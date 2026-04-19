/* ─── useValidationIssues ─────────────────────────────────────────────
 * Runs the validation engine against the current canvas and memoizes
 * the result. Subscribed with a custom equality function that compares
 * a minimal "connectivity digest", so drag/pan frames (which mutate
 * node positions but not structure) don't cause a re-render.
 * ──────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import useCanvasStore from "./canvas-store";
import { runValidation } from "../lib/validation";
import type { ValidationIssue } from "../lib/validation/types";
import type { CanvasState } from "./canvas-store";

/** Small, stable signature that changes iff structure / connectivity /
 *  labels change. Positions, sizes, and selection flags are excluded. */
function connectivityDigest(nodes: Node[], edges: Edge[]): string {
  // parentId is part of the digest because scope-aware validation rules
  // (P5) change their output when a node is re-parented — without this,
  // moving a start event into or out of a subprocess wouldn't re-run
  // validation until an unrelated structural change happened.
  const n = nodes
    .map((x) => `${x.id}:${x.type}:${x.parentId ?? ""}:${(x.data as { label?: string })?.label ?? ""}`)
    .join("|");
  const e = edges.map((x) => `${x.id}:${x.source}>${x.target}`).join("|");
  return `${n}##${e}`;
}

type Snapshot = { nodes: Node[]; edges: Edge[]; digest: string };

const selectSnapshot = (s: CanvasState): Snapshot => ({
  nodes: s.nodes,
  edges: s.edges,
  digest: connectivityDigest(s.nodes, s.edges),
});

const eqByDigest = (a: Snapshot, b: Snapshot) => a.digest === b.digest;

export function useValidationIssues(): ValidationIssue[] {
  const { nodes, edges, digest } = useStoreWithEqualityFn(
    useCanvasStore,
    selectSnapshot,
    eqByDigest,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => runValidation(nodes, edges), [digest]);
}
