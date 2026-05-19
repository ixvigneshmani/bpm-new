/* ─── DesignOnlyBanner ────────────────────────────────────────────────
 * Pinned to the top of any properties-palette section (or sub-region)
 * whose UI saves with the canvas but whose runtime behaviour isn't
 * wired up yet. Replaces the ad-hoc inline pills/badges that were
 * sprinkled across sections in slightly different shapes.
 *
 * Two kinds:
 *   • amber  — design intent persists; the engine doesn't act on it
 *              yet (most cases — SLA, multi-instance, circuit breaker,
 *              script execution).
 *   • violet — feature is conceptually distinct and tracked in a
 *              dedicated milestone (DMN, decision tables in M-D2).
 *
 * Always full-width inside its container, never inline next to a field.
 * ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from "react";

type Kind = "amber" | "violet";

type Props = {
  /** Visual treatment. Default amber. */
  kind?: Kind;
  /** Milestone code shown in the pill — e.g. "E8", "D2". Optional. */
  milestone?: string;
  /** Short headline. Defaults to "Design-only". */
  title?: string;
  /** Sentence-length explanation. Required. */
  children: ReactNode;
};

const PALETTE: Record<Kind, { bg: string; border: string; pillBg: string; pillFg: string; body: string }> = {
  amber: {
    bg: "#fffbeb",
    border: "#fde68a",
    pillBg: "#fef3c7",
    pillFg: "#92400e",
    body: "#92400e",
  },
  violet: {
    bg: "#f5f3ff",
    border: "#ddd6fe",
    pillBg: "#ede9fe",
    pillFg: "#5b21b6",
    body: "#5b21b6",
  },
};

export default function DesignOnlyBanner({
  kind = "amber",
  milestone,
  title = "Design-only",
  children,
}: Props) {
  const c = PALETTE[kind];
  return (
    <div
      role="status"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "10px 12px",
        borderRadius: 10,
        background: c.bg,
        border: `1px solid ${c.border}`,
        marginBottom: 12,
      }}
    >
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          width: 18,
          height: 18,
          borderRadius: 4,
          background: c.pillBg,
          color: c.pillFg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 800,
          marginTop: 1,
        }}
      >
        !
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 2,
            fontSize: 11,
            fontWeight: 700,
            color: c.body,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          <span>{title}</span>
          {milestone && (
            <span
              style={{
                padding: "1px 7px",
                borderRadius: 999,
                background: c.pillBg,
                color: c.pillFg,
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "0.04em",
              }}
            >
              {milestone}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: c.body, lineHeight: 1.55 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
