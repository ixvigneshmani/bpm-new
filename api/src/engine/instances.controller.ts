import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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

  /** GET /instances?status=<status>
   *  Tenant-wide list of instances (newest first, capped at 200).
   *  Optional `status` query filters to one of running/completed/
   *  failed/cancelled. Used by the "Running" page to show what's in
   *  flight without picking a process first. */
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query("status") status?: string,
  ) {
    const allowed = ["running", "completed", "failed", "cancelled"] as const;
    if (status && !allowed.includes(status as (typeof allowed)[number])) {
      throw new BadRequestException(
        `status must be one of: ${allowed.join(", ")}`,
      );
    }
    return this.engine.listInstancesForTenant({
      tenantId: req.user.tenantId,
      status: status as (typeof allowed)[number] | undefined,
    });
  }

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
