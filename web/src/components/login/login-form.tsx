import { useState, type FormEvent } from "react";
import { useAuth } from "../../lib/auth";

export default function LoginForm() {
  const { login, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [focusedField, setFocusedField] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || "Login failed");
    }
  }

  const inputWrapperStyle = (field: string): React.CSSProperties => ({
    position: "relative",
    display: "flex",
    alignItems: "center",
    background: focusedField === field ? "#fff" : "#F9FAFB",
    border: `1.5px solid ${focusedField === field ? "#6366F1" : "#EAECF0"}`,
    borderRadius: 10,
    transition: "all 0.2s ease",
    boxShadow: focusedField === field ? "0 0 0 3px rgba(99,102,241,0.1)" : "none",
  });

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: "12px 14px",
    background: "transparent",
    border: "none",
    fontFamily: "inherit",
    fontSize: 14,
    color: "#101828",
    outline: "none",
  };

  const iconStyle = (field: string): React.CSSProperties => ({
    marginLeft: 14,
    flexShrink: 0,
    color: focusedField === field ? "#6366F1" : "#98A2B3",
    transition: "color 0.2s ease",
  });

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle background pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(99,102,241,0.03) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Top right decoration */}
      <div
        style={{
          position: "absolute",
          top: -120,
          right: -120,
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)",
        }}
      />

      {/* Header */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          justifyContent: "flex-end",
          padding: "24px 32px",
        }}
      >
        <span style={{ fontSize: 13, color: "#667085" }}>
          Need an account?{" "}
          <a
            style={{
              color: "#4F46E5",
              fontWeight: 600,
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            Request access
          </a>
        </span>
      </div>

      {/* Form area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 48px 48px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{
            width: "100%",
            maxWidth: 400,
            animation: "form-in 0.6s cubic-bezier(0.16,1,0.3,1) both",
          }}
        >
          {/* Logo */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 32,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "linear-gradient(135deg, #6366F1, #818CF8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 12px rgba(99,102,241,0.25)",
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M9 11l3 3L22 4" />
              </svg>
            </div>
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#101828",
                letterSpacing: "-0.02em",
              }}
            >
              FlowPro
            </span>
          </div>

          {/* Heading */}
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: "#101828",
              lineHeight: 1.2,
            }}
          >
            Welcome back
          </h1>
          <p
            style={{
              fontSize: 15,
              color: "#667085",
              marginTop: 8,
              marginBottom: 32,
              lineHeight: 1.5,
            }}
          >
            Sign in to your workspace to continue
          </p>

          {/* Error */}
          {error && (
            <div
              style={{
                padding: "12px 16px",
                marginBottom: 20,
                background: "linear-gradient(135deg, #FEF3F2, #FFF1F0)",
                border: "1px solid #FECDCA",
                borderRadius: 10,
                fontSize: 13,
                color: "#B42318",
                display: "flex",
                alignItems: "center",
                gap: 10,
                animation: "form-in 0.3s ease both",
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#FEE4E2",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#F04438"
                  strokeWidth="2.5"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              {error}
            </div>
          )}

          {/* Email */}
          <div style={{ marginBottom: 18 }}>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#344054",
                marginBottom: 6,
                letterSpacing: "0.01em",
              }}
            >
              Email address
            </label>
            <div style={inputWrapperStyle("email")}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={iconStyle("email")}
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M22 7l-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" />
              </svg>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
                placeholder="name@company.com"
                required
                style={inputStyle}
              />
            </div>
          </div>

          {/* Password */}
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#344054",
                  letterSpacing: "0.01em",
                }}
              >
                Password
              </label>
              <a
                style={{
                  fontSize: 13,
                  color: "#6366F1",
                  textDecoration: "none",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Forgot?
              </a>
            </div>
            <div style={inputWrapperStyle("password")}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={iconStyle("password")}
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
                placeholder="Enter your password"
                required
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0 14px 0 0",
                  color: "#98A2B3",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {showPassword ? (
                    <>
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </>
                  ) : (
                    <>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </svg>
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px 18px",
              marginTop: 24,
              background: loading
                ? "#A5B4FC"
                : "linear-gradient(135deg, #4F46E5, #6366F1)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontFamily: "inherit",
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: "0 4px 12px rgba(79,70,229,0.3)",
              transition: "all 0.2s ease",
              letterSpacing: "0.01em",
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.boxShadow =
                  "0 6px 20px rgba(79,70,229,0.4)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow =
                "0 4px 12px rgba(79,70,229,0.3)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            {loading ? (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
                Signing in...
              </span>
            ) : (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                Sign in
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </span>
            )}
          </button>

        </form>
      </div>

      {/* Footer */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "16px 32px",
          display: "flex",
          justifyContent: "center",
          gap: 24,
        }}
      >
        <span style={{ fontSize: 12, color: "#98A2B3" }}>
          © 2026 FlowPro
        </span>
        <a style={{ fontSize: 12, color: "#98A2B3", textDecoration: "none", cursor: "pointer" }}>
          Privacy
        </a>
        <a style={{ fontSize: 12, color: "#98A2B3", textDecoration: "none", cursor: "pointer" }}>
          Terms
        </a>
      </div>
    </div>
  );
}
