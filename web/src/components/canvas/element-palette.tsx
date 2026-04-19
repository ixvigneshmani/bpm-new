import { useState, useRef, useEffect, type DragEvent } from "react";
import { nodeTypes } from "./nodes";

type PaletteItem = {
  type: string;
  label: string;
  color: string;
  shape: "circle" | "circle-bold" | "rect" | "diamond" | "rect-dash";
  icon: React.ReactNode;
};

/** Types registered as first-class renderable nodes. Palette entries not in this
 *  set are shown as "coming soon" and cannot be dragged — this prevents the
 *  palette from advertising elements the canvas can't actually render. */
const REGISTERED_TYPES = new Set(Object.keys(nodeTypes));

const PALETTE_GROUPS: { label: string; items: PaletteItem[] }[] = [
  {
    label: "Events",
    items: [
      {
        type: "startEvent", label: "Start", color: "#16A34A", shape: "circle",
        icon: <polygon points="9,5 18,12 9,19" fill="#16A34A" stroke="none" />,
      },
      {
        type: "timerEvent", label: "Timer", color: "#0EA5E9", shape: "circle",
        icon: <><circle cx="12" cy="12" r="7" fill="none" stroke="#0EA5E9" strokeWidth="1.5" /><path d="M12 9v3l2 1" stroke="#0EA5E9" strokeWidth="1.5" fill="none" strokeLinecap="round" /></>,
      },
      {
        type: "messageStartEvent", label: "Msg Start", color: "#8B5CF6", shape: "circle",
        icon: <><rect x="6" y="8" width="12" height="8" rx="1" fill="none" stroke="#8B5CF6" strokeWidth="1.5" /><polyline points="6 8 12 13 18 8" fill="none" stroke="#8B5CF6" strokeWidth="1.5" /></>,
      },
      {
        type: "signalEvent", label: "Signal", color: "#F59E0B", shape: "circle",
        icon: <polygon points="12,6 18,17 6,17" fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinejoin="round" />,
      },
      {
        type: "endEvent", label: "End", color: "#DC2626", shape: "circle-bold",
        icon: <rect x="9" y="9" width="6" height="6" rx="1" fill="#DC2626" stroke="none" />,
      },
      {
        type: "terminateEvent", label: "Termint", color: "#DC2626", shape: "circle-bold",
        icon: <circle cx="12" cy="12" r="5" fill="#DC2626" stroke="none" />,
      },
      {
        type: "intermediateCatchEvent", label: "Catch", color: "#0891B2", shape: "circle",
        icon: <circle cx="12" cy="12" r="5" fill="none" stroke="#0891B2" strokeWidth="1.5" />,
      },
      {
        type: "intermediateThrowEvent", label: "Throw", color: "#9333EA", shape: "circle",
        icon: <circle cx="12" cy="12" r="5" fill="#9333EA" stroke="none" />,
      },
      {
        type: "boundaryEvent", label: "Boundary", color: "#C2410C", shape: "circle",
        icon: <circle cx="12" cy="12" r="5" fill="none" stroke="#C2410C" strokeWidth="1.5" strokeDasharray="2 1.5" />,
      },
    ],
  },
  {
    label: "Tasks",
    items: [
      {
        type: "userTask", label: "User Task", color: "#6366F1", shape: "rect",
        icon: <><circle cx="12" cy="8" r="3" fill="none" stroke="#6366F1" strokeWidth="1.5" /><path d="M6 18v-1a6 6 0 0112 0v1" fill="none" stroke="#6366F1" strokeWidth="1.5" /></>,
      },
      {
        type: "serviceTask", label: "Service", color: "#EA580C", shape: "rect",
        icon: <><circle cx="12" cy="12" r="3" fill="none" stroke="#EA580C" strokeWidth="1.5" /><path d="M12 5v2M12 17v2M5 12h2M17 12h2" stroke="#EA580C" strokeWidth="1.5" strokeLinecap="round" /></>,
      },
      {
        type: "scriptTask", label: "Script Task", color: "#0891B2", shape: "rect",
        icon: <><path d="M8 6h8l-2 12H6z" fill="none" stroke="#0891B2" strokeWidth="1.5" strokeLinejoin="round" /><path d="M7 10h7M8 14h5" stroke="#0891B2" strokeWidth="1.2" strokeLinecap="round" /></>,
      },
      {
        type: "sendTask", label: "Send Task", color: "#7C3AED", shape: "rect",
        icon: <><rect x="5" y="7" width="14" height="10" rx="1.5" fill="none" stroke="#7C3AED" strokeWidth="1.5" /><polyline points="5 7 12 13 19 7" fill="none" stroke="#7C3AED" strokeWidth="1.5" /></>,
      },
      {
        type: "receiveTask", label: "Receive", color: "#2563EB", shape: "rect",
        icon: <><rect x="5" y="7" width="14" height="10" rx="1.5" fill="none" stroke="#2563EB" strokeWidth="1.5" /><polyline points="5 17 12 12 19 17" fill="none" stroke="#2563EB" strokeWidth="1.5" /></>,
      },
      {
        type: "manualTask", label: "Manual", color: "#059669", shape: "rect",
        icon: <path d="M6 13c0-1 1-2 2-2h1l2-2h3l1 1h2a1.5 1.5 0 010 3h-2v1h2.5a1 1 0 010 2h-3l-2 1H8a2 2 0 01-2-2z" fill="none" stroke="#059669" strokeWidth="1.3" />,
      },
      {
        type: "businessRuleTask", label: "Biz Rule", color: "#B45309", shape: "rect",
        icon: <><rect x="6" y="6" width="12" height="12" rx="1.5" fill="none" stroke="#B45309" strokeWidth="1.5" /><line x1="6" y1="10" x2="18" y2="10" stroke="#B45309" strokeWidth="1.2" /><line x1="11" y1="10" x2="11" y2="18" stroke="#B45309" strokeWidth="1.2" /></>,
      },
      {
        type: "callActivity", label: "Call", color: "#475467", shape: "rect",
        icon: <><rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="#475467" strokeWidth="2.5" /><path d="M10 9v6l4-3z" fill="#475467" stroke="none" /></>,
      },
    ],
  },
  {
    label: "Gateways",
    items: [
      {
        type: "exclusiveGateway", label: "Exclusive", color: "#CA8A04", shape: "diamond",
        icon: <><line x1="8" y1="8" x2="16" y2="16" stroke="#CA8A04" strokeWidth="2.5" strokeLinecap="round" /><line x1="16" y1="8" x2="8" y2="16" stroke="#CA8A04" strokeWidth="2.5" strokeLinecap="round" /></>,
      },
      {
        type: "parallelGateway", label: "Parallel", color: "#0284C7", shape: "diamond",
        icon: <><line x1="12" y1="7" x2="12" y2="17" stroke="#0284C7" strokeWidth="2.5" strokeLinecap="round" /><line x1="7" y1="12" x2="17" y2="12" stroke="#0284C7" strokeWidth="2.5" strokeLinecap="round" /></>,
      },
      {
        type: "inclusiveGateway", label: "Inclusive", color: "#7C3AED", shape: "diamond",
        icon: <circle cx="12" cy="12" r="4.5" fill="none" stroke="#7C3AED" strokeWidth="2.5" />,
      },
      {
        type: "eventBasedGateway", label: "Event", color: "#059669", shape: "diamond",
        icon: <><circle cx="12" cy="12" r="4.5" fill="none" stroke="#059669" strokeWidth="1.5" /><polygon points="12,8 15,14 9,14" fill="none" stroke="#059669" strokeWidth="1.5" /></>,
      },
    ],
  },
  {
    label: "Subprocesses",
    items: [
      {
        type: "subProcess", label: "Sub", color: "#475467", shape: "rect-dash",
        icon: <><rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="#475467" strokeWidth="1.5" strokeDasharray="3 1.5" /><line x1="12" y1="10" x2="12" y2="14" stroke="#475467" strokeWidth="1.5" strokeLinecap="round" /><line x1="10" y1="12" x2="14" y2="12" stroke="#475467" strokeWidth="1.5" strokeLinecap="round" /></>,
      },
      {
        type: "transaction", label: "Transact", color: "#475467", shape: "rect-dash",
        icon: <><rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="#475467" strokeWidth="1.2" /><rect x="7" y="7" width="10" height="10" rx="1.5" fill="none" stroke="#475467" strokeWidth="1.2" /></>,
      },
    ],
  },
  {
    label: "Swimlanes",
    items: [
      {
        type: "pool", label: "Pool", color: "#1D4ED8", shape: "rect",
        icon: <><rect x="4" y="4" width="16" height="16" rx="1.5" fill="none" stroke="#1D4ED8" strokeWidth="1.5" /><line x1="8" y1="4" x2="8" y2="20" stroke="#1D4ED8" strokeWidth="1.2" /><text x="6" y="13" fontSize="5" fill="#1D4ED8" fontWeight="700" textAnchor="middle" transform="rotate(-90 6 13)">P</text></>,
      },
      {
        type: "lane", label: "Lane", color: "#1D4ED8", shape: "rect",
        icon: <><rect x="4" y="4" width="16" height="16" rx="1.5" fill="none" stroke="#1D4ED8" strokeWidth="1.5" /><line x1="4" y1="12" x2="20" y2="12" stroke="#1D4ED8" strokeWidth="1" strokeDasharray="2 1.5" /></>,
      },
    ],
  },
  {
    label: "Data",
    items: [
      {
        type: "dataObject", label: "Object", color: "#475467", shape: "rect",
        icon: <><path d="M7 4h7l4 4v12a1 1 0 01-1 1H7a1 1 0 01-1-1V5a1 1 0 011-1z" fill="none" stroke="#475467" strokeWidth="1.5" /><polyline points="14 4 14 8 18 8" fill="none" stroke="#475467" strokeWidth="1.5" /></>,
      },
      {
        type: "dataStore", label: "Store", color: "#475467", shape: "rect",
        icon: <><ellipse cx="12" cy="7" rx="6" ry="3" fill="none" stroke="#475467" strokeWidth="1.5" /><path d="M6 7v10c0 1.66 2.69 3 6 3s6-1.34 6-3V7" fill="none" stroke="#475467" strokeWidth="1.5" /></>,
      },
    ],
  },
];

/* ─── Tiny shape renderer for palette icons ─── */
function ShapeIcon({ item }: { item: PaletteItem }) {
  const s = 24;
  // Hidden SVG for drag ghost to clone from
  const hiddenSvg = (
    <svg data-drag-icon-svg={item.type} width={0} height={0} viewBox="0 0 24 24" fill="none" style={{ position: "absolute", overflow: "hidden" }}>
      {item.icon}
    </svg>
  );

  if (item.shape === "circle" || item.shape === "circle-bold") {
    return (
      <div data-drag-icon style={{
        width: s, height: s, borderRadius: "50%",
        border: `${item.shape === "circle-bold" ? 2.5 : 1.5}px solid ${item.color}30`,
        background: `${item.color}08`,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        position: "relative",
      }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none">{item.icon}</svg>
        {hiddenSvg}
      </div>
    );
  }
  if (item.shape === "diamond") {
    return (
      <div data-drag-icon style={{
        width: s, height: s, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        position: "relative",
      }}>
        <div style={{
          width: 18, height: 18, transform: "rotate(45deg)", borderRadius: 3,
          border: `1.5px solid ${item.color}30`, background: `${item.color}08`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ transform: "rotate(-45deg)" }}>{item.icon}</svg>
        </div>
        {hiddenSvg}
      </div>
    );
  }
  // rect / rect-dash
  return (
    <div data-drag-icon style={{
      width: s, height: s, borderRadius: 5, flexShrink: 0,
      border: `1.5px ${item.shape === "rect-dash" ? "dashed" : "solid"} ${item.color}30`,
      background: `${item.color}08`,
      display: "flex", alignItems: "center", justifyContent: "center",
      position: "relative",
    }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none">{item.icon}</svg>
      {hiddenSvg}
    </div>
  );
}

export default function ElementPalette() {
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});
  const [panelOpen, setPanelOpen] = useState(true);
  const dragGhostRef = useRef<HTMLDivElement>(null);

  /* Create a persistent off-screen drag ghost container */
  useEffect(() => {
    if (!dragGhostRef.current) {
      const el = document.createElement("div");
      el.id = "palette-drag-ghost";
      el.style.cssText = "position:fixed;top:-200px;left:-200px;pointer-events:none;z-index:9999;";
      document.body.appendChild(el);
      dragGhostRef.current = el;
    }
    return () => {
      dragGhostRef.current?.remove();
      dragGhostRef.current = null;
    };
  }, []);

  const onDragStart = (event: DragEvent, item: PaletteItem) => {
    event.dataTransfer.setData("application/reactflow-type", item.type);
    event.dataTransfer.setData("application/reactflow-label", item.label);
    event.dataTransfer.effectAllowed = "move";

    /* Build a clean drag ghost: rounded pill with icon + label */
    const ghost = dragGhostRef.current;
    if (ghost) {
      ghost.innerHTML = "";
      const card = document.createElement("div");
      card.style.cssText = `
        display:flex;align-items:center;gap:8px;
        padding:8px 14px 8px 10px;
        background:#fff;border:1.5px solid ${item.color}40;
        border-radius:10px;
        box-shadow:0 4px 16px rgba(0,0,0,0.10),0 1px 3px rgba(0,0,0,0.06);
        font-family:Inter,system-ui,sans-serif;
        white-space:nowrap;
      `;
      // Icon circle
      const iconWrap = document.createElement("div");
      iconWrap.style.cssText = `
        width:28px;height:28px;border-radius:8px;
        background:${item.color}12;border:1.5px solid ${item.color}25;
        display:flex;align-items:center;justify-content:center;flex-shrink:0;
      `;
      iconWrap.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${(document.querySelector(`[data-drag-icon-svg="${item.type}"]`) as HTMLElement)?.innerHTML || ""}</svg>`;
      card.appendChild(iconWrap);

      // Label
      const label = document.createElement("span");
      label.style.cssText = `font-size:12px;font-weight:600;color:#344054;`;
      label.textContent = item.label;
      card.appendChild(label);

      ghost.appendChild(card);
      event.dataTransfer.setDragImage(ghost, 20, 22);
    }
  };

  const toggleGroup = (label: string) => {
    setGroupCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  /* ─── Collapsed: just a small toggle button ─── */
  if (!panelOpen) {
    return (
      <button
        onClick={() => setPanelOpen(true)}
        title="Show elements"
        style={{
          position: "absolute", top: 12, left: 12, zIndex: 10,
          width: 36, height: 36, borderRadius: 10,
          background: "#fff", border: "1px solid #E5E7EB",
          boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "#475467",
          transition: "all 0.15s ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#C7D2FE"; e.currentTarget.style.color = "#4F46E5"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E5E7EB"; e.currentTarget.style.color = "#475467"; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
    );
  }

  /* ─── Expanded: floating panel ─── */
  return (
    <div style={{
      position: "absolute", top: 12, left: 12, zIndex: 10,
      width: 196,
      background: "rgba(255,255,255,0.95)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      border: "1px solid #E5E7EB",
      borderRadius: 14,
      boxShadow: "0 4px 24px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
      display: "flex", flexDirection: "column",
      maxHeight: "calc(100% - 24px)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 12px 8px", borderBottom: "1px solid #F2F4F7",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>Elements</div>
          <div style={{ fontSize: 9, color: "#9CA3AF", marginTop: 1 }}>Drag onto canvas</div>
        </div>
        <button
          onClick={() => setPanelOpen(false)}
          title="Collapse"
          style={{
            width: 24, height: 24, borderRadius: 6,
            background: "none", border: "1px solid transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "#98A2B3", transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#F3F4F6"; e.currentTarget.style.color = "#475467"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#98A2B3"; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      {/* Scrollable groups */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {PALETTE_GROUPS.map((group) => {
          const isCollapsed = groupCollapsed[group.label];
          return (
            <div key={group.label}>
              <button
                onClick={() => toggleGroup(group.label)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 12px", background: "none", border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontSize: 9, fontWeight: 600, color: "#98A2B3",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                }}
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={{ transition: "transform 0.15s ease", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                {group.label}
                <span style={{ marginLeft: "auto", fontSize: 9, color: "#D0D5DD" }}>{group.items.length}</span>
              </button>

              {!isCollapsed && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 1, padding: "2px 6px 4px" }}>
                  {group.items.map((item) => {
                    const registered = REGISTERED_TYPES.has(item.type);
                    return (
                      <div
                        key={item.type}
                        draggable={registered}
                        onDragStart={registered ? (e) => onDragStart(e, item) : undefined}
                        title={registered ? item.label : `${item.label} — coming soon`}
                        aria-disabled={!registered}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                          width: 54, padding: "5px 2px 3px",
                          borderRadius: 6, cursor: registered ? "grab" : "not-allowed",
                          transition: "background 0.12s ease",
                          userSelect: "none",
                          opacity: registered ? 1 : 0.45,
                          position: "relative",
                        }}
                        onMouseEnter={registered ? (e) => { e.currentTarget.style.background = "rgba(99,102,241,0.06)"; } : undefined}
                        onMouseLeave={registered ? (e) => { e.currentTarget.style.background = "transparent"; } : undefined}
                      >
                        <ShapeIcon item={item} />
                        <span style={{
                          fontSize: 8, fontWeight: 500, color: "#667085",
                          textAlign: "center", lineHeight: "10px",
                          maxWidth: 50, overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>{item.label}</span>
                        {!registered && (
                          <span style={{
                            position: "absolute", top: 2, right: 2,
                            fontSize: 7, fontWeight: 600,
                            padding: "1px 3px", borderRadius: 3,
                            background: "#F3F4F6", color: "#9CA3AF",
                            letterSpacing: "0.03em",
                          }}>soon</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
