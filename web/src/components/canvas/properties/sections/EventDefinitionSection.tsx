/* ─── Event Definition Section ────────────────────────────────────────
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import type { EventDefinition } from "../../../../types/bpmn-node-data";
import FeelExpressionInput from "../fields/FeelExpressionInput";

type Props = {
  definition: EventDefinition;
  onChange: (def: EventDefinition) => void;
  isStart: boolean;
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

const configBox: React.CSSProperties = {
  border: "1px solid #f2f4f7", borderRadius: 12, background: "#f9fafb",
  padding: 16, display: "flex", flexDirection: "column", gap: 12,
};

const START_DEFINITIONS = [
  { kind: "none", label: "None" },
  { kind: "timer", label: "Timer" },
  { kind: "message", label: "Message" },
  { kind: "signal", label: "Signal" },
  { kind: "conditional", label: "Conditional" },
] as const;

const END_DEFINITIONS = [
  { kind: "none", label: "None" },
  { kind: "error", label: "Error" },
  { kind: "terminate", label: "Terminate" },
  { kind: "escalation", label: "Escalation" },
  { kind: "signal", label: "Signal" },
  { kind: "message", label: "Message" },
  { kind: "compensation", label: "Compensation" },
] as const;

export default function EventDefinitionSection({ definition, onChange, isStart }: Props) {
  const definitions = isStart ? START_DEFINITIONS : END_DEFINITIONS;

  const handleKindChange = (kind: string) => {
    switch (kind) {
      case "none":         onChange({ kind: "none" }); break;
      case "timer":        onChange({ kind: "timer", timerType: "duration", value: "" }); break;
      case "message":      onChange({ kind: "message", messageName: "" }); break;
      case "signal":       onChange({ kind: "signal", signalName: "" }); break;
      case "conditional":  onChange({ kind: "conditional", condition: "" }); break;
      case "error":        onChange({ kind: "error", errorCode: "" }); break;
      case "terminate":    onChange({ kind: "terminate" }); break;
      case "escalation":   onChange({ kind: "escalation", escalationCode: "" }); break;
      case "compensation": onChange({ kind: "compensation" }); break;
      default:             onChange({ kind: "none" }); break;
    }
  };

  const toggleBtn = (kind: string, label: string) => {
    const active = definition.kind === kind;
    return (
      <button
        key={kind}
        type="button"
        onClick={() => handleKindChange(kind)}
        style={{
          padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
          border: `1px solid ${active ? "#818cf8" : "#e5e7eb"}`,
          background: active ? "#eef2ff" : "#fff",
          color: active ? "#4f46e5" : "#667085",
          cursor: "pointer", transition: "all 0.15s",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Definition type selector */}
      <div>
        <div style={labelStyle}>Event Type</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {definitions.map((d) => toggleBtn(d.kind, d.label))}
        </div>
      </div>

      {/* Timer */}
      {definition.kind === "timer" && (
        <div style={configBox}>
          <div>
            <div style={{ ...labelStyle, marginBottom: 6 }}>Timer Type</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["date", "duration", "cycle"] as const).map((t) => {
                const active = definition.timerType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onChange({ ...definition, timerType: t })}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 12,
                      fontWeight: 600, textTransform: "capitalize",
                      border: `1px solid ${active ? "#818cf8" : "#e5e7eb"}`,
                      background: active ? "#eef2ff" : "#fff",
                      color: active ? "#4f46e5" : "#667085",
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <FeelExpressionInput
            label="Value"
            value={definition.value}
            onChange={(v) => onChange({ ...definition, value: v })}
            placeholder={
              definition.timerType === "date" ? "2024-01-15T09:00:00Z"
              : definition.timerType === "duration" ? "PT15M"
              : "R3/PT10M"
            }
          />
        </div>
      )}

      {/* Message */}
      {definition.kind === "message" && (
        <div style={configBox}>
          <div>
            <div style={labelStyle}>Message Name</div>
            <input
              type="text"
              value={definition.messageName}
              onChange={(e) => onChange({ ...definition, messageName: e.target.value })}
              style={inputStyle}
              placeholder="OrderApproved"
            />
          </div>
          {isStart && (
            <FeelExpressionInput
              label="Correlation Key"
              value={definition.correlationKey || ""}
              onChange={(v) => onChange({ ...definition, correlationKey: v })}
              placeholder="= order.id"
            />
          )}
        </div>
      )}

      {/* Signal */}
      {definition.kind === "signal" && (
        <div style={configBox}>
          <div style={labelStyle}>Signal Name</div>
          <input
            type="text"
            value={definition.signalName}
            onChange={(e) => onChange({ ...definition, signalName: e.target.value })}
            style={inputStyle}
            placeholder="PaymentReceived"
          />
        </div>
      )}

      {/* Conditional */}
      {definition.kind === "conditional" && (
        <div style={configBox}>
          <FeelExpressionInput
            label="Condition"
            value={definition.condition}
            onChange={(v) => onChange({ ...definition, condition: v })}
            placeholder="= order.status = 'pending'"
          />
        </div>
      )}

      {/* Error */}
      {definition.kind === "error" && (
        <div style={configBox}>
          <div>
            <div style={labelStyle}>Error Code</div>
            <input
              type="text"
              value={definition.errorCode}
              onChange={(e) => onChange({ ...definition, errorCode: e.target.value })}
              style={inputStyle}
              placeholder="VALIDATION_ERROR"
            />
          </div>
          <div>
            <div style={labelStyle}>Error Message</div>
            <input
              type="text"
              value={definition.errorMessage || ""}
              onChange={(e) => onChange({ ...definition, errorMessage: e.target.value })}
              style={inputStyle}
              placeholder="Optional error message"
            />
          </div>
        </div>
      )}

      {/* Escalation */}
      {definition.kind === "escalation" && (
        <div style={configBox}>
          <div style={labelStyle}>Escalation Code</div>
          <input
            type="text"
            value={definition.escalationCode}
            onChange={(e) => onChange({ ...definition, escalationCode: e.target.value })}
            style={inputStyle}
            placeholder="ESCALATION_001"
          />
        </div>
      )}

      {/* Terminate warning */}
      {definition.kind === "terminate" && (
        <div style={{
          border: "1px solid #fde68a", borderRadius: 10, background: "#fffbeb",
          padding: 14, display: "flex", alignItems: "center", gap: 10,
          fontSize: 12, color: "#92400e",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Terminates the entire process instance, including all parallel paths.
        </div>
      )}
    </div>
  );
}
