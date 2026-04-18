/* ─── Validation Rules ────────────────────────────────────────────────
 * The initial rule set. Each rule is a standalone pure function so new
 * phases can add rules without touching the engine. Rules should be
 * cheap — the runner is called on every edit (debounced in the store).
 * ──────────────────────────────────────────────────────────────────── */

import type { ValidationRule, ValidationIssue } from "./types";
import { EVENT_BASED_VALID_TARGETS } from "../bpmn/capabilities";

const labelOf = (n: { data: Record<string, unknown>; id: string }) =>
  (n.data?.label as string) || n.id;

export const noStartEventRule: ValidationRule = {
  id: "no-start-event",
  name: "Missing start event",
  run: (nodes) => {
    if (nodes.length === 0) return [];
    if (nodes.some((n) => n.type === "startEvent")) return [];
    return [
      {
        id: "no-start-event",
        severity: "error",
        ruleId: "no-start-event",
        message: "Process has no start event. Add one so the process knows where to begin.",
      },
    ];
  },
};

export const noEndEventRule: ValidationRule = {
  id: "no-end-event",
  name: "Missing end event",
  run: (nodes) => {
    if (nodes.length === 0) return [];
    if (nodes.some((n) => n.type === "endEvent")) return [];
    return [
      {
        id: "no-end-event",
        severity: "warning",
        ruleId: "no-end-event",
        message: "Process has no end event. Add one so the process has a clean termination point.",
      },
    ];
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
    const issues: ValidationIssue[] = [];
    for (const n of nodes) {
      if (connected.has(n.id)) continue;
      // A single-node canvas is a work-in-progress, not an issue.
      if (nodes.length <= 1) continue;
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

export const DEFAULT_RULES: ValidationRule[] = [
  noStartEventRule,
  noEndEventRule,
  disconnectedNodeRule,
  duplicateIdsRule,
  eventBasedTargetRule,
];
