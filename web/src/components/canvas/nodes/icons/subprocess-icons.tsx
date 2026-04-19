/* ─── Subprocess icons ────────────────────────────────────────────────
 * Marker glyphs used on collapsed subprocess shapes. Per BPMN 2.0 §10.6
 * a collapsed subprocess carries a `+` marker; ad-hoc collapsed carries
 * a `~`.
 * ──────────────────────────────────────────────────────────────────── */

export function CollapsedMarker({ color, kind = "plus" }: { color: string; kind?: "plus" | "tilde" }) {
  if (kind === "tilde") {
    return (
      <svg width="20" height="14" viewBox="0 0 24 16" fill="none">
        <path d="M2 8c2-6 4-6 6 0s4 6 6 0 4-6 6 0"
          stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="2" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="12" y1="8" x2="12" y2="16" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="12" x2="16" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
