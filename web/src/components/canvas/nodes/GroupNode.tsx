/* ─── GroupNode ───────────────────────────────────────────────────────
 * BPMN 2.0 §10.4.3 — dashed rounded rectangle with a category label at
 * top-left. Groups are visual-only: they do not influence flow scope
 * or containment, so no `parentId` semantics and no handles.
 * ──────────────────────────────────────────────────────────────────── */

import { memo, useEffect, useRef, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { NODE_THEMES } from "../../../types/bpmn-node-data";
import useCanvasStore from "../../../store/canvas-store";

const theme = NODE_THEMES.group;

const GroupNode = memo(({ id, data, selected }: NodeProps) => {
  const d = data as Record<string, unknown>;
  const label = (d.label as string) ?? "";
  const width = (d.width as number | undefined) ?? 320;
  const height = (d.height as number | undefined) ?? 200;

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

  return (
    <div
      style={{
        position: "relative",
        width, height,
        border: `1.5px dashed ${theme.color}`,
        borderRadius: 14,
        background: selected ? theme.bgSelected : "transparent",
        // No pointer events on the interior so the user can still click
        // through to flow nodes inside the group's bounds.
        pointerEvents: "none",
      }}
    >
      <NodeResizer
        isVisible={!!selected}
        minWidth={120}
        minHeight={80}
        handleStyle={{ width: 8, height: 8, background: "#fff", border: `1.5px solid ${theme.color}`, pointerEvents: "auto" }}
        lineStyle={{ border: "none" }}
      />
      {/* Category label — top-left corner. pointer-events re-enabled so
          the user can click/edit the label. */}
      <div
        style={{
          position: "absolute",
          top: 6, left: 10,
          fontSize: 11, fontWeight: 600,
          color: theme.color,
          padding: "2px 6px",
          background: "#fff",
          borderRadius: 4,
          pointerEvents: "auto",
          cursor: "text",
        }}
        onDoubleClick={() => setEditing(true)}
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
              width: Math.max(80, draft.length * 7 + 20),
              background: "#fff",
              border: `1px solid ${theme.color}`,
              borderRadius: 3,
              fontSize: 11, fontWeight: 600,
              color: theme.color,
              padding: "0 4px",
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        ) : (
          <span>{label || "Group"}</span>
        )}
      </div>
    </div>
  );
});
GroupNode.displayName = "GroupNode";

export default GroupNode;
