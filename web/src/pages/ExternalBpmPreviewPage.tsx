/* ─── External BPM preview page ──────────────────────────────────────
 * Renders a webMethods process model in a read-only React Flow canvas,
 * reusing the same BPMN node + edge components the Designer uses so the
 * look-and-feel matches. No data is persisted anywhere; the model is
 * fetched live from the API every visit.
 *
 * Layout notes:
 *  • Coordinates come straight from the webMethods Designer (via
 *    WMSTEPDEFINITION for nodes, BPD XML <bendpoint> for edge
 *    waypoints, <swimlane> for pool/lane structure).
 *  • SCALE blows the source ICON_ coords (~90 px) up to BPMN-rendered
 *    sizes (~180 px) so adjacent nodes don't overlap.
 *  • Each edge picks an explicit sourceHandle / targetHandle from the
 *    BPD XML's sourceTerminal / targetTerminal so the orthogonal
 *    router attaches to the side the designer authored.
 *  • Swimlane bg color comes from the BPD's red/green/blue attrs
 *    (webMethods' soft yellow #ffffcc).
 * ────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { apiGet } from "../lib/api";
import { nodeTypes } from "../components/canvas/nodes";
import { edgeTypes } from "../components/canvas/edges";

/** webMethods → BPMN coordinate scale. 2.6× gives the BPMN-sized nodes
 *  enough room to breathe without losing the original spatial layout. */
const SCALE = 2.6;

/** Fallback fill when a swimlane's BPD XML didn't carry a colour. Soft
 *  alternating greys keep adjacent lanes visually distinct. */
const FALLBACK_LANE_FILLS = ["#FAFBFC", "#F4F6F8"];

/** Default colour for the lane LABEL band when the BPD didn't carry
 *  one — slightly stronger tint than the body fill so the label stands
 *  out against the lane background. */
const FALLBACK_LANE_LABEL_FILL = "#E5E7EB";

/** Match the Designer's edge defaults so transitions render with the
 *  same arrow style — sequence-flow filled arrowhead in slate-400.
 *  Mirrors DEFAULT_EDGE_OPTIONS in DesignCanvasPage.tsx. */
const DEFAULT_EDGE_OPTIONS = {
  type: "sequence" as const,
  style: { stroke: "#94A3B8", strokeWidth: 1.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 18,
    height: 18,
    color: "#94A3B8",
  },
};

interface ExternalNode {
  id: string;
  type: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

interface ExternalEdge {
  id: string;
  source: string;
  target: string;
  /** Pre-computed by the API from the BPD XML's terminal hints; null
   *  when the source XML didn't carry one, in which case we fall back
   *  to a geometric guess client-side. */
  sourceHandle: string | null;
  targetHandle: string | null;
  conditional: boolean;
  label: string | null;
  /** Designer-authored bendpoints from the BPD XML, in canvas-absolute
   *  coordinates. Empty when the edge was drawn straight. */
  waypoints: Array<{ x: number; y: number }>;
  conditionText: string | null;
}

interface ExternalContainer {
  type: "pool" | "lane";
  id: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
  /** "horizontal" = row (label on left), "vertical" = column (label on top). */
  orientation?: "horizontal" | "vertical";
  bgColor?: string | null;
  labelBgColor?: string | null;
}

interface ExternalGraph {
  model: {
    processKey: string;
    modelVersion: string;
    deploymentVersion: number;
    label: string | null;
    enabled: boolean;
    deploymentTime: string | null;
  };
  containers: ExternalContainer[];
  nodes: ExternalNode[];
  edges: ExternalEdge[];
}

/** Pick the cleanest source/target handles on a BPMN node pair, given
 *  their absolute centers. The Designer's nodes expose s-{top|right|
 *  bottom|left} and t-{top|right|bottom|left}. */
function pickHandles(
  src: { x: number; y: number },
  tgt: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "s-right", targetHandle: "t-left" }
      : { sourceHandle: "s-left", targetHandle: "t-right" };
  }
  return dy >= 0
    ? { sourceHandle: "s-bottom", targetHandle: "t-top" }
    : { sourceHandle: "s-top", targetHandle: "t-bottom" };
}

function PreviewInner() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const processKey = params.get("processKey") ?? "";
  const modelVersion = params.get("modelVersion") ?? "";
  const deploymentVersion = params.get("deploymentVersion") ?? "";

  const [graph, setGraph] = useState<ExternalGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        processKey,
        modelVersion,
        deploymentVersion,
      }).toString();
      const data = await apiGet<ExternalGraph>(`/external-bpm/models/preview?${qs}`);
      setGraph(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [processKey, modelVersion, deploymentVersion]);

  useEffect(() => {
    if (processKey && modelVersion && deploymentVersion) {
      load();
    }
  }, [load, processKey, modelVersion, deploymentVersion]);

  const rfNodes: Node[] = useMemo(() => {
    if (!graph) return [];
    const containers = graph.containers ?? [];

    const out: Node[] = [];

    // Pools at the bottom of the z-stack.
    for (const c of containers.filter((c) => c.type === "pool")) {
      out.push({
        id: c.id,
        type: "pool",
        position: { x: c.x * SCALE, y: c.y * SCALE },
        data: {
          label: c.label ?? "Pool",
          participantName: c.label ?? "Pool",
          width: c.width * SCALE,
          height: c.height * SCALE,
        },
        width: c.width * SCALE,
        height: c.height * SCALE,
        draggable: false,
        selectable: false,
      });
    }

    // Swimlanes on top of the pool, with the BPD's authored fill color
    // (or a soft alternating fallback) so adjacent lanes read distinctly.
    const lanes = containers.filter((c) => c.type === "lane");
    lanes.forEach((c, i) => {
      const isHorizontal = c.orientation !== "vertical";
      const bg = c.bgColor ?? FALLBACK_LANE_FILLS[i % FALLBACK_LANE_FILLS.length];
      const labelBg = c.labelBgColor ?? FALLBACK_LANE_LABEL_FILL;
      out.push({
        id: c.id,
        type: "lane",
        parentId: c.parentId ?? undefined,
        extent: c.parentId ? "parent" : undefined,
        position: { x: c.x * SCALE, y: c.y * SCALE },
        data: {
          label: c.label ?? "",
          width: c.width * SCALE,
          height: c.height * SCALE,
          isHorizontal,
        },
        width: c.width * SCALE,
        height: c.height * SCALE,
        draggable: false,
        selectable: false,
        // Override the LaneNode's default visuals with the source colors.
        // CSS custom properties propagate inward so the label band picks
        // up its tint without us forking the node component.
        style: {
          background: bg,
          ["--lane-label-bg" as string]: labelBg,
        },
      });
    });

    // Steps last (z-stack top). When the step is in a swimlane, its
    // position has already been transformed to be lane-relative.
    for (const n of graph.nodes) {
      out.push({
        id: n.id,
        type: n.type,
        parentId: n.parentId ?? undefined,
        extent: n.parentId ? "parent" : undefined,
        position: { x: n.x * SCALE, y: n.y * SCALE },
        data: { label: n.label ?? "" },
        draggable: false,
        selectable: true,
        connectable: false,
      });
    }

    return out;
  }, [graph]);

  const rfEdges: Edge[] = useMemo(() => {
    if (!graph) return [];
    const containers = graph.containers ?? [];

    // Walk the parent chain so a step nested step → swimlane → pool
    // gets all three absolute offsets summed for centre computation.
    const containerById = new Map(containers.map((c) => [c.id, c]));
    function absoluteOrigin(parentId: string | null): { x: number; y: number } {
      let x = 0;
      let y = 0;
      let cur = parentId;
      while (cur) {
        const c = containerById.get(cur);
        if (!c) break;
        x += c.x * SCALE;
        y += c.y * SCALE;
        cur = c.parentId;
      }
      return { x, y };
    }
    const stepCenter = new Map<string, { x: number; y: number }>();
    for (const n of graph.nodes) {
      const origin = absoluteOrigin(n.parentId);
      const baseX = origin.x + n.x * SCALE;
      const baseY = origin.y + n.y * SCALE;
      stepCenter.set(n.id, {
        x: baseX + (n.width * SCALE) / 2,
        y: baseY + (n.height * SCALE) / 2,
      });
    }

    return graph.edges.map((e) => {
      // Prefer API-supplied handles (BPD terminal hints); fall back to
      // a geometric guess when the XML omitted them.
      let sourceHandle = e.sourceHandle;
      let targetHandle = e.targetHandle;
      if (!sourceHandle || !targetHandle) {
        const src = stepCenter.get(e.source);
        const tgt = stepCenter.get(e.target);
        const guess =
          src && tgt
            ? pickHandles(src, tgt)
            : { sourceHandle: "s-right", targetHandle: "t-left" };
        sourceHandle ??= guess.sourceHandle;
        targetHandle ??= guess.targetHandle;
      }
      const scaledWaypoints = e.waypoints?.length
        ? e.waypoints.map((p) => ({ x: p.x * SCALE, y: p.y * SCALE }))
        : [];
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle,
        targetHandle,
        type: "sequence",
        label: e.label ?? undefined,
        style: e.conditional ? { strokeDasharray: "5 4" } : undefined,
        data: {
          isConditional: e.conditional,
          waypoints: scaledWaypoints,
          conditionText: e.conditionText,
        },
      };
    });
  }, [graph]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-slate-200 bg-white">
        <div className="min-w-0">
          <button
            onClick={() => navigate("/external-bpm")}
            className="text-xs text-indigo-600 hover:text-indigo-800 mb-1 cursor-pointer"
          >
            ← Back to External Processes
          </button>
          <h1 className="text-lg font-semibold text-slate-800 truncate">
            {graph?.model.label ?? "Loading…"}
          </h1>
          <p className="text-xs text-slate-500 font-mono truncate">
            {processKey} · v{modelVersion} · deploy {deploymentVersion}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {graph && (
            <>
              <span>
                {(graph.containers ?? []).filter((c) => c.type === "pool").length} pool
                {(graph.containers ?? []).filter((c) => c.type === "pool").length === 1 ? "" : "s"}
              </span>
              <span>·</span>
              <span>
                {(graph.containers ?? []).filter((c) => c.type === "lane").length}{" "}
                swimlanes
              </span>
              <span>·</span>
              <span>{graph.nodes.length} nodes</span>
              <span>·</span>
              <span>{graph.edges.length} edges</span>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 relative bg-slate-50">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 z-10">
            Loading model from webMethods…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600 z-10 p-6 text-center">
            Failed to load: {error}
          </div>
        )}
        {!loading && !error && graph && (
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
            fitView
            // Cap the zoom-out: for big multi-swimlane diagrams fitView
            // would otherwise shrink everything to unreadable size.
            // 0.4 keeps labels legible while still giving an overview.
            fitViewOptions={{ padding: 0.08, minZoom: 0.4 }}
            minZoom={0.2}
            maxZoom={2.5}
            panOnDrag
            panOnScroll
            zoomOnScroll={false}
            zoomOnPinch
            zoomActivationKeyCode="Meta"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#A5B4FC" gap={20} size={1.2} variant={BackgroundVariant.Dots} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeStrokeWidth={2}
              style={{
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
              }}
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}

export default function ExternalBpmPreviewPage() {
  return (
    <ReactFlowProvider>
      <PreviewInner />
    </ReactFlowProvider>
  );
}
