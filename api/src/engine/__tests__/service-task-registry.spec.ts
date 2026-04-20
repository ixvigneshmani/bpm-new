/* ─── ServiceTaskRegistry + built-in handlers tests ─────────────────
 * Pure unit tests; no DB / worker fakes needed because the registry
 * is a Map wrapper and handlers are pure functions over their input.
 * ──────────────────────────────────────────────────────────────────── */

import { describe, expect, it, vi } from "vitest";
import {
  logHandler,
  noopHandler,
  ServiceTaskRegistry,
  setVariableHandler,
  type ServiceTaskHandler,
  type ServiceTaskInput,
} from "../service-task-registry";

const baseInput = (overrides: Partial<ServiceTaskInput> = {}): ServiceTaskInput => ({
  tenantId: "t1",
  instanceId: "inst-1",
  tokenId: "tok-1",
  variables: {},
  nodeData: {},
  ...overrides,
});

describe("ServiceTaskRegistry", () => {
  it("register + get round-trip", () => {
    const reg = new ServiceTaskRegistry();
    const handler: ServiceTaskHandler = vi.fn(async () => ({ ok: true }));
    reg.register("send-email", handler);
    expect(reg.get("send-email")).toBe(handler);
  });

  it("unregistered topic returns undefined", () => {
    const reg = new ServiceTaskRegistry();
    expect(reg.get("nope")).toBeUndefined();
  });

  it("re-registering an existing topic keeps the first handler (first-wins)", () => {
    const reg = new ServiceTaskRegistry();
    const first = vi.fn();
    const second = vi.fn();
    reg.register("topic-x", first);
    reg.register("topic-x", second);
    expect(reg.get("topic-x")).toBe(first);
  });

  it("list() reports all registered topics", () => {
    const reg = new ServiceTaskRegistry();
    reg.register("a", vi.fn());
    reg.register("b", vi.fn());
    expect(reg.list().sort()).toEqual(["a", "b"]);
  });
});

describe("Built-in service-task handlers", () => {
  it("noopHandler returns an empty object", async () => {
    const out = await noopHandler(baseInput());
    expect(out).toEqual({});
  });

  it("logHandler returns an empty object (logs as side effect)", async () => {
    const out = await logHandler(
      baseInput({ variables: { customer: "Alice" } }),
    );
    expect(out).toEqual({});
  });

  it("setVariableHandler emits {<key>: <value>} from nodeData.input", async () => {
    const out = await setVariableHandler(
      baseInput({
        nodeData: { input: { key: "stage", value: "approved" } },
      }),
    );
    expect(out).toEqual({ stage: "approved" });
  });

  it("setVariableHandler null value still writes the key", async () => {
    const out = await setVariableHandler(
      baseInput({ nodeData: { input: { key: "cleared" } } }),
    );
    expect(out).toEqual({ cleared: null });
  });

  it("setVariableHandler throws when key is missing", async () => {
    await expect(
      setVariableHandler(baseInput({ nodeData: { input: { value: 1 } } })),
    ).rejects.toThrow(/key.*required/);
  });

  it("setVariableHandler rejects prototype-pollution-shaped keys", async () => {
    for (const bad of ["__proto__", "constructor", "1leadingDigit", "with space", "with;punct"]) {
      await expect(
        setVariableHandler(
          baseInput({ nodeData: { input: { key: bad, value: "x" } } }),
        ),
      ).rejects.toThrow(/must match/);
    }
  });

  it("setVariableHandler accepts standard variable names", async () => {
    for (const ok of ["amount", "approval_status", "form.email", "x-y-z", "_private"]) {
      const out = await setVariableHandler(
        baseInput({ nodeData: { input: { key: ok, value: 1 } } }),
      );
      expect(out).toEqual({ [ok]: 1 });
    }
  });
});
