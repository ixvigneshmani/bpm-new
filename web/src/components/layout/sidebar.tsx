import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { useSidebar } from "./sidebar-context";

type NavItem = {
  name: string;
  href: string;
  icon: React.ReactNode;
  count?: number;
};

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "My Work",
    items: [
      {
        name: "Home",
        href: "/home",
        icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
      },
      {
        name: "My Tasks",
        href: "/tasks",
        icon: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
        count: 5,
      },
      {
        name: "Approvals",
        href: "/approvals",
        icon: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></>,
        count: 18,
      },
      {
        name: "Inbox",
        href: "/inbox",
        icon: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22 6 12 13 2 6" /></>,
        count: 3,
      },
    ],
  },
  {
    label: "Processes",
    items: [
      {
        name: "Process Designer",
        href: "/designer",
        icon: <><rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 8h4v4H7z" /><path d="M15 8h2" /><path d="M15 12h2" /><circle cx="16" cy="16" r="2" /><path d="M11 10h4" /></>,
      },
      {
        name: "All Processes",
        href: "/processes",
        icon: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
      },
      {
        name: "Running",
        href: "/running",
        icon: <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
      },
      {
        name: "Drafts",
        href: "/drafts",
        icon: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        name: "Teams",
        href: "/teams",
        icon: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></>,
      },
      {
        name: "Analytics",
        href: "/analytics",
        icon: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
      },
      {
        name: "Settings",
        href: "/settings",
        icon: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" /></>,
      },
    ],
  },
];

export default function Sidebar() {
  const { collapsed, mobileOpen, closeMobile } = useSidebar();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const location = useLocation();

  const initials = user?.displayName
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "?";

  return (
    <nav
      style={{
        background: "#fff",
        borderRight: "1px solid #EAECF0",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
        zIndex: 50,
        position: "relative",
      }}
    >
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: -1, background: "rgba(0,0,0,0.3)" }}
          onClick={closeMobile}
        />
      )}

      {/* Logo */}
      <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#6366F1,#818CF8)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(99,102,241,0.3)", flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M9 11l3 3L22 4" /></svg>
          </div>
          {!collapsed && <span style={{ fontSize: 16, fontWeight: 700, color: "#101828", letterSpacing: "-0.02em" }}>FlowPro</span>}
        </div>
        {!collapsed && (
          <span style={{ fontSize: 10, fontWeight: 600, color: "#4F46E5", background: "#EEF2FF", border: "1px solid #E0E7FF", padding: "2px 8px", borderRadius: 9999 }}>Pro</span>
        )}
      </div>

      {/* Workspace selector */}
      {!collapsed && (
        <div style={{ margin: "0 12px 12px", padding: "8px 10px", background: "#F9FAFB", border: "1px solid #EAECF0", borderRadius: 8, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexShrink: 0 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: "#E0E7FF", color: "#4F46E5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>A</div>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#344054" }}>Acme Corp</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#98A2B3" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
        </div>
      )}

      {/* Search */}
      {!collapsed && (
        <input
          type="text"
          placeholder="Search... ⌘K"
          style={{
            margin: "0 12px 8px",
            padding: "8px 10px 8px 34px",
            background: "#F9FAFB",
            border: "1px solid #EAECF0",
            borderRadius: 8,
            fontFamily: "inherit",
            fontSize: 13,
            color: "#101828",
            outline: "none",
            width: "calc(100% - 24px)",
            flexShrink: 0,
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2398A2B3' stroke-width='2' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='M21 21l-4.35-4.35'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "10px center",
          }}
        />
      )}

      {/* Scrollable nav groups */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {navGroups.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div style={{ height: 1, background: "#EAECF0", margin: collapsed ? "8px 12px" : "8px 20px" }} />}
            <div style={{ padding: collapsed ? "4px 6px" : "4px 8px" }}>
              {!collapsed && (
                <div style={{ fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", padding: "12px 12px 6px" }}>
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const isActive = location.pathname === item.href || (item.href !== "/home" && location.pathname.startsWith(item.href));
                return (
                <div
                  key={item.name}
                  onClick={() => navigate(item.href)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: collapsed ? 0 : 10,
                    padding: collapsed ? 10 : "8px 12px",
                    borderRadius: 8,
                    color: isActive ? "#4F46E5" : "#475467",
                    background: isActive ? "#EEF2FF" : "transparent",
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
                    cursor: "pointer",
                    justifyContent: collapsed ? "center" : "flex-start",
                    transition: "background 0.15s ease",
                  }}
                >
                  <svg
                    style={{ width: collapsed ? 20 : 18, height: collapsed ? 20 : 18, flexShrink: 0 }}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    {item.icon}
                  </svg>
                  {!collapsed && (
                    <>
                      <span>{item.name}</span>
                      {item.count !== undefined && (
                        <span style={{
                          marginLeft: "auto",
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 7px",
                          borderRadius: 9999,
                          background: isActive ? "#4F46E5" : "#F2F4F7",
                          color: isActive ? "#fff" : "#667085",
                        }}>
                          {item.count}
                        </span>
                      )}
                    </>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* User footer — always pinned to bottom */}
      <div style={{ flexShrink: 0, padding: 12, borderTop: "1px solid #EAECF0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: collapsed ? 0 : 10, padding: 8, borderRadius: 8, justifyContent: collapsed ? "center" : "flex-start" }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#6366F1,#A78BFA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "#fff", flexShrink: 0 }}>{initials}</div>
          {!collapsed && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#101828" }}>{user?.displayName}</div>
                <div style={{ fontSize: 11, color: "#667085", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</div>
              </div>
              <button
                onClick={() => {
                  logout();
                  navigate("/login", { replace: true });
                }}
                title="Sign out"
                style={{
                  marginLeft: "auto",
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  border: "1px solid #EAECF0",
                  background: "#fff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: "#667085",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#FEF3F2";
                  e.currentTarget.style.borderColor = "#F04438";
                  e.currentTarget.style.color = "#F04438";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#fff";
                  e.currentTarget.style.borderColor = "#EAECF0";
                  e.currentTarget.style.color = "#667085";
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
