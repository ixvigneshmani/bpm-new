/* ─── BusinessDocForm ─────────────────────────────────────────────────
 * Schema-driven typed form for the Business Document. Used by:
 *   • Start instance         (before token enters the engine)
 *   • Edit variables drawer  (admin override mid-flight)
 *   • Replay-from-step       (optional "edit before replay" path)
 *   • Complete task          (when the userTask declares Outputs)
 *
 * The schema is a flat `{ name: typeString }` map saved at wizard
 * step 2 (Business Document). Supported types: string, number,
 * boolean, date, json. The component is deliberately presentational
 * and controlled — parent owns `values` so callers can pre-fill,
 * validate, and submit on their own terms. `coerceBusinessDocValues`
 * turns the raw string state into typed variables when submitting.
 *
 * NOTE: this renders ONLY the field inputs — no header, no buttons.
 * Compose it inside your own dialog/modal so styling stays cohesive.
 * ──────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";

/** Flat schema as stored on `processMeta.businessDoc`. Values are
 *  type-name strings ("string" | "number" | "boolean" | "date" |
 *  "json"). Any unknown type falls through to a text input — the
 *  string fallback is the safest default for forward compatibility. */
export type BusinessDocSchema = Record<string, string> | null | undefined;

/** Fields rendered to the user. Derived from the schema; ordered by
 *  insertion (same order as the schema was authored in the wizard). */
type Field = { name: string; type: string };

export function BusinessDocForm(props: {
  schema: BusinessDocSchema;
  /** Raw string values keyed by field name. Empty string = blank. */
  values: Record<string, string>;
  onChange: (name: string, rawValue: string) => void;
  /** Optional disable flag for read-only or busy states. */
  disabled?: boolean;
  /** Optional override of the empty-state message. Hidden entirely
   *  when the schema has at least one field. */
  emptyMessage?: React.ReactNode;
}) {
  const { schema, values, onChange, disabled, emptyMessage } = props;
  const fields = useMemo<Field[]>(() => {
    if (!schema || typeof schema !== "object") return [];
    return Object.entries(schema).map(([name, type]) => ({
      name,
      type: String(type).toLowerCase(),
    }));
  }, [schema]);

  if (fields.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "#B45309", padding: "10px 12px", background: "#FFFBEB", borderRadius: 8, border: "1px solid #FDE68A" }}>
        {emptyMessage ?? (
          <>No Business Document schema defined for this process. Define one in the wizard's Document step before using the form editor.</>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {fields.map((f) => (
        <FieldInput
          key={f.name}
          name={f.name}
          type={f.type}
          value={values[f.name] ?? ""}
          onChange={(v) => onChange(f.name, v)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

/** Convert the raw string values back into typed JS values for the
 *  variable bag. Drops blank strings entirely so a partial form
 *  doesn't clobber existing variables with empty values — important
 *  for Edit and Replay where we patch (not replace) the bag.
 *
 *  Coercion failures (e.g. JSON parse) keep the raw string so the
 *  caller can spot it and surface an inline error if they want; we
 *  don't throw, because forms shouldn't blow up on a single bad cell. */
export function coerceBusinessDocValues(
  schema: BusinessDocSchema,
  rawValues: Record<string, string>,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [name, declaredType] of Object.entries(schema)) {
    const raw = rawValues[name];
    if (raw === undefined || raw === "") continue;
    out[name] = coerce(raw, String(declaredType).toLowerCase());
  }
  return out;
}

/** Compose the effective form schema from the process Business Document
 *  + step-declared outputs harvested from the canvas. Used by the
 *  runtime dialogs so step Outputs become first-class form fields
 *  alongside the document-level schema.
 *
 *  Merge rule: businessDoc fields take precedence on a name collision.
 *  This matches the design-time warning surfaced by OutputsSection.
 *
 *  When `currentNodeId` is provided, only that node's outputs are
 *  pulled in (used by CompleteTaskDialog so the form shows just what
 *  this step is supposed to produce). Without it, all userTask /
 *  serviceTask outputs are unioned (used by Edit + Replay where the
 *  admin may want to touch any variable).
 */
type CanvasNodeLike = {
  id: string;
  type?: string;
  data?: { outputs?: Array<{ name?: unknown; type?: unknown }> } & Record<string, unknown>;
};

export function buildEffectiveSchema(
  businessDoc: BusinessDocSchema,
  nodes: CanvasNodeLike[] | undefined,
  opts?: { currentNodeId?: string },
): BusinessDocSchema {
  const merged: Record<string, string> = {};
  // Step outputs first so businessDoc can overwrite — same precedence
  // as the runtime variable-merge rule.
  for (const n of nodes ?? []) {
    if (n.type !== "userTask" && n.type !== "serviceTask") continue;
    if (opts?.currentNodeId && n.id !== opts.currentNodeId) continue;
    const decls = n.data?.outputs;
    if (!Array.isArray(decls)) continue;
    for (const d of decls) {
      const name = typeof d.name === "string" ? d.name.trim() : "";
      if (!name || merged[name]) continue;
      merged[name] = typeof d.type === "string" ? d.type : "string";
    }
  }
  if (businessDoc && typeof businessDoc === "object") {
    for (const [k, v] of Object.entries(businessDoc)) merged[k] = String(v);
  }
  return merged;
}

/** Stringify a typed value back into the raw form-state shape. Used
 *  to pre-fill the form when editing an existing variable bag. */
export function stringifyBusinessDocValues(
  schema: BusinessDocSchema,
  values: Record<string, unknown>,
): Record<string, string> {
  if (!schema || typeof schema !== "object") return {};
  const out: Record<string, string> = {};
  for (const [name, declaredType] of Object.entries(schema)) {
    const v = values[name];
    if (v === undefined || v === null) continue;
    const t = String(declaredType).toLowerCase();
    if (t === "boolean") out[name] = v === true ? "true" : v === false ? "false" : "";
    else if (t === "number") out[name] = Number.isFinite(v as number) ? String(v) : "";
    else if (t === "date") out[name] = typeof v === "string" ? v : "";
    else if (t === "json" || t === "object" || t === "array") {
      out[name] = typeof v === "string" ? v : JSON.stringify(v, null, 2);
    } else {
      out[name] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}

/* ─── Internal helpers ─────────────────────────────────────────────── */

function FieldInput(props: {
  name: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const { name, type, value, onChange, disabled } = props;
  const common: React.CSSProperties = {
    width: "100%", padding: "8px 10px",
    border: "1px solid #E5E7EB", borderRadius: 8,
    fontSize: 12, color: "#111827", outline: "none",
    fontFamily: "inherit",
    background: disabled ? "#F9FAFB" : "#fff",
    cursor: disabled ? "not-allowed" : undefined,
    boxSizing: "border-box",
  };
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#344054" }}>
        {name}
        <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 500, color: "#9CA3AF" }}>
          {type}
        </span>
      </span>
      {type === "boolean" ? (
        <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} style={common}>
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : type === "number" ? (
        <input
          type="number"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...common, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        />
      ) : type === "date" ? (
        <input
          type="date"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={common}
        />
      ) : type === "json" || type === "object" || type === "array" ? (
        <textarea
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='{"key": "value"}'
          style={{ ...common, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", minHeight: 80, resize: "vertical" }}
        />
      ) : (
        <input
          type="text"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={common}
        />
      )}
    </label>
  );
}

/** Coerce a raw form string into the type the schema declared. Mirrors
 *  the original logic from start-instance-dialog so behaviour is
 *  identical at the call site post-extraction. */
function coerce(raw: string, type: string): unknown {
  switch (type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case "boolean":
      return raw === "true";
    case "date":
      return raw; // ISO date string passes through unchanged
    case "json":
    case "object":
    case "array":
      try { return JSON.parse(raw); }
      catch { return raw; }
    default:
      return raw;
  }
}
