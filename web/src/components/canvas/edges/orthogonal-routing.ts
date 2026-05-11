/* ─── Orthogonal multi-segment edge routing (GAP-04 v3) ──────────────
 * Edges are STRICTLY orthogonal (right angles only). The user gets a
 * draggable handle on every segment that slides it perpendicular to
 * its own direction:
 *   - Horizontal segment → drag ↕ vertically
 *   - Vertical segment   → drag ↔ horizontally
 *
 * Drag math depends on whether the segment is interior or anchored
 * to source/target:
 *   - Interior (both endpoints are user waypoints): slide both
 *     endpoints by the perpendicular delta; segment moves bodily,
 *     adjacent segments stretch/shrink to compensate.
 *   - Source-anchored (first segment, source.point fixed): can't
 *     simply move; instead INSERT two new waypoints to materialise the
 *     perpendicular offset. Same as Camunda Modeler / bpmn.io.
 *   - Target-anchored (last segment): symmetric insertion near target.
 *
 * Data model — same shape as v1, totally different semantics:
 *   edge.data.waypoints?: Array<{ x: number; y: number }>
 * Invariant: every consecutive pair of (source + waypoints + target)
 * shares an X or Y coordinate, so the path is strictly orthogonal.
 *
 * 0 waypoints = auto-route (H-V-H for right/left handles, V-H-V for
 * top/bottom). The auto-corners are NOT stored; they're computed on
 * render. On the user's first drag we MATERIALISE the auto-corners
 * into waypoints, then all subsequent drags work on explicit data.
 *
 * Engine semantics: projectCanvas strips edge.data to {condition,
 * isDefault, flowType}, so waypoints are intentionally dropped from
 * the engine projection — visual change ≠ semantic change, no
 * version bump on save.
 * ──────────────────────────────────────────────────────────────────── */

import { Position } from "@xyflow/react";

export type Waypoint = { x: number; y: number };
export type SegmentDirection = "H" | "V";

export type Segment = {
  /** Index in the effective points list (source + waypoints + target).
   *  Segment i goes from points[i] to points[i+1]. */
  index: number;
  a: Waypoint;
  b: Waypoint;
  direction: SegmentDirection;
  /** True when one endpoint is the source point (always segment 0). */
  isSourceAnchored: boolean;
  /** True when one endpoint is the target point (always last segment). */
  isTargetAnchored: boolean;
  midpoint: Waypoint;
};

const SNAP_STEP = 16;
const ANCHOR_INSERT_OFFSET = 30;

// ── Pure helpers ────────────────────────────────────────────────────

/** Safe-parse edge.data.waypoints. Returns [] for missing / malformed
 *  data. Filters out non-numeric coordinates so a bad client write
 *  doesn't NaN-crash the renderer. */
export function getEdgeWaypoints(data: unknown): Waypoint[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as { waypoints?: unknown }).waypoints;
  if (!Array.isArray(raw)) return [];
  const out: Waypoint[] = [];
  for (const w of raw) {
    if (
      w &&
      typeof w === "object" &&
      Number.isFinite((w as Waypoint).x) &&
      Number.isFinite((w as Waypoint).y)
    ) {
      out.push({ x: (w as Waypoint).x, y: (w as Waypoint).y });
    }
  }
  return out;
}

export function snapValue(v: number, step = SNAP_STEP): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v / step) * step;
}

export function snapPoint(p: Waypoint, step = SNAP_STEP): Waypoint {
  return { x: snapValue(p.x, step), y: snapValue(p.y, step) };
}

const POS_LEFT = (p: unknown) => p === Position.Left || p === "left";
const POS_RIGHT = (p: unknown) => p === Position.Right || p === "right";
const POS_TOP = (p: unknown) => p === Position.Top || p === "top";
const POS_BOTTOM = (p: unknown) => p === Position.Bottom || p === "bottom";
const isHorizontalHandle = (p: unknown) => POS_LEFT(p) || POS_RIGHT(p);
const isVerticalHandle = (p: unknown) => POS_TOP(p) || POS_BOTTOM(p);

/** "Out-of-source" unit vector — the direction the wire leaves the
 *  source handle. Used to place the offset corner during source-
 *  anchored drag insertion. */
export function sourceUnitVector(
  sourcePos: Position | string | undefined,
): { dx: number; dy: number } {
  if (POS_RIGHT(sourcePos)) return { dx: 1, dy: 0 };
  if (POS_LEFT(sourcePos)) return { dx: -1, dy: 0 };
  if (POS_BOTTOM(sourcePos)) return { dx: 0, dy: 1 };
  if (POS_TOP(sourcePos)) return { dx: 0, dy: -1 };
  return { dx: 1, dy: 0 };
}

/** "Into-target" unit vector — the direction the wire approaches the
 *  target. Used to place the offset corner during target-anchored
 *  drag insertion. (Vector points FROM the corner TO the target.) */
export function targetUnitVector(
  targetPos: Position | string | undefined,
): { dx: number; dy: number } {
  // The wire approaches a left-handle target FROM the right, so the
  // "into" direction is +X. Same logic per side.
  if (POS_LEFT(targetPos)) return { dx: 1, dy: 0 };
  if (POS_RIGHT(targetPos)) return { dx: -1, dy: 0 };
  if (POS_TOP(targetPos)) return { dx: 0, dy: 1 };
  if (POS_BOTTOM(targetPos)) return { dx: 0, dy: -1 };
  return { dx: 1, dy: 0 };
}

/** Whether source + target handle positions form a clean orthogonal
 *  route (both H or both V). Mixed orientations fall back to
 *  smoothstep — no draggable handles, no bend control. */
export function canRouteOrthogonally(
  sourcePos: Position | string | undefined,
  targetPos: Position | string | undefined,
): boolean {
  if (isHorizontalHandle(sourcePos) && isHorizontalHandle(targetPos)) return true;
  if (isVerticalHandle(sourcePos) && isVerticalHandle(targetPos)) return true;
  return false;
}

/** Auto-corners for an edge with no user waypoints. Empty when the
 *  source/target are aligned and a single straight segment suffices. */
export function computeAutoWaypoints(
  source: Waypoint,
  target: Waypoint,
  sourcePos: Position | string | undefined,
  targetPos: Position | string | undefined,
): Waypoint[] {
  if (!canRouteOrthogonally(sourcePos, targetPos)) return [];

  if (isHorizontalHandle(sourcePos)) {
    // H-V-H. Corners at (midX, sy) and (midX, ty). Skip if sy==ty
    // (single H segment suffices).
    if (source.y === target.y) return [];
    const midX = (source.x + target.x) / 2;
    return [
      { x: midX, y: source.y },
      { x: midX, y: target.y },
    ];
  }

  // Vertical handles: V-H-V. Corners at (sx, midY) and (tx, midY).
  if (source.x === target.x) return [];
  const midY = (source.y + target.y) / 2;
  return [
    { x: source.x, y: midY },
    { x: target.x, y: midY },
  ];
}

/** Full point list for rendering / drag math:
 *  [source, ...effectiveWaypoints, target]. If `waypoints` is empty,
 *  auto-corners are inserted; otherwise the user's waypoints are
 *  trusted to maintain the orthogonal invariant. */
export function effectivePoints(
  source: Waypoint,
  waypoints: Waypoint[],
  target: Waypoint,
  sourcePos: Position | string | undefined,
  targetPos: Position | string | undefined,
): Waypoint[] {
  const intermediate =
    waypoints.length > 0
      ? waypoints
      : computeAutoWaypoints(source, target, sourcePos, targetPos);
  return [source, ...intermediate, target];
}

/** Build the segment list (with direction + anchor flags + midpoint)
 *  from an effective point list. */
export function getSegments(points: Waypoint[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    // Direction: H if same Y, V if same X. If neither (invariant
    // broken), call it H — but treat as a degenerate fallback rather
    // than a real configuration we expect to hit.
    const direction: SegmentDirection = a.y === b.y ? "H" : "V";
    segs.push({
      index: i,
      a,
      b,
      direction,
      isSourceAnchored: i === 0,
      isTargetAnchored: i === points.length - 2,
      midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    });
  }
  return segs;
}

/** SVG path string: M source L p1 L p2 ... L target. Straight
 *  orthogonal segments. */
export function buildOrthogonalPath(points: Waypoint[]): string {
  if (points.length === 0) return "";
  const parts: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length; i++) {
    parts.push(`L ${points[i].x} ${points[i].y}`);
  }
  return parts.join(" ");
}

/** Drop redundant intermediate corners from the path. A corner is
 *  redundant when:
 *    - It's identical to its predecessor (zero-length segment), OR
 *    - The segments before AND after it run in the same direction
 *      (collinear horizontal or collinear vertical), meaning the
 *      corner is just a midpoint on a straight line.
 *  Operates on the effective points list (source + waypoints + target)
 *  but only ever removes INTERMEDIATE points — never source or target.
 *  Returns the simplified waypoints (without source/target). */
export function simplifyWaypoints(
  source: Waypoint,
  waypoints: Waypoint[],
  target: Waypoint,
): Waypoint[] {
  if (waypoints.length === 0) return waypoints;
  const effective: Waypoint[] = [source, ...waypoints, target];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < effective.length - 1; i++) {
      const prev = effective[i - 1];
      const curr = effective[i];
      const next = effective[i + 1];
      // Duplicate of either neighbour → zero-length segment, drop curr.
      if (
        (prev.x === curr.x && prev.y === curr.y) ||
        (curr.x === next.x && curr.y === next.y)
      ) {
        effective.splice(i, 1);
        changed = true;
        break;
      }
      // Collinear horizontal — prev, curr, next all share Y → curr
      // is a midpoint on a single straight H segment.
      if (prev.y === curr.y && curr.y === next.y) {
        effective.splice(i, 1);
        changed = true;
        break;
      }
      // Collinear vertical
      if (prev.x === curr.x && curr.x === next.x) {
        effective.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return effective.slice(1, -1);
}

/** True when the simplified waypoints exactly match what the
 *  auto-route would produce — meaning the user has dragged everything
 *  back into the default position. Caller should then clear
 *  edge.data.waypoints so the edge returns to "auto" mode and follows
 *  node movements again. */
export function isAutoRoute(
  source: Waypoint,
  waypoints: Waypoint[],
  target: Waypoint,
  sourcePos: Position | string | undefined,
  targetPos: Position | string | undefined,
): boolean {
  const auto = computeAutoWaypoints(source, target, sourcePos, targetPos);
  if (waypoints.length !== auto.length) return false;
  for (let i = 0; i < waypoints.length; i++) {
    if (waypoints[i].x !== auto[i].x || waypoints[i].y !== auto[i].y) {
      return false;
    }
  }
  return true;
}

// ── Drag math ───────────────────────────────────────────────────────

/** Result of dragging a segment perpendicular to its own direction.
 *  Returns the NEW waypoints array. May insert new corners when the
 *  dragged segment was anchored to source/target. */
export function dragSegment(args: {
  /** Current user waypoints (may be empty if on auto-route). */
  waypoints: Waypoint[];
  /** Index in the effective-segments list (which is computed from
   *  effectivePoints, so it sees auto-corners too if waypoints is
   *  empty). */
  segmentIndex: number;
  /** New perpendicular coordinate (snapped) the cursor wants the
   *  segment to be at. For H segment this is the new Y; for V the
   *  new X. */
  perpendicularValue: number;
  source: Waypoint;
  target: Waypoint;
  sourcePos: Position | string | undefined;
  targetPos: Position | string | undefined;
}): Waypoint[] {
  const { waypoints, segmentIndex, perpendicularValue, source, target, sourcePos, targetPos } = args;

  // Materialise auto-corners on first drag — every subsequent drag
  // works on explicit waypoints.
  const working =
    waypoints.length > 0
      ? waypoints.slice()
      : computeAutoWaypoints(source, target, sourcePos, targetPos);

  const points = [source, ...working, target];
  const segs = getSegments(points);
  if (segmentIndex < 0 || segmentIndex >= segs.length) return working;
  const seg = segs[segmentIndex];
  const isH = seg.direction === "H";

  // Map segment index → indices into the WORKING waypoints array.
  // points[0] = source; points[1..N] = working[0..N-1]; points[N+1] = target.
  const wpStart = seg.index - 1; // working index of seg.a, or -1 if seg.a is source
  const wpEnd = seg.index; // working index of seg.b, or working.length if seg.b is target

  let next: Waypoint[] | null = null;

  // Case A — interior: both endpoints are user waypoints.
  if (!seg.isSourceAnchored && !seg.isTargetAnchored) {
    if (wpStart < 0 || wpEnd >= working.length) return working; // sanity
    if (isH) {
      working[wpStart] = { ...working[wpStart], y: perpendicularValue };
      working[wpEnd] = { ...working[wpEnd], y: perpendicularValue };
    } else {
      working[wpStart] = { ...working[wpStart], x: perpendicularValue };
      working[wpEnd] = { ...working[wpEnd], x: perpendicularValue };
    }
    next = working;
  }

  // Case B — source-anchored: insert two new corners after the source.
  if (!next && seg.isSourceAnchored && !seg.isTargetAnchored) {
    const dir = sourceUnitVector(sourcePos);
    const offset_a: Waypoint = {
      x: source.x + ANCHOR_INSERT_OFFSET * dir.dx,
      y: source.y + ANCHOR_INSERT_OFFSET * dir.dy,
    };
    const offset_b: Waypoint = isH
      ? { x: offset_a.x, y: perpendicularValue }
      : { x: perpendicularValue, y: offset_a.y };
    const updatedFirstWp: Waypoint =
      wpEnd < working.length
        ? isH
          ? { ...working[wpEnd], y: perpendicularValue }
          : { ...working[wpEnd], x: perpendicularValue }
        : isH
          ? { x: target.x, y: perpendicularValue }
          : { x: perpendicularValue, y: target.y };
    next = [offset_a, offset_b, updatedFirstWp, ...working.slice(wpEnd + 1)];
  }

  // Case C — target-anchored: insert two new corners before the target.
  if (!next && seg.isTargetAnchored && !seg.isSourceAnchored) {
    const dir = targetUnitVector(targetPos);
    const offset_b: Waypoint = {
      x: target.x - ANCHOR_INSERT_OFFSET * dir.dx,
      y: target.y - ANCHOR_INSERT_OFFSET * dir.dy,
    };
    const offset_a: Waypoint = isH
      ? { x: offset_b.x, y: perpendicularValue }
      : { x: perpendicularValue, y: offset_b.y };
    const updatedLastWp: Waypoint =
      wpStart >= 0
        ? isH
          ? { ...working[wpStart], y: perpendicularValue }
          : { ...working[wpStart], x: perpendicularValue }
        : isH
          ? { x: source.x, y: perpendicularValue }
          : { x: perpendicularValue, y: source.y };
    next = [...working.slice(0, wpStart), updatedLastWp, offset_a, offset_b];
  }

  // Case D — both anchored: refused for v3.0 (would require 4-corner
  // insertion). User can right-click → Reset routing.
  if (!next) return working;

  // Simplify: drop collinear and duplicate corners. After dragging the
  // user-controlled segment back into alignment with what the auto-
  // route would produce, this collapses the path back to default —
  // the "snap back to a clean line" behavior real BPM tools have.
  const simplified = simplifyWaypoints(source, next, target);

  // Auto-route equivalence: if every remaining corner matches an
  // auto-corner exactly, signal "return to auto" by emitting [].
  // The caller treats empty waypoints as "use auto-route", and the
  // edge tracks node moves dynamically again.
  if (isAutoRoute(source, simplified, target, sourcePos, targetPos)) {
    return [];
  }
  return simplified;
}
