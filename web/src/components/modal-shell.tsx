/* ─── Shared modal primitives ─────────────────────────────────────────
 * Extracted from InstanceDetailPage so other pages can render the same
 * styled dialogs (CompleteTaskDialog now lives in its own component
 * and is consumed by both InstanceDetailPage and TasksInboxPage).
 *
 * Centralised here so the modal chrome (overlay, escape-to-close,
 * panel sizing, button styles) stays consistent across:
 *   - Instance detail (Reassign / Skip / Replay / Edit-vars / Complete)
 *   - Task inbox (Complete-task)
 *
 * Keeping a single ModalShell also keeps z-index + scroll behaviour
 * identical, which matters when modals open over already-open drawers.
 * ──────────────────────────────────────────────────────────────────── */

import { useEffect } from "react";

export function ModalShell({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
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
        zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 520, background: "#fff", borderRadius: 12,
          boxShadow: "0 24px 48px -12px rgba(16,24,40,0.25)", padding: 20,
          maxHeight: "90vh", overflow: "auto",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: "#101828", marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export const modalBtn: React.CSSProperties = {
  padding: "7px 14px", fontSize: 13, borderRadius: 6, border: "1px solid #D0D5DD",
  background: "#fff", color: "#344054", cursor: "pointer", fontFamily: "inherit",
};
export const modalBtnPrimary: React.CSSProperties = {
  ...modalBtn, background: "#6366F1", color: "#fff", border: "1px solid #6366F1", fontWeight: 500,
};
export const modalBtnDanger: React.CSSProperties = {
  ...modalBtn, background: "#D92D20", color: "#fff", border: "1px solid #D92D20", fontWeight: 500,
};
