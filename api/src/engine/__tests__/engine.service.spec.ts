/* ─── Engine Service tests ──────────────────────────────────────────
 * Two layers:
 *   • Pure helpers (`projectCanvas`, `findStartEvent`, `pickNextEdge`)
 *     — straightforward unit tests against fixture canvases.
 *   • `startInstance` flow — driven against a hand-rolled in-memory
 *     fake DB that records every insert/update so we can assert on
 *     the audit-event sequence and the final instance/token state.
 * ──────────────────────────────────────────────────────────────────── */

import { beforeEach, describe, expect, it } from "vitest";
import {
  EngineService,
  findStartEvent,
  pickNextEdge,
  projectCanvas,
  type EngineCanvas,
} from "../engine.service";

// ─── Pure helpers ────────────────────────────────────────────────────

describe("projectCanvas", () => {
  it("filters nodes missing id or type", () => {
    const out = projectCanvas({
      nodes: [
        { id: "a", type: "startEvent" },
        { id: "b" }, // missing type
        { type: "userTask" }, // missing id
        { id: "c", type: "endEvent" },
      ],
      edges: [],
    });
    expect(out.nodes.map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("drops edges with dangling endpoints", () => {
    const out = projectCanvas({
      nodes: [
        { id: "a", type: "startEvent" },
        { id: "b", type: "endEvent" },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "a", target: "ghost" },
        { id: "e3", source: "ghost", target: "b" },
      ],
    });
    expect(out.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("rejects malformed root", () => {
    expect(() => projectCanvas(null)).toThrow();
    expect(() => projectCanvas("not-an-object")).toThrow();
  });

  it("preserves edge condition + isDefault + flowType", () => {
    const out = projectCanvas({
      nodes: [
        { id: "a", type: "exclusiveGateway" },
        { id: "b", type: "endEvent" },
      ],
      edges: [
        {
          id: "e1",
          source: "a",
          target: "b",
          data: { condition: "x > 1", isDefault: true, flowType: "sequence" },
        },
      ],
    });
    expect(out.edges[0].data).toEqual({
      condition: "x > 1",
      isDefault: true,
      flowType: "sequence",
    });
  });
});

describe("findStartEvent", () => {
  it("returns the unique top-level start event", () => {
    const canvas: EngineCanvas = {
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "t", type: "userTask" },
      ],
      edges: [],
    };
    expect(findStartEvent(canvas).id).toBe("s");
  });

  it("rejects zero start events", () => {
    expect(() =>
      findStartEvent({ nodes: [{ id: "t", type: "userTask" }], edges: [] }),
    ).toThrow(/no top-level start/);
  });

  it("rejects multiple top-level start events", () => {
    expect(() =>
      findStartEvent({
        nodes: [
          { id: "s1", type: "startEvent" },
          { id: "s2", type: "startEvent" },
        ],
        edges: [],
      }),
    ).toThrow(/2 top-level start events/);
  });

  it("ignores starts nested inside subprocesses (parentId set)", () => {
    const canvas: EngineCanvas = {
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "sub", type: "subProcess" },
        { id: "innerStart", type: "startEvent", parentId: "sub" },
      ],
      edges: [],
    };
    expect(findStartEvent(canvas).id).toBe("s");
  });
});

describe("pickNextEdge", () => {
  it("returns the first sequence-flow outgoing edge", () => {
    const canvas: EngineCanvas = {
      nodes: [
        { id: "a", type: "startEvent" },
        { id: "b", type: "endEvent" },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
    };
    expect(pickNextEdge(canvas, "a")?.id).toBe("e1");
  });

  it("skips message and association flows", () => {
    const canvas: EngineCanvas = {
      nodes: [
        { id: "a", type: "userTask" },
        { id: "b", type: "endEvent" },
        { id: "note", type: "textAnnotation" },
      ],
      edges: [
        { id: "msg", source: "a", target: "b", data: { flowType: "message" } },
        { id: "assoc", source: "a", target: "note", data: { flowType: "association" } },
        { id: "seq", source: "a", target: "b" },
      ],
    };
    expect(pickNextEdge(canvas, "a")?.id).toBe("seq");
  });

  it("returns null when there are no outgoing sequence flows", () => {
    expect(pickNextEdge({ nodes: [], edges: [] }, "ghost")).toBeNull();
  });
});

// ─── startInstance integration with fake DB ──────────────────────────

/** Insert / update / select records the fake DB collected, so tests can
 *  assert on the precise audit trail and final state. */
type TxInsert = { table: string; values: Record<string, unknown>[] };
type TxUpdate = { table: string; set: Record<string, unknown>; matched: number };

function makeFakeTx(canvas: unknown) {
  const inserts: TxInsert[] = [];
  const updates: TxUpdate[] = [];
  // Token state the WHERE-version guard checks against. Updated as the
  // interpreter mutates the token; lets us simulate optimistic locking.
  const tokenState: { id: string; version: number } = { id: "tok-1", version: 0 };
  let instanceId = "inst-1";

  const tableName = (table: unknown): string => {
    if (table && typeof table === "object" && Symbol.for("drizzle:Name") in table) {
      // @ts-expect-error — drizzle internal
      return table[Symbol.for("drizzle:Name")] as string;
    }
    return "unknown";
  };

  const tx = {
    insert(table: unknown) {
      const name = tableName(table);
      return {
        values(rows: Record<string, unknown> | Record<string, unknown>[]) {
          const values = Array.isArray(rows) ? rows : [rows];
          inserts.push({ table: name, values });
          return {
            returning(_cols?: unknown) {
              if (name === "PROCESS_INSTANCES") {
                return Promise.resolve([{ id: instanceId }]);
              }
              if (name === "INSTANCE_TOKENS") {
                return Promise.resolve([{ id: tokenState.id, version: tokenState.version }]);
              }
              return Promise.resolve([{}]);
            },
            // For inserts that don't .returning() — directly thenable.
            then(resolve: (v: unknown) => unknown) {
              return resolve(undefined);
            },
          };
        },
      };
    },
    update(table: unknown) {
      const name = tableName(table);
      return {
        set(values: Record<string, unknown>) {
          return {
            where(_cond: unknown) {
              return {
                returning(_cols?: unknown) {
                  // Optimistic-lock simulation: only PROCESS_INSTANCES
                  // and INSTANCE_TOKENS hit this path. Treat as a hit
                  // unless a test wants a conflict (none do today).
                  let matched = 1;
                  if (name === "INSTANCE_TOKENS" && typeof values.version === "number") {
                    tokenState.version = values.version;
                  }
                  updates.push({ table: name, set: values, matched });
                  return Promise.resolve([{ id: name === "INSTANCE_TOKENS" ? tokenState.id : instanceId }]);
                },
                then(resolve: (v: unknown) => unknown) {
                  updates.push({ table: name, set: values, matched: 1 });
                  return resolve(undefined);
                },
              };
            },
          };
        },
      };
    },
    select(_cols?: unknown) {
      return {
        from(_table: unknown) {
          return {
            where(_cond: unknown) {
              return {
                limit() {
                  // The only select inside a txn is the count helpers.
                  return Promise.resolve([]);
                },
                then(resolve: (v: unknown) => unknown) {
                  // Counts: return a row per insert observed. Coarse but
                  // sufficient for the assertions we care about.
                  const rows = inserts
                    .filter((i) => i.table === "INSTANCE_TOKENS" || i.table === "INSTANCE_EVENTS")
                    .flatMap((i) => i.values.map(() => ({ id: "x" })));
                  return resolve(rows);
                },
              };
            },
          };
        },
      };
    },
  };

  const db = {
    select(_cols?: unknown) {
      return {
        from(_table: unknown) {
          return {
            where(_cond: unknown) {
              return {
                limit() {
                  return Promise.resolve([{ canvasData: canvas }]);
                },
              };
            },
          };
        },
      };
    },
    transaction<T>(fn: (tx: typeof tx) => Promise<T>): Promise<T> {
      return fn(tx);
    },
  };

  return { db, inserts, updates, tx, tokenState, setInstanceId: (id: string) => (instanceId = id) };
}

describe("EngineService.startInstance", () => {
  let env: ReturnType<typeof makeFakeTx>;
  let service: EngineService;

  function buildService(canvas: unknown): void {
    env = makeFakeTx(canvas);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new EngineService(env.db as any);
  }

  beforeEach(() => {
    env = makeFakeTx(null);
  });

  it("runs start → user task → end straight to completion (E2 happy path)", async () => {
    buildService({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "t", type: "userTask" },
        { id: "e", type: "endEvent" },
      ],
      edges: [
        { id: "e1", source: "s", target: "t" },
        { id: "e2", source: "t", target: "e" },
      ],
    });

    const out = await service.startInstance({
      processId: "proc-1",
      tenantId: "tenant-1",
      userId: "user-1",
    });

    expect(out.instanceId).toBe("inst-1");
    expect(out.status).toBe("completed");

    // Audit sequence — collect all event types in order across all
    // INSTANCE_EVENTS inserts (each insert is a single-row values).
    const events = env.inserts
      .filter((i) => i.table === "INSTANCE_EVENTS")
      .map((i) => i.values[0].eventType as string);
    expect(events).toEqual([
      "instance-started",
      "token-created",
      "node-entered", // start
      "node-exited",
      "edge-taken",
      "node-entered", // userTask
      "node-exited",
      "edge-taken",
      "node-entered", // end
      "node-exited",
      "token-completed",
      "instance-completed",
    ]);

    // Token reached `completed` and the instance was flipped too.
    const tokenUpdates = env.updates.filter((u) => u.table === "INSTANCE_TOKENS");
    expect(tokenUpdates.at(-1)?.set.status).toBe("completed");
    expect(env.updates.some((u) => u.table === "PROCESS_INSTANCES" && u.set.status === "completed")).toBe(true);
  });

  it("rejects a process whose canvas has no start event", async () => {
    buildService({
      nodes: [{ id: "t", type: "userTask" }, { id: "e", type: "endEvent" }],
      edges: [{ id: "e1", source: "t", target: "e" }],
    });

    await expect(
      service.startInstance({ processId: "p", tenantId: "t", userId: "u" }),
    ).rejects.toThrow(/no top-level start/);
  });

  it("dead-end node: instance commits with status=failed and audit trail intact", async () => {
    buildService({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "t", type: "userTask" }, // dead end, not an end event
      ],
      edges: [{ id: "e1", source: "s", target: "t" }],
    });

    const out = await service.startInstance({
      processId: "p",
      tenantId: "t",
      userId: "u",
    });

    expect(out.status).toBe("failed");
    const events = env.inserts
      .filter((i) => i.table === "INSTANCE_EVENTS")
      .map((i) => i.values[0].eventType as string);
    // Audit must include the error + instance-failed events.
    expect(events).toContain("error");
    expect(events).toContain("instance-failed");
    // Instance row was flipped to failed with errorMessage populated.
    const instUpdate = env.updates.find(
      (u) => u.table === "PROCESS_INSTANCES" && u.set.status === "failed",
    );
    expect(instUpdate).toBeDefined();
    expect(instUpdate?.set.errorMessage).toMatch(/no outgoing/);
  });

  it("rejects a process with no canvas at all", async () => {
    buildService(null);
    await expect(
      service.startInstance({ processId: "p", tenantId: "t", userId: "u" }),
    ).rejects.toThrow(/no canvas/);
  });

  it("rejects a process belonging to a different tenant (404)", async () => {
    // Build a fake DB whose process row exists but the loadProcessForInstance
    // tenant filter excludes it (we simulate by returning empty rows).
    env = makeFakeTx(undefined);
    // Override the top-level select to return zero rows — i.e. the
    // (id, tenantId) WHERE didn't match any row.
    env.db.select = () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new EngineService(env.db as any);
    await expect(
      service.startInstance({
        processId: "proc-other",
        tenantId: "tenant-mine",
        userId: "u",
      }),
    ).rejects.toThrow(/Process not found/);
  });

  it("writes a deterministic definitionHash that depends on canvas content", async () => {
    const canvasA = {
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "e", type: "endEvent" },
      ],
      edges: [{ id: "e1", source: "s", target: "e" }],
    };
    buildService(canvasA);
    await service.startInstance({ processId: "p", tenantId: "t", userId: "u" });
    const hashA = (env.inserts.find((i) => i.table === "PROCESS_INSTANCES")?.values[0].definitionHash) as string;
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);

    // Same canvas with reordered nodes yields the same hash thanks to
    // canonicalisation in the engine.
    const canvasB = {
      nodes: [
        { id: "e", type: "endEvent" },
        { id: "s", type: "startEvent" },
      ],
      edges: [{ id: "e1", source: "s", target: "e" }],
    };
    buildService(canvasB);
    await service.startInstance({ processId: "p", tenantId: "t", userId: "u" });
    const hashB = (env.inserts.find((i) => i.table === "PROCESS_INSTANCES")?.values[0].definitionHash) as string;
    expect(hashB).toBe(hashA);

    // A different canvas yields a different hash.
    const canvasC = {
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "t", type: "userTask" },
        { id: "e", type: "endEvent" },
      ],
      edges: [
        { id: "e1", source: "s", target: "t" },
        { id: "e2", source: "t", target: "e" },
      ],
    };
    buildService(canvasC);
    await service.startInstance({ processId: "p", tenantId: "t", userId: "u" });
    const hashC = (env.inserts.find((i) => i.table === "PROCESS_INSTANCES")?.values[0].definitionHash) as string;
    expect(hashC).not.toBe(hashA);
  });
});
