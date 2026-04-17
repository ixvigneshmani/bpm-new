/* ─── Script Task Section ─────────────────────────────────────────────
 * Language selector + inline script editor + result variable binding.
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import type { ScriptConfig, ScriptLanguage } from "../../../../types/bpmn-node-data";
import AiAssistButton from "../fields/AiAssistButton";

type Props = {
  script: ScriptConfig | undefined;
  onChange: (script: ScriptConfig) => void;
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color: "#98a2b3", marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10,
  border: "1px solid #e5e7eb", fontSize: 13, color: "#111827",
  fontFamily: "inherit", outline: "none", background: "#fff",
  lineHeight: "1.5",
};

const monoInput: React.CSSProperties = {
  ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 12,
};

const configBox: React.CSSProperties = {
  border: "1px solid #f2f4f7", borderRadius: 12, background: "#f9fafb",
  padding: 16, display: "flex", flexDirection: "column", gap: 12,
};

const LANGUAGES: { value: ScriptLanguage; label: string }[] = [
  { value: "feel", label: "FEEL" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "groovy", label: "Groovy" },
];

const PLACEHOLDERS: Record<ScriptLanguage, string> = {
  feel: "= order.total * 0.1",
  javascript: "// calculate discount\nreturn order.total * 0.1;",
  python: "# calculate discount\nreturn order['total'] * 0.1",
  groovy: "// calculate discount\nreturn order.total * 0.1",
};

export default function ScriptSection({ script, onChange }: Props) {
  const cfg: ScriptConfig = script || { language: "feel", script: "" };

  return (
    <div style={configBox}>
      {/* Language selector */}
      <div>
        <div style={labelStyle}>Language</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
          {LANGUAGES.map((lang) => {
            const active = cfg.language === lang.value;
            return (
              <button
                key={lang.value}
                type="button"
                onClick={() => onChange({ ...cfg, language: lang.value })}
                style={{
                  padding: "6px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${active ? "#67e8f9" : "#e5e7eb"}`,
                  background: active ? "#ecfeff" : "#fff",
                  color: active ? "#0891b2" : "#667085",
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                {lang.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Script editor */}
      <div>
        <div style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Script</span>
          <AiAssistButton tooltip="AI: Generate script" />
        </div>
        <textarea
          value={cfg.script}
          onChange={(e) => onChange({ ...cfg, script: e.target.value })}
          rows={7}
          style={{ ...monoInput, resize: "vertical", minHeight: 120 }}
          placeholder={PLACEHOLDERS[cfg.language]}
          spellCheck={false}
        />
        <div style={{ marginTop: 4, fontSize: 10, color: "#98a2b3" }}>
          Access process variables directly (FEEL) or via context (JS/Python/Groovy).
        </div>
      </div>

      {/* Result variable */}
      <div>
        <div style={labelStyle}>Result Variable</div>
        <input
          type="text"
          value={cfg.resultVariable || ""}
          onChange={(e) => onChange({ ...cfg, resultVariable: e.target.value })}
          style={monoInput}
          placeholder="discountAmount"
        />
        <div style={{ marginTop: 4, fontSize: 10, color: "#98a2b3" }}>
          Script return value is written to this variable. Leave empty to discard.
        </div>
      </div>
    </div>
  );
}
