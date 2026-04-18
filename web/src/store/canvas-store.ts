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

  addNode: (type: string, position: { x: number; y: number }, label?: string) => void;
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

      addNode: (type, position, label) => {
        const id = `${type}-${nanoid(8)}`;
        const newNode: Node = {
          id,
          type,
          position,
          data: createDefaultNodeData(type, label),
        };
        set({ nodes: [...get().nodes, newNode] });
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

        // 3. Build new nodes with remapped internal refs (e.g. defaultFlowId)
        const newNodes: Node[] = clipboard.nodes.map((n) => {
          const data = { ...(n.data as Record<string, unknown>) };
          if (typeof data.defaultFlowId === "string") {
            const remapped = edgeIdMap.get(data.defaultFlowId as string);
            // Drop the ref if the referenced edge wasn't copied — the paste
            // is a partial selection, so a dangling reference is worse than none.
            data.defaultFlowId = remapped ?? undefined;
          }
          return {
            ...n,
            id: nodeIdMap.get(n.id)!,
            data,
            position: { x: n.position.x + 32, y: n.position.y + 32 },
            selected: true,
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
