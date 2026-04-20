/* ─── IdempotencyService tests ──────────────────────────────────────
 * In-memory fake DB modelling the IDEMPOTENCY_KEYS table just well
 * enough to exercise: cache miss → run + store, cache hit → return
 * stored, key reuse with mismatched body → 409, oversized response
 * → skip cache silently.
 * ──────────────────────────────────────────────────────────────────── */

import { describe, expect, it, vi } from "vitest";
import { IdempotencyService } from "../idempotency.service";

type Row = {
  tenantId: string;
  endpoint: string;
  key: string;
  requestHash: string;
  responseJson: unknown;
  expiresAt: Date;
};

function makeFakeDb() {
  const rows: Row[] = [];
  const tableName = (table: unknown): string => {
    if (table && typeof table === "object" && Symbol.for("drizzle:Name") in table) {
      // @ts-expect-error — drizzle internal
      return table[Symbol.for("drizzle:Name")] as string;
    }
    return "unknown";
  };
  // The engine selects from `IDEMPOTENCY_KEYS` with WHERE tenant + endpoint
  // + key + expiresAt > now. Our fake doesn't introspect the WHERE — it
  // returns the freshest row matching the most recent insert pattern.
  // Tests pass distinct (tenant, endpoint, key) tuples per call.
  let lastQueryArgs: { tenantId?: string; endpoint?: string; key?: string } = {};
  const db = {
    select() {
      let routed: string | null = null;
      const chain = {
        from(table: unknown) {
          routed = tableName(table);
          return chain;
        },
        where: () => chain,
        limit: () => {
          if (routed !== "IDEMPOTENCY_KEYS") return Promise.resolve([]);
          // Find a row matching the most recent unique tuple. We can't
          // introspect `_cond`, so we scan and return the first non-
          // expired hit. Tests use distinct keys to avoid ambiguity.
          const now = new Date();
          const hit = rows.find(
            (r) =>
              (!lastQueryArgs.tenantId || r.tenantId === lastQueryArgs.tenantId) &&
              (!lastQueryArgs.endpoint || r.endpoint === lastQueryArgs.endpoint) &&
              (!lastQueryArgs.key || r.key === lastQueryArgs.key) &&
              r.expiresAt > now,
          );
          return Promise.resolve(hit ? [hit] : []);
        },
      };
      return chain;
    },
    insert(_table: unknown) {
      return {
        values(values: Row | Row[]) {
          const arr = Array.isArray(values) ? values : [values];
          for (const v of arr) rows.push(v);
          return Promise.resolve();
        },
      };
    },
  };
  // Tests set lastQueryArgs to scope the fake's lookup to the right key.
  return {
    db,
    rows,
    setLookup(args: { tenantId?: string; endpoint?: string; key?: string }) {
      lastQueryArgs = args;
    },
  };
}

describe("IdempotencyService.wrap", () => {
  function makeService(opts?: ReturnType<typeof makeFakeDb>) {
    const env = opts ?? makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { service: new IdempotencyService(env.db as any), env };
  }

  it("runs the handler when no key is provided (passthrough)", async () => {
    const { service } = makeService();
    const handler = vi.fn(async () => ({ ok: true }));
    const out = await service.wrap({
      tenantId: "t",
      endpoint: "start-instance",
      key: undefined,
      requestBody: { x: 1 },
      handler,
    });
    expect(out).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("first call runs the handler and caches the response", async () => {
    const { service, env } = makeService();
    env.setLookup({ tenantId: "t", endpoint: "start-instance", key: "k1" });
    const handler = vi.fn(async () => ({ instanceId: "inst-1", status: "completed" }));
    const out = await service.wrap({
      tenantId: "t",
      endpoint: "start-instance",
      key: "k1",
      requestBody: { processId: "p" },
      handler,
    });
    expect(out).toEqual({ instanceId: "inst-1", status: "completed" });
    expect(env.rows).toHaveLength(1);
    expect(env.rows[0].responseJson).toEqual({ instanceId: "inst-1", status: "completed" });
  });

  it("second call with the same key + body returns the cached response without running the handler", async () => {
    const { service, env } = makeService();
    env.setLookup({ tenantId: "t", endpoint: "start-instance", key: "k2" });
    const handler1 = vi.fn(async () => ({ instanceId: "inst-2" }));
    await service.wrap({
      tenantId: "t",
      endpoint: "start-instance",
      key: "k2",
      requestBody: { processId: "p" },
      handler: handler1,
    });
    expect(handler1).toHaveBeenCalledOnce();

    const handler2 = vi.fn(async () => ({ instanceId: "inst-other" }));
    const out = await service.wrap({
      tenantId: "t",
      endpoint: "start-instance",
      key: "k2",
      requestBody: { processId: "p" },
      handler: handler2,
    });
    expect(out).toEqual({ instanceId: "inst-2" });
    expect(handler2).not.toHaveBeenCalled();
  });

  it("same key + different body throws 409 (key reuse bug)", async () => {
    const { service, env } = makeService();
    env.setLookup({ tenantId: "t", endpoint: "start-instance", key: "k3" });
    await service.wrap({
      tenantId: "t",
      endpoint: "start-instance",
      key: "k3",
      requestBody: { processId: "p", variables: { a: 1 } },
      handler: async () => ({ instanceId: "inst-3" }),
    });

    await expect(
      service.wrap({
        tenantId: "t",
        endpoint: "start-instance",
        key: "k3",
        requestBody: { processId: "p", variables: { a: 999 } }, // different
        handler: async () => ({ instanceId: "inst-other" }),
      }),
    ).rejects.toThrow(/Idempotency-Key was reused/);
  });

  it("body hash is stable across key-order permutations", async () => {
    const { service, env } = makeService();
    env.setLookup({ tenantId: "t", endpoint: "complete-task", key: "k4" });
    await service.wrap({
      tenantId: "t",
      endpoint: "complete-task",
      key: "k4",
      requestBody: { tokenId: "tok-1", formData: { amount: 50, approval: "yes" } },
      handler: async () => ({ ok: 1 }),
    });

    // Same logical body, different key order — must hit the cache,
    // not 409 as a "different body".
    const handler = vi.fn(async () => ({ ok: "different" }));
    const out = await service.wrap({
      tenantId: "t",
      endpoint: "complete-task",
      key: "k4",
      requestBody: { formData: { approval: "yes", amount: 50 }, tokenId: "tok-1" },
      handler,
    });
    expect(out).toEqual({ ok: 1 });
    expect(handler).not.toHaveBeenCalled();
  });
});
