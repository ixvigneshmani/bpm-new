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
 *
 * Subprocesses nest: children of a subProcess live in its `flowElements`
 * (not at the process level), recursively. React Flow stores child
 * positions relative to the parent via `node.parentId`; DI bounds are
 * always absolute, so we walk the parent chain to compute each shape's
 * absolute origin before writing `dc:Bounds`.
 * ──────────────────────────────────────────────────────────────────── */

import type { Node, Edge } from "@xyflow/react";
import { BpmnModdle } from "bpmn-moddle";
import { INTERNAL_TO_BPMN, getSize, isSubprocessType, COLLAPSED_SUBPROCESS_SIZE } from "./element-map";
import { flowproDescriptor } from "./flowpro-descriptor";
import {
  buildEventDefinitionElements,
  collectRootDeclarationNames,
  emptyRootDeclarations,
  rootDeclarationsAsArray,
} from "./event-definitions";
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

  // ─── Root declarations (Message / Signal / Error) ─────────────────
  // Pre-scan every node's data and allocate one root element per unique
  // name/code. buildEventDefinitionElements then resolves refs against
  // this registry so the emitted XML carries `messageRef`/`signalRef`/
  // `errorRef` — required for interop with other BPMN tools.
  const rootDecls = emptyRootDeclarations();
  collectRootDeclarationNames(
    moddle,
    rootDecls,
    nodes.map((n) => (n.data || {}) as Record<string, unknown>),
  );

  // ─── Index edges per endpoint ──────────────────────────────────────
  const outgoingByNode = new Map<string, string[]>();
  const incomingByNode = new Map<string, string[]>();
  for (const e of edges) {
    outgoingByNode.set(e.source, [...(outgoingByNode.get(e.source) || []), e.id]);
    incomingByNode.set(e.target, [...(incomingByNode.get(e.target) || []), e.id]);
  }

  // ─── Containment index: parentId → children ────────────────────────
  // `null` parent = root process scope. Nodes with an unknown parentId
  // are promoted to root (the alternative — silently dropping them —
  // would lose user work on a data glitch).
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const childrenByParent = new Map<string | null, Node[]>();
  for (const n of nodes) {
    const pid = n.parentId && nodeById.has(n.parentId) ? n.parentId : null;
    const arr = childrenByParent.get(pid) || [];
    arr.push(n);
    childrenByParent.set(pid, arr);
  }

  /** Walk the parent chain to find the scope (parentId, or null for root)
   *  that a node belongs to. */
  const scopeOf = (nodeId: string): string | null => {
    const n = nodeById.get(nodeId);
    if (!n) return null;
    return n.parentId && nodeById.has(n.parentId) ? n.parentId : null;
  };

  /** Deepest shared parent for two node ids. Returns null for root. */
  const commonScope = (aId: string, bId: string): string | null => {
    const ancestors = new Set<string | null>();
    let cur: string | null = aId;
    while (cur) {
      ancestors.add(scopeOf(cur));
      const p: string | undefined = nodeById.get(cur)?.parentId;
      cur = p && nodeById.has(p) ? p : null;
    }
    ancestors.add(null);
    cur = bId;
    while (cur) {
      const s = scopeOf(cur);
      if (ancestors.has(s)) return s;
      const p: string | undefined = nodeById.get(cur)?.parentId;
      cur = p && nodeById.has(p) ? p : null;
    }
    return null;
  };

  // ─── Assign sequence flows to their hosting scope ──────────────────
  // Edges live in the nearest common ancestor of their endpoints.
  // Message flows are deferred until Collaboration (P6) lands.
  const flowsByScope = new Map<string | null, Edge[]>();
  let skippedMessageFlows = 0;
  for (const e of edges) {
    const flowType = (e.data as Record<string, unknown> | undefined)?.flowType;
    if (flowType === "message") {
      skippedMessageFlows++;
      continue;
    }
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    const scope = commonScope(e.source, e.target);
    const arr = flowsByScope.get(scope) || [];
    arr.push(e);
    flowsByScope.set(scope, arr);
  }
  if (skippedMessageFlows > 0) {
    warnings.push(
      `Skipped ${skippedMessageFlows} message flow(s). BPMN 2.0 requires message flows inside a Collaboration (Pools), which is not yet supported.`,
    );
  }

  // ─── Build moddle elements for every flow node and sequence flow ──
  // These get stitched into their scope's `flowElements` list below.
  const nodeElById = new Map<string, ModdleElement>();
  const flowElById = new Map<string, ModdleElement>();

  const buildFlowNode = (n: Node): ModdleElement | null => {
    const bpmnType = n.type && INTERNAL_TO_BPMN[n.type];
    if (!bpmnType) return null;
    const data = (n.data || {}) as Record<string, unknown>;
    const el = moddle.create(bpmnType, {
      id: n.id,
      name: (data.label as string) || undefined,
    }) as unknown as ModdleElement;

    // Default flow — deferred until sequence flows resolved in a second pass.
    if (
      (bpmnType === "bpmn:ExclusiveGateway" || bpmnType === "bpmn:InclusiveGateway") &&
      typeof data.defaultFlowId === "string"
    ) {
      el._pendingDefaultFlowId = data.defaultFlowId;
    }

    if (bpmnType === "bpmn:EventBasedGateway" && data.instantiate) {
      el.instantiate = true;
    }

    // Event definitions on any event element.
    if (
      bpmnType === "bpmn:StartEvent" ||
      bpmnType === "bpmn:EndEvent" ||
      bpmnType === "bpmn:IntermediateCatchEvent" ||
      bpmnType === "bpmn:IntermediateThrowEvent" ||
      bpmnType === "bpmn:BoundaryEvent"
    ) {
      const defs = buildEventDefinitionElements(
        moddle,
        data.eventDefinition as EventDefinition | undefined,
        rootDecls,
      );
      if (defs.length > 0) el.eventDefinitions = defs;
    }

    if (bpmnType === "bpmn:BoundaryEvent") {
      const attachedToRef = data.attachedToRef;
      if (typeof attachedToRef === "string" && attachedToRef.length > 0) {
        el._pendingAttachedToRef = attachedToRef;
      }
      if (data.cancelActivity === false) el.cancelActivity = false;
    }

    // Subprocess-family attributes.
    if (isSubprocessType(n.type)) {
      if (data.isExpanded !== false) el.isExpanded = true;
      else el.isExpanded = false;
      if (n.type === "eventSubProcess") el.triggeredByEvent = true;
      if (n.type === "adHocSubProcess") {
        const ordering = data.ordering === "Sequential" ? "Sequential" : "Parallel";
        el.ordering = ordering;
      }
      if (n.type === "transaction" && typeof data.method === "string") {
        el.method = data.method;
      }
    }

    const ext = packRichData(moddle, data);
    if (ext) el.extensionElements = ext;

    return el;
  };

  for (const n of nodes) {
    const el = buildFlowNode(n);
    if (el) nodeElById.set(n.id, el);
  }

  const buildSequenceFlow = (e: Edge): ModdleElement | null => {
    const sourceEl = nodeElById.get(e.source);
    const targetEl = nodeElById.get(e.target);
    if (!sourceEl || !targetEl) return null;
    const attrs: Record<string, unknown> = {
      id: e.id,
      sourceRef: sourceEl,
      targetRef: targetEl,
    };
    const name = (e.label as string) || ((e.data as Record<string, unknown> | undefined)?.label as string);
    if (name) attrs.name = name;
    const flow = moddle.create("bpmn:SequenceFlow", attrs) as unknown as ModdleElement;
    const condition = (e.data as Record<string, unknown> | undefined)?.condition;
    if (typeof condition === "string" && condition.length > 0) {
      flow.conditionExpression = moddle.create("bpmn:FormalExpression", { body: condition });
    }
    return flow;
  };

  for (const [, scopedEdges] of flowsByScope) {
    for (const e of scopedEdges) {
      const flow = buildSequenceFlow(e);
      if (flow) flowElById.set(e.id, flow);
    }
  }

  // Wire incoming/outgoing onto every flow node now that flows exist.
  for (const [id, el] of nodeElById) {
    const incoming = (incomingByNode.get(id) || [])
      .map((fid) => flowElById.get(fid))
      .filter(Boolean) as ModdleElement[];
    const outgoing = (outgoingByNode.get(id) || [])
      .map((fid) => flowElById.get(fid))
      .filter(Boolean) as ModdleElement[];
    if (incoming.length) el.incoming = incoming;
    if (outgoing.length) el.outgoing = outgoing;
  }

  // Resolve pending default-flow refs.
  for (const el of nodeElById.values()) {
    const pending = el._pendingDefaultFlowId as string | undefined;
    if (pending) {
      const target = flowElById.get(pending);
      if (target) el.default = target;
      delete el._pendingDefaultFlowId;
    }
  }

  // Resolve pending boundary attachedToRef.
  for (const el of nodeElById.values()) {
    const pending = el._pendingAttachedToRef as string | undefined;
    if (!pending) continue;
    const host = nodeElById.get(pending);
    if (host) {
      el.attachedToRef = host;
    } else {
      warnings.push(
        `Boundary event ${el.id} references unknown activity "${pending}"; attachedToRef dropped.`,
      );
    }
    delete el._pendingAttachedToRef;
  }

  // ─── Assemble flowElements per scope (recursive into subprocesses) ─
  const assembleScope = (parentId: string | null): ModdleElement[] => {
    const out: ModdleElement[] = [];
    const children = childrenByParent.get(parentId) || [];
    for (const n of children) {
      const el = nodeElById.get(n.id);
      if (!el) continue;
      if (isSubprocessType(n.type)) {
        const nested = assembleScope(n.id);
        if (nested.length > 0) el.flowElements = nested;
      }
      out.push(el);
    }
    const scopedFlows = flowsByScope.get(parentId) || [];
    for (const e of scopedFlows) {
      const flow = flowElById.get(e.id);
      if (flow) out.push(flow);
    }
    return out;
  };

  // ─── Pools / Collaboration wrap ────────────────────────────────────
  // When no pool is on the canvas we keep the flat single-Process output
  // byte-identical to P1–P5 exports (critical for backwards-compat —
  // existing saved processes must re-export the same way). Only once a
  // pool exists do we wrap in a Collaboration with one Process per pool.
  const pools = nodes.filter((n) => n.type === "pool");
  const hasPools = pools.length > 0;

  let processesForDefinitions: ModdleElement[];
  let collaborationEl: ModdleElement | null = null;
  let diPlaneTarget: ModdleElement;

  if (!hasPools) {
    const processFlowElements = assembleScope(null);
    const processEl = moddle.create("bpmn:Process", {
      id: processId,
      name: processName,
      isExecutable: true,
      flowElements: processFlowElements,
    }) as unknown as ModdleElement;
    processesForDefinitions = [processEl];
    diPlaneTarget = processEl;
  } else {
    // Orphan flow nodes (no pool ancestor) need a home. Rather than drop
    // them silently, host them inside the first pool's Process and warn.
    const orphans = nodes.filter((n) => {
      if (n.type === "pool") return false;
      if (!n.type || !INTERNAL_TO_BPMN[n.type]) return false;
      // Walk up; if we never hit a pool, it's an orphan.
      let cur: Node | undefined = n;
      while (cur) {
        if (cur.type === "pool") return false;
        cur = cur.parentId ? nodeById.get(cur.parentId) : undefined;
      }
      return true;
    });
    if (orphans.length > 0) {
      warnings.push(
        `${orphans.length} flow node(s) outside any pool were placed in "${((pools[0].data as { label?: string })?.label) || pools[0].id}" on export. Drag them into a pool to control placement.`,
      );
    }

    // Adopt orphans into the first pool *in the scope map only* (no data
    // mutation) so assembleScope sees them as children.
    const firstPoolId = pools[0].id;
    if (orphans.length > 0) {
      const adopted = childrenByParent.get(firstPoolId) || [];
      const adoptedIds = new Set(adopted.map((n) => n.id));
      for (const n of orphans) if (!adoptedIds.has(n.id)) adopted.push(n);
      childrenByParent.set(firstPoolId, adopted);
      // Orphan flows (scope=null) also move under the first pool.
      const rootFlows = flowsByScope.get(null) || [];
      if (rootFlows.length > 0) {
        const existing = flowsByScope.get(firstPoolId) || [];
        flowsByScope.set(firstPoolId, [...existing, ...rootFlows]);
        flowsByScope.set(null, []);
      }
    }

    processesForDefinitions = [];
    const participantEls: ModdleElement[] = [];
    for (const pool of pools) {
      const poolData = (pool.data || {}) as { label?: string; participantName?: string; processId?: string };
      const derivedProcessId = poolData.processId || `Process_${pool.id}`;
      const processEl = moddle.create("bpmn:Process", {
        id: derivedProcessId,
        name: poolData.label || poolData.participantName || "Process",
        isExecutable: true,
        flowElements: assembleScope(pool.id),
      }) as unknown as ModdleElement;
      processesForDefinitions.push(processEl);

      const participantEl = moddle.create("bpmn:Participant", {
        id: pool.id,
        name: poolData.participantName || poolData.label || "Pool",
        processRef: processEl,
      }) as unknown as ModdleElement;
      participantEls.push(participantEl);
    }

    collaborationEl = moddle.create("bpmn:Collaboration", {
      id: `Collaboration_${processId}`,
      participants: participantEls,
    }) as unknown as ModdleElement;
    diPlaneTarget = collaborationEl;
  }

  // ─── Diagram Interchange (DI) — positions + waypoints ──────────────
  // DI bounds are absolute per BPMN 2.0 §A.1 (BPMNDI on a single Plane).
  // React Flow keeps child positions relative to their parent node, so
  // we walk the parent chain to compute the absolute origin for each shape.
  const absPos = (n: Node): { x: number; y: number } => {
    let x = n.position.x;
    let y = n.position.y;
    let cur: Node | undefined = n;
    while (cur?.parentId) {
      const p = nodeById.get(cur.parentId);
      if (!p) break;
      x += p.position.x;
      y += p.position.y;
      cur = p;
    }
    return { x, y };
  };

  const effectiveSize = (n: Node): { width: number; height: number } => {
    const data = (n.data || {}) as { width?: number; height?: number; isExpanded?: boolean };
    if (isSubprocessType(n.type) && data.isExpanded === false) {
      // Collapsed: ignore any width/height the user set while expanded.
      // Those represent the expanded-frame size and would produce a
      // giant "collapsed" shape in the DI (and in the canvas render).
      return COLLAPSED_SUBPROCESS_SIZE;
    }
    const size = getSize(n.type);
    return {
      width: data.width ?? n.width ?? size.width,
      height: data.height ?? n.height ?? size.height,
    };
  };

  const planeElements: ModdleElement[] = [];

  // Pool shapes first — they sit behind the flow-node shapes in z-order.
  // Build id→Participant lookup so we can point each pool's BPMNShape at
  // the moddle Participant object (bpmn-moddle expects the reference, not
  // a bare id string, and serializes it back to an IDREF).
  const participantByPoolId = new Map<string, ModdleElement>();
  if (collaborationEl) {
    const participants = (collaborationEl.participants as ModdleElement[]) || [];
    for (const p of participants) if (p.id) participantByPoolId.set(p.id as string, p);
  }
  if (hasPools) {
    for (const pool of pools) {
      const participant = participantByPoolId.get(pool.id);
      if (!participant) continue;
      const { x, y } = absPos(pool);
      const size = effectiveSize(pool);
      const bounds = moddle.create("dc:Bounds", {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(size.width),
        height: Math.round(size.height),
      });
      const poolData = (pool.data || {}) as { isHorizontal?: boolean };
      const poolShape = moddle.create("bpmndi:BPMNShape", {
        id: `${pool.id}_di`,
        bpmnElement: participant,
        bounds,
        isHorizontal: poolData.isHorizontal !== false,
      }) as unknown as ModdleElement;
      planeElements.push(poolShape);
    }
  }

  for (const n of nodes) {
    if (!n.type || !INTERNAL_TO_BPMN[n.type]) continue;
    const referenced = nodeElById.get(n.id);
    if (!referenced) continue;
    const { x, y } = absPos(n);
    const { width, height } = effectiveSize(n);
    const bounds = moddle.create("dc:Bounds", {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    });
    const shape = moddle.create("bpmndi:BPMNShape", {
      id: `${n.id}_di`,
      bpmnElement: referenced,
      bounds,
    }) as unknown as ModdleElement;
    // Expanded subprocesses must declare isExpanded on their shape for the
    // DI renderer to expand them; collapsed ones default to collapsed.
    if (isSubprocessType(n.type)) {
      const isExpanded = (n.data as { isExpanded?: boolean } | undefined)?.isExpanded !== false;
      shape.isExpanded = isExpanded;
    }
    planeElements.push(shape);
  }

  for (const e of edges) {
    const src = nodeById.get(e.source);
    const tgt = nodeById.get(e.target);
    if (!src || !tgt) continue;
    const srcAbs = absPos(src);
    const tgtAbs = absPos(tgt);
    const srcSize = effectiveSize(src);
    const tgtSize = effectiveSize(tgt);
    const waypoints = [
      moddle.create("dc:Point", {
        x: Math.round(srcAbs.x + srcSize.width / 2),
        y: Math.round(srcAbs.y + srcSize.height / 2),
      }),
      moddle.create("dc:Point", {
        x: Math.round(tgtAbs.x + tgtSize.width / 2),
        y: Math.round(tgtAbs.y + tgtSize.height / 2),
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
    bpmnElement: diPlaneTarget,
    planeElement: planeElements,
  });

  const diagram = moddle.create("bpmndi:BPMNDiagram", {
    id: "BPMNDiagram_1",
    plane,
  });

  // Process(es) must come AFTER Message/Signal/Error in rootElements —
  // some importers resolve refs positionally and complain if the
  // declaration appears after its first reference. Collaboration (when
  // present) sits at the end, again to keep refs resolvable forward.
  const rootElements: ModdleElement[] = [
    ...rootDeclarationsAsArray(rootDecls),
    ...processesForDefinitions,
  ];
  if (collaborationEl) rootElements.push(collaborationEl);

  const definitions = moddle.create("bpmn:Definitions", {
    id: definitionsId,
    targetNamespace: "http://flowpro.io/bpmn",
    rootElements,
    diagrams: [diagram],
  });

  const { xml } = await moddle.toXML(definitions, { format: true });
  return { xml, warnings };
}
