/* ─── Mail Connector ────────────────────────────────────────────────
 * I4 Sprint 2. First "real" connector. Replaces the standalone
 * I1 MailerService + MailController + notify-email handler trio.
 *
 * One operation today: `send`. Multi-recipient + html body + cc/bcc
 * deferred until a customer pull (each adds an inputSchema field, no
 * core machinery changes).
 *
 * Why this connector lives as a class with OnModuleInit instead of a
 * plain const: nodemailer transports are created per send (cheap, and
 * matches the I1 design — stateless transports prevent stale-creds
 * caching bugs). The circuit breaker IS stateful and lives on the
 * class. Putting both inside a class also gives the connector its own
 * Logger context for ops triage ("MailConnector" rather than the
 * generic "ConnectorRegistry").
 *
 * Circuit breaker semantics (carried over from I1):
 *   • Closed → 5 consecutive failures → Open (60s cooldown)
 *   • Open   → reject sends until cooldown elapses
 *   • Cooldown elapsed → Half-Open: next send is the probe; success
 *     closes, failure re-opens for another 60s.
 *   • Saving a fresh connection clears the breaker for that tenant
 *     (operator intent: "I fixed it, try again now"). Handled in the
 *     instances service by invoking `resetBreakerForTenant`.
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import {
  ConnectorRegistry,
  type ConnectorDefinition,
  type ConnectorInvocationContext,
} from "../connector-registry";

const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;

type BreakerState = {
  consecutiveFailures: number;
  openedAt: number | null;
};

type MailConnectionConfig = {
  host: string;
  port: number;
  secure?: boolean;
  username?: string | null;
  password?: string | null;
  fromEmail: string;
  fromName?: string | null;
};

type MailSendInput = {
  to?: unknown;
  subject?: unknown;
  body?: unknown;
};

@Injectable()
export class MailConnector implements OnModuleInit {
  private readonly logger = new Logger(MailConnector.name);
  /** Breaker is keyed by tenantId. One tenant's misconfigured SMTP
   *  must not slam another tenant's queue. Keyed by tenant rather
   *  than (tenant, connectionId) because the breaker is about
   *  protecting the worker pool — granular per-connection breakers
   *  are a v2 concern once tenants regularly have many connections. */
  private readonly breakers = new Map<string, BreakerState>();

  constructor(private readonly registry: ConnectorRegistry) {}

  onModuleInit(): void {
    this.registry.register(this.definition);
  }

  /** Public so ConnectorInstancesService can clear the breaker on a
   *  save. Wired in the service via a hook (avoids a back-pointer
   *  module dependency). */
  resetBreakerForTenant(tenantId: string): void {
    this.breakers.delete(tenantId);
  }

  private get definition(): ConnectorDefinition {
    return {
      id: "mail",
      name: "Email (SMTP)",
      description:
        "Send email through a tenant-configured SMTP relay. One configured connection holds the host, port, credentials, and From identity; processes use the `send` operation with per-call recipient, subject, and body.",
      connectionSchema: {
        host: {
          type: "string",
          required: true,
          placeholder: "smtp.example.com",
          description: "SMTP server hostname.",
          maxLength: 255,
        },
        port: {
          type: "integer",
          required: true,
          min: 1,
          max: 65535,
          default: 587,
          description:
            "SMTP port. 587 (STARTTLS) for most relays; 465 with implicit TLS; 25 only for legacy non-TLS relays.",
        },
        secure: {
          type: "boolean",
          default: false,
          description:
            "Implicit TLS — leave off for STARTTLS on port 587/25; turn on only for port 465.",
        },
        username: {
          type: "string",
          description:
            "Auth username. Blank for relays that don't require authentication.",
          maxLength: 255,
        },
        password: {
          type: "string",
          secret: true,
          description:
            "Auth password. Stored encrypted at rest; never returned by the API.",
          maxLength: 255,
        },
        fromEmail: {
          type: "email",
          required: true,
          placeholder: "noreply@yourdomain.com",
          description: "Default From address for every send.",
        },
        fromName: {
          type: "string",
          placeholder: "FlowPro",
          description: "Optional display name shown in mail clients.",
          maxLength: 255,
        },
      },
      secretFields: ["password"],
      connectionRequired: true,
      operations: [
        {
          id: "send",
          name: "Send email",
          description:
            "Deliver a single message via this connection. Recipient supports comma-separated addresses; subject and body are plain-text in v1 (HTML follows on customer pull).",
          inputSchema: {
            to: {
              type: "string",
              required: true,
              placeholder: "alice@example.com",
              description:
                "Recipient(s). Comma-separated for multiple. Supports `${var}` interpolation.",
            },
            subject: {
              type: "string",
              required: true,
              description: "Subject line. Supports `${var}` interpolation.",
            },
            body: {
              type: "string",
              required: true,
              description: "Plain-text message body. Supports `${var}` interpolation.",
            },
          },
          outputKeys: ["mailMessageId", "mailAccepted"],
          handler: async (ctx, connectionConfig, input) => {
            const cfg = this.requireConnectionConfig(connectionConfig);
            const send = this.normalizeSendInput(input as MailSendInput);
            this.assertBreakerClosed(ctx.tenantId);

            const transporter = this.makeTransport(cfg);
            try {
              const info = await transporter.sendMail({
                from: cfg.fromName
                  ? `"${cfg.fromName}" <${cfg.fromEmail}>`
                  : cfg.fromEmail,
                to: send.to,
                subject: send.subject,
                text: send.body,
              });
              this.recordSuccess(ctx.tenantId);
              return {
                mailMessageId: info.messageId,
                mailAccepted: (info.accepted ?? []).map((a: unknown) => String(a)),
              };
            } catch (err) {
              this.recordFailure(ctx.tenantId);
              const msg = (err as Error).message ?? "unknown SMTP error";
              this.logger.warn(
                `Mail send failed for tenant ${ctx.tenantId}: ${msg}`,
              );
              throw new Error(`SMTP send failed: ${msg}`);
            } finally {
              transporter.close?.();
            }
          },
        },
      ],
      // Operator-driven save = "I fixed it, try again now." Clear the
      // breaker so the next send doesn't wait out the cooldown from
      // the previous broken config.
      onConnectionSaved: (tenantId) => this.resetBreakerForTenant(tenantId),
      testAction: {
        inputSchema: {
          to: {
            type: "email",
            required: true,
            description: "Recipient for the test send.",
          },
        },
        handler: async (ctx, connectionConfig, testInput) => {
          const cfg = this.requireConnectionConfig(connectionConfig);
          const to = String((testInput as { to?: unknown }).to ?? "").trim();
          if (!to) throw new Error("Recipient email is required.");
          const subject = "FlowPro test email";
          const body = `This is a FlowPro test email sent at ${new Date().toISOString()} from the Mail connector. If you received this, the relay is wired up correctly.`;
          this.assertBreakerClosed(ctx.tenantId);
          const transporter = this.makeTransport(cfg);
          try {
            const info = await transporter.sendMail({
              from: cfg.fromName
                ? `"${cfg.fromName}" <${cfg.fromEmail}>`
                : cfg.fromEmail,
              to,
              subject,
              text: body,
            });
            this.recordSuccess(ctx.tenantId);
            return {
              ok: true as const,
              summary: `Test email sent to ${to}.`,
              details: {
                messageId: info.messageId,
                accepted: info.accepted,
              },
            };
          } catch (err) {
            this.recordFailure(ctx.tenantId);
            const msg = (err as Error).message ?? "unknown SMTP error";
            this.logger.warn(
              `Mail test send failed for tenant ${ctx.tenantId}: ${msg}`,
            );
            throw new Error(msg);
          } finally {
            transporter.close?.();
          }
        },
      },
    };
  }

  private requireConnectionConfig(raw: Record<string, unknown>): MailConnectionConfig {
    const host = typeof raw.host === "string" ? raw.host.trim() : "";
    const port = typeof raw.port === "number" ? raw.port : Number(raw.port);
    const fromEmail = typeof raw.fromEmail === "string" ? raw.fromEmail.trim() : "";
    if (!host || !Number.isFinite(port) || !fromEmail) {
      throw new Error(
        "Mail connection is missing host, port, or fromEmail. Open Settings → Connections to fix.",
      );
    }
    return {
      host,
      port,
      secure: raw.secure === true,
      username: typeof raw.username === "string" ? raw.username : null,
      password: typeof raw.password === "string" ? raw.password : null,
      fromEmail,
      fromName: typeof raw.fromName === "string" ? raw.fromName : null,
    };
  }

  private normalizeSendInput(input: MailSendInput): {
    to: string;
    subject: string;
    body: string;
  } {
    const to = typeof input.to === "string" ? input.to.trim() : "";
    const subject = typeof input.subject === "string" ? input.subject : "";
    const body = typeof input.body === "string" ? input.body : "";
    if (!to || !subject || !body) {
      throw new Error(
        'mail.send: "to", "subject", and "body" are all required and must be strings.',
      );
    }
    return { to, subject, body };
  }

  private makeTransport(cfg: MailConnectionConfig): Transporter {
    const auth =
      cfg.username && cfg.password
        ? { user: cfg.username, pass: cfg.password }
        : undefined;
    return createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure ?? false,
      auth,
      // Hard-cap so a hung handshake can't hold a worker slot near the
      // 30s handler timeout. nodemailer defaults are too generous.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  private assertBreakerClosed(tenantId: string): void {
    const b = this.breakers.get(tenantId);
    if (!b || b.openedAt === null) return;
    if (Date.now() - b.openedAt < BREAKER_COOLDOWN_MS) {
      const secondsLeft = Math.ceil(
        (BREAKER_COOLDOWN_MS - (Date.now() - b.openedAt)) / 1000,
      );
      throw new Error(
        `Mail delivery paused after ${b.consecutiveFailures} consecutive SMTP failures. ` +
          `Save updated settings to retry now, or wait ${secondsLeft}s.`,
      );
    }
    // Cooldown elapsed: enter half-open by clearing openedAt while
    // leaving the failure count; a success on the next call wipes it.
    b.openedAt = null;
  }

  private recordSuccess(tenantId: string): void {
    this.breakers.delete(tenantId);
  }

  private recordFailure(tenantId: string): void {
    const b = this.breakers.get(tenantId) ?? {
      consecutiveFailures: 0,
      openedAt: null,
    };
    b.consecutiveFailures += 1;
    if (b.consecutiveFailures >= BREAKER_THRESHOLD) {
      b.openedAt = Date.now();
    }
    this.breakers.set(tenantId, b);
  }

  /** Used by ConnectorInstancesService when a mail connection is
   *  upserted, so the operator-intent "save = retry now" still holds
   *  after Sprint 2 migrates Mail into the connector framework. */
  __resetBreaker(tenantId: string): void {
    this.resetBreakerForTenant(tenantId);
  }
}
