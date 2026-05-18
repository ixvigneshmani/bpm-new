/* ─── Connector Instances Service ───────────────────────────────────
 * CRUD over CONNECTOR_INSTANCES. Tenant-scoped on every read/write.
 * Secrets inside the JSONB `config` blob are encrypted at rest by
 * CryptoService — paths to encrypt come from the connector
 * definition's `secretFields`, so each connector decides which of its
 * fields are sensitive without the service having to know specifics.
 *
 * isDefault enforcement: at most one row per (tenantId, connectorType)
 * can carry isDefault=true. When a caller sets isDefault=true, this
 * service flips the prior default off in the same transaction. The
 * service also auto-promotes the first instance of a connector type
 * to the default — operators shouldn't have to remember "tick the box"
 * for the only Mail connection they have.
 * ──────────────────────────────────────────────────────────────────── */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { CryptoService } from "../common/crypto/crypto.service";
import { DATABASE, type Database } from "../database/database.module";
import { connectorInstances } from "../database/schema";
import { ConnectorRegistry, type ConnectorDefinition } from "./connector-registry";

const REDACTED = "<encrypted>";

export type ConnectionPublic = {
  id: string;
  connectorType: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  /** UI-safe config — secrets are replaced with `<encrypted>` strings,
   *  plus a parallel `_secretsSet` map indicating which secret fields
   *  have a value stored (so the UI can show "(••• stored)" hints). */
  config: Record<string, unknown>;
  secretsSet: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionDecrypted = Omit<ConnectionPublic, "config" | "secretsSet"> & {
  /** Plaintext config — secrets decrypted. Internal use only;
   *  controllers must never echo this. */
  config: Record<string, unknown>;
};

export type UpsertConnectionInput = {
  tenantId: string;
  userId: string;
  connectorType: string;
  name: string;
  /** Plaintext config from the caller. Secret-field values that come
   *  as `null` mean "keep the existing encrypted value"; non-null
   *  string means "overwrite (encrypt + replace)". */
  config: Record<string, unknown>;
  enabled?: boolean;
  isDefault?: boolean;
};

@Injectable()
export class ConnectorInstancesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly registry: ConnectorRegistry,
  ) {}

  async list(tenantId: string, connectorType?: string): Promise<ConnectionPublic[]> {
    const where = connectorType
      ? and(
          eq(connectorInstances.tenantId, tenantId),
          eq(connectorInstances.connectorType, connectorType),
        )
      : eq(connectorInstances.tenantId, tenantId);
    const rows = await this.db.select().from(connectorInstances).where(where);
    return rows.map((r) => this.toPublic(r));
  }

  async getPublic(tenantId: string, id: string): Promise<ConnectionPublic> {
    const row = await this.fetchRow(tenantId, id);
    return this.toPublic(row);
  }

  /** Internal: returns plaintext config for the dispatcher / test
   *  action. Throws if the connection is disabled — disabled means
   *  "do not use", and unifying that gate in one place keeps callers
   *  simple. */
  async getDecrypted(tenantId: string, id: string): Promise<ConnectionDecrypted> {
    const row = await this.fetchRow(tenantId, id);
    if (!row.enabled) {
      throw new BadRequestException(
        `Connection "${row.name}" is disabled. Re-enable it under Settings → Connections.`,
      );
    }
    const def = this.requireDefinition(row.connectorType);
    return {
      id: row.id,
      connectorType: row.connectorType,
      name: row.name,
      enabled: row.enabled,
      isDefault: row.isDefault,
      config: this.decryptConfig((row.config ?? {}) as Record<string, unknown>, def),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Resolve "default connection of this type for this tenant".
   *  Returns null when no default exists; the dispatcher surfaces a
   *  helpful error in that case. */
  async getDefault(tenantId: string, connectorType: string): Promise<ConnectionDecrypted | null> {
    const rows = await this.db
      .select()
      .from(connectorInstances)
      .where(
        and(
          eq(connectorInstances.tenantId, tenantId),
          eq(connectorInstances.connectorType, connectorType),
          eq(connectorInstances.isDefault, true),
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    return this.getDecrypted(tenantId, rows[0].id);
  }

  async create(input: UpsertConnectionInput): Promise<ConnectionPublic> {
    const def = this.requireDefinition(input.connectorType);
    await this.assertNameAvailable(input.tenantId, input.connectorType, input.name);

    // First instance of a type auto-promotes to default unless the
    // caller explicitly says otherwise. Removes a "why isn't my mail
    // sending?" footgun for tenants with one relay.
    const existing = await this.db
      .select()
      .from(connectorInstances)
      .where(
        and(
          eq(connectorInstances.tenantId, input.tenantId),
          eq(connectorInstances.connectorType, input.connectorType),
        ),
      );
    const isFirstOfType = existing.length === 0;
    const isDefault = input.isDefault ?? isFirstOfType;

    const encryptedConfig = this.encryptConfig(input.config, def);

    return this.db.transaction(async (tx) => {
      if (isDefault) {
        await tx
          .update(connectorInstances)
          .set({ isDefault: false, updatedAt: new Date(), updatedBy: input.userId })
          .where(
            and(
              eq(connectorInstances.tenantId, input.tenantId),
              eq(connectorInstances.connectorType, input.connectorType),
              eq(connectorInstances.isDefault, true),
            ),
          );
      }
      const [row] = await tx
        .insert(connectorInstances)
        .values({
          tenantId: input.tenantId,
          connectorType: input.connectorType,
          name: input.name,
          config: encryptedConfig,
          enabled: input.enabled ?? true,
          isDefault,
          updatedBy: input.userId,
        })
        .returning();
      // Fire the per-connector save hook (e.g. Mail clears its
      // breaker). Sync, intentionally — a misbehaving hook should
      // surface immediately rather than create an inconsistent state.
      def.onConnectionSaved?.(input.tenantId, row.id);
      return this.toPublic(row);
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: {
      userId: string;
      name?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
      isDefault?: boolean;
    },
  ): Promise<ConnectionPublic> {
    const existing = await this.fetchRow(tenantId, id);
    const def = this.requireDefinition(existing.connectorType);

    // Name change collides with another row? Reject with a clear
    // message rather than relying on the DB unique-index error.
    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertNameAvailable(tenantId, existing.connectorType, input.name, id);
    }

    // Merge incoming config with existing only when a config patch was
    // supplied. A PUT with no `config` keeps the stored blob verbatim.
    const incoming = input.config ?? {};
    const merged = input.config === undefined
      ? ((existing.config ?? {}) as Record<string, unknown>)
      : this.mergeConfigForUpdate(
      (existing.config ?? {}) as Record<string, unknown>,
      incoming,
      def,
    );

    return this.db.transaction(async (tx) => {
      const wantsDefault = input.isDefault ?? existing.isDefault;
      if (wantsDefault && !existing.isDefault) {
        await tx
          .update(connectorInstances)
          .set({ isDefault: false, updatedAt: new Date(), updatedBy: input.userId })
          .where(
            and(
              eq(connectorInstances.tenantId, tenantId),
              eq(connectorInstances.connectorType, existing.connectorType),
              eq(connectorInstances.isDefault, true),
            ),
          );
      }
      const [row] = await tx
        .update(connectorInstances)
        .set({
          name: input.name ?? existing.name,
          config: merged,
          enabled: input.enabled ?? existing.enabled,
          isDefault: wantsDefault,
          updatedBy: input.userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(connectorInstances.tenantId, tenantId),
            eq(connectorInstances.id, id),
          ),
        )
        .returning();
      def.onConnectionSaved?.(tenantId, row.id);
      return this.toPublic(row);
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const result = await this.db
      .delete(connectorInstances)
      .where(
        and(
          eq(connectorInstances.tenantId, tenantId),
          eq(connectorInstances.id, id),
        ),
      )
      .returning({ id: connectorInstances.id });
    if (result.length === 0) {
      throw new NotFoundException("Connection not found.");
    }
  }

  // ─── helpers ────────────────────────────────────────────────────

  private async fetchRow(tenantId: string, id: string) {
    const rows = await this.db
      .select()
      .from(connectorInstances)
      .where(
        and(
          eq(connectorInstances.tenantId, tenantId),
          eq(connectorInstances.id, id),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException("Connection not found.");
    }
    return rows[0];
  }

  private requireDefinition(connectorType: string): ConnectorDefinition {
    const def = this.registry.get(connectorType);
    if (!def) {
      throw new BadRequestException(
        `Unknown connector type "${connectorType}". Registered: ${this.registry.list().map((d) => d.id).join(", ") || "(none)"}.`,
      );
    }
    return def;
  }

  private async assertNameAvailable(
    tenantId: string,
    connectorType: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const rows = await this.db
      .select({ id: connectorInstances.id })
      .from(connectorInstances)
      .where(
        and(
          eq(connectorInstances.tenantId, tenantId),
          eq(connectorInstances.connectorType, connectorType),
          eq(connectorInstances.name, name),
        ),
      );
    const conflict = rows.find((r) => r.id !== excludeId);
    if (conflict) {
      throw new ConflictException(
        `A ${connectorType} connection named "${name}" already exists. Pick a different name.`,
      );
    }
  }

  private encryptConfig(
    plain: Record<string, unknown>,
    def: ConnectorDefinition,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...plain };
    for (const key of def.secretFields) {
      const v = plain[key];
      if (typeof v === "string" && v.length > 0) {
        out[key] = this.crypto.encrypt(v);
      } else if (v === null || v === undefined || v === "") {
        // Don't store an empty string as encrypted noise. Drop it.
        delete out[key];
      }
    }
    return out;
  }

  /** Update-time merge: caller's incoming config wins for non-secret
   *  fields. For secret fields, an explicit `null` (or omission) means
   *  "keep the existing encrypted value"; a non-empty string means
   *  "overwrite". Matches the I1 mail-settings password UX. */
  private mergeConfigForUpdate(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
    def: ConnectorDefinition,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...existing, ...incoming };
    const secrets = new Set(def.secretFields);
    for (const key of secrets) {
      const v = incoming[key];
      if (v === null || v === undefined) {
        // Keep existing encrypted value.
        if (existing[key] !== undefined) out[key] = existing[key];
        else delete out[key];
      } else if (typeof v === "string" && v.length === 0) {
        // Empty string from the UI also means "no change" (a blank
        // password field shouldn't wipe the stored one).
        if (existing[key] !== undefined) out[key] = existing[key];
        else delete out[key];
      } else if (typeof v === "string") {
        out[key] = this.crypto.encrypt(v);
      }
    }
    return out;
  }

  private decryptConfig(
    stored: Record<string, unknown>,
    def: ConnectorDefinition,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...stored };
    for (const key of def.secretFields) {
      const v = stored[key];
      if (typeof v === "string" && v.length > 0) {
        out[key] = this.crypto.decrypt(v);
      }
    }
    return out;
  }

  private toPublic(row: typeof connectorInstances.$inferSelect): ConnectionPublic {
    const def = this.registry.get(row.connectorType);
    const secretsSet: Record<string, boolean> = {};
    const safeConfig: Record<string, unknown> = { ...((row.config ?? {}) as Record<string, unknown>) };
    if (def) {
      for (const key of def.secretFields) {
        const has = typeof safeConfig[key] === "string" && (safeConfig[key] as string).length > 0;
        secretsSet[key] = has;
        if (has) safeConfig[key] = REDACTED;
      }
    }
    return {
      id: row.id,
      connectorType: row.connectorType,
      name: row.name,
      enabled: row.enabled,
      isDefault: row.isDefault,
      config: safeConfig,
      secretsSet,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
