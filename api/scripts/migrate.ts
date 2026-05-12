/* EE2 — Apply pending Drizzle migrations to the target database.
 *
 * Replaces the dev-only `drizzle-kit push` workflow with a versioned
 * `drizzle-orm/node-postgres/migrator` run. New schema changes flow:
 *   1. edit schema.ts
 *   2. pnpm db:generate         (writes drizzle/NNNN_*.sql)
 *   3. pnpm db:migrate          (this script — applies pending)
 *   4. commit the .sql file
 *
 * Idempotent: drizzle-orm tracks applied migrations in
 * drizzle.__drizzle_migrations and skips any whose hash is already
 * present. Safe to re-run on every deploy.
 */

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";
import { Pool } from "pg";

const env = process.env.NODE_ENV || "development";
config({ path: `.env.${env}` });

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: dbUrl });
  try {
    const db = drizzle(pool);
    const migrationsFolder = resolve(__dirname, "..", "drizzle");
    console.log(
      `[migrate] env=${env} folder=${migrationsFolder} db=${dbUrl.replace(/:[^:@]*@/, ":***@")}`,
    );
    await migrate(db, { migrationsFolder });
    console.log("[migrate] done.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
