/* ─── Service-Task Handler Registry ─────────────────────────────────
 * App-wide map of `topic → handler` for BPMN serviceTask execution.
 * Handlers are registered at boot (via OnModuleInit on a NestJS
 * provider) and live for the process lifetime.
 *
 * Topic resolution: when the engine hits a serviceTask, it reads
 * `node.data.implementation.config.jobType` (for the `externalWorker`
 * strategy) and uses that as the lookup key. Other implementation
 * types (rest, connector, etc.) are deferred to follow-up phases —
 * they can be handled by their own dedicated service that registers a
 * synthetic topic like `__rest__` and inspects node config inside the
 * handler.
 *
 * Built-ins shipped in E5 are intentionally minimal:
 *   • `noop`         — return empty object (used in tests/demos).
 *   • `log`          — log input + return it (debugging).
 *   • `set-variable` — set `<input.key>` to `<input.value>` and return it.
 * Real integrations (HTTP POST, Slack, email, ERP connectors) live in
 * downstream packages that import this module and call `register`.
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, Logger } from "@nestjs/common";

/** The single topic ENGINE_JOBS rows for serviceTasks use. The
 *  per-canvas user topic (`node.data.implementation.config.jobType`)
 *  is carried in the job's `input.userTopic`; the registered
 *  WorkerService handler dispatches by that inner key.
 *
 *  Why one worker topic instead of one-per-user-topic? It lets us
 *  centralise the input-projection + result-merge + onDead callback
 *  in a single ServiceTaskService — handlers stay focused on the
 *  business call. */
export const SERVICE_TASK_TOPIC = "service-task";

/** A service-task handler receives the task input (instance variables
 *  + node-defined static input) and returns a result that the engine
 *  shallow-merges into instance.variables on resume.
 *
 *  Throwing causes the worker to retry with backoff. After max attempts
 *  the job dies and the onDead hook (in ServiceTaskService) marks the
 *  token + instance failed.
 *
 *  Handlers MUST be idempotent: a worker crash mid-execution causes
 *  the job to be reclaimed and re-run; `set-variable` is safe (writing
 *  the same value twice is a no-op), arbitrary HTTP POSTs are not.
 *  Use natural keys + DB upserts on the receiver side. */
export type ServiceTaskHandler = (input: ServiceTaskInput) => Promise<Record<string, unknown>>;

export type ServiceTaskInput = {
  /** Frozen snapshot of instance.variables at the moment the task
   *  was enqueued. Handlers can read but not mutate this. */
  variables: Record<string, unknown>;
  /** Identity of the calling instance/token — useful for logging,
   *  correlation, and (later) writing back to OUTBOX_EVENTS or
   *  emitting custom audit. */
  tenantId: string;
  instanceId: string;
  tokenId: string;
  /** The full `data` object on the BPMN serviceTask node, so handlers
   *  can read static configuration (URL templates, headers,
   *  rate-limit hints, etc.) defined on the canvas. */
  nodeData: Record<string, unknown>;
};

@Injectable()
export class ServiceTaskRegistry {
  private readonly logger = new Logger(ServiceTaskRegistry.name);
  private readonly handlers = new Map<string, ServiceTaskHandler>();

  /** Register a handler. First registration wins (matching WorkerService
   *  behaviour) — duplicate `register("foo")` calls keep the original
   *  and log a warn so the surprise is visible. */
  register(topic: string, handler: ServiceTaskHandler): void {
    if (this.handlers.has(topic)) {
      this.logger.warn(`ServiceTask handler "${topic}" re-registered; ignoring.`);
      return;
    }
    this.handlers.set(topic, handler);
    this.logger.log(`Registered ServiceTask handler: ${topic}`);
  }

  get(topic: string): ServiceTaskHandler | undefined {
    return this.handlers.get(topic);
  }

  /** Diagnostics: list registered topics. Used by the future admin
   *  health endpoint to surface "what handlers does this deployment
   *  know about?". */
  list(): string[] {
    return [...this.handlers.keys()];
  }
}

// ─── Built-in handlers ─────────────────────────────────────────────

/** Returns an empty object. Default fallback for service tasks whose
 *  topic isn't registered or that intentionally do nothing (test/demo). */
export const noopHandler: ServiceTaskHandler = async () => ({});

/** Logs the input + returns it unchanged. Useful for debugging the
 *  variable-flow pipeline without external side effects. Uses
 *  `debug` (not `log`) so production logs aren't flooded by routine
 *  service-task traffic — bump `LOG_LEVEL=debug` to see it. */
export const logHandler: ServiceTaskHandler = async (input) => {
  const logger = new Logger("ServiceTask:log");
  logger.debug?.({
    instanceId: input.instanceId,
    tokenId: input.tokenId,
    variables: input.variables,
    nodeData: input.nodeData,
  });
  return {};
};

/** Identifier-shaped variable name regex. Permissive enough for
 *  typical canvas vocabulary (`approval_status`, `email.subject`)
 *  but rejects strings with leading digits or structural punctuation.
 *  The dot is allowed for readability — variables are flat in the
 *  bag, dots are just label characters here. */
const SAFE_VARIABLE_KEY_RE = /^[A-Za-z_][\w.-]{0,63}$/;
/** Names we never accept regardless of regex shape. `__proto__`
 *  matches the regex above (starts with `_`, all underscores) but
 *  shows up as an own property on the result object — confusing
 *  downstream and an obvious red flag in audit logs. `constructor`
 *  / `prototype` are similar JS-shaped footguns. */
const FORBIDDEN_VARIABLE_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/* ─── REST handler (I2) ───────────────────────────────────────────────
 *
 * Registered under the synthetic topic `__rest__`. Engine maps the
 * service-task's `implementation.type === "rest"` to this topic in
 * `resolveServiceTaskTopic` so the same WorkerService machinery (claim,
 * retry, dead-letter) drives it.
 *
 * Reads `nodeData.implementation.config` (RestConfig from
 * `web/src/types/bpmn-node-data.ts`):
 *   • method       — GET/POST/PUT/PATCH/DELETE
 *   • url          — string with `${var}` placeholders
 *   • headers      — KeyValuePair[], values support `${var}`
 *   • queryParams  — KeyValuePair[], values support `${var}`
 *   • body         — string with `${var}` placeholders (POST/PUT/PATCH)
 *   • auth         — none / bearer / basic / apiKey (oauth2 +
 *                    credentialRef NOT supported in v1; throw on
 *                    those so the operator sees the missing piece
 *                    rather than silently sending an unauthenticated
 *                    request).
 *
 * Response handling:
 *   • 2xx with JSON object body  → merged into instance.variables
 *   • 2xx with non-object body   → returned as
 *                                  `{ responseStatus, responseBody }`
 *                                  so the response is captured without
 *                                  trampling the variables bag.
 *   • 4xx/5xx                    → throws → WorkerService retries per
 *                                  the node's `data.resilience.retry`.
 *   • Network/DNS error          → same retry path.
 *
 * Variable interpolation:
 *   `${foo}` → variables.foo
 *   `${user.email}` → variables.user.email (one level of dotted access)
 *   missing vars → empty string. Matches typical templating libs;
 *   strict-mode validation lives in the canvas validator (which sees
 *   the placeholder list at design time), not at runtime.
 *
 * Out of scope for v1 (tracked under I-series follow-ups):
 *   • OAuth2 token refresh
 *   • CredentialRef store integration
 *   • Status-code → outcome mapping (would interact with VX2 outcomes)
 *   • Streaming / multipart / file uploads
 *   • mTLS
 * ──────────────────────────────────────────────────────────────────── */

/** Synthetic worker topic for rest-typed service tasks. Engine resolves
 *  `impl.type === "rest"` to this constant; the handler reads the rest
 *  config from `nodeData.implementation.config`. */
export const REST_SERVICE_TASK_TOPIC = "__rest__";

/** `${var}` placeholder pattern. Captures whatever's between the braces
 *  so a one-level dotted lookup (`user.email`) can be split inside the
 *  callback. Multi-level paths or array index syntax aren't supported
 *  in v1 — keep templating simple, push complex projection to script
 *  tasks. */
const REST_VAR_INTERPOLATION_RE = /\$\{([^}]+)\}/g;

function interpolateRestTemplate(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(REST_VAR_INTERPOLATION_RE, (_, expr) => {
    const path = String(expr).trim();
    if (!path) return "";
    const parts = path.split(".");
    let cur: unknown = variables;
    for (const p of parts) {
      if (
        cur != null &&
        typeof cur === "object" &&
        Object.prototype.hasOwnProperty.call(cur, p)
      ) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        // Missing var → empty string. Keeps URL/body well-formed; the
        // designer-side variable-registry validator already flags
        // unresolved placeholders at edit time so a runtime "" here
        // means the operator chose to allow it.
        return "";
      }
    }
    return cur == null ? "" : String(cur);
  });
}

type RestKeyValuePair = { key: string; value: string };

type RestAuthConfig =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apiKey"; headerName: string; value: string }
  | { type: "oauth2"; credentialRef?: string }
  | { type: "credentialRef"; refId?: string };

type RestImplConfig = {
  method?: string;
  url?: string;
  headers?: RestKeyValuePair[];
  queryParams?: RestKeyValuePair[];
  body?: string;
  auth?: RestAuthConfig;
};

const REST_VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const REST_BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const REST_RESPONSE_BODY_LIMIT = 500;

export const restHandler: ServiceTaskHandler = async (input) => {
  const impl = input.nodeData.implementation as
    | { type?: unknown; config?: RestImplConfig }
    | undefined;
  if (!impl || impl.type !== "rest" || !impl.config || typeof impl.config !== "object") {
    throw new Error(
      'rest handler: nodeData.implementation must be { type: "rest", config: RestConfig }.',
    );
  }
  const cfg = impl.config;

  const method = String(cfg.method ?? "GET").toUpperCase();
  if (!REST_VALID_METHODS.has(method)) {
    throw new Error(`rest handler: unsupported HTTP method "${method}".`);
  }

  const rawUrl = typeof cfg.url === "string" ? cfg.url : "";
  if (!rawUrl) {
    throw new Error("rest handler: implementation.config.url is required.");
  }

  let url = interpolateRestTemplate(rawUrl, input.variables);
  // Validate URL parses before adding query params — clearer error
  // than letting `new URL` blow up halfway through the builder.
  try {
    new URL(url);
  } catch (e) {
    throw new Error(
      `rest handler: invalid URL after variable interpolation ("${url}"): ${(e as Error).message}`,
    );
  }

  // Build query string from queryParams (if any). Each value goes
  // through interpolation too so `${env}` etc. resolve.
  const queryParams = Array.isArray(cfg.queryParams) ? cfg.queryParams : [];
  if (queryParams.length > 0) {
    const u = new URL(url);
    for (const kv of queryParams) {
      if (kv && typeof kv.key === "string" && kv.key) {
        u.searchParams.append(
          kv.key,
          interpolateRestTemplate(String(kv.value ?? ""), input.variables),
        );
      }
    }
    url = u.toString();
  }

  // Headers: KV pairs first, then auth, then default Content-Type for
  // body methods if the user didn't override it.
  const headers: Record<string, string> = {};
  for (const kv of cfg.headers ?? []) {
    if (kv && typeof kv.key === "string" && kv.key) {
      headers[kv.key] = interpolateRestTemplate(
        String(kv.value ?? ""),
        input.variables,
      );
    }
  }

  const auth = cfg.auth;
  if (auth && auth.type) {
    switch (auth.type) {
      case "none":
        break;
      case "bearer": {
        const token = interpolateRestTemplate(
          String(auth.token ?? ""),
          input.variables,
        );
        if (token) headers["Authorization"] = `Bearer ${token}`;
        break;
      }
      case "basic": {
        const u = interpolateRestTemplate(
          String(auth.username ?? ""),
          input.variables,
        );
        const p = interpolateRestTemplate(
          String(auth.password ?? ""),
          input.variables,
        );
        if (u || p) {
          headers["Authorization"] =
            `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
        }
        break;
      }
      case "apiKey": {
        const headerName = typeof auth.headerName === "string" ? auth.headerName : "";
        const value = interpolateRestTemplate(
          String(auth.value ?? ""),
          input.variables,
        );
        if (headerName && value) headers[headerName] = value;
        break;
      }
      case "oauth2":
      case "credentialRef":
        // Refusing to silently send unauthenticated when the canvas
        // declared an auth requirement is the safer failure mode; an
        // operator gets a clean error in the audit trail rather than
        // a downstream 401 they have to debug.
        throw new Error(
          `rest handler: auth type "${auth.type}" is not supported in this engine version.`,
        );
      default:
        // Future-proofing: if a new auth type lands in the type union
        // before the runtime catches up, we want a clear error rather
        // than a silent no-auth call.
        throw new Error(
          `rest handler: unknown auth type "${(auth as { type?: string }).type ?? "<unset>"}".`,
        );
    }
  }

  let body: string | undefined;
  if (REST_BODY_METHODS.has(method) && typeof cfg.body === "string" && cfg.body !== "") {
    body = interpolateRestTemplate(cfg.body, input.variables);
    const hasContentType = Object.keys(headers).some(
      (h) => h.toLowerCase() === "content-type",
    );
    if (!hasContentType) {
      headers["Content-Type"] = "application/json";
    }
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (e) {
    // DNS / network / abort / TLS — anything before a status code is
    // visible. Throw to feed the worker's retry loop.
    throw new Error(
      `rest handler: ${method} ${url} failed before response: ${(e as Error).message}`,
    );
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON — treat body as opaque text below.
    }
  }

  if (!res.ok) {
    const truncated =
      text.length > REST_RESPONSE_BODY_LIMIT
        ? `${text.slice(0, REST_RESPONSE_BODY_LIMIT)}… (truncated)`
        : text;
    throw new Error(
      `rest handler: ${method} ${url} returned ${res.status} ${res.statusText}: ${truncated || "<empty body>"}`,
    );
  }

  // 2xx success. If the body parsed to a JSON object, merge it
  // directly into instance.variables so callers can do
  // `${responseField}` without unwrapping. Anything else (array,
  // primitive, plain text, empty body) → wrap so we don't drop info.
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
};

/** Sets a variable: reads `key` and `value` from `nodeData.input`
 *  (canvas-defined static input on the service task) and writes them
 *  back into instance variables. The simplest non-trivial handler;
 *  great for "stamp a variable in mid-process" use cases without
 *  needing a script task. */
export const setVariableHandler: ServiceTaskHandler = async (input) => {
  const cfg = (input.nodeData.input ?? {}) as Record<string, unknown>;
  const key = typeof cfg.key === "string" ? cfg.key : null;
  if (!key) {
    throw new Error(
      "set-variable handler: nodeData.input.key (string) is required.",
    );
  }
  if (FORBIDDEN_VARIABLE_KEYS.has(key) || !SAFE_VARIABLE_KEY_RE.test(key)) {
    // Reject prototype-pollution-shaped names (`__proto__`,
    // `constructor`, `prototype`) and anything with structural JS
    // punctuation. The variables bag is consumed downstream as-is;
    // a hostile key would surface in audit + outbox payloads and
    // confuse consumers.
    throw new Error(
      `set-variable handler: key "${key}" must match ${SAFE_VARIABLE_KEY_RE} and not be a reserved name.`,
    );
  }
  return { [key]: cfg.value ?? null };
};
