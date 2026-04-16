/* ─── Mapping Table ───────────────────────────────────────────────────
 * Editable table for input/output variable mappings.
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import { nanoid } from "nanoid";
import type { VariableMapping } from "../../../../types/bpmn-node-data";

type Props = {
  mappings: VariableMapping[];
  onChange: (mappings: VariableMapping[]) => void;
  sourceLabel?: string;
  targetLabel?: string;
  direction: "input" | "output";
};

const cellInput: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #e5e7eb", fontSize: 12, color: "#344054",
  fontFamily: "var(--font-mono, monospace)", outline: "none", background: "#fff",
  lineHeight: "1.4",
};

export default function MappingTable({
  mappings, onChange,
  sourceLabel = "Source", targetLabel = "Target", direction,
}: Props) {
  const addRow = () => {
    onChange([...mappings, { id: nanoid(8), source: "", target: "", type: "" }]);
  };

  const updateRow = (id: string, field: keyof VariableMapping, value: string) => {
    onChange(mappings.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
  };

  const removeRow = (id: string) => {
    onChange(mappings.filter((m) => m.id !== id));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Header */}
      {mappings.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 8, paddingLeft: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#98a2b3" }}>
            {sourceLabel}
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#98a2b3" }}>
            {targetLabel}
          </span>
          <span />
        </div>
      )}

      {/* Rows */}
      {mappings.map((m) => (
        <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={direction === "input" ? m.source : m.target}
            onChange={(e) => updateRow(m.id, direction === "input" ? "source" : "target", e.target.value)}
            placeholder={direction === "input" ? "= expression" : "variableName"}
            spellCheck={false}
            style={cellInput}
          />
          <input
            type="text"
            value={direction === "input" ? m.target : m.source}
            onChange={(e) => updateRow(m.id, direction === "input" ? "target" : "source", e.target.value)}
            placeholder={direction === "input" ? "paramName" : "= expression"}
            spellCheck={false}
            style={cellInput}
          />
          <button
            type="button"
            onClick={() => removeRow(m.id)}
            style={{
              width: 28, height: 28, borderRadius: 6, border: "none",
              background: "transparent", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#d0d5dd", transition: "all 0.15s", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#fef2f2"; e.currentTarget.style.color = "#f04438"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#d0d5dd"; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}

      {/* Add button */}
      <button
        type="button"
        onClick={addRow}
        style={{
          width: "100%", padding: mappings.length === 0 ? "16px 12px" : "8px 12px",
          borderRadius: 10, border: "1.5px dashed #e5e7eb", background: "transparent",
          fontSize: 12, fontWeight: 600, color: "#98a2b3", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#818cf8"; e.currentTarget.style.background = "#eef2ff"; e.currentTarget.style.color = "#4f46e5"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#98a2b3"; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add mapping
      </button>
    </div>
  );
}
