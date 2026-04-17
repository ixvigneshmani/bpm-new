/* ─── BpmnSequenceEdge ────────────────────────────────────────────────
 * Custom edge that renders:
 *  - The line (smoothstep path)
 *  - An editable label (double-click to rename)
 *  - A default-flow slash marker near the source if data.isDefault
 *  - Highlight when selected
 * ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, type CSSProperties } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useStore,
  type EdgeProps,
} from "@xyflow/react";
import useCanvasStore from "../../../store/canvas-store";

const SELECTED_COLOR = "#6366F1";
const DEFAULT_COLOR = "#94A3B8";

export default function BpmnSequenceEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
  label,
  markerEnd,
  style,
}: EdgeProps) {
  const updateEdgeLabel = useCanvasStore((s) => s.updateEdgeLabel);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY,
    targetX, targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const isDefault = !!(data && (data as { isDefault?: boolean }).isDefault);
  const flowType = (data as { flowType?: "sequence" | "message" } | undefined)?.flowType ?? "sequence";

  const stroke = selected ? SELECTED_COLOR : (style as CSSProperties)?.stroke ?? DEFAULT_COLOR;
  const strokeWidth = selected ? 2.5 : ((style as CSSProperties)?.strokeWidth ?? 1.5);

  const pathStyle: CSSProperties = {
    stroke,
    strokeWidth,
    strokeDasharray: flowType === "message" ? "5 4" : undefined,
    fill: "none",
  };

  // Edit-on-double-click label
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState((label as string) || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft((label as string) || "");
  }, [label]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== label) updateEdgeLabel(id, draft);
  };

  // Default-flow slash marker — sits ~12px from source along the path
  // We use a small SVG line rotated to be perpendicular-ish to the path direction.
  const slashOffset = computeSlashTransform(sourceX, sourceY, sourcePosition);

  // React Flow internal: get the wrapping <g> to position our HTML label.
  // EdgeLabelRenderer handles that for us.

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={pathStyle} />

      {/* Default-flow slash marker */}
      {isDefault && (
        <g transform={slashOffset}>
          <line
            x1={-6} y1={-6} x2={6} y2={6}
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </g>
      )}

      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            zIndex: 1000,
          }}
        >
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") {
                  setDraft((label as string) || "");
                  setEditing(false);
                }
              }}
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "3px 8px",
                borderRadius: 6,
                border: `1px solid ${SELECTED_COLOR}`,
                background: "#fff",
                outline: "none",
                color: "#101828",
                minWidth: 60,
              }}
            />
          ) : (label || selected) ? (
            <div
              onDoubleClick={() => setEditing(true)}
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "2px 8px",
                borderRadius: 6,
                background: label ? "#fff" : "transparent",
                border: label ? "1px solid #E5E7EB" : "1px dashed #CBD5E1",
                color: label ? "#344054" : "#94A3B8",
                cursor: "text",
                whiteSpace: "nowrap",
                userSelect: "none",
                boxShadow: label ? "0 1px 2px rgba(16,24,40,0.04)" : "none",
              }}
              title="Double-click to edit"
            >
              {(label as string) || "+ label"}
            </div>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/** Position the default-flow slash marker about 14px from the source point,
 *  rotated based on the source side. */
function computeSlashTransform(
  sourceX: number,
  sourceY: number,
  sourcePosition: string | undefined
): string {
  const distance = 14;
  let dx = 0, dy = 0, rotation = 0;
  switch (sourcePosition) {
    case "right":  dx = distance; rotation = 0; break;
    case "left":   dx = -distance; rotation = 0; break;
    case "top":    dy = -distance; rotation = 90; break;
    case "bottom": dy = distance; rotation = 90; break;
    default:       dx = distance;
  }
  return `translate(${sourceX + dx}, ${sourceY + dy}) rotate(${rotation})`;
}

/* Suppress unused warning for useStore — keeps it imported in case we
   need to read transform later for fancier placement. */
void useStore;
