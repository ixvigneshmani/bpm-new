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
      email: "vignesh.mani@innovatechs.com",
      displayName: "Vignesh Mani",
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

  // ─── Business Document Templates ────────────────────────────────
  const templates = [
    {
      name: "Vendor Registration Form",
      schema: {
        vendorName: "string",
        email: "string",
        phone: "string",
        category: "string",
        taxId: "string",
        bankDetails: { accountNo: "string", ifsc: "string" },
        documents: [{ name: "string", url: "string" }],
        approved: "boolean",
      },
    },
    {
      name: "Invoice Data Schema",
      schema: {
        invoiceNo: "string",
        vendor: "string",
        amount: "number",
        date: "date",
        lineItems: [{ description: "string", qty: "number", price: "number" }],
        status: "string",
        approvedBy: "string",
        notes: "string",
      },
    },
    {
      name: "Employee Record",
      schema: {
        employeeId: "string",
        firstName: "string",
        lastName: "string",
        department: "string",
        role: "string",
        email: "string",
        joinDate: "date",
        manager: "string",
        salary: "number",
        address: { street: "string", city: "string", country: "string" },
        active: "boolean",
      },
    },
  ];

  for (const tpl of templates) {
    const [doc] = await db
      .insert(schema.businessDocuments)
      .values({
        tenantId: tenant.id,
        createdBy: user.id,
        name: tpl.name,
        schema: tpl.schema,
      })
      .returning();
    console.log(`  Template: ${doc.name} (${doc.id})`);
  }

  // ─── Roles (R1) ─────────────────────────────────────────────────
  const seedRoles = [
    { key: "manager", label: "Manager", description: "Approves requests raised by their reports." },
    { key: "employee", label: "Employee", description: "Raises requests that flow through the process engine." },
    { key: "finance", label: "Finance", description: "Approves monetary / expense-related tasks." },
  ];
  const roleIdByKey: Record<string, string> = {};
  for (const r of seedRoles) {
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
    console.log(`  Role: ${row.label} (${row.key})`);
  }

  // Vignesh gets `manager`.
  await db.insert(schema.userRoles).values({
    userId: user.id,
    roleId: roleIdByKey.manager,
    tenantId: tenant.id,
    assignedBy: user.id,
  });
  console.log(`  Assigned: ${user.email} → manager`);

  // Extra employee-only user for authorization-denial tests.
  const [employee] = await db
    .insert(schema.users)
    .values({
      tenantId: tenant.id,
      email: "eva.employee@innovatechs.com",
      displayName: "Eva Employee",
      passwordHash,
      role: "member",
      emailVerifiedAt: new Date(),
    })
    .returning();
  await db.insert(schema.workspaceMembers).values({
    workspaceId: workspace.id,
    userId: employee.id,
    role: "member",
  });
  await db.insert(schema.userRoles).values({
    userId: employee.id,
    roleId: roleIdByKey.employee,
    tenantId: tenant.id,
    assignedBy: user.id,
  });
  console.log(`  User: ${employee.displayName} <${employee.email}> (employee role)`);

  console.log("\nSeed complete!");
  if (process.env.NODE_ENV === "development") {
    console.log(`\n  Login: vignesh.mani@innovatechs.com / password123\n`);
  }

  await pool.end();
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
