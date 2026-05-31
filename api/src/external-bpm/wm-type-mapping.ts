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
  30: 'serviceTask',          // automated step — large 93×60 task icon, action
                              //   labels ("Get Config", "Update Status", "Handle
                              //   Error"). NOT a gateway: only TYPE 40 carries the
                              //   small 34×34 square decision diamond. (Corrected
                              //   2026-05-31 after the icon-size + label evidence
                              //   on the DOE install contradicted the original
                              //   "decision-flavoured" guess.)
  40: 'exclusiveGateway',     // decision diamond (small 34×34 square icon)
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

/** Resolve the FINAL node kind from the TYPE smallint *and* the authored
 *  icon geometry — the generic, install-agnostic rule.
 *
 *  webMethods draws a decision gateway as a small, roughly-square diamond
 *  (~34×34) and an event as a small circle (~28×28); steps and tasks use a
 *  much larger, wide box (~93×60). Across installs the same TYPE smallint
 *  is reused for both decision diamonds and ordinary steps, so the TYPE
 *  alone cannot be trusted to mean "gateway". A gateway-mapped step that
 *  actually carries a task-sized icon would otherwise render as a stretched
 *  rhombus with an overflowing label.
 *
 *  So: a node only stays a gateway when its icon is genuinely
 *  gateway-shaped (small + near-square). Otherwise it is reclassified as a
 *  service task and renders as a rectangle. This makes the decision-shape
 *  fix work for every model, not just the TYPE codes seen on one install. */
export function resolveNodeKind(
  type: number | null | undefined,
  iconWidth: number | null | undefined,
  iconHeight: number | null | undefined,
): BpmnNodeKind {
  const kind = mapWmTypeToBpmn(type);
  if (kind !== 'exclusiveGateway') return kind;

  const w = iconWidth ?? 0;
  const h = iconHeight ?? 0;
  if (w <= 0 || h <= 0) return kind; // no geometry — trust the TYPE map

  const maxDim = Math.max(w, h);
  const aspect = maxDim / Math.min(w, h);
  // Gateway icons are small (~34) and near-square; task icons are ~93×60.
  const isGatewayShape = maxDim <= 60 && aspect <= 1.5;
  return isGatewayShape ? 'exclusiveGateway' : 'serviceTask';
}
