/* ─── TextAnnotationNode ──────────────────────────────────────────────
 * BPMN 2.0 §10.4.2 — open-bracket sticky-note. Label is the body and
 * is edited inline (multiline allowed). Connects via associations.
 * ──────────────────────────────────────────────────────────────────── */

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { NODE_THEMES } from "../../../types/bpmn-node-data";
import useCanvasStore from "../../../store/canvas-store";

const theme = NODE_THEMES.textAnnotation;

function SideHandles() {
  const transparent: CSSProperties = { background: "transparent", border: "none", opacity: 0 };
  return (
    <>
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].map((pos) => (
        <div key={pos}>
          <Handle type="source" position={pos} id={`s-${pos}`} style={{ ...transparent, width: 12, height: 12 }} />
          <Handle type="target" position={pos} id={`t-${pos}`} style={{ ...transparent, width: 12, height: 12 }} />
        </div>
      ))}
    </>
  );
}

const TextAnnotationNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as Record<string, unknown>;
  const body = (d.label as string) ?? "";
  const width = (d.width as number | undefined) ?? 180;
  const height = (d.height as number | undefined) ?? 70;

  const updateNodeLabel = useCanvasStore((s) => s.updateNodeLabel);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(body); }, [body]);
  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [editing]);
  const commit = () => {
    setEditing(false);
    if (draft !== body) updateNodeLabel(id, draft);
  };

  const bracketSize = 10;

  return (
    <div
      style={{ position: "relative", width, height, cursor: "default" }}
      onDoubleClick={() => setEditing(true)}
    >
      <NodeResizer
        isVisible={!!selected}
        minWidth={100}
        minHeight={40}
        handleStyle={{ width: 8, height: 8, background: "#fff", border: `1.5px solid ${theme.color}` }}
        lineStyle={{ border: "none" }}
      />
      {/* Left-side open bracket. BPMN draws three strokes: top-leading,
          vertical, bottom-trailing. No bottom or right border. */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
      >
        <path
          d={`
            M ${bracketSize} 1
            L 1 1
            L 1 ${height - 1}
            L ${bracketSize} ${height - 1}
          `}
          fill="none"
          stroke={theme.color}
          strokeWidth={1.5}
        />
        <rect
          x={bracketSize} y={1} width={width - bracketSize - 1} height={height - 2}
          fill={selected ? theme.bgSelected : theme.bgLight}
          stroke="none"
          opacity={selected ? 1 : 0.6}
        />
      </svg>
      <SideHandles />
      <div
        style={{
          position: "absolute",
          top: 4, left: bracketSize + 6,
          right: 6, bottom: 4,
          fontSize: 11, color: "#101828",
          lineHeight: 1.4,
          whiteSpace: "pre-wrap",
          overflow: "hidden",
        }}
      >
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter commits; plain Enter inserts newline.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDraft(body);
                setEditing(false);
              }
            }}
            style={{
              width: "100%", height: "100%",
              border: "none", background: "transparent",
              fontFamily: "inherit", fontSize: 11, color: "#101828",
              lineHeight: 1.4, resize: "none", outline: "none",
            }}
          />
        ) : (
          <span style={{ cursor: "text" }} onDoubleClick={() => setEditing(true)}>
            {body || <span style={{ color: "#98a2b3", fontStyle: "italic" }}>Double-click to edit</span>}
          </span>
        )}
      </div>
    </div>
  );
});
TextAnnotationNode.displayName = "TextAnnotationNode";

export default TextAnnotationNode;
