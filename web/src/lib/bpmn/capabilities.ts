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

/** Service-task `implementation.type` values the engine actually
 *  executes. Other types still serialize cleanly (and the designer
 *  preserves their config) but at runtime the engine logs a `warn` and
 *  no-ops the task — see `resolveServiceTaskTopic` in
 *  `api/src/engine/engine.service.ts`.
 *
 *  Keep this set IN SYNC with the engine's switch. When a new
 *  integration lands (REST handler / inline-script sandbox / connector
 *  framework / etc.), add the type here in the same commit that wires
 *  the engine handler so the picker stops banner-warning the moment
 *  it becomes executable.
 *
 *  GAP-T2-A / T2-C remediation: the designer reads this set to disable
 *  un-implemented impl-type cards and to surface a banner when an
 *  existing process has a non-executable type already saved. */
export const EXECUTABLE_SERVICE_TASK_IMPL_TYPES: ReadonlySet<string> = new Set([
  "externalWorker",
  // I2 — REST handler shipped 2026-05-06. Reads the canvas RestConfig
  // straight out of `nodeData.implementation.config` at runtime.
  "rest",
  // I4 — Connector framework. Engine routes type=connector to the
  // ConnectorDispatcher which resolves connector + connection +
  // operation and runs the registered handler.
  "connector",
]);
