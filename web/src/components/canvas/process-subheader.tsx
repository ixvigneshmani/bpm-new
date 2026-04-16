import useCanvasStore from "../../store/canvas-store";
import { STATUS_COLORS, STATUS_DISPLAY } from "../../lib/constants";
import { formatRelativeTime } from "../../lib/utils";

export default function ProcessSubheader() {
  const processMeta = useCanvasStore((s) => s.processMeta);
  const wizardStep = useCanvasStore((s) => s.wizardStep);
  const setWizardStep = useCanvasStore((s) => s.setWizardStep);
  const setWizardOrigin = useCanvasStore((s) => s.setWizardOrigin);

  if (wizardStep !== "canvas") return null;

  const statusLabel = STATUS_DISPLAY[processMeta.status] || "Draft";
  const status = STATUS_COLORS[statusLabel] || STATUS_COLORS.Draft;

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "6px 20px",
      background: "#FAFBFC", borderBottom: "1px solid #F2F4F7",
      minHeight: 40,
    }}>
      {/* Left: Process name + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{
          fontSize: 14, fontWeight: 600, color: "#111827",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          maxWidth: 300,
        }}>
          {processMeta.name || "Untitled Process"}
        </span>

        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 8px", borderRadius: 10,
          background: status.bg, color: status.text,
          fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: status.dot }} />
          {statusLabel}
        </span>
      </div>

      {/* Right: Creator + last updated + Edit button */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {processMeta.creatorName && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 20, height: 20, borderRadius: "50%",
              background: "linear-gradient(135deg, #6366F1, #818CF8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 700, color: "#fff",
            }}>
              {processMeta.creatorName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <span style={{ fontSize: 12, color: "#6B7280" }}>{processMeta.creatorName}</span>
          </div>
        )}

        {processMeta.updatedAt && (
          <span style={{ fontSize: 11, color: "#9CA3AF" }}>
            Edited {formatRelativeTime(processMeta.updatedAt)}
          </span>
        )}

        <div style={{ width: 1, height: 16, background: "#E5E7EB" }} />

        <button
          onClick={() => { setWizardOrigin("canvas"); setWizardStep("details"); }}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 12px", borderRadius: 6,
            border: "1px solid #E5E7EB", background: "#fff",
            color: "#374151", fontSize: 12, fontWeight: 500,
            cursor: "pointer", fontFamily: "inherit",
            transition: "all 0.15s ease",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#C7D2FE";
            e.currentTarget.style.background = "#F5F3FF";
            e.currentTarget.style.color = "#4F46E5";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#E5E7EB";
            e.currentTarget.style.background = "#fff";
            e.currentTarget.style.color = "#374151";
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Edit
        </button>
      </div>
    </div>
  );
}
