import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import useCanvasStore from "../../store/canvas-store";
import { apiPost } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { STATUS_COLORS, STATUS_DISPLAY } from "../../lib/constants";
import { formatRelativeTime } from "../../lib/utils";

export default function ProcessSubheader({
  dirty = false,
  onSave,
  readOnly = false,
}: {
  dirty?: boolean;
  onSave?: () => void | Promise<void>;
  readOnly?: boolean;
} = {}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const effectivePermissions = useCanvasStore(
    (s) => s.processMeta.effectivePermissions,
  );
  const isSystemAdmin =
    user?.systemRole === "owner" || user?.systemRole === "admin";
  // OS1 — admins/owners always pass; non-admins gated on explicit grants.
  // effectivePermissions is empty before the GET /processes/:id has
  // resolved; default to "trust the systemRole" so we don't hide
  // buttons during the brief load window.
  const hasPerm = (p: string) =>
    isSystemAdmin ||
    effectivePermissions.length === 0 ||
    effectivePermissions.includes(p);
  const canPublish = hasPerm("publish");
  const canManagePermissions = hasPerm("admin");

  const processId = useCanvasStore((s) => s.processId);
  const processMeta = useCanvasStore((s) => s.processMeta);
  const setProcessMeta = useCanvasStore((s) => s.setProcessMeta);
  const wizardStep = useCanvasStore((s) => s.wizardStep);
  const setWizardStep = useCanvasStore((s) => s.setWizardStep);
  const setWizardOrigin = useCanvasStore((s) => s.setWizardOrigin);
  const saveStatus = useCanvasStore((s) => s.saveStatus);
  const lastSavedAt = useCanvasStore((s) => s.lastSavedAt);
  const saveError = useCanvasStore((s) => s.saveError);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedToast, setPublishedToast] = useState<string | null>(null);

  // Re-render once a minute so "Saved 30s ago" stays current.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSavedAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [lastSavedAt]);

  if (wizardStep !== "canvas") return null;

  const statusLabel = STATUS_DISPLAY[processMeta.status] || "Draft";
  const status = STATUS_COLORS[statusLabel] || STATUS_COLORS.Draft;
  const isDraft = processMeta.status === "DRAFT";

  const onPublish = async () => {
    if (!processId || publishing) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await apiPost<{
        status: "ACTIVE";
        versionNumber: number;
        reused: boolean;
      }>(`/processes/${processId}/publish`, {});
      setProcessMeta({ status: res.status });
      setPublishedToast(
        res.reused
          ? `Already up to date · v${res.versionNumber}`
          : `Published v${res.versionNumber}`,
      );
      window.setTimeout(() => setPublishedToast(null), 3500);
    } catch (e) {
      setPublishError((e as Error).message);
      window.setTimeout(() => setPublishError(null), 5000);
    } finally {
      setPublishing(false);
    }
  };

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

      {/* Right: Save button + status + Creator + last updated + Edit button */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {saveStatus === "error" && saveError ? (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 11, color: "#B91C1C", fontWeight: 500,
            maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={saveError}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Save failed: {saveError}
          </span>
        ) : dirty ? (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 11, color: "#B45309", fontWeight: 500,
          }} title="Your changes are not yet persisted. Click Save or press ⌘S / Ctrl+S.">
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F59E0B" }} />
            Unsaved changes
          </span>
        ) : (
          <SaveStatusPill status={saveStatus} lastSavedAt={lastSavedAt} />
        )}

        {!readOnly && (
          <button
            onClick={() => onSave?.()}
            disabled={!dirty || saveStatus === "saving"}
            title={dirty ? "Save canvas (⌘S)" : "No changes to save"}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 6,
              border: "1px solid " + (dirty ? "#4F46E5" : "#E5E7EB"),
              background: dirty ? "#4F46E5" : "#F9FAFB",
              color: dirty ? "#fff" : "#9CA3AF",
              fontSize: 12, fontWeight: 600,
              cursor: dirty && saveStatus !== "saving" ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
              opacity: saveStatus === "saving" ? 0.6 : 1,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            {saveStatus === "saving" ? "Saving…" : "Save"}
          </button>
        )}

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

        {processId && canPublish && (
          <button
            onClick={onPublish}
            disabled={publishing}
            title={
              isDraft
                ? "Mark this process Active so others can start instances against it."
                : "Snapshot the current canvas as a new published version."
            }
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 6,
              border: "1px solid " + (isDraft ? "#10B981" : "#E5E7EB"),
              background: isDraft ? "#10B981" : "#fff",
              color: isDraft ? "#fff" : "#374151",
              fontSize: 12, fontWeight: 600,
              cursor: publishing ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: publishing ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
            {publishing ? "Publishing…" : isDraft ? "Publish" : "Republish"}
          </button>
        )}

        {publishedToast && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 11, color: "#047857", fontWeight: 500,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981" }} />
            {publishedToast}
          </span>
        )}
        {publishError && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 11, color: "#B91C1C", fontWeight: 500,
            maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={publishError}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#EF4444" }} />
            Publish failed: {publishError}
          </span>
        )}

        {processId && canManagePermissions && (
          <button
            onClick={() => navigate(`/designer/${processId}/permissions`)}
            title="Manage who can view, edit, publish, or start this process"
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 11c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/>
              <path d="M12 13c-3.314 0-6 2.686-6 6v2h12v-2c0-3.314-2.686-6-6-6z"/>
            </svg>
            Permissions
          </button>
        )}

        {!readOnly && (
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
        )}
      </div>
    </div>
  );
}

/* ─── Save status pill ─── */
function SaveStatusPill({
  status, lastSavedAt,
}: {
  status: "idle" | "saving" | "saved" | "error";
  lastSavedAt: number | null;
}) {
  if (status === "idle" && !lastSavedAt) return null;

  let icon: React.ReactNode = null;
  let text = "";
  let color = "#9CA3AF";

  if (status === "saving") {
    icon = (
      <span
        style={{
          width: 10, height: 10, borderRadius: "50%",
          border: "1.5px solid #CBD5E1", borderTopColor: "#6B7280",
          animation: "spin 0.8s linear infinite",
          display: "inline-block",
        }}
      />
    );
    text = "Saving…";
    color = "#6B7280";
  } else if (status === "error") {
    icon = (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
    text = "Save failed";
    color = "#DC2626";
  } else if (status === "saved" || (status === "idle" && lastSavedAt)) {
    icon = (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
    text = lastSavedAt ? `Saved ${relTime(lastSavedAt)}` : "Saved";
    color = "#10B981";
  }

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: 11, color, fontWeight: 500,
    }}>
      {icon}
      {text}
    </span>
  );
}

function relTime(ms: number): string {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
