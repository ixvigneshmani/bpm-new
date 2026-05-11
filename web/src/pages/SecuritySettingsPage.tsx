import { useCallback, useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

type SessionRow = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
};

type EnrollState =
  | { phase: "idle" }
  | { phase: "enrolling"; secret: string; otpauthUrl: string; qrDataUrl: string }
  | { phase: "enabled"; recoveryCodes?: string[] };

export default function SecuritySettingsPage() {
  const { user } = useAuth();

  // ── Change password section ───────────────────────────────────────
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  async function submitPasswordChange(e: FormEvent) {
    e.preventDefault();
    setPwError("");
    setPwSuccess(false);
    if (pwNew !== pwConfirm) {
      setPwError("Confirmation doesn't match the new password.");
      return;
    }
    setPwBusy(true);
    try {
      await apiPost<void>("/auth/password", {
        currentPassword: pwCurrent,
        newPassword: pwNew,
      });
      setPwSuccess(true);
      setPwCurrent("");
      setPwNew("");
      setPwConfirm("");
    } catch (err: any) {
      const msg = err?.message ?? "Failed to change password";
      // class-validator returns an array of messages joined with ","
      setPwError(Array.isArray(msg) ? msg.join(" • ") : String(msg));
    } finally {
      setPwBusy(false);
    }
  }

  // ── MFA section ───────────────────────────────────────────────────
  const [mfa, setMfa] = useState<EnrollState>({ phase: "idle" });
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  // Discover current MFA state from the user's email-based JWT — the API
  // returns user object on login that doesn't include mfaEnabled. We
  // probe by calling /auth/mfa/enroll: if it returns 409, MFA is on.
  const [mfaIsOn, setMfaIsOn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        // GET-able would be cleaner; for now we'll skip the probe and
        // let the user discover state by trying to enroll.
        if (!cancelled) setMfaIsOn(false);
      } catch {
        if (!cancelled) setMfaIsOn(false);
      }
    }
    probe();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startEnroll() {
    setMfaError("");
    setMfaBusy(true);
    try {
      const res = await apiPost<{
        secret: string;
        otpauthUrl: string;
        alreadyEnabled: boolean;
      }>("/auth/mfa/enroll", {});
      const qrDataUrl = await QRCode.toDataURL(res.otpauthUrl, { width: 200 });
      setMfa({
        phase: "enrolling",
        secret: res.secret,
        otpauthUrl: res.otpauthUrl,
        qrDataUrl,
      });
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.toLowerCase().includes("already enabled")) {
        setMfaIsOn(true);
        setMfa({ phase: "enabled" });
      } else {
        setMfaError(msg || "Failed to start enrollment");
      }
    } finally {
      setMfaBusy(false);
    }
  }

  async function verifyEnroll(e: FormEvent) {
    e.preventDefault();
    setMfaError("");
    setMfaBusy(true);
    try {
      const res = await apiPost<{ recoveryCodes: string[] }>(
        "/auth/mfa/verify",
        { code: mfaCode.trim() },
      );
      setMfa({ phase: "enabled", recoveryCodes: res.recoveryCodes });
      setMfaIsOn(true);
      setMfaCode("");
    } catch (err: any) {
      setMfaError(err?.message ?? "Verification failed");
    } finally {
      setMfaBusy(false);
    }
  }

  async function disableMfa(e: FormEvent) {
    e.preventDefault();
    setMfaError("");
    setMfaBusy(true);
    try {
      await apiPost<void>("/auth/mfa/disable", { code: mfaCode.trim() });
      setMfa({ phase: "idle" });
      setMfaIsOn(false);
      setMfaCode("");
    } catch (err: any) {
      setMfaError(err?.message ?? "Failed to disable");
    } finally {
      setMfaBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#101828", marginBottom: 4 }}>
        Security
      </h1>
      <p style={{ fontSize: 14, color: "#667085", marginBottom: 32 }}>
        Manage password and two-factor authentication for {user?.email}.
      </p>

      {/* ── Change password ─────────────────────────────────────────── */}
      <section style={sectionStyle}>
        <h2 style={sectionTitle}>Change password</h2>
        <p style={sectionDesc}>
          At least 8 characters, with a letter and a digit. Changing your
          password signs you out everywhere else.
        </p>

        <form onSubmit={submitPasswordChange} style={{ display: "grid", gap: 12 }}>
          <Field label="Current password" type="password" value={pwCurrent} onChange={setPwCurrent} />
          <Field label="New password" type="password" value={pwNew} onChange={setPwNew} />
          <Field label="Confirm new password" type="password" value={pwConfirm} onChange={setPwConfirm} />

          {pwError && <Banner kind="error">{pwError}</Banner>}
          {pwSuccess && <Banner kind="success">Password updated.</Banner>}

          <button
            type="submit"
            disabled={pwBusy || !pwCurrent || !pwNew || !pwConfirm}
            style={primaryBtn(pwBusy || !pwCurrent || !pwNew || !pwConfirm)}
          >
            {pwBusy ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      {/* ── MFA ─────────────────────────────────────────────────────── */}
      <section style={sectionStyle}>
        <h2 style={sectionTitle}>Two-factor authentication</h2>
        <p style={sectionDesc}>
          Adds a 6-digit code from an authenticator app on top of your
          password. Recommended for any account that can publish processes
          or admin the workspace.
        </p>

        {mfa.phase === "idle" && (
          <>
            <button onClick={startEnroll} disabled={mfaBusy} style={primaryBtn(mfaBusy)}>
              {mfaBusy ? "Starting…" : mfaIsOn ? "Manage MFA" : "Set up two-factor"}
            </button>
            {mfaError && <Banner kind="error">{mfaError}</Banner>}

            {mfaIsOn && (
              <form onSubmit={disableMfa} style={{ marginTop: 20, display: "grid", gap: 12 }}>
                <p style={{ fontSize: 13, color: "#475467" }}>
                  Enter your current 6-digit code or a recovery code to disable
                  two-factor.
                </p>
                <Field label="Code" value={mfaCode} onChange={setMfaCode} placeholder="123456 or recovery code" />
                <button type="submit" disabled={mfaBusy || !mfaCode.trim()} style={dangerBtn(mfaBusy || !mfaCode.trim())}>
                  {mfaBusy ? "Disabling…" : "Disable MFA"}
                </button>
              </form>
            )}
          </>
        )}

        {mfa.phase === "enrolling" && (
          <div>
            <p style={{ fontSize: 13, color: "#475467", marginBottom: 16 }}>
              Scan this QR with Google Authenticator, Authy, 1Password, or any
              TOTP app. Then enter the 6-digit code below to confirm.
            </p>
            <div style={{ display: "flex", gap: 24, alignItems: "flex-start", marginBottom: 20 }}>
              <img
                src={mfa.qrDataUrl}
                alt="MFA QR code"
                width={200}
                height={200}
                style={{ borderRadius: 8, border: "1px solid #EAECF0" }}
              />
              <div style={{ flex: 1, fontSize: 12 }}>
                <div style={{ color: "#667085", marginBottom: 4 }}>
                  Or enter this key manually:
                </div>
                <code
                  style={{
                    display: "block",
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    background: "#F2F4F7",
                    padding: "8px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    wordBreak: "break-all",
                    color: "#101828",
                  }}
                >
                  {mfa.secret}
                </code>
              </div>
            </div>

            <form onSubmit={verifyEnroll} style={{ display: "grid", gap: 12 }}>
              <Field label="Code from your app" value={mfaCode} onChange={setMfaCode} placeholder="123456" autoFocus />
              {mfaError && <Banner kind="error">{mfaError}</Banner>}
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="submit"
                  disabled={mfaBusy || mfaCode.length < 6}
                  style={primaryBtn(mfaBusy || mfaCode.length < 6)}
                >
                  {mfaBusy ? "Verifying…" : "Confirm and enable"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMfa({ phase: "idle" });
                    setMfaCode("");
                  }}
                  style={ghostBtn}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {mfa.phase === "enabled" && mfa.recoveryCodes && (
          <div>
            <Banner kind="success">
              Two-factor authentication is now enabled.
            </Banner>
            <p style={{ fontSize: 14, color: "#101828", marginTop: 16, fontWeight: 600 }}>
              Save these recovery codes
            </p>
            <p style={{ fontSize: 12, color: "#667085", marginBottom: 12 }}>
              Each one works once if you lose access to your authenticator. Store
              them somewhere safe — they won't be shown again.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 6,
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: 13,
                background: "#F2F4F7",
                borderRadius: 8,
                padding: 14,
              }}
            >
              {mfa.recoveryCodes.map((c) => (
                <code key={c} style={{ color: "#101828" }}>
                  {c}
                </code>
              ))}
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(mfa.recoveryCodes!.join("\n"));
              }}
              style={{ marginTop: 12, ...ghostBtn }}
            >
              Copy all
            </button>
            <button
              onClick={() => setMfa({ phase: "idle" })}
              style={{ marginTop: 8, ...primaryBtn(false) }}
            >
              Done
            </button>
          </div>
        )}
      </section>

      <SessionsSection />
    </div>
  );
}

// ── Active sessions section ────────────────────────────────────────

function SessionsSection() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await apiGet<{ sessions: SessionRow[] }>("/auth/sessions");
      setSessions(res.sessions);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load sessions");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await apiDelete<void>(`/auth/sessions/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Failed to revoke");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitle}>Active sessions</h2>
      <p style={sectionDesc}>
        Each device or browser you've signed in from. Revoke any session you
        don't recognise — that device will be signed out the next time it
        tries to use the API.
      </p>

      {error && <Banner kind="error">{error}</Banner>}

      {sessions === null ? (
        <p style={{ fontSize: 13, color: "#667085" }}>Loading…</p>
      ) : sessions.length === 0 ? (
        <p style={{ fontSize: 13, color: "#667085" }}>No active sessions.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {sessions.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                padding: 12,
                background: "#F9FAFB",
                border: "1px solid #EAECF0",
                borderRadius: 8,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#101828", marginBottom: 2 }}>
                  {summariseUserAgent(s.userAgent)}
                </div>
                <div style={{ fontSize: 12, color: "#667085" }}>
                  IP {s.ipAddress ?? "—"} • signed in {formatRelative(s.createdAt)} •
                  {" "}expires {formatRelative(s.expiresAt)}
                </div>
              </div>
              <button
                onClick={() => revoke(s.id)}
                disabled={busyId === s.id}
                style={{
                  padding: "6px 12px",
                  background: "#fff",
                  border: "1px solid #FECDCA",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#B42318",
                  cursor: busyId === s.id ? "wait" : "pointer",
                  flexShrink: 0,
                }}
              >
                {busyId === s.id ? "Revoking…" : "Revoke"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function summariseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  // Tiny heuristic — enough to distinguish "the iPad in the kitchen"
  // from "the Mac at work" without dragging in a UA parser.
  const browser = ua.match(/Edg\/|Chrome\/|Firefox\/|Safari\//)?.[0]?.replace("/", "") ?? "Browser";
  const os = ua.match(/Mac OS X|Windows NT|Android|iPhone|iPad|Linux/)?.[0] ?? "OS";
  return `${browser} on ${os}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const future = diff > 0;
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  if (minutes < 1) return future ? "in a moment" : "just now";
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  if (hours < 48) return future ? `in ${hours}h` : `${hours}h ago`;
  return future ? `in ${days}d` : `${days}d ago`;
}

// ── Tiny UI helpers (inline so this page stays self-contained) ─────

const sectionStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #EAECF0",
  borderRadius: 12,
  padding: "24px 24px",
  marginBottom: 24,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: "#101828",
  marginBottom: 4,
};
const sectionDesc: React.CSSProperties = {
  fontSize: 13,
  color: "#667085",
  marginBottom: 16,
};
const ghostBtn: React.CSSProperties = {
  padding: "10px 16px",
  background: "#fff",
  border: "1px solid #EAECF0",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  color: "#344054",
  cursor: "pointer",
};
function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    background: disabled ? "#A5B4FC" : "linear-gradient(135deg,#4F46E5,#6366F1)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    justifySelf: "start",
  };
}
function dangerBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    background: disabled ? "#FDA29B" : "#D92D20",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    justifySelf: "start",
  };
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#344054", marginBottom: 6 }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{
          width: "100%",
          padding: "10px 12px",
          background: "#F9FAFB",
          border: "1.5px solid #EAECF0",
          borderRadius: 8,
          fontSize: 14,
          color: "#101828",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </label>
  );
}

function Banner({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  const error = kind === "error";
  return (
    <div
      style={{
        padding: "10px 14px",
        background: error ? "#FEF3F2" : "#ECFDF5",
        border: `1px solid ${error ? "#FECDCA" : "#A7F3D0"}`,
        borderRadius: 8,
        fontSize: 13,
        color: error ? "#B42318" : "#065F46",
      }}
    >
      {children}
    </div>
  );
}
