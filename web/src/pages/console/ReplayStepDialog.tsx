/* ─── Replay-from-step dialog ─────────────────────────────────────────
 * Confirm dialog for the destructive "cancel live tokens, rewind to
 * this step" action. Mandatory reason + optional variable patch.
 * Backed by POST /instances/:id/replay.
 * ──────────────────────────────────────────────────────────────────── */

import { useRef, useState } from "react";
import { useActingForSnapshot } from "../../lib/acting-for";

export default function ReplayStepDialog(props: {
  targetNodeId: string;
  onClose: () => void;
  onSubmit: (
    reason: string,
    variablesPatch: Record<string, unknown> | undefined,
    idempotencyKey: string,
    actingForSnapshot: string | null,
  ) => Promise<void>;
}) {
  const { targetNodeId, onClose, onSubmit } = props;
  const [reason, setReason] = useState("");
  const [patchJson, setPatchJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
    if (patchJson.trim()) {
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
    const ok = window.confirm(
      `Replay from "${targetNodeId}"?\n\nThis will CANCEL every live token on the instance and place a new token here. Cannot be undone.`,
    );
    if (!ok) return;
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
            <Label>Variable patch (JSON, optional)</Label>
            <div style={{ fontSize: 12, color: "#667085", marginBottom: 6 }}>
              Shallow-merged before the token advances. <code>null</code> values delete keys.
            </div>
            <textarea
              value={patchJson}
              onChange={(e) => setPatchJson(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder="leave blank to replay with current variables"
              style={{
                width: "100%", padding: 12, borderRadius: 8, border: "1px solid #E5E7EB",
                fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "#111827",
                outline: "none", resize: "vertical",
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
                background: "linear-gradient(135deg, #D97706, #F59E0B)",
                fontSize: 13, fontWeight: 600, color: "#fff", cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Replaying…" : "Replay instance"}
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
