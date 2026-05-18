/* ─── I4 Sprint 2 — Mail settings → Mail connector migrator ─────────
 * One-shot data migrator. For every row in TENANT_MAIL_SETTINGS,
 * insert (or update if "Default" already exists for the tenant) a
 * CONNECTOR_INSTANCES row with connectorType='mail', name='Default',
 * isDefault=true.
 *
 * Idempotent: re-runs against an already-migrated DB are no-ops.
 *
 * The OS8 encryption format of the password is preserved as-is — the
 * encrypted blob lives inside the CONFIG JSONB unchanged. CryptoService
 * decrypts at runtime regardless of which row it came from.
 *
 * The TENANT_MAIL_SETTINGS table itself is dropped by the SQL
 * migration that ships alongside this script (0005_i4_s2_drop_mail
 * _settings.sql); this script must run BEFORE that migration applies.
 * Drizzle migrations are applied in numeric order, so the recommended
 * dev/staging/prod flow is:
 *
 *   1. Deploy the new code (Sprint 2 commit). Don't restart yet.
 *   2. `pnpm db:migrate-mail-to-connector`  ← this script
 *   3. `pnpm db:migrate`                     ← runs 0005, drops table
 *   4. Restart the API.
 *
 * A bundled npm script wraps 2+3 into one command for prod ops.
 * ──────────────────────────────────────────────────────────────────── */

import "reflect-metadata";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { and, eq } from "drizzle-orm";
import { connectorInstances } from "../src/database/schema";

/** Shape of TENANT_MAIL_SETTINGS rows. The schema.ts export was
 *  removed when the table was dropped from the codebase, so we
 *  describe the columns inline. Once the 0005 migration applies in
 *  prod, this table no longer exists and the script's table-existence
 *  check short-circuits. */
type MailSettingsRow = {
  TENANT_ID: string;
  HOST: string;
  PORT: number;
  SECURE: boolean;
  USERNAME: string | null;
  PASSWORD_ENCRYPTED: string | null;
  FROM_EMAIL: string;
  FROM_NAME: string | null;
  ENABLED: boolean;
  UPDATED_BY: string;
};

const env = process.env.NODE_ENV ?? "development";
config({ path: `.env.${env}` });

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const db = drizzle(client);

  console.log(`[mail→connector] env=${env}`);

  // Detect if TENANT_MAIL_SETTINGS still exists. After 0005 drops it,
  // re-runs of this script should be no-ops.
  const tableExists = await client.query(
    `SELECT to_regclass('"TENANT_MAIL_SETTINGS"') AS exists`,
  );
  if (tableExists.rows[0]?.exists == null) {
    console.log(
      "[mail→connector] TENANT_MAIL_SETTINGS no longer exists — nothing to migrate. Done.",
    );
    await client.end();
    return;
  }

  const raw = await client.query<MailSettingsRow>(
    `SELECT "TENANT_ID","HOST","PORT","SECURE","USERNAME","PASSWORD_ENCRYPTED","FROM_EMAIL","FROM_NAME","ENABLED","UPDATED_BY" FROM "TENANT_MAIL_SETTINGS"`,
  );
  const rows = raw.rows;
  console.log(`[mail→connector] found ${rows.length} mail-settings rows.`);

  let migrated = 0;
  let skipped = 0;
  for (const row of rows) {
    // Idempotency: if a (tenant, 'mail', 'Default') row already
    // exists in CONNECTOR_INSTANCES, leave it alone.
    const existing = await db
      .select({ id: connectorInstances.id })
      .from(connectorInstances)
      .where(
        and(
          eq(connectorInstances.tenantId, row.TENANT_ID),
          eq(connectorInstances.connectorType, "mail"),
          eq(connectorInstances.name, "Default"),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      console.log(`[mail→connector] tenant ${row.TENANT_ID}: already migrated. Skip.`);
      skipped += 1;
      continue;
    }

    const config: Record<string, unknown> = {
      host: row.HOST,
      port: row.PORT,
      secure: row.SECURE,
      fromEmail: row.FROM_EMAIL,
    };
    if (row.USERNAME) config.username = row.USERNAME;
    if (row.PASSWORD_ENCRYPTED) config.password = row.PASSWORD_ENCRYPTED; // pass-through enc:v1:...
    if (row.FROM_NAME) config.fromName = row.FROM_NAME;

    await db.insert(connectorInstances).values({
      tenantId: row.TENANT_ID,
      connectorType: "mail",
      name: "Default",
      config,
      enabled: row.ENABLED,
      isDefault: true,
      updatedBy: row.UPDATED_BY,
    });
    migrated += 1;
    console.log(
      `[mail→connector] tenant ${row.TENANT_ID}: migrated → mail/Default (enabled=${row.ENABLED}).`,
    );
  }

  console.log(
    `[mail→connector] done. migrated=${migrated}, skipped=${skipped}.`,
  );
  await client.end();
}

main().catch((e) => {
  console.error("[mail→connector] FAILED:", e);
  process.exit(1);
});
