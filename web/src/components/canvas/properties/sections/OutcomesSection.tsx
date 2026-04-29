/* ─── Outcomes Section ────────────────────────────────────────────────
 * userTask "decision actions" — the discrete choices the operator
 * picks via buttons on the runtime Complete dialog. The chosen id
 * lands in the bag as `outcome` and drives downstream gateways.
 *
 * This is the proper BPM-product pattern (Camunda / Pega / Bizagi /
 * SAP Workflow) — decisions are explicit named actions, not boolean
 * form fields. A 3-way branch is 3 buttons, not a tri-state dropdown.
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
    // Suggest a label/id to make the empty state useful.
    const suggested = outcomes.length === 0
      ? { id: "approve", label: "Approve", style: "primary" as const }
      : outcomes.length === 1
        ? { id: "reject", label: "Reject", style: "danger" as const }
        : { id: "", label: "", style: "neutral" as const };
    onChange([...outcomes, { uid: newUid(), ...suggested }]);
  };
  const setDefault = (uid: string) => {
    // Only one outcome at a time can carry the default flag.
    onChange(outcomes.map((o) => ({ ...o, default: o.uid === uid })));
  };

  // Track id duplicates so the designer can't ship two outcomes with
  // the same id (gateway routing would be ambiguous).
  const idCounts = outcomes.reduce<Record<string, number>>((acc, o) => {
    if (o.id.trim()) acc[o.id.trim()] = (acc[o.id.trim()] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="text-[11px] leading-relaxed text-gray-500">
        Decision actions for this task. Each renders as a button on the runtime
        Complete dialog. The chosen <code className="rounded bg-gray-100 px-1">id</code> lands
        in the variable bag as <code className="rounded bg-gray-100 px-1">outcome</code> —
        gateway conditions read it via <code className="rounded bg-gray-100 px-1">{"${outcome == \"approve\"}"}</code>.
      </div>

      {outcomes.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center">
          <div className="text-[12px] text-gray-500">
            No outcomes declared — runtime will show a single <strong>Complete</strong> button.
          </div>
          <button
            type="button"
            onClick={add}
            className="mt-2 rounded-md border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            + Add outcome
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
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
                <div
                  key={o.uid}
                  className="rounded-md border border-gray-200 bg-white p-2.5"
                >
                  <div className="flex items-start gap-2">
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
                      className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-[12px] outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-50"
                    />
                    <button
                      type="button"
                      onClick={() => remove(o.uid)}
                      title="Remove outcome"
                      aria-label="Remove outcome"
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={o.id}
                      onChange={(e) => update(o.uid, { id: e.target.value })}
                      placeholder="id (e.g. approve)"
                      className={`flex-1 rounded-md border px-2 py-1 font-mono text-[11px] outline-none focus:ring-2 ${
                        warning
                          ? "border-red-300 focus:border-red-400 focus:ring-red-50"
                          : "border-gray-200 focus:border-brand-400 focus:ring-brand-50"
                      }`}
                    />
                    <select
                      value={style}
                      onChange={(e) => update(o.uid, { style: e.target.value as OutcomeStyle })}
                      className="rounded-md border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-50"
                    >
                      {STYLES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                    <label
                      title="Pressing Enter on the runtime Complete dialog fires this outcome. Only one default per task."
                      className="flex cursor-pointer items-center gap-1.5 text-[10px] text-gray-600"
                    >
                      <input
                        type="radio"
                        name={`default-outcome`}
                        checked={!!o.default}
                        onChange={() => setDefault(o.uid)}
                      />
                      Default
                    </label>
                  </div>
                  {warning && (
                    <div className="mt-1.5 text-[10px] text-red-600">{warning}</div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={add}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            + Add outcome
          </button>
        </>
      )}
    </div>
  );
}
