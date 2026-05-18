import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { UsersService } from "./users.service";
import { ProcessPermissionsService } from "../permissions/process-permissions.service";

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly permissions: ProcessPermissionsService,
  ) {}

  /** Admin-only. Used by the Act-as picker in the web console so an
   *  operator can select an impersonation target. Returns users in
   *  the caller's tenant only — tenant isolation enforced in the
   *  service query. */
  @Get()
  list(@Req() req: AuthenticatedRequest) {
    if (req.user.systemRole !== "owner" && req.user.systemRole !== "admin") {
      throw new ForbiddenException("Admin-only.");
    }
    return this.users.listForTenant(req.user.tenantId);
  }

  /** OS1 / H2 — narrower endpoint for the Permissions page picker.
   *  Available to anyone with `admin` permission on the given process
   *  (which by definition includes system owners/admins via the OS1
   *  escape hatch). Lets a delegated process-admin grant access
   *  without needing tenant-wide user-list privileges. */
  @Get("grantable/:processId")
  async grantable(
    @Req() req: AuthenticatedRequest,
    @Param("processId", ParseUUIDPipe) processId: string,
  ) {
    await this.permissions.assert(
      {
        userId: req.user.sub,
        tenantId: req.user.tenantId,
        systemRole: req.user.systemRole,
        roles: req.user.roles ?? [],
      },
      processId,
      "admin",
    );
    return this.users.listForTenant(req.user.tenantId);
  }

  /** Designer Sweep A — tenant users visible to anyone with `edit` on
   *  the given process. Drives the userTask `directUser` picker so
   *  designers don't have to paste UUIDs. */
  @Get("assignable/:processId")
  async assignable(
    @Req() req: AuthenticatedRequest,
    @Param("processId", ParseUUIDPipe) processId: string,
  ) {
    await this.permissions.assert(
      {
        userId: req.user.sub,
        tenantId: req.user.tenantId,
        systemRole: req.user.systemRole,
        roles: req.user.roles ?? [],
      },
      processId,
      "edit",
    );
    return this.users.listForTenant(req.user.tenantId);
  }
}
