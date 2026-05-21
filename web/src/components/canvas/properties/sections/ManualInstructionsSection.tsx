/* ─── Manual Task Instructions Section ────────────────────────────────
 * Markdown-ish textarea for operator-facing instructions.
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import AiAssistButton from "../fields/AiAssistButton";
import { inputStyle, labelStyle } from "../styles";

type Props = {
  instructions: string | undefined;
  onChange: (value: string) => void;
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  lineHeight: "1.6",
  resize: "vertical",
  minHeight: 120,
};

export default function ManualInstructionsSection({ instructions, onChange }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
