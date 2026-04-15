const activities = [
  {
    iconBg: "#EFF8FF",
    iconColor: "#2E90FA",
    icon: <path d="M9 11l3 3L22 4" />,
    text: <><span style={{ fontWeight: 600, color: "#101828" }}>Sarah Chen</span> approved Vendor Onboarding</>,
    time: "2 min ago",
  },
  {
    iconBg: "#ECFDF3",
    iconColor: "#12B76A",
    icon: <><circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" /></>,
    text: <><span style={{ fontWeight: 600, color: "#101828" }}>System</span> completed SLA check for Q2</>,
    time: "18 min ago",
  },
  {
    iconBg: "#FEF3F2",
    iconColor: "#F04438",
    icon: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
    text: <><span style={{ fontWeight: 600, color: "#101828" }}>Invoice #892</span> approaching SLA deadline</>,
    time: "42 min ago",
  },
  {
    iconBg: "#EFF8FF",
    iconColor: "#2E90FA",
    icon: <><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="8.5" cy="7" r="4" /></>,
    text: <><span style={{ fontWeight: 600, color: "#101828" }}>Mike Torres</span> assigned to Invoice Approval</>,
    time: "1 hr ago",
  },
  {
    iconBg: "#ECFDF3",
    iconColor: "#12B76A",
    icon: <><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
    text: <><span style={{ fontWeight: 600, color: "#101828" }}>Priya Patel</span> completed Exit Review</>,
    time: "2 hrs ago",
  },
];

export default function ActivityFeed() {
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

      <div style={{ padding: "4px 0" }}>
        {activities.map((a, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              padding: "10px 20px",
              position: "relative",
            }}
          >
            {/* Timeline line */}
            {i < activities.length - 1 && (
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
              <div style={{ fontSize: 13, color: "#667085", lineHeight: 1.4 }}>
                {a.text}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                  fontSize: 11,
                  color: "#98A2B3",
                  marginTop: 2,
                }}
              >
                {a.time}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
