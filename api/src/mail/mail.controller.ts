/* ─── Mail Controller ────────────────────────────────────────────────
 * Tenant SMTP settings + test send. Restricted to platform owner /
 * admin: mail credentials are tenant-wide secrets, no per-process
 * RBAC applies. Lower-role users get 403.
 * ──────────────────────────────────────────────────────────────────── */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { TestSendMailDto } from "./dto/test-send-mail.dto";
import { UpdateMailSettingsDto } from "./dto/update-mail-settings.dto";
import { MailSettingsService } from "./mail-settings.service";
import { MailerService } from "./mailer.service";

function assertAdmin(req: AuthenticatedRequest): void {
  const role = req.user.systemRole;
  if (role !== "owner" && role !== "admin") {
    throw new ForbiddenException(
      "Only owner / admin users may manage mail settings.",
    );
  }
}

@Controller("mail")
@UseGuards(JwtAuthGuard)
export class MailController {
  constructor(
    private readonly settings: MailSettingsService,
    private readonly mailer: MailerService,
  ) {}

  /** GET /mail/settings — returns null if the tenant hasn't configured
   *  SMTP yet so the page can render an empty form. Never includes the
   *  password; surface a `passwordSet` boolean instead. */
  @Get("settings")
  async get(@Req() req: AuthenticatedRequest) {
    assertAdmin(req);
    return (await this.settings.getPublic(req.user.tenantId)) ?? null;
  }

  /** PUT /mail/settings — upsert. Password omitted/null = keep existing. */
  @Put("settings")
  async put(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateMailSettingsDto,
  ) {
    assertAdmin(req);
    // Clear any open breaker on a settings change — the operator's
    // intent on hitting Save is "try again with these new creds",
    // not "respect the cooldown from the previous broken config".
    this.mailer.resetBreaker(req.user.tenantId);
    return this.settings.upsert({
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      host: dto.host,
      port: dto.port,
      secure: dto.secure,
      username: dto.username ?? null,
      password: dto.password ?? null,
      fromEmail: dto.fromEmail,
      fromName: dto.fromName ?? null,
      enabled: dto.enabled ?? true,
    });
  }

  /** POST /mail/settings/test — send a one-off test email using the
   *  current saved settings. Returns 200 with the SMTP messageId on
   *  success, 400-shaped error on failure (caller surfaces it). */
  @Post("settings/test")
  @HttpCode(200)
  async test(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TestSendMailDto,
  ) {
    assertAdmin(req);
    const subject = dto.subject ?? "FlowPro test email";
    const body =
      dto.body ??
      `This is a FlowPro test email sent at ${new Date().toISOString()} by ${req.user.email}.`;
    // Translate SMTP / breaker / config errors into a 400 carrying the
    // real cause. Without this, nodemailer's "ENOTFOUND smtp.host" collapses
    // to a generic 500 and the operator can't tell whether they fat-fingered
    // the host, the password is wrong, or the relay is genuinely down.
    let result;
    try {
      result = await this.mailer.send({
        tenantId: req.user.tenantId,
        to: dto.to,
        subject,
        text: body,
      });
    } catch (err) {
      throw new BadRequestException(
        `Test send failed: ${(err as Error).message}`,
      );
    }
    return {
      ok: true,
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
    };
  }
}
