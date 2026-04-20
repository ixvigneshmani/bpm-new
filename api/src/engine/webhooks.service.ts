/* ─── Webhooks Service ──────────────────────────────────────────────
 * CRUD over WEBHOOK_SUBSCRIPTIONS for the controller. Auto-generates
 * the per-subscription HMAC secret on create. Tenant-scoped on every
 * read/write — no cross-tenant access.
 * ──────────────────────────────────────────────────────────────────── */

import {
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import { webhookSubscriptions } from "../database/schema";

@Injectable()
export class WebhooksService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Create a new subscription. Secret is generated server-side
   *  (32 random bytes hex) and returned exactly once — callers must
   *  capture it now; subsequent reads omit it. */
  async create(args: {
    tenantId: string;
    userId: string;
    name: string;
    url: string;
    eventTypes?: string;
    processId?: string;
  }): Promise<{
    id: string;
    name: string;
    url: string;
    eventTypes: string;
    processId: string | null;
    secret: string;
    status: "active";
  }> {
    const secret = randomBytes(32).toString("hex");
    const [row] = await this.db
      .insert(webhookSubscriptions)
      .values({
        tenantId: args.tenantId,
        createdBy: args.userId,
        name: args.name,
        url: args.url,
        eventTypes: args.eventTypes ?? "*",
        processId: args.processId ?? null,
        secret,
      })
      .returning();
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      eventTypes: row.eventTypes,
      processId: row.processId,
      secret,
      status: "active",
    };
  }

  /** Tenant-scoped list. Excludes the secret — use the create response
   *  if you missed it; otherwise rotate via delete + recreate. */
  async list(tenantId: string): Promise<
    Array<{
      id: string;
      name: string;
      url: string;
      eventTypes: string;
      processId: string | null;
      status: "active" | "paused" | "disabled";
      createdAt: string;
    }>
  > {
    const rows = await this.db
      .select({
        id: webhookSubscriptions.id,
        name: webhookSubscriptions.name,
        url: webhookSubscriptions.url,
        eventTypes: webhookSubscriptions.eventTypes,
        processId: webhookSubscriptions.processId,
        status: webhookSubscriptions.status,
        createdAt: webhookSubscriptions.createdAt,
      })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.tenantId, tenantId))
      .orderBy(desc(webhookSubscriptions.createdAt));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const result = await this.db
      .delete(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.id, id),
          eq(webhookSubscriptions.tenantId, tenantId),
        ),
      )
      .returning({ id: webhookSubscriptions.id });
    if (result.length === 0) {
      throw new NotFoundException("Webhook subscription not found.");
    }
  }
}
