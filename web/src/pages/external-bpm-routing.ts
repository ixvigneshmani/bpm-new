/* ─── External-BPM orthogonal obstacle-avoiding edge router ───────────
 * "GPS for arrows." webMethods authored its edge bendpoints for tiny
 * (~93×60) icons; the External BPM preview re-renders those steps as
 * full-size BPMN boxes (240×130 tasks, 100×100 gateways), so an arrow
 * that threaded cleanly between small icons can now cut straight THROUGH
 * a box — most visibly when a task sits directly above/below another and
 * a feedback edge has to reach the lower one's top.
 *
 * This router replaces the authored bendpoints with a freshly computed
 * strictly-orthogonal path that steers around every OTHER node box. It
 * is conservative on purpose:
 *
 *   • If the simple auto-route between the AUTHORED handles is already
 *     clean (no box in the way), we return NOTHING (empty waypoints) so
 *     the edge renders exactly as it does today — zero behaviour change
 *     for the ~90% of edges that were never a problem.
 *   • Only when that simple route is blocked do we invoke the lattice
 *     router, and even then we keep the SOURCE side fixed (so a node's
 *     several outgoing edges stay fanned out across different sides, the
 *     way webMethods deliberately authored them) and only re-pick the
 *     TARGET entry side when the authored one is unreachable.
 *
 * The lattice/A* technique is the standard orthogonal-connector routing
 * used by draw.io / yEd: candidate grid lines are drawn along every
 * obstacle edge (inflated by a clearance), an A* with a turn-penalty
 * finds the shortest path with the fewest bends, and collinear corners
 * are simplified away.
 *
 * Coordinates are FLOW coordinates (already multiplied by SCALE), i.e.
 * the same space React Flow positions nodes and handles in.
 * ──────────────────────────────────────────────────────────────────── */

export type Side = "left" | "right" | "top" | "bottom";

/** Axis-aligned node box in flow coords: top-left corner + size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RouteInput {
  source: Box;
  target: Box;
  /** Authored source side — kept fixed to preserve out-edge fan-out. */
  sourceSide: Side;
  /** Authored target side — preferred, re-picked only if blocked. */
  targetSide: Side;
  /** Every OTHER node box (not source/target). */
  obstacles: Box[];
}

export interface RouteResult {
  sourceSide: Side;
  targetSide: Side;
  /** Interior waypoints (EXCLUDING the source/target handle points,
   *  which the renderer adds). Empty = let the renderer auto-route. */
  waypoints: Array<{ x: number; y: number }>;
  /** True when we deviated from the simple authored auto-route. */
  rerouted: boolean;
}

type Pt = { x: number; y: number };

// ── Tunables ────────────────────────────────────────────────────────
/** Gap kept between a wire and any box it routes past. */
const CLEAR = 12;
/** Strict-interior epsilon: a wire running exactly along an inflated
 *  boundary line is allowed; only genuine interior crossings block. */
const EPS = 0.5;
/** Stub length a wire travels straight out of a node before its first
 *  turn (keeps the arrow from kinking right at the box edge). */
const PUSH = 24;
/** Cost added per 90° bend so the router prefers straighter paths. */
const TURN_PENALTY = 60;
/** Safety cap on lattice size; beyond this we bail to a simple route. */
const MAX_LATTICE = 40000;
/** When rerouting, only obstacles within the endpoints' bounding box
 *  inflated by this margin are considered. Keeps the A* lattice small
 *  and bounded on large diagrams (draw.io/yEd "routing window"). The
 *  margin must be generous enough to admit a realistic detour around a
 *  blocker — a few box-heights. */
const WINDOW_MARGIN = 420;

// ── Geometry helpers ────────────────────────────────────────────────

function center(b: Box): Pt {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** The point on a box's boundary where the given side's handle sits. */
export function handlePoint(b: Box, s: Side): Pt {
  const c = center(b);
  switch (s) {
    case "left":
      return { x: b.x, y: c.y };
    case "right":
      return { x: b.x + b.w, y: c.y };
    case "top":
      return { x: c.x, y: b.y };
    case "bottom":
      return { x: c.x, y: b.y + b.h };
  }
}

/** Unit vector pointing OUT of a box through the given side. */
function outward(s: Side): Pt {
  switch (s) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
  }
}

function orient(s: Side): "H" | "V" {
  return s === "left" || s === "right" ? "H" : "V";
}

/** True when the axis-aligned segment a→b passes strictly through the
 *  interior of any obstacle (touching an inflated boundary is fine). */
function segBlocked(a: Pt, b: Pt, obs: Box[]): boolean {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  for (const o of obs) {
    const ol = o.x;
    const or = o.x + o.w;
    const ot = o.y;
    const ob = o.y + o.h;
    if (
      x2 > ol + EPS &&
      x1 < or - EPS &&
      y2 > ot + EPS &&
      y1 < ob - EPS
    ) {
      return true;
    }
  }
  return false;
}

/** True when ANY segment of a polyline is blocked. */
function pathBlocked(points: Pt[], obs: Box[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (segBlocked(points[i], points[i + 1], obs)) return true;
  }
  return false;
}

/** Does the polyline's last meaningful segment approach the target along
 *  the target side's INWARD normal? Iterates back past zero-length tail
 *  segments (mixedProxy can produce duplicates), so a degenerate end
 *  doesn't accidentally pass. Used by routeEdge to detect "geometrically
 *  clean but the arrowhead lands at the wrong angle" cases — typically a
 *  smoothstep that collapsed into a flat L because the source's H-handle
 *  Y matched the target's t-top Y. */
function tangentMatchesSide(points: Pt[], tSide: Side): boolean {
  if (points.length < 2) return false;
  let i = points.length - 1;
  let dx = 0;
  let dy = 0;
  while (i > 0) {
    dx = points[i].x - points[i - 1].x;
    dy = points[i].y - points[i - 1].y;
    if (Math.hypot(dx, dy) >= 0.5) break;
    i -= 1;
  }
  if (Math.hypot(dx, dy) < 0.5) return false;
  const out = outward(tSide);
  // Inward = -outward. Path tangent should point IN to the target.
  const inX = -out.x;
  const inY = -out.y;
  const len = Math.hypot(dx, dy);
  const cos = (dx * inX + dy * inY) / len;
  // ~10° tolerance — generous enough for floating-point drift, strict
  // enough to catch a 90° degenerate landing.
  return cos > 0.98;
}

function uniqSorted(vals: number[]): number[] {
  const out = Array.from(new Set(vals.map((v) => Math.round(v * 100) / 100)));
  out.sort((a, b) => a - b);
  return out;
}

/** Drop duplicate and collinear interior corners from a polyline. */
export function simplify(points: Pt[]): Pt[] {
  if (points.length <= 2) return points.slice();
  const pts = points.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i - 1];
      const c = pts[i];
      const n = pts[i + 1];
      const dup =
        (near(p.x, c.x) && near(p.y, c.y)) ||
        (near(c.x, n.x) && near(c.y, n.y));
      const collinearH = near(p.y, c.y) && near(c.y, n.y);
      const collinearV = near(p.x, c.x) && near(c.x, n.x);
      if (dup || collinearH || collinearV) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1;
}

// ── Simple (non-routed) auto-corners ────────────────────────────────

/** Interior corners for a plain auto-route between two handle points,
 *  or null when the sides are mixed-orientation (renderer draws a
 *  smoothstep curve there — approximated with an L for the clean test).
 */
function autoCorners(
  srcPt: Pt,
  sSide: Side,
  dstPt: Pt,
  tSide: Side,
): Pt[] | null {
  const so = orient(sSide);
  const to = orient(tSide);
  if (so === "H" && to === "H") {
    if (near(srcPt.y, dstPt.y)) return [];
    const midX = (srcPt.x + dstPt.x) / 2;
    return [
      { x: midX, y: srcPt.y },
      { x: midX, y: dstPt.y },
    ];
  }
  if (so === "V" && to === "V") {
    if (near(srcPt.x, dstPt.x)) return [];
    const midY = (srcPt.y + dstPt.y) / 2;
    return [
      { x: srcPt.x, y: midY },
      { x: dstPt.x, y: midY },
    ];
  }
  return null; // mixed orientation
}

/** Offset React Flow's getSmoothStepPath pushes a wire straight out of a
 *  handle before its first turn (its `offset` default). We mirror it so
 *  the clean-test polyline lands where the rendered curve actually does. */
const SMOOTH_OFFSET = 20;

/** Faithful poly-line for a MIXED-orientation edge (one handle
 *  horizontal, one vertical) as React Flow's smoothstep actually draws
 *  it. This is a 1:1 port of @xyflow/system's `getPoints` (the routine
 *  behind getSmoothStepPath) with offset=SMOOTH_OFFSET, stepPosition=0.5
 *  and no externally-supplied center — i.e. exactly the parameters
 *  BpmnSequenceEdge passes for a mixed edge. Hand-approximating the
 *  smoothstep's gapped-exit / source-vs-target split was the source of
 *  under-detected crossings (the V-source / H-target Z-bend in
 *  particular); replicating the real corner-selection logic makes the
 *  clean-test agree with what gets rendered, so a genuinely blocked edge
 *  always triggers a reroute to same-orientation handles (whose path we
 *  control with waypoints). */
function mixedProxy(srcPt: Pt, sSide: Side, dstPt: Pt, tSide: Side): Pt[] {
  const offset = SMOOTH_OFFSET;
  const stepPosition = 0.5;
  const sourceDir = outward(sSide);
  const targetDir = outward(tSide);
  const sourceGapped = { x: srcPt.x + sourceDir.x * offset, y: srcPt.y + sourceDir.y * offset };
  const targetGapped = { x: dstPt.x + targetDir.x * offset, y: dstPt.y + targetDir.y * offset };

  // getDirection
  const dir =
    orient(sSide) === "H"
      ? sourceGapped.x < targetGapped.x
        ? { x: 1, y: 0 }
        : { x: -1, y: 0 }
      : sourceGapped.y < targetGapped.y
        ? { x: 0, y: 1 }
        : { x: 0, y: -1 };
  const dirAccessor: "x" | "y" = dir.x !== 0 ? "x" : "y";
  const currDir = dir[dirAccessor];

  let points: Pt[] = [];
  const sourceGapOffset = { x: 0, y: 0 };
  const targetGapOffset = { x: 0, y: 0 };

  if (sourceDir[dirAccessor] * targetDir[dirAccessor] === -1) {
    // Opposite handle positions.
    let centerX: number;
    let centerY: number;
    if (dirAccessor === "x") {
      centerX = sourceGapped.x + (targetGapped.x - sourceGapped.x) * stepPosition;
      centerY = (sourceGapped.y + targetGapped.y) / 2;
    } else {
      centerX = (sourceGapped.x + targetGapped.x) / 2;
      centerY = sourceGapped.y + (targetGapped.y - sourceGapped.y) * stepPosition;
    }
    const verticalSplit: Pt[] = [
      { x: centerX, y: sourceGapped.y },
      { x: centerX, y: targetGapped.y },
    ];
    const horizontalSplit: Pt[] = [
      { x: sourceGapped.x, y: centerY },
      { x: targetGapped.x, y: centerY },
    ];
    if (sourceDir[dirAccessor] === currDir) {
      points = dirAccessor === "x" ? verticalSplit : horizontalSplit;
    } else {
      points = dirAccessor === "x" ? horizontalSplit : verticalSplit;
    }
  } else {
    const sourceTarget: Pt[] = [{ x: sourceGapped.x, y: targetGapped.y }];
    const targetSource: Pt[] = [{ x: targetGapped.x, y: sourceGapped.y }];
    if (dirAccessor === "x") {
      points = sourceDir.x === currDir ? targetSource : sourceTarget;
    } else {
      points = sourceDir.y === currDir ? sourceTarget : targetSource;
    }
    if (sSide === tSide) {
      const diff = Math.abs(srcPt[dirAccessor] - dstPt[dirAccessor]);
      if (diff <= offset) {
        const gapOffset = Math.min(offset - 1, offset - diff);
        if (sourceDir[dirAccessor] === currDir) {
          sourceGapOffset[dirAccessor] =
            (sourceGapped[dirAccessor] > srcPt[dirAccessor] ? -1 : 1) * gapOffset;
        } else {
          targetGapOffset[dirAccessor] =
            (targetGapped[dirAccessor] > dstPt[dirAccessor] ? -1 : 1) * gapOffset;
        }
      }
    } else {
      // Mixed handle positions (e.g. Bottom -> Left): decide whether the
      // single corner is taken from the source's or the target's axis.
      const opp: "x" | "y" = dirAccessor === "x" ? "y" : "x";
      const isSameDir = sourceDir[dirAccessor] === targetDir[opp];
      const sourceGtTargetOppo = sourceGapped[opp] > targetGapped[opp];
      const sourceLtTargetOppo = sourceGapped[opp] < targetGapped[opp];
      const flipSourceTarget =
        (sourceDir[dirAccessor] === 1 &&
          ((!isSameDir && sourceGtTargetOppo) || (isSameDir && sourceLtTargetOppo))) ||
        (sourceDir[dirAccessor] !== 1 &&
          ((!isSameDir && sourceLtTargetOppo) || (isSameDir && sourceGtTargetOppo)));
      if (flipSourceTarget) {
        points = dirAccessor === "x" ? sourceTarget : targetSource;
      }
    }
  }

  const gappedSource = {
    x: sourceGapped.x + sourceGapOffset.x,
    y: sourceGapped.y + sourceGapOffset.y,
  };
  const gappedTarget = {
    x: targetGapped.x + targetGapOffset.x,
    y: targetGapped.y + targetGapOffset.y,
  };
  const first = points[0];
  const last = points[points.length - 1];
  return [
    srcPt,
    ...(gappedSource.x !== first.x || gappedSource.y !== first.y ? [gappedSource] : []),
    ...points,
    ...(gappedTarget.x !== last.x || gappedTarget.y !== last.y ? [gappedTarget] : []),
    dstPt,
  ];
}

// ── Lattice A* ──────────────────────────────────────────────────────

/** Route strictly-orthogonally from s2 to d2 avoiding obs (which here
 *  INCLUDES the source/target boxes so the wire can't cross its own
 *  endpoints). Returns the point list s2…d2 inclusive, or null. */
function latticeRoute(s2: Pt, d2: Pt, obs: Box[]): Pt[] | null {
  const xs = uniqSorted([
    s2.x,
    d2.x,
    ...obs.flatMap((o) => [o.x - CLEAR, o.x + o.w + CLEAR]),
  ]);
  const ys = uniqSorted([
    s2.y,
    d2.y,
    ...obs.flatMap((o) => [o.y - CLEAR, o.y + o.h + CLEAR]),
  ]);
  if (xs.length * ys.length > MAX_LATTICE) return null;

  const xIndex = new Map(xs.map((v, i) => [v, i]));
  const yIndex = new Map(ys.map((v, i) => [v, i]));
  const sx = xIndex.get(round2(s2.x));
  const sy = yIndex.get(round2(s2.y));
  const gx = xIndex.get(round2(d2.x));
  const gy = yIndex.get(round2(d2.y));
  if (sx == null || sy == null || gx == null || gy == null) return null;

  const W = xs.length;
  const pt = (ix: number, iy: number): Pt => ({ x: xs[ix], y: ys[iy] });

  // A* over states keyed by (ix, iy, axis). axis: 0=none,1=H,2=V.
  type State = { ix: number; iy: number; axis: number };
  const key = (ix: number, iy: number, axis: number) =>
    (iy * W + ix) * 3 + axis;
  const goalH = (ix: number, iy: number) =>
    Math.abs(xs[ix] - xs[gx]) + Math.abs(ys[iy] - ys[gy]);

  const startKey = key(sx, sy, 0);
  const gScore = new Map<number, number>([[startKey, 0]]);
  const came = new Map<number, { k: number; ix: number; iy: number }>();
  // Tiny binary heap.
  const heap: Array<{ f: number; s: State }> = [];
  const push = (f: number, s: State) => {
    heap.push({ f, s });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  push(goalH(sx, sy), { ix: sx, iy: sy, axis: 0 });
  const neighbours = [
    { dx: 1, dy: 0, axis: 1 },
    { dx: -1, dy: 0, axis: 1 },
    { dx: 0, dy: 1, axis: 2 },
    { dx: 0, dy: -1, axis: 2 },
  ];

  while (heap.length) {
    const { s } = pop();
    const ck = key(s.ix, s.iy, s.axis);
    const cg = gScore.get(ck);
    if (cg == null) continue;
    if (s.ix === gx && s.iy === gy) {
      // Reconstruct.
      const path: Pt[] = [];
      let k = ck;
      let cur = { ix: s.ix, iy: s.iy };
      for (;;) {
        path.push(pt(cur.ix, cur.iy));
        const prev = came.get(k);
        if (!prev) break;
        k = prev.k;
        cur = { ix: prev.ix, iy: prev.iy };
      }
      path.reverse();
      return path;
    }
    for (const nb of neighbours) {
      const nx = s.ix + nb.dx;
      const ny = s.iy + nb.dy;
      if (nx < 0 || nx >= xs.length || ny < 0 || ny >= ys.length) continue;
      const a = pt(s.ix, s.iy);
      const b = pt(nx, ny);
      if (segBlocked(a, b, obs)) continue;
      const stepLen = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const turn = s.axis !== 0 && s.axis !== nb.axis ? TURN_PENALTY : 0;
      const tentative = cg + stepLen + turn;
      const nk = key(nx, ny, nb.axis);
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tentative);
        came.set(nk, { k: ck, ix: s.ix, iy: s.iy });
        push(tentative + goalH(nx, ny), { ix: nx, iy: ny, axis: nb.axis });
      }
    }
  }
  return null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Obstacles relevant to routing between `source` and `target`: those
 *  intersecting the endpoints' combined bounding box inflated by
 *  WINDOW_MARGIN. Far-away boxes can't be in the corridor, so dropping
 *  them keeps the lattice bounded (and fast) on large diagrams. */
function windowObstacles(source: Box, target: Box, obstacles: Box[]): Box[] {
  const minX = Math.min(source.x, target.x) - WINDOW_MARGIN;
  const minY = Math.min(source.y, target.y) - WINDOW_MARGIN;
  const maxX = Math.max(source.x + source.w, target.x + target.w) + WINDOW_MARGIN;
  const maxY = Math.max(source.y + source.h, target.y + target.h) + WINDOW_MARGIN;
  return obstacles.filter(
    (o) =>
      o.x < maxX && o.x + o.w > minX && o.y < maxY && o.y + o.h > minY,
  );
}

function pathLength(points: Pt[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  }
  return len;
}

function bendCount(points: Pt[]): number {
  let bends = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const ax = near(points[i - 1].x, points[i].x) ? "V" : "H";
    const bx = near(points[i].x, points[i + 1].x) ? "V" : "H";
    if (ax !== bx) bends++;
  }
  return bends;
}

/** Attempt a routed path for a specific (sourceSide, targetSide) pair.
 *  Returns interior waypoints (excl. handle points) + a cost, or null. */
function tryRoute(
  source: Box,
  sSide: Side,
  target: Box,
  tSide: Side,
  obstacles: Box[],
): { waypoints: Pt[]; cost: number } | null {
  const srcPt = handlePoint(source, sSide);
  const dstPt = handlePoint(target, tSide);
  const so = outward(sSide);
  const to = outward(tSide);
  const s2 = { x: srcPt.x + so.x * PUSH, y: srcPt.y + so.y * PUSH };
  const d2 = { x: dstPt.x + to.x * PUSH, y: dstPt.y + to.y * PUSH };

  const obsWithEnds = [...obstacles, source, target];
  const mid = latticeRoute(s2, d2, obsWithEnds);
  if (!mid) return null;

  const full = simplify([srcPt, ...mid, dstPt]);
  // Reject if the assembled path still clips a real obstacle (the stubs
  // are not lattice-tested, so verify end-to-end against OTHER boxes).
  if (pathBlocked(full, obstacles)) return null;

  const cost = bendCount(full) * TURN_PENALTY + pathLength(full);
  return { waypoints: full.slice(1, -1), cost };
}

// ── Public entry ────────────────────────────────────────────────────

const SIDE_TO_HANDLE: Record<Side, { s: string; t: string }> = {
  left: { s: "s-left", t: "t-left" },
  right: { s: "s-right", t: "t-right" },
  top: { s: "s-top", t: "t-top" },
  bottom: { s: "s-bottom", t: "t-bottom" },
};

/** Map a Side to the source/target handle id the Designer nodes expose. */
export function sideToSourceHandle(s: Side): string {
  return SIDE_TO_HANDLE[s].s;
}
export function sideToTargetHandle(s: Side): string {
  return SIDE_TO_HANDLE[s].t;
}

/** Parse a Designer handle id ("s-right" / "t-top") into a Side. */
export function handleToSide(handle: string | null | undefined): Side | null {
  if (!handle) return null;
  const m = /^[st]-(left|right|top|bottom)$/.exec(handle);
  return m ? (m[1] as Side) : null;
}

/** Compute the final routing for one edge. Returns empty waypoints when
 *  the authored auto-route is already clean (no behaviour change), and
 *  an obstacle-avoiding path (possibly with a re-picked target side)
 *  when it was blocked. */
export function routeEdge(input: RouteInput): RouteResult {
  const { source, target, sourceSide, targetSide, obstacles } = input;

  // 1 ── Is the simple authored route already clean?
  const srcPt = handlePoint(source, sourceSide);
  const dstPt = handlePoint(target, targetSide);
  const corners = autoCorners(srcPt, sourceSide, dstPt, targetSide);
  const simplePath =
    corners != null
      ? [srcPt, ...corners, dstPt]
      : mixedProxy(srcPt, sourceSide, dstPt, targetSide);
  // A route is "clean" iff (a) it dodges every obstacle AND (b) its final
  // segment lands perpendicular to the target's handle side. (b) matters
  // because the SVG arrowhead inherits the path tangent at the endpoint:
  // a smoothstep that degenerates into a flat L (e.g. source's H-handle Y
  // happens to align with target's t-top Y) lands HORIZONTALLY on a top
  // handle, leaving the arrowhead tilted 90° off. Failing either check
  // sends the edge through the reroute loop, which prefers same-orientation
  // target sides whose orthogonal polylines always land perpendicular.
  if (
    !pathBlocked(simplePath, obstacles) &&
    tangentMatchesSide(simplePath, targetSide)
  ) {
    return { sourceSide, targetSide, waypoints: [], rerouted: false };
  }

  // 2 ── Blocked: route around. Keep the source side fixed; prefer
  //      target sides whose orientation matches the source (so the
  //      renderer routes orthogonally and our waypoints actually draw).
  //      Restrict to obstacles near the corridor so the lattice stays
  //      small (and never bails) even on large diagrams.
  const nearObstacles = windowObstacles(source, target, obstacles);
  const srcOri = orient(sourceSide);
  const sameOri: Side[] = srcOri === "H" ? ["right", "left"] : ["bottom", "top"];
  const otherOri: Side[] = srcOri === "H" ? ["bottom", "top"] : ["right", "left"];

  let best: { waypoints: Pt[]; cost: number; ts: Side } | null = null;
  for (const group of [orderByPreference(sameOri, targetSide), otherOri]) {
    for (const ts of group) {
      const res = tryRoute(source, sourceSide, target, ts, nearObstacles);
      if (res && (!best || res.cost < best.cost)) {
        best = { ...res, ts };
      }
    }
    if (best) break; // commit to same-orientation group if any worked
  }

  if (best) {
    return {
      sourceSide,
      targetSide: best.ts,
      waypoints: best.waypoints,
      rerouted: true,
    };
  }

  // 3 ── Nothing found (degenerate). Leave it to the renderer.
  return { sourceSide, targetSide, waypoints: [], rerouted: false };
}

/** Put the authored target side first so it wins ties. */
function orderByPreference(sides: Side[], preferred: Side): Side[] {
  if (!sides.includes(preferred)) return sides;
  return [preferred, ...sides.filter((s) => s !== preferred)];
}
