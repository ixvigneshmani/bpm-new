/* ─── ServiceTaskRegistry + built-in handlers tests ─────────────────
 * Pure unit tests; no DB / worker fakes needed because the registry
 * is a Map wrapper and handlers are pure functions over their input.
 * ──────────────────────────────────────────────────────────────────── */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPrivateIp,
  logHandler,
  noopHandler,
  restHandler,
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

/* ─── restHandler (I2) tests ──────────────────────────────────────────
 * The handler hits `fetch` directly, so we stub the global between
 * tests. No real network. Each test asserts on either the request
 * shape (URL, headers, body, method) we passed to fetch, or on the
 * return value the engine would merge into instance variables.
 * ──────────────────────────────────────────────────────────────────── */

const restInput = (
  overrides: { config?: Record<string, unknown>; variables?: Record<string, unknown> } = {},
): ServiceTaskInput => baseInput({
  nodeData: { implementation: { type: "rest", config: overrides.config ?? {} } },
  variables: overrides.variables ?? {},
});

const fakeOk = (body: unknown, status = 200, contentType = "application/json"): Response => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": contentType } });
};
const fakeErr = (status: number, body = ""): Response =>
  new Response(body, { status, headers: { "content-type": "text/plain" } });

describe("restHandler (I2)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let prevAllow: string | undefined;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Bypass SSRF DNS resolution for the existing fixture URLs
    // (api.example.com is reserved per RFC 2606 and may not resolve
    // in CI). Dedicated SSRF tests below override this per-test.
    prevAllow = process.env.REST_ALLOW_PRIVATE_HOSTS;
    process.env.REST_ALLOW_PRIVATE_HOSTS = "1";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (prevAllow === undefined) delete process.env.REST_ALLOW_PRIVATE_HOSTS;
    else process.env.REST_ALLOW_PRIVATE_HOSTS = prevAllow;
  });

  it("rejects when implementation.type isn't rest", async () => {
    await expect(
      restHandler(baseInput({ nodeData: {} })),
    ).rejects.toThrow(/implementation must be/);
  });

  it("rejects when url is missing", async () => {
    await expect(
      restHandler(restInput({ config: { method: "GET" } })),
    ).rejects.toThrow(/url is required/);
  });

  it("rejects unsupported HTTP method", async () => {
    await expect(
      restHandler(restInput({ config: { method: "TRACE", url: "https://example.com/" } })),
    ).rejects.toThrow(/unsupported HTTP method/);
  });

  it("rejects malformed URL after interpolation", async () => {
    await expect(
      restHandler(restInput({
        config: { method: "GET", url: "not-a-url" },
      })),
    ).rejects.toThrow(/invalid URL/);
  });

  it("performs a GET and returns the JSON body merged into variables", async () => {
    fetchMock.mockResolvedValue(fakeOk({ orderId: "o-9", total: 42 }));
    const out = await restHandler(restInput({
      config: { method: "GET", url: "https://api.example.com/orders/9" },
    }));
    expect(out).toEqual({ orderId: "o-9", total: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://api.example.com/orders/9");
    expect(init.method).toBe("GET");
  });

  it("interpolates ${var} in URL, headers, query params, and body", async () => {
    fetchMock.mockResolvedValue(fakeOk({}));
    await restHandler(restInput({
      config: {
        method: "POST",
        url: "https://api.example.com/o/${order.id}",
        headers: [{ key: "X-Tenant", value: "${tenant}" }],
        queryParams: [{ key: "env", value: "${env}" }],
        body: '{"customer":"${customer}"}',
      },
      variables: {
        order: { id: "ABC" },
        tenant: "acme",
        env: "prod",
        customer: "Alice",
      },
    }));
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://api.example.com/o/ABC?env=prod");
    expect(init.headers["X-Tenant"]).toBe("acme");
    // Default Content-Type when body is set and user didn't override.
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"customer":"Alice"}');
  });

  it("missing variables collapse to empty string (no throw)", async () => {
    fetchMock.mockResolvedValue(fakeOk({}));
    await restHandler(restInput({
      config: {
        method: "GET",
        url: "https://api.example.com/x?missing=${nope}",
      },
    }));
    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://api.example.com/x?missing=");
  });

  it("bearer auth adds Authorization: Bearer header", async () => {
    fetchMock.mockResolvedValue(fakeOk({}));
    await restHandler(restInput({
      config: {
        method: "GET",
        url: "https://api.example.com/",
        auth: { type: "bearer", token: "${apiToken}" },
      },
      variables: { apiToken: "secret-123" },
    }));
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer secret-123");
  });

  it("basic auth base64-encodes user:pass", async () => {
    fetchMock.mockResolvedValue(fakeOk({}));
    await restHandler(restInput({
      config: {
        method: "GET",
        url: "https://api.example.com/",
        auth: { type: "basic", username: "alice", password: "p@ss" },
      },
    }));
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Authorization"]).toBe(
      `Basic ${Buffer.from("alice:p@ss").toString("base64")}`,
    );
  });

  it("apiKey auth puts the value under the configured headerName", async () => {
    fetchMock.mockResolvedValue(fakeOk({}));
    await restHandler(restInput({
      config: {
        method: "GET",
        url: "https://api.example.com/",
        auth: { type: "apiKey", headerName: "X-API-Key", value: "k-77" },
      },
    }));
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-API-Key"]).toBe("k-77");
  });

  it("oauth2 + credentialRef are explicitly rejected (not silent no-auth)", async () => {
    for (const auth of [{ type: "oauth2" }, { type: "credentialRef", refId: "r1" }]) {
      await expect(
        restHandler(restInput({
          config: {
            method: "GET",
            url: "https://api.example.com/",
            auth,
          },
        })),
      ).rejects.toThrow(/not supported/);
    }
  });

  it("4xx response throws a clear error so the worker retries", async () => {
    fetchMock.mockResolvedValue(fakeErr(404, "Not Found"));
    await expect(
      restHandler(restInput({
        config: { method: "GET", url: "https://api.example.com/missing" },
      })),
    ).rejects.toThrow(/returned 404[^]*Not Found/);
  });

  it("network error before response throws a clear error", async () => {
    fetchMock.mockRejectedValue(new Error("ENOTFOUND example.invalid"));
    await expect(
      restHandler(restInput({
        config: { method: "GET", url: "https://example.invalid/notify" },
      })),
    ).rejects.toThrow(/failed before response[^]*ENOTFOUND/);
  });

  it("non-object 2xx body wraps under responseStatus / responseBody", async () => {
    fetchMock.mockResolvedValue(fakeOk("plain text", 200, "text/plain"));
    const out = await restHandler(restInput({
      config: { method: "GET", url: "https://api.example.com/" },
    }));
    expect(out).toEqual({ responseStatus: 200, responseBody: "plain text" });
  });

  it("array 2xx body also wraps (avoids trampling variables)", async () => {
    fetchMock.mockResolvedValue(fakeOk([1, 2, 3]));
    const out = await restHandler(restInput({
      config: { method: "GET", url: "https://api.example.com/" },
    }));
    expect(out).toEqual({ responseStatus: 200, responseBody: [1, 2, 3] });
  });

  it("does NOT add a default Content-Type when the user supplied one", async () => {
    fetchMock.mockResolvedValue(fakeOk({}));
    await restHandler(restInput({
      config: {
        method: "POST",
        url: "https://api.example.com/",
        headers: [{ key: "Content-Type", value: "application/xml" }],
        body: "<order/>",
      },
    }));
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/xml");
  });
});

describe("restHandler SSRF guard (BUG-D2-01)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let prevAllow: string | undefined;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // SSRF guard is ON for these tests.
    prevAllow = process.env.REST_ALLOW_PRIVATE_HOSTS;
    delete process.env.REST_ALLOW_PRIVATE_HOSTS;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (prevAllow === undefined) delete process.env.REST_ALLOW_PRIVATE_HOSTS;
    else process.env.REST_ALLOW_PRIVATE_HOSTS = prevAllow;
  });

  function restInput(impl: { config: Record<string, unknown> }): ServiceTaskInput {
    return baseInput({
      nodeData: { implementation: { type: "rest", ...impl } },
    });
  }

  it("isPrivateIp classifies common ranges", () => {
    // Cloud metadata
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    // RFC 1918
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("172.16.5.4")).toBe(true);
    expect(isPrivateIp("172.31.255.254")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    // Loopback
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    // Unspecified
    expect(isPrivateIp("0.0.0.0")).toBe(true);
    // Multicast
    expect(isPrivateIp("224.0.0.1")).toBe(true);
    // IPv6 loopback / link-local / ULA
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    // IPv4-mapped IPv6 of a private v4
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
    // Public — should NOT be classified private
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    // 172.32 is OUTSIDE the 172.16/12 RFC 1918 range
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });

  it("rejects non-http schemes", async () => {
    await expect(
      restHandler(restInput({
        config: { method: "GET", url: "file:///etc/passwd" },
      })),
    ).rejects.toThrow(/scheme.*not allowed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects literal cloud-metadata IP in URL", async () => {
    await expect(
      restHandler(restInput({
        config: { method: "GET", url: "http://169.254.169.254/latest/meta-data/" },
      })),
    ).rejects.toThrow(/private \/ loopback \/ link-local \/ multicast/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects literal loopback IP in URL", async () => {
    await expect(
      restHandler(restInput({
        config: { method: "GET", url: "http://127.0.0.1:3001/api/admin" },
      })),
    ).rejects.toThrow(/private \/ loopback/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects literal RFC 1918 IP in URL", async () => {
    await expect(
      restHandler(restInput({
        config: { method: "GET", url: "http://10.0.0.5/" },
      })),
    ).rejects.toThrow(/private \/ loopback/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects literal IPv6 loopback", async () => {
    await expect(
      restHandler(restInput({
        config: { method: "GET", url: "http://[::1]/" },
      })),
    ).rejects.toThrow(/private \/ loopback/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects URL whose hostname resolves to a private IP (RFC 6761 .test TLD never resolves to public IP)", async () => {
    // .test is reserved per RFC 6761; OS resolvers either return
    // NXDOMAIN or a configured stub. Either way it'll never be public.
    await expect(
      restHandler(restInput({
        config: { method: "GET", url: "http://internal.test/" },
      })),
    ).rejects.toThrow(/DNS lookup|private \/ loopback/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("REST_ALLOW_PRIVATE_HOSTS=1 bypasses the guard", async () => {
    process.env.REST_ALLOW_PRIVATE_HOSTS = "1";
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    } as Response);
    await expect(
      restHandler(restInput({
        config: { method: "GET", url: "http://127.0.0.1:3001/health" },
      })),
    ).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
