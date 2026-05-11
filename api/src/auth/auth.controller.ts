import { Controller, Post, Body, Get, UseGuards, Req } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { LoginThrottleGuard } from "./login-throttle.guard";
import { LoginDto } from "./dto/login.dto";
import { AuthenticatedRequest } from "../common/types/authenticated-request";

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @UseGuards(LoginThrottleGuard)
  @Post("login")
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async me(@Req() req: AuthenticatedRequest) {
    return {
      user: {
        id: req.user.sub,
        email: req.user.email,
        displayName: req.user.displayName,
        systemRole: req.user.systemRole,
        roles: req.user.roles,
        tenantId: req.user.tenantId,
      },
    };
  }
}
