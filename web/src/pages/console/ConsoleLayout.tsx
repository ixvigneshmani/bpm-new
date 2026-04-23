/* ─── BPM Test Console layout ─────────────────────────────────────────
 * Admin-only shell (/console/*) for exercising the API the way a host
 * app would. Top tabs for each panel; each panel is a sub-route so
 * deep-linking works. Admin gate checked here so a non-admin who types
 * the URL directly sees a friendly forbidden screen instead of a
 * broken panel. Sidebar link is hidden for non-admins separately.
 * ──────────────────────────────────────────────────────────────────── */

import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";

const TABS = [
  { to: "/console/processes",  label: "Processes" },
  { to: "/console/tasks",      label: "My Tasks" },
  { to: "/console/search",     label: "Search" },
  { to: "/console/webhooks",   label: "Webhooks" },
  { to: "/console/variables",  label: "Variables" },
];

export default function ConsoleLayout() {
  const { user } = useAuth();
  const isAdmin = user?.systemRole === "owner" || user?.systemRole === "admin";

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, maxWidth: 480 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#101828" }}>Admin only</h1>
        <p style={{ fontSize: 14, color: "#475467", marginTop: 6 }}>
          The BPM Test Console is restricted to workspace owners and admins.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header + tabs */}
      <div style={{ borderBottom: "1px solid #EAECF0", background: "#fff" }}>
        <div style={{ padding: "16px 24px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#101828", letterSpacing: "-0.02em", margin: 0 }}>
              BPM Test Console
            </h1>
            <p style={{ fontSize: 13, color: "#667085", margin: "4px 0 0" }}>
              Exercise every API endpoint the way a host app would. Admin-only.
            </p>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#92400E", background: "#FEF3C7", border: "1px solid #FDE68A", padding: "3px 10px", borderRadius: 9999 }}>
            {user?.systemRole}
          </span>
        </div>
        <div style={{ padding: "16px 24px 0", display: "flex", gap: 2 }}>
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              style={({ isActive }) => ({
                padding: "8px 14px",
                borderRadius: "8px 8px 0 0",
                fontSize: 13,
                fontWeight: 600,
                color: isActive ? "#4F46E5" : "#667085",
                background: isActive ? "#EEF2FF" : "transparent",
                borderBottom: isActive ? "2px solid #4F46E5" : "2px solid transparent",
                textDecoration: "none",
                marginBottom: -1,
              })}
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <Outlet />
      </div>
    </div>
  );
}
