/* ─── Outcomes Section ────────────────────────────────────────────────
 * userTask "decision actions" — the discrete choices the operator
 * picks via buttons on the runtime Complete dialog. The chosen id
 * lands in the bag as `outcome` and drives downstream gateways.
 *
 * NOTE: inline styles, not Tailwind. Tailwind utilities don't
 * reliably resolve inside `.props-panel` in this codebase (see
 * project_qa_bugs_gaps.md UX-05). Earlier sections like
 * SchedulingSection migrated to inline for the same reason.
 * ──────────────────────────────────────────────────────────────────── */

import type { Outcome, OutcomeStyle } from "../../../../types/bpmn-node-data";

type Props = {
  outcomes: Outcome[] | undefined;
  onChange: (next: Outcome[]) => void;
};

const STYLES: Array<{ value: OutcomeStyle; label: string; preview: { bg: string; color: string; border: string } }> = [
  { value: "primary", label: "Primary", preview: { bg: "#6366F1", color: "#fff", border: "#6366F1" } },
  { value: "neutral", label: "Neutral", preview: { bg: "#fff", color: "#344054", border: "#D0D5DD" } },
  { value: "danger",  label: "Danger",  preview: { bg: "#D92D20", color: "#fff", border: "#D92D20" } },
];

const ID_RE = /^[a-z][a-z0-9_]*$/;

function newUid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `o-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function OutcomesSection({ outcomes = [], onChange }: Props) {
  const update = (uid: string, patch: Partial<Outcome>) => {
    onChange(outcomes.map((o) => (o.uid === uid ? { ...o, ...patch } : o)));
  };
  const remove = (uid: string) => {
    onChange(outcomes.filter((o) => o.uid !== uid));
  };
  const add = () => {
    const suggested = outcomes.length === 0
      ? { id: "approve", label: "Approve", style: "primary" as const }
      : outcomes.length === 1
        ? { id: "reject", label: "Reject", style: "danger" as const }
        : { id: "", label: "", style: "neutral" as const };
    onChange([...outcomes, { uid: newUid(), ...suggested }]);
  };
  const setDefault = (uid: string) => {
    onChange(outcomes.map((o) => ({ ...o, default: o.uid === uid })));
  };

  const idCounts = outcomes.reduce<Record<string, number>>((acc, o) => {
    if (o.id.trim()) acc[o.id.trim()] = (acc[o.id.trim()] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={S.help}>
        Decision actions for this task. Each renders as a button on the runtime
        Complete dialog. The chosen <code style={S.code}>id</code> lands in the variable bag
        as <code style={S.code}>outcome</code> — gateway conditions read it via
        <code style={S.code}>{`outcome == "approve"`}</code>.
      </div>

      {outcomes.length === 0 ? (
        <div style={S.emptyBox}>
          <div style={{ fontSize: 12, color: "#6B7280" }}>
            No outcomes declared — runtime will show a single <strong>Complete</strong> button.
          </div>
          <button type="button" onClick={add} style={{ ...S.btnGhost, marginTop: 8 }}>
            + Add outcome
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {outcomes.map((o) => {
              const trimmed = o.id.trim();
              const isInvalid = trimmed.length > 0 && !ID_RE.test(trimmed);
              const isDup = trimmed.length > 0 && idCounts[trimmed] > 1;
              const warning = isInvalid
                ? "Use lowercase letters, digits and underscores only — starts with a letter."
                : isDup
                  ? "Duplicate id — gateway routing would be ambiguous."
                  : null;
              const style = o.style ?? "neutral";
              const stylePreview = STYLES.find((s) => s.value === style)!.preview;
              return (
                <div key={o.uid} style={S.row}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Live preview of the rendered button */}
                    <span
                      style={{
                        padding: "5px 10px", borderRadius: 6,
                        fontSize: 11, fontWeight: 600,
                        background: stylePreview.bg, color: stylePreview.color,
                        border: `1px solid ${stylePreview.border}`,
                        whiteSpace: "nowrap", flexShrink: 0,
                      }}
                    >
                      {o.label || "Action"}
                    </span>
                    <input
                      type="text"
                      value={o.label}
                      onChange={(e) => update(o.uid, { label: e.target.value })}
                      placeholder="Label (e.g. Approve)"
                      style={{ ...S.input, flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => remove(o.uid)}
                      title="Remove outcome"
                      aria-label="Remove outcome"
                      style={S.btnRemove}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <input
                      type="text"
                      value={o.id}
                      onChange={(e) => update(o.uid, { id: e.target.value })}
                      placeholder="id (e.g. approve)"
                      style={{
                        ...S.input,
                        flex: 1,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: 11,
                        borderColor: warning ? "#FCA5A5" : "#E5E7EB",
                      }}
                    />
                    <select
                      value={style}
                      onChange={(e) => update(o.uid, { style: e.target.value as OutcomeStyle })}
                      style={{ ...S.input, padding: "5px 8px" }}
                    >
                      {STYLES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                    <label
                      title="Pressing Cmd/Ctrl+Enter on the runtime Complete dialog fires this outcome. Only one default per task."
                      style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#6B7280", cursor: "pointer" }}
                    >
                      <input
                        type="radio"
                        name="default-outcome"
                        checked={!!o.default}
                        onChange={() => setDefault(o.uid)}
                      />
                      Default
                    </label>
                  </div>
                  {warning && (
                    <div style={{ marginTop: 6, fontSize: 10, color: "#B42318" }}>{warning}</div>
                  )}
                </div>
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

const S = {
  help: {
    fontSize: 11, lineHeight: 1.5, color: "#6B7280",
  } as React.CSSProperties,
  code: {
    background: "#F2F4F7", padding: "1px 4px", borderRadius: 3,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10, marginRight: 2, marginLeft: 2,
  } as React.CSSProperties,
  emptyBox: {
    border: "1px dashed #E5E7EB", background: "#F9FAFB",
    borderRadius: 8, padding: "14px 12px", textAlign: "center" as const,
  } as React.CSSProperties,
  row: {
    border: "1px solid #E5E7EB", background: "#fff",
    borderRadius: 8, padding: 10,
  } as React.CSSProperties,
  input: {
    width: "100%", padding: "6px 8px", borderRadius: 6,
    border: "1px solid #E5E7EB", fontSize: 12, color: "#111827",
    outline: "none", fontFamily: "inherit", background: "#fff",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  btnRemove: {
    padding: "4px 8px", borderRadius: 6, border: "1px solid #E5E7EB",
    background: "#fff", color: "#6B7280", fontSize: 12,
    cursor: "pointer", fontFamily: "inherit",
  } as React.CSSProperties,
  btnGhost: {
    padding: "6px 12px", borderRadius: 6, border: "1px solid #E5E7EB",
    background: "#fff", color: "#374151", fontSize: 11, fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit",
    alignSelf: "flex-start" as const,
  } as React.CSSProperties,
};
