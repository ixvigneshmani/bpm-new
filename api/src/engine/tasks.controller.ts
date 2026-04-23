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
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { CompleteTaskDto } from "./dto/complete-task.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
import { EngineService } from "./engine.service";
import { IdempotencyService } from "./idempotency.service";

@Controller("tasks")
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(
    private readonly engine: EngineService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** GET /tasks            → claim-first inbox (mine ∪ claimable by my roles)
   *  GET /tasks?assignedTo=<uuid> → exact-assignee view
   *  Tenant-scoped via the JWT guard. Returns up to 200 newest tasks. */
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListTasksDto,
  ) {
    return this.engine.listTasks({
      tenantId: req.user.tenantId,
      assignedTo: query.assignedTo,
      userIdForMine: query.assignedTo ? undefined : req.user.sub,
      userRoles: req.user.roles ?? [],
    });
  }

  /** POST /tasks/:id/claim
   *  Assigns the waiting task to the caller. Role-gated tokens require
   *  the caller to hold the candidateRole; otherwise 403. Idempotent if
   *  caller is already the assignee. */
  @Post(":id/claim")
  claim(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.engine.claimTask({
      tokenId: id,
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      userRoles: req.user.roles ?? [],
    });
  }

  /** POST /tasks/:id/unclaim
   *  Releases the caller's claim on a role-assigned task, returning it
   *  to the role queue. No-op (returns {unclaimed:false}) if the caller
   *  isn't the claimant — so mobile/network retries don't 403. */
  @Post(":id/unclaim")
  unclaim(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.engine.unclaimTask({
      tokenId: id,
      tenantId: req.user.tenantId,
      userId: req.user.sub,
    });
  }

  /** POST /tasks/:id/complete
   *  Requires ASSIGNED_TO === caller for role-assigned tasks. Merges
   *  `formData` into instance variables, advances the token, returns
   *  new instance + token status. Use an `Idempotency-Key` header for
   *  retry-safe submission. */
  @Post(":id/complete")
  complete(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteTaskDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.idempotency.wrap({
      tenantId: req.user.tenantId,
      endpoint: "complete-task",
      key: idempotencyKey,
      requestBody: { tokenId: id, formData: dto.formData ?? null },
      handler: () =>
        this.engine.completeTask({
          tokenId: id,
          tenantId: req.user.tenantId,
          userId: req.user.sub,
          formData: dto.formData,
        }),
    });
  }
}
