/* ─── DataStoreNode ───────────────────────────────────────────────────
 * BPMN 2.0 §10.4.4 — cylinder (persistent store external to process).
 * ──────────────────────────────────────────────────────────────────── */

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { NODE_THEMES } from "../../../types/bpmn-node-data";
import useCanvasStore from "../../../store/canvas-store";

const theme = NODE_THEMES.dataStore;

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

const DataStoreNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as Record<string, unknown>;
  const label = (d.label as string) ?? "";
  const width = (d.width as number | undefined) ?? 60;
  const height = (d.height as number | undefined) ?? 54;

  const updateNodeLabel = useCanvasStore((s) => s.updateNodeLabel);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(label); }, [label]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const commit = () => {
    setEditing(false);
    if (draft !== label) updateNodeLabel(id, draft);
  };

  const ellipseH = Math.min(14, Math.floor(height * 0.28));

  return (
    <div
      style={{ position: "relative", width, height, cursor: "default" }}
      onDoubleClick={() => setEditing(true)}
    >
      <NodeResizer
        isVisible={!!selected}
        minWidth={50}
        minHeight={46}
        handleStyle={{ width: 8, height: 8, background: "#fff", border: `1.5px solid ${theme.color}` }}
        lineStyle={{ border: "none" }}
      />
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        {/* Body: left wall, bottom ellipse, right wall, top ellipse. */}
        <path
          d={`
            M 1 ${ellipseH / 2 + 1}
            L 1 ${height - ellipseH / 2 - 1}
            A ${(width - 2) / 2} ${ellipseH / 2} 0 0 0 ${width - 1} ${height - ellipseH / 2 - 1}
            L ${width - 1} ${ellipseH / 2 + 1}
          `}
          fill={selected ? theme.bgSelected : "#fff"}
          stroke={theme.color}
          strokeWidth={1.5}
        />
        {/* Top ellipse (full) */}
        <ellipse
          cx={width / 2} cy={ellipseH / 2 + 1}
          rx={(width - 2) / 2} ry={ellipseH / 2}
          fill={selected ? theme.bgSelected : "#fff"}
          stroke={theme.color}
          strokeWidth={1.5}
        />
        {/* Interior "shelf" lines for the 3D feel */}
        <path
          d={`M 2 ${ellipseH / 2 + 4} A ${(width - 4) / 2} ${ellipseH / 2 - 2} 0 0 0 ${width - 2} ${ellipseH / 2 + 4}`}
          fill="none"
          stroke={theme.color}
          strokeWidth={1}
          opacity={0.6}
        />
        <path
          d={`M 2 ${ellipseH / 2 + 8} A ${(width - 4) / 2} ${ellipseH / 2 - 2} 0 0 0 ${width - 2} ${ellipseH / 2 + 8}`}
          fill="none"
          stroke={theme.color}
          strokeWidth={1}
          opacity={0.6}
        />
      </svg>
      <SideHandles />
      <div
        style={{
          position: "absolute",
          top: height + 2, left: "50%",
          transform: "translateX(-50%)",
          fontSize: 11, color: "#101828",
          whiteSpace: "nowrap", pointerEvents: editing ? "auto" : "none",
          fontWeight: 500,
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); setDraft(label); setEditing(false); }
            }}
            style={{
              textAlign: "center",
              background: "#fff",
              border: `1px solid ${theme.color}`,
              borderRadius: 4,
              fontSize: 11,
              padding: "1px 4px",
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        ) : (
          <span style={{ pointerEvents: "auto", cursor: "text" }} onDoubleClick={() => setEditing(true)}>
            {label || "Data Store"}
          </span>
        )}
      </div>
    </div>
  );
});
DataStoreNode.displayName = "DataStoreNode";

export default DataStoreNode;
