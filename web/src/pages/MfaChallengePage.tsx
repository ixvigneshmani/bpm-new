import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function MfaChallengePage() {
  const { user, loading, completeMfaLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const challenge = (location.state as { challenge?: string } | null)?.challenge;

  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) navigate("/home", { replace: true });
  }, [user, navigate]);

  // If we somehow landed here without a challenge (refresh, deep link),
  // bounce back to /login.
  useEffect(() => {
    if (!challenge) navigate("/login", { replace: true });
  }, [challenge, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError("");
    try {
      await completeMfaLogin(challenge, code.trim());
    } catch (err: any) {
      setError(err.message || "MFA verification failed");
    }
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        alignItems: "center",
        justifyContent: "center",
        background: "#F9FAFB",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          padding: "40px 36px",
          borderRadius: 16,
          boxShadow: "0 4px 24px rgba(15,23,42,0.06)",
          width: "100%",
          maxWidth: 380,
        }}
      >
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#101828",
            marginBottom: 6,
          }}
        >
          Two-factor authentication
        </h1>
        <p style={{ fontSize: 14, color: "#667085", lineHeight: 1.5, marginBottom: 24 }}>
          Enter the 6-digit code from your authenticator app, or a single-use
          recovery code.
        </p>

        {error && (
          <div
            style={{
              padding: "10px 14px",
              marginBottom: 16,
              background: "#FEF3F2",
              border: "1px solid #FECDCA",
              borderRadius: 8,
              fontSize: 13,
              color: "#B42318",
            }}
          >
            {error}
          </div>
        )}

        <label
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            color: "#344054",
            marginBottom: 6,
          }}
        >
          Verification code
        </label>
        <input
          type="text"
          inputMode="text"
          autoFocus
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456 or recovery code"
          style={{
            width: "100%",
            padding: "12px 14px",
            background: "#F9FAFB",
            border: "1.5px solid #EAECF0",
            borderRadius: 10,
            fontSize: 15,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.04em",
            color: "#101828",
            outline: "none",
            boxSizing: "border-box",
          }}
        />

        <button
          type="submit"
          disabled={loading || !code.trim()}
          style={{
            width: "100%",
            padding: "12px 18px",
            marginTop: 20,
            background:
              loading || !code.trim()
                ? "#A5B4FC"
                : "linear-gradient(135deg,#4F46E5,#6366F1)",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 600,
            cursor: loading || !code.trim() ? "not-allowed" : "pointer",
            boxShadow: "0 4px 12px rgba(79,70,229,0.25)",
          }}
        >
          {loading ? "Verifying…" : "Verify"}
        </button>

        <button
          type="button"
          onClick={() => navigate("/login", { replace: true })}
          style={{
            width: "100%",
            padding: "10px",
            marginTop: 12,
            background: "transparent",
            border: "none",
            color: "#667085",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Cancel and sign in as a different user
        </button>
      </form>
    </div>
  );
}
