import { useEffect, useRef, useCallback, useState, type DragEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useSidebar } from "../components/layout/sidebar-context";
import useCanvasStore from "../store/canvas-store";
import { apiGet, apiPut } from "../lib/api";
import { STEP_MAP, DOC_SOURCE_MAP } from "../lib/constants";
import { nodeTypes } from "../components/canvas/nodes";
import { edgeTypes } from "../components/canvas/edges";
import ElementPalette from "../components/canvas/element-palette";
import PropertiesPanel from "../components/canvas/properties/PropertiesPanel";
import CanvasToolbar from "../components/canvas/canvas-toolbar";
import ProcessWizard from "../components/canvas/process-wizard";
import ProcessSubheader from "../components/canvas/process-subheader";

const DEFAULT_EDGE_OPTIONS = {
  type: "sequence" as const,
  style: { stroke: "#94A3B8", strokeWidth: 1.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 18,
    height: 18,
    color: "#94A3B8",
  },
};
const CONNECTION_LINE_STYLE = { stroke: "#6366F1", strokeWidth: 1.5 };
const SNAP_GRID: [number, number] = [16, 16];
const CANVAS_STYLE = { background: "#F8FAFC" };
const DEFAULT_VIEWPORT = { x: 40, y: 40, zoom: 0.85 };

/* Modifier key for shortcuts: Cmd on Mac, Ctrl elsewhere */
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const modKey = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

function CanvasInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const wizardStep = useCanvasStore((s) => s.wizardStep);
  const rawNodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const reconnectEdgeAction = useCanvasStore((s) => s.reconnectEdge);
  const addNode = useCanvasStore((s) => s.addNode);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const deleteSelected = useCanvasStore((s) => s.deleteSelected);
  const copySelected = useCanvasStore((s) => s.copySelected);
  const pasteClipboard = useCanvasStore((s) => s.pasteClipboard);
  const duplicateSelected = useCanvasStore((s) => s.duplicateSelected);

  // Mirror our selectedNodeId onto React Flow's native node.selected so
  // base nodes (and React Flow's internal selection state) stay in sync.
  // BUT only force this when a single node is selected via panel — multi-select
  // (from React Flow's selection box) should pass through unchanged.
  const nodes = selectedNodeId
    ? rawNodes.map((n) =>
        n.selected === (n.id === selectedNodeId)
          ? n
          : { ...n, selected: n.id === selectedNodeId }
      )
    : rawNodes;

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      reconnectEdgeAction(oldEdge, newConnection);
    },
    [reconnectEdgeAction]
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow-type");
      const label = event.dataTransfer.getData("application/reactflow-label");
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(type, position, label);
    },
    [screenToFlowPosition, addNode]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  /* ─── Keyboard shortcuts ─────────────────────────────────────
     - Backspace / Delete            → delete selection
     - Cmd/Ctrl + Z                  → undo
     - Cmd/Ctrl + Shift + Z (or Y)   → redo
     - Cmd/Ctrl + C                  → copy
     - Cmd/Ctrl + V                  → paste
     - Cmd/Ctrl + D                  → duplicate
     Skipped when an input/textarea/contentEditable has focus.
  ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    const isInputFocused = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = (el as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      // Delete / Backspace → remove selected
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }

      // Cmd/Ctrl + Z (undo) and Cmd/Ctrl + Shift + Z or Y (redo)
      if (modKey(e) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        const temporal = useCanvasStore.temporal.getState();
        if (e.shiftKey) temporal.redo();
        else temporal.undo();
        return;
      }
      if (modKey(e) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        useCanvasStore.temporal.getState().redo();
        return;
      }

      // Cmd/Ctrl + C / V / D — clipboard ops
      if (modKey(e) && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        copySelected();
        return;
      }
      if (modKey(e) && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (modKey(e) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        duplicateSelected();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, copySelected, pasteClipboard, duplicateSelected]);

  const showWizard = wizardStep !== "canvas";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
      {/* Subheader — visible only on canvas step */}
      <ProcessSubheader />

      {/* Wizard overlay */}
      {showWizard && <ProcessWizard />}

      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>

      {/* Center canvas */}
      <div ref={reactFlowWrapper} style={{ flex: 1, position: "relative" }}>
        {/* Floating palette */}
        {!showWizard && <ElementPalette />}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          reconnectRadius={20}
          edgesReconnectable
          onInit={(instance) => { reactFlowInstance.current = instance; }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultViewport={DEFAULT_VIEWPORT}
          minZoom={0.3}
          maxZoom={2}
          fitView={false}
          snapToGrid
          snapGrid={SNAP_GRID}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          connectionLineStyle={CONNECTION_LINE_STYLE}
          connectionLineType={ConnectionLineType.SmoothStep}
          /* Multi-select: hold Shift to drag a selection box */
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode={["Meta", "Control"]}
          panOnDrag={[1, 2]}                /* Mouse middle/right pans; left drag = box select */
          selectionOnDrag
          deleteKeyCode={null}              /* We handle Delete manually for input-aware skip */
          proOptions={{ hideAttribution: true }}
          style={CANVAS_STYLE}
        >
          {/* Visible indigo dots on subtle off-white */}
          <Background id="dots" color="#A5B4FC" gap={20} size={1.2} variant={BackgroundVariant.Dots} />
          <MiniMap
            nodeStrokeWidth={2}
            pannable
            zoomable
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 8,
            }}
          />
          <CanvasToolbar />
        </ReactFlow>

        {/* Floating properties panel */}
        {!showWizard && <PropertiesPanel />}

        {/* Empty state overlay */}
        {nodes.length === 0 && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: "#F3F4F6", border: "1px solid #E5E7EB",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 12px",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round">
                <rect x="2" y="2" width="20" height="20" rx="3" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#344054", marginBottom: 4 }}>
              Design your process
            </div>
            <div style={{ fontSize: 13, color: "#9CA3AF", maxWidth: 240 }}>
              Drag elements from the palette on the left to start building your BPMN workflow
            </div>
          </div>
        )}
      </div>

      {/* Properties panel moved inside canvas wrapper as floating card */}
      </div>
    </div>
  );
}

export default function DesignCanvasPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { collapsed, setCollapsed } = useSidebar();
  const prevCollapsed = useRef(collapsed);
  const [loading, setLoading] = useState(true);

  const setProcessId = useCanvasStore((s) => s.setProcessId);
  const setProcessMeta = useCanvasStore((s) => s.setProcessMeta);
  const setWizardStep = useCanvasStore((s) => s.setWizardStep);
  const loadCanvasData = useCanvasStore((s) => s.loadCanvasData);
  const resetCanvas = useCanvasStore((s) => s.resetCanvas);
  const setSaveStatus = useCanvasStore((s) => s.setSaveStatus);

  // Auto-collapse sidebar
  useEffect(() => {
    prevCollapsed.current = collapsed;
    setCollapsed(true);
    return () => {
      setCollapsed(prevCollapsed.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load process by ID or start fresh
  useEffect(() => {
    const load = async () => {
      if (id && id !== "new") {
        try {
          const proc = await apiGet<{
            id: string; name: string; description: string | null;
            step: string; status: string; updatedAt: string;
            creatorName: string | null;
            canvasData: { nodes: any[]; edges: any[] } | null;
            document: { schemaOverride: Record<string, unknown>; source: string; documentId: string | null } | null;
          }>(`/processes/${id}`);
          setProcessId(proc.id);
          setProcessMeta({
            name: proc.name,
            description: proc.description || "",
            businessDoc: proc.document?.schemaOverride || null,
            businessDocName: proc.document?.documentId ? "Template" : "Custom",
            businessDocSource: proc.document?.source ? DOC_SOURCE_MAP[proc.document.source] || null : null,
            status: proc.status || "DRAFT",
            creatorName: proc.creatorName || "",
            updatedAt: proc.updatedAt || "",
          });
          // Restore canvas data if available
          if (proc.canvasData?.nodes && proc.canvasData?.edges) {
            loadCanvasData(proc.canvasData.nodes, proc.canvasData.edges);
          }
          // Resume at the correct step
          setWizardStep(STEP_MAP[proc.step] || "details");
        } catch {
          navigate("/designer", { replace: true });
          return;
        }
      } else {
        // New process — start fresh
        resetCanvas();
      }
      setLoading(false);
    };
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save canvas data (debounced 2s after last change)
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const processId = useCanvasStore((s) => s.processId);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoad = useRef(true);

  useEffect(() => {
    // Skip the initial load — only save user-initiated changes
    if (initialLoad.current) {
      initialLoad.current = false;
      return;
    }
    if (!processId || loading) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("idle");
    saveTimer.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await apiPut(`/processes/${processId}/canvas`, {
          canvasData: { nodes, edges },
        });
        setSaveStatus("saved");
      } catch (e) {
        console.warn("Auto-save failed:", (e as Error).message);
        setSaveStatus("error");
      }
    }, 2000);

    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [nodes, edges, processId, loading, setSaveStatus]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9CA3AF" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 32, height: 32, border: "3px solid #E5E7EB", borderTopColor: "#4F46E5", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
          <div style={{ fontSize: 13 }}>Loading process...</div>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
