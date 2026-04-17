/* ─── Multi-Instance & Loop Markers Section ───────────────────────────
 * Loop marker configuration shared by all activities (tasks, subprocesses).
 * None / Standard Loop / Multi-Instance (parallel or sequential).
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import type {
  LoopMarker,
  CompensationMarker,
} from "../../../../types/bpmn-node-data";
import FeelExpressionInput from "../fields/FeelExpressionInput";

type Props = {
  loopMarker: LoopMarker | undefined;
  compensation: CompensationMarker | undefined;
  onLoopChange: (lm: LoopMarker) => void;
  onCompensationChange: (c: CompensationMarker) => void;
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

const KINDS: { value: LoopMarker["kind"]; label: string; desc: string; icon: string }[] = [
  { value: "none", label: "None", desc: "Single execution", icon: "—" },
  { value: "standardLoop", label: "Loop", desc: "Repeat while condition is true", icon: "↻" },
  { value: "multiInstance", label: "Multi-Instance", desc: "One execution per item in collection", icon: "⫴" },
];

export default function MultiInstanceSection({
  loopMarker, compensation, onLoopChange, onCompensationChange,
}: Props) {
  const current: LoopMarker = loopMarker || { kind: "none" };

  const setKind = (kind: LoopMarker["kind"]) => {
    if (kind === current.kind) return;
    switch (kind) {
      case "none":
        onLoopChange({ kind: "none" });
        break;
      case "standardLoop":
        onLoopChange({ kind: "standardLoop", condition: "", testBefore: true });
        break;
      case "multiInstance":
        onLoopChange({
          kind: "multiInstance",
          mode: "parallel",
          collection: "",
          elementVariable: "item",
        });
        break;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Marker kind selector */}
      <div>
        <div style={labelStyle}>Execution Mode</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {KINDS.map((k) => {
            const active = current.kind === k.value;
            return (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                style={{
                  padding: "10px 8px", borderRadius: 10, textAlign: "center",
                  border: `1.5px solid ${active ? "#818cf8" : "#e5e7eb"}`,
                  background: active ? "#eef2ff" : "#fff",
                  cursor: "pointer", transition: "all 0.15s",
                }}
                title={k.desc}
              >
                <div style={{ fontSize: 18, marginBottom: 2, color: active ? "#4f46e5" : "#475467" }}>
                  {k.icon}
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, color: active ? "#4f46e5" : "#667085" }}>
                  {k.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Standard loop config */}
      {current.kind === "standardLoop" && (
        <div style={configBox}>
          <FeelExpressionInput
            label="Loop Condition"
            value={current.condition || ""}
            onChange={(v) => onLoopChange({ ...current, condition: v })}
            placeholder="= retries < 3 and not success"
          />
          <div>
            <div style={labelStyle}>Evaluate</div>
            <div style={{ display: "flex", gap: 6 }}>
              {([
                { v: true, label: "Before" },
                { v: false, label: "After" },
              ] as const).map((opt) => {
                const active = (current.testBefore ?? true) === opt.v;
                return (
                  <button
                    key={String(opt.v)}
                    type="button"
                    onClick={() => onLoopChange({ ...current, testBefore: opt.v })}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                      border: `1px solid ${active ? "#818cf8" : "#e5e7eb"}`,
                      background: active ? "#eef2ff" : "#fff",
                      color: active ? "#4f46e5" : "#667085",
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Loop Maximum</div>
            <input
              type="number"
              min={1}
              value={current.loopMaximum ?? ""}
              onChange={(e) => onLoopChange({ ...current, loopMaximum: e.target.value ? Number(e.target.value) : undefined })}
              style={monoInput}
              placeholder="Optional hard cap"
            />
          </div>
        </div>
      )}

      {/* Multi-instance config */}
      {current.kind === "multiInstance" && (
        <div style={configBox}>
          {/* Parallel vs Sequential */}
          <div>
            <div style={labelStyle}>Mode</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["parallel", "sequential"] as const).map((mode) => {
                const active = current.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onLoopChange({ ...current, mode })}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                      textTransform: "capitalize",
                      border: `1px solid ${active ? "#818cf8" : "#e5e7eb"}`,
                      background: active ? "#eef2ff" : "#fff",
                      color: active ? "#4f46e5" : "#667085",
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                  >
                    {mode}
                  </button>
                );
              })}
            </div>
          </div>

          <FeelExpressionInput
            label="Collection"
            value={current.collection || ""}
            onChange={(v) => onLoopChange({ ...current, collection: v })}
            placeholder="= order.lineItems"
          />

          <div>
            <div style={labelStyle}>Element Variable</div>
            <input
              type="text"
              value={current.elementVariable || ""}
              onChange={(e) => onLoopChange({ ...current, elementVariable: e.target.value })}
              style={monoInput}
              placeholder="item"
            />
            <div style={{ marginTop: 4, fontSize: 10, color: "#98a2b3" }}>
              Name used to reference the current item inside the activity.
            </div>
          </div>

          <FeelExpressionInput
            label="Completion Condition"
            value={current.completionCondition || ""}
            onChange={(v) => onLoopChange({ ...current, completionCondition: v })}
            placeholder="= nrOfCompletedInstances >= 3"
          />
        </div>
      )}

      {/* Compensation */}
      <label
        style={{
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
          padding: "10px 12px", borderRadius: 10,
          border: "1px solid #e5e7eb", background: "#fff",
        }}
      >
        <input
          type="checkbox"
          checked={compensation?.enabled || false}
          onChange={(e) => onCompensationChange({ enabled: e.target.checked })}
          style={{ width: 16, height: 16, cursor: "pointer" }}
        />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#344054" }}>
            Compensation activity
          </div>
          <div style={{ fontSize: 10, color: "#98a2b3", marginTop: 2 }}>
            This activity can be invoked to undo the effects of a completed activity.
          </div>
        </div>
      </label>
    </div>
  );
}
