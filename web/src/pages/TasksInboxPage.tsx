/* ─── Task Inbox ────────────────────────────────────────────────────
 * Lists user-task tokens that are waiting for completion. Default
 * view is the caller's "mine" mode (assigned to them OR unassigned
 * = anyone-can-claim queue), matching the engine's listTasks behavior
 * when the controller doesn't pass `assignedTo`.
 *
 * Click a row → opens a side drawer with the form (today: a JSON-
 * editor textarea since the form runtime isn't built yet) plus
 * Complete / Cancel actions. On Complete we POST formData and
 * re-fetch the list — instances that finished disappear, instances
 * that re-suspended on a later user task surface as new rows.
 *
 * Auto-refresh: a 15s tick keeps the list reasonably current
 * without WebSockets. Heavier real-time can wait for the Ops &
 * Security milestone (push from outbox webhooks).
 * ──────────────────────────────────────────────────────────────────── */

import { useCallback, useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import { useVisiblePoll } from "../lib/use-visible-poll";
import ConfirmModal, { type ConfirmConfig } from "../components/ConfirmModal";
import CompleteTaskDialog from "../components/CompleteTaskDialog";
import type { Outcome } from "../types/bpmn-node-data";

type Task = {
  tokenId: string;
  instanceId: string;
  processId: string;
  processName: string;
  nodeId: string;
  nodeLabel: string | null;
  nodeData: Record<string, unknown> | null;
  assignedTo: string | null;
  candidateRole: string | null;
  createdAt: string;
};

type CompleteResponse = {
  instanceId: string;
  instanceStatus: "running" | "completed" | "failed";
  tokenStatus: "completed" | "waiting" | "failed";
};

const REFRESH_INTERVAL_MS = 15_000;

export default function TasksInboxPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  /** Token ids the user just completed, held for ~30s so if the
   *  interval-refresh pulls a stale list that still includes them,
   *  we filter them out. Prevents the "blink" where a completed
   *  task flashes back into the list before the DB is caught up. */
  const [recentlyCompleted, setRecentlyCompleted] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const rows = await apiGet<Task[]>("/tasks");
      setTasks((prev) => {
        const filtered = rows.filter((r) => !recentlyCompleted.has(r.tokenId));
        return filtered.length === prev.length &&
          filtered.every((t, i) => t.tokenId === prev[i]?.tokenId)
          ? prev
          : filtered;
      });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [recentlyCompleted]);

  useVisiblePoll(refresh, REFRESH_INTERVAL_MS);

  const optimisticallyCompleted = useCallback((tokenId: string) => {
    setTasks((prev) => prev.filter((t) => t.tokenId !== tokenId));
    setRecentlyCompleted((prev) => {
      const next = new Set(prev);
      next.add(tokenId);
      return next;
    });
    // Let the server catch up, then drop the suppression so a future
    // "re-suspend on next user task" re-entry can show normally.
    window.setTimeout(() => {
      setRecentlyCompleted((prev) => {
        const next = new Set(prev);
        next.delete(tokenId);
        return next;
      });
    }, 30_000);
  }, []);

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#101828", letterSpacing: "-0.02em", margin: 0 }}>
            My Tasks
          </h1>
          <p style={{ fontSize: 14, color: "#667085", margin: "4px 0 0" }}>
            Tasks assigned to you and unassigned items in your queue
          </p>
        </div>
        <span style={{ fontSize: 13, color: "#98A2B3", fontWeight: 500 }}>
          {tasks.length} task{tasks.length !== 1 ? "s" : ""}
        </span>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", border: "1px solid #FECACA", background: "#FEF2F2", borderRadius: 8, color: "#B42318", fontSize: 13, marginBottom: 12 }}>
          Failed to load tasks: {error}
        </div>
      )}

      {loading && tasks.length === 0 && (
        <div style={{ padding: 60, textAlign: "center", color: "#98A2B3", fontSize: 13 }}>
          Loading…
        </div>
      )}

      {!loading && tasks.length === 0 && !error && (
        <div style={{
          textAlign: "center", padding: "60px 20px",
          background: "#fff", borderRadius: 12, border: "1px solid #E5E7EB",
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D0D5DD" strokeWidth="1.5" style={{ marginBottom: 12 }}>
            <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#344054", marginBottom: 4 }}>Inbox empty</div>
          <div style={{ fontSize: 13, color: "#98A2B3" }}>Start an instance from a process to populate your queue</div>
        </div>
      )}

      {tasks.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "minmax(200px, 2fr) minmax(160px, 1.5fr) 120px 120px 40px",
            padding: "10px 20px", background: "#F9FAFB", borderBottom: "1px solid #E5E7EB",
            fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em",
            alignItems: "center",
          }}>
            <span>Task</span>
            <span>Process</span>
            <span>Assigned</span>
            <span>Waiting</span>
            <span></span>
          </div>
          {tasks.map((t) => {
            const ageMs = Date.now() - new Date(t.createdAt).getTime();
            const age = ageMs < 60_000
              ? "Just now"
              : ageMs < 3_600_000
                ? `${Math.floor(ageMs / 60_000)}m`
                : ageMs < 86_400_000
                  ? `${Math.floor(ageMs / 3_600_000)}h`
                  : `${Math.floor(ageMs / 86_400_000)}d`;
            return (
              <div
                key={t.tokenId}
                onClick={() => setSelected(t)}
                style={{
                  display: "grid", gridTemplateColumns: "minmax(200px, 2fr) minmax(160px, 1.5fr) 120px 120px 40px",
                  padding: "14px 20px", borderBottom: "1px solid #F2F4F7",
                  alignItems: "center", cursor: "pointer", transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#FAFBFC")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>
                    {t.nodeLabel ?? t.nodeId}
                  </div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "var(--font-mono, monospace)" }}>
                    {t.tokenId.slice(0, 8)}…
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "#475467", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.processName}
                </div>
                <div style={{ fontSize: 12 }}>
                  {t.assignedTo ? (
                    <span style={{ padding: "2px 8px", borderRadius: 6, background: "#EEF2FF", color: "#4F46E5", fontWeight: 600 }}>
                      Mine
                    </span>
                  ) : t.candidateRole ? (
                    <span style={{ padding: "2px 8px", borderRadius: 6, background: "#FEF3C7", color: "#92400E", fontWeight: 600 }}>
                      {t.candidateRole}
                    </span>
                  ) : (
                    <span style={{ padding: "2px 8px", borderRadius: 6, background: "#F2F4F7", color: "#667085", fontWeight: 500 }}>
                      Queue
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>{age}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C7D2FE" strokeWidth="1.5" strokeLinecap="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <TaskDrawer
          task={selected}
          onClose={() => setSelected(null)}
          onCompleted={async () => {
            // Optimistic: remove from local list immediately so the
            // operator sees instant feedback; the server catches up
            // on the next poll and the recentlyCompleted set keeps
            // the row from flashing back.
            optimisticallyCompleted(selected.tokenId);
            setSelected(null);
            // Background re-fetch picks up any NEW tasks (e.g. this
            // same instance re-suspended on a chained user task).
            await refresh();
          }}
        />
      )}
    </div>
  );
}

/** Side drawer for completing a single task. The form is JSON-shaped
 *  for v1 — proper rendered forms come with the form-runtime work,
 *  not in scope for E6. Pre-fills with `{}` and lets the operator
 *  type field/value pairs directly. */
function TaskDrawer(props: {
  task: Task;
  onClose: () => void;
  onCompleted: () => Promise<void>;
}) {
  const { task: initialTask, onClose, onCompleted } = props;
  const [task, setTask] = useState<Task>(initialTask);
  const [formJson, setFormJson] = useState("{}");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompleteResponse | null>(null);
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null);
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const isClaimed = !!task.assignedTo;
  const isRoleGated = !!task.candidateRole;
  /* VX2: a userTask with declared outcomes routes via the
   * CompleteTaskDialog (Approve/Reject/etc. action buttons), not the
   * raw JSON textarea. Without this, completing here bypasses the
   * `outcome` variable and the next gateway fails-loud (BUG-18).
   *
   * `outcomes` lives on the task's nodeData snapshot — the engine
   * stamps it onto the token when the userTask is entered, so the
   * inbox doesn't need to re-fetch the process definition. */
  const declaredOutcomes = (() => {
    const o = (task.nodeData ?? {}) as { outcomes?: Outcome[] };
    return Array.isArray(o.outcomes) && o.outcomes.length > 0 ? o.outcomes : null;
  })();

  const claim = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await apiPost<{ claimed: boolean }>(`/tasks/${task.tokenId}/claim`, {});
      setTask({ ...task, assignedTo: "me" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const unclaim = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await apiPost<{ unclaimed: boolean }>(`/tasks/${task.tokenId}/unclaim`, {});
      setTask({ ...task, assignedTo: null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    setError(null);
    // VX2: when the task declares outcomes, completion goes through
    // the CompleteTaskDialog so the operator must pick one. The
    // chosen outcome lands in the variable bag as `outcome`, and
    // downstream gateways read `${outcome}` to route. Skipping this
    // step makes the next exclusive gateway fail-loud — BUG-18.
    if (declaredOutcomes) {
      setOutcomeDialogOpen(true);
      return;
    }
    let parsed: Record<string, unknown> = {};
    if (formJson.trim().length > 0) {
      try {
        parsed = JSON.parse(formJson);
        if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
          throw new Error("Form data must be a JSON object");
        }
      } catch (e) {
        setError(`Invalid JSON: ${(e as Error).message}`);
        return;
      }
    }
    // Confirm when the user is submitting real form data (not just
    // acknowledging an empty task). Completion advances the token and
    // can't be undone; a stray click shouldn't commit the variables
    // silently. Empty-object submissions ({} — the default) skip the
    // prompt because the common "acknowledge and move on" flow
    // doesn't warrant a dialog.
    if (Object.keys(parsed).length > 0) {
      // Hand off to a styled confirm; doSubmit runs only on confirm.
      setConfirm({
        title: "Complete task with form data?",
        confirmLabel: "Complete task",
        body: "This advances the process and can't be undone. The form data you entered will be merged into the instance variables.",
        onConfirm: () => { setConfirm(null); void doSubmit(parsed); },
      });
      return;
    }
    void doSubmit(parsed);
  };

  /** Submit handler for the CompleteTaskDialog. The dialog supplies
   *  `{ outcome, ...maybeRawJsonFromDialog }`. We additionally merge
   *  any JSON the operator typed in the drawer's "Form data (advanced)"
   *  textarea, with the dialog payload winning on key conflicts —
   *  notably so a raw `outcome` key in the drawer textarea can't
   *  override the picked outcome. */
  const submitWithOutcome = async (
    _tokenId: string,
    formData: Record<string, unknown>,
  ): Promise<void> => {
    setOutcomeDialogOpen(false);
    let drawerExtras: Record<string, unknown> = {};
    if (formJson.trim().length > 0 && formJson.trim() !== "{}") {
      try {
        const parsed = JSON.parse(formJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          drawerExtras = parsed as Record<string, unknown>;
        }
      } catch {
        // Silently ignore malformed drawer JSON when an outcome is
        // declared — the operator's intent is the outcome click. The
        // textarea is the secondary input here.
      }
    }
    await doSubmit({ ...drawerExtras, ...formData });
  };

  const doSubmit = async (parsed: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const res = await apiPost<CompleteResponse>(
        `/tasks/${task.tokenId}/complete`,
        { formData: parsed },
      );
      setResult(res);
      // Brief success display before closing the drawer. Shortened
      // from 800ms → 400ms since optimistic UI removes the task from
      // the list immediately anyway.
      window.setTimeout(() => {
        onCompleted();
      }, 400);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 60 }}
      />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 480,
        background: "#fff", boxShadow: "-8px 0 24px rgba(0,0,0,0.08)",
        display: "flex", flexDirection: "column", zIndex: 70,
      }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid #EAECF0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#101828" }}>
              {task.nodeLabel ?? task.nodeId}
            </div>
            <div style={{ fontSize: 12, color: "#667085", marginTop: 2 }}>
              {task.processName}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#667085" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>
          {isRoleGated && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: isClaimed ? "#ECFDF5" : "#FEF3C7", border: `1px solid ${isClaimed ? "#A7F3D0" : "#FDE68A"}`, marginBottom: 16, fontSize: 13 }}>
              {isClaimed
                ? <><strong style={{ color: "#065F46" }}>Claimed.</strong> <span style={{ color: "#047857" }}>Role: {task.candidateRole}</span></>
                : <><strong style={{ color: "#92400E" }}>Role queue: {task.candidateRole}.</strong> <span style={{ color: "#92400E" }}>Claim before completing.</span></>
              }
            </div>
          )}
          {declaredOutcomes && (
            /* VX2: a userTask with declared outcomes is completed via
             * the outcome-picker dialog, not the raw JSON textarea.
             * Show the operator the action menu inline so they don't
             * have to click Complete to discover the choice. */
            <div style={{
              padding: "12px 14px", borderRadius: 8, background: "#EEF2FF",
              border: "1px solid #C7D2FE", marginBottom: 16, fontSize: 13, color: "#3730A3",
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {declaredOutcomes.length} outcome{declaredOutcomes.length === 1 ? "" : "s"} declared
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {declaredOutcomes.map((o) => (
                  <span
                    key={o.uid}
                    style={{
                      padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                      background: o.style === "danger" ? "#FEE4E2" : o.style === "primary" ? "#E0E7FF" : "#F2F4F7",
                      color: o.style === "danger" ? "#B42318" : o.style === "primary" ? "#3730A3" : "#475467",
                    }}
                  >
                    {o.label}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                Click <strong>Complete task</strong> to pick an outcome — the
                choice drives downstream gateway routing.
              </div>
            </div>
          )}
          <div style={{ marginBottom: 16, opacity: isRoleGated && !isClaimed ? 0.4 : 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              {declaredOutcomes ? "Form data (advanced)" : "Form data"}
            </div>
            <div style={{ fontSize: 12, color: "#667085", marginBottom: 8 }}>
              {declaredOutcomes
                ? <>Optional. Extra variables to merge alongside the outcome — paste raw JSON here for QA / dev runs. The host app would normally send these.</>
                : <>JSON object merged into the instance variables on completion. Empty <code>{"{}"}</code> for tasks that just acknowledge.</>}
            </div>
            <textarea
              value={formJson}
              onChange={(e) => setFormJson(e.target.value)}
              placeholder='{"approval": "yes"}'
              spellCheck={false}
              style={{
                width: "100%", minHeight: 220,
                padding: 12, fontFamily: "var(--font-mono, monospace)", fontSize: 13,
                border: "1px solid #E5E7EB", borderRadius: 8, outline: "none", resize: "vertical",
              }}
            />
          </div>

          {error && (
            <div style={{ padding: "10px 14px", border: "1px solid #FECACA", background: "#FEF2F2", borderRadius: 8, color: "#B42318", fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{ padding: "10px 14px", border: "1px solid #BBF7D0", background: "#F0FDF4", borderRadius: 8, color: "#166534", fontSize: 13, marginBottom: 12 }}>
              Completed. Instance is now <strong>{result.instanceStatus}</strong>.
            </div>
          )}

          <div style={{ marginTop: 18, padding: 14, background: "#F9FAFB", borderRadius: 8, fontSize: 12, color: "#475467" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Token</div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", color: "#667085" }}>{task.tokenId}</div>
            <div style={{ fontWeight: 600, margin: "10px 0 6px" }}>Instance</div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", color: "#667085" }}>{task.instanceId}</div>
          </div>
        </div>

        <div style={{ padding: "14px 22px", borderTop: "1px solid #EAECF0", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: "9px 16px", borderRadius: 8, border: "1px solid #E5E7EB",
              background: "#fff", fontSize: 13, fontWeight: 600, color: "#475467",
              cursor: submitting ? "not-allowed" : "pointer", fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          {isRoleGated && isClaimed && (
            <button
              onClick={unclaim}
              disabled={submitting || result !== null}
              style={{
                padding: "9px 14px", borderRadius: 8, border: "1px solid #FDE68A",
                background: "#FFFBEB", fontSize: 13, fontWeight: 600, color: "#92400E",
                cursor: submitting || result ? "not-allowed" : "pointer", fontFamily: "inherit",
              }}
            >
              Unclaim
            </button>
          )}
          {isRoleGated && !isClaimed ? (
            <button
              onClick={claim}
              disabled={submitting}
              style={{
                padding: "9px 18px", borderRadius: 8, border: "none",
                background: "linear-gradient(135deg, #D97706, #F59E0B)",
                fontSize: 13, fontWeight: 600, color: "#fff",
                cursor: submitting ? "not-allowed" : "pointer", fontFamily: "inherit",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Claiming…" : "Claim task"}
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting || result !== null}
              style={{
                padding: "9px 18px", borderRadius: 8, border: "none",
                background: result ? "#10B981" : "linear-gradient(135deg, #4F46E5, #6366F1)",
                fontSize: 13, fontWeight: 600, color: "#fff",
                cursor: submitting || result ? "not-allowed" : "pointer",
                fontFamily: "inherit", opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Submitting…" : result ? "✓ Done" : "Complete task"}
            </button>
          )}
        </div>
      </div>
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      {outcomeDialogOpen && declaredOutcomes && (
        <CompleteTaskDialog
          tokenId={task.tokenId}
          outcomes={declaredOutcomes}
          onClose={() => setOutcomeDialogOpen(false)}
          onSubmit={submitWithOutcome}
        />
      )}
    </>
  );
}
