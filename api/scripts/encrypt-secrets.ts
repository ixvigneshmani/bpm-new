/* OS8 — One-shot migration: encrypt existing plaintext secret rows.
 *
 * Walks the three tables that hold credential-shaped column values
 * and re-stores any plaintext rows in the new `enc:v1:...` format.
 * Idempotent: rows already prefixed `enc:v1:` are skipped.
 *
 * Run once per environment after deploying OS8:
 *   DATABASE_URL=... ENCRYPTION_KEY=... pnpm db:encrypt-secrets
 *
 * Tables touched:
 *   - WEBHOOK_SUBSCRIPTIONS.SECRET     (HMAC signing key)
 *   - ENVIRONMENT_BINDINGS.VALUE_SECRET (D1 per-tenant secret store)
 *   - USERS.MFA_SECRET                 (TOTP shared secret)
 *
 * NOT touched (deliberately out of scope for OS8 v1):
 *   - ENGINE_JOBS.INPUT — jsonb blobs; copies live a short time + are
 *     cascaded out on instance delete. Future OS8.1 if a customer asks.
 *   - PROCESS_INSTANCES.VARIABLES — full variable bag; same trade-off.
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { createCipheriv, randomBytes } from "node:crypto";

const env = process.env.NODE_ENV || "development";
config({ path: `.env.${env}` });

const PREFIX = "enc:v1:";

function encrypt(plaintext: string, key: Buffer): string {
  if (plaintext.startsWith(PREFIX)) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${Buffer.concat([enc, tag]).toString("base64")}`;
}

async function migrateTable(
  pool: Pool,
  table: string,
  column: string,
  key: Buffer,
): Promise<{ scanned: number; encrypted: number }> {
  const sel = await pool.query<{ ID: string; VAL: string | null }>(
    `SELECT "ID", "${column}" AS "VAL" FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" NOT LIKE '${PREFIX}%'`,
  );
  let encrypted = 0;
  for (const row of sel.rows) {
    if (!row.VAL) continue;
    const enc = encrypt(row.VAL, key);
    await pool.query(`UPDATE "${table}" SET "${column}" = $1 WHERE "ID" = $2`, [
      enc,
      row.ID,
    ]);
    encrypted++;
  }
  return { scanned: sel.rows.length, encrypted };
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!dbUrl) throw new Error("DATABASE_URL is required");
  if (!keyHex || keyHex.length !== 64 || !/^[0-9a-f]+$/i.test(keyHex)) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-char hex string (generate via `openssl rand -hex 32`).",
    );
  }
  const key = Buffer.from(keyHex, "hex");

  const pool = new Pool({ connectionString: dbUrl });
  try {
    const tables: Array<[string, string]> = [
      ["WEBHOOK_SUBSCRIPTIONS", "SECRET"],
      ["ENVIRONMENT_BINDINGS", "VALUE_SECRET"],
      ["USERS", "MFA_SECRET"],
    ];
    for (const [t, c] of tables) {
      const { scanned, encrypted } = await migrateTable(pool, t, c, key);
      console.log(`[encrypt-secrets] ${t}.${c}: scanned=${scanned} encrypted=${encrypted}`);
    }
    console.log("[encrypt-secrets] done.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[encrypt-secrets] failed:", err);
  process.exit(1);
});
