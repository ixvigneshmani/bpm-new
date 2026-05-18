/* ─── Assignment Section ──────────────────────────────────────────────
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import type { Assignment, AssignmentType } from "../../../../types/bpmn-node-data";
import { apiGet } from "../../../../lib/api";
import useCanvasStore from "../../../../store/canvas-store";
import FeelExpressionInput from "../fields/FeelExpressionInput";

type Props = {
  assignment: Assignment | undefined;
  onChange: (assignment: Assignment) => void;
};

type RoleRow = { id: string; key: string; label: string };
type UserRow = { id: string; email: string; displayName: string; isActive: boolean };

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color: "#98a2b3", marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10,
  border: "1px solid #e5e7eb", fontSize: 13, color: "#111827",
  fontFamily: "inherit", outline: "none", background: "#fff",
  lineHeight: "1.5",
};

const ASSIGNMENT_TYPES: { type: AssignmentType; label: string; desc: string; icon: string }[] = [
  { type: "directUser", label: "Direct User", desc: "Assign to a specific person", icon: "👤" },
  { type: "role", label: "Role", desc: "Claim-first queue for a role", icon: "👥" },
  { type: "expression", label: "Expression", desc: "Dynamic via FEEL expression", icon: "fx" },
];

/** Module-scoped cache — roles rarely change and the properties panel
 *  is re-mounted often (node-select churn). Lightweight in-memory cache
 *  across mounts avoids repeated /roles fetches in the same session. */
let rolesCache: RoleRow[] | null = null;

/** Sweep-B cleanup #3 — users are fetched per-search-term so we don't
 *  hold thousands of users in memory at large tenants. Cache the
 *  (processId, searchTerm) tuple so re-opening the panel for the same
 *  task doesn't re-fetch. */
const usersCache = new Map<string, UserRow[]>();
const usersCacheKey = (processId: string, search: string) => `${processId}::${search}`;

export default function AssignmentSection({ assignment, onChange }: Props) {
  const processId = useCanvasStore((s) => s.processId);
  const currentType: AssignmentType = assignment?.type === "role" || assignment?.type === "expression"
    ? assignment.type
    : "directUser";

  const [roles, setRoles] = useState<RoleRow[]>(rolesCache ?? []);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [rolesLoading, setRolesLoading] = useState(false);

  const [users, setUsers] = useState<UserRow[]>(() => {
    if (!processId) return [];
    return usersCache.get(usersCacheKey(processId, "")) ?? [];
  });
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  useEffect(() => {
    if (rolesCache) return;
    let cancelled = false;
    setRolesLoading(true);
    apiGet<RoleRow[]>("/roles")
      .then((data) => {
        if (cancelled) return;
        rolesCache = data;
        setRoles(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setRolesError(err?.message ?? "Failed to load roles");
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!processId) return;
    const trimmed = userSearch.trim();
    const cacheKey = usersCacheKey(processId, trimmed);
    const hit = usersCache.get(cacheKey);
    if (hit) {
      setUsers(hit);
      return;
    }
    let cancelled = false;
    setUsersLoading(true);
    setUsersError(null);
    // Debounce keystrokes so the API isn't hit on every character.
    const debounce = trimmed.length === 0 ? 0 : 220;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: "50" });
      if (trimmed) params.set("search", trimmed);
      apiGet<UserRow[]>(`/users/assignable/${processId}?${params.toString()}`)
        .then((data) => {
          if (cancelled) return;
          usersCache.set(cacheKey, data);
          setUsers(data);
        })
        .catch((err) => {
          if (cancelled) return;
          setUsersError(err?.message ?? "Failed to load users");
        })
        .finally(() => {
          if (!cancelled) setUsersLoading(false);
        });
    }, debounce);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [processId, userSearch]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Assignment type cards */}
      <div>
        <div style={labelStyle}>Assign To</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {ASSIGNMENT_TYPES.map((at) => {
            const active = currentType === at.type;
            return (
              <button
                key={at.type}
                type="button"
                onClick={() => onChange({ type: at.type, value: assignment?.type === at.type ? (assignment?.value ?? "") : "" })}
                style={{
                  padding: "10px 12px", borderRadius: 10, textAlign: "left",
                  border: `1.5px solid ${active ? "#818cf8" : "#e5e7eb"}`,
                  background: active ? "#eef2ff" : "#fff",
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 14 }}>{at.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: active ? "#4f46e5" : "#344054" }}>
                    {at.label}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#98a2b3" }}>{at.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Value input */}
      {currentType === "directUser" && (
        <div>
          <div style={labelStyle}>User</div>
          {usersError ? (
            <>
              <div style={{ fontSize: 12, color: "#b42318", padding: "8px 12px", background: "#fef3f2", border: "1px solid #fecdca", borderRadius: 8, marginBottom: 8 }}>
                {usersError}
              </div>
              <input
                type="text"
                value={assignment?.value || ""}
                onChange={(e) => onChange({ type: "directUser", value: e.target.value })}
                style={inputStyle}
                placeholder="User ID (uuid)"
              />
            </>
          ) : (
            <>
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search by name or email…"
                style={{ ...inputStyle, marginBottom: 6 }}
              />
              <select
                value={assignment?.value || ""}
                onChange={(e) => onChange({ type: "directUser", value: e.target.value })}
                style={{ ...inputStyle, cursor: "pointer" }}
                disabled={usersLoading}
              >
                <option value="" disabled>
                  {usersLoading ? "Loading users…" : users.length === 0 ? "No matches" : "Select a user…"}
                </option>
                {/* Preserve any pre-existing uuid that isn't in the current list
                    (e.g. user removed from tenant or filtered out by search). */}
                {assignment?.value &&
                  !users.some((u) => u.id === assignment.value) && (
                    <option value={assignment.value}>
                      {assignment.value} (not in current results)
                    </option>
                  )}
                {users.map((u) => (
                  <option key={u.id} value={u.id} disabled={!u.isActive}>
                    {u.displayName} ({u.email}){!u.isActive ? " — inactive" : ""}
                  </option>
                ))}
              </select>
              {users.length === 50 && (
                <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 4 }}>
                  Showing first 50 — refine the search if you don't see the right user.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {currentType === "role" && (
        <div>
          <div style={labelStyle}>Role</div>
          {rolesError ? (
            <div style={{ fontSize: 12, color: "#b42318", padding: "8px 12px", background: "#fef3f2", border: "1px solid #fecdca", borderRadius: 8 }}>
              {rolesError}
            </div>
          ) : (
            <select
              value={assignment?.value || ""}
              onChange={(e) => onChange({ type: "role", value: e.target.value })}
              style={{ ...inputStyle, cursor: "pointer" }}
              disabled={rolesLoading}
            >
              <option value="" disabled>
                {rolesLoading ? "Loading roles…" : "Select a role…"}
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.key}>
                  {r.label} ({r.key})
                </option>
              ))}
            </select>
          )}
          <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 6, lineHeight: 1.5 }}>
            Any user with this role can claim the task. Only the claimant can complete it.
          </div>
        </div>
      )}

      {currentType === "expression" && (
        <FeelExpressionInput
          label="Assignee Expression"
          value={assignment?.value || ""}
          onChange={(v) => onChange({ type: "expression", value: v })}
          placeholder="${managerId}"
          mode="variable-ref"
        />
      )}
    </div>
  );
}
