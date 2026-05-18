import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EngineModule } from "../engine/engine.module";
import { MailController } from "./mail.controller";
import { MailSettingsService } from "./mail-settings.service";
import { MailerService } from "./mailer.service";
import { NotifyEmailHandler } from "./notify-email.handler";

/** I1 — Mail/SMTP. MailModule owns the per-tenant SMTP config + the
 *  engine `notify-email` service-task handler. Imports EngineModule
 *  so the handler can grab ServiceTaskRegistry; AuthModule for the
 *  JwtAuthGuard on the controller. */
@Module({
  imports: [AuthModule, EngineModule],
  controllers: [MailController],
  providers: [MailSettingsService, MailerService, NotifyEmailHandler],
  exports: [MailerService, MailSettingsService],
})
export class MailModule {}
