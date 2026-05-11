import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { UsersService } from "../users/users.service";
import { MfaService } from "./mfa.service";
import { DATABASE, type Database } from "../database/database.module";
import { sessions, mfaRecoveryCodes, users as usersTable, tenants } from "../database/schema";

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
    private mfaService: MfaService,
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

    if (user.mfaEnabled) {
      const mfaChallenge = await this.jwt.signAsync(
        { sub: user.id, mfaPending: true },
        { expiresIn: "5m" },
      );
      return { mfaChallenge, expiresIn: 300 } as const;
    }

    return this.issueTokens(user, ctx);
  }

  async mfaLogin(
    challenge: string,
    code: string,
    ctx: SessionContext = {},
  ) {
    let payload: { sub?: string; mfaPending?: boolean };
    try {
      payload = await this.jwt.verifyAsync(challenge);
    } catch {
      throw new UnauthorizedException("MFA challenge expired or invalid.");
    }
    if (!payload?.mfaPending || !payload.sub) {
      throw new UnauthorizedException("Not an MFA challenge token.");
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive || !user.mfaEnabled || !user.mfaSecret) {
      throw new UnauthorizedException("Account not eligible for MFA login.");
    }
    const key = user.email.trim().toLowerCase();
    if (this.isLocked(key)) {
      this.logger.warn(`auth-mfa-locked: userId=${user.id}`);
      throw new UnauthorizedException(
        "Account temporarily locked due to repeated failed attempts. Try again later.",
      );
    }
    const valid = await this.mfaService.consumeOtpOrRecovery(
      user.id,
      user.mfaSecret,
      code,
    );
    if (!valid) {
      this.recordFailure(key, "bad-mfa-code");
      throw new UnauthorizedException("Invalid MFA code.");
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

  async listSessions(userId: string) {
    const rows = await this.db
      .select({
        id: sessions.id,
        ipAddress: sessions.ipAddress,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.status, "active")));
    return rows;
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    // Tenant-scoped by userId — a user can only revoke their own
    // sessions. The WHERE clause covers both ownership and existence.
    const result = await this.db
      .update(sessions)
      .set({ status: "revoked" })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
    void result;
  }

  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = this.hashToken(refreshToken);
    await this.db
      .update(sessions)
      .set({ status: "revoked" })
      .where(eq(sessions.tokenHash, tokenHash));
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException("Account is not available.");
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      this.logger.warn(`auth-password-change-failed: userId=${userId} reason=bad-current`);
      throw new UnauthorizedException("Current password is incorrect.");
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException("New password must differ from current.");
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    await this.usersService.setPasswordHash(userId, newHash);
    await this.revokeAllSessionsFor(userId);
    this.logger.warn(`auth-password-changed: userId=${userId}`);
  }

  async adminResetPassword(
    actorId: string,
    actorSystemRole: string,
    actorTenantId: string,
    targetUserId: string,
  ): Promise<{ temporaryPassword: string }> {
    if (actorSystemRole !== "owner" && actorSystemRole !== "admin") {
      throw new ForbiddenException("Only owner / admin may reset passwords.");
    }
    const target = await this.usersService.findById(targetUserId);
    if (!target || target.tenantId !== actorTenantId) {
      throw new NotFoundException("User not found.");
    }
    const temporaryPassword = this.generateTemporaryPassword();
    const newHash = await bcrypt.hash(temporaryPassword, 10);
    await this.usersService.setPasswordHash(targetUserId, newHash);
    await this.revokeAllSessionsFor(targetUserId);
    // Also clear MFA so an admin reset can rescue a user who lost both
    // their authenticator device AND every recovery code (otherwise the
    // password reset doesn't help — they still can't satisfy the MFA
    // challenge). They'll re-enroll MFA after first login if they want.
    await this.db
      .update(usersTable)
      .set({ mfaEnabled: false, mfaSecret: null })
      .where(eq(usersTable.id, targetUserId));
    await this.db
      .delete(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, targetUserId));
    // Clear any in-memory lockout so the user can sign in immediately
    // with the temporary password.
    this.failedAttempts.delete(target.email.trim().toLowerCase());
    this.logger.warn(
      `auth-password-admin-reset: actor=${actorId} target=${targetUserId}`,
    );
    return { temporaryPassword };
  }

  private async revokeAllSessionsFor(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ status: "revoked" })
      .where(and(eq(sessions.userId, userId), eq(sessions.status, "active")));
  }

  /** 16-char temporary password drawn from an unambiguous alphabet
   *  (no 0/O/1/l). Meets the same min-8 + letter + digit policy. */
  private generateTemporaryPassword(): string {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const bytes = randomBytes(16);
    let pw = "";
    for (let i = 0; i < 16; i++) {
      pw += alphabet[bytes[i] % alphabet.length];
    }
    // Force at least one letter + one digit so the policy holds on every draw.
    if (!/[a-zA-Z]/.test(pw)) pw = "A" + pw.slice(1);
    if (!/[0-9]/.test(pw)) pw = pw.slice(0, -1) + "2";
    return pw;
  }

  private async issueTokens(
    user: { id: string; tenantId: string; email: string; displayName: string; role: string },
    ctx: SessionContext,
  ) {
    const roles = await this.usersService.getRoleKeys(user.id);

    const [tenant] = await this.db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, user.tenantId))
      .limit(1);
    const tenantName = tenant?.name ?? null;

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      tenantId: user.tenantId,
      tenantName,
      email: user.email,
      displayName: user.displayName,
      systemRole: user.role,
      roles,
      // jti makes the token unique even when two issuances land in the
      // same second (otherwise the JWT signature is deterministic and a
      // rapid refresh would mint an identical string).
      jti: randomBytes(8).toString("hex"),
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
        tenantName,
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
