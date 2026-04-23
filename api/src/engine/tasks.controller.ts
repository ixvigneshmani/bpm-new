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
}
