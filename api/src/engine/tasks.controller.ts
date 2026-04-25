import {
  Body,
  Controller,
  ForbiddenException,
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
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { CompleteTaskDto } from "./dto/complete-task.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
import { ReassignTaskDto } from "./dto/reassign-task.dto";
import { SkipTaskDto } from "./dto/skip-task.dto";
import { EngineService } from "./engine.service";
import { IdempotencyService } from "./idempotency.service";

function assertAdmin(req: AuthenticatedRequest) {
  if (req.user.systemRole !== "owner" && req.user.systemRole !== "admin") {
    throw new ForbiddenException("Only owner or admin may perform this action.");
  }
}

@Controller("tasks")
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(
    private readonly engine: EngineService,
    private readonly idempotency: IdempotencyService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListTasksDto,
  ) {
    // Act-as: an admin can pass X-Acting-For to view a target user's
    // inbox. listTasks is read-only so the roles shown are the target's.
    const effective = await resolveActingFor(req, this.users);
    return this.engine.listTasks({
      tenantId: req.user.tenantId,
      assignedTo: query.assignedTo,
      userIdForMine: query.assignedTo ? undefined : effective.userId,
      userRoles: effective.roles,
    });
  }

  @Post(":id/claim")
  async claim(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const effective = await resolveActingFor(req, this.users);
    return this.engine.claimTask({
      tokenId: id,
      tenantId: req.user.tenantId,
      userId: effective.userId,
      userRoles: effective.roles,
      actingBy: effective.actingBy,
    });
  }

  @Post(":id/unclaim")
  async unclaim(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const effective = await resolveActingFor(req, this.users);
    return this.engine.unclaimTask({
      tokenId: id,
      tenantId: req.user.tenantId,
      userId: effective.userId,
      actingBy: effective.actingBy,
    });
  }

  @Post(":id/complete")
  async complete(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteTaskDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const effective = await resolveActingFor(req, this.users);
    return this.idempotency.wrap({
      tenantId: req.user.tenantId,
      endpoint: "complete-task",
      key: idempotencyKey,
      // actingBy is part of the idempotency body so the same key
      // replayed with/without impersonation doesn't silently collide.
      requestBody: {
        tokenId: id,
        formData: dto.formData ?? null,
        actingBy: effective.actingBy,
      },
      handler: () =>
        this.engine.completeTask({
          tokenId: id,
          tenantId: req.user.tenantId,
          userId: effective.userId,
          actingBy: effective.actingBy,
          formData: dto.formData,
        }),
    });
  }

  /** Admin-only. Re-assign a waiting userTask to a different user.
   *  X-Acting-For is intentionally NOT honoured here: an admin
   *  impersonating a non-admin shouldn't gain reassign powers via the
   *  impersonation header. The audit trail records the admin's id. */
  @Post(":id/reassign")
  async reassign(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: ReassignTaskDto,
  ) {
    assertAdmin(req);
    return this.engine.reassignTask({
      tokenId: id,
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      targetUserId: dto.userId,
    });
  }

  /** Admin-only. Skip a waiting userTask without form data — advances
   *  the token past the current node. Use to unblock instances whose
   *  assignee is unavailable when reassign isn't appropriate. */
  @Post(":id/skip")
  async skip(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SkipTaskDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    assertAdmin(req);
    return this.idempotency.wrap({
      tenantId: req.user.tenantId,
      endpoint: "skip-task",
      key: idempotencyKey,
      requestBody: { tokenId: id, reason: dto.reason ?? null },
      handler: () =>
        this.engine.skipTask({
          tokenId: id,
          tenantId: req.user.tenantId,
          userId: req.user.sub,
          reason: dto.reason ?? null,
        }),
    });
  }
}
