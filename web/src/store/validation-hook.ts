/* ─── useValidationIssues ─────────────────────────────────────────────
 * Runs the validation engine against the current canvas and memoizes
 * the result. Subscribed with a custom equality function that compares
 * a minimal "connectivity digest", so drag/pan frames (which mutate
 * node positions but not structure) don't cause a re-render.
 *
 * Triage cleanup — module-level cache by digest. Previously every
 * `<NodeErrorMarker>` consumer called this hook, and each one ran
 * `runValidation` in its own `useMemo`. On a 50-node canvas the rules
 * fired ~50 times per structural change. With the cache they fire
 * once; every other consumer (and the precomputed `byNodeId` map)
 * reads from the shared result. The cache is keyed by digest, which
 * is itself derived from the structural fields the rules read.
 * ──────────────────────────────────────────────────────────────────── */

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
  //
  // Sweep B — we also fingerprint the small set of data fields that
  // validation rules read directly: edge `condition` + `flowType`,
  // node `assignment.{type,value}`, gateway `defaultFlowId`, service
  // task `implementation.{type, config.jobType/url/connectorId/operation}`,
  // business-rule `rule.{binding, expression}`. Otherwise editing one
  // of those fields wouldn't refresh the validation issue list (the
  // hook re-runs only on digest change).
  const n = nodes
    .map((x) => {
      const d = x.data as Record<string, unknown> | undefined;
      const label = (d?.label as string) ?? "";
      const assign = d?.assignment as { type?: string; value?: string } | undefined;
      const impl = d?.implementation as { type?: string; config?: Record<string, unknown> } | undefined;
      const rule = d?.rule as { binding?: string; expression?: string } | undefined;
      const cfg = impl?.config ?? {};
      const implSig =
        impl
          ? `${impl.type ?? ""}|${(cfg as { jobType?: string }).jobType ?? ""}|${(cfg as { url?: string }).url ?? ""}|${(cfg as { connectorId?: string }).connectorId ?? ""}|${(cfg as { operation?: string }).operation ?? ""}`
          : "";
      return [
        x.id,
        x.type,
        x.parentId ?? "",
        label,
        (d?.defaultFlowId as string) ?? "",
        `${assign?.type ?? ""}=${assign?.value ?? ""}`,
        implSig,
        `${rule?.binding ?? ""}=${rule?.expression ?? ""}`,
      ].join(":");
    })
    .join("|");
  const e = edges
    .map((x) => {
      const d = x.data as { condition?: string; flowType?: string } | undefined;
      return `${x.id}:${x.source}>${x.target}:${d?.flowType ?? ""}:${d?.condition ?? ""}`;
    })
    .join("|");
  return `${n}##${e}`;
}

type Snapshot = { nodes: Node[]; edges: Edge[]; digest: string };

const selectSnapshot = (s: CanvasState): Snapshot => ({
  nodes: s.nodes,
  edges: s.edges,
  digest: connectivityDigest(s.nodes, s.edges),
});

const eqByDigest = (a: Snapshot, b: Snapshot) => a.digest === b.digest;

/* ─── Shared cache (module-level) ───────────────────────────────────
 * The validation engine is pure: same (nodes, edges) digest → same
 * issue array. So we don't need a per-component memo — one module-level
 * cache serves every caller in the canvas. */
let cachedDigest: string | null = null;
let cachedIssues: ValidationIssue[] = [];
let cachedByNodeId: Map<string, ValidationIssue[]> = new Map();
const EMPTY_ISSUES: ValidationIssue[] = [];

function ensureCache(snapshot: Snapshot): {
  issues: ValidationIssue[];
  byNodeId: Map<string, ValidationIssue[]>;
} {
  if (snapshot.digest !== cachedDigest) {
    cachedDigest = snapshot.digest;
    cachedIssues = runValidation(snapshot.nodes, snapshot.edges);
    const map = new Map<string, ValidationIssue[]>();
    for (const i of cachedIssues) {
      if (!i.nodeId) continue;
      const arr = map.get(i.nodeId) ?? [];
      arr.push(i);
      map.set(i.nodeId, arr);
    }
    cachedByNodeId = map;
  }
  return { issues: cachedIssues, byNodeId: cachedByNodeId };
}

/** Non-hook variant exported for unit tests so they don't need a
 *  React renderer. Same cache as the hook — so a test calling this
 *  twice with the same canvas confirms cache identity, and changing
 *  the structurally-relevant fields produces a fresh array. */
export function getValidationIssues(nodes: Node[], edges: Edge[]): ValidationIssue[] {
  return ensureCache({ nodes, edges, digest: connectivityDigest(nodes, edges) }).issues;
}

/** Non-hook variant of `connectivityDigest` for tests. */
export function digestOf(nodes: Node[], edges: Edge[]): string {
  return connectivityDigest(nodes, edges);
}

/** Returns ALL validation issues for the current canvas. Use this in
 *  the Problems panel, save-button gating, and other "all issues"
 *  consumers. The returned array reference is stable across renders
 *  until the digest changes. */
export function useValidationIssues(): ValidationIssue[] {
  const snapshot = useStoreWithEqualityFn(
    useCanvasStore,
    selectSnapshot,
    eqByDigest,
  );
  return ensureCache(snapshot).issues;
}

/** Returns the validation issues scoped to a single node id. O(1)
 *  lookup against the shared `byNodeId` map, so an N-marker canvas
 *  does 1 validation pass instead of N. */
export function useNodeIssues(nodeId: string): ValidationIssue[] {
  const snapshot = useStoreWithEqualityFn(
    useCanvasStore,
    selectSnapshot,
    eqByDigest,
  );
  const { byNodeId } = ensureCache(snapshot);
  return byNodeId.get(nodeId) ?? EMPTY_ISSUES;
}

/** Test-only — reset the module cache so each test starts clean. */
export function __resetValidationCache(): void {
  cachedDigest = null;
  cachedIssues = [];
  cachedByNodeId = new Map();
}
