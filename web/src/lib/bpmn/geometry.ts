/* ─── Geometry helpers ───────────────────────────────────────────────
 * Shared coordinate utilities. React Flow stores child positions
 * relative to their `parentId`; BPMN DI stores everything absolute.
 * Converting between the two requires walking the parent chain, and
 * we had three subtly-different copies of that walk (serialize.ts,
 * canvas-store.ts, DesignCanvasPage.ts). Centralized here so future
 * nesting changes (pool-in-pool, black-box participants, etc.) only
 * need to touch one place.
 * ──────────────────────────────────────────────────────────────────── */

type PositionedNode = {
  id: string;
  position: { x: number; y: number };
  parentId?: string;
};

/** Absolute origin of `nodeId` — sum of its own position and every
 *  ancestor's position, walking parentId until root. Returns (0,0) if
 *  the node isn't in `byId` (no throw — callers handle missing nodes
 *  defensively elsewhere). */
export function absOrigin(
  nodeId: string,
  byId: Map<string, PositionedNode>,
): { x: number; y: number } {
  let cur = byId.get(nodeId);
  let x = 0;
  let y = 0;
  while (cur) {
    x += cur.position.x;
    y += cur.position.y;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return { x, y };
}

/** Convert an absolute flow-space position to a position relative to
 *  `parentId`. When `parentId` is null or missing, returns the absolute
 *  value unchanged. */
export function toParentRelative(
  absPos: { x: number; y: number },
  parentId: string | null | undefined,
  byId: Map<string, PositionedNode>,
): { x: number; y: number } {
  if (!parentId) return absPos;
  const p = byId.get(parentId);
  if (!p) return absPos;
  const { x: px, y: py } = absOrigin(parentId, byId);
  return { x: absPos.x - px, y: absPos.y - py };
}
