/* ─── BPMN XML Parser ─────────────────────────────────────────────────
 * Parses a BPMN 2.0 XML string into React Flow nodes + edges via
 * bpmn-moddle. The inverse of `serialize.ts`.
 *
 * Only the first bpmn:Process is imported. Unknown or unmapped element
 * types are dropped with a console warning (so a partial import still
 * yields a usable canvas).
 * ──────────────────────────────────────────────────────────────────── */

import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { BpmnModdle } from "bpmn-moddle";
import { BPMN_TO_INTERNAL, getSize } from "./element-map";
import { createDefaultNodeData } from "../../types/bpmn-node-data";

type ModdleElement = {
  $type: string;
  id?: string;
  name?: string;
  [key: string]: unknown;
};

export type ParseResult = {
  nodes: Node[];
  edges: Edge[];
  processId: string | null;
  processName: string | null;
  /** Non-fatal warnings surfaced to the UI (unmapped elements, missing DI, etc.) */
  warnings: string[];
};

const DEFAULT_EDGE_VISUAL = {
  type: "smoothstep" as const,
  animated: false,
  style: { stroke: "#94A3B8", strokeWidth: 1.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 18,
    height: 18,
    color: "#94A3B8",
  },
};

export async function parseBpmnToCanvas(xml: string): Promise<ParseResult> {
  const moddle = new BpmnModdle();
  const warnings: string[] = [];

  const { rootElement, warnings: parseWarnings } = await moddle.fromXML(xml);
  for (const w of parseWarnings || []) warnings.push(String(w));

  const def = rootElement as unknown as ModdleElement;
  const rootElements = (def.rootElements as ModdleElement[] | undefined) || [];
  const process = rootElements.find((r) => r.$type === "bpmn:Process");
  if (!process) {
    return { nodes: [], edges: [], processId: null, processName: null, warnings: [...warnings, "No bpmn:Process found in XML"] };
  }

  // ─── Layout: index DI shapes and edges by the element they describe ──
  const shapeByRef = new Map<string, ModdleElement>();
  const edgeDiByRef = new Map<string, ModdleElement>();
  const diagrams = (def.diagrams as ModdleElement[] | undefined) || [];
  for (const diagram of diagrams) {
    const plane = diagram.plane as ModdleElement | undefined;
    const planeElements = (plane?.planeElement as ModdleElement[] | undefined) || [];
    for (const pe of planeElements) {
      const ref = (pe.bpmnElement as { id?: string } | undefined)?.id;
      if (!ref) continue;
      if (pe.$type === "bpmndi:BPMNShape") shapeByRef.set(ref, pe);
      else if (pe.$type === "bpmndi:BPMNEdge") edgeDiByRef.set(ref, pe);
    }
  }

  // ─── Walk flow elements: nodes vs flows ────────────────────────────
  const flowElements = (process.flowElements as ModdleElement[] | undefined) || [];
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const el of flowElements) {
    // Sequence / message flows
    if (el.$type === "bpmn:SequenceFlow" || el.$type === "bpmn:MessageFlow") {
      const source = (el.sourceRef as { id?: string } | string | undefined);
      const target = (el.targetRef as { id?: string } | string | undefined);
      const sourceId = typeof source === "string" ? source : source?.id;
      const targetId = typeof target === "string" ? target : target?.id;
      if (!el.id || !sourceId || !targetId) {
        warnings.push(`Skipped flow with missing id/source/target: ${el.id ?? "(no id)"}`);
        continue;
      }

      const condExpr = el.conditionExpression as ModdleElement | undefined;
      const condition = condExpr && typeof condExpr.body === "string" ? condExpr.body : undefined;
      const isMessage = el.$type === "bpmn:MessageFlow";

      edges.push({
        id: el.id,
        source: sourceId,
        target: targetId,
        label: el.name || undefined,
        ...DEFAULT_EDGE_VISUAL,
        data: {
          ...(condition ? { condition } : {}),
          ...(isMessage ? { flowType: "message" } : {}),
          ...(el.name ? { label: el.name } : {}),
        },
      });
      continue;
    }

    // Flow nodes (tasks / events / gateways)
    const internalType = BPMN_TO_INTERNAL[el.$type];
    if (!internalType) {
      warnings.push(`Unsupported element type ${el.$type} (id=${el.id ?? "?"}) — skipped`);
      continue;
    }
    if (!el.id) {
      warnings.push(`Skipped ${el.$type} with no id`);
      continue;
    }

    const shape = shapeByRef.get(el.id);
    const bounds = shape?.bounds as { x?: number; y?: number; width?: number; height?: number } | undefined;
    const size = getSize(internalType);
    const position = {
      x: bounds?.x ?? 0,
      y: bounds?.y ?? 0,
    };

    const baseData = createDefaultNodeData(internalType, el.name || undefined) as Record<string, unknown>;
    // Re-apply known BPMN attributes onto node.data. `default` can come
    // back from bpmn-moddle either as a string ID or as the resolved flow
    // element (when the ref target exists in the document).
    if (internalType === "exclusiveGateway" || internalType === "inclusiveGateway") {
      const defaultRef = el.default;
      const defaultFlowId =
        typeof defaultRef === "string"
          ? defaultRef
          : (defaultRef as ModdleElement | undefined)?.id;
      if (defaultFlowId) baseData.defaultFlowId = defaultFlowId;
    }
    if (internalType === "eventBasedGateway" && typeof el.instantiate === "boolean") {
      baseData.instantiate = el.instantiate;
    }
    if (bounds?.width && bounds.width !== size.width) baseData.width = bounds.width;
    if (bounds?.height && bounds.height !== size.height) baseData.height = bounds.height;

    nodes.push({
      id: el.id,
      type: internalType,
      position,
      data: baseData,
    });
  }

  // Mirror isDefault onto each edge whose source gateway marks it default,
  // so the slash marker renders consistently after import.
  for (const n of nodes) {
    const defaultId = (n.data as { defaultFlowId?: string }).defaultFlowId;
    if (!defaultId) continue;
    for (const e of edges) {
      if (e.source === n.id) {
        e.data = { ...(e.data || {}), isDefault: e.id === defaultId };
      }
    }
  }

  return {
    nodes,
    edges,
    processId: process.id || null,
    processName: (process.name as string) || null,
    warnings,
  };
}
