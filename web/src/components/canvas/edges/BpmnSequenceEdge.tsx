/* ─── BpmnSequenceEdge ────────────────────────────────────────────────
 * Orthogonal multi-segment routing (GAP-04 v3).
 *
 * - Path is always strictly orthogonal — right angles only, no
 *   diagonals possible.
 * - Every segment has a draggable midpoint handle. Drag is constrained
 *   to perpendicular direction:
 *     • horizontal segment → drag ↕ vertical
 *     • vertical segment   → drag ↔ horizontal
 * - Interior segments slide bodily; source/target-anchored segments
 *   insert new waypoints to materialise the offset (same as Camunda
 *   Modeler / bpmn.io).
 * - Right-click → "Reset routing" clears all waypoints, reverts to
 *   default auto-route.
 *
 * Falls back to React Flow's smoothstep for mixed source/target
 * orientations (right→top etc.) — no obvious orthogonal route, so no
 * drag handles for those edges.
 * ──────────────────────────────────────────────────────────────────── */

import {
  useState,
  useRef,
  useEffect,
  useMemo,
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
  canRouteOrthogonally,
  dragSegment,
  effectivePoints,
  getEdgeWaypoints,
  getSegments,
  snapValue,
  type Segment,
} from "./orthogonal-routing";

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

  const useOrthogonal = canRouteOrthogonally(sourcePosition, targetPosition);

  const waypoints = useMemo(() => getEdgeWaypoints(data), [data]);
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };

  const points = useMemo(
    () =>
      useOrthogonal
        ? effectivePoints(source, waypoints, target, sourcePosition, targetPosition)
        : [],
    [
      useOrthogonal,
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      waypoints,
    ],
  );

  const segments: Segment[] = useMemo(
    () => (useOrthogonal && points.length >= 2 ? getSegments(points) : []),
    [useOrthogonal, points],
  );

  // Smoothstep fallback for mixed-orientation edges (no clean
  // orthogonal route exists). React Flow still gives us a sensible
  // path + label coord for the fallback.
  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const edgePath = useOrthogonal ? buildOrthogonalPath(points) : smoothPath;

  // Label anchor: pick the longest segment's midpoint so the label
  // sits in clear space, not on a corner. Fall back to smoothstep
  // label coords for the mixed-orientation case.
  const labelPoint = useMemo(() => {
    if (!useOrthogonal || segments.length === 0) {
      return { x: smoothLabelX, y: smoothLabelY };
    }
    let best = segments[0];
    let bestLen = segLength(best);
    for (let i = 1; i < segments.length; i++) {
      const l = segLength(segments[i]);
      if (l > bestLen) {
        best = segments[i];
        bestLen = l;
      }
    }
    return best.midpoint;
  }, [useOrthogonal, segments, smoothLabelX, smoothLabelY]);

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

  // ── Drag state ────────────────────────────────────────────────────
  // `materialised` flips true after the FIRST move of a drag that hit
  // a source/target-anchored segment. The first move inserts the two
  // offset corners; every subsequent move treats the now-interior
  // segment as a normal interior drag (otherwise we'd insert two MORE
  // corners on every pointermove → tangled mess).
  const draggingRef = useRef<{
    segmentIndex: number;
    pointerId: number;
    direction: "H" | "V";
    materialised: boolean;
  } | null>(null);

  function pointerToFlow(e: ReactPointerEvent<SVGElement>): { x: number; y: number } {
    return screenToFlowPosition({ x: e.clientX, y: e.clientY });
  }

  function onDragStart(e: ReactPointerEvent<SVGElement>, segmentIndex: number): void {
    if (!useOrthogonal) return;
    if (segmentIndex < 0 || segmentIndex >= segments.length) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    draggingRef.current = {
      segmentIndex,
      pointerId: e.pointerId,
      direction: segments[segmentIndex].direction,
      materialised: false,
    };
  }

  function onDragMove(e: ReactPointerEvent<SVGElement>): void {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !useOrthogonal) return;

    // Recompute live segments from the LATEST store state so we know
    // the current anchoring of drag.segmentIndex.
    const liveWaypoints = getEdgeWaypoints(
      useCanvasStore.getState().edges.find((edge) => edge.id === id)?.data,
    );
    const livePoints = effectivePoints(
      source,
      liveWaypoints,
      target,
      sourcePosition,
      targetPosition,
    );
    const liveSegments = getSegments(livePoints);
    if (drag.segmentIndex >= liveSegments.length) return;
    const liveSeg = liveSegments[drag.segmentIndex];

    // Perpendicular value — read the cursor's axis matching the
    // segment's perpendicular. Stays locked to the original segment
    // direction; if the user wiggles parallel we still only read the
    // perpendicular axis.
    const cursor = pointerToFlow(e);
    const perp =
      drag.direction === "H" ? snapValue(cursor.y) : snapValue(cursor.x);

    const nextWaypoints = dragSegment({
      waypoints: liveWaypoints,
      segmentIndex: drag.segmentIndex,
      perpendicularValue: perp,
      source,
      target,
      sourcePos: sourcePosition,
      targetPos: targetPosition,
    });

    // First-move bookkeeping: if the segment we just dragged was
    // anchored to source or target, dragSegment INSERTED two new
    // corners to materialise the offset. The segment user is now
    // dragging has shifted INDEX in the new segment list:
    //   - source-anchored insert → new index = old index + 2
    //     (because two new segments are prepended before it)
    //   - target-anchored insert → new index = old index
    //     (insertion is at the END of waypoints, doesn't shift this
    //     segment's position in the list)
    // After this re-indexing, every subsequent pointermove treats
    // the user's segment as INTERIOR — no more insertions, just slide.
    if (!drag.materialised) {
      if (liveSeg.isSourceAnchored && !liveSeg.isTargetAnchored) {
        drag.segmentIndex += 2;
        drag.materialised = true;
      } else if (liveSeg.isTargetAnchored && !liveSeg.isSourceAnchored) {
        // index unchanged but flag set so we don't re-enter the
        // insertion branch on a future move.
        drag.materialised = true;
      } else {
        // Interior — nothing to materialise.
        drag.materialised = true;
      }
    }

    updateEdgeData(id, {
      waypoints: nextWaypoints.length > 0 ? nextWaypoints : undefined,
    });
  }

  function onDragEnd(e: ReactPointerEvent<SVGElement>): void {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // pointer already released by browser; ignore.
    }
    draggingRef.current = null;
  }

  // ── Context menu (right-click) ────────────────────────────────────
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function openMenu(e: ReactMouseEvent<SVGElement>): void {
    if (!useOrthogonal) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function resetRouting(): void {
    updateEdgeData(id, { waypoints: undefined });
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

  const [hovered, setHovered] = useState(false);
  const showHandles = useOrthogonal && (selected || hovered) && !isAssociation;

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

      {/* One bend-handle per segment. Each slides perpendicular to
          its own direction. */}
      {showHandles &&
        segments.map((seg, i) => {
          const cursorClass =
            seg.direction === "H" ? "ns-resize" : "ew-resize";
          return (
            <g
              key={`seg-${i}`}
              style={{ cursor: cursorClass, pointerEvents: "all" }}
              onPointerDown={(e) => onDragStart(e, i)}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              onContextMenu={openMenu}
            >
              <circle
                cx={seg.midpoint.x}
                cy={seg.midpoint.y}
                r={6}
                fill={SELECTED_COLOR}
                stroke="#fff"
                strokeWidth={2}
              />
              {/* Direction glyph: ↕ for H (drags vertically), ↔ for V
                  (drags horizontally). Two short white strokes. */}
              {seg.direction === "H" ? (
                <line
                  x1={seg.midpoint.x}
                  y1={seg.midpoint.y - 3}
                  x2={seg.midpoint.x}
                  y2={seg.midpoint.y + 3}
                  stroke="#fff"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              ) : (
                <line
                  x1={seg.midpoint.x - 3}
                  y1={seg.midpoint.y}
                  x2={seg.midpoint.x + 3}
                  y2={seg.midpoint.y}
                  stroke="#fff"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

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
              disabled={waypoints.length === 0}
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
              // Anchor the label's BOTTOM CENTRE 12px above the segment
              // midpoint so it doesn't sit on the line or steal clicks
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

function segLength(seg: Segment): number {
  return Math.abs(
    seg.direction === "H" ? seg.b.x - seg.a.x : seg.b.y - seg.a.y,
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
