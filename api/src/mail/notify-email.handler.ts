/* ─── notify-email service-task handler ─────────────────────────────
 * Registers under topic `notify-email` so BPMN service tasks with
 *   implementation.type = "externalWorker"
 *   implementation.config.jobType = "notify-email"
 * deliver mail via the tenant's SMTP settings.
 *
 * Reads `nodeData.input` (canvas-defined static input on the service
 * task) for:
 *   • to       — string, comma-separated allowed (required)
 *   • subject  — string (required)
 *   • body     — string, plain text (required)
 * Each field is interpolated with `${var}` against instance variables
 * using the same single-level-dot lookup as the REST handler.
 *
 * On send: returns { mailMessageId, mailAccepted } so downstream nodes
 * can branch on delivery, and so the engine's audit feed carries
 * useful breadcrumbs without a separate audit hook. Throws on missing
 * settings, missing input fields, or SMTP failure — the worker retries
 * per the node's `data.resilience.retry`.
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  ServiceTaskRegistry,
  type ServiceTaskHandler,
} from "../engine/service-task-registry";
import { MailerService } from "./mailer.service";

export const NOTIFY_EMAIL_TOPIC = "notify-email";

const VAR_INTERPOLATION_RE = /\$\{([^}]+)\}/g;

function interpolate(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(VAR_INTERPOLATION_RE, (_, expr) => {
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
        return "";
      }
    }
    return cur == null ? "" : String(cur);
  });
}

@Injectable()
export class NotifyEmailHandler implements OnModuleInit {
  constructor(
    private readonly registry: ServiceTaskRegistry,
    private readonly mailer: MailerService,
  ) {}

  onModuleInit(): void {
    this.registry.register(NOTIFY_EMAIL_TOPIC, this.handle);
  }

  private handle: ServiceTaskHandler = async (input) => {
    const cfg = (input.nodeData.input ?? {}) as Record<string, unknown>;
    const toRaw = typeof cfg.to === "string" ? cfg.to : "";
    const subjectRaw = typeof cfg.subject === "string" ? cfg.subject : "";
    const bodyRaw = typeof cfg.body === "string" ? cfg.body : "";

    if (!toRaw || !subjectRaw || !bodyRaw) {
      throw new Error(
        'notify-email: nodeData.input must define "to", "subject", and "body" (all strings).',
      );
    }

    const to = interpolate(toRaw, input.variables);
    const subject = interpolate(subjectRaw, input.variables);
    const body = interpolate(bodyRaw, input.variables);

    if (!to.trim()) {
      throw new Error(
        'notify-email: "to" resolved to an empty string after variable interpolation.',
      );
    }

    const result = await this.mailer.send({
      tenantId: input.tenantId,
      to,
      subject,
      text: body,
    });

    return {
      mailMessageId: result.messageId,
      mailAccepted: result.accepted,
    };
  };
}
