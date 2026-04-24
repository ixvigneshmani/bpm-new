/* ─── Act-as impersonation state (Feature D) ──────────────────────────
 * An admin/owner can impersonate another user in their tenant. While
 * an Act-as session is active:
 *   • Every API call carries `X-Acting-For: <userId>` (api.ts).
 *   • A persistent amber banner is shown app-wide.
 *   • Actions like claim/complete/cancel apply to the target user.
 *
 * Storage: `flowpro_acting_for` in localStorage holds
 * {userId, email, displayName, roles} — the resolved target profile.
 * ──────────────────────────────────────────────────────────────────── */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type ActingTarget = {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
};

type Ctx = {
  target: ActingTarget | null;
  setTarget: (t: ActingTarget | null) => void;
};

const ActingForContext = createContext<Ctx | null>(null);

function read(): ActingTarget | null {
  try {
    const raw = localStorage.getItem("flowpro_acting_for");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.userId || !Array.isArray(parsed?.roles)) return null;
    return parsed as ActingTarget;
  } catch {
    localStorage.removeItem("flowpro_acting_for");
    return null;
  }
}

export function ActingForProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<ActingTarget | null>(() => read());

  const setTarget = useCallback((t: ActingTarget | null) => {
    if (t) localStorage.setItem("flowpro_acting_for", JSON.stringify(t));
    else localStorage.removeItem("flowpro_acting_for");
    setTargetState(t);
  }, []);

  // Cross-tab sync — if another tab exits/enters impersonation, we
  // reflect it so the banner and API headers stay consistent.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "flowpro_acting_for") setTargetState(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return <ActingForContext.Provider value={{ target, setTarget }}>{children}</ActingForContext.Provider>;
}

export function useActingFor() {
  const ctx = useContext(ActingForContext);
  if (!ctx) throw new Error("useActingFor must be inside ActingForProvider");
  return ctx;
}

/** Capture the CURRENT impersonation target at mount-time and hold it
 *  fixed for the lifetime of the component. Dialogs that submit
 *  state-changing requests should call this so a switch in another
 *  tab / via the banner doesn't silently re-attribute the in-flight
 *  submission (reviewer-flagged bug from Feature D).
 *
 *  Returns the target `userId` or `null` — pass to `apiPost(..., {
 *  actingForOverride: snapshot })` and the value stays frozen. */
export function useActingForSnapshot(): string | null {
  const { target } = useActingFor();
  const snapshot = useRef<string | null>(target?.userId ?? null);
  // Only set on the very first render — subsequent target changes in
  // the context do NOT update the ref.
  return snapshot.current;
}

export function ActingForBanner() {
  const { target, setTarget } = useActingFor();
  if (!target) return null;
  return (
    <div
      role="alert"
      style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "linear-gradient(90deg, #F59E0B, #D97706)",
        color: "#fff", padding: "8px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: "0 2px 6px rgba(0,0,0,0.12)", fontSize: 13, fontWeight: 600,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true">⚠</span>
        <span>
          Acting as <strong>{target.displayName}</strong> &lt;{target.email}&gt;
          {target.roles.length > 0 && (
            <span style={{ opacity: 0.85, marginLeft: 8, fontWeight: 500 }}>
              roles: {target.roles.join(", ")}
            </span>
          )}
        </span>
      </div>
      <button
        onClick={() => setTarget(null)}
        style={{
          background: "rgba(255,255,255,0.18)", color: "#fff",
          border: "1px solid rgba(255,255,255,0.4)", padding: "4px 12px",
          borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}
      >
        Exit Act-as
      </button>
    </div>
  );
}
