const statusStyles: Record<string, { bg: string; color: string }> = {
  Active: { bg: "#ECFDF3", color: "#12B76A" },
  Pending: { bg: "#FFFAEB", color: "#F79009" },
  Review: { bg: "#EFF8FF", color: "#2E90FA" },
};

const processes = [
  {
    name: "Vendor Onboarding",
    id: "#PRO-1247",
    status: "Active",
    owner: "Sarah Chen",
    ownerInitials: "SC",
    avatarGradient: "linear-gradient(135deg,#6366F1,#A78BFA)",
    time: "2m ago",
  },
  {
    name: "Invoice Approval",
    id: "#PRO-892",
    status: "Pending",
    owner: "Mike Torres",
    ownerInitials: "MT",
    avatarGradient: "linear-gradient(135deg,#F59E0B,#EF4444)",
    time: "15m ago",
  },
  {
    name: "Employee Offboarding",
    id: "#PRO-331",
    status: "Review",
    owner: "Priya Patel",
    ownerInitials: "PP",
    avatarGradient: "linear-gradient(135deg,#10B981,#059669)",
    time: "1h ago",
  },
  {
    name: "Contract Renewal",
    id: "#PRO-567",
    status: "Active",
    owner: "James Wilson",
    ownerInitials: "JW",
    avatarGradient: "linear-gradient(135deg,#3B82F6,#06B6D4)",
    time: "2h ago",
  },
];

export default function RecentProcesses() {
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
        <span style={{ fontSize: 14, fontWeight: 600, color: "#101828" }}>Recent Processes</span>
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
          View all
        </a>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Process", "Status", "Owner", "Updated"].map((h) => (
              <th
                key={h}
                style={{
                  padding: "8px 20px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#667085",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  textAlign: "left",
                  background: "#F9FAFB",
                  borderBottom: "1px solid #EAECF0",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {processes.map((p) => {
            const st = statusStyles[p.status] ?? statusStyles.Active;
            return (
              <tr key={p.id}>
                <td style={{ padding: "10px 20px", fontSize: 13, borderBottom: "1px solid #F2F4F7" }}>
                  <div style={{ fontWeight: 600, color: "#101828" }}>{p.name}</div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                      fontSize: 11,
                      color: "#98A2B3",
                      marginTop: 1,
                    }}
                  >
                    {p.id}
                  </div>
                </td>
                <td style={{ padding: "10px 20px", fontSize: 13, borderBottom: "1px solid #F2F4F7" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      borderRadius: 9999,
                      fontSize: 11,
                      fontWeight: 600,
                      background: st.bg,
                      color: st.color,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: st.color,
                      }}
                    />
                    {p.status}
                  </span>
                </td>
                <td style={{ padding: "10px 20px", fontSize: 13, borderBottom: "1px solid #F2F4F7" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: p.avatarGradient,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                        fontWeight: 600,
                        color: "#fff",
                        flexShrink: 0,
                      }}
                    >
                      {p.ownerInitials}
                    </div>
                    <span style={{ fontSize: 13, color: "#475467" }}>{p.owner}</span>
                  </div>
                </td>
                <td
                  style={{
                    padding: "10px 20px",
                    borderBottom: "1px solid #F2F4F7",
                    fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                    fontSize: 11,
                    color: "#98A2B3",
                  }}
                >
                  {p.time}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
