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
import { StartInstanceDto } from "./dto/start-instance.dto";
import { EngineService } from "./engine.service";
import { IdempotencyService } from "./idempotency.service";

@Controller("processes")
@UseGuards(JwtAuthGuard)
export class EngineController {
  constructor(
    private readonly engine: EngineService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** POST /processes/:id/instances
   *  Start a new instance of the given process and run it forward
   *  until it hits a wait state or terminates. Returns the new
   *  instance id + status so the UI can link straight to the instance
   *  detail page.
   *
   *  Replay safety: pass `Idempotency-Key: <uuid>` header to make
   *  retries idempotent — a second request with the same key + body
   *  returns the original response without starting a duplicate. */
  @Post(":id/instances")
  startInstance(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: StartInstanceDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.idempotency.wrap({
      tenantId: req.user.tenantId,
      endpoint: "start-instance",
      key: idempotencyKey,
      requestBody: { processId: id, variables: dto.variables ?? null },
      handler: () =>
        this.engine.startInstance({
          processId: id,
          tenantId: req.user.tenantId,
          userId: req.user.sub,
          variables: dto.variables,
        }),
    });
  }

  /** GET /processes/:id/instances
   *  List instances of a process for the tenant, newest first. Capped
   *  at 200 — pagination is an E7 perf concern. */
  @Get(":id/instances")
  listInstancesForProcess(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.engine.listInstancesForProcess({
      processId: id,
      tenantId: req.user.tenantId,
    });
  }
}
