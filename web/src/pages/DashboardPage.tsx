import WelcomeBanner from "../components/dashboard/welcome-banner";
import QuickActions from "../components/dashboard/quick-actions";
import StatsGrid from "../components/dashboard/stats-grid";
import RecentProcesses from "../components/dashboard/recent-processes";
import ActivityFeed from "../components/dashboard/activity-feed";

export default function DashboardPage() {
  return (
    <>
      <WelcomeBanner />
      <QuickActions />
      <StatsGrid />
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 12 }}>
        <RecentProcesses />
        <ActivityFeed />
      </div>
    </>
  );
}
