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

export function useValidationIssues(): ValidationIssue[] {
  const { nodes, edges, digest } = useStoreWithEqualityFn(
    useCanvasStore,
    selectSnapshot,
    eqByDigest,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => runValidation(nodes, edges), [digest]);
}
