/* ─── Console: Process Explorer ───────────────────────────────────────
 * Lists tenant processes with a Start Instance action. Dialog supports
 * full raw-JSON variables + businessKey + idempotency key so the
 * operator can simulate exactly what a host app would send.
 * ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../../lib/api";

type ProcessRow = {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "PENDING" | "REVIEW";
  version: string | null;
  updatedAt: string;
};

type StartResult = {
  instanceId: string;
  status: "running" | "completed" | "failed";
  tokenCount: number;
  eventCount: number;
};

export default function ProcessesPanel() {
  const [rows, setRows] = useState<ProcessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<ProcessRow | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<ProcessRow[]>("/processes")
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 13, color: "#475467" }}>
        {rows.length} process{rows.length === 1 ? "" : "es"}
      </div>

      {error && <Banner kind="error">Failed to load: {error}</Banner>}
      {loading && <div style={{ color: "#98A2B3", fontSize: 13 }}>Loading…</div>}

      {!loading && rows.length === 0 && !error && (
        <Banner kind="info">No processes yet. Create one in the Designer.</Banner>
      )}

      {rows.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #EAECF0", borderRadius: 10, overflow: "hidden" }}>
          {rows.map((p, i) => (
            <div
              key={p.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 90px 140px 130px",
                alignItems: "center",
                gap: 12,
                padding: "14px 20px",
                borderTop: i > 0 ? "1px solid #F2F4F7" : "none",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#101828" }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "#98A2B3", fontFamily: "var(--font-mono, monospace)", marginTop: 2 }}>
                  {p.id}
                </div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                padding: "3px 8px", borderRadius: 6,
                background: p.status === "ACTIVE" ? "#ECFDF5" : "#F2F4F7",
                color:      p.status === "ACTIVE" ? "#065F46" : "#475467",
                textAlign: "center",
              }}>
                {p.status}
              </span>
              <span style={{ fontSize: 12, color: "#667085", fontFamily: "var(--font-mono, monospace)" }}>
                {p.version ?? "—"}
              </span>
              <button
                onClick={() => setStarting(p)}
                style={{
                  padding: "7px 14px", borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, #4F46E5, #6366F1)",
                  color: "#fff", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Start instance
              </button>
            </div>
          ))}
        </div>
      )}

      {starting && (
        <StartInstanceConsoleDialog
          process={starting}
          onClose={() => setStarting(null)}
        />
      )}
    </div>
  );
}

function StartInstanceConsoleDialog(props: { process: ProcessRow; onClose: () => void }) {
  const { process, onClose } = props;
  const [businessKey, setBusinessKey] = useState("");
  const [variablesJson, setVariablesJson] = useState("{}");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StartResult | null>(null);

  const submit = async () => {
    setError(null);
    let variables: Record<string, unknown> = {};
    if (variablesJson.trim()) {
      try {
        variables = JSON.parse(variablesJson);
        if (typeof variables !== "object" || Array.isArray(variables) || variables === null) {
          throw new Error("variables must be a JSON object");
        }
      } catch (e) {
        setError(`Invalid JSON: ${(e as Error).message}`);
        return;
      }
    }
    const body = {
      ...(businessKey.trim() ? { businessKey: businessKey.trim() } : {}),
      ...(Object.keys(variables).length ? { variables } : {}),
    };
    setSubmitting(true);
    try {
      const opts = idempotencyKey.trim()
        ? { headers: { "Idempotency-Key": idempotencyKey.trim() } }
        : undefined;
      const res = await apiPost<StartResult>(`/processes/${process.id}/instances`, body, opts);
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DrawerShell title={`Start: ${process.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Business key" hint="Host-app correlation id (PO number, ticket id…). Leave blank for ad-hoc runs.">
          <input
            value={businessKey}
            onChange={(e) => setBusinessKey(e.target.value)}
            placeholder="leave-req-2026-0142"
            style={inputStyle}
          />
        </Field>
        <Field label="Variables (JSON)" hint="Initial variable bag. Merged into the instance at start.">
          <textarea
            value={variablesJson}
            onChange={(e) => setVariablesJson(e.target.value)}
            spellCheck={false}
            rows={8}
            style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
          />
        </Field>
        <Field label="Idempotency-Key" hint="Optional. A replay-safe uuid; same key + same body returns the original response.">
          <input
            value={idempotencyKey}
            onChange={(e) => setIdempotencyKey(e.target.value)}
            placeholder="leave this blank or paste a uuid"
            style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
          />
        </Field>

        {error && <Banner kind="error">{error}</Banner>}
        {result && (
          <Banner kind="success">
            Started instance <code style={{ background: "#F2F4F7", padding: "1px 6px", borderRadius: 4 }}>{result.instanceId}</code> — status <strong>{result.status}</strong>.
            {" "}
            <Link to={`/console/instances/${result.instanceId}`} style={{ color: "#166534", fontWeight: 600 }}>View in console →</Link>
          </Banner>
        )}
      </div>

      <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 16 }}>
        <button onClick={onClose} style={secondaryBtn}>Close</button>
        <button
          onClick={submit}
          disabled={submitting || !!result}
          style={{
            ...primaryBtn,
            opacity: submitting ? 0.7 : 1,
            cursor: submitting || result ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Starting…" : result ? "✓ Started" : "Start instance"}
        </button>
      </div>
    </DrawerShell>
  );
}

/* ─── small helpers reused across console panels ─────────────────── */

export function Banner({ kind, children }: { kind: "error" | "info" | "success"; children: React.ReactNode }) {
  const palette = {
    error:   { bg: "#FEF2F2", border: "#FECACA", fg: "#B42318" },
    info:    { bg: "#F0F9FF", border: "#BAE6FD", fg: "#075985" },
    success: { bg: "#F0FDF4", border: "#BBF7D0", fg: "#166534" },
  }[kind];
  return (
    <div style={{
      padding: "10px 14px", border: `1px solid ${palette.border}`,
      background: palette.bg, borderRadius: 8, color: palette.fg, fontSize: 13,
    }}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: "#667085", marginBottom: 8 }}>{hint}</div>}
      {children}
    </div>
  );
}

export function DrawerShell(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div
        onClick={props.onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 60 }}
      />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 520,
        background: "#fff", boxShadow: "-8px 0 24px rgba(0,0,0,0.08)",
        display: "flex", flexDirection: "column", zIndex: 70,
      }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EAECF0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#101828" }}>{props.title}</div>
          <button onClick={props.onClose} aria-label="Close" style={closeBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 22, display: "flex", flexDirection: "column" }}>
          {props.children}
        </div>
      </div>
    </>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 8,
  border: "1px solid #E5E7EB", fontSize: 13, color: "#111827",
  fontFamily: "inherit", outline: "none", background: "#fff",
};

export const primaryBtn: React.CSSProperties = {
  padding: "9px 18px", borderRadius: 8, border: "none",
  background: "linear-gradient(135deg, #4F46E5, #6366F1)",
  fontSize: 13, fontWeight: 600, color: "#fff",
  fontFamily: "inherit", cursor: "pointer",
};

export const secondaryBtn: React.CSSProperties = {
  padding: "9px 16px", borderRadius: 8, border: "1px solid #E5E7EB",
  background: "#fff", fontSize: 13, fontWeight: 600, color: "#475467",
  fontFamily: "inherit", cursor: "pointer",
};

const closeBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: "1px solid #E5E7EB",
  background: "#fff", cursor: "pointer", display: "flex",
  alignItems: "center", justifyContent: "center", color: "#667085",
};
