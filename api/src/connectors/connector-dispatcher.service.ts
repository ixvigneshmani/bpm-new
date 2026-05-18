/* ─── Connector Dispatcher Service ──────────────────────────────────
 * Routes every BPMN serviceTask with `implementation.type === "connector"`
 * to the right registered ConnectorOperation. Sits underneath the
 * existing ServiceTaskService machinery (claim, retry, dead-letter,
 * per-attempt audit) by registering a handler at the synthetic
 * userTopic `__connector__`.
 *
 * Lifecycle on success:
 *   worker claims job → ServiceTaskService.runJob → this.handle(input)
 *     → resolve connection (decrypt) → interpolate ${var} on operation input
 *     → operation.handler(ctx, connectionConfig, input)
 *     → result merged into instance.variables by the engine
 *
 * Lifecycle on permanent failure:
 *   same as any service-task — engine fails the token after exhausted
 *   retries via the existing onDead hook in ServiceTaskService.
 *
 * Why no new worker topic: REST already proves the pattern — synthetic
 * userTopics share the single `service-task` worker registration. Less
 * duplication, less to monitor, and tenant queue quotas (OS7) apply
 * uniformly.
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  ServiceTaskRegistry,
  type ServiceTaskHandler,
  type ServiceTaskInput,
} from "../engine/service-task-registry";
import {
  ConnectorRegistry,
  CONNECTOR_TOPIC,
  type ConnectorOperation,
} from "./connector-registry";
import { ConnectorInstancesService } from "./connector-instances.service";
import { interpolateDeep } from "./template";

/** Shape the designer writes into `data.implementation.config` for a
 *  connector-typed service task. The dispatcher reads exactly these
 *  keys; anything else is ignored. */
type ConnectorTaskConfig = {
  connector?: string;
  /** Null/missing → use the default connection for this connector type.
   *  Empty-`connectionSchema` connectors (e.g. REST) ignore this. */
  connectionId?: string | null;
  operation?: string;
  /** Per-call input matching the operation's `inputSchema`. Strings
   *  inside are `${var}`-interpolated against instance variables. */
  input?: Record<string, unknown>;
};

@Injectable()
export class ConnectorDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(ConnectorDispatcherService.name);

  constructor(
    private readonly serviceTaskRegistry: ServiceTaskRegistry,
    private readonly connectors: ConnectorRegistry,
    private readonly instances: ConnectorInstancesService,
  ) {}

  onModuleInit(): void {
    this.serviceTaskRegistry.register(CONNECTOR_TOPIC, this.handle);
  }

  private handle: ServiceTaskHandler = async (input: ServiceTaskInput) => {
    const impl = input.nodeData.implementation as
      | { type?: unknown; config?: Record<string, unknown> }
      | undefined;
    if (!impl || !impl.config) {
      throw new Error(
        'connector dispatch: nodeData.implementation must be { type: "connector" | "rest", config: ... }.',
      );
    }

    // Legacy shim: a canvas authored before the framework existed
    // carries `implementation.type === "rest"` with the rest config
    // (method/url/headers/queryParams/body/auth) flat on
    // `impl.config`. The engine routes it here (see
    // resolveServiceTaskTopic). Translate to the connector shape so
    // the rest of this handler doesn't need to know about it.
    let cfg: ConnectorTaskConfig;
    if (impl.type === "rest") {
      cfg = {
        connector: "rest",
        connectionId: null,
        operation: "request",
        input: impl.config,
      };
      this.logger.log(
        `Legacy type=rest shim → connector=rest/request for tenant ${input.tenantId} instance ${input.instanceId}.`,
      );
    } else if (impl.type === "connector") {
      cfg = impl.config as ConnectorTaskConfig;
    } else {
      throw new Error(
        `connector dispatch: unexpected implementation.type "${String(impl.type)}".`,
      );
    }

    const connectorId = typeof cfg.connector === "string" ? cfg.connector : "";
    const operationId = typeof cfg.operation === "string" ? cfg.operation : "";
    if (!connectorId || !operationId) {
      throw new Error(
        "connector dispatch: config.connector and config.operation are required.",
      );
    }

    const def = this.connectors.get(connectorId);
    if (!def) {
      throw new Error(
        `connector dispatch: unknown connector "${connectorId}". Known: ${this.connectors.list().map((d) => d.id).join(", ") || "(none)"}.`,
      );
    }
    const op: ConnectorOperation | undefined = def.operations.find((o) => o.id === operationId);
    if (!op) {
      throw new Error(
        `connector dispatch: connector "${connectorId}" has no operation "${operationId}". Available: ${def.operations.map((o) => o.id).join(", ") || "(none)"}.`,
      );
    }

    // Resolve connection (decrypt + enabled-check). Behavior depends
    // on the connector's connectionRequired flag:
    //   • required=true (Mail, Slack, …): missing connection AND no
    //     tenant default → dispatch error.
    //   • required=false (REST, noop, …): connection is optional. When
    //     picked, the operation handler merges connection defaults
    //     with per-task input. When omitted, handler receives an empty
    //     connectionConfig and uses only per-task input.
    let connectionConfig: Record<string, unknown> = {};
    const connectionRequired = def.connectionRequired ?? true;
    if (cfg.connectionId) {
      const conn = await this.instances.getDecrypted(input.tenantId, cfg.connectionId);
      if (conn.connectorType !== connectorId) {
        throw new Error(
          `connector dispatch: connection ${cfg.connectionId} is of type "${conn.connectorType}", but task expects "${connectorId}".`,
        );
      }
      connectionConfig = conn.config;
    } else if (connectionRequired) {
      const def$ = await this.instances.getDefault(input.tenantId, connectorId);
      if (!def$) {
        throw new Error(
          `connector dispatch: connector "${connectorId}" requires a connection, and the tenant has no default configured. Set one under Settings → Connections.`,
        );
      }
      connectionConfig = def$.config;
    }
    // else: connectionRequired=false and no connectionId → empty config.

    // Interpolate ${var} across the operation input. Doing this here
    // rather than in each handler keeps the connector code focused on
    // the business call and ensures uniform behaviour across all
    // connectors (REST, Mail, future Slack/etc.).
    const interpolatedInput = interpolateDeep(
      (cfg.input ?? {}) as Record<string, unknown>,
      input.variables,
    );

    try {
      const result = await op.handler(
        {
          tenantId: input.tenantId,
          instanceId: input.instanceId,
          tokenId: input.tokenId,
          nodeId: this.extractNodeId(input),
          variables: input.variables,
        },
        connectionConfig,
        interpolatedInput,
      );
      return result ?? {};
    } catch (err) {
      // Re-throw so the worker retry path handles it. Log here so the
      // pino structured line carries the connector/operation context
      // — without this, the worker's generic "handler failed" line
      // doesn't tell ops which connector blew up.
      this.logger.warn(
        `Connector "${connectorId}" operation "${operationId}" failed for tenant ${input.tenantId}: ${(err as Error).message}`,
      );
      throw err;
    }
  };

  /** The engine populates `nodeData` with the canvas data; the node
   *  id itself isn't on `nodeData` (it's the React Flow node's `.id`,
   *  hoisted into `job.input.nodeId` separately). The service-task
   *  registry's `ServiceTaskInput` doesn't carry it directly today, so
   *  we extract from `nodeData.id` if the engine populates it there,
   *  else null. Used only for log context. */
  private extractNodeId(input: ServiceTaskInput): string | null {
    const id = (input.nodeData as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
}
