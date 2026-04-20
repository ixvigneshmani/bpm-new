/* ─── Instances List ────────────────────────────────────────────────
 * Tenant-wide list of process instances, status-filterable. Click
 * a row → instance detail page (state + tokens + recent events).
 * ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../lib/api";
import { useVisiblePoll } from "../lib/use-visible-poll";

type InstanceRow = {
  id: string;
  processId: string;
  processName: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedBy: string;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
};

type StatusFilter = "all" | "running" | "completed" | "failed" | "cancelled";

const STATUS_STYLES: Record<InstanceRow["status"], { bg: string; text: string; dot: string; label: string }> = {
  running:   { bg: "#EEF2FF", text: "#4338CA", dot: "#6366F1", label: "Running" },
  completed: { bg: "#F0FDF4", text: "#166534", dot: "#22C55E", label: "Completed" },
  failed:    { bg: "#FEF2F2", text: "#B42318", dot: "#EF4444", label: "Failed" },
  cancelled: { bg: "#F9FAFB", text: "#475467", dot: "#98A2B3", label: "Cancelled" },
};

const REFRESH_INTERVAL_MS = 15_000;

export default function InstancesListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<InstanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");

  const refresh = useCallback(async () => {
    try {
      const path = filter === "all" ? "/instances" : `/instances?status=${filter}`;
      const data = await apiGet<InstanceRow[]>(path);
      setRows(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Reset the loading spinner when the filter changes. The actual
  // refresh is driven by useVisiblePoll, which fires an immediate
  // refresh on every render where `refresh` identity changes (which
  // happens when the filter does).
  useEffect(() => {
    setLoading(true);
  }, [filter]);

  useVisiblePoll(refresh, REFRESH_INTERVAL_MS);

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#101828", letterSpacing: "-0.02em", margin: 0 }}>
            Running Instances
          </h1>
          <p style={{ fontSize: 14, color: "#667085", margin: "4px 0 0" }}>
            Live + recently terminated process executions across the tenant
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(["all", "running", "completed", "failed", "cancelled"] as StatusFilter[]).map((f) => {
          const active = f === filter;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "7px 14px", borderRadius: 8,
                border: active ? "1px solid #C7D2FE" : "1px solid #E5E7EB",
                background: active ? "#EEF2FF" : "#fff",
                color: active ? "#4F46E5" : "#475467",
                fontSize: 13, fontWeight: active ? 600 : 500,
                cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize",
              }}
            >
              {f}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ alignSelf: "center", fontSize: 13, color: "#98A2B3" }}>
          {rows.length} instance{rows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", border: "1px solid #FECACA", background: "#FEF2F2", borderRadius: 8, color: "#B42318", fontSize: 13, marginBottom: 12 }}>
          Failed to load instances: {error}
        </div>
      )}

      {loading && rows.length === 0 && (
        <div style={{ padding: 60, textAlign: "center", color: "#98A2B3", fontSize: 13 }}>Loading…</div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div style={{
          textAlign: "center", padding: "60px 20px",
          background: "#fff", borderRadius: 12, border: "1px solid #E5E7EB",
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D0D5DD" strokeWidth="1.5" style={{ marginBottom: 12 }}>
            <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#344054", marginBottom: 4 }}>
            No {filter === "all" ? "" : filter} instances
          </div>
          <div style={{ fontSize: 13, color: "#98A2B3" }}>
            Open a process and click <strong>Start instance</strong> to kick one off
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "minmax(200px, 2fr) 120px 120px 140px 40px",
            padding: "10px 20px", background: "#F9FAFB", borderBottom: "1px solid #E5E7EB",
            fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em",
            alignItems: "center",
          }}>
            <span>Process</span>
            <span>Status</span>
            <span>Started</span>
            <span>Duration</span>
            <span></span>
          </div>
          {rows.map((row) => {
            const st = STATUS_STYLES[row.status];
            const startedAt = new Date(row.startedAt);
            const endedAt = row.completedAt ? new Date(row.completedAt) : null;
            const startAge = formatAge(Date.now() - startedAt.getTime());
            const duration = endedAt
              ? formatAge(endedAt.getTime() - startedAt.getTime(), true)
              : "—";
            return (
              <div
                key={row.id}
                onClick={() => navigate(`/instances/${row.id}`)}
                style={{
                  display: "grid", gridTemplateColumns: "minmax(200px, 2fr) 120px 120px 140px 40px",
                  padding: "14px 20px", borderBottom: "1px solid #F2F4F7",
                  alignItems: "center", cursor: "pointer", transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#FAFBFC")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.processName}
                  </div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "var(--font-mono, monospace)" }}>
                    {row.id.slice(0, 8)}…
                  </div>
                </div>
                <div>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "3px 10px", borderRadius: 6,
                    background: st.bg, fontSize: 11, fontWeight: 600, color: st.text,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.dot }} />
                    {st.label}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>{startAge}</span>
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>{duration}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C7D2FE" strokeWidth="1.5" strokeLinecap="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatAge(ms: number, includeSeconds = false): string {
  if (ms < 1_000) return includeSeconds ? `${ms}ms` : "Just now";
  if (ms < 60_000) return includeSeconds ? `${Math.floor(ms / 1_000)}s` : "Just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}
