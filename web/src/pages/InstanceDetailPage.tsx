/* ─── Instance Detail ───────────────────────────────────────────────
 * Three sections from a single GET /instances/:id call: instance
 * header (status + variables), live tokens, recent audit events.
 * Cancel button on running instances.
 *
 * Auto-refresh: while the instance is still `running`, we poll every
 * 3 s so the operator watching a service-task complete sees tokens
 * advance without manual refresh clicks. Terminal states
 * (completed/failed/cancelled) stop the poll — the view freezes as
 * a "what happened?" snapshot.
 * ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";
import InstanceCanvas from "./console/InstanceCanvas";

type InstanceDetail = {
  id: string;
  processId: string;
  processVersionId: string | null;
  definitionHash: string;
  businessKey: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  variables: Record<string, unknown>;
  startedBy: string;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  version: number;
  tokens: Array<{
    id: string;
    currentNodeId: string;
    status: "active" | "waiting" | "completed" | "failed";
    waitingFor: string | null;
    assignedTo: string | null;
    candidateRole: string | null;
    version: number;
    updatedAt: string;
  }>;
  recentEvents: Array<{
    id: string;
    eventType: string;
    tokenId: string | null;
    nodeId: string | null;
    userId: string | null;
    payload: unknown;
    createdAt: string;
  }>;
  canvasData: unknown;
};

type CanvasData = {
  nodes?: Array<{ id: string; type?: string; position?: { x: number; y: number }; data?: Record<string, unknown>; width?: number; height?: number; parentId?: string }>;
  edges?: Array<{ id: string; source: string; target: string; type?: string; data?: Record<string, unknown>; sourceHandle?: string | null; targetHandle?: string | null }>;
};

const STATUS_STYLES: Record<InstanceDetail["status"], { bg: string; text: string; dot: string; label: string }> = {
  running:   { bg: "#EEF2FF", text: "#4338CA", dot: "#6366F1", label: "Running" },
  completed: { bg: "#F0FDF4", text: "#166534", dot: "#22C55E", label: "Completed" },
  failed:    { bg: "#FEF2F2", text: "#B42318", dot: "#EF4444", label: "Failed" },
  cancelled: { bg: "#F9FAFB", text: "#475467", dot: "#98A2B3", label: "Cancelled" },
};

export default function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [processCanvas, setProcessCanvas] = useState<CanvasData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiGet<InstanceDetail>(`/instances/${id}`);
      setDetail(data);
      // One-time canvas fetch — the versioned snapshot strips positions
      // (canonicalise drops them for content-hash dedupe), so we pull
      // positions from the live process. Layout may drift slightly if
      // the process was edited mid-instance; node identity is stable.
      if (!processCanvas) {
        try {
          const p = await apiGet<{ canvasData?: CanvasData }>(`/processes/${data.processId}`);
          if (p.canvasData) setProcessCanvas(p.canvasData);
        } catch {
          // Non-fatal — page still works without the flow view.
        }
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, processCanvas]);

  // Initial fetch; the auto-poll effect below picks up from there.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live auto-refresh while running. Interval is stopped + cleared
  // when the instance terminates OR the tab is hidden (to avoid
  // idle polling of backgrounded windows). Visibility-change
  // re-arms it when the tab comes back.
  const statusRef = useRef(detail?.status);
  statusRef.current = detail?.status;
  useEffect(() => {
    if (!detail || detail.status !== "running") return;
    let timer: number | null = null;
    const tick = () => {
      if (statusRef.current !== "running") return;
      refresh();
    };
    const start = () => {
      if (timer !== null) return;
      timer = window.setInterval(tick, 3_000);
    };
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [detail, refresh]);

  const onCancel = async () => {
    if (!detail || !window.confirm(`Cancel this instance? This cannot be undone.`)) return;
    setCancelling(true);
    try {
      await apiPost(`/instances/${detail.id}/cancel`, { reason: "Cancelled from UI" });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const canvas: CanvasData | null = processCanvas ?? (detail?.canvasData as CanvasData | null) ?? null;
  const filteredEvents = useMemo(() => {
    if (!detail) return [];
    if (!selectedNodeId) return detail.recentEvents;
    return detail.recentEvents.filter((e) => e.nodeId === selectedNodeId);
  }, [detail, selectedNodeId]);

  if (loading) {
    return <div style={{ padding: 60, textAlign: "center", color: "#98A2B3", fontSize: 13 }}>Loading…</div>;
  }
  if (error || !detail) {
    return (
      <div style={{ padding: "10px 14px", border: "1px solid #FECACA", background: "#FEF2F2", borderRadius: 8, color: "#B42318", fontSize: 13 }}>
        {error ?? "Instance not found"}
      </div>
    );
  }

  const st = STATUS_STYLES[detail.status];
  const isRunning = detail.status === "running";

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <button
            onClick={() => navigate("/running")}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px 4px 8px", borderRadius: 6, border: "1px solid #E5E7EB",
              background: "#fff", fontSize: 12, color: "#475467", fontWeight: 500,
              cursor: "pointer", fontFamily: "inherit", marginBottom: 10,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
            Back to instances
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#101828", letterSpacing: "-0.02em", margin: 0 }}>
              Instance
            </h1>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "4px 12px", borderRadius: 6,
              background: st.bg, fontSize: 12, fontWeight: 600, color: st.text,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot }} />
              {st.label}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#9CA3AF", fontFamily: "var(--font-mono, monospace)", marginTop: 4 }}>
            {detail.id}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={refresh}
            style={{
              padding: "9px 16px", borderRadius: 8, border: "1px solid #E5E7EB",
              background: "#fff", fontSize: 13, fontWeight: 600, color: "#475467",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Refresh
          </button>
          {isRunning && (
            <button
              onClick={onCancel}
              disabled={cancelling}
              style={{
                padding: "9px 18px", borderRadius: 8, border: "1px solid #FECACA",
                background: "#fff", fontSize: 13, fontWeight: 600, color: "#B42318",
                cursor: cancelling ? "not-allowed" : "pointer", fontFamily: "inherit",
                opacity: cancelling ? 0.7 : 1,
              }}
            >
              {cancelling ? "Cancelling…" : "Cancel instance"}
            </button>
          )}
        </div>
      </div>

      {/* Flow diagram with live state overlay */}
      {canvas && (canvas.nodes?.length ?? 0) > 0 && (
        <Card
          title={selectedNodeId ? `Flow — filtered to ${selectedNodeId}` : "Flow — click a node to filter events"}
          style={{ marginBottom: 16 }}
        >
          {selectedNodeId && (
            <button
              onClick={() => setSelectedNodeId(null)}
              style={{
                padding: "4px 10px", borderRadius: 6, border: "1px solid #E5E7EB",
                background: "#fff", fontSize: 11, fontWeight: 600, color: "#475467",
                cursor: "pointer", marginBottom: 8,
              }}
            >
              Clear filter
            </button>
          )}
          <InstanceCanvas
            canvas={canvas}
            tokens={detail.tokens}
            events={detail.recentEvents}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            height={480}
          />
        </Card>
      )}

      {/* Top section: meta + variables side-by-side */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) 2fr", gap: 16, marginBottom: 16 }}>
        <Card title="Instance">
          <Field label="Process" mono>{detail.processId.slice(0, 8)}…</Field>
          <Field label="Hash" mono>{detail.definitionHash.slice(0, 12)}…</Field>
          <Field label="Started by" mono>{detail.startedBy.slice(0, 8)}…</Field>
          <Field label="Started at">{new Date(detail.startedAt).toLocaleString()}</Field>
          {detail.completedAt && (
            <Field label="Ended at">{new Date(detail.completedAt).toLocaleString()}</Field>
          )}
          <Field label="Version">{String(detail.version)}</Field>
          {detail.errorMessage && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, fontSize: 12, color: "#B42318" }}>
              {detail.errorMessage}
            </div>
          )}
        </Card>

        <Card title="Variables">
          {Object.keys(detail.variables).length === 0 ? (
            <div style={{ fontSize: 13, color: "#98A2B3", padding: "12px 0" }}>No variables set</div>
          ) : (
            <pre style={{
              margin: 0, padding: 12, background: "#F9FAFB", borderRadius: 6,
              fontSize: 12, fontFamily: "var(--font-mono, monospace)", color: "#101828",
              overflow: "auto", maxHeight: 240,
            }}>
              {JSON.stringify(detail.variables, null, 2)}
            </pre>
          )}
        </Card>
      </div>

      {/* Tokens */}
      <Card title={`Tokens (${detail.tokens.length})`}>
        {detail.tokens.length === 0 ? (
          <div style={{ fontSize: 13, color: "#98A2B3", padding: 12 }}>No tokens</div>
        ) : (
          <div>
            {detail.tokens.map((tok) => (
              <div key={tok.id} style={{
                display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 120px 120px 1fr 100px",
                padding: "10px 0", borderTop: "1px solid #F2F4F7",
                alignItems: "center", fontSize: 13,
              }}>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "#475467" }}>
                  {tok.id.slice(0, 8)}…
                </span>
                <span style={{ color: "#475467" }}>
                  Node <code style={{ fontSize: 12, fontFamily: "var(--font-mono, monospace)" }}>{tok.currentNodeId}</code>
                </span>
                <TokenStatusBadge status={tok.status} />
                <span style={{ fontSize: 12, color: "#667085" }}>
                  {tok.waitingFor ? `Waiting on ${tok.waitingFor}` : ""}
                  {tok.assignedTo ? ` · ${tok.assignedTo.slice(0, 8)}…` : ""}
                </span>
                <span style={{ fontSize: 12, color: "#9CA3AF", textAlign: "right" }}>
                  v{tok.version}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recent events */}
      <Card title={selectedNodeId
        ? `Events at ${selectedNodeId} (${filteredEvents.length})`
        : `Recent events (${detail.recentEvents.length})`} style={{ marginTop: 16 }}>
        {filteredEvents.length === 0 ? (
          <div style={{ fontSize: 13, color: "#98A2B3", padding: 12 }}>No events</div>
        ) : (
          <div>
            {filteredEvents.map((ev) => (
              <div key={ev.id} style={{
                display: "grid", gridTemplateColumns: "180px minmax(140px, 1fr) 1fr 110px",
                padding: "8px 0", borderTop: "1px solid #F2F4F7",
                alignItems: "start", fontSize: 12,
              }}>
                <span style={{
                  display: "inline-flex", padding: "2px 8px", borderRadius: 4,
                  background: eventTypeBg(ev.eventType), color: "#475467",
                  fontFamily: "var(--font-mono, monospace)", fontSize: 11, fontWeight: 600,
                  alignSelf: "start", maxWidth: "fit-content",
                }}>
                  {ev.eventType}
                </span>
                <span style={{ color: "#475467", fontSize: 12 }}>
                  {ev.nodeId && <code style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>{ev.nodeId}</code>}
                </span>
                <code style={{
                  fontFamily: "var(--font-mono, monospace)", fontSize: 11,
                  color: "#667085", whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {ev.payload ? JSON.stringify(ev.payload) : ""}
                </code>
                <span style={{ fontSize: 11, color: "#9CA3AF", textAlign: "right" }}>
                  {new Date(ev.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Card(props: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 20px", ...props.style }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
        {props.title}
      </div>
      {props.children}
    </div>
  );
}

function Field(props: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
      <span style={{ color: "#667085" }}>{props.label}</span>
      <span style={{ color: "#101828", fontWeight: 500, fontFamily: props.mono ? "var(--font-mono, monospace)" : undefined, fontSize: props.mono ? 12 : 13 }}>
        {props.children}
      </span>
    </div>
  );
}

function TokenStatusBadge({ status }: { status: "active" | "waiting" | "completed" | "failed" }) {
  const m: Record<typeof status, { bg: string; color: string; label: string }> = {
    active:    { bg: "#EEF2FF", color: "#4338CA", label: "Active" },
    waiting:   { bg: "#FEF3C7", color: "#92400E", label: "Waiting" },
    completed: { bg: "#F0FDF4", color: "#166534", label: "Done" },
    failed:    { bg: "#FEF2F2", color: "#B42318", label: "Failed" },
  };
  const s = m[status];
  return (
    <span style={{ display: "inline-flex", padding: "2px 10px", borderRadius: 6, background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, maxWidth: "fit-content" }}>
      {s.label}
    </span>
  );
}

function eventTypeBg(eventType: string): string {
  if (eventType.startsWith("instance-completed") || eventType === "token-completed") return "#F0FDF4";
  if (eventType.startsWith("instance-failed") || eventType === "error") return "#FEF2F2";
  if (eventType === "instance-cancelled") return "#F9FAFB";
  if (eventType.startsWith("task-")) return "#EEF2FF";
  return "#F2F4F7";
}
