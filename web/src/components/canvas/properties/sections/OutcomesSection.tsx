/* ─── Outcomes Section ────────────────────────────────────────────────
 * userTask "decision actions" — discrete choices the operator picks
 * via buttons on the runtime Complete dialog. The chosen id lands in
 * the bag as `outcome` and drives downstream gateways.
 *
 * Designed to read as a card list: each outcome is an editable card
 * with header (live preview + remove), labelled fields, and a footer
 * for meta flags. Inline styles — Tailwind doesn't reliably resolve
 * inside `.props-panel` (UX-05).
 * ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import type { Outcome, OutcomeStyle } from "../../../../types/bpmn-node-data";

type Props = {
  outcomes: Outcome[] | undefined;
  onChange: (next: Outcome[]) => void;
};

const STYLE_PREVIEW: Record<OutcomeStyle, { bg: string; color: string; border: string; chip: string }> = {
  primary: { bg: "#6366F1", color: "#fff",     border: "#6366F1", chip: "Primary" },
  neutral: { bg: "#fff",    color: "#344054",  border: "#D0D5DD", chip: "Neutral" },
  danger:  { bg: "#D92D20", color: "#fff",     border: "#D92D20", chip: "Danger"  },
};

const STYLES: OutcomeStyle[] = ["primary", "neutral", "danger"];
const ID_RE = /^[a-z][a-z0-9_]*$/;

function newUid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `o-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Generate a safe id from a label — title-cased "Send back" → "send_back". */
function suggestIdFromLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/g, "")
    .slice(0, 32);
}

export default function OutcomesSection({ outcomes = [], onChange }: Props) {
  const update = (uid: string, patch: Partial<Outcome>) => {
    onChange(outcomes.map((o) => (o.uid === uid ? { ...o, ...patch } : o)));
  };
  const remove = (uid: string) => {
    onChange(outcomes.filter((o) => o.uid !== uid));
  };
  const setDefault = (uid: string) => {
    onChange(outcomes.map((o) => ({ ...o, default: o.uid === uid })));
  };
  const add = () => {
    const suggestion = outcomes.length === 0
      ? { id: "approve", label: "Approve", style: "primary" as const, default: outcomes.length === 0 }
      : outcomes.length === 1
        ? { id: "reject", label: "Reject", style: "danger" as const }
        : { id: "", label: "", style: "neutral" as const };
    onChange([...outcomes, { uid: newUid(), ...suggestion }]);
  };

  const idCounts = outcomes.reduce<Record<string, number>>((acc, o) => {
    if (o.id.trim()) acc[o.id.trim()] = (acc[o.id.trim()] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={S.help}>
        Decision buttons rendered on the Complete dialog. The chosen <code style={S.code}>id</code>
        lands in the variable bag as <code style={S.code}>outcome</code> and drives downstream
        gateway routing.
      </div>

      {outcomes.length === 0 ? (
        <div style={S.emptyBox}>
          <div style={{ fontSize: 12, color: "#475467", lineHeight: 1.5 }}>
            No outcomes declared. Runtime will show a single <strong>Complete</strong> button —
            useful for acknowledgement-only tasks (e.g. "Sign document", "Notify employee").
          </div>
          <button type="button" onClick={add} style={{ ...S.btnGhost, marginTop: 10 }}>
            + Add outcome
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {outcomes.map((o, idx) => {
              const trimmed = o.id.trim();
              const isInvalid = trimmed.length > 0 && !ID_RE.test(trimmed);
              const isDup = trimmed.length > 0 && idCounts[trimmed] > 1;
              const idWarning = isInvalid
                ? "Use lowercase letters, digits and underscores only — must start with a letter."
                : isDup
                  ? "Duplicate id — gateway routing would be ambiguous."
                  : null;
              const style = o.style ?? "neutral";
              const preview = STYLE_PREVIEW[style];
              return (
                <OutcomeCard
                  key={o.uid}
                  outcome={o}
                  index={idx + 1}
                  preview={preview}
                  idWarning={idWarning}
                  onUpdate={(patch) => update(o.uid, patch)}
                  onRemove={() => remove(o.uid)}
                  onSetDefault={() => setDefault(o.uid)}
                />
              );
            })}
          </div>
          <button type="button" onClick={add} style={S.btnGhost}>
            + Add outcome
          </button>
        </>
      )}
    </div>
  );
}

function OutcomeCard(props: {
  outcome: Outcome;
  index: number;
  preview: { bg: string; color: string; border: string; chip: string };
  idWarning: string | null;
  onUpdate: (patch: Partial<Outcome>) => void;
  onRemove: () => void;
  onSetDefault: () => void;
}) {
  const { outcome, index, preview, idWarning, onUpdate, onRemove, onSetDefault } = props;
  const [hoverRemove, setHoverRemove] = useState(false);
  const [idDirty, setIdDirty] = useState(outcome.id.trim().length > 0);

  // Auto-suggest id from label until the user touches the id field
  const onLabelChange = (label: string) => {
    const patch: Partial<Outcome> = { label };
    if (!idDirty) patch.id = suggestIdFromLabel(label);
    onUpdate(patch);
  };
  const onIdChange = (id: string) => {
    setIdDirty(true);
    onUpdate({ id });
  };

  return (
    <div style={S.card}>
      {/* Header: index pill + live preview button + remove */}
      <div style={S.cardHeader}>
        <div style={S.indexPill}>{index}</div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span
            style={{
              padding: "5px 12px", borderRadius: 6,
              fontSize: 12, fontWeight: 600,
              background: preview.bg, color: preview.color,
              border: `1px solid ${preview.border}`,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              maxWidth: "100%",
            }}
            title="Live preview of the runtime button"
          >
            {outcome.label || "Action"}
          </span>
          {outcome.default && <span style={S.defaultBadge}>DEFAULT</span>}
        </div>
        <button
          type="button"
          onClick={onRemove}
          onMouseEnter={() => setHoverRemove(true)}
          onMouseLeave={() => setHoverRemove(false)}
          title="Remove outcome"
          aria-label="Remove outcome"
          style={{
            ...S.btnIcon,
            color: hoverRemove ? "#B42318" : "#98A2B3",
            borderColor: hoverRemove ? "#FCA5A5" : "#E5E7EB",
            background: hoverRemove ? "#FEF2F2" : "#fff",
          }}
        >
          ✕
        </button>
      </div>

      {/* Field stack — label, id, style + default */}
      <div style={S.fieldStack}>
        <Field label="Label">
          <input
            type="text"
            value={outcome.label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="e.g. Approve"
            style={S.input}
          />
        </Field>

        <Field label="ID" hint="Used in gateway conditions: outcome == &quot;...&quot;">
          <input
            type="text"
            value={outcome.id}
            onChange={(e) => onIdChange(e.target.value)}
            placeholder="e.g. approve"
            style={{
              ...S.input,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              borderColor: idWarning ? "#FCA5A5" : "#E5E7EB",
            }}
          />
          {idWarning && (
            <div style={{ marginTop: 4, fontSize: 10, color: "#B42318" }}>{idWarning}</div>
          )}
        </Field>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <Field label="Style" style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {STYLES.map((s) => {
                const active = (outcome.style ?? "neutral") === s;
                const p = STYLE_PREVIEW[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onUpdate({ style: s })}
                    style={{
                      flex: 1,
                      padding: "5px 8px",
                      borderRadius: 6,
                      border: `1.5px solid ${active ? p.border : "#E5E7EB"}`,
                      background: active ? (s === "neutral" ? "#F9FAFB" : p.bg) : "#fff",
                      color: active ? (s === "neutral" ? "#344054" : p.color) : "#667085",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {p.chip}
                  </button>
                );
              })}
            </div>
          </Field>
          <label
            title="⌘/Ctrl+Enter on the runtime Complete dialog fires this outcome. Only one default per task."
            style={{
              display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
              fontSize: 11, fontWeight: 500, color: outcome.default ? "#4F46E5" : "#475467",
              padding: "5px 10px", borderRadius: 6,
              border: `1px solid ${outcome.default ? "#C7D2FE" : "#E5E7EB"}`,
              background: outcome.default ? "#EEF2FF" : "#fff",
              whiteSpace: "nowrap",
            }}
          >
            <input
              type="radio"
              name="outcome-default"
              checked={!!outcome.default}
              onChange={onSetDefault}
              style={{ accentColor: "#4F46E5" }}
            />
            Default
          </label>
        </div>
      </div>
    </div>
  );
}

function Field(props: { label: string; hint?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...props.style }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={S.fieldLabel}>{props.label}</span>
        {props.hint && <span style={S.fieldHint}>{props.hint}</span>}
      </div>
      {props.children}
    </div>
  );
}

const S = {
  help: {
    fontSize: 11, lineHeight: 1.55, color: "#667085",
  } as React.CSSProperties,
  code: {
    background: "#F2F4F7", padding: "1px 4px", borderRadius: 3,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10, marginRight: 1, marginLeft: 1, color: "#344054",
  } as React.CSSProperties,
  emptyBox: {
    border: "1px dashed #E5E7EB", background: "#F9FAFB",
    borderRadius: 8, padding: "16px 14px", textAlign: "left" as const,
  } as React.CSSProperties,
  card: {
    border: "1px solid #E4E7EC",
    background: "#fff",
    borderRadius: 10,
    padding: 0,
    overflow: "hidden",
    boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
  } as React.CSSProperties,
  cardHeader: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 12px",
    borderBottom: "1px solid #F2F4F7",
    background: "#FCFCFD",
  } as React.CSSProperties,
  indexPill: {
    width: 22, height: 22, borderRadius: 11,
    background: "#EEF2FF", color: "#4F46E5",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 10, fontWeight: 700,
    flexShrink: 0,
  } as React.CSSProperties,
  defaultBadge: {
    fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
    padding: "2px 6px", borderRadius: 4,
    background: "#EEF2FF", color: "#4F46E5",
    flexShrink: 0,
  } as React.CSSProperties,
  fieldStack: {
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  } as React.CSSProperties,
  fieldLabel: {
    fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const,
    letterSpacing: "0.06em", color: "#667085",
  } as React.CSSProperties,
  fieldHint: {
    fontSize: 10, color: "#98A2B3", fontWeight: 400,
  } as React.CSSProperties,
  input: {
    width: "100%", padding: "7px 10px", borderRadius: 6,
    border: "1px solid #E5E7EB", fontSize: 12, color: "#101828",
    outline: "none", fontFamily: "inherit", background: "#fff",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  btnIcon: {
    width: 26, height: 26, borderRadius: 6,
    border: "1px solid #E5E7EB", background: "#fff",
    cursor: "pointer", fontSize: 12, fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
    transition: "background 120ms, border-color 120ms",
  } as React.CSSProperties,
  btnGhost: {
    padding: "8px 14px", borderRadius: 8,
    border: "1px dashed #D0D5DD", background: "#fff",
    color: "#475467", fontSize: 12, fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit",
    alignSelf: "flex-start" as const,
  } as React.CSSProperties,
};
