import {
  Controller,
  Post,
  Body,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { LoginThrottleGuard } from "./login-throttle.guard";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { AuthenticatedRequest } from "../common/types/authenticated-request";

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @UseGuards(LoginThrottleGuard)
  @Post("login")
  async login(@Body() dto: LoginDto, @Req() req: { ip?: string; headers?: Record<string, string | undefined> }) {
    return this.authService.login(dto.email, dto.password, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.["user-agent"] ?? null,
    });
  }

  @Post("refresh")
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: { ip?: string; headers?: Record<string, string | undefined> }) {
    return this.authService.refresh(dto.refreshToken, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.["user-agent"] ?? null,
    });
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
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
