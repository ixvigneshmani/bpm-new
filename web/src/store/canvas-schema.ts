/* ─── Canvas Schema Versioning ───────────────────────────────────────
 * The canvas JSON (nodes + edges) is persisted to the API. As the
 * BPMN data model evolves across phases, older saved processes must
 * keep loading cleanly. Bump CANVAS_SCHEMA_VERSION and register a
 * migration any time a breaking change lands.
 * ──────────────────────────────────────────────────────────────────── */

import type { Node, Edge } from "@xyflow/react";

/** Bump on every breaking data-model change. */
export const CANVAS_SCHEMA_VERSION = 2;

export type CanvasPayload = {
  schemaVersion: number;
  nodes: Node[];
  edges: Edge[];
};

type Migration = (payload: CanvasPayload) => CanvasPayload;

/** Keyed by the version being migrated *from*. Each entry upgrades
 *  payload.schemaVersion by 1. */
const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: legacy payloads had no schemaVersion; we treat them as v0.
  0: (payload) => ({ ...payload, schemaVersion: 1 }),
  // 1 → 2: subprocess types added. Nesting is expressed via React Flow's
  // native `parentId` / `extent` fields on Node — no pre-existing node
  // gains or loses a parent, so this is a no-op bump.
  1: (payload) => ({ ...payload, schemaVersion: 2 }),
};

/** Accept either a bare `{ nodes, edges }` (legacy) or a versioned payload,
 *  apply migrations, and return the latest shape. Unknown future versions
 *  pass through unchanged with a console warning. */
export function normalizeCanvasPayload(raw: unknown): CanvasPayload {
  if (!raw || typeof raw !== "object") {
    return { schemaVersion: CANVAS_SCHEMA_VERSION, nodes: [], edges: [] };
  }
  const r = raw as Record<string, unknown>;
  let payload: CanvasPayload = {
    schemaVersion: typeof r.schemaVersion === "number" ? r.schemaVersion : 0,
    nodes: Array.isArray(r.nodes) ? (r.nodes as Node[]) : [],
    edges: Array.isArray(r.edges) ? (r.edges as Edge[]) : [],
  };

  let safety = 20;
  while (payload.schemaVersion < CANVAS_SCHEMA_VERSION && safety-- > 0) {
    const migrate = MIGRATIONS[payload.schemaVersion];
    if (!migrate) break;
    payload = migrate(payload);
  }

  if (payload.schemaVersion > CANVAS_SCHEMA_VERSION) {
    console.warn(
      `[canvas] Loaded payload v${payload.schemaVersion} is newer than client v${CANVAS_SCHEMA_VERSION}. ` +
        "Loading as-is; fields unknown to this client will be preserved but not editable."
    );
  }

  return payload;
}

export function toCanvasPayload(nodes: Node[], edges: Edge[]): CanvasPayload {
  return { schemaVersion: CANVAS_SCHEMA_VERSION, nodes, edges };
}
