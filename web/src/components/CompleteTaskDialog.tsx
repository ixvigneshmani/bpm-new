/* ─── CompleteTaskDialog (VX2) ────────────────────────────────────────
 * Headless-BPM Complete-task dialog: outcome buttons drive routing,
 * the host app owns any real form. The BPM only:
 *   • Renders one button per declared outcome (or a single "Complete"
 *     when none declared).
 *   • Provides a collapsed "Variables (raw JSON)" textarea for QA /
 *     dogfooding inside FlowPro's built-in inbox — operators in real
 *     deployments use the host's UI, not this dialog.
 *
 * Submit shape: `{ outcome: <id>, ...rawVariablesIfAny }`. Downstream
 * gateways read `${outcome}` to route.
 *
 * Originally lived in InstanceDetailPage. Extracted here so the My-Tasks
 * inbox drawer can use the same dialog (BUG-18: inbox previously
 * surfaced a generic "Complete task" button that bypassed outcomes
 * entirely, making instances fail at the next gateway).
 * ──────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useState } from "react";
import type { Outcome } from "../types/bpmn-node-data";
import { ModalShell, modalBtn } from "./modal-shell";

export default function CompleteTaskDialog(props: {
  tokenId: string;
  /** The waiting userTask's outcomes. Empty/missing → single
   *  "Complete" button with implicit id. */
  outcomes: Outcome[] | undefined;
  onClose: () => void;
  onSubmit: (tokenId: string, formData: Record<string, unknown>) => Promise<void>;
}) {
  const { tokenId, outcomes, onClose, onSubmit } = props;
  const effectiveOutcomes: Outcome[] = useMemo(() => {
    if (outcomes && outcomes.length > 0) return outcomes;
    return [{ uid: "implicit", id: "complete", label: "Complete", style: "primary" }];
  }, [outcomes]);

  /* QA / dogfood-only escape hatch. In production the host app sends
   * its own form data; here we let the operator paste raw JSON for
   * test runs. Hidden behind a "Show advanced" toggle so it doesn't
   * pollute the dialog when the host owns the form. */
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rawJson, setRawJson] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parseRawJson = (): Record<string, unknown> | null => {
    if (!showAdvanced) return {};
    const trimmed = rawJson.trim();
    if (!trimmed || trimmed === "{}") return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setErr("Variables must be a JSON object.");
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch (e) {
      setErr(`Invalid JSON: ${(e as Error).message}`);
      return null;
    }
  };

  const onPickOutcome = async (outcome: Outcome) => {
    setErr(null);
    const extra = parseRawJson();
    if (extra === null) return;
    setBusy(true);
    try {
      // Submit shape: { outcome: <id>, ...rawVariables }. The outcome
      // id must NOT be overridden by the raw JSON — drop any key with
      // that name to keep gateway routing predictable.
      const { outcome: _drop, ...safe } = extra;
      void _drop;
      await onSubmit(tokenId, { outcome: outcome.id, ...safe });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  // Cmd/Ctrl+Enter fires the default outcome. Convention: first
  // outcome is the implicit default unless one is explicitly flagged
  // (the simplified Outcomes UI no longer sets `default`, but legacy
  // data may still carry the flag).
  const defaultOutcome = useMemo(
    () => effectiveOutcomes.find((o) => o.default) ?? effectiveOutcomes[0] ?? null,
    [effectiveOutcomes],
  );
  useEffect(() => {
    if (!defaultOutcome) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
        e.preventDefault();
        void onPickOutcome(defaultOutcome);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [defaultOutcome, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ModalShell onClose={onClose} title="Complete task">
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#475467" }}>
        Pick the action that reflects your decision. The choice drives the
        process flow — downstream gateways route on the outcome.
      </p>

      <div style={{ marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => { setShowAdvanced((v) => !v); setErr(null); }}
          style={{
            padding: "4px 10px", borderRadius: 6, border: "1px solid #E5E7EB",
            background: showAdvanced ? "#EEF2FF" : "#fff",
            color: showAdvanced ? "#4F46E5" : "#667085",
            fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {showAdvanced ? "▾" : "▸"} Variables (raw JSON) — for QA / dev
        </button>
        {showAdvanced && (
          <textarea
            value={rawJson}
            onChange={(e) => { setRawJson(e.target.value); setErr(null); }}
            spellCheck={false}
            placeholder='{"comment": "approved", "approvedAmount": 1500}'
            style={{
              width: "100%", marginTop: 8, minHeight: 120, padding: 10, fontSize: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              border: "1px solid #D0D5DD", borderRadius: 6, color: "#101828",
              boxSizing: "border-box", resize: "vertical",
            }}
          />
        )}
      </div>

      {err && (
        <div style={{ marginBottom: 12, padding: "8px 10px", border: "1px solid #FECACA", background: "#FEF2F2", borderRadius: 6, fontSize: 12, color: "#B42318" }}>
          {err}
        </div>
      )}

      <div style={{ borderTop: "1px solid #EAECF0", paddingTop: 14, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} disabled={busy} style={modalBtn}>Cancel</button>
        {effectiveOutcomes.map((o, idx) => (
          <OutcomeActionButton
            key={o.uid}
            outcome={o}
            // Convention: the first outcome gets primary styling unless
            // an explicit style was set on the outcome itself. Keeps the
            // default-action visually obvious without forcing the
            // designer to think about UI.
            implicitPrimary={idx === 0 && !o.style}
            disabled={busy}
            onClick={() => onPickOutcome(o)}
          />
        ))}
      </div>
      {defaultOutcome && (
        <div style={{ marginTop: 8, fontSize: 10, color: "#98A2B3", textAlign: "right" }}>
          ⌘/Ctrl + Enter → {defaultOutcome.label}
        </div>
      )}
    </ModalShell>
  );
}

/** Action button for one outcome. The simplified designer UI no
 *  longer asks for a style — by convention, the first outcome rendered
 *  gets primary, the rest are neutral. Legacy data with explicit
 *  `style` still wins. */
function OutcomeActionButton(props: {
  outcome: Outcome;
  implicitPrimary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { outcome, implicitPrimary, disabled, onClick } = props;
  const effectiveStyle = outcome.style ?? (implicitPrimary ? "primary" : "neutral");
  const css: React.CSSProperties = (() => {
    if (effectiveStyle === "primary") return { background: "#6366F1", color: "#fff", border: "1px solid #6366F1" };
    if (effectiveStyle === "danger")  return { background: "#D92D20", color: "#fff", border: "1px solid #D92D20" };
    return                                   { background: "#fff",    color: "#344054", border: "1px solid #D0D5DD" };
  })();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={outcome.description || `Submit with outcome=${outcome.id}`}
      style={{
        padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
        opacity: disabled ? 0.6 : 1,
        ...css,
      }}
    >
      {outcome.label}
    </button>
  );
}
