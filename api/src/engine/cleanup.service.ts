/* ─── Cleanup Service ───────────────────────────────────────────────
 * Periodic housekeeping tasks that don't deserve a dedicated worker
 * but would otherwise let the database grow unbounded:
 *   • Sweep expired IDEMPOTENCY_KEYS rows.
 *   • Reclaim stale ENGINE_JOBS in `running` whose worker crashed
 *     mid-execution (reset to `queued`).
 *
 * Implemented as a self-rescheduling setTimeout instead of pulling in
 * @nestjs/schedule (one less dep). One-minute interval is plenty for
 * MVP — the costliest delete is a few hundred rows. Skipped under
 * NODE_ENV=test for deterministic specs.
 * ──────────────────────────────────────────────────────────────────── */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { lt } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import { idempotencyKeys } from "../database/schema";
import { WorkerService } from "./worker.service";

const TICK_INTERVAL_MS = 60 * 1000;

@Injectable()
export class CleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CleanupService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private currentTick: Promise<void> | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly worker: WorkerService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test" || process.env.WORKER_DISABLED === "1") {
      this.logger.log("Cleanup tick disabled (test mode).");
      return;
    }
    this.running = true;
    this.scheduleNextTick();
    this.logger.log("Cleanup service started.");
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

  /** Public so tests + admin tooling can run a sweep on demand. */
  async tick(): Promise<{ idempotencyDeleted: number; jobsReclaimed: number }> {
    const idempotencyDeleted = await this.sweepExpiredIdempotencyKeys();
    const jobsReclaimed = await this.worker.reclaimStaleJobs();
    if (idempotencyDeleted > 0 || jobsReclaimed > 0) {
      this.logger.log(
        `cleanup tick: ${idempotencyDeleted} idempotency rows deleted, ${jobsReclaimed} stale jobs reclaimed`,
      );
    }
    return { idempotencyDeleted, jobsReclaimed };
  }

  private scheduleNextTick(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.currentTick = this.tick()
        .then(() => undefined)
        .catch((err) => {
          this.logger.error(
            `cleanup tick failed: ${(err as Error).message}`,
            (err as Error).stack,
          );
        })
        .finally(() => {
          this.currentTick = null;
          this.scheduleNextTick();
        });
    }, TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  private async sweepExpiredIdempotencyKeys(): Promise<number> {
    const deleted = await this.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, new Date()))
      .returning({ id: idempotencyKeys.id });
    return deleted.length;
  }
}
