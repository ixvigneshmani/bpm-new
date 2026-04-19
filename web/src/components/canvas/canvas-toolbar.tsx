import { useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useStore } from "zustand";
import useCanvasStore from "../../store/canvas-store";
import { serializeCanvasToBpmn } from "../../lib/bpmn/serialize";
import { parseBpmnToCanvas } from "../../lib/bpmn/parse";

export default function CanvasToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const deleteSelected = useCanvasStore((s) => s.deleteSelected);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const connectMode = useCanvasStore((s) => s.connectMode);
  const setConnectMode = useCanvasStore((s) => s.setConnectMode);
  const { undo, redo } = useCanvasStore.temporal.getState();
  const pastStates = useStore(useCanvasStore.temporal, (state) => state.pastStates);
  const futureStates = useStore(useCanvasStore.temporal, (state) => state.futureStates);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "export" | "import">(null);

  const handleExport = async () => {
    if (busy) return;
    setBusy("export");
    try {
      const { nodes, edges, processMeta } = useCanvasStore.getState();
      const { xml, warnings } = await serializeCanvasToBpmn(nodes, edges, {
        processName: processMeta.name || "Process",
      });
      if (warnings.length) {
        console.warn("BPMN export warnings:", warnings);
        alert(`Export completed with ${warnings.length} warning(s):\n\n${warnings.join("\n\n")}`);
      }
      const blob = new Blob([xml], { type: "application/bpmn+xml" });
      const url = URL.createObjectURL(blob);
      const safeName = (processMeta.name || "process").replace(/[^a-z0-9-_]+/gi, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}.bpmn`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("BPMN export failed:", e);
      alert(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleImportClick = () => {
    if (busy) return;
    fileInputRef.current?.click();
  };

  const handleImportFile = async (evt: React.ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    evt.target.value = ""; // reset so selecting same file twice still fires change
    if (!file) return;

    const { nodes: existing } = useCanvasStore.getState();
    if (existing.length > 0) {
      const ok = window.confirm(
        `Importing will replace ${existing.length} node(s) already on the canvas. Continue?`,
      );
      if (!ok) return;
    }

    setBusy("import");
    try {
      const xml = await file.text();
      const result = await parseBpmnToCanvas(xml);
      const store = useCanvasStore.getState();
      // Clear any selection so the Properties Panel doesn't render against a
      // stale node ID that may no longer exist after the import.
      store.setSelectedNode(null);
      store.loadCanvasData(result.nodes, result.edges);
      // Mark dirty so auto-save picks up the imported canvas.
      store.setDocumentDirty(true);
      if (result.warnings.length) {
        console.warn("BPMN import warnings:", result.warnings);
        alert(
          `Imported ${result.nodes.length} element(s) with ${result.warnings.length} warning(s). See console for details.`,
        );
      }
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    } catch (e) {
      console.error("BPMN import failed:", e);
      alert(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const btnStyle = (disabled = false): React.CSSProperties => ({
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#fff",
    border: "1px solid #E5E7EB",
    borderRadius: 6,
    cursor: disabled ? "not-allowed" : "pointer",
    color: disabled ? "#D0D5DD" : "#475467",
    transition: "all 0.15s ease",
    opacity: disabled ? 0.5 : 1,
    flexShrink: 0,
  });

  const divider = (
    <div style={{ width: 1, height: 20, background: "#E5E7EB", flexShrink: 0 }} />
  );

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 10,
        padding: "4px 6px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      }}
    >
      {/* Undo */}
      <button
        onClick={() => undo()}
        disabled={pastStates.length === 0}
        style={btnStyle(pastStates.length === 0)}
        title="Undo"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
        </svg>
      </button>

      {/* Redo */}
      <button
        onClick={() => redo()}
        disabled={futureStates.length === 0}
        style={btnStyle(futureStates.length === 0)}
        title="Redo"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.13-9.36L23 10" />
        </svg>
      </button>

      {divider}

      {/* Connect mode toggle: Sequence | Message */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 0,
          background: "#F3F4F6", borderRadius: 6, padding: 2,
        }}
        title="Drag from a node edge to connect. Toggle whether new edges are sequence flows or message flows."
      >
        <button
          onClick={() => setConnectMode("sequence")}
          style={{
            padding: "4px 8px", borderRadius: 4, border: "none",
            fontSize: 10, fontWeight: 600,
            background: connectMode === "sequence" ? "#fff" : "transparent",
            color: connectMode === "sequence" ? "#4F46E5" : "#667085",
            boxShadow: connectMode === "sequence" ? "0 1px 2px rgba(16,24,40,0.06)" : "none",
            cursor: "pointer",
            transition: "all 0.12s ease",
          }}
        >
          Sequence
        </button>
        <button
          onClick={() => setConnectMode("message")}
          style={{
            padding: "4px 8px", borderRadius: 4, border: "none",
            fontSize: 10, fontWeight: 600,
            background: connectMode === "message" ? "#fff" : "transparent",
            color: connectMode === "message" ? "#4F46E5" : "#667085",
            boxShadow: connectMode === "message" ? "0 1px 2px rgba(16,24,40,0.06)" : "none",
            cursor: "pointer",
            transition: "all 0.12s ease",
          }}
        >
          Message
        </button>
      </div>

      {divider}

      {/* Zoom in */}
      <button onClick={() => zoomIn()} style={btnStyle()} title="Zoom in">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>

      {/* Zoom out */}
      <button onClick={() => zoomOut()} style={btnStyle()} title="Zoom out">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>

      {/* Fit view */}
      <button onClick={() => fitView({ padding: 0.2 })} style={btnStyle()} title="Fit view">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
        </svg>
      </button>

      {divider}

      {/* Import BPMN XML */}
      <button
        onClick={handleImportClick}
        disabled={busy !== null}
        style={btnStyle(busy !== null)}
        title="Import BPMN 2.0 XML"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </button>

      {/* Export BPMN XML */}
      <button
        onClick={handleExport}
        disabled={busy !== null}
        style={btnStyle(busy !== null)}
        title="Export BPMN 2.0 XML"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>

      {divider}

      {/* Delete */}
      <button
        onClick={deleteSelected}
        disabled={!selectedNodeId}
        style={btnStyle(!selectedNodeId)}
        title="Delete selected"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={selectedNodeId ? "#EF4444" : "currentColor"} strokeWidth="2" strokeLinecap="round">
          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
      </button>

      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".bpmn,.xml,application/bpmn+xml,application/xml,text/xml"
        style={{ display: "none" }}
        onChange={handleImportFile}
      />
    </div>
  );
}
