/* ─── Manual Task Instructions Section ────────────────────────────────
 * Markdown-ish textarea for operator-facing instructions.
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import AiAssistButton from "../fields/AiAssistButton";

type Props = {
  instructions: string | undefined;
  onChange: (value: string) => void;
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color: "#98a2b3", marginBottom: 8,
};

const textareaStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10,
  border: "1px solid #e5e7eb", fontSize: 13, color: "#111827",
  fontFamily: "inherit", outline: "none", background: "#fff",
  lineHeight: "1.6", resize: "vertical", minHeight: 120,
};

const configBox: React.CSSProperties = {
  border: "1px solid #f2f4f7", borderRadius: 12, background: "#f9fafb",
  padding: 16, display: "flex", flexDirection: "column", gap: 8,
};

export default function ManualInstructionsSection({ instructions, onChange }: Props) {
  return (
    <div style={configBox}>
      <div style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Operator Instructions</span>
        <AiAssistButton tooltip="AI: Generate instructions" />
      </div>
      <textarea
        value={instructions || ""}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        style={textareaStyle}
        placeholder={`Step-by-step guidance for the person performing this task.\n\n1. Pull the paperwork from the tray...\n2. Verify signatures match the ledger...\n3. File in the completed folder...`}
      />
      <div style={{ fontSize: 10, color: "#98a2b3" }}>
        Manual tasks are not tracked by a form or worker. Instructions are shown in the task inbox.
      </div>
    </div>
  );
}
