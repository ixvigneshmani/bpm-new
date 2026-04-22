/**
 * R1 — Roles + extra test user migration (idempotent).
 *
 * Run once against an existing DB to:
 *   • Create the 3 system roles (manager/employee/finance) per tenant.
 *   • Assign the primary test user (Vignesh) to `manager`.
 *   • Create `eva.employee@innovatechs.com` with role `employee` for
 *     authorization-denial tests.
 *
 * Safe to re-run — every write checks for existing rows first.
 * Prerequisite: `pnpm db:push` has added ROLES + USER_ROLES tables.
 */
import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import * as schema from "./schema";

const env = process.env.NODE_ENV || "development";
config({ path: `.env.${env}` });

const SEED_ROLES = [
  { key: "manager", label: "Manager", description: "Approves requests raised by their reports." },
  { key: "employee", label: "Employee", description: "Raises requests that flow through the process engine." },
  { key: "finance", label: "Finance", description: "Approves monetary / expense-related tasks." },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  console.log(`R1 setup (${env})...\n`);

  const tenants = await db.select().from(schema.tenants);
  if (tenants.length === 0) {
    console.error("No tenants found — run `pnpm db:seed` first.");
    process.exit(1);
  }

  for (const tenant of tenants) {
    console.log(`  Tenant: ${tenant.name} (${tenant.id})`);

    // Seed roles per tenant.
    const roleIdByKey: Record<string, string> = {};
    for (const r of SEED_ROLES) {
      const existing = await db
        .select()
        .from(schema.roles)
        .where(and(eq(schema.roles.tenantId, tenant.id), eq(schema.roles.key, r.key)))
        .limit(1);
      if (existing.length > 0) {
        roleIdByKey[r.key] = existing[0].id;
        console.log(`    Role exists: ${r.key}`);
        continue;
      }
      const [row] = await db
        .insert(schema.roles)
        .values({
          tenantId: tenant.id,
          key: r.key,
          label: r.label,
          description: r.description,
          system: true,
        })
        .returning();
      roleIdByKey[r.key] = row.id;
      console.log(`    Role created: ${r.label} (${r.key})`);
    }

    // Assign every owner/admin in the tenant to manager (idempotent).
    const privileged = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.tenantId, tenant.id)));
    for (const u of privileged) {
      if (u.role !== "owner" && u.role !== "admin") continue;
      const has = await db
        .select()
        .from(schema.userRoles)
        .where(
          and(
            eq(schema.userRoles.userId, u.id),
            eq(schema.userRoles.roleId, roleIdByKey.manager),
          ),
        )
        .limit(1);
      if (has.length > 0) {
        console.log(`    Already has manager: ${u.email}`);
        continue;
      }
      await db.insert(schema.userRoles).values({
        userId: u.id,
        roleId: roleIdByKey.manager,
        tenantId: tenant.id,
        assignedBy: u.id,
      });
      console.log(`    Assigned: ${u.email} → manager`);
    }

    // Create Eva (employee-only test user) if not present.
    const evaEmail = "eva.employee@innovatechs.com";
    const existingEva = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.tenantId, tenant.id), eq(schema.users.email, evaEmail)))
      .limit(1);

    let evaId: string;
    if (existingEva.length > 0) {
      evaId = existingEva[0].id;
      console.log(`    User exists: ${evaEmail}`);
    } else {
      const passwordHash = await bcrypt.hash("password123", 12);
      const [eva] = await db
        .insert(schema.users)
        .values({
          tenantId: tenant.id,
          email: evaEmail,
          displayName: "Eva Employee",
          passwordHash,
          role: "member",
          emailVerifiedAt: new Date(),
        })
        .returning();
      evaId = eva.id;
      console.log(`    User created: ${evaEmail} / password123`);

      // Add to the first workspace of this tenant, if any.
      const [ws] = await db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.tenantId, tenant.id))
        .limit(1);
      if (ws) {
        await db.insert(schema.workspaceMembers).values({
          workspaceId: ws.id,
          userId: evaId,
          role: "member",
        });
      }
    }

    const evaHasEmployee = await db
      .select()
      .from(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, evaId),
          eq(schema.userRoles.roleId, roleIdByKey.employee),
        ),
      )
      .limit(1);
    if (evaHasEmployee.length === 0) {
      await db.insert(schema.userRoles).values({
        userId: evaId,
        roleId: roleIdByKey.employee,
        tenantId: tenant.id,
      });
      console.log(`    Assigned: ${evaEmail} → employee`);
    }
  }

  console.log("\nR1 setup complete.");
  await pool.end();
}

main().catch((e) => {
  console.error("R1 setup failed:", e);
  process.exit(1);
});
