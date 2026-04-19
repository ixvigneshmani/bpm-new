import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { AiService } from "./ai.service";
import { ScaffoldProcessDto } from "./dto/scaffold-process.dto";

@Controller("ai")
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** POST /ai/scaffold-process
   *  Turn a plain-language description into a canvas-ready
   *  {nodes, edges} payload. The frontend loads the result via
   *  `loadCanvasData` — user can accept, edit, or regenerate.
   *  Tenant-scoped via the JWT guard; rate-limited per tenant inside
   *  the service. */
  @Post("scaffold-process")
  scaffold(@Req() req: AuthenticatedRequest, @Body() dto: ScaffoldProcessDto) {
    return this.ai.scaffoldProcess({
      description: dto.description,
      businessDocSchema: dto.businessDocSchema,
      tenantId: req.user.tenantId,
      userId: req.user.sub,
    });
  }
}
