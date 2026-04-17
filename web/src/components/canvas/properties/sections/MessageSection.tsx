/* ─── Send/Receive Message Section ────────────────────────────────────
 * Shared properties for Send Task and Receive Task message configuration.
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import type {
  SendMessageConfig,
  ReceiveMessageConfig,
  VariableMapping,
} from "../../../../types/bpmn-node-data";
import FeelExpressionInput from "../fields/FeelExpressionInput";
import MappingTable from "../fields/MappingTable";

type Props = {
  mode: "send" | "receive";
  config: SendMessageConfig | ReceiveMessageConfig | undefined;
  onChange: (c: SendMessageConfig | ReceiveMessageConfig) => void;
  instantiate?: boolean;
  onInstantiateChange?: (v: boolean) => void;
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

export default function MessageSection({
  mode, config, onChange, instantiate, onInstantiateChange,
}: Props) {
  const base: SendMessageConfig | ReceiveMessageConfig =
    config || { messageName: "" };
  const payload: VariableMapping[] = base.payloadMappings || [];

  return (
    <div style={configBox}>
      {/* Message name */}
      <div>
        <div style={labelStyle}>Message Name</div>
        <input
          type="text"
          value={base.messageName}
          onChange={(e) => onChange({ ...base, messageName: e.target.value })}
          style={inputStyle}
          placeholder={mode === "send" ? "OrderShipped" : "PaymentConfirmed"}
        />
      </div>

      {/* Correlation key */}
      <FeelExpressionInput
        label="Correlation Key"
        value={base.correlationKey || ""}
        onChange={(v) => onChange({ ...base, correlationKey: v })}
        placeholder="= order.id"
      />

      {/* Target system (send only) */}
      {mode === "send" && (
        <div>
          <div style={labelStyle}>Target System</div>
          <input
            type="text"
            value={(base as SendMessageConfig).targetSystem || ""}
            onChange={(e) =>
              onChange({ ...(base as SendMessageConfig), targetSystem: e.target.value })
            }
            style={inputStyle}
            placeholder="kafka:orders-topic, smtp:noreply@x.com..."
          />
          <div style={{ marginTop: 4, fontSize: 10, color: "#98a2b3" }}>
            Optional. Broker, queue, or endpoint reference.
          </div>
        </div>
      )}

      {/* Instantiate flag (receive only) */}
      {mode === "receive" && onInstantiateChange && (
        <label
          style={{
            display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
            padding: "10px 12px", borderRadius: 10,
            border: "1px solid #e5e7eb", background: "#fff",
          }}
        >
          <input
            type="checkbox"
            checked={instantiate || false}
            onChange={(e) => onInstantiateChange(e.target.checked)}
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#344054" }}>
              Instantiate process
            </div>
            <div style={{ fontSize: 10, color: "#98a2b3", marginTop: 2 }}>
              Message can start a new process instance (non-interrupting).
            </div>
          </div>
        </label>
      )}

      {/* Payload mappings */}
      <div>
        <div style={labelStyle}>
          {mode === "send" ? "Payload (Input)" : "Payload (Output)"}
        </div>
        <MappingTable
          mappings={payload}
          onChange={(m) => onChange({ ...base, payloadMappings: m })}
          direction={mode === "send" ? "input" : "output"}
          sourceLabel={mode === "send" ? "From variable" : "From payload"}
          targetLabel={mode === "send" ? "Payload field" : "To variable"}
        />
      </div>
    </div>
  );
}
