/* ─── ConfirmModal ────────────────────────────────────────────────────
 * Drop-in replacement for `window.confirm` — a styled, keyboard-
 * accessible modal that matches the rest of the app instead of the
 * unstyled, blocking browser prompt.
 *
 * Usage:
 *   const [confirm, setConfirm] = useState<ConfirmConfig | null>(null);
 *   ...
 *   setConfirm({
 *     title: "Cancel instance",
 *     body: "This terminates all running tokens.",
 *     danger: true,
 *     onConfirm: () => { setConfirm(null); doIt(); },
 *   });
 *   ...
 *   {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
 *
 * `body` accepts a string or any ReactNode so callers can render
 * structured content (lists, code blocks, links).
 * ──────────────────────────────────────────────────────────────────── */

import { useEffect } from "react";

export type ConfirmConfig = {
  title: string;
  body: React.ReactNode;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Hide the cancel button — turns the dialog into an alert with a
   *  single dismiss action. Useful as a `window.alert` replacement. */
  alertOnly?: boolean;
  onConfirm: () => void | Promise<void>;
};

export default function ConfirmModal(props: ConfirmConfig & { onClose: () => void }) {
  const { title, body, danger, confirmLabel, cancelLabel, alertOnly, onConfirm, onClose } = props;

  // Close on Escape — matches the keyboard contract of the other
  // app dialogs (ReplayStepDialog, CompleteTaskDialog, etc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)",
        zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480, background: "#fff", borderRadius: 12,
          boxShadow: "0 24px 48px -12px rgba(16,24,40,0.25)", padding: 20,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: "#101828", marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: "#475467", lineHeight: 1.5, marginBottom: 18 }}>
          {body}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {!alertOnly && (
            <button onClick={onClose} style={btnNeutral}>
              {cancelLabel ?? "Cancel"}
            </button>
          )}
          <button onClick={onConfirm} style={danger ? btnDanger : btnPrimary} autoFocus>
            {confirmLabel ?? (alertOnly ? "OK" : danger ? "Confirm" : "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}

const btnBase: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13, borderRadius: 6, fontFamily: "inherit",
  cursor: "pointer", fontWeight: 500,
};
const btnNeutral: React.CSSProperties = {
  ...btnBase, background: "#fff", color: "#344054", border: "1px solid #D0D5DD",
};
const btnPrimary: React.CSSProperties = {
  ...btnBase, background: "#6366F1", color: "#fff", border: "1px solid #6366F1",
};
const btnDanger: React.CSSProperties = {
  ...btnBase, background: "#D92D20", color: "#fff", border: "1px solid #D92D20",
};
