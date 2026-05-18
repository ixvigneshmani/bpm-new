/* ─── Mailer Service ────────────────────────────────────────────────
 * Sends mail via the tenant's configured SMTP transport. Wraps
 * nodemailer with a per-tenant in-memory circuit breaker so a dead
 * relay (DNS NXDOMAIN, auth failures, hung connection) can't blow
 * up an engine worker every retry.
 *
 * Circuit states (per tenant):
 *   • closed   — normal; failures count toward the threshold
 *   • open     — short-circuited; send() throws without attempting
 *                a connection until cooldown elapses
 *   • half-open — first send after cooldown; success closes it,
 *                 another failure re-opens for another cooldown
 *
 * Transports are NOT cached. SMTP creds change rarely but invalidating
 * a cache on settings update would be one more thing to keep in sync;
 * creating a transport per send is cheap (a few ms) and lets the
 * service stay stateless. If profiling ever shows it's hot, cache
 * keyed by (tenantId, updatedAt).
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { MailSettingsService, type MailSettingsRow } from "./mail-settings.service";

const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;

type BreakerState = {
  consecutiveFailures: number;
  openedAt: number | null;
};

export type SendMailInput = {
  tenantId: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

export type SendMailResult = {
  messageId: string;
  accepted: string[];
  rejected: string[];
};

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly breakers = new Map<string, BreakerState>();

  constructor(private readonly settings: MailSettingsService) {}

  /** Send mail for a tenant. Throws when:
   *   • the tenant has no settings configured
   *   • settings are disabled
   *   • the breaker is open (cooldown hasn't elapsed)
   *   • SMTP delivery fails
   *  Caller (engine handler) treats the throw as a job-level failure
   *  that feeds the WorkerService retry loop. */
  async send(input: SendMailInput): Promise<SendMailResult> {
    const cfg = await this.settings.getDecrypted(input.tenantId);
    if (!cfg) {
      // User-facing strings deliberately omit the tenant UUID — the
      // caller is already scoped to one tenant and the UUID is noise.
      // The structured log line below carries it for ops debugging.
      this.logger.warn(
        `Mail send refused — no settings configured for tenant ${input.tenantId}.`,
      );
      throw new Error(
        "No SMTP settings configured. Open Settings → Email and save a relay.",
      );
    }
    if (!cfg.enabled) {
      this.logger.warn(
        `Mail send refused — delivery disabled for tenant ${input.tenantId}.`,
      );
      throw new Error(
        "Outgoing mail is disabled. Re-enable it under Settings → Email.",
      );
    }
    this.assertBreakerClosed(input.tenantId);

    const transporter = this.makeTransport(cfg);
    try {
      const info = await transporter.sendMail({
        from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromEmail}>` : cfg.fromEmail,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      this.recordSuccess(input.tenantId);
      return {
        messageId: info.messageId,
        accepted: (info.accepted ?? []).map((a: unknown) => String(a)),
        rejected: (info.rejected ?? []).map((a: unknown) => String(a)),
      };
    } catch (err) {
      this.recordFailure(input.tenantId);
      const msg = (err as Error).message ?? "unknown SMTP error";
      this.logger.warn(
        `Mail send failed for tenant ${input.tenantId}: ${msg}`,
      );
      throw new Error(`SMTP send failed: ${msg}`);
    } finally {
      transporter.close?.();
    }
  }

  /** Verify connectivity without sending. Used by the "Test Send"
   *  endpoint's preflight + by the controller's connection-only check
   *  if we ever expose one. Does NOT participate in the breaker —
   *  the operator is actively testing, breaker state is for the
   *  engine handler. */
  async verify(tenantId: string): Promise<void> {
    const cfg = await this.settings.getDecrypted(tenantId);
    if (!cfg) {
      throw new Error("No mail settings configured.");
    }
    const transporter = this.makeTransport(cfg);
    try {
      await transporter.verify();
    } finally {
      transporter.close?.();
    }
  }

  private makeTransport(cfg: MailSettingsRow): Transporter {
    const auth =
      cfg.username && cfg.password
        ? { user: cfg.username, pass: cfg.password }
        : undefined;
    return createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
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
      // No tenant UUID in the operator-facing string — the action they
      // need to take ("save updated settings or wait") is the same
      // regardless of which tenant they're in.
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

  /** Test hook + admin endpoint helper: clears the breaker for a
   *  tenant. Public so an admin "I fixed the SMTP creds, retry now"
   *  flow can re-arm without waiting on cooldown. */
  resetBreaker(tenantId: string): void {
    this.breakers.delete(tenantId);
  }
}
