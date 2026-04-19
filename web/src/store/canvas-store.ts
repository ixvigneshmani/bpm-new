import { create } from "zustand";
import { temporal } from "zundo";
import {
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  reconnectEdge,
  MarkerType,
} from "@xyflow/react";
import { nanoid } from "nanoid";
import { createDefaultNodeData, type BpmnNodeData } from "../types/bpmn-node-data";

export type ProcessMeta = {
  name: string;
  description: string;
  businessDoc: Record<string, unknown> | null;
  businessDocName: string;
  businessDocSource: "template" | "paste" | "empty" | null;
  status: string;
  creatorName: string;
  updatedAt: string;
};

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type CanvasState = {
  processId: string | null;
  processMeta: ProcessMeta;
  wizardStep: "details" | "document" | "canvas";
  wizardOrigin: "list" | "canvas";
  documentDirty: boolean;
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;

  /* Save state surfaced in the subheader */
  saveStatus: SaveStatus;
  lastSavedAt: number | null;        // epoch ms

  /* In-memory clipboard (nodes + edges that were copied) */
  clipboard: { nodes: Node[]; edges: Edge[] } | null;

  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  addNode: (
    type: string,
    position: { x: number; y: number },
    label?: string,
    parentId?: string,
  ) => void;
  /** Move a node (and its descendant subtree) under a new parent, or to
   *  the root when `parentId` is null. React Flow positions become
   *  relative to the new parent, so this also adjusts `position`. */
  reparentNode: (nodeId: string, parentId: string | null) => void;
  setSelectedNode: (id: string | null) => void;
  updateNodeLabel: (id: string, label: string) => void;
  updateNodeData: (id: string, patch: Partial<BpmnNodeData>) => void;
  updateEdgeLabel: (id: string, label: string) => void;
  updateEdgeData: (id: string, patch: Record<string, unknown>) => void;
  /** Set an edge's condition (FEEL) for exclusive/inclusive gateways. */
  setEdgeCondition: (edgeId: string, condition: string) => void;
  /** Atomically mark a single outgoing edge of `gatewayId` as the default.
   *  Writes `defaultFlowId` on the node *and* mirrors `isDefault` onto each
   *  outgoing edge so the slash marker renders. Pass `null` to clear. */
  setGatewayDefaultFlow: (gatewayId: string, flowId: string | null) => void;
  reconnectEdge: (oldEdge: Edge, newConnection: Connection) => void;

  /* Selection-aware actions (multi-select) */
  deleteSelected: () => void;
  copySelected: () => void;
  pasteClipboard: () => void;
  duplicateSelected: () => void;

  setSaveStatus: (status: SaveStatus) => void;

  setProcessId: (id: string | null) => void;
  setProcessMeta: (meta: Partial<ProcessMeta>) => void;
  setWizardStep: (step: "details" | "document" | "canvas") => void;
  setWizardOrigin: (origin: "list" | "canvas") => void;
  setDocumentDirty: (dirty: boolean) => void;
  loadCanvasData: (nodes: Node[], edges: Edge[]) => void;
  resetCanvas: () => void;
};

const DEFAULT_EDGE_VISUAL = {
  type: "smoothstep",
  animated: false,
  style: { stroke: "#94A3B8", strokeWidth: 1.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 18,
    height: 18,
    color: "#94A3B8",
  },
};

const useCanvasStore = create<CanvasState>()(
  temporal(
    (set, get) => ({
      processId: null as string | null,
      processMeta: { name: "", description: "", businessDoc: null, businessDocName: "", businessDocSource: null, status: "DRAFT", creatorName: "", updatedAt: "" },
      wizardStep: "details" as const,
      wizardOrigin: "list" as const,
      documentDirty: false,
      nodes: [],
      edges: [],
      selectedNodeId: null,
      saveStatus: "idle" as SaveStatus,
      lastSavedAt: null as number | null,
      clipboard: null,

      onNodesChange: (changes) => {
        set({ nodes: applyNodeChanges(changes, get().nodes) });
      },

      onEdgesChange: (changes) => {
        set({ edges: applyEdgeChanges(changes, get().edges) });
      },

      onConnect: (connection) => {
        const id = `e-${nanoid(8)}`;
        set({
          edges: addEdge(
            { ...connection, id, ...DEFAULT_EDGE_VISUAL },
            get().edges
          ),
        });
      },

      addNode: (type, position, label, parentId) => {
        const id = `${type}-${nanoid(8)}`;
        const nodes = get().nodes;
        // React Flow requires child positions relative to parent. If the
        // caller passed an absolute position and a parent, convert once
        // here so every call-site doesn't have to repeat the math.
        let pos = position;
        if (parentId) {
          const parent = nodes.find((n) => n.id === parentId);
          if (parent) {
            // Walk up to compute parent's absolute origin.
            let px = parent.position.x;
            let py = parent.position.y;
            let cur: Node | undefined = parent;
            while (cur?.parentId) {
              const gp = nodes.find((n) => n.id === cur!.parentId);
              if (!gp) break;
              px += gp.position.x;
              py += gp.position.y;
              cur = gp;
            }
            pos = { x: position.x - px, y: position.y - py };
          }
        }
        const newNode: Node = {
          id,
          type,
          position: pos,
          data: createDefaultNodeData(type, label),
          ...(parentId ? { parentId, extent: "parent" as const } : {}),
        };
        set({ nodes: [...nodes, newNode] });
      },

      reparentNode: (nodeId, parentId) => {
        const nodes = get().nodes;
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return;
        if ((node.parentId || null) === parentId) return;

        // No self-parenting, no creating cycles (can't drop a subprocess
        // into one of its own descendants).
        if (parentId === nodeId) return;
        const byId = new Map(nodes.map((n) => [n.id, n]));
        if (parentId) {
          let cur: string | undefined = parentId;
          while (cur) {
            if (cur === nodeId) return;
            cur = byId.get(cur)?.parentId;
          }
        }

        const absOf = (id: string): { x: number; y: number } => {
          let cur: Node | undefined = byId.get(id);
          let x = 0;
          let y = 0;
          while (cur) {
            x += cur.position.x;
            y += cur.position.y;
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
          }
          return { x, y };
        };

        // Boundary events attached to the moved node must follow — they're
        // geometrically and semantically tied to their host's scope per
        // BPMN 2.0 §10.5.5. Without this, dragging a task-with-boundary
        // into a subprocess strands the boundary at the old scope.
        const boundaryIds = new Set<string>();
        for (const n of nodes) {
          if (n.type !== "boundaryEvent") continue;
          const attachedTo = (n.data as { attachedToRef?: string })?.attachedToRef;
          if (attachedTo === nodeId) boundaryIds.add(n.id);
        }

        const newParentAbs = parentId ? absOf(parentId) : { x: 0, y: 0 };

        set({
          nodes: nodes.map((n) => {
            if (n.id === nodeId || boundaryIds.has(n.id)) {
              const myAbs = absOf(n.id);
              const relative = { x: myAbs.x - newParentAbs.x, y: myAbs.y - newParentAbs.y };
              return {
                ...n,
                position: relative,
                ...(parentId
                  ? { parentId, extent: "parent" as const }
                  : { parentId: undefined, extent: undefined }),
              };
            }
            return n;
          }),
        });
      },

      setSelectedNode: (id) => set({ selectedNodeId: id }),

      updateNodeLabel: (id, label) => {
        set({
          nodes: get().nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, label } } : n
          ),
        });
      },

      updateNodeData: (id, patch) => {
        set({
          nodes: get().nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
          ),
        });
      },

      updateEdgeLabel: (id, label) => {
        set({
          edges: get().edges.map((e) =>
            e.id === id ? { ...e, label } : e
          ),
        });
      },

      updateEdgeData: (id, patch) => {
        set({
          edges: get().edges.map((e) =>
            e.id === id ? { ...e, data: { ...(e.data || {}), ...patch } } : e
          ),
        });
      },

      setEdgeCondition: (edgeId, condition) => {
        set({
          edges: get().edges.map((e) =>
            e.id === edgeId
              ? { ...e, data: { ...(e.data || {}), condition } }
              : e
          ),
        });
      },

      setGatewayDefaultFlow: (gatewayId, flowId) => {
        const node = get().nodes.find((n) => n.id === gatewayId);
        const bpmnType = (node?.data as { bpmnType?: string } | undefined)?.bpmnType;
        // Only exclusive and inclusive gateways carry a default flow per BPMN spec.
        if (bpmnType !== "exclusiveGateway" && bpmnType !== "inclusiveGateway") return;
        set({
          nodes: get().nodes.map((n) =>
            n.id === gatewayId ? { ...n, data: { ...n.data, defaultFlowId: flowId ?? undefined } } : n
          ),
          edges: get().edges.map((e) =>
            e.source === gatewayId
              ? { ...e, data: { ...(e.data || {}), isDefault: e.id === flowId } }
              : e
          ),
        });
      },

      reconnectEdge: (oldEdge, newConnection) => {
        set({
          edges: reconnectEdge(oldEdge, newConnection, get().edges),
        });
      },

      deleteSelected: () => {
        const { nodes, edges, selectedNodeId } = get();
        const selectedNodeIds = new Set(
          nodes.filter((n) => n.selected || n.id === selectedNodeId).map((n) => n.id)
        );
        const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));
        if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

        // Cascade: boundary events attached to a deleted host go with it.
        // Leaving them orphaned produces ugly validation errors and a
        // floating circle with no visible relationship to anything.
        for (const n of nodes) {
          if (n.type !== "boundaryEvent") continue;
          const attachedTo = (n.data as { attachedToRef?: string })?.attachedToRef;
          if (attachedTo && selectedNodeIds.has(attachedTo)) {
            selectedNodeIds.add(n.id);
          }
        }

        // Cascade: descendants of a deleted subprocess go with it. We
        // walk repeatedly until the set stops growing so grandchildren
        // and boundary events attached to nested hosts are also swept.
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of nodes) {
            if (selectedNodeIds.has(n.id)) continue;
            if (n.parentId && selectedNodeIds.has(n.parentId)) {
              selectedNodeIds.add(n.id);
              grew = true;
            }
            if (n.type === "boundaryEvent") {
              const attachedTo = (n.data as { attachedToRef?: string })?.attachedToRef;
              if (attachedTo && selectedNodeIds.has(attachedTo)) {
                selectedNodeIds.add(n.id);
                grew = true;
              }
            }
          }
        }

        set({
          nodes: nodes.filter((n) => !selectedNodeIds.has(n.id)),
          edges: edges.filter(
            (e) =>
              !selectedEdgeIds.has(e.id) &&
              !selectedNodeIds.has(e.source) &&
              !selectedNodeIds.has(e.target)
          ),
          selectedNodeId: null,
        });
      },

      copySelected: () => {
        const { nodes, edges } = get();
        const selectedNodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
        if (selectedNodeIds.size === 0) return;

        // Include descendants of selected subprocesses so the paste
        // doesn't leave a dangling parentId. Boundary events attached
        // to selected hosts come along too — same reasoning as delete.
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of nodes) {
            if (selectedNodeIds.has(n.id)) continue;
            if (n.parentId && selectedNodeIds.has(n.parentId)) {
              selectedNodeIds.add(n.id);
              grew = true;
            }
            if (n.type === "boundaryEvent") {
              const attachedTo = (n.data as { attachedToRef?: string })?.attachedToRef;
              if (attachedTo && selectedNodeIds.has(attachedTo)) {
                selectedNodeIds.add(n.id);
                grew = true;
              }
            }
          }
        }

        const copiedNodes = nodes.filter((n) => selectedNodeIds.has(n.id));
        const copiedEdges = edges.filter(
          (e) => selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target)
        );
        set({ clipboard: { nodes: copiedNodes, edges: copiedEdges } });
      },

      pasteClipboard: () => {
        const { clipboard, nodes, edges } = get();
        if (!clipboard || clipboard.nodes.length === 0) return;

        // 1. Remap node IDs
        const nodeIdMap = new Map<string, string>();
        for (const n of clipboard.nodes) {
          nodeIdMap.set(n.id, `${n.type ?? "node"}-${nanoid(8)}`);
        }

        // 2. Remap edge IDs (build the map first so node data can reference new edge IDs)
        const edgeIdMap = new Map<string, string>();
        for (const e of clipboard.edges) {
          edgeIdMap.set(e.id, `e-${nanoid(8)}`);
        }

        // 3. Build new nodes with remapped internal refs (defaultFlowId on
        //    gateways, attachedToRef on boundary events). When the referenced
        //    element wasn't copied, drop the ref — a dangling reference is
        //    worse than none, and the validation engine will surface the gap.
        const newNodes: Node[] = clipboard.nodes.map((n) => {
          const data = { ...(n.data as Record<string, unknown>) };
          if (typeof data.defaultFlowId === "string") {
            data.defaultFlowId = edgeIdMap.get(data.defaultFlowId) ?? undefined;
          }
          if (typeof data.attachedToRef === "string") {
            data.attachedToRef = nodeIdMap.get(data.attachedToRef) ?? undefined;
          }
          // Root-level pasted nodes get the +32 offset; children keep
          // their relative position so the subprocess interior doesn't
          // fly apart on paste.
          const isRootPaste = !n.parentId || !nodeIdMap.has(n.parentId);
          const position = isRootPaste
            ? { x: n.position.x + 32, y: n.position.y + 32 }
            : n.position;
          return {
            ...n,
            id: nodeIdMap.get(n.id)!,
            data,
            position,
            selected: true,
            ...(n.parentId && nodeIdMap.has(n.parentId)
              ? { parentId: nodeIdMap.get(n.parentId), extent: "parent" as const }
              : { parentId: undefined, extent: undefined }),
          };
        });

        // 4. Build new edges with remapped endpoints
        const newEdges: Edge[] = clipboard.edges.map((e) => ({
          ...e,
          id: edgeIdMap.get(e.id)!,
          source: nodeIdMap.get(e.source) ?? e.source,
          target: nodeIdMap.get(e.target) ?? e.target,
          selected: false,
        }));

        // 5. Deselect all existing then select the pasted nodes
        set({
          nodes: [
            ...nodes.map((n) => ({ ...n, selected: false })),
            ...newNodes,
          ],
          edges: [...edges, ...newEdges],
        });
      },

      duplicateSelected: () => {
        get().copySelected();
        get().pasteClipboard();
      },

      setSaveStatus: (status) => {
        set({
          saveStatus: status,
          lastSavedAt: status === "saved" ? Date.now() : get().lastSavedAt,
        });
      },

      setProcessId: (id) => set({ processId: id }),

      setProcessMeta: (meta) => {
        set({ processMeta: { ...get().processMeta, ...meta } });
      },

      setWizardStep: (step) => set({ wizardStep: step }),

      setWizardOrigin: (origin) => set({ wizardOrigin: origin }),

      setDocumentDirty: (dirty) => set({ documentDirty: dirty }),

      loadCanvasData: (nodes, edges) => set({ nodes, edges }),

      resetCanvas: () => set({
        processId: null,
        processMeta: { name: "", description: "", businessDoc: null, businessDocName: "", businessDocSource: null, status: "DRAFT", creatorName: "", updatedAt: "" },
        wizardStep: "details",
        wizardOrigin: "list",
        documentDirty: false,
        nodes: [],
        edges: [],
        selectedNodeId: null,
        saveStatus: "idle",
        lastSavedAt: null,
        clipboard: null,
      }),
    }),
    {
      limit: 50,
      equality: (past, current) =>
        JSON.stringify(past.nodes) === JSON.stringify(current.nodes) &&
        JSON.stringify(past.edges) === JSON.stringify(current.edges),
    }
  )
);

export default useCanvasStore;
