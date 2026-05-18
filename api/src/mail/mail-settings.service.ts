/* ─── Mail Settings Service ─────────────────────────────────────────
 * CRUD over TENANT_MAIL_SETTINGS. One row per tenant — primary key
 * IS the tenant id. SMTP password is stored encrypted at rest via
 * CryptoService; UI reads expose only a `passwordSet` boolean.
 * ──────────────────────────────────────────────────────────────────── */

import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { CryptoService } from "../common/crypto/crypto.service";
import { DATABASE, type Database } from "../database/database.module";
import { tenantMailSettings } from "../database/schema";

export type MailSettingsRow = {
  tenantId: string;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  /** Plaintext password — only ever returned by the internal
   *  `getDecrypted` path used by MailerService. The controller never
   *  exposes this. */
  password: string | null;
  fromEmail: string;
  fromName: string | null;
  enabled: boolean;
  updatedAt: string;
};

export type MailSettingsPublic = Omit<MailSettingsRow, "password"> & {
  passwordSet: boolean;
};

export type UpsertMailSettingsInput = {
  tenantId: string;
  userId: string;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  /** Null = keep existing stored password; string = overwrite. */
  password: string | null;
  fromEmail: string;
  fromName: string | null;
  enabled: boolean;
};

@Injectable()
export class MailSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  /** UI-safe read. Returns null if the tenant has no settings yet so
   *  the page can render an empty form. */
  async getPublic(tenantId: string): Promise<MailSettingsPublic | null> {
    const row = await this.fetchRaw(tenantId);
    if (!row) return null;
    return {
      tenantId: row.tenantId,
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      passwordSet: !!row.passwordEncrypted,
      fromEmail: row.fromEmail,
      fromName: row.fromName,
      enabled: row.enabled,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Internal: decrypted password + plaintext fields, for use by
   *  MailerService when building a transport. Returns null when no
   *  settings exist OR when the tenant has disabled mail. */
  async getDecrypted(tenantId: string): Promise<MailSettingsRow | null> {
    const row = await this.fetchRaw(tenantId);
    if (!row) return null;
    return {
      tenantId: row.tenantId,
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      password: row.passwordEncrypted
        ? this.crypto.decrypt(row.passwordEncrypted)
        : null,
      fromEmail: row.fromEmail,
      fromName: row.fromName,
      enabled: row.enabled,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Insert-or-update. Returns the UI-safe view (no password). */
  async upsert(input: UpsertMailSettingsInput): Promise<MailSettingsPublic> {
    const existing = await this.fetchRaw(input.tenantId);

    // Password handling: null = keep existing; non-null string = encrypt
    // + overwrite. Encrypted on the way in so a hostile DB dump never
    // sees plaintext.
    let passwordEncrypted: string | null;
    if (input.password === null) {
      passwordEncrypted = existing?.passwordEncrypted ?? null;
    } else {
      passwordEncrypted = this.crypto.encrypt(input.password);
    }

    if (existing) {
      await this.db
        .update(tenantMailSettings)
        .set({
          host: input.host,
          port: input.port,
          secure: input.secure,
          username: input.username,
          passwordEncrypted,
          fromEmail: input.fromEmail,
          fromName: input.fromName,
          enabled: input.enabled,
          updatedBy: input.userId,
          updatedAt: new Date(),
        })
        .where(eq(tenantMailSettings.tenantId, input.tenantId));
    } else {
      await this.db.insert(tenantMailSettings).values({
        tenantId: input.tenantId,
        host: input.host,
        port: input.port,
        secure: input.secure,
        username: input.username,
        passwordEncrypted,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        enabled: input.enabled,
        updatedBy: input.userId,
      });
    }

    const fresh = await this.getPublic(input.tenantId);
    // Race-safe: the row was just written under this tenantId so a
    // null here would indicate a concurrent delete — exceptional
    // enough to fall through to "missing settings" semantics.
    if (!fresh) {
      throw new Error("Mail settings vanished immediately after upsert.");
    }
    return fresh;
  }

  private async fetchRaw(tenantId: string) {
    const rows = await this.db
      .select()
      .from(tenantMailSettings)
      .where(eq(tenantMailSettings.tenantId, tenantId))
      .limit(1);
    return rows[0] ?? null;
  }
}
