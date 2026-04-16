/* ─── Assignment Section ──────────────────────────────────────────────
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import type { Assignment, AssignmentType } from "../../../../types/bpmn-node-data";
import FeelExpressionInput from "../fields/FeelExpressionInput";

type Props = {
  assignment: Assignment | undefined;
  onChange: (assignment: Assignment) => void;
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color: "#98a2b3", marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10,
  border: "1px solid #e5e7eb", fontSize: 13, color: "#111827",
  fontFamily: "inherit", outline: "none", background: "#fff",
  lineHeight: "1.5",
};

const ASSIGNMENT_TYPES: { type: AssignmentType; label: string; desc: string; icon: string }[] = [
  { type: "directUser", label: "Direct User", desc: "Assign to a specific person", icon: "👤" },
  { type: "candidateGroup", label: "Group", desc: "Assign to a group or role", icon: "👥" },
  { type: "expression", label: "Expression", desc: "Dynamic via FEEL expression", icon: "fx" },
  { type: "aiRouted", label: "AI Routed", desc: "Intelligent task routing", icon: "✨" },
];

export default function AssignmentSection({ assignment, onChange }: Props) {
  const currentType = assignment?.type || "directUser";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Assignment type cards */}
      <div>
        <div style={labelStyle}>Assign To</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {ASSIGNMENT_TYPES.map((at) => {
            const active = currentType === at.type;
            return (
              <button
                key={at.type}
                type="button"
                onClick={() => onChange({ type: at.type, value: assignment?.value || "" })}
                style={{
                  padding: "10px 12px", borderRadius: 10, textAlign: "left",
                  border: `1.5px solid ${active ? "#818cf8" : "#e5e7eb"}`,
                  background: active ? "#eef2ff" : "#fff",
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 14 }}>{at.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: active ? "#4f46e5" : "#344054" }}>
                    {at.label}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#98a2b3" }}>{at.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Value input */}
      {currentType === "directUser" && (
        <div>
          <div style={labelStyle}>User</div>
          <input
            type="text"
            value={assignment?.value || ""}
            onChange={(e) => onChange({ type: "directUser", value: e.target.value })}
            style={inputStyle}
            placeholder="Search for a user..."
          />
        </div>
      )}

      {currentType === "candidateGroup" && (
        <div>
          <div style={labelStyle}>Group / Role</div>
          <input
            type="text"
            value={assignment?.value || ""}
            onChange={(e) => onChange({ type: "candidateGroup", value: e.target.value })}
            style={inputStyle}
            placeholder="managers, finance-team..."
          />
        </div>
      )}

      {currentType === "expression" && (
        <FeelExpressionInput
          label="Assignee Expression"
          value={assignment?.value || ""}
          onChange={(v) => onChange({ type: "expression", value: v })}
          placeholder="= process.initiator"
        />
      )}

      {currentType === "aiRouted" && (
        <div style={{
          border: "1px solid #c7d2fe", borderRadius: 10, background: "#eef2ff",
          padding: 14, display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />
            <path d="M19 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
          </svg>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#4338ca" }}>AI-Powered Routing</div>
            <div style={{ fontSize: 11, color: "#6366f1", marginTop: 3, lineHeight: 1.5 }}>
              Tasks will be routed based on workload, expertise, availability, and historical performance.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
