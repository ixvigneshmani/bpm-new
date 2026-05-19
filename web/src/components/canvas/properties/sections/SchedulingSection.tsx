/* ─── Scheduling Section ──────────────────────────────────────────────
 * User Task scheduling: due date, follow-up date, priority, SLA.
 *
 * Refactored for the wide palette (Sweep C cleanup, Session 1):
 *   • All Tailwind classes converted to inline styles (Tailwind preflight
 *     is disabled inside `.props-panel`, so half the utilities silently
 *     no-op'd — duration inputs in particular were rendering as bare,
 *     border-less text fields).
 *   • Due Date + Priority share a single 2-column row. Wide palette
 *     earns horizontal density.
 *   • Duration inputs (`PT1H`) cap at ~180 px and surface a parsed
 *     "⏱ 1 hour" chip to the right instead of a 600 px-wide mono field.
 *   • The "Configure / Hide" link became a checkbox at the top of the
 *     SLA group — single click, no hidden-mode anti-pattern.
 *   • SLA still ships as design-only at runtime; banner now sits at the
 *     top of the sub-region rather than as a tiny inline pill.
 * ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import type { SchedulingConfig, SlaConfig } from "../../../../types/bpmn-node-data";
import FeelExpressionInput from "../fields/FeelExpressionInput";
import {
  configBox,
  formatIsoDuration,
  hintStyle,
  inlineChip,
  inputStyle,
  labelStyle,
  numericInput,
  sectionStack,
  subLabelStyle,
  tokenInput,
  twoColumnGrid,
} from "../styles";

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
  const [useDueDateExpr, setUseDueDateExpr] = useState(
    scheduling.dueDateIsExpression || false,
  );
  const slaEnabled = !!sla?.reactionTime || !!sla?.completionDeadline;

  const reactionPreview = formatIsoDuration(sla?.reactionTime);
  const completionPreview = formatIsoDuration(sla?.completionDeadline);

  return (
    <div style={sectionStack}>
      {/* Row 1 — Due Date + Priority side-by-side */}
      <div style={twoColumnGrid}>
        {/* Due Date */}
        <div>
          <div
            style={{
              ...labelStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>Due Date</span>
            <button
              type="button"
              onClick={() => {
                setUseDueDateExpr(!useDueDateExpr);
                onSchedulingChange({
                  ...scheduling,
                  dueDateIsExpression: !useDueDateExpr,
                });
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "#6366f1",
                fontSize: 10,
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
                fontFamily: "inherit",
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              {useDueDateExpr ? "Use date picker" : "Use expression"}
            </button>
          </div>
          {useDueDateExpr ? (
            <FeelExpressionInput
              value={scheduling.dueDate || ""}
              onChange={(v) => onSchedulingChange({ ...scheduling, dueDate: v })}
              placeholder='= now() + duration("P3D")'
              showAiAssist={false}
            />
          ) : (
            <input
              type="datetime-local"
              value={scheduling.dueDate || ""}
              onChange={(e) =>
                onSchedulingChange({ ...scheduling, dueDate: e.target.value })
              }
              style={inputStyle}
            />
          )}
        </div>

        {/* Priority — vertical button stack for the four levels */}
        <div>
          <div style={labelStyle}>Priority</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {PRIORITIES.map((p) => {
              const active = scheduling.priority === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() =>
                    onSchedulingChange({ ...scheduling, priority: p.value })
                  }
                  style={{
                    padding: "8px 6px",
                    borderRadius: 8,
                    border: `1.5px solid ${active ? p.color : "#e5e7eb"}`,
                    background: active ? `${p.color}10` : "#fff",
                    color: active ? p.color : "#98a2b3",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Follow-up date — full-width row (when present) */}
      {scheduling.followUpDate !== undefined && (
        <div>
          <div style={labelStyle}>Follow-up Date</div>
          <input
            type="datetime-local"
            value={scheduling.followUpDate || ""}
            onChange={(e) =>
              onSchedulingChange({ ...scheduling, followUpDate: e.target.value })
            }
            style={inputStyle}
          />
        </div>
      )}

      {/* SLA — checkbox-gated config-box. */}
      <div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            color: "#344054",
            marginBottom: slaEnabled ? 10 : 0,
          }}
        >
          <input
            type="checkbox"
            checked={slaEnabled}
            onChange={(e) => {
              if (e.target.checked) {
                onSlaChange({
                  ...sla,
                  reactionTime: sla?.reactionTime ?? "",
                  completionDeadline: sla?.completionDeadline ?? "",
                  breachAction: sla?.breachAction ?? "notify",
                });
              } else {
                onSlaChange({});
              }
            }}
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
          <span>Set an SLA on this task</span>
          <span
            style={{
              marginLeft: "auto",
              padding: "2px 8px",
              borderRadius: 999,
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            DESIGN-ONLY · E8
          </span>
        </label>

        {slaEnabled && (
          <div style={configBox}>
            <div style={{ ...hintStyle, marginTop: 0, color: "#667085" }}>
              SLA fields persist with the canvas; the engine's enforcement
              behaviour ships with milestone E8 (event semantics).
            </div>

            <div style={twoColumnGrid}>
              <div>
                <div style={subLabelStyle} title="Max time until someone claims this task.">
                  Reaction time
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="text"
                    value={sla?.reactionTime || ""}
                    onChange={(e) =>
                      onSlaChange({ ...sla, reactionTime: e.target.value })
                    }
                    style={tokenInput}
                    placeholder="PT1H"
                  />
                  {reactionPreview && (
                    <span style={inlineChip}>⏱ {reactionPreview}</span>
                  )}
                </div>
                <div style={hintStyle}>ISO-8601 duration (e.g. PT1H, P3D).</div>
              </div>

              <div>
                <div style={subLabelStyle} title="Max time until the task is completed.">
                  Completion deadline
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="text"
                    value={sla?.completionDeadline || ""}
                    onChange={(e) =>
                      onSlaChange({ ...sla, completionDeadline: e.target.value })
                    }
                    style={tokenInput}
                    placeholder="P3D"
                  />
                  {completionPreview && (
                    <span style={inlineChip}>⏱ {completionPreview}</span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div style={subLabelStyle}>On breach</div>
              <select
                value={sla?.breachAction || "notify"}
                onChange={(e) =>
                  onSlaChange({
                    ...sla,
                    breachAction: e.target.value as SlaConfig["breachAction"],
                  })
                }
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                <option value="notify">Notify</option>
                <option value="escalate">Escalate</option>
                <option value="subprocess">Trigger subprocess</option>
                <option value="hook">Custom hook</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Silence unused-import noise from styles refactor.
void numericInput;
