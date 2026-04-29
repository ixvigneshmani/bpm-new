/* ─── Admin variable-edit dialog ──────────────────────────────────────
 * Lets an operator shallow-merge a JSON patch into the instance's
 * variable bag. Reason field is mandatory (min 3 chars) — compliance
 * rule: the audit trail must answer "why was this changed?" months
 * after the fact. Backed by POST /instances/:id/variables.
 * ──────────────────────────────────────────────────────────────────── */

import { useMemo, useRef, useState } from "react";
import { useActingForSnapshot } from "../../lib/acting-for";
import ConfirmModal, { type ConfirmConfig } from "../../components/ConfirmModal";
import {
  BusinessDocForm,
  coerceBusinessDocValues,
  stringifyBusinessDocValues,
  type BusinessDocSchema,
} from "../../components/BusinessDocForm";

export default function EditVariablesDialog(props: {
  currentVariables: Record<string, unknown>;
  /** Effective schema = processMeta.businessDoc + harvested step
   *  Outputs across the canvas. When non-empty, the dialog defaults
   *  to a typed Form. Pass null/empty to fall through to JSON only. */
  schema: BusinessDocSchema;
  onClose: () => void;
  onSubmit: (
    patch: Record<string, unknown>,
    reason: string,
    idempotencyKey: string,
    actingForSnapshot: string | null,
  ) => Promise<void>;
}) {
  const { currentVariables, schema, onClose, onSubmit } = props;
  const hasSchema = useMemo(
    () => !!schema && Object.keys(schema as Record<string, unknown>).length > 0,
    [schema],
  );
  const [mode, setMode] = useState<"form" | "advanced">(hasSchema ? "form" : "advanced");
  /* Form-mode state: pre-filled from currentVariables so the operator
   * sees the live values and edits in place. Coerce + diff against
   * `currentVariables` on submit produces the minimal patch. */
  const initialFormValues = useMemo(
    () => stringifyBusinessDocValues(schema, currentVariables),
    [schema, currentVariables],
  );
  const [formValues, setFormValues] = useState<Record<string, string>>(initialFormValues);
  const [patchJson, setPatchJson] = useState("{}");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null);
  // Freeze impersonation + idempotency key at open-time. A mid-edit
  // switch of Act-as target no longer silently re-attributes; a
  // network retry replays the same key and the backend de-dupes.
  const actingForSnapshot = useActingForSnapshot();
  const idemKey = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random().toString(36).slice(2),
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let patch: Record<string, unknown>;
    if (mode === "form") {
      // Coerce form values, then diff against current bag to produce
      // the minimal patch — only fields the operator actually edited.
      // Equality check is JSON-stringify based; good enough for the
      // primitive types BusinessDocForm renders.
      const next = coerceBusinessDocValues(schema, formValues);
      patch = {};
      for (const [k, v] of Object.entries(next)) {
        if (JSON.stringify(currentVariables[k]) !== JSON.stringify(v)) {
          patch[k] = v;
        }
      }
    } else {
      try {
        patch = JSON.parse(patchJson);
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
          throw new Error("Patch must be a JSON object.");
        }
      } catch (ex) {
        setError(`Invalid JSON: ${(ex as Error).message}`);
        return;
      }
    }
    if (reason.trim().length < 3) {
      setError("Reason is required (min 3 characters).");
      return;
    }
    if (Object.keys(patch).length === 0) {
      setError("Patch has no keys — nothing to change.");
      return;
    }
    // Warn on risky shallow-replace of object values (bag-level merge
    // does NOT deep-merge — editing `user.name` alone overwrites the
    // whole `user` object and drops other fields). Make the operator
    // confirm.
    const riskyKeys = Object.keys(patch).filter((k) => {
      const cur = currentVariables[k];
      return cur && typeof cur === "object" && !Array.isArray(cur);
    });
    if (riskyKeys.length > 0) {
      // Hand off to a styled ConfirmModal; the actual write happens
      // in the modal's onConfirm so the function returns now and the
      // form's submit-state stays clean if the user backs out.
      setConfirm({
        title: "Replace object values?",
        danger: true,
        confirmLabel: "Replace and apply",
        body: (
          <>
            These keys currently hold <strong>object</strong> values:
            <ul style={{ margin: "8px 0", paddingLeft: 18, fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "#101828" }}>
              {riskyKeys.map((k) => <li key={k}>{k}</li>)}
            </ul>
            The edit will replace each entire object (not deep-merge).
          </>
        ),
        onConfirm: () => {
          setConfirm(null);
          void doSubmit(patch);
        },
      });
      return;
    }
    void doSubmit(patch);
  };

  const doSubmit = async (patch: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      await onSubmit(patch, reason.trim(), idemKey.current, actingForSnapshot);
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 60 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 560, background: "#fff",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", zIndex: 70,
      }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EAECF0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#101828" }}>Edit variables</div>
            <div style={{ fontSize: 12, color: "#667085", marginTop: 2 }}>Admin-only. Shallow-merge the patch into the instance bag.</div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <form onSubmit={submit} style={{ flex: 1, overflowY: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label>Current variables (reference)</Label>
            <pre style={{
              margin: 0, padding: 12, background: "#F9FAFB", border: "1px solid #EAECF0",
              borderRadius: 6, fontSize: 11, fontFamily: "var(--font-mono, monospace)",
              color: "#475467", maxHeight: 160, overflow: "auto",
            }}>
              {JSON.stringify(currentVariables, null, 2) || "{}"}
            </pre>
          </div>

          {hasSchema && (
            <div style={{ display: "flex", gap: 6 }}>
              <ModeToggle active={mode === "form"} onClick={() => setMode("form")}>Form</ModeToggle>
              <ModeToggle active={mode === "advanced"} onClick={() => setMode("advanced")}>Advanced (JSON)</ModeToggle>
            </div>
          )}

          {mode === "form" ? (
            <div>
              <Label>Edit values *</Label>
              <div style={{ fontSize: 12, color: "#667085", marginBottom: 8 }}>
                Form is pre-filled with the current values. Only the fields you change get patched. To unset a value or send raw JSON, switch to <strong>Advanced</strong>.
              </div>
              <BusinessDocForm
                schema={schema}
                values={formValues}
                onChange={(name, v) => setFormValues((prev) => ({ ...prev, [name]: v }))}
                disabled={submitting}
              />
            </div>
          ) : (
            <div>
              <Label>Patch (JSON object) *</Label>
              <div style={{ fontSize: 12, color: "#667085", marginBottom: 6 }}>
                Merged onto the bag. To remove a key, set its value to <code>null</code>. <br />
                Example: <code>{`{"approved": true, "approverNotes": "manual override"}`}</code>
              </div>
              <textarea
                value={patchJson}
                onChange={(e) => setPatchJson(e.target.value)}
                rows={10}
                spellCheck={false}
                style={{
                  width: "100%", padding: 12, borderRadius: 8, border: "1px solid #E5E7EB",
                  fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "#111827",
                  outline: "none", resize: "vertical",
                }}
              />
            </div>
          )}

          <div>
            <Label>Reason *</Label>
            <div style={{ fontSize: 12, color: "#667085", marginBottom: 6 }}>
              Stored with every changed key in the audit trail. Minimum 3 characters.
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. operator correction — wrong approval amount submitted"
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #E5E7EB",
                fontSize: 13, color: "#111827", outline: "none",
              }}
            />
          </div>

          {error && (
            <div style={{ padding: "10px 14px", border: "1px solid #FECACA", background: "#FEF2F2", borderRadius: 8, color: "#B42318", fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={onClose} disabled={submitting}
              style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, fontWeight: 600, color: "#475467", cursor: "pointer" }}>
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              style={{
                padding: "9px 18px", borderRadius: 8, border: "none",
                background: "linear-gradient(135deg, #4F46E5, #6366F1)",
                fontSize: 13, fontWeight: 600, color: "#fff", cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Saving…" : "Save with reason"}
            </button>
          </div>
        </form>
      </div>
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}

function Label(props: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
      {props.children}
    </div>
  );
}

function ModeToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 10px", borderRadius: 6,
        border: "1px solid " + (active ? "#C7D2FE" : "#E5E7EB"),
        background: active ? "#EEF2FF" : "#fff",
        color: active ? "#4F46E5" : "#667085",
        fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}
