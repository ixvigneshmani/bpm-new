import {
  Injectable,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { UsersService } from "../users/users.service";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly failedAttempts = new Map<string, number[]>();

  constructor(
    private usersService: UsersService,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const key = email.trim().toLowerCase();

    if (this.isLocked(key)) {
      this.logger.warn(
        `auth-login-locked: email=${key} repeated failures within ${LOCKOUT_WINDOW_MS / 60000}m`,
      );
      throw new UnauthorizedException(
        "Account temporarily locked due to repeated failed attempts. Try again later.",
      );
    }

    const user = await this.usersService.findByEmail(email);

    if (!user || !user.passwordHash) {
      this.recordFailure(key, "unknown-user");
      throw new UnauthorizedException("Invalid email or password");
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      this.recordFailure(key, "bad-password");
      throw new UnauthorizedException("Invalid email or password");
    }

    if (!user.isActive) {
      this.recordFailure(key, "deactivated");
      throw new UnauthorizedException("Account is deactivated");
    }

    this.failedAttempts.delete(key);

    const roles = await this.usersService.getRoleKeys(user.id);

    const payload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      systemRole: user.role,
      roles,
    };

    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        systemRole: user.role,
        roles,
        tenantId: user.tenantId,
      },
    };
  }

  private isLocked(key: string): boolean {
    const cutoff = Date.now() - LOCKOUT_WINDOW_MS;
    const fresh = (this.failedAttempts.get(key) ?? []).filter((t) => t > cutoff);
    if (fresh.length !== (this.failedAttempts.get(key)?.length ?? 0)) {
      this.failedAttempts.set(key, fresh);
    }
    return fresh.length >= LOCKOUT_THRESHOLD;
  }

  private recordFailure(key: string, reason: string): void {
    const now = Date.now();
    const cutoff = now - LOCKOUT_WINDOW_MS;
    const bucket = (this.failedAttempts.get(key) ?? []).filter((t) => t > cutoff);
    bucket.push(now);
    this.failedAttempts.set(key, bucket);
    this.logger.warn(
      `auth-login-failed: email=${key} reason=${reason} attempts=${bucket.length}/${LOCKOUT_THRESHOLD}`,
    );
  }
}
