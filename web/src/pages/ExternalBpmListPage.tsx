/* ─── External BPM list page ─────────────────────────────────────────
 * Lists deployed process models from an external webMethods install
 * (DOE project for now). Read-only — no FlowPro DB writes happen
 * anywhere on this page. Click a row to preview the model's graph.
 *
 * Styling intentionally mirrors InstancesListPage so the page feels
 * native to the rest of the app.
 * ────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../lib/api";
import Button from "../components/ui/button";

interface ExternalModel {
  processKey: string;
  modelVersion: string;
  deploymentVersion: number;
  label: string | null;
  enabled: boolean;
  deploymentTime: string | null;
  processPath: string | null;
}

const GRID_COLUMNS =
  "minmax(180px, 2fr) 64px 70px 100px 110px 28px";

export default function ExternalBpmListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ExternalModel[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ExternalModel[]>("/external-bpm/models");
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        (r.label ?? "").toLowerCase().includes(q) ||
        r.processKey.toLowerCase().includes(q) ||
        (r.processPath ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  function openPreview(row: ExternalModel) {
    const qs = new URLSearchParams({
      processKey: row.processKey,
      modelVersion: row.modelVersion,
      deploymentVersion: String(row.deploymentVersion),
    });
    navigate(`/external-bpm/preview?${qs.toString()}`);
  }

  return (
    <div>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#101828",
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            External Processes
          </h1>
          <p style={{ fontSize: 14, color: "#667085", margin: "4px 0 0" }}>
            Browse process models deployed in an external BPM system. Read-only —
            no data is stored in FlowPro.
          </p>
        </div>
        <Button variant="secondary" size="md" onClick={refresh} disabled={loading}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Refresh
        </Button>
      </div>

      {/* Search + source bar */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ position: "relative", flex: 1, maxWidth: 480 }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#98A2B3"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by label or process key…"
            style={{
              width: "100%",
              padding: "8px 12px 8px 36px",
              fontSize: 13,
              color: "#101828",
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 8,
              outline: "none",
              fontFamily: "inherit",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#C7D2FE")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#E5E7EB")}
          />
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: "#98A2B3" }}>
          Source: <strong style={{ color: "#475467", fontWeight: 600 }}>webMethods</strong>
          {" · "}
          {filtered.length.toLocaleString()} model{filtered.length === 1 ? "" : "s"}
          {filtered.length !== rows.length && (
            <span style={{ color: "#9CA3AF" }}>
              {" "}of {rows.length.toLocaleString()}
            </span>
          )}
        </span>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            border: "1px solid #FECACA",
            background: "#FEF2F2",
            borderRadius: 8,
            color: "#B42318",
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          Failed to load models: {error}
        </div>
      )}

      {loading && rows.length === 0 && (
        <div
          style={{
            padding: 60,
            textAlign: "center",
            color: "#98A2B3",
            fontSize: 13,
          }}
        >
          Loading models from webMethods…
        </div>
      )}

      {!loading && filtered.length === 0 && !error && (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            background: "#fff",
            borderRadius: 12,
            border: "1px solid #E5E7EB",
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#D0D5DD"
            strokeWidth="1.5"
            style={{ marginBottom: 12 }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "#344054",
              marginBottom: 4,
            }}
          >
            {rows.length === 0 ? "No models found" : "No matches"}
          </div>
          <div style={{ fontSize: 13, color: "#98A2B3" }}>
            {rows.length === 0
              ? "The connected webMethods database has no deployed process definitions."
              : "Try a different search term."}
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS,
              padding: "10px 20px",
              background: "#F9FAFB",
              borderBottom: "1px solid #E5E7EB",
              fontSize: 11,
              fontWeight: 600,
              color: "#98A2B3",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              alignItems: "center",
            }}
          >
            <span>Model</span>
            <span>Version</span>
            <span>Deploy #</span>
            <span>Status</span>
            <span>Deployed</span>
            <span></span>
          </div>

          {/* Data rows */}
          {filtered.map((row) => {
            const key = `${row.processKey}|${row.modelVersion}|${row.deploymentVersion}`;
            const deployedAt = row.deploymentTime ? new Date(row.deploymentTime) : null;
            return (
              <div
                key={key}
                onClick={() => openPreview(row)}
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID_COLUMNS,
                  padding: "14px 20px",
                  borderBottom: "1px solid #F2F4F7",
                  alignItems: "center",
                  cursor: "pointer",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#FAFBFC")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#111827",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {row.label || (
                      <span style={{ color: "#9CA3AF", fontStyle: "italic" }}>
                        (no label)
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#9CA3AF",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={`${row.processPath ?? ""} · ${row.processKey}`}
                  >
                    {row.processPath ? (
                      <>
                        <span style={{ color: "#6366F1", fontWeight: 500 }}>
                          {row.processPath}
                        </span>
                        <span style={{ color: "#D1D5DB" }}>{" / "}</span>
                      </>
                    ) : null}
                    <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                      {row.processKey.replace(/^.*\//, "")}
                    </span>
                  </div>
                </div>
                <span style={{ fontSize: 13, color: "#475467" }}>
                  v{row.modelVersion}
                </span>
                <span style={{ fontSize: 13, color: "#475467" }}>
                  #{row.deploymentVersion}
                </span>
                <div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "3px 10px",
                      borderRadius: 6,
                      background: row.enabled ? "#ECFDF3" : "#F2F4F7",
                      fontSize: 11,
                      fontWeight: 600,
                      color: row.enabled ? "#027A48" : "#667085",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: row.enabled ? "#12B76A" : "#98A2B3",
                      }}
                    />
                    {row.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>
                  {deployedAt ? deployedAt.toLocaleDateString() : "—"}
                </span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#C7D2FE"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
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
