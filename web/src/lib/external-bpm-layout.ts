/* ─── External BPM auto-layout ────────────────────────────────────────
 * Re-positions a webMethods process graph using ELKjs's `layered`
 * algorithm so it reads cleanly even when the original Designer
 * coordinates are sparse or overlapping. Operates per-pool so swim-
 * lane boundaries stay meaningful: each pool is laid out as its own
 * subgraph; cross-pool edges keep their original endpoints.
 *
 * After layout:
 *  • Every step gets a new (x, y) inside its pool's local coord space
 *  • Each pool's width/height shrinks to fit its laid-out children
 *  • Pools stack vertically with a fixed gap so they don't overlap
 *
 * Returns NEW arrays — the original `nodes` / `containers` are not
 * mutated, so the caller can flip between "source" and "auto" layouts
 * without re-fetching from the API.
 * ────────────────────────────────────────────────────────────────────── */

import ELK from "elkjs/lib/elk.bundled.js";

interface LayoutNode {
  id: string;
  type: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

interface LayoutContainer {
  type: "pool" | "lane";
  id: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

const elk = new ELK();

/** Standard BPM-ish dimensions. Steps from webMethods are often tagged
 *  with tiny ICON_ dimensions (60×60); we widen them so ELK reserves
 *  realistic space matching what the BPMN task nodes actually render at.
 *  Task box height in particular needs to be generous — long labels like
 *  "More Information Requested By Specialist" wrap onto 2-3 lines, and
 *  if ELK reserves only 80 px those wrapped lines overflow into the
 *  neighbour below and look like an overlap. */
// Generous on purpose: the BPMN node components don't honour width/
// height as hard caps — they auto-grow to fit wrapped labels. webMethods
// task labels like "More Information Requested By Section Head" wrap
// onto 3 lines in the rendered DOM, so the displayed task can hit
// ~240×160. Reserving the worst-case prevents adjacent nodes from
// touching even when labels are long.
const STANDARD_TASK_WIDTH = 240;
const STANDARD_TASK_HEIGHT = 160;
// Gateways and events render with their LABEL BELOW the shape. Reserve
// vertical room for that label so the row below doesn't clip into it.
const STANDARD_EVENT_SIZE = 80;
const STANDARD_GATEWAY_SIZE = 80;
const POOL_LABEL_BAND = 30;     // PoolNode renders a 30-px vertical label band
const POOL_PADDING_X = 60;
const POOL_PADDING_Y = 60;
const POOL_GAP = 80;

function standardSizeFor(type: string): { width: number; height: number } {
  if (type === "startEvent" || type === "endEvent" || type === "intermediateCatchEvent") {
    return { width: STANDARD_EVENT_SIZE, height: STANDARD_EVENT_SIZE };
  }
  if (type.endsWith("Gateway")) {
    return { width: STANDARD_GATEWAY_SIZE, height: STANDARD_GATEWAY_SIZE };
  }
  return { width: STANDARD_TASK_WIDTH, height: STANDARD_TASK_HEIGHT };
}

export async function runAutoLayout(
  containers: LayoutContainer[],
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Promise<{ nodes: LayoutNode[]; containers: LayoutContainer[] }> {
  const pools = containers.filter((c) => c.type === "pool");

  // Group nodes by their containing pool (resolving lane→pool if needed).
  const poolOfNode = new Map<string, string | null>();
  for (const n of nodes) {
    if (!n.parentId) {
      poolOfNode.set(n.id, null);
      continue;
    }
    const direct = containers.find((c) => c.id === n.parentId);
    if (direct?.type === "pool") poolOfNode.set(n.id, direct.id);
    else if (direct?.type === "lane") poolOfNode.set(n.id, direct.parentId);
    else poolOfNode.set(n.id, null);
  }

  // Defensive orphan inference: any node missing a pool gets adopted by
  // the pool of its most common neighbour. This catches steps whose
  // container info was missing from the BPD XML (e.g. terminate / error
  // events authored at diagram root). Without this they'd render at raw
  // webMethods coords outside any pool, which looks broken and confuses
  // the per-pool layout. Iterate until stable (orphans can chain).
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const n of nodes) {
      if (poolOfNode.get(n.id)) continue;
      const tally = new Map<string, number>();
      for (const e of edges) {
        const peer = e.source === n.id ? e.target : e.target === n.id ? e.source : null;
        if (!peer) continue;
        const peerPool = poolOfNode.get(peer);
        if (peerPool) tally.set(peerPool, (tally.get(peerPool) ?? 0) + 1);
      }
      if (tally.size === 0) continue;
      const winner = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
      poolOfNode.set(n.id, winner);
      changed = true;
    }
    if (!changed) break;
  }

  // Pre-built map of edges within each pool. Cross-pool edges are
  // skipped — they don't influence the per-pool layout.
  const edgesByPool = new Map<string, LayoutEdge[]>();
  for (const e of edges) {
    const srcPool = poolOfNode.get(e.source);
    const tgtPool = poolOfNode.get(e.target);
    if (srcPool && srcPool === tgtPool) {
      const arr = edgesByPool.get(srcPool) ?? [];
      arr.push(e);
      edgesByPool.set(srcPool, arr);
    }
  }

  const newNodes: LayoutNode[] = [];
  const newContainers: LayoutContainer[] = [];
  let stackY = 0;

  for (const pool of pools) {
    const childNodes = nodes.filter((n) => poolOfNode.get(n.id) === pool.id);
    const childEdges = edgesByPool.get(pool.id) ?? [];

    // Hand ELK an idealised graph: standard BPM dimensions for each
    // shape, layered algorithm, left-to-right reading direction,
    // orthogonal edges.
    const elkGraph = {
      id: pool.id,
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        // Generous spacing — webMethods diagrams use long task labels
        // that wrap, so tight spacing makes adjacent rows touch.
        "elk.layered.spacing.nodeNodeBetweenLayers": "100",
        "elk.spacing.nodeNode": "70",
        "elk.layered.spacing.edgeNodeBetweenLayers": "40",
        "elk.spacing.edgeNode": "30",
        "elk.spacing.edgeEdge": "20",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.padding": `[top=${POOL_PADDING_Y},left=${POOL_LABEL_BAND + POOL_PADDING_X},bottom=${POOL_PADDING_Y},right=${POOL_PADDING_X}]`,
      },
      children: childNodes.map((n) => {
        const std = standardSizeFor(n.type);
        return { id: n.id, width: std.width, height: std.height };
      }),
      edges: childEdges.map((e) => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      })),
    };

    let laid: Awaited<ReturnType<typeof elk.layout>>;
    try {
      laid = await elk.layout(elkGraph);
    } catch (err) {
      console.warn(`ELK layout failed for pool ${pool.id}:`, err);
      // Fall back to source positions on failure.
      newContainers.push({ ...pool, y: stackY });
      stackY += pool.height + POOL_GAP;
      for (const n of childNodes) newNodes.push(n);
      continue;
    }

    const poolW = Math.max(laid.width ?? 0, 400);
    const poolH = Math.max(laid.height ?? 0, 200);

    newContainers.push({
      ...pool,
      x: 0,
      y: stackY,
      width: poolW,
      height: poolH,
    });

    for (const child of laid.children ?? []) {
      const original = childNodes.find((n) => n.id === child.id);
      if (!original) continue;
      const std = standardSizeFor(original.type);
      newNodes.push({
        ...original,
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: std.width,
        height: std.height,
      });
    }

    stackY += poolH + POOL_GAP;
  }

  // Carry forward any node that didn't fit into a pool (rare — usually
  // means the BPD XML didn't have container info for that step) and any
  // lane containers (visual only, untouched by layout).
  const placedIds = new Set(newNodes.map((n) => n.id));
  for (const n of nodes) {
    if (!placedIds.has(n.id)) newNodes.push(n);
  }
  for (const c of containers) {
    if (c.type !== "pool") newContainers.push(c);
  }

  return { nodes: newNodes, containers: newContainers };
}
