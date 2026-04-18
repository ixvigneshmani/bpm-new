/* ─── BPMN Capability Sets ────────────────────────────────────────────
 * Shared per-element capability lookups — the single source of truth
 * for "which node types can play which BPMN role?". Both the UI
 * validation hints and the validation engine read from here, so new
 * element types (P4b intermediate events, P5 subprocesses, …) can be
 * onboarded by editing one file.
 * ──────────────────────────────────────────────────────────────────── */

/** Valid targets of a sequence flow that leaves an Event-Based Gateway,
 *  per BPMN 2.0 §13.3.4. Only `receiveTask` is registered today; the
 *  intermediate catch events land in P4b and are pre-listed here so the
 *  set doesn't need to change when they land. */
export const EVENT_BASED_VALID_TARGETS: ReadonlySet<string> = new Set([
  "receiveTask",
  "intermediateCatchEvent",
  "intermediateEvent",
  "messageIntermediateCatchEvent",
  "timerIntermediateCatchEvent",
  "signalIntermediateCatchEvent",
  "conditionalIntermediateCatchEvent",
]);
