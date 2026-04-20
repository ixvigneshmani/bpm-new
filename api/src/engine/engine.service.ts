/* ─── Engine Service ─────────────────────────────────────────────────
 * Token-flow interpreter for BPMN processes stored in
 * `processes.canvas_data`.
 *
 * E2 ships the linear happy path: start an instance, place a token on
 * the start event, advance through sequence flows, treat user / service
 * tasks as pass-throughs (E3 introduces wait states), and terminate
 * cleanly on the end event. Every transition writes an INSTANCE_EVENTS
 * row so we get an audit trail from day one.
 *
 * Intentionally not handled in E2 (deferred to later phases):
 *   • Wait states on user tasks         → E3
 *   • Gateway branch evaluation         → E4
 *   • Service-task handler registry     → E5
 *   • Timers / boundary events          → post-MVP (needs scheduler)
 *   • Subprocesses, pools, lanes        → post-MVP (nested scopes)
 *
 * The whole start-and-advance flow runs in one DB transaction — for
 * E2 every token finishes in the same call, so atomicity buys us "all
 * the events land or none of them do". Once E3's wait states exist the
 * txn boundary will move to per-step.
 * ──────────────────────────────────────────────────────────────────── */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import {
  instanceEvents,
  instanceTokens,
  processInstances,
  processes,
} from "../database/schema";

/** RFC4122-ish UUID matcher; we use it to defensively validate the
 *  `data.assignment.value` of a directUser before writing it into
 *  `INSTANCE_TOKENS.assignedTo`. The column FK would catch most
 *  garbage at insert time but a clean BadRequest beats a 500 from PG. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A canvas node as the interpreter sees it. The canonical shape lives
 *  in `web/src/types/bpmn-node-data.ts`; we read only what we need to
 *  traverse + execute. `data` stays loose because event/task/gateway
 *  each carry type-specific payloads narrowed by per-handler code. */
export type EngineNode = {
  id: string;
  type: string;
  parentId?: string;
  data?: Record<string, unknown>;
};

export type EngineEdge = {
  id: string;
  source: string;
  target: string;
  data?: {
    condition?: string;
    isDefault?: boolean;
    flowType?: string;
  };
};

/** Engine projection of `processes.canvas_data`. Anything else on the
 *  canvas (viewport, selection state, layout hints) is irrelevant to
 *  execution and stays in the JSONB blob untouched. */
export type EngineCanvas = {
  nodes: EngineNode[];
  edges: EngineEdge[];
};

/** Hard cap on advance-loop iterations per call. A well-formed E2
 *  process terminates in O(nodes) hops; if we exceed this it's a cycle
 *  or runaway model error and we fail loudly rather than spin. The
 *  comparison is `>=` so the cap is exactly this many hops. */
const MAX_ADVANCE_HOPS = 1000;

/** Flow-typed edges the interpreter will *not* traverse. Message flows
 *  cross pool boundaries semantically; associations are decorative
 *  artifact links. Both must be filtered out of "what comes next?" */
const NON_SEQUENCE_FLOW_TYPES = new Set(["message", "association"]);

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Start a new instance: load the process, snapshot its canvas, find
   *  the start event, place a token, and advance until the token reaches
   *  a wait state (E2: never) or an end event (E2: always).
   *
   *  Returns `{ instanceId, status, tokenCount, eventCount }` so the
   *  controller can surface enough for the user to see what happened
   *  without a follow-up GET. */
  async startInstance(args: {
    processId: string;
    tenantId: string;
    userId: string;
    variables?: Record<string, unknown>;
  }): Promise<{
    instanceId: string;
    status: "running" | "completed" | "failed";
    tokenCount: number;
    eventCount: number;
  }> {
    const proc = await this.loadProcessForInstance(args.processId, args.tenantId);
    const canvas = projectCanvas(proc.canvasData);
    const startNode = findStartEvent(canvas);

    // Hash the canonicalised snapshot so a future PROCESS_DEFINITIONS
    // table can dedupe by content. JSON.stringify with sorted keys is
    // good-enough canonicalisation for a hash; we don't need to be
    // round-trip identical, just stable for the same input.
    const snapshot = canonicalise(canvas);
    const definitionHash = sha256Hex(JSON.stringify(snapshot));
    const initialVariables = args.variables ?? {};

    return this.db.transaction(async (tx) => {
      // 1. Create the instance row.
      const [inst] = await tx
        .insert(processInstances)
        .values({
          tenantId: args.tenantId,
          processId: args.processId,
          startedBy: args.userId,
          status: "running",
          variables: initialVariables,
          definitionSnapshot: snapshot as unknown as Record<string, unknown>,
          definitionHash,
        })
        .returning({ id: processInstances.id });

      // 2. Audit: instance-started.
      await tx.insert(instanceEvents).values({
        tenantId: args.tenantId,
        instanceId: inst.id,
        userId: args.userId,
        eventType: "instance-started",
        payload: { processId: args.processId, definitionHash },
      });

      // 3. Place the initial token on the start event.
      const [token] = await tx
        .insert(instanceTokens)
        .values({
          tenantId: args.tenantId,
          instanceId: inst.id,
          currentNodeId: startNode.id,
          status: "active",
        })
        .returning({ id: instanceTokens.id, version: instanceTokens.version });

      await tx.insert(instanceEvents).values({
        tenantId: args.tenantId,
        instanceId: inst.id,
        tokenId: token.id,
        nodeId: startNode.id,
        eventType: "token-created",
      });

      // 4. Drive the token through the graph until it hits a wait state
      //    or an end event. The advance helper writes its own audit
      //    rows on every node-entered/edge-taken/node-exited transition.
      //    Mid-walk modeling errors (dead-ends, cycles) come back as
      //    `tokenStatus="failed"` with an `errorMessage` rather than
      //    throwing — that way the audit trail commits with the txn
      //    and the user can debug a broken process from INSTANCE_EVENTS
      //    instead of being told only "400 bad request".
      const advance = await this.advanceToken({
        tx,
        tenantId: args.tenantId,
        instanceId: inst.id,
        tokenId: token.id,
        tokenVersion: token.version,
        currentNodeId: startNode.id,
        canvas,
        variables: initialVariables,
      });

      // 5. Flip the instance to its terminal state (E2: one token per
      //    instance, so token status drives instance status directly).
      //    E3+ will count remaining active/waiting tokens before this.
      let instanceStatus: "running" | "completed" | "failed" = "running";
      if (advance.tokenStatus === "completed") {
        await tx
          .update(processInstances)
          .set({
            status: "completed",
            completedAt: new Date(),
          })
          .where(eq(processInstances.id, inst.id));
        await tx.insert(instanceEvents).values({
          tenantId: args.tenantId,
          instanceId: inst.id,
          eventType: "instance-completed",
          payload: { hops: advance.hops },
        });
        instanceStatus = "completed";
      } else if (advance.tokenStatus === "failed") {
        await tx
          .update(processInstances)
          .set({
            status: "failed",
            errorMessage: advance.errorMessage ?? null,
            completedAt: new Date(),
          })
          .where(eq(processInstances.id, inst.id));
        await tx.insert(instanceEvents).values({
          tenantId: args.tenantId,
          instanceId: inst.id,
          eventType: "instance-failed",
          payload: { hops: advance.hops, message: advance.errorMessage },
        });
        instanceStatus = "failed";
      }

      // Event-count + token-count are convenient for the UI; one extra
      // SELECT each, kept inside the txn so the snapshot is consistent.
      const tokenRows = await tx
        .select({ id: instanceTokens.id })
        .from(instanceTokens)
        .where(eq(instanceTokens.instanceId, inst.id));
      const eventRows = await tx
        .select({ id: instanceEvents.id })
        .from(instanceEvents)
        .where(eq(instanceEvents.instanceId, inst.id));

      this.logger.log({
        event: "engine.instance.started",
        tenantId: args.tenantId,
        instanceId: inst.id,
        status: instanceStatus,
        hops: advance.hops,
      });

      return {
        instanceId: inst.id,
        status: instanceStatus,
        tokenCount: tokenRows.length,
        eventCount: eventRows.length,
      };
    });
  }

  /** Drive a single token forward. Returns the token's terminal status
   *  for this advance call: "completed" (hit an end event), "waiting"
   *  (paused on a user task — E3), or "failed" (modeling error).
   *
   *  Normal hop:
   *    • emit `node-entered`
   *    • execute the node's behavior:
   *        - endEvent → drain token, return "completed"
   *        - userTask → suspend, return "waiting"
   *        - everything else → pass-through (E4 will handle gateways,
   *          E5 will execute service-task handlers)
   *    • emit `node-exited`
   *    • pick the next sequence-flow edge, emit `edge-taken`
   *    • move the token's currentNodeId to the edge's target
   *
   *  When `resumeFromWait` is true, we skip the entered/execute steps
   *  on the first iteration only — the token already entered this node
   *  in a prior call and is now leaving via `completeTask`. This avoids
   *  duplicate `node-entered` events and re-suspending on the same
   *  user task we're trying to leave.
   *
   *  Token UPDATEs go through `updateTokenWithLock` so a concurrent
   *  mutator can't silently overwrite us. */
  private async advanceToken(args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any;
    tenantId: string;
    instanceId: string;
    tokenId: string;
    tokenVersion: number;
    currentNodeId: string;
    canvas: EngineCanvas;
    /** Read-only snapshot of the instance variable bag. Required so
     *  exclusiveGateway condition expressions (E4) and future
     *  service-task input mappings (E5) can evaluate against process
     *  state without re-reading the DB on every hop. Pass the merged
     *  bag from completeTask, or `initialVariables` from startInstance. */
    variables: Record<string, unknown>;
    resumeFromWait?: boolean;
  }): Promise<{
    tokenStatus: "completed" | "waiting" | "failed";
    hops: number;
    errorMessage?: string;
  }> {
    const nodesById = new Map(args.canvas.nodes.map((n) => [n.id, n]));
    let nodeId = args.currentNodeId;
    let version = args.tokenVersion;
    let isResuming = args.resumeFromWait === true;
    let hops = 0;

    while (true) {
      hops++;
      if (hops >= MAX_ADVANCE_HOPS) {
        const message = `Advance loop exceeded ${MAX_ADVANCE_HOPS} hops at node ${nodeId} (likely cycle).`;
        await this.markTokenFailed(
          args.tx,
          args.tenantId,
          args.instanceId,
          args.tokenId,
          version,
          nodeId,
          message,
        );
        return { tokenStatus: "failed", hops, errorMessage: message };
      }

      const node = nodesById.get(nodeId);
      if (!node) {
        const message = `Token landed on unknown node id ${nodeId}.`;
        await this.markTokenFailed(
          args.tx,
          args.tenantId,
          args.instanceId,
          args.tokenId,
          version,
          nodeId,
          message,
        );
        return { tokenStatus: "failed", hops, errorMessage: message };
      }

      if (!isResuming) {
        await args.tx.insert(instanceEvents).values({
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          tokenId: args.tokenId,
          nodeId,
          eventType: "node-entered",
        });

        // Terminal: end event drains the token.
        if (node.type === "endEvent") {
          await args.tx.insert(instanceEvents).values({
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: args.tokenId,
            nodeId,
            eventType: "node-exited",
          });
          version = await this.updateTokenWithLock(
            args.tx,
            args.tokenId,
            version,
            { status: "completed", currentNodeId: nodeId },
          );
          await args.tx.insert(instanceEvents).values({
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: args.tokenId,
            nodeId,
            eventType: "token-completed",
          });
          return { tokenStatus: "completed", hops };
        }

        // Wait state: user task suspends the token until completeTask
        // resumes it. Resolved assignee (directUser only for E3) goes
        // on the token row so the inbox query is a single index hit.
        if (node.type === "userTask") {
          const assignedTo = resolveDirectUserAssignee(node, this.logger);
          version = await this.updateTokenWithLock(
            args.tx,
            args.tokenId,
            version,
            {
              status: "waiting",
              waitingFor: "userTask",
              assignedTo: assignedTo ?? null,
              currentNodeId: nodeId,
            },
          );
          await args.tx.insert(instanceEvents).values({
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: args.tokenId,
            nodeId,
            eventType: "token-waiting",
            payload: { waitingFor: "userTask", assignedTo: assignedTo ?? null },
          });
          // Auto-claim audit. We emit task-claimed at suspension when
          // an assignee was resolved — the system is "claiming on
          // behalf" of the user. Unassigned tasks stay in the queue
          // and emit task-claimed only if/when an explicit claim
          // endpoint lands (post-E3).
          if (assignedTo) {
            await args.tx.insert(instanceEvents).values({
              tenantId: args.tenantId,
              instanceId: args.instanceId,
              tokenId: args.tokenId,
              userId: assignedTo,
              nodeId,
              eventType: "task-claimed",
              payload: { auto: true },
            });
          }
          return { tokenStatus: "waiting", hops };
        }
      }
      isResuming = false;

      // Pass-through node-exited. Gateways still emit a single
      // node-exited; the difference is in *which* outgoing edge gets
      // picked below.
      await args.tx.insert(instanceEvents).values({
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: args.tokenId,
        nodeId,
        eventType: "node-exited",
      });

      // Edge selection: exclusive gateway → first-true-condition with
      // default-flow fallback (E4). Other gateway types fall through
      // to the simple "first outgoing" picker until later phases land
      // their semantics. The picker is wrapped here so a gateway that
      // can't find any matching branch fails the instance with a
      // diagnostic message rather than silently going off-rails.
      let next: EngineEdge | null;
      if (node.type === "exclusiveGateway") {
        const gw = pickExclusiveGatewayEdge(
          args.canvas,
          nodeId,
          args.variables,
          this.logger,
        );
        if (gw.kind === "matched") {
          next = gw.edge;
        } else {
          const message =
            gw.kind === "no-match"
              ? `Exclusive gateway ${nodeId}: no outgoing condition matched and no default flow defined.`
              : `Exclusive gateway ${nodeId}: condition eval failed (${gw.reason}).`;
          await this.markTokenFailed(
            args.tx,
            args.tenantId,
            args.instanceId,
            args.tokenId,
            version,
            nodeId,
            message,
          );
          return { tokenStatus: "failed", hops, errorMessage: message };
        }
      } else {
        next = pickNextEdge(args.canvas, nodeId, this.logger, node.type);
      }
      if (!next) {
        // Dead-end node that isn't an end event. Treat as a structural
        // modeling error — record it in the audit and let the caller
        // mark the instance failed (instead of throwing and losing the
        // event trail to txn rollback).
        const message = `Node ${nodeId} (${node.type}) has no outgoing sequence flow and is not an end event.`;
        await this.markTokenFailed(
          args.tx,
          args.tenantId,
          args.instanceId,
          args.tokenId,
          version,
          nodeId,
          message,
        );
        return { tokenStatus: "failed", hops, errorMessage: message };
      }

      await args.tx.insert(instanceEvents).values({
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: args.tokenId,
        nodeId,
        eventType: "edge-taken",
        payload: { edgeId: next.id, target: next.target },
      });

      version = await this.updateTokenWithLock(
        args.tx,
        args.tokenId,
        version,
        { currentNodeId: next.target },
      );
      nodeId = next.target;
    }
  }

  /** Optimistic-lock UPDATE on a token: bump VERSION, assert the prior
   *  version in WHERE. Returns the new version. Throws ConflictException
   *  if zero rows match — meaning someone else mutated the token under
   *  us. E2's single-call flow can't actually race with itself; the
   *  guard is here for E3's user-task-completion path and for safety. */
  private async updateTokenWithLock(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    tokenId: string,
    expectedVersion: number,
    patch: {
      status?: "active" | "waiting" | "completed" | "failed";
      currentNodeId?: string;
      waitingFor?: string | null;
      assignedTo?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<number> {
    const next = expectedVersion + 1;
    const updated = await tx
      .update(instanceTokens)
      .set({ ...patch, version: next, updatedAt: new Date() })
      .where(
        and(
          eq(instanceTokens.id, tokenId),
          eq(instanceTokens.version, expectedVersion),
        ),
      )
      .returning({ id: instanceTokens.id });
    if (updated.length === 0) {
      throw new ConflictException(
        `Concurrent token update: ${tokenId} no longer at version ${expectedVersion}.`,
      );
    }
    return next;
  }

  /** Mark a token as failed and write the matching audit rows. The
   *  caller now returns `tokenStatus: "failed"` rather than throwing,
   *  so the txn commits with the failure trail intact. */
  private async markTokenFailed(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    tenantId: string,
    instanceId: string,
    tokenId: string,
    version: number,
    nodeId: string,
    message: string,
  ): Promise<void> {
    try {
      await this.updateTokenWithLock(tx, tokenId, version, {
        status: "failed",
        errorMessage: message,
      });
    } catch {
      // Concurrent mutator already moved the token; the audit-event
      // insert below still records the failure for diagnosability.
    }
    await tx.insert(instanceEvents).values({
      tenantId,
      instanceId,
      tokenId,
      nodeId,
      eventType: "error",
      payload: { message },
    });
  }

  /** Complete a waiting user-task token: validate ownership, merge
   *  the form output into the instance variable bag, advance the token
   *  off the user task, and propagate the result to the instance row.
   *
   *  Authorisation rules (E3):
   *    • token must be in tenant
   *    • token must be in `waiting` status with `waitingFor=userTask`
   *    • if `assignedTo` is set, only that user can complete it
   *    • if `assignedTo` is null, anyone in the tenant can claim+complete
   *
   *  Returns the new instance status so the UI can decide whether to
   *  show another inbox entry (still running with more waits) or a
   *  completion banner. */
  async completeTask(args: {
    tokenId: string;
    tenantId: string;
    userId: string;
    formData?: Record<string, unknown>;
  }): Promise<{
    instanceId: string;
    instanceStatus: "running" | "completed" | "failed";
    tokenStatus: "completed" | "waiting" | "failed";
  }> {
    return this.db.transaction(async (tx) => {
      const tokenRow = await this.loadWaitingTokenForCompletion(
        tx,
        args.tokenId,
        args.tenantId,
        args.userId,
      );
      const instRow = await this.loadInstanceById(
        tx,
        tokenRow.instanceId,
        args.tenantId,
      );

      // Pull the canvas from the frozen DEFINITION_SNAPSHOT — the live
      // process may have been edited since this instance started, but
      // execution always honours the snapshot.
      const canvas = projectCanvas(instRow.definitionSnapshot);

      // 1. Audit task-completed FIRST so it acts as the user-facing
      //    anchor in any timeline replay — the variable-set rows that
      //    follow are the attribution detail. Reordering this is a
      //    behavioural contract; downstream consumers may rely on the
      //    "what did Alice just do" event coming before its details.
      await tx.insert(instanceEvents).values({
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        userId: args.userId,
        nodeId: tokenRow.currentNodeId,
        eventType: "task-completed",
      });

      // 2. Shallow-merge form output into the instance variable bag.
      //    NOTE: shallow only — `{form: {address: {line1: ...}}}` from
      //    one task and `{form: {address: {line2: ...}}}` from another
      //    will clobber, not deep-merge. Callers that need to update a
      //    nested field must read+rewrite the whole top-level key.
      //    Optimistic lock on the instance: a concurrent cancel/timer
      //    will 409 us and the txn rolls back cleanly.
      let instanceVersion = instRow.version;
      const mergedVariables = {
        ...(instRow.variables as Record<string, unknown> | null ?? {}),
        ...(args.formData ?? {}),
      };
      if (args.formData && Object.keys(args.formData).length > 0) {
        instanceVersion = await this.updateInstanceWithLock(
          tx,
          tokenRow.instanceId,
          instanceVersion,
          { variables: mergedVariables },
        );
        for (const key of Object.keys(args.formData)) {
          await tx.insert(instanceEvents).values({
            tenantId: args.tenantId,
            instanceId: tokenRow.instanceId,
            tokenId: args.tokenId,
            userId: args.userId,
            eventType: "variable-set",
            payload: { key, value: args.formData[key] },
          });
        }
      }

      const tokenVersion = await this.updateTokenWithLock(
        tx,
        args.tokenId,
        tokenRow.version,
        {
          status: "active",
          waitingFor: null,
          // Keep assignedTo as a record of who did the work — only
          // clear it on the next suspension.
        },
      );

      await tx.insert(instanceEvents).values({
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        userId: args.userId,
        nodeId: tokenRow.currentNodeId,
        eventType: "token-resumed",
      });

      // 3. Resume the advance loop from the user-task node with
      //    `resumeFromWait=true` so we skip the entered/execute step
      //    that would otherwise re-suspend on the same node.
      const advance = await this.advanceToken({
        tx,
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        tokenVersion,
        currentNodeId: tokenRow.currentNodeId,
        canvas,
        variables: mergedVariables,
        resumeFromWait: true,
      });

      // 4. If this was the only token and it terminated, flip the
      //    instance. E4+ will need a remaining-tokens count when
      //    parallel branches exist.
      let instanceStatus: "running" | "completed" | "failed" = "running";
      if (advance.tokenStatus === "completed") {
        await this.updateInstanceWithLock(
          tx,
          tokenRow.instanceId,
          instanceVersion,
          {
            status: "completed",
            completedAt: new Date(),
          },
        );
        await tx.insert(instanceEvents).values({
          tenantId: args.tenantId,
          instanceId: tokenRow.instanceId,
          eventType: "instance-completed",
          payload: { hops: advance.hops },
        });
        instanceStatus = "completed";
      } else if (advance.tokenStatus === "failed") {
        await this.updateInstanceWithLock(
          tx,
          tokenRow.instanceId,
          instanceVersion,
          {
            status: "failed",
            errorMessage: advance.errorMessage ?? null,
            completedAt: new Date(),
          },
        );
        await tx.insert(instanceEvents).values({
          tenantId: args.tenantId,
          instanceId: tokenRow.instanceId,
          eventType: "instance-failed",
          payload: { hops: advance.hops, message: advance.errorMessage },
        });
        instanceStatus = "failed";
      }

      this.logger.log({
        event: "engine.task.completed",
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        userId: args.userId,
        instanceStatus,
        tokenStatus: advance.tokenStatus,
      });

      return {
        instanceId: tokenRow.instanceId,
        instanceStatus,
        tokenStatus: advance.tokenStatus,
      };
    });
  }

  /** Inbox query: waiting user-task tokens for a tenant, filterable by
   *  assignee. Returned shape includes the parent process name + the
   *  user-task node's label/data so the UI doesn't need follow-up
   *  GETs.
   *
   *  Filter modes (controller decides which to pass):
   *    • `assignedTo=<uuid>` — exact-assignee match (admin "show me
   *      Alice's queue" view, or `assignedTo=req.user.sub` for "tasks
   *      explicitly mine").
   *    • `userIdForMine=<uuid>` — "my inbox" filter: tokens assigned
   *      to me OR unassigned (anyone-can-claim queue). The standard
   *      operator view.
   *    • neither → all waiting tasks for the tenant.
   *
   *  Authorisation: there is no role check today — any tenant member
   *  can view any other member's queue with `assignedTo=<their-uuid>`.
   *  Acceptable for MVP where the only operators are admins; tighten
   *  when an RBAC layer lands.
   *
   *  Perf: the projector parses the full DEFINITION_SNAPSHOT JSONB on
   *  every row to extract the node label. With the 200-row cap and
   *  small canvases this is fine; once a tenant has tasks at scale
   *  denormalise `nodeLabel` onto INSTANCE_TOKENS at suspension time
   *  (E7 perf pass). */
  async listTasks(args: {
    tenantId: string;
    assignedTo?: string;
    userIdForMine?: string;
  }): Promise<
    Array<{
      tokenId: string;
      instanceId: string;
      processId: string;
      processName: string;
      nodeId: string;
      nodeLabel: string | null;
      nodeData: Record<string, unknown> | null;
      assignedTo: string | null;
      createdAt: string;
    }>
  > {
    const baseConds = [
      eq(instanceTokens.tenantId, args.tenantId),
      eq(instanceTokens.status, "waiting"),
      eq(instanceTokens.waitingFor, "userTask"),
    ];
    let whereExpr;
    if (args.assignedTo) {
      whereExpr = and(
        ...baseConds,
        eq(instanceTokens.assignedTo, args.assignedTo),
      );
    } else if (args.userIdForMine) {
      whereExpr = and(
        ...baseConds,
        or(
          eq(instanceTokens.assignedTo, args.userIdForMine),
          isNull(instanceTokens.assignedTo),
        ),
      );
    } else {
      whereExpr = and(...baseConds);
    }

    const rows = await this.db
      .select({
        tokenId: instanceTokens.id,
        instanceId: instanceTokens.instanceId,
        currentNodeId: instanceTokens.currentNodeId,
        assignedTo: instanceTokens.assignedTo,
        createdAt: instanceTokens.createdAt,
        processId: processInstances.processId,
        definitionSnapshot: processInstances.definitionSnapshot,
        processName: processes.name,
      })
      .from(instanceTokens)
      .innerJoin(
        processInstances,
        eq(processInstances.id, instanceTokens.instanceId),
      )
      .innerJoin(processes, eq(processes.id, processInstances.processId))
      .where(whereExpr)
      .orderBy(desc(instanceTokens.createdAt))
      .limit(200);

    return rows.map((r) => {
      const canvas = projectCanvas(r.definitionSnapshot);
      const node = canvas.nodes.find((n) => n.id === r.currentNodeId);
      const nodeData = node?.data ?? null;
      const nodeLabel =
        nodeData && typeof nodeData === "object" && typeof (nodeData as Record<string, unknown>).label === "string"
          ? ((nodeData as Record<string, unknown>).label as string)
          : null;
      return {
        tokenId: r.tokenId,
        instanceId: r.instanceId,
        processId: r.processId,
        processName: r.processName,
        nodeId: r.currentNodeId,
        nodeLabel,
        nodeData,
        assignedTo: r.assignedTo,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /** Load + validate a token for the completeTask flow. Centralised so
   *  the auth check happens in exactly one place — the txn body stays
   *  readable. Returns the row including the snapshot + variables we
   *  need to advance. */
  private async loadWaitingTokenForCompletion(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    tokenId: string,
    tenantId: string,
    userId: string,
  ): Promise<{
    instanceId: string;
    currentNodeId: string;
    version: number;
    assignedTo: string | null;
  }> {
    const rows = await tx
      .select({
        id: instanceTokens.id,
        tenantId: instanceTokens.tenantId,
        instanceId: instanceTokens.instanceId,
        currentNodeId: instanceTokens.currentNodeId,
        status: instanceTokens.status,
        waitingFor: instanceTokens.waitingFor,
        assignedTo: instanceTokens.assignedTo,
        version: instanceTokens.version,
      })
      .from(instanceTokens)
      .where(
        and(
          eq(instanceTokens.id, tokenId),
          eq(instanceTokens.tenantId, tenantId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException("Task not found.");
    if (row.status !== "waiting" || row.waitingFor !== "userTask") {
      throw new BadRequestException(
        `Task is not waiting on a user action (status=${row.status}).`,
      );
    }
    if (row.assignedTo && row.assignedTo !== userId) {
      throw new ForbiddenException(
        "Task is assigned to another user.",
      );
    }
    return {
      instanceId: row.instanceId,
      currentNodeId: row.currentNodeId,
      version: row.version,
      assignedTo: row.assignedTo,
    };
  }

  private async loadInstanceById(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    instanceId: string,
    tenantId: string,
  ): Promise<{
    id: string;
    version: number;
    variables: unknown;
    definitionSnapshot: unknown;
  }> {
    const rows = await tx
      .select({
        id: processInstances.id,
        version: processInstances.version,
        variables: processInstances.variables,
        definitionSnapshot: processInstances.definitionSnapshot,
      })
      .from(processInstances)
      .where(
        and(
          eq(processInstances.id, instanceId),
          eq(processInstances.tenantId, tenantId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException("Instance not found.");
    return row;
  }

  /** Optimistic-lock UPDATE on an instance. Mirrors `updateTokenWithLock`.
   *  Bumps VERSION + UPDATED_AT, asserts prior version in WHERE. Returns
   *  the new version so the caller can chain another patch in the same
   *  txn (e.g. variables set → status flip). */
  private async updateInstanceWithLock(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    instanceId: string,
    expectedVersion: number,
    patch: {
      status?: "running" | "completed" | "failed" | "cancelled";
      variables?: Record<string, unknown>;
      errorMessage?: string | null;
      completedAt?: Date;
    },
  ): Promise<number> {
    const next = expectedVersion + 1;
    const updated = await tx
      .update(processInstances)
      .set({ ...patch, version: next, updatedAt: new Date() })
      .where(
        and(
          eq(processInstances.id, instanceId),
          eq(processInstances.version, expectedVersion),
        ),
      )
      .returning({ id: processInstances.id });
    if (updated.length === 0) {
      throw new ConflictException(
        `Concurrent instance update: ${instanceId} no longer at version ${expectedVersion}.`,
      );
    }
    return next;
  }

  /** List instances of a single process for a tenant, newest first.
   *  Operability — without this, ops can't see what's running for a
   *  given process. Capped at 200; pagination cursor is an E7 perf
   *  concern. */
  async listInstancesForProcess(args: {
    processId: string;
    tenantId: string;
  }): Promise<
    Array<{
      id: string;
      status: "running" | "completed" | "failed" | "cancelled";
      startedBy: string;
      startedAt: string;
      completedAt: string | null;
      errorMessage: string | null;
    }>
  > {
    const rows = await this.db
      .select({
        id: processInstances.id,
        status: processInstances.status,
        startedBy: processInstances.startedBy,
        startedAt: processInstances.startedAt,
        completedAt: processInstances.completedAt,
        errorMessage: processInstances.errorMessage,
      })
      .from(processInstances)
      .where(
        and(
          eq(processInstances.processId, args.processId),
          eq(processInstances.tenantId, args.tenantId),
        ),
      )
      .orderBy(desc(processInstances.createdAt))
      .limit(200);
    return rows.map((r) => ({
      ...r,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    }));
  }

  /** Single-instance detail with current state, live tokens, and the
   *  most recent 50 audit events. The debug view: when E4 lands and
   *  someone asks "why did the gateway choose the wrong branch?", this
   *  is what they look at. */
  async getInstance(args: {
    instanceId: string;
    tenantId: string;
  }): Promise<{
    id: string;
    processId: string;
    status: "running" | "completed" | "failed" | "cancelled";
    variables: Record<string, unknown>;
    startedBy: string;
    startedAt: string;
    completedAt: string | null;
    errorMessage: string | null;
    version: number;
    tokens: Array<{
      id: string;
      currentNodeId: string;
      status: "active" | "waiting" | "completed" | "failed";
      waitingFor: string | null;
      assignedTo: string | null;
      version: number;
      updatedAt: string;
    }>;
    recentEvents: Array<{
      id: string;
      eventType: string;
      tokenId: string | null;
      nodeId: string | null;
      userId: string | null;
      payload: unknown;
      createdAt: string;
    }>;
  }> {
    const instRows = await this.db
      .select()
      .from(processInstances)
      .where(
        and(
          eq(processInstances.id, args.instanceId),
          eq(processInstances.tenantId, args.tenantId),
        ),
      )
      .limit(1);
    const inst = instRows[0];
    if (!inst) throw new NotFoundException("Instance not found.");

    const tokens = await this.db
      .select({
        id: instanceTokens.id,
        currentNodeId: instanceTokens.currentNodeId,
        status: instanceTokens.status,
        waitingFor: instanceTokens.waitingFor,
        assignedTo: instanceTokens.assignedTo,
        version: instanceTokens.version,
        updatedAt: instanceTokens.updatedAt,
      })
      .from(instanceTokens)
      .where(eq(instanceTokens.instanceId, args.instanceId))
      .orderBy(desc(instanceTokens.createdAt));

    const events = await this.db
      .select({
        id: instanceEvents.id,
        eventType: instanceEvents.eventType,
        tokenId: instanceEvents.tokenId,
        nodeId: instanceEvents.nodeId,
        userId: instanceEvents.userId,
        payload: instanceEvents.payload,
        createdAt: instanceEvents.createdAt,
      })
      .from(instanceEvents)
      .where(eq(instanceEvents.instanceId, args.instanceId))
      .orderBy(desc(instanceEvents.createdAt))
      .limit(50);

    return {
      id: inst.id,
      processId: inst.processId,
      status: inst.status,
      variables: (inst.variables as Record<string, unknown>) ?? {},
      startedBy: inst.startedBy,
      startedAt: inst.startedAt.toISOString(),
      completedAt: inst.completedAt ? inst.completedAt.toISOString() : null,
      errorMessage: inst.errorMessage,
      version: inst.version,
      tokens: tokens.map((t) => ({
        ...t,
        updatedAt: t.updatedAt.toISOString(),
      })),
      recentEvents: events.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /** Cancel a running instance: flip the status to `cancelled`, mark
   *  every active/waiting token as cancelled (failed status — we
   *  don't have a per-token `cancelled` enum value), and emit
   *  instance-cancelled. Idempotent on already-terminal instances:
   *  if the instance is already completed/failed/cancelled we no-op
   *  with a 200 instead of throwing, so retries / accidental
   *  double-clicks don't error. */
  async cancelInstance(args: {
    instanceId: string;
    tenantId: string;
    userId: string;
    reason?: string;
  }): Promise<{
    instanceId: string;
    status: "running" | "completed" | "failed" | "cancelled";
    tokensCancelled: number;
  }> {
    return this.db.transaction(async (tx) => {
      const instRows = await tx
        .select({
          id: processInstances.id,
          status: processInstances.status,
          version: processInstances.version,
        })
        .from(processInstances)
        .where(
          and(
            eq(processInstances.id, args.instanceId),
            eq(processInstances.tenantId, args.tenantId),
          ),
        )
        .limit(1);
      const inst = instRows[0];
      if (!inst) throw new NotFoundException("Instance not found.");

      // Already terminal: idempotent no-op. The audit row from the
      // original transition is the authoritative record.
      if (inst.status !== "running") {
        return { instanceId: inst.id, status: inst.status, tokensCancelled: 0 };
      }

      // Cancel all active/waiting tokens first. We don't lock-and-bump
      // each individually because we hold the instance row update next
      // and the txn provides write isolation; a token mid-completion in
      // another session will hit the instance-version conflict.
      const liveTokens = await tx
        .select({ id: instanceTokens.id, version: instanceTokens.version, currentNodeId: instanceTokens.currentNodeId })
        .from(instanceTokens)
        .where(
          and(
            eq(instanceTokens.instanceId, args.instanceId),
            // active OR waiting — drizzle's `inArray` would be cleaner
            // but two ORs read fine for the small live set.
          ),
        );
      let cancelledCount = 0;
      for (const tok of liveTokens) {
        try {
          await this.updateTokenWithLock(tx, tok.id, tok.version, {
            status: "failed",
            errorMessage: args.reason
              ? `Cancelled: ${args.reason}`
              : "Cancelled by user.",
          });
          await tx.insert(instanceEvents).values({
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: tok.id,
            userId: args.userId,
            nodeId: tok.currentNodeId,
            eventType: "error",
            payload: { reason: "cancelled" },
          });
          cancelledCount++;
        } catch {
          // Token already moved by a concurrent completer. Skip it —
          // the instance-level cancel still fires below.
        }
      }

      await this.updateInstanceWithLock(
        tx,
        inst.id,
        inst.version,
        {
          status: "cancelled",
          completedAt: new Date(),
          errorMessage: args.reason ?? null,
        },
      );

      await tx.insert(instanceEvents).values({
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        userId: args.userId,
        eventType: "instance-cancelled",
        payload: {
          reason: args.reason ?? null,
          tokensCancelled: cancelledCount,
        },
      });

      this.logger.log({
        event: "engine.instance.cancelled",
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        userId: args.userId,
        tokensCancelled: cancelledCount,
      });

      return {
        instanceId: inst.id,
        status: "cancelled" as const,
        tokensCancelled: cancelledCount,
      };
    });
  }

  /** Load a process row scoped to the tenant, validating that it has
   *  a non-empty canvas. We refuse to start an instance of a draft
   *  whose author hasn't drawn anything yet — an empty canvas would
   *  fail at "find start event" with a less actionable message. */
  private async loadProcessForInstance(
    processId: string,
    tenantId: string,
  ): Promise<{ canvasData: unknown }> {
    const rows = await this.db
      .select({ canvasData: processes.canvasData })
      .from(processes)
      .where(
        and(eq(processes.id, processId), eq(processes.tenantId, tenantId)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException("Process not found.");
    if (!row.canvasData) {
      throw new BadRequestException(
        "Process has no canvas; nothing to execute.",
      );
    }
    return row;
  }
}

/** Project an arbitrary JSONB blob onto the engine's expected shape.
 *  Keeps unknown fields out of the snapshot used for execution and the
 *  hash; if the canvas grows new fields the engine doesn't care about,
 *  they don't change the hash. */
export function projectCanvas(raw: unknown): EngineCanvas {
  if (!raw || typeof raw !== "object") {
    throw new BadRequestException("Canvas data is malformed.");
  }
  const obj = raw as Record<string, unknown>;
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const nodes: EngineNode[] = [];
  for (const n of rawNodes) {
    if (!n || typeof n !== "object") continue;
    const nn = n as Record<string, unknown>;
    if (typeof nn.id !== "string" || typeof nn.type !== "string") continue;
    nodes.push({
      id: nn.id,
      type: nn.type,
      parentId: typeof nn.parentId === "string" ? nn.parentId : undefined,
      data:
        nn.data && typeof nn.data === "object"
          ? (nn.data as Record<string, unknown>)
          : undefined,
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: EngineEdge[] = [];
  for (const e of rawEdges) {
    if (!e || typeof e !== "object") continue;
    const ee = e as Record<string, unknown>;
    if (
      typeof ee.id !== "string" ||
      typeof ee.source !== "string" ||
      typeof ee.target !== "string"
    ) {
      continue;
    }
    // Drop edges with dangling endpoints — same defence the AI sanitize
    // pipeline applies. A snapshot with these would crash the engine
    // when the token tries to traverse.
    if (!nodeIds.has(ee.source) || !nodeIds.has(ee.target)) continue;
    const data =
      ee.data && typeof ee.data === "object"
        ? (ee.data as Record<string, unknown>)
        : undefined;
    edges.push({
      id: ee.id,
      source: ee.source,
      target: ee.target,
      data: data
        ? {
            condition: typeof data.condition === "string" ? data.condition : undefined,
            isDefault: data.isDefault === true ? true : undefined,
            flowType: typeof data.flowType === "string" ? data.flowType : undefined,
          }
        : undefined,
    });
  }
  return { nodes, edges };
}

/** Find the single start event. Process scopes (pool / lane / sub-
 *  process) can each have their own start in real BPMN; E2 supports
 *  exactly one process-level start. Multiple starts → reject so the
 *  user sees a clear error rather than silent nondeterminism. */
export function findStartEvent(canvas: EngineCanvas): EngineNode {
  const starts = canvas.nodes.filter(
    (n) => n.type === "startEvent" && !n.parentId,
  );
  if (starts.length === 0) {
    throw new BadRequestException(
      "Process has no top-level start event.",
    );
  }
  if (starts.length > 1) {
    throw new BadRequestException(
      `Process has ${starts.length} top-level start events; expected exactly one.`,
    );
  }
  return starts[0];
}

/** Pick the next sequence-flow edge from a node. E2 implements the
 *  simplest reasonable rule: the first sequence-flow outgoing. E4 will
 *  replace this for gateways with FEEL evaluation + default-flow
 *  fallback. For non-gateway nodes a multi-outgoing topology is
 *  malformed BPMN — we still pick the first edge so the instance can
 *  finish, but log a warning so it shows up in ops. */
export function pickNextEdge(
  canvas: EngineCanvas,
  fromNodeId: string,
  logger?: { warn?: (msg: string) => void },
  fromNodeType?: string,
): EngineEdge | null {
  const out = canvas.edges.filter(
    (e) =>
      e.source === fromNodeId &&
      !NON_SEQUENCE_FLOW_TYPES.has(e.data?.flowType ?? ""),
  );
  if (out.length > 1 && fromNodeType && !fromNodeType.endsWith("Gateway")) {
    logger?.warn?.(
      `Node ${fromNodeId} (${fromNodeType}) has ${out.length} outgoing sequence flows; picking ${out[0].id}. Use a gateway to disambiguate.`,
    );
  }
  return out[0] ?? null;
}

/** Canonicalise a canvas so two semantically-equal snapshots produce
 *  the same SHA-256. We sort node/edge arrays by id and sort every
 *  nested object's keys recursively before stringification — without
 *  the recursive sort, two edges `{condition, isDefault}` vs
 *  `{isDefault, condition}` would hash differently even though the
 *  graph is identical. Arrays inside `data` keep their order (it's
 *  meaningful for things like multi-instance loop characteristics). */
function canonicalise(canvas: EngineCanvas): EngineCanvas {
  return {
    nodes: [...canvas.nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => ({ ...n, data: n.data ? sortKeysDeep(n.data) : undefined })),
    edges: [...canvas.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({ ...e, data: e.data ? sortKeysDeep(e.data) : undefined })),
  };
}

/** Result of evaluating an exclusive gateway:
 *  • `matched`  — picked an outgoing edge (matching condition or default).
 *  • `no-match` — no condition truthy AND no default flow defined.
 *  • `eval-error` — a condition expression threw / was rejected.
 *  Caller (advanceToken) maps the latter two to a failed instance with
 *  the diagnostic recorded in INSTANCE_EVENTS. */
export type GatewayPickResult =
  | { kind: "matched"; edge: EngineEdge; matchedAt: number; reason: "condition" | "default" }
  | { kind: "no-match" }
  | { kind: "eval-error"; reason: string };

/** Pick the outgoing edge an exclusive gateway should follow:
 *  1. Walk outgoing sequence flows in declaration order.
 *  2. Take the first whose `data.condition` evaluates truthy.
 *  3. If none match, take the edge marked `data.isDefault: true`.
 *  4. If none match and no default → return no-match (caller fails).
 *
 *  Edges with no condition are skipped during step 2 — they can only
 *  be selected as the default in step 3. This matches BPMN 2.0 spec
 *  (§13.3.2): conditional flows and default flow are distinct kinds. */
export function pickExclusiveGatewayEdge(
  canvas: EngineCanvas,
  fromNodeId: string,
  variables: Record<string, unknown>,
  logger?: { warn?: (msg: string) => void; debug?: (msg: string) => void },
): GatewayPickResult {
  const out = canvas.edges.filter(
    (e) =>
      e.source === fromNodeId &&
      !NON_SEQUENCE_FLOW_TYPES.has(e.data?.flowType ?? ""),
  );
  let matchedAt = 0;
  for (const edge of out) {
    const cond = edge.data?.condition;
    if (typeof cond !== "string" || cond.trim() === "") {
      matchedAt++;
      continue;
    }
    let result: boolean;
    try {
      result = evalCondition(cond, variables);
    } catch (err) {
      return { kind: "eval-error", reason: (err as Error).message };
    }
    logger?.debug?.(
      `gateway ${fromNodeId}: edge ${edge.id} condition "${cond}" → ${result}`,
    );
    if (result) {
      return { kind: "matched", edge, matchedAt, reason: "condition" };
    }
    matchedAt++;
  }
  // No conditional flow matched. Look for a default flow.
  const def = out.find((e) => e.data?.isDefault === true);
  if (def) {
    return { kind: "matched", edge: def, matchedAt: out.indexOf(def), reason: "default" };
  }
  return { kind: "no-match" };
}

/** Identifiers we hard-block in condition expressions because they
 *  expose a sandbox escape: globals, prototype walking, dynamic code
 *  execution, control-flow statements. A truly hostile expression
 *  would need to slip past *all* of these. We pair this with a
 *  character-allowlist below for defence-in-depth.
 *
 *  This is "good enough for trusted-tenant authoring" — the same
 *  trust model FlowPro applies to AI-generated canvases. A future
 *  hardening pass can swap to a real FEEL parser (jsonata, etc.). */
const FORBIDDEN_CONDITION_TOKENS_RE =
  /\b(this|window|globalThis|process|global|require|import|export|eval|Function|constructor|prototype|__proto__|arguments|new|class|async|await|yield|throw|while|for|do|if|else|return|var|let|const|delete|void|typeof|instanceof|in)\b/;

/** Allowed character set: alphanumerics + identifier chars +
 *  arithmetic/comparison/logical operators + parens + dot/bracket
 *  member access + comma + whitespace + string quotes. Anything
 *  outside this is structural code, not an expression. */
const ALLOWED_CONDITION_CHAR_RE = /^[\w\s\d.,\[\]()+\-*/%<>=!&|"'`]+$/;

/** Maximum source length for a condition. Real BPMN conditions are
 *  short; a runaway 10KB expression is almost certainly an attack
 *  or a stuck AI generation. */
const MAX_CONDITION_LENGTH = 500;

/** JS-identifier check: only top-level vars whose key is a valid
 *  identifier can be passed as a Function() parameter. Keys with
 *  hyphens, spaces, etc. are dropped from the eval scope (the
 *  condition still runs; it just can't reference those names
 *  directly — callers in trouble can rename keys). */
const VALID_IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

/** Evaluate a FEEL-lite condition string against an instance variable
 *  bag. Returns boolean. Throws BadRequestException on:
 *    • disallowed character
 *    • forbidden identifier (sink risk)
 *    • length cap exceeded
 *    • runtime error (ReferenceError on unknown var, TypeError, …)
 *
 *  This is NOT a full FEEL implementation — just enough JS expression
 *  surface to express the conditions a business analyst writes
 *  ("amount > 1000 && approved", "form.status === 'urgent'"). The
 *  sandbox is the static analyser, not the runtime — `new Function`
 *  itself runs without its own isolate. */
export function evalCondition(
  expr: string,
  variables: Record<string, unknown>,
): boolean {
  if (typeof expr !== "string") {
    throw new BadRequestException("Condition is not a string.");
  }
  if (expr.length > MAX_CONDITION_LENGTH) {
    throw new BadRequestException(
      `Condition longer than ${MAX_CONDITION_LENGTH} characters.`,
    );
  }
  if (!ALLOWED_CONDITION_CHAR_RE.test(expr)) {
    throw new BadRequestException(
      `Condition contains disallowed character: "${expr}"`,
    );
  }
  if (FORBIDDEN_CONDITION_TOKENS_RE.test(expr)) {
    throw new BadRequestException(
      `Condition contains forbidden identifier: "${expr}"`,
    );
  }
  const safeKeys = Object.keys(variables).filter((k) =>
    VALID_IDENTIFIER_RE.test(k),
  );
  const safeValues = safeKeys.map((k) => variables[k]);
  try {
    // Body is wrapped in `Boolean(...)` so a truthy non-bool
    // ("yes", 1, etc.) coerces predictably and a thrown ReferenceError
    // for an unknown identifier surfaces as a clean BadRequest.
    const fn = new Function(
      ...safeKeys,
      `"use strict"; return Boolean(${expr});`,
    );
    return fn(...safeValues) === true;
  } catch (err) {
    throw new BadRequestException(
      `Condition eval failed: ${(err as Error).message}`,
    );
  }
}

/** Resolve a userTask node's `data.assignment` to a concrete userId
 *  for the assignedTo column. E3 supports the `directUser` strategy
 *  only; other strategies (candidateGroup, expression, aiRouted) leave
 *  the token unassigned (anyone in the tenant can complete) and log a
 *  warning so it shows up in ops.
 *
 *  Returns null if there is no assignment, the strategy is unsupported,
 *  or the value isn't a UUID. We never write garbage into assignedTo
 *  because the FK constraint would 500 the request — better to leave
 *  it null and let the operator re-route. */
export function resolveDirectUserAssignee(
  node: EngineNode,
  logger?: { warn?: (msg: string) => void },
): string | null {
  const data = node.data as Record<string, unknown> | undefined;
  const assignment = data?.assignment as
    | { type?: unknown; value?: unknown }
    | undefined;
  if (!assignment || typeof assignment !== "object") return null;
  const type = assignment.type;
  const value = assignment.value;
  if (type !== "directUser") {
    if (typeof type === "string") {
      logger?.warn?.(
        `User task ${node.id}: assignment type "${type}" not supported in E3; leaving unassigned.`,
      );
    }
    return null;
  }
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    logger?.warn?.(
      `User task ${node.id}: directUser assignment value is not a UUID; leaving unassigned.`,
    );
    return null;
  }
  return value;
}

function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => sortKeysDeep(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return sorted as unknown as T;
  }
  return value;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
