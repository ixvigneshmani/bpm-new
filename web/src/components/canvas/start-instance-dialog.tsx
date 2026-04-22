import { useState, useMemo } from "react";
import { createPortal } from "react-dom";

/** Dialog that collects start-instance variables from the user, based
 *  on the process's Business Document schema. Closes the BUG-16 gap
 *  where the toolbar button previously posted empty variables, leaving
 *  any ${var} expressions (assignees, gateway conditions, mappings)
 *  silently unresolved.
 *
 *  The schema is the `{fieldName: typeString}` map saved at wizard
 *  step 2. Types supported: string, number, boolean, date, json. If
 *  the schema is missing or empty, we render a raw-JSON textarea so
 *  operators can still pass variables during testing. */

type FieldType = "string" | "number" | "boolean" | "date" | "json" | string;
type SchemaMap = Record<string, FieldType> | null | undefined;

export default function StartInstanceDialog({
  schema,
  onCancel,
  onSubmit,
  submitting,
}: {
  schema: SchemaMap;
  onCancel: () => void;
  onSubmit: (variables: Record<string, unknown>) => void;
  submitting: boolean;
}) {
  const fields = useMemo(() => {
    if (!schema || typeof schema !== "object") return [];
    return Object.entries(schema).map(([name, type]) => ({
      name,
      type: String(type).toLowerCase(),
    }));
  }, [schema]);

  const hasSchema = fields.length > 0;
  const [values, setValues] = useState<Record<string, string>>({});
  const [rawJson, setRawJson] = useState<string>("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [mode, setMode] = useState<"form" | "raw">(hasSchema ? "form" : "raw");

  const submit = () => {
    if (mode === "raw") {
      try {
        const parsed = JSON.parse(rawJson || "{}");
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          setJsonError("Must be a JSON object");
          return;
        }
        setJsonError(null);
        onSubmit(parsed as Record<string, unknown>);
      } catch (e) {
        setJsonError((e as Error).message);
      }
      return;
    }
    // Form mode — coerce values by declared type, drop blanks.
    const out: Record<string, unknown> = {};
    for (const { name, type } of fields) {
      const raw = values[name];
      if (raw === undefined || raw === "") continue;
      out[name] = coerce(raw, type);
    }
    onSubmit(out);
  };

  // Portal to document.body so the fixed-positioned overlay escapes
  // React Flow's transformed viewport. Without this, `position: fixed`
  // is contained by the nearest transformed ancestor (a browser quirk
  // specified by CSS containing-block rules) and the modal gets
  // clipped to canvas bounds instead of viewport bounds.
  return createPortal(
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(17,24,39,0.45)",
        // Scroll the overlay (not the modal) when content is tall —
        // centering with `alignItems: center` on a too-tall modal
        // clips the top. `flex-start` + `overflow: auto` lets the whole
        // dialog scroll cleanly and keeps the header always reachable.
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 24px 24px",
        overflowY: "auto",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 12,
          width: "100%", maxWidth: 520,
          boxShadow: "0 24px 48px rgba(17,24,39,0.2)",
          display: "flex", flexDirection: "column",
          // Let the modal grow naturally. Body has its own max-height
          // so very long schemas still get an internal scroll area.
        }}
      >
        <header style={{ padding: "20px 24px 12px", borderBottom: "1px solid #F3F4F6" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#101828" }}>
            Start instance
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#667085" }}>
            Provide initial variables. These resolve any <code>${"${varName}"}</code> expressions
            (assignees, conditions, mappings).
          </p>
        </header>

        <div style={{ padding: "16px 24px", overflowY: "auto", maxHeight: "70vh" }}>
          {hasSchema && (
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <ModeChip active={mode === "form"} onClick={() => setMode("form")} label="Form" />
              <ModeChip active={mode === "raw"} onClick={() => setMode("raw")} label="Raw JSON" />
            </div>
          )}

          {mode === "form" && hasSchema && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {fields.map((f) => (
                <FieldInput
                  key={f.name}
                  name={f.name}
                  type={f.type}
                  value={values[f.name] ?? ""}
                  onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
                />
              ))}
            </div>
          )}

          {mode === "raw" && (
            <div>
              {!hasSchema && (
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "#B45309" }}>
                  No Business Document schema defined for this process. Paste start variables as raw JSON.
                </p>
              )}
              <textarea
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%", minHeight: 140, padding: 10,
                  border: "1px solid #E5E7EB", borderRadius: 8,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12, color: "#111827",
                  resize: "vertical",
                  outline: "none",
                }}
                placeholder='{"managerId": "uuid-here", "days": 3}'
              />
              {jsonError && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#B42318" }}>{jsonError}</div>
              )}
            </div>
          )}
        </div>

        <footer
          style={{
            padding: "12px 24px 16px",
            borderTop: "1px solid #F3F4F6",
            display: "flex", justifyContent: "flex-end", gap: 8,
          }}
        >
          <button
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: "8px 14px", borderRadius: 8,
              border: "1px solid #E5E7EB", background: "#fff",
              color: "#374151", fontSize: 13, fontWeight: 500,
              cursor: submitting ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            style={{
              padding: "8px 14px", borderRadius: 8,
              border: "none",
              background: submitting ? "#A5B4FC" : "linear-gradient(135deg, #4F46E5, #6366F1)",
              color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              boxShadow: "0 1px 2px rgba(79,70,229,0.25)",
            }}
          >
            {submitting ? "Starting…" : "Start instance"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function ModeChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 10px", borderRadius: 6,
        border: "1px solid " + (active ? "#C7D2FE" : "#E5E7EB"),
        background: active ? "#EEF2FF" : "#fff",
        color: active ? "#4F46E5" : "#667085",
        fontSize: 11, fontWeight: 600,
        cursor: "pointer", fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

function FieldInput({
  name, type, value, onChange,
}: {
  name: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const common: React.CSSProperties = {
    width: "100%", padding: "8px 10px",
    border: "1px solid #E5E7EB", borderRadius: 8,
    fontSize: 12, color: "#111827", outline: "none",
    fontFamily: "inherit",
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
        <select value={value} onChange={(e) => onChange(e.target.value)} style={common}>
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : type === "number" ? (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...common, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        />
      ) : type === "date" ? (
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={common}
        />
      ) : type === "json" || type === "object" || type === "array" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='{"key": "value"}'
          style={{ ...common, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", minHeight: 80, resize: "vertical" }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={common}
        />
      )}
    </label>
  );
}

function coerce(raw: string, type: string): unknown {
  switch (type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case "boolean":
      return raw === "true";
    case "date":
      return raw; // ISO date string passed through
    case "json":
    case "object":
    case "array":
      try { return JSON.parse(raw); }
      catch { return raw; }
    default:
      return raw;
  }
}
