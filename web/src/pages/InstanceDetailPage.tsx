/* ─── Instance Detail ───────────────────────────────────────────────
 * Full-width diagram as the primary surface; step details open in a
 * right-side overlay drawer on node click. Tabs below are always
 * instance-scoped (drawer owns step-scope). Selection is reflected
 * in the URL hash (`#node=xxx`) so refresh/share preserves state.
 *
 * Auto-refresh: polls every 3 s while running; pauses on hidden tab.
 * ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";
import InstanceCanvas from "./console/InstanceCanvas";
import StepSnapshot from "./console/StepSnapshot";
import EditVariablesDialog from "./console/EditVariablesDialog";
import ReplayStepDialog from "./console/ReplayStepDialog";
import AiCopilotDialog from "./console/AiCopilotDialog";
import { useAuth } from "../lib/auth";
import { useActingForSnapshot } from "../lib/acting-for";

function newIdemKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
}

type InstanceDetail = {
  id: string;
  processId: string;
  processName: string | null;
  processVersion: number | null;
  processVersionId: string | null;
  definitionHash: string;
  businessKey: string | null;
  status: "running" | "completed" | "failed" | "cancelled" | "suspended";
  variables: Record<string, unknown>;
  startedBy: string;
  startedByName: string | null;
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

type CanvasNode = { id: string; type?: string; position?: { x: number; y: number }; data?: Record<string, unknown>; width?: number; height?: number; parentId?: string };
type CanvasEdge = { id: string; source: string; target: string; type?: string; data?: Record<string, unknown>; sourceHandle?: string | null; targetHandle?: string | null };
type CanvasData = { nodes?: CanvasNode[]; edges?: CanvasEdge[] };

const STATUS_STYLES: Record<InstanceDetail["status"], { bg: string; text: string; dot: string; label: string }> = {
  running:   { bg: "#EEF2FF", text: "#4338CA", dot: "#6366F1", label: "Running" },
  completed: { bg: "#F0FDF4", text: "#166534", dot: "#22C55E", label: "Completed" },
  failed:    { bg: "#FEF2F2", text: "#B42318", dot: "#EF4444", label: "Failed" },
  cancelled: { bg: "#F9FAFB", text: "#475467", dot: "#98A2B3", label: "Cancelled" },
  suspended: { bg: "#FFFBEB", text: "#92400E", dot: "#F59E0B", label: "Suspended" },
};

type TabKey = "activity" | "variables" | "incidents";

function readNodeFromHash(): string | null {
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return null;
  const params = new URLSearchParams(h);
  return params.get("node");
}

function writeNodeToHash(nodeId: string | null) {
  const h = nodeId ? `#node=${encodeURIComponent(nodeId)}` : "";
  const next = window.location.pathname + window.location.search + h;
  window.history.replaceState(null, "", next);
}

export default function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [processCanvas, setProcessCanvas] = useState<CanvasData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => readNodeFromHash());
  const [pinned, setPinned] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<null | "suspend" | "resume" | "edit" | "replay">(null);
  const [activeTab, setActiveTab] = useState<TabKey>("activity");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(Date.now());
  const [, setNowTick] = useState(0);
  const { user } = useAuth();
  const isAdmin = user?.systemRole === "owner" || user?.systemRole === "admin";
  const pageActingFor = useActingForSnapshot();

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiGet<InstanceDetail>(`/instances/${id}`);
      setDetail(data);
      if (!processCanvas) {
        try {
          const p = await apiGet<{ canvasData?: CanvasData }>(`/processes/${data.processId}`);
          if (p.canvasData) setProcessCanvas(p.canvasData);
        } catch { /* non-fatal */ }
      }
      setError(null);
      setLastRefreshedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, processCanvas]);

  useEffect(() => { refresh(); }, [refresh]);

  const statusRef = useRef(detail?.status);
  statusRef.current = detail?.status;
  useEffect(() => {
    if (!detail || detail.status !== "running") return;
    let timer: number | null = null;
    const tick = () => { if (statusRef.current === "running") refresh(); };
    const start = () => { if (timer === null) timer = window.setInterval(tick, 3_000); };
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const onVis = () => { document.visibilityState === "visible" ? start() : stop(); };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [detail, refresh]);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => { writeNodeToHash(selectedNodeId); }, [selectedNodeId]);
  useEffect(() => {
    const onHash = () => setSelectedNodeId(readNodeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!selectedNodeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pinned) setSelectedNodeId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNodeId, pinned]);

  const onCancel = async () => {
    if (!detail || !window.confirm(`Cancel this instance? This cannot be undone.`)) return;
    setCancelling(true);
    try {
      await apiPost(`/instances/${detail.id}/cancel`, { reason: "Cancelled from UI" }, {
        headers: { "Idempotency-Key": newIdemKey() },
        actingForOverride: pageActingFor,
      });
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setCancelling(false); }
  };

  const onSuspend = async () => {
    if (!detail) return;
    const reason = window.prompt("Reason for suspending? (optional)") ?? "";
    setBusyAction("suspend");
    try {
      await apiPost(`/instances/${detail.id}/suspend`, reason.trim() ? { reason: reason.trim() } : {}, {
        headers: { "Idempotency-Key": newIdemKey() },
        actingForOverride: pageActingFor,
      });
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusyAction(null); }
  };

  const onResume = async () => {
    if (!detail) return;
    setBusyAction("resume");
    try {
      await apiPost(`/instances/${detail.id}/resume`, {}, {
        headers: { "Idempotency-Key": newIdemKey() },
        actingForOverride: pageActingFor,
      });
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusyAction(null); }
  };

  const onEditSubmit = async (patch: Record<string, unknown>, reason: string, idemKey: string, actingForSnapshot: string | null) => {
    if (!detail) return;
    setBusyAction("edit");
    try {
      await apiPost(`/instances/${detail.id}/variables`, { patch, reason }, {
        headers: { "Idempotency-Key": idemKey },
        actingForOverride: actingForSnapshot,
      });
      setEditOpen(false);
      await refresh();
    } catch (e) { throw e; }
    finally { setBusyAction(null); }
  };

  const onReplaySubmit = async (reason: string, variablesPatch: Record<string, unknown> | undefined, idemKey: string, actingForSnapshot: string | null) => {
    if (!detail || !selectedNodeId) return;
    setBusyAction("replay");
    try {
      await apiPost(`/instances/${detail.id}/replay`, {
        targetNodeId: selectedNodeId, reason, ...(variablesPatch ? { variablesPatch } : {}),
      }, {
        headers: { "Idempotency-Key": idemKey },
        actingForOverride: actingForSnapshot,
      });
      setReplayOpen(false);
      setSelectedNodeId(null);
      await refresh();
    } catch (e) { throw e; }
    finally { setBusyAction(null); }
  };

  /* Task lifecycle actions — operate on the token sitting at a
   * waiting userTask. The token id IS the task id in our engine.
   * Complete and Reassign open a small modal; Claim/Release/Skip
   * are direct calls (with confirms where needed). */
  const [completeForToken, setCompleteForToken] = useState<string | null>(null);
  const [reassignForToken, setReassignForToken] = useState<string | null>(null);

  const onClaimTask = async (tokenId: string) => {
    try {
      await apiPost(`/tasks/${tokenId}/claim`, {}, { actingForOverride: pageActingFor });
      await refresh();
    } catch (e) { setError((e as Error).message); }
  };
  const onReleaseTask = async (tokenId: string) => {
    try {
      await apiPost(`/tasks/${tokenId}/unclaim`, {}, { actingForOverride: pageActingFor });
      await refresh();
    } catch (e) { setError((e as Error).message); }
  };
  const onOpenComplete = (tokenId: string) => setCompleteForToken(tokenId);
  const onSubmitComplete = async (tokenId: string, formData: Record<string, unknown>) => {
    await apiPost(`/tasks/${tokenId}/complete`, { formData }, {
      headers: { "Idempotency-Key": newIdemKey() },
      actingForOverride: pageActingFor,
    });
    setCompleteForToken(null);
    await refresh();
  };
  const onOpenReassign = (tokenId: string) => setReassignForToken(tokenId);
  const onSubmitReassign = async (tokenId: string, targetUserId: string) => {
    await apiPost(`/tasks/${tokenId}/reassign`, { userId: targetUserId }, {
      actingForOverride: pageActingFor,
    });
    setReassignForToken(null);
    await refresh();
  };
  const onSkipTask = async (tokenId: string) => {
    const reason = window.prompt("Reason for skipping this task? (optional, but recommended for the audit trail)");
    if (reason === null) return; // user cancelled
    try {
      await apiPost(`/tasks/${tokenId}/skip`, reason.trim() ? { reason: reason.trim() } : {}, {
        headers: { "Idempotency-Key": newIdemKey() },
        actingForOverride: pageActingFor,
      });
      await refresh();
    } catch (e) { setError((e as Error).message); }
  };

  const canvas: CanvasData | null = processCanvas ?? (detail?.canvasData as CanvasData | null) ?? null;

  const selectedNode: CanvasNode | null = useMemo(() => {
    if (!canvas || !selectedNodeId) return null;
    return canvas.nodes?.find((n) => n.id === selectedNodeId) ?? null;
  }, [canvas, selectedNodeId]);

  const selectedNodeTokens = useMemo(() => {
    if (!detail || !selectedNodeId) return [];
    return detail.tokens.filter((t) => t.currentNodeId === selectedNodeId);
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
  const isSuspended = detail.status === "suspended";
  const canAdmin = isRunning || isSuspended;

  const activeTokens = detail.tokens.filter((t) => t.status === "active" || t.status === "waiting").length;
  const incidentCount = detail.errorMessage ? 1 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "#101828", letterSpacing: "-0.02em", margin: 0 }}>
                {detail.processName ?? "Instance"}
              </h1>
              {detail.processVersion !== null && (
                <span style={{
                  fontSize: 12, fontWeight: 600, color: "#475467",
                  background: "#F2F4F7", padding: "2px 8px", borderRadius: 4,
                }} title="Process definition version">
                  v{detail.processVersion}
                </span>
              )}
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "3px 10px", borderRadius: 6,
                background: st.bg, fontSize: 12, fontWeight: 600, color: st.text,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot }} />
                {st.label}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "#475467", marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>Started by <strong style={{ color: "#101828", fontWeight: 600 }}>{detail.startedByName ?? "External system"}</strong></span>
              <Dot />
              <span>{new Date(detail.startedAt).toLocaleString()}</span>
              <Dot />
              <span>Running {formatDuration(detail.startedAt, detail.completedAt)}</span>
              {isRunning && (
                <>
                  <Dot />
                  <span style={{ color: "#98A2B3" }}>Updated {formatAgo(lastRefreshedAt)}</span>
                </>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {isAdmin && (
              <button
                onClick={() => setAiOpen(true)}
                title="Ask Claude about this instance"
                style={{
                  padding: "8px 14px", borderRadius: 8, border: "none",
                  background: "linear-gradient(135deg, #8B5CF6, #6366F1)",
                  color: "#fff", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <span aria-hidden="true">✨</span> Ask AI
              </button>
            )}
            <ActionsMenu
              items={[
                { key: "refresh", label: "Refresh now", onClick: refresh },
                canAdmin && { key: "edit", label: "Edit variables…", onClick: () => setEditOpen(true) },
                isRunning && { key: "suspend", label: busyAction === "suspend" ? "Suspending…" : "Suspend", onClick: onSuspend, disabled: busyAction === "suspend" },
                isSuspended && { key: "resume", label: busyAction === "resume" ? "Resuming…" : "Resume", onClick: onResume, disabled: busyAction === "resume" },
                canAdmin && { key: "cancel", label: cancelling ? "Cancelling…" : "Cancel instance", onClick: onCancel, disabled: cancelling, destructive: true },
              ].filter(Boolean) as MenuItem[]}
            />
          </div>
        </div>
      </div>

      {detail.errorMessage && (
        <div style={{ padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, fontSize: 13, color: "#B42318" }}>
          <strong>Incident:</strong> {detail.errorMessage}
        </div>
      )}

      {/* Quick stats: just two pill chips + business key + instance ID.
       * Replaces the cramped 6-column metrics strip with breathable
       * pills that map to the operator's first scan questions:
       * "is anything stuck?" / "anything failing?" / "which work item
       * is this?" — without UUID noise. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <StatPill
          icon="●"
          tone={activeTokens > 0 ? "info" : "neutral"}
          label={`${activeTokens} active step${activeTokens === 1 ? "" : "s"}`}
          tooltip="Steps currently in flight (waiting on a person, running a service, or sitting at a timer)."
        />
        <StatPill
          icon={incidentCount > 0 ? "⚠" : "✓"}
          tone={incidentCount > 0 ? "danger" : "success"}
          label={`${incidentCount} incident${incidentCount === 1 ? "" : "s"}`}
          tooltip="Errors that need human attention — failed service tasks, stuck timers, unhandled exceptions."
        />
        <div style={{ flex: 1 }} />
        {detail.businessKey && (
          <span
            title="A human-readable identifier your app supplies — used to find this work item without dealing with UUIDs."
            style={{ fontSize: 12, color: "#667085" }}
          >
            <span style={{ color: "#98A2B3" }}>Business key </span>
            <strong style={{ color: "#344054", fontWeight: 600 }}>{detail.businessKey}</strong>
          </span>
        )}
        <CopyableId id={detail.id} />
      </div>

      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
        {canvas && (canvas.nodes?.length ?? 0) > 0 ? (
          <InstanceCanvas
            canvas={canvas}
            tokens={detail.tokens}
            events={detail.recentEvents}
            selectedNodeId={selectedNodeId}
            onSelectNode={(id) => setSelectedNodeId((cur) => (cur === id ? null : id))}
            height={400}
          />
        ) : (
          <div style={{ padding: 60, textAlign: "center", color: "#98A2B3", fontSize: 13 }}>
            Flow diagram unavailable for this instance.
          </div>
        )}
      </div>

      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12 }}>
        <div style={{ display: "flex", borderBottom: "1px solid #EAECF0", padding: "0 8px", overflowX: "auto" }}>
          <TabButton active={activeTab === "activity"} onClick={() => setActiveTab("activity")}>
            Activity
          </TabButton>
          <TabButton active={activeTab === "variables"} onClick={() => setActiveTab("variables")}>
            Variables ({Object.keys(detail.variables).length})
          </TabButton>
          <TabButton
            active={activeTab === "incidents"}
            onClick={() => setActiveTab("incidents")}
            badge={incidentCount > 0 ? incidentCount : undefined}
            danger={incidentCount > 0}
          >
            Incidents
          </TabButton>
        </div>
        <div style={{ padding: "16px 20px" }}>
          {activeTab === "activity" && (
            <ActivityView
              events={detail.recentEvents}
              tokens={detail.tokens}
              canvasNodes={(canvas?.nodes ?? [])}
              startedBy={detail.startedBy}
              onOpenNode={setSelectedNodeId}
            />
          )}
          {activeTab === "variables" && <VariablesView variables={detail.variables} />}
          {activeTab === "incidents" && <IncidentsView errorMessage={detail.errorMessage} />}
        </div>
      </div>

      {selectedNodeId && (
        <NodeDrawer
          node={selectedNode}
          nodeId={selectedNodeId}
          tokens={selectedNodeTokens}
          events={detail.recentEvents.filter((e) => e.nodeId === selectedNodeId)}
          currentVariables={detail.variables}
          currentUser={user}
          isAdmin={isAdmin}
          onClaimTask={onClaimTask}
          onReleaseTask={onReleaseTask}
          onCompleteTask={onOpenComplete}
          onReassignTask={onOpenReassign}
          onSkipTask={onSkipTask}
          canAdmin={canAdmin}
          pinned={pinned}
          onTogglePin={() => setPinned((v) => !v)}
          onClose={() => setSelectedNodeId(null)}
          onReplay={() => setReplayOpen(true)}
          onExplain={() => setAiOpen(true)}
          onEditVars={() => setEditOpen(true)}
        />
      )}

      {editOpen && (
        <EditVariablesDialog
          currentVariables={detail.variables}
          onClose={() => setEditOpen(false)}
          onSubmit={onEditSubmit}
        />
      )}
      {replayOpen && selectedNodeId && (
        <ReplayStepDialog
          targetNodeId={selectedNodeId}
          onClose={() => setReplayOpen(false)}
          onSubmit={onReplaySubmit}
        />
      )}
      {aiOpen && (
        <AiCopilotDialog
          instanceId={detail.id}
          onClose={() => setAiOpen(false)}
        />
      )}
      {completeForToken && (
        <CompleteTaskDialog
          tokenId={completeForToken}
          onClose={() => setCompleteForToken(null)}
          onSubmit={onSubmitComplete}
        />
      )}
      {reassignForToken && (
        <ReassignTaskDialog
          tokenId={reassignForToken}
          candidateRole={detail.tokens.find((t) => t.id === reassignForToken)?.candidateRole ?? null}
          currentAssignee={detail.tokens.find((t) => t.id === reassignForToken)?.assignedTo ?? null}
          onClose={() => setReassignForToken(null)}
          onSubmit={onSubmitReassign}
        />
      )}
    </div>
  );
}

/* ─── Drawer (overlay, right edge) ───────────────────────────────── */

function NodeDrawer(props: {
  node: CanvasNode | null;
  nodeId: string;
  tokens: InstanceDetail["tokens"];
  events: InstanceDetail["recentEvents"];
  currentVariables: Record<string, unknown>;
  currentUser: { id: string; roles: string[]; systemRole: string } | null;
  isAdmin: boolean;
  canAdmin: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onClose: () => void;
  onReplay: () => void;
  onExplain: () => void;
  onEditVars: () => void;
  onClaimTask: (tokenId: string) => Promise<void> | void;
  onReleaseTask: (tokenId: string) => Promise<void> | void;
  onCompleteTask: (tokenId: string) => Promise<void> | void;
  onReassignTask: (tokenId: string) => Promise<void> | void;
  onSkipTask: (tokenId: string) => Promise<void> | void;
}) {
  const { node, nodeId, tokens, events, currentVariables, currentUser, isAdmin, canAdmin,
    pinned, onTogglePin, onClose, onReplay, onExplain, onEditVars,
    onClaimTask, onReleaseTask, onCompleteTask, onReassignTask, onSkipTask } = props;
  const nodeLabel = String((node?.data as { label?: string })?.label ?? nodeId);
  const nodeType = String(node?.type ?? "node");
  const liveToken = tokens[0];

  /* Eligibility for the task lifecycle buttons. The token id IS the
   * task id in our engine. We only render the buttons that the
   * current user is actually allowed to invoke — Camunda Tasklist
   * pattern (don't show buttons that will 403). */
  const isUserTask = liveToken?.waitingFor === "userTask";
  const isWaiting = liveToken?.status === "waiting";
  const myId = currentUser?.id ?? "";
  const myRoles = currentUser?.roles ?? [];
  const hasCandidateRole = liveToken?.candidateRole ? myRoles.includes(liveToken.candidateRole) : false;
  const isAssignee = liveToken?.assignedTo === myId;
  const canClaim = isUserTask && isWaiting && !liveToken?.assignedTo && (isAdmin || hasCandidateRole);
  const canRelease = isUserTask && isWaiting && isAssignee;
  const canComplete = isUserTask && isWaiting && (isAssignee || isAdmin);
  // Reassign + Skip are admin-only escape hatches: they don't fit the
  // normal claim/complete flow and are intended for unblocking stuck
  // instances when the assignee is unavailable.
  const canReassign = isUserTask && isWaiting && isAdmin;
  const canSkip = isUserTask && isWaiting && isAdmin;

  return (
    <aside
      role="complementary"
      aria-label={`Details for ${nodeLabel}`}
      style={{
        position: "fixed", top: 20, right: 20, bottom: 20, width: 400,
        background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12,
        boxShadow: "0 24px 48px -12px rgba(16,24,40,0.18), 0 8px 16px -6px rgba(16,24,40,0.10)",
        zIndex: 40, display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid #EAECF0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {humanizeNodeType(nodeType)}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <IconButton onClick={onTogglePin} title={pinned ? "Unpin drawer" : "Pin drawer open"} active={pinned}>
              {pinned ? "📌" : "📍"}
            </IconButton>
            <IconButton onClick={onClose} title="Close (Esc)">✕</IconButton>
          </div>
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, color: "#101828", wordBreak: "break-word", lineHeight: 1.3 }}>
          {nodeLabel}
        </div>
        <div style={{ fontSize: 11, color: "#98A2B3", fontFamily: "var(--font-mono, monospace)", marginTop: 2 }}>
          {nodeId}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        <DrawerSection label="Execution">
          {liveToken ? (
            <div>
              <DrawerRow label="Status"><TokenBadge status={liveToken.status} /></DrawerRow>
              <DrawerRow label="Waiting for">{humanizeWaitingFor(liveToken.waitingFor)}</DrawerRow>
              <DrawerRow label="Role">{liveToken.candidateRole ?? "—"}</DrawerRow>
              <DrawerRow label="Assignee">{liveToken.assignedTo ? `${liveToken.assignedTo.slice(0, 8)}…` : "—"}</DrawerRow>
            </div>
          ) : (
            <div style={emptyStyle}>
              No active execution at this step. It may have already completed, or the flow hasn't reached here yet.
            </div>
          )}
        </DrawerSection>

        <DrawerSection label="Variables" right={canAdmin ? <button onClick={onEditVars} style={linkBtn}>Edit</button> : null}>
          {Object.keys(currentVariables).length === 0 ? (
            <div style={emptyStyle}>No variables set on this instance.</div>
          ) : (
            <pre style={{
              margin: 0, padding: 10, background: "#F9FAFB", borderRadius: 6,
              fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "#101828",
              overflow: "auto", maxHeight: 180,
            }}>
              {JSON.stringify(currentVariables, null, 2)}
            </pre>
          )}
        </DrawerSection>

        <Collapsible label="Business document (step-scoped snapshot)">
          <StepSnapshot nodeId={nodeId} events={events} currentVariables={currentVariables} />
        </Collapsible>

        <Collapsible label={`Activity (${events.filter(isMeaningfulEvent).length})`}>
          {(() => {
            const filtered = events.filter(isMeaningfulEvent);
            if (filtered.length === 0) return <div style={emptyStyle}>No activity yet for this step.</div>;
            return (
              <div>
                {filtered.map((ev) => {
                  const h = humanizeEvent(ev.eventType);
                  return (
                    <div key={ev.id} style={{ padding: "8px 0", borderTop: "1px solid #F2F4F7", fontSize: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ color: h.tone === "danger" ? "#B42318" : h.tone === "success" ? "#166534" : "#344054", fontWeight: 500 }}>
                          {h.label}
                        </span>
                        <span style={{ color: "#9CA3AF", fontSize: 11 }}>{new Date(ev.createdAt).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </Collapsible>
      </div>

      <div style={{ padding: "12px 16px", borderTop: "1px solid #EAECF0", background: "#FCFCFD" }}>
        {canAdmin ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(canClaim || canRelease || canComplete) && (
              <ActionGroup label="Task actions">
                {canClaim && (
                  <button
                    onClick={() => liveToken && onClaimTask(liveToken.id)}
                    style={actionBtnPrimary}
                    title="Take ownership of this task"
                  >
                    Claim
                  </button>
                )}
                {canComplete && (
                  <button
                    onClick={() => liveToken && onCompleteTask(liveToken.id)}
                    style={actionBtn}
                    title="Mark this task as done"
                  >
                    Complete
                  </button>
                )}
                {canRelease && (
                  <button
                    onClick={() => liveToken && onReleaseTask(liveToken.id)}
                    style={actionBtn}
                    title="Release back to the role queue"
                  >
                    Release
                  </button>
                )}
              </ActionGroup>
            )}

            {isUserTask && isWaiting && !canClaim && !canRelease && !canComplete && (
              <div style={{ fontSize: 11, color: "#667085", padding: "0 0 4px" }}>
                You don't have permission to act on this task.
                {liveToken?.candidateRole && ` Required role: ${liveToken.candidateRole}.`}
              </div>
            )}

            {(canReassign || canSkip) && (
              <ActionGroup label="Admin overrides">
                {canReassign && (
                  <button
                    onClick={() => liveToken && onReassignTask(liveToken.id)}
                    style={actionBtn}
                    title="Reassign this task to a different user"
                  >
                    Reassign…
                  </button>
                )}
                {canSkip && (
                  <button
                    onClick={() => liveToken && onSkipTask(liveToken.id)}
                    style={actionBtn}
                    title="Advance the token past this step without form data"
                  >
                    Skip step
                  </button>
                )}
              </ActionGroup>
            )}

            <ActionGroup label="Step actions">
              <button onClick={onReplay} style={actionBtn} title="Cancel live tokens and rewind to this step">
                ⟲ Replay from this step
              </button>
            </ActionGroup>

            <ActionGroup label="AI">
              <button onClick={onExplain} style={actionBtn}>
                ✨ Explain this step
              </button>
            </ActionGroup>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#667085", padding: "4px 0" }}>
            Instance is not in a live state — actions are disabled.
          </div>
        )}
      </div>
    </aside>
  );
}

function ActionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

/* ─── Drawer primitives ──────────────────────────────────────────── */

function DrawerSection({ label, right, children }: { label: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {label}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function DrawerRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderBottom: "1px solid #F2F4F7", gap: 8 }}>
      <span style={{ color: "#667085" }}>{label}</span>
      <span style={{ color: "#101828", fontWeight: 500, textAlign: "right" }}>{children}</span>
    </div>
  );
}

function Collapsible({ label, children, defaultOpen = false }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 16, border: "1px solid #EAECF0", borderRadius: 8 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", textAlign: "left", padding: "10px 12px",
          border: "none", background: "transparent", cursor: "pointer",
          fontSize: 12, fontWeight: 600, color: "#344054",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontFamily: "inherit",
        }}
      >
        {label}
        <span style={{ color: "#98A2B3", fontSize: 10 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div style={{ padding: "0 12px 12px" }}>{children}</div>}
    </div>
  );
}

function IconButton({ onClick, title, children, active }: { onClick: () => void; title: string; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: "4px 8px", borderRadius: 6,
        border: "1px solid " + (active ? "#C7D2FE" : "#E5E7EB"),
        background: active ? "#EEF2FF" : "#fff",
        fontSize: 12, color: active ? "#4338CA" : "#667085",
        cursor: "pointer", fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function TokenBadge({ status }: { status: "active" | "waiting" | "completed" | "failed" }) {
  const map = {
    active:    { bg: "#EEF2FF", color: "#4338CA", label: "Active" },
    waiting:   { bg: "#FEF3C7", color: "#92400E", label: "Waiting" },
    completed: { bg: "#F0FDF4", color: "#166534", label: "Done" },
    failed:    { bg: "#FEF2F2", color: "#B42318", label: "Failed" },
  };
  const s = map[status];
  return (
    <span style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 4, background: s.bg, color: s.color, fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

/* ─── Stat pill ──────────────────────────────────────────────────── */

function StatPill({ icon, label, tone, tooltip }: { icon: string; label: string; tone: "neutral" | "info" | "success" | "danger" | "warning"; tooltip?: string }) {
  const palette: Record<typeof tone, { bg: string; text: string; icon: string }> = {
    neutral: { bg: "#F9FAFB", text: "#475467", icon: "#98A2B3" },
    info:    { bg: "#EEF2FF", text: "#3730A3", icon: "#6366F1" },
    success: { bg: "#F0FDF4", text: "#166534", icon: "#22C55E" },
    danger:  { bg: "#FEF2F2", text: "#B42318", icon: "#EF4444" },
    warning: { bg: "#FFFBEB", text: "#92400E", icon: "#F59E0B" },
  };
  const c = palette[tone];
  return (
    <span title={tooltip} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "5px 12px", borderRadius: 999,
      background: c.bg, color: c.text,
      fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
    }}>
      <span style={{ color: c.icon, fontSize: 11 }}>{icon}</span>
      {label}
    </span>
  );
}

/* ─── Tabs ───────────────────────────────────────────────────────── */

function TabButton({ active, children, onClick, badge, danger }: { active: boolean; children: React.ReactNode; onClick: () => void; badge?: number; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "12px 14px", border: "none", background: "transparent",
        fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
        color: active ? "#101828" : "#667085",
        borderBottom: `2px solid ${active ? "#6366F1" : "transparent"}`,
        marginBottom: -1, display: "flex", alignItems: "center", gap: 6,
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {badge !== undefined && (
        <span style={{
          display: "inline-flex", minWidth: 18, height: 18, padding: "0 6px",
          background: danger ? "#FEF2F2" : "#F2F4F7",
          color: danger ? "#B42318" : "#475467",
          borderRadius: 9, fontSize: 10, fontWeight: 700,
          alignItems: "center", justifyContent: "center",
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}

function VariablesView({ variables }: { variables: Record<string, unknown> }) {
  if (Object.keys(variables).length === 0) {
    return <div style={emptyStyle}>No variables set on this instance.</div>;
  }
  return (
    <pre style={{
      margin: 0, padding: 12, background: "#F9FAFB", borderRadius: 6,
      fontSize: 12, fontFamily: "var(--font-mono, monospace)", color: "#101828",
      overflow: "auto", maxHeight: 320,
    }}>
      {JSON.stringify(variables, null, 2)}
    </pre>
  );
}

/* ─── Activity feed ──────────────────────────────────────────────── */

type ActivityRow =
  | { kind: "step"; key: string; nodeId: string; label: string; status: "completed" | "failed"; enteredAt: number; exitedAt: number; durationMs: number; userId: string | null }
  | { kind: "pending"; key: string; nodeId: string; label: string; waitingFor: string | null; role: string | null; assignee: string | null; since: number }
  | { kind: "instance"; key: string; label: string; tone: "neutral" | "success" | "warning" | "danger"; at: number; userId: string | null }
  | { kind: "admin"; key: string; label: string; at: number; userId: string | null }
  | { kind: "raw"; key: string; eventType: string; nodeId: string | null; at: number; userId: string | null };

function buildActivityFeed(args: {
  events: InstanceDetail["recentEvents"];
  tokens: InstanceDetail["tokens"];
  canvasNodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
  startedBy: string;
}): ActivityRow[] {
  const { events, tokens, canvasNodes, startedBy } = args;
  const nodeById = new Map(canvasNodes.map((n) => [n.id, n]));
  const labelOf = (id: string) => {
    const lbl = (nodeById.get(id)?.data as { label?: string } | undefined)?.label;
    return typeof lbl === "string" && lbl.trim() ? lbl : id;
  };
  const typeOf = (id: string) => nodeById.get(id)?.type ?? "";
  const isStartEnd = (id: string) => {
    const t = typeOf(id);
    return t === "startEvent" || t === "endEvent";
  };

  const rows: ActivityRow[] = [];

  // Pair node-entered → node-exited per node, in event order, to build
  // "step completed in Xs" rows. Multiple instances per node (loops)
  // produce multiple rows.
  const pendingEntries = new Map<string, Array<{ at: number; userId: string | null }>>();
  for (const ev of events) {
    if (ev.eventType === "node-entered" && ev.nodeId) {
      const at = new Date(ev.createdAt).getTime();
      const list = pendingEntries.get(ev.nodeId) ?? [];
      list.push({ at, userId: ev.userId });
      pendingEntries.set(ev.nodeId, list);
    } else if (ev.eventType === "node-exited" && ev.nodeId) {
      const at = new Date(ev.createdAt).getTime();
      const list = pendingEntries.get(ev.nodeId) ?? [];
      const entry = list.shift();
      // Start and end events fire at the same instant as
      // instance-started / instance-completed — folding them into one
      // row prevents duplicate "Process started + Leave submitted
      // completed" lines for the same moment.
      if (entry && !isStartEnd(ev.nodeId)) {
        rows.push({
          kind: "step",
          key: `step:${ev.id}`,
          nodeId: ev.nodeId,
          label: labelOf(ev.nodeId),
          status: "completed",
          enteredAt: entry.at,
          exitedAt: at,
          durationMs: at - entry.at,
          userId: ev.userId ?? entry.userId ?? null,
        });
      }
      pendingEntries.set(ev.nodeId, list);
    } else if (ev.eventType === "node-failed" && ev.nodeId) {
      const at = new Date(ev.createdAt).getTime();
      const list = pendingEntries.get(ev.nodeId) ?? [];
      const entry = list.shift();
      rows.push({
        kind: "step",
        key: `fail:${ev.id}`,
        nodeId: ev.nodeId,
        label: labelOf(ev.nodeId),
        status: "failed",
        enteredAt: entry?.at ?? at,
        exitedAt: at,
        durationMs: entry ? at - entry.at : 0,
        userId: ev.userId,
      });
      pendingEntries.set(ev.nodeId, list);
    } else if (ev.eventType === "instance-started") {
      // Plain "Process started". The diagram already shows which
      // start event fired; appending the node label here would
      // overpromise context we may not have when external systems
      // kick off the instance without a known user record.
      rows.push({ kind: "instance", key: ev.id, label: "Process started", tone: "neutral", at: new Date(ev.createdAt).getTime(), userId: ev.userId ?? startedBy });
    } else if (ev.eventType === "instance-completed") {
      rows.push({ kind: "instance", key: ev.id, label: "Process completed", tone: "success", at: new Date(ev.createdAt).getTime(), userId: ev.userId });
    } else if (ev.eventType === "instance-failed") {
      rows.push({ kind: "instance", key: ev.id, label: "Process failed", tone: "danger", at: new Date(ev.createdAt).getTime(), userId: ev.userId });
    } else if (ev.eventType === "instance-cancelled") {
      rows.push({ kind: "admin", key: ev.id, label: "Process cancelled", at: new Date(ev.createdAt).getTime(), userId: ev.userId });
    } else if (ev.eventType === "instance-suspended") {
      rows.push({ kind: "admin", key: ev.id, label: "Process paused", at: new Date(ev.createdAt).getTime(), userId: ev.userId });
    } else if (ev.eventType === "instance-resumed") {
      rows.push({ kind: "admin", key: ev.id, label: "Process resumed", at: new Date(ev.createdAt).getTime(), userId: ev.userId });
    } else if (ev.eventType === "variables-updated") {
      rows.push({ kind: "admin", key: ev.id, label: "Variables updated", at: new Date(ev.createdAt).getTime(), userId: ev.userId });
    } else if (ev.eventType === "replay") {
      const target = (ev.payload as { targetNodeId?: string } | null)?.targetNodeId;
      rows.push({ kind: "admin", key: ev.id, label: target ? `Replayed from “${labelOf(target)}”` : "Replayed", at: new Date(ev.createdAt).getTime(), userId: ev.userId });
    }
  }

  // Sort all completed rows chronologically (by exitedAt for steps,
  // by `at` for instance/admin events).
  rows.sort((a, b) => {
    const aT = a.kind === "step" ? a.exitedAt : (a as { at: number }).at;
    const bT = b.kind === "step" ? b.exitedAt : (b as { at: number }).at;
    return aT - bT;
  });

  // Append currently waiting steps as "pending" rows at the end.
  for (const t of tokens) {
    if (t.status !== "waiting" && t.status !== "active") continue;
    const list = pendingEntries.get(t.currentNodeId) ?? [];
    const entered = list[0];
    rows.push({
      kind: "pending",
      key: `pending:${t.id}`,
      nodeId: t.currentNodeId,
      label: labelOf(t.currentNodeId),
      waitingFor: t.waitingFor,
      role: t.candidateRole,
      assignee: t.assignedTo,
      since: entered?.at ?? Date.now(),
    });
  }

  return rows;
}

function ActivityView(props: {
  events: InstanceDetail["recentEvents"];
  tokens: InstanceDetail["tokens"];
  canvasNodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
  startedBy: string;
  onOpenNode: (nodeId: string) => void;
}) {
  const { events, tokens, canvasNodes, startedBy, onOpenNode } = props;
  const [showRaw, setShowRaw] = useState(false);

  const rows = useMemo(
    () => buildActivityFeed({ events, tokens, canvasNodes, startedBy }),
    [events, tokens, canvasNodes, startedBy],
  );

  if (rows.length === 0 && !showRaw) {
    return <div style={emptyStyle}>No activity yet.</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button
          onClick={() => setShowRaw((v) => !v)}
          style={{
            padding: "4px 10px", borderRadius: 6, border: "1px solid #E5E7EB",
            background: "#fff", fontSize: 11, fontWeight: 600, color: "#475467",
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {showRaw ? "Hide technical events" : "Show technical events"}
        </button>
      </div>

      {!showRaw ? (
        <div>
          {rows.map((r) => (
            <ActivityRowView key={r.key} row={r} onOpenNode={onOpenNode} />
          ))}
        </div>
      ) : (
        <RawEventsTable events={events} onOpenNode={onOpenNode} />
      )}
    </div>
  );
}

function ActivityRowView({ row, onOpenNode }: { row: ActivityRow; onOpenNode: (id: string) => void }) {
  const dotColor =
    row.kind === "step" && row.status === "completed" ? "#22C55E" :
    row.kind === "step" && row.status === "failed" ? "#EF4444" :
    row.kind === "pending" ? "#F59E0B" :
    row.kind === "instance" && row.tone === "success" ? "#22C55E" :
    row.kind === "instance" && row.tone === "danger" ? "#EF4444" :
    row.kind === "admin" ? "#6366F1" : "#98A2B3";

  const time =
    row.kind === "step" ? new Date(row.exitedAt).toLocaleString() :
    row.kind === "pending" ? `since ${new Date(row.since).toLocaleString()}` :
    new Date((row as { at: number }).at).toLocaleString();

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "20px 1fr auto",
      padding: "12px 0", borderTop: "1px solid #F2F4F7",
      alignItems: "start", gap: 12,
    }}>
      <div style={{
        marginTop: 4, width: 10, height: 10, borderRadius: "50%",
        background: dotColor,
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "#101828", fontWeight: 500 }}>
          {renderRowTitle(row, onOpenNode)}
        </div>
        <div style={{ fontSize: 12, color: "#667085", marginTop: 2 }}>
          {renderRowSubtitle(row)}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#98A2B3", whiteSpace: "nowrap" }}>{time}</div>
    </div>
  );
}

function renderRowTitle(row: ActivityRow, onOpenNode: (id: string) => void): React.ReactNode {
  if (row.kind === "step") {
    return (
      <>
        <NodeLink id={row.nodeId} label={row.label} onOpenNode={onOpenNode} />
        {row.status === "completed" ? " — completed" : " — failed"}
        {row.durationMs > 0 ? ` in ${formatMs(row.durationMs)}` : ""}
      </>
    );
  }
  if (row.kind === "pending") {
    return (
      <>
        <NodeLink id={row.nodeId} label={row.label} onOpenNode={onOpenNode} />
        {" — waiting"}
      </>
    );
  }
  if (row.kind === "instance" || row.kind === "admin") return row.label;
  return null;
}

function renderRowSubtitle(row: ActivityRow): React.ReactNode {
  if (row.kind === "step") {
    return row.userId ? `By ${row.userId.slice(0, 8)}…` : "Automatic step";
  }
  if (row.kind === "pending") {
    const parts: string[] = [];
    parts.push(`Waiting for ${humanizeWaitingFor(row.waitingFor)}`);
    if (row.role) parts.push(`role: ${row.role}`);
    if (row.assignee) parts.push(`assignee: ${row.assignee.slice(0, 8)}…`);
    parts.push(`pending ${formatMs(Date.now() - row.since)}`);
    return parts.join(" · ");
  }
  if (row.kind === "admin" || row.kind === "instance") {
    return row.userId ? `By ${row.userId.slice(0, 8)}…` : "By external system";
  }
  return null;
}

function NodeLink({ id, label, onOpenNode }: { id: string; label: string; onOpenNode: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpenNode(id)}
      style={{
        border: "none", background: "transparent", padding: 0,
        fontSize: 13, color: "#4338CA", cursor: "pointer",
        fontFamily: "inherit", fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}

function RawEventsTable({ events, onOpenNode }: { events: InstanceDetail["recentEvents"]; onOpenNode: (id: string) => void }) {
  if (events.length === 0) return <div style={emptyStyle}>No events.</div>;
  return (
    <div>
      {events.map((ev) => (
        <div key={ev.id} style={{
          display: "grid", gridTemplateColumns: "180px minmax(120px, 1fr) 2fr 110px",
          padding: "8px 0", borderTop: "1px solid #F2F4F7",
          alignItems: "start", fontSize: 11,
        }}>
          <code style={{ fontFamily: "var(--font-mono, monospace)", color: "#475467", fontWeight: 600 }}>{ev.eventType}</code>
          <span>
            {ev.nodeId ? (
              <button onClick={() => onOpenNode(ev.nodeId!)} style={{
                border: "none", background: "transparent", padding: 0,
                fontFamily: "var(--font-mono, monospace)", fontSize: 11,
                color: "#4338CA", cursor: "pointer", textDecoration: "underline",
              }}>{ev.nodeId}</button>
            ) : <span style={{ color: "#98A2B3" }}>—</span>}
          </span>
          <code style={{
            fontFamily: "var(--font-mono, monospace)", color: "#667085",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {ev.payload ? JSON.stringify(ev.payload) : ""}
          </code>
          <span style={{ color: "#9CA3AF", textAlign: "right" }}>
            {new Date(ev.createdAt).toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function IncidentsView({ errorMessage }: { errorMessage: string | null }) {
  if (!errorMessage) {
    return <div style={emptyStyle}>No incidents for this instance.</div>;
  }
  return (
    <div style={{ padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, fontSize: 13, color: "#B42318" }}>
      {errorMessage}
    </div>
  );
}

/* ─── Actions overflow menu ──────────────────────────────────────── */

type MenuItem = { key: string; label: string; onClick: () => void; disabled?: boolean; destructive?: boolean };

function ActionsMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB",
          background: "#fff", fontSize: 13, fontWeight: 600, color: "#475467",
          cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
        }}
      >
        Actions
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 220,
          background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
          boxShadow: "0 12px 24px rgba(16,24,40,0.10)", zIndex: 50, padding: 4,
        }}>
          {items.map((it) => (
            <button
              key={it.key}
              disabled={it.disabled}
              onClick={() => { if (!it.disabled) { it.onClick(); setOpen(false); } }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "8px 12px", border: "none", background: "transparent",
                fontSize: 13, fontWeight: 500,
                color: it.destructive ? "#B42318" : "#101828",
                cursor: it.disabled ? "not-allowed" : "pointer",
                opacity: it.disabled ? 0.5 : 1, borderRadius: 6,
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => { (e.currentTarget.style.background = "#F9FAFB"); }}
              onMouseLeave={(e) => { (e.currentTarget.style.background = "transparent"); }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Small helpers ──────────────────────────────────────────────── */

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      title={id}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 4, border: "1px solid #E5E7EB",
        background: "#F9FAFB", cursor: "pointer", fontFamily: "inherit",
        fontSize: 11, color: "#667085",
      }}
    >
      <code style={{ fontFamily: "var(--font-mono, monospace)" }}>{id.slice(0, 8)}…</code>
      <span style={{ fontSize: 10, color: copied ? "#166534" : "#98A2B3" }}>{copied ? "✓" : "⧉"}</span>
    </button>
  );
}

function Dot() {
  return <span style={{ color: "#D0D5DD" }}>·</span>;
}

function humanizeNodeType(t: string): string {
  if (!t) return "Node";
  const spaced = t.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const emptyStyle: React.CSSProperties = {
  fontSize: 12, color: "#98A2B3", padding: "8px 0", lineHeight: 1.5,
};

const actionBtn: React.CSSProperties = {
  padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB",
  background: "#fff", fontSize: 13, fontWeight: 600, color: "#475467",
  cursor: "pointer", fontFamily: "inherit", textAlign: "left",
};

const actionBtnPrimary: React.CSSProperties = {
  ...actionBtn,
  border: "1px solid #FDE68A", background: "#FFFBEB", color: "#92400E",
};

const linkBtn: React.CSSProperties = {
  padding: "2px 6px", borderRadius: 4, border: "none",
  background: "transparent", fontSize: 11, fontWeight: 600,
  color: "#4338CA", cursor: "pointer", fontFamily: "inherit",
};

/* Event humanization for the operator UI. "Plumbing" events
 * (token-created, edge-taken) are filtered out of the default view
 * — they aren't useful to a business operator and clutter the
 * picture. Users can toggle "Show all events" for the raw list. */
const MEANINGFUL_EVENTS = new Set<string>([
  "instance-started", "instance-completed", "instance-failed", "instance-cancelled",
  "instance-suspended", "instance-resumed",
  "node-entered", "node-exited", "node-failed",
  "token-waiting", "token-completed", "token-failed",
  "task-assigned", "task-reassigned", "task-completed", "task-claimed",
  "variables-updated", "error", "incident-raised", "incident-resolved",
  "replay", "impersonation",
]);

function isMeaningfulEvent(ev: { eventType: string }): boolean {
  return MEANINGFUL_EVENTS.has(ev.eventType);
}

function humanizeEvent(type: string): { label: string; tone: "neutral" | "success" | "warning" | "danger" } {
  const map: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
    "instance-started":    { label: "Process started", tone: "neutral" },
    "instance-completed":  { label: "Process completed", tone: "success" },
    "instance-failed":     { label: "Process failed", tone: "danger" },
    "instance-cancelled":  { label: "Process cancelled", tone: "neutral" },
    "instance-suspended":  { label: "Process paused", tone: "warning" },
    "instance-resumed":    { label: "Process resumed", tone: "neutral" },
    "node-entered":        { label: "Entered step", tone: "neutral" },
    "node-exited":         { label: "Left step", tone: "neutral" },
    "node-failed":         { label: "Step failed", tone: "danger" },
    "token-created":       { label: "Execution started", tone: "neutral" },
    "token-waiting":       { label: "Waiting for action", tone: "warning" },
    "token-completed":     { label: "Step completed", tone: "success" },
    "token-failed":        { label: "Step failed", tone: "danger" },
    "edge-taken":          { label: "Moved to next step", tone: "neutral" },
    "task-assigned":       { label: "Task assigned", tone: "neutral" },
    "task-reassigned":     { label: "Task reassigned", tone: "neutral" },
    "task-completed":      { label: "Task completed", tone: "success" },
    "task-claimed":        { label: "Task claimed", tone: "neutral" },
    "variables-updated":   { label: "Variables updated", tone: "neutral" },
    "error":               { label: "Error", tone: "danger" },
    "incident-raised":     { label: "Incident raised", tone: "danger" },
    "incident-resolved":   { label: "Incident resolved", tone: "success" },
    "replay":              { label: "Replayed from step", tone: "warning" },
    "impersonation":       { label: "Admin acted as user", tone: "neutral" },
  };
  return map[type] ?? { label: type.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), tone: "neutral" };
}

function humanizeWaitingFor(raw: string | null): string {
  if (!raw) return "—";
  const map: Record<string, string> = {
    userTask: "User action",
    timer: "Timer",
    message: "Message",
    signal: "Signal",
    serviceTask: "Service to run",
  };
  return map[raw] ?? raw;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const s = Math.max(0, Math.floor((end - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

/* ─── Complete-task dialog ───────────────────────────────────────────
 * v1: a small JSON editor. The proper version (designer-defined form
 * schema rendered as a real form) is a separate epic; until then this
 * lets admins drive real test flows by typing the variables they want
 * the gateway / next step to read. "Skip form" submits an empty {}. */
function CompleteTaskDialog(props: {
  tokenId: string;
  onClose: () => void;
  onSubmit: (tokenId: string, formData: Record<string, unknown>) => Promise<void>;
}) {
  const { tokenId, onClose, onSubmit } = props;
  const [text, setText] = useState("{\n  \n}");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (formData: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(tokenId, formData);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const onComplete = async () => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch (e) { setErr(`Invalid JSON: ${(e as Error).message}`); return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setErr("Form data must be a JSON object (e.g. {\"approved\": true}).");
      return;
    }
    await submit(parsed as Record<string, unknown>);
  };
  const onSkipForm = () => submit({});

  return (
    <ModalShell onClose={onClose} title="Complete task">
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "#475467" }}>
        Form data is merged into the instance variables. Gateways and downstream
        steps read these to branch and fill templates. Common shape:
      </p>
      <pre style={{ margin: "0 0 12px", padding: 8, background: "#F9FAFB", borderRadius: 6, fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "#475467" }}>
{`{ "approved": true, "comment": "OK" }`}
      </pre>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setErr(null); }}
        spellCheck={false}
        style={{
          width: "100%", minHeight: 160, padding: 10, fontSize: 12,
          fontFamily: "var(--font-mono, monospace)", border: "1px solid #D0D5DD",
          borderRadius: 6, color: "#101828", boxSizing: "border-box", resize: "vertical",
        }}
      />
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#B42318" }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button onClick={onClose} disabled={busy} style={modalBtn}>Cancel</button>
        <button onClick={onSkipForm} disabled={busy} style={modalBtn} title="Submit with empty {} — no form data">
          Skip form
        </button>
        <button onClick={onComplete} disabled={busy} style={modalBtnPrimary}>
          {busy ? "Completing…" : "Complete task"}
        </button>
      </div>
    </ModalShell>
  );
}

/* ─── Reassign-task dialog ───────────────────────────────────────────
 * Admin-only. Shows tenant users; if the task carries a candidateRole,
 * surfaces who actually holds it so the admin doesn't strand the task
 * by reassigning to someone outside the role. The API enforces this
 * too — the UI just makes the right choice obvious. */
type TenantUser = { id: string; email: string; displayName: string; isActive: boolean; roles: string[] };

function ReassignTaskDialog(props: {
  tokenId: string;
  candidateRole: string | null;
  currentAssignee: string | null;
  onClose: () => void;
  onSubmit: (tokenId: string, targetUserId: string) => Promise<void>;
}) {
  const { tokenId, candidateRole, currentAssignee, onClose, onSubmit } = props;
  const [users, setUsers] = useState<TenantUser[] | null>(null);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<TenantUser[]>("/users")
      .then((rows) => { if (alive) setUsers(rows); })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = filter.trim().toLowerCase();
    return users
      .filter((u) => u.isActive && u.id !== currentAssignee)
      .filter((u) => !candidateRole || u.roles.includes(candidateRole))
      .filter((u) => !q || u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q));
  }, [users, filter, candidateRole, currentAssignee]);

  const onConfirm = async () => {
    if (!picked) return;
    setBusy(true);
    setErr(null);
    try { await onSubmit(tokenId, picked); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <ModalShell onClose={onClose} title="Reassign task">
      {candidateRole ? (
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "#475467" }}>
          Showing active users who hold the <code style={{ background: "#F2F4F7", padding: "1px 4px", borderRadius: 3 }}>{candidateRole}</code> role.
        </p>
      ) : (
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "#475467" }}>
          This task has no role gate — any active user is eligible.
        </p>
      )}
      <input
        type="text"
        placeholder="Filter by name or email…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #D0D5DD", borderRadius: 6, marginBottom: 10, boxSizing: "border-box" }}
      />
      <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #EAECF0", borderRadius: 6 }}>
        {users === null ? (
          <div style={{ padding: 16, fontSize: 12, color: "#98A2B3" }}>Loading users…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12, color: "#98A2B3" }}>No matching eligible users.</div>
        ) : filtered.map((u) => (
          <label
            key={u.id}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
              borderTop: "1px solid #F2F4F7", cursor: "pointer",
              background: picked === u.id ? "#EEF2FF" : "transparent",
            }}
          >
            <input
              type="radio"
              name="reassign-target"
              checked={picked === u.id}
              onChange={() => setPicked(u.id)}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "#101828", fontWeight: 500 }}>{u.displayName || u.email}</div>
              <div style={{ fontSize: 11, color: "#667085" }}>{u.email}</div>
            </div>
            {u.roles.length > 0 && (
              <div style={{ fontSize: 10, color: "#475467" }}>{u.roles.join(", ")}</div>
            )}
          </label>
        ))}
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#B42318" }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button onClick={onClose} disabled={busy} style={modalBtn}>Cancel</button>
        <button onClick={onConfirm} disabled={busy || !picked} style={modalBtnPrimary}>
          {busy ? "Reassigning…" : "Reassign"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)",
        zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 520, background: "#fff", borderRadius: 12,
          boxShadow: "0 24px 48px -12px rgba(16,24,40,0.25)", padding: 20,
          maxHeight: "90vh", overflow: "auto",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: "#101828", marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

const modalBtn: React.CSSProperties = {
  padding: "7px 14px", fontSize: 13, borderRadius: 6, border: "1px solid #D0D5DD",
  background: "#fff", color: "#344054", cursor: "pointer", fontFamily: "inherit",
};
const modalBtnPrimary: React.CSSProperties = {
  ...modalBtn, background: "#6366F1", color: "#fff", border: "1px solid #6366F1", fontWeight: 500,
};
