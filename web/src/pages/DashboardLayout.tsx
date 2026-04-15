import { Outlet } from "react-router-dom";
import { SidebarProvider } from "../components/layout/sidebar-context";
import AppShell from "../components/layout/app-shell";

export default function DashboardLayout() {
  return (
    <SidebarProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </SidebarProvider>
  );
}
