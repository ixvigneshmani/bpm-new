import useCanvasStore from "../../store/canvas-store";

export default function PropertiesPanel() {
  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const updateNodeLabel = useCanvasStore((s) => s.updateNodeLabel);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div
        style={{
          width: 260,
          background: "#fff",
          borderLeft: "1px solid #E5E7EB",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          flexShrink: 0,
          color: "#9CA3AF",
        }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M16.36 16.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M16.36 7.64l1.42-1.42" />
        </svg>
        <div style={{ fontSize: 13, fontWeight: 500 }}>No element selected</div>
        <div style={{ fontSize: 11, color: "#D0D5DD", textAlign: "center", padding: "0 20px" }}>
          Click a node on the canvas to view its properties
        </div>
      </div>
    );
  }

  const bpmnType = (selectedNode.data as { bpmnType?: string }).bpmnType || selectedNode.type || "unknown";
  const label = (selectedNode.data as { label?: string }).label || "";

  const typeLabels: Record<string, string> = {
    startEvent: "Start Event",
    endEvent: "End Event",
    userTask: "User Task",
    serviceTask: "Service Task",
    exclusiveGateway: "Exclusive Gateway",
  };

  const typeColors: Record<string, string> = {
    startEvent: "#16A34A",
    endEvent: "#DC2626",
    userTask: "#6366F1",
    serviceTask: "#EA580C",
    exclusiveGateway: "#CA8A04",
  };

  return (
    <div
      style={{
        width: 260,
        background: "#fff",
        borderLeft: "1px solid #E5E7EB",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #F2F4F7" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Properties</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {/* Type badge */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Type
          </div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 6,
            background: `${typeColors[bpmnType] || "#6366F1"}12`,
            fontSize: 12, fontWeight: 600,
            color: typeColors[bpmnType] || "#6366F1",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: typeColors[bpmnType] || "#6366F1" }} />
            {typeLabels[bpmnType] || bpmnType}
          </span>
        </div>

        {/* ID */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            ID
          </div>
          <div style={{ fontSize: 12, color: "#6B7280", fontFamily: "var(--font-mono, monospace)", background: "#F9FAFB", padding: "6px 10px", borderRadius: 6, border: "1px solid #F2F4F7" }}>
            {selectedNode.id}
          </div>
        </div>

        {/* Label */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Label
          </div>
          <input
            type="text"
            value={label}
            onChange={(e) => updateNodeLabel(selectedNode.id, e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "1px solid #E5E7EB",
              borderRadius: 8,
              fontSize: 13,
              color: "#111827",
              fontFamily: "inherit",
              outline: "none",
              background: "#fff",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "#C7D2FE"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.08)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "#E5E7EB"; e.currentTarget.style.boxShadow = "none"; }}
          />
        </div>

        {/* Position */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Position
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, background: "#F9FAFB", padding: "6px 10px", borderRadius: 6, border: "1px solid #F2F4F7" }}>
              <span style={{ fontSize: 10, color: "#98A2B3" }}>X</span>
              <span style={{ fontSize: 12, color: "#344054", marginLeft: 4, fontFamily: "var(--font-mono, monospace)" }}>
                {Math.round(selectedNode.position.x)}
              </span>
            </div>
            <div style={{ flex: 1, background: "#F9FAFB", padding: "6px 10px", borderRadius: 6, border: "1px solid #F2F4F7" }}>
              <span style={{ fontSize: 10, color: "#98A2B3" }}>Y</span>
              <span style={{ fontSize: 12, color: "#344054", marginLeft: 4, fontFamily: "var(--font-mono, monospace)" }}>
                {Math.round(selectedNode.position.y)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
