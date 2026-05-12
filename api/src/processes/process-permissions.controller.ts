import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { ProcessPermissionsService } from "../permissions/process-permissions.service";
import { GrantPermissionDto } from "./dto/grant-permission.dto";

@Controller("processes/:id/permissions")
@UseGuards(JwtAuthGuard)
export class ProcessPermissionsController {
  constructor(private readonly perms: ProcessPermissionsService) {}

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.perms.assert(
      {
        userId: req.user.sub,
        tenantId: req.user.tenantId,
        systemRole: req.user.systemRole,
        roles: req.user.roles ?? [],
      },
      id,
      "admin",
    );
    return this.perms.list(req.user.tenantId, id);
  }

  @Post()
  async grant(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GrantPermissionDto,
  ) {
    await this.perms.assert(
      {
        userId: req.user.sub,
        tenantId: req.user.tenantId,
        systemRole: req.user.systemRole,
        roles: req.user.roles ?? [],
      },
      id,
      "admin",
    );
    return this.perms.grant({
      tenantId: req.user.tenantId,
      processId: id,
      granteeType: dto.granteeType,
      granteeId: dto.granteeId,
      permission: dto.permission,
      grantedBy: req.user.sub,
    });
  }

  @Delete(":grantId")
  async revoke(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("grantId", ParseUUIDPipe) grantId: string,
  ) {
    await this.perms.assert(
      {
        userId: req.user.sub,
        tenantId: req.user.tenantId,
        systemRole: req.user.systemRole,
        roles: req.user.roles ?? [],
      },
      id,
      "admin",
    );
    return this.perms.revoke({
      tenantId: req.user.tenantId,
      processId: id,
      grantId,
      actorUserId: req.user.sub,
    });
  }

  /** H1 — audit trail. Available to anyone with `admin` on the process
   *  (same gate as the grant endpoints). Newest first. */
  @Get("audit")
  async audit(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.perms.assert(
      {
        userId: req.user.sub,
        tenantId: req.user.tenantId,
        systemRole: req.user.systemRole,
        roles: req.user.roles ?? [],
      },
      id,
      "admin",
    );
    return this.perms.listAudit(req.user.tenantId, id);
  }
}
