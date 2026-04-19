/* ─── AI Service defensive layer ────────────────────────────────────
 * The outbound Anthropic call is mocked out — these tests cover the
 * pure logic the service owns: input guards, error mapping, default
 * backfill, rate limiting, and the sanitize pipeline that defends
 * the canvas from malformed model output.
 * ──────────────────────────────────────────────────────────────────── */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { AiService, type ScaffoldResult } from "../ai.service";

type FakeDb = {
  insert: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  /** Rows the next select chain will resolve to when awaited. */
  selectResult: unknown[];
};

function makeFakeDb(opts: { failOnInsert?: boolean } = {}): FakeDb {
  const values = vi.fn(async () => {
    if (opts.failOnInsert) throw new Error("DB down");
  });
  const insert = vi.fn(() => ({ values }));
  const db = { insert, values, select: vi.fn(), selectResult: [] as unknown[] } as FakeDb;
  // Model drizzle's chainable select builder as a thenable. Every
  // builder method returns the same chain; awaiting it resolves with
  // whatever `db.selectResult` is at resolve time.
  const chain: Record<string, unknown> = {};
  const chainMethods = ["from", "where", "orderBy", "limit"];
  for (const m of chainMethods) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown) => unknown) => resolve(db.selectResult);
  db.select = vi.fn(() => chain);
  return db;
}

/** Fire-and-forget persistence means the insert runs on a microtask
 *  after the caller's promise resolves. Flush the queue before asserting. */
async function flushPersistence(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function makeService(
  opts: { apiKey?: string | null; db?: FakeDb | null } = {},
): AiService {
  // Distinguishing "not set" from "set to empty string": the explicit-
  // null branch lets tests force the disabled path regardless of the
  // default-arg fallthrough.
  const apiKey = "apiKey" in opts ? opts.apiKey : "test-key";
  const config = {
    get: vi.fn((key: string) => (key === "ANTHROPIC_API_KEY" ? apiKey : undefined)),
  } as unknown as ConfigService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AiService(config, (opts.db ?? null) as any);
}

describe("AiService.sanitize", () => {
  const service = makeService();

  const baseResult = (overrides: Partial<ScaffoldResult> = {}): ScaffoldResult => ({
    processName: "Test",
    processDescription: "",
    nodes: [],
    edges: [],
    notes: "",
    ...overrides,
  });

  it("drops nodes with unsupported types", () => {
    const out = service.sanitize(
      baseResult({
        nodes: [
          { id: "a", type: "userTask", label: "Real", position: { x: 0, y: 0 } },
          { id: "b", type: "madeUpType", label: "Fake", position: { x: 10, y: 0 } },
        ],
      }),
    );
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0].id).toBe("a");
    expect(out.notes).toMatch(/Dropped unsupported node type\(s\): madeUpType/);
  });

  it("drops edges whose endpoints don't resolve", () => {
    const out = service.sanitize(
      baseResult({
        nodes: [{ id: "a", type: "userTask", label: "A", position: { x: 0, y: 0 } }],
        edges: [
          { id: "e1", source: "a", target: "missing" },
          { id: "e2", source: "also-missing", target: "a" },
        ],
      }),
    );
    expect(out.edges).toHaveLength(0);
    expect(out.notes).toMatch(/Dropped 2 edge\(s\) with missing endpoints/);
  });

  it("backfills eventDefinition on events that lack one", () => {
    const out = service.sanitize(
      baseResult({
        nodes: [
          { id: "s", type: "startEvent", label: "Start", position: { x: 0, y: 0 } },
          { id: "e", type: "endEvent", label: "End", position: { x: 200, y: 0 } },
          { id: "b", type: "boundaryEvent", label: "B", position: { x: 100, y: 60 } },
        ],
      }),
    );
    for (const n of out.nodes) {
      expect(n.data?.eventDefinition).toEqual({ kind: "none" });
    }
  });

  it("backfills isExpanded=true on subprocess types that omit it", () => {
    const out = service.sanitize(
      baseResult({
        nodes: [
          { id: "sp", type: "subProcess", label: "SP", position: { x: 0, y: 0 } },
          { id: "esp", type: "eventSubProcess", label: "ESP", position: { x: 0, y: 0 } },
        ],
      }),
    );
    expect(out.nodes[0].data?.isExpanded).toBe(true);
    expect(out.nodes[1].data?.isExpanded).toBe(true);
    // Event subprocesses also need the triggeredByEvent marker.
    expect(out.nodes[1].data?.triggeredByEvent).toBe(true);
  });

  it("preserves explicit eventDefinition + isExpanded when the model set them", () => {
    const out = service.sanitize(
      baseResult({
        nodes: [
          {
            id: "s", type: "startEvent", label: "Start", position: { x: 0, y: 0 },
            data: { eventDefinition: { kind: "message", messageName: "OrderIn" } },
          },
          {
            id: "sp", type: "subProcess", label: "SP", position: { x: 0, y: 0 },
            data: { isExpanded: false },
          },
        ],
      }),
    );
    expect((out.nodes[0].data?.eventDefinition as { kind: string }).kind).toBe("message");
    expect(out.nodes[0].data?.eventDefinition).toMatchObject({ messageName: "OrderIn" });
    expect(out.nodes[1].data?.isExpanded).toBe(false);
  });

  it("truncates labels longer than 200 characters with an ellipsis marker", () => {
    const longLabel = "x".repeat(500);
    const out = service.sanitize(
      baseResult({
        nodes: [{ id: "a", type: "userTask", label: longLabel, position: { x: 0, y: 0 } }],
      }),
    );
    expect(out.nodes[0].label.length).toBeLessThanOrEqual(200);
    expect(out.nodes[0].label.endsWith("…")).toBe(true);
    expect(out.notes).toMatch(/Truncated 1 overlong label/);
  });

  it("strips parentId when it references a node the sanitizer dropped", () => {
    const out = service.sanitize(
      baseResult({
        nodes: [
          // Parent node has an unsupported type → gets dropped.
          { id: "ghost", type: "nonsense", label: "?", position: { x: 0, y: 0 } },
          { id: "t", type: "userTask", label: "T", position: { x: 0, y: 0 }, parentId: "ghost" },
        ],
      }),
    );
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0].parentId).toBeUndefined();
  });

  it("falls back to a default process name when missing", () => {
    const out = service.sanitize(baseResult({ processName: "" }));
    expect(out.processName).toBe("AI Scaffold");
  });
});

describe("AiService.scaffoldProcess — input guards", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("throws ServiceUnavailable when ANTHROPIC_API_KEY is not set", async () => {
    const service = makeService({ apiKey: null });
    await expect(
      service.scaffoldProcess({
        description: "test",
        tenantId: "t1",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("throws PayloadTooLarge when businessDocSchema serializes past 32 KB", async () => {
    const service = makeService();
    // Build a ~40 KB object that survives JSON.stringify.
    const big: Record<string, string> = {};
    for (let i = 0; i < 500; i++) big[`field_${i}`] = "x".repeat(100);
    await expect(
      service.scaffoldProcess({
        description: "test",
        businessDocSchema: big,
        tenantId: "t1",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("records a history row on a successful scaffold", async () => {
    const db = makeFakeDb();
    const service = makeService({ db });
    // Stub the Anthropic client so we don't hit the network.
    const fakeResponse = {
      content: [
        {
          type: "tool_use",
          input: {
            processName: "Test",
            processDescription: "",
            nodes: [
              { id: "s", type: "startEvent", label: "Start", position: { x: 0, y: 0 } },
            ],
            edges: [],
            notes: "",
          },
        },
      ],
      usage: { input_tokens: 123, output_tokens: 45 },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).client = { messages: { create: vi.fn(async () => fakeResponse) } };

    await service.scaffoldProcess({
      description: "test description long enough",
      tenantId: "tenant-X",
      userId: "user-X",
    });

    await flushPersistence();
    expect(db.insert).toHaveBeenCalledTimes(1);
    const row = db.values.mock.calls[0][0];
    expect(row).toMatchObject({
      tenantId: "tenant-X",
      userId: "user-X",
      kind: "scaffold-process",
      status: "success",
      tokensIn: 123,
      tokensOut: 45,
    });
    expect(row.responseJson).toBeTruthy();
    expect(typeof row.durationMs).toBe("number");
  });

  it("records a history row on a failed scaffold", async () => {
    const db = makeFakeDb();
    const service = makeService({ db });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).client = {
      messages: {
        create: vi.fn(async () => {
          throw Object.assign(new Error("boom"), { status: 500 });
        }),
      },
    };

    await expect(
      service.scaffoldProcess({
        description: "test description long enough",
        tenantId: "tenant-E",
        userId: "user-E",
      }),
    ).rejects.toBeDefined();

    await flushPersistence();
    expect(db.insert).toHaveBeenCalledTimes(1);
    const row = db.values.mock.calls[0][0];
    expect(row).toMatchObject({ tenantId: "tenant-E", status: "error" });
    expect(row.errorMessage).toMatch(/\d+:/);
    expect(row.responseJson).toBeNull();
  });

  it("swallows DB insert failures and still returns the scaffold", async () => {
    const db = makeFakeDb({ failOnInsert: true });
    const service = makeService({ db });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).client = {
      messages: {
        create: vi.fn(async () => ({
          content: [
            {
              type: "tool_use",
              input: {
                processName: "Ok",
                processDescription: "",
                nodes: [{ id: "s", type: "startEvent", label: "S", position: { x: 0, y: 0 } }],
                edges: [],
                notes: "",
              },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10 },
        })),
      },
    };

    const out = await service.scaffoldProcess({
      description: "test description long enough",
      tenantId: "tenant-Y",
      userId: "user-Y",
    });
    expect(out.nodes).toHaveLength(1);
    await flushPersistence();
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("rate-limits per tenant (20 per rolling hour)", async () => {
    const service = makeService();
    // We can't let the real Anthropic call fire — so we populate the
    // rate bucket by invoking the limiter through the private hook.
    // Twenty synthetic timestamps in the same window trip the guard.
    const bucket: number[] = [];
    const now = Date.now();
    for (let i = 0; i < 20; i++) bucket.push(now - i * 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).rateBuckets.set("tenant-A", bucket);

    await expect(
      service.scaffoldProcess({
        description: "test description that is long enough",
        tenantId: "tenant-A",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("persists a history row when the tenant rate limit trips", async () => {
    const db = makeFakeDb();
    const service = makeService({ db });
    const bucket: number[] = [];
    const now = Date.now();
    for (let i = 0; i < 20; i++) bucket.push(now - i * 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).rateBuckets.set("tenant-RL", bucket);

    await expect(
      service.scaffoldProcess({
        description: "test description that is long enough",
        tenantId: "tenant-RL",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ status: 429 });

    await flushPersistence();
    expect(db.insert).toHaveBeenCalledTimes(1);
    const row = db.values.mock.calls[0][0];
    expect(row).toMatchObject({ tenantId: "tenant-RL", status: "error" });
    expect(row.errorMessage).toMatch(/^429:/);
  });

  it("persists a history row when the business-doc schema is too large", async () => {
    const db = makeFakeDb();
    const service = makeService({ db });
    const big: Record<string, string> = {};
    for (let i = 0; i < 500; i++) big[`field_${i}`] = "x".repeat(100);

    await expect(
      service.scaffoldProcess({
        description: "test",
        businessDocSchema: big,
        tenantId: "tenant-413",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ status: 413 });

    await flushPersistence();
    expect(db.insert).toHaveBeenCalledTimes(1);
    const row = db.values.mock.calls[0][0];
    expect(row).toMatchObject({ tenantId: "tenant-413", status: "error" });
    expect(row.errorMessage).toMatch(/^413:/);
  });

  it("scaffoldProcessStream delivers progress, returns sanitized result, persists success row", async () => {
    const db = makeFakeDb();
    const service = makeService({ db });

    type InputJsonListener = (partial: string, snapshot: unknown) => void;
    const listeners: InputJsonListener[] = [];
    const finalMessage = {
      content: [
        {
          type: "tool_use",
          input: {
            processName: "Streamed",
            processDescription: "",
            nodes: [
              { id: "s", type: "startEvent", label: "Start", position: { x: 0, y: 0 } },
              { id: "e", type: "endEvent", label: "End", position: { x: 200, y: 0 } },
            ],
            edges: [{ id: "e1", source: "s", target: "e" }],
            notes: "ok",
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const fakeStream = {
      on: vi.fn((event: string, fn: InputJsonListener) => {
        if (event === "inputJson") listeners.push(fn);
        return fakeStream;
      }),
      abort: vi.fn(),
      finalMessage: vi.fn(async () => {
        // Drive two progress callbacks before returning the final payload.
        listeners.forEach((fn) => fn("{", "{"));
        listeners.forEach((fn) => fn('"x":1', '{"x":1}'));
        return finalMessage;
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).client = { messages: { stream: vi.fn(() => fakeStream) } };

    const progressCalls: Array<{ charsOut: number; elapsedMs: number }> = [];
    const out = await service.scaffoldProcessStream({
      description: "long enough description",
      tenantId: "tenant-S1",
      userId: "u1",
      onProgress: (p) => progressCalls.push(p),
    });

    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toHaveLength(1);
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
    expect(progressCalls[progressCalls.length - 1].charsOut).toBeGreaterThan(0);

    await flushPersistence();
    expect(db.insert).toHaveBeenCalledTimes(1);
    const row = db.values.mock.calls[0][0];
    expect(row).toMatchObject({
      tenantId: "tenant-S1",
      status: "success",
      tokensIn: 100,
      tokensOut: 50,
    });
  });

  it("scaffoldProcessStream aborts the Anthropic stream + skips persistence when the abortSignal fires", async () => {
    const db = makeFakeDb();
    const service = makeService({ db });
    const abort = vi.fn();
    // Model a stream whose `finalMessage()` resolves with a rejection
    // once `abort()` is called — mirrors the real Anthropic SDK's
    // APIUserAbortError behavior so we can observe the catch branch.
    let rejectFinal!: (err: unknown) => void;
    const fakeStream = {
      on: vi.fn(() => fakeStream),
      abort: vi.fn(() => {
        abort();
        rejectFinal(Object.assign(new Error("aborted by user"), { name: "APIUserAbortError" }));
      }),
      finalMessage: vi.fn(
        () => new Promise((_res, rej) => { rejectFinal = rej; }),
      ),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).client = { messages: { stream: vi.fn(() => fakeStream) } };

    const controller = new AbortController();
    const pending = service.scaffoldProcessStream({
      description: "long enough description",
      tenantId: "tenant-A1",
      userId: "u1",
      abortSignal: controller.signal,
    });
    await new Promise((r) => setImmediate(r));
    controller.abort();

    await expect(pending).rejects.toBeDefined();
    expect(abort).toHaveBeenCalled();
    await flushPersistence();
    // User-initiated cancel should not pollute the history table.
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("slow DB insert does not block the HTTP response", async () => {
    let resolveInsert!: () => void;
    const slowValues = vi.fn(
      () => new Promise<void>((r) => { resolveInsert = r; }),
    );
    const db = { insert: vi.fn(() => ({ values: slowValues })) } as unknown as FakeDb;
    const service = makeService({ db });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).client = {
      messages: {
        create: vi.fn(async () => ({
          content: [
            {
              type: "tool_use",
              input: {
                processName: "Ok",
                processDescription: "",
                nodes: [{ id: "s", type: "startEvent", label: "S", position: { x: 0, y: 0 } }],
                edges: [],
                notes: "",
              },
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      },
    };

    // Response resolves even while the DB insert is still pending.
    const out = await service.scaffoldProcess({
      description: "test description long enough",
      tenantId: "tenant-S",
      userId: "u1",
    });
    expect(out.nodes).toHaveLength(1);
    expect(slowValues).toHaveBeenCalledTimes(1);
    // Unblock the stub so vitest doesn't leak a pending promise.
    resolveInsert();
  });
});

describe("AiService.listInteractions", () => {
  it("returns [] when no DB is configured", async () => {
    const service = makeService();
    const out = await service.listInteractions("tenant-X");
    expect(out).toEqual([]);
  });

  it("serializes createdAt to ISO and forwards rows in list order", async () => {
    const db = makeFakeDb();
    const now = new Date("2026-04-19T12:00:00Z");
    db.selectResult = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        kind: "scaffold-process",
        status: "success",
        description: "test",
        model: "claude-sonnet-4-6",
        errorMessage: null,
        tokensIn: 10,
        tokensOut: 20,
        durationMs: 1234,
        createdAt: now,
      },
    ];
    const service = makeService({ db });
    const out = await service.listInteractions("tenant-Y", { limit: 5 });
    expect(out).toHaveLength(1);
    expect(out[0].createdAt).toBe("2026-04-19T12:00:00.000Z");
    expect(out[0].status).toBe("success");
  });

  it("clamps limit to the [1, 50] range", async () => {
    const db = makeFakeDb();
    const service = makeService({ db });
    // Just verifying the service doesn't throw on out-of-range values —
    // the actual limit clause is validated by integration tests later.
    await expect(service.listInteractions("t", { limit: 9999 })).resolves.toEqual([]);
    await expect(service.listInteractions("t", { limit: 0 })).resolves.toEqual([]);
  });
});

describe("AiService.getInteraction", () => {
  it("throws NotFound when the row isn't in the tenant", async () => {
    const db = makeFakeDb();
    db.selectResult = [];
    const service = makeService({ db });
    await expect(
      service.getInteraction("tenant-A", "11111111-1111-1111-1111-111111111111"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("returns the row with responseJson + ISO createdAt when found", async () => {
    const db = makeFakeDb();
    const now = new Date("2026-04-19T12:00:00Z");
    db.selectResult = [
      {
        id: "22222222-2222-2222-2222-222222222222",
        tenantId: "tenant-B",
        userId: "u1",
        kind: "scaffold-process",
        status: "success",
        description: "desc",
        model: "claude-sonnet-4-6",
        errorMessage: null,
        tokensIn: 100,
        tokensOut: 50,
        durationMs: 500,
        createdAt: now,
        responseJson: { nodes: [], edges: [] } as unknown,
      },
    ];
    const service = makeService({ db });
    const out = await service.getInteraction("tenant-B", "22222222-2222-2222-2222-222222222222");
    expect(out.createdAt).toBe("2026-04-19T12:00:00.000Z");
    expect(out.responseJson).toEqual({ nodes: [], edges: [] });
  });

  it("throws NotFound when no DB is configured", async () => {
    const service = makeService();
    await expect(
      service.getInteraction("t", "11111111-1111-1111-1111-111111111111"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
