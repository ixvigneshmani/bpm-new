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
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { apiGet } from "../lib/api";
import { nodeTypes } from "../components/canvas/nodes";
import { edgeTypes } from "../components/canvas/edges";
import {
  type Box,
  handleToSide,
  routeEdge,
  type Side,
  sideToSourceHandle,
  sideToTargetHandle,
} from "./external-bpm-routing";

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

function PreviewInner() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const processKey = params.get("processKey") ?? "";
  const modelVersion = params.get("modelVersion") ?? "";
  const deploymentVersion = params.get("deploymentVersion") ?? "";

  const [graph, setGraph] = useState<ExternalGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Measured per-node SHAPE boxes (handle-extent bounding boxes in flow
  // coords). The webMethods node bbox we reserve (NODE_SIZE) is bigger
  // than the visual BPMN shape for gateways/events — their diamond/circle
  // sits top-centre with the label below, and the connection handles
  // attach to the shape, not the bbox. Routing against the reserved bbox
  // (with handles assumed at its side-centres) mis-places endpoints by up
  // to ~half a box and lets long edges clip a neighbour. Once the canvas
  // mounts we read the real handle positions and re-route against those,
  // which exactly matches where edges actually attach — fully generic, no
  // per-node-type magic numbers.
  const rf = useReactFlow();
  const [shapeBoxes, setShapeBoxes] = useState<Map<string, Box> | null>(null);

  // After the canvas mounts, read each node's real connection-handle
  // positions (in flow coords) and use their bounding box as the routing
  // shape. The handles attach to the visible BPMN glyph — which for
  // gateways/events is smaller than and offset within the reserved
  // NODE_SIZE bbox — so this exactly matches where edges actually leave
  // and enter, with no per-node-type constants. We poll across a few
  // animation frames because the handle DOM (and React Flow's fitView
  // transform) settle a tick after the nodes first render.
  useEffect(() => {
    if (!graph) return;
    setShapeBoxes(null);
    let raf = 0;
    let attempts = 0;
    const measure = () => {
      attempts += 1;
      const map = new Map<string, Box>();
      for (const n of graph.nodes) {
        let el: Element | null = null;
        try {
          el = document.querySelector(
            `.react-flow__node[data-id="${CSS.escape(n.id)}"]`,
          );
        } catch {
          el = null;
        }
        const handles = el?.querySelectorAll(".react-flow__handle");
        if (!handles || handles.length === 0) continue;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const h of handles) {
          const r = h.getBoundingClientRect();
          const f = rf.screenToFlowPosition({
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
          });
          minX = Math.min(minX, f.x);
          minY = Math.min(minY, f.y);
          maxX = Math.max(maxX, f.x);
          maxY = Math.max(maxY, f.y);
        }
        if (!Number.isFinite(minX)) continue;
        map.set(n.id, {
          x: minX,
          y: minY,
          w: Math.max(maxX - minX, 1),
          h: Math.max(maxY - minY, 1),
        });
      }
      // Commit once every node is measured, or after we've given the DOM
      // enough frames to settle (whichever comes first).
      if (map.size >= graph.nodes.length || (map.size > 0 && attempts >= 12)) {
        setShapeBoxes(map);
        return;
      }
      if (attempts < 40) raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [graph, rf]);

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
    // Node bounding boxes in the SAME absolute flow space React Flow
    // positions nodes/handles in. We use the RENDERED sizeFor() box (not
    // the tiny webMethods ICON_ dims) so the obstacle router reasons
    // about the boxes the user actually sees.
    const boxFor = new Map<string, Box>();
    const centerFor = new Map<string, { x: number; y: number }>();
    for (const n of graph.nodes) {
      // Prefer the measured shape box (exact handle geometry) once the
      // canvas has mounted; fall back to the reserved NODE_SIZE box on the
      // very first render before measurement lands.
      const measured = shapeBoxes?.get(n.id);
      if (measured) {
        boxFor.set(n.id, measured);
        centerFor.set(n.id, {
          x: measured.x + measured.w / 2,
          y: measured.y + measured.h / 2,
        });
        continue;
      }
      const origin = absoluteOrigin(n.parentId);
      const sz = sizeFor(n.type);
      const x = origin.x + n.x * SCALE;
      const y = origin.y + n.y * SCALE;
      boxFor.set(n.id, { x, y, w: sz.width, h: sz.height });
      centerFor.set(n.id, { x: x + sz.width / 2, y: y + sz.height / 2 });
    }

    return graph.edges.map((e) => {
      const sBox = boxFor.get(e.source);
      const tBox = boxFor.get(e.target);

      // Without geometry for both endpoints we can't route; fall back to
      // the authored handles and a straight auto-route.
      if (!sBox || !tBox) {
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? "s-right",
          targetHandle: e.targetHandle ?? "t-left",
          type: "sequence",
          label: e.label ?? undefined,
          style: e.conditional ? { strokeDasharray: "5 4" } : undefined,
          data: {
            isConditional: e.conditional,
            waypoints: [],
            conditionText: e.conditionText,
          },
        } satisfies Edge;
      }

      // Authored entry/exit sides (BPD terminal hints), or a geometric
      // guess when the XML omitted them.
      let sSide = handleToSide(e.sourceHandle);
      let tSide = handleToSide(e.targetHandle);
      if (!sSide || !tSide) {
        const guess = pickHandles(
          centerFor.get(e.source)!,
          centerFor.get(e.target)!,
        );
        sSide ??= handleToSide(guess.sourceHandle);
        tSide ??= handleToSide(guess.targetHandle);
      }

      const obstacles: Box[] = [];
      for (const [id, b] of boxFor) {
        if (id !== e.source && id !== e.target) obstacles.push(b);
      }

      // "GPS" pass: keep the authored route when it's already clean,
      // otherwise steer around the boxes in the way (and re-pick the
      // target entry side if the authored one is unreachable). webMethods
      // bendpoints are intentionally ignored — they were authored for
      // tiny icons and are unreliable at full BPMN box size.
      const routed = routeEdge({
        source: sBox,
        target: tBox,
        sourceSide: (sSide ?? "right") as Side,
        targetSide: (tSide ?? "left") as Side,
        obstacles,
      });

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: sideToSourceHandle(routed.sourceSide),
        targetHandle: sideToTargetHandle(routed.targetSide),
        type: "sequence",
        label: e.label ?? undefined,
        style: e.conditional ? { strokeDasharray: "5 4" } : undefined,
        data: {
          isConditional: e.conditional,
          waypoints: routed.waypoints,
          conditionText: e.conditionText,
        },
      } satisfies Edge;
    });
  }, [graph, shapeBoxes]);

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

        /* Decision/gateway diamonds: the shared Designer gateway component
           rounds its rotated square (borderRadius: 5 on a 50px box ≈ 10%),
           which blunts the points so it reads as a tilted rounded square
           rather than a crisp BPMN rhombus. Sharpen the corners here only
           (scoped to the read-only preview, Designer untouched). The
           rotated background div carries the .rounded class. */
        .external-bpm-canvas .react-flow__node-exclusiveGateway .bpmn-gateway-node > .relative > div.rounded,
        .external-bpm-canvas .react-flow__node-parallelGateway .bpmn-gateway-node > .relative > div.rounded,
        .external-bpm-canvas .react-flow__node-inclusiveGateway .bpmn-gateway-node > .relative > div.rounded,
        .external-bpm-canvas .react-flow__node-eventBasedGateway .bpmn-gateway-node > .relative > div.rounded {
          border-radius: 0 !important;
        }

        /* Keep the diamond a true square. The gateway wrapper is a flex
           column (diamond + label); inside our fixed-height preview node
           the long webMethods labels wrap and the flex container shrinks
           the 50×50 diamond box vertically (offsetHeight collapsed to ~29),
           rendering a flattened rhombus. Pin the diamond container so it
           never shrinks and stays square. */
        .external-bpm-canvas .react-flow__node-exclusiveGateway .bpmn-gateway-node,
        .external-bpm-canvas .react-flow__node-parallelGateway .bpmn-gateway-node,
        .external-bpm-canvas .react-flow__node-inclusiveGateway .bpmn-gateway-node,
        .external-bpm-canvas .react-flow__node-eventBasedGateway .bpmn-gateway-node {
          justify-content: center !important;
        }
        .external-bpm-canvas .react-flow__node-exclusiveGateway .bpmn-gateway-node > .relative,
        .external-bpm-canvas .react-flow__node-parallelGateway .bpmn-gateway-node > .relative,
        .external-bpm-canvas .react-flow__node-inclusiveGateway .bpmn-gateway-node > .relative,
        .external-bpm-canvas .react-flow__node-eventBasedGateway .bpmn-gateway-node > .relative {
          flex-shrink: 0 !important;
          flex-grow: 0 !important;
          align-self: center !important;
        }

        /* Make ALL text inside step nodes bigger. The Designer's BPMN
           components render labels in deeply nested spans/divs, so we
           use a universal selector with !important to win against
           their own font-size declarations. Use big numbers (18 / 20
           px) so the text stays legible even when fitView zooms out
           to 0.3-0.5 on wide diagrams. */
        .external-bpm-canvas .react-flow__node:not(.react-flow__node-pool):not(.react-flow__node-lane) * {
          font-size: 18px !important;
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
          font-size: 16px !important;
        }

        /* Lane labels (vertical text on swimlane bands). */
        .external-bpm-canvas .react-flow__node-lane * {
          font-size: 18px !important;
        }

        /* Edge labels (condition text). */
        .external-bpm-canvas .react-flow__edge-textwrapper,
        .external-bpm-canvas .react-flow__edge-text {
          font-size: 16px !important;
          font-weight: 500;
        }
      `}</style>

      <div className="flex-1 relative bg-slate-50 external-bpm-canvas">
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
            // Open at a READABLE zoom rather than fitting the whole
            // (often very wide/tall) diagram into the viewport, which on
            // big webMethods models drives the fit zoom down to ~0.13 and
            // makes everything microscopic on load. Clamping fitView's
            // own zoom to [0.5, 1] means:
            //   • huge diagrams open at 0.5 anchored on the content; the
            //     user pans to explore the rest (same as webMethods'
            //     Designer, which opens at ~100% and scrolls);
            //   • small diagrams don't balloon past 1× either.
            // The component minZoom stays low so the user can still pinch
            // all the way out to see the whole model at once when they want.
            fitViewOptions={{ padding: 0.12, minZoom: 0.5, maxZoom: 1 }}
            minZoom={0.1}
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
