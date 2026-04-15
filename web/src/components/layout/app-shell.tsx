
import { useLocation } from "react-router-dom";
import { useSidebar } from "./sidebar-context";
import Sidebar from "./sidebar";
import Header from "./header";

const FULL_BLEED_ROUTES = ["/designer/new"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  const location = useLocation();

  const isFullBleed = FULL_BLEED_ROUTES.some((r) => location.pathname.startsWith(r));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: collapsed ? "60px 1fr" : "260px 1fr",
        transition: "grid-template-columns 0.3s cubic-bezier(0.4,0,0.2,1)",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <Sidebar />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#F9FAFB",
          minWidth: 0,
          height: "100%",
        }}
      >
        <Header />
        <main
          style={{
            overflowY: isFullBleed ? "hidden" : "auto",
            padding: isFullBleed ? 0 : 24,
            flex: 1,
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
