import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPost, apiPut } from "../lib/api";
import { useAuth } from "../lib/auth";

type MailSettings = {
  tenantId: string;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  passwordSet: boolean;
  fromEmail: string;
  fromName: string | null;
  enabled: boolean;
  updatedAt: string;
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #EAECF0",
  borderRadius: 12,
  padding: 24,
  marginBottom: 16,
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#344054",
  marginBottom: 6,
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #D0D5DD",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};
const row: React.CSSProperties = { marginBottom: 14 };
const btn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #4F46E5",
  background: "#4F46E5",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #D0D5DD",
  background: "#fff",
  color: "#344054",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export default function MailSettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.systemRole === "owner" || user?.systemRole === "admin";

  const [loading, setLoading] = useState(true);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordSet, setPasswordSet] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveOk, setSaveOk] = useState(false);

  const [testTo, setTestTo] = useState(user?.email ?? "");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  /** Holds the recipient we sent to once the API confirms delivery, so
   *  the success banner can say "Sent to alice@…" instead of leaking the
   *  raw SMTP Message-ID, which means nothing to a business user. */
  const [testSentTo, setTestSentTo] = useState<string | null>(null);
  /** Optional toggle for the SMTP Message-ID, hidden by default. Surfaces
   *  for operators who need it to trace deliveries with their mail relay. */
  const [testMessageId, setTestMessageId] = useState<string | null>(null);
  const [showDeliveryDetails, setShowDeliveryDetails] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<MailSettings | null>("/mail/settings");
        if (cancelled) return;
        if (data) {
          setHost(data.host);
          setPort(data.port);
          setSecure(data.secure);
          setUsername(data.username ?? "");
          setPasswordSet(data.passwordSet);
          setFromEmail(data.fromEmail);
          setFromName(data.fromName ?? "");
          setEnabled(data.enabled);
          setUpdatedAt(data.updatedAt);
        }
      } catch (e: any) {
        setSaveError(e?.message ?? "Failed to load mail settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div style={{ padding: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Email settings</h1>
        <p style={{ color: "#667085" }}>
          Only owner / admin users may view or change tenant mail configuration.
        </p>
      </div>
    );
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaveError("");
    setSaveOk(false);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        host: host.trim(),
        port,
        secure,
        username: username.trim() || null,
        fromEmail: fromEmail.trim(),
        fromName: fromName.trim() || null,
        enabled,
      };
      // Only send password when the operator typed a new one.
      if (password) body.password = password;
      const updated = await apiPut<MailSettings>("/mail/settings", body);
      setPasswordSet(updated.passwordSet);
      setUpdatedAt(updated.updatedAt);
      setPassword("");
      setSaveOk(true);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to save settings.";
      setSaveError(Array.isArray(msg) ? msg.join(" • ") : String(msg));
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTestError("");
    setTestSentTo(null);
    setTestMessageId(null);
    setShowDeliveryDetails(false);
    if (!testTo.trim()) {
      setTestError("Enter a recipient email address.");
      return;
    }
    setTesting(true);
    try {
      const res = await apiPost<{ ok: true; messageId: string }>(
        "/mail/settings/test",
        { to: testTo.trim() },
      );
      setTestSentTo(testTo.trim());
      setTestMessageId(res.messageId);
    } catch (e: any) {
      const msg = e?.message ?? "Test send failed.";
      setTestError(Array.isArray(msg) ? msg.join(" • ") : String(msg));
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 32 }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 32, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Email settings</h1>
      <p style={{ color: "#667085", marginTop: 0, marginBottom: 20 }}>
        Configure the SMTP relay used by FlowPro for notifications and the
        <code style={{ background: "#F2F4F7", padding: "1px 6px", borderRadius: 4, margin: "0 4px" }}>notify-email</code>
        service-task. Passwords are encrypted at rest.
      </p>

      <form onSubmit={onSave} style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 16 }}>SMTP relay</h2>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
          <div style={row}>
            <label style={label}>Host *</label>
            <input
              style={input}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="smtp.example.com"
              required
            />
          </div>
          <div style={row}>
            <label style={label}>Port *</label>
            <input
              style={input}
              type="number"
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)}
              required
            />
          </div>
        </div>

        <div style={row}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#344054" }}>
            <input
              type="checkbox"
              checked={secure}
              onChange={(e) => setSecure(e.target.checked)}
            />
            Implicit TLS (use for port 465; leave off for 587/25 + STARTTLS)
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={row}>
            <label style={label}>Username</label>
            <input
              style={input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="apikey, postmaster@…, blank for none"
            />
          </div>
          <div style={row}>
            <label style={label}>
              Password {passwordSet && <span style={{ color: "#667085", fontWeight: 400 }}>(••• stored)</span>}
            </label>
            <input
              style={input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={passwordSet ? "Leave blank to keep existing" : "SMTP password"}
              autoComplete="new-password"
            />
          </div>
        </div>

        <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 20, marginBottom: 16 }}>Sender identity</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={row}>
            <label style={label}>From email *</label>
            <input
              style={input}
              type="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="noreply@yourdomain.com"
              required
            />
          </div>
          <div style={row}>
            <label style={label}>From name</label>
            <input
              style={input}
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="FlowPro"
            />
          </div>
        </div>

        <div style={row}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#344054" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enable outgoing mail (engine will dispatch <code>notify-email</code> tasks)
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
          <button type="submit" disabled={saving} style={{ ...btn, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          {updatedAt && (
            <span style={{ fontSize: 12, color: "#667085" }}>
              Last updated {new Date(updatedAt).toLocaleString()}
            </span>
          )}
        </div>
        {saveError && (
          <div style={{ marginTop: 12, padding: 10, background: "#FEF3F2", border: "1px solid #FECDCA", borderRadius: 6, color: "#B42318", fontSize: 13 }}>
            {saveError}
          </div>
        )}
        {saveOk && (
          <div style={{ marginTop: 12, padding: 10, background: "#ECFDF3", border: "1px solid #ABEFC6", borderRadius: 6, color: "#067647", fontSize: 13 }}>
            Settings saved.
          </div>
        )}
      </form>

      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 16 }}>Test send</h2>
        <p style={{ fontSize: 13, color: "#667085", marginTop: 0, marginBottom: 12 }}>
          Sends a test email using the saved settings above. Save your changes first.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Recipient</label>
            <input
              style={input}
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@yourdomain.com"
            />
          </div>
          <button onClick={onTest} disabled={testing} style={{ ...btnSecondary, opacity: testing ? 0.6 : 1 }}>
            {testing ? "Sending…" : "Send test"}
          </button>
        </div>
        {testError && (
          <div style={{ marginTop: 12, padding: 10, background: "#FEF3F2", border: "1px solid #FECDCA", borderRadius: 6, color: "#B42318", fontSize: 13 }}>
            {testError}
          </div>
        )}
        {testSentTo && (
          <div style={{ marginTop: 12, padding: 10, background: "#ECFDF3", border: "1px solid #ABEFC6", borderRadius: 6, color: "#067647", fontSize: 13 }}>
            <div>
              ✓ Test email sent to <strong>{testSentTo}</strong>. Check that inbox to confirm delivery.
            </div>
            {testMessageId && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#067647" }}>
                <button
                  type="button"
                  onClick={() => setShowDeliveryDetails((v) => !v)}
                  style={{ background: "transparent", border: "none", padding: 0, color: "#067647", cursor: "pointer", textDecoration: "underline", fontSize: 12 }}
                >
                  {showDeliveryDetails ? "Hide" : "Show"} delivery details
                </button>
                {showDeliveryDetails && (
                  <div style={{ marginTop: 6, color: "#475467" }}>
                    SMTP Message-ID: <code style={{ fontSize: 11 }}>{testMessageId}</code>
                    <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 2 }}>
                      The relay's unique tracking id for this send — useful for tracing in mail-server logs.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
