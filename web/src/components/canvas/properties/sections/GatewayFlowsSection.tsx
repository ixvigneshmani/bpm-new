/* ─── Gateway Flows Section ───────────────────────────────────────────
 * Lists outgoing sequence flows from a gateway.
 * Behavior varies by gateway kind:
 *   - exclusive:  conditions + default flow (XOR — first matching wins)
 *   - inclusive:  conditions + default flow (OR — all matching taken)
 *   - parallel:   no conditions, no default (AND — all taken)
 *   - eventBased: no conditions, targets must be catch events (first event wins)
 * ──────────────────────────────────────────────────────────────────── */

import type { Edge, Node } from "@xyflow/react";
import FeelExpressionInput from "../fields/FeelExpressionInput";
import AiAssistButton from "../fields/AiAssistButton";
import { NODE_THEMES } from "../../../../types/bpmn-node-data";

export type GatewayKind = "exclusive" | "inclusive" | "parallel" | "eventBased";

type Props = {
  nodeId: string;
  kind: GatewayKind;
  edges: Edge[];
  nodes: { id: string; type?: Node["type"]; data: Record<string, unknown> }[];
  defaultFlowId?: string;
  onDefaultFlowChange: (flowId: string | undefined) => void;
  onEdgeConditionChange: (edgeId: string, condition: string) => void;
  onEdgeLabelChange: (edgeId: string, label: string) => void;
};

/** Types valid as targets of an event-based gateway. Today only `receiveTask`
 *  actually renders — the intermediate catch-event variants land in P4. Once
 *  those node types exist, this should be replaced by a `BPMN_CAPABILITIES`
 *  lookup keyed by bpmnType with a boolean `isCatchEvent` flag. */
const EVENT_BASED_VALID_TARGETS = new Set([
  "receiveTask",
  "intermediateCatchEvent",
  "intermediateEvent",
  "messageIntermediateCatchEvent",
  "timerIntermediateCatchEvent",
  "signalIntermediateCatchEvent",
  "conditionalIntermediateCatchEvent",
]);

/** Maps a gateway kind to the matching entry in `NODE_THEMES` so banner colors
 *  stay in lock-step with the on-canvas node colors. */
const KIND_THEME_KEY: Record<GatewayKind, string> = {
  exclusive: "exclusiveGateway",
  inclusive: "inclusiveGateway",
  parallel: "parallelGateway",
  eventBased: "eventBasedGateway",
};

const KIND_COPY: Record<GatewayKind, { label: string; help: string }> = {
  exclusive: {
    label: "Exclusive (XOR)",
    help: "First matching condition wins. If none match, the default flow is taken.",
  },
  inclusive: {
    label: "Inclusive (OR)",
    help: "Every matching condition is taken in parallel. Default flow triggers if none match.",
  },
  parallel: {
    label: "Parallel (AND)",
    help: "All outgoing paths are taken simultaneously. Conditions are ignored.",
  },
  eventBased: {
    label: "Event-based",
    help: "The first event to arrive wins; other branches are cancelled. Targets must be catch events.",
  },
};

export default function GatewayFlowsSection({
  nodeId,
  kind,
  edges,
  nodes,
  defaultFlowId,
  onDefaultFlowChange,
  onEdgeConditionChange,
  onEdgeLabelChange,
}: Props) {
  const outgoing = edges.filter((e) => e.source === nodeId);
  const copy = KIND_COPY[kind];
  const theme = NODE_THEMES[KIND_THEME_KEY[kind]];
  const banner = { label: copy.label, help: copy.help, color: theme.color, bg: theme.bgLight };
  const supportsConditions = kind === "exclusive" || kind === "inclusive";
  const supportsDefault = supportsConditions;

  const getTarget = (targetId: string) => nodes.find((n) => n.id === targetId);
  const getTargetLabel = (targetId: string) =>
    (getTarget(targetId)?.data?.label as string) || targetId;

  return (
    <div className="space-y-4">
      {/* Kind banner */}
      <div
        className="rounded-lg px-3 py-2 text-[11px]"
        style={{ background: banner.bg, color: banner.color, border: `1px solid ${banner.color}33` }}
      >
        <div className="font-semibold">{banner.label}</div>
        <div className="mt-0.5 opacity-80">{banner.help}</div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Outgoing Flows ({outgoing.length})
        </div>
        {supportsConditions && <AiAssistButton tooltip="AI: Generate conditions" />}
      </div>

      {outgoing.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-[11px] text-gray-400">
          No outgoing connections yet. Connect this gateway to other elements.
        </div>
      )}

      {outgoing.map((edge, i) => {
        const isDefault = supportsDefault && edge.id === defaultFlowId;
        const condition = ((edge.data as Record<string, unknown>)?.condition as string) || "";
        const flowLabel =
          ((edge.data as Record<string, unknown>)?.label as string) ||
          (edge.label as string) ||
          "";

        const targetNode = getTarget(edge.target);
        const invalidEventTarget =
          kind === "eventBased" &&
          targetNode?.type != null &&
          !EVENT_BASED_VALID_TARGETS.has(targetNode.type);

        return (
          <div
            key={edge.id}
            className="rounded-lg border p-3 transition-all"
            style={{
              borderColor: isDefault
                ? "#86EFAC"
                : invalidEventTarget
                ? "#FCA5A5"
                : "#E5E7EB",
              background: isDefault
                ? "#F0FDF440"
                : invalidEventTarget
                ? "#FEF2F240"
                : "white",
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
              {supportsDefault && (
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
              )}
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

            {/* Condition — only for exclusive/inclusive non-default flows.
                AI assist is surfaced at the section level (above) to avoid
                duplicating the entry point per-row. */}
            {supportsConditions && !isDefault && (
              <FeelExpressionInput
                value={condition}
                onChange={(v) => onEdgeConditionChange(edge.id, v)}
                placeholder="= order.amount > 100"
              />
            )}

            {/* Event-based target warning */}
            {invalidEventTarget && (
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-red-600">
                <span>⚠</span>
                <span>
                  Target must be an intermediate catch event or receive task (got{" "}
                  <code className="rounded bg-red-50 px-1">{targetNode?.type}</code>).
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* Validation hint: missing default on conditional gateway */}
      {supportsDefault && outgoing.length > 0 && !defaultFlowId && (
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
