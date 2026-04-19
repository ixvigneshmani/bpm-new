/* ─── BPMN XML Parser ─────────────────────────────────────────────────
 * Parses a BPMN 2.0 XML string into React Flow nodes + edges via
 * bpmn-moddle. The inverse of `serialize.ts`.
 *
 * Only the first bpmn:Process is imported. Unknown or unmapped element
 * types are dropped with a console warning (so a partial import still
 * yields a usable canvas).
 *
 * Subprocesses recurse: a bpmn:SubProcess's `flowElements` are imported
 * as child nodes with `parentId` set to the subprocess. DI bounds in
 * the XML are absolute; React Flow wants child positions relative to
 * the parent, so we convert on import.
 * ──────────────────────────────────────────────────────────────────── */

import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { BpmnModdle } from "bpmn-moddle";
import { BPMN_TO_INTERNAL, getSize, isSubprocessType } from "./element-map";
import { createDefaultNodeData } from "../../types/bpmn-node-data";
import { flowproDescriptor } from "./flowpro-descriptor";
import { readEventDefinition, resolveRootDeclarations } from "./event-definitions";
import { unpackRichData } from "./extensions";

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
  const moddle = new BpmnModdle({ flowpro: flowproDescriptor });
  const warnings: string[] = [];

  const { rootElement, warnings: parseWarnings } = await moddle.fromXML(xml);
  // bpmn-moddle emits warning objects ({message, error, ...}). `String(obj)`
  // produces "[object Object]" — pull the readable message instead.
  for (const w of parseWarnings || []) {
    const msg = (w as { message?: string })?.message;
    warnings.push(msg || String(w));
  }

  const def = rootElement as unknown as ModdleElement;
  const rootElements = (def.rootElements as ModdleElement[] | undefined) || [];
  const processes = rootElements.filter((r) => r.$type === "bpmn:Process");
  if (processes.length === 0) {
    return { nodes: [], edges: [], processId: null, processName: null, warnings: [...warnings, "No bpmn:Process found in XML"] };
  }

  // Collaboration + Participant → pool nodes. Each Participant owns one
  // Process (via processRef); we walk those Processes as nested scopes,
  // giving every flow node inside a parentId pointing at its pool.
  const collaboration = rootElements.find((r) => r.$type === "bpmn:Collaboration");
  const participantByProcessId = new Map<string, ModdleElement>();
  if (collaboration) {
    const participants = (collaboration.participants as ModdleElement[]) || [];
    for (const p of participants) {
      const procRef = p.processRef as ModdleElement | string | undefined;
      const procId = typeof procRef === "string" ? procRef : procRef?.id;
      if (procId) {
        participantByProcessId.set(procId, p);
      } else {
        warnings.push(
          `Participant "${(p.name as string) || p.id || "(no id)"}" has no processRef — pool will be empty.`,
        );
      }
    }
  }

  // Resolve root Message/Signal/Error declarations so event definitions
  // can map their *Ref back to user-facing names/codes.
  const resolvedDecls = resolveRootDeclarations(rootElements);

  // ─── Index DI shapes/edges by the element they describe ───────────
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

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  /** Map bpmn-moddle $type → our internal type, with disambiguation for
   *  SubProcess variants (event subprocess, transaction, ad-hoc). */
  const resolveInternalType = (el: ModdleElement): string | undefined => {
    // bpmn-moddle's class hierarchy surfaces subclasses with their own
    // $type (bpmn:Transaction, bpmn:AdHocSubProcess). Only bpmn:SubProcess
    // needs the triggeredByEvent disambiguation.
    if (el.$type === "bpmn:SubProcess") {
      return el.triggeredByEvent === true ? "eventSubProcess" : "subProcess";
    }
    return BPMN_TO_INTERNAL[el.$type];
  };

  /** Walk a scope's flowElements recursively, pushing nodes + edges into
   *  the outer arrays. `parentId` is set on child nodes for subprocess
   *  nesting. `parentAbs` is the absolute origin of the enclosing scope
   *  (for converting DI absolute bounds → RF relative positions). */
  const walkScope = (
    flowElements: ModdleElement[],
    parentId: string | null,
    parentAbs: { x: number; y: number },
  ) => {
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

      const internalType = resolveInternalType(el);
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
      const absX = bounds?.x ?? 0;
      const absY = bounds?.y ?? 0;
      // React Flow stores child positions relative to parentId.
      const position = {
        x: absX - parentAbs.x,
        y: absY - parentAbs.y,
      };

      const baseData = createDefaultNodeData(internalType, el.name || undefined) as Record<string, unknown>;

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

      if (
        internalType === "startEvent" ||
        internalType === "endEvent" ||
        internalType === "intermediateCatchEvent" ||
        internalType === "intermediateThrowEvent" ||
        internalType === "boundaryEvent"
      ) {
        baseData.eventDefinition = readEventDefinition(el, resolvedDecls, warnings);
      }

      if (internalType === "boundaryEvent") {
        const attached = el.attachedToRef;
        const attachedId =
          typeof attached === "string"
            ? attached
            : (attached as ModdleElement | undefined)?.id;
        if (attachedId) baseData.attachedToRef = attachedId;
        baseData.cancelActivity = el.cancelActivity !== false;
      }

      // Subprocess-family attributes.
      if (isSubprocessType(internalType)) {
        // Default true when absent (spec default varies by renderer; our
        // canvas is clearest when expanded so children can be seen).
        baseData.isExpanded = el.isExpanded !== false;
        if (internalType === "eventSubProcess") baseData.triggeredByEvent = true;
        if (internalType === "adHocSubProcess") {
          baseData.ordering = el.ordering === "Sequential" ? "Sequential" : "Parallel";
        }
        if (internalType === "transaction" && typeof el.method === "string") {
          baseData.method = el.method;
        }
      }

      const rich = unpackRichData(el);
      for (const [k, v] of Object.entries(rich)) {
        // eventDefinition merge: rich payload was the source of truth
        // before root declarations landed (P6.1), so some files still
        // carry it. If the rich form has an empty name/code but the
        // BPMN ref resolved to one, keep the resolved value — the
        // alternative silently wipes names on re-import.
        if (k === "eventDefinition" && v && typeof v === "object") {
          const resolved = baseData.eventDefinition as Record<string, unknown> | undefined;
          const richDef = v as Record<string, unknown>;
          if (resolved && resolved.kind === richDef.kind) {
            const pickNonEmpty = (key: string) => {
              const rv = richDef[key];
              const sv = resolved[key];
              return typeof rv === "string" && rv.length > 0 ? rv : sv;
            };
            baseData.eventDefinition = {
              ...resolved,
              ...richDef,
              messageName: pickNonEmpty("messageName"),
              signalName: pickNonEmpty("signalName"),
              errorCode: pickNonEmpty("errorCode"),
            };
            continue;
          }
        }
        baseData[k] = v;
      }

      const node: Node = {
        id: el.id,
        type: internalType,
        position,
        data: baseData,
      };
      if (parentId) {
        node.parentId = parentId;
        node.extent = "parent";
      }
      nodes.push(node);

      // Recurse into subprocess children.
      if (isSubprocessType(internalType)) {
        const childFlowElements = (el.flowElements as ModdleElement[] | undefined) || [];
        if (childFlowElements.length > 0) {
          walkScope(childFlowElements, el.id, { x: absX, y: absY });
        }
      }
    }
  };

  // bpmn:MessageFlow elements live on the Collaboration, not on any
  // Process. Walk them here; they become edges with data.flowType.
  if (collaboration) {
    const messageFlows = (collaboration.messageFlows as ModdleElement[] | undefined) || [];
    for (const mf of messageFlows) {
      const source = mf.sourceRef as ModdleElement | string | undefined;
      const target = mf.targetRef as ModdleElement | string | undefined;
      const sourceId = typeof source === "string" ? source : source?.id;
      const targetId = typeof target === "string" ? target : target?.id;
      if (!mf.id || !sourceId || !targetId) {
        warnings.push(`Skipped message flow with missing id/source/target: ${mf.id ?? "(no id)"}`);
        continue;
      }
      edges.push({
        id: mf.id,
        source: sourceId,
        target: targetId,
        label: (mf.name as string) || undefined,
        ...DEFAULT_EDGE_VISUAL,
        data: {
          flowType: "message",
          ...((mf.name as string) ? { label: mf.name as string } : {}),
        },
      });
    }
  }

  // Build pool nodes from Participants (if any). Each Participant gets a
  // matching React Flow node; flow elements inside the pool's Process
  // become its children via parentId. Pool DI bounds come from the
  // BPMNShape whose bpmnElement references the Participant id.
  const poolAbsById = new Map<string, { x: number; y: number }>();
  if (collaboration) {
    const participants = (collaboration.participants as ModdleElement[]) || [];
    for (const p of participants) {
      if (!p.id) continue;
      const shape = shapeByRef.get(p.id);
      const bounds = shape?.bounds as { x?: number; y?: number; width?: number; height?: number } | undefined;
      const absX = bounds?.x ?? 0;
      const absY = bounds?.y ?? 0;
      const baseData = createDefaultNodeData("pool", (p.name as string) || undefined) as Record<string, unknown>;
      baseData.participantName = (p.name as string) || "";
      const procRef = p.processRef as ModdleElement | string | undefined;
      baseData.processId = typeof procRef === "string" ? procRef : procRef?.id;
      const isHorizontal = shape?.isHorizontal;
      baseData.isHorizontal = isHorizontal !== false;
      if (bounds?.width) baseData.width = bounds.width;
      if (bounds?.height) baseData.height = bounds.height;
      nodes.push({
        id: p.id,
        type: "pool",
        position: { x: absX, y: absY },
        data: baseData,
      });
      poolAbsById.set(p.id, { x: absX, y: absY });
    }
  }

  // Walk each Process: if it belongs to a Participant, its flowElements
  // root is the Participant node (relative positions computed from the
  // pool's absolute origin). Otherwise — a Process with no Participant,
  // or the single-Process (no Collaboration) case — walk from root.
  for (const process of processes) {
    const owningParticipant = process.id ? participantByProcessId.get(process.id) : undefined;
    const rootFlowElements = (process.flowElements as ModdleElement[] | undefined) || [];
    if (owningParticipant?.id) {
      walkScope(rootFlowElements, owningParticipant.id, poolAbsById.get(owningParticipant.id) || { x: 0, y: 0 });
    } else {
      walkScope(rootFlowElements, null, { x: 0, y: 0 });
    }

    // Lanes: each LaneSet on the Process declares Lanes with
    // flowNodeRef. Build lane nodes from their BPMNShape bounds, set
    // parentId on referenced flow nodes to the lane. Nested lanes
    // recurse via childLaneSet.
    const laneSets = (process.laneSets as ModdleElement[] | undefined) || [];
    if (laneSets.length > 0) {
      const poolAbs = owningParticipant?.id ? (poolAbsById.get(owningParticipant.id) || { x: 0, y: 0 }) : { x: 0, y: 0 };
      const poolParent = owningParticipant?.id ?? null;
      // Shared id→Node lookup so flowNodeRef resolution is O(1).
      const nodeById = new Map<string, Node>();
      for (const n of nodes) nodeById.set(n.id, n);
      // Tracks which lane claimed each flow node so we can detect and
      // warn on duplicate flowNodeRef references.
      const claimedRefs = new Map<string, string>();
      for (const ls of laneSets) hydrateLaneSet(ls, poolParent, poolAbs, nodeById, claimedRefs);
    }
  }

  /** Walk a LaneSet, push lane nodes, re-parent flow nodes by flowNodeRef.
   *  `nodeById` is a shared Map built once per parse so we get O(1) lookup
   *  per flowNodeRef — otherwise this is O(N²) for large pools.
   *  `claimedRefs` tracks which flow nodes a lane has already adopted; if
   *  a second lane references the same id we ignore it and warn (spec
   *  disallows lane overlap; the winning lane is the first to reference). */
  function hydrateLaneSet(
    laneSet: ModdleElement,
    containerParentId: string | null,
    containerAbs: { x: number; y: number },
    nodeById: Map<string, Node>,
    claimedRefs: Map<string, string>,
  ): void {
    const lanes = (laneSet.lanes as ModdleElement[] | undefined) || [];
    for (const lane of lanes) {
      if (!lane.id) continue;
      const shape = shapeByRef.get(lane.id);
      const bounds = shape?.bounds as { x?: number; y?: number; width?: number; height?: number } | undefined;
      if (!shape || !bounds) {
        warnings.push(
          `Lane "${(lane.name as string) || lane.id}" has no DI bounds — rendered at (0,0) with default size.`,
        );
      }
      const absX = bounds?.x ?? 0;
      const absY = bounds?.y ?? 0;
      const baseData = createDefaultNodeData("lane", (lane.name as string) || undefined) as Record<string, unknown>;
      baseData.isHorizontal = shape?.isHorizontal !== false;
      if (bounds?.width) baseData.width = bounds.width;
      if (bounds?.height) baseData.height = bounds.height;

      const laneNode: Node = {
        id: lane.id,
        type: "lane",
        position: { x: absX - containerAbs.x, y: absY - containerAbs.y },
        data: baseData,
      };
      if (containerParentId) {
        laneNode.parentId = containerParentId;
        laneNode.extent = "parent";
      }
      nodes.push(laneNode);
      nodeById.set(lane.id, laneNode);

      const refs = (lane.flowNodeRef as Array<ModdleElement | string> | undefined) || [];
      for (const ref of refs) {
        const refId = typeof ref === "string" ? ref : ref?.id;
        if (!refId) continue;
        const target = nodeById.get(refId);
        if (!target) {
          warnings.push(
            `Lane "${(lane.name as string) || lane.id}" references unknown flow node "${refId}" — ref dropped.`,
          );
          continue;
        }
        const alreadyClaimedBy = claimedRefs.get(refId);
        if (alreadyClaimedBy && alreadyClaimedBy !== lane.id) {
          warnings.push(
            `Flow node "${refId}" is referenced by both lane "${alreadyClaimedBy}" and lane "${lane.id}" — first-writer wins.`,
          );
          continue;
        }
        claimedRefs.set(refId, lane.id);
        const targetAbsX = (target.position?.x ?? 0) + containerAbs.x;
        const targetAbsY = (target.position?.y ?? 0) + containerAbs.y;
        target.position = { x: targetAbsX - absX, y: targetAbsY - absY };
        target.parentId = lane.id;
        target.extent = "parent";
      }

      const childSet = lane.childLaneSet as ModdleElement | undefined;
      if (childSet) hydrateLaneSet(childSet, lane.id, { x: absX, y: absY }, nodeById, claimedRefs);
    }
  }

  // Mirror isDefault onto each edge whose source gateway marks it default.
  for (const n of nodes) {
    const defaultId = (n.data as { defaultFlowId?: string }).defaultFlowId;
    if (!defaultId) continue;
    for (const e of edges) {
      if (e.source === n.id) {
        e.data = { ...(e.data || {}), isDefault: e.id === defaultId };
      }
    }
  }

  // processId/processName report the *primary* process. When there's a
  // Collaboration, pick the first Process without a Participant (the
  // "host" process) or fall back to the first Process.
  const primaryProcess =
    processes.find((p) => !p.id || !participantByProcessId.has(p.id)) || processes[0];
  return {
    nodes,
    edges,
    processId: primaryProcess.id || null,
    processName: (primaryProcess.name as string) || null,
    warnings,
  };
}
