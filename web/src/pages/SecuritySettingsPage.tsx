import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

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
    </div>
  );
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
