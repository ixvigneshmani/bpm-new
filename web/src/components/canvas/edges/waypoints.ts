/* ─── Edge waypoints — pure geometry + data helpers (GAP-04) ─────────
 * Waypoints are an opt-in array on `edge.data.waypoints` that lets the
 * user route an edge through specific points instead of accepting the
 * library's default routing.
 *
 *   shape:  edge.data.waypoints?: Array<{ x: number; y: number }>
 *
 * Engine semantics: projectCanvas() in api/src/engine/engine.service.ts
 * STRIPS edge.data to {condition, isDefault, flowType} — waypoints are
 * intentionally dropped from the projected view so two canvases that
 * differ only in visual routing produce the same definitionHash and
 * don't bump the process version. They DO survive the full-canvas
 * save (PROCESS_VERSIONS stores the raw canvas, per BUG-D1-01).
 *
 * Everything in this file is pure so it can be tested without spinning
 * up React Flow or React itself. ──────────────────────────────────── */

export type Waypoint = { x: number; y: number };

/** Read waypoints from an edge.data blob safely. Tolerates missing /
 *  malformed payloads — returns []. Filters out non-numeric coords so
 *  a half-baked client write doesn't NaN-crash the renderer. */
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

/** Round to the canvas snap grid. Default 16 matches the canvas's
 *  SNAP_GRID constant (web/src/pages/DesignCanvasPage.tsx). */
export function snapToGrid(value: number, step = 16): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / step) * step;
}

export function snapWaypoint(w: Waypoint, step = 16): Waypoint {
  return { x: snapToGrid(w.x, step), y: snapToGrid(w.y, step) };
}

export function midpoint(a: Waypoint, b: Waypoint): Waypoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Strict (typeof number) equality with a small epsilon so floats from
 *  two different render cycles still compare equal. */
export function waypointsEqual(a: Waypoint, b: Waypoint, eps = 0.5): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/** Squash adjacent duplicates (e.g. user dragged one waypoint exactly
 *  onto its neighbour) and any waypoint within `threshold` of the
 *  preceding one. Keeps the geometry sane — without this, repeatedly
 *  inserting then back-tracking would silt up the array. */
export function mergeNearbyWaypoints(
  waypoints: Waypoint[],
  threshold = 8,
): Waypoint[] {
  if (waypoints.length < 2) return waypoints.slice();
  const out: Waypoint[] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const prev = out[out.length - 1];
    const w = waypoints[i];
    const dx = w.x - prev.x;
    const dy = w.y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > threshold) out.push(w);
  }
  return out;
}

/** Splice a new waypoint at `insertIndex`. Returns a fresh array. */
export function insertWaypoint(
  waypoints: Waypoint[],
  insertIndex: number,
  w: Waypoint,
): Waypoint[] {
  const idx = Math.max(0, Math.min(insertIndex, waypoints.length));
  const out = waypoints.slice();
  out.splice(idx, 0, w);
  return out;
}

export function removeWaypoint(
  waypoints: Waypoint[],
  index: number,
): Waypoint[] {
  if (index < 0 || index >= waypoints.length) return waypoints.slice();
  const out = waypoints.slice();
  out.splice(index, 1);
  return out;
}

export function updateWaypointAt(
  waypoints: Waypoint[],
  index: number,
  w: Waypoint,
): Waypoint[] {
  if (index < 0 || index >= waypoints.length) return waypoints.slice();
  const out = waypoints.slice();
  out[index] = w;
  return out;
}

/** SVG path string through source → waypoints → target.
 *
 *  Uses straight line segments (`M…L…L…L`). Rounded corners would be
 *  nicer but require knowing the turn direction at each vertex; v1
 *  keeps it simple and crisp. */
export function buildPolylinePath(
  source: Waypoint,
  waypoints: Waypoint[],
  target: Waypoint,
): string {
  const parts: string[] = [`M ${source.x} ${source.y}`];
  for (const w of waypoints) {
    parts.push(`L ${w.x} ${w.y}`);
  }
  parts.push(`L ${target.x} ${target.y}`);
  return parts.join(" ");
}

/** Geometric centre of the rendered polyline — used to position the
 *  edge label and the "add waypoint here" hover handles for each
 *  segment. Returns the midpoint of the LONGEST segment so the label
 *  doesn't land on a corner. */
export function polylineLabelPoint(
  source: Waypoint,
  waypoints: Waypoint[],
  target: Waypoint,
): Waypoint {
  const pts = [source, ...waypoints, target];
  let bestMid: Waypoint = midpoint(pts[0], pts[1] ?? pts[0]);
  let bestLen = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > bestLen) {
      bestLen = len;
      bestMid = midpoint(a, b);
    }
  }
  return bestMid;
}

/** Midpoints of every segment of the polyline. These are the "+ here"
 *  hover handles that turn into new waypoints when the user starts
 *  dragging from them. Returns one entry per segment, in order, so
 *  `result[i]` is the midpoint between point i and point i+1 of
 *  `[source, ...waypoints, target]`. */
export function segmentMidpoints(
  source: Waypoint,
  waypoints: Waypoint[],
  target: Waypoint,
): Waypoint[] {
  const pts = [source, ...waypoints, target];
  const mids: Waypoint[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    mids.push(midpoint(pts[i], pts[i + 1]));
  }
  return mids;
}
