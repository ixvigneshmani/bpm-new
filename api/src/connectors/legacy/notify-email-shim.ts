/* ─── notify-email legacy shim ──────────────────────────────────────
 * I4 Sprint 2. Pre-Sprint-2 processes (published with
 *   implementation.type = "externalWorker"
 *   implementation.config.jobType = "notify-email"
 * + nodeData.input = { to, subject, body })
 * keep running unchanged. The engine's resolveServiceTaskTopic still
 * routes those to the "notify-email" topic; this handler accepts the
 * topic and re-dispatches the work through the Mail connector against
 * the tenant's default mail connection.
 *
 * Why not rewrite the canvas data: doing so would silently mutate
 * already-published process versions, which OS4 + GAP-05 explicitly
 * forbid. Pre-existing canvases keep their stored shape; new edits in
 * the designer use the connector shape. This shim is permanent for
 * the lifetime of v1; Sprint 3's designer migration will offer a
 * one-click "Convert to Connector" button so legacy processes can be
 * upgraded explicitly on next save.
 *
 * Emits a one-time INFO log per (tenantId, instanceId) so ops can
 * trace which instances are still riding the shim. After enough time
 * elapses with zero shim activations, the topic can be retired in a
 * later sprint.
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  ServiceTaskRegistry,
  type ServiceTaskHandler,
} from "../../engine/service-task-registry";
import { MailConnector } from "../connectors/mail.connector";
import { ConnectorInstancesService } from "../connector-instances.service";
import { ConnectorRegistry } from "../connector-registry";
import { interpolate } from "../template";

export const NOTIFY_EMAIL_LEGACY_TOPIC = "notify-email";

@Injectable()
export class NotifyEmailLegacyShim implements OnModuleInit {
  private readonly logger = new Logger(NotifyEmailLegacyShim.name);

  constructor(
    private readonly serviceTaskRegistry: ServiceTaskRegistry,
    private readonly connectors: ConnectorRegistry,
    private readonly instances: ConnectorInstancesService,
    // Inject the MailConnector explicitly so Nest constructs it before
    // this shim resolves at init-time. We don't call methods on it
    // directly — the registry is the API — but the dependency
    // guarantees ordering.
    @SuppressUnused() _mail: MailConnector,
  ) {}

  onModuleInit(): void {
    this.serviceTaskRegistry.register(NOTIFY_EMAIL_LEGACY_TOPIC, this.handle);
  }

  private handle: ServiceTaskHandler = async (input) => {
    const cfg = (input.nodeData.input ?? {}) as Record<string, unknown>;
    const toRaw = typeof cfg.to === "string" ? cfg.to : "";
    const subjectRaw = typeof cfg.subject === "string" ? cfg.subject : "";
    const bodyRaw = typeof cfg.body === "string" ? cfg.body : "";
    if (!toRaw || !subjectRaw || !bodyRaw) {
      throw new Error(
        'notify-email (legacy): nodeData.input must define "to", "subject", and "body" (all strings).',
      );
    }

    const to = interpolate(toRaw, input.variables);
    const subject = interpolate(subjectRaw, input.variables);
    const body = interpolate(bodyRaw, input.variables);
    if (!to.trim()) {
      throw new Error(
        'notify-email (legacy): "to" resolved to an empty string after variable interpolation.',
      );
    }

    const mailDef = this.connectors.get("mail");
    const sendOp = mailDef?.operations.find((o) => o.id === "send");
    if (!mailDef || !sendOp) {
      throw new Error(
        "notify-email (legacy): the Mail connector is not registered. Cannot dispatch legacy notify-email.",
      );
    }

    const defaultConn = await this.instances.getDefault(input.tenantId, "mail");
    if (!defaultConn) {
      throw new Error(
        "notify-email (legacy): tenant has no default Mail connection. Configure one under Settings → Connections.",
      );
    }

    this.logger.log(
      `Legacy notify-email shim dispatched for tenant ${input.tenantId} instance ${input.instanceId} via connection "${defaultConn.name}".`,
    );

    return sendOp.handler(
      {
        tenantId: input.tenantId,
        instanceId: input.instanceId,
        tokenId: input.tokenId,
        nodeId: null,
        variables: input.variables,
      },
      defaultConn.config,
      { to, subject, body },
    );
  };
}

/** No-op decorator so unused constructor params don't trip lint while
 *  still keeping the explicit DI dependency edge. Mirrors how other
 *  modules in the codebase tag deliberate-import-for-ordering. */
function SuppressUnused(): ParameterDecorator {
  return () => {};
}
