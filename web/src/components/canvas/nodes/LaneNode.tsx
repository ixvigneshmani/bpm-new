/* ─── LaneNode ────────────────────────────────────────────────────────
 * Swimlane — `bpmn:Lane`. Lives inside a pool (or another lane).
 * Rendered as a sub-strip with a narrow left label band, same
 * orientation as the containing pool. Lane contents attach via
 * React Flow `parentId`; BPMN serialize derives `flowNodeRef` from
 * that relationship.
 * ──────────────────────────────────────────────────────────────────── */

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import useCanvasStore from "../../../store/canvas-store";
import { resizeHandleStyle } from "./base/BaseTaskNode";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.lane;
const LABEL_BAND = 24;

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

const LaneNode = memo((props: NodeProps) => {
  const { id, data, selected } = props;
  const d = data as Record<string, unknown>;
  const label = (d.label as string) || "Lane";
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
    if (draft !== label) updateNodeLabel(id, draft);
  };

  const borderColor = selected ? theme.color : `${theme.color}55`;

  return (
    <div
      className="bpmn-lane"
      style={{
        position: "relative",
        width: customWidth ?? 770,
        height: customHeight ?? 120,
        background: theme.bgLight,
        border: `1px solid ${borderColor}`,
        borderRadius: 2,
        boxSizing: "border-box",
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={60}
        maxWidth={2400}
        maxHeight={600}
        handleStyle={resizeHandleStyle(theme.color)}
        lineStyle={{ border: "none" }}
        onResize={(_, params) => {
          // Same shrink clamp as PoolNode — children must stay inside.
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

      <div
        style={{
          position: "absolute",
          top: 0, left: 0, bottom: 0,
          width: LABEL_BAND,
          background: "#FFFFFF",
          borderRight: `1px solid ${theme.color}22`,
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
              fontSize: 11, fontWeight: 600, color: theme.color,
              padding: "1px 4px", border: `1px solid ${theme.color}`,
              borderRadius: 3, background: "#fff", outline: "none",
              fontFamily: "inherit", width: 100,
            }}
          />
        ) : (
          <div
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              fontSize: 11, fontWeight: 600, color: theme.color,
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
LaneNode.displayName = "LaneNode";

export default LaneNode;
