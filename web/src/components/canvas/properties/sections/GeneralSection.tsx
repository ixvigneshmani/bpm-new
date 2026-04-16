/* ─── General Section ─────────────────────────────────────────────────
 * Common properties for all node types: Name, ID, Type badge, Documentation.
 * Always rendered first in the properties panel.
 * Uses inline styles because Tailwind preflight is disabled (Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { NODE_THEMES } from "../../../../types/bpmn-node-data";
import AiAssistButton from "../fields/AiAssistButton";

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

const textareaStyle: React.CSSProperties = {
  ...inputStyle, fontSize: 13, resize: "vertical", minHeight: 72,
  lineHeight: "1.6",
};

const monoTextareaStyle: React.CSSProperties = {
  ...textareaStyle, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
  fontSize: 12, minHeight: 80,
};

type Props = {
  nodeId: string;
  bpmnType: string;
  label: string;
  description?: string;
  documentation?: string;
  showDescriptionDocs?: boolean;
  onLabelChange: (label: string) => void;
  onDescriptionChange: (desc: string) => void;
  onDocumentationChange: (doc: string) => void;
};

export default function GeneralSection({
  nodeId, bpmnType, label, description = "", documentation = "",
  showDescriptionDocs = true,
  onLabelChange, onDescriptionChange, onDocumentationChange,
}: Props) {
  const [docPreview, setDocPreview] = useState(false);
  const theme = NODE_THEMES[bpmnType];
  const color = theme?.color || "#6366F1";
  const displayName = theme?.label || bpmnType;

  const focusHandler = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "#818cf8";
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.08)";
  };
  const blurHandler = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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

      {/* Description — hidden for events */}
      {showDescriptionDocs && (
        <div>
          <div style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Description</span>
            <AiAssistButton tooltip="AI: Generate description" />
          </div>
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={2}
            onFocus={focusHandler}
            onBlur={blurHandler}
            style={textareaStyle}
            placeholder="Brief description of this element..."
          />
        </div>
      )}

      {/* Documentation — hidden for events */}
      {showDescriptionDocs && (
        <div>
          <div style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Documentation</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                type="button"
                onClick={() => setDocPreview(!docPreview)}
                style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 10,
                  fontWeight: 600, color: "#98a2b3", background: "#f2f4f7",
                  border: "none", cursor: "pointer", transition: "all 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#e5e7eb"; e.currentTarget.style.color = "#475467"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#f2f4f7"; e.currentTarget.style.color = "#98a2b3"; }}
              >
                {docPreview ? "Edit" : "Preview"}
              </button>
              <AiAssistButton tooltip="AI: Generate documentation" />
            </div>
          </div>
          {docPreview ? (
            <div style={{
              minHeight: 64, borderRadius: 8, padding: "10px 12px",
              border: "1px solid #f2f4f7", background: "#f9fafb",
              fontSize: 12, lineHeight: 1.6, color: "#475467",
            }}>
              {documentation || <span style={{ color: "#d0d5dd", fontStyle: "italic" }}>No documentation yet</span>}
            </div>
          ) : (
            <textarea
              value={documentation}
              onChange={(e) => onDocumentationChange(e.target.value)}
              rows={3}
              onFocus={focusHandler}
              onBlur={blurHandler}
              style={monoTextareaStyle}
              placeholder="Markdown documentation..."
            />
          )}
        </div>
      )}
    </div>
  );
}
