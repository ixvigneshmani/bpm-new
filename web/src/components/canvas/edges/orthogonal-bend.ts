/* ─── Edge orthogonal bend (GAP-04 v2) ───────────────────────────────
 * Replaces the GAP-04 v1 "polyline-waypoints" model with what real
 * BPMN tools (Camunda Modeler, Signavio, bpmn.io) do: edges stay
 * STRICTLY orthogonal, and the user gets ONE draggable handle on the
 * middle segment that slides it perpendicular to itself. The line is
 * always right-angles only — no arbitrary diagonals.
 *
 *   data.bend?: number
 *
 * Semantics (axis derived from source + target handle positions):
 *   - Right/Left source ↔ Right/Left target  →  H-V-H route. `bend`
 *     is the X coordinate of the middle V segment (drag horizontally).
 *   - Top/Bottom source ↔ Top/Bottom target  →  V-H-V route. `bend`
 *     is the Y coordinate of the middle H segment (drag vertically).
 *   - Mixed orientations  →  no bend control (engine falls back to
 *     React Flow's smoothstep autorouting).
 *
 * Engine semantics: projectCanvas() in api/src/engine/engine.service.ts
 * strips edge.data to {condition, isDefault, flowType} — `bend` is
 * intentionally NOT in that allowlist, so two canvases that differ
 * only in `bend` produce the same definitionHash and don't bump the
 * process version. Visual change ≠ semantic change.
 *
 * Pure module — tested without React. ────────────────────────────── */

import { Position } from "@xyflow/react";

const SNAP_STEP = 16;

export type BendAxis = "x" | "y" | null;

/** Decide which axis the middle segment is "free" along, based on the
 *  handle positions React Flow gave us for the edge endpoints. */
export function getBendAxis(
  sourcePos: Position | string | undefined,
  targetPos: Position | string | undefined,
): BendAxis {
  const isHoriz = (p: unknown) => p === Position.Left || p === Position.Right || p === "left" || p === "right";
  const isVert = (p: unknown) => p === Position.Top || p === Position.Bottom || p === "top" || p === "bottom";
  if (isHoriz(sourcePos) && isHoriz(targetPos)) return "x";
  if (isVert(sourcePos) && isVert(targetPos)) return "y";
  return null;
}

/** Safe-read the `bend` value off an edge.data blob. Returns undefined
 *  when missing or malformed (NaN, Infinity, non-number). */
export function getEdgeBend(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const b = (data as { bend?: unknown }).bend;
  return typeof b === "number" && Number.isFinite(b) ? b : undefined;
}

/** Default bend value when the user hasn't dragged yet — middle of
 *  source/target along the controlled axis. */
export function getAutoBend(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  axis: BendAxis,
): number {
  if (axis === "x") return (sx + tx) / 2;
  if (axis === "y") return (sy + ty) / 2;
  return 0;
}

/** Snap a bend value to the canvas grid (matches the 16px grid the
 *  rest of the canvas uses). */
export function snapBend(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / SNAP_STEP) * SNAP_STEP;
}

/** SVG path string for the orthogonal route. Three straight segments
 *  for H-V-H or V-H-V, or a single straight line for the mixed-axis
 *  fallback (caller should prefer React Flow's smoothstep then). */
export function buildOrthogonalPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  axis: BendAxis,
  bendValue: number,
): string {
  if (axis === "x") {
    return `M ${sx} ${sy} L ${bendValue} ${sy} L ${bendValue} ${ty} L ${tx} ${ty}`;
  }
  if (axis === "y") {
    return `M ${sx} ${sy} L ${sx} ${bendValue} L ${tx} ${bendValue} L ${tx} ${ty}`;
  }
  return `M ${sx} ${sy} L ${tx} ${ty}`;
}

/** Centre of the middle segment — where the drag handle sits. For
 *  axis="x" the handle is on the vertical segment at X=bend, halfway
 *  between sy and ty. For axis="y" it's on the horizontal segment. */
export function getBendHandlePosition(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  axis: BendAxis,
  bendValue: number,
): { x: number; y: number } {
  if (axis === "x") return { x: bendValue, y: (sy + ty) / 2 };
  if (axis === "y") return { x: (sx + tx) / 2, y: bendValue };
  return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
}

/** Anchor for the edge label — slightly above the middle segment so
 *  it doesn't sit on the line OR on the drag handle. */
export function getOrthogonalLabelPoint(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  axis: BendAxis,
  bendValue: number,
): { x: number; y: number } {
  // Same as the handle for now — the edge component offsets the label
  // visually via CSS transform so it doesn't overlap. Centralising
  // the source of truth here so both stay in sync.
  return getBendHandlePosition(sx, sy, tx, ty, axis, bendValue);
}
