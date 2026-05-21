/* ─── FEEL Expression Input ───────────────────────────────────────────
 * Monospace text input with variable autocomplete dropdown and AI-assist.
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useMemo } from "react";
import { useVariableRegistry, TYPE_COLORS, TYPE_ICONS } from "../../../../store/variable-registry";
import { parseFeelCondition, parseVariableRef, evaluate } from "../../../../lib/feel/parse";
import AiAssistButton from "./AiAssistButton";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  /** Caller-supplied error overrides the parser's auto-check. Used by
   *  sections that want to surface a domain error (e.g. "decisionId
   *  not found") next to a syntactically-valid expression. */
  error?: string;
  showAiAssist?: boolean;
  multiline?: boolean;
  /** Designer Sweep B — which expression surface this input belongs to.
   *  Conditions accept the JS-subset; variable refs accept only the
   *  strict `${path}` form. Defaults to condition. */
  mode?: "condition" | "variable-ref";
};

const baseInput: React.CSSProperties = {
  width: "100%", borderRadius: 10, padding: "10px 14px",
  border: "1px solid #e5e7eb", fontSize: 13, color: "#111827",
  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
  outline: "none", background: "#fff", transition: "border-color 0.15s, box-shadow 0.15s",
  lineHeight: "1.5",
};

export default function FeelExpressionInput({
  value: rawValue, onChange, placeholder = "= expression",
  label, error, showAiAssist = true, multiline = false,
  mode = "condition",
}: Props) {
  // Defensive: callers can pass `undefined` (e.g. a freshly-added
  // timer boundary's `definition.value`). Normalize to "" so downstream
  // `.split` / parser calls don't NPE on first render before the user
  // has typed anything.
  const value = rawValue ?? "";
  const [focused, setFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const registry = useVariableRegistry();

  // Designer Sweep B — parse on every value change. Empty input is not
  // an error here (sections show their own "required" message); we
  // only surface syntactic / structural problems.
  const parseResult = useMemo(() => {
    if (!value || !value.trim()) return null;
    return mode === "variable-ref" ? parseVariableRef(value) : parseFeelCondition(value);
  }, [value, mode]);
  const autoError =
    parseResult && !parseResult.ok ? parseResult.error.message : undefined;

  const displayError = error ?? autoError;

  // Sweep-B cleanup #8 — dry-run preview against a deterministic sample
  // scope. Only shown when the expression parses cleanly; on type
  // errors we fall back to "—" rather than spamming a noisy stack.
  const preview = useMemo(() => {
    if (!parseResult?.ok) return null;
    if (mode === "variable-ref") return null; // variable refs are paths, not expressions
    try {
      const scope = registry.getSampleScope();
      const v = evaluate(parseResult.ast, scope);
      return formatPreviewValue(v);
    } catch {
      return "—";
    }
  }, [parseResult, registry, mode]);

  const lastWord = value.split(/[\s=+\-*/<>!&|(),]+/).pop() || "";
  const suggestions = lastWord.length > 0
    ? registry.getCompletions(lastWord).slice(0, 8) : [];

  useEffect(() => { setSelectedIdx(0); }, [lastWord]);

  const insertSuggestion = (path: string) => {
    const lastWordStart = value.lastIndexOf(lastWord);
    const newValue = value.substring(0, lastWordStart) + path;
    onChange(newValue);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertSuggestion(suggestions[selectedIdx].path); }
    else if (e.key === "Escape") { setShowSuggestions(false); }
  };

  const inputStyles: React.CSSProperties = {
    ...baseInput,
    borderColor: displayError ? "#f04438" : focused ? "#818cf8" : "#e5e7eb",
    boxShadow: displayError ? "0 0 0 3px rgba(240,68,56,0.08)" : focused ? "0 0 0 3px rgba(99,102,241,0.08)" : "none",
  };

  const sharedProps = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { onChange(e.target.value); setShowSuggestions(true); },
    onFocus: () => { setFocused(true); setShowSuggestions(true); },
    onBlur: () => { setFocused(false); setTimeout(() => setShowSuggestions(false), 150); },
    onKeyDown: handleKeyDown,
    placeholder,
    spellCheck: false,
    style: inputStyles,
  };

  return (
    <div style={{ position: "relative" }}>
      {label && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "#98a2b3" }}>
            {label}
          </label>
          {showAiAssist && <AiAssistButton tooltip="AI: Generate expression" />}
        </div>
      )}

      <div style={{ position: "relative" }}>
        {multiline ? (
          <textarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} {...sharedProps} rows={3} style={{ ...inputStyles, resize: "vertical", minHeight: 60 }} />
        ) : (
          <input ref={inputRef as React.RefObject<HTMLInputElement>} type="text" {...sharedProps} />
        )}
      </div>

      {displayError && <div style={{ marginTop: 4, fontSize: 11, color: "#f04438" }}>{displayError}</div>}
      {!displayError && preview !== null && (
        <div style={{ marginTop: 4, fontSize: 11, color: "#98a2b3", fontFamily: "var(--font-mono, monospace)" }}>
          evaluates to: <span style={{ color: "#475467", fontWeight: 600 }}>{preview}</span>
          <span style={{ marginLeft: 6, color: "#cbd5e1" }}>(sample data)</span>
        </div>
      )}

      {/* Autocomplete dropdown */}
      {showSuggestions && focused && suggestions.length > 0 && (
        <div style={{
          position: "absolute", left: 0, right: 0, zIndex: 50, marginTop: 4,
          borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)", maxHeight: 200, overflow: "auto",
        }}>
          {suggestions.map((s, i) => (
            <div
              key={s.path}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
                fontSize: 12, cursor: "pointer", transition: "background 0.1s",
                background: i === selectedIdx ? "#eef2ff" : "transparent",
              }}
              onMouseDown={(e) => { e.preventDefault(); insertSuggestion(s.path); }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span style={{
                display: "flex", height: 18, width: 26, alignItems: "center", justifyContent: "center",
                borderRadius: 4, fontFamily: "var(--font-mono, monospace)", fontSize: 9,
                fontWeight: 700, color: "#fff", background: TYPE_COLORS[s.type],
              }}>
                {TYPE_ICONS[s.type]}
              </span>
              <span style={{ flex: 1, fontFamily: "var(--font-mono, monospace)", color: "#344054" }}>{s.path}</span>
              <span style={{ fontSize: 10, color: "#98a2b3" }}>{s.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatPreviewValue(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" && !Number.isFinite(v)) return String(v);
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 40 ? s.slice(0, 37) + "…" : s;
  } catch {
    return String(v);
  }
}
