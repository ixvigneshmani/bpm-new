/* ─── Rich-Data Extension Elements ────────────────────────────────────
 * Packs the non-spec fields on a node's data into a `<flowpro:Data>`
 * element under `<bpmn:extensionElements>`, and unpacks the inverse on
 * import. Spec-mapped fields (label, bpmnType, defaultFlowId, etc.) are
 * stripped from the payload — only the "rich" fields that don't have a
 * dedicated BPMN attribute travel through extensionElements.
 * ──────────────────────────────────────────────────────────────────── */

import type { BpmnModdle } from "bpmn-moddle";

type Moddle = InstanceType<typeof BpmnModdle>;
type ModdleElement = Record<string, unknown> & { $type: string };

/** Fields on node.data that have dedicated BPMN serialization and should
 *  NOT be duplicated inside extensionElements. */
const SPEC_MAPPED_KEYS = new Set([
  "label",         // → name attr
  "bpmnType",      // internal tag; reconstituted from $type
  "defaultFlowId", // → default attr on gateway
  "instantiate",   // → instantiate attr on event-based gateway
  "width",         // → DI bounds
  "height",        // → DI bounds
]);
// Note: `eventDefinition` intentionally stays in the rich payload even
// though it's *also* emitted as BPMN child elements. The BPMN form is
// lossy (messageName/errorCode/signalName all require root declarations
// we don't emit yet), so we keep the full form in flowpro:Data for a
// lossless self-round-trip, while the BPMN child elements remain for
// interop with other tools.

/** Returns `null` when no rich data needs emitting (so caller can skip
 *  emitting an empty extensionElements wrapper). */
export function packRichData(
  moddle: Moddle,
  data: Record<string, unknown>,
): ModdleElement | null {
  const rich: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SPEC_MAPPED_KEYS.has(k)) continue;
    if (v === undefined || v === null) continue;
    rich[k] = v;
  }
  if (Object.keys(rich).length === 0) return null;

  const flowproData = moddle.create("flowpro:Data", {
    json: JSON.stringify(rich),
  }) as unknown as ModdleElement;

  return moddle.create("bpmn:ExtensionElements", {
    values: [flowproData],
  }) as unknown as ModdleElement;
}

/** Extract the flowpro:Data JSON payload from a parsed flow element's
 *  extensionElements. Returns `{}` when none present or parse fails. */
export function unpackRichData(el: ModdleElement): Record<string, unknown> {
  const ext = el.extensionElements as ModdleElement | undefined;
  if (!ext) return {};
  const values = (ext.values as ModdleElement[] | undefined) || [];
  for (const v of values) {
    if (v.$type !== "flowpro:Data") continue;
    const raw = v.json as string | undefined;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}
