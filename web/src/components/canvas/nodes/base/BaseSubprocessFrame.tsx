/* ─── BaseSubprocessFrame ─────────────────────────────────────────────
 * Rendered when a subProcess / transaction / eventSubProcess / ad-hoc is
 * in the expanded state. It's a resizable container with a label header
 * and 4-sided connection handles. React Flow draws the actual child
 * nodes via `parentId` / `extent: 'parent'` — this component is just
 * the visual frame.
 *
 * Collapsed subprocesses render via BaseTaskNode with a `+` marker; this
 * file only handles the expanded path.
 * ──────────────────────────────────────────────────────────────────── */

import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import useCanvasStore from "../../../../store/canvas-store";
import { resizeHandleStyle } from "./BaseTaskNode";

type BaseSubprocessFrameProps = NodeProps & {
  accentColor: string;
  typeName: string;
  /** "solid" | "dashed" (event subprocess) | "double" (transaction). */
  borderStyle?: "solid" | "dashed" | "double";
  /** Tilde marker for ad-hoc. */
  adHoc?: boolean;
};

function SideHandles() {
  const sides: Array<Position> = [Position.Top, Position.Right, Position.Bottom, Position.Left];
  const transparent: CSSProperties = {
    background: "transparent", border: "none", opacity: 0,
    width: 14, height: 14,
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

function AdHocGlyph({ color }: { color: string }) {
  return (
    <svg width="18" height="12" viewBox="0 0 24 16" fill="none">
      <path d="M2 8c2-6 4-6 6 0s4 6 6 0 4-6 6 0"
        stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const BaseSubprocessFrame = memo((props: BaseSubprocessFrameProps): ReactNode => {
  const { id, data, selected, accentColor, typeName, borderStyle = "solid", adHoc } = props;
  const d = data as Record<string, unknown>;
  const label = (d.label as string) || "";
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

  const border =
    borderStyle === "double"
      ? `3px double ${selected ? accentColor : `${accentColor}80`}`
      : borderStyle === "dashed"
        ? `1.5px dashed ${selected ? accentColor : `${accentColor}80`}`
        : `1.5px solid ${selected ? accentColor : `${accentColor}66`}`;

  return (
    <div
      className="bpmn-subprocess-frame"
      style={{
        position: "relative",
        width: customWidth ?? 360,
        height: customHeight ?? 200,
        background: `${accentColor}0A`,
        border,
        borderRadius: 12,
        boxShadow: selected
          ? `0 0 0 3px ${accentColor}1A, 0 6px 18px ${accentColor}1F`
          : `0 1px 2px rgba(16,24,40,0.04)`,
        transition: "background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
        boxSizing: "border-box",
        // Make sure the frame itself catches drops over empty interior
        // area — React Flow lifts inner children above it.
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={120}
        maxWidth={1200}
        maxHeight={800}
        handleStyle={resizeHandleStyle(accentColor)}
        lineStyle={{ border: "none" }}
        onResize={(_, params) => updateNodeData(id, { width: params.width, height: params.height })}
      />

      {/* Header row */}
      <div style={{
        position: "absolute", top: 8, left: 12, right: 12,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        pointerEvents: "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto" }}>
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
                fontSize: 12, fontWeight: 600, color: "#101828",
                padding: "1px 6px", border: `1px solid ${accentColor}`,
                borderRadius: 4, background: "#fff", outline: "none",
                fontFamily: "inherit",
              }}
            />
          ) : (
            <div
              onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
              style={{ fontSize: 12, fontWeight: 600, color: "#101828", cursor: "text" }}
              title="Double-click to rename"
            >
              {label}
            </div>
          )}
          <span style={{
            fontSize: 8, fontWeight: 700, letterSpacing: "0.05em",
            textTransform: "uppercase", color: accentColor, opacity: 0.7,
          }}>{typeName}</span>
        </div>
        {adHoc && <div style={{ pointerEvents: "auto" }}><AdHocGlyph color={accentColor} /></div>}
      </div>

      <SideHandles />
    </div>
  );
});
BaseSubprocessFrame.displayName = "BaseSubprocessFrame";

export default BaseSubprocessFrame;
