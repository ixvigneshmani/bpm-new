import type { ReactNode } from "react";

type Props = {
  activeProcessCount: number;
  totalProcessCount: number;
  taskCount: number;
  runningCount: number;
  completedTodayCount: number;
};

type Stat = {
  icon: ReactNode;
  iconBg: string;
  iconColor: string;
  value: string;
  label: string;
  sub: string;
};

export default function StatsGrid({
  activeProcessCount,
  totalProcessCount,
  taskCount,
  runningCount,
  completedTodayCount,
}: Props) {
  const draftCount = totalProcessCount - activeProcessCount;
  const stats: Stat[] = [
    {
      icon: (
        <>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </>
      ),
      iconBg: "#EEF2FF",
      iconColor: "#4F46E5",
      value: String(activeProcessCount),
      label: "Active Processes",
      sub: `${totalProcessCount} total · ${draftCount} draft`,
    },
    {
      icon: (
        <>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </>
      ),
      iconBg: "#FFFAEB",
      iconColor: "#F79009",
      value: String(taskCount),
      label: "My Tasks",
      sub: "Awaiting your action",
    },
    {
      icon: (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </>
      ),
      iconBg: "#EFF8FF",
      iconColor: "#2E90FA",
      value: String(runningCount),
      label: "Running Instances",
      sub: "In flight right now",
    },
    {
      icon: (
        <>
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </>
      ),
      iconBg: "#ECFDF3",
      iconColor: "#12B76A",
      value: String(completedTodayCount),
      label: "Completed Today",
      sub: "Since midnight",
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
      {stats.map((s) => (
        <div
          key={s.label}
          style={{
            background: "#fff",
            border: "1px solid #EAECF0",
            borderRadius: 12,
            padding: "18px 20px",
            boxShadow: "0 1px 2px rgba(16,24,40,0.05)",
          }}
        >
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: s.iconBg,
                color: s.iconColor,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                {s.icon}
              </svg>
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: "#101828" }}>
            {s.value}
          </div>
          <div style={{ fontSize: 12, color: "#667085", marginTop: 2, fontWeight: 500 }}>{s.label}</div>
          <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 6 }}>{s.sub}</div>
        </div>
      ))}
    </div>
  );
}
