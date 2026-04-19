/* ─── SubprocessConfigSection ─────────────────────────────────────────
 * Subprocess family configuration:
 *  - isExpanded (all)
 *  - ordering: Parallel | Sequential (ad-hoc)
 *  - method: transaction protocol (transaction)
 *  - triggeredByEvent indicator (event subprocess — read-only, structural)
 * ──────────────────────────────────────────────────────────────────── */

import type { TransactionMethod } from "../../../../types/bpmn-node-data";

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

export default function SubprocessConfigSection(props: SubprocessConfigProps) {
  const { variant, isExpanded, onIsExpandedChange } = props;

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-[12px] text-gray-700">
        <input
          type="checkbox"
          checked={isExpanded}
          onChange={(e) => onIsExpandedChange(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Expanded</span>
          <span className="block text-[10px] text-gray-500">
            When checked, the shape renders as a resizable frame and its children are visible.
            Uncheck to collapse to a task-sized box with a <code>+</code> marker.
          </span>
        </span>
      </label>

      {variant === "adHocSubProcess" && props.onOrderingChange && (
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Ordering
          </label>
          <select
            value={props.ordering || "Parallel"}
            onChange={(e) => props.onOrderingChange!(e.target.value as "Parallel" | "Sequential")}
            className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
          >
            <option value="Parallel">Parallel — activities may run concurrently</option>
            <option value="Sequential">Sequential — one activity at a time</option>
          </select>
        </div>
      )}

      {variant === "transaction" && props.onMethodChange && (
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Transaction Protocol
          </label>
          <select
            value={props.method || ""}
            onChange={(e) => props.onMethodChange!((e.target.value || undefined) as TransactionMethod | undefined)}
            className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
          >
            <option value="">— Unspecified —</option>
            <option value="##Compensate">##Compensate</option>
            <option value="##Store">##Store</option>
            <option value="##Image">##Image</option>
          </select>
          <div className="mt-1 text-[10px] text-gray-500">
            Rarely tuned by modelers — round-trips for interop with engines that use it.
          </div>
        </div>
      )}

      {variant === "eventSubProcess" && (
        <div className="rounded-md border border-violet-100 bg-violet-50/40 px-3 py-2 text-[11px] text-violet-900">
          <span className="font-medium">Triggered by event.</span> This subprocess starts when its
          inner start event fires (no incoming sequence flow). Place an event-typed start event
          (timer, message, signal, error, escalation, compensation, conditional) inside it.
        </div>
      )}
    </div>
  );
}
