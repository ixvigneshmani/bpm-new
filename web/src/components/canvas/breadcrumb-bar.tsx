/* ─── Breadcrumb Bar ──────────────────────────────────────────────────
 * Renders the subprocess ancestry of the currently selected node as a
 * clickable trail. Only visible when the selected node has at least one
 * subprocess ancestor, so it stays out of the way during root-scope work.
 * Clicking a crumb selects that ancestor so the user can drill "up".
 * ──────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import useCanvasStore from "../../store/canvas-store";

export default function BreadcrumbBar() {
  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const { fitView } = useReactFlow();

  const trail = useMemo(() => {
    if (!selectedNodeId) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const chain: { id: string; label: string }[] = [];
    let cur = byId.get(selectedNodeId);
    while (cur?.parentId) {
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      chain.unshift({
        id: parent.id,
        label: (parent.data as { label?: string }).label || parent.id,
      });
      cur = parent;
    }
    return chain;
  }, [nodes, selectedNodeId]);

  if (trail.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: "1px solid #E5E7EB",
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        fontSize: 11,
        fontWeight: 500,
        color: "#475467",
      }}
    >
      <button
        onClick={() => {
          setSelectedNode(null);
          // Pan/zoom to fit the root scope so a user working deep in a
          // subprocess actually sees the shift instead of staring at the
          // same viewport with nothing visibly changed.
          fitView({ padding: 0.2, duration: 250 });
        }}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#98A2B3",
          padding: 0,
          fontSize: 11,
          fontFamily: "inherit",
        }}
      >
        Process
      </button>
      {trail.map((crumb, i) => (
        <span key={crumb.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#D0D5DD" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="9 6 15 12 9 18" />
          </svg>
          <button
            onClick={() => {
              setSelectedNode(crumb.id);
              fitView({ nodes: [{ id: crumb.id }], padding: 0.3, duration: 250 });
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: i === trail.length - 1 ? "#101828" : "#475467",
              fontWeight: i === trail.length - 1 ? 600 : 500,
              padding: 0,
              fontSize: 11,
              fontFamily: "inherit",
            }}
            title="Select this subprocess"
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </div>
  );
}
