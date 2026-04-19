/* ─── PoolNode ────────────────────────────────────────────────────────
 * Renders a BPMN 2.0 Participant (pool). A horizontal strip with a 30px
 * vertical label band on the left, the rest is an empty plane that
 * children (flow nodes, lanes — lanes land in P6.3) live inside via
 * React Flow's parentId + extent:'parent'.
 *
 * Pools are root-only (enforced by the canvas store). They can't nest.
 * ──────────────────────────────────────────────────────────────────── */

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import useCanvasStore from "../../../store/canvas-store";
import { resizeHandleStyle } from "./base/BaseTaskNode";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.pool;
const LABEL_BAND = 30;

function SideHandles({ enabled }: { enabled: boolean }) {
  const sides: Array<Position> = [Position.Top, Position.Right, Position.Bottom, Position.Left];
  const transparent: CSSProperties = {
    background: "transparent", border: "none", opacity: 0,
    width: 14, height: 14,
    pointerEvents: enabled ? "auto" : "none",
  };
  return (
    <>
      {sides.map((pos) => (
        <div key={pos}>
          <Handle type="source" position={pos} id={`s-${pos}`} style={transparent} />
          <Handle type="target" position={pos} id={`t-${pos}`} style={transparent} />
        </div>
      ))}
    </>
  );
}

const PoolNode = memo((props: NodeProps) => {
  const { id, data, selected } = props;
  const d = data as Record<string, unknown>;
  const label = (d.participantName as string) || (d.label as string) || "Pool";
  const customWidth = d.width as number | undefined;
  const customHeight = d.height as number | undefined;

  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeLabel = useCanvasStore((s) => s.updateNodeLabel);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(label); }, [label]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const commitLabel = () => {
    setEditing(false);
    if (draft !== label) {
      updateNodeLabel(id, draft);
      updateNodeData(id, { participantName: draft });
    }
  };

  const borderColor = selected ? theme.color : `${theme.color}66`;

  return (
    <div
      className="bpmn-pool"
      style={{
        position: "relative",
        width: customWidth ?? 800,
        height: customHeight ?? 240,
        background: "#FFFFFF",
        border: `1.5px solid ${borderColor}`,
        borderRadius: 4,
        boxShadow: selected
          ? `0 0 0 3px ${theme.color}1A, 0 6px 18px ${theme.color}1F`
          : `0 1px 2px rgba(16,24,40,0.04)`,
        boxSizing: "border-box",
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={400}
        minHeight={120}
        maxWidth={2400}
        maxHeight={1200}
        handleStyle={resizeHandleStyle(theme.color)}
        lineStyle={{ border: "none" }}
        onResize={(_, params) => {
          // Clamp shrink so the pool never ends up smaller than the
          // bounding rect of its descendants — React Flow's
          // `extent:'parent'` would otherwise clamp children into the
          // shrunken box and silently relocate them.
          const store = useCanvasStore.getState();
          const kids = store.nodes.filter((n) => n.parentId === id);
          let minW = 0, minH = 0;
          for (const k of kids) {
            const kd = (k.data || {}) as { width?: number; height?: number };
            const kw = kd.width ?? k.width ?? 120;
            const kh = kd.height ?? k.height ?? 80;
            minW = Math.max(minW, (k.position?.x ?? 0) + kw);
            minH = Math.max(minH, (k.position?.y ?? 0) + kh);
          }
          const w = Math.max(params.width, minW);
          const h = Math.max(params.height, minH);
          updateNodeData(id, { width: w, height: h });
        }}
      />

      {/* Left label band */}
      <div
        style={{
          position: "absolute",
          top: 0, left: 0, bottom: 0,
          width: LABEL_BAND,
          background: theme.bgSelected,
          borderRight: `1px solid ${theme.color}33`,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "auto",
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
              else if (e.key === "Escape") { setDraft(label); setEditing(false); }
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag"
            style={{
              fontSize: 12, fontWeight: 600, color: theme.color,
              padding: "2px 6px", border: `1px solid ${theme.color}`,
              borderRadius: 4, background: "#fff", outline: "none",
              fontFamily: "inherit",
              transform: "rotate(-90deg)", transformOrigin: "center",
              width: 140,
            }}
          />
        ) : (
          <div
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              fontSize: 12, fontWeight: 700, color: theme.color,
              letterSpacing: "0.04em",
              cursor: "text",
            }}
            title="Double-click to rename"
          >
            {label}
          </div>
        )}
      </div>

      <SideHandles enabled={!!selected} />
    </div>
  );
});
PoolNode.displayName = "PoolNode";

export default PoolNode;
