/* ─── Console: Instance Detail ────────────────────────────────────────
 * Extended operator view of a single instance — variables, tokens,
 * audit trail, cancel. Reaches `GET /api/instances/:id` which returns
 * the last 50 events (paginated audit + force-ops preview are OS2).
 * ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiGet, apiPost } from "../../lib/api";
import { Banner, primaryBtn, secondaryBtn } from "./ProcessesPanel";

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
};

export default function InstancePanel() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const d = await apiGet<InstanceDetail>(`/instances/${id}`);
      setDetail(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
    // Running instances: poll every 4s so the operator watches tokens
    // advance live. Terminal instances: no polling (nothing changes).
    if (!detail || detail.status !== "running") return;
    const t = window.setInterval(refresh, 4000);
    return () => window.clearInterval(t);
  }, [refresh, detail?.status]);

  const cancel = async () => {
    if (!id || !detail) return;
    if (!window.confirm(`Cancel instance ${id}? This terminates all running tokens.`)) return;
    setCancelling(true);
    try {
      await apiPost(`/instances/${id}/cancel`, { reason: "console-cancel" });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <div style={{ color: "#98A2B3", fontSize: 13 }}>Loading…</div>;
  if (error) return <Banner kind="error">Failed to load: {error}</Banner>;
  if (!detail) return <Banner kind="info">Instance not found.</Banner>;

  return (
    <div>
      <Link to="/console/processes" style={{ fontSize: 12, color: "#4F46E5", textDecoration: "none" }}>
        ← Back to processes
      </Link>

      {/* Summary header */}
      <div style={{ marginTop: 12, background: "#fff", border: "1px solid #EAECF0", borderRadius: 10, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: "#98A2B3", fontFamily: "var(--font-mono, monospace)" }}>{detail.id}</div>
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <StatusPill status={detail.status} />
              {detail.businessKey && (
                <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, background: "#EEF2FF", color: "#4F46E5", fontWeight: 600, fontFamily: "var(--font-mono, monospace)" }}>
                  key: {detail.businessKey}
                </span>
              )}
              <span style={{ fontSize: 12, color: "#667085" }}>
                started {new Date(detail.startedAt).toLocaleString()}
              </span>
              {detail.completedAt && (
                <span style={{ fontSize: 12, color: "#667085" }}>
                  · {detail.status} {new Date(detail.completedAt).toLocaleString()}
                </span>
              )}
            </div>
            {detail.errorMessage && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#B42318" }}>
                <strong>Error:</strong> {detail.errorMessage}
              </div>
            )}
          </div>
          {detail.status === "running" && (
            <button onClick={cancel} disabled={cancelling}
              style={{ ...secondaryBtn, color: "#B42318", borderColor: "#FECACA", background: "#FEF2F2" }}>
              {cancelling ? "Cancelling…" : "Cancel instance"}
            </button>
          )}
        </div>
      </div>

      {/* Two-column layout: variables + tokens */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <Card title={`Variables (${Object.keys(detail.variables).length})`}>
          {Object.keys(detail.variables).length === 0 ? (
            <div style={{ color: "#98A2B3", fontSize: 12 }}>No variables.</div>
          ) : (
            <pre style={preStyle}>{JSON.stringify(detail.variables, null, 2)}</pre>
          )}
        </Card>

        <Card title={`Tokens (${detail.tokens.length})`}>
          {detail.tokens.length === 0 ? (
            <div style={{ color: "#98A2B3", fontSize: 12 }}>No tokens.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {detail.tokens.map((t) => (
                <div key={t.id} style={{ padding: 10, border: "1px solid #F2F4F7", borderRadius: 8, fontSize: 12 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <TokenStatusPill status={t.status} />
                    <span style={{ fontWeight: 600, color: "#111827" }}>{t.currentNodeId}</span>
                    {t.waitingFor && <span style={{ color: "#667085" }}>→ waiting on {t.waitingFor}</span>}
                  </div>
                  {t.status === "waiting" && t.candidateRole && (
                    <div style={{ fontSize: 11, color: "#92400E" }}>
                      candidateRole: <strong>{t.candidateRole}</strong>{t.assignedTo ? " (claimed)" : " (queue)"}
                    </div>
                  )}
                  {t.status === "waiting" && t.assignedTo && !t.candidateRole && (
                    <div style={{ fontSize: 11, color: "#475467" }}>assignedTo: <code>{t.assignedTo.slice(0, 8)}…</code></div>
                  )}
                  <div style={{ fontSize: 11, color: "#98A2B3", fontFamily: "var(--font-mono, monospace)", marginTop: 2 }}>
                    {t.id.slice(0, 8)}… · v{t.version}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Audit trail */}
      <div style={{ marginTop: 16 }}>
        <Card title={`Audit trail — recent ${detail.recentEvents.length} events`}>
          {detail.recentEvents.length === 0 ? (
            <div style={{ color: "#98A2B3", fontSize: 12 }}>No events.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {[...detail.recentEvents].reverse().map((e) => (
                <div key={e.id} style={{ display: "grid", gridTemplateColumns: "160px 160px 120px 1fr", gap: 12, fontSize: 12, padding: "6px 4px", borderTop: "1px dashed #F2F4F7", alignItems: "start" }}>
                  <span style={{ color: "#98A2B3", fontFamily: "var(--font-mono, monospace)" }}>
                    {new Date(e.createdAt).toLocaleTimeString()}
                  </span>
                  <span style={{ fontWeight: 600, color: "#4F46E5" }}>{e.eventType}</span>
                  <span style={{ color: "#667085" }}>{e.nodeId ?? "—"}</span>
                  <code style={{ color: "#475467", fontSize: 11, wordBreak: "break-all" }}>
                    {e.payload ? JSON.stringify(e.payload) : ""}
                  </code>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Admin force-ops preview — disabled, surfaced as OS2 marker */}
      <div style={{ marginTop: 16, padding: 14, background: "#FFFBEB", border: "1px dashed #FDE68A", borderRadius: 10, fontSize: 12, color: "#92400E" }}>
        <strong>Force-ops</strong> (set variable, force-fail, force-resume) land in the Ops &amp; Security milestone (OS2).
        This panel will surface them here once the admin API exists.
      </div>
    </div>
  );
}

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #EAECF0", borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>{props.title}</div>
      {props.children}
    </div>
  );
}

function StatusPill({ status }: { status: InstanceDetail["status"] }) {
  const palette: Record<InstanceDetail["status"], { bg: string; fg: string }> = {
    running:   { bg: "#EEF2FF", fg: "#4F46E5" },
    completed: { bg: "#ECFDF5", fg: "#065F46" },
    failed:    { bg: "#FEF2F2", fg: "#B42318" },
    cancelled: { bg: "#F2F4F7", fg: "#475467" },
  };
  const p = palette[status];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase",
      padding: "3px 10px", borderRadius: 9999, background: p.bg, color: p.fg }}>
      {status}
    </span>
  );
}

function TokenStatusPill({ status }: { status: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    active:    { bg: "#EEF2FF", fg: "#4F46E5" },
    waiting:   { bg: "#FEF3C7", fg: "#92400E" },
    completed: { bg: "#ECFDF5", fg: "#065F46" },
    failed:    { bg: "#FEF2F2", fg: "#B42318" },
  };
  const p = palette[status] ?? { bg: "#F2F4F7", fg: "#475467" };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
      padding: "2px 7px", borderRadius: 9999, background: p.bg, color: p.fg }}>
      {status}
    </span>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0, padding: 12, background: "#F9FAFB", borderRadius: 8,
  fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "#111827",
  maxHeight: 400, overflow: "auto",
};

// primaryBtn imported for completeness in future edits; kept here so linter doesn't complain.
void primaryBtn;
