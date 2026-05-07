/* ─── Console: My Tasks (role-aware) ──────────────────────────────────
 * Admin-flavored view of the caller's inbox. Unlike the user-facing
 * /tasks page this one surfaces token id + candidateRole + raw JSON
 * completion and ships Claim / Unclaim / Complete inline so an
 * operator can drive the claim-first lifecycle from one screen.
 * ──────────────────────────────────────────────────────────────────── */

import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../../lib/api";
import { useVisiblePoll } from "../../lib/use-visible-poll";
import { Banner, Field, inputStyle, primaryBtn, secondaryBtn } from "./ProcessesPanel";

type Task = {
  tokenId: string;
  instanceId: string;
  processId: string;
  processName: string;
  nodeId: string;
  nodeLabel: string | null;
  assignedTo: string | null;
  candidateRole: string | null;
  createdAt: string;
};

export default function TasksPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await apiGet<Task[]>("/tasks");
      setTasks(rows);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useVisiblePoll(refresh, 5000);

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 13, color: "#475467" }}>
        {tasks.length} task{tasks.length === 1 ? "" : "s"} in your claim-first inbox (claimed + claimable by your roles)
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {loading && <div style={{ color: "#98A2B3", fontSize: 13 }}>Loading…</div>}

      {!loading && tasks.length === 0 && !error && (
        <Banner kind="info">No tasks. Start an instance from the Processes panel.</Banner>
      )}

      {tasks.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #EAECF0", borderRadius: 10, overflow: "hidden" }}>
          <div style={headerRow}>
            <span>Task</span>
            <span>Process</span>
            <span>State</span>
            <span>Age</span>
            <span />
          </div>
          {tasks.map((t) => {
            const isClaimed = !!t.assignedTo;
            const isRoleGated = !!t.candidateRole;
            const ageSec = (Date.now() - new Date(t.createdAt).getTime()) / 1000;
            const age = ageSec < 60 ? `${ageSec | 0}s` : ageSec < 3600 ? `${(ageSec / 60) | 0}m` : `${(ageSec / 3600) | 0}h`;
            return (
              <div key={t.tokenId} style={bodyRow}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#101828" }}>{t.nodeLabel ?? t.nodeId}</div>
                  <div style={{ fontSize: 11, color: "#98A2B3", fontFamily: "var(--font-mono, monospace)", marginTop: 2 }}>
                    token {t.tokenId.slice(0, 8)}…
                  </div>
                </div>
                <Link to={`/console/instances/${t.instanceId}`} style={{ fontSize: 13, color: "#4F46E5", textDecoration: "none" }}>
                  {t.processName}
                </Link>
                <span style={{ fontSize: 12 }}>
                  {isClaimed ? (
                    <span style={pill("#EEF2FF", "#4F46E5")}>Mine</span>
                  ) : isRoleGated ? (
                    <span style={pill("#FEF3C7", "#92400E")}>{t.candidateRole}</span>
                  ) : (
                    <span style={pill("#F2F4F7", "#667085")}>Queue</span>
                  )}
                </span>
                <span style={{ fontSize: 12, color: "#98A2B3" }}>{age}</span>
                <button onClick={() => setSelected(t)} style={{ ...secondaryBtn, padding: "6px 12px", fontSize: 12 }}>
                  Open
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <TaskActionsDrawer task={selected} onClose={() => setSelected(null)} onChanged={refresh} />
      )}
    </div>
  );
}

function TaskActionsDrawer(props: { task: Task; onClose: () => void; onChanged: () => Promise<void> }) {
  const { task: initial, onClose, onChanged } = props;
  const [task, setTask] = useState<Task>(initial);
  const [formJson, setFormJson] = useState("{}");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isClaimed = !!task.assignedTo;
  const isRoleGated = !!task.candidateRole;

  const handle = async (fn: () => Promise<void>) => {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const claim = () => handle(async () => {
    await apiPost(`/tasks/${task.tokenId}/claim`, {});
    setTask({ ...task, assignedTo: "me" });
    setMessage("Claimed.");
  });

  const unclaim = () => handle(async () => {
    await apiPost(`/tasks/${task.tokenId}/unclaim`, {});
    setTask({ ...task, assignedTo: null });
    setMessage("Unclaimed.");
  });

  const complete = () => handle(async () => {
    let parsed: Record<string, unknown> = {};
    if (formJson.trim()) {
      parsed = JSON.parse(formJson);
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        throw new Error("formData must be a JSON object");
      }
    }
    const opts = idempotencyKey.trim()
      ? { headers: { "Idempotency-Key": idempotencyKey.trim() } }
      : undefined;
    await apiPost(`/tasks/${task.tokenId}/complete`, { formData: parsed }, opts);
    setMessage("Completed.");
    // Close after a beat so the list poller picks up removal
    window.setTimeout(onClose, 400);
  });

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 60 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 520, background: "#fff",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", zIndex: 70,
      }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EAECF0" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#101828" }}>{task.nodeLabel ?? task.nodeId}</div>
          <div style={{ fontSize: 12, color: "#667085", marginTop: 2 }}>{task.processName}</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          {isRoleGated && (
            <div style={{ padding: "8px 12px", borderRadius: 8, fontSize: 12,
              background: isClaimed ? "#ECFDF5" : "#FEF3C7",
              border: `1px solid ${isClaimed ? "#A7F3D0" : "#FDE68A"}`,
              color: isClaimed ? "#065F46" : "#92400E",
            }}>
              {isClaimed
                ? <>Claimed (role <strong>{task.candidateRole}</strong>). You may complete it.</>
                : <>Role-gated on <strong>{task.candidateRole}</strong>. Claim before completing.</>
              }
            </div>
          )}
          <Field label="Form data (JSON)" hint="Merged into instance variables on completion.">
            <textarea
              value={formJson}
              onChange={(e) => setFormJson(e.target.value)}
              rows={7} spellCheck={false}
              style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
              disabled={isRoleGated && !isClaimed}
            />
          </Field>
          <Field label="Idempotency-Key" hint="Optional uuid so retries are safe.">
            <input
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
              placeholder="leave blank for first attempt"
              disabled={isRoleGated && !isClaimed}
            />
          </Field>
          <div style={{ padding: 12, background: "#F9FAFB", borderRadius: 8, fontSize: 12, color: "#475467" }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Token</div>
            <code>{task.tokenId}</code>
            <div style={{ fontWeight: 600, margin: "8px 0 4px" }}>Instance</div>
            <Link to={`/console/instances/${task.instanceId}`} style={{ color: "#4F46E5" }}>{task.instanceId}</Link>
          </div>
          {error && <Banner kind="error">{error}</Banner>}
          {message && <Banner kind="success">{message}</Banner>}
        </div>
        <div style={{ padding: "14px 22px", borderTop: "1px solid #EAECF0", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={submitting} style={secondaryBtn}>Close</button>
          {isRoleGated && isClaimed && (
            <button onClick={unclaim} disabled={submitting}
              style={{ ...secondaryBtn, color: "#92400E", borderColor: "#FDE68A", background: "#FFFBEB" }}>
              Unclaim
            </button>
          )}
          {isRoleGated && !isClaimed ? (
            <button onClick={claim} disabled={submitting} style={{ ...primaryBtn, background: "linear-gradient(135deg, #D97706, #F59E0B)" }}>
              {submitting ? "Claiming…" : "Claim task"}
            </button>
          ) : (
            <button onClick={complete} disabled={submitting} style={primaryBtn}>
              {submitting ? "Submitting…" : "Complete"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

const headerRow: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "minmax(220px, 2fr) minmax(160px, 1.5fr) 120px 60px 80px",
  padding: "10px 20px", background: "#F9FAFB", borderBottom: "1px solid #EAECF0",
  fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em",
  alignItems: "center", gap: 12,
};

const bodyRow: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "minmax(220px, 2fr) minmax(160px, 1.5fr) 120px 60px 80px",
  padding: "14px 20px", borderBottom: "1px solid #F2F4F7", alignItems: "center", gap: 12,
};

function pill(bg: string, fg: string): React.CSSProperties {
  return { padding: "3px 9px", borderRadius: 9999, background: bg, color: fg, fontWeight: 600, fontSize: 11 };
}
