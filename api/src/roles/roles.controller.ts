import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  ForbiddenException,
  ParseUUIDPipe,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesService } from "./roles.service";
import { CreateRoleDto } from "./dto/create-role.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { AuthenticatedRequest } from "../common/types/authenticated-request";

/** Any authenticated member can read roles (needed by the canvas role
 *  picker + task inbox). Mutations require platform owner/admin. */
function assertAdmin(req: AuthenticatedRequest) {
  if (req.user.systemRole !== "owner" && req.user.systemRole !== "admin") {
    throw new ForbiddenException("Only owner or admin may modify roles");
  }
}

@Controller("roles")
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.roles.list(req.user.tenantId);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRoleDto) {
    assertAdmin(req);
    return this.roles.create(req.user.tenantId, dto);
  }

  @Patch(":id")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    assertAdmin(req);
    return this.roles.update(req.user.tenantId, id, dto);
  }

  @Delete(":id")
  remove(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    assertAdmin(req);
    return this.roles.remove(req.user.tenantId, id);
  }

  @Get(":id/members")
  members(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.roles.members(req.user.tenantId, id);
  }

  @Post(":roleId/users/:userId")
  assign(
    @Req() req: AuthenticatedRequest,
    @Param("roleId", ParseUUIDPipe) roleId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    assertAdmin(req);
    return this.roles.assign(req.user.tenantId, roleId, userId, req.user.sub);
  }

  @Delete(":roleId/users/:userId")
  revoke(
    @Req() req: AuthenticatedRequest,
    @Param("roleId", ParseUUIDPipe) roleId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    assertAdmin(req);
    return this.roles.revoke(req.user.tenantId, roleId, userId);
  }
}
