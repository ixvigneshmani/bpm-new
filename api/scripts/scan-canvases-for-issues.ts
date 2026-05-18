/* ─── Sweep-B cleanup #1 — Cross-tenant canvas validation scan ──────
 * Runs the same family of design-time checks the new in-app validator
 * fires (Sweep B), but across every process in the database. Produces
 * a report grouped by tenant + process so an operator can decide who
 * to nudge before the next deploy.
 *
 * Intentionally NOT a migration — read-only, idempotent, no DB writes.
 * Re-runs are safe. Run via:
 *
 *   pnpm db:scan-canvases
 *
 * The rules implemented here are a fixed subset of the web validator
 * (whichever ones map cleanly to "no runtime context required").
 * Keep in sync with web/src/lib/validation/rules.ts when adding rules
 * that meet that bar.
 * ──────────────────────────────────────────────────────────────────── */

import "reflect-metadata";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "../src/database/schema";

config();

type CanvasNode = {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  parentId?: string;
};
type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  data?: { condition?: string; flowType?: string };
};
type Canvas = { nodes?: CanvasNode[]; edges?: CanvasEdge[] };

type Issue = { ruleId: string; severity: "error" | "warning"; message: string };

function labelOf(n: CanvasNode): string {
  return (n.data?.label as string) || n.id;
}

function scan(canvas: Canvas | null | undefined): Issue[] {
  if (!canvas || !Array.isArray(canvas.nodes)) return [];
  const nodes = canvas.nodes;
  const edges = Array.isArray(canvas.edges) ? canvas.edges : [];
  const issues: Issue[] = [];

  // ── user-task-assignment ──
  for (const n of nodes) {
    if (n.type !== "userTask") continue;
    const a = (n.data?.assignment as { type?: string; value?: string }) ?? undefined;
    if (!a || !a.type || !a.value || !String(a.value).trim()) {
      issues.push({
        ruleId: "user-task-assignment",
        severity: "error",
        message: `userTask "${labelOf(n)}" has no/empty assignment.`,
      });
    }
  }

  // ── gateway-non-exhaustive ──
  for (const n of nodes) {
    if (n.type !== "exclusiveGateway" && n.type !== "inclusiveGateway") continue;
    const outgoing = edges.filter((e) => e.source === n.id);
    if (outgoing.length < 2) continue;
    const def = (n.data?.defaultFlowId as string) ?? null;
    const hasDefault = !!def && outgoing.some((e) => e.id === def);
    if (hasDefault) continue;
    const allConditional = outgoing.every((e) => {
      const cond = e.data?.condition;
      return typeof cond === "string" && cond.trim().length > 0;
    });
    if (!allConditional) continue;
    issues.push({
      ruleId: "gateway-non-exhaustive",
      severity: "warning",
      message: `gateway "${labelOf(n)}" has conditions on every flow but no default.`,
    });
  }

  // ── service-task-impl ──
  const KNOWN_IMPL = new Set(["externalWorker", "rest", "connector"]);
  for (const n of nodes) {
    if (n.type !== "serviceTask" && n.type !== "sendTask") continue;
    const impl = n.data?.implementation as { type?: string; config?: Record<string, unknown> } | undefined;
    if (!impl || !impl.type) {
      issues.push({
        ruleId: "service-task-impl",
        severity: "error",
        message: `serviceTask "${labelOf(n)}" has no implementation.`,
      });
      continue;
    }
    if (!KNOWN_IMPL.has(impl.type)) {
      issues.push({
        ruleId: "service-task-impl",
        severity: "warning",
        message: `serviceTask "${labelOf(n)}" uses unknown impl "${impl.type}".`,
      });
      continue;
    }
    const cfg = impl.config ?? {};
    if (impl.type === "externalWorker" && !(cfg as { jobType?: string }).jobType) {
      issues.push({
        ruleId: "service-task-impl",
        severity: "error",
        message: `serviceTask "${labelOf(n)}" external worker has no jobType.`,
      });
    }
    if (impl.type === "connector") {
      const c = cfg as { connectorId?: string; operation?: string };
      if (!c.connectorId || !c.operation) {
        issues.push({
          ruleId: "service-task-impl",
          severity: "error",
          message: `serviceTask "${labelOf(n)}" connector incomplete (connectorId/operation).`,
        });
      }
    }
    if (impl.type === "rest" && !(cfg as { url?: string }).url) {
      issues.push({
        ruleId: "service-task-impl",
        severity: "error",
        message: `serviceTask "${labelOf(n)}" REST has no URL.`,
      });
    }
  }

  // ── call-activity-runtime ──
  for (const n of nodes) {
    if (n.type !== "callActivity") continue;
    issues.push({
      ruleId: "call-activity-runtime",
      severity: "warning",
      message: `callActivity "${labelOf(n)}" — engine doesn't yet execute child processes.`,
    });
  }

  return issues;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  const db = drizzle(client, { schema });

  const tenants = await db.select().from(schema.tenants);
  const tenantMap = new Map(tenants.map((t) => [t.id, t.name]));

  const procs = await db.select().from(schema.processes);
  let totalIssues = 0;
  let processesWithErrors = 0;
  const byTenant = new Map<string, Array<{ proc: typeof procs[number]; issues: Issue[] }>>();

  for (const p of procs) {
    const issues = scan(p.canvasData as Canvas);
    if (issues.length === 0) continue;
    if (issues.some((i) => i.severity === "error")) processesWithErrors++;
    totalIssues += issues.length;
    const arr = byTenant.get(p.tenantId) ?? [];
    arr.push({ proc: p, issues });
    byTenant.set(p.tenantId, arr);
  }

  console.log(`\nScanned ${procs.length} processes across ${tenants.length} tenants.`);
  console.log(`${processesWithErrors} have hard errors, ${totalIssues} total issues.\n`);

  for (const [tenantId, rows] of byTenant) {
    console.log(`── ${tenantMap.get(tenantId) ?? tenantId} ──`);
    for (const { proc, issues } of rows) {
      const errs = issues.filter((i) => i.severity === "error").length;
      const warns = issues.filter((i) => i.severity === "warning").length;
      console.log(`  • "${proc.name}" [${proc.status}] — ${errs} error${errs === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"}`);
      for (const i of issues) {
        console.log(`      ${i.severity === "error" ? "✕" : "!"} ${i.ruleId}: ${i.message}`);
      }
    }
    console.log("");
  }

  await client.end();
  // Exit non-zero when any hard errors exist so CI can gate on it.
  process.exit(processesWithErrors > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
