import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { generateSecret, generateURI, verify } from "otplib";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import { users, mfaRecoveryCodes } from "../database/schema";

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 5;
const ISSUER = "FlowPro";

// ±1 step (30s each side) of tolerance for clock drift.
const EPOCH_TOLERANCE: [number, number] = [30, 30];

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(@Inject(DATABASE) private db: Database) {}

  async enroll(
    userId: string,
    email: string,
  ): Promise<{ secret: string; otpauthUrl: string; alreadyEnabled: boolean }> {
    const [user] = await this.db
      .select({ mfaEnabled: users.mfaEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new UnauthorizedException("Account is not available.");
    if (user.mfaEnabled) {
      throw new ConflictException("MFA is already enabled for this account.");
    }
    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: ISSUER, label: email, secret });
    await this.db
      .update(users)
      .set({ mfaSecret: secret })
      .where(eq(users.id, userId));
    return { secret, otpauthUrl, alreadyEnabled: false };
  }

  async verifyEnrollment(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const [user] = await this.db
      .select({ mfaEnabled: users.mfaEnabled, mfaSecret: users.mfaSecret })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || !user.mfaSecret) {
      throw new BadRequestException("Start enrollment before verifying.");
    }
    if (user.mfaEnabled) {
      throw new ConflictException("MFA is already enabled.");
    }
    const result = await verify({
      token: code,
      secret: user.mfaSecret,
      epochTolerance: EPOCH_TOLERANCE,
    });
    if (!result.valid) {
      throw new UnauthorizedException("Invalid verification code.");
    }
    await this.db
      .update(users)
      .set({ mfaEnabled: true })
      .where(eq(users.id, userId));
    const recoveryCodes = await this.regenerateRecoveryCodes(userId);
    this.logger.warn(`mfa-enrolled: userId=${userId}`);
    return { recoveryCodes };
  }

  async disable(userId: string, code: string): Promise<void> {
    const [user] = await this.db
      .select({ mfaEnabled: users.mfaEnabled, mfaSecret: users.mfaSecret })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new BadRequestException("MFA is not enabled.");
    }
    if (!(await this.consumeOtpOrRecovery(userId, user.mfaSecret, code))) {
      throw new UnauthorizedException("Invalid code.");
    }
    await this.db
      .update(users)
      .set({ mfaEnabled: false, mfaSecret: null })
      .where(eq(users.id, userId));
    await this.db
      .delete(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, userId));
    this.logger.warn(`mfa-disabled: userId=${userId}`);
  }

  /** Validate a code at login (or for disable). TOTP first; if that
   *  fails, try recovery codes (case-insensitive, hyphens stripped).
   *  Recovery codes are consumed on success. Returns true if valid. */
  async consumeOtpOrRecovery(
    userId: string,
    secret: string,
    code: string,
  ): Promise<boolean> {
    const clean = code.replace(/[-\s]/g, "");
    if (/^\d{6}$/.test(clean)) {
      const result = await verify({
        token: clean,
        secret,
        epochTolerance: EPOCH_TOLERANCE,
      });
      if (result.valid) return true;
    }
    const codeHash = this.hashRecovery(clean.toUpperCase());
    const rows = await this.db
      .select({ id: mfaRecoveryCodes.id })
      .from(mfaRecoveryCodes)
      .where(
        and(
          eq(mfaRecoveryCodes.userId, userId),
          eq(mfaRecoveryCodes.codeHash, codeHash),
          isNull(mfaRecoveryCodes.usedAt),
        ),
      )
      .limit(1);
    if (rows.length === 0) return false;
    await this.db
      .update(mfaRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(eq(mfaRecoveryCodes.id, rows[0].id));
    this.logger.warn(`mfa-recovery-used: userId=${userId}`);
    return true;
  }

  private async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    await this.db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    const plaintext: string[] = [];
    const rows: { userId: string; codeHash: string }[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const raw = randomBytes(RECOVERY_CODE_BYTES).toString("hex").toUpperCase();
      const formatted = `${raw.slice(0, 5)}-${raw.slice(5)}`;
      plaintext.push(formatted);
      rows.push({ userId, codeHash: this.hashRecovery(raw) });
    }
    await this.db.insert(mfaRecoveryCodes).values(rows);
    return plaintext;
  }

  private hashRecovery(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }
}
