import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

type GranteeType = "user" | "role";
type Permission = "view" | "start" | "edit" | "publish" | "admin";

interface Grant {
  id: string;
  granteeType: GranteeType;
  granteeId: string;
  permission: Permission;
  grantedAt: string;
}

interface TenantUser {
  id: string;
  email: string;
  displayName: string;
}

interface TenantRole {
  id: string;
  key: string;
  label: string;
}

interface ProcessMeta {
  id: string;
  name: string;
}

const PERMISSIONS: Permission[] = ["view", "start", "edit", "publish", "admin"];

const PERM_HELP: Record<Permission, string> = {
  view: "Can see the process and open it in the designer.",
  start: "Can start new instances against the published version.",
  edit: "Can modify canvas, business doc, and process details (implies view).",
  publish: "Can publish a new version (implies edit + view).",
  admin: "Full control including deletion and granting permissions (implies all).",
};

export default function ProcessPermissionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [process, setProcess] = useState<ProcessMeta | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [granteeType, setGranteeType] = useState<GranteeType>("user");
  const [granteeId, setGranteeId] = useState("");
  const [permission, setPermission] = useState<Permission>("view");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [proc, grantsRes, usersRes, rolesRes] = await Promise.all([
          apiGet<ProcessMeta>(`/processes/${id}`),
          apiGet<Grant[]>(`/processes/${id}/permissions`),
          apiGet<TenantUser[]>(`/users`).catch(() => [] as TenantUser[]),
          apiGet<TenantRole[]>(`/roles`).catch(() => [] as TenantRole[]),
        ]);
        if (cancelled) return;
        setProcess(proc);
        setGrants(grantsRes);
        setUsers(usersRes);
        setRoles(rolesRes);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const isAdminLike =
    user?.systemRole === "owner" || user?.systemRole === "admin";

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !granteeId) return;
    setSubmitting(true);
    setError(null);
    try {
      const row = await apiPost<Grant>(`/processes/${id}/permissions`, {
        granteeType,
        granteeId,
        permission,
      });
      setGrants((prev) => [...prev, row]);
      setGranteeId("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (grantId: string) => {
    if (!id) return;
    if (!window.confirm("Revoke this grant?")) return;
    try {
      await apiDelete(`/processes/${id}/permissions/${grantId}`);
      setGrants((prev) => prev.filter((g) => g.id !== grantId));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const granteeLabel = (g: Grant): string => {
    if (g.granteeType === "user") {
      const u = users.find((x) => x.id === g.granteeId);
      return u ? `${u.displayName} (${u.email})` : g.granteeId;
    }
    const r = roles.find((x) => x.key === g.granteeId);
    return r ? `Role: ${r.label}` : `Role: ${g.granteeId}`;
  };

  if (loading) {
    return <div style={{ padding: 32, color: "#6B7280" }}>Loading…</div>;
  }

  if (!process) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: "#B91C1C", marginBottom: 12 }}>
          {error || "Process not found."}
        </div>
        <button onClick={() => navigate(-1)} style={btnSecondary}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 32px", maxWidth: 920, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => navigate(`/designer/${id}`)}
          style={{ ...btnSecondary, marginBottom: 12 }}
        >
          ← Back to designer
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "#111827", margin: 0 }}>
          Permissions — {process.name}
        </h1>
        <p style={{ fontSize: 13, color: "#6B7280", marginTop: 6 }}>
          Grant specific users or domain roles access to this process. Owners
          and admins always have full access; this page lets you delegate
          access to other members.
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 6,
            color: "#B91C1C",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {!isAdminLike && (
        <div
          style={{
            padding: "10px 14px",
            background: "#FFFBEB",
            border: "1px solid #FDE68A",
            borderRadius: 6,
            color: "#92400E",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          You do not have admin permission on this process. The form below
          will be rejected by the server.
        </div>
      )}

      {/* Grant form */}
      <section style={card}>
        <h2 style={cardTitle}>Grant access</h2>
        <form
          onSubmit={handleGrant}
          style={{ display: "grid", gridTemplateColumns: "120px 1fr 140px auto", gap: 10, alignItems: "end" }}
        >
          <div>
            <label style={lblStyle}>Type</label>
            <select
              value={granteeType}
              onChange={(e) => {
                setGranteeType(e.target.value as GranteeType);
                setGranteeId("");
              }}
              style={inputStyle}
            >
              <option value="user">User</option>
              <option value="role">Role</option>
            </select>
          </div>
          <div>
            <label style={lblStyle}>
              {granteeType === "user" ? "User" : "Role"}
            </label>
            <select
              value={granteeId}
              onChange={(e) => setGranteeId(e.target.value)}
              style={inputStyle}
              required
            >
              <option value="">— select —</option>
              {granteeType === "user"
                ? users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName} ({u.email})
                    </option>
                  ))
                : roles.map((r) => (
                    <option key={r.id} value={r.key}>
                      {r.label} ({r.key})
                    </option>
                  ))}
            </select>
          </div>
          <div>
            <label style={lblStyle}>Permission</label>
            <select
              value={permission}
              onChange={(e) => setPermission(e.target.value as Permission)}
              style={inputStyle}
              title={PERM_HELP[permission]}
            >
              {PERMISSIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={submitting || !granteeId}
            style={{
              ...btnPrimary,
              opacity: submitting || !granteeId ? 0.6 : 1,
              cursor: submitting || !granteeId ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Granting…" : "Grant"}
          </button>
        </form>
        <p style={{ fontSize: 11, color: "#6B7280", marginTop: 10, marginBottom: 0 }}>
          {PERM_HELP[permission]}
        </p>
      </section>

      {/* Grant list */}
      <section style={{ ...card, marginTop: 20 }}>
        <h2 style={cardTitle}>Current grants ({grants.length})</h2>
        {grants.length === 0 ? (
          <div style={{ fontSize: 13, color: "#6B7280", padding: "8px 0" }}>
            No explicit grants. View + start are open to all tenant members
            by default; edit / publish / admin require either a system-role
            admin or an explicit grant.
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", color: "#6B7280" }}>
                <th style={thStyle}>Grantee</th>
                <th style={thStyle}>Permission</th>
                <th style={thStyle}>Granted</th>
                <th style={{ ...thStyle, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                  <td style={tdStyle}>{granteeLabel(g)}</td>
                  <td style={tdStyle}>
                    <span style={permBadge}>{g.permission}</span>
                  </td>
                  <td style={{ ...tdStyle, color: "#6B7280" }}>
                    {new Date(g.grantedAt).toLocaleDateString()}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <button
                      onClick={() => handleRevoke(g.id)}
                      style={btnDanger}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div
        style={{
          marginTop: 20,
          fontSize: 12,
          color: "#6B7280",
          padding: 12,
          background: "#F9FAFB",
          borderRadius: 6,
        }}
      >
        <strong style={{ color: "#374151" }}>How this works:</strong> Owners
        and admins always have full access regardless of grants. For other
        members, a process with <em>no</em> grants is open to view and start;
        once any grant exists, only listed grantees + admins can access it.
        Permission hierarchy: admin ⊃ publish ⊃ edit ⊃ view. <code>start</code>{" "}
        is orthogonal.
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E5E7EB",
  borderRadius: 8,
  padding: "16px 20px",
};

const cardTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#111827",
  margin: "0 0 14px 0",
};

const lblStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 500,
  color: "#6B7280",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  fontSize: 13,
  background: "#fff",
};

const btnPrimary: React.CSSProperties = {
  padding: "7px 14px",
  border: "1px solid #4F46E5",
  background: "#4F46E5",
  color: "#fff",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 12px",
  border: "1px solid #E5E7EB",
  background: "#fff",
  color: "#374151",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  padding: "4px 10px",
  border: "1px solid #FCA5A5",
  background: "#fff",
  color: "#B91C1C",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
};

const thStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontWeight: 500,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const tdStyle: React.CSSProperties = {
  padding: "10px 8px",
  color: "#374151",
};

const permBadge: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 10,
  background: "#EEF2FF",
  color: "#4338CA",
  fontSize: 11,
  fontWeight: 600,
  fontFamily: "monospace",
};
