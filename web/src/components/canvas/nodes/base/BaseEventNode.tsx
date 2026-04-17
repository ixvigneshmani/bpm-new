/* ─── BaseEventNode ───────────────────────────────────────────────────
 * Right-edge connect chip + corner-only aspect-locked resize.
 * Source + target handles on all 4 sides for connect & reconnect.
 * ──────────────────────────────────────────────────────────────────── */

import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { cn } from "../../../../lib/utils";
import useCanvasStore from "../../../../store/canvas-store";

export type EventVariant = "start" | "end" | "intermediateThrow" | "intermediateCatch" | "boundary";

type BaseEventProps = NodeProps & {
  icon: ReactNode;
  accentColor: string;
  bgColor: string;
  variant: EventVariant;
  isInterrupting?: boolean;
};

function RightConnectChip({ accentColor }: { accentColor: string }) {
  return (
    <div
      className="bpmn-connect-chip"
      style={{
        position: "absolute",
        top: "50%", right: -11,
        transform: "translateY(-50%)",
        width: 22, height: 22, borderRadius: "50%",
        background: "#fff",
        border: `1.5px solid ${accentColor}`,
        boxShadow: `0 1px 3px ${accentColor}40`,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 5,
        pointerEvents: "none",
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

function SideHandles({ showSource, showTarget }: { showSource: boolean; showTarget: boolean }) {
  const sides: Array<{ pos: Position; size: number }> = [
    { pos: Position.Top, size: 14 },
    { pos: Position.Right, size: 22 },
    { pos: Position.Bottom, size: 14 },
    { pos: Position.Left, size: 14 },
  ];
  const transparent: CSSProperties = { background: "transparent", border: "none", opacity: 0 };
  return (
    <>
      {sides.map(({ pos, size }) => (
        <div key={pos}>
          {showSource && (
            <Handle
              type="source"
              position={pos}
              id={`s-${pos}`}
              style={{ ...transparent, width: size, height: size, cursor: pos === Position.Right ? "crosshair" : "grab" }}
            />
          )}
          {showTarget && (
            <Handle
              type="target"
              position={pos}
              id={`t-${pos}`}
              style={{ ...transparent, width: size, height: size }}
            />
          )}
        </div>
      ))}
    </>
  );
}

const BaseEventNode = memo(({
  id,
  data,
  selected,
  icon,
  accentColor,
  bgColor,
  variant,
  isInterrupting = true,
}: BaseEventProps) => {
  const d = data as Record<string, unknown>;
  const label = d.label as string;
  const customSize = (d.width as number | undefined) ?? (d.height as number | undefined);

  const defaultSize = variant === "end" ? 48 : 46;
  const size = customSize ?? defaultSize;
  const borderWidth = variant === "end" ? 3 : 2;
  const isDouble = variant === "intermediateCatch" || variant === "intermediateThrow" || variant === "boundary";
  const isDashed = !isInterrupting && variant === "boundary";

  const showSource = variant !== "end";
  const showTarget = variant !== "start";

  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeLabel = useCanvasStore((s) => s.updateNodeLabel);

  /* Inline label edit */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label || "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(label || ""); }, [label]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const commitLabel = () => {
    setEditing(false);
    if (draft !== label) updateNodeLabel(id, draft);
  };

  return (
    <div className={`bpmn-event-node ${selected ? "is-selected" : ""} flex flex-col items-center gap-1`} style={{ position: "relative" }}>
      {/* Circle */}
      <div
        className={cn(
          "relative flex items-center justify-center transition-all duration-200",
          selected && "scale-105"
        )}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: selected ? bgColor : `${bgColor}CC`,
          border: `${borderWidth}px ${isDashed ? "dashed" : "solid"} ${selected ? accentColor : `${accentColor}88`}`,
          boxShadow: selected
            ? `0 0 0 4px ${accentColor}15, 0 4px 12px ${accentColor}15`
            : `0 2px 8px ${accentColor}10`,
          transition: "all 0.2s ease",
        }}
      >
        <NodeResizer
          isVisible={selected}
          keepAspectRatio
          minWidth={36}
          minHeight={36}
          maxWidth={96}
          maxHeight={96}
          handleStyle={resizeHandleStyle(accentColor)}
          lineStyle={{ border: "none" }}
          onResize={(_, params) => {
            updateNodeData(id, { width: params.width, height: params.height });
          }}
        />

        {isDouble && (
          <div
            className="absolute inset-[3px] rounded-full"
            style={{
              border: `1.5px ${isDashed ? "dashed" : "solid"} ${selected ? accentColor : `${accentColor}66`}`,
            }}
          />
        )}
        <div className="relative z-10 flex items-center justify-center">{icon}</div>

        {showSource && <RightConnectChip accentColor={accentColor} />}
        <SideHandles showSource={showSource} showTarget={showTarget} />
      </div>

      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitLabel();
            else if (e.key === "Escape") { setDraft(label || ""); setEditing(false); }
            e.stopPropagation();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="nodrag"
          style={{
            maxWidth: 90, textAlign: "center",
            fontSize: 11, fontWeight: 500, color: "#101828",
            padding: "1px 4px",
            border: `1px solid ${accentColor}`, borderRadius: 4,
            background: "#fff", outline: "none",
            fontFamily: "inherit",
          }}
        />
      ) : (
        <span
          className="max-w-[90px] text-center text-[11px] font-medium leading-[14px] text-gray-600"
          style={{ textShadow: "0 1px 2px rgba(255,255,255,0.8)", cursor: "text" }}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title="Double-click to rename"
        >
          {label || <span style={{ color: "#CBD5E1", fontStyle: "italic" }}>label</span>}
        </span>
      )}
    </div>
  );
});
BaseEventNode.displayName = "BaseEventNode";

function resizeHandleStyle(accentColor: string): CSSProperties {
  return {
    width: 9, height: 9, borderRadius: 2,
    background: "#fff", border: `1.5px solid ${accentColor}`, zIndex: 10,
  };
}

export default BaseEventNode;
