/* ─── Form Fields Section ─────────────────────────────────────────────
 * Auxiliary data captured alongside an outcome on the runtime Complete
 * dialog — comments, attachments, approved amounts, etc. Distinct
 * from outcomes (which drive routing): form fields land in the
 * variable bag as named typed values.
 *
 * Optional `showWhen` lets a field appear only when a specific outcome
 * is chosen — e.g. "approved amount" shows only when outcome=approve.
 *
 * NOTE: inline styles (Tailwind doesn't reliably resolve inside
 * `.props-panel` — see UX-05 in QA bugs).
 * ──────────────────────────────────────────────────────────────────── */

import type { FormField, FormFieldType, Outcome } from "../../../../types/bpmn-node-data";

type Props = {
  fields: FormField[] | undefined;
  outcomes: Outcome[] | undefined;
  reservedNames?: string[];
  onChange: (next: FormField[]) => void;
};

const TYPES: Array<{ value: FormFieldType; label: string }> = [
  { value: "string",  label: "Text" },
  { value: "number",  label: "Number" },
  { value: "boolean", label: "Yes / No" },
  { value: "date",    label: "Date" },
  { value: "json",    label: "JSON object" },
];

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function newUid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function FormFieldsSection({ fields = [], outcomes = [], reservedNames = [], onChange }: Props) {
  const reserved = new Set(reservedNames);
  const update = (uid: string, patch: Partial<FormField>) => {
    onChange(fields.map((f) => (f.uid === uid ? { ...f, ...patch } : f)));
  };
  const remove = (uid: string) => {
    onChange(fields.filter((f) => f.uid !== uid));
  };
  const add = () => {
    onChange([...fields, { uid: newUid(), name: "", type: "string", required: false }]);
  };

  const nameCounts = fields.reduce<Record<string, number>>((acc, f) => {
    if (f.name.trim()) acc[f.name.trim()] = (acc[f.name.trim()] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={S.help}>
        Auxiliary data the operator captures alongside the outcome — comments,
        attachments, amounts. Each field lands as a named variable in the bag.
        Use <code style={S.code}>Show when</code> to surface a field only for certain outcomes.
      </div>

      {fields.length === 0 ? (
        <div style={S.emptyBox}>
          <div style={{ fontSize: 12, color: "#6B7280" }}>
            No form fields — operator just clicks an outcome button.
          </div>
          <button type="button" onClick={add} style={{ ...S.btnGhost, marginTop: 8 }}>
            + Add field
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {fields.map((f) => {
              const trimmed = f.name.trim();
              const isInvalid = trimmed.length > 0 && !NAME_RE.test(trimmed);
              const isDup = trimmed.length > 0 && nameCounts[trimmed] > 1;
              const isReserved = trimmed.length > 0 && reserved.has(trimmed);
              const isReservedOutcome = trimmed === "outcome";
              const warning = isInvalid
                ? "Use letters, digits and underscores only (no spaces)."
                : isDup
                  ? "Duplicate name on this task."
                  : isReservedOutcome
                    ? "`outcome` is reserved — used by the engine to record which button was clicked."
                    : isReserved
                      ? "Shadows a Business Document field — the document value will win at runtime merge."
                      : null;
              const warnColor = isReserved && !isReservedOutcome ? "#B45309" : "#B42318";
              return (
                <div key={f.uid} style={S.row}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="text"
                      value={f.name}
                      onChange={(e) => update(f.uid, { name: e.target.value })}
                      placeholder="variable name"
                      style={{
                        ...S.input,
                        flex: 1,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        borderColor: warning && !isReserved ? "#FCA5A5" : "#E5E7EB",
                      }}
                    />
                    <select
                      value={f.type}
                      onChange={(e) => update(f.uid, { type: e.target.value as FormFieldType })}
                      style={{ ...S.input, padding: "5px 8px", width: "auto" }}
                    >
                      {TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => remove(f.uid)}
                      title="Remove field"
                      aria-label="Remove field"
                      style={S.btnRemove}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#374151", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!f.required}
                        onChange={(e) => update(f.uid, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <input
                      type="text"
                      value={f.label ?? ""}
                      onChange={(e) => update(f.uid, { label: e.target.value })}
                      placeholder="display label"
                      style={{ ...S.input, flex: 1, fontSize: 11 }}
                    />
                  </div>
                  {outcomes.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#9CA3AF" }}>
                        Show when
                      </span>
                      <select
                        value={f.showWhen?.outcomeId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          update(f.uid, v ? { showWhen: { outcomeId: v } } : { showWhen: undefined });
                        }}
                        style={{ ...S.input, padding: "5px 8px", width: "auto", fontSize: 11 }}
                      >
                        <option value="">always</option>
                        {outcomes.map((o) => (
                          <option key={o.uid} value={o.id}>outcome = {o.id || "(unnamed)"}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <input
                    type="text"
                    value={f.description ?? ""}
                    onChange={(e) => update(f.uid, { description: e.target.value })}
                    placeholder="description (shown under the field)"
                    style={{ ...S.input, fontSize: 11, marginTop: 8 }}
                  />
                  {warning && (
                    <div style={{ marginTop: 6, fontSize: 10, color: warnColor }}>{warning}</div>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={add} style={S.btnGhost}>
            + Add field
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
