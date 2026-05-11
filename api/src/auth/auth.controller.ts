import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { MfaService } from "./mfa.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { LoginThrottleGuard } from "./login-throttle.guard";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { AdminResetPasswordDto } from "./dto/admin-reset-password.dto";
import { MfaCodeDto, MfaLoginDto } from "./dto/mfa.dto";
import { AuthenticatedRequest } from "../common/types/authenticated-request";

@Controller("auth")
export class AuthController {
  constructor(
    private authService: AuthService,
    private mfaService: MfaService,
  ) {}

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

  @Post("mfa/login")
  async mfaLogin(@Body() dto: MfaLoginDto, @Req() req: { ip?: string; headers?: Record<string, string | undefined> }) {
    return this.authService.mfaLogin(dto.mfaChallenge, dto.code, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.["user-agent"] ?? null,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post("mfa/enroll")
  async mfaEnroll(@Req() req: AuthenticatedRequest) {
    return this.mfaService.enroll(req.user.sub, req.user.email);
  }

  @UseGuards(JwtAuthGuard)
  @Post("mfa/verify")
  async mfaVerify(@Body() dto: MfaCodeDto, @Req() req: AuthenticatedRequest) {
    return this.mfaService.verifyEnrollment(req.user.sub, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post("mfa/disable")
  @HttpCode(HttpStatus.NO_CONTENT)
  async mfaDisable(@Body() dto: MfaCodeDto, @Req() req: AuthenticatedRequest) {
    await this.mfaService.disable(req.user.sub, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post("password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.authService.changePassword(
      req.user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post("admin-reset")
  async adminReset(
    @Body() dto: AdminResetPasswordDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.authService.adminResetPassword(
      req.user.sub,
      req.user.systemRole,
      req.user.tenantId,
      dto.userId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get("sessions")
  async listSessions(@Req() req: AuthenticatedRequest) {
    const sessions = await this.authService.listSessions(req.user.sub);
    return { sessions };
  }

  @UseGuards(JwtAuthGuard)
  @Delete("sessions/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.authService.revokeSession(req.user.sub, id);
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
        tenantName: (req.user as { tenantName?: string | null }).tenantName ?? null,
      },
    };
  }
}
