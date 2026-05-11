/* ─── BpmnSequenceEdge ────────────────────────────────────────────────
 * Custom edge that renders:
 *  - The line (smoothstep path, OR a user-routed polyline when
 *    edge.data.waypoints is populated — GAP-04)
 *  - Draggable handles per waypoint + "+ here" handles per segment for
 *    inserting new waypoints
 *  - Right-click context menu: remove a waypoint, reset routing
 *  - An editable label (double-click to rename)
 *  - A default-flow slash marker near the source if data.isDefault
 *  - Highlight when selected
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
  buildPolylinePath,
  getEdgeWaypoints,
  insertWaypoint,
  mergeNearbyWaypoints,
  polylineLabelPoint,
  removeWaypoint,
  segmentMidpoints,
  snapWaypoint,
  updateWaypointAt,
  type Waypoint,
} from "./waypoints";

const SELECTED_COLOR = "#6366F1";
const DEFAULT_COLOR = "#94A3B8";
const HANDLE_FILL = "#fff";

type ContextMenuState = {
  x: number;
  y: number;
  /** index into waypoints[]; -1 means "no waypoint under cursor (edge body)". */
  waypointIndex: number;
};

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

  const waypoints = useMemo(() => getEdgeWaypoints(data), [data]);

  const source: Waypoint = { x: sourceX, y: sourceY };
  const target: Waypoint = { x: targetX, y: targetY };

  // Edge path: smoothstep when no waypoints (preserves the existing
  // look for every existing edge in every existing process); polyline
  // through user-set waypoints otherwise.
  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });
  const usePolyline = waypoints.length > 0;
  const edgePath = usePolyline ? buildPolylinePath(source, waypoints, target) : smoothPath;

  const labelPoint = usePolyline
    ? polylineLabelPoint(source, waypoints, target)
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

  // ── Drag state ────────────────────────────────────────────────────
  // A live-drag is reflected by setting `dragging` to {index, point}.
  // The store is updated on every move tick (cheap — single Map.set).
  const draggingRef = useRef<{ index: number; pointerId: number } | null>(null);

  function commitWaypoints(next: Waypoint[]): void {
    const cleaned = mergeNearbyWaypoints(next);
    updateEdgeData(id, { waypoints: cleaned.length > 0 ? cleaned : undefined });
  }

  function pointerToFlow(e: ReactPointerEvent<SVGElement>): Waypoint {
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    return snapWaypoint({ x: flow.x, y: flow.y });
  }

  function startDragExistingWaypoint(
    e: ReactPointerEvent<SVGElement>,
    index: number,
  ): void {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    draggingRef.current = { index, pointerId: e.pointerId };
  }

  function startDragNewWaypoint(
    e: ReactPointerEvent<SVGElement>,
    insertAtIndex: number,
  ): void {
    e.stopPropagation();
    e.preventDefault();
    // Insert immediately at the segment midpoint so the user "grabs" a
    // real waypoint they can drag, then continue tracking it.
    const initial = pointerToFlow(e);
    const next = insertWaypoint(waypoints, insertAtIndex, initial);
    commitWaypoints(next);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    draggingRef.current = { index: insertAtIndex, pointerId: e.pointerId };
  }

  function onDragMove(e: ReactPointerEvent<SVGElement>): void {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const next = updateWaypointAt(
      getEdgeWaypoints(useCanvasStore.getState().edges.find((edge) => edge.id === id)?.data),
      drag.index,
      pointerToFlow(e),
    );
    updateEdgeData(id, { waypoints: next.length > 0 ? next : undefined });
  }

  function onDragEnd(e: ReactPointerEvent<SVGElement>): void {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // pointer may have been released by the browser already; ignore.
    }
    draggingRef.current = null;
    // Final merge-near-duplicates pass — covers the "user dragged
    // waypoint onto its neighbour" gesture.
    const current = getEdgeWaypoints(
      useCanvasStore.getState().edges.find((edge) => edge.id === id)?.data,
    );
    commitWaypoints(current);
  }

  // ── Context menu (right-click) ────────────────────────────────────
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  function openMenuForEdge(e: ReactMouseEvent<SVGPathElement>): void {
    if (!selected) return; // only when edge is the focus
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, waypointIndex: -1 });
  }

  function openMenuForWaypoint(
    e: ReactMouseEvent<SVGCircleElement>,
    index: number,
  ): void {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, waypointIndex: index });
  }

  function handleMenuAction(action: "remove" | "reset"): void {
    if (action === "reset") {
      updateEdgeData(id, { waypoints: undefined });
    } else if (action === "remove" && menu && menu.waypointIndex >= 0) {
      const next = removeWaypoint(waypoints, menu.waypointIndex);
      updateEdgeData(id, { waypoints: next.length > 0 ? next : undefined });
    }
    setMenu(null);
  }

  // Close context menu on any outside click
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

  // Default-flow slash marker
  const slashOffset = computeSlashTransform(sourceX, sourceY, sourcePosition);

  // Show waypoint handles + midpoint "+" handles when the edge is
  // selected OR hovered. Selection alone is too discoverable — users
  // drag, they don't always click first.
  const [hovered, setHovered] = useState(false);
  const showHandles = (selected || hovered) && !isAssociation;
  // When the edge has 0 waypoints we render smoothstep — a curved
  // path that does NOT go through the straight-line midpoint of
  // source→target. So put the single "+ here" handle at React Flow's
  // own labelX/labelY (the centre of the smoothstep path) — that's
  // the only place where the handle sits ON the visible line.
  // Once the user adds even one waypoint we switch to the polyline
  // and the segment midpoints are then accurate.
  const midpoints = useMemo(() => {
    if (!showHandles) return [];
    if (waypoints.length === 0) return [{ x: smoothLabelX, y: smoothLabelY }];
    return segmentMidpoints(source, waypoints, target);
  }, [showHandles, source.x, source.y, target.x, target.y, waypoints, smoothLabelX, smoothLabelY]);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={effectiveMarkerEnd}
        style={pathStyle}
        onContextMenu={openMenuForEdge}
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

      {/* Existing waypoint handles — draggable circles. Drawn last so
          they're hit-test-first under the cursor. White fill + indigo
          stroke makes them readable against any background. */}
      {showHandles &&
        waypoints.map((w, i) => (
          <g key={`wp-${i}`}>
            <circle
              cx={w.x}
              cy={w.y}
              r={6}
              fill={HANDLE_FILL}
              stroke={SELECTED_COLOR}
              strokeWidth={2}
              style={{ cursor: "grab", pointerEvents: "all" }}
              onPointerDown={(e) => startDragExistingWaypoint(e, i)}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              onContextMenu={(e) => openMenuForWaypoint(e, i)}
            />
          </g>
        ))}

      {/* "+ here" midpoint handles — drag from one to insert a new
          waypoint. Visually distinct from existing waypoints: white
          fill + DASHED indigo stroke + tiny "+" sign so the affordance
          ("add a point") reads at a glance. Slightly larger than the
          old 4px so they don't disappear into the edge line. */}
      {showHandles &&
        midpoints.map((m, i) => (
          <g
            key={`mid-${i}`}
            style={{ cursor: "crosshair", pointerEvents: "all" }}
            onPointerDown={(e) => startDragNewWaypoint(e, i)}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <circle
              cx={m.x}
              cy={m.y}
              r={7}
              fill={SELECTED_COLOR}
              stroke="#fff"
              strokeWidth={2}
            />
            {/* White "+" glyph against the indigo fill — reads as a
                button-style "add point here" affordance. Strokes
                instead of a font glyph so it scales cleanly. */}
            <line
              x1={m.x - 3}
              y1={m.y}
              x2={m.x + 3}
              y2={m.y}
              stroke="#fff"
              strokeWidth={1.6}
              strokeLinecap="round"
              pointerEvents="none"
            />
            <line
              x1={m.x}
              y1={m.y - 3}
              x2={m.x}
              y2={m.y + 3}
              stroke="#fff"
              strokeWidth={1.6}
              strokeLinecap="round"
              pointerEvents="none"
            />
          </g>
        ))}

      {/* Context menu — HTML rendered into EdgeLabelRenderer so it
          escapes the SVG viewport transform. */}
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
            {menu.waypointIndex >= 0 && (
              <button
                onClick={() => handleMenuAction("remove")}
                style={menuItem}
              >
                Remove this waypoint
              </button>
            )}
            <button
              onClick={() => handleMenuAction("reset")}
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
              transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`,
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
