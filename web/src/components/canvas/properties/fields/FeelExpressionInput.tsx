/* ─── FEEL Expression Input ───────────────────────────────────────────
 * Monospace text input with variable autocomplete dropdown and AI-assist.
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect } from "react";
import { useVariableRegistry, TYPE_COLORS, TYPE_ICONS } from "../../../../store/variable-registry";
import AiAssistButton from "./AiAssistButton";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  error?: string;
  showAiAssist?: boolean;
  multiline?: boolean;
};

const baseInput: React.CSSProperties = {
  width: "100%", borderRadius: 10, padding: "10px 14px",
  border: "1px solid #e5e7eb", fontSize: 13, color: "#111827",
  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
  outline: "none", background: "#fff", transition: "border-color 0.15s, box-shadow 0.15s",
  lineHeight: "1.5",
};

export default function FeelExpressionInput({
  value, onChange, placeholder = "= expression",
  label, error, showAiAssist = true, multiline = false,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const registry = useVariableRegistry();

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
    borderColor: error ? "#f04438" : focused ? "#818cf8" : "#e5e7eb",
    boxShadow: error ? "0 0 0 3px rgba(240,68,56,0.08)" : focused ? "0 0 0 3px rgba(99,102,241,0.08)" : "none",
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

      {error && <div style={{ marginTop: 4, fontSize: 11, color: "#f04438" }}>{error}</div>}

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
