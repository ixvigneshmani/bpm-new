import { Controller, ForbiddenException, Get, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedRequest } from "../common/types/authenticated-request";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

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
}
