/* ─── Validation Rules ────────────────────────────────────────────────
 * The initial rule set. Each rule is a standalone pure function so new
 * phases can add rules without touching the engine. Rules should be
 * cheap — the runner is called on every edit (debounced in the store).
 * ──────────────────────────────────────────────────────────────────── */

import type { ValidationRule, ValidationIssue } from "./types";
import { EVENT_BASED_VALID_TARGETS } from "../bpmn/capabilities";
import { isSubprocessType } from "../bpmn/element-map";

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
 *  event subprocess unreachable. */
export const eventSubprocessTriggerRule: ValidationRule = {
  id: "event-subprocess-trigger",
  name: "Event subprocess trigger",
  run: (nodes) => {
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (n.type !== "eventSubProcess") continue;
      const children = nodes.filter((m) => m.parentId === n.id && m.type === "startEvent");
      if (children.length === 0) continue; // covered by no-start-event rule
      for (const start of children) {
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
      if (!byId.has(data.attachedToRef)) {
        issues.push({
          id: `boundary-dangling-attachment:${n.id}`,
          severity: "error",
          ruleId: "boundary-dangling-attachment",
          nodeId: n.id,
          message: `Boundary event "${labelOf(n as { id: string; data: Record<string, unknown> })}" references a deleted activity "${data.attachedToRef}".`,
        });
      }
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
];
