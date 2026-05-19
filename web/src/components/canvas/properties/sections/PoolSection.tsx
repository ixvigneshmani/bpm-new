/* ─── PoolSection ────────────────────────────────────────────────────
 * Pool (bpmn:Participant) properties: participant name, orientation.
 *
 * Refactored Session 2: dropped Tailwind in favour of the shared
 * inline-style tokens.
 * ──────────────────────────────────────────────────────────────────── */

import { hintStyle, inputStyle, labelStyle, sectionStack } from "../styles";

export type PoolSectionProps = {
  participantName: string;
  onParticipantNameChange: (v: string) => void;
  isHorizontal: boolean;
  onIsHorizontalChange: (v: boolean) => void;
};

export default function PoolSection(props: PoolSectionProps) {
  return (
    <div style={sectionStack}>
      <div>
        <div style={labelStyle}>Participant Name</div>
        <input
          type="text"
          value={props.participantName}
          onChange={(e) => props.onParticipantNameChange(e.target.value)}
          style={inputStyle}
          placeholder="e.g. Customer"
        />
        <div style={hintStyle}>
          Written to <code style={{ fontFamily: "var(--font-mono, monospace)" }}>bpmn:Participant@name</code>.
          Shown on the pool's left band.
        </div>
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          cursor: "pointer",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <input
          type="checkbox"
          checked={props.isHorizontal}
          onChange={(e) => props.onIsHorizontalChange(e.target.checked)}
          style={{ marginTop: 2, width: 16, height: 16, cursor: "pointer" }}
        />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#344054" }}>
            Horizontal orientation
          </div>
          <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 2, lineHeight: 1.5 }}>
            Lanes stack vertically inside the pool. Vertical pools aren't
            rendered yet — toggle only affects the BPMN DI{" "}
            <code style={{ fontFamily: "var(--font-mono, monospace)" }}>isHorizontal</code>{" "}
            attribute on export.
          </div>
        </div>
      </label>
    </div>
  );
}
