/* ─── Signal Subscription Service ────────────────────────────────────
 * P3 Session 8 — signals (broadcast, name-only) backed by
 * SIGNAL_SUBSCRIPTIONS. Two row shapes coexist in the same table:
 *
 *   - Catch row:  instanceId + tokenId set, processId NULL.
 *                 An intermediate signal-catch token is parked, waiting.
 *   - Start row:  processId set, instanceId + tokenId NULL.
 *                 A signal-start event on a published process.
 *
 * findAll() returns BOTH kinds for a tenant + name tuple so the
 * controller can fan out: resume each catching token AND start a fresh
 * instance for each start row, all in one transaction.
 *
 * Cancel paths mirror MessageSubscriptionService so all three
 * registries (timers, messages, signals) clean up identically on
 * cancelInstance / scope-drain / replay-cancel / process-republish.
 * ──────────────────────────────────────────────────────────────────── */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import { signalSubscriptions } from "../database/schema";

export interface SubscribeCatchArgs {
  tenantId: string;
  instanceId: string;
  tokenId: string;
  scopeTokenId?: string | null;
  signalName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any;
}

export interface SubscribeStartArgs {
  tenantId: string;
  processId: string;
  signalName: string;
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
  signalName: string;
}

@Injectable()
export class SignalSubscriptionService {
  private readonly logger = new Logger(SignalSubscriptionService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Catch-side: park-and-subscribe inside advanceToken. */
  async subscribeCatch(args: SubscribeCatchArgs): Promise<{ id: string }> {
    const exec = args.tx ?? this.db;
    const rows = await exec
      .insert(signalSubscriptions)
      .values({
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: args.tokenId,
        scopeTokenId: args.scopeTokenId ?? null,
        signalName: args.signalName,
        processId: null,
      })
      .returning({ id: signalSubscriptions.id });
    return { id: rows[0].id };
  }

  /** Start-side: registered at process publish time. */
  async subscribeStart(args: SubscribeStartArgs): Promise<{ id: string }> {
    const exec = args.tx ?? this.db;
    const rows = await exec
      .insert(signalSubscriptions)
      .values({
        tenantId: args.tenantId,
        processId: args.processId,
        signalName: args.signalName,
        instanceId: null,
        tokenId: null,
      })
      .returning({ id: signalSubscriptions.id });
    return { id: rows[0].id };
  }

  /** Fan-out lookup. Returns BOTH catch + start rows. Caller MUST be
   *  inside a transaction so it can use savepoints around each
   *  per-target action; one bad target shouldn't poison the rest. */
  async findAll(
    tenantId: string,
    signalName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
  ): Promise<ListedSubscription[]> {
    const rows = await tx
      .select({
        id: signalSubscriptions.id,
        tenantId: signalSubscriptions.tenantId,
        instanceId: signalSubscriptions.instanceId,
        tokenId: signalSubscriptions.tokenId,
        scopeTokenId: signalSubscriptions.scopeTokenId,
        processId: signalSubscriptions.processId,
        signalName: signalSubscriptions.signalName,
      })
      .from(signalSubscriptions)
      .where(
        and(
          eq(signalSubscriptions.tenantId, tenantId),
          eq(signalSubscriptions.signalName, signalName),
        ),
      );
    return rows as ListedSubscription[];
  }

  /** Catch-side cleanup on resume / cancel. */
  async unsubscribeToken(
    tokenId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(signalSubscriptions)
      .where(eq(signalSubscriptions.tokenId, tokenId))
      .returning({ id: signalSubscriptions.id });
    return rows.length;
  }

  /** Bulk cancel by instance (cancelInstance, scope-drain). Only
   *  affects catch rows — start rows survive because they belong to
   *  the process, not the instance. */
  async cancelForInstance(
    instanceId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(signalSubscriptions)
      .where(eq(signalSubscriptions.instanceId, instanceId))
      .returning({ id: signalSubscriptions.id });
    return rows.length;
  }

  /** Bulk cancel by scope (subprocess interrupt). */
  async cancelForScope(
    scopeTokenId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(signalSubscriptions)
      .where(eq(signalSubscriptions.scopeTokenId, scopeTokenId))
      .returning({ id: signalSubscriptions.id });
    return rows.length;
  }

  /** Clean start rows on republish / unpublish. Only affects start
   *  rows; catch rows pointing at live tokens stay (they're for the
   *  currently-running instances, not for the process metadata). */
  async cancelStartsForProcess(
    processId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const rows = await exec
      .delete(signalSubscriptions)
      .where(
        and(
          eq(signalSubscriptions.processId, processId),
          isNull(signalSubscriptions.tokenId),
        ),
      )
      .returning({ id: signalSubscriptions.id });
    return rows.length;
  }
}
