/* ─── AI Scaffold Dialog ─────────────────────────────────────────────
 * Modal: user types a plain-language process description, backend
 * calls Claude with a structured-output tool, and we get back a
 * canvas-ready {nodes, edges} payload. User previews the AI's notes,
 * then applies (replacing the current canvas) or regenerates.
 *
 * Deliberate choices for the v1 UX:
 *  - Apply fully replaces the canvas. When the canvas is non-empty
 *    we gate Apply behind a confirm prompt so users don't lose work.
 *  - We surface the AI's `notes` so the user has a readable summary
 *    before the canvas changes. No diff UI yet.
 *  - Generate uses AbortController: closing the modal cancels the
 *    request, and a second Generate before the first returns cancels
 *    the stale request so a late response can't clobber a newer one.
 * ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useReactFlow, type Node, type Edge } from "@xyflow/react";
import useCanvasStore, { type RefineOp } from "../../store/canvas-store";

type ScaffoldResponse = {
  processName: string;
  processDescription: string;
  nodes: Node[];
  edges: Edge[];
  notes: string;
};

type RefineResponse = {
  ops: RefineOp[];
  notes: string;
};

type InteractionSummary = {
  id: string;
  kind: string;
  status: "success" | "error";
  description: string;
  model: string;
  errorMessage: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number;
  createdAt: string;
};

type InteractionDetail = InteractionSummary & {
  responseJson: ScaffoldResponse | null;
};

const API_BASE = "/api";
const MAX_DESCRIPTION = 4000;

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(16, 24, 40, 0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 100,
};

const cardStyle: CSSProperties = {
  width: "min(720px, calc(100vw - 48px))",
  maxHeight: "calc(100vh - 80px)",
  background: "#fff",
  borderRadius: 14,
  boxShadow: "0 20px 50px rgba(16, 24, 40, 0.25)",
  display: "flex", flexDirection: "column",
  overflow: "hidden",
};

type Props = { onClose: () => void };

/** Map HTTP-status + provider-error text into a short, user-readable
 *  sentence. Keeps raw Anthropic messages + request IDs out of the UI. */
function humanizeError(status: number | null, raw: string): string {
  if (status === 429) return "Too many AI requests right now. Try again in a moment.";
  if (status === 401 || status === 500) return "AI service isn't available. Contact your admin.";
  if (status === 502 || status === 503) return "AI service is temporarily unreachable. Try again shortly.";
  if (status === 413) {
    // Server distinguishes canvas vs schema via the message; fall back
    // to a generic "too large" if we don't recognize the prefix so a
    // future source of 413s doesn't degrade to the wrong copy.
    if (/canvas/i.test(raw)) return raw;
    if (/schema|document/i.test(raw)) return "Business document is too large for AI to process.";
    return "Request is too large for AI to process.";
  }
  if (status === 400) return "AI couldn't handle that request. Try rephrasing.";
  if (/aborted|AbortError/i.test(raw)) return "Request cancelled.";
  if (/Failed to fetch|NetworkError/i.test(raw)) return "Network error. Check your connection and try again.";
  return "Something went wrong. Try again.";
}

export default function AiScaffoldDialog({ onClose }: Props) {
  const loadCanvasData = useCanvasStore((s) => s.loadCanvasData);
  const applyRefineOps = useCanvasStore((s) => s.applyRefineOps);
  const setProcessMeta = useCanvasStore((s) => s.setProcessMeta);
  const setDocumentDirty = useCanvasStore((s) => s.setDocumentDirty);
  const businessDoc = useCanvasStore((s) => s.processMeta.businessDoc);
  const existingNodeCount = useCanvasStore((s) => s.nodes.length);
  const { fitView } = useReactFlow();

  // Mode defaults to "refine" when the canvas isn't empty — iterating
  // is the overwhelmingly common case once a scaffold has landed.
  const initialMode: "scaffold" | "refine" = existingNodeCount > 0 ? "refine" : "scaffold";

  const [tab, setTab] = useState<"create" | "history">("create");
  const [mode, setMode] = useState<"scaffold" | "refine">(initialMode);
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<ScaffoldResponse | null>(null);
  const [refineResult, setRefineResult] = useState<RefineResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ charsOut: number; elapsedMs: number } | null>(null);
  const [history, setHistory] = useState<InteractionSummary[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [reapplyingId, setReapplyingId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useRef(`ai-scaffold-title-${Math.random().toString(36).slice(2, 8)}`);

  // Cleanup on unmount: abort any in-flight request and flip the
  // mounted flag so stale responses can't setState on a dead tree.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Focus the textarea on open for keyboard users.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Esc closes; prevent close while busy so users don't lose a
  // half-completed request without understanding it was cancelled.
  const handleClose = useCallback(() => {
    if (busy) abortRef.current?.abort();
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const hasSchema = !!(businessDoc && Object.keys(businessDoc).length > 0);
  const canGenerate = description.trim().length >= 8 && description.length <= MAX_DESCRIPTION && !busy;

  async function generate() {
    // Cancel any previous request — stale responses can't update state
    // because (a) we overwrite abortRef here and (b) the mountedRef
    // gate below skips setState after unmount.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    setResult(null);
    setRefineResult(null);
    setProgress(null);

    const token = localStorage.getItem("flowpro_token");
    const body: Record<string, unknown> = { description };
    if (hasSchema) body.businessDocSchema = businessDoc;
    if (mode === "refine") {
      // Minimal snapshot — the canvas store carries React Flow-specific
      // fields (selected, dragging) the AI shouldn't see.
      const { nodes, edges } = useCanvasStore.getState();
      body.currentCanvas = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          parentId: n.parentId,
          data: n.data,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          data: e.data,
        })),
      };
    }

    const endpoint = mode === "refine"
      ? "/ai/refine-process-stream"
      : "/ai/scaffold-process-stream";

    let status: number | null = null;
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      status = res.status;
      if (!res.ok) {
        // Pre-stream failures (auth, 400 body-validation) — come back as
        // a regular JSON response, never reach SSE framing.
        const errBody = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(errBody.message || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("Response body is not readable.");

      // `charsOut` from the server re-stringifies the partial JSON
      // snapshot, so it can dip as the model replaces a long string
      // value with a structured sub-object. Users read any number that
      // ticks backwards as "something broke" — cap it monotonically.
      let maxCharsOut = 0;
      let terminal: "complete" | "error" | null = null;

      await consumeSseStream(res.body, controller.signal, {
        onProgress: (p) => {
          if (!mountedRef.current || controller.signal.aborted) return;
          maxCharsOut = Math.max(maxCharsOut, p.charsOut);
          setProgress({ charsOut: maxCharsOut, elapsedMs: p.elapsedMs });
        },
        onComplete: (payload) => {
          terminal = "complete";
          if (!mountedRef.current || controller.signal.aborted) return;
          if (mode === "refine") {
            setRefineResult(payload as RefineResponse);
          } else {
            setResult(payload as ScaffoldResponse);
          }
        },
        onError: (evt) => {
          terminal = "error";
          if (!mountedRef.current || controller.signal.aborted) return;
          setError(humanizeError(evt.status, evt.message));
        },
      });

      // Stream closed without ever sending complete or error — surface
      // it instead of leaving the dialog silent (happens if a proxy or
      // server bug truncates the response mid-flight).
      if (!terminal && mountedRef.current && !controller.signal.aborted) {
        setError("Connection closed before the scaffold finished. Try again.");
      }
    } catch (e) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setError(humanizeError(status, (e as Error).message));
    } finally {
      if (mountedRef.current && abortRef.current === controller) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  function apply() {
    if (!result || result.nodes.length === 0) return;
    if (existingNodeCount > 0) {
      // One explicit confirm per session beats a quiet 10px footer
      // hint for the class of user who has real work on the canvas.
      const ok = window.confirm(
        `Replace the ${existingNodeCount} element(s) currently on the canvas with the AI scaffold? This cannot be undone.`,
      );
      if (!ok) return;
    }
    loadCanvasData(result.nodes, result.edges);
    if (result.processName) {
      setProcessMeta({ name: result.processName, description: result.processDescription || "" });
    }
    setDocumentDirty(true);
    // Invalidate cached history so the next History-tab open refetches
    // and includes the row we just persisted.
    setHistory(null);
    onClose();
    // Auto-fit the new graph so Claude's layout guesses never leave
    // the canvas blank at the old viewport.
    setTimeout(() => fitView({ padding: 0.2, duration: 250 }), 50);
  }

  function applyRefine() {
    if (!refineResult || refineResult.ops.length === 0) return;
    const { skipped } = applyRefineOps(refineResult.ops);
    if (skipped > 0) {
      // Ops were produced against the canvas snapshot at generate-time;
      // if the user edited during generation some targets may no longer
      // exist. A mid-request alert beats a silent partial apply.
      window.alert(
        `${skipped} of ${refineResult.ops.length} change(s) skipped — the canvas changed since the AI started. Review the result.`,
      );
    }
    setHistory(null);
    onClose();
    setTimeout(() => fitView({ padding: 0.2, duration: 250 }), 50);
  }

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const token = localStorage.getItem("flowpro_token");
      const res = await fetch(`${API_BASE}/ai/interactions?limit=20`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Failed to load history" }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const items: InteractionSummary[] = await res.json();
      if (!mountedRef.current) return;
      setHistory(items);
    } catch (e) {
      if (!mountedRef.current) return;
      setHistoryError((e as Error).message || "Failed to load history");
    } finally {
      if (mountedRef.current) setHistoryLoading(false);
    }
  }, []);

  // Lazy-load history the first time the tab is shown.
  useEffect(() => {
    if (tab === "history" && history === null && !historyLoading) {
      void loadHistory();
    }
  }, [tab, history, historyLoading, loadHistory]);

  // Clear any stale result panels + error when the user flips modes.
  // The footer reads `result || refineResult` and would otherwise
  // render the previous mode's Apply button next to the new mode's
  // (still-unset) result.
  useEffect(() => {
    setResult(null);
    setRefineResult(null);
    setError(null);
    setProgress(null);
  }, [mode]);

  async function reapply(id: string) {
    // Confirm before we spend a network round-trip fetching a ~20 KB
    // payload only to discard it.
    if (existingNodeCount > 0) {
      const ok = window.confirm(
        `Replace the ${existingNodeCount} element(s) currently on the canvas with this saved scaffold? This cannot be undone.`,
      );
      if (!ok) return;
    }
    setReapplyingId(id);
    setHistoryError(null);
    try {
      const token = localStorage.getItem("flowpro_token");
      const res = await fetch(`${API_BASE}/ai/interactions/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const detail: InteractionDetail = await res.json();
      if (!mountedRef.current) return;
      const payload = detail.responseJson;
      // Defensive structural check: server already guards, but the
      // type is `any`-adjacent across the JSON boundary and a bad
      // payload would otherwise crash the canvas loader.
      if (
        !payload
        || !Array.isArray(payload.nodes)
        || !Array.isArray(payload.edges)
        || payload.nodes.length === 0
      ) {
        throw new Error("This saved scaffold is empty or unavailable.");
      }
      loadCanvasData(payload.nodes, payload.edges);
      if (payload.processName) {
        setProcessMeta({ name: payload.processName, description: payload.processDescription || "" });
      }
      setDocumentDirty(true);
      onClose();
      setTimeout(() => fitView({ padding: 0.2, duration: 250 }), 50);
    } catch (e) {
      if (!mountedRef.current) return;
      setHistoryError((e as Error).message || "Could not re-apply scaffold.");
    } finally {
      if (mountedRef.current) setReapplyingId(null);
    }
  }

  const emptyResult = result !== null && result.nodes.length === 0;
  const charCount = description.length;

  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId.current}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div style={cardStyle} onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: "20px 28px 16px",
          borderBottom: "1px solid #f2f4f7",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div id={titleId.current} style={{ fontSize: 16, fontWeight: 700, color: "#101828", display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden>✨</span> AI Process Scaffold
            </div>
            <div style={{ fontSize: 12, color: "#667085", marginTop: 2 }}>
              {mode === "refine"
                ? "Describe how to refine the current canvas — Claude proposes targeted add/modify/remove ops."
                : "Describe the process in plain language — Claude drafts the nodes, flows, and gateways."}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#667085" }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, padding: "10px 20px 0", borderBottom: "1px solid #f2f4f7" }} role="tablist">
          <TabButton active={tab === "create"} onClick={() => setTab("create")}>
            New scaffold
          </TabButton>
          <TabButton active={tab === "history"} onClick={() => setTab("history")}>
            History
          </TabButton>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: "18px 28px", overflowY: "auto", display: tab === "create" ? "flex" : "none", flexDirection: "column", gap: 14 }}>
          {existingNodeCount > 0 && (
            <div
              role="radiogroup"
              aria-label="Generation mode"
              style={{
                display: "flex", gap: 0,
                background: "#F3F4F6", borderRadius: 8, padding: 3,
                alignSelf: "flex-start",
              }}
            >
              <ModeSegment active={mode === "refine"} onClick={() => setMode("refine")}>
                Refine existing
              </ModeSegment>
              <ModeSegment active={mode === "scaffold"} onClick={() => setMode("scaffold")}>
                Replace with new
              </ModeSegment>
            </div>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#98a2b3", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", justifyContent: "space-between" }}>
              <span>Description</span>
              <span style={{ color: charCount > MAX_DESCRIPTION ? "#B42318" : "#98a2b3", fontWeight: 500 }}>
                {charCount}/{MAX_DESCRIPTION}
              </span>
            </span>
            <textarea
              ref={textareaRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={mode === "refine"
                ? "Example: Add a rejection path from the approval gateway that notifies the submitter and ends the process."
                : "Example: 3-step invoice approval with manager review, finance check for amounts over $1000, and director sign-off. Escalate if no response in 48h."}
              rows={5}
              style={{
                width: "100%", padding: "10px 12px",
                borderRadius: 8, border: "1px solid #E5E7EB",
                fontSize: 13, fontFamily: "inherit", color: "#101828",
                outline: "none", resize: "vertical",
                lineHeight: 1.45,
              }}
              disabled={busy}
            />
            <span style={{ fontSize: 10, color: "#98a2b3" }}>
              {hasSchema
                ? "Business document schema is attached — Claude will use your real variable names."
                : "Tip: attach a business document first to get richer gateway conditions."}
            </span>
          </label>

          {busy && (
            <div
              role="status"
              aria-live="polite"
              style={{
                padding: "10px 14px", borderRadius: 8,
                background: "#EEF2FF", border: "1px solid #C7D2FE",
                color: "#4F46E5", fontSize: 12,
                display: "flex", alignItems: "center", gap: 10,
              }}
            >
              <Spinner />
              <span>
                {progress
                  ? `Generating… ${progress.charsOut.toLocaleString()} chars received (${(progress.elapsedMs / 1000).toFixed(1)}s).`
                  : "Generating scaffold… this usually takes 5–20 seconds."}
                {" "}
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  style={{
                    background: "none", border: "none", padding: 0,
                    color: "#4F46E5", cursor: "pointer", textDecoration: "underline",
                    fontSize: 12, fontFamily: "inherit", fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
              </span>
            </div>
          )}

          {error && (
            <div role="alert" style={{
              padding: "8px 12px", borderRadius: 6,
              background: "#FEE4E2", color: "#B42318",
              fontSize: 12, lineHeight: 1.4,
            }}>
              {error}
            </div>
          )}

          {emptyResult && (
            <div role="alert" style={{
              padding: "12px 14px", borderRadius: 8,
              background: "#FEF3C7", color: "#92400E",
              fontSize: 12, lineHeight: 1.5,
            }}>
              AI returned an empty scaffold — try rephrasing your description with specific steps, roles, or conditions.
            </div>
          )}

          {result && !emptyResult && (
            <div style={{
              padding: "12px 14px", borderRadius: 8,
              background: "#F8FAFC", border: "1px solid #E5E7EB",
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#101828" }}>
                {result.processName || "Scaffold ready"}
              </div>
              <div style={{ fontSize: 11, color: "#475467", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                {result.notes}
              </div>
              <div style={{ fontSize: 10, color: "#667085", display: "flex", gap: 12 }}>
                <span>{result.nodes.length} node(s)</span>
                <span>{result.edges.length} edge(s)</span>
              </div>
            </div>
          )}

          {refineResult && (
            <div style={{
              padding: "12px 14px", borderRadius: 8,
              background: "#F8FAFC", border: "1px solid #E5E7EB",
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#101828" }}>
                {refineResult.ops.length === 0
                  ? "No changes proposed"
                  : `${refineResult.ops.length} operation(s) proposed`}
              </div>
              {refineResult.notes && (
                <div style={{ fontSize: 11, color: "#475467", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {refineResult.notes}
                </div>
              )}
              <OpsBreakdown ops={refineResult.ops} />
            </div>
          )}
        </div>

        {/* History body */}
        <div style={{ flex: 1, padding: "18px 28px", overflowY: "auto", display: tab === "history" ? "flex" : "none", flexDirection: "column", gap: 10 }}>
          {historyLoading && history === null && (
            <div style={{ fontSize: 12, color: "#667085" }}>Loading…</div>
          )}
          {historyError && (
            <div role="alert" style={{
              padding: "8px 12px", borderRadius: 6,
              background: "#FEE4E2", color: "#B42318",
              fontSize: 12, lineHeight: 1.4,
            }}>
              {historyError}
            </div>
          )}
          {history !== null && history.length === 0 && !historyError && (
            <div style={{ fontSize: 12, color: "#98a2b3", textAlign: "center", padding: "24px 0" }}>
              No past scaffolds yet. Generate one to see it here.
            </div>
          )}
          {history?.map((row) => (
            <HistoryRow
              key={row.id}
              row={row}
              busy={reapplyingId === row.id}
              onReapply={() => reapply(row.id)}
            />
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 28px",
          borderTop: "1px solid #f2f4f7",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 12,
        }}>
          <div style={{ fontSize: 10, color: "#98a2b3" }}>
            {result && !emptyResult && existingNodeCount > 0
              ? `Applying replaces ${existingNodeCount} existing element(s).`
              : ""}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleClose}
              style={btnStyle("ghost")}
            >
              {busy ? "Cancel" : "Close"}
            </button>
            {tab === "create" && (!(result || refineResult) ? (
              <button
                type="button"
                onClick={generate}
                disabled={!canGenerate}
                style={btnStyle("primary", !canGenerate)}
              >
                Generate
              </button>
            ) : (
              <>
                <button type="button" onClick={generate} disabled={busy} style={btnStyle("ghost", busy)}>
                  Regenerate
                </button>
                {mode === "refine" ? (
                  <button
                    type="button"
                    onClick={applyRefine}
                    disabled={!refineResult || refineResult.ops.length === 0}
                    style={btnStyle("primary", !refineResult || refineResult.ops.length === 0)}
                  >
                    Apply {refineResult?.ops.length ?? 0} change(s)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={apply}
                    disabled={emptyResult}
                    style={btnStyle("primary", emptyResult)}
                  >
                    Apply to canvas
                  </button>
                )}
              </>
            ))}
            {tab === "history" && (
              <button
                type="button"
                onClick={() => void loadHistory()}
                disabled={historyLoading}
                style={btnStyle("ghost", historyLoading)}
              >
                Refresh
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeSegment({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: 6,
        border: "none",
        background: active ? "#fff" : "transparent",
        color: active ? "#101828" : "#667085",
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        boxShadow: active ? "0 1px 2px rgba(16, 24, 40, 0.1)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function OpsBreakdown({ ops }: { ops: RefineOp[] }) {
  const counts: Record<RefineOp["op"], number> = {
    "add-node": 0, "modify-node": 0, "remove-node": 0, "add-edge": 0, "remove-edge": 0,
  };
  for (const op of ops) counts[op.op]++;
  const spec: Array<{ key: RefineOp["op"]; label: string; color: string }> = [
    { key: "add-node", label: "Added nodes", color: "#166534" },
    { key: "modify-node", label: "Modified nodes", color: "#1E40AF" },
    { key: "remove-node", label: "Removed nodes", color: "#B42318" },
    { key: "add-edge", label: "Added edges", color: "#166534" },
    { key: "remove-edge", label: "Removed edges", color: "#B42318" },
  ];
  const rows = spec.filter((r) => counts[r.key] > 0);
  if (rows.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 10 }}>
      {rows.map((r) => (
        <span key={r.key} style={{
          padding: "2px 8px", borderRadius: 10,
          background: "#fff", border: `1px solid ${r.color}33`,
          color: r.color, fontWeight: 600,
        }}>
          {r.label}: {counts[r.key]}
        </span>
      ))}
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: "8px 14px",
        borderRadius: "6px 6px 0 0",
        border: "none",
        borderBottom: active ? "2px solid #4F46E5" : "2px solid transparent",
        background: "transparent",
        color: active ? "#4F46E5" : "#667085",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

function HistoryRow({
  row, busy, onReapply,
}: {
  row: InteractionSummary;
  busy: boolean;
  onReapply: () => void;
}) {
  const isSuccess = row.status === "success";
  // Only scaffold rows have a `responseJson` with `{nodes, edges}`;
  // refine rows store `{ops, notes}` and re-applying them against a
  // canvas that has since changed doesn't make sense. Hide the button
  // rather than show a dead end.
  const canReapply = isSuccess && row.kind === "scaffold-process";
  // Use absolute timestamp — relative-time drift is easy to get wrong
  // and the dialog is too transient for users to care about "3m ago".
  const when = new Date(row.createdAt).toLocaleString();
  const excerpt = row.description.length > 140
    ? row.description.slice(0, 140) + "…"
    : row.description;
  return (
    <div style={{
      padding: "12px 14px", borderRadius: 8,
      background: "#F8FAFC", border: "1px solid #E5E7EB",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 600,
          padding: "2px 8px", borderRadius: 10,
          background: isSuccess ? "#DCFCE7" : "#FEE4E2",
          color: isSuccess ? "#166534" : "#B42318",
          textTransform: "uppercase", letterSpacing: "0.04em",
        }}>
          {row.status}
        </span>
        <span style={{ fontSize: 10, color: "#98a2b3" }}>{when}</span>
      </div>
      <div style={{ fontSize: 12, color: "#101828", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
        {excerpt}
      </div>
      {row.errorMessage && (
        <div style={{ fontSize: 11, color: "#B42318", lineHeight: 1.4 }}>
          {row.errorMessage}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 10, color: "#667085", display: "flex", gap: 12 }}>
          <span>{row.model}</span>
          <span>{(row.durationMs / 1000).toFixed(1)}s</span>
          {row.tokensIn !== null && (
            <span aria-label={`${row.tokensIn} input tokens`}>
              {row.tokensIn}
              <span aria-hidden>↓</span>
            </span>
          )}
          {row.tokensOut !== null && (
            <span aria-label={`${row.tokensOut} output tokens`}>
              {row.tokensOut}
              <span aria-hidden>↑</span>
            </span>
          )}
        </div>
        {canReapply ? (
          <button
            type="button"
            onClick={onReapply}
            disabled={busy}
            style={{
              padding: "6px 10px", borderRadius: 6,
              border: "1px solid #C7D2FE", background: "#EEF2FF",
              color: "#4F46E5", fontSize: 11, fontWeight: 600,
              fontFamily: "inherit",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Loading…" : "Re-apply"}
          </button>
        ) : (
          <span style={{ fontSize: 10, color: "#98a2b3", fontStyle: "italic" }}>
            {row.kind === "refine-process" ? "refine" : row.kind}
          </span>
        )}
      </div>
    </div>
  );
}

/** Parse an SSE ReadableStream and dispatch by event name. The server
 *  emits `start`, `progress`, `complete`, and `error` events; we only
 *  surface the three with side-effects. AbortSignal lets the caller
 *  short-circuit without waiting for the next chunk. */
async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  handlers: {
    onProgress: (p: { charsOut: number; elapsedMs: number }) => void;
    onComplete: (payload: unknown) => void;
    onError: (evt: { status: number; message: string }) => void;
  },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const onAbort = () => reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      // Normalize CRLF → LF so proxies that rewrite line endings
      // (some CDNs do) don't break our frame boundary detection.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      // SSE frames are separated by a blank line. Emit each whole frame
      // and keep the trailing partial for the next read.
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        dispatchFrame(frame, handlers);
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function dispatchFrame(
  frame: string,
  handlers: {
    onProgress: (p: { charsOut: number; elapsedMs: number }) => void;
    onComplete: (payload: ScaffoldResponse) => void;
    onError: (evt: { status: number; message: string }) => void;
  },
): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  let data: unknown;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }
  if (event === "progress") {
    handlers.onProgress(data as { charsOut: number; elapsedMs: number });
  } else if (event === "complete") {
    handlers.onComplete(data as ScaffoldResponse);
  } else if (event === "error") {
    handlers.onError(data as { status: number; message: string });
  }
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="#C7D2FE" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="#4F46E5" strokeWidth="3" fill="none" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

function btnStyle(variant: "primary" | "ghost", disabled = false): CSSProperties {
  const base: CSSProperties = {
    padding: "8px 14px", borderRadius: 6,
    fontSize: 12, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.15s ease",
    fontFamily: "inherit",
    opacity: disabled ? 0.6 : 1,
  };
  if (variant === "primary") {
    return {
      ...base,
      background: "#4F46E5", color: "#fff", border: "1px solid #4F46E5",
    };
  }
  return {
    ...base,
    background: "#fff", color: "#344054", border: "1px solid #E5E7EB",
  };
}
