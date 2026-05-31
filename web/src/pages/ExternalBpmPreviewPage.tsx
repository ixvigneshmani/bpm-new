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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useStore,
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

/** Reserved bounding-box per node type — independent of webMethods'
 *  ICON_ dimensions, which are tiny (60×60) and don't reflect the
 *  rendered BPMN component size. Pairing these with the CSS overrides
 *  below makes nodes render large enough to be readable at any zoom
 *  without us having to push the viewport zoom up. */
const NODE_SIZE: Record<string, { width: number; height: number }> = {
  startEvent: { width: 90, height: 90 },
  endEvent: { width: 90, height: 90 },
  intermediateCatchEvent: { width: 90, height: 90 },
  exclusiveGateway: { width: 100, height: 100 },
  // Tasks + subprocesses: longer labels need wider boxes.
  userTask: { width: 240, height: 130 },
  serviceTask: { width: 240, height: 130 },
  callActivity: { width: 240, height: 130 },
};
function sizeFor(type: string): { width: number; height: number } {
  return NODE_SIZE[type] ?? { width: 240, height: 130 };
}

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

/** Lives inside <ReactFlow> so it can subscribe to the React Flow store.
 *  Reads the current viewport zoom and writes it onto `--rf-zoom` on
 *  the canvas wrapper, so our CSS rules can counter-scale text via
 *  `calc(base / var(--rf-zoom))` and keep it at a constant on-screen
 *  size regardless of how zoomed-out the canvas is. This is the same
 *  trick bpmn-js uses for label legibility. */
function ZoomCssBridge({
  targetRef,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>;
}) {
  const zoom = useStore((s) => s.transform[2]);
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    el.style.setProperty("--rf-zoom", String(zoom || 1));
  }, [zoom, targetRef]);
  return null;
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
  /** Ref to the canvas wrapper — the CSS-var target for counter-scaling. */
  const canvasRef = useRef<HTMLDivElement | null>(null);

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
        // Override the LaneNode's default visuals with the source
        // colours. CSS custom properties propagate inward; the !important
        // overrides at the top of the page wire them onto the inner
        // .bpmn-lane div so the BPD-authored fills actually show.
        style: {
          ["--bpd-lane-bg" as string]: bg,
          ["--bpd-lane-label-bg" as string]: labelBg,
        },
      });
    });

    // Steps last (z-stack top). When the step is in a swimlane, its
    // position has already been transformed to be lane-relative.
    //
    // We explicitly set the React Flow bbox size per node type — not
    // the webMethods ICON_ dims (which are tiny) — so the BPMN node
    // visuals can grow to a readable size via the CSS overrides below.
    // RF uses this size for edge attach points and parent clipping.
    for (const n of graph.nodes) {
      const sz = sizeFor(n.type);
      out.push({
        id: n.id,
        type: n.type,
        parentId: n.parentId ?? undefined,
        extent: n.parentId ? "parent" : undefined,
        position: { x: n.x * SCALE, y: n.y * SCALE },
        data: { label: n.label ?? "" },
        width: sz.width,
        height: sz.height,
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

      {/* Designer's BpmnLane hardcodes a background on its inner
         div; these !important overrides let our per-node CSS vars
         (`--bpd-lane-bg`, `--bpd-lane-label-bg`) actually take effect.
         The same scoped block also enlarges the BPMN node visuals so
         tasks render readable at any zoom — no zoom-floor cheat. */}
      <style>{`
        /* Lane bg overrides */
        .external-bpm-canvas .react-flow__node-lane .bpmn-lane {
          background: var(--bpd-lane-bg, transparent) !important;
        }
        .external-bpm-canvas .react-flow__node-lane .bpmn-lane > div:first-child {
          background: var(--bpd-lane-label-bg, rgba(0, 0, 0, 0.04)) !important;
        }

        /* Force the inner BPMN component to fill the React Flow bbox
           we set per node type. Designer components have their own
           fixed widths; width/height: 100% with !important lets the
           bbox dictate, so our sizeFor() values actually drive the
           visible size. */
        .external-bpm-canvas .react-flow__node-userTask > div,
        .external-bpm-canvas .react-flow__node-serviceTask > div,
        .external-bpm-canvas .react-flow__node-scriptTask > div,
        .external-bpm-canvas .react-flow__node-businessRuleTask > div,
        .external-bpm-canvas .react-flow__node-sendTask > div,
        .external-bpm-canvas .react-flow__node-receiveTask > div,
        .external-bpm-canvas .react-flow__node-manualTask > div,
        .external-bpm-canvas .react-flow__node-callActivity > div,
        .external-bpm-canvas .react-flow__node-subProcess > div,
        .external-bpm-canvas .react-flow__node-exclusiveGateway > div,
        .external-bpm-canvas .react-flow__node-parallelGateway > div,
        .external-bpm-canvas .react-flow__node-inclusiveGateway > div,
        .external-bpm-canvas .react-flow__node-eventBasedGateway > div,
        .external-bpm-canvas .react-flow__node-startEvent > div,
        .external-bpm-canvas .react-flow__node-endEvent > div,
        .external-bpm-canvas .react-flow__node-intermediateCatchEvent > div,
        .external-bpm-canvas .react-flow__node-intermediateThrowEvent > div {
          width: 100% !important;
          height: 100% !important;
          min-width: 0 !important;
          min-height: 0 !important;
        }

        /* Counter-scale text against the viewport zoom so labels stay
           at a constant on-screen pixel size regardless of how
           zoomed-out the canvas is. Same trick bpmn-js uses.

           --rf-zoom is updated in real time by <ZoomCssBridge> on every
           viewport change. clamp() caps the counter-scale so text
           doesn't grow absurdly when zooming way out (--rf-zoom
           approaches 0) nor become microscopic when zooming way in.

           The viewport's CSS transform: scale(zoom) is then applied
           to this counter-scaled font, producing constant on-screen
           pixels: scale × (base / scale) = base.

           Base sizes (on-screen):
             tasks         14 px
             gateways/events 13 px
             lane labels    14 px
             edge labels    12 px */
        .external-bpm-canvas .react-flow__node:not(.react-flow__node-pool):not(.react-flow__node-lane) * {
          font-size: clamp(11px, calc(14px / var(--rf-zoom, 1)), 56px) !important;
          line-height: 1.2 !important;
        }
        .external-bpm-canvas .react-flow__node-exclusiveGateway *,
        .external-bpm-canvas .react-flow__node-parallelGateway *,
        .external-bpm-canvas .react-flow__node-inclusiveGateway *,
        .external-bpm-canvas .react-flow__node-eventBasedGateway *,
        .external-bpm-canvas .react-flow__node-startEvent *,
        .external-bpm-canvas .react-flow__node-endEvent *,
        .external-bpm-canvas .react-flow__node-intermediateCatchEvent *,
        .external-bpm-canvas .react-flow__node-intermediateThrowEvent * {
          font-size: clamp(10px, calc(13px / var(--rf-zoom, 1)), 52px) !important;
        }

        /* Lane labels (vertical text on swimlane bands). */
        .external-bpm-canvas .react-flow__node-lane * {
          font-size: clamp(11px, calc(14px / var(--rf-zoom, 1)), 56px) !important;
        }

        /* Edge labels (condition text). */
        .external-bpm-canvas .react-flow__edge-textwrapper,
        .external-bpm-canvas .react-flow__edge-text {
          font-size: clamp(9px, calc(12px / var(--rf-zoom, 1)), 48px) !important;
          font-weight: 500;
        }
      `}</style>

      <div ref={canvasRef} className="flex-1 relative bg-slate-50 external-bpm-canvas">
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
            // fitView is allowed to choose freely — the per-node bbox
            // sizing above ensures shapes are large enough at most
            // zoom levels without needing a zoom floor.
            fitViewOptions={{ padding: 0.08 }}
            minZoom={0.15}
            maxZoom={2.5}
            panOnDrag
            panOnScroll
            zoomOnScroll={false}
            zoomOnPinch
            zoomActivationKeyCode="Meta"
            proOptions={{ hideAttribution: true }}
          >
            <ZoomCssBridge targetRef={canvasRef} />
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
