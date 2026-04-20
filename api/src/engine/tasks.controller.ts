import {
  Body,
  Controller,
  Get,
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

@Controller("tasks")
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly engine: EngineService) {}

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
   *  the instance variable bag with optimistic locking. */
  @Post(":id/complete")
  complete(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteTaskDto,
  ) {
    return this.engine.completeTask({
      tokenId: id,
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      formData: dto.formData,
    });
  }
}
