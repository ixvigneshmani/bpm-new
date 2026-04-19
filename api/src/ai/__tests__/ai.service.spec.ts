/* ─── AI Service defensive layer ────────────────────────────────────
 * The outbound Anthropic call is mocked out — these tests cover the
 * pure logic the service owns: input guards, error mapping, default
 * backfill, rate limiting, and the sanitize pipeline that defends
 * the canvas from malformed model output.
 * ──────────────────────────────────────────────────────────────────── */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { AiService, type ScaffoldResult } from "../ai.service";

function makeService(opts: { apiKey?: string | null } = {}): AiService {
  // Distinguishing "not set" from "set to empty string": the explicit-
  // null branch lets tests force the disabled path regardless of the
  // default-arg fallthrough.
  const apiKey = "apiKey" in opts ? opts.apiKey : "test-key";
  const config = {
    get: vi.fn((key: string) => (key === "ANTHROPIC_API_KEY" ? apiKey : undefined)),
  } as unknown as ConfigService;
  return new AiService(config);
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
});
