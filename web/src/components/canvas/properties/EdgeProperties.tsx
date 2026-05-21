/* ─── Edge Properties Panel ───────────────────────────────────────────
 * Right-side panel content rendered when a sequence-flow or message-flow
 * edge is selected (instead of a node). Mirrors the node-panel chrome
 * (header + scrollable fieldset + read-only banner) so the visual
 * affordance is consistent.
 *
 * Extracted from PropertiesPanel.tsx (Phase 1 cleanup) so the
 * orchestrator stops carrying ~140 lines of edge-specific UI.
 * ──────────────────────────────────────────────────────────────────── */

import FeelExpressionInput from "./fields/FeelExpressionInput";

type Props = {
  edgeId: string;
  label: string;
  flowType: "sequence" | "message";
  condition: string;
  onLabelChange: (v: string) => void;
  onFlowTypeChange: (v: "sequence" | "message") => void;
  onConditionChange: (v: string) => void;
  readOnly?: boolean;
};

const radioCardLabel: React.CSSProperties = {
  flex: 1,
  display: "flex",
  gap: 8,
  padding: "8px 12px",
  borderRadius: 6,
  cursor: "pointer",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#98a2b3",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 6,
};

export default function EdgeProperties({
  edgeId,
  label,
  flowType,
  condition,
  onLabelChange,
  onFlowTypeChange,
  onConditionChange,
  readOnly = false,
}: Props) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: "50%",
        minWidth: 420,
        zIndex: 10,
        background: "#ffffff",
        borderLeft: "1px solid #E5E7EB",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "18px 28px 16px",
          borderBottom: "1px solid #f2f4f7",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#101828" }}>Edge</div>
          <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 2 }}>
            {flowType === "message" ? "Message flow" : "Sequence flow"}
          </div>
        </div>
      </div>

      {readOnly && (
        <div
          style={{
            padding: "8px 28px",
            background: "#FFFBEB",
            borderBottom: "1px solid #FDE68A",
            color: "#92400E",
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          View only — properties are locked.
        </div>
      )}

      <fieldset
        disabled={readOnly}
        style={{
          padding: "20px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          border: 0,
          margin: 0,
          minWidth: 0,
        }}
      >
        <div>
          <label style={fieldLabel}>Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="Optional edge label"
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #E5E7EB",
              fontSize: 12,
              fontFamily: "inherit",
              color: "#101828",
              outline: "none",
            }}
          />
        </div>

        <div>
          <label style={fieldLabel}>Flow Type</label>
          <div style={{ display: "flex", gap: 8 }}>
            <label
              style={{
                ...radioCardLabel,
                border: `1px solid ${flowType === "sequence" ? "#4F46E5" : "#E5E7EB"}`,
                background: flowType === "sequence" ? "#EEF2FF" : "#fff",
              }}
            >
              <input
                type="radio"
                name={`flowType-${edgeId}`}
                checked={flowType === "sequence"}
                onChange={() => onFlowTypeChange("sequence")}
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#101828" }}>Sequence</span>
                <span style={{ fontSize: 10, color: "#667085" }}>Same pool</span>
              </div>
            </label>
            <label
              style={{
                ...radioCardLabel,
                border: `1px solid ${flowType === "message" ? "#4F46E5" : "#E5E7EB"}`,
                background: flowType === "message" ? "#EEF2FF" : "#fff",
              }}
            >
              <input
                type="radio"
                name={`flowType-${edgeId}`}
                checked={flowType === "message"}
                onChange={() => onFlowTypeChange("message")}
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#101828" }}>Message</span>
                <span style={{ fontSize: 10, color: "#667085" }}>Cross-pool</span>
              </div>
            </label>
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: "#98a2b3" }}>
            BPMN 2.0 §8.3.3: sequence flows must stay inside one pool;
            message flows must cross a pool boundary.
          </div>
        </div>

        {flowType === "sequence" && (
          <div>
            <label style={fieldLabel}>Condition (FEEL)</label>
            <FeelExpressionInput
              value={condition}
              onChange={onConditionChange}
              placeholder='outcome == "approve"  or  amount > 1000'
            />
            <div style={{ marginTop: 6, fontSize: 10, color: "#98a2b3" }}>
              Evaluated when this edge is the outgoing flow from an exclusive
              or inclusive gateway. Examples: <code>outcome == "approve"</code>,
              {" "}<code>amount &gt; 1000</code>,{" "}
              <code>daysRequested &gt; 5 && approved</code>.
            </div>
          </div>
        )}
      </fieldset>
    </div>
  );
}
