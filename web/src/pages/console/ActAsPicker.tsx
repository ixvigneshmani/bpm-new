/* ─── Act-as picker (Feature D) ────────────────────────────────────────
 * Admin-only dialog: pick a user in the tenant to impersonate. Stores
 * the resolved target in localStorage; all subsequent API calls carry
 * X-Acting-For automatically via lib/api.ts.
 * ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";
import { useActingFor } from "../../lib/acting-for";
import { useAuth } from "../../lib/auth";

type TenantUser = {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  systemRole: string;
  roles: string[];
};

export default function ActAsPicker(props: { onClose: () => void }) {
  const { setTarget } = useActingFor();
  const { user: self } = useAuth();
  const [rows, setRows] = useState<TenantUser[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiGet<TenantUser[]>("/users")
      .then((r) => { if (alive) setRows(r.filter((u) => u.id !== self?.id)); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [self?.id]);

  const filtered = rows.filter((u) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q) || u.roles.some((r) => r.toLowerCase().includes(q));
  });

  const pick = (u: TenantUser) => {
    if (!u.isActive) return;
    setTarget({ userId: u.id, email: u.email, displayName: u.displayName, roles: u.roles });
    props.onClose();
  };

  return (
    <>
      <div onClick={props.onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 60 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 480, background: "#fff",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", zIndex: 70,
      }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EAECF0" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#101828" }}>Act as another user</div>
          <div style={{ fontSize: 12, color: "#667085", marginTop: 2 }}>
            Every action you take will be attributed to the target user. Every audit row also records you as <code>actingBy</code>.
          </div>
        </div>

        <div style={{ padding: 14, borderBottom: "1px solid #EAECF0" }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by name, email, or role…"
            autoFocus
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #E5E7EB",
              fontSize: 13, outline: "none",
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <div style={{ padding: 24, color: "#98A2B3", fontSize: 13 }}>Loading…</div>}
          {error && <div style={{ margin: 16, padding: 12, border: "1px solid #FECACA", background: "#FEF2F2", color: "#B42318", fontSize: 13, borderRadius: 8 }}>{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 24, color: "#98A2B3", fontSize: 13 }}>No matches.</div>
          )}
          {filtered.map((u) => (
            <button key={u.id} onClick={() => pick(u)}
              disabled={!u.isActive}
              style={{
                display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 10,
                width: "100%", padding: "12px 18px", border: "none", borderBottom: "1px solid #F2F4F7",
                background: "#fff", textAlign: "left",
                cursor: u.isActive ? "pointer" : "not-allowed", opacity: u.isActive ? 1 : 0.5,
                fontFamily: "inherit",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#101828" }}>{u.displayName}</div>
                <div style={{ fontSize: 12, color: "#667085" }}>{u.email}</div>
                <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={pill("#EEF2FF", "#4F46E5")}>{u.systemRole}</span>
                  {u.roles.map((r) => <span key={r} style={pill("#FEF3C7", "#92400E")}>{r}</span>)}
                  {!u.isActive && <span style={pill("#F2F4F7", "#667085")}>inactive</span>}
                </div>
              </div>
              <span style={{ color: "#4F46E5", fontSize: 13, fontWeight: 600 }}>Act as →</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function pill(bg: string, fg: string): React.CSSProperties {
  return { padding: "2px 8px", borderRadius: 9999, background: bg, color: fg, fontSize: 10, fontWeight: 600 };
}
