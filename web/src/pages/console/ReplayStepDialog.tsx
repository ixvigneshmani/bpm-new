/* ─── Replay-from-step dialog ─────────────────────────────────────────
 * Confirm dialog for the destructive "cancel live tokens, rewind to
 * this step" action. Mandatory reason + optional variable patch.
 * Backed by POST /instances/:id/replay.
 * ──────────────────────────────────────────────────────────────────── */

import { useMemo, useRef, useState } from "react";
import { useActingForSnapshot } from "../../lib/acting-for";
import {
  BusinessDocForm,
  coerceBusinessDocValues,
  stringifyBusinessDocValues,
  type BusinessDocSchema,
} from "../../components/BusinessDocForm";

export default function ReplayStepDialog(props: {
  targetNodeId: string;
  /** Effective schema (businessDoc + step Outputs) used by the
   *  optional "edit variables before replay" form. */
  schema: BusinessDocSchema;
  /** Current variables on the instance — pre-fills the edit form. */
  currentVariables: Record<string, unknown>;
  onClose: () => void;
  onSubmit: (
    reason: string,
    variablesPatch: Record<string, unknown> | undefined,
    idempotencyKey: string,
    actingForSnapshot: string | null,
  ) => Promise<void>;
}) {
  const { targetNodeId, schema, currentVariables, onClose, onSubmit } = props;
  const [reason, setReason] = useState("");
  const [patchJson, setPatchJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hasSchema = useMemo(
    () => !!schema && Object.keys(schema as Record<string, unknown>).length > 0,
    [schema],
  );
  /* Replay variable choice — kept simple as a radio so the user
   * always sees what's about to happen:
   *   "current" → empty patch, current bag carries forward verbatim
   *   "edit"    → form pre-filled from currentVariables; diff on submit
   *   "json"    → raw patch JSON (existing behaviour, escape hatch)   */
  const [varMode, setVarMode] = useState<"current" | "edit" | "json">("current");
  const initialFormValues = useMemo(
    () => stringifyBusinessDocValues(schema, currentVariables),
    [schema, currentVariables],
  );
  const [formValues, setFormValues] = useState<Record<string, string>>(initialFormValues);
  /* Two-step confirmation: the first click on the destructive button
   * validates the form and flips into `confirming`; the second click
   * actually fires the API call. Replaces the old window.confirm() so
   * the entire flow stays inside the styled dialog. */
  const [confirming, setConfirming] = useState(false);
  const actingForSnapshot = useActingForSnapshot();
  const idemKey = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random().toString(36).slice(2),
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 3) {
      setError("Reason is required (min 3 chars).");
      return;
    }
    let patch: Record<string, unknown> | undefined;
    if (varMode === "edit") {
      // Coerce form values, then diff against current bag — same logic
      // as EditVariablesDialog. Skip when there's no schema (defensive).
      const next = coerceBusinessDocValues(schema, formValues);
      const diff: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(next)) {
        if (JSON.stringify(currentVariables[k]) !== JSON.stringify(v)) diff[k] = v;
      }
      patch = Object.keys(diff).length > 0 ? diff : undefined;
    } else if (varMode === "json" && patchJson.trim()) {
      try {
        patch = JSON.parse(patchJson);
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
          throw new Error("Patch must be a JSON object.");
        }
      } catch (ex) {
        setError(`Invalid JSON patch: ${(ex as Error).message}`);
        return;
      }
    }
    // varMode === "current" → patch stays undefined → engine uses
    // existing variables verbatim.
    if (!confirming) {
      // First click: validation passed — arm the confirmation. The
      // button label + a red callout below the form make the next
      // click read clearly as "this is the destructive one".
      setConfirming(true);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(reason.trim(), patch, idemKey.current, actingForSnapshot);
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
        position: "fixed", top: 0, right: 0, bottom: 0, width: 520, background: "#fff",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", zIndex: 70,
      }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EAECF0" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#101828" }}>Replay from step</div>
          <div style={{ fontSize: 12, color: "#667085", marginTop: 2 }}>
            Cancel every live token and place a new token at <code style={{ background: "#F2F4F7", padding: "1px 6px", borderRadius: 4 }}>{targetNodeId}</code>. Destructive — no undo.
          </div>
        </div>

        <form onSubmit={submit} style={{ flex: 1, overflowY: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ padding: "10px 14px", border: "1px solid #FECACA", background: "#FEF2F2", borderRadius: 8, fontSize: 12, color: "#B42318" }}>
            <strong>⚠ Destructive operation.</strong> All currently-running or waiting tokens on this instance will be cancelled.
            Queued engine jobs for this instance will be killed. Any variable patch is applied before the new token advances.
          </div>

          <div>
            <Label>Target step</Label>
            <div style={{ padding: 10, background: "#F9FAFB", border: "1px solid #EAECF0", borderRadius: 6, fontSize: 13, fontFamily: "var(--font-mono, monospace)" }}>
              {targetNodeId}
            </div>
          </div>

          <div>
            <Label>Reason *</Label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. gateway picked wrong branch; rewinding after data fix"
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #E5E7EB",
                fontSize: 13, color: "#111827", outline: "none",
              }}
            />
          </div>

          <div>
            <Label>Variables before replay</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              <ReplayVarRadio
                checked={varMode === "current"}
                onChange={() => setVarMode("current")}
                label="Replay with current values"
                hint="The instance's existing variables carry forward unchanged."
              />
              {hasSchema && (
                <ReplayVarRadio
                  checked={varMode === "edit"}
                  onChange={() => setVarMode("edit")}
                  label="Edit variables before replay"
                  hint="Pre-filled form. Only fields you change get patched."
                />
              )}
              <ReplayVarRadio
                checked={varMode === "json"}
                onChange={() => setVarMode("json")}
                label="Advanced — raw JSON patch"
                hint="For unsetting keys (null) or sending values not in the schema."
              />
            </div>

            {varMode === "edit" && hasSchema && (
              <BusinessDocForm
                schema={schema}
                values={formValues}
                onChange={(name, v) => setFormValues((prev) => ({ ...prev, [name]: v }))}
                disabled={submitting}
              />
            )}

            {varMode === "json" && (
              <textarea
                value={patchJson}
                onChange={(e) => setPatchJson(e.target.value)}
                rows={8}
                spellCheck={false}
                placeholder='{"approved": true} — or leave blank to send no patch'
                style={{
                  width: "100%", padding: 12, borderRadius: 8, border: "1px solid #E5E7EB",
                  fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "#111827",
                  outline: "none", resize: "vertical",
                }}
              />
            )}
          </div>

          {error && (
            <div style={{ padding: "10px 14px", border: "1px solid #FECACA", background: "#FEF2F2", borderRadius: 8, color: "#B42318", fontSize: 13 }}>
              {error}
            </div>
          )}

          {confirming && !submitting && (
            <div style={{ padding: "10px 14px", border: "1px solid #FCA5A5", background: "#FEF2F2", borderRadius: 8, fontSize: 13, color: "#B42318" }}>
              <strong>Last chance.</strong> Click <em>Confirm — replay now</em> to cancel every live token and rewind to this step. Click <em>Back</em> to edit your inputs.
            </div>
          )}

          <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {confirming ? (
              <button type="button" onClick={() => setConfirming(false)} disabled={submitting}
                style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, fontWeight: 600, color: "#475467", cursor: "pointer" }}>
                Back
              </button>
            ) : (
              <button type="button" onClick={onClose} disabled={submitting}
                style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", fontSize: 13, fontWeight: 600, color: "#475467", cursor: "pointer" }}>
                Cancel
              </button>
            )}
            <button type="submit" disabled={submitting}
              style={{
                padding: "9px 18px", borderRadius: 8, border: "none",
                background: confirming
                  ? "linear-gradient(135deg, #B42318, #D92D20)"
                  : "linear-gradient(135deg, #D97706, #F59E0B)",
                fontSize: 13, fontWeight: 600, color: "#fff", cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Replaying…" : confirming ? "Confirm — replay now" : "Replay instance"}
            </button>
          </div>
        </form>
      </div>
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

function ReplayVarRadio(props: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  const { checked, onChange, label, hint } = props;
  return (
    <label
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px",
        border: "1px solid " + (checked ? "#C7D2FE" : "#E5E7EB"),
        background: checked ? "#EEF2FF" : "#fff",
        borderRadius: 8, cursor: "pointer",
      }}
    >
      <input type="radio" checked={checked} onChange={onChange} style={{ marginTop: 2 }} />
      <span>
        <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#101828" }}>{label}</span>
        <span style={{ display: "block", fontSize: 11, color: "#667085", marginTop: 2 }}>{hint}</span>
      </span>
    </label>
  );
}
