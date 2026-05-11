import {
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { UsersService } from "../users/users.service";
import { DATABASE, type Database } from "../database/database.module";
import { sessions } from "../database/schema";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_BYTES = 32;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly failedAttempts = new Map<string, number[]>();

  constructor(
    private usersService: UsersService,
    private jwt: JwtService,
    @Inject(DATABASE) private db: Database,
  ) {}

  async login(email: string, password: string, ctx: SessionContext = {}) {
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

    return this.issueTokens(user, ctx);
  }

  async refresh(refreshToken: string, ctx: SessionContext = {}) {
    if (!refreshToken) {
      throw new UnauthorizedException("Refresh token required.");
    }
    const tokenHash = this.hashToken(refreshToken);

    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    if (!session) {
      throw new UnauthorizedException("Refresh token not recognized.");
    }

    // Theft detection: any reuse of a non-active session means an attacker
    // grabbed a refresh token. Nuke every active session for the user so
    // the attacker AND the legit user are both forced through full login.
    if (session.status !== "active") {
      this.logger.warn(
        `auth-refresh-reuse: userId=${session.userId} sessionId=${session.id} status=${session.status} — revoking all active sessions for user`,
      );
      await this.db
        .update(sessions)
        .set({ status: "revoked" })
        .where(
          and(eq(sessions.userId, session.userId), eq(sessions.status, "active")),
        );
      throw new UnauthorizedException("Refresh token reuse detected.");
    }

    if (session.expiresAt.getTime() < Date.now()) {
      await this.db
        .update(sessions)
        .set({ status: "expired" })
        .where(eq(sessions.id, session.id));
      throw new UnauthorizedException("Refresh token expired.");
    }

    const user = await this.usersService.findById(session.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Account is not available.");
    }

    // Revoke the old session, issue a new one. Standard refresh-token rotation.
    await this.db
      .update(sessions)
      .set({ status: "revoked" })
      .where(eq(sessions.id, session.id));

    return this.issueTokens(user, ctx);
  }

  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = this.hashToken(refreshToken);
    await this.db
      .update(sessions)
      .set({ status: "revoked" })
      .where(eq(sessions.tokenHash, tokenHash));
  }

  private async issueTokens(
    user: { id: string; tenantId: string; email: string; displayName: string; role: string },
    ctx: SessionContext,
  ) {
    const roles = await this.usersService.getRoleKeys(user.id);

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      systemRole: user.role,
      roles,
    });

    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.db.insert(sessions).values({
      userId: user.id,
      tenantId: user.tenantId,
      tokenHash,
      status: "active",
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
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

  private hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
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
