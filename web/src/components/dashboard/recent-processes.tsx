import { useNavigate } from "react-router-dom";
import RelativeTime from "../RelativeTime";
import { STATUS_DISPLAY, STATUS_COLORS } from "../../lib/constants";
import type { DashProcess } from "../../pages/DashboardPage";

type Props = {
  processes: DashProcess[];
};

const MAX_ROWS = 5;

export default function RecentProcesses({ processes }: Props) {
  const navigate = useNavigate();

  const rows = [...processes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
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
        <span style={{ fontSize: 14, fontWeight: 600, color: "#101828" }}>Recent Processes</span>
        <a
          onClick={() => navigate("/designer")}
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

      {rows.length === 0 ? (
        <div style={{ padding: "32px 20px", fontSize: 13, color: "#98A2B3", textAlign: "center" }}>
          No processes yet. Create one to get started.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Process", "Status", "Version", "Updated"].map((h) => (
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
            {rows.map((p) => {
              const label = STATUS_DISPLAY[p.status] ?? p.status;
              const st = STATUS_COLORS[label] ?? STATUS_COLORS.Draft;
              return (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/designer/${p.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <td style={{ padding: "10px 20px", fontSize: 13, borderBottom: "1px solid #F2F4F7" }}>
                    <div style={{ fontWeight: 600, color: "#101828" }}>{p.name}</div>
                    {p.description && (
                      <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 1 }}>
                        {p.description.length > 60 ? `${p.description.slice(0, 60)}…` : p.description}
                      </div>
                    )}
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
                        color: st.text,
                      }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: st.dot }} />
                      {label}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "10px 20px",
                      fontSize: 12,
                      color: "#475467",
                      borderBottom: "1px solid #F2F4F7",
                      fontFamily: "var(--font-mono,'JetBrains Mono',monospace)",
                    }}
                  >
                    {p.version || "v1.0"}
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
                    <RelativeTime iso={p.updatedAt} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
