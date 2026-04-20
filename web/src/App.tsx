import { Routes, Route, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { ProtectedRoute } from "./lib/auth";
import { PageErrorBoundary } from "./components/layout/page-error-boundary";
import LoginPage from "./pages/LoginPage";
import DashboardLayout from "./pages/DashboardLayout";
import DashboardPage from "./pages/DashboardPage";
import ProcessListPage from "./pages/ProcessListPage";
import DesignCanvasPage from "./pages/DesignCanvasPage";
import TasksInboxPage from "./pages/TasksInboxPage";
import InstancesListPage from "./pages/InstancesListPage";
import InstanceDetailPage from "./pages/InstanceDetailPage";

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
      </Route>
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
