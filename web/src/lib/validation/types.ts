/* ─── Validation Types ────────────────────────────────────────────────
 * Shared types for the validation engine. A ValidationRule is a pure
 * function over (nodes, edges) that returns any issues it finds —
 * keeping rules stateless keeps the engine easy to compose and test.
 * ──────────────────────────────────────────────────────────────────── */

import type { Node, Edge } from "@xyflow/react";

export type IssueSeverity = "error" | "warning" | "info";

export type ValidationIssue = {
  /** Stable per-issue ID so the UI can key a list and dedupe. */
  id: string;
  severity: IssueSeverity;
  /** Short, actionable message shown in the problems panel. */
  message: string;
  /** The rule that produced this issue — used for filtering + icons. */
  ruleId: string;
  /** Optional pointer to the offending element on the canvas. */
  nodeId?: string;
  edgeId?: string;
};

export type ValidationRule = {
  id: string;
  name: string;
  run: (nodes: Node[], edges: Edge[]) => ValidationIssue[];
};
