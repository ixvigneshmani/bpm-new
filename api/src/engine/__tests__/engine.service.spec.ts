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
  applyMapping,
  EngineService,
  evalCondition,
  findStartEvent,
  getByPath,
  pickExclusiveGatewayEdge,
  pickNextEdge,
  projectCanvas,
  resolveDirectUserAssignee,
  resolveTaskScheduling,
  type EngineCanvas,
  type EngineNode,
} from "../engine.service";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

/** Stub WorkerService used to inject into EngineService in unit tests.
 *  Records enqueued jobs so serviceTask-suspend tests can assert on
 *  what the engine asked the worker to do. The actual job execution
 *  is never driven from the engine spec — covered by separate
 *  ServiceTaskService tests against a real-shape WorkerService stub. */
function makeFakeWorker() {
  const enqueued: Array<{
    tenantId: string;
    topic: string;
    jobType: string;
    instanceId?: string;
    tokenId?: string;
    input?: Record<string, unknown>;
    maxAttempts?: number;
  }> = [];
  return {
    enqueued,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    enqueue: async (args: any) => {
      enqueued.push(args);
      return { id: `job-${enqueued.length}` };
    },
  };
}

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
                  // P1 countLiveTokens approximation: live = #token
                  // inserts − #status updates to a terminal value. Other
                  // .then() select paths in the engine all flow through
                  // .limit() so this is the only consumer.
                  const inserted = inserts.filter((i) => i.table === "INSTANCE_TOKENS").length;
                  const terminal = updates.filter(
                    (u) =>
                      u.table === "INSTANCE_TOKENS" &&
                      (u.set.status === "completed" || u.set.status === "failed"),
                  ).length;
                  const live = Math.max(0, inserted - terminal);
                  return resolve(Array.from({ length: live }, () => ({ id: "x" })));
                },
              };
            },
          };
        },
      };
    },
  };

  // Tracks where the most recent select was routed. The two queries
  // we need to differentiate at the db (non-tx) level are:
  //   • PROCESSES → return canvasData
  //   • PROCESS_VERSIONS → return any existing version row (we
  //     simulate "no existing version" so getOrCreateProcessVersion
  //     follows the insert path)
  let lastDbSelectTable: string | null = null;
  const dbTableName = (table: unknown): string => {
    if (table && typeof table === "object" && Symbol.for("drizzle:Name") in table) {
      // @ts-expect-error — drizzle internal
      return table[Symbol.for("drizzle:Name")] as string;
    }
    return "unknown";
  };

  const db = {
    select(_cols?: unknown) {
      const chain = {
        from(table: unknown) {
          lastDbSelectTable = dbTableName(table);
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () => {
          if (lastDbSelectTable === "PROCESSES") {
            return Promise.resolve([{ canvasData: canvas, status: "ACTIVE" }]);
          }
          // PROCESS_VERSIONS lookups return empty so the engine takes
          // the create-version path.
          return Promise.resolve([]);
        },
      };
      return chain;
    },
    insert(table: unknown) {
      // Non-tx insert path is used for PROCESS_VERSIONS create. Mirror
      // the tx fake's recording so test assertions on env.inserts can
      // observe it.
      const name = dbTableName(table);
      return {
        values(rows: Record<string, unknown> | Record<string, unknown>[]) {
          inserts.push({ table: name, values: Array.isArray(rows) ? rows : [rows] });
          return {
            returning() {
              return Promise.resolve([{ id: "ver-1" }]);
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
    service = new EngineService(env.db as any, makeFakeWorker() as any);
  }

  beforeEach(() => {
    env = makeFakeTx(null);
  });

  it("runs start → end straight to completion (no wait states)", async () => {
    buildService({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "e", type: "endEvent" },
      ],
      edges: [{ id: "e1", source: "s", target: "e" }],
    });

    const out = await service.startInstance({
      processId: "proc-1",
      tenantId: "tenant-1",
      userId: "user-1",
    });

    expect(out.instanceId).toBe("inst-1");
    expect(out.status).toBe("completed");

    const events = env.inserts
      .filter((i) => i.table === "INSTANCE_EVENTS")
      .map((i) => i.values[0].eventType as string);
    expect(events).toEqual([
      "instance-started",
      "token-created",
      "node-entered", // start
      "node-exited",
      "edge-taken",
      "node-entered", // end
      "node-exited",
      "token-completed",
      "instance-completed",
    ]);

    const tokenUpdates = env.updates.filter((u) => u.table === "INSTANCE_TOKENS");
    expect(tokenUpdates.at(-1)?.set.status).toBe("completed");
    expect(env.updates.some((u) => u.table === "PROCESS_INSTANCES" && u.set.status === "completed")).toBe(true);
  });

  it("E3: userTask suspends the token; instance stays running with audit ending at token-waiting", async () => {
    buildService({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "t", type: "userTask", data: { assignment: { type: "directUser", value: UUID_A } } },
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

    expect(out.status).toBe("running");

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
      "token-waiting",
      "task-claimed", // auto-claim because directUser assignment resolved
    ]);

    // Token was flipped to waiting + assigned to UUID_A.
    const tokenUpdate = env.updates.find(
      (u) => u.table === "INSTANCE_TOKENS" && u.set.status === "waiting",
    );
    expect(tokenUpdate?.set.waitingFor).toBe("userTask");
    expect(tokenUpdate?.set.assignedTo).toBe(UUID_A);
    // Instance row was NOT flipped to completed/failed.
    expect(env.updates.some((u) => u.table === "PROCESS_INSTANCES" && (u.set.status === "completed" || u.set.status === "failed"))).toBe(false);
  });

  it("E3: userTask without a directUser assignment leaves assignedTo null", async () => {
    buildService({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "t", type: "userTask" }, // no assignment field at all
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

    expect(out.status).toBe("running");
    const tokenUpdate = env.updates.find(
      (u) => u.table === "INSTANCE_TOKENS" && u.set.status === "waiting",
    );
    expect(tokenUpdate?.set.assignedTo).toBeNull();
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
        // manualTask passes through (no suspend, no handler). userTask
        // and serviceTask now both suspend, so they'd never reach the
        // dead-end branch.
        { id: "t", type: "manualTask" },
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
    // tenant filter excludes it (we simulate by returning empty rows
    // from every select).
    env = makeFakeTx(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.db as any).select = () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve([]),
      };
      return chain;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new EngineService(env.db as any, makeFakeWorker() as any);
    await expect(
      service.startInstance({
        processId: "proc-other",
        tenantId: "tenant-mine",
        userId: "u",
      }),
    ).rejects.toThrow(/Process not found/);
  });

  it("E4.5 polish: engineConfig.redactedVariableKeys survives canonicalise + outbox redaction", async () => {
    buildService({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "e", type: "endEvent" },
      ],
      edges: [{ id: "e1", source: "s", target: "e" }],
      engineConfig: { redactedVariableKeys: ["ssn"] },
    });
    await service.startInstance({
      processId: "p",
      tenantId: "t",
      userId: "u",
      variables: { ssn: "123-45-6789", amount: 500 },
    });
    // The canvas as written into PROCESS_VERSIONS must carry the
    // engineConfig — otherwise PII redaction is silently broken on
    // every later read (the bug E4.5 QA caught).
    const verInsert = env.inserts.find(
      (i) => i.table === "PROCESS_VERSIONS",
    );
    const verCanvas = verInsert?.values[0].canvasData as Record<string, unknown>;
    expect(verCanvas.engineConfig).toEqual({ redactedVariableKeys: ["ssn"] });

    // The instance-completed outbox row's `variables` field must
    // redact `ssn` while keeping `amount` raw, so webhook receivers
    // can't reconstruct the sensitive value.
    const completedOutbox = env.inserts.find(
      (i) =>
        i.table === "OUTBOX_EVENTS" &&
        i.values[0].eventType === "instance-completed",
    );
    const payload = completedOutbox?.values[0].payload as Record<string, unknown>;
    expect((payload.variables as Record<string, unknown>).ssn).toBe("<redacted>");
    expect((payload.variables as Record<string, unknown>).amount).toBe(500);
  });

  it("E5: serviceTask suspends the token + enqueues a worker job (externalWorker.jobType → topic)", async () => {
    env = makeFakeTx({
      nodes: [
        { id: "s", type: "startEvent" },
        {
          id: "svc",
          type: "serviceTask",
          data: {
            implementation: {
              type: "externalWorker",
              config: { jobType: "send-email" },
            },
          },
        },
        { id: "e", type: "endEvent" },
      ],
      edges: [
        { id: "e1", source: "s", target: "svc" },
        { id: "e2", source: "svc", target: "e" },
      ],
    });
    const fakeWorker = makeFakeWorker();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new EngineService(env.db as any, fakeWorker as any);
    const out = await service.startInstance({
      processId: "p",
      tenantId: "t",
      userId: "u",
      variables: { customer: "Alice" },
    });
    expect(out.status).toBe("running");
    // Token should be waiting on a service-task.
    const tokenUpdate = env.updates.find(
      (u) => u.table === "INSTANCE_TOKENS" && u.set.status === "waiting",
    );
    expect(tokenUpdate?.set.waitingFor).toBe("service-task");
    // Worker enqueue called with the right topic + carry-through input.
    expect(fakeWorker.enqueued).toHaveLength(1);
    const job = fakeWorker.enqueued[0];
    expect(job.topic).toBe("service-task");
    expect((job.input as Record<string, unknown>).userTopic).toBe("send-email");
    expect(((job.input as Record<string, unknown>).variables as Record<string, unknown>).customer).toBe("Alice");
  });

  it("E5 mappings: inputMappings projects only the listed vars to the handler", async () => {
    env = makeFakeTx({
      nodes: [
        { id: "s", type: "startEvent" },
        {
          id: "svc",
          type: "serviceTask",
          data: {
            implementation: { type: "externalWorker", config: { jobType: "noop" } },
            inputMappings: {
              contactId: "$customer.id",
              kind: "external", // literal pass-through
            },
          },
        },
        { id: "e", type: "endEvent" },
      ],
      edges: [
        { id: "e1", source: "s", target: "svc" },
        { id: "e2", source: "svc", target: "e" },
      ],
    });
    const fakeWorker = makeFakeWorker();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new EngineService(env.db as any, fakeWorker as any);
    await service.startInstance({
      processId: "p",
      tenantId: "t",
      userId: "u",
      variables: {
        customer: { id: "c-7", email: "a@b.c" },
        secret: "should-not-leak",
      },
    });
    const job = fakeWorker.enqueued[0];
    const handlerVars = (job.input as Record<string, unknown>).variables as Record<string, unknown>;
    // Only the mapped keys are visible to the handler — `secret`
    // and `customer.email` are filtered out.
    expect(handlerVars).toEqual({ contactId: "c-7", kind: "external" });
    expect("secret" in handlerVars).toBe(false);
  });

  it("E5: serviceTask without an implementation falls back to noop topic (warn, no failure)", async () => {
    env = makeFakeTx({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "svc", type: "serviceTask" }, // no data.implementation
        { id: "e", type: "endEvent" },
      ],
      edges: [
        { id: "e1", source: "s", target: "svc" },
        { id: "e2", source: "svc", target: "e" },
      ],
    });
    const fakeWorker = makeFakeWorker();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new EngineService(env.db as any, fakeWorker as any);
    await service.startInstance({ processId: "p", tenantId: "t", userId: "u" });
    expect((fakeWorker.enqueued[0].input as Record<string, unknown>).userTopic).toBe("noop");
  });

  it("E4.5c: startInstance writes an OUTBOX_EVENTS row alongside instance-started audit", async () => {
    buildService({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "e", type: "endEvent" },
      ],
      edges: [{ id: "e1", source: "s", target: "e" }],
    });
    await service.startInstance({ processId: "p", tenantId: "t", userId: "u" });
    const outboxRows = env.inserts.filter((i) => i.table === "OUTBOX_EVENTS");
    const outboxTypes = outboxRows.map((i) => i.values[0].eventType as string);
    // start + complete events both go to the outbox.
    expect(outboxTypes).toContain("instance-started");
    expect(outboxTypes).toContain("instance-completed");
  });

  it("E4.5b: startInstance writes processVersionId (PROCESS_VERSIONS dedup path)", async () => {
    buildService({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "e", type: "endEvent" },
      ],
      edges: [{ id: "e1", source: "s", target: "e" }],
    });
    const out = await service.startInstance({
      processId: "p",
      tenantId: "t",
      userId: "u",
    });
    expect(out.status).toBe("completed");
    // The instance row carries processVersionId pointing at the synthetic
    // version id from the fake DB; the legacy snapshot column is null.
    const inst = env.inserts.find((i) => i.table === "PROCESS_INSTANCES");
    expect(inst?.values[0].processVersionId).toBe("ver-1");
    expect(inst?.values[0].definitionSnapshot).toBeUndefined();
  });

  it("E4.5b: identical canvases dedupe — engine looks up the existing version row", async () => {
    // Override the db so PROCESS_VERSIONS lookup returns an existing
    // row instead of empty (simulating a re-publish of the same canvas).
    buildService({
      nodes: [{ id: "s", type: "startEvent" }, { id: "e", type: "endEvent" }],
      edges: [{ id: "e1", source: "s", target: "e" }],
    });
    let dbSelectsForVersions = 0;
    let dbInsertsForVersions = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.db as any).select = () => {
      let routedTable: string | null = null;
      const chain = {
        from(table: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const name = (table as any)?.[Symbol.for("drizzle:Name")] ?? "";
          routedTable = String(name);
          if (routedTable === "PROCESS_VERSIONS") dbSelectsForVersions++;
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () => {
          if (routedTable === "PROCESSES") {
            return Promise.resolve([{
              canvasData: {
                nodes: [{ id: "s", type: "startEvent" }, { id: "e", type: "endEvent" }],
                edges: [{ id: "e1", source: "s", target: "e" }],
              },
              status: "ACTIVE",
            }]);
          }
          if (routedTable === "PROCESS_VERSIONS") {
            return Promise.resolve([{ id: "existing-ver" }]);
          }
          return Promise.resolve([]);
        },
      };
      return chain;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.db as any).insert = () => ({
      values() {
        dbInsertsForVersions++;
        return {
          returning() { return Promise.resolve([{ id: "should-not-be-used" }]); },
        };
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new EngineService(env.db as any, makeFakeWorker() as any);
    const out = await service.startInstance({ processId: "p", tenantId: "t", userId: "u" });
    expect(out.status).toBe("completed");
    expect(dbSelectsForVersions).toBeGreaterThan(0);
    expect(dbInsertsForVersions).toBe(0); // reused existing row
    const inst = env.inserts.find((i) => i.table === "PROCESS_INSTANCES");
    expect(inst?.values[0].processVersionId).toBe("existing-ver");
  });

  it("E4: exclusive gateway routes via matching condition (startInstance with vars)", async () => {
    buildService({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "gw", type: "exclusiveGateway" },
        { id: "approve", type: "endEvent" },
        { id: "review", type: "endEvent" },
      ],
      edges: [
        { id: "e1", source: "s", target: "gw" },
        { id: "e2", source: "gw", target: "approve", data: { condition: "amount < 1000" } },
        { id: "e3", source: "gw", target: "review", data: { isDefault: true } },
      ],
    });

    const out = await service.startInstance({
      processId: "p",
      tenantId: "t",
      userId: "u",
      variables: { amount: 500 },
    });

    expect(out.status).toBe("completed");
    // Verify the gateway took the condition branch (e2 → approve), not
    // the default. The audit edge-taken events tell us which way it went.
    const edgeIds = env.inserts
      .filter((i) => i.table === "INSTANCE_EVENTS" && i.values[0].eventType === "edge-taken")
      .map((i) => (i.values[0].payload as Record<string, unknown>).edgeId as string);
    expect(edgeIds).toContain("e2");
    expect(edgeIds).not.toContain("e3");
  });

  it("E4: exclusive gateway falls through to default when no condition matches", async () => {
    buildService({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "gw", type: "exclusiveGateway" },
        { id: "approve", type: "endEvent" },
        { id: "review", type: "endEvent" },
      ],
      edges: [
        { id: "e1", source: "s", target: "gw" },
        { id: "e2", source: "gw", target: "approve", data: { condition: "amount < 100" } },
        { id: "e3", source: "gw", target: "review", data: { isDefault: true } },
      ],
    });
    const out = await service.startInstance({
      processId: "p",
      tenantId: "t",
      userId: "u",
      variables: { amount: 5000 },
    });
    expect(out.status).toBe("completed");
    const edgeIds = env.inserts
      .filter((i) => i.table === "INSTANCE_EVENTS" && i.values[0].eventType === "edge-taken")
      .map((i) => (i.values[0].payload as Record<string, unknown>).edgeId as string);
    expect(edgeIds).toContain("e3"); // default branch
    expect(edgeIds).not.toContain("e2");
  });

  it("E4: exclusive gateway with no match and no default → instance failed", async () => {
    buildService({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "gw", type: "exclusiveGateway" },
        { id: "approve", type: "endEvent" },
      ],
      edges: [
        { id: "e1", source: "s", target: "gw" },
        { id: "e2", source: "gw", target: "approve", data: { condition: "amount < 100" } },
      ],
    });
    const out = await service.startInstance({
      processId: "p",
      tenantId: "t",
      userId: "u",
      variables: { amount: 5000 },
    });
    expect(out.status).toBe("failed");
    const instUpdate = env.updates.find(
      (u) => u.table === "PROCESS_INSTANCES" && u.set.status === "failed",
    );
    expect(instUpdate?.set.errorMessage).toMatch(/no outgoing condition matched/);
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

// ─── E5 mappings: getByPath + applyMapping ──────────────────────────

describe("getByPath", () => {
  it("returns top-level value", () => {
    expect(getByPath({ a: 1 }, "a")).toBe(1);
  });

  it("walks dot-separated nested keys", () => {
    expect(getByPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("returns undefined for missing segments", () => {
    expect(getByPath({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(getByPath({ a: { b: 1 } }, "a.c")).toBeUndefined();
  });

  it("returns undefined for non-object source", () => {
    expect(getByPath(null, "a")).toBeUndefined();
    expect(getByPath("string", "a")).toBeUndefined();
  });

  it("empty path returns the source unchanged", () => {
    expect(getByPath({ a: 1 }, "")).toEqual({ a: 1 });
  });
});

describe("applyMapping", () => {
  const source = {
    customer: { id: "c-1", email: "a@b.c" },
    amount: 500,
    flag: true,
  };

  it("$-prefixed strings project from source paths", () => {
    expect(
      applyMapping(
        { contactId: "$customer.id", total: "$amount" },
        source,
      ),
    ).toEqual({ contactId: "c-1", total: 500 });
  });

  it("{from: ...} object form is equivalent to $-prefix", () => {
    expect(
      applyMapping(
        { email: { from: "customer.email" } },
        source,
      ),
    ).toEqual({ email: "a@b.c" });
  });

  it("non-prefixed strings + numbers + booleans pass through as literals", () => {
    expect(
      applyMapping(
        { kind: "external", priority: 5, urgent: true },
        source,
      ),
    ).toEqual({ kind: "external", priority: 5, urgent: true });
  });

  it("missing source paths are omitted from the result (not set as undefined)", () => {
    const out = applyMapping(
      { good: "$customer.id", bad: "$does.not.exist" },
      source,
    );
    expect(out).toEqual({ good: "c-1" });
    expect("bad" in out).toBe(false);
  });

  it("undefined / empty mappings yield {}", () => {
    expect(applyMapping(undefined, source)).toEqual({});
    expect(applyMapping({}, source)).toEqual({});
  });
});

// ─── E4: condition eval + exclusive-gateway edge selection ──────────

describe("evalCondition", () => {
  it("evaluates simple comparisons against top-level vars", () => {
    expect(evalCondition("amount > 1000", { amount: 5000 })).toBe(true);
    expect(evalCondition("amount > 1000", { amount: 500 })).toBe(false);
    expect(evalCondition("amount === 0", { amount: 0 })).toBe(true);
  });

  it("supports boolean combinators", () => {
    expect(
      evalCondition("amount > 100 && approved", { amount: 200, approved: true }),
    ).toBe(true);
    expect(
      evalCondition("amount > 100 && approved", { amount: 200, approved: false }),
    ).toBe(false);
    expect(
      evalCondition("amount > 100 || approved", { amount: 50, approved: true }),
    ).toBe(true);
  });

  it("coerces truthy/falsy values to boolean predictably", () => {
    expect(evalCondition("approved", { approved: "yes" })).toBe(true);
    expect(evalCondition("approved", { approved: 0 })).toBe(false);
    expect(evalCondition("approved", { approved: null })).toBe(false);
  });

  it("supports string equality", () => {
    expect(
      evalCondition("status === 'urgent'", { status: "urgent" }),
    ).toBe(true);
    expect(
      evalCondition("status === 'urgent'", { status: "normal" }),
    ).toBe(false);
  });

  it("supports nested member access via dot", () => {
    expect(
      evalCondition("form.amount > 1000", { form: { amount: 2000 } }),
    ).toBe(true);
  });

  it("rejects forbidden identifiers (prototype walking, globals, code-eval)", () => {
    for (const expr of [
      "this.x > 0",
      "process.env.SECRET === 'x'",
      "constructor === 1",
      "__proto__ === null",
      "eval('1 > 0')",
      "new Date() > 0",
      "Function('return 1')() === 1",
    ]) {
      expect(() => evalCondition(expr, {})).toThrow(/forbidden/);
    }
  });

  it("rejects disallowed characters (semicolons, braces)", () => {
    expect(() => evalCondition("amount > 0; alert(1)", { amount: 1 })).toThrow(
      /disallowed character/,
    );
    expect(() => evalCondition("{} === {}", {})).toThrow(/disallowed character/);
    // Note: bare assignment `amount = 999` is allowed by the char filter
    // but is harmless — strict-mode `new Function` makes the parameter
    // reassignment local, no mutation leaks back to the variable bag.
    // The result is truthy (999), which is correct boolean coercion.
  });

  it("rejects expressions over the length cap", () => {
    expect(() => evalCondition("a" + " > 0".repeat(1000), {})).toThrow(/longer than/);
  });

  it("surfaces runtime errors (unknown identifier) as BadRequest", () => {
    expect(() => evalCondition("unknownVar > 0", {})).toThrow(
      /Condition eval failed/,
    );
  });

  it("ignores variable keys that aren't valid JS identifiers", () => {
    // "user-id" can't be a Function param; valid keys are still in scope.
    const vars = { "user-id": "abc", amount: 100 };
    expect(evalCondition("amount > 50", vars)).toBe(true);
  });
});

describe("pickExclusiveGatewayEdge", () => {
  const gatewayCanvas = (
    edges: Array<{ id: string; target: string; condition?: string; isDefault?: boolean }>,
  ): EngineCanvas => ({
    nodes: [
      { id: "gw", type: "exclusiveGateway" },
      { id: "a", type: "endEvent" },
      { id: "b", type: "endEvent" },
      { id: "c", type: "endEvent" },
    ],
    edges: edges.map((e) => ({
      id: e.id,
      source: "gw",
      target: e.target,
      data: { condition: e.condition, isDefault: e.isDefault },
    })),
  });

  it("picks the first edge whose condition evaluates truthy", () => {
    const canvas = gatewayCanvas([
      { id: "e1", target: "a", condition: "amount > 1000" },
      { id: "e2", target: "b", condition: "amount > 100" },
      { id: "e3", target: "c", isDefault: true },
    ]);
    const result = pickExclusiveGatewayEdge(canvas, "gw", { amount: 500 });
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.edge.id).toBe("e2");
      expect(result.reason).toBe("condition");
    }
  });

  it("falls through to default flow when no condition matches", () => {
    const canvas = gatewayCanvas([
      { id: "e1", target: "a", condition: "amount > 1000" },
      { id: "e2", target: "b", condition: "amount > 100" },
      { id: "e3", target: "c", isDefault: true },
    ]);
    const result = pickExclusiveGatewayEdge(canvas, "gw", { amount: 50 });
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.edge.id).toBe("e3");
      expect(result.reason).toBe("default");
    }
  });

  it("returns no-match when nothing matches and no default exists", () => {
    const canvas = gatewayCanvas([
      { id: "e1", target: "a", condition: "amount > 1000" },
      { id: "e2", target: "b", condition: "amount > 100" },
    ]);
    const result = pickExclusiveGatewayEdge(canvas, "gw", { amount: 50 });
    expect(result.kind).toBe("no-match");
  });

  it("returns eval-error when a condition throws", () => {
    const canvas = gatewayCanvas([
      { id: "e1", target: "a", condition: "this === bad" },
      { id: "e2", target: "b", isDefault: true },
    ]);
    const result = pickExclusiveGatewayEdge(canvas, "gw", {});
    expect(result.kind).toBe("eval-error");
  });

  it("skips edges with no condition during matching, considers them only as default", () => {
    // First edge has no condition (and isn't default) — should be skipped,
    // not silently picked.
    const canvas = gatewayCanvas([
      { id: "e1", target: "a" }, // no condition, no default
      { id: "e2", target: "b", condition: "amount > 100" },
    ]);
    const result = pickExclusiveGatewayEdge(canvas, "gw", { amount: 200 });
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.edge.id).toBe("e2");
    }
  });
});

// ─── E3: assignee resolution + completeTask flow ────────────────────

describe("resolveDirectUserAssignee", () => {
  const node = (data?: Record<string, unknown>): EngineNode => ({
    id: "t",
    type: "userTask",
    data,
  });

  it("returns the userId for a directUser assignment with a UUID", () => {
    expect(
      resolveDirectUserAssignee(
        node({ assignment: { type: "directUser", value: UUID_A } }),
      ).assignee,
    ).toBe(UUID_A);
  });

  it("returns candidateRole for a role assignment (claim-first; no assignee)", () => {
    const { assignee, candidateRole, diagnostic } = resolveDirectUserAssignee(
      node({ assignment: { type: "role", value: "manager" } }),
    );
    expect(assignee).toBeNull();
    expect(candidateRole).toBe("manager");
    expect(diagnostic).toBeUndefined();
  });

  it("emits `empty-role-key` diagnostic when role assignment has no key", () => {
    const { assignee, candidateRole, diagnostic } = resolveDirectUserAssignee(
      node({ assignment: { type: "role", value: "   " } }),
    );
    expect(assignee).toBeNull();
    expect(candidateRole).toBeNull();
    expect(diagnostic?.reason).toBe("empty-role-key");
  });

  it("returns null + diagnostic for unknown assignment types", () => {
    const { assignee, diagnostic } = resolveDirectUserAssignee(
      node({ assignment: { type: "candidateGroup", value: UUID_A } }),
    );
    expect(assignee).toBeNull();
    expect(diagnostic?.reason).toBe("unsupported-type");
    expect(diagnostic?.assignmentType).toBe("candidateGroup");
  });

  it("resolves an expression assignment against the variable bag", () => {
    const { assignee, diagnostic } = resolveDirectUserAssignee(
      node({ assignment: { type: "expression", value: "${managerId}" } }),
      { managerId: UUID_A },
    );
    expect(assignee).toBe(UUID_A);
    expect(diagnostic).toBeUndefined();
  });

  it("emits an `unresolved-expression` diagnostic when the variable is missing", () => {
    const { assignee, diagnostic } = resolveDirectUserAssignee(
      node({ assignment: { type: "expression", value: "${managerId}" } }),
      {},
    );
    expect(assignee).toBeNull();
    expect(diagnostic?.reason).toBe("unresolved-expression");
    expect(diagnostic?.expression).toBe("${managerId}");
  });

  it("emits `expression-not-uuid` when the resolved value is not a UUID", () => {
    const { assignee, diagnostic } = resolveDirectUserAssignee(
      node({ assignment: { type: "expression", value: "${managerId}" } }),
      { managerId: "alice" },
    );
    expect(assignee).toBeNull();
    expect(diagnostic?.reason).toBe("expression-not-uuid");
  });

  it("returns null when the value is not a UUID", () => {
    expect(
      resolveDirectUserAssignee(
        node({ assignment: { type: "directUser", value: "not-a-uuid" } }),
      ).assignee,
    ).toBeNull();
  });

  it("returns null when there is no assignment at all", () => {
    expect(resolveDirectUserAssignee(node(undefined)).assignee).toBeNull();
    expect(resolveDirectUserAssignee(node({})).assignee).toBeNull();
  });
});

/** Focused fake-DB for completeTask: serves a stateful waiting token +
 *  instance row to the engine's `loadWaitingTokenForCompletion` and
 *  `loadInstanceById`, then records every insert/update so the test
 *  can assert on the resume audit trail. */
function makeCompleteTaskEnv(opts: {
  tokenAssignedTo: string | null;
  tokenStatus?: "active" | "waiting" | "completed" | "failed";
  waitingFor?: string | null;
  canvas: unknown;
  variables?: Record<string, unknown>;
}) {
  const tokenRow = {
    id: "tok-waiting",
    tenantId: "tenant-1",
    instanceId: "inst-1",
    currentNodeId: "t",
    status: opts.tokenStatus ?? "waiting",
    waitingFor: opts.waitingFor ?? "userTask",
    assignedTo: opts.tokenAssignedTo,
    version: 5,
  };
  const instanceRow = {
    id: "inst-1",
    version: 2,
    variables: opts.variables ?? {},
    definitionSnapshot: opts.canvas,
  };

  const inserts: { table: string; values: Record<string, unknown>[] }[] = [];
  const updates: { table: string; set: Record<string, unknown> }[] = [];

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
          inserts.push({ table: name, values: Array.isArray(rows) ? rows : [rows] });
          return {
            returning() { return Promise.resolve([{}]); },
            then(resolve: (v: unknown) => unknown) { return resolve(undefined); },
          };
        },
      };
    },
    update(table: unknown) {
      const name = tableName(table);
      return {
        set(values: Record<string, unknown>) {
          // Simulate an optimistic-lock miss: if the test set
          // tokenRow.simulateConflict (or instanceRow.simulateConflict)
          // we return zero affected rows once, then clear the flag.
          let simulateMiss = false;
          if (name === "INSTANCE_TOKENS" && (tokenRow as Record<string, unknown>).simulateConflict) {
            simulateMiss = true;
            (tokenRow as Record<string, unknown>).simulateConflict = false;
          }
          if (name === "PROCESS_INSTANCES" && (instanceRow as Record<string, unknown>).simulateConflict) {
            simulateMiss = true;
            (instanceRow as Record<string, unknown>).simulateConflict = false;
          }
          if (!simulateMiss) {
            if (name === "INSTANCE_TOKENS" && typeof values.version === "number") {
              tokenRow.version = values.version;
              if (typeof values.status === "string") tokenRow.status = values.status as typeof tokenRow.status;
            }
            if (name === "PROCESS_INSTANCES" && typeof values.version === "number") {
              instanceRow.version = values.version;
            }
          }
          return {
            where(_cond: unknown) {
              return {
                returning() {
                  updates.push({ table: name, set: values });
                  if (simulateMiss) return Promise.resolve([]);
                  return Promise.resolve([{ id: name === "INSTANCE_TOKENS" ? tokenRow.id : instanceRow.id }]);
                },
              };
            },
          };
        },
      };
    },
    select(_cols?: unknown) {
      // Two stateful selects: one for INSTANCE_TOKENS (load token),
      // one for PROCESS_INSTANCES (load instance). The fake routes by
      // the first table reference observed.
      let routedTable: string | null = null;
      const chain = {
        from(table: unknown) {
          routedTable = tableName(table);
          return chain;
        },
        where(_cond: unknown) { return chain; },
        limit() {
          if (routedTable === "INSTANCE_TOKENS") {
            return Promise.resolve([tokenRow]);
          }
          if (routedTable === "PROCESS_INSTANCES") {
            return Promise.resolve([instanceRow]);
          }
          return Promise.resolve([]);
        },
        // P1 countLiveTokens — completeTask only has the one waiting
        // userTask token, so 0 live tokens AFTER it transitions to
        // active (the engine sets status=active before this query
        // runs). We approximate by reading tokenRow.status: live when
        // active|waiting, 0 otherwise.
        then(resolve: (v: unknown) => unknown) {
          if (routedTable === "INSTANCE_TOKENS") {
            const live = tokenRow.status === "active" || tokenRow.status === "waiting"
              ? [{ id: tokenRow.id }]
              : [];
            return resolve(live);
          }
          return resolve([]);
        },
      };
      return chain;
    },
  };

  const db = {
    transaction<T>(fn: (tx: typeof tx) => Promise<T>): Promise<T> { return fn(tx); },
  };

  return { db, tx, inserts, updates, tokenRow, instanceRow };
}

describe("EngineService.completeTask", () => {
  const happyCanvas = {
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

  it("completes a waiting task assigned to the caller and runs to instance-completed", async () => {
    const env = makeCompleteTaskEnv({ tokenAssignedTo: UUID_A, canvas: happyCanvas });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);

    const out = await service.completeTask({
      tokenId: "tok-waiting",
      tenantId: "tenant-1",
      userId: UUID_A,
      formData: { approval: "yes" },
    });

    expect(out.instanceStatus).toBe("completed");
    expect(out.tokenStatus).toBe("completed");

    const events = env.inserts
      .filter((i) => i.table === "INSTANCE_EVENTS")
      .map((i) => i.values[0].eventType as string);
    // Resume audit trail (E3 polish): task-completed first as the
    // user-facing anchor, then per-key variable-set attributions, then
    // token-resumed and the resumed advance through the end event.
    expect(events).toEqual([
      "task-completed",
      "variable-set",
      "token-resumed",
      // resumed advance: userTask's node-exited → edge-taken → end's
      // entered/exited/token-completed → instance-completed.
      "node-exited",
      "edge-taken",
      "node-entered",
      "node-exited",
      "token-completed",
      "instance-completed",
    ]);

    // Variables were merged onto the instance.
    const varUpdate = env.updates.find(
      (u) => u.table === "PROCESS_INSTANCES" && u.set.variables !== undefined,
    );
    expect(varUpdate?.set.variables).toEqual({ approval: "yes" });
  });

  it("rejects completion when the caller is not the assignee (403)", async () => {
    const env = makeCompleteTaskEnv({ tokenAssignedTo: UUID_A, canvas: happyCanvas });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    await expect(
      service.completeTask({
        tokenId: "tok-waiting",
        tenantId: "tenant-1",
        userId: UUID_B,
      }),
    ).rejects.toThrow(/assigned to another user/);
  });

  it("allows any tenant user to complete an unassigned task", async () => {
    const env = makeCompleteTaskEnv({ tokenAssignedTo: null, canvas: happyCanvas });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    const out = await service.completeTask({
      tokenId: "tok-waiting",
      tenantId: "tenant-1",
      userId: UUID_B,
    });
    expect(out.instanceStatus).toBe("completed");
  });

  it("rejects when token is not in waiting state", async () => {
    const env = makeCompleteTaskEnv({
      tokenAssignedTo: null,
      tokenStatus: "completed",
      waitingFor: null,
      canvas: happyCanvas,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    await expect(
      service.completeTask({
        tokenId: "tok-waiting",
        tenantId: "tenant-1",
        userId: UUID_A,
      }),
    ).rejects.toThrow(/not waiting/);
  });

  it("rejects cross-tenant token access (404)", async () => {
    const env = makeCompleteTaskEnv({ tokenAssignedTo: null, canvas: happyCanvas });
    // Override the select chain so the (tokenId, tenantId) WHERE
    // matches nothing.
    env.tx.select = () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    await expect(
      service.completeTask({
        tokenId: "tok-waiting",
        tenantId: "tenant-other",
        userId: UUID_A,
      }),
    ).rejects.toThrow(/Task not found/);
  });

  it("when no formData is provided, no variable-set events are written", async () => {
    const env = makeCompleteTaskEnv({ tokenAssignedTo: UUID_A, canvas: happyCanvas });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    await service.completeTask({
      tokenId: "tok-waiting",
      tenantId: "tenant-1",
      userId: UUID_A,
    });
    const events = env.inserts
      .filter((i) => i.table === "INSTANCE_EVENTS")
      .map((i) => i.values[0].eventType as string);
    expect(events).not.toContain("variable-set");
    expect(events[0]).toBe("task-completed");
  });

  it("optimistic-lock conflict on instance variable update surfaces as 409", async () => {
    const env = makeCompleteTaskEnv({ tokenAssignedTo: UUID_A, canvas: happyCanvas });
    // Force the instance UPDATE to behave as if a concurrent writer
    // bumped the version under us. The instance update happens during
    // the variable-merge step in completeTask.
    (env.instanceRow as Record<string, unknown>).simulateConflict = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    await expect(
      service.completeTask({
        tokenId: "tok-waiting",
        tenantId: "tenant-1",
        userId: UUID_A,
        formData: { approval: "yes" },
      }),
    ).rejects.toThrow(/Concurrent instance update/);
  });

  it("optimistic-lock conflict on token resume surfaces as 409", async () => {
    const env = makeCompleteTaskEnv({ tokenAssignedTo: UUID_A, canvas: happyCanvas });
    // Token UPDATE (status=active) is the next write after audit
    // events; force a conflict there.
    (env.tokenRow as Record<string, unknown>).simulateConflict = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    await expect(
      service.completeTask({
        tokenId: "tok-waiting",
        tenantId: "tenant-1",
        userId: UUID_A,
      }),
    ).rejects.toThrow(/Concurrent token update/);
  });

  it("E5 polish: cancelInstance also marks queued/running ENGINE_JOBS dead", async () => {
    // Standalone fake — captures every UPDATE so we can verify the
    // engine_jobs UPDATE is issued during the cancel flow.
    const inst = { id: "inst-1", status: "running", version: 0 };
    const liveTokens: Array<{ id: string; version: number; currentNodeId: string }> = [
      { id: "tok-1", version: 0, currentNodeId: "svc" },
    ];
    const updates: { table: string; set: Record<string, unknown> }[] = [];
    const tableName = (table: unknown): string => {
      if (table && typeof table === "object" && Symbol.for("drizzle:Name") in table) {
        // @ts-expect-error — drizzle internal
        return table[Symbol.for("drizzle:Name")] as string;
      }
      return "unknown";
    };
    const tx = {
      insert: (_table: unknown) => ({
        values: () => ({
          returning: () => Promise.resolve([{}]),
          then: (r: (v: unknown) => unknown) => r(undefined),
        }),
      }),
      update: (table: unknown) => {
        const name = tableName(table);
        return {
          set: (values: Record<string, unknown>) => {
            updates.push({ table: name, set: values });
            return {
              where: () => ({
                returning: () => {
                  if (name === "ENGINE_JOBS") {
                    return Promise.resolve([{ id: "job-1" }, { id: "job-2" }]);
                  }
                  return Promise.resolve([{ id: "x" }]);
                },
              }),
            };
          },
        };
      },
      select: () => {
        let routed: string | null = null;
        const chain = {
          from: (table: unknown) => {
            routed = tableName(table);
            return chain;
          },
          where: () => chain,
          orderBy: () => chain,
          limit: () => Promise.resolve(routed === "PROCESS_INSTANCES" ? [inst] : []),
          then: (r: (v: unknown) => unknown) => {
            if (routed === "INSTANCE_TOKENS") return r(liveTokens);
            return r([]);
          },
        };
        return chain;
      },
    };
    const db = {
      transaction: <T>(fn: (tx: typeof tx) => Promise<T>): Promise<T> => fn(tx),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(db as any, makeFakeWorker() as any);

    const out = await service.cancelInstance({
      instanceId: "inst-1",
      tenantId: "t",
      userId: UUID_A,
    });
    expect(out.status).toBe("cancelled");
    // The ENGINE_JOBS UPDATE was issued with status=dead.
    const jobUpdate = updates.find(
      (u) => u.table === "ENGINE_JOBS" && u.set.status === "dead",
    );
    expect(jobUpdate).toBeDefined();
    expect(jobUpdate?.set.lastError).toBe("Instance cancelled.");
  });

  it("cancelled instance + already-terminal idempotent cancel", async () => {
    // Build a richer fake to cover cancelInstance: needs select on
    // PROCESS_INSTANCES (with status + version), select on
    // INSTANCE_TOKENS (live tokens), updates on both.
    const inst = { id: "inst-1", status: "running" as string, version: 0 };
    const liveTokens = [
      { id: "tok-1", version: 1, currentNodeId: "t" },
      { id: "tok-2", version: 0, currentNodeId: "t2" },
    ];
    const inserts: { table: string; values: Record<string, unknown>[] }[] = [];
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
            inserts.push({ table: name, values: Array.isArray(rows) ? rows : [rows] });
            return {
              returning: () => Promise.resolve([{}]),
              then: (resolve: (v: unknown) => unknown) => resolve(undefined),
            };
          },
        };
      },
      update(table: unknown) {
        const name = tableName(table);
        return {
          set(values: Record<string, unknown>) {
            if (name === "PROCESS_INSTANCES" && typeof values.version === "number") {
              inst.version = values.version;
              if (typeof values.status === "string") inst.status = values.status;
            }
            if (name === "INSTANCE_TOKENS" && typeof values.version === "number") {
              const tokId = liveTokens[0]?.id; // fake doesn't introspect WHERE; ok
              if (tokId) liveTokens[0].version = values.version;
            }
            return {
              where: () => ({
                returning: () => Promise.resolve([{ id: name === "INSTANCE_TOKENS" ? "tok-1" : inst.id }]),
              }),
            };
          },
        };
      },
      select() {
        let routed: string | null = null;
        const chain = {
          from(table: unknown) {
            routed = tableName(table);
            return chain;
          },
          where: () => chain,
          orderBy: () => chain,
          limit: () => {
            if (routed === "PROCESS_INSTANCES") return Promise.resolve([inst]);
            if (routed === "INSTANCE_TOKENS") return Promise.resolve(liveTokens);
            return Promise.resolve([]);
          },
          then: (resolve: (v: unknown) => unknown) => {
            if (routed === "INSTANCE_TOKENS") return resolve(liveTokens);
            if (routed === "PROCESS_INSTANCES") return resolve([inst]);
            return resolve([]);
          },
        };
        return chain;
      },
    };
    const db = {
      transaction<T>(fn: (tx: typeof tx) => Promise<T>): Promise<T> { return fn(tx); },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(db as any, makeFakeWorker() as any);

    const out = await service.cancelInstance({
      instanceId: "inst-1",
      tenantId: "tenant-1",
      userId: UUID_A,
      reason: "wrong process",
    });

    expect(out.status).toBe("cancelled");
    expect(out.tokensCancelled).toBeGreaterThan(0);
    const events = inserts
      .filter((i) => i.table === "INSTANCE_EVENTS")
      .map((i) => i.values[0].eventType as string);
    expect(events).toContain("error"); // per cancelled token
    expect(events).toContain("instance-cancelled");

    // Second call on the now-cancelled instance: idempotent no-op.
    const out2 = await service.cancelInstance({
      instanceId: "inst-1",
      tenantId: "tenant-1",
      userId: UUID_A,
    });
    expect(out2.status).toBe("cancelled");
    expect(out2.tokensCancelled).toBe(0);
  });

  it("E4.5c: PII redaction replaces value in variable-set audit when key is in canvas.engineConfig", async () => {
    const env = makeCompleteTaskEnv({
      tokenAssignedTo: UUID_A,
      canvas: {
        nodes: [
          { id: "s", type: "startEvent" },
          { id: "t", type: "userTask" },
          { id: "e", type: "endEvent" },
        ],
        edges: [
          { id: "e1", source: "s", target: "t" },
          { id: "e2", source: "t", target: "e" },
        ],
        engineConfig: { redactedVariableKeys: ["ssn"] },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    await service.completeTask({
      tokenId: "tok-waiting",
      tenantId: "tenant-1",
      userId: UUID_A,
      formData: { ssn: "123-45-6789", approval: "yes" },
    });
    const variableSetRows = env.inserts
      .filter((i) => i.table === "INSTANCE_EVENTS" && i.values[0].eventType === "variable-set")
      .map((i) => i.values[0].payload as Record<string, unknown>);
    const ssnRow = variableSetRows.find((p) => p.key === "ssn");
    const approvalRow = variableSetRows.find((p) => p.key === "approval");
    expect(ssnRow?.value).toBe("<redacted>");
    expect(ssnRow?.redacted).toBe(true);
    expect(approvalRow?.value).toBe("yes");
    expect(approvalRow?.redacted).toBeUndefined();
  });

  it("E4.5c: completeTask emits a task-completed outbox row", async () => {
    const env = makeCompleteTaskEnv({
      tokenAssignedTo: UUID_A,
      canvas: {
        nodes: [
          { id: "s", type: "startEvent" },
          { id: "t", type: "userTask" },
          { id: "e", type: "endEvent" },
        ],
        edges: [
          { id: "e1", source: "s", target: "t" },
          { id: "e2", source: "t", target: "e" },
        ],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    await service.completeTask({
      tokenId: "tok-waiting",
      tenantId: "tenant-1",
      userId: UUID_A,
    });
    const outboxTypes = env.inserts
      .filter((i) => i.table === "OUTBOX_EVENTS")
      .map((i) => i.values[0].eventType as string);
    expect(outboxTypes).toContain("task-completed");
  });

  it("E5: completeServiceTask resumes a service-task-suspended token and merges result into vars", async () => {
    const env = makeCompleteTaskEnv({
      tokenAssignedTo: null,
      tokenStatus: "waiting",
      waitingFor: "service-task",
      canvas: {
        nodes: [
          { id: "s", type: "startEvent" },
          { id: "svc", type: "serviceTask" },
          { id: "e", type: "endEvent" },
        ],
        edges: [
          { id: "e1", source: "s", target: "svc" },
          { id: "e2", source: "svc", target: "e" },
        ],
      },
    });
    // Override the token's currentNodeId to match the serviceTask.
    env.tokenRow.currentNodeId = "svc";
    const fakeWorker = makeFakeWorker();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, fakeWorker as any);

    const out = await service.completeServiceTask({
      tokenId: "tok-waiting",
      tenantId: "tenant-1",
      result: { emailSent: true, messageId: "msg-42" },
    });
    expect(out.instanceStatus).toBe("completed");
    expect(out.tokenStatus).toBe("completed");

    // Variables merged onto the instance row.
    const varUpdate = env.updates.find(
      (u) => u.table === "PROCESS_INSTANCES" && u.set.variables !== undefined,
    );
    expect(varUpdate?.set.variables).toMatchObject({
      emailSent: true,
      messageId: "msg-42",
    });
    // Per-key variable-set audit rows tagged with source.
    const varEvents = env.inserts
      .filter((i) => i.table === "INSTANCE_EVENTS" && i.values[0].eventType === "variable-set")
      .map((i) => i.values[0].payload as Record<string, unknown>);
    expect(varEvents.every((p) => p.source === "service-task")).toBe(true);
  });

  it("E5 mappings: outputMappings reshape the handler result before merging into vars", async () => {
    const env = makeCompleteTaskEnv({
      tokenAssignedTo: null,
      tokenStatus: "waiting",
      waitingFor: "service-task",
      canvas: {
        nodes: [
          { id: "s", type: "startEvent" },
          {
            id: "svc",
            type: "serviceTask",
            data: {
              outputMappings: {
                ticketId: "$response.id",
                stage: "$response.status",
              },
            },
          },
          { id: "e", type: "endEvent" },
        ],
        edges: [
          { id: "e1", source: "s", target: "svc" },
          { id: "e2", source: "svc", target: "e" },
        ],
      },
    });
    env.tokenRow.currentNodeId = "svc";
    const fakeWorker = makeFakeWorker();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, fakeWorker as any);

    await service.completeServiceTask({
      tokenId: "tok-waiting",
      tenantId: "tenant-1",
      result: {
        response: { id: "T-99", status: "open", privateField: "leaks-without-mapping" },
      },
    });

    // The instance variable update should ONLY contain the mapped
    // keys — `response.privateField` doesn't surface anywhere.
    const varUpdate = env.updates.find(
      (u) => u.table === "PROCESS_INSTANCES" && u.set.variables !== undefined,
    );
    const vars = varUpdate?.set.variables as Record<string, unknown>;
    expect(vars.ticketId).toBe("T-99");
    expect(vars.stage).toBe("open");
    expect("response" in vars).toBe(false);
    expect("privateField" in vars).toBe(false);
  });

  it("E5: completeServiceTask refuses a token not waiting on a service task", async () => {
    const env = makeCompleteTaskEnv({
      tokenAssignedTo: UUID_A,
      tokenStatus: "waiting",
      waitingFor: "userTask", // wrong wait kind
      canvas: { nodes: [], edges: [] },
    });
    const fakeWorker = makeFakeWorker();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, fakeWorker as any);
    await expect(
      service.completeServiceTask({
        tokenId: "tok-waiting",
        tenantId: "tenant-1",
        result: {},
      }),
    ).rejects.toThrow(/not waiting on a service task/);
  });

  it("E5: failServiceTaskFromWorker marks token + instance failed (onDead path)", async () => {
    const env = makeCompleteTaskEnv({
      tokenAssignedTo: null,
      tokenStatus: "waiting",
      waitingFor: "service-task",
      canvas: { nodes: [], edges: [] },
    });
    const fakeWorker = makeFakeWorker();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, fakeWorker as any);

    await service.failServiceTaskFromWorker({
      tokenId: "tok-waiting",
      tenantId: "tenant-1",
      reason: "max retries exceeded",
    });

    // Token flipped to failed.
    const tokenFail = env.updates.find(
      (u) => u.table === "INSTANCE_TOKENS" && u.set.status === "failed",
    );
    expect(tokenFail?.set.errorMessage).toBe("max retries exceeded");
    // Instance flipped to failed.
    const instFail = env.updates.find(
      (u) => u.table === "PROCESS_INSTANCES" && u.set.status === "failed",
    );
    expect(instFail).toBeDefined();
    // Audit + outbox both written.
    const eventTypes = env.inserts
      .filter((i) => i.table === "INSTANCE_EVENTS")
      .map((i) => i.values[0].eventType as string);
    expect(eventTypes).toContain("error");
    expect(eventTypes).toContain("instance-failed");
    const outboxTypes = env.inserts
      .filter((i) => i.table === "OUTBOX_EVENTS")
      .map((i) => i.values[0].eventType as string);
    expect(outboxTypes).toContain("instance-failed");
  });

  it("E5: failServiceTaskFromWorker is idempotent if the token already moved on", async () => {
    const env = makeCompleteTaskEnv({
      tokenAssignedTo: null,
      tokenStatus: "completed", // already done
      waitingFor: null,
      canvas: { nodes: [], edges: [] },
    });
    const fakeWorker = makeFakeWorker();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, fakeWorker as any);
    // Should NOT throw — the dead-job retry hitting an already-done
    // token is a no-op (the load helper returns null caught by a
    // .catch in the engine, then early-return).
    await expect(
      service.failServiceTaskFromWorker({
        tokenId: "tok-waiting",
        tenantId: "tenant-1",
        reason: "any",
      }),
    ).resolves.toBeUndefined();
    // No state mutations.
    const failUpdate = env.updates.find((u) => u.set.status === "failed");
    expect(failUpdate).toBeUndefined();
  });

  it("if the task is followed by another userTask, instance stays running and re-suspends", async () => {
    const env = makeCompleteTaskEnv({
      tokenAssignedTo: UUID_A,
      canvas: {
        nodes: [
          { id: "s", type: "startEvent" },
          { id: "t", type: "userTask" }, // completing this one
          { id: "t2", type: "userTask" }, // re-suspends here
          { id: "e", type: "endEvent" },
        ],
        edges: [
          { id: "e1", source: "s", target: "t" },
          { id: "e2", source: "t", target: "t2" },
          { id: "e3", source: "t2", target: "e" },
        ],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    const out = await service.completeTask({
      tokenId: "tok-waiting",
      tenantId: "tenant-1",
      userId: UUID_A,
    });
    expect(out.instanceStatus).toBe("running");
    expect(out.tokenStatus).toBe("waiting");
  });

  // ─── P0: outcome list validation ──────────────────────────────────
  describe("outcome list validation", () => {
    const outcomesCanvas = {
      nodes: [
        { id: "s", type: "startEvent" },
        {
          id: "t",
          type: "userTask",
          data: {
            outcomes: [
              { id: "approve", label: "Approve" },
              { id: "reject", label: "Reject" },
            ],
          },
        },
        { id: "e", type: "endEvent" },
      ],
      edges: [
        { id: "e1", source: "s", target: "t" },
        { id: "e2", source: "t", target: "e" },
      ],
    };

    it("accepts a submitted outcome that matches a declared id", async () => {
      const env = makeCompleteTaskEnv({ tokenAssignedTo: UUID_A, canvas: outcomesCanvas });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new EngineService(env.db as any, makeFakeWorker() as any);
      const out = await service.completeTask({
        tokenId: "tok-waiting",
        tenantId: "tenant-1",
        userId: UUID_A,
        formData: { outcome: "approve" },
      });
      expect(out.instanceStatus).toBe("completed");
    });

    it("accepts an outcome matching a declared label", async () => {
      const env = makeCompleteTaskEnv({ tokenAssignedTo: UUID_A, canvas: outcomesCanvas });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new EngineService(env.db as any, makeFakeWorker() as any);
      const out = await service.completeTask({
        tokenId: "tok-waiting",
        tenantId: "tenant-1",
        userId: UUID_A,
        formData: { outcome: "Reject" },
      });
      expect(out.instanceStatus).toBe("completed");
    });

    it("rejects completion without an outcome when outcomes are declared", async () => {
      const env = makeCompleteTaskEnv({ tokenAssignedTo: UUID_A, canvas: outcomesCanvas });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new EngineService(env.db as any, makeFakeWorker() as any);
      await expect(
        service.completeTask({
          tokenId: "tok-waiting",
          tenantId: "tenant-1",
          userId: UUID_A,
          formData: { approval: "yes" },
        }),
      ).rejects.toThrow(/declared outcomes/);
    });

    it("rejects an outcome that is not in the declared list", async () => {
      const env = makeCompleteTaskEnv({ tokenAssignedTo: UUID_A, canvas: outcomesCanvas });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new EngineService(env.db as any, makeFakeWorker() as any);
      await expect(
        service.completeTask({
          tokenId: "tok-waiting",
          tenantId: "tenant-1",
          userId: UUID_A,
          formData: { outcome: "delegate" },
        }),
      ).rejects.toThrow(/not declared/);
    });

    it("skips validation when the task declares no outcomes", async () => {
      const env = makeCompleteTaskEnv({ tokenAssignedTo: UUID_A, canvas: happyCanvas });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new EngineService(env.db as any, makeFakeWorker() as any);
      const out = await service.completeTask({
        tokenId: "tok-waiting",
        tenantId: "tenant-1",
        userId: UUID_A,
        formData: { outcome: "anything-goes" },
      });
      expect(out.instanceStatus).toBe("completed");
    });
  });
});

// ─── P0: task scheduling resolver ────────────────────────────────────

describe("resolveTaskScheduling", () => {
  const node = (scheduling?: Record<string, unknown>): EngineNode => ({
    id: "t",
    type: "userTask",
    data: scheduling ? { scheduling } : {},
  });

  it("returns nulls when no scheduling is configured", () => {
    expect(resolveTaskScheduling(node())).toEqual({ dueAt: null, priority: null });
    expect(resolveTaskScheduling(node({}))).toEqual({ dueAt: null, priority: null });
  });

  it("parses a static ISO datetime into dueAt", () => {
    const { dueAt } = resolveTaskScheduling(
      node({ dueDate: "2026-12-01T09:00:00Z" }),
    );
    expect(dueAt?.toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });

  it("parses an ISO duration relative to the supplied clock", () => {
    const fixed = new Date("2026-05-21T00:00:00Z");
    const { dueAt } = resolveTaskScheduling(node({ dueDate: "PT2H" }), fixed);
    expect(dueAt?.toISOString()).toBe("2026-05-21T02:00:00.000Z");
  });

  it("parses an ISO duration with days", () => {
    const fixed = new Date("2026-05-21T00:00:00Z");
    const { dueAt } = resolveTaskScheduling(node({ dueDate: "P1D" }), fixed);
    expect(dueAt?.toISOString()).toBe("2026-05-22T00:00:00.000Z");
  });

  it("returns null dueAt for an unparseable value", () => {
    const { dueAt } = resolveTaskScheduling(node({ dueDate: "not-a-date" }));
    expect(dueAt).toBeNull();
  });

  it("skips dueDate when dueDateIsExpression is set (deferred to P2)", () => {
    const { dueAt } = resolveTaskScheduling(
      node({ dueDate: "${order.deliverBy}", dueDateIsExpression: true }),
    );
    expect(dueAt).toBeNull();
  });

  it("persists a numeric priority", () => {
    expect(resolveTaskScheduling(node({ priority: 75 })).priority).toBe(75);
  });

  it("skips priority when a priorityExpression is set", () => {
    expect(
      resolveTaskScheduling(node({ priority: 50, priorityExpression: "${urgency}" })).priority,
    ).toBeNull();
  });

  it("ignores a non-numeric priority", () => {
    expect(resolveTaskScheduling(node({ priority: "high" })).priority).toBeNull();
  });
});

// ─── P1: parallel-gateway split ──────────────────────────────────────

/** Fake DB tailored for parallel-split tests. Differences from makeFakeTx:
 *   • Each INSERT into INSTANCE_TOKENS allocates a fresh id (`tok-2`,
 *     `tok-3`, …) so child tokens don't collide with the root token.
 *   • Optimistic-lock UPDATEs always succeed (always returns 1 row) —
 *     we don't need to simulate version contention for these tests.
 *   • countLiveTokens runs against tracked rows: every INSERTed token
 *     starts `active`; UPDATEs that set `status` mutate the in-memory
 *     row. Lets us assert the instance flips only after the LAST sibling
 *     completes. */
function makeParallelEnv(canvas: unknown) {
  const inserts: { table: string; values: Record<string, unknown>[] }[] = [];
  const updates: { table: string; set: Record<string, unknown> }[] = [];
  // Tokens start empty — the root token gets INSERTed by startInstance
  // and our insert handler appends it (id `tok-1`). Child tokens then
  // get `tok-2`, `tok-3`, …
  const tokenRows: Array<Record<string, unknown> & { id: string; status: string; version: number }> = [];
  let nextTokenSeq = 0;
  const instanceRow = { id: "inst-1", version: 0, status: "running", variables: {} };

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
          const arr = Array.isArray(rows) ? rows : [rows];
          inserts.push({ table: name, values: arr });
          if (name === "INSTANCE_TOKENS") {
            const newIds = arr.map((r) => {
              const id = `tok-${++nextTokenSeq}`;
              tokenRows.push({
                ...r,
                id,
                status: (r.status as string) ?? "active",
                version: 0,
              });
              return { id, version: 0 };
            });
            return {
              returning() { return Promise.resolve(newIds); },
              then(resolve: (v: unknown) => unknown) { return resolve(undefined); },
            };
          }
          return {
            returning() { return Promise.resolve([{}]); },
            then(resolve: (v: unknown) => unknown) { return resolve(undefined); },
          };
        },
      };
    },
    update(table: unknown) {
      const name = tableName(table);
      return {
        set(values: Record<string, unknown>) {
          updates.push({ table: name, set: values });
          // The updateTokenWithLock filter is (id, expectedVersion). We
          // don't see the WHERE here, so we match by version: the
          // engine bumps version on every UPDATE so the prior version
          // uniquely identifies the target token in test scenarios.
          if (name === "INSTANCE_TOKENS" && typeof values.version === "number") {
            const expected = values.version - 1;
            const target = [...tokenRows].reverse().find((t) => t.version === expected);
            if (target) {
              if (typeof values.status === "string") target.status = values.status;
              if (typeof values.currentNodeId === "string") target.currentNodeId = values.currentNodeId;
              target.version = values.version;
            }
          }
          return {
            where(_cond: unknown) {
              return {
                returning() {
                  return Promise.resolve([{ id: name === "INSTANCE_TOKENS" ? "tok" : instanceRow.id }]);
                },
                then(resolve: (v: unknown) => unknown) { return resolve(undefined); },
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
        where(_cond: unknown) { return chain; },
        limit() {
          if (routed === "PROCESS_INSTANCES") return Promise.resolve([instanceRow]);
          return Promise.resolve([]);
        },
        then(resolve: (v: unknown) => unknown) {
          // countLiveTokens select uses .then (no .limit) — return
          // tokens whose status is active|waiting.
          if (routed === "INSTANCE_TOKENS") {
            return resolve(tokenRows.filter((t) => t.status === "active" || t.status === "waiting"));
          }
          return resolve([]);
        },
      };
      return chain;
    },
  };

  let lastTable: string | null = null;
  const db = {
    select(_cols?: unknown) {
      const chain = {
        from(table: unknown) {
          lastTable = tableName(table);
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () => {
          if (lastTable === "PROCESSES") {
            return Promise.resolve([{ canvasData: canvas, status: "ACTIVE" }]);
          }
          return Promise.resolve([]);
        },
      };
      return chain;
    },
    insert(table: unknown) {
      const name = tableName(table);
      return {
        values(rows: Record<string, unknown> | Record<string, unknown>[]) {
          inserts.push({ table: name, values: Array.isArray(rows) ? rows : [rows] });
          return {
            returning() { return Promise.resolve([{ id: "ver-1" }]); },
          };
        },
      };
    },
    transaction<T>(fn: (tx: typeof tx) => Promise<T>): Promise<T> {
      return fn(tx);
    },
  };
  return { db, tx, inserts, updates, tokenRows, instanceRow };
}

describe("EngineService — P1 parallel-gateway split", () => {
  it("2-way split: inserts 2 child tokens carrying parentTokenId + a shared forkId, parent flips to completed", async () => {
    const env = makeParallelEnv({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "pg", type: "parallelGateway" },
        { id: "a", type: "endEvent" },
        { id: "b", type: "endEvent" },
      ],
      edges: [
        { id: "e0", source: "s", target: "pg" },
        { id: "e1", source: "pg", target: "a" },
        { id: "e2", source: "pg", target: "b" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    const out = await service.startInstance({ processId: "p", tenantId: "t", userId: "u" });

    // Two children inserted with parent + shared forkId.
    const tokenInserts = env.inserts.filter((i) => i.table === "INSTANCE_TOKENS");
    // First insert is the root token; the next two are the children.
    expect(tokenInserts.length).toBe(3);
    const child1 = tokenInserts[1].values[0];
    const child2 = tokenInserts[2].values[0];
    expect(child1.parentTokenId).toBeDefined();
    expect(child1.parentTokenId).toBe(child2.parentTokenId);
    expect(child1.forkId).toBe(child2.forkId);
    expect(typeof child1.forkId).toBe("string");

    // Instance completed (both children ran to endEvent so live count = 0).
    expect(out.status).toBe("completed");
    expect(env.updates.some((u) => u.table === "PROCESS_INSTANCES" && u.set.status === "completed")).toBe(true);

    // Audit trail carries token-created + edge-taken per child + the
    // parent's node-exited.
    const events = env.inserts
      .filter((i) => i.table === "INSTANCE_EVENTS")
      .map((i) => i.values[0].eventType as string);
    expect(events.filter((e) => e === "edge-taken").length).toBeGreaterThanOrEqual(3); // start→pg + pg→a + pg→b
    expect(events.filter((e) => e === "token-created").length).toBe(3); // root + 2 children
    expect(events.includes("instance-completed")).toBe(true);
  });

  it("3-way split: spawns 3 children, all carry the SAME forkId; instance completes after last sibling drains", async () => {
    const env = makeParallelEnv({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "pg", type: "parallelGateway" },
        { id: "a", type: "endEvent" },
        { id: "b", type: "endEvent" },
        { id: "c", type: "endEvent" },
      ],
      edges: [
        { id: "e0", source: "s", target: "pg" },
        { id: "e1", source: "pg", target: "a" },
        { id: "e2", source: "pg", target: "b" },
        { id: "e3", source: "pg", target: "c" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    const out = await service.startInstance({ processId: "p", tenantId: "t", userId: "u" });

    const childInserts = env.inserts.filter((i) => i.table === "INSTANCE_TOKENS").slice(1);
    expect(childInserts.length).toBe(3);
    const forkIds = childInserts.map((i) => i.values[0].forkId);
    expect(new Set(forkIds).size).toBe(1);
    expect(out.status).toBe("completed");
  });

  it("instance stays running when one branch suspends on a userTask", async () => {
    const env = makeParallelEnv({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "pg", type: "parallelGateway" },
        { id: "t", type: "userTask", data: { assignment: { type: "directUser", value: UUID_A } } },
        { id: "e", type: "endEvent" },
      ],
      edges: [
        { id: "e0", source: "s", target: "pg" },
        { id: "e1", source: "pg", target: "t" },
        { id: "e2", source: "pg", target: "e" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    const out = await service.startInstance({ processId: "p", tenantId: "t", userId: "u" });

    // The userTask child is waiting → instance stays running, NOT
    // completed.
    expect(out.status).toBe("running");
    expect(env.updates.some((u) => u.table === "PROCESS_INSTANCES" && u.set.status === "completed")).toBe(false);
    // Two children inserted.
    const childInserts = env.inserts.filter((i) => i.table === "INSTANCE_TOKENS").slice(1);
    expect(childInserts.length).toBe(2);
  });

  it("1-out parallel gateway is a degenerate pass-through (no children spawned, no fork)", async () => {
    const env = makeParallelEnv({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "pg", type: "parallelGateway" },
        { id: "e", type: "endEvent" },
      ],
      edges: [
        { id: "e0", source: "s", target: "pg" },
        { id: "e1", source: "pg", target: "e" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    const out = await service.startInstance({ processId: "p", tenantId: "t", userId: "u" });

    // No child tokens — pass-through.
    const tokenInserts = env.inserts.filter((i) => i.table === "INSTANCE_TOKENS");
    expect(tokenInserts.length).toBe(1); // only the root token
    expect(out.status).toBe("completed");
  });

  it("0-out parallel gateway fails the instance with a structural error", async () => {
    const env = makeParallelEnv({
      nodes: [
        { id: "s", type: "startEvent" },
        { id: "pg", type: "parallelGateway" },
      ],
      edges: [{ id: "e0", source: "s", target: "pg" }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new EngineService(env.db as any, makeFakeWorker() as any);
    const out = await service.startInstance({ processId: "p", tenantId: "t", userId: "u" });
    expect(out.status).toBe("failed");
    const instUpdate = env.updates.find((u) => u.table === "PROCESS_INSTANCES" && u.set.status === "failed");
    expect(instUpdate?.set.errorMessage).toMatch(/parallel/i);
  });
});
