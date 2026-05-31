/* ─── webMethods layout compaction ───────────────────────────────────
 * webMethods models are authored on a very sparse canvas: swimlane
 * bands are typically 5-6× taller than the row of nodes inside them,
 * and the whole diagram carries wide outer margins. Rendered 1:1 that
 * makes even a 22-node model ~6000px tall, so fitView zooms out to
 * ~0.13 and everything is microscopic on open.
 *
 * This pass removes the *excess* whitespace while preserving the
 * designer's relative arrangement:
 *   • Each swimlane band is shrunk to its actual node content + a small
 *     padding, and the lanes are re-stacked contiguously.
 *   • Outer margins on the cross axis are trimmed.
 *   • Node coordinates are re-based to match.
 *   • Edge waypoints (authored bendpoints) are shifted by the SAME
 *     per-lane constant as the nodes in that lane, so edges stay
 *     attached and keep their shape.
 *
 * It does NOT compress the gaps *between* nodes within a lane — that
 * would distort the authored flow and is unnecessary; the dominant
 * waste is the empty band area, not inter-node spacing.
 *
 * All coordinates here are in the model's pool-local space (the same
 * space WMSTEPDEFINITION.ICON_X/Y and the BPD swimlane bands share —
 * verified to align on the DOE install). SCALE is applied later, on the
 * frontend.
 * ────────────────────────────────────────────────────────────────────── */

import type { BpdPool, BpdLane } from './bpd-xml-parser';
import type { ExternalBpmNode, ExternalBpmEdge } from './external-bpm.service';

/** Padding kept around node content inside each shrunk lane band. */
const LANE_PAD = 30;
/** Height/width given to a swimlane that has no nodes of its own. */
const EMPTY_LANE = 70;
/** Outer margin kept on the trimmed cross axis. */
const MARGIN = 40;

/** A contiguous old-coordinate band on the stack axis, paired with the
 *  constant shift applied to everything inside it. Used to relocate edge
 *  waypoints the same way their endpoint nodes moved. */
interface BandShift {
  lo: number;
  hi: number;
  shift: number;
}

function applyBandShift(value: number, bands: BandShift[]): number {
  for (const b of bands) {
    if (value >= b.lo && value <= b.hi) return value + b.shift;
  }
  // Outside every band (rare): snap to the nearest band's shift so the
  // point still travels with the diagram rather than flying off.
  let best: BandShift | null = null;
  let bestDist = Infinity;
  for (const b of bands) {
    const d = value < b.lo ? b.lo - value : value - b.hi;
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best ? value + best.shift : value;
}

/** Compact one pool that has swimlanes along a single axis.
 *  `axis` = 'y' for horizontal lanes (rows stacked vertically),
 *           'x' for vertical lanes (columns stacked horizontally). */
function compactLaned(
  pool: BpdPool,
  poolLanes: BpdLane[],
  nodes: ExternalBpmNode[],
  edges: ExternalBpmEdge[],
  axis: 'x' | 'y',
): void {
  // `s` = stack axis (the one lanes are stacked along + the one we
  // compact band-by-band). `c` = cross axis (trim outer margin only).
  const s = axis;
  const c = axis === 'y' ? 'x' : 'y';
  const sSize = axis === 'y' ? 'height' : 'width';
  const cSize = axis === 'y' ? 'width' : 'height';

  const laneTop = (l: BpdLane) => (axis === 'y' ? l.y : l.x);
  const setLaneTop = (l: BpdLane, v: number) => { if (axis === 'y') l.y = v; else l.x = v; };
  const laneSpan = (l: BpdLane) => (axis === 'y' ? l.height : l.width);
  const setLaneSpan = (l: BpdLane, v: number) => { if (axis === 'y') l.height = v; else l.width = v; };

  const sorted = [...poolLanes].sort((a, b) => laneTop(a) - laneTop(b));
  const nodesOfLane = (id: string) => nodes.filter((n) => n.parentId === id);

  const bands: BandShift[] = [];
  let cursor = 0;

  for (const lane of sorted) {
    const oldTop = laneTop(lane);
    const oldSpan = laneSpan(lane);
    const ln = nodesOfLane(lane.id);

    if (ln.length === 0) {
      // Empty lane: collapse to a thin band, record a straight shift.
      const shift = cursor - oldTop;
      bands.push({ lo: oldTop, hi: oldTop + oldSpan, shift });
      setLaneTop(lane, cursor);
      setLaneSpan(lane, EMPTY_LANE);
      cursor += EMPTY_LANE;
      continue;
    }

    // Node coords on the stack axis are lane-relative (the service
    // already subtracted the lane's offset on this axis). Find the
    // content extent within the lane.
    const localLo = Math.min(...ln.map((n) => n[s]));
    const localHi = Math.max(...ln.map((n) => n[s] + n[sSize]));
    const contentSpan = localHi - localLo;

    // Re-base nodes so content starts at LANE_PAD inside the band.
    for (const n of ln) n[s] = n[s] - localLo + LANE_PAD;

    const newSpan = contentSpan + 2 * LANE_PAD;
    // Per-lane constant shift in absolute (pool-local) coords, applied
    // identically to nodes and to waypoints that fall in the old band.
    const shift = cursor + LANE_PAD - (oldTop + localLo);
    bands.push({ lo: oldTop, hi: oldTop + oldSpan, shift });

    setLaneTop(lane, cursor);
    setLaneSpan(lane, newSpan);
    cursor += newSpan;
  }

  // Pool-direct nodes (inside this pool but not landing in any lane
  // band) ride the band map on the stack axis just like lane nodes —
  // their coords are pool-absolute, which is the space `bands` is in.
  for (const n of nodes) {
    if (n.parentId === pool.id) n[s] = applyBandShift(n[s], bands);
  }

  // Cross axis: trim the outer margin uniformly across the whole pool.
  const poolNodes = nodes.filter(
    (n) => n.parentId != null && (n.parentId === pool.id || poolLanes.some((l) => l.id === n.parentId)),
  );
  const cMin = Math.min(...poolNodes.map((n) => n[c]));
  const cShift = MARGIN - cMin;
  let cMax = -Infinity;
  for (const n of poolNodes) {
    n[c] = n[c] + cShift;
    if (n[c] + n[cSize] > cMax) cMax = n[c] + n[cSize];
  }
  const crossExtent = cMax + MARGIN;

  // Relocate edge waypoints: stack-axis coord via the band map, cross
  // axis via the uniform trim shift (clamped into the pool on the cross
  // axis). Only touch edges whose endpoints are in this pool (waypoints
  // are pool-local absolute coords).
  const poolNodeIds = new Set(poolNodes.map((n) => n.id));
  const touchedWps: { x: number; y: number }[] = [];
  for (const e of edges) {
    if (!poolNodeIds.has(e.source) && !poolNodeIds.has(e.target)) continue;
    for (const wp of e.waypoints) {
      wp[s] = applyBandShift(wp[s], bands);
      wp[c] = Math.min(Math.max(wp[c] + cShift, 0), crossExtent);
      touchedWps.push(wp);
    }
  }

  // Authored bendpoints sometimes route through the old sparse top/bottom
  // margin — e.g. feedback edges that loop *above* every lane to travel
  // back across the diagram. Compaction removes that routing channel, so
  // such waypoints can land outside the pool on the stack axis. Rather
  // than clamp them (which would collapse parallel feedback edges onto the
  // pool border), grow the pool just enough to re-contain them and absorb
  // the routing margin into the nearest end lane so the lanes still tile
  // the pool cleanly. The authored routing — and the separation between
  // parallel feedback edges — is preserved.
  let wpLo = 0;
  let wpHi = cursor;
  for (const wp of touchedWps) {
    if (wp[s] < wpLo) wpLo = wp[s];
    if (wp[s] > wpHi) wpHi = wp[s];
  }

  if (wpLo < 0) {
    // Overshoot above the top: translate ALL pool content down by `g`
    // (pool origin must stay at 0), then extend the topmost lane up to 0
    // to swallow the new margin. Lane-relative child nodes ride their
    // lane automatically; pool-direct nodes and waypoints are absolute.
    const g = -wpLo + LANE_PAD;
    for (const lane of sorted) setLaneTop(lane, laneTop(lane) + g);
    for (const n of nodes) if (n.parentId === pool.id) n[s] = n[s] + g;
    for (const wp of touchedWps) wp[s] = wp[s] + g;
    cursor += g;
    wpHi += g;

    const top = sorted[0];
    const topShift = laneTop(top); // == g
    setLaneTop(top, 0);
    setLaneSpan(top, laneSpan(top) + topShift);
    for (const n of nodesOfLane(top.id)) n[s] = n[s] + topShift;
  }

  if (wpHi > cursor) {
    // Overshoot below the bottom: extend the last lane down to contain it.
    const last = sorted[sorted.length - 1];
    const extra = wpHi - cursor + LANE_PAD;
    setLaneSpan(last, laneSpan(last) + extra);
    cursor += extra;
  }

  // Lanes span the full cross extent; their stack span is set above.
  for (const lane of sorted) {
    if (axis === 'y') lane.width = crossExtent;
    else lane.height = crossExtent;
  }

  // Pool box = stacked length × cross extent.
  if (axis === 'y') { pool.height = cursor; pool.width = crossExtent; }
  else { pool.width = cursor; pool.height = crossExtent; }
  pool.x = 0;
  pool.y = 0;
}

/** Compact a pool that has no swimlanes — just trim outer margins on
 *  both axes so a small model doesn't sit in a sea of whitespace. */
function compactFlat(
  pool: BpdPool,
  poolNodes: ExternalBpmNode[],
  edges: ExternalBpmEdge[],
): void {
  if (poolNodes.length === 0) return;

  // Include the waypoints of this pool's edges in the extent so authored
  // bendpoints that route outside the node bounding box don't escape the
  // pool after the margin trim.
  const ids = new Set(poolNodes.map((n) => n.id));
  const poolEdges = edges.filter((e) => ids.has(e.source) || ids.has(e.target));
  const wps = poolEdges.flatMap((e) => e.waypoints);

  const minX = Math.min(...poolNodes.map((n) => n.x), ...wps.map((w) => w.x));
  const minY = Math.min(...poolNodes.map((n) => n.y), ...wps.map((w) => w.y));
  const dx = MARGIN - minX;
  const dy = MARGIN - minY;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of poolNodes) {
    n.x += dx;
    n.y += dy;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  for (const wp of wps) {
    wp.x += dx;
    wp.y += dy;
    if (wp.x > maxX) maxX = wp.x;
    if (wp.y > maxY) maxY = wp.y;
  }
  pool.x = 0;
  pool.y = 0;
  pool.width = maxX + MARGIN;
  pool.height = maxY + MARGIN;
}

/** Entry point: compact every pool in the model in place. */
export function compactLayout(
  pools: BpdPool[],
  lanes: BpdLane[],
  nodes: ExternalBpmNode[],
  edges: ExternalBpmEdge[],
): void {
  for (const pool of pools) {
    const poolLanes = lanes.filter((l) => l.poolId === pool.id);
    if (poolLanes.length === 0) {
      const poolNodes = nodes.filter((n) => n.parentId === pool.id);
      compactFlat(pool, poolNodes, edges);
      continue;
    }
    // webMethods keeps one orientation per pool; pick the majority just
    // in case a stray lane disagrees.
    const verticalCount = poolLanes.filter((l) => l.orientation === 'vertical').length;
    const axis: 'x' | 'y' = verticalCount > poolLanes.length / 2 ? 'x' : 'y';
    compactLaned(pool, poolLanes, nodes, edges, axis);
  }
}
