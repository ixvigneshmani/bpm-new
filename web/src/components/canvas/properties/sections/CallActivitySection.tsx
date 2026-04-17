/* ─── Call Activity Section ───────────────────────────────────────────
 * Configures the called process, binding/version, and variable passing.
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import type {
  CallActivityConfig,
  CallActivityBinding,
  VariableMapping,
} from "../../../../types/bpmn-node-data";
import MappingTable from "../fields/MappingTable";

type Props = {
  call: CallActivityConfig | undefined;
  onChange: (c: CallActivityConfig) => void;
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

const BINDINGS: { value: CallActivityBinding; label: string; desc: string }[] = [
  { value: "latest", label: "Latest", desc: "Always call the latest deployed version" },
  { value: "deployment", label: "Deployment", desc: "Pin to current deployment" },
  { value: "version", label: "Version", desc: "Pin to a specific version" },
];

export default function CallActivitySection({ call, onChange }: Props) {
  const current: CallActivityConfig = call || {
    calledProcessId: "", binding: "latest", propagateAllVariables: false,
  };

  const inputMappings: VariableMapping[] = current.inputMappings || [];
  const outputMappings: VariableMapping[] = current.outputMappings || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={configBox}>
        <div>
          <div style={labelStyle}>Called Process ID</div>
          <input
            type="text"
            value={current.calledProcessId}
            onChange={(e) => onChange({ ...current, calledProcessId: e.target.value })}
            style={monoInput}
            placeholder="order-fulfillment"
          />
        </div>
        <div>
          <div style={labelStyle}>Display Name</div>
          <input
            type="text"
            value={current.calledProcessName || ""}
            onChange={(e) => onChange({ ...current, calledProcessName: e.target.value })}
            style={inputStyle}
            placeholder="Order Fulfillment"
          />
        </div>

        {/* Binding */}
        <div>
          <div style={labelStyle}>Binding</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {BINDINGS.map((b) => {
              const active = current.binding === b.value;
              return (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => onChange({ ...current, binding: b.value })}
                  style={{
                    padding: "8px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                    border: `1px solid ${active ? "#cbd5e1" : "#e5e7eb"}`,
                    background: active ? "#f1f5f9" : "#fff",
                    color: active ? "#475569" : "#667085",
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                  title={b.desc}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: "#98a2b3" }}>
            {BINDINGS.find((b) => b.value === current.binding)?.desc}
          </div>
        </div>

        {/* Version (only when binding = version) */}
        {current.binding === "version" && (
          <div>
            <div style={labelStyle}>Version</div>
            <input
              type="text"
              value={current.version || ""}
              onChange={(e) => onChange({ ...current, version: e.target.value })}
              style={monoInput}
              placeholder="v3"
            />
          </div>
        )}
      </div>

      {/* Propagate all */}
      <label
        style={{
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
          padding: "10px 12px", borderRadius: 10,
          border: "1px solid #e5e7eb", background: "#fff",
        }}
      >
        <input
          type="checkbox"
          checked={current.propagateAllVariables || false}
          onChange={(e) =>
            onChange({ ...current, propagateAllVariables: e.target.checked })
          }
          style={{ width: 16, height: 16, cursor: "pointer" }}
        />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#344054" }}>
            Propagate all variables
          </div>
          <div style={{ fontSize: 10, color: "#98a2b3", marginTop: 2 }}>
            Pass the entire parent scope into the called process, and back out.
          </div>
        </div>
      </label>

      {/* Input mappings */}
      {!current.propagateAllVariables && (
        <div>
          <div style={labelStyle}>Input Mappings (parent → child)</div>
          <MappingTable
            mappings={inputMappings}
            onChange={(m) => onChange({ ...current, inputMappings: m })}
            direction="input"
            sourceLabel="From parent"
            targetLabel="To child var"
          />
        </div>
      )}

      {/* Output mappings */}
      {!current.propagateAllVariables && (
        <div>
          <div style={labelStyle}>Output Mappings (child → parent)</div>
          <MappingTable
            mappings={outputMappings}
            onChange={(m) => onChange({ ...current, outputMappings: m })}
            direction="output"
            sourceLabel="From child"
            targetLabel="To parent var"
          />
        </div>
      )}
    </div>
  );
}
