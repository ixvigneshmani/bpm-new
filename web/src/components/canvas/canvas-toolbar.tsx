import { useReactFlow } from "@xyflow/react";
import { useStore } from "zustand";
import useCanvasStore from "../../store/canvas-store";

export default function CanvasToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const deleteSelected = useCanvasStore((s) => s.deleteSelected);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const { undo, redo } = useCanvasStore.temporal.getState();
  const pastStates = useStore(useCanvasStore.temporal, (state) => state.pastStates);
  const futureStates = useStore(useCanvasStore.temporal, (state) => state.futureStates);

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

    </div>
  );
}
