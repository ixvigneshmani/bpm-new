/* ─── Connector Registry ─────────────────────────────────────────────
 * App-wide registry of `ConnectorDefinition` objects keyed by connector
 * id (e.g. "mail", "rest", "slack"). Each definition declares:
 *
 *   • connectionSchema  — JSON-schema-shaped object describing the
 *                         credential/config fields needed to instantiate
 *                         a connection. Empty for connectors like REST
 *                         that need no per-tenant config.
 *   • secretFields      — array of paths inside `connectionSchema` whose
 *                         values must be encrypted at rest. Read by
 *                         ConnectorInstancesService at write time.
 *   • operations        — list of `ConnectorOperation` records. Each
 *                         operation defines its input/output schemas and
 *                         a handler function. The runtime dispatcher
 *                         looks up `(connector, operation)` and calls
 *                         the handler with the decrypted connection
 *                         config + the per-call input.
 *   • testAction        — optional handler that admins can hit from the
 *                         Settings → Connections page to verify the
 *                         connection is wired up correctly. Receives the
 *                         decrypted config + a small operator-supplied
 *                         payload (e.g. test recipient email).
 *
 * Connectors register themselves at boot via the `register` method on
 * an injectable ConnectorRegistry, mirroring ServiceTaskRegistry. First
 * registration wins; duplicate ids log a warn and are ignored.
 *
 * Why a single registry instead of one provider per connector? Each
 * connector becomes a Nest provider for DI (timing service, http
 * fetcher, etc.) but its `ConnectorDefinition` is the public surface
 * the dispatcher and admin endpoints care about. Keeping the
 * definitions in one map lets the dispatcher resolve in O(1) without
 * traversing the Nest container.
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, Logger } from "@nestjs/common";

/** Synthetic worker topic that the connector dispatcher claims. The
 *  engine's resolveServiceTaskTopic routes any serviceTask with
 *  `implementation.type === "connector"` to this topic. */
export const CONNECTOR_TOPIC = "__connector__";

/** A minimal JSON-schema-ish description of one config/input field.
 *  Deliberately not full JSON Schema — we only need what the UI
 *  renderer + runtime validator both consume. Extend as concrete
 *  connectors need it. */
export type ConnectorFieldSchema =
  | { type: "string"; required?: boolean; secret?: boolean; placeholder?: string; description?: string; maxLength?: number }
  | { type: "email"; required?: boolean; placeholder?: string; description?: string }
  | { type: "integer"; required?: boolean; min?: number; max?: number; default?: number; description?: string }
  | { type: "boolean"; default?: boolean; description?: string }
  | { type: "url"; required?: boolean; placeholder?: string; description?: string }
  | { type: "enum"; required?: boolean; options: string[]; default?: string; description?: string };

/** Shape used both by `connectionSchema` and `operation.inputSchema`.
 *  The keys are the field names and become keys in the stored config
 *  blob (or the per-call input object). Plain object — order is the
 *  insertion order, which the UI honours for form rendering. */
export type ConnectorSchema = Record<string, ConnectorFieldSchema>;

/** Context passed to operation handlers and testAction handlers at
 *  call time. The dispatcher fills these in from the engine job; the
 *  testAction path uses synthesised values (no real token). */
export type ConnectorInvocationContext = {
  tenantId: string;
  /** Null when invoked via testAction (no instance). */
  instanceId: string | null;
  /** Null when invoked via testAction. */
  tokenId: string | null;
  /** Null when invoked via testAction. */
  nodeId: string | null;
  /** The instance variables at enqueue time. {} for testAction. */
  variables: Record<string, unknown>;
};

/** One callable operation on a connector. Handler receives the
 *  decrypted connection config (or {} when the connector's
 *  connectionSchema is empty), the per-call input, and the invocation
 *  context. Returns an object that the dispatcher merges into
 *  `instance.variables` (shallow merge), matching the existing service-
 *  task handler contract. */
export type ConnectorOperation = {
  id: string;
  name: string;
  description?: string;
  inputSchema: ConnectorSchema;
  /** Documented output keys for UI/variable-registry hints. Not
   *  validated at runtime — handlers return what they return. */
  outputKeys?: string[];
  handler: (
    ctx: ConnectorInvocationContext,
    connectionConfig: Record<string, unknown>,
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
};

/** Optional admin-driven test action. Used by the Settings UI's
 *  "Test connection" button. Should be cheap, side-effect-light, and
 *  produce a clear error message on failure. Receives a per-call
 *  testInput (e.g. { to: "ops@flowpro.test" } for Mail). */
export type ConnectorTestAction = {
  /** Schema for the operator-supplied test input (e.g. recipient). */
  inputSchema: ConnectorSchema;
  handler: (
    ctx: ConnectorInvocationContext,
    connectionConfig: Record<string, unknown>,
    testInput: Record<string, unknown>,
  ) => Promise<{ ok: true; summary: string; details?: Record<string, unknown> }>;
};

export type ConnectorDefinition = {
  id: string;
  name: string;
  description: string;
  /** Fields needed to instantiate a connection. May be non-empty even
   *  when `connectionRequired` is false — REST is the canonical example:
   *  baseUrl + auth + defaultHeaders are reusable when configured, but
   *  tasks can also operate fully standalone. */
  connectionSchema: ConnectorSchema;
  /** Paths within `connectionSchema` whose values are secrets. The
   *  service encrypts these on write and decrypts on read. Use a flat
   *  string array of top-level keys; we don't need nested paths yet. */
  secretFields: string[];
  /** When true (default), dispatch requires either an explicit
   *  connectionId on the task OR a tenant default of this connector
   *  type. Missing either → dispatch error.
   *
   *  When false, connections are optional: tasks may pick one (the
   *  operation merges connection defaults with per-task input) or
   *  omit it (operation receives an empty connectionConfig and uses
   *  only per-task input). Industry-matching for REST/generic HTTP
   *  per the Q2 decision; also right for the noop test fixture. */
  connectionRequired?: boolean;
  operations: ConnectorOperation[];
  /** Optional. When present, the controller exposes a POST
   *  /connections/:id/test endpoint. */
  testAction?: ConnectorTestAction;
};

@Injectable()
export class ConnectorRegistry {
  private readonly logger = new Logger(ConnectorRegistry.name);
  private readonly defs = new Map<string, ConnectorDefinition>();

  /** Register a connector definition. First registration wins; later
   *  attempts to register the same id log a warn and are ignored, so
   *  a misconfigured downstream module fails loudly without silently
   *  clobbering a working connector. */
  register(def: ConnectorDefinition): void {
    if (this.defs.has(def.id)) {
      this.logger.warn(
        `Connector "${def.id}" already registered; ignoring duplicate.`,
      );
      return;
    }
    this.defs.set(def.id, def);
    this.logger.log(
      `Registered connector: ${def.id} (${def.operations.length} operations)`,
    );
  }

  get(id: string): ConnectorDefinition | undefined {
    return this.defs.get(id);
  }

  getOperation(connectorId: string, operationId: string): ConnectorOperation | undefined {
    return this.defs.get(connectorId)?.operations.find((op) => op.id === operationId);
  }

  /** All registered definitions in registration order. The admin
   *  endpoint surfaces these as the "what connector types can I
   *  configure?" list. Secrets are scrubbed at the controller layer. */
  list(): ConnectorDefinition[] {
    return [...this.defs.values()];
  }
}
