import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { CreateWebhookDto } from "./dto/create-webhook.dto";
import { WebhooksService } from "./webhooks.service";

@Controller("webhooks")
@UseGuards(JwtAuthGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /** POST /webhooks
   *  Create a subscription. Response includes the freshly-generated
   *  HMAC `secret` exactly once — capture it now or rotate via
   *  delete + recreate. */
  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooks.create({
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      name: dto.name,
      url: dto.url,
      eventTypes: dto.eventTypes,
      processId: dto.processId,
    });
  }

  /** GET /webhooks
   *  List the tenant's subscriptions (secret omitted). */
  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.webhooks.list(req.user.tenantId);
  }

  /** DELETE /webhooks/:id
   *  Remove a subscription. Returns 204. */
  @Delete(":id")
  @HttpCode(204)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    await this.webhooks.remove(req.user.tenantId, id);
  }
}
