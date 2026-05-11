import {
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
import { resolveActingFor } from "../auth/acting-for";
import { UsersService } from "../users/users.service";
import { ProcessPermissionsService } from "../permissions/process-permissions.service";
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
    private readonly users: UsersService,
    private readonly permissions: ProcessPermissionsService,
  ) {}

  private callerCtx(req: AuthenticatedRequest) {
    return {
      userId: req.user.sub,
      tenantId: req.user.tenantId,
      systemRole: req.user.systemRole,
      roles: req.user.roles ?? [],
    };
  }

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
  async startInstance(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: StartInstanceDto,
    @Query("testRun") testRunParam?: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    await this.permissions.assert(this.callerCtx(req), id, "start");
    const effective = await resolveActingFor(req, this.users);
    const testRun = testRunParam === "true" || testRunParam === "1";
    return this.idempotency.wrap({
      tenantId: req.user.tenantId,
      endpoint: "start-instance",
      key: idempotencyKey,
      // actingBy + testRun are part of the idempotency body so the
      // same key + body combo collapses correctly across replays.
      requestBody: {
        processId: id,
        variables: dto.variables ?? null,
        businessKey: dto.businessKey ?? null,
        actingBy: effective.actingBy,
        testRun,
      },
      handler: () =>
        this.engine.startInstance({
          processId: id,
          tenantId: req.user.tenantId,
          userId: effective.userId,
          actingBy: effective.actingBy,
          variables: dto.variables,
          businessKey: dto.businessKey,
          testRun,
        }),
    });
  }

  /** GET /processes/:id/instances
   *  List instances of a process for the tenant, newest first. Capped
   *  at 200 — pagination is an E7 perf concern. */
  @Get(":id/instances")
  async listInstancesForProcess(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.permissions.assert(this.callerCtx(req), id, "view");
    return this.engine.listInstancesForProcess({
      processId: id,
      tenantId: req.user.tenantId,
    });
  }
}
