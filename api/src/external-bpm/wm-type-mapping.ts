/* ─── webMethods TYPE → FlowPro BPMN node-type mapping ────────────
 * Decodes the WMSTEPDEFINITION.TYPE smallint into the string keys used
 * by the Designer's nodeTypes registry (web/src/components/canvas/nodes/index.ts),
 * so the External BPM preview can reuse the exact same node components
 * the Designer renders.
 *
 * Mapping inferred from a 16 082-row sample of the DOE webMethods DB
 * (2026-05-28 discovery). Confirmed with the user; revisit if a new
 * install surfaces TYPE values not in this table.
 * ────────────────────────────────────────────────────────────────── */

export type BpmnNodeKind =
  | 'startEvent'
  | 'endEvent'
  | 'intermediateCatchEvent'
  | 'userTask'
  | 'serviceTask'
  | 'exclusiveGateway'
  | 'callActivity';

const TYPE_MAP: Record<number, BpmnNodeKind> = {
  1: 'serviceTask',           // generic invoke step (largest bucket)
  31: 'userTask',             // CAF human task (COMPONENT = TASKID||<uuid>)
  30: 'exclusiveGateway',     // decision-flavoured
  40: 'exclusiveGateway',     // also decision-flavoured (treated the same in v1)
  50: 'callActivity',         // "initiate"/"receive" — subprocess invocation
  110: 'endEvent',            // explicit end node
  35: 'intermediateCatchEvent', // rare; "await" / intermediate signal
};

/** Map a webMethods TYPE smallint to a FlowPro BPMN node-type key.
 *  Unknown values fall back to serviceTask so the preview still renders
 *  rather than blowing up on an unmapped code. */
export function mapWmTypeToBpmn(type: number | null | undefined): BpmnNodeKind {
  if (type == null) return 'serviceTask';
  return TYPE_MAP[type] ?? 'serviceTask';
}
