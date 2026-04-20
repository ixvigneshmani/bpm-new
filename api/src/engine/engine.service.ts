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
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import {
  instanceEvents,
  instanceTokens,
  processInstances,
  processes,
} from "../database/schema";

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
 *  or runaway model error and we fail loudly rather than spin. */
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
      const { tokenStatus, hops } = await this.advanceToken({
        tx,
        tenantId: args.tenantId,
        instanceId: inst.id,
        tokenId: token.id,
        tokenVersion: token.version,
        currentNodeId: startNode.id,
        canvas,
      });

      // 5. If the token completed, the whole instance is done (E2: only
      //    one token per instance). E3+ will need to count remaining
      //    active/waiting tokens before flipping status.
      let instanceStatus: "running" | "completed" | "failed" = "running";
      if (tokenStatus === "completed") {
        await tx
          .update(processInstances)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(processInstances.id, inst.id));
        await tx.insert(instanceEvents).values({
          tenantId: args.tenantId,
          instanceId: inst.id,
          eventType: "instance-completed",
          payload: { hops },
        });
        instanceStatus = "completed";
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
        hops,
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
   *  for this advance call: "completed" (hit an end event) or — once
   *  E3 lands — "waiting" (paused on a user task / timer / message).
   *
   *  Each hop:
   *    • emit `node-entered`
   *    • execute the node's behavior (E2: pass-through for everything
   *      except endEvent)
   *    • emit `node-exited`
   *    • pick the next sequence-flow edge, emit `edge-taken`
   *    • move the token's currentNodeId to the edge's target
   *
   *  The token row itself is updated with optimistic-locking guards on
   *  `version` so a concurrent mutator can't silently overwrite us. */
  private async advanceToken(args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any;
    tenantId: string;
    instanceId: string;
    tokenId: string;
    tokenVersion: number;
    currentNodeId: string;
    canvas: EngineCanvas;
  }): Promise<{ tokenStatus: "completed" | "waiting"; hops: number }> {
    const nodesById = new Map(args.canvas.nodes.map((n) => [n.id, n]));
    let nodeId = args.currentNodeId;
    let version = args.tokenVersion;
    let hops = 0;

    while (true) {
      if (++hops > MAX_ADVANCE_HOPS) {
        await this.markTokenFailed(
          args.tx,
          args.tenantId,
          args.instanceId,
          args.tokenId,
          version,
          `Advance loop exceeded ${MAX_ADVANCE_HOPS} hops at node ${nodeId}.`,
        );
        throw new BadRequestException(
          `Process likely contains a cycle: token exceeded ${MAX_ADVANCE_HOPS} hops.`,
        );
      }

      const node = nodesById.get(nodeId);
      if (!node) {
        // Snapshot integrity bug — should be unreachable because edges
        // were validated to point at known nodes when the snapshot was
        // taken. Surface it loudly rather than silently terminate.
        await this.markTokenFailed(
          args.tx,
          args.tenantId,
          args.instanceId,
          args.tokenId,
          version,
          `Token landed on unknown node id ${nodeId}.`,
        );
        throw new BadRequestException(`Unknown node id in snapshot: ${nodeId}`);
      }

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

      // Pass-through nodes for E2: start, user task (no wait yet),
      // service task (no handler yet), gateways (no branching yet).
      // Each becomes a real handler in E3-E5.
      await args.tx.insert(instanceEvents).values({
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: args.tokenId,
        nodeId,
        eventType: "node-exited",
      });

      const next = pickNextEdge(args.canvas, nodeId);
      if (!next) {
        // Dead-end node that isn't an end event. Treat as a structural
        // error — E2 doesn't know how else to terminate.
        await this.markTokenFailed(
          args.tx,
          args.tenantId,
          args.instanceId,
          args.tokenId,
          version,
          `Node ${nodeId} has no outgoing sequence flow and is not an end event.`,
        );
        throw new BadRequestException(
          `Node ${nodeId} (${node.type}) has no outgoing flow.`,
        );
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

  /** Mark a token as failed and write the matching audit rows. Used
   *  when the interpreter hits an unrecoverable structural error — we
   *  want the audit trail before throwing the exception that aborts
   *  the txn. NOTE: because we throw afterwards, the txn rolls back
   *  and these writes are discarded. They run anyway so that if a
   *  caller catches without re-throwing in the future, the trail is
   *  intact for the partial work. */
  private async markTokenFailed(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    tenantId: string,
    instanceId: string,
    tokenId: string,
    version: number,
    message: string,
  ): Promise<void> {
    try {
      await this.updateTokenWithLock(tx, tokenId, version, {
        status: "failed",
        errorMessage: message,
      });
    } catch {
      // Already conflicted — nothing useful to do; the structural
      // error we're about to throw is the real story.
    }
    await tx.insert(instanceEvents).values({
      tenantId,
      instanceId,
      tokenId,
      eventType: "error",
      payload: { message },
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
 *  fallback; for non-gateway nodes the "first outgoing" choice is
 *  correct (a non-gateway with multiple outgoing is malformed BPMN
 *  but we silently pick one rather than fail in MVP). */
export function pickNextEdge(
  canvas: EngineCanvas,
  fromNodeId: string,
): EngineEdge | null {
  const out = canvas.edges.filter(
    (e) =>
      e.source === fromNodeId &&
      !NON_SEQUENCE_FLOW_TYPES.has(e.data?.flowType ?? ""),
  );
  return out[0] ?? null;
}

function canonicalise(canvas: EngineCanvas): EngineCanvas {
  // Sort node + edge arrays by id for a stable hash regardless of the
  // order React Flow happened to serialise them in. We don't sort `data`
  // keys recursively — the JSON.stringify call doesn't either, and the
  // canvas writer is internally consistent enough for our use.
  return {
    nodes: [...canvas.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...canvas.edges].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
