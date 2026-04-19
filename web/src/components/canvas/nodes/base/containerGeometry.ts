/* ─── containerGeometry ─────────────────────────────────────────────
 * Shared helper used by PoolNode / LaneNode / future container shapes
 * to clamp a NodeResizer onResize so the container never shrinks past
 * its *full* descendant bounding rect — including grandchildren whose
 * intermediate parent (e.g. a lane inside a pool) may not have itself
 * been grown to encompass them.
 * ──────────────────────────────────────────────────────────────────── */

import type { Node } from "@xyflow/react";

type Bounds = { width: number; height: number };

/** Recursive descent: for each descendant of `containerId`, compute its
 *  position relative to the container (sum parent-relative offsets up
 *  to but not including the container) and compare its bottom-right
 *  corner against the running max.
 *
 *  Cheap — O(N) for a typical small subtree. No memoization needed
 *  since this only runs during an active resize gesture. */
export function minContainerBounds(
  containerId: string,
  nodes: Node[],
): Bounds {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let maxW = 0;
  let maxH = 0;

  for (const n of nodes) {
    // Walk up the parent chain and see if `containerId` is an ancestor.
    // While walking, accumulate offsets so we land with a position
    // relative to `containerId`.
    let relX = n.position?.x ?? 0;
    let relY = n.position?.y ?? 0;
    let cur = n.parentId ? byId.get(n.parentId) : undefined;
    let found = cur?.id === containerId;
    while (cur && !found) {
      relX += cur.position?.x ?? 0;
      relY += cur.position?.y ?? 0;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      if (cur?.id === containerId) found = true;
    }
    if (!found) continue;

    const data = (n.data || {}) as { width?: number; height?: number };
    const w = data.width ?? n.width ?? 120;
    const h = data.height ?? n.height ?? 80;
    if (relX + w > maxW) maxW = relX + w;
    if (relY + h > maxH) maxH = relY + h;
  }

  return { width: maxW, height: maxH };
}
