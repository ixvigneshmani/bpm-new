/* ─── Edge Types Registry ─────────────────────────────────────────────
 * Custom edge components registered with React Flow.
 *
 * Both `sequence` and `bpmnSequence` resolve to the same component.
 * Pre-VX2 fixtures (T1 — Leave Request, Loan Application, anything
 * round-tripped through the older serializer) saved edges with
 * `type: "bpmnSequence"`; the canonical name is `"sequence"`. Without
 * this alias React Flow emits a "edge type X not found, using fallback"
 * warning on every render — one log line per edge per re-render, which
 * floods the console on instance-detail pages that re-render under
 * the polling refresh.
 *
 * Keeping the alias instead of migrating the data:
 *  - existing saved processes don't need an edit-and-resave to render
 *    cleanly,
 *  - the reverse mapping (BPMN XML round-trip via parse.ts) doesn't
 *    have to special-case anything,
 *  - eventual cleanup can land via a v2→v3 canvas-schema migration
 *    that rewrites `bpmnSequence` → `sequence` on load. (Tracked but
 *    not done here — the alias is the minimal silence.)
 * ──────────────────────────────────────────────────────────────────── */

import BpmnSequenceEdge from "./BpmnSequenceEdge";

export const edgeTypes = {
  sequence: BpmnSequenceEdge,
  /** Legacy alias — see header comment. */
  bpmnSequence: BpmnSequenceEdge,
};
