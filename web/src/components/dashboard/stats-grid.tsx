const stats = [
  {
    icon: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
    iconBg: "#EEF2FF",
    iconColor: "#4F46E5",
    trend: "+12.5%",
    trendUp: true,
    value: "247",
    label: "Active Processes",
    barWidth: "72%",
    barColor: "#6366F1",
  },
  {
    icon: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></>,
    iconBg: "#FFFAEB",
    iconColor: "#F79009",
    trend: "-3.2%",
    trendUp: false,
    value: "18",
    label: "Pending Approvals",
    barWidth: "28%",
    barColor: "#F79009",
  },
  {
    icon: <><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
    iconBg: "#ECFDF3",
    iconColor: "#12B76A",
    trend: "+8.1%",
    trendUp: true,
    value: "56",
    label: "Completed Today",
    barWidth: "85%",
    barColor: "#12B76A",
  },
  {
    icon: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
    iconBg: "#F5F3FF",
    iconColor: "#7C3AED",
    trend: "+1.8%",
    trendUp: true,
    value: "94.2%",
    valueColor: "#12B76A",
    label: "SLA Compliance",
    barWidth: "94%",
    barColor: "#7C3AED",
  },
];

export default function StatsGrid() {
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: s.iconBg, color: s.iconColor }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">{s.icon}</svg>
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                fontSize: 11,
                fontWeight: 500,
                padding: "2px 8px",
                borderRadius: 9999,
                background: s.trendUp ? "#ECFDF3" : "#FEF3F2",
                color: s.trendUp ? "#12B76A" : "#F04438",
              }}
            >
              {s.trend}
            </span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: s.valueColor ?? "#101828" }}>
            {s.value}
          </div>
          <div style={{ fontSize: 12, color: "#667085", marginTop: 2, fontWeight: 500 }}>{s.label}</div>
          <div style={{ height: 3, background: "#F2F4F7", borderRadius: 2, marginTop: 12 }}>
            <div style={{ height: "100%", borderRadius: 2, background: s.barColor, width: s.barWidth }} />
          </div>
        </div>
      ))}
    </div>
  );
}
