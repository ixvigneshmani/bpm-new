/* ─── Outcomes Section ────────────────────────────────────────────────
 * userTask "decision actions" — discrete choices the operator picks
 * via buttons on the runtime Complete dialog. The chosen `id` lands
 * in the bag as `outcome` and drives downstream gateways.
 *
 * Designed deliberately minimal: the BPM is not the UI. The designer
 * declares LABELS only — the host application owns styling, button
 * order, default-action, etc. We auto-derive a stable `id` from the
 * label (used by gateway conditions) and surface it inline so the
 * designer can copy it into `outcome == "..."` expressions.
 *
 * What was removed (intentionally):
 *   • Style picker (primary/danger/neutral) — host app's job
 *   • Default flag — host app's job; runtime falls back to "first"
 *   • Description — over-engineered for a label list
 *
 * Inline styles (Tailwind doesn't reliably resolve in `.props-panel`).
 * ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import type { Outcome } from "../../../../types/bpmn-node-data";

type Props = {
  outcomes: Outcome[] | undefined;
  onChange: (next: Outcome[]) => void;
};

const ID_RE = /^[a-z][a-z0-9_]*$/;

function newUid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `o-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Slugify a label into a stable id ("Send back" → "send_back"). */
function slug(label: string): string {
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
  const add = (label = "") => {
    onChange([...outcomes, { uid: newUid(), id: slug(label), label }]);
  };

  // Track whether two outcomes resolve to the same id — that would
  // make gateway routing ambiguous.
  const idCounts = outcomes.reduce<Record<string, number>>((acc, o) => {
    const id = o.id?.trim() || slug(o.label);
    if (id) acc[id] = (acc[id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={S.help}>
        Action labels operators can pick on this task. Each lands in the bag as
        <code style={S.code}>outcome</code> and drives gateway routing via
        <code style={S.code}>{`outcome == "..."`}</code>.
      </div>

      {outcomes.length === 0 ? (
        <div style={S.emptyBox}>
          <div style={{ fontSize: 12, color: "#475467", lineHeight: 1.5 }}>
            No outcomes — runtime shows a single <strong>Complete</strong> button.
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" onClick={() => { add("Approve"); add("Reject"); }} style={S.btnSuggest}>
              Approve / Reject
            </button>
            <button type="button" onClick={() => add("")} style={S.btnGhost}>
              + Add outcome
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {outcomes.map((o, idx) => {
              const computedId = (o.id?.trim() || slug(o.label)) || "";
              const isInvalid = computedId.length > 0 && !ID_RE.test(computedId);
              const isDup = computedId.length > 0 && idCounts[computedId] > 1;
              const warning = isInvalid
                ? "Label couldn't produce a valid id — start with a letter."
                : isDup
                  ? "Duplicate id — gateway routing would be ambiguous."
                  : null;
              return (
                <OutcomeRow
                  key={o.uid}
                  index={idx + 1}
                  outcome={o}
                  computedId={computedId}
                  warning={warning}
                  onChange={(label) => update(o.uid, { label, id: slug(label) })}
                  onRemove={() => remove(o.uid)}
                />
              );
            })}
          </div>
          <button type="button" onClick={() => add("")} style={S.btnGhost}>
            + Add outcome
          </button>
        </>
      )}
    </div>
  );
}

function OutcomeRow(props: {
  index: number;
  outcome: Outcome;
  computedId: string;
  warning: string | null;
  onChange: (label: string) => void;
  onRemove: () => void;
}) {
  const { index, outcome, computedId, warning, onChange, onRemove } = props;
  const [hoverRemove, setHoverRemove] = useState(false);

  return (
    <div style={S.row}>
      <div style={S.indexPill}>{index}</div>
      <input
        type="text"
        value={outcome.label}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Approve"
        autoFocus={!outcome.label}
        style={{
          ...S.input,
          borderColor: warning ? "#FCA5A5" : "#E5E7EB",
        }}
        title={warning ?? undefined}
      />
      <span
        style={{
          ...S.idChip,
          background: warning ? "#FEF2F2" : "#F2F4F7",
          color: warning ? "#B42318" : "#475467",
          borderColor: warning ? "#FCA5A5" : "transparent",
          visibility: computedId ? "visible" : "hidden",
        }}
        title={warning ?? `Gateway condition: outcome == "${computedId}"`}
      >
        {warning ? "!" : "id:"}&nbsp;{computedId || "—"}
      </span>
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
  );
}

const S = {
  help: {
    fontSize: 11, lineHeight: 1.55, color: "#667085",
  } as React.CSSProperties,
  code: {
    background: "#F2F4F7", padding: "1px 4px", borderRadius: 3,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10, marginRight: 1, marginLeft: 2, color: "#344054",
  } as React.CSSProperties,
  emptyBox: {
    border: "1px dashed #E5E7EB", background: "#F9FAFB",
    borderRadius: 8, padding: "14px 14px",
  } as React.CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: "22px 1fr 160px 26px",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    background: "#fff",
    border: "1px solid #E4E7EC",
    borderRadius: 8,
  } as React.CSSProperties,
  indexPill: {
    width: 22, height: 22, borderRadius: 11,
    background: "#F2F4F7", color: "#667085",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 10, fontWeight: 700,
    flexShrink: 0,
  } as React.CSSProperties,
  input: {
    flex: 1, minWidth: 0,
    padding: "7px 10px", borderRadius: 6,
    border: "1px solid #E5E7EB", fontSize: 12, color: "#101828",
    outline: "none", fontFamily: "inherit", background: "#fff",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  idChip: {
    display: "inline-flex", alignItems: "center", justifyContent: "flex-start",
    padding: "3px 10px", borderRadius: 999,
    border: "1px solid transparent",
    fontSize: 10, fontWeight: 600,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    whiteSpace: "nowrap" as const,
    overflow: "hidden", textOverflow: "ellipsis",
    width: "100%", boxSizing: "border-box",
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
  btnSuggest: {
    padding: "6px 12px", borderRadius: 8,
    border: "1px solid #C7D2FE", background: "#EEF2FF",
    color: "#4F46E5", fontSize: 11, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  } as React.CSSProperties,
};
