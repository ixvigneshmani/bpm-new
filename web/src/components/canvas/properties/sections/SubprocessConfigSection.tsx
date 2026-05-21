/* ─── SubprocessConfigSection ─────────────────────────────────────────
 * Subprocess family configuration:
 *  - isExpanded (all)
 *  - ordering: Parallel | Sequential (ad-hoc)
 *  - method: transaction protocol (transaction)
 *  - triggeredByEvent indicator (event subprocess — read-only, structural)
 *
 * Refactored Session 2: dropped Tailwind for shared inline-style tokens.
 * ──────────────────────────────────────────────────────────────────── */

import type { TransactionMethod } from "../../../../types/bpmn-node-data";
import DesignOnlyBanner from "../banners/DesignOnlyBanner";
import { hintStyle, inputStyle, labelStyle, sectionStack } from "../styles";

type SubprocessVariant = "subProcess" | "eventSubProcess" | "transaction" | "adHocSubProcess";

export type SubprocessConfigProps = {
  variant: SubprocessVariant;
  isExpanded: boolean;
  onIsExpandedChange: (v: boolean) => void;
  ordering?: "Parallel" | "Sequential";
  onOrderingChange?: (v: "Parallel" | "Sequential") => void;
  method?: TransactionMethod;
  onMethodChange?: (v: TransactionMethod | undefined) => void;
};

const VARIANT_RUNTIME_NOTE: Record<SubprocessVariant, string> = {
  subProcess:
    "Engine today doesn't execute subprocess children — a token entering this shape hops straight to the outgoing edge. Subprocess execution ships in P2 of the engine sprint.",
  eventSubProcess:
    "Engine today doesn't subscribe event-subprocess triggers. The subprocess won't fire on the chosen event until P2 (subprocess) + P3 (event correlation) land.",
  transaction:
    "Engine today doesn't execute transaction children or run compensation/cancel handlers. Full transaction semantics ship in P2 + P6 of the engine sprint.",
  adHocSubProcess:
    "Engine today doesn't execute ad-hoc children or honour completion conditions. Ad-hoc execution ships in P2 of the engine sprint.",
};

export default function SubprocessConfigSection(props: SubprocessConfigProps) {
  const { variant, isExpanded, onIsExpandedChange } = props;

  return (
    <div style={sectionStack}>
      <DesignOnlyBanner milestone="E8">
        {VARIANT_RUNTIME_NOTE[variant]}
      </DesignOnlyBanner>
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          cursor: "pointer",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <input
          type="checkbox"
          checked={isExpanded}
          onChange={(e) => onIsExpandedChange(e.target.checked)}
          style={{ marginTop: 2, width: 16, height: 16, cursor: "pointer" }}
        />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#344054" }}>Expanded</div>
          <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 2, lineHeight: 1.5 }}>
            When checked, the shape renders as a resizable frame and its
            children are visible. Uncheck to collapse to a task-sized box
            with a <code style={{ fontFamily: "var(--font-mono, monospace)" }}>+</code> marker.
          </div>
        </div>
      </label>

      {variant === "adHocSubProcess" && props.onOrderingChange && (
        <div>
          <div style={labelStyle}>Ordering</div>
          <select
            value={props.ordering || "Parallel"}
            onChange={(e) =>
              props.onOrderingChange!(e.target.value as "Parallel" | "Sequential")
            }
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            <option value="Parallel">Parallel — activities may run concurrently</option>
            <option value="Sequential">Sequential — one activity at a time</option>
          </select>
        </div>
      )}

      {variant === "transaction" && props.onMethodChange && (
        <div>
          <div style={labelStyle}>Transaction Protocol</div>
          <select
            value={props.method || ""}
            onChange={(e) =>
              props.onMethodChange!(
                (e.target.value || undefined) as TransactionMethod | undefined,
              )
            }
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            <option value="">— Unspecified —</option>
            <option value="##Compensate">##Compensate</option>
            <option value="##Store">##Store</option>
            <option value="##Image">##Image</option>
          </select>
          <div style={hintStyle}>
            Rarely tuned by modelers — round-trips for interop with engines that use it.
          </div>
        </div>
      )}

      {variant === "eventSubProcess" && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "#f5f3ff",
            border: "1px solid #ddd6fe",
            fontSize: 11.5,
            color: "#5b21b6",
            lineHeight: 1.55,
          }}
        >
          <strong>Triggered by event.</strong> This subprocess starts when its
          inner start event fires (no incoming sequence flow). Place an
          event-typed start event (timer, message, signal, error, escalation,
          compensation, conditional) inside it.
        </div>
      )}
    </div>
  );
}
