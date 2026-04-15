import FeatureCarousel from "./feature-carousel";

export default function LoginBrand() {
  return (
    <div
      style={{
        flex: "0 0 50%",
        background: "#101828",
        display: "flex",
        flexDirection: "column",
        padding: 40,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Grid pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(99,102,241,0.08) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      {/* Glowing orb */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)",
          bottom: -200,
          right: -100,
          animation: "glow-pulse 12s ease-in-out infinite",
        }}
      />

      {/* Top logo */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background: "linear-gradient(135deg, #6366F1, #818CF8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 24px rgba(99,102,241,0.15)",
              animation: "scale-in 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both, glow-pulse 4s ease-in-out 1s infinite",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M9 11l3 3L22 4" />
            </svg>
          </div>
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#fff",
              letterSpacing: "-0.02em",
              animation: "fade-right 0.5s cubic-bezier(0.16,1,0.3,1) 0.2s both",
            }}
          >
            FlowPro
          </span>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            width: "fit-content",
            padding: "4px 12px 4px 6px",
            background: "rgba(99,102,241,0.12)",
            border: "1px solid rgba(99,102,241,0.2)",
            borderRadius: 9999,
            animation: "fade-up 0.6s cubic-bezier(0.16,1,0.3,1) 0.3s both",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#12B76A",
              boxShadow: "0 0 8px rgba(18,183,106,0.4)",
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 500, color: "#818CF8" }}>
            AI-Native Process Platform
          </span>
        </div>
      </div>

      {/* Center content */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          maxWidth: 500,
        }}
      >
        <h1
          style={{
            fontSize: 40,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            color: "#fff",
            animation: "fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.4s both",
          }}
        >
          Design processes
          <br />
          that{" "}
          <span
            style={{
              background: "linear-gradient(135deg, #818CF8, #C084FC, #818CF8)",
              backgroundSize: "200% 200%",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              animation: "gradient-shift 6s ease infinite",
            }}
          >
            just work.
          </span>
        </h1>
        <p
          style={{
            fontSize: 16,
            color: "#98A2B3",
            marginTop: 16,
            lineHeight: 1.65,
            maxWidth: 420,
            animation: "fade-up 0.7s cubic-bezier(0.16,1,0.3,1) 0.55s both",
          }}
        >
          Co-author workflows between business and engineering. AI bridges the gap. BPMN 2.0 compliance under the hood.
        </p>

        <FeatureCarousel />
      </div>

      {/* Trust bar */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginTop: "auto",
          paddingTop: 20,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          animation: "fade-up 0.5s cubic-bezier(0.16,1,0.3,1) 1.6s both",
        }}
      >
        <div style={{ display: "flex" }}>
          {[
            { initials: "AK", gradient: "linear-gradient(135deg,#6366F1,#A78BFA)" },
            { initials: "SC", gradient: "linear-gradient(135deg,#F59E0B,#EF4444)" },
            { initials: "MT", gradient: "linear-gradient(135deg,#10B981,#059669)" },
            { initials: "PP", gradient: "linear-gradient(135deg,#3B82F6,#06B6D4)" },
          ].map((av, i) => (
            <div
              key={i}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: "2px solid #101828",
                marginLeft: i > 0 ? -8 : 0,
                background: av.gradient,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: 600,
                color: "#fff",
              }}
            >
              {av.initials}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 13, color: "#98A2B3" }}>
          <strong style={{ color: "#D0D5DD" }}>340+ teams</strong> trust FlowPro
        </div>
      </div>
    </div>
  );
}
