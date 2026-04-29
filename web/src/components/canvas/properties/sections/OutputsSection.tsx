/* ─── Outputs Section ─────────────────────────────────────────────────
 * Designer surface for declaring "this step adds these typed variables
 * to the business document at runtime." Pairs with TaskOutputDecl on
 * UserTaskData / ServiceTaskData. Distinct from outputMappings — that's
 * a FEEL→variable map for developers; this is a flat declarative list
 * for designers. The runtime form (BusinessDocForm) merges these with
 * processMeta.businessDoc to build the effective schema.
 * ──────────────────────────────────────────────────────────────────── */

import type { TaskOutputDecl } from "../../../../types/bpmn-node-data";

type Props = {
  outputs: TaskOutputDecl[] | undefined;
  onChange: (next: TaskOutputDecl[]) => void;
  /** Names already used by the process businessDoc. Surfaced as
   *  inline warnings when the designer declares a colliding name —
   *  businessDoc wins at merge time. */
  reservedNames?: string[];
};

const TYPES: Array<{ value: TaskOutputDecl["type"]; label: string }> = [
  { value: "string",  label: "Text" },
  { value: "number",  label: "Number" },
  { value: "boolean", label: "Yes / No" },
  { value: "date",    label: "Date" },
  { value: "json",    label: "JSON object" },
];

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `o-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function OutputsSection({ outputs = [], onChange, reservedNames = [] }: Props) {
  const reserved = new Set(reservedNames);

  const update = (id: string, patch: Partial<TaskOutputDecl>) => {
    onChange(outputs.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  const remove = (id: string) => {
    onChange(outputs.filter((o) => o.id !== id));
  };

  const add = () => {
    onChange([
      ...outputs,
      { id: newId(), name: "", type: "string", required: false },
    ]);
  };

  // Track in-list duplicates so we can warn the designer. Two outputs
  // sharing a name on the same task is a configuration error — the
  // engine will silently overwrite at merge time.
  const nameCounts = outputs.reduce<Record<string, number>>((acc, o) => {
    if (o.name.trim()) acc[o.name.trim()] = (acc[o.name.trim()] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="text-[11px] leading-relaxed text-gray-500">
        Variables this step adds to the business document at runtime. The runtime
        form (Complete / Edit / Replay) shows these as typed inputs alongside the
        process-level fields.
      </div>

      {outputs.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center">
          <div className="text-[12px] text-gray-500">No outputs declared yet.</div>
          <button
            type="button"
            onClick={add}
            className="mt-2 rounded-md border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            + Add output
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {outputs.map((o) => {
              const trimmed = o.name.trim();
              const isInvalid = trimmed.length > 0 && !NAME_RE.test(trimmed);
              const isDup = trimmed.length > 0 && nameCounts[trimmed] > 1;
              const isReserved = trimmed.length > 0 && reserved.has(trimmed);
              const warning = isInvalid
                ? "Use letters, digits and underscores only (no spaces, no FEEL)."
                : isDup
                  ? "Duplicate name on this task."
                  : isReserved
                    ? "Shadows a Business Document field — the document value will win at runtime."
                    : null;
              return (
                <div
                  key={o.id}
                  className="rounded-md border border-gray-200 bg-white p-2.5"
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="text"
                      value={o.name}
                      onChange={(e) => update(o.id, { name: e.target.value })}
                      placeholder="variable name"
                      className={`flex-1 rounded-md border px-2 py-1 font-mono text-[12px] outline-none focus:ring-2 ${
                        warning && !isReserved
                          ? "border-red-300 focus:border-red-400 focus:ring-red-50"
                          : "border-gray-200 focus:border-brand-400 focus:ring-brand-50"
                      }`}
                    />
                    <select
                      value={o.type}
                      onChange={(e) => update(o.id, { type: e.target.value as TaskOutputDecl["type"] })}
                      className="rounded-md border border-gray-200 px-2 py-1 text-[12px] outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-50"
                    >
                      {TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => remove(o.id)}
                      title="Remove output"
                      aria-label="Remove output"
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-600">
                      <input
                        type="checkbox"
                        checked={!!o.required}
                        onChange={(e) => update(o.id, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <input
                      type="text"
                      value={o.description ?? ""}
                      onChange={(e) => update(o.id, { description: e.target.value })}
                      placeholder="description (shown under the field)"
                      className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-50"
                    />
                  </div>
                  {warning && (
                    <div
                      className={`mt-1.5 text-[10px] ${
                        isReserved ? "text-amber-700" : "text-red-600"
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
            + Add output
          </button>
        </>
      )}
    </div>
  );
}
