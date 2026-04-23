/* ─── Console: Instance Canvas (read-only overlay) ────────────────────
 * Renders the process canvas in view-only mode with overlay styling
 * that reflects the live instance state:
 *
 *   • completed nodes → green tint (the token passed through)
 *   • waiting node(s) → amber halo (the token is here right now)
 *   • failed nodes    → red tint
 *   • traversed edges → indigo bold
 *   • unvisited edges → dim grey
 *
 * Industry-standard operator view — matches Camunda Cockpit / Zeebe
 * Operate. Reuses the same node + edge components the designer uses;
 * state is layered purely via ReactFlow node/edge className.
 * ──────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "../../components/canvas/nodes";
import { edgeTypes } from "../../components/canvas/edges";

type CanvasNode = {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
  width?: number;
  height?: number;
  parentId?: string;
};

type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  type?: string;
  data?: Record<string, unknown>;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

type CanvasPayload = {
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
};

type InstanceEvent = {
  eventType: string;
  nodeId: string | null;
  payload: unknown;
};

type TokenState = {
  currentNodeId: string;
  status: "active" | "waiting" | "completed" | "failed";
};

export default function InstanceCanvas(props: {
  canvas: CanvasPayload;
  tokens: TokenState[];
  events: InstanceEvent[];
  onSelectNode?: (nodeId: string | null) => void;
  selectedNodeId?: string | null;
  height?: number;
}) {
  const { canvas, tokens, events, onSelectNode, selectedNodeId, height = 520 } = props;

  // Derive the visual state from events + tokens.
  const { waitingSet, failedSet, completedSet, traversedEdgeSet } = useMemo(() => {
    const waiting = new Set<string>();
    const failed = new Set<string>();
    const completed = new Set<string>();
    const traversed = new Set<string>();

    // Node state from tokens.
    for (const t of tokens) {
      if (t.status === "waiting") waiting.add(t.currentNodeId);
      if (t.status === "failed") failed.add(t.currentNodeId);
    }

    // node-entered / node-exited build the "visited" set. A node that
    // was entered AND exited is completed; one that was entered but not
    // exited is still in-flight (waiting/active/failed, already handled
    // above). We reconstruct by counting enters vs exits per node.
    const entered = new Map<string, number>();
    const exited = new Map<string, number>();
    for (const e of events) {
      if (!e.nodeId) continue;
      if (e.eventType === "node-entered") entered.set(e.nodeId, (entered.get(e.nodeId) ?? 0) + 1);
      if (e.eventType === "node-exited") exited.set(e.nodeId, (exited.get(e.nodeId) ?? 0) + 1);
      if (e.eventType === "edge-taken" && e.payload && typeof e.payload === "object") {
        const edgeId = (e.payload as { edgeId?: string }).edgeId;
        if (edgeId) traversed.add(edgeId);
      }
    }
    for (const [nodeId, enterCount] of entered) {
      const exitCount = exited.get(nodeId) ?? 0;
      // Completed: every enter had a matching exit AND the node isn't
      // currently waiting/failed (those win). Partial exits (enter > exit)
      // mean a token is still in-flight there.
      if (exitCount >= enterCount && !waiting.has(nodeId) && !failed.has(nodeId)) {
        completed.add(nodeId);
      }
    }

    return { waitingSet: waiting, failedSet: failed, completedSet: completed, traversedEdgeSet: traversed };
  }, [tokens, events]);

  const rfNodes: Node[] = useMemo(() => {
    return (canvas.nodes ?? []).map((n) => {
      const classes: string[] = [];
      if (failedSet.has(n.id)) classes.push("inst-node-failed");
      else if (waitingSet.has(n.id)) classes.push("inst-node-waiting");
      else if (completedSet.has(n.id)) classes.push("inst-node-completed");
      else classes.push("inst-node-unvisited");
      if (selectedNodeId === n.id) classes.push("inst-node-selected");
      return {
        id: n.id,
        type: n.type,
        position: n.position ?? { x: 0, y: 0 },
        data: n.data ?? {},
        width: n.width,
        height: n.height,
        parentId: n.parentId,
        draggable: false,
        connectable: false,
        selectable: true,
        className: classes.join(" "),
      };
    });
  }, [canvas.nodes, waitingSet, failedSet, completedSet, selectedNodeId]);

  const rfEdges: Edge[] = useMemo(() => {
    return (canvas.edges ?? []).map((e) => {
      const traversed = traversedEdgeSet.has(e.id);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        data: e.data,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        className: traversed ? "inst-edge-traversed" : "inst-edge-unvisited",
      };
    });
  }, [canvas.edges, traversedEdgeSet]);

  return (
    <div style={{ height, border: "1px solid #EAECF0", borderRadius: 10, overflow: "hidden", background: "#F8FAFC", position: "relative" }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        onNodeClick={(_, node) => onSelectNode?.(node.id)}
        onPaneClick={() => onSelectNode?.(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="#CBD5E1" gap={20} size={1} />
        <MiniMap pannable zoomable style={{ background: "#fff", border: "1px solid #EAECF0" }} />
      </ReactFlow>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div style={{
      position: "absolute", bottom: 10, left: 10, padding: "8px 10px",
      background: "rgba(255,255,255,0.95)", border: "1px solid #EAECF0", borderRadius: 8,
      display: "flex", gap: 12, fontSize: 11, color: "#475467", alignItems: "center",
    }}>
      <LegendSwatch color="#10B981" label="Completed" />
      <LegendSwatch color="#F59E0B" label="Waiting" />
      <LegendSwatch color="#EF4444" label="Failed" />
      <LegendSwatch color="#D1D5DB" label="Unvisited" />
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}
