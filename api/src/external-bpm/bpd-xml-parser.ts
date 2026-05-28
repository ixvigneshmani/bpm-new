/* ─── webMethods BPD XML parser ──────────────────────────────────────
 * Extracts pool / lane / step-membership info from the BPD XML blob
 * stored in WMPROCESSDEFINITION.PROCESSFILE. The relational tables
 * (WMSTEPDEFINITION / WMSTEPTRANSITIONDEFINITION) carry node and edge
 * topology, but pool/lane container structure only lives in the XML.
 *
 * We only need a small slice of the BPD format:
 *   <businessProcessDiagram>
 *     <pool uid="P1" label="…" [x="…" y="…" width="…" height="…"]>
 *       <lane uid="L1" label="…" [x y width height]>
 *         <invokeStep uid="S1" x="…" y="…" width="…" height="…" label="…"/>
 *         <decisionStep …/>
 *         <transition source="S1" target="S2"/>
 *       </lane>
 *       <invokeStep uid="S3" …/>      ← step directly in pool, no lane
 *     </pool>
 *   </businessProcessDiagram>
 *
 * Coordinates inside a pool are pool-relative; lanes nest inside pools;
 * step coordinates inside a lane are lane-relative.
 * ────────────────────────────────────────────────────────────────────── */

import { XMLParser } from 'fast-xml-parser';

export interface BpdPool {
  /** webMethods uid (e.g. "P1"). Used as React Flow node id. */
  id: string;
  label: string | null;
  /** Absolute (canvas-space) layout. May be derived if not in XML. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BpdLane {
  id: string;
  /** Parent pool's uid. */
  poolId: string;
  label: string | null;
  /** Coordinates relative to the parent pool's content area. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Edge attachment hint from the BPD XML. webMethods stores which side
 *  of the source/target node each transition attaches to — using these
 *  produces dramatically cleaner routing than guessing from positions,
 *  because the original designer hand-placed them to avoid overlaps. */
export interface BpdTransitionTerminal {
  source: string;
  target: string;
  /** "TOP" | "RIGHT" | "BOTTOM" | "LEFT" — or null when XML omits it. */
  sourceTerminal: string | null;
  targetTerminal: string | null;
}

export interface BpdContainerMap {
  /** All pools in the diagram, top-level. */
  pools: BpdPool[];
  /** All lanes, parented to a pool via `poolId`. */
  lanes: BpdLane[];
  /** stepUid → poolId  (which pool a step lives in) */
  stepToPool: Map<string, string>;
  /** stepUid → laneId  (which lane a step lives in; absent if step is directly in a pool) */
  stepToLane: Map<string, string>;
  /** Per-transition handle hints harvested from <transition> elements. */
  transitionTerminals: BpdTransitionTerminal[];
}

/** Every BPD element that represents a "step" we want to render as a
 *  node. webMethods has a long tail of step types beyond invokeStep
 *  (gatewayStep for branches, receiveStep for inbound messages,
 *  errorEventStep + terminateStep for terminators, decisionStep for
 *  legacy gateways). All of them carry uid + x + y attributes and live
 *  as direct children of a <pool> or <lane>. */
const STEP_ELEMENT_NAMES = [
  'invokeStep',
  'decisionStep',
  'endStep',
  'gatewayStep',
  'receiveStep',
  'errorEventStep',
  'terminateStep',
] as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  allowBooleanAttributes: true,
  // Preserve every element even when only one occurrence — saves us a
  // pile of "is it an array?" branches downstream.
  isArray: (name) =>
    name === 'pool' ||
    name === 'lane' ||
    name === 'transition' ||
    (STEP_ELEMENT_NAMES as readonly string[]).includes(name),
});

/** Coerce a child node's `@x`/`@y`/etc. attributes to numbers, with sane
 *  fallbacks. The BPD spec sometimes omits dimensions on containers. */
function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** List every direct child element that represents a step in this
 *  container. webMethods has a family of step element names — see
 *  STEP_ELEMENT_NAMES. fast-xml-parser wraps these in arrays via
 *  isArray, but we also handle the single-object fallback in case the
 *  config ever drifts. */
function stepChildren(container: Record<string, unknown>): Array<{ uid: string; x: number; y: number; w: number; h: number }> {
  const out: Array<{ uid: string; x: number; y: number; w: number; h: number }> = [];
  for (const name of STEP_ELEMENT_NAMES) {
    const raw = container[name];
    if (raw == null) continue;
    const arr: Array<Record<string, unknown>> = Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : [raw as Record<string, unknown>];
    for (const el of arr) {
      const uid = el['@uid'];
      if (typeof uid !== 'string') continue;
      out.push({
        uid,
        x: num(el['@x'], 0),
        y: num(el['@y'], 0),
        w: num(el['@width'], 60),
        h: num(el['@height'], 60),
      });
    }
  }
  return out;
}

/** Compute a pool's bbox from its child steps + lanes when the XML
 *  doesn't carry explicit dimensions.
 *
 *  Returns ABSOLUTE bounds (maxX + padding, maxY + padding) — not the
 *  span — because child positions are absolute within the pool's local
 *  coordinate system, and React Flow renders children at those raw
 *  positions. Using span (maxX - minX) would clip any step whose right
 *  edge sits beyond the pool's computed width. (Caught in QA against
 *  SNIProc/SNIProcess where a step at x=1746 was overflowing.)
 */
function computeBbox(
  children: Array<{ x: number; y: number; w: number; h: number }>,
  paddingX = 60, // leaves room for the pool's vertical label band
  paddingY = 40,
): { x: number; y: number; width: number; height: number } {
  if (children.length === 0) {
    return { x: 0, y: 0, width: 400, height: 200 };
  }
  let maxX = -Infinity, maxY = -Infinity;
  for (const c of children) {
    if (c.x + c.w > maxX) maxX = c.x + c.w;
    if (c.y + c.h > maxY) maxY = c.y + c.h;
  }
  return {
    x: 0,
    y: 0,
    width: maxX + paddingX,
    height: maxY + paddingY,
  };
}

/** Collect every <transition> element under any container, recursively.
 *  webMethods nests transitions inside the pool/lane where they live. */
function collectTransitions(
  container: Record<string, unknown>,
  acc: BpdTransitionTerminal[],
): void {
  const tx = (container['transition'] ?? []) as Array<Record<string, unknown>>;
  for (const t of tx) {
    const source = typeof t['@source'] === 'string' ? t['@source'] : null;
    const target = typeof t['@target'] === 'string' ? t['@target'] : null;
    if (!source || !target) continue;
    const st = typeof t['@sourceTerminal'] === 'string' ? t['@sourceTerminal'] : null;
    const tt = typeof t['@targetTerminal'] === 'string' ? t['@targetTerminal'] : null;
    acc.push({ source, target, sourceTerminal: st, targetTerminal: tt });
  }
  // Recurse into nested lanes (and any other container element).
  const lanes = (container['lane'] ?? []) as Array<Record<string, unknown>>;
  for (const l of lanes) collectTransitions(l, acc);
}

/** Parse a BPD XML blob and pull out the container structure.
 *  Returns an empty result on parse failure — callers should treat the
 *  XML as best-effort layout enrichment, not a hard requirement. */
export function parseBpdXml(xml: string | null | undefined): BpdContainerMap {
  const empty: BpdContainerMap = {
    pools: [],
    lanes: [],
    stepToPool: new Map(),
    stepToLane: new Map(),
    transitionTerminals: [],
  };
  if (!xml || typeof xml !== 'string' || xml.trim() === '') return empty;

  let root: Record<string, unknown>;
  try {
    root = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return empty;
  }

  const diagram = (root['businessProcessDiagram'] ?? {}) as Record<string, unknown>;
  const poolEls = (diagram['pool'] ?? []) as Array<Record<string, unknown>>;
  if (poolEls.length === 0) return empty;

  const pools: BpdPool[] = [];
  const lanes: BpdLane[] = [];
  const stepToPool = new Map<string, string>();
  const stepToLane = new Map<string, string>();
  const transitionTerminals: BpdTransitionTerminal[] = [];

  // Stack pools vertically when the XML doesn't carry pool-level
  // coordinates. Use a small gap so they read as separate swimlanes.
  let poolStackY = 0;
  const POOL_GAP = 30;

  for (const poolEl of poolEls) {
    const poolUid = typeof poolEl['@uid'] === 'string' ? poolEl['@uid'] : null;
    if (!poolUid) continue;

    const poolLabel = (poolEl['@label'] ?? poolEl['@name'] ?? null) as string | null;
    const poolSteps = stepChildren(poolEl);

    // Collect lanes inside this pool
    const laneEls = (poolEl['lane'] ?? []) as Array<Record<string, unknown>>;
    const laneRecords: BpdLane[] = [];
    const laneChildBboxes: Array<{ x: number; y: number; w: number; h: number }> = [];

    for (const laneEl of laneEls) {
      const laneUid = typeof laneEl['@uid'] === 'string' ? laneEl['@uid'] : null;
      if (!laneUid) continue;
      const laneLabel = (laneEl['@label'] ?? laneEl['@name'] ?? null) as string | null;
      const laneSteps = stepChildren(laneEl);
      for (const s of laneSteps) {
        stepToLane.set(s.uid, laneUid);
        stepToPool.set(s.uid, poolUid);
      }
      const laneBbox = computeBbox(laneSteps, 30, 20);
      const laneX = num(laneEl['@x'], 0);
      const laneY = num(laneEl['@y'], 0);
      const laneW = num(laneEl['@width'], laneBbox.width);
      const laneH = num(laneEl['@height'], laneBbox.height);
      laneRecords.push({
        id: laneUid,
        poolId: poolUid,
        label: laneLabel,
        x: laneX,
        y: laneY,
        width: laneW,
        height: laneH,
      });
      laneChildBboxes.push({ x: laneX, y: laneY, w: laneW, h: laneH });
    }

    // Steps living directly under the pool (no lane wrapper)
    for (const s of poolSteps) {
      stepToPool.set(s.uid, poolUid);
    }

    // Pool dimensions: prefer XML, fall back to bbox of (lanes + direct steps)
    const containedForBbox = [...laneChildBboxes, ...poolSteps];
    const bbox = computeBbox(containedForBbox);
    const poolX = num(poolEl['@x'], 0);
    const poolY = num(poolEl['@y'], poolStackY);
    const poolW = num(poolEl['@width'], bbox.width);
    const poolH = num(poolEl['@height'], bbox.height);

    pools.push({
      id: poolUid,
      label: poolLabel,
      x: poolX,
      y: poolY,
      width: poolW,
      height: poolH,
    });
    lanes.push(...laneRecords);
    collectTransitions(poolEl, transitionTerminals);
    poolStackY = poolY + poolH + POOL_GAP;
  }

  return { pools, lanes, stepToPool, stepToLane, transitionTerminals };
}
