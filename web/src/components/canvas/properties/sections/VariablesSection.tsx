/* ─── Variables Section ───────────────────────────────────────────────
 * Input/output variable mappings and extension properties.
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import type { VariableMapping, KeyValuePair } from "../../../../types/bpmn-node-data";
import MappingTable from "../fields/MappingTable";
import { useVariableRegistry, TYPE_COLORS, TYPE_ICONS, type VariableNode as VarNode } from "../../../../store/variable-registry";

type Props = {
  inputMappings: VariableMapping[];
  outputMappings: VariableMapping[];
  extensionProperties: KeyValuePair[];
  onInputMappingsChange: (m: VariableMapping[]) => void;
  onOutputMappingsChange: (m: VariableMapping[]) => void;
  onExtensionPropertiesChange: (p: KeyValuePair[]) => void;
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", borderRadius: 8,
  border: "1px solid #e5e7eb", fontSize: 12, color: "#111827",
  fontFamily: "inherit", outline: "none", background: "#fff",
};

export default function VariablesSection({
  inputMappings, outputMappings, extensionProperties,
  onInputMappingsChange, onOutputMappingsChange, onExtensionPropertiesChange,
}: Props) {
  const [activeTab, setActiveTab] = useState<"input" | "output" | "variables" | "extensions">("variables");
  const registry = useVariableRegistry();

  const tabs = [
    { key: "variables" as const, label: "Variables", count: registry.flatList.length },
    { key: "input" as const, label: "Input", count: inputMappings.length },
    { key: "output" as const, label: "Output", count: outputMappings.length },
    { key: "extensions" as const, label: "Extensions", count: extensionProperties.length },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Tab bar */}
      <div style={{
        display: "flex", gap: 4, padding: 4,
        background: "#f2f4f7", borderRadius: 10,
      }}>
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1, padding: "7px 8px", borderRadius: 8,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: "none", transition: "all 0.15s",
                background: active ? "#fff" : "transparent",
                color: active ? "#111827" : "#98a2b3",
                boxShadow: active ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{ marginLeft: 3, fontSize: 10, color: "#98a2b3" }}>
                  ({tab.count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Variable browser */}
      {activeTab === "variables" && (
        <div>
          {registry.isEmpty ? (
            <div style={{
              border: "1.5px dashed #e5e7eb", borderRadius: 12,
              padding: "24px 16px", textAlign: "center",
              fontSize: 12, color: "#98a2b3", lineHeight: 1.6,
            }}>
              No variables defined. Define a business document in Step 2 to see process variables here.
            </div>
          ) : (
            <div style={{
              maxHeight: 240, overflowY: "auto",
              border: "1px solid #f2f4f7", borderRadius: 12,
              background: "#f9fafb",
            }}>
              {registry.variables.map((v) => (
                <VariableTreeItem key={v.path} variable={v} depth={0} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Input mappings */}
      {activeTab === "input" && (
        <MappingTable
          mappings={inputMappings}
          onChange={onInputMappingsChange}
          sourceLabel="Expression"
          targetLabel="Parameter"
          direction="input"
        />
      )}

      {/* Output mappings */}
      {activeTab === "output" && (
        <MappingTable
          mappings={outputMappings}
          onChange={onOutputMappingsChange}
          sourceLabel="Result"
          targetLabel="Variable"
          direction="output"
        />
      )}

      {/* Extension properties */}
      {activeTab === "extensions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {extensionProperties.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                value={p.key}
                onChange={(e) => {
                  const updated = [...extensionProperties];
                  updated[i] = { ...p, key: e.target.value };
                  onExtensionPropertiesChange(updated);
                }}
                placeholder="key"
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                type="text"
                value={p.value}
                onChange={(e) => {
                  const updated = [...extensionProperties];
                  updated[i] = { ...p, value: e.target.value };
                  onExtensionPropertiesChange(updated);
                }}
                placeholder="value"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => onExtensionPropertiesChange(extensionProperties.filter((_, j) => j !== i))}
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
          <button
            type="button"
            onClick={() => onExtensionPropertiesChange([...extensionProperties, { key: "", value: "" }])}
            style={{
              width: "100%", padding: extensionProperties.length === 0 ? "16px 12px" : "8px 12px",
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
            Add property
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Variable tree item ─── */

function VariableTreeItem({ variable, depth }: { variable: VarNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = (variable.children && variable.children.length > 0) || (variable.itemType && variable.itemType.length > 0);

  return (
    <div>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px", paddingLeft: 12 + depth * 16,
          cursor: hasChildren ? "pointer" : "default",
          transition: "background 0.1s",
          borderBottom: "1px solid #f2f4f7",
        }}
        onClick={() => hasChildren && setExpanded(!expanded)}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#f2f4f7"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        {/* Expand/collapse arrow */}
        {hasChildren ? (
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#98a2b3" strokeWidth="2.5"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease", flexShrink: 0 }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        {/* Type badge */}
        <span style={{
          display: "inline-flex", height: 20, minWidth: 28, padding: "0 6px",
          alignItems: "center", justifyContent: "center",
          borderRadius: 5, fontFamily: "var(--font-mono, monospace)",
          fontSize: 9, fontWeight: 700, color: "#fff", flexShrink: 0,
          background: TYPE_COLORS[variable.type],
        }}>
          {TYPE_ICONS[variable.type]}
        </span>

        {/* Name */}
        <span style={{
          flex: 1, fontFamily: "var(--font-mono, monospace)",
          fontSize: 12, color: "#344054", fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {variable.name}
        </span>

        {/* Type label */}
        <span style={{ fontSize: 10, color: "#98a2b3", flexShrink: 0 }}>
          {variable.type}
        </span>
      </div>

      {/* Children */}
      {expanded && variable.children?.map((c) => (
        <VariableTreeItem key={c.path} variable={c} depth={depth + 1} />
      ))}
      {expanded && variable.itemType?.map((c) => (
        <VariableTreeItem key={c.path} variable={c} depth={depth + 1} />
      ))}
    </div>
  );
}
