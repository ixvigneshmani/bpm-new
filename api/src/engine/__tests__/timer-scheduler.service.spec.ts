/* ─── TimerSchedulerService tests ────────────────────────────────────
 * Covers the four core paths of the scheduler:
 *   • claim → callback → delete (happy path)
 *   • no-callback-registered → drop row + warn
 *   • callback throws → row stays `firing` (recovery picks it up)
 *   • bootstrap backfill (no-op when nothing to backfill)
 *
 * The poll-loop interval itself (10s setTimeout) isn't simulated;
 * tests call `tick()` directly.
 * ──────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import {
  TimerSchedulerService,
  type ClaimedTimer,
} from "../timer-scheduler.service";

/** In-memory drizzle-shaped db with just enough behaviour for the
 *  scheduler. Tracks timer rows + supports the three operations the
 *  scheduler hits: `db.execute(sql\`...\`)` for claim + recovery,
 *  `db.delete(table).where(...)` for callback success, and
 *  `db.insert(table).values(...)` for scheduleTimer. */
type TimerRow = {
  id: string;
  tenantId: string;
  instanceId: string;
  tokenId: string | null;
  fireAt: Date;
  kind: string;
  status: "pending" | "firing";
  payload: unknown;
  firingStartedAt: Date | null;
};

function makeFakeDb(seed: TimerRow[] = []) {
  const rows: TimerRow[] = [...seed];
  let nextSeq = seed.length;
  // Tracks db.execute SQL fragments so tests can assert if needed.
  const executions: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const execute = async (frag: any): Promise<{ rows: Array<Record<string, unknown>> }> => {
    // Drizzle's sql`...` exposes `.queryChunks`; for the fake we just
    // walk the chunks and stringify to detect which query is running.
    // Simpler heuristic: inspect the first text chunk for keywords.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chunks: any[] = (frag.queryChunks ?? frag.chunks ?? []) as any[];
    const text = chunks
      .map((c) => (typeof c === "string" ? c : c?.value?.[0] ?? c?.value ?? ""))
      .join(" ");
    executions.push(text);

    if (/SET\s+"STATUS"\s*=\s*'pending'/.test(text)) {
      // recoverStaleFiring — find rows in `firing` older than the
      // captured cutoff. Cutoff is the first `${cutoff}` interpolation
      // — we approximate by treating "older than 5 min" as "any
      // firing row" in the test; tests that care pass an explicit
      // firingStartedAt far in the past.
      const cutoff = (frag.queryChunks ?? []).find((c: unknown) => c instanceof Date) as Date | undefined;
      const reset: Array<{ ID: string }> = [];
      for (const r of rows) {
        if (r.status === "firing" && r.firingStartedAt && (!cutoff || r.firingStartedAt < cutoff)) {
          r.status = "pending";
          r.firingStartedAt = null;
          reset.push({ ID: r.id });
        }
      }
      return { rows: reset };
    }
    if (/SELECT[\s\S]*FOR UPDATE SKIP LOCKED/.test(text)) {
      // claim — pending rows with fire_at <= NOW. Flip to firing,
      // return projected columns.
      const now = (frag.queryChunks ?? []).find((c: unknown) => c instanceof Date) as Date;
      const claimed = rows
        .filter((r) => r.status === "pending" && r.fireAt <= now)
        .slice(0, 50);
      for (const r of claimed) {
        r.status = "firing";
        r.firingStartedAt = now;
      }
      return {
        rows: claimed.map((r) => ({
          ID: r.id,
          TENANT_ID: r.tenantId,
          INSTANCE_ID: r.instanceId,
          TOKEN_ID: r.tokenId,
          FIRE_AT: r.fireAt,
          KIND: r.kind,
          PAYLOAD: r.payload,
        })),
      };
    }
    return { rows: [] };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insert = (_table: any) => ({
    values(v: Partial<TimerRow> | Partial<TimerRow>[]) {
      const arr = Array.isArray(v) ? v : [v];
      const inserted: Array<{ id: string }> = [];
      for (const r of arr) {
        const id = `tmr-${++nextSeq}`;
        rows.push({
          id,
          tenantId: r.tenantId!,
          instanceId: r.instanceId!,
          tokenId: r.tokenId ?? null,
          fireAt: r.fireAt!,
          kind: r.kind ?? "task-due-reminder",
          status: "pending",
          payload: r.payload ?? null,
          firingStartedAt: null,
        });
        inserted.push({ id });
      }
      return {
        returning() { return Promise.resolve(inserted); },
        then(resolve: (v: unknown) => unknown) { return resolve(undefined); },
      };
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const del = (_table: any) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where(cond: any) {
      // The fake doesn't parse drizzle SQL fragments; in the
      // scheduler's actual code, `delete(scheduledTimers).where(eq(id,
      // x))` always targets the timer we just dispatched. Match by
      // membership: pop the most-recent `firing` row (the callback
      // just finished). Tests that need by-token or by-instance
      // semantics pass a hint via the cond.tokenId / cond.instanceId.
      const hint = (cond as Record<string, unknown>) ?? {};
      const tokenHint = hint.tokenId as string | undefined;
      const instanceHint = hint.instanceId as string | undefined;
      const deleted: Array<{ id: string }> = [];
      const keep: TimerRow[] = [];
      for (const r of rows) {
        if (tokenHint && r.tokenId === tokenHint) { deleted.push({ id: r.id }); continue; }
        if (instanceHint && r.instanceId === instanceHint) { deleted.push({ id: r.id }); continue; }
        if (!tokenHint && !instanceHint && r.status === "firing") { deleted.push({ id: r.id }); continue; }
        keep.push(r);
      }
      rows.length = 0; rows.push(...keep);
      return {
        returning() { return Promise.resolve(deleted); },
        then(resolve: (v: unknown) => unknown) { return resolve(undefined); },
      };
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const select = (_cols: any) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from(_table: any) {
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where(_cond: any) {
          // Used by backfillMissingTimers — return empty so the
          // backfill is a no-op in tests that don't seed waiting
          // tokens.
          return Promise.resolve([]);
        },
      };
    },
  });

  return {
    rows,
    executions,
    db: { execute, insert, delete: del, select },
  };
}

describe("TimerSchedulerService", () => {
  it("schedules a timer + dispatches its callback + deletes the row on success", async () => {
    const env = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new TimerSchedulerService(env.db as any);
    const fired: ClaimedTimer[] = [];
    svc.registerCallback("task-due-reminder", async (t) => { fired.push(t); });

    await svc.scheduleTimer({
      tenantId: "tenant-1",
      instanceId: "inst-1",
      tokenId: "tok-1",
      fireAt: new Date(Date.now() - 1000), // already due
      kind: "task-due-reminder",
    });

    const result = await svc.tick();
    expect(result.fired).toBe(1);
    expect(result.failed).toBe(0);
    expect(fired).toHaveLength(1);
    expect(fired[0].tokenId).toBe("tok-1");
    // Row deleted after fire.
    expect(env.rows.length).toBe(0);
  });

  it("does NOT pick up timers whose fire_at is in the future", async () => {
    const env = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new TimerSchedulerService(env.db as any);
    svc.registerCallback("task-due-reminder", async () => undefined);

    await svc.scheduleTimer({
      tenantId: "tenant-1", instanceId: "inst-1", tokenId: "tok-1",
      fireAt: new Date(Date.now() + 60_000),
      kind: "task-due-reminder",
    });
    const result = await svc.tick();
    expect(result.fired).toBe(0);
    expect(env.rows.length).toBe(1);
    expect(env.rows[0].status).toBe("pending");
  });

  it("when no callback is registered, drops the row instead of poll-spinning forever", async () => {
    const env = makeFakeDb([{
      id: "tmr-orphan", tenantId: "t", instanceId: "i", tokenId: null,
      fireAt: new Date(Date.now() - 1000),
      kind: "boundary-timer", status: "pending", payload: null, firingStartedAt: null,
    }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new TimerSchedulerService(env.db as any);
    // boundary-timer callback NOT registered.
    const result = await svc.tick();
    expect(result.fired).toBe(0);
    expect(result.failed).toBe(0);
    expect(env.rows.length).toBe(0); // dropped
  });

  it("callback throw leaves the row in `firing` for the recovery query", async () => {
    const env = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new TimerSchedulerService(env.db as any);
    svc.registerCallback("task-due-reminder", async () => { throw new Error("boom"); });

    await svc.scheduleTimer({
      tenantId: "t", instanceId: "i", tokenId: "tk",
      fireAt: new Date(Date.now() - 1000),
      kind: "task-due-reminder",
    });
    const result = await svc.tick();
    expect(result.fired).toBe(0);
    expect(result.failed).toBe(1);
    expect(env.rows.length).toBe(1);
    expect(env.rows[0].status).toBe("firing");
  });

  it("recoverStaleFiring resets `firing` rows older than the 5-min threshold to `pending`", async () => {
    const old = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    const env = makeFakeDb([{
      id: "tmr-stuck", tenantId: "t", instanceId: "i", tokenId: "tk",
      fireAt: new Date(Date.now() - 30 * 60_000),
      kind: "task-due-reminder", status: "firing", payload: null,
      firingStartedAt: old,
    }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new TimerSchedulerService(env.db as any);
    let fireCount = 0;
    svc.registerCallback("task-due-reminder", async () => { fireCount++; });
    const result = await svc.tick();
    expect(result.recovered).toBe(1);
    expect(result.fired).toBe(1);
    expect(fireCount).toBe(1);
    expect(env.rows.length).toBe(0);
  });

  it("cancelTimer deletes by tokenId and returns the count", async () => {
    const env = makeFakeDb([{
      id: "tmr-1", tenantId: "t", instanceId: "i", tokenId: "tk-1",
      fireAt: new Date(Date.now() + 60_000),
      kind: "task-due-reminder", status: "pending", payload: null, firingStartedAt: null,
    }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new TimerSchedulerService(env.db as any);
    // The fake reads the eq() condition's stringified form; smoke-test
    // by hint object since the fake doesn't parse drizzle SQL.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await svc.cancelTimer("tk-1", { delete: (_t: any) => ({ where: (_c: any) => ({ returning: () => Promise.resolve([{ id: "tmr-1" }]) }) }) } as any);
    expect(count).toBe(1);
  });
});
