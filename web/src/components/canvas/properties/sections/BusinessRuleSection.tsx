/* ─── Business Rule Task Section ──────────────────────────────────────
 * DMN decision reference, inline decision table link, or FEEL expression.
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import type {
  BusinessRuleConfig,
  BusinessRuleBinding,
} from "../../../../types/bpmn-node-data";
import FeelExpressionInput from "../fields/FeelExpressionInput";

type Props = {
  rule: BusinessRuleConfig | undefined;
  onChange: (rule: BusinessRuleConfig) => void;
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

const monoInput: React.CSSProperties = {
  ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 12,
};

const configBox: React.CSSProperties = {
  border: "1px solid #f2f4f7", borderRadius: 12, background: "#f9fafb",
  padding: 16, display: "flex", flexDirection: "column", gap: 12,
};

const BINDINGS: { value: BusinessRuleBinding; label: string; desc: string; icon: string }[] = [
  { value: "dmnRef", label: "DMN Decision", desc: "Reference a published DMN model", icon: "📋" },
  { value: "inlineTable", label: "Decision Table", desc: "Edit inline table", icon: "🗂️" },
  { value: "expression", label: "Expression", desc: "FEEL boolean/decision", icon: "fx" },
];

export default function BusinessRuleSection({ rule, onChange }: Props) {
  const current: BusinessRuleConfig =
    rule || { binding: "dmnRef", decisionId: "" };

  const setBinding = (binding: BusinessRuleBinding) => {
    if (binding === current.binding) return;
    switch (binding) {
      case "dmnRef":
        onChange({ binding: "dmnRef", decisionId: "", resultVariable: current.resultVariable });
        break;
      case "inlineTable":
        onChange({ binding: "inlineTable", resultVariable: current.resultVariable });
        break;
      case "expression":
        onChange({ binding: "expression", expression: "", resultVariable: current.resultVariable });
        break;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Binding selector */}
      <div>
        <div style={labelStyle}>Rule Source</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {BINDINGS.map((b) => {
            const active = current.binding === b.value;
            return (
              <button
                key={b.value}
                type="button"
                onClick={() => setBinding(b.value)}
                style={{
                  padding: "10px 8px", borderRadius: 10, textAlign: "center",
                  border: `1.5px solid ${active ? "#fcd34d" : "#e5e7eb"}`,
                  background: active ? "#fffbeb" : "#fff",
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 2 }}>{b.icon}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: active ? "#B45309" : "#667085" }}>
                  {b.label}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: "#98a2b3" }}>
          {BINDINGS.find((b) => b.value === current.binding)?.desc}
        </div>
      </div>

      {/* DMN ref */}
      {current.binding === "dmnRef" && (
        <div style={configBox}>
          <div>
            <div style={labelStyle}>Decision ID</div>
            <input
              type="text"
              value={current.decisionId}
              onChange={(e) => onChange({ ...current, decisionId: e.target.value })}
              style={monoInput}
              placeholder="approve-loan-decision"
            />
          </div>
          <div>
            <div style={labelStyle}>Display Name</div>
            <input
              type="text"
              value={current.decisionName || ""}
              onChange={(e) => onChange({ ...current, decisionName: e.target.value })}
              style={inputStyle}
              placeholder="Approve Loan"
            />
          </div>
        </div>
      )}

      {/* Inline table */}
      {current.binding === "inlineTable" && (
        <div style={configBox}>
          <div style={{
            padding: "12px 14px", borderRadius: 10,
            border: "1px dashed #e5e7eb", background: "#fff",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#344054" }}>
                {current.tableId ? `Linked: ${current.tableId}` : "No table linked"}
              </div>
              <div style={{ fontSize: 10, color: "#98a2b3", marginTop: 2 }}>
                Table builder coming soon
              </div>
            </div>
            <button
              type="button"
              disabled
              style={{
                padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                border: "1px solid #e5e7eb", background: "#f9fafb",
                color: "#98a2b3", cursor: "not-allowed",
              }}
            >
              Open editor
            </button>
          </div>
        </div>
      )}

      {/* Expression */}
      {current.binding === "expression" && (
        <div style={configBox}>
          <FeelExpressionInput
            label="Decision Expression"
            value={current.expression}
            onChange={(v) => onChange({ ...current, expression: v })}
            placeholder="= if order.total > 10000 then 'manual' else 'auto'"
            multiline
          />
        </div>
      )}

      {/* Result variable (shared) */}
      <div>
        <div style={labelStyle}>Result Variable</div>
        <input
          type="text"
          value={current.resultVariable || ""}
          onChange={(e) => onChange({ ...current, resultVariable: e.target.value })}
          style={monoInput}
          placeholder="decisionResult"
        />
      </div>
    </div>
  );
}
