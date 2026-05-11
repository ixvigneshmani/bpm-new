import { Routes, Route, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { ProtectedRoute } from "./lib/auth";
import { PageErrorBoundary } from "./components/layout/page-error-boundary";
import LoginPage from "./pages/LoginPage";
import MfaChallengePage from "./pages/MfaChallengePage";
import SecuritySettingsPage from "./pages/SecuritySettingsPage";
import DashboardLayout from "./pages/DashboardLayout";
import DashboardPage from "./pages/DashboardPage";
import ProcessListPage from "./pages/ProcessListPage";
import DesignCanvasPage from "./pages/DesignCanvasPage";
import TasksInboxPage from "./pages/TasksInboxPage";
import InstancesListPage from "./pages/InstancesListPage";
import InstanceDetailPage from "./pages/InstanceDetailPage";
import ConsoleLayout from "./pages/console/ConsoleLayout";
import ProcessesPanel from "./pages/console/ProcessesPanel";
import InstancePanel from "./pages/console/InstancePanel";
import TasksPanel from "./pages/console/TasksPanel";
import SearchPanel from "./pages/console/SearchPanel";
import StubPanel from "./pages/console/StubPanel";

/** Wrap a route element in a per-page error boundary. A render crash
 *  inside any single page is contained and shows a friendly fallback
 *  instead of tearing down the sidebar + shell. */
function guarded(element: ReactNode): ReactNode {
  return <PageErrorBoundary>{element}</PageErrorBoundary>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/mfa" element={<MfaChallengePage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={guarded(<DashboardPage />)} />
        <Route path="designer" element={guarded(<ProcessListPage />)} />
        <Route path="designer/new" element={guarded(<DesignCanvasPage />)} />
        <Route path="designer/:id" element={guarded(<DesignCanvasPage />)} />
        <Route path="tasks" element={guarded(<TasksInboxPage />)} />
        <Route path="running" element={guarded(<InstancesListPage />)} />
        <Route path="instances/:id" element={guarded(<InstanceDetailPage />)} />
        <Route path="settings/security" element={guarded(<SecuritySettingsPage />)} />
        <Route path="console" element={guarded(<ConsoleLayout />)}>
          <Route index element={<Navigate to="/console/processes" replace />} />
          <Route path="processes" element={<ProcessesPanel />} />
          <Route path="instances/:id" element={<InstancePanel />} />
          <Route path="tasks"     element={<TasksPanel />} />
          <Route path="search"    element={<SearchPanel />} />
          <Route path="webhooks"  element={<StubPanel title="Webhook Inspector"        comingIn="TC1.4" />} />
          <Route path="variables" element={<StubPanel title="Variables Playground"     comingIn="TC1.5" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
