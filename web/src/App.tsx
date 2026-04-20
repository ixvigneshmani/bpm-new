import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./lib/auth";
import LoginPage from "./pages/LoginPage";
import DashboardLayout from "./pages/DashboardLayout";
import DashboardPage from "./pages/DashboardPage";
import ProcessListPage from "./pages/ProcessListPage";
import DesignCanvasPage from "./pages/DesignCanvasPage";
import TasksInboxPage from "./pages/TasksInboxPage";
import InstancesListPage from "./pages/InstancesListPage";
import InstanceDetailPage from "./pages/InstanceDetailPage";

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
        <Route path="home" element={<DashboardPage />} />
        <Route path="designer" element={<ProcessListPage />} />
        <Route path="designer/new" element={<DesignCanvasPage />} />
        <Route path="designer/:id" element={<DesignCanvasPage />} />
        <Route path="tasks" element={<TasksInboxPage />} />
        <Route path="running" element={<InstancesListPage />} />
        <Route path="instances/:id" element={<InstanceDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
