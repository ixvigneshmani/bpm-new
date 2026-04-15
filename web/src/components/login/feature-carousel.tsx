
import { useState, useEffect, useCallback } from "react";

const lineArrow: React.CSSProperties = {
  position: "absolute",
  right: -3,
  top: -3,
  width: 0,
  height: 0,
  borderLeft: "5px solid rgba(255,255,255,0.15)",
  borderTop: "3px solid transparent",
  borderBottom: "3px solid transparent",
};

const connectorLine: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: "rgba(255,255,255,0.1)",
  position: "relative",
};

const nodeBase: React.CSSProperties = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 8,
  fontWeight: 600,
  color: "rgba(255,255,255,0.5)",
};

const chatUser: React.CSSProperties = {
  alignSelf: "flex-end",
  maxWidth: "80%",
  padding: "6px 12px",
  borderRadius: 8,
  borderBottomRightRadius: 2,
  background: "rgba(99,102,241,0.12)",
  color: "#818CF8",
  fontSize: 10,
  lineHeight: 1.4,
};

const chatAi: React.CSSProperties = {
  alignSelf: "flex-start",
  maxWidth: "80%",
  padding: "6px 12px",
  borderRadius: 8,
  borderBottomLeftRadius: 2,
  background: "rgba(255,255,255,0.06)",
  color: "#98A2B3",
  fontSize: 10,
  lineHeight: 1.4,
};

const slides = [
  {
    iconBg: "rgba(99,102,241,0.15)",
    iconColor: "#818CF8",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    title: "Visual Process Designer",
    desc: "Drag-and-drop canvas with real-time collaboration",
    visual: (
      <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "0 24px", width: "100%" }}>
        {/* Start */}
        <div style={{ ...nodeBase, width: 24, height: 24, borderRadius: "50%", background: "rgba(18,183,106,0.15)", border: "1.5px solid rgba(18,183,106,0.35)" }} />
        <div style={connectorLine}><span style={lineArrow} /></div>
        {/* Review */}
        <div style={{ ...nodeBase, height: 28, borderRadius: 6, padding: "0 10px", whiteSpace: "nowrap", background: "rgba(99,102,241,0.1)", border: "1.5px solid rgba(99,102,241,0.25)" }}>Review</div>
        <div style={connectorLine}><span style={lineArrow} /></div>
        {/* Gateway */}
        <div style={{ ...nodeBase, width: 22, height: 22, transform: "rotate(45deg)", background: "rgba(247,144,9,0.1)", border: "1.5px solid rgba(247,144,9,0.25)" }} />
        <div style={connectorLine}><span style={lineArrow} /></div>
        {/* Approve */}
        <div style={{ ...nodeBase, height: 28, borderRadius: 6, padding: "0 10px", whiteSpace: "nowrap", background: "rgba(99,102,241,0.1)", border: "1.5px solid rgba(99,102,241,0.25)" }}>Approve</div>
        <div style={connectorLine}><span style={lineArrow} /></div>
        {/* AI Check */}
        <div style={{ ...nodeBase, height: 28, borderRadius: 6, padding: "0 10px", whiteSpace: "nowrap", background: "rgba(192,132,252,0.1)", border: "1.5px solid rgba(192,132,252,0.25)" }}>AI Check</div>
        <div style={connectorLine}><span style={lineArrow} /></div>
        {/* End */}
        <div style={{ ...nodeBase, width: 24, height: 24, borderRadius: "50%", background: "rgba(240,68,56,0.12)", border: "2px solid rgba(240,68,56,0.3)" }} />
      </div>
    ),
  },
  {
    iconBg: "rgba(18,183,106,0.12)",
    iconColor: "#34D399",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    title: "AI-Powered Authoring",
    desc: "Describe workflows in plain language",
    visual: (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 20px", width: "100%" }}>
        <div style={chatUser}>Create an invoice approval with 3 levels</div>
        <div style={chatAi}>Generated a 3-step approval process with manager, finance, and director review gates.</div>
        <div style={chatUser}>Add SLA timer of 48h on each step</div>
      </div>
    ),
  },
  {
    iconBg: "rgba(247,144,9,0.12)",
    iconColor: "#FBBF24",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "Live Migration",
    desc: "Semantic diff and safe version upgrades",
    visual: (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 20px", width: "100%", fontFamily: "var(--font-mono,'JetBrains Mono',monospace)", fontSize: 9 }}>
        <div style={{ padding: "3px 8px", borderRadius: 4, color: "#667085" }}>
          &nbsp; node: &quot;checkCredit&quot; (unchanged)
        </div>
        <div style={{ padding: "3px 8px", borderRadius: 4, background: "rgba(240,68,56,0.08)", color: "#F87171" }}>
          - node: &quot;manualReview&quot; (removed)
        </div>
        <div style={{ padding: "3px 8px", borderRadius: 4, background: "rgba(18,183,106,0.1)", color: "#34D399" }}>
          + node: &quot;aiReview&quot; (added)
        </div>
        <div style={{ padding: "3px 8px", borderRadius: 4, background: "rgba(18,183,106,0.1)", color: "#34D399" }}>
          + node: &quot;escalation&quot; (added)
        </div>
        <div style={{ padding: "3px 8px", borderRadius: 4, color: "#667085" }}>
          &nbsp; node: &quot;finalApproval&quot; (unchanged)
        </div>
      </div>
    ),
  },
  {
    iconBg: "rgba(46,144,250,0.12)",
    iconColor: "#60A5FA",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
    title: "Time-Travel Debugging",
    desc: "Step through any instance at any point in time",
    visual: (
      <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "0 20px", width: "100%" }}>
        {[
          { type: "dot", state: "past", label: "Start" },
          { type: "line", done: true },
          { type: "dot", state: "past", label: "Review" },
          { type: "line", done: true },
          { type: "dot", state: "current", label: "Approve" },
          { type: "line", done: false },
          { type: "dot", state: "future", label: "Deploy" },
          { type: "line", done: false },
          { type: "dot", state: "future", label: "End" },
        ].map((item, i) => {
          if (item.type === "line") {
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 2,
                  background: item.done ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.06)",
                }}
              />
            );
          }
          const dotStyles: Record<string, React.CSSProperties> = {
            past: { background: "rgba(99,102,241,0.3)", border: "1.5px solid rgba(99,102,241,0.5)" },
            current: { background: "#818CF8", border: "2px solid #818CF8", boxShadow: "0 0 10px rgba(99,102,241,0.15)" },
            future: { background: "rgba(255,255,255,0.06)", border: "1.5px solid rgba(255,255,255,0.12)" },
          };
          return (
            <div
              key={i}
              style={{
                position: "relative",
                flexShrink: 0,
                width: 10,
                height: 10,
                borderRadius: "50%",
                zIndex: 1,
                ...dotStyles[item.state!],
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 14,
                  left: "50%",
                  transform: "translateX(-50%)",
                  fontSize: 8,
                  color: "#667085",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    ),
  },
];

export default function FeatureCarousel() {
  const [current, setCurrent] = useState(0);
  const [exiting, setExiting] = useState<number | null>(null);

  const goTo = useCallback(
    (n: number) => {
      if (n === current) return;
      setExiting(current);
      setTimeout(() => {
        setCurrent(n);
        setExiting(null);
      }, 300);
    },
    [current]
  );

  useEffect(() => {
    const timer = setInterval(() => {
      goTo((current + 1) % slides.length);
    }, 3500);
    return () => clearInterval(timer);
  }, [current, goTo]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 28,
          flex: 1,
          minHeight: 200,
          overflow: "hidden",
          animation: "fade-up 0.6s cubic-bezier(0.16,1,0.3,1) 0.6s both",
        }}
      >
        {slides.map((slide, i) => {
          const isActive = i === current;
          const isExiting = i === exiting;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                padding: "20px 24px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16,
                opacity: isActive ? 1 : 0,
                transform: isActive
                  ? "translateY(0)"
                  : isExiting
                    ? "translateY(-20px)"
                    : "translateY(20px)",
                transition: "opacity 0.5s ease, transform 0.5s ease",
                pointerEvents: isActive ? "auto" : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    background: slide.iconBg,
                    color: slide.iconColor,
                  }}
                >
                  {slide.icon}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 3 }}>
                    {slide.title}
                  </div>
                  <div style={{ fontSize: 13, color: "#98A2B3", lineHeight: 1.45 }}>
                    {slide.desc}
                  </div>
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                {slide.visual}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          gap: 6,
          marginTop: 14,
          animation: "fade-up 0.5s cubic-bezier(0.16,1,0.3,1) 0.7s both",
        }}
      >
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            style={{
              width: i === current ? 36 : 24,
              height: 4,
              borderRadius: 2,
              border: "none",
              cursor: "pointer",
              background: i === current ? "#818CF8" : "rgba(255,255,255,0.15)",
              transition: "all 0.3s ease",
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}
