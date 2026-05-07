import { useCallback, useState } from "react";
import { apiGet } from "../lib/api";
import { useVisiblePoll } from "../lib/use-visible-poll";
import WelcomeBanner from "../components/dashboard/welcome-banner";
import QuickActions from "../components/dashboard/quick-actions";
import StatsGrid from "../components/dashboard/stats-grid";
import RecentProcesses from "../components/dashboard/recent-processes";
import ActivityFeed from "../components/dashboard/activity-feed";

export type DashProcess = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type DashInstance = {
  id: string;
  processId: string;
  processName: string;
  status: "running" | "completed" | "failed" | "cancelled" | "suspended";
  startedBy: string;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
};

export type DashTask = {
  tokenId: string;
  instanceId: string;
  processId: string;
  processName: string;
  nodeLabel: string | null;
  assignedTo: string | null;
  candidateRole: string | null;
  createdAt: string;
};

const REFRESH_INTERVAL_MS = 15_000;

export default function DashboardPage() {
  const [processes, setProcesses] = useState<DashProcess[]>([]);
  const [instances, setInstances] = useState<DashInstance[]>([]);
  const [tasks, setTasks] = useState<DashTask[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, i, t] = await Promise.all([
        apiGet<DashProcess[]>("/processes"),
        apiGet<DashInstance[]>("/instances"),
        apiGet<DashTask[]>("/tasks"),
      ]);
      setProcesses(p);
      setInstances(i);
      setTasks(t);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useVisiblePoll(refresh, REFRESH_INTERVAL_MS);

  const runningCount = instances.filter((i) => i.status === "running").length;
  const failedCount = instances.filter((i) => i.status === "failed").length;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const completedTodayCount = instances.filter(
    (i) =>
      i.status === "completed" &&
      i.completedAt &&
      new Date(i.completedAt).getTime() >= todayStart.getTime(),
  ).length;
  const activeProcessCount = processes.filter(
    (p) => p.status === "ACTIVE",
  ).length;

  return (
    <>
      <WelcomeBanner
        taskCount={tasks.length}
        runningCount={runningCount}
        failedCount={failedCount}
      />
      <QuickActions />
      <StatsGrid
        activeProcessCount={activeProcessCount}
        totalProcessCount={processes.length}
        taskCount={tasks.length}
        runningCount={runningCount}
        completedTodayCount={completedTodayCount}
      />
      {error && (
        <div
          style={{
            background: "#FEF3F2",
            border: "1px solid #FECDCA",
            color: "#B42318",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          Failed to load dashboard data: {error}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 12 }}>
        <RecentProcesses processes={processes} />
        <ActivityFeed instances={instances} />
      </div>
    </>
  );
}
