import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

type User = {
  id: string;
  email: string;
  displayName: string;
  /** Platform access level — owner/admin/member/viewer. */
  systemRole: string;
  /** Domain role keys, e.g. ["manager"]. */
  roles: string[];
  tenantId: string;
  /** Human-readable tenant name from TENANTS.NAME, served by /auth/login.
   *  Null if the row is unexpectedly missing. */
  tenantName: string | null;
};

type LoginSuccess =
  | { kind: "ok"; user: User }
  | { kind: "mfa"; challenge: string };

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginSuccess>;
  completeMfaLogin: (challenge: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Force the AuthProvider to re-read user from localStorage after
   *  a security-sensitive change (e.g. enrolling MFA, changing password). */
  reloadUser: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = "flowpro_token";
const REFRESH_KEY = "flowpro_refresh";
const USER_KEY = "flowpro_user";

function persistTokens(accessToken: string, refreshToken: string, user: User) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

async function rawPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStoredUser());
  const [loading, setLoading] = useState(false);

  function readStoredUser(): User | null {
    try {
      const stored = localStorage.getItem(USER_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (!parsed?.systemRole || !Array.isArray(parsed.roles)) {
        clearTokens();
        return null;
      }
      // tenantName was added 2026-05-11. Old localStorage entries
      // predate it; default to null rather than forcing a re-login.
      if (parsed.tenantName === undefined) parsed.tenantName = null;
      return parsed;
    } catch {
      clearTokens();
      return null;
    }
  }

  async function login(email: string, password: string): Promise<LoginSuccess> {
    setLoading(true);
    try {
      const res = await rawPost<
        | { accessToken: string; refreshToken: string; user: User }
        | { mfaChallenge: string; expiresIn: number }
      >("/auth/login", { email, password });
      if ("mfaChallenge" in res) {
        return { kind: "mfa", challenge: res.mfaChallenge };
      }
      persistTokens(res.accessToken, res.refreshToken, res.user);
      setUser(res.user);
      return { kind: "ok", user: res.user };
    } finally {
      setLoading(false);
    }
  }

  async function completeMfaLogin(challenge: string, code: string): Promise<void> {
    setLoading(true);
    try {
      const res = await rawPost<{
        accessToken: string;
        refreshToken: string;
        user: User;
      }>("/auth/mfa/login", { mfaChallenge: challenge, code });
      persistTokens(res.accessToken, res.refreshToken, res.user);
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  }

  async function logout(): Promise<void> {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (refreshToken) {
      try {
        await rawPost<void>("/auth/logout", { refreshToken });
      } catch {
        // Best-effort. Even if the server-side revoke fails (network
        // down, token already revoked), still clear local state.
      }
    }
    clearTokens();
    setUser(null);
  }

  function reloadUser() {
    setUser(readStoredUser());
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, completeMfaLogin, logout, reloadUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate("/login", { replace: true });
    }
  }, [user, navigate]);

  if (!user) return null;
  return <>{children}</>;
}
