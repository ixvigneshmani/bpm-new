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
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import {
  engineJobs,
  instanceEvents,
  instanceTokens,
  outboxEvents,
  processDocuments,
  processInstances,
  processVersions,
  processes,
  roles,
  tenants,
  userRoles,
  users,
} from "../database/schema";
import { inArray } from "drizzle-orm";
import { REST_SERVICE_TASK_TOPIC, SERVICE_TASK_TOPIC } from "./service-task-registry";
import { CONNECTOR_TOPIC } from "../connectors/connector-registry";
import { WorkerService } from "./worker.service";
import { TimerSchedulerService, type ClaimedTimer } from "./timer-scheduler.service";
import { MessageSubscriptionService } from "./message-subscription.service";
import { CorrelationContext } from "../common/observability/correlation-context";

/** OS4.1 / M5 — every INSTANCE_EVENTS row written by the engine flows
 *  through this helper. It auto-injects the current HTTP request's
 *  correlationId into the payload so an audit row can be matched back
 *  to the exact API call that produced it. Falls back gracefully when
 *  the engine runs outside an HTTP context (worker jobs, scheduler
 *  ticks) by stamping `null` rather than crashing. */
function withCorrelation<T extends Record<string, unknown> | null | undefined>(
  payload: T,
): T extends null | undefined
  ? { correlationId: string | null }
  : T & { correlationId: string | null } {
  const correlationId = CorrelationContext.getCorrelationId() ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...(payload ?? {}), correlationId } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordEvent(tx: any, row: Record<string, unknown>) {
  // Uses the RAW drizzle insert below (NOT the recordEvent wrapper)
  // to avoid infinite recursion — the bulk sed that introduced this
  // helper accidentally rewrote the inner call too.
  return tx
    .insert(instanceEvents)
    .values({
      ...row,
      payload: withCorrelation(row.payload as Record<string, unknown> | null | undefined),
    });
}

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
  /** Optional engine-specific config bag at the canvas root.
   *  E4.5c: `redactedVariableKeys` lists variable names whose values
   *  must be replaced with `<redacted>` in INSTANCE_EVENTS payloads.
   *  Match is exact on the top-level key. The value itself still goes
   *  into `instance.variables` so the engine can use it; only the
   *  audit trail is sanitised. */
  engineConfig?: {
    redactedVariableKeys?: string[];
  };
};

/** D1.0 — portable process bundle returned by exportProcess and
 *  consumed by importProcess. The `format` field gates schema
 *  evolution: future v2 imports will read this to drive a migration.
 *  Keep this type identical between API and (eventual) CLI. */
export type ProcessExportBundle = {
  format: "flowpro/v1";
  exportedAt: string;
  exportedFrom: {
    tenantId: string;
    tenantName: string | null;
  };
  process: {
    slug: string;
    name: string;
    description: string | null;
    version: number;
    hash: string;
    canvas: Record<string, unknown>;
    businessDoc: Record<string, unknown> | null;
  };
  envBindings: Record<
    string,
    { kind: "placeholder" | "role-key"; key?: string; value?: string }
  >;
  metadata: {
    publishedBy: null;
    publishedAt: null;
  };
};

/** D1.0 — walk a canvas and collect every role-key referenced by
 *  userTask `assignment.type === "role"` nodes. Used at import time
 *  to validate that the destination tenant has provisioned the
 *  roles before accepting the bundle. */
export function extractRoleKeysFromCanvas(
  canvas: Record<string, unknown>,
): Set<string> {
  const out = new Set<string>();
  const nodes = (canvas as { nodes?: unknown[] }).nodes;
  if (!Array.isArray(nodes)) return out;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const data = (node as { data?: { assignment?: { type?: string; value?: string } } })
      .data;
    const a = data?.assignment;
    if (a?.type === "role" && typeof a.value === "string" && a.value) {
      out.add(a.value);
    }
  }
  return out;
}

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

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly worker: WorkerService,
    private readonly timerScheduler?: TimerSchedulerService,
    // P3 Session 7 — optional like timerScheduler so unit tests that
    // hand-construct EngineService keep compiling. The
    // intermediateCatchEvent branch falls back to a no-op subscribe
    // when this is undefined (tests can still exercise the engine path
    // without standing the service up).
    private readonly messageSubscriptions?: MessageSubscriptionService,
  ) {
    // P2 Session 4 — register the task-due-reminder dispatcher. The
    // scheduler is optional in the constructor so unit tests that
    // hand-construct EngineService keep working without wiring it.
    this.timerScheduler?.registerCallback(
      "task-due-reminder",
      (t) => this.fireTaskDueReminder(t),
    );
    this.timerScheduler?.registerCallback(
      "boundary-timer",
      (t) => this.fireBoundaryTimer(t),
    );
    // P2 Session 6b — event-subprocess timer-start dispatcher.
    this.timerScheduler?.registerCallback(
      "start-event-timer",
      (t) => this.fireEventSubProcessStart(t),
    );
  }

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
    actingBy?: string | null;
    variables?: Record<string, unknown>;
    businessKey?: string;
    /** Designer-only escape hatch: run an instance against a DRAFT
     *  process. Without this flag, DRAFT starts are rejected so the
     *  Publish lifecycle has teeth. The instance-started audit row
     *  records the flag so test runs are distinguishable in the
     *  trail. */
    testRun?: boolean;
  }): Promise<{
    instanceId: string;
    status: "running" | "completed" | "failed";
    tokenCount: number;
    eventCount: number;
  }> {
    const proc = await this.loadProcessForInstance(args.processId, args.tenantId);
    if (proc.status !== "ACTIVE" && !args.testRun) {
      throw new BadRequestException(
        "Process is in DRAFT — publish it first, or pass testRun=true to run a test from the designer.",
      );
    }
    const canvas = projectCanvas(proc.canvasData);
    const startNode = findStartEvent(canvas);

    // Hash on the canonicalised PROJECTED view — engine semantics
    // are what dedup care about. Store the FULL raw canvas (incl.
    // React Flow positions etc.) so re-loaded versions render in
    // the designer and D1 exports preserve layout. BUG-D1-01.
    const snapshot = canonicalise(canvas);
    const definitionHash = sha256Hex(JSON.stringify(snapshot));
    const initialVariables = args.variables ?? {};

    const versionId = await this.getOrCreateProcessVersion({
      processId: args.processId,
      tenantId: args.tenantId,
      userId: args.userId,
      hash: definitionHash,
      canvas: proc.canvasData as Record<string, unknown>,
    });

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
          // Legacy DEFINITION_SNAPSHOT column stays null for new rows;
          // canvas now lives in PROCESS_VERSIONS keyed by versionId.
          processVersionId: versionId,
          definitionHash,
          businessKey: args.businessKey ?? null,
        })
        .returning({ id: processInstances.id });

      // 2. Audit + outbox: instance-started. Outbox row goes in the
      //    same txn so subscriber delivery is at-least-once-on-commit.
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: inst.id,
        userId: args.userId,
        eventType: "instance-started",
        payload: {
          processId: args.processId,
          definitionHash,
          ...(args.testRun ? { testRun: true } : {}),
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });
      await this.emitOutbox(tx, {
        tenantId: args.tenantId,
        processId: args.processId,
        instanceId: inst.id,
        eventType: "instance-started",
        payload: {
          definitionHash,
          startedBy: args.userId,
          businessKey: args.businessKey ?? null,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
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

      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: inst.id,
        tokenId: token.id,
        nodeId: startNode.id,
        eventType: "token-created",
      });

      // P2 Session 6b — subscribe event-subprocess timer-starts at the
      // ROOT scope (eventSubProcess nodes with no parentId). Cancelled
      // implicitly when the root token's children drain (timer fire
      // callback bails on non-live host) or via cancelTimersForInstance
      // on cancelInstance.
      await this.subscribeEventSubProcessTimers({
        tx,
        tenantId: args.tenantId,
        instanceId: inst.id,
        parentScopeNodeId: null,
        parentScopeTokenId: token.id,
        canvas,
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

      // 5. Flip the instance to its terminal state. P1 — only flip to
      //    `completed` when no live siblings remain; a parallel-split
      //    process keeps the instance `running` until the last branch
      //    drains. Failure short-circuits and flips immediately
      //    (per-branch failure propagation lands in P4).
      let instanceStatus: "running" | "completed" | "failed" = "running";
      if (advance.tokenStatus === "completed" && (await this.countLiveTokens(tx, inst.id)) === 0) {
        await tx
          .update(processInstances)
          .set({
            status: "completed",
            completedAt: new Date(),
          })
          .where(eq(processInstances.id, inst.id));
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: inst.id,
          eventType: "instance-completed",
          payload: { hops: advance.hops },
        });
        await this.emitOutbox(tx, {
          tenantId: args.tenantId,
          processId: args.processId,
          instanceId: inst.id,
          eventType: "instance-completed",
          payload: { hops: advance.hops, variables: initialVariables },
          redactedKeys: canvas.engineConfig?.redactedVariableKeys,
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
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: inst.id,
          eventType: "instance-failed",
          payload: { hops: advance.hops, message: advance.errorMessage },
        });
        await this.emitOutbox(tx, {
          tenantId: args.tenantId,
          processId: args.processId,
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
        await recordEvent(args.tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          tokenId: args.tokenId,
          nodeId,
          eventType: "node-entered",
        });

        // Terminal: end event drains the token.
        // P2 Session 5 — if the token has a `scope_token_id` (i.e.,
        // it's inside a subprocess), the end event doesn't terminate
        // the instance — it terminates the SCOPE. When this is the
        // LAST live token in the scope, we resume the parent token
        // and continue advancing through the subprocess's outgoing
        // edge. Other scope siblings completing first just drop in
        // here, mark themselves done, and exit; only the last arrival
        // triggers the parent resume.
        if (node.type === "endEvent") {
          // P2 Session 6b — error end event: throw + walk scope chain
          // for a matching error boundary. If caught, the host scope is
          // interrupted and execution continues on the boundary's
          // outgoing edge; uncaught errors fail the instance with a
          // clear message. Falls back to the normal terminal logic
          // below when the end event is not an error throw.
          const endDef = (node.data as
            | { eventDefinition?: { kind?: string; errorCode?: string } }
            | undefined)?.eventDefinition;
          if (endDef?.kind === "error") {
            const thrown = await this.throwErrorFromEnd({
              tx: args.tx,
              tenantId: args.tenantId,
              instanceId: args.instanceId,
              throwingTokenId: args.tokenId,
              throwingTokenVersion: version,
              errorCode: endDef.errorCode ?? "",
              throwNodeId: nodeId,
              canvas: args.canvas,
              variables: args.variables,
              hops,
            });
            return thrown;
          }
          await recordEvent(args.tx, {
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
          await recordEvent(args.tx, {
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: args.tokenId,
            nodeId,
            eventType: "token-completed",
          });
          // Load scope info on this token (no @args.scopeTokenId, fresh
          // read since updateTokenWithLock doesn't return the row).
          const scopeRows = await args.tx
            .select({ scopeTokenId: instanceTokens.scopeTokenId })
            .from(instanceTokens)
            .where(eq(instanceTokens.id, args.tokenId))
            .limit(1);
          const scopeTokenId = scopeRows[0]?.scopeTokenId ?? null;
          if (!scopeTokenId) {
            return { tokenStatus: "completed", hops };
          }
          // Inside a subprocess. Are any siblings still live?
          const liveInScope = await this.countLiveScopeTokens(args.tx, scopeTokenId);
          if (liveInScope > 0) {
            // Other inner branches still running. Just exit; whichever
            // sibling arrives last will fire the parent resume.
            return { tokenStatus: "completed", hops };
          }
          // Last in scope — resume the parent token. Re-enter the loop
          // with nodeId = subprocess node, the parent's currentNodeId.
          const parentRows = await args.tx
            .select({
              id: instanceTokens.id,
              version: instanceTokens.version,
              currentNodeId: instanceTokens.currentNodeId,
              status: instanceTokens.status,
            })
            .from(instanceTokens)
            .where(eq(instanceTokens.id, scopeTokenId))
            .limit(1);
          const parent = parentRows[0];
          if (!parent) {
            // Parent vanished (cancel happened concurrently). Treat
            // as terminal completion of this token; the cancel txn
            // is responsible for cleanup.
            return { tokenStatus: "completed", hops };
          }
          if (parent.status !== "waiting") {
            // Parent already resumed by another path. Idempotent skip.
            return { tokenStatus: "completed", hops };
          }
          // Flip parent back to active + emit resume audit. Continue
          // advancing through the subprocess's outgoing edge by re-
          // entering the loop on the parent's currentNodeId.
          const parentNewVersion = await this.updateTokenWithLock(
            args.tx, parent.id, parent.version,
            { status: "active", waitingFor: null },
          );
          await recordEvent(args.tx, {
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: parent.id,
            nodeId: parent.currentNodeId,
            eventType: "token-resumed",
            payload: { via: "subprocess", scopeTokenId },
          });
          // Recurse into advanceToken so the parent's continuation
          // commits within this same txn. resumeFromWait=true skips
          // the entered-execute reprise on the subprocess node.
          const cont = await this.advanceToken({
            tx: args.tx,
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: parent.id,
            tokenVersion: parentNewVersion,
            currentNodeId: parent.currentNodeId,
            canvas: args.canvas,
            variables: args.variables,
            resumeFromWait: true,
          });
          return {
            tokenStatus: cont.tokenStatus,
            hops: hops + cont.hops,
            errorMessage: cont.errorMessage,
          };
        }

        // Wait state: user task suspends the token until completeTask
        // resumes it. Resolved assignee (directUser only for E3) goes
        // on the token row so the inbox query is a single index hit.
        if (node.type === "userTask") {
          const {
            assignee: assignedTo,
            candidateRole,
            diagnostic: assignDiag,
          } = resolveDirectUserAssignee(node, args.variables, this.logger);
          // Emit a `variable-unresolved` audit event when the assignment
          // expression couldn't be resolved (e.g. ${managerId} but the
          // variable wasn't set). Doesn't change behavior — still falls
          // through to Queue — but the failure is now visible in the
          // audit trail instead of silent. BUG-17.
          if (assignDiag && assignDiag.reason === "unresolved-expression") {
            await recordEvent(args.tx, {
              tenantId: args.tenantId,
              instanceId: args.instanceId,
              tokenId: args.tokenId,
              nodeId,
              eventType: "variable-unresolved",
              payload: {
                kind: "assignment",
                expression: assignDiag.expression,
                assignmentType: assignDiag.assignmentType,
              },
            });
          }
          const { dueAt, priority } = resolveTaskScheduling(node);
          version = await this.updateTokenWithLock(
            args.tx,
            args.tokenId,
            version,
            {
              status: "waiting",
              waitingFor: "userTask",
              assignedTo: assignedTo ?? null,
              candidateRole: candidateRole ?? null,
              currentNodeId: nodeId,
              dueAt,
              priority,
            },
          );
          await recordEvent(args.tx, {
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: args.tokenId,
            nodeId,
            eventType: "token-waiting",
            payload: {
              waitingFor: "userTask",
              assignedTo: assignedTo ?? null,
              candidateRole: candidateRole ?? null,
            },
          });
          // Auto-claim audit. We emit task-claimed at suspension when
          // an assignee was resolved — the system is "claiming on
          // behalf" of the user. Role-assigned tasks start unclaimed
          // and emit task-claimed only when a role-member calls the
          // /tasks/:id/claim endpoint (R1.6).
          if (assignedTo) {
            await recordEvent(args.tx, {
              tenantId: args.tenantId,
              instanceId: args.instanceId,
              tokenId: args.tokenId,
              userId: assignedTo,
              nodeId,
              eventType: "task-claimed",
              payload: { auto: true },
            });
          }
          // P2 Session 4 — schedule the task-due reminder. Already
          // overdue? Emit task-due audit immediately and skip the
          // scheduler (no point in queuing a "fire ASAP" row when we
          // already know the time has passed).
          if (dueAt && this.timerScheduler) {
            if (dueAt.getTime() <= Date.now()) {
              await recordEvent(args.tx, {
                tenantId: args.tenantId,
                instanceId: args.instanceId,
                tokenId: args.tokenId,
                nodeId,
                eventType: "task-due",
                payload: {
                  dueAt: dueAt.toISOString(),
                  taskLabel: (node.data as { label?: string } | undefined)?.label ?? null,
                  assignedTo: assignedTo ?? null,
                  candidateRole: candidateRole ?? null,
                  fireImmediately: true,
                },
              });
              await this.emitOutbox(args.tx, {
                tenantId: args.tenantId,
                instanceId: args.instanceId,
                eventType: "task-due",
                payload: {
                  tokenId: args.tokenId,
                  nodeId,
                  dueAt: dueAt.toISOString(),
                  assignedTo: assignedTo ?? null,
                  candidateRole: candidateRole ?? null,
                },
              });
            } else {
              await this.timerScheduler.scheduleTimer(
                {
                  tenantId: args.tenantId,
                  instanceId: args.instanceId,
                  tokenId: args.tokenId,
                  fireAt: dueAt,
                  kind: "task-due-reminder",
                },
                args.tx,
              );
            }
          }
          // P2 Session 6a — subscribe boundary timers (if any) on this
          // host. Same hook used by serviceTask below; subProcess too.
          await this.subscribeBoundaryTimers({
            tx: args.tx,
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            hostTokenId: args.tokenId,
            hostNodeId: nodeId,
            canvas: args.canvas,
          });
          return { tokenStatus: "waiting", hops };
        }

        // P3 Session 7 — intermediate message-catch event.
        //
        // First entry only (this branch lives inside `if (!isResuming)`):
        // park the token + INSERT a MESSAGE_SUBSCRIPTIONS row keyed on
        // (tenant, messageName, correlationKey). The row sits until:
        //   - POST /api/messages delivers a matching message → resumes
        //     the token (re-entering advanceToken with isResuming=true,
        //     which falls through to the outgoing-edge pick below), or
        //   - cancelInstance / replay-cancel / scope-drain wipes it.
        //
        // Correlation key resolves to (in order):
        //   1. eventDefinition.correlationKey literal on the node (lets
        //      a process wait for a key that ISN'T businessKey — e.g.
        //      a sub-document id).
        //   2. instance.businessKey.
        // If neither is set we fail the token loud rather than create
        // an un-deliverable subscription.
        if (
          node.type === "intermediateCatchEvent" &&
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((node as any).data?.eventDefinition?.kind === "message")
        ) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const def = (node as any).data.eventDefinition as {
            messageName?: string;
            correlationKey?: string;
          };
          const messageName = (def.messageName ?? "").trim();
          if (!messageName) {
            const m = `intermediateCatchEvent ${nodeId}: kind=message but no messageName configured.`;
            await this.markTokenFailed(
              args.tx, args.tenantId, args.instanceId, args.tokenId,
              version, nodeId, m,
            );
            return { tokenStatus: "failed", hops, errorMessage: m };
          }
          let correlationKey = (def.correlationKey ?? "").trim();
          if (!correlationKey) {
            const bkRows = await args.tx
              .select({ businessKey: processInstances.businessKey })
              .from(processInstances)
              .where(eq(processInstances.id, args.instanceId))
              .limit(1);
            correlationKey = (bkRows[0]?.businessKey ?? "").trim();
          }
          if (!correlationKey) {
            const m =
              `intermediateCatchEvent ${nodeId}: no correlation key — ` +
              `set instance.businessKey on startInstance or ` +
              `eventDefinition.correlationKey on the node.`;
            await this.markTokenFailed(
              args.tx, args.tenantId, args.instanceId, args.tokenId,
              version, nodeId, m,
            );
            return { tokenStatus: "failed", hops, errorMessage: m };
          }
          // Read the token's existing scope (subprocess containment).
          // Stored on the subscription row so scope-drain can clean up.
          const scopeRows = await args.tx
            .select({ scopeTokenId: instanceTokens.scopeTokenId })
            .from(instanceTokens)
            .where(eq(instanceTokens.id, args.tokenId))
            .limit(1);
          const scopeTokenId = scopeRows[0]?.scopeTokenId ?? null;
          version = await this.updateTokenWithLock(
            args.tx, args.tokenId, version,
            {
              status: "waiting",
              waitingFor: "message",
              currentNodeId: nodeId,
            },
          );
          if (this.messageSubscriptions) {
            await this.messageSubscriptions.subscribe({
              tenantId: args.tenantId,
              instanceId: args.instanceId,
              tokenId: args.tokenId,
              scopeTokenId,
              messageName,
              correlationKey,
              tx: args.tx,
            });
          }
          await recordEvent(args.tx, {
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: args.tokenId,
            nodeId,
            eventType: "message-subscribed",
            payload: { messageName, correlationKey, scopeTokenId },
          });
          await recordEvent(args.tx, {
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: args.tokenId,
            nodeId,
            eventType: "token-waiting",
            payload: { waitingFor: "message", messageName, correlationKey },
          });
          return { tokenStatus: "waiting", hops };
        }

        // Wait state: service task suspends the token until the
        // worker handler completes the job and calls back into
        // completeServiceTask. Topic resolution: the canvas's
        // `data.implementation.config.jobType` (externalWorker
        // strategy). If missing, we fall back to "noop" with a
        // warning rather than failing the instance — defensive.
        if (node.type === "serviceTask") {
          const userTopic = resolveServiceTaskTopic(node, this.logger);
          version = await this.updateTokenWithLock(
            args.tx,
            args.tokenId,
            version,
            {
              status: "waiting",
              waitingFor: "service-task",
              currentNodeId: nodeId,
            },
          );
          await recordEvent(args.tx, {
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: args.tokenId,
            nodeId,
            eventType: "token-waiting",
            payload: { waitingFor: "service-task", topic: userTopic },
          });
          // Apply the canvas-defined input mapping. If
          // `data.inputMappings` is set, project from instance
          // variables to the explicit subset the handler should see;
          // otherwise pass the full bag (backward compat). This is
          // the canvas's contract about which variables are visible
          // to integrations — keeps PII and unrelated state out of
          // handler scope by default-deny.
          const inputMappings = (node.data as Record<string, unknown> | undefined)
            ?.inputMappings as Record<string, MappingEntry> | undefined;
          const handlerInput = inputMappings
            ? applyMapping(inputMappings, args.variables)
            : args.variables;

          // Enqueue the worker job IN THE SAME TXN as the token+audit
          // writes above. Without `tx:`, the ENGINE_JOBS row commits
          // on a separate connection and a parallel worker tick can
          // race the engine's commit, claim the job, and call
          // completeServiceTask before the token is visible as
          // `waiting/service-task`.
          await this.worker.enqueue({
            tx: args.tx,
            tenantId: args.tenantId,
            jobType: "service-task",
            topic: SERVICE_TASK_TOPIC,
            instanceId: args.instanceId,
            tokenId: args.tokenId,
            input: {
              userTopic,
              nodeId,
              nodeData: node.data ?? {},
              variables: handlerInput,
            },
            maxAttempts: resolveServiceTaskMaxAttempts(node) ?? 3,
          });
          // P2 Session 6a — subscribe boundary timers.
          await this.subscribeBoundaryTimers({
            tx: args.tx,
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            hostTokenId: args.tokenId,
            hostNodeId: nodeId,
            canvas: args.canvas,
          });
          return { tokenStatus: "waiting", hops };
        }

        // P2 Session 5 — subprocess execution. Three variants
        // (subProcess + transaction + adHocSubProcess) share the same
        // entry semantics. eventSubProcess is NOT triggered by an
        // incoming sequence flow (it fires on an event subscription —
        // Session 6 work) and is intentionally NOT in this branch.
        if (
          node.type === "subProcess" ||
          node.type === "transaction" ||
          node.type === "adHocSubProcess"
        ) {
          // Locate inner nodes by React-Flow parentId. The canvas
          // schema stores subprocess membership there (set by the
          // Designer drag-into-frame UX).
          const innerNodes = args.canvas.nodes.filter(
            (n) => (n as { parentId?: string }).parentId === nodeId,
          );
          // Decision #2: pick the first `none`-type start event. Zero
          // → fail. Multiple `none` → use the first; design-time
          // validation rule warns separately.
          const innerStarts = innerNodes.filter((n) => {
            if (n.type !== "startEvent") return false;
            const def = (n.data as { eventDefinition?: { kind?: string } } | undefined)?.eventDefinition;
            return !def || !def.kind || def.kind === "none";
          });
          if (innerStarts.length === 0) {
            const message = `Subprocess ${nodeId} has no \`none\`-type inner start event — engine can't enter it.`;
            await this.markTokenFailed(
              args.tx, args.tenantId, args.instanceId, args.tokenId, version, nodeId, message,
            );
            return { tokenStatus: "failed", hops, errorMessage: message };
          }
          if (innerStarts.length > 1) {
            this.logger.warn(
              `Subprocess ${nodeId}: multiple \`none\`-type inner start events found; using "${innerStarts[0].id}" by canvas order.`,
            );
          }
          const innerStart = innerStarts[0];

          // Park the parent token at the subprocess node so the inner
          // end-event handler can find it via scope_token_id.
          version = await this.updateTokenWithLock(
            args.tx, args.tokenId, version,
            { status: "waiting", waitingFor: "subprocess", currentNodeId: nodeId },
          );
          await recordEvent(args.tx, {
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: args.tokenId,
            nodeId,
            eventType: "token-waiting",
            payload: { waitingFor: "subprocess" },
          });
          // P2 Session 6a — boundary timers on the subprocess host
          // subscribe here. Interrupting fire later kills the parent
          // + all scoped descendants.
          await this.subscribeBoundaryTimers({
            tx: args.tx,
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            hostTokenId: args.tokenId,
            hostNodeId: nodeId,
            canvas: args.canvas,
          });
          // P2 Session 6b — event-subprocess timer-starts that sit
          // inside this subprocess (children with parentId = nodeId
          // and type = eventSubProcess) subscribe here. Timer fire
          // spawns a child token at the eventSubProcess's inner start
          // with scope = the parent subprocess token; interrupting
          // variant kills scope siblings.
          await this.subscribeEventSubProcessTimers({
            tx: args.tx,
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            parentScopeNodeId: nodeId,
            parentScopeTokenId: args.tokenId,
            canvas: args.canvas,
          });

          // Spawn the inner child at the inner start. scope_token_id
          // = self; descendants from inner forks inherit it.
          const childRows = await args.tx
            .insert(instanceTokens)
            .values({
              tenantId: args.tenantId,
              instanceId: args.instanceId,
              currentNodeId: innerStart.id,
              status: "active",
              parentTokenId: args.tokenId,
              scopeTokenId: args.tokenId,
            })
            .returning({ id: instanceTokens.id, version: instanceTokens.version });
          const child = childRows[0];
          await recordEvent(args.tx, {
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: child.id,
            nodeId: innerStart.id,
            eventType: "token-created",
            payload: { parentTokenId: args.tokenId, scopeTokenId: args.tokenId, via: "subprocess" },
          });

          // Recurse into the inner flow. When the LAST inner sibling
          // hits an end event, the endEvent scope-drain logic resumes
          // the parent + advances it through this subprocess's
          // outgoing edge in the same recursion. The childResult's
          // tokenStatus therefore reflects the PARENT's effective
          // final state.
          const childResult = await this.advanceToken({
            tx: args.tx,
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            tokenId: child.id,
            tokenVersion: child.version ?? 0,
            currentNodeId: innerStart.id,
            canvas: args.canvas,
            variables: args.variables,
          });
          return {
            tokenStatus: childResult.tokenStatus,
            hops: hops + childResult.hops,
            errorMessage: childResult.errorMessage,
          };
        }
      }
      isResuming = false;

      // Pass-through node-exited for every node EXCEPT parallel/
      // inclusive gateways — those emit their own node-exited
      // explicitly inside the SPLIT / JOIN-fire paths, and a token that
      // PARKS at a join doesn't truly exit the gateway. Emitting it
      // here would put a misleading "exited" row in the audit trail
      // ahead of token-waiting(join).
      if (node.type !== "parallelGateway" && node.type !== "inclusiveGateway") {
        await recordEvent(args.tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          tokenId: args.tokenId,
          nodeId,
          eventType: "node-exited",
        });
      }

      // P1 — parallel split. Every outgoing edge fires; one fresh child
      // token per edge is INSERTed at the edge's target (active),
      // carrying `parent_token_id` = this token + a shared `fork_id` so
      // Session 3's JOIN can scope correctly. The parent token flips to
      // `completed` — its job (entering the gateway) is done — and we
      // recurse into advanceToken for each child synchronously inside
      // the same txn so audit trails commit atomically. Children that
      // suspend on a wait state stay `waiting` in the DB; children that
      // run to an end event flip to `completed`. The outer caller's
      // instance-flip logic uses `maybeCompleteInstance` which counts
      // remaining live tokens, so the instance only flips when the last
      // sibling drains.
      //
      // TODO(P1 polish): replay-from-step semantics when active siblings
      // exist are undefined; flag at the replay entrypoint.
      let next: EngineEdge | null = null;
      // P1 Session 3 — for parallel/inclusive gateways we skip the
      // pass-through `node-exited` at the top of the loop so a token
      // that PARKS at a JOIN doesn't leave a misleading "exited" row in
      // the audit. The flag below tracks whether one of the exit paths
      // (SPLIT multi-fire / JOIN fire) has already emitted node-exited,
      // so we don't double-emit when the flow falls through to the
      // 1-out advance.
      let gatewayNodeExitedEmitted = false;
      if (node.type === "parallelGateway" || node.type === "inclusiveGateway") {
        const outgoing = args.canvas.edges.filter((e) => e.source === nodeId);
        const incoming = args.canvas.edges.filter((e) => e.target === nodeId);

        // ─── JOIN ─────────────────────────────────────────────────────
        // P1 Session 3 — when the token arrives at a gateway with > 1
        // incoming edges, this is a JOIN. Park (status=waiting,
        // waitingFor="join"). Serialize the "am I last?" decision via
        // SELECT FOR UPDATE on the instance row so two siblings can't
        // both decide they're firing. When the parked count for this
        // fork matches the token's persisted `forkSize`, fire — pick
        // the latest arriver as the firing token (deterministic by
        // arrival order; FOR UPDATE serialization makes this stable),
        // mark the N-1 already-parked siblings `completed`, then take
        // the gateway's single outgoing edge.
        //
        // Variable merge (Decision #1): variables already merge into
        // `instance.variables` as each sibling does its work
        // (completeTask / completeServiceTask shallow-merge into the
        // bag). Last-writer-wins by arrival order, matching Camunda.
        // Nothing to do at the join itself.
        if (incoming.length > 1) {
          const tokRow = await this.loadTokenForJoin(args.tx, args.tokenId);
          if (!tokRow.forkId || tokRow.forkSize == null) {
            // Degenerate: token reached a multi-in gateway without a
            // fork lineage. Treat as a pass-through — single token,
            // no synchronization possible. Designer flags joins
            // unreachable from a parallel/inclusive split.
            // Fall through to edge selection below.
          } else {
            // Lock the instance row to serialize sibling arrivals at
            // this join. Other txns at the same gateway block here.
            await args.tx
              .select({ id: processInstances.id })
              .from(processInstances)
              .where(eq(processInstances.id, args.instanceId))
              .for("update");

            // Park this token at the join.
            version = await this.updateTokenWithLock(
              args.tx, args.tokenId, version,
              { status: "waiting", waitingFor: "join", currentNodeId: nodeId },
            );

            // Count siblings parked at THIS gateway with the same
            // forkId (i.e., this fork's arrivals). Include self.
            const parked = await args.tx
              .select({ id: instanceTokens.id, version: instanceTokens.version })
              .from(instanceTokens)
              .where(
                and(
                  eq(instanceTokens.instanceId, args.instanceId),
                  eq(instanceTokens.forkId, tokRow.forkId),
                  eq(instanceTokens.currentNodeId, nodeId),
                  eq(instanceTokens.status, "waiting"),
                ),
              );

            if (parked.length < tokRow.forkSize) {
              // Not last — record the wait and bail. The next sibling
              // to arrive will re-evaluate.
              await recordEvent(args.tx, {
                tenantId: args.tenantId,
                instanceId: args.instanceId,
                tokenId: args.tokenId,
                nodeId,
                eventType: "token-waiting",
                payload: { waitingFor: "join", forkId: tokRow.forkId, parked: parked.length, expected: tokRow.forkSize },
              });
              return { tokenStatus: "waiting", hops };
            }

            // We're the last arriver — fire. Mark every OTHER parked
            // sibling completed. Use a single bulk UPDATE (no per-token
            // optimistic lock needed: the FOR UPDATE on the instance
            // serialises sibling state until we COMMIT, and within
            // this txn no other writer touches them). The audit row
            // per merged sibling is still emitted individually so
            // timeline UIs can attribute each merge.
            await recordEvent(args.tx, {
              tenantId: args.tenantId, instanceId: args.instanceId,
              tokenId: args.tokenId, nodeId, eventType: "node-exited",
              payload: { via: "join", forkId: tokRow.forkId, mergedTokens: parked.length },
            });
            gatewayNodeExitedEmitted = true;
            await args.tx
              .update(instanceTokens)
              .set({ status: "completed", updatedAt: new Date() })
              .where(
                and(
                  eq(instanceTokens.instanceId, args.instanceId),
                  eq(instanceTokens.forkId, tokRow.forkId),
                  eq(instanceTokens.currentNodeId, nodeId),
                  eq(instanceTokens.status, "waiting"),
                  ne(instanceTokens.id, args.tokenId),
                ),
              );
            for (const sib of parked) {
              if (sib.id === args.tokenId) continue;
              await recordEvent(args.tx, {
                tenantId: args.tenantId,
                instanceId: args.instanceId,
                tokenId: sib.id,
                nodeId,
                eventType: "token-completed",
                payload: { mergedInto: args.tokenId, forkId: tokRow.forkId, via: "join" },
              });
            }

            // Reactivate self so the loop's edge-selection step can
            // advance through the single outgoing edge.
            version = await this.updateTokenWithLock(
              args.tx, args.tokenId, version,
              { status: "active", waitingFor: null },
            );
            await recordEvent(args.tx, {
              tenantId: args.tenantId,
              instanceId: args.instanceId,
              tokenId: args.tokenId,
              nodeId,
              eventType: "token-resumed",
              payload: { via: "join", forkId: tokRow.forkId },
            });
            // Fall through to edge selection (one outgoing edge expected).
          }
        }

        // ─── SPLIT ────────────────────────────────────────────────────
        // outgoing > 1 — spawn children. parallel = all edges fire;
        // inclusive = only edges whose condition evaluates true (default
        // flow fires when none match; failure when none match + no
        // default).
        if (outgoing.length === 0 && incoming.length <= 1) {
          const message = `${node.type} ${nodeId} has no outgoing flow.`;
          await this.markTokenFailed(
            args.tx, args.tenantId, args.instanceId, args.tokenId, version, nodeId, message,
          );
          return { tokenStatus: "failed", hops, errorMessage: message };
        }

        if (outgoing.length > 1) {
          let firing: EngineEdge[];
          if (node.type === "inclusiveGateway") {
            const defaultFlowId = (node.data as { defaultFlowId?: string } | undefined)?.defaultFlowId;
            const matched: EngineEdge[] = [];
            for (const edge of outgoing) {
              if (edge.id === defaultFlowId) continue;
              const cond = (edge.data as { condition?: string } | undefined)?.condition;
              if (typeof cond !== "string" || cond.trim().length === 0) continue;
              let ok: boolean;
              try {
                ok = evalCondition(cond, args.variables);
              } catch (e) {
                const message = `Inclusive gateway ${nodeId}: condition eval failed on edge ${edge.id} (${(e as Error).message}).`;
                await this.markTokenFailed(
                  args.tx, args.tenantId, args.instanceId, args.tokenId, version, nodeId, message,
                );
                return { tokenStatus: "failed", hops, errorMessage: message };
              }
              if (ok) matched.push(edge);
            }
            if (matched.length > 0) {
              firing = matched;
            } else if (defaultFlowId) {
              const def = outgoing.find((e) => e.id === defaultFlowId);
              if (!def) {
                const message = `Inclusive gateway ${nodeId}: defaultFlowId references missing edge ${defaultFlowId}.`;
                await this.markTokenFailed(
                  args.tx, args.tenantId, args.instanceId, args.tokenId, version, nodeId, message,
                );
                return { tokenStatus: "failed", hops, errorMessage: message };
              }
              firing = [def];
            } else {
              const message = `Inclusive gateway ${nodeId}: no outgoing condition matched and no default flow defined.`;
              await this.markTokenFailed(
                args.tx, args.tenantId, args.instanceId, args.tokenId, version, nodeId, message,
              );
              return { tokenStatus: "failed", hops, errorMessage: message };
            }
          } else {
            firing = outgoing;
          }

          // Degenerate: 1 firing edge means no fork needed — fall
          // through to the regular advance.
          if (firing.length === 1) {
            next = firing[0];
          } else {
            // Multi-fire SPLIT. Parent flips completed, N children
            // spawn carrying the shared forkId + forkSize so the join
            // downstream knows what to wait for.
            await recordEvent(args.tx, {
              tenantId: args.tenantId, instanceId: args.instanceId,
              tokenId: args.tokenId, nodeId, eventType: "node-exited",
            });
            gatewayNodeExitedEmitted = true;
            version = await this.updateTokenWithLock(
              args.tx, args.tokenId, version,
              { status: "completed", currentNodeId: nodeId },
            );
            await recordEvent(args.tx, {
              tenantId: args.tenantId, instanceId: args.instanceId,
              tokenId: args.tokenId, nodeId, eventType: "token-completed",
            });

            const forkId = randomUUID();
            const forkSize = firing.length;
            // P2 Session 5 — children spawned inside a subprocess
            // inherit the parent's scope. Without this, the inner
            // end-event's countLiveScopeTokens query misses them and
            // the parent resumes too early (or not at all).
            const parentScopeRows = await args.tx
              .select({ scopeTokenId: instanceTokens.scopeTokenId })
              .from(instanceTokens)
              .where(eq(instanceTokens.id, args.tokenId))
              .limit(1);
            const parentScopeTokenId = parentScopeRows[0]?.scopeTokenId ?? null;
            let aggregateHops = hops;
            for (const edge of firing) {
              const childRows = await args.tx
                .insert(instanceTokens)
                .values({
                  tenantId: args.tenantId,
                  instanceId: args.instanceId,
                  currentNodeId: edge.target,
                  status: "active",
                  parentTokenId: args.tokenId,
                  forkId,
                  forkSize,
                  scopeTokenId: parentScopeTokenId,
                })
                .returning({ id: instanceTokens.id, version: instanceTokens.version });
              const child = childRows[0];
              await recordEvent(args.tx, {
                tenantId: args.tenantId, instanceId: args.instanceId,
                tokenId: args.tokenId, nodeId, eventType: "edge-taken",
                payload: { edgeId: edge.id, target: edge.target, childTokenId: child.id, forkId, forkSize },
              });
              await recordEvent(args.tx, {
                tenantId: args.tenantId, instanceId: args.instanceId,
                tokenId: child.id, nodeId: edge.target, eventType: "token-created",
                payload: { parentTokenId: args.tokenId, forkId, forkSize },
              });
              const childResult = await this.advanceToken({
                tx: args.tx,
                tenantId: args.tenantId,
                instanceId: args.instanceId,
                tokenId: child.id,
                tokenVersion: child.version ?? 0,
                currentNodeId: edge.target,
                canvas: args.canvas,
                variables: args.variables,
              });
              aggregateHops += childResult.hops;
              if (childResult.tokenStatus === "failed") {
                return {
                  tokenStatus: "failed",
                  hops: aggregateHops,
                  errorMessage: childResult.errorMessage,
                };
              }
            }
            return { tokenStatus: "completed", hops: aggregateHops };
          }
        } else if (outgoing.length === 1) {
          // 1-out (post-join or degenerate split) — take the single edge.
          next = outgoing[0];
        }

        // Emit node-exited if the token actually leaves the gateway
        // via a single outgoing edge and we haven't already emitted
        // (JOIN-fire and SPLIT multi-fire flag this). JOIN-park returns
        // before this line so its emit-suppression stands.
        if (next && !gatewayNodeExitedEmitted) {
          await recordEvent(args.tx, {
            tenantId: args.tenantId, instanceId: args.instanceId,
            tokenId: args.tokenId, nodeId, eventType: "node-exited",
          });
        }
      }

      // Edge selection: exclusive gateway → first-true-condition with
      // default-flow fallback (E4). Other gateway types fall through
      // to the simple "first outgoing" picker until later phases land
      // their semantics. The picker is wrapped here so a gateway that
      // can't find any matching branch fails the instance with a
      // diagnostic message rather than silently going off-rails.
      //
      // For a 1-out parallel gateway the branch above already assigned
      // `next` to the sole outgoing edge; skip re-picking.
      if (next) {
        // already chosen by the parallelGateway branch (degenerate
        // 1-out case)
      } else if (node.type === "exclusiveGateway") {
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
        // Default: read the lone outgoing edge. message-catch lands
        // here on resume — its first-entry park lives in the
        // `if (!isResuming)` block above (where userTask + serviceTask
        // park too), so resume just needs the outgoing-edge pick.
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

      await recordEvent(args.tx, {
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

  /** P1 Session 3 — load forkId + forkSize for the token at the moment
   *  it enters a JOIN gateway. Fetched here rather than carried through
   *  advanceToken's args because joins are rare and the args contract
   *  stays compact. */
  private async loadTokenForJoin(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    tokenId: string,
  ): Promise<{ forkId: string | null; forkSize: number | null }> {
    const rows = await tx
      .select({ forkId: instanceTokens.forkId, forkSize: instanceTokens.forkSize })
      .from(instanceTokens)
      .where(eq(instanceTokens.id, tokenId))
      .limit(1);
    if (!rows[0]) return { forkId: null, forkSize: null };
    return { forkId: rows[0].forkId ?? null, forkSize: rows[0].forkSize ?? null };
  }

  /** P2 Session 4 — dispatcher for the `task-due-reminder` timer kind.
   *  Called by TimerSchedulerService when a scheduled row hits its
   *  fire_at. Looks up the token (it may have completed in the
   *  meantime), emits the `task-due` audit + outbox event if the task
   *  is still waiting. If the token already moved on, drops silently
   *  — the scheduler will DELETE the row regardless. */
  private async fireTaskDueReminder(t: ClaimedTimer): Promise<void> {
    if (!t.tokenId) return;
    const rows = await this.db
      .select({
        status: instanceTokens.status,
        waitingFor: instanceTokens.waitingFor,
        currentNodeId: instanceTokens.currentNodeId,
        assignedTo: instanceTokens.assignedTo,
        candidateRole: instanceTokens.candidateRole,
      })
      .from(instanceTokens)
      .where(eq(instanceTokens.id, t.tokenId))
      .limit(1);
    const row = rows[0];
    if (!row || row.status !== "waiting" || row.waitingFor !== "userTask") {
      // Task no longer waiting — token already completed/skipped.
      // Audit a "skipped" diagnostic so the timeline shows we saw the
      // timer fire and elected to no-op. Stays useful for operators
      // investigating "why didn't I get a reminder?".
      this.logger.log({
        event: "engine.timer.task-due.skipped",
        tokenId: t.tokenId,
        instanceId: t.instanceId,
        reason: row ? `token ${row.status}/${row.waitingFor}` : "token not found",
      });
      return;
    }
    await this.db.transaction(async (tx) => {
      await recordEvent(tx, {
        tenantId: t.tenantId,
        instanceId: t.instanceId,
        tokenId: t.tokenId,
        nodeId: row.currentNodeId,
        eventType: "task-due",
        payload: {
          dueAt: t.fireAt.toISOString(),
          assignedTo: row.assignedTo,
          candidateRole: row.candidateRole,
        },
      });
      await this.emitOutbox(tx, {
        tenantId: t.tenantId,
        instanceId: t.instanceId,
        eventType: "task-due",
        payload: {
          tokenId: t.tokenId,
          nodeId: row.currentNodeId,
          dueAt: t.fireAt.toISOString(),
          assignedTo: row.assignedTo,
          candidateRole: row.candidateRole,
        },
      });
    });
  }

  /** P2 Session 6a — subscribe one boundary-timer row per timer
   *  boundary attached to this host. Reuses SCHEDULED_TIMERS (kind
   *  `boundary-timer`). Payload carries the boundary node id + the
   *  interrupting flag so the fire callback can act without re-walking
   *  the canvas. Cancellation is implicit: cancelTimer(hostTokenId)
   *  deletes every row keyed by token_id — including these — at host
   *  exit, alongside the task-due reminder. */
  private async subscribeBoundaryTimers(args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any;
    tenantId: string;
    instanceId: string;
    hostTokenId: string;
    hostNodeId: string;
    canvas: EngineCanvas;
  }): Promise<void> {
    if (!this.timerScheduler) return;
    const boundaries = args.canvas.nodes.filter((n) => {
      if (n.type !== "boundaryEvent") return false;
      const d = n.data as
        | { attachedToRef?: string; eventDefinition?: { kind?: string } }
        | undefined;
      return d?.attachedToRef === args.hostNodeId && d?.eventDefinition?.kind === "timer";
    });
    for (const bnd of boundaries) {
      const d = bnd.data as {
        eventDefinition?: { value?: string; timerType?: string };
        cancelActivity?: boolean;
      };
      const fireAt = resolveTimerFireAt(d.eventDefinition);
      if (!fireAt) {
        this.logger.warn(
          `Boundary timer ${bnd.id}: could not parse value "${d.eventDefinition?.value ?? ""}". Skipping.`,
        );
        continue;
      }
      const interrupting = d.cancelActivity !== false; // default true per spec
      await this.timerScheduler.scheduleTimer(
        {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          tokenId: args.hostTokenId,
          fireAt,
          kind: "boundary-timer",
          payload: { boundaryNodeId: bnd.id, hostNodeId: args.hostNodeId, interrupting },
        },
        args.tx,
      );
      await recordEvent(args.tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: args.hostTokenId,
        nodeId: args.hostNodeId,
        eventType: "boundary-subscribed",
        payload: { boundaryNodeId: bnd.id, kind: "timer", interrupting, fireAt: fireAt.toISOString() },
      });
    }
  }

  /** P2 Session 6a — dispatcher for the `boundary-timer` kind. Loads
   *  the host token, verifies still live, finds the boundary's
   *  outgoing edge target, and either kills the host + spawns a
   *  replacement at the target (interrupting) or just spawns a
   *  sibling there (non-interrupting). Other boundary timers on the
   *  same host cancel implicitly when the host is killed (the next
   *  pre-fire host check sees a non-live token and bails). */
  private async fireBoundaryTimer(t: ClaimedTimer): Promise<void> {
    if (!t.tokenId) return;
    const payload = t.payload as
      | { boundaryNodeId?: string; hostNodeId?: string; interrupting?: boolean }
      | null;
    const boundaryNodeId = payload?.boundaryNodeId;
    if (!boundaryNodeId) return;
    const interrupting = payload?.interrupting !== false;
    const hostTokenId = t.tokenId;

    await this.db.transaction(async (tx) => {
      const hostRows = await tx
        .select({
          id: instanceTokens.id,
          version: instanceTokens.version,
          status: instanceTokens.status,
          currentNodeId: instanceTokens.currentNodeId,
          scopeTokenId: instanceTokens.scopeTokenId,
        })
        .from(instanceTokens)
        .where(eq(instanceTokens.id, hostTokenId))
        .limit(1);
      const host = hostRows[0];
      if (!host || (host.status !== "active" && host.status !== "waiting")) {
        // Host already done (completed/skipped/cancelled/interrupted by
        // an earlier boundary). Drop silently — the scheduler will
        // DELETE this row alongside any siblings via cancelTimer.
        this.logger.log({
          event: "engine.boundary.fired.skipped",
          reason: host ? `host ${host.status}` : "host not found",
          hostTokenId,
          boundaryNodeId,
        });
        return;
      }

      const instRow = await this.loadInstanceById(tx, t.instanceId, t.tenantId);
      const canvas = await this.loadCanvasForInstance(tx, instRow);
      const boundaryNode = canvas.nodes.find((n) => n.id === boundaryNodeId);
      if (!boundaryNode) {
        this.logger.warn(`Boundary timer: boundary node ${boundaryNodeId} not on canvas; dropping.`);
        return;
      }
      const outgoing = canvas.edges.find((e) => e.source === boundaryNodeId);
      if (!outgoing) {
        this.logger.warn(`Boundary ${boundaryNodeId} has no outgoing flow; dropping.`);
        return;
      }

      await recordEvent(tx, {
        tenantId: t.tenantId,
        instanceId: t.instanceId,
        tokenId: hostTokenId,
        nodeId: host.currentNodeId,
        eventType: "boundary-fired",
        payload: {
          boundaryNodeId,
          kind: "timer",
          interrupting,
          target: outgoing.target,
        },
      });

      if (interrupting) {
        // Kill host + scoped descendants. The host's status flips to
        // failed with a "interrupted by boundary" message so downstream
        // ops can distinguish from a real failure.
        await this.updateTokenWithLock(tx, host.id, host.version, {
          status: "failed",
          errorMessage: `Interrupted by boundary ${boundaryNodeId}.`,
        });
        // Cascade: any tokens scoped through the host (host as a
        // subprocess) die too. Cheap bulk UPDATE; no per-token
        // optimistic lock needed because we hold the txn.
        await tx
          .update(instanceTokens)
          .set({
            status: "failed",
            errorMessage: `Interrupted by boundary ${boundaryNodeId} on host.`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(instanceTokens.scopeTokenId, host.id),
              inArray(instanceTokens.status, ["active", "waiting"] as const),
            ),
          );
        // Cancel sibling boundary timers on the host so they don't
        // re-fire after the host is dead.
        await this.timerScheduler?.cancelTimer(host.id, tx);
      }

      // Spawn the boundary-output token. Parent = host (audit lineage);
      // scope = host's scope (so a non-interrupting boundary inside a
      // subprocess still drains the subprocess correctly).
      const childRows = await tx
        .insert(instanceTokens)
        .values({
          tenantId: t.tenantId,
          instanceId: t.instanceId,
          currentNodeId: outgoing.target,
          status: "active",
          parentTokenId: host.id,
          scopeTokenId: host.scopeTokenId,
        })
        .returning({ id: instanceTokens.id, version: instanceTokens.version });
      const child = childRows[0];
      await recordEvent(tx, {
        tenantId: t.tenantId,
        instanceId: t.instanceId,
        tokenId: child.id,
        nodeId: outgoing.target,
        eventType: "token-created",
        payload: {
          parentTokenId: host.id,
          scopeTokenId: host.scopeTokenId,
          via: interrupting ? "boundary-interrupt" : "boundary-noninterrupt",
        },
      });
      const adv = await this.advanceToken({
        tx,
        tenantId: t.tenantId,
        instanceId: t.instanceId,
        tokenId: child.id,
        tokenVersion: child.version ?? 0,
        currentNodeId: outgoing.target,
        canvas,
        variables: (instRow.variables as Record<string, unknown> | null) ?? {},
      });

      // P2 Session 6a — instance-completion check. The 5 main advance
      // call sites all run this dance; fireBoundaryTimer is the 6th
      // and was missing it (caught by live QA — boundary fired,
      // escalation token reached an end event, but the instance
      // stayed `running` forever).
      if (adv.tokenStatus === "completed" && (await this.countLiveTokens(tx, t.instanceId)) === 0) {
        await tx
          .update(processInstances)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(processInstances.id, t.instanceId));
        await recordEvent(tx, {
          tenantId: t.tenantId,
          instanceId: t.instanceId,
          eventType: "instance-completed",
          payload: { via: "boundary-timer", hops: adv.hops },
        });
        await this.emitOutbox(tx, {
          tenantId: t.tenantId,
          instanceId: t.instanceId,
          eventType: "instance-completed",
          payload: { via: "boundary-timer", hops: adv.hops },
          redactedKeys: canvas.engineConfig?.redactedVariableKeys,
        });
      } else if (adv.tokenStatus === "failed") {
        // Failure on the boundary path bubbles up; the boundary
        // shouldn't keep an instance in a half-running state.
        await tx
          .update(processInstances)
          .set({
            status: "failed",
            errorMessage: adv.errorMessage ?? null,
            completedAt: new Date(),
          })
          .where(eq(processInstances.id, t.instanceId));
        await recordEvent(tx, {
          tenantId: t.tenantId,
          instanceId: t.instanceId,
          eventType: "instance-failed",
          payload: { via: "boundary-timer", hops: adv.hops, message: adv.errorMessage },
        });
      }
    });
  }

  /** P2 Session 6b — throw an error from an end event with
   *  eventDefinition.kind === 'error'. Walks the scope chain (via
   *  scopeTokenId) looking for an error boundary attached to a parent
   *  scope activity. Match policy (Camunda-style): empty/null errorCode
   *  on the boundary catches any code; a specific code requires exact
   *  string match. Multiple matching boundaries on one host fire in
   *  canvas/node order (first match wins).
   *
   *  Caught → mark the host scope token failed, bulk-kill the host's
   *  scope siblings, cancel timers on the host (sibling boundaries +
   *  event-subprocess starters), spawn a new token at the boundary's
   *  outgoing target inheriting the host's parent scope, and recurse
   *  advanceToken from there. Returns the resulting tokenStatus so the
   *  caller's instance-completion gate runs normally.
   *
   *  Uncaught (chain exhausted, no match) → fails the throwing token +
   *  bubbles up. The startInstance / completeTask / boundary-timer
   *  outer wrappers flip the instance to failed with the same message. */
  private async throwErrorFromEnd(args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any;
    tenantId: string;
    instanceId: string;
    throwingTokenId: string;
    throwingTokenVersion: number;
    errorCode: string;
    throwNodeId: string;
    canvas: EngineCanvas;
    variables: Record<string, unknown>;
    hops: number;
  }): Promise<{
    tokenStatus: "completed" | "waiting" | "failed";
    hops: number;
    errorMessage?: string;
  }> {
    // Emit the throw audit before we touch anything. Operators see the
    // throw row even if no catcher matches (uncaught path also fails).
    await recordEvent(args.tx, {
      tenantId: args.tenantId,
      instanceId: args.instanceId,
      tokenId: args.throwingTokenId,
      nodeId: args.throwNodeId,
      eventType: "error-thrown",
      payload: { errorCode: args.errorCode },
    });

    // Mark the throwing token completed (it has done its job). We do
    // this BEFORE the scope walk so a cascading kill at the host scope
    // doesn't double-update this row (and so the audit reads "thrower
    // completed → host failed → boundary fired", in order).
    await recordEvent(args.tx, {
      tenantId: args.tenantId,
      instanceId: args.instanceId,
      tokenId: args.throwingTokenId,
      nodeId: args.throwNodeId,
      eventType: "node-exited",
    });
    await this.updateTokenWithLock(
      args.tx,
      args.throwingTokenId,
      args.throwingTokenVersion,
      { status: "completed", currentNodeId: args.throwNodeId },
    );
    await recordEvent(args.tx, {
      tenantId: args.tenantId,
      instanceId: args.instanceId,
      tokenId: args.throwingTokenId,
      nodeId: args.throwNodeId,
      eventType: "token-completed",
      payload: { via: "error-throw" },
    });

    // Walk up: starting at the throwing token's scope, examine each
    // scope token's currentNodeId for an attached error boundary that
    // matches our code. Bail when scopeTokenId becomes null (chain end
    // = uncaught).
    const startRows = await args.tx
      .select({ scopeTokenId: instanceTokens.scopeTokenId })
      .from(instanceTokens)
      .where(eq(instanceTokens.id, args.throwingTokenId))
      .limit(1);
    let cursor: string | null = (startRows[0]?.scopeTokenId as string | null) ?? null;
    // Track the chain of intermediate scopes we passed through; we kill
    // them (and their siblings) when we find the host so the whole
    // sub-tree is torn down, matching Camunda's interrupting semantics.
    const chain: Array<{
      id: string;
      nodeId: string;
      version: number;
      scopeTokenId: string | null;
      status: string;
    }> = [];

    while (cursor !== null) {
      const rows = await args.tx
        .select({
          id: instanceTokens.id,
          version: instanceTokens.version,
          currentNodeId: instanceTokens.currentNodeId,
          scopeTokenId: instanceTokens.scopeTokenId,
          status: instanceTokens.status,
        })
        .from(instanceTokens)
        .where(eq(instanceTokens.id, cursor))
        .limit(1);
      const scopeTok = rows[0];
      if (!scopeTok) break;

      // Look on canvas for error boundary(ies) attached to this scope's
      // current node. First match in canvas-node order wins.
      const hostNodeId: string = scopeTok.currentNodeId as string;
      const boundary = args.canvas.nodes.find((n) => {
        if (n.type !== "boundaryEvent") return false;
        const d = n.data as
          | { attachedToRef?: string; eventDefinition?: { kind?: string; errorCode?: string } }
          | undefined;
        if (d?.attachedToRef !== hostNodeId) return false;
        if (d?.eventDefinition?.kind !== "error") return false;
        const wanted = d.eventDefinition.errorCode ?? "";
        // Camunda-style: empty/null on boundary = catch-all.
        return wanted === "" || wanted === args.errorCode;
      });

      if (boundary) {
        // Found a catcher. host = scopeTok (the activity carrying the
        // boundary). The boundary's outgoing edge target gets a fresh
        // token inheriting host's parent scope.
        const outgoing = args.canvas.edges.find((e) => e.source === boundary.id);
        if (!outgoing) {
          const message = `Error boundary ${boundary.id} has no outgoing flow; can't continue.`;
          this.logger.warn(message);
          return { tokenStatus: "failed", hops: args.hops, errorMessage: message };
        }

        await recordEvent(args.tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          tokenId: scopeTok.id as string,
          nodeId: hostNodeId,
          eventType: "boundary-fired",
          payload: {
            boundaryNodeId: boundary.id,
            kind: "error",
            errorCode: args.errorCode,
            interrupting: true,
            target: outgoing.target,
          },
        });

        // Kill the intermediate scope tokens we walked through (each
        // one was parked at a subprocess; the error throw bypasses
        // their normal end-of-scope drain) + their direct scope
        // siblings.
        for (const intermediate of chain) {
          if (intermediate.status === "waiting" || intermediate.status === "active") {
            await this.updateTokenWithLock(
              args.tx, intermediate.id, intermediate.version,
              {
                status: "failed",
                errorMessage: `Cancelled by error boundary ${boundary.id} (code "${args.errorCode}").`,
              },
            );
          }
          // Direct siblings of this intermediate (same scopeTokenId,
          // different id). Bulk update; no per-row lock needed inside
          // the same txn.
          if (intermediate.scopeTokenId) {
            await args.tx
              .update(instanceTokens)
              .set({
                status: "failed",
                errorMessage: `Cancelled by error boundary ${boundary.id} on enclosing scope.`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(instanceTokens.scopeTokenId, intermediate.scopeTokenId),
                  ne(instanceTokens.id, intermediate.id),
                  inArray(instanceTokens.status, ["active", "waiting"] as const),
                ),
              );
          }
        }

        // Mark the host scope token failed (interrupted by boundary).
        await this.updateTokenWithLock(
          args.tx, scopeTok.id as string, scopeTok.version as number,
          {
            status: "failed",
            errorMessage: `Interrupted by error boundary ${boundary.id} (code "${args.errorCode}").`,
          },
        );
        // Bulk-kill host's direct scope children (same kill shape as
        // fireBoundaryTimer's shallow cascade — covers the common case).
        await args.tx
          .update(instanceTokens)
          .set({
            status: "failed",
            errorMessage: `Cancelled by error boundary ${boundary.id} on enclosing host.`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(instanceTokens.scopeTokenId, scopeTok.id as string),
              inArray(instanceTokens.status, ["active", "waiting"] as const),
            ),
          );

        // Cancel sibling boundary timers + event-subprocess timers
        // hanging off the host so they don't fire post-interrupt.
        await this.timerScheduler?.cancelTimer(scopeTok.id as string, args.tx);

        // Spawn the boundary-output token at the boundary's edge
        // target, inheriting host's PARENT scope (so the recovery
        // path runs at the right scope level).
        const childRows = await args.tx
          .insert(instanceTokens)
          .values({
            tenantId: args.tenantId,
            instanceId: args.instanceId,
            currentNodeId: outgoing.target,
            status: "active",
            parentTokenId: scopeTok.id as string,
            scopeTokenId: scopeTok.scopeTokenId as string | null,
          })
          .returning({ id: instanceTokens.id, version: instanceTokens.version });
        const child = childRows[0];
        await recordEvent(args.tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          tokenId: child.id,
          nodeId: outgoing.target,
          eventType: "token-created",
          payload: {
            parentTokenId: scopeTok.id,
            scopeTokenId: scopeTok.scopeTokenId,
            via: "error-boundary",
          },
        });
        const adv = await this.advanceToken({
          tx: args.tx,
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          tokenId: child.id,
          tokenVersion: child.version ?? 0,
          currentNodeId: outgoing.target,
          canvas: args.canvas,
          variables: args.variables,
        });
        return {
          tokenStatus: adv.tokenStatus,
          hops: args.hops + adv.hops,
          errorMessage: adv.errorMessage,
        };
      }

      // No match at this scope — push into the chain so a deeper
      // catcher can tear us down too, then walk up.
      chain.push({
        id: scopeTok.id as string,
        nodeId: hostNodeId,
        version: scopeTok.version as number,
        scopeTokenId: (scopeTok.scopeTokenId as string | null) ?? null,
        status: scopeTok.status as string,
      });
      cursor = (scopeTok.scopeTokenId as string | null) ?? null;
    }

    // Uncaught — chain exhausted. Fail.
    const message = `Uncaught error "${args.errorCode}" thrown at ${args.throwNodeId} — no matching error boundary in scope chain.`;
    await recordEvent(args.tx, {
      tenantId: args.tenantId,
      instanceId: args.instanceId,
      tokenId: args.throwingTokenId,
      nodeId: args.throwNodeId,
      eventType: "error-uncaught",
      payload: { errorCode: args.errorCode },
    });
    return { tokenStatus: "failed", hops: args.hops, errorMessage: message };
  }

  /** P2 Session 6b — at scope entry (root process start OR subprocess
   *  entry), find eventSubProcess children of the scope whose inner
   *  start event carries a timer eventDefinition, and schedule a
   *  `start-event-timer` row per match.
   *
   *  `parentScopeNodeId === null` means root-process scope: we match
   *  eventSubProcess nodes with no parentId. Otherwise we match
   *  eventSubProcess nodes whose parentId === parentScopeNodeId.
   *
   *  Timer rows are keyed on the parent scope token so cancelTimer
   *  (used by boundary fires, error boundaries, completeTask in the
   *  subprocess parent's case) bulk-deletes them at scope exit. */
  private async subscribeEventSubProcessTimers(args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any;
    tenantId: string;
    instanceId: string;
    parentScopeNodeId: string | null;
    parentScopeTokenId: string;
    canvas: EngineCanvas;
  }): Promise<void> {
    if (!this.timerScheduler) return;
    const eventSubProcesses = args.canvas.nodes.filter((n) => {
      if (n.type !== "eventSubProcess") return false;
      const parentId = (n as { parentId?: string }).parentId ?? null;
      return parentId === args.parentScopeNodeId;
    });
    for (const esp of eventSubProcesses) {
      // Find the inner start event with a timer definition. There's
      // canonically exactly one start event inside an event subprocess;
      // if multiple timer-starts exist we take the first.
      const innerStart = args.canvas.nodes.find((n) => {
        if (n.type !== "startEvent") return false;
        if ((n as { parentId?: string }).parentId !== esp.id) return false;
        const d = (n.data as { eventDefinition?: { kind?: string } } | undefined)?.eventDefinition;
        return d?.kind === "timer";
      });
      if (!innerStart) continue;
      const d = innerStart.data as {
        eventDefinition?: { value?: string; timerType?: string };
      };
      const fireAt = resolveTimerFireAt(d.eventDefinition);
      if (!fireAt) {
        this.logger.warn(
          `Event-subprocess timer ${esp.id} (start ${innerStart.id}): could not parse value "${d.eventDefinition?.value ?? ""}". Skipping.`,
        );
        continue;
      }
      // Interrupting flag: read off the eventSubProcess data
      // (`interrupting`) or the inner start's `isInterrupting`; default
      // true per BPMN 2.0. Designer doesn't yet expose this — current
      // default matches Camunda.
      const espData = esp.data as { interrupting?: boolean } | undefined;
      const startData = innerStart.data as { isInterrupting?: boolean } | undefined;
      const interrupting =
        espData?.interrupting !== false && startData?.isInterrupting !== false;
      await this.timerScheduler.scheduleTimer(
        {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          tokenId: args.parentScopeTokenId,
          fireAt,
          kind: "start-event-timer",
          payload: {
            eventSubProcessId: esp.id,
            innerStartId: innerStart.id,
            parentScopeNodeId: args.parentScopeNodeId,
            parentScopeTokenId: args.parentScopeTokenId,
            interrupting,
          },
        },
        args.tx,
      );
      await recordEvent(args.tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: args.parentScopeTokenId,
        nodeId: esp.id,
        eventType: "event-subprocess-subscribed",
        payload: {
          eventSubProcessId: esp.id,
          innerStartId: innerStart.id,
          kind: "timer",
          interrupting,
          fireAt: fireAt.toISOString(),
        },
      });
    }
  }

  /** P2 Session 6b — fire callback for `start-event-timer`. When the
   *  parent scope is still alive, spawns a child token at the
   *  eventSubProcess's inner start. Interrupting variant bulk-kills
   *  scope siblings before the spawn (root scope = the whole instance;
   *  subprocess scope = direct scope children). Non-interrupting just
   *  spawns alongside running siblings. */
  private async fireEventSubProcessStart(t: ClaimedTimer): Promise<void> {
    if (!t.tokenId) return;
    const payload = t.payload as
      | {
          eventSubProcessId?: string;
          innerStartId?: string;
          parentScopeNodeId?: string | null;
          parentScopeTokenId?: string;
          interrupting?: boolean;
        }
      | null;
    const innerStartId = payload?.innerStartId;
    const eventSubProcessId = payload?.eventSubProcessId;
    const parentScopeTokenId = payload?.parentScopeTokenId ?? t.tokenId;
    if (!innerStartId || !eventSubProcessId) return;
    const interrupting = payload?.interrupting !== false;

    await this.db.transaction(async (tx) => {
      // Reload parent scope token. If it's no longer live, the scope
      // is gone (completed / cancelled / interrupted) and this timer
      // is a stale fire. Drop silently.
      const scopeRows = await tx
        .select({
          id: instanceTokens.id,
          status: instanceTokens.status,
          scopeTokenId: instanceTokens.scopeTokenId,
        })
        .from(instanceTokens)
        .where(eq(instanceTokens.id, parentScopeTokenId))
        .limit(1);
      const scope = scopeRows[0];
      if (!scope || (scope.status !== "active" && scope.status !== "waiting")) {
        this.logger.log({
          event: "engine.eventSubProcess.fired.skipped",
          reason: scope ? `scope ${scope.status}` : "scope not found",
          parentScopeTokenId,
          eventSubProcessId,
        });
        return;
      }

      const instRow = await this.loadInstanceById(tx, t.instanceId, t.tenantId);
      const canvas = await this.loadCanvasForInstance(tx, instRow);
      const innerStart = canvas.nodes.find((n) => n.id === innerStartId);
      if (!innerStart) {
        this.logger.warn(`Event-subprocess timer: inner start ${innerStartId} not on canvas; dropping.`);
        return;
      }

      await recordEvent(tx, {
        tenantId: t.tenantId,
        instanceId: t.instanceId,
        tokenId: parentScopeTokenId,
        nodeId: eventSubProcessId,
        eventType: "event-subprocess-fired",
        payload: {
          eventSubProcessId,
          innerStartId,
          kind: "timer",
          interrupting,
        },
      });

      if (interrupting) {
        // Kill the scope siblings. Root scope (scopeTokenId IS NULL on
        // the parent scope token, AND parentScopeNodeId === null on
        // the timer payload) → kill all (active|waiting) tokens in the
        // instance EXCEPT the new child (not yet inserted, so just
        // bulk-kill before insert). Subprocess scope → kill tokens
        // whose scopeTokenId = parentScopeTokenId; leave the parent
        // scope token itself in `waiting` so the scope-drain logic
        // resumes it normally when the event-subprocess inner-end
        // fires.
        const isRootScope = payload?.parentScopeNodeId == null && scope.scopeTokenId == null;
        if (isRootScope) {
          await tx
            .update(instanceTokens)
            .set({
              status: "failed",
              errorMessage: `Interrupted by event subprocess ${eventSubProcessId}.`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(instanceTokens.instanceId, t.instanceId),
                inArray(instanceTokens.status, ["active", "waiting"] as const),
              ),
            );
        } else {
          await tx
            .update(instanceTokens)
            .set({
              status: "failed",
              errorMessage: `Interrupted by event subprocess ${eventSubProcessId}.`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(instanceTokens.scopeTokenId, parentScopeTokenId),
                inArray(instanceTokens.status, ["active", "waiting"] as const),
              ),
            );
        }
        // Cancel sibling event-subprocess timers + boundary timers on
        // this scope so they don't double-fire after the interrupt.
        await this.timerScheduler?.cancelTimer(parentScopeTokenId, tx);
      }

      // Spawn child at inner start. Scope:
      //  - root: scopeTokenId = null (matches root tokens; inner end
      //    triggers terminal completion + instance flip)
      //  - subprocess: scopeTokenId = parentScopeTokenId (matches
      //    a normal subprocess child; inner end fires the scope-drain
      //    + parent-resume path)
      const isRootScope = payload?.parentScopeNodeId == null && scope.scopeTokenId == null;
      const childScopeTokenId = isRootScope ? null : parentScopeTokenId;
      const childRows = await tx
        .insert(instanceTokens)
        .values({
          tenantId: t.tenantId,
          instanceId: t.instanceId,
          currentNodeId: innerStartId,
          status: "active",
          parentTokenId: parentScopeTokenId,
          scopeTokenId: childScopeTokenId,
        })
        .returning({ id: instanceTokens.id, version: instanceTokens.version });
      const child = childRows[0];
      await recordEvent(tx, {
        tenantId: t.tenantId,
        instanceId: t.instanceId,
        tokenId: child.id,
        nodeId: innerStartId,
        eventType: "token-created",
        payload: {
          parentTokenId: parentScopeTokenId,
          scopeTokenId: childScopeTokenId,
          via: interrupting ? "event-subprocess-interrupt" : "event-subprocess-noninterrupt",
        },
      });

      const adv = await this.advanceToken({
        tx,
        tenantId: t.tenantId,
        instanceId: t.instanceId,
        tokenId: child.id,
        tokenVersion: child.version ?? 0,
        currentNodeId: innerStartId,
        canvas,
        variables: (instRow.variables as Record<string, unknown> | null) ?? {},
      });

      // Same instance-completion gate as fireBoundaryTimer (6a fix).
      if (adv.tokenStatus === "completed" && (await this.countLiveTokens(tx, t.instanceId)) === 0) {
        await tx
          .update(processInstances)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(processInstances.id, t.instanceId));
        await recordEvent(tx, {
          tenantId: t.tenantId,
          instanceId: t.instanceId,
          eventType: "instance-completed",
          payload: { via: "event-subprocess-timer", hops: adv.hops },
        });
        await this.emitOutbox(tx, {
          tenantId: t.tenantId,
          instanceId: t.instanceId,
          eventType: "instance-completed",
          payload: { via: "event-subprocess-timer", hops: adv.hops },
          redactedKeys: canvas.engineConfig?.redactedVariableKeys,
        });
      } else if (adv.tokenStatus === "failed") {
        await tx
          .update(processInstances)
          .set({
            status: "failed",
            errorMessage: adv.errorMessage ?? null,
            completedAt: new Date(),
          })
          .where(eq(processInstances.id, t.instanceId));
        await recordEvent(tx, {
          tenantId: t.tenantId,
          instanceId: t.instanceId,
          eventType: "instance-failed",
          payload: { via: "event-subprocess-timer", hops: adv.hops, message: adv.errorMessage },
        });
      }
    });
  }

  /** P2 Session 5 — count active+waiting tokens whose `scope_token_id`
   *  matches. Called by the inner-end-event handler to decide whether
   *  the current sibling is the LAST one in the subprocess scope; only
   *  the last triggers parent resume. */
  private async countLiveScopeTokens(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    scopeTokenId: string,
  ): Promise<number> {
    const rows = await tx
      .select({ id: instanceTokens.id })
      .from(instanceTokens)
      .where(
        and(
          eq(instanceTokens.scopeTokenId, scopeTokenId),
          inArray(instanceTokens.status, ["active", "waiting"] as const),
        ),
      );
    return rows.length;
  }

  /** P1 — count tokens that are still live (active or waiting) on an
   *  instance. Called by every "is this token's completion terminal for
   *  the whole instance?" check so a parallel-split instance only flips
   *  to `completed` when the LAST sibling drains. Cheap single-row
   *  count query against the existing TOKEN_TENANT_STATUS_IDX. */
  private async countLiveTokens(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    instanceId: string,
  ): Promise<number> {
    const rows = await tx
      .select({ id: instanceTokens.id })
      .from(instanceTokens)
      .where(
        and(
          eq(instanceTokens.instanceId, instanceId),
          inArray(instanceTokens.status, ["active", "waiting"] as const),
        ),
      );
    return rows.length;
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
      candidateRole?: string | null;
      errorMessage?: string | null;
      dueAt?: Date | null;
      priority?: number | null;
      forkSize?: number | null;
      scopeTokenId?: string | null;
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
    await recordEvent(tx, {
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
    actingBy?: string | null;
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

      // Pull the canvas via the version FK (preferred) or the legacy
      // inline snapshot. The live process may have been edited since
      // this instance started, but execution always honours the
      // versioned snapshot.
      const canvas = await this.loadCanvasForInstance(tx, instRow);

      // P0 — outcome list validation. When the userTask declares
      // outcomes, the formData must carry an `outcome` key whose value
      // matches a declared id or label. Otherwise the routing condition
      // `outcome == "..."` can never match and the gateway fails. Done
      // BEFORE the task-completed audit so a rejected submission leaves
      // no misleading trail.
      const taskNode = canvas.nodes.find((n) => n.id === tokenRow.currentNodeId);
      const declaredOutcomes = (taskNode?.data as { outcomes?: Array<{ id?: string; label?: string }> } | undefined)
        ?.outcomes;
      if (Array.isArray(declaredOutcomes) && declaredOutcomes.length > 0) {
        const submitted = (args.formData as { outcome?: unknown } | undefined)?.outcome;
        if (typeof submitted !== "string" || submitted.length === 0) {
          throw new BadRequestException(
            `Task requires one of the declared outcomes: ${declaredOutcomes
              .map((o) => o.id || o.label)
              .join(", ")}.`,
          );
        }
        const allowed = new Set(
          declaredOutcomes.flatMap((o) => [o.id, o.label].filter(Boolean) as string[]),
        );
        if (!allowed.has(submitted)) {
          throw new BadRequestException(
            `Outcome "${submitted}" is not declared on this task. Valid: ${[...allowed].join(", ")}.`,
          );
        }
      }

      // P2 Session 4 — cancel any pending task-due reminder for this
      // token. Inside the txn so it rolls back if completion fails
      // downstream (e.g. an advanceToken failure).
      if (this.timerScheduler) {
        await this.timerScheduler.cancelTimer(args.tokenId, tx);
      }

      // 1. Audit task-completed FIRST so it acts as the user-facing
      //    anchor in any timeline replay — the variable-set rows that
      //    follow are the attribution detail. Reordering this is a
      //    behavioural contract; downstream consumers may rely on the
      //    "what did Alice just do" event coming before its details.
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        userId: args.userId,
        nodeId: tokenRow.currentNodeId,
        eventType: "task-completed",
        payload: args.actingBy ? { actingBy: args.actingBy } : null,
      });
      await this.emitOutbox(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        eventType: "task-completed",
        payload: {
          tokenId: args.tokenId,
          nodeId: tokenRow.currentNodeId,
          completedBy: args.userId,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
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
        // PII redaction: any key listed in canvas.engineConfig.
        // redactedVariableKeys gets its value replaced with the
        // sentinel string in the audit payload. The value still lives
        // in instance.variables; only the event trail is sanitised so
        // someone reading the audit can't reconstruct sensitive data.
        const redactedKeys = new Set(canvas.engineConfig?.redactedVariableKeys ?? []);
        for (const key of Object.keys(args.formData)) {
          await recordEvent(tx, {
            tenantId: args.tenantId,
            instanceId: tokenRow.instanceId,
            tokenId: args.tokenId,
            userId: args.userId,
            eventType: "variable-set",
            payload: redactedKeys.has(key)
              ? { key, value: "<redacted>", redacted: true }
              : { key, value: args.formData[key] },
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

      await recordEvent(tx, {
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

      // 4. Flip the instance to a terminal state once no live tokens
      //    remain. P1 — parallel-split instances stay `running` until
      //    the LAST sibling drains, so we guard the `completed` flip on
      //    a live-token count of zero. Failure flips immediately (per-
      //    branch failure propagation lands in P4).
      let instanceStatus: "running" | "completed" | "failed" = "running";
      if (advance.tokenStatus === "completed" && (await this.countLiveTokens(tx, tokenRow.instanceId)) === 0) {
        await this.updateInstanceWithLock(
          tx,
          tokenRow.instanceId,
          instanceVersion,
          {
            status: "completed",
            completedAt: new Date(),
          },
        );
        await recordEvent(tx, {
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
        await recordEvent(tx, {
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

  /** P3 Session 7 — deliver an external message to a parked
   *  intermediate-message-catch token.
   *
   *  Looks up the subscription via (tenantId, messageName, correlationKey)
   *  with FOR UPDATE SKIP LOCKED so two concurrent deliveries for the
   *  same tuple don't both wake the same token (only the first claim
   *  wins; the second sees no row and returns `no-subscription`).
   *
   *  On success: merges payload into instance.variables, deletes the
   *  subscription row, audits message-received, resumes the token, and
   *  re-runs advanceToken from the catch node. Returns
   *  `{ outcome: "delivered", instanceId, instanceStatus, tokenStatus }`.
   *
   *  On no match: returns `{ outcome: "no-subscription" }` so the
   *  controller can answer with a 404 + a useful body. Camunda answer.
   *
   *  Idempotency is handled by the controller (in-memory 10-min cache);
   *  this method is the inner transactional half. */
  async deliverMessage(args: {
    tenantId: string;
    messageName: string;
    correlationKey: string;
    payload?: Record<string, unknown>;
  }): Promise<
    | {
        outcome: "delivered";
        instanceId: string;
        instanceStatus: "running" | "completed" | "failed";
        tokenStatus: "completed" | "waiting" | "failed";
      }
    | { outcome: "no-subscription" }
  > {
    if (!this.messageSubscriptions) {
      // Defensive: tests that hand-construct without the service wired
      // shouldn't be calling this anyway, but a clear error beats a
      // confusing crash.
      throw new Error(
        "MessageSubscriptionService not wired into EngineService — cannot deliver messages.",
      );
    }
    return this.db.transaction(async (tx) => {
      const sub = await this.messageSubscriptions!.findAndLock(
        args.tenantId,
        args.messageName,
        args.correlationKey,
        tx,
      );
      if (!sub) {
        return { outcome: "no-subscription" as const };
      }

      // Load the parked token + instance. The subscription FK guarantees
      // both exist; if either is gone we treat that as no-subscription
      // (stale row from a partially-rolled-back txn — exotic but cheap
      // to handle).
      const tokenRows = await tx
        .select({
          id: instanceTokens.id,
          version: instanceTokens.version,
          instanceId: instanceTokens.instanceId,
          currentNodeId: instanceTokens.currentNodeId,
          status: instanceTokens.status,
          waitingFor: instanceTokens.waitingFor,
        })
        .from(instanceTokens)
        .where(eq(instanceTokens.id, sub.tokenId))
        .limit(1);
      const tokenRow = tokenRows[0];
      if (
        !tokenRow ||
        tokenRow.status !== "waiting" ||
        tokenRow.waitingFor !== "message"
      ) {
        // Stale subscription row pointing at a token that's already
        // moved on. Delete + report no-subscription.
        await this.messageSubscriptions!.unsubscribe(sub.tokenId, tx);
        return { outcome: "no-subscription" as const };
      }
      const instRow = await this.loadInstanceById(
        tx,
        tokenRow.instanceId,
        args.tenantId,
      );
      const canvas = await this.loadCanvasForInstance(tx, instRow);

      // Merge payload into instance.variables. Shallow merge — same
      // contract as completeTask.formData. Empty/undefined payload =
      // no variable mutation, no variable-set audit rows.
      let instanceVersion = instRow.version;
      const mergedVariables = {
        ...(instRow.variables as Record<string, unknown> | null ?? {}),
        ...(args.payload ?? {}),
      };
      if (args.payload && Object.keys(args.payload).length > 0) {
        instanceVersion = await this.updateInstanceWithLock(
          tx,
          tokenRow.instanceId,
          instanceVersion,
          { variables: mergedVariables },
        );
        const redactedKeys = new Set(
          canvas.engineConfig?.redactedVariableKeys ?? [],
        );
        for (const key of Object.keys(args.payload)) {
          await recordEvent(tx, {
            tenantId: args.tenantId,
            instanceId: tokenRow.instanceId,
            tokenId: tokenRow.id,
            eventType: "variable-set",
            payload: redactedKeys.has(key)
              ? { key, value: "<redacted>", redacted: true, via: "message" }
              : { key, value: args.payload[key], via: "message" },
          });
        }
      }

      // Audit the delivery. We log KEYS only, not values — the
      // variable-set rows above carry per-key values (with redaction).
      // That keeps message-received as a stable "what arrived" anchor
      // even when payloads are large or sensitive.
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: tokenRow.id,
        nodeId: tokenRow.currentNodeId,
        eventType: "message-received",
        payload: {
          messageName: args.messageName,
          correlationKey: args.correlationKey,
          payloadKeys: Object.keys(args.payload ?? {}),
        },
      });

      // Delete the subscription row in the same txn so a retry can't
      // double-fire even if the resume below fails downstream and
      // rolls everything back (the row comes back on rollback — that's
      // correct: the message wasn't actually delivered).
      await this.messageSubscriptions!.unsubscribe(tokenRow.id, tx);

      // Resume + advance — same shape as completeTask.
      const tokenVersion = await this.updateTokenWithLock(
        tx,
        tokenRow.id,
        tokenRow.version,
        { status: "active", waitingFor: null },
      );
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: tokenRow.id,
        nodeId: tokenRow.currentNodeId,
        eventType: "token-resumed",
        payload: { via: "message", messageName: args.messageName },
      });

      const advance = await this.advanceToken({
        tx,
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: tokenRow.id,
        tokenVersion,
        currentNodeId: tokenRow.currentNodeId,
        canvas,
        variables: mergedVariables,
        resumeFromWait: true,
      });

      // Flip the instance to terminal once tokens drain. Same shape as
      // completeTask's step 4 — replicated inline rather than extracted
      // because the live-token count short-circuit is the only branch
      // we care about, and extracting it without touching completeTask
      // is a bigger blast radius than this method warrants.
      let instanceStatus: "running" | "completed" | "failed" = "running";
      if (
        advance.tokenStatus === "completed" &&
        (await this.countLiveTokens(tx, tokenRow.instanceId)) === 0
      ) {
        await this.updateInstanceWithLock(
          tx,
          tokenRow.instanceId,
          instanceVersion,
          { status: "completed", completedAt: new Date() },
        );
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: tokenRow.instanceId,
          eventType: "instance-completed",
          payload: { via: "message", hops: advance.hops },
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
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: tokenRow.instanceId,
          eventType: "instance-failed",
          payload: { via: "message", hops: advance.hops, message: advance.errorMessage },
        });
        instanceStatus = "failed";
      }

      return {
        outcome: "delivered" as const,
        instanceId: tokenRow.instanceId,
        instanceStatus,
        tokenStatus: advance.tokenStatus,
      };
    });
  }

  /** Resume a token that was suspended on a serviceTask. Called by
   *  ServiceTaskService when the worker handler returns successfully.
   *  No auth check — this is worker-internal, gated by the fact that
   *  it can only be reached via a job claim that was originally
   *  enqueued by the engine itself.
   *
   *  Result is shallow-merged into instance.variables. PII redaction
   *  applies to the per-key variable-set audit rows (same rule as
   *  completeTask). The token then advances normally. */
  async completeServiceTask(args: {
    tokenId: string;
    tenantId: string;
    result: Record<string, unknown>;
  }): Promise<{
    instanceId: string;
    instanceStatus: "running" | "completed" | "failed";
    tokenStatus: "completed" | "waiting" | "failed";
  }> {
    return this.db.transaction(async (tx) => {
      const tokenRow = await this.loadWaitingServiceTaskToken(
        tx,
        args.tokenId,
        args.tenantId,
      );
      const instRow = await this.loadInstanceById(
        tx,
        tokenRow.instanceId,
        args.tenantId,
      );
      const canvas = await this.loadCanvasForInstance(tx, instRow);

      // Audit anchor first, then per-key variable rows (mirrors the
      // E3-polish completeTask ordering).
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        nodeId: tokenRow.currentNodeId,
        eventType: "node-exited",
        payload: { kind: "service-task-result" },
      });

      // Apply the canvas-defined output mapping (if any) to project
      // the handler's result shape onto the variable bag's vocabulary.
      // Without a mapping the result merges flat — backward compat
      // for canvases authored before E5.1.
      const node = canvas.nodes.find((n) => n.id === tokenRow.currentNodeId);
      const outputMappings = (node?.data as Record<string, unknown> | undefined)
        ?.outputMappings as Record<string, MappingEntry> | undefined;
      const projectedResult: Record<string, unknown> = outputMappings
        ? applyMapping(outputMappings, args.result ?? {})
        : (args.result ?? {});

      let instanceVersion = instRow.version;
      const merged = {
        ...((instRow.variables as Record<string, unknown> | null) ?? {}),
        ...projectedResult,
      };
      if (Object.keys(projectedResult).length > 0) {
        instanceVersion = await this.updateInstanceWithLock(
          tx,
          tokenRow.instanceId,
          instanceVersion,
          { variables: merged },
        );
        const redactedKeys = new Set(
          canvas.engineConfig?.redactedVariableKeys ?? [],
        );
        for (const key of Object.keys(projectedResult)) {
          await recordEvent(tx, {
            tenantId: args.tenantId,
            instanceId: tokenRow.instanceId,
            tokenId: args.tokenId,
            nodeId: tokenRow.currentNodeId,
            eventType: "variable-set",
            payload: redactedKeys.has(key)
              ? { key, value: "<redacted>", redacted: true, source: "service-task" }
              : { key, value: projectedResult[key], source: "service-task" },
          });
        }
      }

      const tokenVersion = await this.updateTokenWithLock(
        tx,
        args.tokenId,
        tokenRow.version,
        { status: "active", waitingFor: null },
      );
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        nodeId: tokenRow.currentNodeId,
        eventType: "token-resumed",
      });

      const advance = await this.advanceToken({
        tx,
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        tokenVersion,
        currentNodeId: tokenRow.currentNodeId,
        canvas,
        variables: merged,
        resumeFromWait: true,
      });

      // P1 — guard the `completed` flip on a live-token count of zero
      // (parallel-split siblings keep the instance running).
      let instanceStatus: "running" | "completed" | "failed" = "running";
      if (advance.tokenStatus === "completed" && (await this.countLiveTokens(tx, tokenRow.instanceId)) === 0) {
        await this.updateInstanceWithLock(
          tx,
          tokenRow.instanceId,
          instanceVersion,
          { status: "completed", completedAt: new Date() },
        );
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: tokenRow.instanceId,
          eventType: "instance-completed",
          payload: { hops: advance.hops },
        });
        await this.emitOutbox(tx, {
          tenantId: args.tenantId,
          instanceId: tokenRow.instanceId,
          eventType: "instance-completed",
          payload: { hops: advance.hops, variables: merged },
          redactedKeys: canvas.engineConfig?.redactedVariableKeys,
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
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: tokenRow.instanceId,
          eventType: "instance-failed",
          payload: { hops: advance.hops, message: advance.errorMessage },
        });
        instanceStatus = "failed";
      }

      return {
        instanceId: tokenRow.instanceId,
        instanceStatus,
        tokenStatus: advance.tokenStatus,
      };
    });
  }

  /** Mark a service-task-suspended token as failed because the worker
   *  job hit the dead state (handler exhausted retries or no handler
   *  registered). Without this hook the token would sit in `waiting`
   *  forever. Called by ServiceTaskService.onDead. */
  async failServiceTaskFromWorker(args: {
    tokenId: string;
    tenantId: string;
    reason: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const tokenRow = await this.loadWaitingServiceTaskToken(
        tx,
        args.tokenId,
        args.tenantId,
      ).catch(() => null);
      // If the token isn't waiting on a service-task anymore (already
      // resumed, completed, or cancelled) the dead-job is moot.
      // Idempotent no-op so worker retries can't double-fail.
      if (!tokenRow) return;

      const instRow = await this.loadInstanceById(
        tx,
        tokenRow.instanceId,
        args.tenantId,
      );

      try {
        await this.updateTokenWithLock(tx, args.tokenId, tokenRow.version, {
          status: "failed",
          errorMessage: args.reason,
        });
      } catch {
        // Concurrent mutation already moved it; nothing to do.
        return;
      }
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        nodeId: tokenRow.currentNodeId,
        eventType: "error",
        payload: { reason: "service-task-dead", message: args.reason },
      });

      // Instance flip can race with a concurrent cancel/complete that
      // already moved the instance to a terminal state. The
      // optimistic-lock conflict on .version surfaces as
      // ConflictException — catch it and skip the instance update +
      // outbox emit. The token-level audit above already records the
      // service-task failure; the instance's existing terminal state
      // is the authoritative outcome.
      try {
        await this.updateInstanceWithLock(
          tx,
          tokenRow.instanceId,
          instRow.version,
          {
            status: "failed",
            errorMessage: args.reason,
            completedAt: new Date(),
          },
        );
      } catch {
        return;
      }
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        eventType: "instance-failed",
        payload: { reason: "service-task-dead", message: args.reason },
      });
      await this.emitOutbox(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        eventType: "instance-failed",
        payload: { reason: "service-task-dead", message: args.reason },
      });
    });
  }

  /** Record a per-attempt service-task failure to the audit trail.
   *  Called by the worker on EVERY failed attempt — both the ones that
   *  will retry and the final one that flips the token to dead. Without
   *  this, operators only saw the terminal "service task dead after N
   *  attempts" summary; debugging a flaky integration ("attempt 1
   *  timed out, attempt 2 returned 502") was impossible from the audit
   *  trail alone. GAP-T2-B remediation.
   *
   *  Best-effort: a write failure here does NOT abort the worker's
   *  retry loop. Logged at warn so a degraded audit pipeline is
   *  visible without taking down the engine.
   *
   *  No token-status mutation: this method ONLY writes the audit row.
   *  Token + instance terminal flips happen in failServiceTaskFromWorker
   *  on the dead-job path, after the final retry. */
  async recordServiceTaskAttemptFailed(args: {
    tokenId: string;
    instanceId: string;
    tenantId: string;
    nodeId: string | null;
    attempt: number;
    maxAttempts: number;
    error: string;
    willRetry: boolean;
    nextAttemptAt: Date | null;
  }): Promise<void> {
    try {
      await this.db.insert(instanceEvents).values({
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: args.tokenId,
        nodeId: args.nodeId,
        eventType: "service-task-attempt-failed",
        payload: {
          attempt: args.attempt,
          maxAttempts: args.maxAttempts,
          // Cap the error string so a chatty handler can't bloat the
          // audit row. The terminal `error` event keeps the full last-
          // attempt message anyway.
          error: args.error.length > 1000 ? `${args.error.slice(0, 1000)}…` : args.error,
          willRetry: args.willRetry,
          nextAttemptAt: args.nextAttemptAt ? args.nextAttemptAt.toISOString() : null,
        },
      });
    } catch (e) {
      this.logger.warn(
        `recordServiceTaskAttemptFailed: audit write failed for token ${args.tokenId}: ${(e as Error).message}`,
      );
    }
  }

  /** Variant of loadWaitingTokenForCompletion for the service-task
   *  resume path. Validates `waitingFor === "service-task"` (vs the
   *  user-task helper's "userTask"). No assignedTo check — service
   *  tasks aren't user-claimable. */
  private async loadWaitingServiceTaskToken(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    tokenId: string,
    tenantId: string,
  ): Promise<{
    instanceId: string;
    currentNodeId: string;
    version: number;
  }> {
    const rows = await tx
      .select({
        id: instanceTokens.id,
        instanceId: instanceTokens.instanceId,
        currentNodeId: instanceTokens.currentNodeId,
        status: instanceTokens.status,
        waitingFor: instanceTokens.waitingFor,
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
    if (!row) throw new NotFoundException("Service-task token not found.");
    if (row.status !== "waiting" || row.waitingFor !== "service-task") {
      throw new BadRequestException(
        `Token is not waiting on a service task (status=${row.status}, waitingFor=${row.waitingFor}).`,
      );
    }
    // BUG-B-07 fix: block service-task completion if the instance has
    // been suspended since the job was claimed. The worker-level job
    // filter prevents NEW claims from executing while suspended, but
    // jobs already in `running` status continue to the callback. We
    // reject here with a retriable BadRequest; the worker registry
    // transitions the job back to queued so it auto-resumes when the
    // admin calls /resume.
    const instRows = await tx
      .select({ status: processInstances.status })
      .from(processInstances)
      .where(eq(processInstances.id, row.instanceId))
      .limit(1);
    if (instRows[0]?.status === "suspended") {
      throw new BadRequestException(
        "Instance is suspended — service-task completion deferred until resume.",
      );
    }
    return {
      instanceId: row.instanceId,
      currentNodeId: row.currentNodeId,
      version: row.version,
    };
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
    /** Domain roles held by the caller — drives the claimable-by-me
     *  half of the "my inbox" filter. Ignored when an explicit
     *  `assignedTo` filter is passed. */
    userRoles?: string[];
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
      candidateRole: string | null;
      createdAt: string;
      dueAt: string | null;
      priority: number | null;
      overdue: boolean;
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
      // Claim-first inbox:
      //   • tasks I've already claimed (assignedTo=me), OR
      //   • unassigned tasks with no role gate (legacy pre-R1 tokens), OR
      //   • unassigned tasks whose candidateRole is in my role set.
      const myRoles = args.userRoles ?? [];
      const claimable = myRoles.length > 0
        ? or(
            isNull(instanceTokens.candidateRole),
            inArray(instanceTokens.candidateRole, myRoles),
          )
        : isNull(instanceTokens.candidateRole);
      whereExpr = and(
        ...baseConds,
        or(
          eq(instanceTokens.assignedTo, args.userIdForMine),
          and(isNull(instanceTokens.assignedTo), claimable),
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
        candidateRole: instanceTokens.candidateRole,
        createdAt: instanceTokens.createdAt,
        dueAt: instanceTokens.dueAt,
        priority: instanceTokens.priority,
        processId: processInstances.processId,
        // Prefer the versioned canvas; fall back to the legacy inline
        // snapshot for instances created before E4.5b.
        versionedCanvas: processVersions.canvasData,
        legacySnapshot: processInstances.definitionSnapshot,
        processName: processes.name,
      })
      .from(instanceTokens)
      .innerJoin(
        processInstances,
        eq(processInstances.id, instanceTokens.instanceId),
      )
      .innerJoin(processes, eq(processes.id, processInstances.processId))
      .leftJoin(
        processVersions,
        eq(processVersions.id, processInstances.processVersionId),
      )
      .where(whereExpr)
      .orderBy(desc(instanceTokens.createdAt))
      .limit(200);

    return rows.map((r) => {
      const canvas = projectCanvas(r.versionedCanvas ?? r.legacySnapshot);
      const node = canvas.nodes.find((n) => n.id === r.currentNodeId);
      const nodeData = node?.data ?? null;
      const nodeLabel =
        nodeData && typeof nodeData === "object" && typeof (nodeData as Record<string, unknown>).label === "string"
          ? ((nodeData as Record<string, unknown>).label as string)
          : null;
      // P2 Session 4 — `overdue` is a derived convenience for inbox
      // rendering. Server-side computation guarantees clock parity
      // (clients with skewed clocks would otherwise flag/unflag).
      const dueAtMs = r.dueAt ? r.dueAt.getTime() : null;
      return {
        tokenId: r.tokenId,
        instanceId: r.instanceId,
        processId: r.processId,
        processName: r.processName,
        nodeId: r.currentNodeId,
        nodeLabel,
        nodeData,
        assignedTo: r.assignedTo,
        candidateRole: r.candidateRole,
        createdAt: r.createdAt.toISOString(),
        dueAt: r.dueAt ? r.dueAt.toISOString() : null,
        priority: r.priority,
        overdue: dueAtMs !== null && dueAtMs <= Date.now(),
      };
    });
  }

  /** Claim a waiting userTask token. Requires the token to have no
   *  current assignee; if it carries a candidateRole, caller must hold
   *  that role. Idempotent if the caller is already the assignee. */
  async claimTask(args: {
    tokenId: string;
    tenantId: string;
    userId: string;
    userRoles: string[];
    /** Admin id when this claim is being made on behalf of `userId`.
     *  The target still has to hold the required candidateRole — the
     *  admin's systemRole doesn't grant role membership. */
    actingBy?: string | null;
  }): Promise<{ claimed: boolean; alreadyClaimed: boolean }> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: instanceTokens.id,
          status: instanceTokens.status,
          waitingFor: instanceTokens.waitingFor,
          assignedTo: instanceTokens.assignedTo,
          candidateRole: instanceTokens.candidateRole,
          currentNodeId: instanceTokens.currentNodeId,
          instanceId: instanceTokens.instanceId,
          version: instanceTokens.version,
        })
        .from(instanceTokens)
        .where(
          and(
            eq(instanceTokens.id, args.tokenId),
            eq(instanceTokens.tenantId, args.tenantId),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundException("Task not found.");
      const [instRow] = await tx
        .select({ status: processInstances.status })
        .from(processInstances)
        .where(eq(processInstances.id, row.instanceId))
        .limit(1);
      if (instRow?.status === "suspended") {
        throw new BadRequestException(
          "Instance is suspended — resume it before claiming tasks.",
        );
      }
      if (row.status !== "waiting" || row.waitingFor !== "userTask") {
        throw new BadRequestException(
          `Task is not waiting on a user action (status=${row.status}).`,
        );
      }
      if (row.assignedTo === args.userId) {
        return { claimed: false, alreadyClaimed: true };
      }
      if (row.assignedTo && row.assignedTo !== args.userId) {
        throw new ForbiddenException(
          "Task is already claimed by another user.",
        );
      }
      if (row.candidateRole && !args.userRoles.includes(row.candidateRole)) {
        throw new ForbiddenException(
          `Task requires role "${row.candidateRole}" which you do not hold.`,
        );
      }
      try {
        await this.updateTokenWithLock(tx, args.tokenId, row.version, {
          assignedTo: args.userId,
        });
      } catch (err) {
        // Translate the optimistic-lock collision into the same
        // user-facing message as the pre-check path above. Without
        // this, a race-loser sees the engine's internal "token
        // version" message which leaks the lock impl + tokenId.
        if (err instanceof ConflictException) {
          throw new ForbiddenException(
            "Task is already claimed by another user.",
          );
        }
        throw err;
      }
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: row.instanceId,
        tokenId: args.tokenId,
        userId: args.userId,
        nodeId: row.currentNodeId,
        eventType: "task-claimed",
        payload: {
          auto: false,
          candidateRole: row.candidateRole ?? null,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });
      return { claimed: true, alreadyClaimed: false };
    });
  }

  /** Release a claim the caller holds. Idempotent: if not the
   *  claimant, returns {unclaimed: false} rather than erroring so
   *  retries on network flakes don't 403. */
  async unclaimTask(args: {
    tokenId: string;
    tenantId: string;
    userId: string;
    actingBy?: string | null;
  }): Promise<{ unclaimed: boolean }> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: instanceTokens.id,
          status: instanceTokens.status,
          waitingFor: instanceTokens.waitingFor,
          assignedTo: instanceTokens.assignedTo,
          candidateRole: instanceTokens.candidateRole,
          currentNodeId: instanceTokens.currentNodeId,
          instanceId: instanceTokens.instanceId,
          version: instanceTokens.version,
        })
        .from(instanceTokens)
        .where(
          and(
            eq(instanceTokens.id, args.tokenId),
            eq(instanceTokens.tenantId, args.tenantId),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundException("Task not found.");
      if (row.status !== "waiting" || row.waitingFor !== "userTask") {
        throw new BadRequestException(
          `Task is not waiting on a user action (status=${row.status}).`,
        );
      }
      if (row.assignedTo !== args.userId) {
        return { unclaimed: false };
      }
      // Safeguard: only role-assigned tokens should be unclaimable.
      // Direct-user tokens had assignedTo set at entry and unclaiming
      // would strand the task — block it.
      if (!row.candidateRole) {
        throw new BadRequestException(
          "Task is not role-assigned; cannot be unclaimed.",
        );
      }
      try {
        await this.updateTokenWithLock(tx, args.tokenId, row.version, {
          assignedTo: null,
        });
      } catch (err) {
        if (err instanceof ConflictException) {
          throw new ConflictException(
            "Task assignment changed; please refresh and try again.",
          );
        }
        throw err;
      }
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: row.instanceId,
        tokenId: args.tokenId,
        userId: args.userId,
        nodeId: row.currentNodeId,
        eventType: "task-unclaimed",
        payload: {
          candidateRole: row.candidateRole,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });
      return { unclaimed: true };
    });
  }

  /** Admin-only: reassign a waiting userTask to a different user.
   *  Validates the target is in-tenant and active, and (if the token
   *  carries a candidateRole) that the target holds that role —
   *  reassigning to someone who can't perform the task would just
   *  strand it. Records both the previous and new assignee on the
   *  audit event so the trail shows who-from-whom-to-whom. */
  async reassignTask(args: {
    tokenId: string;
    tenantId: string;
    userId: string;          // admin performing the reassign
    targetUserId: string;
    actingBy?: string | null;
  }): Promise<{ reassigned: boolean; from: string | null; to: string }> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: instanceTokens.id,
          status: instanceTokens.status,
          waitingFor: instanceTokens.waitingFor,
          assignedTo: instanceTokens.assignedTo,
          candidateRole: instanceTokens.candidateRole,
          currentNodeId: instanceTokens.currentNodeId,
          instanceId: instanceTokens.instanceId,
          version: instanceTokens.version,
        })
        .from(instanceTokens)
        .where(
          and(
            eq(instanceTokens.id, args.tokenId),
            eq(instanceTokens.tenantId, args.tenantId),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundException("Task not found.");
      if (row.status !== "waiting" || row.waitingFor !== "userTask") {
        throw new BadRequestException(
          `Task is not waiting on a user action (status=${row.status}).`,
        );
      }

      const [target] = await tx
        .select({
          id: users.id,
          tenantId: users.tenantId,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, args.targetUserId))
        .limit(1);
      if (!target || target.tenantId !== args.tenantId) {
        throw new NotFoundException("Target user not found.");
      }
      if (!target.isActive) {
        throw new BadRequestException("Target user is inactive.");
      }
      if (row.candidateRole) {
        // Tenant-scoped role membership lookup. The userRoles row is
        // created at role-grant time and removed on revoke, so an
        // in-list check here is authoritative.
        const targetRoles = await this.userRoleKeysForTenant(
          tx,
          args.targetUserId,
          args.tenantId,
        );
        if (!targetRoles.includes(row.candidateRole)) {
          throw new BadRequestException(
            `Target user does not hold role "${row.candidateRole}".`,
          );
        }
      }

      if (row.assignedTo === args.targetUserId) {
        return { reassigned: false, from: row.assignedTo, to: args.targetUserId };
      }

      try {
        await this.updateTokenWithLock(tx, args.tokenId, row.version, {
          assignedTo: args.targetUserId,
        });
      } catch (err) {
        if (err instanceof ConflictException) {
          throw new ConflictException(
            "Task assignment changed; please refresh and try again.",
          );
        }
        throw err;
      }
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: row.instanceId,
        tokenId: args.tokenId,
        userId: args.userId,
        nodeId: row.currentNodeId,
        eventType: "task-reassigned",
        payload: {
          from: row.assignedTo,
          to: args.targetUserId,
          candidateRole: row.candidateRole ?? null,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });
      return { reassigned: true, from: row.assignedTo, to: args.targetUserId };
    });
  }

  /** Admin-only: advance a waiting userTask past its current node
   *  WITHOUT requiring a claim, an assignee match, or form data.
   *  Use case: an admin needs to unblock an instance whose task is
   *  parked on a user who is unavailable, and the proper path
   *  (reassign + complete) isn't appropriate. The audit event is
   *  "task-skipped" so the trail clearly distinguishes this from a
   *  normal completion. */
  async skipTask(args: {
    tokenId: string;
    tenantId: string;
    userId: string;          // admin performing the skip
    actingBy?: string | null;
    reason?: string | null;
  }): Promise<{
    instanceId: string;
    instanceStatus: "running" | "completed" | "failed";
    tokenStatus: "completed" | "waiting" | "failed";
  }> {
    return this.db.transaction(async (tx) => {
      const [tokenRow] = await tx
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
            eq(instanceTokens.id, args.tokenId),
            eq(instanceTokens.tenantId, args.tenantId),
          ),
        )
        .limit(1);
      if (!tokenRow) throw new NotFoundException("Task not found.");
      if (tokenRow.status !== "waiting" || tokenRow.waitingFor !== "userTask") {
        throw new BadRequestException(
          `Task is not waiting on a user action (status=${tokenRow.status}).`,
        );
      }
      const instRow = await this.loadInstanceById(
        tx,
        tokenRow.instanceId,
        args.tenantId,
      );
      const canvas = await this.loadCanvasForInstance(tx, instRow);

      // P2 Session 4 — cancel any pending task-due reminder.
      if (this.timerScheduler) {
        await this.timerScheduler.cancelTimer(args.tokenId, tx);
      }

      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        userId: args.userId,
        nodeId: tokenRow.currentNodeId,
        eventType: "task-skipped",
        payload: {
          previousAssignee: tokenRow.assignedTo,
          reason: args.reason ?? null,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });
      await this.emitOutbox(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        eventType: "task-skipped",
        payload: {
          tokenId: args.tokenId,
          nodeId: tokenRow.currentNodeId,
          skippedBy: args.userId,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });

      const tokenVersion = await this.updateTokenWithLock(
        tx,
        args.tokenId,
        tokenRow.version,
        {
          status: "active",
          waitingFor: null,
        },
      );
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        userId: args.userId,
        nodeId: tokenRow.currentNodeId,
        eventType: "token-resumed",
      });

      const advance = await this.advanceToken({
        tx,
        tenantId: args.tenantId,
        instanceId: tokenRow.instanceId,
        tokenId: args.tokenId,
        tokenVersion,
        currentNodeId: tokenRow.currentNodeId,
        canvas,
        variables: (instRow.variables as Record<string, unknown> | null) ?? {},
        resumeFromWait: true,
      });

      // P1 — guard `completed` on a live-token count of zero (parallel
      // siblings keep the instance running).
      let instanceStatus: "running" | "completed" | "failed" = "running";
      if (advance.tokenStatus === "completed" && (await this.countLiveTokens(tx, tokenRow.instanceId)) === 0) {
        await this.updateInstanceWithLock(
          tx,
          tokenRow.instanceId,
          instRow.version,
          { status: "completed", completedAt: new Date() },
        );
        await recordEvent(tx, {
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
          instRow.version,
          {
            status: "failed",
            errorMessage: advance.errorMessage ?? null,
            completedAt: new Date(),
          },
        );
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: tokenRow.instanceId,
          eventType: "instance-failed",
          payload: { hops: advance.hops, message: advance.errorMessage },
        });
        instanceStatus = "failed";
      }

      this.logger.log({
        event: "engine.task.skipped",
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

  /** Tenant-scoped role-key lookup used by reassignTask. Mirrors the
   *  query in UsersService.getRoleKeys but lives on the engine txn so
   *  the membership check sits inside the same transaction as the
   *  token update — no read/write race against a concurrent revoke. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async userRoleKeysForTenant(tx: any, userId: string, tenantId: string): Promise<string[]> {
    const rows = await tx
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.tenantId, tenantId),
        ),
      );
    return rows.map((r: { key: string }) => r.key);
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
        candidateRole: instanceTokens.candidateRole,
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
    // Separate instance-status lookup (not innerJoin) so the fake DB
    // in unit tests keeps working. Trivial perf cost (single PK hit).
    const instRows = await tx
      .select({ status: processInstances.status })
      .from(processInstances)
      .where(eq(processInstances.id, row.instanceId))
      .limit(1);
    if (instRows[0]?.status === "suspended") {
      throw new BadRequestException(
        "Instance is suspended — resume it before completing tasks.",
      );
    }
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
    // Claim-first: role-assigned tokens must be claimed before they
    // can be completed. The permissive "anyone can complete an
    // unassigned task" path is preserved for legacy tokens that carry
    // no role gate — backwards compatible with pre-R1 instances.
    if (!row.assignedTo && row.candidateRole) {
      throw new ForbiddenException(
        `Task must be claimed before completion (role "${row.candidateRole}").`,
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
    processVersionId: string | null;
  }> {
    const rows = await tx
      .select({
        id: processInstances.id,
        version: processInstances.version,
        variables: processInstances.variables,
        definitionSnapshot: processInstances.definitionSnapshot,
        processVersionId: processInstances.processVersionId,
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
      status?: "running" | "completed" | "failed" | "cancelled" | "suspended";
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
      status: "running" | "completed" | "failed" | "cancelled" | "suspended";
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

  /** List instances across the tenant, newest first. The "Running"
   *  page calls this to show what's in flight without picking a
   *  process first. Optional `status` filter narrows to a single
   *  state ('running'/'completed'/'failed'/'cancelled'). Capped at
   *  200; pagination cursor is the E7 perf concern.
   *
   *  Includes the parent process name + the user who started the
   *  instance so the UI can render a single row without follow-up
   *  GETs (small N+1 cost on the join is fine for the 200-row cap). */
  async listInstancesForTenant(args: {
    tenantId: string;
    status?: "running" | "completed" | "failed" | "cancelled" | "suspended";
    businessKey?: string;
  }): Promise<
    Array<{
      id: string;
      processId: string;
      processName: string;
      status: "running" | "completed" | "failed" | "cancelled" | "suspended";
      businessKey: string | null;
      startedBy: string;
      startedAt: string;
      completedAt: string | null;
      errorMessage: string | null;
    }>
  > {
    const conds = [eq(processInstances.tenantId, args.tenantId)];
    if (args.status) conds.push(eq(processInstances.status, args.status));
    if (args.businessKey) {
      conds.push(eq(processInstances.businessKey, args.businessKey));
    }
    const rows = await this.db
      .select({
        id: processInstances.id,
        processId: processInstances.processId,
        processName: processes.name,
        status: processInstances.status,
        businessKey: processInstances.businessKey,
        startedBy: processInstances.startedBy,
        startedAt: processInstances.startedAt,
        completedAt: processInstances.completedAt,
        errorMessage: processInstances.errorMessage,
      })
      .from(processInstances)
      .innerJoin(processes, eq(processes.id, processInstances.processId))
      .where(and(...conds))
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
  /** HR-1 — lightweight lookup used by the InstancesController to
   *  gate `view` permission BEFORE running the full instance fetch.
   *  Returns the processId of the instance, or null if the id doesn't
   *  exist in the caller's tenant. The caller collapses "not found"
   *  and "not authorised" into the same 403 to avoid leaking instance
   *  ids to unauthorised users. */
  async getInstanceProcessId(args: {
    instanceId: string;
    tenantId: string;
  }): Promise<string | null> {
    const [row] = await this.db
      .select({ processId: processInstances.processId })
      .from(processInstances)
      .where(
        and(
          eq(processInstances.id, args.instanceId),
          eq(processInstances.tenantId, args.tenantId),
        ),
      )
      .limit(1);
    return row?.processId ?? null;
  }

  async getInstance(args: {
    instanceId: string;
    tenantId: string;
  }): Promise<{
    id: string;
    processId: string;
    processName: string | null;
    processVersion: number | null;
    processVersionId: string | null;
    definitionHash: string;
    businessKey: string | null;
    status: "running" | "completed" | "failed" | "cancelled" | "suspended";
    variables: Record<string, unknown>;
    startedBy: string;
    startedByName: string | null;
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
      candidateRole: string | null;
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
    /** The versioned canvas this instance is running against. Included
     *  so the console's read-only canvas view has everything it needs
     *  in one round-trip. Shape is ReactFlow nodes+edges. */
    canvasData: unknown;
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

    // Resolve the versioned canvas (or fall back to legacy snapshot)
    // AND the human-readable process version number in one go. Kept
    // defensive: if the version row is missing we still return null
    // rather than throwing, so the detail page renders.
    let canvasData: unknown = null;
    let processVersion: number | null = null;
    if (inst.processVersionId) {
      const vrows = await this.db
        .select({ canvasData: processVersions.canvasData, version: processVersions.version })
        .from(processVersions)
        .where(eq(processVersions.id, inst.processVersionId))
        .limit(1);
      canvasData = vrows[0]?.canvasData ?? null;
      processVersion = vrows[0]?.version ?? null;
    }
    if (!canvasData && inst.definitionSnapshot) {
      canvasData = inst.definitionSnapshot;
    }

    // Process name and started-by display name — operator UI needs
    // these instead of UUIDs. One small select each; both are tiny
    // single-row lookups against indexed PKs.
    let processName: string | null = null;
    {
      const prows = await this.db
        .select({ name: processes.name })
        .from(processes)
        .where(eq(processes.id, inst.processId))
        .limit(1);
      processName = prows[0]?.name ?? null;
    }
    let startedByName: string | null = null;
    if (inst.startedBy) {
      const urows = await this.db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, inst.startedBy))
        .limit(1);
      startedByName = urows[0]?.displayName ?? null;
    }

    const tokens = await this.db
      .select({
        id: instanceTokens.id,
        currentNodeId: instanceTokens.currentNodeId,
        status: instanceTokens.status,
        waitingFor: instanceTokens.waitingFor,
        assignedTo: instanceTokens.assignedTo,
        candidateRole: instanceTokens.candidateRole,
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
      processName,
      processVersion,
      processVersionId: inst.processVersionId,
      definitionHash: inst.definitionHash,
      businessKey: inst.businessKey,
      status: inst.status,
      variables: (inst.variables as Record<string, unknown>) ?? {},
      startedBy: inst.startedBy,
      startedByName,
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
      canvasData,
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
    actingBy?: string | null;
    reason?: string;
  }): Promise<{
    instanceId: string;
    status: "running" | "completed" | "failed" | "cancelled" | "suspended";
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
      // original transition is the authoritative record. Suspended
      // instances are NOT terminal — operators must be able to cancel
      // without resuming first (otherwise suspending-then-cancelling
      // a broken instance requires two round-trips and briefly
      // un-pauses execution, which is exactly what the operator is
      // trying to avoid).
      if (inst.status !== "running" && inst.status !== "suspended") {
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
      // P2 Session 4 — clear all timers tied to this instance. Cheap
      // bulk delete; the alternative is N per-token cancels in the
      // loop below. Inside the txn so cancellation rolls back if the
      // instance update fails.
      if (this.timerScheduler) {
        await this.timerScheduler.cancelTimersForInstance(args.instanceId, tx);
      }
      // P3 Session 7 — same shape for message subscriptions. Without
      // this, a cancelled instance would leave a stale row that a
      // later POST /api/messages could try to deliver to a dead token.
      if (this.messageSubscriptions) {
        await this.messageSubscriptions.cancelForInstance(args.instanceId, tx);
      }
      for (const tok of liveTokens) {
        try {
          await this.updateTokenWithLock(tx, tok.id, tok.version, {
            status: "failed",
            errorMessage: args.reason
              ? `Cancelled: ${args.reason}`
              : "Cancelled by user.",
          });
          await recordEvent(tx, {
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

      // Cancel any in-flight jobs tied to this instance. Without this,
      // service-task jobs that were queued/running when the user
      // cancels keep ticking; their handlers eventually call back into
      // completeServiceTask, find the instance cancelled, and throw,
      // burning retry slots and generating spurious error logs.
      // Marking them `dead` short-circuits that loop. Status='running'
      // jobs aren't aborted mid-execution (we can't), but the
      // failServiceTaskFromWorker idempotency above handles their
      // post-completion writes by no-op'ing on the already-terminal
      // instance.
      const cancelledJobs = await tx
        .update(engineJobs)
        .set({
          status: "dead",
          lastError: "Instance cancelled.",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(engineJobs.instanceId, args.instanceId),
            inArray(engineJobs.status, ["queued", "running"]),
          ),
        )
        .returning({ id: engineJobs.id });

      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        userId: args.userId,
        eventType: "instance-cancelled",
        payload: {
          reason: args.reason ?? null,
          tokensCancelled: cancelledCount,
          jobsCancelled: cancelledJobs.length,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });
      await this.emitOutbox(tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        eventType: "instance-cancelled",
        payload: {
          reason: args.reason ?? null,
          cancelledBy: args.userId,
          tokensCancelled: cancelledCount,
          jobsCancelled: cancelledJobs.length,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
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

  /** Admin variable edit: shallow-merge patch into instance variables,
   *  audit every touched key with old + new values + operator reason.
   *  Industry equivalent: Camunda Cockpit's "Modify Variables" action
   *  in Admin → Instance. Reason is mandatory per compliance rule —
   *  auditors need to answer "why was this variable changed 3 weeks
   *  later?". Emits per-key `variable-edited` rows (different type
   *  from the engine-driven `variable-set` so the audit trail cleanly
   *  distinguishes admin intervention from normal flow). */
  async editInstanceVariables(args: {
    instanceId: string;
    tenantId: string;
    userId: string;
    /** When set, an admin is editing on behalf of `userId`. Recorded
     *  on every audit row so the trail answers "who really did this?"
     *  Feature D — Act-as impersonation. */
    actingBy?: string | null;
    patch: Record<string, unknown>;
    reason: string;
  }): Promise<{ instanceId: string; editedKeys: string[] }> {
    if (!args.reason || args.reason.trim().length < 3) {
      throw new BadRequestException(
        "A reason (min 3 chars) is required to edit variables.",
      );
    }
    if (!args.patch || typeof args.patch !== "object" || Array.isArray(args.patch)) {
      throw new BadRequestException("patch must be a JSON object.");
    }
    const keys = Object.keys(args.patch);
    if (keys.length === 0) {
      return { instanceId: args.instanceId, editedKeys: [] };
    }
    return this.db.transaction(async (tx) => {
      const [inst] = await tx
        .select({
          id: processInstances.id,
          variables: processInstances.variables,
          version: processInstances.version,
          status: processInstances.status,
        })
        .from(processInstances)
        .where(and(
          eq(processInstances.id, args.instanceId),
          eq(processInstances.tenantId, args.tenantId),
        ))
        .limit(1);
      if (!inst) throw new NotFoundException("Instance not found.");
      // Forbid edits on terminal instances — the audit story "we changed
      // variables on a completed instance" is a compliance red flag.
      if (inst.status === "completed" || inst.status === "cancelled" || inst.status === "failed") {
        throw new BadRequestException(
          `Cannot edit variables on a ${inst.status} instance. Create a new instance instead.`,
        );
      }
      const current = (inst.variables as Record<string, unknown>) ?? {};
      // BUG-B-03 fix: a `null` patch value DELETES the key (matches the
      // UI copy: "To remove a key, set its value to null"). Previously
      // we shallow-merged, leaving the key with value null — which
      // BPMN expressions treat differently from "unset".
      const merged: Record<string, unknown> = { ...current };
      for (const k of keys) {
        if (args.patch[k] === null) delete merged[k];
        else merged[k] = args.patch[k];
      }
      await this.updateInstanceWithLock(tx, inst.id, inst.version, {
        variables: merged,
      });
      for (const k of keys) {
        const hadKey = Object.prototype.hasOwnProperty.call(current, k);
        const isDelete = args.patch[k] === null;
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          userId: args.userId,
          eventType: "variable-edited",
          payload: {
            key: k,
            // Preserve null-vs-undefined fidelity (BUG-B-06 partial):
            // hadKey=false means "key did not exist", vs value===null
            // means "key was explicitly null".
            hadOldValue: hadKey,
            oldValue: hadKey ? current[k] ?? null : null,
            newValue: args.patch[k] ?? null,
            action: isDelete ? "delete" : "set",
            reason: args.reason.trim(),
            ...(args.actingBy ? { actingBy: args.actingBy } : {}),
          },
        });
      }
      // BUG-B-05 fix: emit outbox so webhook subscribers learn about
      // admin-initiated variable changes — business-critical for SLA
      // dashboards + compliance integrations.
      await this.emitOutbox(tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        eventType: "variable-edited",
        payload: {
          editedKeys: keys,
          editedBy: args.userId,
          reason: args.reason.trim(),
        },
      });
      this.logger.log({
        event: "engine.instance.variables-edited",
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        userId: args.userId,
        keys,
        reason: args.reason.trim(),
      });
      return { instanceId: args.instanceId, editedKeys: keys };
    });
  }

  /** Suspend a running instance. Advance loop refuses to move tokens
   *  while `status='suspended'`; worker poll skips queued jobs for this
   *  instance. Idempotent if already suspended. Industry equivalent:
   *  Camunda `runtime.suspendProcessInstance`. */
  async suspendInstance(args: {
    instanceId: string;
    tenantId: string;
    userId: string;
    actingBy?: string | null;
    reason?: string;
  }): Promise<{ instanceId: string; status: string }> {
    return this.db.transaction(async (tx) => {
      const [inst] = await tx
        .select({
          id: processInstances.id,
          version: processInstances.version,
          status: processInstances.status,
        })
        .from(processInstances)
        .where(and(
          eq(processInstances.id, args.instanceId),
          eq(processInstances.tenantId, args.tenantId),
        ))
        .limit(1);
      if (!inst) throw new NotFoundException("Instance not found.");
      if (inst.status === "suspended") {
        return { instanceId: inst.id, status: "suspended" };
      }
      if (inst.status !== "running") {
        throw new BadRequestException(
          `Cannot suspend a ${inst.status} instance.`,
        );
      }
      await this.updateInstanceWithLock(tx, inst.id, inst.version, {
        status: "suspended",
      });
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        userId: args.userId,
        eventType: "instance-suspended",
        payload: {
          reason: args.reason ?? null,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });
      await this.emitOutbox(tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        eventType: "instance-suspended",
        payload: {
          reason: args.reason ?? null,
          suspendedBy: args.userId,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });
      this.logger.log({
        event: "engine.instance.suspended",
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        userId: args.userId,
        reason: args.reason ?? null,
      });
      return { instanceId: inst.id, status: "suspended" };
    });
  }

  /** Resume a suspended instance back to running. Idempotent if already
   *  running. Tokens that were waiting remain waiting; queued jobs
   *  become eligible again on the next worker tick. */
  async resumeInstance(args: {
    instanceId: string;
    tenantId: string;
    userId: string;
    actingBy?: string | null;
  }): Promise<{ instanceId: string; status: string }> {
    return this.db.transaction(async (tx) => {
      const [inst] = await tx
        .select({
          id: processInstances.id,
          version: processInstances.version,
          status: processInstances.status,
        })
        .from(processInstances)
        .where(and(
          eq(processInstances.id, args.instanceId),
          eq(processInstances.tenantId, args.tenantId),
        ))
        .limit(1);
      if (!inst) throw new NotFoundException("Instance not found.");
      if (inst.status === "running") {
        return { instanceId: inst.id, status: "running" };
      }
      if (inst.status !== "suspended") {
        throw new BadRequestException(
          `Cannot resume a ${inst.status} instance.`,
        );
      }
      await this.updateInstanceWithLock(tx, inst.id, inst.version, {
        status: "running",
      });
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        userId: args.userId,
        eventType: "instance-resumed",
        payload: args.actingBy ? { actingBy: args.actingBy } : {},
      });
      await this.emitOutbox(tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        eventType: "instance-resumed",
        payload: {
          resumedBy: args.userId,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });
      this.logger.log({
        event: "engine.instance.resumed",
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        userId: args.userId,
      });
      return { instanceId: inst.id, status: "running" };
    });
  }

  /** Replay-from-step (Camunda-style instance modification).
   *
   *  Cancel every live token, kill every queued job, and place a fresh
   *  token at `targetNodeId`. Runs the advance loop from there just
   *  like startInstance. Admin-only. Reason is required — this is a
   *  destructive operation and the audit story needs to answer "why did
   *  someone rewind the instance to step X on 2026-04-23?"
   *
   *  Industry equivalent: Camunda's `ProcessInstanceModificationBuilder`
   *  (Cockpit exposes it as right-click → Modify). Our delta: a single
   *  atomic API call (not the N-operation builder) + mandatory reason +
   *  optional variable patch applied in the same txn so the replay
   *  starts with the corrected state.
   *
   *  Safety: rejects on terminal instances (completed/cancelled/failed).
   *  Suspended instances are allowed — replay flips them to running.
   *  Subprocess / multi-instance scopes: not supported in the first
   *  pass — targetNodeId must be a top-level node on the canvas.
   */
  async replayFromStep(args: {
    instanceId: string;
    tenantId: string;
    userId: string;
    actingBy?: string | null;
    targetNodeId: string;
    reason: string;
    variablesPatch?: Record<string, unknown>;
  }): Promise<{
    instanceId: string;
    newTokenId: string;
    cancelledTokens: number;
    cancelledJobs: number;
    status: "running" | "completed" | "failed";
  }> {
    if (!args.reason || args.reason.trim().length < 3) {
      throw new BadRequestException(
        "A reason (min 3 chars) is required to replay from a step.",
      );
    }
    if (!args.targetNodeId) {
      throw new BadRequestException("targetNodeId is required.");
    }

    return this.db.transaction(async (tx) => {
      const [inst] = await tx
        .select({
          id: processInstances.id,
          status: processInstances.status,
          version: processInstances.version,
          variables: processInstances.variables,
          processId: processInstances.processId,
          processVersionId: processInstances.processVersionId,
          definitionSnapshot: processInstances.definitionSnapshot,
        })
        .from(processInstances)
        .where(and(
          eq(processInstances.id, args.instanceId),
          eq(processInstances.tenantId, args.tenantId),
        ))
        .limit(1);
      if (!inst) throw new NotFoundException("Instance not found.");
      if (inst.status === "completed" || inst.status === "cancelled" || inst.status === "failed") {
        throw new BadRequestException(
          `Cannot replay a ${inst.status} instance. Start a fresh instance instead.`,
        );
      }

      // Validate target node against the versioned canvas. If the
      // caller asks to replay into a node that doesn't exist in the
      // snapshot the instance is running against, fail fast rather
      // than advancing into a node the engine can't execute.
      const canvas = await this.loadCanvasForInstance(tx, inst);
      const targetNode = canvas.nodes.find((n) => n.id === args.targetNodeId);
      if (!targetNode) {
        throw new BadRequestException(
          `Target node "${args.targetNodeId}" not found on this instance's canvas.`,
        );
      }
      // Reject target-node types the engine doesn't know how to enter
      // via a bare token placement. Subprocess children need scope
      // setup; boundary events require a host activity; end events
      // would terminate immediately (unintended). Reviewer-flagged
      // failure modes that previously silently misbehaved.
      const targetData = targetNode as unknown as {
        type?: string;
        parentId?: string | null;
        data?: Record<string, unknown>;
      };
      if (targetData.parentId) {
        throw new BadRequestException(
          `Target node "${args.targetNodeId}" is inside a subprocess — subprocess-scoped replay is not supported. Replay into a top-level node.`,
        );
      }
      const unsafeTypes = new Set([
        "boundaryEvent",
        "subProcess",
        "callActivity",
        "endEvent",
        "intermediateCatchEvent",
        "intermediateThrowEvent",
      ]);
      if (targetData.type && unsafeTypes.has(targetData.type)) {
        throw new BadRequestException(
          `Target node type "${targetData.type}" is not supported for replay. Use a start event, user task, service task, or gateway.`,
        );
      }

      // Snapshot pre-replay state for the audit payload.
      const liveTokens = await tx
        .select({
          id: instanceTokens.id,
          version: instanceTokens.version,
          currentNodeId: instanceTokens.currentNodeId,
          status: instanceTokens.status,
        })
        .from(instanceTokens)
        .where(and(
          eq(instanceTokens.instanceId, args.instanceId),
          inArray(instanceTokens.status, ["active", "waiting"]),
        ));

      // Cancel every live token. We use the same "failed with reason"
      // pattern cancelInstance uses — each token gets a terminal status
      // and an error audit row so the trail shows "token T was alive
      // doing X, was cut off by replay, and a new token was born at Y".
      // Cancel every live token. A concurrent completer racing us is
      // now a hard failure — the whole replay txn aborts and the
      // caller retries. Previously we swallowed the optimistic-lock
      // error which could leave live tokens behind co-existing with
      // the replay token. (Reviewer bug C-03.)
      let cancelledTokens = 0;
      for (const tok of liveTokens) {
        await this.updateTokenWithLock(tx, tok.id, tok.version, {
          status: "failed",
          errorMessage: "Superseded by replay-from-step.",
        });
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          tokenId: tok.id,
          userId: args.userId,
          nodeId: tok.currentNodeId,
          eventType: "error",
          payload: { reason: "superseded-by-replay" },
        });
        cancelledTokens += 1;
      }

      // P2 Session 4 — kill all scheduled timers on this instance.
      // Replay supersedes every live token, and stale timers would
      // fire on now-dead tokens.
      if (this.timerScheduler) {
        await this.timerScheduler.cancelTimersForInstance(args.instanceId, tx);
      }
      // P3 Session 7 — same for message subscriptions. Replay rewrites
      // the active token set; any old subscription row would resume a
      // token that no longer exists.
      if (this.messageSubscriptions) {
        await this.messageSubscriptions.cancelForInstance(args.instanceId, tx);
      }

      // Kill queued jobs on this instance — they would otherwise resume
      // the very token we just cancelled.
      const deadJobs = await tx
        .update(engineJobs)
        .set({
          status: "dead",
          lastError: "Superseded by replay-from-step.",
          updatedAt: new Date(),
        })
        .where(and(
          eq(engineJobs.tenantId, args.tenantId),
          eq(engineJobs.instanceId, args.instanceId),
          inArray(engineJobs.status, ["queued", "running"]),
        ))
        .returning({ id: engineJobs.id });

      // Apply the optional variable patch inline so the new token
      // advances with the corrected state. Intentionally shallow-merge
      // (matching editInstanceVariables semantics with null-deletes).
      const baseVars = (inst.variables as Record<string, unknown> | null) ?? {};
      const mergedVars: Record<string, unknown> = { ...baseVars };
      const patch = args.variablesPatch ?? {};
      const patchKeys = Object.keys(patch);
      for (const k of patchKeys) {
        if (patch[k] === null) delete mergedVars[k];
        else mergedVars[k] = patch[k];
      }
      // Flip instance back to running (catches suspended → running) +
      // persist the new variable bag.
      await this.updateInstanceWithLock(tx, inst.id, inst.version, {
        status: "running",
        variables: mergedVars,
        errorMessage: null,
      });

      // Instance-modified audit row BEFORE the new token is placed so
      // the trail reads: "modified → token-created at Y → advancing".
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        userId: args.userId,
        nodeId: args.targetNodeId,
        eventType: "instance-modified",
        payload: {
          action: "replay",
          targetNodeId: args.targetNodeId,
          cancelledTokens: liveTokens.map((t) => ({ id: t.id, wasAt: t.currentNodeId })),
          cancelledJobs: deadJobs.length,
          patchKeys,
          reason: args.reason.trim(),
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });
      await this.emitOutbox(tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        eventType: "instance-modified",
        payload: {
          action: "replay",
          targetNodeId: args.targetNodeId,
          reason: args.reason.trim(),
          modifiedBy: args.userId,
          ...(args.actingBy ? { actingBy: args.actingBy } : {}),
        },
      });

      // Place the new token and advance.
      const [token] = await tx
        .insert(instanceTokens)
        .values({
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          currentNodeId: args.targetNodeId,
          status: "active",
        })
        .returning({ id: instanceTokens.id, version: instanceTokens.version });
      await recordEvent(tx, {
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: token.id,
        nodeId: args.targetNodeId,
        eventType: "token-created",
        payload: { source: "replay" },
      });

      const advance = await this.advanceToken({
        tx,
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        tokenId: token.id,
        tokenVersion: token.version,
        currentNodeId: args.targetNodeId,
        canvas,
        variables: mergedVars,
      });

      // Map terminal results to instance status — mirrors startInstance.
      // BUG-C-01 fix: outbox emits for terminal transitions triggered
      // by replay were missing; subscribers never learned when a
      // replayed instance completed or failed. Now parity with the
      // startInstance lifecycle.
      //
      // P1 — guard `completed` on a live-token count of zero. Note that
      // replay-from-step semantics with active parallel siblings are
      // undefined for now: starting a replay on a multi-token instance
      // races against the existing tokens. Tracked as a TODO; surfaced
      // here so a future polish session addresses it.
      let instanceStatus: "running" | "completed" | "failed" = "running";
      if (advance.tokenStatus === "completed" && (await this.countLiveTokens(tx, args.instanceId)) === 0) {
        await tx
          .update(processInstances)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(processInstances.id, args.instanceId));
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          eventType: "instance-completed",
          payload: { hops: advance.hops, via: "replay" },
        });
        await this.emitOutbox(tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          eventType: "instance-completed",
          payload: { hops: advance.hops, via: "replay", variables: mergedVars },
          redactedKeys: canvas.engineConfig?.redactedVariableKeys,
        });
        instanceStatus = "completed";
      } else if (advance.tokenStatus === "failed") {
        await tx
          .update(processInstances)
          .set({ status: "failed", errorMessage: advance.errorMessage ?? null, completedAt: new Date() })
          .where(eq(processInstances.id, args.instanceId));
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          eventType: "instance-failed",
          payload: { hops: advance.hops, message: advance.errorMessage, via: "replay" },
        });
        await this.emitOutbox(tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          eventType: "instance-failed",
          payload: { hops: advance.hops, message: advance.errorMessage, via: "replay" },
        });
        instanceStatus = "failed";
      } else if (inst.status === "suspended") {
        // Replay flipped a suspended instance to running — emit the
        // resumed lifecycle event so subscribers don't stay stale.
        await recordEvent(tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          userId: args.userId,
          eventType: "instance-resumed",
          payload: { via: "replay" },
        });
        await this.emitOutbox(tx, {
          tenantId: args.tenantId,
          instanceId: args.instanceId,
          eventType: "instance-resumed",
          payload: { via: "replay", resumedBy: args.userId },
        });
      }

      this.logger.log({
        event: "engine.instance.replayed",
        tenantId: args.tenantId,
        instanceId: args.instanceId,
        userId: args.userId,
        targetNodeId: args.targetNodeId,
        cancelledTokens,
        cancelledJobs: deadJobs.length,
        reason: args.reason.trim(),
      });

      return {
        instanceId: args.instanceId,
        newTokenId: token.id,
        cancelledTokens,
        cancelledJobs: deadJobs.length,
        status: instanceStatus,
      };
    });
  }

  /** Write a row to OUTBOX_EVENTS in the current txn. Called by every
   *  engine lifecycle transition that's interesting to external
   *  subscribers (instance-started/completed/failed/cancelled,
   *  task-completed). The OutboxService dispatcher tick reads
   *  `pending` rows and enqueues per-subscription delivery jobs.
   *
   *  Transactional with the audit row above the call site, so a
   *  rollback discards both — no half-emitted events.
   *
   *  PII safety: if the payload includes a `variables` object and the
   *  caller passes `redactedKeys`, listed keys are replaced with
   *  "<redacted>" before the row is written. Without this, the audit
   *  trail is sanitised but webhook receivers still get raw values. */
  private async emitOutbox(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    args: {
      tenantId: string;
      processId?: string;
      instanceId?: string;
      eventType: string;
      payload: Record<string, unknown>;
      redactedKeys?: ReadonlyArray<string> | Set<string>;
    },
  ): Promise<void> {
    let payload = args.payload;
    if (args.redactedKeys && payload && typeof payload === "object") {
      const keys =
        args.redactedKeys instanceof Set
          ? args.redactedKeys
          : new Set(args.redactedKeys);
      // Only the top-level `variables` field is treated as the
      // PII-bearing surface. Other payload fields are engine-emitted
      // metadata (hops, message, edge id) and don't carry user data.
      const vars = payload.variables;
      if (vars && typeof vars === "object" && !Array.isArray(vars)) {
        const redacted: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(vars)) {
          redacted[k] = keys.has(k) ? "<redacted>" : v;
        }
        payload = { ...payload, variables: redacted };
      }
    }
    await tx.insert(outboxEvents).values({
      tenantId: args.tenantId,
      processId: args.processId ?? null,
      instanceId: args.instanceId ?? null,
      eventType: args.eventType,
      payload,
    });
  }

  /** Idempotent get-or-create on PROCESS_VERSIONS keyed by
   *  (processId, hash). Two concurrent startInstance calls for the
   *  same process race; the unique constraint resolves the race.
   *  We do not run this inside the calling txn — the (likely)
   *  failed-insert + retry would bloat the txn's write set, and the
   *  read-after-failure needs to see the winner's commit anyway. */
  private async getOrCreateProcessVersion(args: {
    processId: string;
    tenantId: string;
    userId: string;
    hash: string;
    /** FULL raw canvas including UI fields (React Flow positions,
     *  viewport, etc). The hash is computed by the caller from the
     *  engine's PROJECTED view of this canvas; storage keeps the
     *  full thing so the designer can render after re-load and the
     *  D1 export pipeline doesn't lose layout. BUG-D1-01. */
    canvas: Record<string, unknown>;
  }): Promise<string> {
    const existing = await this.db
      .select({ id: processVersions.id })
      .from(processVersions)
      .where(
        and(
          eq(processVersions.processId, args.processId),
          eq(processVersions.hash, args.hash),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0].id;

    // Compute the next monotonic version number for this process.
    // A small race here means two concurrent inserts could compute
    // the same N; the (processId, hash) unique index still protects
    // dedup correctness, and the version number is best-effort
    // metadata (the hash is the canonical identity).
    const maxRow = await this.db
      .select({ v: processVersions.version })
      .from(processVersions)
      .where(eq(processVersions.processId, args.processId))
      .orderBy(desc(processVersions.version))
      .limit(1);
    const nextVersion = (maxRow[0]?.v ?? 0) + 1;

    try {
      const [row] = await this.db
        .insert(processVersions)
        .values({
          tenantId: args.tenantId,
          processId: args.processId,
          hash: args.hash,
          canvasData: args.canvas as unknown as Record<string, unknown>,
          version: nextVersion,
          publishedBy: args.userId,
        })
        .returning({ id: processVersions.id });
      return row.id;
    } catch (err) {
      // Unique-constraint race: a concurrent inserter beat us. Re-read.
      const refetch = await this.db
        .select({ id: processVersions.id })
        .from(processVersions)
        .where(
          and(
            eq(processVersions.processId, args.processId),
            eq(processVersions.hash, args.hash),
          ),
        )
        .limit(1);
      if (refetch[0]) return refetch[0].id;
      throw err;
    }
  }

  /** GAP-05 — Publish lifecycle. Marks a process ACTIVE so non-test
   *  starts are allowed, and snapshots the current canvas into
   *  PROCESS_VERSIONS for version pinning. Idempotent: republishing
   *  with an unchanged canvas reuses the existing snapshot row.
   *  Republishing after edits creates a new row and the latest
   *  numbered version becomes the active one. */
  async publishProcess(args: {
    processId: string;
    tenantId: string;
    userId: string;
  }): Promise<{
    processId: string;
    status: "ACTIVE";
    versionId: string;
    versionNumber: number;
    /** True when this publish reused an existing snapshot (no canvas
     *  changes since the last publish). Useful for the UI to render
     *  "no changes — already up to date" rather than a "v3 published"
     *  toast. */
    reused: boolean;
  }> {
    const proc = await this.loadProcessForInstance(
      args.processId,
      args.tenantId,
    );
    const canvas = projectCanvas(proc.canvasData);
    // Validate fail-loud: a process with no start event is not
    // shippable. Engine would error at startInstance anyway, but
    // catching it at publish saves operators from a confusing
    // post-publish failure.
    findStartEvent(canvas);

    const snapshot = canonicalise(canvas);
    const definitionHash = sha256Hex(JSON.stringify(snapshot));

    // Detect reuse before insert: lookup existing (processId, hash).
    const existing = await this.db
      .select({ id: processVersions.id, version: processVersions.version })
      .from(processVersions)
      .where(
        and(
          eq(processVersions.processId, args.processId),
          eq(processVersions.hash, definitionHash),
        ),
      )
      .limit(1);
    const reused = !!existing[0];

    const versionId = await this.getOrCreateProcessVersion({
      processId: args.processId,
      tenantId: args.tenantId,
      userId: args.userId,
      hash: definitionHash,
      // Store the FULL raw canvas including positions/UI fields so
      // export/import round-trips preserve designer layout. The
      // hash above was computed from the canonicalised PROJECTED
      // view so engine-semantic dedup still works. BUG-D1-01.
      canvas: proc.canvasData as Record<string, unknown>,
    });
    const [versionRow] = await this.db
      .select({ version: processVersions.version })
      .from(processVersions)
      .where(eq(processVersions.id, versionId))
      .limit(1);

    await this.db
      .update(processes)
      .set({ status: "ACTIVE", updatedAt: new Date() })
      .where(
        and(
          eq(processes.id, args.processId),
          eq(processes.tenantId, args.tenantId),
        ),
      );

    return {
      processId: args.processId,
      status: "ACTIVE",
      versionId,
      versionNumber: versionRow?.version ?? 1,
      reused,
    };
  }

  /** D1.0 — export a process as a portable .flowpro.json bundle.
   *  Returns the latest published PROCESS_VERSIONS snapshot — NOT
   *  the live canvas. Unpublished processes can't be exported; the
   *  caller must publish first.
   *
   *  Format gate: `format: "flowpro/v1"`. Future v2 imports will
   *  read this to drive a migration if the schema changes.
   *
   *  Permissions: any tenant member who can read the process.
   *  Stricter scoping (export-only API tokens) lands with the
   *  API_TOKENS auth path. */
  async exportProcess(args: {
    processId: string;
    tenantId: string;
  }): Promise<ProcessExportBundle> {
    // 1. Process row (tenant-scoped).
    const [proc] = await this.db
      .select({
        id: processes.id,
        slug: processes.slug,
        name: processes.name,
        description: processes.description,
        status: processes.status,
      })
      .from(processes)
      .where(
        and(
          eq(processes.id, args.processId),
          eq(processes.tenantId, args.tenantId),
        ),
      )
      .limit(1);
    if (!proc) throw new NotFoundException("Process not found.");

    // Refuse export of unpublished processes. PROCESS_VERSIONS rows
    // are auto-populated on every startInstance call (even test
    // runs on drafts) for forensic/dedup reasons, so "has any
    // version" is NOT a proxy for "has been published". The
    // PROCESSES.status = ACTIVE flag is the only authoritative
    // "this canvas was explicitly promoted to live" signal — gate
    // on it so test-run snapshots can't accidentally be exported as
    // production-grade bundles.
    if (proc.status !== "ACTIVE") {
      throw new BadRequestException(
        "Process is not published. Publish it before exporting.",
      );
    }

    // 2. Latest published version — the snapshot that the publish
    //    flow attached to PROCESSES.status=ACTIVE.
    const [latestVersion] = await this.db
      .select({
        id: processVersions.id,
        hash: processVersions.hash,
        canvasData: processVersions.canvasData,
        version: processVersions.version,
      })
      .from(processVersions)
      .where(eq(processVersions.processId, args.processId))
      .orderBy(desc(processVersions.version))
      .limit(1);
    if (!latestVersion) {
      // Defensive — status=ACTIVE without a PROCESS_VERSIONS row
      // shouldn't be possible (publish always creates one), but
      // refuse rather than emit an empty bundle if the invariant
      // ever breaks.
      throw new BadRequestException(
        "Process is published but has no version snapshot — engine state inconsistent.",
      );
    }

    // 3. Business document schema (optional — older processes may
    //    not have one). schemaOverride holds the per-process schema;
    //    re-export uses it directly so the destination doesn't need
    //    to look up a shared template.
    const [doc] = await this.db
      .select({ schemaOverride: processDocuments.schemaOverride })
      .from(processDocuments)
      .where(eq(processDocuments.processId, args.processId))
      .limit(1);

    // 4. Source tenant identity. Future "tenantSlug" lives on
    //    TENANTS as a separate D1.x feature; for now expose the id
    //    so the operator can correlate.
    const [tenant] = await this.db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, args.tenantId))
      .limit(1);

    return {
      format: "flowpro/v1",
      exportedAt: new Date().toISOString(),
      exportedFrom: {
        tenantId: tenant?.id ?? args.tenantId,
        tenantName: tenant?.name ?? null,
      },
      process: {
        slug: proc.slug,
        name: proc.name,
        description: proc.description,
        version: latestVersion.version ?? 1,
        hash: latestVersion.hash,
        canvas: latestVersion.canvasData as Record<string, unknown>,
        businessDoc:
          (doc?.schemaOverride as Record<string, unknown> | undefined) ?? null,
      },
      // envBindings analysis — placeholder list inferred from canvas
      // ${env.X} references. Static-empty for D1.0; D1.1 wires the
      // canvas walker that surfaces required keys to operators.
      envBindings: {},
      metadata: {
        // PII stripped from the export — publishedBy/publishedAt
        // are env-local and would leak source-env user identity.
        publishedBy: null,
        publishedAt: null,
      },
    };
  }

  /** D1.0 — import a process bundle into this environment. Creates
   *  or updates the PROCESSES row by slug, validates that every
   *  role-key referenced in the canvas exists in the destination
   *  tenant, then snapshots the canvas as a new PROCESS_VERSIONS
   *  row with IMPORTED_FROM provenance set.
   *
   *  Slug-collision policy: REFUSE. If the destination already has
   *  the slug at an equal-or-higher version (with a different
   *  hash), reject with HTTP 400 — operator must reconcile
   *  manually. Same-hash dedupes and returns the existing row.
   *
   *  Does NOT auto-publish. Imported processes land as DRAFT (or
   *  retain their existing status); operator publishes separately.
   *  This preserves the GAP-05 contract that publish is an
   *  explicit decision.
   *
   *  Permissions: any tenant member with JWT today; future
   *  process:write API token scope when that auth path lands. */
  async importProcess(args: {
    bundle: ProcessExportBundle;
    tenantId: string;
    userId: string;
  }): Promise<{
    processId: string;
    slug: string;
    versionId: string;
    versionNumber: number;
    /** True when the bundle's hash matched an existing
     *  PROCESS_VERSIONS row — no new snapshot was written. */
    reused: boolean;
    /** True when this is the first time the slug appeared on this
     *  destination — i.e., a fresh PROCESSES row was created
     *  rather than updating an existing one. */
    created: boolean;
  }> {
    const { bundle } = args;

    // 1. Validate role-keys referenced in the canvas exist on the
    //    destination tenant. We refuse silently-creating roles —
    //    a typo in source would otherwise auto-grant unintended
    //    permissions in the destination.
    const requiredRoleKeys = extractRoleKeysFromCanvas(bundle.process.canvas);
    if (requiredRoleKeys.size > 0) {
      const found = await this.db
        .select({ key: roles.key })
        .from(roles)
        .where(
          and(
            eq(roles.tenantId, args.tenantId),
            inArray(roles.key, Array.from(requiredRoleKeys)),
          ),
        );
      const foundKeys = new Set(found.map((r) => r.key));
      const missing = Array.from(requiredRoleKeys).filter(
        (k) => !foundKeys.has(k),
      );
      if (missing.length > 0) {
        throw new BadRequestException(
          `Import refused: destination tenant is missing required role(s): ${missing.join(", ")}. Provision the role(s) and retry.`,
        );
      }
    }

    // 2. Find or create the destination process by slug.
    const [existingProc] = await this.db
      .select({
        id: processes.id,
        slug: processes.slug,
      })
      .from(processes)
      .where(
        and(
          eq(processes.tenantId, args.tenantId),
          eq(processes.slug, bundle.process.slug),
        ),
      )
      .limit(1);

    let processId: string;
    let created = false;
    if (existingProc) {
      processId = existingProc.id;
    } else {
      const [newProc] = await this.db
        .insert(processes)
        .values({
          tenantId: args.tenantId,
          createdBy: args.userId,
          name: bundle.process.name,
          description: bundle.process.description ?? null,
          slug: bundle.process.slug,
          canvasData: bundle.process.canvas,
          status: "DRAFT",
          step: "CANVAS",
        })
        .returning({ id: processes.id });
      processId = newProc.id;
      created = true;
    }

    // 3. Slug-collision policy on existing process: refuse if the
    //    destination already has a higher-or-equal-numbered version
    //    with a DIFFERENT hash. Same hash = idempotent dedupe.
    if (!created) {
      const [destLatest] = await this.db
        .select({
          id: processVersions.id,
          version: processVersions.version,
          hash: processVersions.hash,
        })
        .from(processVersions)
        .where(eq(processVersions.processId, processId))
        .orderBy(desc(processVersions.version))
        .limit(1);

      if (destLatest && destLatest.hash === bundle.process.hash) {
        // Idempotent: bundle already imported (or independently
        // produced the same canvas). Return the existing row.
        return {
          processId,
          slug: bundle.process.slug,
          versionId: destLatest.id,
          versionNumber: destLatest.version ?? 1,
          reused: true,
          created: false,
        };
      }

      if (
        destLatest &&
        (destLatest.version ?? 0) >= bundle.process.version &&
        destLatest.hash !== bundle.process.hash
      ) {
        throw new BadRequestException(
          `Import refused: destination already has slug "${bundle.process.slug}" at version ${destLatest.version} (different content). Source bundle is v${bundle.process.version}. Reconcile manually before retrying.`,
        );
      }
    }

    // 4. Compute next version number for destination.
    const [maxRow] = await this.db
      .select({ v: processVersions.version })
      .from(processVersions)
      .where(eq(processVersions.processId, processId))
      .orderBy(desc(processVersions.version))
      .limit(1);
    const nextVersion = (maxRow?.v ?? 0) + 1;

    // 5. Insert the new version with provenance.
    const importedFrom = {
      sourceTenantId: bundle.exportedFrom.tenantId,
      sourceTenantName: bundle.exportedFrom.tenantName,
      sourceVersion: bundle.process.version,
      sourceHash: bundle.process.hash,
      importedAt: new Date().toISOString(),
    };
    const [versionRow] = await this.db
      .insert(processVersions)
      .values({
        tenantId: args.tenantId,
        processId,
        hash: bundle.process.hash,
        canvasData: bundle.process.canvas,
        version: nextVersion,
        publishedBy: args.userId,
        importedFrom,
      })
      .returning({ id: processVersions.id });

    // 6. Update the PROCESSES row's live canvasData so the designer
    //    shows the imported snapshot. Updating an existing row also
    //    refreshes name/description from the bundle. Also advance
    //    the wizard step so an imported process opens directly on
    //    the canvas rather than re-running the Details/Document
    //    wizard. BUG-D1-02.
    if (!created) {
      await this.db
        .update(processes)
        .set({
          name: bundle.process.name,
          description: bundle.process.description ?? null,
          canvasData: bundle.process.canvas,
          step: "CANVAS",
          updatedAt: new Date(),
        })
        .where(eq(processes.id, processId));
    }

    // 7. Restore businessDoc into PROCESS_DOCUMENTS if the bundle
    //    carries one. The schemaOverride column is the per-process
    //    schema; we mark source=PASTE since it came from another env
    //    rather than a local template. BUG-D1-03.
    if (bundle.process.businessDoc) {
      const [existingDoc] = await this.db
        .select({ id: processDocuments.id })
        .from(processDocuments)
        .where(eq(processDocuments.processId, processId))
        .limit(1);
      if (existingDoc) {
        await this.db
          .update(processDocuments)
          .set({
            schemaOverride: bundle.process.businessDoc,
            source: "PASTE",
            updatedAt: new Date(),
          })
          .where(eq(processDocuments.id, existingDoc.id));
      } else {
        await this.db.insert(processDocuments).values({
          processId,
          schemaOverride: bundle.process.businessDoc,
          source: "PASTE",
        });
      }
    }

    return {
      processId,
      slug: bundle.process.slug,
      versionId: versionRow.id,
      versionNumber: nextVersion,
      reused: false,
      created,
    };
  }

  /** Resolve the canvas to execute against for an instance. New
   *  instances reference PROCESS_VERSIONS via processVersionId;
   *  legacy rows (pre-E4.5b) still carry the snapshot inline.
   *  Either path returns the same EngineCanvas projection. */
  private async loadCanvasForInstance(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    instance: { processVersionId: string | null; definitionSnapshot: unknown },
  ): Promise<EngineCanvas> {
    if (instance.processVersionId) {
      const rows = await tx
        .select({ canvasData: processVersions.canvasData })
        .from(processVersions)
        .where(eq(processVersions.id, instance.processVersionId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new NotFoundException(
          `Process version ${instance.processVersionId} not found.`,
        );
      }
      return projectCanvas(row.canvasData);
    }
    if (instance.definitionSnapshot) {
      return projectCanvas(instance.definitionSnapshot);
    }
    throw new BadRequestException(
      "Instance has no canvas reference (neither version nor inline snapshot).",
    );
  }

  /** Load a process row scoped to the tenant, validating that it has
   *  a non-empty canvas. We refuse to start an instance of a draft
   *  whose author hasn't drawn anything yet — an empty canvas would
   *  fail at "find start event" with a less actionable message. */
  private async loadProcessForInstance(
    processId: string,
    tenantId: string,
  ): Promise<{ canvasData: unknown; status: string }> {
    const rows = await this.db
      .select({
        canvasData: processes.canvasData,
        status: processes.status,
      })
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
  // Preserve engineConfig if present + well-shaped. We only read
  // `redactedVariableKeys` today (E4.5c) — everything else is dropped.
  let engineConfig: EngineCanvas["engineConfig"];
  const ec = (obj.engineConfig as Record<string, unknown> | undefined);
  if (ec && typeof ec === "object") {
    const raw = ec.redactedVariableKeys;
    if (Array.isArray(raw)) {
      const keys = raw.filter((k): k is string => typeof k === "string");
      if (keys.length > 0) engineConfig = { redactedVariableKeys: keys };
    }
  }

  return { nodes, edges, ...(engineConfig ? { engineConfig } : {}) };
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
  // Preserve `engineConfig` through the snapshot pipeline. Earlier
  // versions stripped it, which silently broke PII redaction: the
  // engine wrote the canvas to PROCESS_VERSIONS without engineConfig,
  // then `loadCanvasForInstance` read it back empty, and every
  // `redactedKeys.has(key)` check returned false. Bug found by E4.5
  // QA — keep this preservation.
  return {
    nodes: [...canvas.nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => ({ ...n, data: n.data ? sortKeysDeep(n.data) : undefined })),
    edges: [...canvas.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => ({ ...e, data: e.data ? sortKeysDeep(e.data) : undefined })),
    ...(canvas.engineConfig
      ? { engineConfig: sortKeysDeep(canvas.engineConfig) }
      : {}),
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

/** Resolve a serviceTask node's user-defined topic for the worker
 *  registry. Two strategies are wired today:
 *    • `externalWorker` — `data.implementation = { type: "externalWorker",
 *                          config: { jobType: "<topic>" } }`. The user's
 *                          job type IS the worker topic.
 *    • `rest` (I2) —      `data.implementation = { type: "rest",
 *                          config: <RestConfig> }`. Mapped to the
 *                          synthetic topic `__rest__`; the built-in
 *                          REST handler reads the config out of
 *                          `nodeData.implementation.config` at run
 *                          time. See `restHandler` in
 *                          `service-task-registry.ts`.
 *
 *  Other strategies (connector, soap, wasmModule, inlineScript) still
 *  fall through to `noop` with a warn log — the designer surfaces a
 *  banner (GAP-T2-C) so authors know the no-op is happening, but we
 *  keep the dispatch defensive in case a process is migrated through
 *  here with one of those types persisted.
 *
 *  Keep the supported set IN SYNC with
 *  `web/src/lib/bpmn/capabilities.ts::EXECUTABLE_SERVICE_TASK_IMPL_TYPES`
 *  — the designer reads that set to enable/disable the impl-type
 *  picker cards. */
export function resolveServiceTaskTopic(
  node: EngineNode,
  logger?: { warn?: (msg: string) => void },
): string {
  const data = node.data as Record<string, unknown> | undefined;
  const impl = data?.implementation as
    | { type?: unknown; config?: Record<string, unknown> }
    | undefined;
  if (!impl || typeof impl !== "object") {
    logger?.warn?.(
      `Service task ${node.id}: no implementation configured; using "noop".`,
    );
    return "noop";
  }
  if (impl.type === "rest") {
    // I4 Sprint 3: type=rest is now a legacy alias for the REST
    // connector. The dispatcher detects it and synthesises the
    // connector shape on the fly so already-published canvases run
    // unchanged. The dedicated __rest__ topic + restHandler are
    // retired.
    return CONNECTOR_TOPIC;
  }
  if (impl.type === "connector") {
    // I4 — Connector framework. ConnectorDispatcherService validates
    // connector/operation/connection inside its handler so malformed
    // configs surface as a clear error in the worker retry loop, not
    // a silent noop.
    return CONNECTOR_TOPIC;
  }
  if (impl.type !== "externalWorker") {
    logger?.warn?.(
      `Service task ${node.id}: implementation type "${String(impl.type)}" not yet executable; using "noop".`,
    );
    return "noop";
  }
  const cfg = impl.config ?? {};
  const topic = (cfg as { jobType?: unknown }).jobType;
  if (typeof topic !== "string" || topic.trim() === "") {
    logger?.warn?.(
      `Service task ${node.id}: externalWorker.jobType missing; using "noop".`,
    );
    return "noop";
  }
  return topic;
}

/** Resolve `data.resilience.retry.count` if the canvas declares one;
 *  otherwise null and the engine uses the WorkerService default. */
export function resolveServiceTaskMaxAttempts(node: EngineNode): number | null {
  const data = node.data as Record<string, unknown> | undefined;
  const res = data?.resilience as { retry?: { count?: unknown } } | undefined;
  const count = res?.retry?.count;
  if (typeof count === "number" && count > 0 && Number.isInteger(count)) {
    return count;
  }
  return null;
}

/** P0 — resolve a userTask node's `data.scheduling` to a concrete
 *  due timestamp + numeric priority for the TASK row. Supports static
 *  values only in P0: ISO 8601 datetime (`2026-05-21T10:00:00Z`) or
 *  ISO 8601 duration relative to `now` (`PT2H`, `P1D`). FEEL expression
 *  evaluation against the instance variable bag lands in P2 alongside
 *  the timer scheduler. */
const ISO_DURATION_RE =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

function parseIsoDurationMs(s: string): number | null {
  const m = ISO_DURATION_RE.exec(s.trim());
  if (!m || s.trim() === "P" || s.trim() === "PT") return null;
  const [, y, mo, w, d, h, mi, se] = m;
  const days =
    (Number(y || 0) * 365) +
    (Number(mo || 0) * 30) +
    (Number(w || 0) * 7) +
    Number(d || 0);
  const ms =
    days * 86_400_000 +
    Number(h || 0) * 3_600_000 +
    Number(mi || 0) * 60_000 +
    Number(se || 0) * 1000;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** P2 Session 6a — parse a timer event-definition's value into a
 *  concrete fire-at Date. Supports BPMN's three timerType variants
 *  (date, duration, cycle); for Session 6a the engine only fires once
 *  per subscription, so cycle is parsed to the FIRST iteration only.
 *  Returns null when the value is empty or unparseable. */
export function resolveTimerFireAt(
  def: { value?: string; timerType?: string } | undefined,
  now: Date = new Date(),
): Date | null {
  if (!def || typeof def.value !== "string" || def.value.trim().length === 0) return null;
  const raw = def.value.trim();
  // ISO 8601 date: "2026-12-01T09:00:00Z"
  if (def.timerType === "date" || (!def.timerType && !raw.startsWith("P") && !raw.startsWith("R"))) {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : new Date(t);
  }
  // ISO 8601 cycle "R<n>/P..." — first iteration only.
  if (def.timerType === "cycle" || raw.startsWith("R")) {
    const match = /^R\d*\/(P.+)$/.exec(raw);
    const durStr = match?.[1];
    if (!durStr) return null;
    const ms = parseIsoDurationMs(durStr);
    return ms !== null ? new Date(now.getTime() + ms) : null;
  }
  // ISO 8601 duration: "PT2H", "P1D"
  if (raw.startsWith("P")) {
    const ms = parseIsoDurationMs(raw);
    return ms !== null ? new Date(now.getTime() + ms) : null;
  }
  return null;
}

export function resolveTaskScheduling(
  node: EngineNode,
  now: Date = new Date(),
): { dueAt: Date | null; priority: number | null } {
  const data = node.data as Record<string, unknown> | undefined;
  const s = data?.scheduling as
    | {
        dueDate?: unknown;
        dueDateIsExpression?: unknown;
        priority?: unknown;
        priorityExpression?: unknown;
      }
    | undefined;
  if (!s) return { dueAt: null, priority: null };
  let dueAt: Date | null = null;
  if (typeof s.dueDate === "string" && s.dueDate.trim().length > 0 && !s.dueDateIsExpression) {
    const raw = s.dueDate.trim();
    if (raw.startsWith("P")) {
      const ms = parseIsoDurationMs(raw);
      if (ms !== null) dueAt = new Date(now.getTime() + ms);
    } else {
      const t = Date.parse(raw);
      if (!Number.isNaN(t)) dueAt = new Date(t);
    }
  }
  const priority =
    typeof s.priority === "number" && Number.isFinite(s.priority) && !s.priorityExpression
      ? Math.trunc(s.priority)
      : null;
  return { dueAt, priority };
}

/** Resolve a userTask node's `data.assignment` to either a concrete
 *  userId (write to `assignedTo`) or a role key (write to
 *  `candidateRole` and leave `assignedTo` null so a role-member must
 *  claim first).
 *
 *  Strategies:
 *   - `directUser`  → value is a literal user UUID → assignedTo
 *   - `expression`  → value is `${varName}` (or contains `${...}`);
 *                     we resolve against the instance variables to a UUID
 *   - `role`        → value is a role KEY (e.g. `manager`);
 *                     assignee stays null (claim-first)
 *
 *  Returns `{ assignee, candidateRole?, diagnostic? }`. `diagnostic`,
 *  when present, names a specific failure mode
 *  (`"unresolved-expression"`, `"not-a-uuid"`, `"empty-role-key"`,
 *  etc.) so the caller can emit a `variable-unresolved` audit event —
 *  silent misses become visible in the instance audit trail.
 *
 *  We never write garbage into assignedTo because the FK constraint
 *  would 500 the request — better to leave it null and let the
 *  operator re-route. */
export function resolveDirectUserAssignee(
  node: EngineNode,
  variables: Record<string, unknown> = {},
  logger?: { warn?: (msg: string) => void },
): {
  assignee: string | null;
  candidateRole?: string | null;
  diagnostic?: {
    reason: string;
    expression?: string;
    assignmentType?: string;
  };
} {
  const data = node.data as Record<string, unknown> | undefined;
  const assignment = data?.assignment as
    | { type?: unknown; value?: unknown }
    | undefined;
  if (!assignment || typeof assignment !== "object") return { assignee: null };
  const type = assignment.type;
  const value = assignment.value;

  if (type === "directUser") {
    if (typeof value !== "string" || !UUID_RE.test(value)) {
      logger?.warn?.(
        `User task ${node.id}: directUser assignment value is not a UUID; leaving unassigned.`,
      );
      return {
        assignee: null,
        diagnostic: { reason: "not-a-uuid", assignmentType: "directUser" },
      };
    }
    return { assignee: value };
  }

  if (type === "role") {
    if (typeof value !== "string" || !value.trim()) {
      logger?.warn?.(
        `User task ${node.id}: role assignment has no role key; leaving unassigned.`,
      );
      return {
        assignee: null,
        candidateRole: null,
        diagnostic: { reason: "empty-role-key", assignmentType: "role" },
      };
    }
    return { assignee: null, candidateRole: value.trim() };
  }

  if (type === "expression") {
    if (typeof value !== "string" || !value.trim()) {
      return {
        assignee: null,
        diagnostic: { reason: "empty-expression", assignmentType: "expression" },
      };
    }
    const resolved = resolveVariableExpression(value, variables);
    if (resolved === undefined || resolved === null || resolved === "") {
      logger?.warn?.(
        `User task ${node.id}: assignment expression "${value}" resolved to empty; leaving unassigned.`,
      );
      return {
        assignee: null,
        diagnostic: {
          reason: "unresolved-expression",
          expression: value,
          assignmentType: "expression",
        },
      };
    }
    if (typeof resolved !== "string" || !UUID_RE.test(resolved)) {
      logger?.warn?.(
        `User task ${node.id}: assignment expression "${value}" resolved to "${String(resolved).slice(0, 60)}" which is not a UUID; leaving unassigned.`,
      );
      return {
        assignee: null,
        diagnostic: {
          reason: "expression-not-uuid",
          expression: value,
          assignmentType: "expression",
        },
      };
    }
    return { assignee: resolved };
  }

  if (typeof type === "string") {
    logger?.warn?.(
      `User task ${node.id}: assignment type "${type}" not supported yet; leaving unassigned.`,
    );
    return {
      assignee: null,
      diagnostic: { reason: "unsupported-type", assignmentType: type },
    };
  }
  return { assignee: null };
}

/** Resolve a `${path.to.var}` expression against the variable bag.
 *  Supports bare variable names (`${managerId}`) and dot-paths
 *  (`${customer.id}`). Returns `undefined` if any segment is missing.
 *  Does NOT evaluate arbitrary FEEL — just variable substitution. For
 *  more complex logic use a scriptTask or an externalWorker handler. */
export function resolveVariableExpression(
  expr: string,
  variables: Record<string, unknown>,
): unknown {
  const m = /^\s*\$\{\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\}\s*$/.exec(expr);
  if (!m) return undefined;
  const path = m[1].split(".");
  let cur: unknown = variables;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** A single mapping entry on a serviceTask node:
 *  - string starting with "$" → source path into the source bag
 *    (variables for input, handler result for output). Stored as
 *    "$customer.id" — leading "$" stripped at apply time.
 *  - { from: "customer.id" } → equivalent object form. Lets canvases
 *    that don't want the "$" sigil convention express the same.
 *  - any other literal → passed through verbatim (string/number/bool
 *    constants, useful for static input enrichment). */
export type MappingEntry = string | number | boolean | null | { from?: string };

/** Apply a `Record<targetKey, MappingEntry>` map by projecting from
 *  `source`. Missing source paths produce `undefined` values (omitted
 *  from the result). Used in two places:
 *    • input mapping: engine projects from instance.variables before
 *      enqueuing the worker job, so handlers see only the data the
 *      canvas explicitly exposes.
 *    • output mapping: engine projects from the handler result
 *      before merging into instance.variables, so handler-internal
 *      shape doesn't leak into the canvas vocabulary.
 *  Returns a new flat object. */
export function applyMapping(
  mappings: Record<string, MappingEntry> | undefined,
  source: Record<string, unknown>,
): Record<string, unknown> {
  if (!mappings || typeof mappings !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [target, entry] of Object.entries(mappings)) {
    let value: unknown;
    if (typeof entry === "string" && entry.startsWith("$")) {
      value = getByPath(source, entry.slice(1));
    } else if (entry && typeof entry === "object" && "from" in entry) {
      const path = (entry as { from?: unknown }).from;
      if (typeof path === "string") value = getByPath(source, path);
    } else {
      // Literal — pass through (string without $, number, boolean, null).
      value = entry;
    }
    if (value !== undefined) out[target] = value;
  }
  return out;
}

/** Resolve a dot-separated path inside a nested record. Returns
 *  undefined for any missing segment. Doesn't follow prototype chain
 *  (uses Object.prototype.hasOwnProperty implicitly via `in`).
 *  Bracket notation isn't supported — variables are flat by
 *  convention; if a value is itself nested the path drills in. */
export function getByPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== "object") return undefined;
  if (path === "") return source;
  const parts = path.split(".");
  let cur: unknown = source;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Parse a small ISO 8601 duration (the subset BPMN canvases emit
 *  for SLA + timeout fields) into milliseconds. Supports the
 *  `PT<n>H<n>M<n>S` form and any subset thereof — e.g. `PT30S`,
 *  `PT5M`, `PT1H30M`. Returns null if the input is malformed; callers
 *  fall back to a sane default. We deliberately don't pull a full
 *  ISO 8601 lib for a one-shot use case. */
export function parseDurationToMs(iso: string): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso.trim());
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseFloat(m[3]) : 0;
  const total = h * 3_600_000 + min * 60_000 + s * 1_000;
  return total > 0 ? total : null;
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
