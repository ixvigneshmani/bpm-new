import { useEffect, useMemo, useRef, useCallback, useState, type DragEvent } from "react";
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
import { normalizeCanvasPayload, toCanvasPayload } from "../store/canvas-schema";
import { apiGet, apiPut } from "../lib/api";
import { STEP_MAP, DOC_SOURCE_MAP } from "../lib/constants";
import { nodeTypes } from "../components/canvas/nodes";
import { isSubprocessType, isSwimlaneType, isContainerType, COLLAPSED_SUBPROCESS_SIZE } from "../lib/bpmn/element-map";
import { getSize } from "../lib/bpmn/element-map";
import { absOrigin } from "../lib/bpmn/geometry";
import { edgeTypes } from "../components/canvas/edges";
import ElementPalette from "../components/canvas/element-palette";
import PropertiesPanel from "../components/canvas/properties/PropertiesPanel";
import CanvasToolbar from "../components/canvas/canvas-toolbar";
import ProblemsPanel from "../components/canvas/problems-panel";
import ProcessWizard from "../components/canvas/process-wizard";
import ProcessSubheader from "../components/canvas/process-subheader";
import BreadcrumbBar from "../components/canvas/breadcrumb-bar";
import AiScaffoldDialog from "../components/canvas/ai-scaffold-dialog";

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
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  // Pulled from the store (set by DesignCanvasPage's useParams) so the
  // toolbar can hide its Start-instance button on the new-process draft.
  const canvasProcessId = useCanvasStore((s) => s.processId);

  const wizardStep = useCanvasStore((s) => s.wizardStep);
  const rawNodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const reconnectEdgeAction = useCanvasStore((s) => s.reconnectEdge);
  const addNode = useCanvasStore((s) => s.addNode);
  const reparentNode = useCanvasStore((s) => s.reparentNode);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const deleteSelected = useCanvasStore((s) => s.deleteSelected);
  const copySelected = useCanvasStore((s) => s.copySelected);
  const pasteClipboard = useCanvasStore((s) => s.pasteClipboard);
  const duplicateSelected = useCanvasStore((s) => s.duplicateSelected);
  const setSaveStatus = useCanvasStore((s) => s.setSaveStatus);

  // ─── Manual save ────────────────────────────────────────────────────
  // Replaces the former debounced auto-save. A user may leave a design
  // half-edited without committing — they control when to persist.
  //
  // Dirty tracking: signature-diff. The PARENT (DesignCanvasPage's
  // load effect) sets `canvasBaselineSig` in the store right after
  // calling loadCanvasData — we read it here and compare against the
  // current canvas payload. This replaces the fragile 500ms-load-
  // window heuristic that mistakenly flagged "dirty" when React
  // Flow's deferred layout pass nudged a position after the window
  // closed, producing a phantom refresh popup on untouched canvases.
  const canvasBaselineSig = useCanvasStore((s) => s.canvasBaselineSig);
  const setCanvasBaselineSig = useCanvasStore((s) => s.setCanvasBaselineSig);
  const dirty = useMemo(() => {
    if (!canvasProcessId || canvasBaselineSig === null) return false;
    const current = JSON.stringify(toCanvasPayload(rawNodes, edges));
    return current !== canvasBaselineSig;
  }, [canvasProcessId, canvasBaselineSig, rawNodes, edges]);

  const handleSave = useCallback(async () => {
    if (!canvasProcessId) return;
    setSaveStatus("saving");
    try {
      const payload = toCanvasPayload(rawNodes, edges);
      await apiPut(`/processes/${canvasProcessId}/canvas`, {
        canvasData: payload,
      });
      setSaveStatus("saved");
      // Save succeeded — the on-disk state now matches in-memory, so
      // reset the baseline. Dirty drops to false next render.
      setCanvasBaselineSig(JSON.stringify(payload));
    } catch (e) {
      console.warn("Save failed:", (e as Error).message);
      setSaveStatus("error");
    }
  }, [canvasProcessId, rawNodes, edges, setSaveStatus, setCanvasBaselineSig]);

  // Cmd/Ctrl + S shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (dirty) handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, handleSave]);

  // beforeunload guard — stops tab-close or hard refresh when dirty.
  // In-SPA route changes are a separate concern (router block pattern).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "You have unsaved canvas changes.";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Mirror our selectedNodeId onto React Flow's native node.selected so
  // base nodes (and React Flow's internal selection state) stay in sync.
  // BUT only force this when a single node is selected via panel — multi-select
  // (from React Flow's selection box) should pass through unchanged.
  //
  // Collapsed subprocess frames hide their descendant subtree: children
  // still exist in the store (positions preserved) but React Flow skips
  // rendering them and their edges. Without this, `extent: 'parent'`
  // clamps children into the collapsed 120×80 box, so expanding again
  // would show a jammed pile.
  // Descendants of a collapsed subprocess are `hidden:true` so React Flow
  // skips rendering them and `extent:'parent'` can't clamp them into the
  // shrunken 120×80 box. Memoized on rawNodes — pan/hover re-renders reuse
  // the result instead of rebuilding the maps.
  const hiddenIds = useMemo<Set<string> | null>(() => {
    const byId = new Map(rawNodes.map((n) => [n.id, n]));
    const collapsed = new Set<string>();
    for (const n of rawNodes) {
      const d = n.data as { isExpanded?: boolean };
      const isSubprocess =
        n.type === "subProcess" || n.type === "eventSubProcess" ||
        n.type === "transaction" || n.type === "adHocSubProcess";
      if (isSubprocess && d.isExpanded === false) collapsed.add(n.id);
    }
    if (collapsed.size === 0) return null;
    const hidden = new Set<string>();
    for (const n of rawNodes) {
      let cur: string | undefined = n.parentId;
      while (cur) {
        if (collapsed.has(cur)) { hidden.add(n.id); break; }
        cur = byId.get(cur)?.parentId;
      }
    }
    return hidden;
  }, [rawNodes]);

  const nodes = useMemo(() => {
    // Sync `selected` flag to our authoritative selectedNodeId in
    // EVERY case — including when selectedNodeId becomes null (user
    // clicked an edge or the pane). Without this, a stale
    // `n.selected: true` lingers on the previously-selected node, so
    // Backspace would delete that node along with the now-selected
    // edge, and the Properties panel would still show node props.
    const base = rawNodes.map((n) => {
      const shouldBeSelected = n.id === selectedNodeId;
      return n.selected === shouldBeSelected ? n : { ...n, selected: shouldBeSelected };
    });
    if (!hiddenIds || hiddenIds.size === 0) return base;
    return base.map((n) => (hiddenIds.has(n.id) ? { ...n, hidden: true } : n));
  }, [rawNodes, selectedNodeId, hiddenIds]);

  const visibleEdges = useMemo(() => {
    if (!hiddenIds || hiddenIds.size === 0) return edges;
    return edges.map((e) =>
      hiddenIds.has(e.source) || hiddenIds.has(e.target)
        ? { ...e, hidden: true }
        : e,
    );
  }, [edges, hiddenIds]);

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

  /** Absolute origin of a node — thin wrapper around the shared
   *  geometry helper so hit-testing and reparenting math come from the
   *  same source as the serializer's coord conversion. */
  const absOriginOf = useCallback(
    (nodeId: string, allNodes: typeof rawNodes): { x: number; y: number } => {
      const byId = new Map(allNodes.map((n) => [n.id, n]));
      return absOrigin(nodeId, byId);
    },
    [],
  );

  /** Deepest expanded container (subprocess or pool) whose bounding box
   *  contains the given absolute flow-space position. Returns null when
   *  the drop is on the root pane. */
  const findSubprocessAt = useCallback(
    (pos: { x: number; y: number }, ignoreId?: string): string | null => {
      const allNodes = rawNodes;
      let best: { id: string; depth: number } | null = null;
      const byId = new Map(allNodes.map((n) => [n.id, n]));
      for (const n of allNodes) {
        if (!isContainerType(n.type)) continue;
        if (ignoreId && n.id === ignoreId) continue;
        const d = n.data as { isExpanded?: boolean; width?: number; height?: number };
        // Pools don't collapse; subprocesses do.
        if (isSubprocessType(n.type) && d.isExpanded === false) continue;
        const origin = absOriginOf(n.id, allNodes);
        const size = getSize(n.type);
        const w = d.width ?? n.width ?? size.width;
        const h = d.height ?? n.height ?? size.height;
        if (
          pos.x >= origin.x &&
          pos.x <= origin.x + w &&
          pos.y >= origin.y &&
          pos.y <= origin.y + h
        ) {
          let depth = 0;
          let cur: typeof n | undefined = n;
          while (cur?.parentId) {
            depth++;
            cur = byId.get(cur.parentId);
          }
          if (!best || depth > best.depth) best = { id: n.id, depth };
        }
      }
      return best?.id || null;
    },
    [rawNodes, absOriginOf],
  );

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

      // Auto-parent tasks / events / gateways dropped onto an expanded
      // container (subprocess or pool). Container drops stay at root
      // (user can drag in afterward) — *except* for eventSubProcess,
      // which per BPMN 2.0 §10.11 must be nested. Pools are always
      // root-only and never auto-nest.
      const isSubprocess = isSubprocessType(type);
      const isPool = type === "pool";
      const isLane = type === "lane";
      // Groups are visual-only (BPMN 2.0 §10.4.3): they do NOT own
      // their contents via parentId, so skip auto-nesting or they'd
      // clamp nodes into the group frame and serialize under the
      // wrong scope's artifacts list.
      const isGroup = type === "group";
      const canAutoNestSubprocess = type === "eventSubProcess";
      const parentId = isPool || isGroup
        ? null
        : (isSubprocess && !canAutoNestSubprocess)
          ? null
          : findSubprocessAt(position);
      // Lanes must live inside a pool (or another lane) — refuse a
      // root-level drop rather than create an orphan lane that
      // disappears from the XML on next export.
      if (isLane && !parentId) {
        // eslint-disable-next-line no-alert
        console.warn("[canvas] Lane drop rejected: drop inside a pool or lane.");
        return;
      }
      addNode(type, position, label, parentId || undefined);
    },
    [screenToFlowPosition, addNode, findSubprocessAt]
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: { id: string; type?: string; parentId?: string }) => {
      // Re-parent when a node is dragged into or out of a subprocess frame.
      // We use the center of the node's bounding box as the hit point.
      const allNodes = useCanvasStore.getState().nodes;
      const n = allNodes.find((m) => m.id === node.id);
      if (!n || !n.type) return;
      // Subprocess + pool nodes themselves don't auto-reparent on drag.
      // Pools are root-only by rule; subprocesses avoid nesting cycles
      // from fast drags. Structural reparenting is deliberate via future
      // UX, not an accident of pointer travel.
      if (isSubprocessType(n.type) || isSwimlaneType(n.type)) return;
      const origin = absOriginOf(n.id, allNodes);
      const size = getSize(n.type);
      const d = n.data as { width?: number; height?: number; isExpanded?: boolean };
      const w =
        isSubprocessType(n.type) && d.isExpanded === false
          ? COLLAPSED_SUBPROCESS_SIZE.width
          : d.width ?? n.width ?? size.width;
      const h =
        isSubprocessType(n.type) && d.isExpanded === false
          ? COLLAPSED_SUBPROCESS_SIZE.height
          : d.height ?? n.height ?? size.height;
      const center = { x: origin.x + w / 2, y: origin.y + h / 2 };
      const hit = findSubprocessAt(center, n.id);
      const current = n.parentId || null;
      if (hit !== current) reparentNode(n.id, hit);
    },
    [absOriginOf, findSubprocessAt, reparentNode],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode]
  );

  /* Clicking an edge must clear the previously-selected node so the
   * Properties panel switches to edge-mode AND the Backspace handler
   * deletes the edge (not the still-selected node). Without this,
   * selecting node X then clicking an edge leaves selectedNodeId set,
   * the panel keeps showing X's properties, and Delete would remove X. */
  const onEdgeClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

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
      <ProcessSubheader dirty={dirty} onSave={handleSave} />

      {/* Wizard overlay */}
      {showWizard && <ProcessWizard />}

      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>

      {/* Center canvas */}
      <div ref={reactFlowWrapper} style={{ flex: 1, position: "relative" }}>
        {/* Floating palette */}
        {!showWizard && <ElementPalette />}
        {!showWizard && <BreadcrumbBar />}
        <ReactFlow
          nodes={nodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          reconnectRadius={20}
          edgesReconnectable
          onInit={(instance) => { reactFlowInstance.current = instance; }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
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
          panOnScroll                        /* Two-finger trackpad scroll pans the canvas (Figma/Miro convention) */
          zoomOnScroll={false}               /* Plain scroll no longer zooms — prevents accidental zoom on trackpad */
          zoomOnPinch                        /* Pinch gesture still zooms */
          zoomActivationKeyCode="Meta"       /* Cmd+scroll also zooms, for users who prefer the old behavior */
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
          <CanvasToolbar onOpenAi={() => setAiDialogOpen(true)} processId={canvasProcessId ?? undefined} />
        </ReactFlow>

        {aiDialogOpen && <AiScaffoldDialog onClose={() => setAiDialogOpen(false)} />}

        {/* Floating properties panel */}
        {!showWizard && <PropertiesPanel />}
        {!showWizard && <ProblemsPanel />}

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
          // Restore canvas data if available — run through schema migrations
          if (proc.canvasData) {
            const payload = normalizeCanvasPayload(proc.canvasData);
            loadCanvasData(payload.nodes, payload.edges);
            // Capture baseline signature so the dirty-check can flip
            // back to false once React Flow finishes its layout pass.
            // The signature is the canonical save payload — same shape
            // we'd POST on save — so cosmetic React-Flow nudges (which
            // toCanvasPayload strips) don't flip dirty.
            useCanvasStore.getState().setCanvasBaselineSig(
              JSON.stringify(toCanvasPayload(payload.nodes, payload.edges)),
            );
          } else {
            // Empty canvas → empty baseline so a fresh paint of an
            // empty canvas isn't flagged dirty either.
            useCanvasStore.getState().setCanvasBaselineSig(
              JSON.stringify(toCanvasPayload([], [])),
            );
          }
          // Resume at the correct step. VX1 guard: even if the
          // server says step="canvas", route the user back to the
          // Document step when no businessDoc fields exist — the doc
          // is mandatory before any canvas work. Catches legacy
          // processes that were saved at canvas step before the
          // gate landed.
          const resolvedStep = STEP_MAP[proc.step] || "details";
          const docFieldCount = proc.document?.schemaOverride
            ? Object.keys(proc.document.schemaOverride).length
            : 0;
          setWizardStep(
            resolvedStep === "canvas" && docFieldCount === 0 ? "document" : resolvedStep,
          );
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
