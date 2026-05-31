import { useState, useRef, useEffect, type DragEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { nodeTypes } from "./nodes";
import {
  NoneStartIcon,
  NoneEndIcon,
  UserTaskIcon,
  ServiceTaskIcon,
  ScriptTaskIcon,
  SendTaskIcon,
  ReceiveTaskIcon,
  ManualTaskIcon,
  BusinessRuleTaskIcon,
  CallActivityIcon,
  ExclusiveGatewayIcon,
  ParallelGatewayIcon,
  InclusiveGatewayIcon,
  EventBasedGatewayIcon,
} from "./nodes/icons/event-icons";

/** Icon = a function that produces the same React element the canvas
 *  node renders. Lets ShapeIcon size it and the drag-ghost renderer
 *  inline the markup without duplicating SVG paths. */
type IconRenderer = (color: string, size: number) => React.ReactElement;

type PaletteItem = {
  type: string;
  label: string;
  color: string;
  shape: "circle" | "circle-bold" | "rect" | "diamond" | "rect-dash";
  icon: IconRenderer;
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
        icon: (color, size) => <NoneStartIcon color={color} size={size} />,
      },
      {
        type: "endEvent", label: "End", color: "#DC2626", shape: "circle-bold",
        icon: (color, size) => <NoneEndIcon color={color} size={size} />,
      },
      {
        type: "intermediateCatchEvent", label: "Catch", color: "#0D9488", shape: "circle",
        icon: (color, size) => <NoneStartIcon color={color} size={size} />,
      },
      {
        type: "intermediateThrowEvent", label: "Throw", color: "#9333EA", shape: "circle",
        icon: (color, size) => <NoneStartIcon color={color} size={size} />,
      },
      {
        type: "boundaryEvent", label: "Boundary", color: "#C2410C", shape: "circle",
        icon: (color, size) => <NoneStartIcon color={color} size={size} />,
      },
    ],
  },
  {
    label: "Tasks",
    items: [
      {
        type: "userTask", label: "User Task", color: "#6366F1", shape: "rect",
        icon: (color, size) => <UserTaskIcon color={color} size={size} />,
      },
      {
        type: "serviceTask", label: "Service", color: "#EA580C", shape: "rect",
        icon: (color, size) => <ServiceTaskIcon color={color} size={size} />,
      },
      {
        type: "scriptTask", label: "Script Task", color: "#0891B2", shape: "rect",
        icon: (color, size) => <ScriptTaskIcon color={color} size={size} />,
      },
      {
        type: "sendTask", label: "Send Task", color: "#7C3AED", shape: "rect",
        icon: (color, size) => <SendTaskIcon color={color} size={size} />,
      },
      {
        type: "receiveTask", label: "Receive", color: "#2563EB", shape: "rect",
        icon: (color, size) => <ReceiveTaskIcon color={color} size={size} />,
      },
      {
        type: "manualTask", label: "Manual", color: "#059669", shape: "rect",
        icon: (color, size) => <ManualTaskIcon color={color} size={size} />,
      },
      {
        type: "businessRuleTask", label: "Biz Rule", color: "#B45309", shape: "rect",
        icon: (color, size) => <BusinessRuleTaskIcon color={color} size={size} />,
      },
      {
        type: "callActivity", label: "Call", color: "#475467", shape: "rect",
        icon: (color, size) => <CallActivityIcon color={color} size={size} />,
      },
    ],
  },
  {
    label: "Gateways",
    items: [
      {
        type: "exclusiveGateway", label: "Exclusive", color: "#CA8A04", shape: "diamond",
        icon: (color, size) => <ExclusiveGatewayIcon color={color} size={size} />,
      },
      {
        type: "parallelGateway", label: "Parallel", color: "#0284C7", shape: "diamond",
        icon: (color, size) => <ParallelGatewayIcon color={color} size={size} />,
      },
      {
        type: "inclusiveGateway", label: "Inclusive", color: "#7C3AED", shape: "diamond",
        icon: (color, size) => <InclusiveGatewayIcon color={color} size={size} />,
      },
      {
        type: "eventBasedGateway", label: "Event", color: "#059669", shape: "diamond",
        icon: (color, size) => <EventBasedGatewayIcon color={color} size={size} />,
      },
    ],
  },
  {
    label: "Subprocesses",
    items: [
      {
        type: "subProcess", label: "Sub", color: "#475467", shape: "rect-dash",
        icon: (color, size) => (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
            <rect x="6" y="6" width="12" height="12" rx="2" />
            <line x1="12" y1="10" x2="12" y2="14" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        ),
      },
      {
        type: "transaction", label: "Transact", color: "#0F766E", shape: "rect-dash",
        icon: (color, size) => (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
            <rect x="5" y="5" width="14" height="14" rx="2" />
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
          </svg>
        ),
      },
      {
        type: "eventSubProcess", label: "Event Sub", color: "#7C3AED", shape: "rect-dash",
        icon: (color, size) => (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
            <rect x="6" y="6" width="12" height="12" rx="2" strokeDasharray="2 1.5" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        ),
      },
      {
        type: "adHocSubProcess", label: "Ad-hoc", color: "#B45309", shape: "rect-dash",
        icon: (color, size) => (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
            <rect x="6" y="6" width="12" height="12" rx="2" strokeDasharray="3 1.5" />
            <path d="M8 13c1.5-3 3-3 4 0s2.5 3 4 0" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Swimlanes",
    items: [
      {
        type: "pool", label: "Pool", color: "#1D4ED8", shape: "rect",
        icon: (color, size) => (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
            <rect x="4" y="4" width="16" height="16" rx="1.5" />
            <line x1="8" y1="4" x2="8" y2="20" />
          </svg>
        ),
      },
      {
        type: "lane", label: "Lane", color: "#1D4ED8", shape: "rect",
        icon: (color, size) => (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
            <rect x="4" y="4" width="16" height="16" rx="1.5" />
            <line x1="4" y1="12" x2="20" y2="12" strokeDasharray="2 1.5" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Artifacts",
    items: [
      {
        type: "dataStore", label: "Store", color: "#475467", shape: "rect",
        icon: (color, size) => (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
            <ellipse cx="12" cy="7" rx="6" ry="3" />
            <path d="M6 7v10c0 1.66 2.69 3 6 3s6-1.34 6-3V7" />
          </svg>
        ),
      },
      {
        type: "textAnnotation", label: "Note", color: "#92400E", shape: "rect",
        icon: (color, size) => (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
            <path d="M10 5h8v14h-8" />
            <path d="M10 5v14" />
          </svg>
        ),
      },
      {
        type: "group", label: "Group", color: "#475467", shape: "rect-dash",
        icon: (color, size) => (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
            <rect x="4" y="5" width="16" height="14" rx="3" strokeDasharray="3 2" />
          </svg>
        ),
      },
    ],
  },
];

/* ─── Tiny shape renderer for palette icons ─── */
function ShapeIcon({ item }: { item: PaletteItem }) {
  const s = 24;
  const inner = item.icon(item.color, 14);

  if (item.shape === "circle" || item.shape === "circle-bold") {
    return (
      <div data-drag-icon style={{
        width: s, height: s, borderRadius: "50%",
        border: `${item.shape === "circle-bold" ? 2.5 : 1.5}px solid ${item.color}30`,
        background: `${item.color}08`,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        position: "relative",
      }}>
        {inner}
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
          <div style={{ transform: "rotate(-45deg)", display: "flex" }}>{item.icon(item.color, 12)}</div>
        </div>
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
      {inner}
    </div>
  );
}

export default function ElementPalette({ disabled = false }: { disabled?: boolean } = {}) {
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
      // Render the SAME icon component the canvas node uses, as static
      // markup, so the drag ghost mirrors the palette pill exactly.
      iconWrap.innerHTML = renderToStaticMarkup(item.icon(item.color, 14));
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
          <div style={{ fontSize: 9, color: disabled ? "#B45309" : "#9CA3AF", marginTop: 1 }}>
            {disabled ? "View only" : "Drag onto canvas"}
          </div>
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
                    const draggable = registered && !disabled;
                    return (
                      <div
                        key={item.type}
                        draggable={draggable}
                        onDragStart={draggable ? (e) => onDragStart(e, item) : undefined}
                        title={
                          disabled
                            ? "View only — you don't have edit permission"
                            : registered
                              ? item.label
                              : `${item.label} — coming soon`
                        }
                        aria-disabled={!draggable}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                          width: 54, padding: "5px 2px 3px",
                          borderRadius: 6,
                          cursor: disabled ? "not-allowed" : registered ? "grab" : "not-allowed",
                          transition: "background 0.12s ease",
                          userSelect: "none",
                          opacity: disabled ? 0.4 : registered ? 1 : 0.45,
                          position: "relative",
                        }}
                        onMouseEnter={draggable ? (e) => { e.currentTarget.style.background = "rgba(99,102,241,0.06)"; } : undefined}
                        onMouseLeave={draggable ? (e) => { e.currentTarget.style.background = "transparent"; } : undefined}
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
