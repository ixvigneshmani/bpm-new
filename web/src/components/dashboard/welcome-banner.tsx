export default function WelcomeBanner() {
  return (
    <div
      style={{
        background: "linear-gradient(135deg,#4F46E5 0%,#7C3AED 50%,#6366F1 100%)",
        borderRadius: 16,
        padding: "28px 32px",
        marginBottom: 24,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 12px 16px -4px rgba(16,24,40,0.08),0 4px 6px -2px rgba(16,24,40,0.03)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 90% 30%,rgba(255,255,255,0.08) 0%,transparent 50%),radial-gradient(circle at 10% 80%,rgba(255,255,255,0.04) 0%,transparent 50%)",
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>
          Good morning, Alex
        </div>
        <div style={{ fontSize: 14, opacity: 0.75, marginTop: 4 }}>
          You have 18 approvals pending and 3 processes need attention
        </div>
      </div>
      <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 24 }}>
        {[
          { value: "247", label: "Active" },
          { value: "56", label: "Completed" },
          { value: "94%", label: "SLA" },
        ].map((m) => (
          <div key={m.label} style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-mono,'JetBrains Mono',monospace)", fontSize: 24, fontWeight: 600 }}>
              {m.value}
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
