/* ─── Properties palette — shared style tokens ─────────────────────────
 * Single source of truth for the right-side palette's visual language.
 * Replaces the ~10 file-local redeclarations of labelStyle / inputStyle
 * / configBox that drifted subtly (padding 8/12 vs 10/14, radius 8 vs
 * 10, etc.) and made the palette feel inconsistent.
 *
 * House style: inline-styles only (Tailwind preflight is disabled in
 * `.props-panel` because of Ant Design compatibility). Hence everything
 * here is `React.CSSProperties`.
 *
 * The wide-palette layout strategy (palette is 50% of screen / ≥ 420px)
 * means most rows pair two short controls side-by-side via `twoColumnGrid`.
 * Solo full-width inputs are reserved for URLs, expressions, mapping
 * tables, and long names — see the width-token rule of thumb below.
 * ──────────────────────────────────────────────────────────────────── */

import type { CSSProperties } from "react";

/* ─── Labels ───────────────────────────────────────────────────────── */

/** Section-internal field label. Uppercase + tracking, drawn in light
 *  grey so the section title (rendered by the orchestrator) still wins
 *  the visual hierarchy. */
export const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#98a2b3",
  marginBottom: 6,
};

/** Sub-label inside a config-box. Sentence-case so it doesn't compete
 *  with the section title or the section's own `labelStyle` rows. */
export const subLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#475467",
  marginBottom: 6,
};

/** Inline help / hint copy under an input. */
export const hintStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  color: "#98a2b3",
  lineHeight: 1.5,
};

/* ─── Inputs ───────────────────────────────────────────────────────── */

/** Default input shape. Width is NOT set here — use a width token
 *  below, or wrap in `twoColumnGrid` for paired inputs. */
const inputBase: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  fontSize: 13,
  color: "#111827",
  fontFamily: "inherit",
  outline: "none",
  background: "#fff",
  lineHeight: 1.5,
  boxSizing: "border-box",
};

/** Full-width input — for URLs, expressions, mapping tables, long names. */
export const inputStyle: CSSProperties = {
  ...inputBase,
  width: "100%",
};

/** Numeric input — counts, thresholds (e.g. "5"). ~100 px. */
export const numericInput: CSSProperties = {
  ...inputBase,
  width: 100,
};

/** Token-shaped input — ISO-8601 durations ("PT1H"), slugs, element
 *  variable names, versions. ~180 px. Mono-font to telegraph "this is
 *  a code-shaped value". */
export const tokenInput: CSSProperties = {
  ...inputBase,
  width: 180,
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: 12,
};

/** Slug-shaped input — short identifiers like decision-id, http-header
 *  names. ~280 px. */
export const slugInput: CSSProperties = {
  ...inputBase,
  width: 280,
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: 12,
};

/** Single-line text input for short prose ("Approve", "Reject"). */
export const labelInput: CSSProperties = {
  ...inputBase,
  width: 280,
};

/** Full-width monospaced input — for URLs, expressions. */
export const monoInput: CSSProperties = {
  ...inputBase,
  width: "100%",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: 12,
};

/* ─── Containers ───────────────────────────────────────────────────── */

/** Light-grey config-box used to group related fields inside a section. */
export const configBox: CSSProperties = {
  border: "1px solid #f2f4f7",
  borderRadius: 12,
  background: "#f9fafb",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

/** 2-column grid — the default row shape for short paired fields
 *  (e.g. Due Date + Priority). The wide palette earns this layout. */
export const twoColumnGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 14,
};

/** Section root — vertical stack of rows with consistent spacing. */
export const sectionStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

/** Inline chip — used to surface a computed value or unit next to an
 *  input ("⏱ 1 hour", "id: approve"). Right-aligned, monospaced. */
export const inlineChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 8px",
  borderRadius: 999,
  background: "#f2f4f7",
  color: "#475467",
  fontSize: 11,
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  whiteSpace: "nowrap",
};

/* ─── Helpers ──────────────────────────────────────────────────────── */

/** Parse a (very small) subset of ISO-8601 durations for the "⏱ 1 hour"
 *  preview chip next to duration inputs. Returns a human string or null
 *  when the input isn't a recognised pattern. Deliberately conservative:
 *  we'd rather render nothing than misrepresent a malformed expression. */
export function formatIsoDuration(spec: string | undefined): string | null {
  if (!spec) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(spec.trim());
  if (!m) return null;
  const [, d, h, mn, s] = m;
  const parts: string[] = [];
  if (d) parts.push(`${d} day${d === "1" ? "" : "s"}`);
  if (h) parts.push(`${h} hour${h === "1" ? "" : "s"}`);
  if (mn) parts.push(`${mn} minute${mn === "1" ? "" : "s"}`);
  if (s) parts.push(`${s} second${s === "1" ? "" : "s"}`);
  return parts.length === 0 ? null : parts.join(" ");
}
