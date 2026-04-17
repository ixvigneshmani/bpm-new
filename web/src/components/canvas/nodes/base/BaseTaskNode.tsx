/* ─── BaseTaskNode ────────────────────────────────────────────────────
 * Soft colored card for all BPMN task types.
 *
 * Three states, three distinct affordances:
 *  - IDLE     → just the card
 *  - HOVER    → ONE "+" chip flush against the right edge (drag to connect)
 *  - SELECTED → 4 corner squares for resizing
 *
 * Source/target Handles on ALL 4 sides (invisible) so:
 *  - Outgoing connections can be drawn from the right chip
 *  - Existing edge endpoints can be re-attached to ANY side of ANY node
 * ──────────────────────────────────────────────────────────────────── */

import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import useCanvasStore from "../../../../store/canvas-store";
import type { LoopMarker, CompensationMarker } from "../../../../types/bpmn-node-data";

type BaseTaskProps = NodeProps & {
  icon: ReactNode;
  iconBg: string;
  accentColor: string;
  typeName: string;
  markers?: ReactNode;
  borderStyle?: string;
};

/* ─── Marker glyphs ─── */

function LoopGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#475467" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 4v4h-4" /><path d="M20 11a8 8 0 00-15-3" />
      <path d="M7 20v-4h4" /><path d="M4 13a8 8 0 0015 3" />
    </svg>
  );
}
function ParallelMiGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#475467" stroke="none">
      <rect x="5" y="5" width="3" height="14" rx="0.5" />
      <rect x="10.5" y="5" width="3" height="14" rx="0.5" />
      <rect x="16" y="5" width="3" height="14" rx="0.5" />
    </svg>
  );
}
function SequentialMiGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#475467" stroke="none">
      <rect x="5" y="5" width="14" height="3" rx="0.5" />
      <rect x="5" y="10.5" width="14" height="3" rx="0.5" />
      <rect x="5" y="16" width="14" height="3" rx="0.5" />
    </svg>
  );
}
function CompensationGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#475467" stroke="none">
      <polygon points="12,5 12,19 3,12" /><polygon points="22,5 22,19 13,12" />
    </svg>
  );
}

function ActivityMarkers({ loopMarker, compensation }: {
  loopMarker?: LoopMarker;
  compensation?: CompensationMarker;
}) {
  const glyphs: ReactNode[] = [];
  if (loopMarker?.kind === "standardLoop") glyphs.push(<LoopGlyph key="loop" />);
  if (loopMarker?.kind === "multiInstance") {
    glyphs.push(loopMarker.mode === "parallel"
      ? <ParallelMiGlyph key="mi" />
      : <SequentialMiGlyph key="mi" />);
  }
  if (compensation?.enabled) glyphs.push(<CompensationGlyph key="comp" />);
  if (glyphs.length === 0) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      marginTop: 6,
    }}>
      {glyphs}
    </div>
  );
}

/* ─── Connect chip on the right edge ───────────────────────────────
 * Visual decoration only (`pointer-events: none`). The actual source
 * Handle sits behind it on the right edge so the line originates
 * exactly at the node boundary.
 * ────────────────────────────────────────────────────────────────── */
function RightConnectChip({ accentColor }: { accentColor: string }) {
  return (
    <div
      className="bpmn-connect-chip"
      style={{
        position: "absolute",
        top: "50%", right: -11,           // chip CENTER sits exactly at node's right edge
        transform: "translateY(-50%)",
        width: 22, height: 22,
        borderRadius: "50%",
        background: "#fff",
        border: `1.5px solid ${accentColor}`,
        boxShadow: `0 1px 3px ${accentColor}40`,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 5,
        pointerEvents: "none",            // purely visual; Handle below catches drags
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
        stroke={accentColor} strokeWidth="3" strokeLinecap="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </div>
  );
}

/* ─── Side handles ─────────────────────────────────────────────────
 * 4 source + 4 target handles, one per side, invisible.
 * The right source handle is enlarged so users can grab the visible
 * chip area easily.
 * ────────────────────────────────────────────────────────────────── */
function SideHandles() {
  const sides: Array<{ pos: Position; handleStyle: CSSProperties }> = [
    { pos: Position.Top,    handleStyle: { width: 14, height: 14 } },
    { pos: Position.Right,  handleStyle: { width: 22, height: 22 } }, // larger for chip
    { pos: Position.Bottom, handleStyle: { width: 14, height: 14 } },
    { pos: Position.Left,   handleStyle: { width: 14, height: 14 } },
  ];

  const transparent: CSSProperties = {
    background: "transparent",
    border: "none",
    opacity: 0,
  };

  return (
    <>
      {sides.map(({ pos, handleStyle }) => (
        <div key={pos}>
          <Handle
            type="source"
            position={pos}
            id={`s-${pos}`}
            style={{ ...transparent, ...handleStyle, cursor: pos === Position.Right ? "crosshair" : "grab" }}
          />
          <Handle
            type="target"
            position={pos}
            id={`t-${pos}`}
            style={{ ...transparent, ...handleStyle }}
          />
        </div>
      ))}
    </>
  );
}

const BaseTaskNode = memo(({
  id,
  data,
  selected,
  icon,
  accentColor,
  typeName,
  markers,
  borderStyle = "solid",
}: BaseTaskProps) => {
  const d = data as Record<string, unknown>;
  const label = d.label as string;
  const loopMarker = d.loopMarker as LoopMarker | undefined;
  const compensation = d.compensation as CompensationMarker | undefined;
  const customWidth = d.width as number | undefined;
  const customHeight = d.height as number | undefined;

  // Pull updaters
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeLabel = useCanvasStore((s) => s.updateNodeLabel);

  /* Inline label edit (double-click) */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(label); }, [label]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const commitLabel = () => {
    setEditing(false);
    if (draft !== label) updateNodeLabel(id, draft);
  };

  const bgTint = `${accentColor}14`;
  const bgTintHover = `${accentColor}1F`;
  const borderColor = selected ? accentColor : `${accentColor}40`;
  const borderWidth = borderStyle === "double" ? "3px double" : "1.5px solid";

  return (
    <div
      className={`bpmn-task-node ${selected ? "is-selected" : ""}`}
      style={{
        position: "relative",
        width: customWidth ?? 128,
        height: customHeight ?? 62,
        padding: "8px 10px",
        background: selected ? bgTintHover : bgTint,
        border: `${borderWidth} ${borderColor}`,
        borderRadius: 10,
        boxShadow: selected
          ? `0 0 0 3px ${accentColor}1A, 0 4px 10px ${accentColor}1F`
          : `0 1px 2px rgba(16,24,40,0.04), 0 2px 6px ${accentColor}0D`,
        transition: "background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
        display: "flex",
        flexDirection: "column",
        cursor: "grab",
        boxSizing: "border-box",
      }}
    >
      {/* RESIZE — corners only when selected. onResize writes back to data
          so the inline width/height re-renders. */}
      <NodeResizer
        isVisible={selected}
        minWidth={96}
        minHeight={48}
        maxWidth={400}
        maxHeight={240}
        handleStyle={resizeHandleStyle(accentColor)}
        lineStyle={{ border: "none" }}
        onResize={(_, params) => {
          updateNodeData(id, { width: params.width, height: params.height });
        }}
      />

      {/* Top row */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          color: accentColor, opacity: 0.95,
        }}>
          {icon}
        </div>
        <span style={{
          fontSize: 8, fontWeight: 700, letterSpacing: "0.05em",
          textTransform: "uppercase", color: accentColor, opacity: 0.7,
          whiteSpace: "nowrap",
        }}>
          {typeName}
        </span>
      </div>

      {/* Label — double-click to edit */}
      <div style={{
        flex: 1,
        display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
        marginTop: 4, textAlign: "center",
      }}>
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
              else if (e.key === "Escape") {
                setDraft(label);
                setEditing(false);
              }
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag"
            style={{
              fontSize: 11.5, fontWeight: 600, color: "#101828",
              lineHeight: 1.25, textAlign: "center",
              width: "100%", padding: "1px 4px",
              border: `1px solid ${accentColor}`, borderRadius: 4,
              background: "#fff", outline: "none",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <div
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
            style={{
              fontSize: 11.5, fontWeight: 600, color: "#101828",
              lineHeight: 1.25, wordBreak: "break-word",
              display: "-webkit-box", WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical" as const, overflow: "hidden",
              cursor: "text",
            }}
            title="Double-click to rename"
          >
            {label}
          </div>
        )}
        <ActivityMarkers loopMarker={loopMarker} compensation={compensation} />
        {markers}
      </div>

      {/* CONNECT chip — visual only, hidden when selected (CSS) */}
      <RightConnectChip accentColor={accentColor} />

      {/* All 4 sides: source + target handles for connect & reconnect */}
      <SideHandles />
    </div>
  );
});
BaseTaskNode.displayName = "BaseTaskNode";

export function resizeHandleStyle(accentColor: string): CSSProperties {
  return {
    width: 9, height: 9,
    borderRadius: 2,
    background: "#fff",
    border: `1.5px solid ${accentColor}`,
    zIndex: 10,
  };
}

export default BaseTaskNode;
