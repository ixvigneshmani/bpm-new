/* ─── Gateway Flows Section ───────────────────────────────────────────
 * Lists outgoing sequence flows from a gateway. Each card represents
 * ONE specific edge (gateway → target node) with its own condition
 * and default-flow toggle — conditions are scoped per-edge, never to
 * the gateway itself.
 *
 * Behaviour by kind:
 *   exclusive  — first matching condition wins; priority = list order
 *   inclusive  — every matching condition is taken in parallel
 *   parallel   — no conditions; all flows fire
 *   eventBased — first event to arrive wins; targets must be catch
 *                events / receive tasks
 *
 * Designer affordances:
 *   • Card-per-edge with target node name as the row header
 *   • Up/down arrows reorder priority (engine reads array order)
 *   • Auto-map outcomes button when the upstream is a userTask with
 *     declared outcomes — generates `outcome == "<id>"` per branch
 *   • FEEL autocomplete on conditions (variable-registry-driven)
 *   • Default-flow toggle; the chosen flow drops its condition input
 *   • Examples panel at the bottom for designers writing free-form
 *     conditions like `amount > 1000`
 *
 * Inline styles — Tailwind doesn't reliably resolve in `.props-panel`.
 * ──────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";
import FeelExpressionInput from "../fields/FeelExpressionInput";
import DesignOnlyBanner from "../banners/DesignOnlyBanner";
import { NODE_THEMES } from "../../../../types/bpmn-node-data";
import type { Outcome } from "../../../../types/bpmn-node-data";
import { EVENT_BASED_VALID_TARGETS } from "../../../../lib/bpmn/capabilities";

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
  onReorderOutgoing: (gatewayId: string, fromIdx: number, toIdx: number) => void;
};

const KIND_THEME_KEY: Record<GatewayKind, string> = {
  exclusive: "exclusiveGateway",
  inclusive: "inclusiveGateway",
  parallel: "parallelGateway",
  eventBased: "eventBasedGateway",
};

const KIND_COPY: Record<GatewayKind, { label: string; help: string }> = {
  exclusive: {
    label: "Exclusive (XOR)",
    help: "First matching condition wins. If none match, the Default flow runs.",
  },
  inclusive: {
    label: "Inclusive (OR)",
    help: "Every matching condition is taken in parallel. Default fires when none match.",
  },
  parallel: {
    label: "Parallel (AND)",
    help: "All outgoing paths fire simultaneously. Conditions are ignored.",
  },
  eventBased: {
    label: "Event-based",
    help: "The first event to arrive wins; other branches are cancelled.",
  },
};

export default function GatewayFlowsSection(props: Props) {
  const {
    nodeId, kind, edges, nodes,
    defaultFlowId,
    onDefaultFlowChange, onEdgeConditionChange, onEdgeLabelChange, onReorderOutgoing,
  } = props;

  const outgoing = edges.filter((e) => e.source === nodeId);
  const copy = KIND_COPY[kind];
  const theme = NODE_THEMES[KIND_THEME_KEY[kind]];
  const supportsConditions = kind === "exclusive" || kind === "inclusive";
  const supportsDefault = supportsConditions;
  const supportsReorder = kind === "exclusive"; // priority only matters for XOR

  const getTarget = (id: string) => nodes.find((n) => n.id === id);
  const getTargetLabel = (id: string) => (getTarget(id)?.data?.label as string) || id;

  // Detect upstream userTask with declared outcomes — drives the
  // "Auto-map outcomes" affordance. Walks one hop back from the
  // gateway; if the predecessor is a userTask with outcomes[], we
  // can suggest `outcome == "<id>"` conditions per outgoing flow.
  const upstreamOutcomes = useMemo(() => {
    const incomingToGw = edges.filter((e) => e.target === nodeId);
    for (const e of incomingToGw) {
      const src = getTarget(e.source);
      if (src?.type !== "userTask") continue;
      const outcomes = (src.data as { outcomes?: Outcome[] }).outcomes;
      if (Array.isArray(outcomes) && outcomes.length > 0) {
        return { taskLabel: (src.data?.label as string) || src.id, outcomes };
      }
    }
    return null;
  }, [edges, nodeId, nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const autoMapOutcomes = () => {
    if (!upstreamOutcomes) return;
    // Map outcome[i] → outgoing[i] in array order. If the user has
    // more outgoing edges than outcomes, only the first N get filled;
    // they can edit the rest manually or set one as Default.
    const pairs = Math.min(outgoing.length, upstreamOutcomes.outcomes.length);
    for (let i = 0; i < pairs; i++) {
      const edge = outgoing[i];
      const oc = upstreamOutcomes.outcomes[i];
      const id = oc.id || oc.label;
      onEdgeConditionChange(edge.id, `outcome == "${id}"`);
    }
  };

  // P0: engine today only branches on `exclusiveGateway`. Parallel,
  // inclusive, and event-based gateways silently take the first outgoing
  // edge — parity ships in P1 (parallel/inclusive) and P3+P6 (eventBased).
  const runtimeNote =
    kind === "parallel"
      ? "Engine today takes only the first outgoing edge. Parallel split/join executes in P1 of the engine sprint."
      : kind === "inclusive"
      ? "Engine today takes only the first outgoing edge. Inclusive split/join executes in P1 of the engine sprint."
      : kind === "eventBased"
      ? "Engine today doesn't race events on this gateway — the first outgoing edge wins. Event-based dispatch ships in P3."
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {runtimeNote && (
        <DesignOnlyBanner milestone="E8">{runtimeNote}</DesignOnlyBanner>
      )}
      {/* Kind banner */}
      <div
        style={{
          padding: "8px 10px", borderRadius: 8,
          background: theme.bgLight, color: theme.color,
          border: `1px solid ${theme.color}33`,
          fontSize: 11, lineHeight: 1.5,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{copy.label}</div>
        <div style={{ opacity: 0.85 }}>{copy.help}</div>
      </div>

      {/* Auto-map suggestion */}
      {supportsConditions && upstreamOutcomes && (
        <div style={{
          padding: "10px 12px", borderRadius: 8,
          background: "#EEF2FF", border: "1px solid #C7D2FE",
          fontSize: 11, lineHeight: 1.5, color: "#3730A3",
        }}>
          <div style={{ marginBottom: 8 }}>
            Upstream task <strong>{upstreamOutcomes.taskLabel}</strong> declares{" "}
            <strong>{upstreamOutcomes.outcomes.length} outcomes</strong>. Auto-fill conditions to map them onto these flows in order.
          </div>
          <button
            type="button"
            onClick={autoMapOutcomes}
            style={{
              padding: "5px 12px", borderRadius: 6,
              border: "1px solid #4F46E5", background: "#4F46E5", color: "#fff",
              fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ⚡ Auto-map outcomes
          </button>
        </div>
      )}

      {/* Section header */}
      <div style={{
        fontSize: 10, fontWeight: 600, textTransform: "uppercase",
        letterSpacing: "0.06em", color: "#9CA3AF",
      }}>
        Outgoing flows ({outgoing.length})
      </div>

      {outgoing.length === 0 && (
        <div style={{
          padding: "14px 12px", borderRadius: 8,
          border: "1px dashed #E5E7EB", background: "#F9FAFB",
          fontSize: 11, color: "#9CA3AF", textAlign: "center",
        }}>
          No outgoing connections. Connect this gateway to other elements on the canvas.
        </div>
      )}

      {/* Flow cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
            <FlowCard
              key={edge.id}
              index={i + 1}
              total={outgoing.length}
              targetLabel={getTargetLabel(edge.target)}
              isDefault={isDefault}
              invalidEventTarget={invalidEventTarget}
              invalidEventTargetType={targetNode?.type}
              flowLabel={flowLabel}
              condition={condition}
              supportsConditions={supportsConditions}
              supportsDefault={supportsDefault}
              supportsReorder={supportsReorder}
              onLabelChange={(v) => onEdgeLabelChange(edge.id, v)}
              onConditionChange={(v) => onEdgeConditionChange(edge.id, v)}
              onSetDefault={() => onDefaultFlowChange(isDefault ? undefined : edge.id)}
              onMoveUp={i > 0 ? () => onReorderOutgoing(nodeId, i, i - 1) : undefined}
              onMoveDown={i < outgoing.length - 1 ? () => onReorderOutgoing(nodeId, i, i + 1) : undefined}
            />
          );
        })}
      </div>

      {/* Validation hint: missing default on conditional gateway */}
      {supportsDefault && outgoing.length > 0 && !defaultFlowId && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 10px", borderRadius: 8,
          background: "#FFFBEB", border: "1px solid #FDE68A",
          fontSize: 10, color: "#92400E",
        }}>
          <span style={{ flexShrink: 0 }}>⚠</span>
          <span>No default flow set. If no condition matches at runtime, the instance fails.</span>
        </div>
      )}

      {/* Examples panel */}
      {supportsConditions && outgoing.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{
            cursor: "pointer", fontSize: 10, fontWeight: 600,
            color: "#6B7280", listStyle: "none",
            padding: "4px 0",
          }}>
            ▸ Condition examples
          </summary>
          <div style={{
            marginTop: 6,
            padding: "8px 10px", borderRadius: 6,
            background: "#F9FAFB", border: "1px solid #E5E7EB",
            fontSize: 11, lineHeight: 1.6,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            color: "#374151",
          }}>
            outcome == "approve"<br />
            amount {">"} 1000<br />
            daysRequested {">"} 5 && approved<br />
            employee.department == "Engineering"<br />
            priority == "high" || urgent
          </div>
        </details>
      )}
    </div>
  );
}

function FlowCard(props: {
  index: number;
  total: number;
  targetLabel: string;
  isDefault: boolean;
  invalidEventTarget: boolean;
  invalidEventTargetType?: string;
  flowLabel: string;
  condition: string;
  supportsConditions: boolean;
  supportsDefault: boolean;
  supportsReorder: boolean;
  onLabelChange: (v: string) => void;
  onConditionChange: (v: string) => void;
  onSetDefault: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const {
    index, targetLabel, isDefault, invalidEventTarget, invalidEventTargetType,
    flowLabel, condition,
    supportsConditions, supportsDefault, supportsReorder,
    onLabelChange, onConditionChange, onSetDefault, onMoveUp, onMoveDown,
  } = props;

  const borderColor = isDefault ? "#86EFAC" : invalidEventTarget ? "#FCA5A5" : "#E4E7EC";
  const headerBg = isDefault ? "#F0FDF4" : invalidEventTarget ? "#FEF2F2" : "#FCFCFD";

  return (
    <div style={{
      borderRadius: 10, border: `1px solid ${borderColor}`,
      background: "#fff", overflow: "hidden",
      boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
    }}>
      {/* Header: index pill + arrow + target node name + reorder + default toggle */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "9px 12px",
        borderBottom: "1px solid #F2F4F7",
        background: headerBg,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: 11,
          background: isDefault ? "#16A34A" : "#9CA3AF",
          color: "#fff", fontSize: 10, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          {index}
        </div>
        <span style={{ fontSize: 14, color: "#475467", flexShrink: 0 }}>→</span>
        <span style={{
          flex: 1, minWidth: 0,
          fontSize: 13, fontWeight: 600, color: "#101828",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {targetLabel}
        </span>
        {isDefault && (
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
            padding: "2px 6px", borderRadius: 4,
            background: "#DCFCE7", color: "#16A34A",
            flexShrink: 0,
          }}>
            DEFAULT
          </span>
        )}
        {supportsReorder && (
          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!onMoveUp}
              title="Move up (higher priority)"
              aria-label="Move up"
              style={{ ...iconBtn, opacity: onMoveUp ? 1 : 0.3, cursor: onMoveUp ? "pointer" : "not-allowed" }}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!onMoveDown}
              title="Move down (lower priority)"
              aria-label="Move down"
              style={{ ...iconBtn, opacity: onMoveDown ? 1 : 0.3, cursor: onMoveDown ? "pointer" : "not-allowed" }}
            >
              ↓
            </button>
          </div>
        )}
      </div>

      {/* Body: condition + label */}
      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 10 }}>
        {supportsConditions && !isDefault && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              if
            </div>
            <FeelExpressionInput
              value={condition}
              onChange={onConditionChange}
              placeholder='outcome == "approve"  or  amount > 1000'
            />
          </div>
        )}

        {supportsConditions && isDefault && (
          <div style={{
            padding: "6px 10px", borderRadius: 6,
            background: "#F0FDF4", border: "1px solid #BBF7D0",
            fontSize: 11, color: "#166534",
          }}>
            Runs when no other condition matches.
          </div>
        )}

        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            Flow label <span style={{ fontWeight: 400 }}>(shown on canvas)</span>
          </div>
          <input
            type="text"
            value={flowLabel}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="optional"
            style={{
              width: 280, maxWidth: "100%",
              padding: "6px 10px", borderRadius: 6,
              border: "1px solid #E5E7EB", fontSize: 12, color: "#101828",
              outline: "none", fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
        </div>

        {supportsDefault && (
          <label style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            cursor: "pointer", fontSize: 11, fontWeight: 500,
            color: isDefault ? "#16A34A" : "#475467",
            padding: "5px 10px", borderRadius: 6,
            border: `1px solid ${isDefault ? "#86EFAC" : "#E5E7EB"}`,
            background: isDefault ? "#F0FDF4" : "#fff",
            alignSelf: "flex-start",
          }}>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={onSetDefault}
              style={{ accentColor: "#16A34A" }}
            />
            Make default flow
          </label>
        )}

        {invalidEventTarget && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 10, color: "#B42318",
            padding: "6px 10px", borderRadius: 6,
            background: "#FEF2F2", border: "1px solid #FCA5A5",
          }}>
            <span>⚠</span>
            <span>
              Event-based gateway target must be an intermediate catch event or receive task (got{" "}
              <code style={{ background: "#FECACA", padding: "1px 4px", borderRadius: 3 }}>{invalidEventTargetType}</code>).
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 5,
  border: "1px solid #E5E7EB", background: "#fff",
  fontSize: 11, color: "#475467",
  fontFamily: "inherit",
  display: "flex", alignItems: "center", justifyContent: "center",
};
