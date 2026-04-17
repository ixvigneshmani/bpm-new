/* ─── General Section ─────────────────────────────────────────────────
 * Common properties for all node types: Type badge, ID, Name.
 * Always rendered first in the properties panel.
 * Uses inline styles because Tailwind preflight is disabled (Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import { NODE_THEMES } from "../../../../types/bpmn-node-data";

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color: "#98a2b3", marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10,
  border: "1px solid #e5e7eb", fontSize: 13, color: "#111827",
  fontFamily: "inherit", outline: "none", background: "#fff",
  transition: "border-color 0.15s, box-shadow 0.15s",
  lineHeight: "1.5",
};

type Props = {
  nodeId: string;
  bpmnType: string;
  label: string;
  onLabelChange: (label: string) => void;
};

export default function GeneralSection({
  nodeId, bpmnType, label, onLabelChange,
}: Props) {
  const theme = NODE_THEMES[bpmnType];
  const color = theme?.color || "#6366F1";
  const displayName = theme?.label || bpmnType;

  const focusHandler = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "#818cf8";
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.08)";
  };
  const blurHandler = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "#e5e7eb";
    e.currentTarget.style.boxShadow = "none";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Type badge */}
      <div>
        <div style={labelStyle}>Type</div>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 12px", borderRadius: 6,
          background: `${color}12`, fontSize: 12, fontWeight: 600, color,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
          {displayName}
        </span>
      </div>

      {/* ID (read-only) */}
      <div>
        <div style={labelStyle}>ID</div>
        <div style={{
          padding: "7px 12px", borderRadius: 8, fontSize: 11,
          fontFamily: "var(--font-mono, monospace)", color: "#667085",
          background: "#f9fafb", border: "1px solid #f2f4f7",
          userSelect: "all",
        }}>
          {nodeId}
        </div>
      </div>

      {/* Name / Label */}
      <div>
        <div style={labelStyle}>Name</div>
        <input
          type="text"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          onFocus={focusHandler}
          onBlur={blurHandler}
          style={inputStyle}
          placeholder="Element name..."
        />
      </div>
    </div>
  );
}
