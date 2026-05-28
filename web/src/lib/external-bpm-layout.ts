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

/** ELK layout options shared by every container. */
function elkLayoutOptions(leftPad: number) {
  return {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.spacing.nodeNode": "70",
    "elk.layered.spacing.edgeNodeBetweenLayers": "40",
    "elk.spacing.edgeNode": "30",
    "elk.spacing.edgeEdge": "20",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.padding": `[top=${POOL_PADDING_Y},left=${leftPad},bottom=${POOL_PADDING_Y},right=${POOL_PADDING_X}]`,
  };
}

export async function runAutoLayout(
  containers: LayoutContainer[],
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Promise<{ nodes: LayoutNode[]; containers: LayoutContainer[] }> {
  const pools = containers.filter((c) => c.type === "pool");
  const swimlanesByPool = new Map<string, LayoutContainer[]>();
  for (const c of containers) {
    if (c.type !== "lane" || !c.parentId) continue;
    const arr = swimlanesByPool.get(c.parentId) ?? [];
    arr.push(c);
    swimlanesByPool.set(c.parentId, arr);
  }

  // For every step, identify its leaf container (swimlane > pool > null).
  // Cross-container edges are dropped from the per-container ELK input;
  // they re-emerge as React Flow edges using their original endpoints.
  const leafOfNode = new Map<string, string | null>();
  for (const n of nodes) {
    leafOfNode.set(n.id, n.parentId ?? null);
  }

  // Orphan inference — same as before, but now uses leaf container, not pool.
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const n of nodes) {
      if (leafOfNode.get(n.id)) continue;
      const tally = new Map<string, number>();
      for (const e of edges) {
        const peer = e.source === n.id ? e.target : e.target === n.id ? e.source : null;
        if (!peer) continue;
        const peerLeaf = leafOfNode.get(peer);
        if (peerLeaf) tally.set(peerLeaf, (tally.get(peerLeaf) ?? 0) + 1);
      }
      if (tally.size === 0) continue;
      const winner = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
      leafOfNode.set(n.id, winner);
      changed = true;
    }
    if (!changed) break;
  }

  // Edges within each leaf container (used by ELK per-container).
  const edgesByLeaf = new Map<string, LayoutEdge[]>();
  for (const e of edges) {
    const srcLeaf = leafOfNode.get(e.source);
    const tgtLeaf = leafOfNode.get(e.target);
    if (srcLeaf && srcLeaf === tgtLeaf) {
      const arr = edgesByLeaf.get(srcLeaf) ?? [];
      arr.push(e);
      edgesByLeaf.set(srcLeaf, arr);
    }
  }

  const newNodes: LayoutNode[] = [];
  const newContainers: LayoutContainer[] = [];
  let poolStackY = 0;

  /** Run ELK on a single leaf container and yield laid-out child nodes
   *  plus the natural (width, height) the algorithm chose. */
  async function layoutLeaf(
    leafId: string,
    leftPad: number,
  ): Promise<{ width: number; height: number; placed: LayoutNode[] }> {
    const childNodes = nodes.filter((n) => leafOfNode.get(n.id) === leafId);
    const childEdges = edgesByLeaf.get(leafId) ?? [];
    if (childNodes.length === 0) {
      return { width: 400, height: 150, placed: [] };
    }
    const elkGraph = {
      id: leafId,
      layoutOptions: elkLayoutOptions(leftPad),
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
    try {
      const laid = (await elk.layout(elkGraph)) as {
        width?: number;
        height?: number;
        children?: Array<{ id: string; x?: number; y?: number }>;
      };
      const placed: LayoutNode[] = [];
      for (const child of laid.children ?? []) {
        const original = childNodes.find((n) => n.id === child.id);
        if (!original) continue;
        const std = standardSizeFor(original.type);
        placed.push({
          ...original,
          x: child.x ?? 0,
          y: child.y ?? 0,
          width: std.width,
          height: std.height,
        });
      }
      return {
        width: Math.max(laid.width ?? 0, 400),
        height: Math.max(laid.height ?? 0, 150),
        placed,
      };
    } catch (err) {
      console.warn(`ELK layout failed for ${leafId}:`, err);
      return { width: 400, height: 150, placed: childNodes };
    }
  }

  for (const pool of pools) {
    const swimlanes = swimlanesByPool.get(pool.id) ?? [];
    if (swimlanes.length > 0) {
      // Pool has swimlanes — lay out each swimlane independently,
      // stack them vertically inside the pool, then resize the pool
      // to enclose them all.
      let laneStackY = 0;
      let maxLaneWidth = 0;
      for (const sw of swimlanes) {
        const laid = await layoutLeaf(sw.id, POOL_LABEL_BAND + 24);
        newContainers.push({
          ...sw,
          x: 0,
          y: laneStackY,
          width: laid.width,
          height: laid.height,
        });
        for (const p of laid.placed) newNodes.push(p);
        laneStackY += laid.height;
        if (laid.width > maxLaneWidth) maxLaneWidth = laid.width;
      }
      newContainers.push({
        ...pool,
        x: 0,
        y: poolStackY,
        width: maxLaneWidth,
        height: laneStackY,
      });
      poolStackY += laneStackY + POOL_GAP;
    } else {
      // Pool has no swimlanes — single ELK pass over the pool itself.
      const laid = await layoutLeaf(pool.id, POOL_LABEL_BAND + POOL_PADDING_X);
      newContainers.push({
        ...pool,
        x: 0,
        y: poolStackY,
        width: laid.width,
        height: laid.height,
      });
      for (const p of laid.placed) newNodes.push(p);
      poolStackY += laid.height + POOL_GAP;
    }
  }

  // Carry forward any nodes / swimlanes we didn't end up laying out
  // (e.g. orphan node with no neighbours to infer membership from).
  const placedIds = new Set(newNodes.map((n) => n.id));
  for (const n of nodes) {
    if (!placedIds.has(n.id)) newNodes.push(n);
  }
  const placedContainerIds = new Set(newContainers.map((c) => c.id));
  for (const c of containers) {
    if (!placedContainerIds.has(c.id)) newContainers.push(c);
  }

  return { nodes: newNodes, containers: newContainers };
}
