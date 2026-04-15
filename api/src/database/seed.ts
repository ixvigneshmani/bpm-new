import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as bcrypt from "bcryptjs";
import * as schema from "./schema";

const env = process.env.NODE_ENV || "development";
config({ path: `.env.${env}` });

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  console.log(`Seeding database (${env})...\n`);

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: "Acme Corp", slug: "acme", plan: "pro" })
    .returning();
  console.log(`  Tenant: ${tenant.name} (${tenant.id})`);

  const [workspace] = await db
    .insert(schema.workspaces)
    .values({ tenantId: tenant.id, name: "Default", slug: "default" })
    .returning();
  console.log(`  Workspace: ${workspace.name} (${workspace.id})`);

  const passwordHash = await bcrypt.hash("password123", 12);
  const [user] = await db
    .insert(schema.users)
    .values({
      tenantId: tenant.id,
      email: "alex@acmecorp.ae",
      displayName: "Alex Kim",
      passwordHash,
      role: "owner",
      emailVerifiedAt: new Date(),
    })
    .returning();
  console.log(`  User: ${user.displayName} <${user.email}>`);

  await db.insert(schema.workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: "owner",
  });

  console.log("\nSeed complete!");
  console.log(`\n  Login: alex@acmecorp.ae / password123\n`);

  await pool.end();
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
