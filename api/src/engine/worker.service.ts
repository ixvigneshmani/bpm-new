/* ─── Worker Service ────────────────────────────────────────────────
 * Durable async work queue for the engine. Pulls `queued` jobs from
 * ENGINE_JOBS using SELECT FOR UPDATE SKIP LOCKED, runs the registered
 * handler, marks completed/failed/dead with exponential backoff retry.
 *
 * Why a custom queue instead of BullMQ/pg-boss?
 *   • Keeps infra to {Postgres, Node} — no Redis dependency, no
 *     additional library churn for the MVP.
 *   • SKIP LOCKED gives us multi-process safety without a coordinator.
 *   • Trivial to swap out: handler registry + enqueue API are the
 *     only surface area. A future BullMQ migration touches this file.
 *
 * Lifecycle:
 *   OnModuleInit → start the polling loop (default 1s tick).
 *   OnModuleDestroy → stop the loop, wait for in-flight jobs.
 *
 * Handlers register themselves at boot via `registerHandler(topic, fn)`.
 * E5 will register a `service-task` handler that dispatches by the
 * job's `topic` (the user-defined integration key on the canvas node).
 *
 * Resume contract: when a handler completes, it's the handler's job
 * to call back into EngineService to advance the suspended token.
 * The worker doesn't auto-resume — different job kinds may have
 * different completion semantics (service task → resume token,
 * webhook dispatch → no token to resume).
 * ──────────────────────────────────────────────────────────────────── */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import { engineJobs } from "../database/schema";

/** A handler runs against the claimed job row. Throwing reschedules
 *  the job with backoff (until maxAttempts, then `dead`). Returning a
 *  value persists it as `result` on the row. The handler is expected
 *  to be idempotent: a worker crash mid-execution will requeue the
 *  job after a stale-lock timeout (post-MVP — for now, manual). */
export type JobHandler = (job: ClaimedJob) => Promise<unknown>;

export type ClaimedJob = {
  id: string;
  tenantId: string;
  instanceId: string | null;
  tokenId: string | null;
  jobType: string;
  topic: string;
  input: unknown;
  attempts: number;
  maxAttempts: number;
};

/** Backoff schedule (ms) by attempt count. After exhausting the
 *  schedule the job is marked `dead` regardless of `maxAttempts`.
 *  Gentle ramp because most failures are transient (network blip,
 *  rate limit) and a 5-minute wait is plenty for those. */
const BACKOFF_MS = [5_000, 30_000, 120_000, 300_000, 1_800_000];

/** How many jobs to claim per tick. Bounded so a single node doesn't
 *  starve siblings; SKIP LOCKED makes scaling horizontal. */
const BATCH_SIZE = 5;

/** Default tick interval. Jobs scheduled in the future poll at most
 *  this often. Lower latency would mean polling more aggressively;
 *  the right answer post-MVP is LISTEN/NOTIFY for instant wake-ups. */
const TICK_INTERVAL_MS = 1_000;

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private readonly workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  /** When false, the tick loop exits at the next iteration boundary
   *  and any new ticks no-op. Set on shutdown so OnModuleDestroy
   *  can wait for the in-flight tick to drain. */
  private running = false;
  /** Lets tests + tools advance the loop deterministically without
   *  waiting for the timer. Production never reads this. */
  private currentTick: Promise<void> | null = null;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Register a handler for a job topic. Topic format is convention,
   *  not enforced — for service tasks E5 will use `service-task:<topic>`,
   *  for webhooks E4.5c uses `webhook-dispatch`. The first
   *  registration wins; re-registering the same topic logs a warning. */
  registerHandler(topic: string, handler: JobHandler): void {
    if (this.handlers.has(topic)) {
      this.logger.warn(`Worker handler for "${topic}" re-registered; ignoring.`);
      return;
    }
    this.handlers.set(topic, handler);
    this.logger.log(`Registered worker handler: ${topic}`);
  }

  /** Enqueue a job. Idempotency is the caller's responsibility — the
   *  engine deduplicates by setting (instanceId, tokenId, topic) on
   *  service tasks since a token can only suspend on one outbound job
   *  at a time. Returns the new job id.
   *
   *  Note: if `maxAttempts` exceeds the BACKOFF_MS schedule length
   *  (5), the effective cap is the schedule length — a `maxAttempts`
   *  of 100 still dies after 5 tries. Logged as a warn so callers
   *  spot the silent cap; tighten or extend BACKOFF_MS if you need
   *  more attempts. */
  async enqueue(args: {
    tenantId: string;
    jobType: string;
    topic: string;
    instanceId?: string;
    tokenId?: string;
    input?: Record<string, unknown>;
    maxAttempts?: number;
    /** Schedule the first attempt for some time in the future. Used
     *  for retry-after semantics or future timer events. Defaults to
     *  `now`, meaning the next tick claims it. */
    scheduledFor?: Date;
  }): Promise<{ id: string }> {
    if (args.maxAttempts && args.maxAttempts > BACKOFF_MS.length) {
      this.logger.warn(
        `enqueue(${args.topic}): maxAttempts=${args.maxAttempts} exceeds BACKOFF_MS schedule length (${BACKOFF_MS.length}); effective cap is ${BACKOFF_MS.length}.`,
      );
    }
    const [row] = await this.db
      .insert(engineJobs)
      .values({
        tenantId: args.tenantId,
        instanceId: args.instanceId ?? null,
        tokenId: args.tokenId ?? null,
        jobType: args.jobType,
        topic: args.topic,
        input: args.input ?? null,
        maxAttempts: args.maxAttempts ?? 3,
        scheduledFor: args.scheduledFor ?? new Date(),
      })
      .returning({ id: engineJobs.id });
    return { id: row.id };
  }

  /** OnModuleInit: kick off the poll loop. Skipped under NODE_ENV=test
   *  so unit tests can drive `tick()` deterministically without racing
   *  the timer. */
  onModuleInit(): void {
    if (process.env.NODE_ENV === "test" || process.env.WORKER_DISABLED === "1") {
      this.logger.log("Worker tick loop disabled (test mode).");
      return;
    }
    this.running = true;
    this.scheduleNextTick();
    this.logger.log(`Worker started: ${this.workerId}`);
  }

  /** OnModuleDestroy: stop scheduling new ticks, wait for the current
   *  one to finish so an in-flight handler isn't torn down mid-DB-write. */
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
        // already logged inside tick()
      }
    }
    this.logger.log(`Worker stopped: ${this.workerId}`);
  }

  /** One pass over the job queue: claim up to BATCH_SIZE due rows,
   *  run their handlers, mark each as completed/failed. Public so
   *  tests can drive it. */
  async tick(): Promise<void> {
    if (!this.running && process.env.NODE_ENV !== "test") return;
    let claimed: ClaimedJob[];
    try {
      claimed = await this.claim(BATCH_SIZE);
    } catch (err) {
      this.logger.error(
        `tick claim failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return;
    }
    for (const job of claimed) {
      await this.runOne(job);
    }
  }

  private scheduleNextTick(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.currentTick = this.tick().finally(() => {
        this.currentTick = null;
        this.scheduleNextTick();
      });
    }, TICK_INTERVAL_MS);
    // setTimeout returns an object; call .unref so a long-running
    // worker doesn't keep the process alive past Nest shutdown.
    this.timer.unref?.();
  }

  /** SELECT FOR UPDATE SKIP LOCKED then UPDATE to mark `running`.
   *  Drizzle's helper here uses raw SQL because the `FOR UPDATE
   *  SKIP LOCKED` modifier isn't part of the high-level builder.
   *  Returns the rows transitioned to `running`. */
  private async claim(batchSize: number): Promise<ClaimedJob[]> {
    const now = new Date();
    // Use a CTE so the SELECT FOR UPDATE SKIP LOCKED + UPDATE happen
    // atomically and we don't accidentally claim the same row twice.
    const rows = await this.db.execute(
      sql`
        WITH claimed AS (
          SELECT "ID" FROM "ENGINE_JOBS"
          WHERE "STATUS" = 'queued' AND "SCHEDULED_FOR" <= ${now}
          ORDER BY "SCHEDULED_FOR" ASC, "CREATED_AT" ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "ENGINE_JOBS" j
        SET "STATUS" = 'running',
            "LOCKED_AT" = ${now},
            "LOCKED_BY" = ${this.workerId},
            "ATTEMPTS" = j."ATTEMPTS" + 1,
            "UPDATED_AT" = ${now}
        FROM claimed
        WHERE j."ID" = claimed."ID"
        RETURNING j."ID", j."TENANT_ID", j."INSTANCE_ID", j."TOKEN_ID",
                  j."JOB_TYPE", j."TOPIC", j."INPUT",
                  j."ATTEMPTS", j."MAX_ATTEMPTS";
      `,
    );
    // pg returns rows as a `{ rows: [...] }` shape via drizzle's
    // `execute`. Map to the canonical ClaimedJob shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rows as any).rows ?? rows;
    return (raw as Array<Record<string, unknown>>).map((r) => ({
      id: r.ID as string,
      tenantId: r.TENANT_ID as string,
      instanceId: (r.INSTANCE_ID as string | null) ?? null,
      tokenId: (r.TOKEN_ID as string | null) ?? null,
      jobType: r.JOB_TYPE as string,
      topic: r.TOPIC as string,
      input: r.INPUT,
      attempts: r.ATTEMPTS as number,
      maxAttempts: r.MAX_ATTEMPTS as number,
    }));
  }

  private async runOne(job: ClaimedJob): Promise<void> {
    const handler = this.handlers.get(job.topic);
    if (!handler) {
      // No handler — surface as a fail so ops see the orphan.
      // Don't retry; manual intervention required (deploy the missing
      // handler, then requeue).
      await this.markDead(
        job.id,
        `No worker handler registered for topic "${job.topic}".`,
      );
      this.logger.error(`Job ${job.id}: no handler for topic ${job.topic}`);
      return;
    }
    try {
      const result = await handler(job);
      await this.markCompleted(job.id, result);
    } catch (err) {
      const message = (err as Error).message;
      const isFinalAttempt = job.attempts >= Math.min(job.maxAttempts, BACKOFF_MS.length);
      if (isFinalAttempt) {
        await this.markDead(job.id, message);
        this.logger.error(
          `Job ${job.id} (${job.topic}) → dead after ${job.attempts} attempts: ${message}`,
        );
      } else {
        const delay = BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)];
        await this.markRetry(job.id, message, new Date(Date.now() + delay));
        this.logger.warn(
          `Job ${job.id} (${job.topic}) failed (attempt ${job.attempts}); retry in ${delay}ms`,
        );
      }
    }
  }

  private async markCompleted(id: string, result: unknown): Promise<void> {
    await this.db
      .update(engineJobs)
      .set({
        status: "completed",
        result: (result as Record<string, unknown>) ?? null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(engineJobs.id, id));
  }

  private async markRetry(id: string, error: string, when: Date): Promise<void> {
    await this.db
      .update(engineJobs)
      .set({
        status: "queued",
        scheduledFor: when,
        lastError: error.slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(engineJobs.id, id));
  }

  private async markDead(id: string, error: string): Promise<void> {
    await this.db
      .update(engineJobs)
      .set({
        status: "dead",
        lastError: error.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(engineJobs.id, id));
  }

  /** Operability: list jobs for diagnostics. Capped at 100; an admin
   *  endpoint will pipe this through a controller in the Ops & Security
   *  milestone. Tenant-scoped for safety. */
  async listJobs(args: {
    tenantId: string;
    status?: "queued" | "running" | "completed" | "failed" | "dead";
  }): Promise<
    Array<{
      id: string;
      jobType: string;
      topic: string;
      status: string;
      attempts: number;
      maxAttempts: number;
      scheduledFor: string;
      lastError: string | null;
      createdAt: string;
    }>
  > {
    const conds = [eq(engineJobs.tenantId, args.tenantId)];
    if (args.status) conds.push(eq(engineJobs.status, args.status));
    const rows = await this.db
      .select({
        id: engineJobs.id,
        jobType: engineJobs.jobType,
        topic: engineJobs.topic,
        status: engineJobs.status,
        attempts: engineJobs.attempts,
        maxAttempts: engineJobs.maxAttempts,
        scheduledFor: engineJobs.scheduledFor,
        lastError: engineJobs.lastError,
        createdAt: engineJobs.createdAt,
      })
      .from(engineJobs)
      .where(and(...conds))
      .orderBy(engineJobs.createdAt)
      .limit(100);
    return rows.map((r) => ({
      ...r,
      scheduledFor: r.scheduledFor.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Move a `dead` job back to `queued` for one more shot. Used by
   *  the (future, Ops & Security milestone) admin DLQ-replay
   *  endpoint. Resets attempts so the backoff schedule starts over.
   *  Tenant-scoped to prevent cross-tenant retry. Throws if the job
   *  isn't in `dead`. */
  async retryDead(args: {
    jobId: string;
    tenantId: string;
  }): Promise<{ requeued: boolean }> {
    const updated = await this.db
      .update(engineJobs)
      .set({
        status: "queued",
        attempts: 0,
        scheduledFor: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(engineJobs.id, args.jobId),
          eq(engineJobs.tenantId, args.tenantId),
          eq(engineJobs.status, "dead"),
        ),
      )
      .returning({ id: engineJobs.id });
    return { requeued: updated.length > 0 };
  }

  /** Reclaim stale `running` jobs whose worker presumably crashed.
   *  Runs as part of the cleanup tick (E4.5c). Threshold is 5 minutes
   *  — well past any reasonable handler runtime; tune if you have
   *  long-running handlers. */
  async reclaimStaleJobs(maxRunningAgeMs = 5 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxRunningAgeMs);
    const result = await this.db
      .update(engineJobs)
      .set({
        status: "queued",
        lockedAt: null,
        lockedBy: null,
        scheduledFor: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(engineJobs.status, "running"), lte(engineJobs.lockedAt, cutoff)),
      )
      .returning({ id: engineJobs.id });
    if (result.length > 0) {
      this.logger.warn(`Reclaimed ${result.length} stale running job(s)`);
    }
    return result.length;
  }
}
