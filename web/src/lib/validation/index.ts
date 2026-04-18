/* ─── Validation Engine ───────────────────────────────────────────────
 * Runs the full rule set against a canvas snapshot and returns a flat
 * list of issues, sorted by severity (errors first) then rule id for
 * stable UI ordering.
 * ──────────────────────────────────────────────────────────────────── */

import type { Node, Edge } from "@xyflow/react";
import { DEFAULT_RULES } from "./rules";
import type { ValidationIssue, ValidationRule } from "./types";

const SEVERITY_ORDER: Record<ValidationIssue["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export function runValidation(
  nodes: Node[],
  edges: Edge[],
  rules: ValidationRule[] = DEFAULT_RULES,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const rule of rules) {
    try {
      issues.push(...rule.run(nodes, edges));
    } catch (e) {
      // A broken rule must not prevent other rules from running.
      console.error(`[validation] rule "${rule.id}" threw:`, e);
    }
  }
  issues.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return s !== 0 ? s : a.ruleId.localeCompare(b.ruleId);
  });
  return issues;
}

export type { ValidationIssue, ValidationRule } from "./types";
