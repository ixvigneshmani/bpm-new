import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  BusinessDocForm,
  coerceBusinessDocValues,
  type BusinessDocSchema,
} from "../BusinessDocForm";

/** Dialog that collects start-instance variables from the user, based
 *  on the process's Business Document schema. Closes the BUG-16 gap
 *  where the toolbar button previously posted empty variables, leaving
 *  any ${var} expressions (assignees, gateway conditions, mappings)
 *  silently unresolved.
 *
 *  Form rendering is delegated to <BusinessDocForm> so the same UX is
 *  reused for Edit Variables, Replay-edit, and Complete-with-form. */

export default function StartInstanceDialog({
  schema,
  onCancel,
  onSubmit,
  submitting,
}: {
  schema: BusinessDocSchema;
  onCancel: () => void;
  /** Receives both the variable bag AND the optional businessKey. The
   *  businessKey is what the engine uses to correlate inbound messages
   *  (P3 Session 7) — without it, any intermediate message-catch in the
   *  process fails immediately with "no correlation key". This field
   *  was added 2026-05-25 to close OBS-S7-A. */
  onSubmit: (
    variables: Record<string, unknown>,
    businessKey: string | undefined,
  ) => void;
  submitting: boolean;
}) {
  const hasSchema = useMemo(
    () => !!schema && typeof schema === "object" && Object.keys(schema).length > 0,
    [schema],
  );

  const [businessKey, setBusinessKey] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [rawJson, setRawJson] = useState<string>("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [mode, setMode] = useState<"form" | "raw">(hasSchema ? "form" : "raw");

  const submit = () => {
    const bk = businessKey.trim() || undefined;
    if (mode === "raw") {
      try {
        const parsed = JSON.parse(rawJson || "{}");
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          setJsonError("Must be a JSON object");
          return;
        }
        setJsonError(null);
        onSubmit(parsed as Record<string, unknown>, bk);
      } catch (e) {
        setJsonError((e as Error).message);
      }
      return;
    }
    onSubmit(coerceBusinessDocValues(schema, values), bk);
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
          {/* Business key — optional in general, REQUIRED if the process
              has an intermediate message-catch event correlating on
              businessKey. Without it, P3 Session 7 fails the token loud
              with "no correlation key". Caller passes it as the second
              arg to onSubmit; empty string → undefined → engine treats
              it as not set. */}
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="start-business-key"
              style={{
                display: "block", fontSize: 12, fontWeight: 600,
                color: "#374151", marginBottom: 4, fontFamily: "inherit",
              }}
            >
              Business key <span style={{ fontWeight: 400, color: "#9CA3AF" }}>(optional)</span>
            </label>
            <input
              id="start-business-key"
              type="text"
              value={businessKey}
              onChange={(e) => setBusinessKey(e.target.value)}
              disabled={submitting}
              spellCheck={false}
              placeholder="e.g. ORD-1234, leave-req-2026-0142"
              style={{
                width: "100%", padding: "8px 10px",
                border: "1px solid #E5E7EB", borderRadius: 8,
                fontSize: 13, color: "#111827", outline: "none",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            />
            <div style={{ marginTop: 4, fontSize: 11, color: "#9CA3AF" }}>
              Host-app correlation id. Required if this process catches messages by businessKey.
            </div>
          </div>

          {hasSchema && (
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <ModeChip active={mode === "form"} onClick={() => setMode("form")} label="Form" />
              <ModeChip active={mode === "raw"} onClick={() => setMode("raw")} label="Raw JSON" />
            </div>
          )}

          {mode === "form" && hasSchema && (
            <BusinessDocForm
              schema={schema}
              values={values}
              onChange={(name, v) => setValues((prev) => ({ ...prev, [name]: v }))}
              disabled={submitting}
            />
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

