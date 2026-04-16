/* ─── Scheduling Section ──────────────────────────────────────────────
 * User Task scheduling: due date, follow-up date, priority, SLA.
 * ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import type { SchedulingConfig, SlaConfig } from "../../../../types/bpmn-node-data";
import FeelExpressionInput from "../fields/FeelExpressionInput";

type Props = {
  scheduling: SchedulingConfig | undefined;
  sla: SlaConfig | undefined;
  onSchedulingChange: (s: SchedulingConfig) => void;
  onSlaChange: (s: SlaConfig) => void;
};

const PRIORITIES = [
  { value: 25, label: "Low", color: "#6B7280" },
  { value: 50, label: "Medium", color: "#CA8A04" },
  { value: 75, label: "High", color: "#EA580C" },
  { value: 100, label: "Critical", color: "#DC2626" },
];

export default function SchedulingSection({
  scheduling = {},
  sla,
  onSchedulingChange,
  onSlaChange,
}: Props) {
  const [useDueDateExpr, setUseDueDateExpr] = useState(scheduling.dueDateIsExpression || false);
  const [showSla, setShowSla] = useState(!!sla?.reactionTime || !!sla?.completionDeadline);

  return (
    <div className="space-y-4">
      {/* Due Date */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Due Date
          </span>
          <button
            type="button"
            onClick={() => { setUseDueDateExpr(!useDueDateExpr); onSchedulingChange({ ...scheduling, dueDateIsExpression: !useDueDateExpr }); }}
            className="rounded px-1.5 py-0.5 text-[9px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            {useDueDateExpr ? "Date picker" : "Expression"}
          </button>
        </div>
        {useDueDateExpr ? (
          <FeelExpressionInput
            value={scheduling.dueDate || ""}
            onChange={(v) => onSchedulingChange({ ...scheduling, dueDate: v })}
            placeholder='= now() + duration("P3D")'
          />
        ) : (
          <input
            type="datetime-local"
            value={scheduling.dueDate || ""}
            onChange={(e) => onSchedulingChange({ ...scheduling, dueDate: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-900 outline-none transition-all focus:border-brand-400 focus:ring-2 focus:ring-brand-50"
          />
        )}
      </div>

      {/* Priority */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Priority
        </div>
        <div className="flex gap-1">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onSchedulingChange({ ...scheduling, priority: p.value })}
              className="flex-1 rounded-lg border py-1.5 text-center text-[10px] font-semibold transition-all"
              style={{
                background: scheduling.priority === p.value ? `${p.color}10` : "white",
                borderColor: scheduling.priority === p.value ? p.color : "#E5E7EB",
                color: scheduling.priority === p.value ? p.color : "#9CA3AF",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* SLA (our extension) */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            SLA
          </span>
          <div className="flex items-center gap-1">
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-brand-600">
              Extension
            </span>
            <button
              type="button"
              onClick={() => setShowSla(!showSla)}
              className="rounded px-1.5 py-0.5 text-[9px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              {showSla ? "Hide" : "Configure"}
            </button>
          </div>
        </div>

        {showSla && (
          <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div>
              <div className="mb-1 text-[10px] font-medium text-gray-500">Reaction Time</div>
              <input
                type="text"
                value={sla?.reactionTime || ""}
                onChange={(e) => onSlaChange({ ...sla, reactionTime: e.target.value })}
                className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 font-mono text-[11px] text-gray-900 outline-none transition-all focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
                placeholder="PT1H (1 hour)"
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-medium text-gray-500">Completion Deadline</div>
              <input
                type="text"
                value={sla?.completionDeadline || ""}
                onChange={(e) => onSlaChange({ ...sla, completionDeadline: e.target.value })}
                className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 font-mono text-[11px] text-gray-900 outline-none transition-all focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
                placeholder="P3D (3 days)"
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-medium text-gray-500">On Breach</div>
              <select
                value={sla?.breachAction || "notify"}
                onChange={(e) => onSlaChange({ ...sla, breachAction: e.target.value as SlaConfig["breachAction"] })}
                className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-900 outline-none transition-all focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
              >
                <option value="notify">Notify</option>
                <option value="escalate">Escalate</option>
                <option value="subprocess">Trigger Subprocess</option>
                <option value="hook">Custom Hook</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
