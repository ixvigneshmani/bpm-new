/* ─── Timer Scheduler Service ────────────────────────────────────────
 * P2 Session 4 — the engine's wake-me-up-later queue. Pulls rows from
 * SCHEDULED_TIMERS via `FOR UPDATE SKIP LOCKED` (same pattern as
 * WorkerService) and dispatches kind-specific callbacks registered by
 * other services (e.g. EngineService registers `task-due-reminder`).
 *
 * Lifecycle / idempotency contract (Decision #1):
 *   1. Poll: SELECT FOR UPDATE SKIP LOCKED rows where status='pending'
 *      and fire_at <= NOW(). Atomic UPDATE flips them to 'firing' in
 *      the same CTE so two parallel pollers can't claim the same row.
 *   2. Dispatch the registered callback.
 *   3. DELETE the row.
 *
 * Crash between steps 1 and 3 leaves the row stuck in 'firing'. The
 * `recoverStaleFiring()` query at the top of every poll re-picks rows
 * older than RECOVERY_THRESHOLD_MS and resets them to 'pending'. This
 * accepts rare double-fires only on a crash + recovery boundary, which
 * is fine for task-due reminders (audit row + outbox event — both
 * idempotent enough for downstream consumers).
 *
 * Bootstrap backfill (Decision #2): once on application start, scan
 * waiting userTask tokens whose `dueAt` is set AND no SCHEDULED_TIMERS
 * row references them, then INSERT timer rows. Catches pre-Session-4
 * tasks already in-flight.
 *
 * Skipped under NODE_ENV=test / WORKER_DISABLED=1 so vitest specs stay
 * deterministic.
 * ──────────────────────────────────────────────────────────────────── */

import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import { instanceTokens, scheduledTimers } from "../database/schema";

const POLL_INTERVAL_MS = 10 * 1000;
const RECOVERY_THRESHOLD_MS = 5 * 60 * 1000;
const POLL_BATCH_SIZE = 50;

export interface ClaimedTimer {
  id: string;
  tenantId: string;
  instanceId: string;
  tokenId: string | null;
  fireAt: Date;
  kind: string;
  payload: unknown;
}

export type TimerCallback = (timer: ClaimedTimer) => Promise<void>;

@Injectable()
export class TimerSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TimerSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private currentTick: Promise<void> | null = null;
  private readonly callbacks = new Map<string, TimerCallback>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  registerCallback(kind: string, cb: TimerCallback): void {
    this.callbacks.set(kind, cb);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === "test" || process.env.WORKER_DISABLED === "1") {
      this.logger.log("Timer scheduler disabled (test mode).");
      return;
    }
    try {
      const backfilled = await this.backfillMissingTimers();
      if (backfilled > 0) {
        this.logger.log(`Bootstrap backfill: inserted ${backfilled} timer rows for in-flight tasks.`);
      }
    } catch (err) {
      this.logger.error(
        `Bootstrap backfill failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
    this.running = true;
    this.scheduleNextTick();
    this.logger.log("Timer scheduler started.");
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

  /** Public so tests + admin tooling can run a tick on demand. */
  async tick(): Promise<{ recovered: number; fired: number; failed: number }> {
    const recovered = await this.recoverStaleFiring();
    const claimed = await this.claim(POLL_BATCH_SIZE);
    let fired = 0;
    let failed = 0;
    for (const t of claimed) {
      try {
        const cb = this.callbacks.get(t.kind);
        if (!cb) {
          this.logger.warn(`No callback registered for timer kind "${t.kind}" (timer ${t.id}).`);
          // Drop the row so we don't poll-spin on it. Re-register the
          // callback + restart the API to re-enable that kind.
          await this.db.delete(scheduledTimers).where(eq(scheduledTimers.id, t.id));
          continue;
        }
        await cb(t);
        await this.db.delete(scheduledTimers).where(eq(scheduledTimers.id, t.id));
        fired++;
      } catch (err) {
        failed++;
        this.logger.error(
          `Timer ${t.id} (${t.kind}) callback failed: ${(err as Error).message}`,
          (err as Error).stack,
        );
        // Leave the row in `firing`; the recovery query will retry it
        // after RECOVERY_THRESHOLD_MS. Sentry hook (if wired at the
        // app level via Logger) catches the error too.
      }
    }
    return { recovered, fired, failed };
  }

  /** Insert a new timer row. Idempotency is the caller's job — the
   *  engine cancels existing timers for a token before scheduling a
   *  new one in the same context. */
  async scheduleTimer(
    args: {
      tenantId: string;
      instanceId: string;
      tokenId: string | null;
      fireAt: Date;
      kind: string;
      payload?: unknown;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<{ id: string }> {
    const exec = tx ?? this.db;
    const rows = await exec
      .insert(scheduledTimers)
      .values({
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: args.tokenId,
        fireAt: args.fireAt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        kind: args.kind as any,
        payload: args.payload ?? null,
      })
      .returning({ id: scheduledTimers.id });
    return { id: rows[0].id };
  }

  /** Cancel by tokenId. Pass `tx` to participate in an existing
   *  transaction (so completeTask / skipTask atomically cancel the
   *  reminder alongside the token state change). */
  async cancelTimer(
    tokenId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(scheduledTimers)
      .where(eq(scheduledTimers.tokenId, tokenId))
      .returning({ id: scheduledTimers.id });
    return rows.length;
  }

  async cancelTimersForInstance(
    instanceId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(scheduledTimers)
      .where(eq(scheduledTimers.instanceId, instanceId))
      .returning({ id: scheduledTimers.id });
    return rows.length;
  }

  private scheduleNextTick(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.currentTick = this.tick()
        .then(() => undefined)
        .catch((err) => {
          this.logger.error(
            `Timer tick failed: ${(err as Error).message}`,
            (err as Error).stack,
          );
        })
        .finally(() => {
          this.currentTick = null;
          this.scheduleNextTick();
        });
    }, POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Recover rows stuck in `firing` after a worker crash. Resets them
   *  to `pending` so the next claim picks them up. */
  private async recoverStaleFiring(): Promise<number> {
    const cutoff = new Date(Date.now() - RECOVERY_THRESHOLD_MS);
    const rows = await this.db.execute(
      sql`
        UPDATE "SCHEDULED_TIMERS"
        SET "STATUS" = 'pending',
            "FIRING_STARTED_AT" = NULL
        WHERE "STATUS" = 'firing'
          AND "FIRING_STARTED_AT" < ${cutoff}
        RETURNING "ID";
      `,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rows as any).rows ?? rows;
    return (raw as unknown[]).length;
  }

  /** CTE that SELECT FOR UPDATE SKIP LOCKED + UPDATE flips due rows to
   *  `firing` atomically. Same pattern as WorkerService.claim. */
  private async claim(batchSize: number): Promise<ClaimedTimer[]> {
    const now = new Date();
    const rows = await this.db.execute(
      sql`
        WITH claimed AS (
          SELECT "ID" FROM "SCHEDULED_TIMERS"
          WHERE "STATUS" = 'pending' AND "FIRE_AT" <= ${now}
          ORDER BY "FIRE_AT" ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "SCHEDULED_TIMERS" t
        SET "STATUS" = 'firing',
            "FIRING_STARTED_AT" = ${now}
        FROM claimed
        WHERE t."ID" = claimed."ID"
        RETURNING t."ID", t."TENANT_ID", t."INSTANCE_ID", t."TOKEN_ID",
                  t."FIRE_AT", t."KIND", t."PAYLOAD";
      `,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rows as any).rows ?? rows;
    return (raw as Array<Record<string, unknown>>).map((r) => ({
      id: r.ID as string,
      tenantId: r.TENANT_ID as string,
      instanceId: r.INSTANCE_ID as string,
      tokenId: (r.TOKEN_ID as string | null) ?? null,
      // node-postgres returns timestamps as Date when the column type
      // is registered with the parser, BUT drizzle's `sql.execute()`
      // bypasses drizzle's coercion and pg's default for TIMESTAMPTZ
      // can come through as string or Date depending on the pg-types
      // version. Normalize at the boundary so dispatchers can safely
      // treat fireAt as a Date.
      fireAt: r.FIRE_AT instanceof Date ? r.FIRE_AT : new Date(r.FIRE_AT as string),
      kind: r.KIND as string,
      payload: r.PAYLOAD,
    }));
  }

  /** Bootstrap one-shot: find waiting userTask tokens with dueAt set
   *  but no matching SCHEDULED_TIMERS row, then INSERT timer rows
   *  pointing at their dueAt. Picks up pre-Session-4 tasks. */
  private async backfillMissingTimers(): Promise<number> {
    // Find candidates first so we can build INSERT values cleanly.
    const candidates = await this.db
      .select({
        id: instanceTokens.id,
        tenantId: instanceTokens.tenantId,
        instanceId: instanceTokens.instanceId,
        dueAt: instanceTokens.dueAt,
      })
      .from(instanceTokens)
      .where(
        and(
          eq(instanceTokens.status, "waiting"),
          eq(instanceTokens.waitingFor, "userTask"),
          isNotNull(instanceTokens.dueAt),
        ),
      );
    if (candidates.length === 0) return 0;
    // Filter out ones that already have a timer row.
    const existing = await this.db.execute<{ TOKEN_ID: string }>(
      sql`SELECT "TOKEN_ID" FROM "SCHEDULED_TIMERS"
          WHERE "KIND" = 'task-due-reminder'
            AND "TOKEN_ID" = ANY(${sql.raw(`ARRAY[${candidates.map((c) => `'${c.id}'`).join(",")}]::uuid[]`)})`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingRaw = (existing as any).rows ?? existing;
    const haveTimer = new Set((existingRaw as Array<{ TOKEN_ID: string }>).map((r) => r.TOKEN_ID));
    const toInsert = candidates.filter((c) => !haveTimer.has(c.id) && c.dueAt);
    if (toInsert.length === 0) return 0;
    await this.db.insert(scheduledTimers).values(
      toInsert.map((c) => ({
        tenantId: c.tenantId,
        instanceId: c.instanceId,
        tokenId: c.id,
        fireAt: c.dueAt as Date,
        kind: "task-due-reminder" as const,
        payload: { source: "bootstrap-backfill" },
      })),
    );
    return toInsert.length;
  }
}
