import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { CancelInstanceDto } from "./dto/cancel-instance.dto";
import { EngineService } from "./engine.service";
import { IdempotencyService } from "./idempotency.service";

@Controller("instances")
@UseGuards(JwtAuthGuard)
export class InstancesController {
  constructor(
    private readonly engine: EngineService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** GET /instances/:id
   *  Single-instance detail: state, variables, live tokens, last 50
   *  audit events. The debug + operability view. */
  @Get(":id")
  getInstance(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.engine.getInstance({
      instanceId: id,
      tenantId: req.user.tenantId,
    });
  }

  /** POST /instances/:id/cancel
   *  Cancel a running instance: cancels every live token, flips
   *  status to `cancelled`, emits an audit row. Idempotent — if the
   *  instance is already terminal we return its current state, no
   *  error.
   *
   *  Replay safety: pass `Idempotency-Key` to make retries safe. */
  @Post(":id/cancel")
  cancelInstance(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: CancelInstanceDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.idempotency.wrap({
      tenantId: req.user.tenantId,
      endpoint: "cancel-instance",
      key: idempotencyKey,
      requestBody: { instanceId: id, reason: dto.reason ?? null },
      handler: () =>
        this.engine.cancelInstance({
          instanceId: id,
          tenantId: req.user.tenantId,
          userId: req.user.sub,
          reason: dto.reason,
        }),
    });
  }
}
