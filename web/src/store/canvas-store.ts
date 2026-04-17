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

type CanvasState = {
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
        const idMap = new Map<string, string>();
        const newNodes: Node[] = clipboard.nodes.map((n) => {
          const newId = `${n.type ?? "node"}-${nanoid(8)}`;
          idMap.set(n.id, newId);
          return {
            ...n,
            id: newId,
            position: { x: n.position.x + 32, y: n.position.y + 32 },
            selected: true,
          };
        });
        const newEdges: Edge[] = clipboard.edges.map((e) => ({
          ...e,
          id: `e-${nanoid(8)}`,
          source: idMap.get(e.source) ?? e.source,
          target: idMap.get(e.target) ?? e.target,
          selected: false,
        }));
        // Deselect all existing then select the pasted ones
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
