/* ─── useValidationIssues ─────────────────────────────────────────────
 * Runs the validation engine against the current canvas and memoizes
 * the result. Subscribed to a minimal "connectivity digest" rather than
 * the raw nodes/edges arrays so a drag or pan doesn't re-run every rule
 * at 60Hz — only structural changes invalidate the memo.
 * ──────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import useCanvasStore from "./canvas-store";
import { runValidation } from "../lib/validation";
import type { ValidationIssue } from "../lib/validation/types";

/** Small, stable signature that changes iff structure / connectivity /
 *  labels change. Positions, sizes, and selection flags are excluded. */
function connectivityDigest(nodes: Node[], edges: Edge[]): string {
  const n = nodes.map((x) => `${x.id}:${x.type}:${(x.data as { label?: string })?.label ?? ""}`).join("|");
  const e = edges.map((x) => `${x.id}:${x.source}>${x.target}`).join("|");
  return `${n}##${e}`;
}

export function useValidationIssues(): ValidationIssue[] {
  const digest = useCanvasStore((s) => connectivityDigest(s.nodes, s.edges));
  const nodes = useCanvasStore.getState().nodes;
  const edges = useCanvasStore.getState().edges;

  return useMemo(
    () => runValidation(nodes, edges),
    // Digest drives re-computation — actual arrays read via getState().
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [digest],
  );
}
