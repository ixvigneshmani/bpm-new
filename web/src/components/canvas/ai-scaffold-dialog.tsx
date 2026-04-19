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

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useReactFlow, type Node, type Edge } from "@xyflow/react";
import useCanvasStore from "../../store/canvas-store";

type ScaffoldResponse = {
  processName: string;
  processDescription: string;
  nodes: Node[];
  edges: Edge[];
  notes: string;
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
  if (status === 413) return "Business document is too large for AI to process.";
  if (status === 400) return "AI couldn't handle that request. Try rephrasing.";
  if (/aborted|AbortError/i.test(raw)) return "Request cancelled.";
  if (/Failed to fetch|NetworkError/i.test(raw)) return "Network error. Check your connection and try again.";
  return "Something went wrong. Try again.";
}

export default function AiScaffoldDialog({ onClose }: Props) {
  const loadCanvasData = useCanvasStore((s) => s.loadCanvasData);
  const setProcessMeta = useCanvasStore((s) => s.setProcessMeta);
  const setDocumentDirty = useCanvasStore((s) => s.setDocumentDirty);
  const businessDoc = useCanvasStore((s) => s.processMeta.businessDoc);
  const existingNodeCount = useCanvasStore((s) => s.nodes.length);
  const { fitView } = useReactFlow();

  const [description, setDescription] = useState("");
  const [result, setResult] = useState<ScaffoldResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ charsOut: number; elapsedMs: number } | null>(null);

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
    setProgress(null);

    const token = localStorage.getItem("flowpro_token");
    const body: Record<string, unknown> = { description };
    if (hasSchema) body.businessDocSchema = businessDoc;

    let status: number | null = null;
    try {
      const res = await fetch(`${API_BASE}/ai/scaffold-process-stream`, {
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

      await consumeSseStream(res.body, controller.signal, {
        onProgress: (p) => {
          if (!mountedRef.current || controller.signal.aborted) return;
          setProgress(p);
        },
        onComplete: (payload) => {
          if (!mountedRef.current || controller.signal.aborted) return;
          setResult(payload);
        },
        onError: (evt) => {
          if (!mountedRef.current || controller.signal.aborted) return;
          setError(humanizeError(evt.status, evt.message));
        },
      });
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
    onClose();
    // Auto-fit the new graph so Claude's layout guesses never leave
    // the canvas blank at the old viewport.
    setTimeout(() => fitView({ padding: 0.2, duration: 250 }), 50);
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
              Describe the process in plain language — Claude drafts the nodes, flows, and gateways.
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

        {/* Body */}
        <div style={{ flex: 1, padding: "18px 28px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
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
              placeholder="Example: 3-step invoice approval with manager review, finance check for amounts over $1000, and director sign-off. Escalate if no response in 48h."
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
            {!result ? (
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
                <button
                  type="button"
                  onClick={apply}
                  disabled={emptyResult}
                  style={btnStyle("primary", emptyResult)}
                >
                  Apply to canvas
                </button>
              </>
            )}
          </div>
        </div>
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
    onComplete: (payload: ScaffoldResponse) => void;
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
      buffer += decoder.decode(value, { stream: true });

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
