import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "./api";

type User = {
  id: string;
  email: string;
  displayName: string;
  /** Platform access level — owner/admin/member/viewer. */
  systemRole: string;
  /** Domain role keys, e.g. ["manager"]. */
  roles: string[];
  tenantId: string;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem("flowpro_user");
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      // Old payload shape (pre-R1) had `role` only. Force re-login so
      // the new systemRole/roles fields are populated from /auth/login.
      if (!parsed?.systemRole || !Array.isArray(parsed.roles)) {
        localStorage.removeItem("flowpro_user");
        localStorage.removeItem("flowpro_token");
        return null;
      }
      return parsed;
    } catch {
      localStorage.removeItem("flowpro_user");
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  async function login(email: string, password: string) {
    setLoading(true);
    try {
      const res = await apiPost<{ accessToken: string; user: User }>(
        "/auth/login",
        { email, password },
      );
      localStorage.setItem("flowpro_token", res.accessToken);
      localStorage.setItem("flowpro_user", JSON.stringify(res.user));
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("flowpro_token");
    localStorage.removeItem("flowpro_user");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
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
