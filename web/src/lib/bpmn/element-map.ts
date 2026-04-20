/* ─── BPMN Element Type Map ───────────────────────────────────────────
 * Maps our internal React Flow node types to the BPMN 2.0 XML element
 * names used by bpmn-moddle. Used by both the serializer (out) and
 * parser (in) so the two stay symmetric.
 * ──────────────────────────────────────────────────────────────────── */

/** Default on-canvas size per element type (pixels). Used for DI bounds
 *  when a node doesn't already carry a `width`/`height` override. */
export const DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  startEvent: { width: 36, height: 36 },
  endEvent: { width: 36, height: 36 },
  intermediateCatchEvent: { width: 36, height: 36 },
  intermediateThrowEvent: { width: 36, height: 36 },
  boundaryEvent: { width: 36, height: 36 },
  userTask: { width: 120, height: 80 },
  serviceTask: { width: 120, height: 80 },
  scriptTask: { width: 120, height: 80 },
  sendTask: { width: 120, height: 80 },
  receiveTask: { width: 120, height: 80 },
  manualTask: { width: 120, height: 80 },
  businessRuleTask: { width: 120, height: 80 },
  callActivity: { width: 120, height: 80 },
  exclusiveGateway: { width: 50, height: 50 },
  parallelGateway: { width: 50, height: 50 },
  inclusiveGateway: { width: 50, height: 50 },
  eventBasedGateway: { width: 50, height: 50 },
  subProcess: { width: 360, height: 200 },
  eventSubProcess: { width: 360, height: 200 },
  transaction: { width: 360, height: 200 },
  adHocSubProcess: { width: 360, height: 200 },
  pool: { width: 800, height: 240 },
  lane: { width: 770, height: 120 },
  dataStore: { width: 60, height: 54 },
  textAnnotation: { width: 180, height: 70 },
  group: { width: 320, height: 200 },
};

/** Collapsed subprocess shapes render as task-sized boxes; use this when
 *  a subProcess/transaction/etc. has `isExpanded=false`. */
export const COLLAPSED_SUBPROCESS_SIZE = { width: 120, height: 80 };

export function isSubprocessType(type: string | undefined): boolean {
  return (
    type === "subProcess" ||
    type === "eventSubProcess" ||
    type === "transaction" ||
    type === "adHocSubProcess"
  );
}

/** Pools and lanes aren't flow nodes — they're `bpmn:Participant` and
 *  `bpmn:Lane` respectively, emitted outside the flowElements list.
 *  `INTERNAL_TO_BPMN` intentionally omits them; callers branch on this
 *  helper before walking the flow-node path. */
export function isSwimlaneType(type: string | undefined): boolean {
  return type === "pool" || type === "lane";
}

/** Data artifacts + annotations (BPMN 2.0 §10.4). These live alongside
 *  flow nodes in the process but serialize as `bpmn:DataStoreReference`
 *  / `bpmn:TextAnnotation` / `bpmn:Group` and are NOT valid endpoints
 *  for sequence or message flows. DataObject is intentionally omitted
 *  — FlowPro represents in-process data via `processMeta.businessDoc`. */
export function isArtifactType(type: string | undefined): boolean {
  return (
    type === "dataStore" ||
    type === "textAnnotation" ||
    type === "group"
  );
}

/** Any node that acts as a container for others (influences parentId
 *  semantics + containment UX). Combination of subprocess + swimlane. */
export function isContainerType(type: string | undefined): boolean {
  return isSubprocessType(type) || isSwimlaneType(type);
}

/** Internal React Flow node type → bpmn-moddle $type. */
export const INTERNAL_TO_BPMN: Record<string, string> = {
  startEvent: "bpmn:StartEvent",
  endEvent: "bpmn:EndEvent",
  intermediateCatchEvent: "bpmn:IntermediateCatchEvent",
  intermediateThrowEvent: "bpmn:IntermediateThrowEvent",
  boundaryEvent: "bpmn:BoundaryEvent",
  userTask: "bpmn:UserTask",
  serviceTask: "bpmn:ServiceTask",
  scriptTask: "bpmn:ScriptTask",
  sendTask: "bpmn:SendTask",
  receiveTask: "bpmn:ReceiveTask",
  manualTask: "bpmn:ManualTask",
  businessRuleTask: "bpmn:BusinessRuleTask",
  callActivity: "bpmn:CallActivity",
  exclusiveGateway: "bpmn:ExclusiveGateway",
  parallelGateway: "bpmn:ParallelGateway",
  inclusiveGateway: "bpmn:InclusiveGateway",
  eventBasedGateway: "bpmn:EventBasedGateway",
  subProcess: "bpmn:SubProcess",
  // Event subprocesses are a bpmn:SubProcess with triggeredByEvent=true.
  // On serialize we emit bpmn:SubProcess; on parse we re-discriminate
  // below based on the triggeredByEvent attribute.
  eventSubProcess: "bpmn:SubProcess",
  transaction: "bpmn:Transaction",
  adHocSubProcess: "bpmn:AdHocSubProcess",
  // Artifacts. DataStore uses the reference form directly (every BPMN
  // tool draws the reference, not the declaration).
  dataStore: "bpmn:DataStoreReference",
  textAnnotation: "bpmn:TextAnnotation",
  group: "bpmn:Group",
};

/** Inverse: bpmn-moddle $type → our internal type. Built at module load.
 *  Note: bpmn:SubProcess collides between `subProcess` and `eventSubProcess`
 *  here — the inverse returns `subProcess` by last-write-wins. Callers
 *  discriminate via `triggeredByEvent` on the moddle element (see parse.ts). */
export const BPMN_TO_INTERNAL: Record<string, string> = Object.fromEntries(
  Object.entries(INTERNAL_TO_BPMN)
    .filter(([k]) => k !== "eventSubProcess")
    .map(([k, v]) => [v, k]),
);

export function getSize(type: string | undefined): { width: number; height: number } {
  return (type && DEFAULT_SIZE[type]) || { width: 100, height: 80 };
}
