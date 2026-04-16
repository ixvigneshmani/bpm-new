import { useLocation, useNavigate } from "react-router-dom";
import { useSidebar } from "./sidebar-context";

const ROUTE_LABELS: Record<string, string> = {
  "/home": "Home",
  "/tasks": "My Tasks",
  "/approvals": "Approvals",
  "/inbox": "Inbox",
  "/designer": "Process Designer",
  "/designer/new": "New Process",
  "/processes": "All Processes",
  "/running": "Running",
  "/drafts": "Drafts",
  "/teams": "Teams",
  "/analytics": "Analytics",
  "/settings": "Settings",
};

function buildBreadcrumbs(pathname: string) {
  const crumbs: { label: string; path: string }[] = [];

  // Handle dynamic /designer/:id routes
  const designerMatch = pathname.match(/^\/designer\/(.+)$/);
  if (designerMatch && designerMatch[1] !== "new") {
    crumbs.push({ label: "Acme Corp", path: "/home" });
    crumbs.push({ label: "Process Designer", path: "/designer" });
    crumbs.push({ label: "Edit Process", path: pathname });
    return crumbs;
  }

  // Always start with workspace
  crumbs.push({ label: "Acme Corp", path: "/home" });

  // Exact match first
  if (ROUTE_LABELS[pathname]) {
    // Check if there's a parent route (e.g., /designer for /designer/new)
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length > 1) {
      const parentPath = "/" + segments[0];
      if (ROUTE_LABELS[parentPath]) {
        crumbs.push({ label: ROUTE_LABELS[parentPath], path: parentPath });
      }
    }
    crumbs.push({ label: ROUTE_LABELS[pathname], path: pathname });
  }

  return crumbs;
}

export default function Header() {
  const { toggle } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();

  const breadcrumbs = buildBreadcrumbs(location.pathname);

  return (
    <header
      style={{
        height: 56,
        background: "#fff",
        borderBottom: "1px solid #EAECF0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={toggle}
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "1px solid #EAECF0",
            borderRadius: 8,
            color: "#667085",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>

        {/* Dynamic breadcrumb */}
        <nav style={{ display: "flex", alignItems: "center", gap: 0, fontSize: 13 }}>
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <div key={crumb.path} style={{ display: "flex", alignItems: "center" }}>
                {i > 0 && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#D0D5DD"
                    strokeWidth="2"
                    style={{ margin: "0 6px", flexShrink: 0 }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
                <span
                  onClick={() => { if (!isLast) navigate(crumb.path); }}
                  style={{
                    color: isLast ? "#344054" : "#98A2B3",
                    fontWeight: isLast ? 600 : 400,
                    cursor: isLast ? "default" : "pointer",
                    transition: "color 0.15s ease",
                  }}
                  onMouseEnter={(e) => { if (!isLast) e.currentTarget.style.color = "#475467"; }}
                  onMouseLeave={(e) => { if (!isLast) e.currentTarget.style.color = "#98A2B3"; }}
                >
                  {crumb.label}
                </span>
              </div>
            );
          })}
        </nav>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", border: "1px solid #EAECF0", borderRadius: 8, color: "#667085", cursor: "pointer", position: "relative" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
          <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, background: "#F04438", borderRadius: "50%", border: "2px solid #fff" }} />
        </button>
      </div>
    </header>
  );
}
