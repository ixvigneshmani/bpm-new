/* ─── REST Connector ────────────────────────────────────────────────
 * I4 Sprint 3. Second concrete connector. REST stands apart from
 * Mail / Slack / Salesforce because it has no per-vendor identity —
 * it's the generic HTTP escape hatch. Per the Q2 decision, REST
 * supports OPTIONAL connections holding:
 *
 *   • baseUrl              — when set, task `url` may be relative
 *                            and gets joined to baseUrl
 *   • auth                 — bearer / basic / apiKey reused across
 *                            every task that picks this connection;
 *                            per-task auth overrides on conflict
 *   • defaultHeaders[]     — KV pairs merged into every request
 *                            (per-task headers win on key clash)
 *   • defaultQueryParams[] — same, for query string
 *
 * The connector is `connectionRequired: false` — tasks may also run
 * without picking a connection at all, in which case behaviour matches
 * today's I2 standalone REST handler exactly.
 *
 * Migration story: existing canvases with `implementation.type === "rest"`
 * are routed by the engine to the connector dispatcher, which
 * synthesises a `{ connector: "rest", operation: "request", input:
 * <existing config> }` shape on the fly. No canvas rewriting.
 *
 * Why merge per-task over connection (not the other way): a task-level
 * override is the operator's explicit "for this call, use X instead."
 * Reversing it would mean a connection-level default could not be
 * overridden without removing it from the connection — making
 * connection updates dangerous.
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  assertSsrfSafe,
} from "../../engine/service-task-registry";
import {
  ConnectorRegistry,
  type ConnectorDefinition,
  type ConnectorInvocationContext,
} from "../connector-registry";

const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const RESPONSE_BODY_LIMIT = 500;

type KV = { key: string; value: string };

type RestAuth =
  | { type: "none" }
  | { type: "bearer"; token?: string }
  | { type: "basic"; username?: string; password?: string }
  | { type: "apiKey"; headerName?: string; value?: string };

type RestConnectionConfig = {
  baseUrl?: string;
  defaultHeaders?: KV[];
  defaultQueryParams?: KV[];
  // Flat auth fields — matches what's stored under `config` in
  // CONNECTOR_INSTANCES (the connection schema declares them at the
  // top level so the schema-driven form can render each one). First
  // non-empty triple wins inside applyAuth.
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  apiKeyHeader?: string;
  apiKeyValue?: string;
};

type RestOperationInput = {
  method?: string;
  url?: string;
  headers?: KV[];
  queryParams?: KV[];
  body?: string;
  auth?: RestAuth;
};

@Injectable()
export class RestConnector implements OnModuleInit {
  constructor(private readonly registry: ConnectorRegistry) {}

  onModuleInit(): void {
    this.registry.register(this.definition);
  }

  private get definition(): ConnectorDefinition {
    return {
      id: "rest",
      name: "HTTP / REST",
      description:
        "Call any HTTP endpoint. Tasks can run standalone (URL + auth on the task) or share a connection that holds the base URL, reusable auth, and default headers across many tasks.",
      // All optional. A REST task with no connection works fine.
      connectionSchema: {
        baseUrl: {
          type: "url",
          placeholder: "https://api.example.com",
          description:
            "Prepended to task URLs that aren't absolute. Leave blank to require every task to carry a full URL.",
        },
        // Auth fields are flat for v1 — the form renders one option
        // per shape. A "kind" enum + conditional rendering would be a
        // v2 polish; today an admin picks one of bearerToken / basic /
        // apiKey and fills its fields. Server-side, the first non-
        // empty triple wins.
        bearerToken: {
          type: "string",
          secret: true,
          description:
            "Bearer token reused across all tasks using this connection. Sent as `Authorization: Bearer <token>`.",
          maxLength: 4096,
        },
        basicUsername: {
          type: "string",
          description:
            "Basic-auth username paired with basicPassword. Sent as `Authorization: Basic <base64>`.",
          maxLength: 255,
        },
        basicPassword: {
          type: "string",
          secret: true,
          description: "Basic-auth password.",
          maxLength: 255,
        },
        apiKeyHeader: {
          type: "string",
          placeholder: "X-API-Key",
          description:
            "Custom header name to carry the API key (paired with apiKeyValue).",
          maxLength: 255,
        },
        apiKeyValue: {
          type: "string",
          secret: true,
          description: "API key value.",
          maxLength: 4096,
        },
      },
      secretFields: ["bearerToken", "basicPassword", "apiKeyValue"],
      connectionRequired: false,
      operations: [
        {
          id: "request",
          name: "HTTP request",
          description:
            "Send an HTTP request. URL may be relative if the connection provides a baseUrl. Body is sent as JSON by default unless a Content-Type header is set explicitly.",
          inputSchema: {
            method: {
              type: "enum",
              required: true,
              options: ["GET", "POST", "PUT", "PATCH", "DELETE"],
              default: "GET",
              description: "HTTP method.",
            },
            url: {
              type: "string",
              required: true,
              placeholder: "/users/${user.id}  or  https://api.example.com/users/${user.id}",
              description:
                "Endpoint URL. Supports `${var}` interpolation. Relative if a connection's baseUrl is set.",
            },
            body: {
              type: "string",
              description:
                "Request body (POST/PUT/PATCH). Free-form string with `${var}` interpolation; JSON sent as Content-Type: application/json unless an explicit Content-Type header overrides.",
            },
          },
          outputKeys: ["responseStatus", "responseBody"],
          handler: async (ctx, conn, input) => {
            return executeRestRequest(
              ctx,
              conn as RestConnectionConfig,
              input as RestOperationInput,
            );
          },
        },
      ],
    };
  }
}

/** Core HTTP execution shared between the operation handler and the
 *  legacy `type=rest` shim path. Variable interpolation already
 *  happened in the dispatcher (interpolateDeep on the input), so this
 *  function only handles connection merging + SSRF + the fetch call. */
async function executeRestRequest(
  _ctx: ConnectorInvocationContext,
  conn: RestConnectionConfig | null | undefined,
  input: RestOperationInput,
): Promise<Record<string, unknown>> {
  const method = String(input.method ?? "GET").toUpperCase();
  if (!VALID_METHODS.has(method)) {
    throw new Error(`rest: unsupported HTTP method "${method}".`);
  }

  // URL: resolve relative against baseUrl (if any), then SSRF check.
  let rawUrl = typeof input.url === "string" ? input.url.trim() : "";
  if (!rawUrl) throw new Error("rest: input.url is required.");
  if (!/^https?:\/\//i.test(rawUrl)) {
    const base = conn?.baseUrl?.trim();
    if (!base) {
      throw new Error(
        `rest: URL "${rawUrl}" is relative but the connection has no baseUrl. Use an absolute URL or pick a connection with baseUrl.`,
      );
    }
    rawUrl = base.replace(/\/+$/, "") + "/" + rawUrl.replace(/^\/+/, "");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (e) {
    throw new Error(`rest: invalid URL "${rawUrl}": ${(e as Error).message}`);
  }
  await assertSsrfSafe(parsedUrl);

  // Query params: connection defaults first, then per-task wins on
  // duplicate keys. URLSearchParams.append doesn't dedupe, so collect
  // into a Map first.
  const qpMap = new Map<string, string>();
  for (const kv of conn?.defaultQueryParams ?? []) {
    if (kv?.key) qpMap.set(kv.key, String(kv.value ?? ""));
  }
  for (const kv of input.queryParams ?? []) {
    if (kv?.key) qpMap.set(kv.key, String(kv.value ?? ""));
  }
  if (qpMap.size > 0) {
    const u = new URL(rawUrl);
    for (const [k, v] of qpMap) u.searchParams.append(k, v);
    rawUrl = u.toString();
  }

  // Headers: connection defaults first, per-task overrides next, auth
  // last (auth headers can be overridden by a per-task explicit header
  // — operator's "for this call, use Y" wins).
  const headers: Record<string, string> = {};
  for (const kv of conn?.defaultHeaders ?? []) {
    if (kv?.key) headers[kv.key] = String(kv.value ?? "");
  }
  for (const kv of input.headers ?? []) {
    if (kv?.key) headers[kv.key] = String(kv.value ?? "");
  }

  applyAuth(headers, input.auth, conn);

  let body: string | undefined;
  if (BODY_METHODS.has(method) && typeof input.body === "string" && input.body !== "") {
    body = input.body;
    const hasCT = Object.keys(headers).some((h) => h.toLowerCase() === "content-type");
    if (!hasCT) headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(rawUrl, { method, headers, body });
  } catch (e) {
    throw new Error(
      `rest: ${method} ${rawUrl} failed before response: ${(e as Error).message}`,
    );
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON
    }
  }

  if (!res.ok) {
    const truncated =
      text.length > RESPONSE_BODY_LIMIT
        ? `${text.slice(0, RESPONSE_BODY_LIMIT)}… (truncated)`
        : text;
    throw new Error(
      `rest: ${method} ${rawUrl} returned ${res.status} ${res.statusText}: ${truncated || "<empty body>"}`,
    );
  }

  if (
    parsed !== undefined &&
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed)
  ) {
    return parsed as Record<string, unknown>;
  }
  return {
    responseStatus: res.status,
    responseBody: parsed === undefined ? text : parsed,
  };
}

/** Auth resolution order: per-task `input.auth` wins if its first
 *  meaningful field is set; otherwise fall back to the connection's
 *  flat bearer/basic/apiKey fields (first non-empty wins).
 *
 *  oauth2 / credentialRef remain rejected with a clear error so
 *  callers see what's missing rather than silently sending an
 *  unauthenticated request. */
function applyAuth(
  headers: Record<string, string>,
  taskAuth: RestAuth | undefined,
  conn: RestConnectionConfig | null | undefined,
): void {
  // Per-task explicit auth wins.
  if (taskAuth && taskAuth.type) {
    switch (taskAuth.type) {
      case "none":
        return;
      case "bearer":
        if (taskAuth.token) headers["Authorization"] = `Bearer ${taskAuth.token}`;
        return;
      case "basic": {
        const u = taskAuth.username ?? "";
        const p = taskAuth.password ?? "";
        if (u || p) {
          headers["Authorization"] = `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
        }
        return;
      }
      case "apiKey":
        if (taskAuth.headerName && taskAuth.value) {
          headers[taskAuth.headerName] = taskAuth.value;
        }
        return;
      default:
        throw new Error(
          `rest: unsupported auth type "${(taskAuth as { type?: string }).type}". Use none/bearer/basic/apiKey, or move auth to the connection.`,
        );
    }
  }
  // Fall back to connection-level auth.
  if (!conn) return;
  if (conn.bearerToken) {
    headers["Authorization"] = `Bearer ${conn.bearerToken}`;
    return;
  }
  if (conn.basicUsername || conn.basicPassword) {
    const u = conn.basicUsername ?? "";
    const p = conn.basicPassword ?? "";
    headers["Authorization"] = `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
    return;
  }
  if (conn.apiKeyHeader && conn.apiKeyValue) {
    headers[conn.apiKeyHeader] = conn.apiKeyValue;
    return;
  }
}

