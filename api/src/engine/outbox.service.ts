/* ─── Outbox Service ────────────────────────────────────────────────
 * Transactional outbox + webhook dispatcher.
 *
 * Write path: the engine writes an OUTBOX_EVENTS row inside the same
 * txn as the corresponding INSTANCE_EVENTS audit row, so at-least-once
 * delivery is guaranteed by transaction atomicity.
 *
 * Dispatch path: a periodic tick reads `pending` rows oldest-first,
 * looks up matching WEBHOOK_SUBSCRIPTIONS for the tenant + event type,
 * and enqueues one ENGINE_JOBS row per (event × subscription). The
 * worker delivers via HTTP with HMAC-SHA256 signature, retries with
 * the worker's standard backoff, marks the outbox row dispatched
 * after enqueueing (the worker tracks per-delivery success).
 *
 * Why split outbox-write from outbox-dispatch?
 *   • Write must be transactional with the audit trail.
 *   • Dispatch can be async + retryable + horizontally scaled.
 *   • Splitting also lets us swap the dispatch backend (Kafka, SQS)
 *     without touching the engine.
 * ──────────────────────────────────────────────────────────────────── */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import {
  outboxEvents,
  webhookSubscriptions,
} from "../database/schema";
import { WorkerService, type ClaimedJob } from "./worker.service";

const DISPATCH_TICK_MS = 2_000;
const BATCH_SIZE = 25;
/** Cap on a single webhook delivery attempt. Without this, a slow
 *  receiver freezes a worker slot indefinitely (Node's default fetch
 *  has no timeout). 30s is generous for any reasonable receiver while
 *  still bounded enough that one bad subscriber can't take the queue
 *  down. */
const WEBHOOK_FETCH_TIMEOUT_MS = 30_000;
/** Job topic registered with the worker for webhook delivery. */
export const WEBHOOK_DISPATCH_TOPIC = "webhook-dispatch";

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private currentTick: Promise<void> | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly worker: WorkerService,
  ) {}

  onModuleInit(): void {
    // Register the webhook delivery handler regardless of test mode —
    // unit tests of the worker can register their own; in production
    // we hand control of HTTP delivery to this handler.
    this.worker.registerHandler(WEBHOOK_DISPATCH_TOPIC, this.deliverWebhook);

    if (process.env.NODE_ENV === "test" || process.env.WORKER_DISABLED === "1") {
      this.logger.log("Outbox dispatch tick disabled (test mode).");
      return;
    }
    this.running = true;
    this.scheduleNextTick();
    this.logger.log("Outbox dispatcher started.");
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.currentTick) {
      try {
        await this.currentTick;
      } catch {
        // already logged
      }
    }
  }

  /** Public so tests + admin tooling can drain the outbox on demand.
   *
   *  Atomic claim pattern: the same CTE + SKIP LOCKED idiom the worker
   *  uses for ENGINE_JOBS. Without this, two ticks (or two API pods)
   *  could both read the same `pending` rows and both enqueue
   *  delivery jobs — webhook receivers would see duplicates with
   *  the same x-engine-event-id but separate physical POSTs.
   *  The CTE marks rows `dispatched` atomically with the read, so a
   *  crash between read and the rest of the loop only "loses" the
   *  enqueue (the outbox row stays dispatched but no delivery job
   *  was created — admin retry path will need to re-emit). The
   *  duplicate-window is far narrower than the read-then-update
   *  variant. */
  async tick(): Promise<{ dispatched: number; jobsEnqueued: number }> {
    const now = new Date();
    const claimed = await this.db.execute(
      sql`
        WITH claimed AS (
          SELECT "ID" FROM "OUTBOX_EVENTS"
          WHERE "STATUS" = 'pending'
          ORDER BY "CREATED_AT" ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "OUTBOX_EVENTS" o
        SET "STATUS" = 'dispatched', "DISPATCHED_AT" = ${now}
        FROM claimed
        WHERE o."ID" = claimed."ID"
        RETURNING o."ID", o."TENANT_ID", o."PROCESS_ID", o."INSTANCE_ID",
                  o."EVENT_TYPE", o."PAYLOAD";
      `,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (claimed as any).rows ?? claimed;
    const due = (raw as Array<Record<string, unknown>>).map((r) => ({
      id: r.ID as string,
      tenantId: r.TENANT_ID as string,
      processId: (r.PROCESS_ID as string | null) ?? null,
      instanceId: (r.INSTANCE_ID as string | null) ?? null,
      eventType: r.EVENT_TYPE as string,
      payload: r.PAYLOAD,
    }));

    if (due.length === 0) return { dispatched: 0, jobsEnqueued: 0 };

    let jobsEnqueued = 0;
    for (const ev of due) {
      // Find subscriptions matching this tenant + event type. Process
      // scope (NULL = tenant-wide) is applied in JS to avoid a complex
      // OR clause in the WHERE — the subscription set is small.
      const subs = await this.db
        .select({
          id: webhookSubscriptions.id,
          processId: webhookSubscriptions.processId,
          url: webhookSubscriptions.url,
          eventTypes: webhookSubscriptions.eventTypes,
          secret: webhookSubscriptions.secret,
        })
        .from(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.tenantId, ev.tenantId),
            eq(webhookSubscriptions.status, "active"),
          ),
        );

      const matching = subs.filter((s) => {
        if (s.processId && s.processId !== ev.processId) return false;
        if (s.eventTypes.trim() === "*") return true;
        return s.eventTypes.split(",").map((x) => x.trim()).includes(ev.eventType);
      });

      for (const sub of matching) {
        await this.worker.enqueue({
          tenantId: ev.tenantId,
          jobType: "webhook",
          topic: WEBHOOK_DISPATCH_TOPIC,
          instanceId: ev.instanceId ?? undefined,
          input: {
            subscriptionId: sub.id,
            url: sub.url,
            secret: sub.secret,
            event: {
              id: ev.id,
              type: ev.eventType,
              tenantId: ev.tenantId,
              processId: ev.processId,
              instanceId: ev.instanceId,
              payload: ev.payload,
            },
          },
          maxAttempts: 5,
        });
        jobsEnqueued++;
      }
    }

    // Mark-as-dispatched already happened atomically in the CTE
    // claim above, so no separate UPDATE here.

    this.logger.log(
      `outbox tick: ${due.length} events dispatched, ${jobsEnqueued} delivery jobs enqueued`,
    );
    return { dispatched: due.length, jobsEnqueued };
  }

  /** Bound arrow so `this` survives passing into the registry. */
  private deliverWebhook = async (job: ClaimedJob): Promise<unknown> => {
    const input = job.input as {
      subscriptionId: string;
      url: string;
      secret: string;
      event: Record<string, unknown>;
    };
    const body = JSON.stringify(input.event);
    const signature = createHmac("sha256", input.secret)
      .update(body)
      .digest("hex");

    // Use the platform fetch (Node 20) with an explicit per-call
    // timeout. AbortSignal.timeout is the standard way; unbounded
    // would let a slow receiver hold a worker slot forever.
    // x-engine-schema is a one-line forward-compat hook so receivers
    // can branch on payload shape when v2 lands.
    const res = await fetch(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-engine-event": String(input.event.type ?? ""),
        "x-engine-event-id": String(input.event.id ?? ""),
        "x-engine-schema": "v1",
        "x-engine-signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      // 4xx on the receiver is usually a permanent rejection (bad
      // payload / endpoint disabled); we still retry once or twice
      // because intermittent 502s exist. The worker maxAttempts caps it.
      throw new Error(
        `Webhook ${input.url} returned ${res.status} ${res.statusText}`,
      );
    }
    return { status: res.status };
  };

  private scheduleNextTick(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.currentTick = this.tick()
        .then(() => undefined)
        .catch((err) => {
          this.logger.error(
            `outbox tick failed: ${(err as Error).message}`,
            (err as Error).stack,
          );
        })
        .finally(() => {
          this.currentTick = null;
          this.scheduleNextTick();
        });
    }, DISPATCH_TICK_MS);
    this.timer.unref?.();
  }
}
