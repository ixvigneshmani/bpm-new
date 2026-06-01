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

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
  /** Raw WMSTEPDEFINITION.TYPE smallint — shown in the details drawer's
   *  "Identifiers" section alongside the mapped BPMN kind. */
  rawType?: number | null;
  /** Designer-authored notes; surfaced as a Description section when set. */
  description?: string | null;
  /** Behavior pointer — TASKID for user tasks, IS service path for service
   *  tasks, subprocess key for call activities. */
  component?: string | null;
  /** IS host this step runs on. */
  server?: string | null;
  /** Pipeline INPUT documents — names + resolved Document Type FQN.
   *  Empty for gateways / end / error steps. */
  pipelineIn?: PipelineDoc[];
  /** Pipeline OUTPUT documents — same shape as pipelineIn. */
  pipelineOut?: PipelineDoc[];
}

/** Drawer tab identity. Persisted in the URL as `?tab=…` so a teammate's
 *  link drops them in the same view (Overview / Pipeline / Connections /
 *  More). The "More" bucket holds Position + Identifiers — small enough
 *  not to deserve their own tab. */
type DrawerTab = "overview" | "pipeline" | "connections" | "more";

/** One pipeline document slot on a step. `label` strips the
 *  `{namespace}` prefix for friendly display; `typeFqn` is the
 *  Document Type the IS Admin client resolves on demand. */
interface PipelineDoc {
  name: string;
  label: string;
  typeFqn: string | null;
}

/** Type schema returned by GET /external-bpm/types/:fqn — used by
 *  the drawer's expandable Pipeline tree to render Document Type
 *  fields. Cached client-side keyed by fqn so re-expanding is free. */
interface IsTypeSchema {
  fqn: string;
  kind: string;
  fields: IsField[];
}
interface IsField {
  name: string;
  type: string;
  optional: boolean;
  isArray: boolean;
  comment: string | null;
  recrefFqn: string | null;
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

/** Human-readable label for a BPMN kind, shown in the details drawer
 *  pill and section copy. Falls back to the raw key so unknown types
 *  still render gracefully. */
const KIND_LABELS: Record<string, string> = {
  startEvent: "Start Event",
  endEvent: "End Event",
  userTask: "User Task",
  serviceTask: "Service Task",
  exclusiveGateway: "Decision",
  callActivity: "Call Activity",
  intermediateCatchEvent: "Intermediate Event",
};

/** Pull the TASKID portion out of a webMethods user-task COMPONENT string.
 *  webMethods stores user tasks as "TASKID||<uuid>"; surfacing just the
 *  UUID is friendlier than the full prefix. Returns the raw string when
 *  the format doesn't match. */
function extractTaskId(component: string | null | undefined): string | null {
  if (!component) return null;
  const m = component.match(/^TASKID\|\|(.+)$/);
  return m ? m[1] : component;
}

/** Right-side drawer showing the selected step's key details. Sourced
 *  entirely from data already on the client (the preview API payload +
 *  the in-memory graph) — except the Pipeline tab, which lazy-loads
 *  Document Type schemas via the IS Admin API on click.
 *
 *  Layout is tabbed (Overview / Pipeline / Connections / More) so big
 *  schemas don't stack on top of the small step metadata. The Pipeline
 *  tab uses a master-detail pattern: list of IN/OUT docs by default,
 *  schema viewer (breadcrumb + search + field grid) once a doc is
 *  picked — nested recrefs push another segment onto the breadcrumb,
 *  keeping the visible surface focused on one level at a time. */
function StepDetailsDrawer(props: {
  node: ExternalNode;
  allNodes: ExternalNode[];
  allEdges: ExternalEdge[];
  tab: DrawerTab;
  setTab: (tab: DrawerTab) => void;
  drillPath: string[];
  setDrillPath: (path: string[]) => void;
  onClose: () => void;
}) {
  const {
    node,
    allNodes,
    allEdges,
    tab,
    setTab,
    drillPath,
    setDrillPath,
    onClose,
  } = props;
  const kindLabel = KIND_LABELS[node.type] ?? node.type;
  const incoming = useMemo(
    () => allEdges.filter((e) => e.target === node.id),
    [allEdges, node.id],
  );
  const outgoing = useMemo(
    () => allEdges.filter((e) => e.source === node.id),
    [allEdges, node.id],
  );
  const nodeLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of allNodes) m.set(n.id, n.label || n.id);
    return m;
  }, [allNodes]);
  const [copied, setCopied] = useState(false);
  // Re-render tick when an async type schema fetch resolves; the module
  // cache returns the same Promise across renders so we can't useState
  // on it directly. Bumped after each fetch settles.
  const [, setTick] = useState(0);
  const onTypeLoaded = useCallback(() => setTick((t) => t + 1), []);
  const onCopyStepId = useCallback(() => {
    void navigator.clipboard?.writeText(node.id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }, [node.id]);

  const inCount = node.pipelineIn?.length ?? 0;
  const outCount = node.pipelineOut?.length ?? 0;
  const hasPipeline = inCount + outCount > 0;
  const connectionCount = incoming.length + outgoing.length;
  // If the user clicks the Pipeline tab on a step that has none, fall
  // back to Overview so we don't render an empty pane.
  const effectiveTab: DrawerTab =
    tab === "pipeline" && !hasPipeline ? "overview" : tab;

  return (
    <aside
      role="dialog"
      aria-label={`Step details: ${node.label ?? node.id}`}
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        bottom: 12,
        width: 460,
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 10,
        boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
        display: "flex",
        flexDirection: "column",
        zIndex: 20,
        fontSize: 13,
        color: "#0F172A",
      }}
    >
      {/* Sticky header */}
      <header
        style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid #F1F5F9",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={node.label ?? ""}
          >
            {node.label || "(no label)"}
          </div>
          <div
            style={{
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={onCopyStepId}
              title="Copy step ID"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px 2px 8px",
                borderRadius: 4,
                border: "1px solid #E2E8F0",
                background: "#F8FAFC",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 11,
                color: "#475569",
                cursor: "pointer",
              }}
            >
              {node.id}
              <span style={{ color: copied ? "#16A34A" : "#94A3B8" }}>
                {copied ? "✓" : "⧉"}
              </span>
            </button>
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                background: "#EEF2FF",
                color: "#4338CA",
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              {kindLabel}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "#64748B",
            fontSize: 18,
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>
      </header>

      {/* Tab bar — sticky between header and body. */}
      <DrawerTabBar
        active={effectiveTab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          {
            id: "pipeline",
            label: `Pipeline (${inCount + outCount})`,
            disabled: !hasPipeline,
            title: hasPipeline
              ? `${inCount} input · ${outCount} output`
              : "No pipeline IN/OUT on this step",
          },
          {
            id: "connections",
            label: `Connections (${connectionCount})`,
          },
          { id: "more", label: "More" },
        ]}
      />

      {/* Body — one of four tab panes. */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {effectiveTab === "overview" && <OverviewTab node={node} />}
        {effectiveTab === "pipeline" && hasPipeline && (
          <PipelineTab
            node={node}
            drillPath={drillPath}
            setDrillPath={setDrillPath}
            onTypeLoaded={onTypeLoaded}
          />
        )}
        {effectiveTab === "connections" && (
          <ConnectionsTab
            incoming={incoming}
            outgoing={outgoing}
            nodeLabelById={nodeLabelById}
          />
        )}
        {effectiveTab === "more" && <MoreTab node={node} />}
      </div>

      {/* Footer — keeps the no-write contract visible. */}
      <footer
        style={{
          padding: "8px 14px",
          borderTop: "1px solid #F1F5F9",
          color: "#94A3B8",
          fontSize: 11,
        }}
      >
        Read-only — sourced from webMethods
      </footer>
    </aside>
  );
}

/** Tiny section primitive used by StepDetailsDrawer — keeps spacing and
 *  the optional collapse affordance consistent across sections without
 *  pulling in a UI lib. */
function Section(props: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const { title, children, collapsible, open, onToggle } = props;
  return (
    <section style={{ marginBottom: 14 }}>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: 0,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#0F172A",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            marginBottom: 6,
          }}
        >
          <span style={{ color: "#94A3B8", fontSize: 10 }}>{open ? "▾" : "▸"}</span>
          {title}
        </button>
      ) : (
        <div
          style={{
            color: "#0F172A",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            marginBottom: 6,
          }}
        >
          {title}
        </div>
      )}
      {(!collapsible || open) && <div>{children}</div>}
    </section>
  );
}

// ── Pipeline type tree ────────────────────────────────────────────
// Module-level cache of resolved Document Type schemas, keyed by the
// diagram's `{folder}name` FQN. The backend already caches for 24 h,
// so this client cache only saves the network round-trip during the
// same session — but it makes re-expand instant after the user has
// drilled into a tree once.
const TYPE_SCHEMA_CACHE = new Map<string, Promise<IsTypeSchema>>();
function fetchTypeSchema(typeFqn: string): Promise<IsTypeSchema> {
  let p = TYPE_SCHEMA_CACHE.get(typeFqn);
  if (!p) {
    p = apiGet<IsTypeSchema>(
      `/external-bpm/types/${encodeURIComponent(typeFqn)}`,
    );
    TYPE_SCHEMA_CACHE.set(typeFqn, p);
  }
  return p;
}

/** Drop the `{namespace}` prefix off a webMethods FQN for friendlier
 *  display in the drawer. `{DOEEnforcement.documents}BusinessDoc` →
 *  `DOEEnforcement.documents:BusinessDoc`. */
function prettyFqn(fqn: string): string {
  const m = fqn.match(/^\{([^}]*)\}(.+)$/);
  return m ? `${m[1]}:${m[2]}` : fqn;
}

/** Format a field type for the right-aligned chip: scalar gets the
 *  type as-is, arrays append `[]`, recrefs hide the raw "recref" word
 *  in favour of the referenced FQN. */
function fieldTypeLabel(f: IsField): string {
  if (f.type === "recref") {
    return (f.recrefFqn ? prettyFqn(f.recrefFqn) : "recref") + (f.isArray ? "[]" : "");
  }
  return f.type + (f.isArray ? "[]" : "");
}

// ── Drawer tab strip ─────────────────────────────────────────────
// Underline-style tabs, click swaps the body pane below. Disabled
// state is used for the Pipeline tab on steps that have no IN/OUT.
function DrawerTabBar(props: {
  active: DrawerTab;
  onChange: (tab: DrawerTab) => void;
  tabs: Array<{
    id: DrawerTab;
    label: string;
    disabled?: boolean;
    title?: string;
  }>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Step details sections"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 0,
        padding: "0 14px",
        borderBottom: "1px solid #F1F5F9",
        background: "#FAFBFC",
      }}
    >
      {props.tabs.map((t) => {
        const isActive = props.active === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            disabled={t.disabled}
            title={t.title}
            onClick={() => !t.disabled && props.onChange(t.id)}
            style={{
              padding: "8px 10px",
              border: "none",
              background: "transparent",
              cursor: t.disabled ? "default" : "pointer",
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              color: t.disabled
                ? "#CBD5E1"
                : isActive
                  ? "#0F172A"
                  : "#64748B",
              borderBottom: isActive
                ? "2px solid #4338CA"
                : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Tab: Overview ───────────────────────────────────────────────
// Description + Behavior (kind-aware). Stays short — fits one screen.
function OverviewTab(props: { node: ExternalNode }) {
  const { node } = props;
  const taskId = extractTaskId(node.component);
  const rows: Array<{ label: string; value: string; mono?: boolean }> = [];
  if (node.type === "userTask" && taskId) {
    rows.push({ label: "Task ID", value: taskId, mono: true });
  } else if (node.type === "serviceTask") {
    if (node.component) rows.push({ label: "Service", value: node.component });
    if (node.server) rows.push({ label: "Server", value: node.server });
  } else if (node.type === "callActivity") {
    if (node.component) rows.push({ label: "Subprocess", value: node.component });
  } else if (node.component) {
    rows.push({ label: "Component", value: node.component });
  }

  return (
    <>
      {node.description && (
        <Section title="Description">
          <p style={{ margin: 0, lineHeight: 1.5, color: "#334155" }}>
            {node.description}
          </p>
        </Section>
      )}
      {rows.length > 0 ? (
        <Section title="Behavior">
          <dl
            style={{
              margin: 0,
              display: "grid",
              gridTemplateColumns: "max-content 1fr",
              rowGap: 6,
              columnGap: 10,
            }}
          >
            {rows.map((r) => (
              <Fragment key={r.label}>
                <dt style={{ color: "#64748B", fontSize: 12 }}>{r.label}</dt>
                <dd
                  style={{
                    margin: 0,
                    fontFamily: r.mono
                      ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                      : "inherit",
                    fontSize: r.mono ? 11 : 13,
                    wordBreak: "break-all",
                    color: "#0F172A",
                  }}
                >
                  {r.value}
                </dd>
              </Fragment>
            ))}
          </dl>
        </Section>
      ) : (
        !node.description && (
          <p style={{ margin: 0, color: "#94A3B8" }}>
            No description or behavior metadata on this step.
          </p>
        )
      )}
    </>
  );
}

// ── Tab: Connections ────────────────────────────────────────────
function ConnectionsTab(props: {
  incoming: ExternalEdge[];
  outgoing: ExternalEdge[];
  nodeLabelById: Map<string, string>;
}) {
  const { incoming, outgoing, nodeLabelById } = props;
  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <p style={{ margin: 0, color: "#94A3B8" }}>
        No incoming or outgoing flows.
      </p>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {incoming.length > 0 && (
        <div>
          <div style={{ color: "#64748B", fontSize: 11, marginBottom: 4 }}>
            ← Incoming
          </div>
          <ul style={{ margin: 0, paddingLeft: 14 }}>
            {incoming.map((e) => (
              <li key={e.id} style={{ marginBottom: 2 }}>
                {nodeLabelById.get(e.source) ?? e.source}
              </li>
            ))}
          </ul>
        </div>
      )}
      {outgoing.length > 0 && (
        <div>
          <div style={{ color: "#64748B", fontSize: 11, marginBottom: 4 }}>
            → Outgoing
          </div>
          <ul style={{ margin: 0, paddingLeft: 14 }}>
            {outgoing.map((e) => {
              const label = nodeLabelById.get(e.target) ?? e.target;
              const cond = e.conditionText?.trim();
              return (
                <li key={e.id} style={{ marginBottom: 4 }}>
                  {label}
                  {cond && (
                    <span
                      style={{
                        marginLeft: 6,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: "#F1F5F9",
                        color: "#475569",
                        fontSize: 11,
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      }}
                    >
                      {cond}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Tab: More ────────────────────────────────────────────────────
// Position + Identifiers — small metadata not big enough for its own tab.
function MoreTab(props: { node: ExternalNode }) {
  const { node } = props;
  const Row = (p: { label: string; value: string; mono?: boolean }) => (
    <Fragment>
      <dt style={{ color: "#64748B", fontSize: 12 }}>{p.label}</dt>
      <dd
        style={{
          margin: 0,
          fontFamily: p.mono
            ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
            : "inherit",
          fontSize: p.mono ? 11 : 13,
          color: "#0F172A",
        }}
      >
        {p.value}
      </dd>
    </Fragment>
  );
  return (
    <>
      <Section title="Position">
        <dl
          style={{
            margin: 0,
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            rowGap: 4,
            columnGap: 10,
          }}
        >
          <Row label="Parent" value={node.parentId ?? "—"} />
          <Row
            label="x, y"
            value={`${Math.round(node.x)}, ${Math.round(node.y)}`}
          />
          <Row
            label="Size"
            value={`${Math.round(node.width)} × ${Math.round(node.height)}`}
          />
        </dl>
      </Section>
      <Section title="Identifiers">
        <dl
          style={{
            margin: 0,
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            rowGap: 4,
            columnGap: 10,
          }}
        >
          <Row label="Step ID" value={node.id} mono />
          <Row label="BPMN kind" value={node.type} />
          <Row label="webMethods TYPE" value={String(node.rawType ?? "—")} />
        </dl>
      </Section>
    </>
  );
}

// ── Tab: Pipeline ────────────────────────────────────────────────
// Master-detail. When drillPath is empty, render the list of IN/OUT
// documents. When the user picks one, swap to the schema view (full
// field grid + filter + breadcrumb back) so big schemas like
// BusinessDoc don't bury the rest of the drawer in scroll.
function PipelineTab(props: {
  node: ExternalNode;
  drillPath: string[];
  setDrillPath: (path: string[]) => void;
  onTypeLoaded: () => void;
}) {
  const { node, drillPath, setDrillPath, onTypeLoaded } = props;
  if (drillPath.length === 0) {
    return (
      <PipelineListView
        node={node}
        onSelect={(direction, idx) =>
          setDrillPath([direction, String(idx)])
        }
      />
    );
  }
  return (
    <SchemaView
      node={node}
      drillPath={drillPath}
      setDrillPath={setDrillPath}
      onTypeLoaded={onTypeLoaded}
    />
  );
}

// Top-level pipeline IN/OUT list. Clicking a row drills into the
// schema viewer — no inline expansion, no nested scroll.
function PipelineListView(props: {
  node: ExternalNode;
  onSelect: (direction: "in" | "out", idx: number) => void;
}) {
  const { node, onSelect } = props;
  const sections: Array<{
    direction: "in" | "out";
    title: string;
    docs: PipelineDoc[];
  }> = [];
  if ((node.pipelineIn?.length ?? 0) > 0) {
    sections.push({
      direction: "in",
      title: "Input",
      docs: node.pipelineIn!,
    });
  }
  if ((node.pipelineOut?.length ?? 0) > 0) {
    sections.push({
      direction: "out",
      title: "Output",
      docs: node.pipelineOut!,
    });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {sections.map((s) => (
        <div key={s.direction}>
          <div
            style={{
              color: "#64748B",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              marginBottom: 6,
            }}
          >
            {s.title}
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 4 }}
          >
            {s.docs.map((doc, i) => (
              <button
                key={`${s.direction}-${i}`}
                type="button"
                onClick={() => doc.typeFqn && onSelect(s.direction, i)}
                disabled={!doc.typeFqn}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 10px",
                  background: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  borderRadius: 6,
                  cursor: doc.typeFqn ? "pointer" : "default",
                  color: "#0F172A",
                  fontSize: 13,
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: 500,
                  }}
                >
                  {doc.label}
                </span>
                {doc.typeFqn && (
                  <>
                    <span
                      title={doc.typeFqn}
                      style={{
                        color: "#94A3B8",
                        fontSize: 11,
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 180,
                      }}
                    >
                      {prettyFqn(doc.typeFqn)}
                    </span>
                    <span style={{ color: "#94A3B8", fontSize: 12 }}>›</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Resolves the drillPath segments into a chain of (label, fqn) pairs.
// Path shape: ["in"|"out", idx, fieldName?, fieldName?, …]
//   - segments 0/1 always come from the node's pipelineIn/Out
//   - subsequent segments are recref field names; each requires the
//     parent schema to be cached so we can look up the field's
//     recrefFqn. Fetches missing parents and re-renders via
//     onTypeLoaded.
//
// State:
//   "loading" — at least one schema in the chain is still in flight
//   "broken"  — the path doesn't resolve (bad index / unknown field /
//               IS error). Caller renders an error + back-arrow.
//   "ready"   — all segments resolved, current.fqn is the deepest type
function useDrillPath(
  node: ExternalNode,
  path: string[],
  onTypeLoaded: () => void,
): {
  segments: Array<{ label: string; fqn: string }>;
  state: "loading" | "broken" | "ready";
} {
  if (path.length < 2) return { segments: [], state: "broken" };
  const direction = path[0] as "in" | "out";
  const idx = Number(path[1]);
  const docs = direction === "in" ? node.pipelineIn : node.pipelineOut;
  const root = docs?.[idx];
  if (!root || !root.typeFqn) return { segments: [], state: "broken" };

  const segments: Array<{ label: string; fqn: string }> = [
    { label: root.label, fqn: root.typeFqn },
  ];

  for (let i = 2; i < path.length; i++) {
    const parentFqn = segments[segments.length - 1].fqn;
    const cached = TYPE_SCHEMA_CACHE.get(parentFqn);
    if (!cached) {
      fetchTypeSchema(parentFqn)
        .then(() => onTypeLoaded())
        .catch(() => onTypeLoaded());
      return { segments, state: "loading" };
    }
    const resolved = readResolved(cached);
    if (resolved === null) return { segments, state: "loading" };
    if (resolved === "error") return { segments, state: "broken" };
    const field = resolved.fields.find((f) => f.name === path[i]);
    if (!field?.recrefFqn) return { segments, state: "broken" };
    segments.push({ label: field.name, fqn: field.recrefFqn });
  }

  // Make sure the deepest level itself has been fetched too.
  const deepest = segments[segments.length - 1].fqn;
  const deepestCached = TYPE_SCHEMA_CACHE.get(deepest);
  if (!deepestCached) {
    fetchTypeSchema(deepest)
      .then(() => onTypeLoaded())
      .catch(() => onTypeLoaded());
    return { segments, state: "loading" };
  }
  const deepestResolved = readResolved(deepestCached);
  if (deepestResolved === null) return { segments, state: "loading" };
  if (deepestResolved === "error") return { segments, state: "broken" };
  return { segments, state: "ready" };
}

// Schema viewer for ONE document type. Renders breadcrumb (each
// segment clickable to pop back) + a filter input + a field grid.
// Clicking a recref field's drill chevron pushes a new segment onto
// the path → the parent re-renders the schema for the nested type.
function SchemaView(props: {
  node: ExternalNode;
  drillPath: string[];
  setDrillPath: (path: string[]) => void;
  onTypeLoaded: () => void;
}) {
  const { node, drillPath, setDrillPath, onTypeLoaded } = props;
  const { segments, state } = useDrillPath(node, drillPath, onTypeLoaded);
  const [filter, setFilter] = useState("");
  // Reset the filter whenever the drill changes so going one level
  // deeper doesn't carry the previous level's search forward.
  useEffect(() => setFilter(""), [drillPath.join(":")]);

  const directionLabel = drillPath[0] === "out" ? "Output" : "Input";
  const back = () => setDrillPath([]);

  const deepest = segments[segments.length - 1]?.fqn;
  const schema =
    deepest && state === "ready"
      ? readResolved(TYPE_SCHEMA_CACHE.get(deepest))
      : null;
  const fields = schema && schema !== "error" ? schema.fields : [];
  const filtered = filter
    ? fields.filter((f) =>
        f.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : fields;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Breadcrumb row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "#475569",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={back}
          aria-label="Back to pipeline list"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
            borderRadius: 4,
            border: "1px solid #E2E8F0",
            background: "#fff",
            cursor: "pointer",
            fontSize: 11,
            color: "#475569",
          }}
        >
          ‹ {directionLabel}
        </button>
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          return (
            <Fragment key={i}>
              <span style={{ color: "#CBD5E1" }}>/</span>
              {isLast ? (
                <span
                  title={seg.fqn}
                  style={{
                    color: "#0F172A",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 240,
                  }}
                >
                  {seg.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setDrillPath(drillPath.slice(0, 2 + i))}
                  title={`Back to ${seg.label}`}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "#4338CA",
                    textDecoration: "underline",
                    textDecorationStyle: "dotted",
                    fontSize: 12,
                  }}
                >
                  {seg.label}
                </button>
              )}
            </Fragment>
          );
        })}
      </div>

      {/* FQN line */}
      {deepest && (
        <div
          title={deepest}
          style={{
            color: "#94A3B8",
            fontSize: 11,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {prettyFqn(deepest)}
        </div>
      )}

      {/* State surfaces */}
      {state === "loading" && (
        <div style={{ color: "#94A3B8", fontSize: 12, padding: "16px 0" }}>
          Loading schema…
        </div>
      )}
      {state === "broken" && (
        <div
          style={{
            color: "#B91C1C",
            fontSize: 12,
            padding: "10px 12px",
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 6,
          }}
        >
          Couldn't resolve this schema — the type may not exist on the IS, or
          the field reference is broken. Use the breadcrumb to go back.
        </div>
      )}

      {state === "ready" && (
        <>
          {/* Filter */}
          <input
            type="text"
            placeholder={`Filter ${fields.length} fields…`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              padding: "6px 8px",
              border: "1px solid #E2E8F0",
              borderRadius: 6,
              fontSize: 12,
              color: "#0F172A",
              outline: "none",
            }}
          />
          {/* Field grid */}
          {filtered.length === 0 ? (
            <div
              style={{ color: "#94A3B8", fontSize: 12, padding: "12px 0" }}
            >
              {fields.length === 0
                ? "(no fields)"
                : `No fields match "${filter}".`}
            </div>
          ) : (
            <FieldGrid
              fields={filtered}
              onDrill={(fieldName) =>
                setDrillPath([...drillPath, fieldName])
              }
            />
          )}
        </>
      )}
    </div>
  );
}

// Tabular field list. 3 columns: name, type+optional marker, drill
// chevron (only present for recref fields). Field name truncates with
// ellipsis; full type FQN goes in the tooltip.
function FieldGrid(props: {
  fields: IsField[];
  onDrill: (fieldName: string) => void;
}) {
  const { fields, onDrill } = props;
  return (
    <div
      role="table"
      style={{
        display: "flex",
        flexDirection: "column",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
      }}
    >
      {fields.map((f) => (
        <FieldRow key={f.name} field={f} onDrill={onDrill} />
      ))}
    </div>
  );
}

/** One row of the field grid. For recref fields the whole row is a
 *  single button so clicking anywhere — field name, type chip, or
 *  the trailing `›` — drills in. Primitive fields render as a plain
 *  3-cell row (no hover, no pointer) since there's nowhere to drill
 *  to.
 *
 *  Each row is its own grid (`1fr auto auto`) rather than a shared
 *  outer grid so a per-row hover state is easy to style and so the
 *  whole row can be a single tabbable button for keyboard users. */
function FieldRow(props: {
  field: IsField;
  onDrill: (fieldName: string) => void;
}) {
  const { field: f, onDrill } = props;
  const [hover, setHover] = useState(false);
  const rowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    columnGap: 10,
    alignItems: "center",
    padding: "2px 6px",
    margin: "0 -6px", // bleed the hover background past the body padding
    borderRadius: 4,
    background: f.recrefFqn && hover ? "#EEF2FF" : "transparent",
    transition: "background 120ms",
  };
  const nameCell = (
    <span
      title={f.comment ?? f.name}
      style={{
        color: "#0F172A",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        textAlign: "left",
      }}
    >
      {f.name}
    </span>
  );
  const typeCell = (
    <span
      title={f.recrefFqn ?? undefined}
      style={{
        color: f.type === "recref" ? "#4338CA" : "#64748B",
        fontSize: 11,
        whiteSpace: "nowrap",
      }}
    >
      {fieldTypeLabel(f)}
      {f.optional && (
        <span style={{ color: "#94A3B8", marginLeft: 4 }}>·opt</span>
      )}
    </span>
  );
  const chevronCell = f.recrefFqn ? (
    <span
      aria-hidden
      style={{
        color: "#4338CA",
        fontSize: 13,
        padding: "0 4px",
        lineHeight: 1,
      }}
    >
      ›
    </span>
  ) : (
    <span style={{ width: 16 }} />
  );
  if (f.recrefFqn) {
    return (
      <button
        type="button"
        onClick={() => onDrill(f.name)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={`Drill into ${f.name}`}
        style={{
          ...rowStyle,
          background: hover ? "#EEF2FF" : "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: "inherit",
          width: "auto",
        }}
      >
        {nameCell}
        {typeCell}
        {chevronCell}
      </button>
    );
  }
  return (
    <div style={rowStyle}>
      {nameCell}
      {typeCell}
      {chevronCell}
    </div>
  );
}

/** Resolve a cached Promise<IsTypeSchema> synchronously by stashing
 *  the settled value on the Promise itself. React forces a re-render
 *  via the `onTypeLoaded` tick once the fetch lands. Returns
 *  - `null` while pending,
 *  - `"error"` on failure,
 *  - the parsed schema once resolved. */
type SchemaOrError = IsTypeSchema | "error" | null;
function readResolved(
  p: Promise<IsTypeSchema> | undefined,
): SchemaOrError {
  if (!p) return null;
  const tagged = p as Promise<IsTypeSchema> & {
    __resolved?: IsTypeSchema | "error";
  };
  if (tagged.__resolved) return tagged.__resolved;
  // Attach the resolver only once.
  if (!(tagged as { __tagged?: boolean }).__tagged) {
    (tagged as { __tagged?: boolean }).__tagged = true;
    tagged
      .then((s) => {
        tagged.__resolved = s;
      })
      .catch(() => {
        tagged.__resolved = "error";
      });
  }
  return null;
}

function PreviewInner() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const processKey = params.get("processKey") ?? "";
  const modelVersion = params.get("modelVersion") ?? "";
  const deploymentVersion = params.get("deploymentVersion") ?? "";

  const [graph, setGraph] = useState<ExternalGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Step-details drawer — driven by ?stepId=… in the URL so the open
  // panel survives reload and is shareable (useful for the future
  // KPI-definition workflow the user described, where step IDs travel
  // across apps). Selecting a node patches the URL; clicking empty
  // canvas or hitting Esc clears it. Reading the value off the URL on
  // every render keeps drawer state and URL state in lock-step.
  const selectedStepId = params.get("stepId");
  // Drawer tab + pipeline drill path — both URL-backed so a teammate's
  // link drops them in the same view (useful for the future cross-app
  // KPI workflow where stepId + path become coordinates).
  const drawerTab = (params.get("tab") as DrawerTab) ?? "overview";
  const drillPathRaw = params.get("path") ?? "";
  const drillPath = useMemo(
    () => (drillPathRaw ? drillPathRaw.split(":") : []),
    [drillPathRaw],
  );
  const setSelectedStepId = useCallback(
    (id: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("stepId", id);
          else {
            next.delete("stepId");
            // tab + path are step-scoped — clear them when no step is
            // selected (and below, also when a different step is picked).
            next.delete("tab");
            next.delete("path");
          }
          // Pipeline drill segments encode the current step's pipeline
          // indices, so they must clear on every step change.
          next.delete("path");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const setDrawerTab = useCallback(
    (tab: DrawerTab) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", tab);
          // Switching tabs leaves any deep drill behind — schema drill
          // only makes sense while on the Pipeline tab.
          if (tab !== "pipeline") next.delete("path");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const setDrillPath = useCallback(
    (path: string[]) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (path.length > 0) next.set("path", path.join(":"));
          else next.delete("path");
          // Drill is meaningful only on the Pipeline tab.
          if (path.length > 0) next.set("tab", "pipeline");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  useEffect(() => {
    if (!selectedStepId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (drillPath.length > 0) setDrillPath([]);
        else setSelectedStepId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedStepId, drillPath.length, setSelectedStepId, setDrillPath]);
  const selectedNode = useMemo(
    () =>
      selectedStepId && graph
        ? (graph.nodes.find((n) => n.id === selectedStepId) ?? null)
        : null,
    [selectedStepId, graph],
  );

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 12,
        overflow: "hidden",
      }}
    >
      {/* Back button on the AppShell gray, like InstanceDetailPage —
          gives the page its first breathing line before the title. */}
      <div>
        <button
          onClick={() => navigate("/external-bpm")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px 4px 8px",
            borderRadius: 6,
            border: "1px solid #E5E7EB",
            background: "#fff",
            fontSize: 12,
            color: "#475467",
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to External Processes
        </button>
      </div>

      {/* Title row — uses the same h1 + caption typography as the
          ExternalBpmListPage so the two screens feel like one product. */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1
            className="truncate"
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#101828",
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            {graph?.model.label ?? "Loading…"}
          </h1>
          <p
            className="truncate font-mono"
            style={{
              fontSize: 12,
              color: "#667085",
              margin: "4px 0 0",
            }}
          >
            {processKey} · v{modelVersion} · deploy {deploymentVersion}
          </p>
        </div>
        {graph && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 12,
              color: "#667085",
              flexShrink: 0,
            }}
          >
            <span>
              {(graph.containers ?? []).filter((c) => c.type === "pool").length}{" "}
              pool
              {(graph.containers ?? []).filter((c) => c.type === "pool").length === 1
                ? ""
                : "s"}
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
          </div>
        )}
      </div>

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

      <div
        className="flex-1 relative external-bpm-canvas"
        style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 10,
          overflow: "hidden",
          minHeight: 0,
        }}
      >
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
            onNodeClick={(_, node) => {
              // Ignore pool / lane background clicks — they aren't real
              // BPMN steps and don't carry stepId-level detail.
              if (node.type === "pool" || node.type === "lane") return;
              setSelectedStepId(node.id);
            }}
            onPaneClick={() => setSelectedStepId(null)}
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
        {selectedNode && graph && (
          <StepDetailsDrawer
            node={selectedNode}
            allNodes={graph.nodes}
            allEdges={graph.edges}
            tab={drawerTab}
            setTab={setDrawerTab}
            drillPath={drillPath}
            setDrillPath={setDrillPath}
            onClose={() => setSelectedStepId(null)}
          />
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
