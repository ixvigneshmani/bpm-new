/* ─── Admin variable-edit dialog ──────────────────────────────────────
 * Lets an operator shallow-merge a JSON patch into the instance's
 * variable bag. Reason field is mandatory (min 3 chars) — compliance
 * rule: the audit trail must answer "why was this changed?" months
 * after the fact. Backed by POST /instances/:id/variables.
 * ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";

export default function EditVariablesDialog(props: {
  currentVariables: Record<string, unknown>;
  onClose: () => void;
  onSubmit: (patch: Record<string, unknown>, reason: string) => Promise<void>;
}) {
  const { currentVariables, onClose, onSubmit } = props;
  const [patchJson, setPatchJson] = useState("{}");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Parse + validate JSON patch.
    let patch: Record<string, unknown>;
    try {
      patch = JSON.parse(patchJson);
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new Error("Patch must be a JSON object.");
      }
    } catch (ex) {
      setError(`Invalid JSON: ${(ex as Error).message}`);
      return;
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
      const ok = window.confirm(
        `These keys currently hold OBJECT values:\n\n  ${riskyKeys.join("\n  ")}\n\nThe edit will replace each entire object (not deep-merge). Continue?`,
      );
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      await onSubmit(patch, reason.trim());
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
