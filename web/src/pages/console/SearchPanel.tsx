/* ─── Console: businessKey Search ─────────────────────────────────────
 * Look up instances by the host-app correlation key. Simulates the
 * host-app flow "find the BPM instance that matches my PO/ticket id".
 * ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../lib/api";
import { Banner, Field, inputStyle, primaryBtn } from "./ProcessesPanel";

type InstanceRow = {
  id: string;
  processId: string;
  processName: string;
  status: "running" | "completed" | "failed" | "cancelled";
  businessKey: string | null;
  startedBy: string;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
};

export default function SearchPanel() {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<InstanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setError(null);
    setLoading(true);
    try {
      const rows = await apiGet<InstanceRow[]>(`/instances?businessKey=${encodeURIComponent(trimmed)}`);
      setResults(rows);
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={submit} style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <Field label="businessKey" hint="Host-app correlation id set when the instance was started.">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="leave-req-2026-0142"
              style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)" }}
              autoFocus
            />
          </Field>
        </div>
        <button type="submit" style={primaryBtn} disabled={loading || !key.trim()}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <Banner kind="error">{error}</Banner>}

      {results !== null && !error && (
        <>
          <div style={{ fontSize: 13, color: "#475467", marginBottom: 8 }}>
            {results.length} match{results.length === 1 ? "" : "es"} for <code style={{ background: "#F2F4F7", padding: "1px 6px", borderRadius: 4 }}>{key.trim()}</code>
          </div>
          {results.length === 0 ? (
            <Banner kind="info">
              No instances carry that key. Start an instance from Processes with a businessKey to correlate it.
            </Banner>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #EAECF0", borderRadius: 10, overflow: "hidden" }}>
              {results.map((r, i) => (
                <Link key={r.id} to={`/console/instances/${r.id}`}
                  style={{
                    display: "grid", gridTemplateColumns: "minmax(220px,2fr) 1fr 110px 130px",
                    alignItems: "center", gap: 12, padding: "14px 20px",
                    borderTop: i > 0 ? "1px solid #F2F4F7" : "none",
                    textDecoration: "none", color: "inherit",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#101828" }}>{r.processName}</div>
                    <div style={{ fontSize: 11, color: "#98A2B3", fontFamily: "var(--font-mono, monospace)", marginTop: 2 }}>
                      {r.id}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: "#4F46E5", fontFamily: "var(--font-mono, monospace)" }}>
                    {r.businessKey}
                  </span>
                  <span style={statusPill(r.status)}>{r.status}</span>
                  <span style={{ fontSize: 12, color: "#667085" }}>
                    {new Date(r.startedAt).toLocaleString()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function statusPill(status: InstanceRow["status"]): React.CSSProperties {
  const palette: Record<InstanceRow["status"], [string, string]> = {
    running:   ["#EEF2FF", "#4F46E5"],
    completed: ["#ECFDF5", "#065F46"],
    failed:    ["#FEF2F2", "#B42318"],
    cancelled: ["#F2F4F7", "#475467"],
  };
  const [bg, fg] = palette[status];
  return {
    fontSize: 11, fontWeight: 700, textTransform: "uppercase",
    padding: "3px 10px", borderRadius: 9999, background: bg, color: fg, textAlign: "center",
  };
}
