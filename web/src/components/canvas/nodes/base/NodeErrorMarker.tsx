/* ─── NodeErrorMarker ─────────────────────────────────────────────────
 * Designer Sweep A — Red/yellow dot rendered on the top-right of a node
 * whenever the validation engine reports issue(s) scoped to that node.
 * Click opens the Problems panel and scrolls to the highest-severity
 * issue. Position offsets are tuned per host shape (task / event / gw).
 * ──────────────────────────────────────────────────────────────────── */

import { memo } from "react";
import useCanvasStore from "../../../../store/canvas-store";
import { useValidationIssues } from "../../../../store/validation-hook";
import type { IssueSeverity } from "../../../../lib/validation/types";

type Props = {
  nodeId: string;
  /** Pixel offset from the host's top-right anchor. Defaults to
   *  rectangular task framing; events/gateways pass overrides. */
  offsetTop?: number;
  offsetRight?: number;
};

const SEV_COLOR: Record<IssueSeverity, { dot: string; ring: string }> = {
  error: { dot: "#F04438", ring: "#FEE4E2" },
  warning: { dot: "#F79009", ring: "#FEF0C7" },
  info: { dot: "#2E90FA", ring: "#D1E9FF" },
};

const SEV_RANK: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

function NodeErrorMarker({ nodeId, offsetTop = -6, offsetRight = -6 }: Props) {
  const issues = useValidationIssues();
  const focusIssue = useCanvasStore((s) => s.focusIssue);

  const mine = issues.filter((i) => i.nodeId === nodeId);
  if (mine.length === 0) return null;

  mine.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const top = mine[0];
  const c = SEV_COLOR[top.severity];

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    focusIssue(top.id, nodeId);
  };

  const title =
    mine.length === 1
      ? top.message
      : `${mine.length} problems — ${top.message}`;

  return (
    <div
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      className="nodrag"
      title={title}
      style={{
        position: "absolute",
        top: offsetTop,
        right: offsetRight,
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: c.dot,
        boxShadow: `0 0 0 3px ${c.ring}, 0 1px 2px rgba(16,24,40,0.18)`,
        cursor: "pointer",
        zIndex: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 8,
        fontWeight: 700,
        lineHeight: 1,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {mine.length > 1 ? mine.length : ""}
    </div>
  );
}

export default memo(NodeErrorMarker);
