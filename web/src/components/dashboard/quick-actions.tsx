import { useNavigate } from "react-router-dom";

type Action = {
  title: string;
  desc: string;
  iconBg: string;
  iconColor: string;
  icon: React.ReactNode;
  to: string;
};

const actions: Action[] = [
  {
    title: "Create Process",
    desc: "Start a new design",
    iconBg: "#EEF2FF",
    iconColor: "#4F46E5",
    icon: (
      <>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    ),
    to: "/designer/new",
  },
  {
    title: "Browse Designs",
    desc: "All process designs",
    iconBg: "#EFF8FF",
    iconColor: "#2E90FA",
    icon: (
      <>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </>
    ),
    to: "/designer",
  },
  {
    title: "My Tasks",
    desc: "Tasks waiting for you",
    iconBg: "#FFFAEB",
    iconColor: "#F79009",
    icon: (
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </>
    ),
    to: "/tasks",
  },
  {
    title: "Running Instances",
    desc: "Live executions",
    iconBg: "#ECFDF3",
    iconColor: "#12B76A",
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </>
    ),
    to: "/running",
  },
];

export default function QuickActions() {
  const navigate = useNavigate();
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
      {actions.map((a) => (
        <button
          key={a.title}
          type="button"
          onClick={() => navigate(a.to)}
          style={{
            flex: 1,
            background: "#fff",
            border: "1px solid #EAECF0",
            borderRadius: 12,
            padding: 16,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 14,
            boxShadow: "0 1px 2px rgba(16,24,40,0.05)",
            textAlign: "left",
            font: "inherit",
            color: "inherit",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              background: a.iconBg,
              color: a.iconColor,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              {a.icon}
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#101828" }}>{a.title}</div>
            <div style={{ fontSize: 12, color: "#667085", marginTop: 1 }}>{a.desc}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
