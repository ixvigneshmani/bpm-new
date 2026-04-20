import {
  Body,
  Controller,
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

@Controller("processes")
@UseGuards(JwtAuthGuard)
export class EngineController {
  constructor(private readonly engine: EngineService) {}

  /** POST /processes/:id/instances
   *  Start a new instance of the given process and run it forward
   *  until it hits a wait state or terminates. E2: always terminates
   *  in-call (no wait states yet). Returns the new instance id +
   *  status so the UI can link straight to the instance detail page. */
  @Post(":id/instances")
  startInstance(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: StartInstanceDto,
  ) {
    return this.engine.startInstance({
      processId: id,
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      variables: dto.variables,
    });
  }
}
