import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { nanoid } from "nanoid";
import useCanvasStore from "../../store/canvas-store";
import { apiPost, apiPut, apiGet, apiPatch } from "../../lib/api";
import { useAuth } from "../../lib/auth";

/* ─── Field Builder Types & Helpers ─── */
type FieldDef = {
  id: string;
  name: string;
  type: "string" | "number" | "boolean" | "date" | "object" | "array";
  required: boolean;
  children?: FieldDef[];  // for object
  items?: FieldDef[];     // for array item schema
  collapsed?: boolean;
};

const FIELD_TYPES = ["string", "number", "boolean", "date", "object", "array"] as const;

function createField(name = "", type: FieldDef["type"] = "string"): FieldDef {
  return { id: nanoid(8), name, type, required: false };
}

function fieldsToJson(fields: FieldDef[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const f of fields) {
    if (!f.name.trim()) continue;
    if (f.type === "object" && f.children) {
      obj[f.name] = fieldsToJson(f.children);
    } else if (f.type === "array" && f.items) {
      obj[f.name] = [fieldsToJson(f.items)];
    } else {
      obj[f.name] = f.type;
    }
  }
  return obj;
}

function jsonToFields(json: Record<string, unknown>): FieldDef[] {
  return Object.entries(json).map(([key, val]) => {
    if (Array.isArray(val)) {
      return { ...createField(key, "array"), items: val[0] && typeof val[0] === "object" ? jsonToFields(val[0] as Record<string, unknown>) : [] };
    }
    if (val && typeof val === "object") {
      return { ...createField(key, "object"), children: jsonToFields(val as Record<string, unknown>) };
    }
    const t = typeof val === "string" && FIELD_TYPES.includes(val as FieldDef["type"]) ? (val as FieldDef["type"]) : "string";
    return createField(key, t);
  });
}

function updateFieldInTree(fields: FieldDef[], id: string, updater: (f: FieldDef) => FieldDef): FieldDef[] {
  return fields.map((f) => {
    if (f.id === id) return updater(f);
    return {
      ...f,
      children: f.children ? updateFieldInTree(f.children, id, updater) : undefined,
      items: f.items ? updateFieldInTree(f.items, id, updater) : undefined,
    };
  });
}

function removeFieldFromTree(fields: FieldDef[], id: string): FieldDef[] {
  return fields.filter((f) => f.id !== id).map((f) => ({
    ...f,
    children: f.children ? removeFieldFromTree(f.children, id) : undefined,
    items: f.items ? removeFieldFromTree(f.items, id) : undefined,
  }));
}

function addFieldToParent(fields: FieldDef[], parentId: string, target: "children" | "items"): FieldDef[] {
  return fields.map((f) => {
    if (f.id === parentId) {
      const arr = f[target] || [];
      return { ...f, [target]: [...arr, createField()] };
    }
    return {
      ...f,
      children: f.children ? addFieldToParent(f.children, parentId, target) : undefined,
      items: f.items ? addFieldToParent(f.items, parentId, target) : undefined,
    };
  });
}

/* ─── Stepper Bar ─── */
function StepperBar({ currentIndex, onStepClick, isExisting }: { currentIndex: number; onStepClick: (i: number) => void; isExisting: boolean }) {
  const documentDirty = useCanvasStore((s) => s.documentDirty);
  const labels = ["Details", "Business Doc", "Canvas"];
  return (
    <div style={{
      padding: "16px 48px", borderBottom: "1px solid #F2F4F7",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(255,255,255,0.6)", backdropFilter: "blur(8px)",
      position: "relative", zIndex: 2,
    }}>
      {labels.map((label, i) => {
        const isDone = i < currentIndex;
        const isActive = i === currentIndex;
        const isClickable = (isExisting || isDone) && !documentDirty;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center" }}>
            <div
              onClick={() => isClickable && !isActive && onStepClick(i)}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: isClickable && !isActive ? "pointer" : "default" }}
              title={documentDirty && !isActive ? "Save or discard schema changes first" : undefined}
            >
              <div style={{
                width: 34, height: 34, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.3s ease",
                ...(isDone ? {
                  background: "#10B981", border: "2px solid #10B981", color: "#fff",
                  boxShadow: "0 0 0 4px rgba(16,185,129,0.12)",
                } : isActive ? {
                  background: "#4F46E5", border: "2px solid #4F46E5", color: "#fff",
                  boxShadow: "0 0 0 4px rgba(79,70,229,0.12)",
                } : {
                  background: "#F9FAFB", border: isExisting ? "2px solid #D0D5DD" : "2px solid #E5E7EB", color: isExisting ? "#6B7280" : "#9CA3AF",
                }),
              }}>
                {isDone ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{i + 1}</span>
                )}
              </div>
              <span style={{
                fontSize: 13, fontWeight: 600,
                color: isDone ? "#10B981" : isActive ? "#111827" : isExisting ? "#6B7280" : "#9CA3AF",
                transition: "color 0.3s ease",
              }}>{label}</span>
            </div>
            {i < 2 && (
              <div style={{
                width: 80, height: 2, margin: "0 16px", borderRadius: 1,
                background: isDone ? "#A7F3D0" : isActive ? "#C7D2FE" : "#E5E7EB",
                transition: "background 0.3s ease",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Step 1: Process Details (two-column) ─── */
function StepDetails() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const processId = useCanvasStore((s) => s.processId);
  const processMeta = useCanvasStore((s) => s.processMeta);
  const setProcessMeta = useCanvasStore((s) => s.setProcessMeta);
  const setProcessId = useCanvasStore((s) => s.setProcessId);
  const setWizardStep = useCanvasStore((s) => s.setWizardStep);
  const wizardOrigin = useCanvasStore((s) => s.wizardOrigin);
  const [saving, setSaving] = useState(false);
  const canContinue = processMeta.name.trim().length > 0 && !saving;
  const isExisting = !!processId;
  const cameFromCanvas = wizardOrigin === "canvas";

  const handleGoBack = () => {
    if (cameFromCanvas) {
      setWizardStep("canvas");
    } else {
      navigate("/processes");
    }
  };

  const inputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "#818CF8";
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.08)";
  };
  const inputBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "#E5E7EB";
    e.currentTarget.style.boxShadow = "none";
  };

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr",
      minHeight: "calc(100vh - 124px)", position: "relative", zIndex: 1,
    }}>
      {/* Left: Form */}
      <div style={{
        padding: "32px 36px", borderRight: "1px solid #F2F4F7",
        background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)",
        display: "flex", flexDirection: "column",
      }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>{isExisting ? "Process Details" : "Create new process"}</h2>
        <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 28, lineHeight: 1.5 }}>{isExisting ? "Review or update your process details." : "Give it a name and description to get started."}</div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6, display: "block" }}>Process Name *</label>
            <input
              type="text" value={processMeta.name}
              onChange={(e) => { if (!processId) setProcessMeta({ name: e.target.value }); }}
              placeholder="Enter process name"
              autoFocus={!processId}
              readOnly={!!processId}
              style={{ width: "100%", padding: "12px 14px", border: "1.5px solid #E5E7EB", borderRadius: 10, fontSize: 14, color: processId ? "#6B7280" : "#111827", fontFamily: "inherit", outline: "none", background: processId ? "#F9FAFB" : "#fff", transition: "all 0.15s ease", cursor: processId ? "not-allowed" : "text" }}
              onFocus={processId ? undefined : inputFocus} onBlur={processId ? undefined : inputBlur}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6, display: "block" }}>Description</label>
            <textarea
              value={processMeta.description}
              onChange={(e) => setProcessMeta({ description: e.target.value })}
              placeholder="Briefly describe the purpose of this process"
              style={{ width: "100%", padding: "12px 14px", minHeight: 110, resize: "vertical", border: "1.5px solid #E5E7EB", borderRadius: 10, fontSize: 14, color: "#111827", fontFamily: "inherit", outline: "none", background: "#fff", transition: "all 0.15s ease" }}
              onFocus={inputFocus} onBlur={inputBlur}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 12, marginTop: 14, paddingTop: 14, borderTop: "1px solid #F2F4F7" }}>
          <button onClick={handleGoBack} style={{ padding: "11px 20px", borderRadius: 10, border: "1.5px solid #E5E7EB", background: "#fff", color: "#374151", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
            {cameFromCanvas ? "← Back to Canvas" : "← Back to Processes"}
          </button>
          <button
            onClick={async () => {
              if (!canContinue) return;
              setSaving(true);
              try {
                if (processId) {
                  await apiPatch(`/processes/${processId}`, { description: processMeta.description });
                  setWizardStep("document");
                } else {
                  const proc = await apiPost<{ id: string }>("/processes", { name: processMeta.name, description: processMeta.description });
                  setProcessId(proc.id);
                  setProcessMeta({ creatorName: user?.displayName || "", status: "DRAFT", updatedAt: new Date().toISOString() });
                  setWizardStep("document");
                  navigate(`/designer/${proc.id}`, { replace: true });
                }
              } catch (e) {
                console.error("Save failed:", e);
              } finally {
                setSaving(false);
              }
            }}
            style={{
              padding: "11px 32px", borderRadius: 10, border: "none",
              background: canContinue ? "linear-gradient(135deg, #4F46E5, #6366F1)" : "#E5E7EB",
              color: canContinue ? "#fff" : "#9CA3AF", fontSize: 14, fontWeight: 600,
              cursor: canContinue ? "pointer" : "not-allowed", fontFamily: "inherit",
              boxShadow: canContinue ? "0 4px 12px rgba(79,70,229,0.25)" : "none",
              transition: "all 0.2s ease",
            }}
          >{saving ? "Saving..." : isExisting ? "Save & Continue →" : "Continue →"}</button>
        </div>
      </div>

      {/* Right: Muted canvas illustration */}
      <div style={{
        background: "#F8FAFC",
        overflow: "hidden", position: "relative",
        opacity: 0.4,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "40px",
      }}>
        <svg width="100%" height="100%" viewBox="0 0 600 700" fill="none" style={{ maxWidth: 360, maxHeight: 420 }}>
          {/* Dot grid background */}
          <defs>
            <pattern id="wizGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="10" cy="10" r="0.9" fill="#C7D2FE" fillOpacity="0.4" />
            </pattern>
          </defs>
          <rect width="600" height="700" fill="url(#wizGrid)" />

          {/* ─── Row 1: Start → Review → Gateway ─── */}
          {/* Start Event */}
          <circle cx="60" cy="120" r="24" fill="#F0FDF4" stroke="#86EFAC" strokeWidth="2.5" />
          <polygon points="55,112 68,120 55,128" fill="#16A34A" />
          <text x="60" y="158" textAnchor="middle" fontSize="10" fill="#6B7280" fontFamily="Inter">Start</text>

          {/* Arrow → */}
          <line x1="84" y1="120" x2="140" y2="120" stroke="#94A3B8" strokeWidth="1.5" />
          <polygon points="137,116 145,120 137,124" fill="#94A3B8" />

          {/* Review Task */}
          <rect x="148" y="100" width="110" height="40" rx="10" fill="#EEF2FF" stroke="#C7D2FE" strokeWidth="1.5" />
          <text x="203" y="124" textAnchor="middle" fontSize="12" fontWeight="600" fill="#4F46E5" fontFamily="Inter">Review</text>
          <text x="203" y="136" textAnchor="middle" fontSize="8" fill="#818CF8" fontFamily="Inter">User Task</text>

          {/* Arrow → */}
          <line x1="258" y1="120" x2="310" y2="120" stroke="#94A3B8" strokeWidth="1.5" />
          <polygon points="307,116 315,120 307,124" fill="#94A3B8" />

          {/* Exclusive Gateway */}
          <g transform="translate(340,120)">
            <rect x="-20" y="-20" width="40" height="40" rx="5" transform="rotate(45)" fill="#FFFBEB" stroke="#FDE68A" strokeWidth="2.5" />
            <line x1="-8" y1="-8" x2="8" y2="8" stroke="#CA8A04" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="8" y1="-8" x2="-8" y2="8" stroke="#CA8A04" strokeWidth="2.5" strokeLinecap="round" />
          </g>
          <text x="340" y="158" textAnchor="middle" fontSize="10" fill="#6B7280" fontFamily="Inter">Decision</text>

          {/* ─── Right branch: Gateway → Approve → End ─── */}
          <line x1="364" y1="120" x2="416" y2="120" stroke="#94A3B8" strokeWidth="1.5" />
          <polygon points="413,116 421,120 413,124" fill="#94A3B8" />
          <text x="390" y="112" textAnchor="middle" fontSize="8" fill="#10B981" fontFamily="Inter">Yes</text>

          <rect x="424" y="100" width="100" height="40" rx="10" fill="#F0FDF4" stroke="#A7F3D0" strokeWidth="1.5" />
          <text x="474" y="124" textAnchor="middle" fontSize="12" fontWeight="600" fill="#059669" fontFamily="Inter">Approve</text>

          <line x1="524" y1="120" x2="556" y2="120" stroke="#94A3B8" strokeWidth="1.5" />
          <polygon points="553,116 561,120 553,124" fill="#94A3B8" />

          {/* End Event */}
          <circle cx="572" cy="120" r="18" fill="#FEF2F2" stroke="#FCA5A5" strokeWidth="3" />
          <rect x="564" y="112" width="16" height="16" rx="3" fill="#DC2626" />

          {/* ─── Down branch: Gateway → Notify → Archive ─── */}
          <line x1="340" y1="148" x2="340" y2="220" stroke="#94A3B8" strokeWidth="1.5" />
          <polygon points="336,217 340,225 344,217" fill="#94A3B8" />
          <text x="350" y="185" fontSize="8" fill="#DC2626" fontFamily="Inter">No</text>

          <rect x="285" y="228" width="110" height="40" rx="10" fill="#FFF7ED" stroke="#FDBA74" strokeWidth="1.5" />
          <text x="340" y="252" textAnchor="middle" fontSize="12" fontWeight="600" fill="#EA580C" fontFamily="Inter">Notify Team</text>
          <text x="340" y="264" textAnchor="middle" fontSize="8" fill="#FB923C" fontFamily="Inter">Service Task</text>

          <line x1="395" y1="248" x2="440" y2="248" stroke="#94A3B8" strokeWidth="1.5" />
          <polygon points="437,244 445,248 437,252" fill="#94A3B8" />

          <rect x="448" y="228" width="100" height="40" rx="10" fill="#F0F9FF" stroke="#BAE6FD" strokeWidth="1.5" />
          <text x="498" y="252" textAnchor="middle" fontSize="12" fontWeight="600" fill="#0284C7" fontFamily="Inter">Archive</text>
          <text x="498" y="264" textAnchor="middle" fontSize="8" fill="#38BDF8" fontFamily="Inter">Script Task</text>

          {/* ─── Row 3: Subprocess + Parallel branch ─── */}
          <line x1="340" y1="268" x2="340" y2="340" stroke="#94A3B8" strokeWidth="1" strokeDasharray="5 3" opacity="0.5" />

          <rect x="270" y="345" width="140" height="45" rx="10" fill="#F9FAFB" stroke="#D0D5DD" strokeWidth="1.5" strokeDasharray="5 3" />
          <text x="340" y="372" textAnchor="middle" fontSize="11" fontWeight="500" fill="#475467" fontFamily="Inter">Error Handling</text>
          <text x="340" y="384" textAnchor="middle" fontSize="8" fill="#9CA3AF" fontFamily="Inter">Subprocess</text>

          {/* Parallel Gateway */}
          <g transform="translate(120,248)">
            <rect x="-18" y="-18" width="36" height="36" rx="4" transform="rotate(45)" fill="#EFF6FF" stroke="#93C5FD" strokeWidth="2" />
            <line x1="0" y1="-9" x2="0" y2="9" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="-9" y1="0" x2="9" y2="0" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />
          </g>
          <text x="120" y="284" textAnchor="middle" fontSize="10" fill="#6B7280" fontFamily="Inter">Parallel</text>

          <line x1="60" y1="144" x2="60" y2="248" stroke="#94A3B8" strokeWidth="1" strokeDasharray="5 3" opacity="0.4" />
          <line x1="60" y1="248" x2="96" y2="248" stroke="#94A3B8" strokeWidth="1.5" />
          <line x1="144" y1="248" x2="285" y2="248" stroke="#94A3B8" strokeWidth="1" strokeDasharray="5 3" opacity="0.4" />

          {/* Send Task */}
          <rect x="50" y="330" width="110" height="40" rx="10" fill="#F5F3FF" stroke="#DDD6FE" strokeWidth="1.5" />
          <text x="105" y="354" textAnchor="middle" fontSize="12" fontWeight="600" fill="#7C3AED" fontFamily="Inter">Send Email</text>
          <text x="105" y="366" textAnchor="middle" fontSize="8" fill="#A78BFA" fontFamily="Inter">Send Task</text>
          <line x1="120" y1="274" x2="120" y2="330" stroke="#94A3B8" strokeWidth="1" strokeDasharray="5 3" opacity="0.4" />

          {/* Pool/Lane at bottom */}
          <rect x="30" y="420" width="540" height="65" rx="10" fill="white" fillOpacity="0.4" stroke="#E5E7EB" strokeWidth="1.5" />
          <rect x="30" y="420" width="32" height="65" rx="10" fill="#EEF2FF" fillOpacity="0.4" />
          <text x="46" y="458" textAnchor="middle" fontSize="8" fill="#818CF8" fontWeight="600" transform="rotate(-90 46 458)">Pool</text>
          <line x1="30" y1="452" x2="570" y2="452" stroke="#E5E7EB" strokeWidth="1" strokeDasharray="4 3" />
          <text x="80" y="440" fontSize="8" fill="#9CA3AF" fontFamily="Inter">Lane A</text>
          <text x="80" y="470" fontSize="8" fill="#9CA3AF" fontFamily="Inter">Lane B</text>

          {/* Timer Event */}
          <circle cx="500" y="360" cy="360" r="18" fill="#F0F9FF" stroke="#7DD3FC" strokeWidth="2" />
          <circle cx="500" cy="360" r="10" fill="none" stroke="#0EA5E9" strokeWidth="1.5" />
          <line x1="500" y1="354" x2="500" y2="360" stroke="#0EA5E9" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="500" y1="360" x2="504" y2="363" stroke="#0EA5E9" strokeWidth="1.5" strokeLinecap="round" />
          <text x="500" y="392" textAnchor="middle" fontSize="10" fill="#6B7280" fontFamily="Inter">Timer</text>

          {/* Data Object */}
          <path d="M480 440 L510 440 L520 450 L520 480 L480 480 Z" fill="white" fillOpacity="0.6" stroke="#D0D5DD" strokeWidth="1.5" />
          <path d="M510 440 L510 450 L520 450" fill="none" stroke="#D0D5DD" strokeWidth="1.5" />
          <text x="500" y="496" textAnchor="middle" fontSize="8" fill="#9CA3AF" fontFamily="Inter">Data</text>
        </svg>
      </div>
    </div>
  );
}

/* ─── Type color map ─── */
const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  string: { bg: "#EEF2FF", text: "#4F46E5", border: "#C7D2FE" },
  number: { bg: "#FFF7ED", text: "#EA580C", border: "#FDBA74" },
  boolean: { bg: "#F0FDF4", text: "#059669", border: "#A7F3D0" },
  date: { bg: "#FFF1F2", text: "#BE123C", border: "#FECDD3" },
  object: { bg: "#F5F3FF", text: "#7C3AED", border: "#DDD6FE" },
  array: { bg: "#F0F9FF", text: "#0284C7", border: "#BAE6FD" },
};

/* ─── Field Row (redesigned — card style) ─── */
function FieldRow({ field, depth, onChange, onRemove, onAddChild }: {
  field: FieldDef; depth: number;
  onChange: (id: string, partial: Partial<FieldDef>) => void;
  onRemove: (id: string) => void;
  onAddChild: (parentId: string, target: "children" | "items") => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasNested = field.type === "object" || field.type === "array";
  const nestedFields = field.type === "object" ? field.children : field.type === "array" ? field.items : null;
  const nestedTarget = field.type === "object" ? "children" : "items";
  const tc = TYPE_COLORS[field.type] || TYPE_COLORS.string;

  return (
    <div style={{ marginLeft: depth * 20 }}>
      {/* Card row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 10px", marginBottom: 4,
        borderRadius: 8, background: "#fff",
        border: "1px solid #F2F4F7",
        transition: "border-color 0.12s ease",
      }}>
        {/* Collapse chevron or nesting dot */}
        {hasNested ? (
          <button onClick={() => setCollapsed(!collapsed)} style={{
            width: 20, height: 20, borderRadius: 4, border: "none",
            background: "#F9FAFB", cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center", color: "#6B7280",
            flexShrink: 0, padding: 0,
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ transition: "transform 0.15s ease", transform: collapsed ? "rotate(-90deg)" : "rotate(0)" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        ) : depth > 0 ? (
          <div style={{ width: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#D0D5DD" }} />
          </div>
        ) : <div style={{ width: 20, flexShrink: 0 }} />}

        {/* Field name input */}
        <input
          type="text"
          value={field.name}
          onChange={(e) => onChange(field.id, { name: e.target.value })}
          placeholder="field name"
          style={{
            flex: 1, minWidth: 0, padding: "4px 0",
            border: "none", borderBottom: "1.5px solid transparent",
            fontSize: 13, color: "#111827", fontFamily: "'JetBrains Mono', monospace",
            outline: "none", background: "transparent",
            transition: "border-color 0.15s ease",
          }}
          onFocus={(e) => { e.currentTarget.style.borderBottomColor = "#C7D2FE"; }}
          onBlur={(e) => { e.currentTarget.style.borderBottomColor = "transparent"; }}
        />

        {/* Type badge (clickable dropdown) */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <select
            value={field.type}
            onChange={(e) => {
              const newType = e.target.value as FieldDef["type"];
              const update: Partial<FieldDef> = { type: newType };
              if (newType === "object") { update.children = field.children || []; update.items = undefined; }
              else if (newType === "array") { update.items = field.items || []; update.children = undefined; }
              else { update.children = undefined; update.items = undefined; }
              onChange(field.id, update);
            }}
            style={{
              padding: "3px 20px 3px 8px", borderRadius: 6,
              border: `1px solid ${tc.border}`, background: tc.bg,
              fontSize: 11, fontWeight: 600, color: tc.text,
              fontFamily: "inherit", outline: "none", cursor: "pointer",
              appearance: "none", WebkitAppearance: "none",
            }}
          >
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={tc.text} strokeWidth="2.5"
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {/* Required toggle */}
        <button
          onClick={() => onChange(field.id, { required: !field.required })}
          title={field.required ? "Required" : "Optional"}
          style={{
            padding: "2px 6px", borderRadius: 4, flexShrink: 0,
            border: "none", cursor: "pointer",
            background: field.required ? "#EEF2FF" : "transparent",
            fontSize: 10, fontWeight: 600,
            color: field.required ? "#4F46E5" : "#D0D5DD",
            transition: "all 0.12s ease",
          }}
        >
          {field.required ? "REQ" : "OPT"}
        </button>

        {/* Delete */}
        <button
          onClick={() => onRemove(field.id)}
          style={{
            width: 20, height: 20, borderRadius: 4, border: "none",
            background: "none", cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center",
            color: "#D0D5DD", padding: 0, flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#EF4444"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#D0D5DD"; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Nested children */}
      {hasNested && !collapsed && nestedFields && (
        <div style={{
          marginLeft: 10, paddingLeft: 10,
          borderLeft: `2px solid ${tc.border}`,
          marginBottom: 4,
        }}>
          {field.type === "array" && nestedFields.length === 0 && (
            <div style={{ fontSize: 10, color: "#9CA3AF", fontStyle: "italic", padding: "4px 0" }}>
              Define the structure of each array item
            </div>
          )}
          {nestedFields.map((child) => (
            <FieldRow key={child.id} field={child} depth={depth + 1}
              onChange={onChange} onRemove={onRemove} onAddChild={onAddChild} />
          ))}
          <button
            onClick={() => onAddChild(field.id, nestedTarget as "children" | "items")}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "4px 8px", border: "none", borderRadius: 4,
              background: "none", color: tc.text, fontSize: 11, fontWeight: 500,
              cursor: "pointer", fontFamily: "inherit", opacity: 0.7,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            + {field.type === "array" ? "item field" : "child"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Field Tree Builder ─── */
function FieldTreeBuilder({ fields, onChange }: { fields: FieldDef[]; onChange: (f: FieldDef[]) => void }) {
  const handleFieldChange = (id: string, partial: Partial<FieldDef>) => {
    onChange(updateFieldInTree(fields, id, (f) => ({ ...f, ...partial })));
  };
  const handleRemove = (id: string) => { onChange(removeFieldFromTree(fields, id)); };
  const handleAddChild = (parentId: string, target: "children" | "items") => { onChange(addFieldToParent(fields, parentId, target)); };
  const handleAddRoot = () => { onChange([...fields, createField()]); };

  return (
    <div>
      {fields.length === 0 && (
        <div style={{ padding: "24px 0", textAlign: "center" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D0D5DD" strokeWidth="1.5" style={{ margin: "0 auto 8px", display: "block" }}>
            <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
          </svg>
          <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 2 }}>No fields defined</div>
          <div style={{ fontSize: 11, color: "#D0D5DD" }}>Add fields below or import a template / paste JSON above</div>
        </div>
      )}
      {fields.map((f) => (
        <FieldRow key={f.id} field={f} depth={0}
          onChange={handleFieldChange} onRemove={handleRemove} onAddChild={handleAddChild} />
      ))}
      <button
        onClick={handleAddRoot}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          marginTop: 6, padding: "8px 12px",
          border: "1.5px dashed #D0D5DD", borderRadius: 8,
          background: "none", color: "#6B7280", fontSize: 12, fontWeight: 500,
          cursor: "pointer", fontFamily: "inherit", width: "100%",
          justifyContent: "center", transition: "all 0.15s ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#818CF8"; e.currentTarget.style.color = "#4F46E5"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#D0D5DD"; e.currentTarget.style.color = "#6B7280"; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        Add Field
      </button>
    </div>
  );
}

/* ─── Template type ─── */
type DocTemplate = { id: string; name: string; schema: Record<string, unknown>; createdAt: string };

/* ─── Unsaved Changes Dialog ─── */
function UnsavedChangesDialog({ onSave, onDiscard, onCancel, saving }: {
  onSave: () => void; onDiscard: () => void; onCancel: () => void; saving: boolean;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={onCancel} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }} />
      <div style={{
        position: "relative", background: "#fff", borderRadius: 14,
        padding: "28px 32px", width: 440, maxWidth: "90vw",
        boxShadow: "0 20px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)",
      }}>
        {/* Warning icon */}
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: "#FFF7ED", border: "1px solid #FED7AA",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 16,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Unsaved schema changes</h3>
        <p style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.6, marginBottom: 24 }}>
          You've modified the business document schema. Would you like to save your changes before leaving?
        </p>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onDiscard} style={{
            padding: "9px 18px", borderRadius: 8, border: "1px solid #E5E7EB",
            background: "#fff", color: "#374151", fontSize: 13, fontWeight: 500,
            cursor: "pointer", fontFamily: "inherit",
          }}>Discard Changes</button>
          <button onClick={onCancel} style={{
            padding: "9px 18px", borderRadius: 8, border: "1px solid #E5E7EB",
            background: "#fff", color: "#374151", fontSize: 13, fontWeight: 500,
            cursor: "pointer", fontFamily: "inherit",
          }}>Keep Editing</button>
          <button onClick={onSave} disabled={saving} style={{
            padding: "9px 22px", borderRadius: 8, border: "none",
            background: "linear-gradient(135deg, #4F46E5, #6366F1)",
            color: "#fff", fontSize: 13, fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit",
            boxShadow: "0 2px 8px rgba(79,70,229,0.25)",
          }}>{saving ? "Saving..." : "Save & Continue"}</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Step 2: Business Document — Smart Single View ─── */
function StepDocument() {
  const processId = useCanvasStore((s) => s.processId);
  const setWizardStep = useCanvasStore((s) => s.setWizardStep);
  const setProcessMeta = useCanvasStore((s) => s.setProcessMeta);
  const processMeta = useCanvasStore((s) => s.processMeta);
  const wizardOrigin = useCanvasStore((s) => s.wizardOrigin);
  const [expanded, setExpanded] = useState<"template" | "paste" | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [source, setSource] = useState<"template" | "paste" | "empty" | null>(null);
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [initialSchemaJson, setInitialSchemaJson] = useState<string>("");
  const [pendingNav, setPendingNav] = useState<"details" | "canvas" | null>(null);
  const [saving, setSaving] = useState(false);

  // Load templates from API
  useEffect(() => {
    apiGet<DocTemplate[]>("/processes/templates/list").then(setTemplates).catch(() => {});
    // If process already has a document, load it into fields
    if (processMeta.businessDoc) {
      const loadedFields = jsonToFields(processMeta.businessDoc);
      setFields(loadedFields);
      setSource(processMeta.businessDocSource || "paste");
      setInitialSchemaJson(JSON.stringify(fieldsToJson(loadedFields)));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const schemaJson = fieldsToJson(fields);
  const schemaStr = JSON.stringify(schemaJson, null, 2);
  const hasSchema = fields.length > 0 && fields.some((f) => f.name.trim());

  // Import from template
  const handleSelectDoc = (docId: string) => {
    setSelectedDoc(docId);
    const doc = templates.find((d) => d.id === docId);
    if (doc) {
      setFields(jsonToFields(doc.schema));
      setExpanded(null);
      setSource("template");
    }
  };

  // Import from pasted JSON
  const handleImportPaste = () => {
    if (!pasteText.trim()) return;
    try {
      const parsed = JSON.parse(pasteText);
      setFields(jsonToFields(parsed));
      setPasteError(null);
      setExpanded(null);
      setSelectedDoc(null);
      setSource("paste");
    } catch (e) {
      setPasteError((e as Error).message);
    }
  };

  // Field builder changes
  const handleFieldsChange = (f: FieldDef[]) => { setFields(f); };

  // Start empty
  const handleStartEmpty = () => {
    setFields([createField()]);
    setExpanded(null);
    setSelectedDoc(null);
    setSource("empty");
  };

  const [saveError, setSaveError] = useState<string | null>(null);

  const setDocumentDirty = useCanvasStore((s) => s.setDocumentDirty);
  const schemaChanged = JSON.stringify(schemaJson) !== initialSchemaJson;

  // Keep store in sync with dirty state
  useEffect(() => { setDocumentDirty(schemaChanged); return () => setDocumentDirty(false); }, [schemaChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSchema = async (): Promise<boolean> => {
    if (!processId) { setSaveError("Process not saved yet. Go back and save details first."); return false; }
    if (!hasSchema) { setSaveError("Add at least one named field before continuing."); return false; }
    setSaving(true);
    setSaveError(null);
    try {
      const sourceMap: Record<string, string> = { template: "TEMPLATE", paste: "PASTE", empty: "EMPTY" };
      await apiPut(`/processes/${processId}/document`, {
        schema: schemaJson,
        source: sourceMap[source || "empty"] || "EMPTY",
        templateId: source === "template" ? selectedDoc : undefined,
      });
      const doc = templates.find((d) => d.id === selectedDoc);
      setProcessMeta({ businessDoc: schemaJson, businessDocName: doc?.name || "Custom Schema", businessDocSource: source });
      setInitialSchemaJson(JSON.stringify(schemaJson));
      return true;
    } catch (e: any) {
      setSaveError(e?.message || "Failed to save document. Check if the API server is running.");
      console.error("Save document failed:", e);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const navigateTo = (target: "details" | "canvas") => {
    if (schemaChanged && initialSchemaJson) {
      setPendingNav(target);
    } else {
      setWizardStep(target);
    }
  };

  const handleOpenCanvas = async () => {
    if (!processId) { setSaveError("Process not saved yet. Go back and save details first."); return; }
    if (!schemaChanged && initialSchemaJson) {
      setWizardStep("canvas");
      return;
    }
    const ok = await saveSchema();
    if (ok) setWizardStep("canvas");
  };

  const handleDialogSave = async () => {
    const ok = await saveSchema();
    if (ok && pendingNav) {
      setWizardStep(pendingNav);
      setPendingNav(null);
    }
  };

  const handleDialogDiscard = () => {
    // Revert fields to the original schema
    if (processMeta.businessDoc) {
      setFields(jsonToFields(processMeta.businessDoc));
      setSource(processMeta.businessDocSource || "paste");
    }
    if (pendingNav) {
      setWizardStep(pendingNav);
      setPendingNav(null);
    }
  };

  const cardBtn = (icon: React.ReactNode, label: string, desc: string, isActive: boolean, onClick: () => void) => (
    <button onClick={onClick} style={{
      flex: 1, padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${isActive ? "#818CF8" : "#E5E7EB"}`,
      background: isActive ? "#EEF2FF" : "#fff", cursor: "pointer", fontFamily: "inherit",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
      transition: "all 0.15s ease", textAlign: "center",
    }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.borderColor = "#C7D2FE"; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.borderColor = isActive ? "#818CF8" : "#E5E7EB"; }}
    >
      <div style={{ color: isActive ? "#4F46E5" : "#6B7280" }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? "#4F46E5" : "#111827" }}>{label}</div>
      <div style={{ fontSize: 10, color: "#9CA3AF" }}>{desc}</div>
    </button>
  );

  return (
    <>
    {pendingNav && (
      <UnsavedChangesDialog
        saving={saving}
        onSave={handleDialogSave}
        onDiscard={handleDialogDiscard}
        onCancel={() => setPendingNav(null)}
      />
    )}
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr",
      height: "calc(100vh - 124px)", position: "relative", zIndex: 1,
    }}>
      {/* ═══ Left: Smart single view ═══ */}
      <div style={{
        borderRight: "1px solid #F2F4F7",
        background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)",
        display: "flex", flexDirection: "column",
        height: "100%", overflow: "hidden",
      }}>
        {/* Fixed header */}
        <div style={{ padding: "32px 36px 0 36px", flexShrink: 0 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Business Document</h2>
        <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 16, lineHeight: 1.5 }}>Define the data schema your process will work with.</div>

        {/* 3 option cards — active card shows which method was used */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {cardBtn(
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>,
            "Template", "From existing",
            expanded === "template" || (source === "template" && expanded === null),
            () => { setExpanded(expanded === "template" ? null : "template"); setFields([]); setSelectedDoc(null); setSource(null); setPasteText(""); setPasteError(null); },
          )}
          {cardBtn(
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>,
            "Paste JSON", "Import schema",
            expanded === "paste" || (source === "paste" && expanded === null),
            () => { setExpanded(expanded === "paste" ? null : "paste"); setFields([]); setSelectedDoc(null); setSource(null); setPasteText(""); setPasteError(null); },
          )}
          {cardBtn(
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
            "Start Empty", "Build from scratch",
            source === "empty" && expanded === null,
            handleStartEmpty,
          )}
        </div>

        {/* Expanded: Template picker */}
        {expanded === "template" && (
          <div style={{
            marginBottom: 12, padding: "10px", borderRadius: 10,
            background: "#F9FAFB", border: "1px solid #E5E7EB",
          }}>
            {templates.map((doc) => (
              <div key={doc.id} onClick={() => handleSelectDoc(doc.id)} style={{
                padding: "10px 12px", borderRadius: 8, marginBottom: 4,
                border: `1.5px solid ${selectedDoc === doc.id ? "#818CF8" : "transparent"}`,
                background: selectedDoc === doc.id ? "#EEF2FF" : "#fff",
                display: "flex", alignItems: "center", gap: 10,
                cursor: "pointer", transition: "all 0.12s ease",
              }}
                onMouseEnter={(e) => { if (selectedDoc !== doc.id) e.currentTarget.style.background = "#F3F4F6"; }}
                onMouseLeave={(e) => { if (selectedDoc !== doc.id) e.currentTarget.style.background = "#fff"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={selectedDoc === doc.id ? "#4F46E5" : "#9CA3AF"} strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{doc.name}</div>
                  <div style={{ fontSize: 10, color: "#9CA3AF" }}>{Object.keys(doc.schema || {}).length} fields</div>
                </div>
                {selectedDoc === doc.id && <span style={{ color: "#4F46E5", fontWeight: 700, fontSize: 13 }}>✓</span>}
              </div>
            ))}
            <div style={{ fontSize: 10, color: "#92400E", background: "#FFFBEB", padding: "6px 8px", borderRadius: 6, border: "1px solid #FDE68A", marginTop: 4 }}>
              Changes below won't affect the original template.
            </div>
          </div>
        )}

        {/* Expanded: Paste JSON */}
        {expanded === "paste" && (
          <div style={{
            marginBottom: 12, padding: "12px", borderRadius: 10,
            background: "#F9FAFB", border: "1px solid #E5E7EB",
          }}>
            <textarea
              value={pasteText}
              onChange={(e) => { setPasteText(e.target.value); setPasteError(null); }}
              placeholder={'{\n  "fieldName": "string",\n  "amount": "number"\n}'}
              style={{
                width: "100%", padding: "12px 14px", minHeight: 120, resize: "vertical",
                border: `1.5px solid ${pasteError ? "#FCA5A5" : "#E5E7EB"}`, borderRadius: 8,
                fontSize: 12, color: "#111827", fontFamily: "'JetBrains Mono', monospace",
                lineHeight: 1.7, outline: "none", background: "#fff",
              }}
            />
            {pasteError && (
              <div style={{ marginTop: 4, fontSize: 11, color: "#DC2626" }}>
                Invalid JSON: {pasteError.split(" at ")[0]}
              </div>
            )}
            <button onClick={handleImportPaste} style={{
              marginTop: 8, padding: "7px 16px", borderRadius: 6, border: "none",
              background: pasteText.trim() ? "linear-gradient(135deg, #4F46E5, #6366F1)" : "#E5E7EB",
              color: pasteText.trim() ? "#fff" : "#9CA3AF", fontSize: 12, fontWeight: 600,
              cursor: pasteText.trim() ? "pointer" : "not-allowed", fontFamily: "inherit",
            }}>Import into Fields ↓</button>
          </div>
        )}

        {/* Source badge with clear button */}
        {fields.length > 0 && !expanded && selectedDoc && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 10,
            padding: "4px 6px 4px 10px", borderRadius: 6, background: "#F0FDF4", border: "1px solid #A7F3D0",
            fontSize: 11, color: "#059669", fontWeight: 500, width: "fit-content",
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            From: {templates.find((d) => d.id === selectedDoc)?.name}
            <button
              onClick={() => { setFields([]); setSelectedDoc(null); setSource(null); }}
              title="Clear and start over"
              style={{
                width: 16, height: 16, borderRadius: 4, border: "none",
                background: "none", cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "center", color: "#6B7280",
                padding: 0, marginLeft: 2,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#DC2626"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#6B7280"; }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        </div>

        {/* ─── Scrollable Field Builder ─── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 36px" }}>
          <FieldTreeBuilder fields={fields} onChange={handleFieldsChange} />
        </div>

        {/* Fixed Footer */}
        <div style={{ flexShrink: 0, padding: "14px 36px", borderTop: "1px solid #F2F4F7" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={() => navigateTo("details")} style={{
              padding: "11px 20px", borderRadius: 10, border: "1.5px solid #E5E7EB",
              background: "#fff", color: "#374151", fontSize: 14, fontWeight: 500,
              cursor: "pointer", fontFamily: "inherit",
            }}>← Details</button>
            <button onClick={() => !saving && handleOpenCanvas()} style={{
              padding: "11px 32px", borderRadius: 10, border: "none",
              background: (hasSchema || initialSchemaJson) ? "linear-gradient(135deg, #4F46E5, #6366F1)" : "#E5E7EB",
              color: (hasSchema || initialSchemaJson) ? "#fff" : "#9CA3AF", fontSize: 14, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit",
              boxShadow: (hasSchema || initialSchemaJson) ? "0 4px 12px rgba(79,70,229,0.25)" : "none",
            }}>{saving ? "Saving..." : schemaChanged ? "Save & Open Canvas →" : wizardOrigin === "canvas" ? "Back to Canvas →" : "Open Canvas →"}</button>
          </div>
          {saveError && (
            <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", fontSize: 12 }}>
              {saveError}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Right: Read-only JSON Preview ═══ */}
      <div style={{ padding: "32px 32px", background: "rgba(249,250,251,0.8)", backdropFilter: "blur(8px)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Schema Preview</div>
          {hasSchema && (
            <span style={{ fontSize: 11, color: "#10B981", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
              {fields.filter((f) => f.name.trim()).length} fields
            </span>
          )}
        </div>

        <pre style={{
          flex: 1, minHeight: 200, margin: 0,
          background: "#1E293B", borderRadius: 12, padding: "20px 24px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12.5, lineHeight: 1.8, color: "#94A3B8",
          overflow: "auto", whiteSpace: "pre",
          border: "1.5px solid #334155",
        }}>
          {hasSchema ? schemaStr.split("\n").map((line, i) => {
            const parts = line.split(/("(?:[^"\\]|\\.)*")/g);
            return (
              <div key={i}>{parts.map((part, j) => {
                if (part.startsWith('"') && part.endsWith('"')) {
                  const rest = parts.slice(j + 1).join("");
                  if (rest.trimStart().startsWith(":")) return <span key={j} style={{ color: "#7DD3FC" }}>{part}</span>;
                  return <span key={j} style={{ color: "#86EFAC" }}>{part}</span>;
                }
                return <span key={j} style={{ color: "#64748B" }}>{part}</span>;
              })}</div>
            );
          }) : <span style={{ color: "#475569", fontStyle: "italic" }}>Schema will appear here as you define fields</span>}
        </pre>

        <div style={{ marginTop: 10, fontSize: 10, color: "#64748B", lineHeight: 1.5 }}>
          This preview updates live as you build fields.
          Supported types: {["string", "number", "boolean", "date", "object", "array"].map((t) => (
            <code key={t} style={{ color: "#94A3B8", marginRight: 3 }}>{t}</code>
          ))}
        </div>
      </div>
    </div>
    </>
  );
}

/* ─── Main Wizard ─── */
export default function ProcessWizard() {
  const wizardStep = useCanvasStore((s) => s.wizardStep);
  const setWizardStep = useCanvasStore((s) => s.setWizardStep);
  const processId = useCanvasStore((s) => s.processId);
  const stepIndex = wizardStep === "details" ? 0 : wizardStep === "document" ? 1 : 2;

  const handleStepClick = (i: number) => {
    const keys = ["details", "document", "canvas"] as const;
    setWizardStep(keys[i]);
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 20, background: "#F8FAFC", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Dot grid background */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, #C7D2FE 1.2px, transparent 1.2px)", backgroundSize: "28px 28px", opacity: 0.35, pointerEvents: "none" }} />
      {/* Radial glow */}
      <div style={{ position: "absolute", top: "10%", left: "50%", transform: "translateX(-50%)", width: 700, height: 500, background: "radial-gradient(ellipse, rgba(99,102,241,0.06) 0%, rgba(99,102,241,0.02) 40%, transparent 70%)", pointerEvents: "none", borderRadius: "50%" }} />

      <StepperBar currentIndex={stepIndex} onStepClick={handleStepClick} isExisting={!!processId} />

      <div style={{ flex: 1, overflow: "auto" }}>
        {wizardStep === "details" && <StepDetails />}
        {wizardStep === "document" && <StepDocument />}
      </div>
    </div>
  );
}
