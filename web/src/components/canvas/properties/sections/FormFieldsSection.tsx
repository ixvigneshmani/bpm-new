/* ─── Form Fields Section ─────────────────────────────────────────────
 * Auxiliary data captured alongside an outcome on the runtime Complete
 * dialog — comments, attachments, approved amounts, etc. Distinct
 * from outcomes (which drive routing): form fields land in the
 * variable bag as named typed values.
 *
 * Optional `showWhen` lets a field appear only when a specific outcome
 * is chosen — e.g. "approved amount" shows only when outcome=approve.
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
    <div className="space-y-3">
      <div className="text-[11px] leading-relaxed text-gray-500">
        Auxiliary data the operator captures alongside the outcome — comments,
        attachments, amounts. Each field lands as a named variable in the bag.
        Use <code className="rounded bg-gray-100 px-1">Show when</code> to surface
        a field only for certain outcomes.
      </div>

      {fields.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center">
          <div className="text-[12px] text-gray-500">No form fields — operator just clicks an outcome button.</div>
          <button
            type="button"
            onClick={add}
            className="mt-2 rounded-md border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            + Add field
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
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
              return (
                <div
                  key={f.uid}
                  className="rounded-md border border-gray-200 bg-white p-2.5"
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="text"
                      value={f.name}
                      onChange={(e) => update(f.uid, { name: e.target.value })}
                      placeholder="variable name"
                      className={`flex-1 rounded-md border px-2 py-1 font-mono text-[12px] outline-none focus:ring-2 ${
                        warning && !isReserved
                          ? "border-red-300 focus:border-red-400 focus:ring-red-50"
                          : "border-gray-200 focus:border-brand-400 focus:ring-brand-50"
                      }`}
                    />
                    <select
                      value={f.type}
                      onChange={(e) => update(f.uid, { type: e.target.value as FormFieldType })}
                      className="rounded-md border border-gray-200 px-2 py-1 text-[12px] outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-50"
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
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-600">
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
                      className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-50"
                    />
                  </div>
                  {outcomes.length > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-gray-400">Show when</span>
                      <select
                        value={f.showWhen?.outcomeId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          update(f.uid, v ? { showWhen: { outcomeId: v } } : { showWhen: undefined });
                        }}
                        className="rounded-md border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-50"
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
                    className="mt-2 w-full rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-50"
                  />
                  {warning && (
                    <div
                      className={`mt-1.5 text-[10px] ${
                        isReserved && !isReservedOutcome ? "text-amber-700" : "text-red-600"
                      }`}
                    >
                      {warning}
                    </div>
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
            + Add field
          </button>
        </>
      )}
    </div>
  );
}
