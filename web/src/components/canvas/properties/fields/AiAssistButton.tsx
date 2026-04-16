/* ─── AI Assist Button ────────────────────────────────────────────────
 * Sparkle icon button placed next to expression/text fields.
 * Phase 1: placeholder that shows a tooltip. Will wire to AI gateway later.
 * ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";

type Props = {
  tooltip?: string;
  onClick?: () => void;
};

export default function AiAssistButton({ tooltip = "AI Suggest", onClick }: Props) {
  const [hovered, setHovered] = useState(false);

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex h-6 w-6 items-center justify-center rounded-md transition-all duration-150 hover:bg-brand-50"
        style={{
          background: hovered ? "#EEF2FF" : "transparent",
          border: "1px solid transparent",
          cursor: "pointer",
        }}
        title={tooltip}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={hovered ? "#6366F1" : "#9CA3AF"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: "stroke 0.15s ease" }}
        >
          {/* Sparkle/magic wand */}
          <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />
          <path d="M19 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
          <path d="M5 17l.5 1.5L7 19l-1.5.5L5 21l-.5-1.5L3 19l1.5-.5L5 17z" />
        </svg>
      </button>

      {/* Tooltip */}
      {hovered && (
        <div
          className="pointer-events-none absolute -top-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-medium text-white shadow-lg"
          style={{ background: "#1D2939" }}
        >
          {tooltip}
          <div
            className="absolute left-1/2 top-full -translate-x-1/2"
            style={{
              width: 0,
              height: 0,
              borderLeft: "4px solid transparent",
              borderRight: "4px solid transparent",
              borderTop: "4px solid #1D2939",
            }}
          />
        </div>
      )}
    </div>
  );
}
