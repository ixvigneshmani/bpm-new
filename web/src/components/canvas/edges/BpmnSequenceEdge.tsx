/* ─── BpmnSequenceEdge ────────────────────────────────────────────────
 * Custom edge that renders:
 *  - An orthogonal H-V-H (or V-H-V) route. ONE draggable handle on
 *    the middle segment, constrained to perpendicular drag — slides
 *    that segment to wherever the user wants the bend (GAP-04 v2).
 *  - Editable label (double-click to rename), offset above the line
 *    so it doesn't sit on top of the handle.
 *  - Default-flow slash marker near the source if data.isDefault.
 *  - Highlight when selected.
 *
 * Falls back to React Flow's smoothstep when the source/target use
 * mixed orientations (e.g. right→top) — those edges have no obvious
 * single bend axis, so we don't show a drag handle for them.
 * ──────────────────────────────────────────────────────────────────── */

import {
  useState,
  useRef,
  useEffect,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import useCanvasStore from "../../../store/canvas-store";
import {
  buildOrthogonalPath,
  getAutoBend,
  getBendAxis,
  getBendHandlePosition,
  getEdgeBend,
  snapBend,
} from "./orthogonal-bend";

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
  const updateEdgeData = useCanvasStore((s) => s.updateEdgeData);
  const { screenToFlowPosition } = useReactFlow();

  const axis = getBendAxis(sourcePosition, targetPosition);
  const storedBend = getEdgeBend(data);
  const autoBend = getAutoBend(sourceX, sourceY, targetX, targetY, axis);
  const bendValue = storedBend ?? autoBend;

  // Smoothstep fallback for mixed-orientation edges (no clear bend axis).
  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const useOrthogonal = axis !== null;
  const edgePath = useOrthogonal
    ? buildOrthogonalPath(sourceX, sourceY, targetX, targetY, axis, bendValue)
    : smoothPath;

  const labelPoint = useOrthogonal
    ? getBendHandlePosition(sourceX, sourceY, targetX, targetY, axis, bendValue)
    : { x: smoothLabelX, y: smoothLabelY };

  const isDefault = !!(data && (data as { isDefault?: boolean }).isDefault);
  const flowType =
    (data as { flowType?: "sequence" | "message" | "association" } | undefined)
      ?.flowType ?? "sequence";
  const isAssociation = flowType === "association";

  const stroke = selected
    ? SELECTED_COLOR
    : ((style as CSSProperties)?.stroke ?? DEFAULT_COLOR);
  const strokeWidth = selected ? 2.5 : ((style as CSSProperties)?.strokeWidth ?? 1.5);
  const strokeDasharray =
    flowType === "message" ? "5 4" : flowType === "association" ? "2 3" : undefined;

  const pathStyle: CSSProperties = {
    stroke,
    strokeWidth,
    strokeDasharray,
    fill: "none",
  };

  const effectiveMarkerEnd = isAssociation ? undefined : markerEnd;

  // ── Bend handle drag ────────────────────────────────────────────────
  const draggingRef = useRef<{ pointerId: number } | null>(null);

  function pointerToFlow(e: ReactPointerEvent<SVGElement>): { x: number; y: number } {
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    return flow;
  }

  function onDragStart(e: ReactPointerEvent<SVGElement>): void {
    if (axis === null) return; // no draggable bend on smoothstep fallback
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    draggingRef.current = { pointerId: e.pointerId };
  }

  function onDragMove(e: ReactPointerEvent<SVGElement>): void {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId || axis === null) return;
    const flow = pointerToFlow(e);
    // Perpendicular drag only — for axis "x" we read the cursor's flow X
    // (the segment slides left-right). For axis "y" we read flow Y.
    const newBend = snapBend(axis === "x" ? flow.x : flow.y);
    updateEdgeData(id, { bend: newBend });
  }

  function onDragEnd(e: ReactPointerEvent<SVGElement>): void {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already have been released by the browser; ignore.
    }
    draggingRef.current = null;
  }

  // ── Context menu (right-click) ────────────────────────────────────
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function openMenu(e: ReactMouseEvent<SVGElement>): void {
    if (axis === null) return; // no routing to reset on smoothstep fallback
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function resetRouting(): void {
    updateEdgeData(id, { bend: undefined });
    setMenu(null);
  }

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  // ── Label edit ────────────────────────────────────────────────────
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

  const slashOffset = computeSlashTransform(sourceX, sourceY, sourcePosition);

  // Drag handle shows when the edge is selected OR hovered. Hover-only
  // discovery is the convention BPM tools use (Lucidchart/Camunda).
  const [hovered, setHovered] = useState(false);
  const showHandle = useOrthogonal && (selected || hovered) && !isAssociation;
  const handlePos = useOrthogonal ? labelPoint : null;

  // Cursor for the drag handle — horizontal-resize for axis x (slide
  // sideways), vertical-resize for axis y. Reads "this slides".
  const handleCursor = axis === "x" ? "ew-resize" : axis === "y" ? "ns-resize" : "grab";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={effectiveMarkerEnd}
        style={pathStyle}
        onContextMenu={openMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {isDefault && !isAssociation && (
        <g transform={slashOffset}>
          <line
            x1={-6}
            y1={-6}
            x2={6}
            y2={6}
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* The one bend-handle. Sits on the middle segment; drags it
          perpendicular to its own direction. */}
      {showHandle && handlePos && (
        <g
          style={{ cursor: handleCursor, pointerEvents: "all" }}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onContextMenu={openMenu}
        >
          <circle
            cx={handlePos.x}
            cy={handlePos.y}
            r={7}
            fill={SELECTED_COLOR}
            stroke="#fff"
            strokeWidth={2}
          />
          {/* Two short white strokes indicating which way it slides:
              "↔" for axis x, "↕" for axis y. */}
          {axis === "x" ? (
            <>
              <line
                x1={handlePos.x - 4}
                y1={handlePos.y}
                x2={handlePos.x + 4}
                y2={handlePos.y}
                stroke="#fff"
                strokeWidth={1.5}
                strokeLinecap="round"
                pointerEvents="none"
              />
            </>
          ) : (
            <>
              <line
                x1={handlePos.x}
                y1={handlePos.y - 4}
                x2={handlePos.x}
                y2={handlePos.y + 4}
                stroke="#fff"
                strokeWidth={1.5}
                strokeLinecap="round"
                pointerEvents="none"
              />
            </>
          )}
        </g>
      )}

      {menu && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "fixed",
              left: menu.x,
              top: menu.y,
              background: "#fff",
              border: "1px solid #EAECF0",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
              padding: 4,
              fontSize: 13,
              minWidth: 180,
              zIndex: 2000,
              pointerEvents: "all",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={resetRouting}
              style={menuItem}
              disabled={storedBend === undefined}
            >
              Reset routing
            </button>
          </div>
        </EdgeLabelRenderer>
      )}

      {!isAssociation && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              // Anchor the label's BOTTOM CENTRE 12px above the bend
              // handle so it doesn't sit on the line or steal clicks
              // from the handle below it.
              transform: `translate(-50%, -100%) translate(${labelPoint.x}px, ${labelPoint.y - 12}px)`,
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
            ) : (label || (selected && !editing)) ? (
              <div
                onDoubleClick={() => {
                  if (!selected) setEditing(true);
                }}
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
      )}
    </>
  );
}

const menuItem: CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 12px",
  background: "transparent",
  border: "none",
  textAlign: "left",
  fontSize: 13,
  color: "#344054",
  cursor: "pointer",
  borderRadius: 6,
  fontFamily: "inherit",
};

function computeSlashTransform(
  sourceX: number,
  sourceY: number,
  sourcePosition: string | undefined,
): string {
  const distance = 14;
  let dx = 0,
    dy = 0,
    rotation = 0;
  switch (sourcePosition) {
    case "right":
      dx = distance;
      rotation = 0;
      break;
    case "left":
      dx = -distance;
      rotation = 0;
      break;
    case "top":
      dy = -distance;
      rotation = 90;
      break;
    case "bottom":
      dy = distance;
      rotation = 90;
      break;
    default:
      dx = distance;
  }
  return `translate(${sourceX + dx}, ${sourceY + dy}) rotate(${rotation})`;
}
