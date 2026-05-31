/* ─── Conditional Subscription Service ───────────────────────────────
 * P3 Session 9 — backs intermediate conditional-catch tokens AND
 * conditional-start registrations.
 *
 * Two row shapes (same pattern as SIGNAL_SUBSCRIPTIONS):
 *   - Catch row:  instanceId + tokenId set, processId NULL.
 *   - Start row:  processId set, instanceId + tokenId NULL.
 *
 * Evaluation is NOT polled. The engine's variable-set audit path calls
 * `evaluatePendingConditions(...)` which scans this table per tenant
 * and re-evaluates each expression against the new variable bag. Hits
 * resume tokens / spawn instances inline in the same txn.
 *
 * Cancel paths mirror MessageSubscriptionService so all four registries
 * (timers, messages, signals, conditionals) clean up identically.
 * ──────────────────────────────────────────────────────────────────── */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, or, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import { conditionalSubscriptions } from "../database/schema";

export interface SubscribeCatchArgs {
  tenantId: string;
  instanceId: string;
  tokenId: string;
  scopeTokenId?: string | null;
  conditionExpression: string;
  /** P4 event-closure — set for conditional BOUNDARY catchers. */
  boundaryNodeId?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any;
}

export interface SubscribeStartArgs {
  tenantId: string;
  processId: string;
  conditionExpression: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any;
}

export interface ListedSubscription {
  id: string;
  tenantId: string;
  instanceId: string | null;
  tokenId: string | null;
  scopeTokenId: string | null;
  processId: string | null;
  conditionExpression: string;
  boundaryNodeId: string | null;
}

@Injectable()
export class ConditionalSubscriptionService {
  private readonly logger = new Logger(ConditionalSubscriptionService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async subscribeCatch(args: SubscribeCatchArgs): Promise<{ id: string }> {
    const exec = args.tx ?? this.db;
    const rows = await exec
      .insert(conditionalSubscriptions)
      .values({
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: args.tokenId,
        scopeTokenId: args.scopeTokenId ?? null,
        conditionExpression: args.conditionExpression,
        processId: null,
        boundaryNodeId: args.boundaryNodeId ?? null,
      })
      .returning({ id: conditionalSubscriptions.id });
    return { id: rows[0].id };
  }

  async subscribeStart(args: SubscribeStartArgs): Promise<{ id: string }> {
    const exec = args.tx ?? this.db;
    const rows = await exec
      .insert(conditionalSubscriptions)
      .values({
        tenantId: args.tenantId,
        processId: args.processId,
        conditionExpression: args.conditionExpression,
        instanceId: null,
        tokenId: null,
      })
      .returning({ id: conditionalSubscriptions.id });
    return { id: rows[0].id };
  }

  /** Find all subscriptions for a tenant — both catch and start rows.
   *  Caller filters/evaluates. Used by the variable-set hook to
   *  re-evaluate every pending condition for a tenant after a variable
   *  write. (Could be scoped to just the changed instance + tenant
   *  start-row scope; the variable-set hook does that.) */
  async findCatchesForInstance(
    instanceId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
  ): Promise<ListedSubscription[]> {
    return tx
      .select({
        id: conditionalSubscriptions.id,
        tenantId: conditionalSubscriptions.tenantId,
        instanceId: conditionalSubscriptions.instanceId,
        tokenId: conditionalSubscriptions.tokenId,
        scopeTokenId: conditionalSubscriptions.scopeTokenId,
        processId: conditionalSubscriptions.processId,
        conditionExpression: conditionalSubscriptions.conditionExpression,
        boundaryNodeId: conditionalSubscriptions.boundaryNodeId,
      })
      .from(conditionalSubscriptions)
      .where(eq(conditionalSubscriptions.instanceId, instanceId));
  }

  /** Find all conditional-start subscriptions for a tenant. Caller
   *  evaluates each against the change-set's variable bag and spawns
   *  matching instances. Bounded by tenant for cheap scans. */
  async findStartsForTenant(
    tenantId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
  ): Promise<ListedSubscription[]> {
    return tx
      .select({
        id: conditionalSubscriptions.id,
        tenantId: conditionalSubscriptions.tenantId,
        instanceId: conditionalSubscriptions.instanceId,
        tokenId: conditionalSubscriptions.tokenId,
        scopeTokenId: conditionalSubscriptions.scopeTokenId,
        processId: conditionalSubscriptions.processId,
        conditionExpression: conditionalSubscriptions.conditionExpression,
      })
      .from(conditionalSubscriptions)
      .where(
        and(
          eq(conditionalSubscriptions.tenantId, tenantId),
          isNull(conditionalSubscriptions.tokenId),
        ),
      );
  }

  async unsubscribeToken(
    tokenId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(conditionalSubscriptions)
      .where(eq(conditionalSubscriptions.tokenId, tokenId))
      .returning({ id: conditionalSubscriptions.id });
    return rows.length;
  }

  async cancelForInstance(
    instanceId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(conditionalSubscriptions)
      .where(eq(conditionalSubscriptions.instanceId, instanceId))
      .returning({ id: conditionalSubscriptions.id });
    return rows.length;
  }

  async cancelStartsForProcess(
    processId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(conditionalSubscriptions)
      .where(
        and(
          eq(conditionalSubscriptions.processId, processId),
          isNull(conditionalSubscriptions.tokenId),
        ),
      )
      .returning({ id: conditionalSubscriptions.id });
    return rows.length;
  }
}
