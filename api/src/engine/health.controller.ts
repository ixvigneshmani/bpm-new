/* ─── Engine health probe (GAP-02) ──────────────────────────────────
 * GET /engine/health — liveness + DB-reachability check intended for
 * k8s probes / load balancers. No auth: probe targets need to hit it
 * without a token, and we deliberately don't return tenant data so
 * there's nothing to leak.
 *
 * Auth-gated detailed counts (queued / dead jobs per tenant) are a
 * separate /engine/health/detailed endpoint scoped to admins; not
 * shipped in v1 since nothing currently consumes it.
 * ──────────────────────────────────────────────────────────────────── */

import { Controller, Get, HttpCode, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";

@Controller("engine")
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get("health")
  @HttpCode(200)
  async health(): Promise<{
    ok: boolean;
    dbReachable: boolean;
    checkedAt: string;
  }> {
    const checkedAt = new Date().toISOString();
    let dbReachable = false;
    try {
      // Cheapest reachability check that actually exercises the
      // connection pool — `SELECT 1` round-trips a query without
      // touching application tables.
      await this.db.execute(sql`SELECT 1`);
      dbReachable = true;
    } catch {
      // Swallow the error: a 200 with dbReachable=false is more useful
      // to a probe than a 5xx that hides which subsystem failed.
    }
    return {
      ok: dbReachable,
      dbReachable,
      checkedAt,
    };
  }
}
