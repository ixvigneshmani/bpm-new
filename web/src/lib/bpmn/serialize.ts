/* ─── BPMN XML Serializer ─────────────────────────────────────────────
 * Converts the canvas JSON (React Flow nodes + edges) into a BPMN 2.0
 * XML string via bpmn-moddle. Emits:
 *   - bpmn:Definitions / bpmn:Process with flowElements
 *   - bpmndi:BPMNDiagram with BPMNShape and BPMNEdge for layout
 *
 * This is a round-trippable subset: every field we read on parse is
 * written on serialize and vice versa. Data model extensions (SLA,
 * retries, etc.) are not yet mapped to BPMN extensionElements — they
 * survive the round-trip via our own JSON persistence, but don't show
 * up in exported .bpmn files.
 * ──────────────────────────────────────────────────────────────────── */

import type { Node, Edge } from "@xyflow/react";
import { BpmnModdle } from "bpmn-moddle";
import { INTERNAL_TO_BPMN, getSize } from "./element-map";
import { flowproDescriptor } from "./flowpro-descriptor";
import { buildEventDefinitionElements } from "./event-definitions";
import { packRichData } from "./extensions";
import type { EventDefinition } from "../../types/bpmn-node-data";

type ModdleElement = Record<string, unknown> & { $type: string; id?: string };

export type SerializeOptions = {
  processId?: string;
  processName?: string;
  /** bpmn:Definitions@id — defaults to a timestamp. */
  definitionsId?: string;
};

export type SerializeResult = {
  xml: string;
  /** Non-fatal issues the caller should surface to the user. */
  warnings: string[];
};

/** Build a BPMN 2.0 XML document from the canvas nodes + edges. */
export async function serializeCanvasToBpmn(
  nodes: Node[],
  edges: Edge[],
  opts: SerializeOptions = {},
): Promise<SerializeResult> {
  const moddle = new BpmnModdle({ flowpro: flowproDescriptor });
  const warnings: string[] = [];

  const processId = opts.processId || "Process_1";
  const processName = opts.processName || "Process";
  const definitionsId = opts.definitionsId || `Definitions_${Date.now()}`;

  // ─── Flow elements (tasks / events / gateways) ─────────────────────
  const flowElements: ModdleElement[] = [];

  // Index outgoing/incoming edges per node for BPMN connectivity refs
  const outgoingByNode = new Map<string, string[]>();
  const incomingByNode = new Map<string, string[]>();
  for (const e of edges) {
    outgoingByNode.set(e.source, [...(outgoingByNode.get(e.source) || []), e.id]);
    incomingByNode.set(e.target, [...(incomingByNode.get(e.target) || []), e.id]);
  }

  for (const n of nodes) {
    const bpmnType = n.type && INTERNAL_TO_BPMN[n.type];
    if (!bpmnType) continue; // unregistered type — skip rather than emit invalid XML

    const data = (n.data || {}) as Record<string, unknown>;
    const el = moddle.create(bpmnType, {
      id: n.id,
      name: (data.label as string) || undefined,
    }) as unknown as ModdleElement;

    // Default flow on exclusive / inclusive gateways — resolved below once
    // sequence flow elements exist (they're declared after flow nodes).
    if (
      (bpmnType === "bpmn:ExclusiveGateway" || bpmnType === "bpmn:InclusiveGateway") &&
      typeof data.defaultFlowId === "string"
    ) {
      el._pendingDefaultFlowId = data.defaultFlowId;
    }

    // Event-based gateway instantiate flag
    if (bpmnType === "bpmn:EventBasedGateway" && data.instantiate) {
      el.instantiate = true;
    }

    // Event definitions on start / end events
    if (bpmnType === "bpmn:StartEvent" || bpmnType === "bpmn:EndEvent") {
      const defs = buildEventDefinitionElements(
        moddle,
        data.eventDefinition as EventDefinition | undefined,
      );
      if (defs.length > 0) el.eventDefinitions = defs;
    }

    // Rich node data → bpmn:extensionElements / flowpro:Data
    const ext = packRichData(moddle, data);
    if (ext) el.extensionElements = ext;

    flowElements.push(el);
  }

  // Index flow elements by ID so we can resolve sourceRef/targetRef to the
  // actual moddle objects — bpmn-moddle stores IDREFs as the referenced
  // element, not as a { $ref } wrapper or bare string.
  const nodeElById = new Map<string, ModdleElement>();
  for (const el of flowElements) if (el.id) nodeElById.set(el.id as string, el);

  // ─── Sequence flows ─────────────────────────────────────────────────
  const sequenceFlowEls: ModdleElement[] = [];
  let skippedMessageFlows = 0;
  for (const e of edges) {
    const flowType = (e.data as Record<string, unknown> | undefined)?.flowType;
    const isMessage = flowType === "message";
    // BPMN 2.0 only permits bpmn:MessageFlow inside a bpmn:Collaboration,
    // not directly in a bpmn:Process. Until pools/collaboration land (P6),
    // skip message flows rather than emit schema-invalid XML.
    if (isMessage) {
      skippedMessageFlows++;
      continue;
    }
    const sourceEl = nodeElById.get(e.source);
    const targetEl = nodeElById.get(e.target);
    if (!sourceEl || !targetEl) continue; // orphan edge — skip

    const attrs: Record<string, unknown> = {
      id: e.id,
      sourceRef: sourceEl,
      targetRef: targetEl,
    };
    const name = (e.label as string) || ((e.data as Record<string, unknown> | undefined)?.label as string);
    if (name) attrs.name = name;

    const flow = moddle.create(
      "bpmn:SequenceFlow",
      attrs,
    ) as unknown as ModdleElement;

    // Condition expression on sequence flows
    const condition = (e.data as Record<string, unknown> | undefined)?.condition;
    if (!isMessage && typeof condition === "string" && condition.length > 0) {
      flow.conditionExpression = moddle.create("bpmn:FormalExpression", {
        body: condition,
      });
    }
    sequenceFlowEls.push(flow);
  }

  if (skippedMessageFlows > 0) {
    warnings.push(
      `Skipped ${skippedMessageFlows} message flow(s). BPMN 2.0 requires message flows inside a Collaboration (Pools), which is not yet supported.`,
    );
  }

  // Index the sequence flows by id for incoming/outgoing resolution
  const flowElById = new Map<string, ModdleElement>();
  for (const el of sequenceFlowEls) if (el.id) flowElById.set(el.id as string, el);

  // Wire incoming/outgoing refs onto flow-node elements. BPMN 2.0 schema
  // requires these lists to be IDREFs to SequenceFlow elements — we pass the
  // resolved moddle objects so bpmn-moddle serializes them as ID strings.
  for (const el of flowElements) {
    const id = el.id as string;
    const incoming = (incomingByNode.get(id) || [])
      .map((fid) => flowElById.get(fid))
      .filter(Boolean) as ModdleElement[];
    const outgoing = (outgoingByNode.get(id) || [])
      .map((fid) => flowElById.get(fid))
      .filter(Boolean) as ModdleElement[];
    if (incoming.length) el.incoming = incoming;
    if (outgoing.length) el.outgoing = outgoing;
  }

  // Resolve pending gateway default-flow refs now that sequence flows exist.
  for (const el of flowElements) {
    const pending = el._pendingDefaultFlowId as string | undefined;
    if (pending) {
      const target = flowElById.get(pending);
      if (target) el.default = target;
      delete el._pendingDefaultFlowId;
    }
  }

  // Append sequence/message flows after the flow nodes so references resolve.
  for (const f of sequenceFlowEls) flowElements.push(f);

  const processEl = moddle.create("bpmn:Process", {
    id: processId,
    name: processName,
    isExecutable: true,
    flowElements,
  });

  // ─── Diagram Interchange (DI) — positions + waypoints ──────────────
  const planeElements: ModdleElement[] = [];

  for (const n of nodes) {
    if (!n.type || !INTERNAL_TO_BPMN[n.type]) continue;
    const referenced = nodeElById.get(n.id);
    if (!referenced) continue;
    const size = getSize(n.type);
    const width = (n.data as { width?: number } | undefined)?.width ?? n.width ?? size.width;
    const height = (n.data as { height?: number } | undefined)?.height ?? n.height ?? size.height;
    const bounds = moddle.create("dc:Bounds", {
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      width: Math.round(width),
      height: Math.round(height),
    });
    const shape = moddle.create("bpmndi:BPMNShape", {
      id: `${n.id}_di`,
      bpmnElement: referenced,
      bounds,
    }) as unknown as ModdleElement;
    planeElements.push(shape);
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const src = nodeById.get(e.source);
    const tgt = nodeById.get(e.target);
    if (!src || !tgt) continue;
    const srcSize = getSize(src.type);
    const tgtSize = getSize(tgt.type);
    const waypoints = [
      moddle.create("dc:Point", {
        x: Math.round(src.position.x + srcSize.width / 2),
        y: Math.round(src.position.y + srcSize.height / 2),
      }),
      moddle.create("dc:Point", {
        x: Math.round(tgt.position.x + tgtSize.width / 2),
        y: Math.round(tgt.position.y + tgtSize.height / 2),
      }),
    ];
    const referencedFlow = flowElById.get(e.id);
    if (!referencedFlow) continue;
    const di = moddle.create("bpmndi:BPMNEdge", {
      id: `${e.id}_di`,
      bpmnElement: referencedFlow,
      waypoint: waypoints,
    }) as unknown as ModdleElement;
    planeElements.push(di);
  }

  const plane = moddle.create("bpmndi:BPMNPlane", {
    id: "BPMNPlane_1",
    bpmnElement: processEl,
    planeElement: planeElements,
  });

  const diagram = moddle.create("bpmndi:BPMNDiagram", {
    id: "BPMNDiagram_1",
    plane,
  });

  // ─── Definitions root ──────────────────────────────────────────────
  const definitions = moddle.create("bpmn:Definitions", {
    id: definitionsId,
    targetNamespace: "http://flowpro.io/bpmn",
    rootElements: [processEl],
    diagrams: [diagram],
  });

  const { xml } = await moddle.toXML(definitions, { format: true });
  return { xml, warnings };
}
