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

  /** GET /tasks            → "my inbox" (assigned to me OR unassigned)
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
      // Default mode: caller's inbox (mine + unassigned). Switching to
      // a different `assignedTo` makes the explicit filter take over.
      userIdForMine: query.assignedTo ? undefined : req.user.sub,
    });
  }

  /** POST /tasks/:id/complete
   *  Submits the form output for a waiting user-task token, advances
   *  the token off the user-task node, and returns the new instance
   *  + token status. The body's `formData` (optional) is merged into
   *  the instance variable bag with optimistic locking.
   *
   *  Replay safety: pass `Idempotency-Key` to make retries idempotent
   *  — without this, a network retry would 409 against the optimistic
   *  lock (since the original request already advanced the token);
   *  with it, the retry returns the original response. */
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
