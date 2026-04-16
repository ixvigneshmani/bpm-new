import { create } from "zustand";
import { temporal } from "zundo";
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";
import { nanoid } from "nanoid";

export type BpmnNodeData = {
  label: string;
  bpmnType: string;
  description?: string;
};

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

type CanvasState = {
  processId: string | null;
  processMeta: ProcessMeta;
  wizardStep: "details" | "document" | "canvas";
  wizardOrigin: "list" | "canvas";
  documentDirty: boolean;
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;

  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  addNode: (type: string, position: { x: number; y: number }, label?: string) => void;
  setSelectedNode: (id: string | null) => void;
  updateNodeLabel: (id: string, label: string) => void;
  deleteSelected: () => void;

  setProcessId: (id: string | null) => void;
  setProcessMeta: (meta: Partial<ProcessMeta>) => void;
  setWizardStep: (step: "details" | "document" | "canvas") => void;
  setWizardOrigin: (origin: "list" | "canvas") => void;
  setDocumentDirty: (dirty: boolean) => void;
  loadCanvasData: (nodes: Node[], edges: Edge[]) => void;
  resetCanvas: () => void;
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
            {
              ...connection,
              id,
              type: "smoothstep",
              animated: false,
              style: { stroke: "#94A3B8", strokeWidth: 1.5 },
            },
            get().edges
          ),
        });
      },

      addNode: (type, position, label) => {
        const id = `${type}-${nanoid(8)}`;
        const defaults: Record<string, string> = {
          startEvent: "Start",
          endEvent: "End",
          userTask: "User Task",
          serviceTask: "Service Task",
          exclusiveGateway: "",
        };
        const newNode: Node = {
          id,
          type,
          position,
          data: {
            label: label || defaults[type] || type,
            bpmnType: type,
          },
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

      deleteSelected: () => {
        const { selectedNodeId, nodes, edges } = get();
        if (!selectedNodeId) return;
        set({
          nodes: nodes.filter((n) => n.id !== selectedNodeId),
          edges: edges.filter(
            (e) => e.source !== selectedNodeId && e.target !== selectedNodeId
          ),
          selectedNodeId: null,
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
