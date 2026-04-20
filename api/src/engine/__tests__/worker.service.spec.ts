/* ─── WorkerService tests ──────────────────────────────────────────
 * In-memory fake DB modelling ENGINE_JOBS just well enough to drive
 * tick() through claim → run → complete/retry/dead.
 *
 * Drizzle accepts camelCase TS field names on .values() / .set() and
 * translates to UPPER_CASE columns on the wire. This fake stores rows
 * keyed by the TS names; only the raw `execute()` path returns
 * UPPER_CASE keys (mirroring what pg actually emits for raw SQL).
 *
 * Real concurrency (SKIP LOCKED, multi-process safety) is verified by
 * integration in QA; here we cover the state machine + dispatch.
 * ──────────────────────────────────────────────────────────────────── */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerService, type ClaimedJob } from "../worker.service";

type Row = {
  id: string;
  tenantId: string;
  instanceId: string | null;
  tokenId: string | null;
  jobType: string;
  topic: string;
  input: unknown;
  status: "queued" | "running" | "completed" | "failed" | "dead";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  result: unknown;
  scheduledFor: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  createdAt: Date;
};

function makeFakeDb() {
  const rows: Row[] = [];
  let nextId = 1;

  // Track which row was "just claimed" so update().set() / .where()
  // mutates the right one. Real drizzle introspects the WHERE clause;
  // we approximate via FIFO of claimed-but-not-yet-finished ids.
  const inFlight: string[] = [];

  const newRow = (vals: Record<string, unknown>): Row => ({
    id: `job-${nextId++}`,
    tenantId: String(vals.tenantId ?? ""),
    instanceId: (vals.instanceId as string | null | undefined) ?? null,
    tokenId: (vals.tokenId as string | null | undefined) ?? null,
    jobType: String(vals.jobType ?? ""),
    topic: String(vals.topic ?? ""),
    input: vals.input ?? null,
    status: "queued",
    attempts: 0,
    maxAttempts: (vals.maxAttempts as number | undefined) ?? 3,
    lastError: null,
    result: null,
    scheduledFor: (vals.scheduledFor as Date | undefined) ?? new Date(),
    lockedAt: null,
    lockedBy: null,
    createdAt: new Date(),
  });

  const tableName = (table: unknown): string => {
    if (table && typeof table === "object" && Symbol.for("drizzle:Name") in table) {
      // @ts-expect-error — drizzle internal
      return table[Symbol.for("drizzle:Name")] as string;
    }
    return "unknown";
  };

  const db = {
    insert(_table: unknown) {
      return {
        values(values: Record<string, unknown> | Record<string, unknown>[]) {
          const arr = Array.isArray(values) ? values : [values];
          const created = arr.map((v) => newRow(v));
          for (const r of created) rows.push(r);
          return {
            returning() {
              return Promise.resolve(created.map((r) => ({ id: r.id })));
            },
          };
        },
      };
    },
    update(_table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(_cond: unknown) {
              // Mutate the most recent in-flight job (the one runOne
              // is currently processing). If none, fall back to the
              // most recent running row.
              const targetId = inFlight.shift() ??
                rows.filter((r) => r.status === "running").pop()?.id ??
                rows[rows.length - 1]?.id;
              const target = rows.find((r) => r.id === targetId);
              if (target) {
                if ("status" in values) target.status = values.status as Row["status"];
                if ("lastError" in values) target.lastError = (values.lastError as string | null);
                if ("result" in values) target.result = values.result;
                if ("scheduledFor" in values) target.scheduledFor = values.scheduledFor as Date;
                if ("lockedAt" in values) target.lockedAt = (values.lockedAt as Date | null);
                if ("lockedBy" in values) target.lockedBy = (values.lockedBy as string | null);
              }
              return {
                returning: () => Promise.resolve(target ? [{ id: target.id }] : []),
              };
            },
          };
        },
      };
    },
    select(_cols?: unknown) {
      let routed: string | null = null;
      const chain = {
        from(table: unknown) {
          routed = tableName(table);
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () => {
          if (routed === "ENGINE_JOBS") {
            return Promise.resolve(rows.map((r) => ({
              id: r.id,
              jobType: r.jobType,
              topic: r.topic,
              status: r.status,
              attempts: r.attempts,
              maxAttempts: r.maxAttempts,
              scheduledFor: r.scheduledFor,
              lastError: r.lastError,
              createdAt: r.createdAt,
            })));
          }
          return Promise.resolve([]);
        },
      };
      return chain;
    },
    /** WorkerService.claim uses raw SQL; the fake here implements the
     *  CTE semantics: pick up to 5 due 'queued' rows, mark them
     *  running, bump attempts, return UPPER_CASE column names like pg. */
    execute() {
      const now = new Date();
      const due = rows
        .filter((r) => r.status === "queued" && r.scheduledFor <= now)
        .slice(0, 5);
      for (const r of due) {
        r.status = "running";
        r.lockedAt = now;
        r.lockedBy = "test-worker";
        r.attempts += 1;
        inFlight.push(r.id);
      }
      return Promise.resolve({
        rows: due.map((r) => ({
          ID: r.id,
          TENANT_ID: r.tenantId,
          INSTANCE_ID: r.instanceId,
          TOKEN_ID: r.tokenId,
          JOB_TYPE: r.jobType,
          TOPIC: r.topic,
          INPUT: r.input,
          ATTEMPTS: r.attempts,
          MAX_ATTEMPTS: r.maxAttempts,
        })),
      });
    },
  };
  return { db, rows };
}

describe("WorkerService.enqueue + tick", () => {
  let env: ReturnType<typeof makeFakeDb>;
  let worker: WorkerService;

  beforeEach(() => {
    env = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    worker = new WorkerService(env.db as any);
    process.env.NODE_ENV = "test";
  });

  it("enqueue creates a queued row", async () => {
    const out = await worker.enqueue({
      tenantId: "t1",
      jobType: "service-task",
      topic: "noop",
      input: { hello: "world" },
    });
    expect(out.id).toMatch(/^job-/);
    expect(env.rows).toHaveLength(1);
    expect(env.rows[0].status).toBe("queued");
    expect(env.rows[0].input).toEqual({ hello: "world" });
  });

  it("tick claims a queued job, runs the handler, marks completed", async () => {
    const handler = vi.fn(async (job: ClaimedJob) => ({ output: job.input }));
    worker.registerHandler("noop", handler);
    await worker.enqueue({ tenantId: "t1", jobType: "service-task", topic: "noop", input: { x: 1 } });

    await worker.tick();

    expect(handler).toHaveBeenCalledOnce();
    expect(env.rows[0].status).toBe("completed");
    expect(env.rows[0].result).toEqual({ output: { x: 1 } });
  });

  it("tick on a job with no registered handler marks it dead immediately", async () => {
    await worker.enqueue({ tenantId: "t1", jobType: "service-task", topic: "missing-topic" });

    await worker.tick();

    expect(env.rows[0].status).toBe("dead");
    expect(env.rows[0].lastError).toMatch(/No worker handler/);
  });

  it("handler throw triggers retry with backoff (status back to queued, scheduledFor in future)", async () => {
    worker.registerHandler("flaky", vi.fn(async () => {
      throw new Error("transient");
    }));
    await worker.enqueue({ tenantId: "t1", jobType: "service-task", topic: "flaky", maxAttempts: 5 });

    const before = Date.now();
    await worker.tick();

    expect(env.rows[0].status).toBe("queued");
    expect(env.rows[0].lastError).toBe("transient");
    expect(env.rows[0].scheduledFor.getTime()).toBeGreaterThan(before + 1000);
  });

  it("handler throws past maxAttempts → dead", async () => {
    worker.registerHandler("always-fails", vi.fn(async () => {
      throw new Error("permanent");
    }));
    await worker.enqueue({ tenantId: "t1", jobType: "service-task", topic: "always-fails", maxAttempts: 2 });

    // Drive enough ticks to exhaust attempts. Reset scheduledFor each
    // round so the row is immediately due.
    for (let i = 0; i < 6; i++) {
      env.rows[0].scheduledFor = new Date(0);
      await worker.tick();
      if (env.rows[0].status === "dead") break;
    }
    expect(env.rows[0].status).toBe("dead");
    expect(env.rows[0].lastError).toBe("permanent");
  });

  it("registerHandler ignores duplicate registrations (first wins)", async () => {
    const first = vi.fn(async () => ({ ok: 1 }));
    const second = vi.fn(async () => ({ ok: 2 }));
    worker.registerHandler("topic-x", first);
    worker.registerHandler("topic-x", second);
    await worker.enqueue({ tenantId: "t1", jobType: "service-task", topic: "topic-x" });
    await worker.tick();
    expect(first).toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("listJobs returns rows for the tenant", async () => {
    await worker.enqueue({ tenantId: "t1", jobType: "service-task", topic: "a" });
    await worker.enqueue({ tenantId: "t1", jobType: "service-task", topic: "b" });
    const out = await worker.listJobs({ tenantId: "t1" });
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.topic).sort()).toEqual(["a", "b"]);
  });
});
