import { useNavigate } from "react-router-dom";
import RelativeTime from "../RelativeTime";
import type { DashInstance } from "../../pages/DashboardPage";

type Props = {
  instances: DashInstance[];
};

const MAX_ROWS = 6;

type Entry = {
  id: string;
  instanceId: string;
  ts: string;
  iconBg: string;
  iconColor: string;
  icon: React.ReactNode;
  body: React.ReactNode;
};

function entryFor(i: DashInstance): Entry {
  const name = i.processName || "Process";
  switch (i.status) {
    case "completed":
      return {
        id: `${i.id}:completed`,
        instanceId: i.id,
        ts: i.completedAt ?? i.startedAt,
        iconBg: "#ECFDF3",
        iconColor: "#12B76A",
        icon: (
          <>
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </>
        ),
        body: (
          <>
            <span style={{ fontWeight: 600, color: "#101828" }}>{name}</span> completed
          </>
        ),
      };
    case "failed":
      return {
        id: `${i.id}:failed`,
        instanceId: i.id,
        ts: i.completedAt ?? i.startedAt,
        iconBg: "#FEF3F2",
        iconColor: "#F04438",
        icon: (
          <>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </>
        ),
        body: (
          <>
            <span style={{ fontWeight: 600, color: "#101828" }}>{name}</span> failed
            {i.errorMessage && (
              <span style={{ color: "#98A2B3" }}> — {i.errorMessage.length > 60 ? `${i.errorMessage.slice(0, 60)}…` : i.errorMessage}</span>
            )}
          </>
        ),
      };
    case "cancelled":
      return {
        id: `${i.id}:cancelled`,
        instanceId: i.id,
        ts: i.completedAt ?? i.startedAt,
        iconBg: "#F9FAFB",
        iconColor: "#667085",
        icon: (
          <>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </>
        ),
        body: (
          <>
            <span style={{ fontWeight: 600, color: "#101828" }}>{name}</span> cancelled
          </>
        ),
      };
    case "suspended":
      return {
        id: `${i.id}:suspended`,
        instanceId: i.id,
        ts: i.startedAt,
        iconBg: "#FFFAEB",
        iconColor: "#F79009",
        icon: (
          <>
            <rect x="6" y="5" width="4" height="14" />
            <rect x="14" y="5" width="4" height="14" />
          </>
        ),
        body: (
          <>
            <span style={{ fontWeight: 600, color: "#101828" }}>{name}</span> suspended
          </>
        ),
      };
    case "running":
    default:
      return {
        id: `${i.id}:started`,
        instanceId: i.id,
        ts: i.startedAt,
        iconBg: "#EFF8FF",
        iconColor: "#2E90FA",
        icon: (
          <>
            <polygon points="5 3 19 12 5 21 5 3" />
          </>
        ),
        body: (
          <>
            <span style={{ fontWeight: 600, color: "#101828" }}>{name}</span> started
          </>
        ),
      };
  }
}

export default function ActivityFeed({ instances }: Props) {
  const navigate = useNavigate();

  const rows = instances
    .map(entryFor)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, MAX_ROWS);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #EAECF0",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(16,24,40,0.05)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid #EAECF0",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: "#101828" }}>Activity</span>
        <a
          onClick={() => navigate("/running")}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#4F46E5",
            cursor: "pointer",
            padding: "4px 10px",
            borderRadius: 9999,
          }}
        >
          See all
        </a>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "32px 20px", fontSize: 13, color: "#98A2B3", textAlign: "center" }}>
          No instance activity yet.
        </div>
      ) : (
        <div style={{ padding: "4px 0" }}>
          {rows.map((a, i) => (
            <div
              key={a.id}
              onClick={() => navigate(`/instances/${a.instanceId}`)}
              style={{
                display: "flex",
                gap: 12,
                padding: "10px 20px",
                position: "relative",
                cursor: "pointer",
              }}
            >
              {i < rows.length - 1 && (
                <div
                  style={{
                    position: "absolute",
                    left: 33,
                    top: 38,
                    bottom: -2,
                    width: 1,
                    background: "#F2F4F7",
                  }}
                />
              )}
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  position: "relative",
                  zIndex: 1,
                  background: a.iconBg,
                  color: a.iconColor,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {a.icon}
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 13, color: "#667085", lineHeight: 1.4 }}>{a.body}</div>
                <div
                  style={{
                    fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                    fontSize: 11,
                    color: "#98A2B3",
                    marginTop: 2,
                  }}
                >
                  <RelativeTime iso={a.ts} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
