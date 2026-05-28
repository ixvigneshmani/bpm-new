/* ─── External BPM preview page ──────────────────────────────────────
 * Renders a webMethods process model in a read-only React Flow canvas,
 * reusing the same BPMN node + edge components the Designer uses so the
 * look-and-feel matches. No data is persisted anywhere; the model is
 * fetched live from the API every visit.
 *
 * Layout notes:
 *  • webMethods stores tight coordinates (~120 px between nodes). The
 *    Designer's BPMN task boxes render at ~180 px, so we scale all
 *    coordinates by SCALE to give edges room to route cleanly.
 *  • Each edge picks an explicit sourceHandle / targetHandle based on
 *    the relative position of source vs target — otherwise React Flow's
 *    default mid-edge attach makes the orthogonal router bend through
 *    the node bodies.
 *  • Pools (and lanes when present) come from the BPD XML, not the
 *    relational tables. They render as parent nodes; steps chain to
 *    them via `parentId` + `extent: "parent"`.
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
import { runAutoLayout } from "../lib/external-bpm-layout";

/** webMethods → BPMN coordinate scale, applied in `source` mode only.
 *  webMethods stores tight ICON_ coordinates (~60-90 px sizes); the
 *  BPMN node components render at ~180 px wide, so we 2× the source
 *  coords to keep things from overlapping. In `auto` mode ELK already
 *  emits coords in standard pixel space, so we use 1×. */
const SOURCE_SCALE = 2;
const AUTO_SCALE = 1;

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
  // Auto-layout state. `source` shows the model as authored in the
  // webMethods Designer; `auto` runs ELK to repack the graph for
  // readability (clean orthogonal flow, no overlaps, no empty bands).
  // Default to "auto" because the source coords are often sparse.
  const [layoutMode, setLayoutMode] = useState<"source" | "auto">("auto");
  const [autoGraph, setAutoGraph] = useState<ExternalGraph | null>(null);
  const [autoLaying, setAutoLaying] = useState(false);

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

  // Whenever a new graph arrives, kick off an ELK auto-layout in the
  // background. The result is cached so toggling between Source / Auto
  // is instant after the first compute.
  useEffect(() => {
    if (!graph) {
      setAutoGraph(null);
      return;
    }
    let cancelled = false;
    setAutoLaying(true);
    runAutoLayout(graph.containers ?? [], graph.nodes, graph.edges)
      .then((laid) => {
        if (cancelled) return;
        setAutoGraph({ ...graph, containers: laid.containers, nodes: laid.nodes });
      })
      .catch((err) => {
        console.warn("Auto-layout failed:", err);
        if (!cancelled) setAutoGraph(null);
      })
      .finally(() => {
        if (!cancelled) setAutoLaying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [graph]);

  /** The graph actually rendered — auto-laid when ready and toggled on,
   *  otherwise the original webMethods source layout. */
  const displayGraph = useMemo(() => {
    if (layoutMode === "auto" && autoGraph) return autoGraph;
    return graph;
  }, [layoutMode, autoGraph, graph]);

  // Build the React Flow node list. Pools/lanes come first so they sit
  // beneath the step nodes in the render order; React Flow uses array
  // order for z-stacking within a parent.
  const rfNodes: Node[] = useMemo(() => {
    if (!displayGraph) return [];
    const containers = displayGraph.containers ?? [];
    const scale = layoutMode === "auto" ? AUTO_SCALE : SOURCE_SCALE;

    // Step → which pool it belongs to (one level up only; lanes are
    // visual-only in v1 so steps parent directly to the pool, not the
    // lane — keeps coordinate math simple since WMSTEPDEFINITION
    // positions are pool-relative).
    const stepPoolMap = new Map<string, string>();
    for (const n of displayGraph.nodes) {
      if (n.parentId) {
        // The parentId might be a lane uid; resolve up to the pool.
        const lane = containers.find(
          (c) => c.type === "lane" && c.id === n.parentId,
        );
        stepPoolMap.set(n.id, lane?.parentId ?? n.parentId);
      }
    }

    const out: Node[] = [];

    // Pools first
    for (const c of containers.filter((c) => c.type === "pool")) {
      out.push({
        id: c.id,
        type: "pool",
        position: { x: c.x * scale, y: c.y * scale },
        data: {
          label: c.label ?? "Pool",
          participantName: c.label ?? "Pool",
          width: c.width * scale,
          height: c.height * scale,
        },
        width: c.width * scale,
        height: c.height * scale,
        draggable: false,
        selectable: false,
      });
    }

    // Lanes next (children of pools)
    for (const c of containers.filter((c) => c.type === "lane")) {
      out.push({
        id: c.id,
        type: "lane",
        parentId: c.parentId ?? undefined,
        extent: c.parentId ? "parent" : undefined,
        position: { x: c.x * scale, y: c.y * scale },
        data: {
          label: c.label ?? "",
          width: c.width * scale,
          height: c.height * scale,
        },
        width: c.width * scale,
        height: c.height * scale,
        draggable: false,
        selectable: false,
      });
    }

    // Steps last (chained to their pool for parent positioning). When
    // auto-layout is on we MUST pass width/height through to React Flow
    // so its bbox matches ELK's reserved space — otherwise RF measures
    // the rendered DOM (which can differ from ELK's hint), and adjacent
    // nodes appear to overlap.
    for (const n of displayGraph.nodes) {
      const poolId = stepPoolMap.get(n.id);
      out.push({
        id: n.id,
        type: n.type,
        parentId: poolId,
        extent: poolId ? "parent" : undefined,
        position: { x: n.x * scale, y: n.y * scale },
        data: { label: n.label ?? "" },
        ...(layoutMode === "auto"
          ? { width: n.width * scale, height: n.height * scale }
          : {}),
        draggable: false,
        selectable: true,
        connectable: false,
      });
    }

    return out;
  }, [displayGraph, layoutMode]);

  // Build edges with explicit handles so the BPMN sequence edge can
  // route orthogonally without bending through node bodies.
  const rfEdges: Edge[] = useMemo(() => {
    if (!displayGraph) return [];
    const containers = displayGraph.containers ?? [];
    const scale = layoutMode === "auto" ? AUTO_SCALE : SOURCE_SCALE;

    // Precompute each step's absolute centre on the canvas so we can
    // compare source vs target direction.
    const poolOffset = new Map<string, { x: number; y: number }>();
    for (const c of containers.filter((c) => c.type === "pool")) {
      poolOffset.set(c.id, { x: c.x * scale, y: c.y * scale });
    }
    const stepCenter = new Map<string, { x: number; y: number }>();
    for (const n of displayGraph.nodes) {
      const parentPool = (() => {
        if (!n.parentId) return null;
        const direct = containers.find((c) => c.id === n.parentId);
        if (direct?.type === "pool") return direct.id;
        if (direct?.type === "lane") return direct.parentId;
        return null;
      })();
      const offset = parentPool ? poolOffset.get(parentPool) : null;
      const baseX = (offset?.x ?? 0) + n.x * scale;
      const baseY = (offset?.y ?? 0) + n.y * scale;
      stepCenter.set(n.id, {
        x: baseX + (n.width * scale) / 2,
        y: baseY + (n.height * scale) / 2,
      });
    }

    return displayGraph.edges.map((e) => {
      // Prefer the API-provided handles (derived from the BPD XML's
      // sourceTerminal/targetTerminal — what the original Designer
      // actually authored). Fall back to geometry if the XML omitted them.
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
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle,
        targetHandle,
        type: "sequence",
        label: e.label ?? undefined,
        style: e.conditional ? { strokeDasharray: "5 4" } : undefined,
        data: { isConditional: e.conditional },
      };
    });
  }, [displayGraph, layoutMode]);

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
              <span>{graph.nodes.length} nodes</span>
              <span>·</span>
              <span>{graph.edges.length} edges</span>
            </>
          )}
          {/* Layout toggle. Default to Auto; user can flip to Source to
              see the model exactly as authored in webMethods Designer. */}
          <div className="flex items-center bg-slate-100 rounded-md p-0.5 ml-3">
            <button
              type="button"
              onClick={() => setLayoutMode("source")}
              className={
                "px-2.5 py-1 text-xs rounded font-medium transition-colors " +
                (layoutMode === "source"
                  ? "bg-white text-slate-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700")
              }
              title="Show the layout exactly as it was authored in webMethods Designer"
            >
              Source
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("auto")}
              disabled={!autoGraph && !autoLaying}
              className={
                "px-2.5 py-1 text-xs rounded font-medium transition-colors flex items-center gap-1 " +
                (layoutMode === "auto"
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-700")
              }
              title="Re-arrange the graph for clean reading (ELK layered, orthogonal)"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="3 11 22 2 13 21 11 13 3 11" />
              </svg>
              Auto
              {autoLaying && layoutMode === "auto" && (
                <span className="text-[10px] opacity-70">…</span>
              )}
            </button>
          </div>
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
            // Re-keying on layoutMode forces React Flow to rebuild and
            // re-fit when the user toggles between Source / Auto, so the
            // viewport always frames the new graph cleanly.
            key={layoutMode}
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            minZoom={0.1}
            maxZoom={2}
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
