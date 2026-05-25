/* ─── Message Subscription Service ───────────────────────────────────
 * P3 Session 7 — the engine's correlation registry for intermediate
 * message-catch events. Persists in MESSAGE_SUBSCRIPTIONS (one row per
 * parked token) and exposes the four shapes the rest of the engine
 * needs:
 *
 *   1. `subscribe()` — called by advanceToken when a token enters an
 *      intermediateCatchEvent with kind=message. Writes the row.
 *   2. `findAndLock()` — called by POST /api/messages. Does the
 *      `SELECT ... FOR UPDATE` on (tenant, name, key) so two parallel
 *      deliveries can't both wake the same token.
 *   3. `unsubscribe(tokenId)` — single-row delete after a successful
 *      delivery resumes the token. Idempotent (returns count).
 *   4. `cancelForInstance(instanceId)` — bulk delete on cancelInstance
 *      and scope-drain paths. Mirrors `cancelTimersForInstance` so all
 *      cancellation entry points clean up both kinds of "parked waits".
 *
 * Idempotency for retried inbound deliveries lives outside this service
 * (in the controller), keyed in-memory by
 * (tenantId, name, correlationKey, payloadHash) for 10 minutes. See
 * MessagesController for the design notes.
 * ──────────────────────────────────────────────────────────────────── */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import {
  messageStartSubscriptions,
  messageSubscriptions,
} from "../database/schema";

export interface SubscribeArgs {
  tenantId: string;
  instanceId: string;
  tokenId: string;
  scopeTokenId?: string | null;
  messageName: string;
  correlationKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any;
}

export interface LockedSubscription {
  id: string;
  tenantId: string;
  instanceId: string;
  tokenId: string;
  scopeTokenId: string | null;
  messageName: string;
  correlationKey: string;
}

@Injectable()
export class MessageSubscriptionService {
  private readonly logger = new Logger(MessageSubscriptionService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Insert a single subscription row. Called from inside the engine's
   *  advanceToken transaction so the park + subscribe are atomic. */
  async subscribe(args: SubscribeArgs): Promise<{ id: string }> {
    const exec = args.tx ?? this.db;
    const rows = await exec
      .insert(messageSubscriptions)
      .values({
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: args.tokenId,
        scopeTokenId: args.scopeTokenId ?? null,
        messageName: args.messageName,
        correlationKey: args.correlationKey,
      })
      .returning({ id: messageSubscriptions.id });
    return { id: rows[0].id };
  }

  /** Find one subscription matching the tuple and row-lock it. Returns
   *  null if none. Caller MUST be inside a transaction (uses
   *  `FOR UPDATE`); the row stays locked until the txn commits or rolls
   *  back, blocking any concurrent delivery for the same tuple. */
  async findAndLock(
    tenantId: string,
    messageName: string,
    correlationKey: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
  ): Promise<LockedSubscription | null> {
    // Drizzle's `.for("update")` isn't exposed on every version; use raw
    // SQL for the lock hint. Limit 1 so two parallel callers don't both
    // grab the same set of rows — the first claim wins.
    const result = await tx.execute(sql`
      SELECT "ID" AS id,
             "TENANT_ID" AS "tenantId",
             "INSTANCE_ID" AS "instanceId",
             "TOKEN_ID" AS "tokenId",
             "SCOPE_TOKEN_ID" AS "scopeTokenId",
             "MESSAGE_NAME" AS "messageName",
             "CORRELATION_KEY" AS "correlationKey"
      FROM "MESSAGE_SUBSCRIPTIONS"
      WHERE "TENANT_ID" = ${tenantId}
        AND "MESSAGE_NAME" = ${messageName}
        AND "CORRELATION_KEY" = ${correlationKey}
      ORDER BY "CREATED_AT" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    // drizzle's pg driver returns rows on `.rows`; node-postgres direct
    // returns the array itself. Normalize.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = Array.isArray(result) ? result : (result as any).rows;
    if (!rows || rows.length === 0) return null;
    return rows[0] as LockedSubscription;
  }

  /** Single-row delete by token id. Called after a successful delivery
   *  resumes the token. Returns the number of rows deleted (0 or 1) so
   *  the caller can assert "we did wake exactly one". */
  async unsubscribe(
    tokenId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(messageSubscriptions)
      .where(eq(messageSubscriptions.tokenId, tokenId))
      .returning({ id: messageSubscriptions.id });
    return rows.length;
  }

  /** Bulk delete on cancelInstance / scope-drain. Same pattern as
   *  TimerSchedulerService.cancelTimersForInstance. */
  async cancelForInstance(
    instanceId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(messageSubscriptions)
      .where(eq(messageSubscriptions.instanceId, instanceId))
      .returning({ id: messageSubscriptions.id });
    return rows.length;
  }

  /** Bulk delete on scope-drain inside a subprocess. The boundary-fired
   *  cascade (Session 6a) uses this shape to wipe subscriptions that
   *  belonged to the host scope without touching siblings outside it. */
  async cancelForScope(
    scopeTokenId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(messageSubscriptions)
      .where(eq(messageSubscriptions.scopeTokenId, scopeTokenId))
      .returning({ id: messageSubscriptions.id });
    return rows.length;
  }

  /* ─── Message-start subscriptions (P3 Session 8) ────────────────────
   * Process-level. Registered at publishProcess; not tied to a token. */

  /** Register a start subscription for an ACTIVE process. Called from
   *  publishProcess for every startEvent whose eventDefinition.kind
   *  === "message". The unique constraint catches duplicates (two
   *  start events with the same message name on the same process). */
  async registerStart(args: {
    tenantId: string;
    processId: string;
    messageName: string;
    startNodeId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any;
  }): Promise<void> {
    const exec = args.tx ?? this.db;
    await exec
      .insert(messageStartSubscriptions)
      .values({
        tenantId: args.tenantId,
        processId: args.processId,
        messageName: args.messageName,
        startNodeId: args.startNodeId,
      });
  }

  /** Lookup on POST /api/messages fallback path. Returns the matching
   *  (tenantId, messageName) row, or null. No row-lock — we only need
   *  enough info to call startInstance; startInstance handles its own
   *  concurrency. */
  async findStart(
    tenantId: string,
    messageName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
  ): Promise<{
    processId: string;
    startNodeId: string;
  } | null> {
    const rows = await tx
      .select({
        processId: messageStartSubscriptions.processId,
        startNodeId: messageStartSubscriptions.startNodeId,
      })
      .from(messageStartSubscriptions)
      .where(
        and(
          eq(messageStartSubscriptions.tenantId, tenantId),
          eq(messageStartSubscriptions.messageName, messageName),
        ),
      )
      .limit(1);
    return (rows[0] as { processId: string; startNodeId: string }) ?? null;
  }

  /** Wipe ALL start rows for a process. Called inside publishProcess
   *  before re-registering, so the latest publish is always the source
   *  of truth (no orphan starts from a prior version). */
  async unregisterStartsForProcess(
    processId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(messageStartSubscriptions)
      .where(eq(messageStartSubscriptions.processId, processId))
      .returning({ id: messageStartSubscriptions.id });
    return rows.length;
  }
}
