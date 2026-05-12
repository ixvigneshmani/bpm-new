/* EE2 — Stamp the baseline migration as already-applied against a
 * dev database that was previously built via `drizzle-kit push`.
 *
 * Use case: this script bootstraps an existing dev DB into the new
 * versioned-migration workflow. It does NOT run the baseline SQL —
 * it only writes the row drizzle-orm's migrator would have written
 * if it had been the one to create the tables.
 *
 * Run once per existing environment:
 *   DATABASE_URL=postgres://... pnpm tsx scripts/stamp-baseline.ts
 *
 * Safe to re-run: idempotent on the same hash. Refuses to stamp if
 * the migrations table already has a row for any baseline.
 */

import { config } from "dotenv";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";

const env = process.env.NODE_ENV || "development";
config({ path: `.env.${env}` });

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required");

  const drizzleDir = resolve(__dirname, "..", "drizzle");
  const journalPath = `${drizzleDir}/meta/_journal.json`;
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };

  if (journal.entries.length === 0) {
    throw new Error("Journal has no entries — nothing to stamp.");
  }

  const pool = new Pool({ connectionString: dbUrl });
  try {
    // Create the same schema + table the drizzle migrator would.
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    const existing = await pool.query<{ hash: string; created_at: string }>(
      `SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at ASC`,
    );
    if (existing.rows.length > 0) {
      console.log(
        `[stamp] migrations table already has ${existing.rows.length} row(s); leaving alone.`,
      );
      for (const r of existing.rows) {
        console.log(`  - hash=${r.hash} created_at=${r.created_at}`);
      }
      return;
    }

    // Stamp every entry in the journal (today there's one — baseline).
    // Generalises cleanly if a future generate runs before stamping.
    for (const entry of journal.entries) {
      const sqlPath = `${drizzleDir}/${entry.tag}.sql`;
      const sql = readFileSync(sqlPath, "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");
      await pool.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
        [hash, entry.when],
      );
      console.log(
        `[stamp] ${entry.tag} → hash=${hash.slice(0, 12)}… created_at=${entry.when} (stamped)`,
      );
    }

    console.log("[stamp] done.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[stamp] failed:", err);
  process.exit(1);
});
