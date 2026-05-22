/* ─── Validation Rules ────────────────────────────────────────────────
 * The initial rule set. Each rule is a standalone pure function so new
 * phases can add rules without touching the engine. Rules should be
 * cheap — the runner is called on every edit (debounced in the store).
 * ──────────────────────────────────────────────────────────────────── */

import type { ValidationRule, ValidationIssue } from "./types";
import { EVENT_BASED_VALID_TARGETS } from "../bpmn/capabilities";
import { isSubprocessType } from "../bpmn/element-map";
import { poolOf as sharedPoolOf } from "../bpmn/scope";
import { parseFeelCondition, parseVariableRef } from "../feel/parse";

/** Node types valid as boundary-event hosts per BPMN 2.0 §10.5.5. */
const BOUNDARY_VALID_HOSTS = new Set([
  "userTask", "serviceTask", "scriptTask", "sendTask", "receiveTask",
  "manualTask", "businessRuleTask", "callActivity",
  "subProcess", "eventSubProcess", "transaction", "adHocSubProcess",
]);

const labelOf = (n: { data: Record<string, unknown>; id: string }) =>
  (n.data?.label as string) || n.id;

/** Group nodes by their parent scope. Root scope is keyed by `null`.
 *  Nodes whose parentId references a missing node fall back to root. */
function groupByScope<T extends { id: string; parentId?: string }>(
  nodes: T[],
): Map<string | null, T[]> {
  const ids = new Set(nodes.map((n) => n.id));
  const byScope = new Map<string | null, T[]>();
  for (const n of nodes) {
    const key = n.parentId && ids.has(n.parentId) ? n.parentId : null;
    const arr = byScope.get(key) || [];
    arr.push(n);
    byScope.set(key, arr);
  }
  return byScope;
}

const scopeLabel = (
  scopeId: string | null,
  byId: Map<string, { data: Record<string, unknown>; id: string }>,
): string => {
  if (!scopeId) return "Process";
  const host = byId.get(scopeId);
  return host ? `subprocess "${labelOf(host)}"` : `subprocess "${scopeId}"`;
};

export const noStartEventRule: ValidationRule = {
  id: "no-start-event",
  name: "Missing start event",
  run: (nodes) => {
    if (nodes.length === 0) return [];
    const byScope = groupByScope(nodes);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const issues: ValidationIssue[] = [];
    for (const [scopeId, scopeNodes] of byScope) {
      // An empty (but existing) subprocess is a work-in-progress, not yet
      // an error — flagging it would spam users mid-modeling. Root with
      // zero nodes short-circuits above.
      if (scopeNodes.length === 0) continue;
      if (scopeNodes.some((n) => n.type === "startEvent")) continue;
      issues.push({
        id: scopeId ? `no-start-event:${scopeId}` : "no-start-event",
        severity: "error",
        ruleId: "no-start-event",
        nodeId: scopeId ?? undefined,
        message: `${scopeLabel(scopeId, byId)} has no start event. Add one so it knows where to begin.`,
      });
    }
    return issues;
  },
};

export const noEndEventRule: ValidationRule = {
  id: "no-end-event",
  name: "Missing end event",
  run: (nodes) => {
    if (nodes.length === 0) return [];
    const byScope = groupByScope(nodes);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const issues: ValidationIssue[] = [];
    for (const [scopeId, scopeNodes] of byScope) {
      if (scopeNodes.length === 0) continue;
      if (scopeNodes.some((n) => n.type === "endEvent")) continue;
      issues.push({
        id: scopeId ? `no-end-event:${scopeId}` : "no-end-event",
        severity: "warning",
        ruleId: "no-end-event",
        nodeId: scopeId ?? undefined,
        message: `${scopeLabel(scopeId, byId)} has no end event. Add one so it has a clean termination point.`,
      });
    }
    return issues;
  },
};

/** Event subprocesses fire when their inner start event receives a
 *  trigger (timer, message, signal, error, escalation, compensation,
 *  conditional). A start event without an event definition makes an
 *  event subprocess unreachable — and an event subprocess with no
 *  children at all can never fire, so we flag both cases here (the
 *  generic no-start-event rule skips empty scopes to avoid spamming
 *  during modeling, so event subprocesses need their own coverage). */
export const eventSubprocessTriggerRule: ValidationRule = {
  id: "event-subprocess-trigger",
  name: "Event subprocess trigger",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    const childrenByParent = new Map<string, typeof nodes>();
    for (const n of nodes) {
      if (!n.parentId) continue;
      const arr = childrenByParent.get(n.parentId) || [];
      arr.push(n);
      childrenByParent.set(n.parentId, arr);
    }
    for (const n of nodes) {
      if (n.type !== "eventSubProcess") continue;
      const starts = (childrenByParent.get(n.id) || []).filter((m) => m.type === "startEvent");
      if (starts.length === 0) {
        issues.push({
          id: `event-subprocess-trigger:${n.id}:no-start`,
          severity: "error",
          ruleId: "event-subprocess-trigger",
          nodeId: n.id,
          message: `Event subprocess "${labelOf(n as { id: string; data: Record<string, unknown> })}" has no start event. Add a start event with a trigger (timer, message, signal, error, escalation, compensation, or conditional).`,
        });
        continue;
      }
      for (const start of starts) {
        const def = (start.data as { eventDefinition?: { kind?: string } })?.eventDefinition;
        if (!def || def.kind === "none" || !def.kind) {
          issues.push({
            id: `event-subprocess-trigger:${start.id}`,
            severity: "error",
            ruleId: "event-subprocess-trigger",
            nodeId: start.id,
            message: `Start event "${labelOf(start as { id: string; data: Record<string, unknown> })}" inside event subprocess "${labelOf(n as { id: string; data: Record<string, unknown> })}" needs an event definition (timer, message, signal, error, escalation, compensation, or conditional).`,
          });
        }
      }
    }
    return issues;
  },
};

export const disconnectedNodeRule: ValidationRule = {
  id: "disconnected-node",
  name: "Disconnected node",
  run: (nodes, edges) => {
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    const byId = new Map(nodes.map((m) => [m.id, m]));
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (connected.has(n.id)) continue;
      // A single-node canvas is a work-in-progress, not an issue.
      if (nodes.length <= 1) continue;
      // Boundary events intentionally have no incoming flows — they fire
      // via their `attachedToRef` host activity. The boundary-attachment
      // rule covers their own validation.
      if (n.type === "boundaryEvent") continue;
      // Subprocess frames aren't themselves "disconnected" when they
      // only contain (fully connected) children — connectivity is
      // evaluated per scope. Skip subprocesses that have children.
      if (isSubprocessType(n.type) && nodes.some((m) => m.parentId === n.id)) continue;
      // Pools and lanes are containers that don't participate in
      // sequence-flow connectivity at all.
      if (n.type === "pool" || n.type === "lane") continue;
      // Artifacts (DataStore / TextAnnotation / Group) connect via
      // associations — or not at all (groups are purely visual).
      // The association-endpoints rule owns their validation.
      if (n.type === "dataStore" || n.type === "textAnnotation" || n.type === "group") continue;
      // Start events of event subprocesses intentionally have no
      // incoming flow — they fire on event. Skip.
      if (n.type === "startEvent") {
        const parent = n.parentId ? byId.get(n.parentId) : undefined;
        if (parent?.type === "eventSubProcess") continue;
      }
      issues.push({
        id: `disconnected-node:${n.id}`,
        severity: "warning",
        ruleId: "disconnected-node",
        nodeId: n.id,
        message: `"${labelOf(n as { id: string; data: Record<string, unknown> })}" has no incoming or outgoing flows.`,
      });
    }
    return issues;
  },
};

export const duplicateIdsRule: ValidationRule = {
  id: "duplicate-ids",
  name: "Duplicate IDs",
  run: (nodes, edges) => {
    const seen = new Map<string, "node" | "edge">();
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (seen.has(n.id)) {
        issues.push({
          id: `duplicate-id:${n.id}`,
          severity: "error",
          ruleId: "duplicate-ids",
          nodeId: n.id,
          message: `Duplicate ID "${n.id}" — BPMN IDs must be unique.`,
        });
      }
      seen.set(n.id, "node");
    }
    for (const e of edges) {
      if (seen.has(e.id)) {
        issues.push({
          id: `duplicate-id:${e.id}`,
          severity: "error",
          ruleId: "duplicate-ids",
          edgeId: e.id,
          message: `Duplicate ID "${e.id}" — BPMN IDs must be unique.`,
        });
      }
      seen.set(e.id, "edge");
    }
    return issues;
  },
};

export const eventBasedTargetRule: ValidationRule = {
  id: "event-based-invalid-target",
  name: "Event-based gateway target",
  run: (nodes, edges) => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "eventBasedGateway") continue;
      for (const e of edges) {
        if (e.source !== n.id) continue;
        const target = byId.get(e.target);
        if (!target?.type) continue;
        if (EVENT_BASED_VALID_TARGETS.has(target.type)) continue;
        issues.push({
          id: `event-based-target:${e.id}`,
          severity: "error",
          ruleId: "event-based-invalid-target",
          edgeId: e.id,
          nodeId: n.id,
          message: `Event-based gateway "${labelOf(n as { id: string; data: Record<string, unknown> })}" targets "${labelOf(target as { id: string; data: Record<string, unknown> })}" (${target.type}). Targets must be catch events or receive tasks.`,
        });
      }
    }
    return issues;
  },
};

export const boundaryAttachmentRule: ValidationRule = {
  id: "boundary-attachment",
  name: "Boundary event attachment",
  run: (nodes) => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "boundaryEvent") continue;
      const data = n.data as { attachedToRef?: string; label?: string };
      if (!data.attachedToRef) {
        issues.push({
          id: `boundary-missing-attachment:${n.id}`,
          severity: "error",
          ruleId: "boundary-missing-attachment",
          nodeId: n.id,
          message: `Boundary event "${labelOf(n as { id: string; data: Record<string, unknown> })}" isn't attached to an activity. Pick a host in the Attachment section.`,
        });
        continue;
      }
      const host = byId.get(data.attachedToRef);
      if (!host) {
        issues.push({
          id: `boundary-dangling-attachment:${n.id}`,
          severity: "error",
          ruleId: "boundary-dangling-attachment",
          nodeId: n.id,
          message: `Boundary event "${labelOf(n as { id: string; data: Record<string, unknown> })}" references a deleted activity "${data.attachedToRef}".`,
        });
        continue;
      }
      // Per BPMN 2.0 §10.5.5 a boundary event may only attach to an
      // Activity (task family or subprocess). The PropertiesPanel
      // dropdown filters to these types, but XML import or direct data
      // mutation could slip through — cover it here.
      if (host.type && !BOUNDARY_VALID_HOSTS.has(host.type)) {
        issues.push({
          id: `boundary-invalid-host:${n.id}`,
          severity: "error",
          ruleId: "boundary-invalid-host",
          nodeId: n.id,
          message: `Boundary event "${labelOf(n as { id: string; data: Record<string, unknown> })}" is attached to "${labelOf(host as { id: string; data: Record<string, unknown> })}" (${host.type}). Boundary events must attach to an activity (task or subprocess).`,
        });
      }
    }
    return issues;
  },
};

/** Event subprocesses must live inside a parent process or subprocess
 *  per BPMN 2.0 §10.11 — a root-level event subprocess is structurally
 *  invalid (it has no parent whose death it can observe). */
export const eventSubprocessNestingRule: ValidationRule = {
  id: "event-subprocess-nesting",
  name: "Event subprocess nesting",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "eventSubProcess") continue;
      if (n.parentId) continue;
      issues.push({
        id: `event-subprocess-nesting:${n.id}`,
        severity: "error",
        ruleId: "event-subprocess-nesting",
        nodeId: n.id,
        message: `Event subprocess "${labelOf(n as { id: string; data: Record<string, unknown> })}" must be nested inside a parent subprocess. Drag it onto an expanded subprocess frame.`,
      });
    }
    return issues;
  },
};

/** Sequence flows must stay inside a single pool (BPMN 2.0 §8.3.3).
 *  Cross-pool connections must be message flows — firing here prevents
 *  a silent export-time drop. */
export const sequenceFlowSamePoolRule: ValidationRule = {
  id: "sequence-flow-same-pool",
  name: "Sequence flow must stay inside one pool",
  run: (nodes, edges) => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const hasAnyPool = nodes.some((n) => n.type === "pool");
    if (!hasAnyPool) return [];
    const issues: ValidationIssue[] = [];
    for (const e of edges) {
      const flowType = (e.data as { flowType?: string } | undefined)?.flowType;
      if (flowType === "message") continue;
      const sp = sharedPoolOf(e.source, byId);
      const tp = sharedPoolOf(e.target, byId);
      if (sp && tp && sp !== tp) {
        issues.push({
          id: `sequence-flow-same-pool:${e.id}`,
          severity: "error",
          ruleId: "sequence-flow-same-pool",
          edgeId: e.id,
          message: "Sequence flow crosses a pool boundary. Convert to a message flow, or redraw inside a single pool.",
        });
      } else if ((sp && !tp) || (!sp && tp)) {
        // Asymmetric — one endpoint is in a pool, the other is an
        // orphan. The serializer will adopt the orphan into the first
        // pool on export, which changes the flow's structural meaning.
        // Flag it so the user can decide deliberately.
        issues.push({
          id: `sequence-flow-same-pool:${e.id}`,
          severity: "warning",
          ruleId: "sequence-flow-same-pool",
          edgeId: e.id,
          message: "Sequence flow has one endpoint outside any pool. Move it into a pool (or remove the pool) to make scope explicit.",
        });
      }
    }
    return issues;
  },
};

/** Message flows must cross a pool boundary (BPMN 2.0 §8.3.3). */
export const messageFlowCrossPoolRule: ValidationRule = {
  id: "message-flow-cross-pool",
  name: "Message flow must cross a pool boundary",
  run: (nodes, edges) => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const issues: ValidationIssue[] = [];
    for (const e of edges) {
      const flowType = (e.data as { flowType?: string } | undefined)?.flowType;
      if (flowType !== "message") continue;
      const sp = sharedPoolOf(e.source, byId);
      const tp = sharedPoolOf(e.target, byId);
      if (!sp || !tp) {
        issues.push({
          id: `message-flow-cross-pool:${e.id}`,
          severity: "error",
          ruleId: "message-flow-cross-pool",
          edgeId: e.id,
          message: "Message flow requires both endpoints to live inside a pool. Add a pool around each endpoint.",
        });
        continue;
      }
      if (sp === tp) {
        issues.push({
          id: `message-flow-cross-pool:${e.id}`,
          severity: "error",
          ruleId: "message-flow-cross-pool",
          edgeId: e.id,
          message: "Message flow has both endpoints in the same pool. Convert to a sequence flow, or move an endpoint to another pool.",
        });
      }
    }
    return issues;
  },
};

/** A lane is only meaningful inside a pool (or another lane nested in
 *  a pool). Root-level lanes vanish from the XML on export, so flag
 *  them explicitly rather than let the silent drop happen. */
export const laneRequiresPoolRule: ValidationRule = {
  id: "lane-requires-pool",
  name: "Lane must live inside a pool",
  run: (nodes) => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "lane") continue;
      if (!sharedPoolOf(n.id, byId)) {
        issues.push({
          id: `lane-requires-pool:${n.id}`,
          severity: "error",
          ruleId: "lane-requires-pool",
          nodeId: n.id,
          message: `Lane "${labelOf(n as { id: string; data: Record<string, unknown> })}" must be inside a pool.`,
        });
      }
    }
    return issues;
  },
};

/** P8: text annotations are only useful if they carry text. An empty
 *  sticky-note is a modeling mistake (user double-clicked to create one
 *  then didn't type), surface as a warning so the exporter can flag it. */
const emptyTextAnnotationRule: ValidationRule = {
  id: "empty-text-annotation",
  name: "Text annotation has no text",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "textAnnotation") continue;
      const body = (n.data?.label as string) ?? "";
      if (body.trim().length === 0) {
        issues.push({
          id: `empty-text-annotation:${n.id}`,
          severity: "warning",
          ruleId: "empty-text-annotation",
          nodeId: n.id,
          message: "Text annotation is empty — double-click to add content or remove it.",
        });
      }
    }
    return issues;
  },
};

/** P8: associations connect a flow node to an artifact (or vice versa).
 *  An association between two flow nodes, or between two artifacts, is
 *  a modeling mistake — BPMN 2.0 §10.4.5 defines associations only for
 *  linking artifacts to the flow. */
const associationEndpointsRule: ValidationRule = {
  id: "association-endpoints",
  name: "Association endpoints",
  run: (nodes, edges) => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const issues: ValidationIssue[] = [];
    const artifactTypes = new Set(["dataStore", "textAnnotation", "group"]);
    for (const e of edges) {
      const flowType = (e.data as { flowType?: string } | undefined)?.flowType;
      if (flowType !== "association") continue;
      const src = byId.get(e.source);
      const tgt = byId.get(e.target);
      if (!src || !tgt) continue;
      const srcArt = artifactTypes.has(src.type || "");
      const tgtArt = artifactTypes.has(tgt.type || "");
      if (srcArt === tgtArt) {
        issues.push({
          id: `association-endpoints:${e.id}`,
          severity: "warning",
          ruleId: "association-endpoints",
          edgeId: e.id,
          message: srcArt
            ? "Association connects two artifacts — consider linking one end to a flow node instead."
            : "Association between two flow nodes reads as commentary; a sequence flow or message flow is usually clearer.",
        });
      }
    }
    return issues;
  },
};

/* ─── Designer Sweep B — new rules ────────────────────────────────── */

/** A userTask must have an assignment — otherwise the engine logs a
 *  diagnostic and leaves the task unassigned, and no one can claim it.
 *  `directUser` needs a value, `role` needs a role key, `expression`
 *  needs a non-empty FEEL expression. Anything else (no assignment
 *  field at all) is flagged. */
const userTaskAssignmentRule: ValidationRule = {
  id: "user-task-assignment",
  name: "User task assignment",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "userTask") continue;
      const d = n.data as Record<string, unknown> | undefined;
      const a = d?.assignment as { type?: string; value?: string } | undefined;
      const label = labelOf(n as { id: string; data: Record<string, unknown> });
      if (!a || !a.type) {
        issues.push({
          id: `user-task-assignment:${n.id}`,
          severity: "error",
          ruleId: "user-task-assignment",
          nodeId: n.id,
          message: `User task "${label}" has no assignment — pick a user, role, or expression.`,
        });
        continue;
      }
      const v = typeof a.value === "string" ? a.value.trim() : "";
      if (v.length === 0) {
        issues.push({
          id: `user-task-assignment:${n.id}`,
          severity: "error",
          ruleId: "user-task-assignment",
          nodeId: n.id,
          message: `User task "${label}" is assigned by ${a.type} but the value is empty.`,
        });
      }
    }
    return issues;
  },
};

/** Exclusive/inclusive gateways with conditional outgoing flows should
 *  have an explicit default flow OR exhaustive conditions. We can't
 *  prove exhaustiveness without a real solver, so we flag the
 *  common-mistake shape: "more than one outgoing flow, every flow
 *  has a condition, no default set." That's the configuration that
 *  raises "no matching outgoing flow" at runtime. */
const gatewayNonExhaustiveRule: ValidationRule = {
  id: "gateway-non-exhaustive",
  name: "Gateway non-exhaustive",
  run: (nodes, edges) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "exclusiveGateway" && n.type !== "inclusiveGateway") continue;
      const outgoing = edges.filter((e) => e.source === n.id);
      if (outgoing.length < 2) continue;
      const d = n.data as { defaultFlowId?: string } | undefined;
      const hasDefault =
        !!d?.defaultFlowId &&
        outgoing.some((e) => e.id === d.defaultFlowId);
      if (hasDefault) continue;
      const allConditional = outgoing.every((e) => {
        const cond = (e.data as { condition?: string } | undefined)?.condition;
        return typeof cond === "string" && cond.trim().length > 0;
      });
      if (!allConditional) continue;
      const label = labelOf(n as { id: string; data: Record<string, unknown> });
      issues.push({
        id: `gateway-non-exhaustive:${n.id}`,
        severity: "warning",
        ruleId: "gateway-non-exhaustive",
        nodeId: n.id,
        message: `Gateway "${label}" has conditions on every outgoing flow but no default — an instance with no matching condition will fail.`,
      });
    }
    return issues;
  },
};

/** Service task with no usable implementation. The engine's
 *  `resolveServiceTaskTopic` only knows externalWorker, rest, and
 *  connector. Anything else (or no implementation at all) silently
 *  no-ops at runtime. Flag at design time so authors don't ship a
 *  process that does nothing useful. */
const KNOWN_SERVICE_IMPL_TYPES = new Set([
  "externalWorker",
  "rest",
  "connector",
]);

const serviceTaskImplRule: ValidationRule = {
  id: "service-task-impl",
  name: "Service task implementation",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "serviceTask" && n.type !== "sendTask") continue;
      const d = n.data as Record<string, unknown> | undefined;
      const impl = d?.implementation as { type?: string; config?: unknown } | undefined;
      const label = labelOf(n as { id: string; data: Record<string, unknown> });
      if (!impl || typeof impl !== "object" || !impl.type) {
        issues.push({
          id: `service-task-impl:${n.id}`,
          severity: "error",
          ruleId: "service-task-impl",
          nodeId: n.id,
          message: `Service task "${label}" has no implementation — pick external worker, REST, or a connector.`,
        });
        continue;
      }
      if (!KNOWN_SERVICE_IMPL_TYPES.has(impl.type)) {
        issues.push({
          id: `service-task-impl:${n.id}`,
          severity: "warning",
          ruleId: "service-task-impl",
          nodeId: n.id,
          message: `Service task "${label}" uses implementation type "${impl.type}" which the engine does not yet execute — it will no-op at runtime.`,
        });
        continue;
      }
      // Topic-shape sanity checks per type.
      const config = (impl.config as Record<string, unknown>) ?? {};
      if (impl.type === "externalWorker") {
        const topic = config.jobType;
        if (typeof topic !== "string" || !topic.trim()) {
          issues.push({
            id: `service-task-impl:${n.id}`,
            severity: "error",
            ruleId: "service-task-impl",
            nodeId: n.id,
            message: `Service task "${label}" uses external worker but the job type is empty.`,
          });
        }
      } else if (impl.type === "connector") {
        const ref = config.connectorId ?? config.connectorRef;
        const op = config.operation ?? config.operationId;
        if (typeof ref !== "string" || !ref) {
          issues.push({
            id: `service-task-impl:${n.id}`,
            severity: "error",
            ruleId: "service-task-impl",
            nodeId: n.id,
            message: `Service task "${label}" uses a connector but no connector is selected.`,
          });
        } else if (typeof op !== "string" || !op) {
          issues.push({
            id: `service-task-impl:${n.id}`,
            severity: "error",
            ruleId: "service-task-impl",
            nodeId: n.id,
            message: `Service task "${label}" selects connector "${ref}" but no operation is picked.`,
          });
        }
      } else if (impl.type === "rest") {
        const url = config.url;
        if (typeof url !== "string" || !url.trim()) {
          issues.push({
            id: `service-task-impl:${n.id}`,
            severity: "error",
            ruleId: "service-task-impl",
            nodeId: n.id,
            message: `Service task "${label}" uses REST but no URL is set.`,
          });
        }
      }
    }
    return issues;
  },
};

/** Nodes that the engine can never reach from any start event in their
 *  scope. Stronger than `disconnected-node` (which flags only nodes
 *  with zero edges): a chain of nodes wired only into a dead-end can
 *  have edges but still be unreachable from any start. */
const unreachableNodeRule: ValidationRule = {
  id: "unreachable-node",
  name: "Unreachable node",
  run: (nodes, edges) => {
    const issues: ValidationIssue[] = [];
    const byScope = groupByScope(nodes);
    const adjacencyByScope = new Map<string | null, Map<string, string[]>>();
    for (const [scopeId, scopeNodes] of byScope) {
      const ids = new Set(scopeNodes.map((n) => n.id));
      const adj = new Map<string, string[]>();
      for (const e of edges) {
        if (!ids.has(e.source) || !ids.has(e.target)) continue;
        const flow = (e.data as { flowType?: string } | undefined)?.flowType;
        // Only sequence flows drive reachability inside a scope. Message
        // flows cross pool boundaries; associations are commentary.
        if (flow === "message" || flow === "association") continue;
        const arr = adj.get(e.source) ?? [];
        arr.push(e.target);
        adj.set(e.source, arr);
      }
      adjacencyByScope.set(scopeId, adj);
    }
    for (const [scopeId, scopeNodes] of byScope) {
      const starts = scopeNodes.filter((n) => n.type === "startEvent");
      if (starts.length === 0) continue;
      const adj = adjacencyByScope.get(scopeId)!;
      const reached = new Set<string>();
      const stack = starts.map((s) => s.id);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (reached.has(cur)) continue;
        reached.add(cur);
        for (const next of adj.get(cur) ?? []) stack.push(next);
      }
      for (const n of scopeNodes) {
        // Artifacts and boundary events aren't reachable via sequence
        // flow by definition — skip. Disconnected-node rule already
        // covers nodes with zero edges.
        if (
          n.type === "boundaryEvent" ||
          n.type === "textAnnotation" ||
          n.type === "dataStore" ||
          n.type === "group"
        ) continue;
        if (reached.has(n.id)) continue;
        const hasAnyEdge = (adj.get(n.id)?.length ?? 0) > 0 ||
          edges.some((e) => e.target === n.id);
        if (!hasAnyEdge) continue; // disconnected-node handles this
        issues.push({
          id: `unreachable-node:${n.id}`,
          severity: "warning",
          ruleId: "unreachable-node",
          nodeId: n.id,
          message: `"${labelOf(n as { id: string; data: Record<string, unknown> })}" is wired up but no path from a start event reaches it.`,
        });
      }
    }
    return issues;
  },
};

/** callActivity has no runtime dispatcher yet — a token reaching one
 *  silently hops to the next edge without executing the child process.
 *  Flag at design time so authors know the node is a placeholder until
 *  the runtime lands (tracked in the E-series engine roadmap). */
const callActivityRuntimeRule: ValidationRule = {
  id: "call-activity-runtime",
  name: "Call activity runtime",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "callActivity") continue;
      const label = labelOf(n as { id: string; data: Record<string, unknown> });
      issues.push({
        id: `call-activity-runtime:${n.id}`,
        severity: "warning",
        ruleId: "call-activity-runtime",
        nodeId: n.id,
        message: `Call activity "${label}" — the engine doesn't yet execute child processes. Tokens will hop past this node without running the called flow.`,
      });
    }
    return issues;
  },
};

/** Parse every FEEL expression on the canvas and flag the broken ones.
 *  Sources today:
 *    • sequence flow conditions (`edge.data.condition`)
 *    • business-rule task expression bindings (`data.rule.expression`)
 *    • user task expression assignments (`data.assignment.value` when
 *      `assignment.type === "expression"`) — strict `${path}` form
 *
 *  Empty strings are skipped; required-but-empty cases are flagged by
 *  the assignment rule (above) and Camunda-style "condition required"
 *  rules at the edge level. */
const feelExpressionRule: ValidationRule = {
  id: "feel-expression",
  name: "FEEL expression syntax",
  run: (nodes, edges) => {
    const issues: ValidationIssue[] = [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) {
      const cond = (e.data as { condition?: string } | undefined)?.condition;
      if (typeof cond !== "string" || cond.trim().length === 0) continue;
      const res = parseFeelCondition(cond);
      if (res.ok) continue;
      issues.push({
        id: `feel-expression:edge:${e.id}`,
        severity: "error",
        ruleId: "feel-expression",
        edgeId: e.id,
        message: `Sequence flow condition: ${res.error.message}`,
      });
    }
    for (const n of nodes) {
      const d = n.data as Record<string, unknown> | undefined;
      if (n.type === "userTask") {
        const a = d?.assignment as { type?: string; value?: string } | undefined;
        if (a?.type === "expression" && typeof a.value === "string" && a.value.trim().length > 0) {
          const res = parseVariableRef(a.value);
          if (!res.ok) {
            issues.push({
              id: `feel-expression:assignment:${n.id}`,
              severity: "error",
              ruleId: "feel-expression",
              nodeId: n.id,
              message: `Assignee expression: ${res.error.message}`,
            });
          }
        }
      }
      if (n.type === "businessRuleTask") {
        const rule = d?.rule as { binding?: string; expression?: string } | undefined;
        if (rule?.binding === "expression" && typeof rule.expression === "string" && rule.expression.trim().length > 0) {
          const res = parseFeelCondition(rule.expression);
          if (!res.ok) {
            issues.push({
              id: `feel-expression:rule:${n.id}`,
              severity: "error",
              ruleId: "feel-expression",
              nodeId: n.id,
              message: `Decision expression: ${res.error.message}`,
            });
          }
        }
      }
    }
    // Suppress unused-import warning when there are no nodes to check.
    if (issues.length === 0 && byId.size === 0) return [];
    return issues;
  },
};

/** P0 — silent-no-op runtime gaps. Every BPMN element below is captured
 *  + validated + persisted by the Designer, but the engine today either
 *  pass-throughs or fails to dispatch. Flag at design time so authors
 *  don't ship a process that quietly does the wrong thing. Each gap
 *  retires as its phase of the engine sprint ships (P1–P7). */

const gatewayRuntimeRule = (
  ruleId: string,
  bpmnType: string,
  phaseHint: string,
): ValidationRule => ({
  id: ruleId,
  name: `${bpmnType} runtime`,
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== bpmnType) continue;
      const label = labelOf(n as { id: string; data: Record<string, unknown> });
      issues.push({
        id: `${ruleId}:${n.id}`,
        severity: "warning",
        ruleId,
        nodeId: n.id,
        message: `${bpmnType} "${label}" — engine today takes only the first outgoing edge. ${phaseHint}`,
      });
    }
    return issues;
  },
});

// P1 Session 3 — parallel + inclusive gateway runtime rules retired
// (engine ships split + join end-to-end). Event-based stays until P3.

const eventBasedGatewayRuntimeRule = gatewayRuntimeRule(
  "event-based-gateway-runtime",
  "eventBasedGateway",
  "Event-based dispatch executes in P3+P6 of the engine sprint.",
);

// P2 Session 5 — subprocess execution requires exactly one `none`-type
// inner start event. Zero → engine fails the instance at entry;
// multiple → engine picks the first by canvas order + logs a warning.
// Flag both at design time so authors notice before running.
const SUBPROCESS_EXEC_VARIANTS = new Set([
  "subProcess", "transaction", "adHocSubProcess",
]);

const subprocessInnerStartRule: ValidationRule = {
  id: "subprocess-inner-start",
  name: "Subprocess inner start event",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const sp of nodes) {
      if (!SUBPROCESS_EXEC_VARIANTS.has(sp.type ?? "")) continue;
      const inner = nodes.filter((n) => (n as { parentId?: string }).parentId === sp.id);
      if (inner.length === 0) continue; // empty subprocess — no-start-event rule handles
      const noneStarts = inner.filter((n) => {
        if (n.type !== "startEvent") return false;
        const def = (n.data as { eventDefinition?: { kind?: string } } | undefined)?.eventDefinition;
        return !def || !def.kind || def.kind === "none";
      });
      const label = labelOf(sp as { id: string; data: Record<string, unknown> });
      if (noneStarts.length === 0) {
        issues.push({
          id: `subprocess-inner-start:${sp.id}`,
          severity: "error",
          ruleId: "subprocess-inner-start",
          nodeId: sp.id,
          message: `Subprocess "${label}" has no \`none\`-type inner start event. The engine can't enter it — add a plain start event inside.`,
        });
      } else if (noneStarts.length > 1) {
        issues.push({
          id: `subprocess-inner-start:${sp.id}`,
          severity: "info",
          ruleId: "subprocess-inner-start",
          nodeId: sp.id,
          message: `Subprocess "${label}" has ${noneStarts.length} \`none\`-type inner start events. The engine picks the first by canvas order — collapse to a single start to avoid ambiguity.`,
        });
      }
    }
    return issues;
  },
};

// P2 Session 5 narrowed scope: subProcess + transaction +
// adHocSubProcess now execute. eventSubProcess still inert until
// Session 6 (event subscription).
const subprocessRuntimeRule: ValidationRule = {
  id: "subprocess-runtime",
  name: "Subprocess runtime",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "eventSubProcess") continue;
      const label = labelOf(n as { id: string; data: Record<string, unknown> });
      issues.push({
        id: `subprocess-runtime:${n.id}`,
        severity: "warning",
        ruleId: "subprocess-runtime",
        nodeId: n.id,
        message: `Event subprocess "${label}" — engine doesn't subscribe to its trigger event today. Won't fire until Session 6 of the engine sprint (boundary events + event subscription).`,
      });
    }
    return issues;
  },
};

const businessRuleExpressionRuntimeRule: ValidationRule = {
  id: "business-rule-expression-runtime",
  name: "Business rule expression runtime",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "businessRuleTask") continue;
      const d = n.data as Record<string, unknown> | undefined;
      const rule = d?.rule as { binding?: string } | undefined;
      if (rule?.binding !== "expression") continue;
      const label = labelOf(n as { id: string; data: Record<string, unknown> });
      issues.push({
        id: `business-rule-expression-runtime:${n.id}`,
        severity: "warning",
        ruleId: "business-rule-expression-runtime",
        nodeId: n.id,
        message: `Business rule task "${label}" — engine doesn't evaluate FEEL expressions today. Tokens hop past without setting the result variable. Expression evaluation ships in P5 of the engine sprint.`,
      });
    }
    return issues;
  },
};

const EVENT_HOST_TYPES = new Set([
  "startEvent", "endEvent", "intermediateCatchEvent",
  "intermediateThrowEvent", "boundaryEvent",
]);

// P2 Session 6a — `timer` is now wired end-to-end on event hosts that
// matter: boundaryEvent (subscribe + fire). Other kinds (message,
// signal, error, escalation, conditional, link, cancel, compensation)
// stay flagged until Sessions 6b–9 + P4/P6.
const EVENT_KINDS_STILL_INERT = new Set([
  "message", "signal", "error", "escalation", "conditional",
  "link", "cancel", "compensation",
]);

const eventDefinitionRuntimeRule: ValidationRule = {
  id: "event-definition-runtime",
  name: "Event definition runtime",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (!EVENT_HOST_TYPES.has(n.type ?? "")) continue;
      const d = n.data as Record<string, unknown> | undefined;
      const def = d?.eventDefinition as { kind?: string } | undefined;
      const kind = def?.kind;
      if (!kind || kind === "none") continue;
      // Timer on boundary events is implemented (P2 Session 6a). Other
      // host types (start/intermediate) still need the event-
      // subscription tables (P3+). Timer on those stays flagged.
      if (kind === "timer" && n.type === "boundaryEvent") continue;
      if (!EVENT_KINDS_STILL_INERT.has(kind) && kind !== "timer" && kind !== "terminate") continue;
      const label = labelOf(n as { id: string; data: Record<string, unknown> });
      issues.push({
        id: `event-definition-runtime:${n.id}`,
        severity: "warning",
        ruleId: "event-definition-runtime",
        nodeId: n.id,
        message: `${n.type} "${label}" carries a "${kind}" trigger but the engine doesn't subscribe to events today. Event subscription + correlation ships in later P2/P3/P4/P6 sessions (kind-dependent).`,
      });
    }
    return issues;
  },
};

// P2 Session 6a — boundary events with kind `timer` now execute.
// Other kinds still flagged until Sessions 6b–9 (per kind).
const boundaryEventRuntimeRule: ValidationRule = {
  id: "boundary-event-runtime",
  name: "Boundary event runtime",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "boundaryEvent") continue;
      const d = n.data as { eventDefinition?: { kind?: string } } | undefined;
      const kind = d?.eventDefinition?.kind;
      if (kind === "timer") continue; // shipped
      const label = labelOf(n as { id: string; data: Record<string, unknown> });
      issues.push({
        id: `boundary-event-runtime:${n.id}`,
        severity: "warning",
        ruleId: "boundary-event-runtime",
        nodeId: n.id,
        message: `Boundary event "${label}" (kind "${kind ?? "none"}") — engine doesn't register this boundary kind today. Timer boundaries work (Session 6a); error lands in Session 6b; message/signal/etc. land later.`,
      });
    }
    return issues;
  },
};

const SCHEDULING_HOST_TYPES = new Set([
  "userTask", "serviceTask", "scriptTask", "sendTask", "receiveTask",
  "manualTask", "businessRuleTask",
]);

const schedulingRuntimeRule: ValidationRule = {
  id: "scheduling-runtime",
  name: "Scheduling expression runtime",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (!SCHEDULING_HOST_TYPES.has(n.type ?? "")) continue;
      const d = n.data as Record<string, unknown> | undefined;
      const s = d?.scheduling as
        | {
            dueDate?: string;
            dueDateIsExpression?: boolean;
            followUpDate?: string;
            followUpDateIsExpression?: boolean;
            priorityExpression?: unknown;
          }
        | undefined;
      if (!s) continue;
      const usesExpression =
        !!(s.dueDateIsExpression && s.dueDate) ||
        !!(s.followUpDateIsExpression && s.followUpDate) ||
        !!s.priorityExpression;
      if (!usesExpression) continue;
      const label = labelOf(n as { id: string; data: Record<string, unknown> });
      issues.push({
        id: `scheduling-runtime:${n.id}`,
        severity: "info",
        ruleId: "scheduling-runtime",
        nodeId: n.id,
        message: `${n.type} "${label}" uses FEEL expressions for scheduling — engine today only honours static dueDate + priority. Static dueDate now fires task-due reminders (P2 Session 4); expression evaluation for dueDate / followUpDate / priority lands in a later P2 polish session.`,
      });
    }
    return issues;
  },
};

export const DEFAULT_RULES: ValidationRule[] = [
  noStartEventRule,
  noEndEventRule,
  disconnectedNodeRule,
  duplicateIdsRule,
  eventBasedTargetRule,
  boundaryAttachmentRule,
  eventSubprocessTriggerRule,
  eventSubprocessNestingRule,
  sequenceFlowSamePoolRule,
  messageFlowCrossPoolRule,
  laneRequiresPoolRule,
  emptyTextAnnotationRule,
  associationEndpointsRule,
  userTaskAssignmentRule,
  gatewayNonExhaustiveRule,
  serviceTaskImplRule,
  unreachableNodeRule,
  callActivityRuntimeRule,
  eventBasedGatewayRuntimeRule,
  subprocessRuntimeRule,
  subprocessInnerStartRule,
  businessRuleExpressionRuntimeRule,
  eventDefinitionRuntimeRule,
  boundaryEventRuntimeRule,
  schedulingRuntimeRule,
  feelExpressionRule,
];
