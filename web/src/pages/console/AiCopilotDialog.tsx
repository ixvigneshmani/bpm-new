/* ─── AI copilot dialog (Feature E) ────────────────────────────────────
 * Ask Claude a question about the current instance. Sends question +
 * instanceId to POST /ai/analyze-instance; the backend gathers
 * canvas + variables + audit events and returns markdown.
 * ──────────────────────────────────────────────────────────────────── */

import { useRef, useState } from "react";
import { apiPost } from "../../lib/api";

type Turn = { question: string; analysis: string | null; error: string | null; busy: boolean };

const SUGGESTIONS = [
  "Why is this instance stuck?",
  "Summarise what happened so far.",
  "Did any step fail or retry?",
  "What changed in the variable bag during this run?",
  "What's the recommended next operator action?",
];

export default function AiCopilotDialog(props: {
  instanceId: string;
  onClose: () => void;
}) {
  const { instanceId, onClose } = props;
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const ask = async (q: string) => {
    const question = q.trim();
    if (question.length < 3) return;
    const idx = turns.length;
    setTurns((t) => [...t, { question, analysis: null, error: null, busy: true }]);
    setInput("");
    try {
      const res = await apiPost<{ analysis: string; tokensIn: number | null; tokensOut: number | null }>(
        "/ai/analyze-instance",
        { instanceId, question },
      );
      setTurns((t) => t.map((row, i) => i === idx ? { ...row, analysis: res.analysis, busy: false } : row));
    } catch (ex) {
      setTurns((t) => t.map((row, i) => i === idx ? { ...row, error: (ex as Error).message, busy: false } : row));
    }
    // Scroll to bottom on reply.
    window.setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 50);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 60 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 560, background: "#fff",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", zIndex: 70,
      }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EAECF0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#101828", display: "flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden="true">✨</span> AI copilot
            </div>
            <div style={{ fontSize: 12, color: "#667085", marginTop: 2 }}>
              Ask a plain-language question about this instance. Claude sees canvas + variables + audit trail.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer" }}>✕</button>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          {turns.length === 0 && (
            <div style={{ padding: 14, background: "#F9FAFB", border: "1px dashed #E5E7EB", borderRadius: 10, fontSize: 13, color: "#475467" }}>
              <div style={{ fontWeight: 600, color: "#101828", marginBottom: 8 }}>Try one of these:</div>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                    marginBottom: 6, border: "1px solid #E5E7EB", background: "#fff", borderRadius: 8,
                    fontSize: 13, color: "#4F46E5", cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i}>
              <div style={{
                background: "#EEF2FF", color: "#3730A3", padding: "10px 14px", borderRadius: 10,
                marginBottom: 8, fontSize: 13, fontWeight: 500,
              }}>
                {t.question}
              </div>
              {t.busy && <div style={{ fontSize: 13, color: "#98A2B3", padding: 8 }}>Thinking…</div>}
              {t.error && (
                <div style={{ padding: "10px 14px", border: "1px solid #FECACA", background: "#FEF2F2", color: "#B42318", fontSize: 13, borderRadius: 8 }}>
                  {t.error}
                </div>
              )}
              {t.analysis && (
                <div style={{
                  background: "#fff", border: "1px solid #EAECF0", padding: "12px 16px", borderRadius: 10,
                  fontSize: 13, color: "#101828", lineHeight: 1.55, whiteSpace: "pre-wrap", fontFamily: "inherit",
                }}>
                  {t.analysis}
                </div>
              )}
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); ask(input); }}
          style={{ padding: 14, borderTop: "1px solid #EAECF0", display: "flex", gap: 8 }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about this instance…"
            autoFocus
            style={{
              flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #E5E7EB",
              fontSize: 13, outline: "none",
            }}
          />
          <button type="submit" disabled={input.trim().length < 3}
            style={{
              padding: "10px 16px", borderRadius: 8, border: "none",
              background: input.trim().length < 3 ? "#C7D2FE" : "linear-gradient(135deg, #4F46E5, #6366F1)",
              color: "#fff", fontSize: 13, fontWeight: 600, cursor: input.trim().length < 3 ? "not-allowed" : "pointer",
            }}
          >
            Ask
          </button>
        </form>
      </div>
    </>
  );
}
