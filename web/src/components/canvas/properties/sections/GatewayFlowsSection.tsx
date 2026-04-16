/* ─── Gateway Flows Section ───────────────────────────────────────────
 * Lists outgoing sequence flows from a gateway with condition editing.
 * Each flow gets a FEEL expression condition and optional default marker.
 * ──────────────────────────────────────────────────────────────────── */

import type { Edge } from "@xyflow/react";
import FeelExpressionInput from "../fields/FeelExpressionInput";
import AiAssistButton from "../fields/AiAssistButton";

type Props = {
  nodeId: string;
  edges: Edge[];
  nodes: { id: string; data: Record<string, unknown> }[];
  defaultFlowId?: string;
  onDefaultFlowChange: (flowId: string | undefined) => void;
  onEdgeConditionChange: (edgeId: string, condition: string) => void;
  onEdgeLabelChange: (edgeId: string, label: string) => void;
};

export default function GatewayFlowsSection({
  nodeId,
  edges,
  nodes,
  defaultFlowId,
  onDefaultFlowChange,
  onEdgeConditionChange,
  onEdgeLabelChange,
}: Props) {
  // Find outgoing edges from this gateway
  const outgoing = edges.filter((e) => e.source === nodeId);

  const getTargetLabel = (targetId: string) => {
    const node = nodes.find((n) => n.id === targetId);
    return (node?.data?.label as string) || targetId;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Outgoing Flows ({outgoing.length})
        </div>
        <AiAssistButton tooltip="AI: Generate conditions" />
      </div>

      {outgoing.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-[11px] text-gray-400">
          No outgoing connections yet. Connect this gateway to other elements.
        </div>
      )}

      {outgoing.map((edge, i) => {
        const isDefault = edge.id === defaultFlowId;
        const condition = (edge.data as Record<string, unknown>)?.condition as string || "";
        const flowLabel = (edge.data as Record<string, unknown>)?.label as string || edge.label as string || "";

        return (
          <div
            key={edge.id}
            className="rounded-lg border p-3 transition-all"
            style={{
              borderColor: isDefault ? "#86EFAC" : "#E5E7EB",
              background: isDefault ? "#F0FDF440" : "white",
            }}
          >
            {/* Flow header */}
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: isDefault ? "#16A34A" : "#9CA3AF" }}
                >
                  {i + 1}
                </div>
                <span className="text-[11px] font-medium text-gray-700">
                  → {getTargetLabel(edge.target)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onDefaultFlowChange(isDefault ? undefined : edge.id)}
                className="rounded-md px-2 py-0.5 text-[9px] font-semibold transition-all"
                style={{
                  background: isDefault ? "#DCFCE7" : "transparent",
                  color: isDefault ? "#16A34A" : "#9CA3AF",
                  border: `1px solid ${isDefault ? "#86EFAC" : "#E5E7EB"}`,
                }}
              >
                {isDefault ? "Default ✓" : "Set Default"}
              </button>
            </div>

            {/* Flow label */}
            <div className="mb-2">
              <input
                type="text"
                value={flowLabel}
                onChange={(e) => onEdgeLabelChange(edge.id, e.target.value)}
                className="w-full rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-700 outline-none transition-all focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
                placeholder="Flow label (shown on canvas)"
              />
            </div>

            {/* Condition (not shown for default flow) */}
            {!isDefault && (
              <FeelExpressionInput
                value={condition}
                onChange={(v) => onEdgeConditionChange(edge.id, v)}
                placeholder="= order.amount > 100"
                showAiAssist
              />
            )}
          </div>
        );
      })}

      {/* Validation hint */}
      {outgoing.length > 0 && !defaultFlowId && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] text-amber-700">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          No default flow set. If no condition matches at runtime, the process will fail.
        </div>
      )}
    </div>
  );
}
