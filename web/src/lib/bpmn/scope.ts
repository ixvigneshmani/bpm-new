/* ─── Scope helpers ──────────────────────────────────────────────────
 * Shared parent-chain walkers used by the serializer, parser, and
 * validation engine. Keeping one implementation prevents the three
 * call sites from drifting when nesting semantics evolve.
 * ──────────────────────────────────────────────────────────────────── */

type Indexable = { id: string; type?: string; parentId?: string };

/** Walk `nodeId`'s parent chain, returning the first ancestor of the
 *  given type — or `null` if none is found. `byId` is an id→node map
 *  the caller builds once per run. */
export function ancestorOfType(
  nodeId: string,
  byId: Map<string, Indexable>,
  type: string,
): string | null {
  let cur = byId.get(nodeId);
  while (cur) {
    if (cur.type === type) return cur.id;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}

/** Convenience for the most common lookup: the nearest pool. */
export function poolOf(nodeId: string, byId: Map<string, Indexable>): string | null {
  return ancestorOfType(nodeId, byId, "pool");
}
