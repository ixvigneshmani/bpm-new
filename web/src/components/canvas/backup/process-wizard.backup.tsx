import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import useCanvasStore from "../../store/canvas-store";

/* ─── Mock data ─── */
const MOCK_DOCS = [
  { id: "doc-1", name: "Vendor Registration Form", fields: 12, usedIn: 3, schema: { vendorName: "string", email: "string", phone: "string", category: "string", taxId: "string", bankDetails: { accountNo: "string", ifsc: "string" }, documents: [{ name: "string", url: "string" }], approved: "boolean" } },
  { id: "doc-2", name: "Invoice Data Schema", fields: 8, usedIn: 1, schema: { invoiceNo: "string", vendor: "string", amount: "number", date: "date", lineItems: [{ description: "string", qty: "number", price: "number" }], status: "string", approvedBy: "string", notes: "string" } },
  { id: "doc-3", name: "Employee Record", fields: 15, usedIn: 2, schema: { employeeId: "string", firstName: "string", lastName: "string", department: "string", role: "string", email: "string", joinDate: "date", manager: "string", salary: "number", address: { street: "string", city: "string", country: "string" }, active: "boolean" } },
];

/* ─── CSS connection line ─── */
function CLine({ left, top, width, height, dir = "h", active = false, delay = 0 }: {
  left: string; top: string; width?: string; height?: string; dir?: "h" | "v"; active?: boolean; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, delay }}
      style={{
        position: "absolute", left, top,
        width: dir === "h" ? (width || "10%") : 2,
        height: dir === "v" ? (height || "10%") : 2,
        background: active ? "transparent" : "#D0D5DD",
        backgroundImage: active
          ? dir === "h"
            ? "repeating-linear-gradient(90deg, #818CF8 0px, #818CF8 6px, transparent 6px, transparent 12px)"
            : "repeating-linear-gradient(180deg, #818CF8 0px, #818CF8 6px, transparent 6px, transparent 12px)"
          : "none",
        animation: active ? "flow-dash 0.8s linear infinite" : "none",
      }}
    />
  );
}

/* ─── BPMN Node component ─── */
function BpmnNode({ x, y, type, label, sublabel, glow, delay = 0 }: {
  x: number; y: number; type: "start" | "end" | "task" | "gateway" | "service" | "script" | "subprocess" | "pool";
  label: string; sublabel?: string; glow?: boolean; delay?: number;
}) {
  const nodeContent = (() => {
    switch (type) {
      case "start":
        return (
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: "linear-gradient(135deg, #F0FDF4, #DCFCE7)",
            border: "2px solid #86EFAC",
            display: "flex", alignItems: "center", justifyContent: "center",
            ...(glow ? { animation: "soft-glow 2.5s ease-in-out infinite" } : {}),
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#16A34A"><polygon points="9,5 19,12 9,19" /></svg>
          </div>
        );
      case "end":
        return (
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: "linear-gradient(135deg, #FEF2F2, #FEE2E2)",
            border: "3px solid #FCA5A5",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ width: 14, height: 14, borderRadius: 2, background: "#DC2626" }} />
          </div>
        );
      case "gateway":
        return (
          <div style={{
            width: 44, height: 44, transform: "rotate(45deg)",
            background: "linear-gradient(135deg, #FFFBEB, #FEF3C7)",
            border: "2px solid #FDE68A", borderRadius: 5,
            display: "flex", alignItems: "center", justifyContent: "center",
            ...(glow ? { animation: "soft-glow 2.5s ease-in-out infinite" } : {}),
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#CA8A04" strokeWidth="2.5" strokeLinecap="round" style={{ transform: "rotate(-45deg)" }}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
        );
      case "task":
        return (
          <div style={{
            padding: "10px 20px", background: "linear-gradient(135deg, #EEF2FF, #E0E7FF)",
            border: "1.5px solid #C7D2FE", borderRadius: 10,
            ...(glow ? { animation: "soft-glow 2.5s ease-in-out infinite" } : {}),
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#4F46E5" }}>{label}</div>
            {sublabel && <div style={{ fontSize: 9, color: "#818CF8", marginTop: 1 }}>{sublabel}</div>}
          </div>
        );
      case "service":
        return (
          <div style={{
            padding: "10px 20px",
            background: "linear-gradient(135deg, #FFF7ED, #FFEDD5)",
            border: "1.5px solid #FDBA74", borderRadius: 10,
            ...(glow ? { animation: "soft-glow 2.5s ease-in-out infinite" } : {}),
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#EA580C" }}>{label}</div>
            {sublabel && <div style={{ fontSize: 9, color: "#FB923C", marginTop: 1 }}>{sublabel}</div>}
          </div>
        );
      case "script":
        return (
          <div style={{
            padding: "10px 20px", background: "linear-gradient(135deg, #F0F9FF, #E0F2FE)",
            border: "1.5px solid #BAE6FD", borderRadius: 10,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#0284C7" }}>{label}</div>
            {sublabel && <div style={{ fontSize: 9, color: "#38BDF8", marginTop: 1 }}>{sublabel}</div>}
          </div>
        );
      case "subprocess":
        return (
          <div style={{
            padding: "10px 20px", background: "rgba(249,250,251,0.7)",
            border: "1.5px dashed #D0D5DD", borderRadius: 10,
          }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#475467" }}>{label}</div>
          </div>
        );
      default: return null;
    }
  })();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay, ease: [0.4, 0, 0.2, 1] }}
      style={{ position: "absolute", left: `${x}%`, top: `${y}%` }}
    >
      {/* Pulse ring for glowing elements */}
      {glow && (
        <div style={{
          position: "absolute", left: "50%", top: "50%",
          width: 60, height: 60, borderRadius: "50%",
          border: "2px solid rgba(99,102,241,0.3)",
          animation: "ring-pulse 2s ease-out infinite",
          pointerEvents: "none",
        }} />
      )}
      {nodeContent}
      {type !== "task" && type !== "service" && type !== "script" && type !== "subprocess" && (
        <div style={{ fontSize: 9, color: "#6B7280", textAlign: "center", marginTop: 4, fontWeight: 500 }}>{label}</div>
      )}
    </motion.div>
  );
}

/* ─── BPMN Canvas Background ─── */
function CanvasBackground({ step }: { step: string }) {
  const isStep1 = step === "details";
  return (
    <>
      {/* Dot grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "radial-gradient(circle, #A5B4FC 1.2px, transparent 1.2px)",
        backgroundSize: "28px 28px", opacity: 0.25,
      }} />

      {/* CSS connection lines — pushed down to avoid stepper overlap */}
      {/* Start → Review */}
      <CLine left="8%" top="28%" width="9%" active={isStep1} delay={0.1} />
      {/* Review → Gateway */}
      <CLine left="30%" top="28%" width="9%" active={isStep1} delay={0.15} />
      {/* Gateway → Approve */}
      <CLine left="45%" top="28%" width="8%" active={isStep1} delay={0.2} />
      {/* Approve → End */}
      <CLine left="66%" top="28%" width="9%" delay={0.25} />
      {/* Gateway down → Service */}
      <CLine left="41%" top="33%" height="18%" dir="v" active={!isStep1} delay={0.3} />
      {/* Service → Script */}
      <CLine left="59%" top="56%" width="8%" active={!isStep1} delay={0.35} />

      {/* BPMN Nodes — pushed down 10% to clear stepper */}
      <BpmnNode x={3} y={24} type="start" label="Start" delay={0.1} />
      <BpmnNode x={17} y={21} type="task" label="Review" sublabel="User Task" delay={0.15} glow={isStep1} />
      <BpmnNode x={39} y={20} type="gateway" label="Decision" delay={0.2} glow={isStep1} />
      <BpmnNode x={53} y={21} type="task" label="Approve" sublabel="User Task" delay={0.25} />
      <BpmnNode x={76} y={24} type="end" label="End" delay={0.3} />
      <BpmnNode x={46} y={50} type="service" label="Notify Team" sublabel="Service Task" delay={0.35} glow={!isStep1} />
      <BpmnNode x={67} y={50} type="script" label="Archive" sublabel="Script Task" delay={0.4} glow={!isStep1} />
      <BpmnNode x={10} y={62} type="subprocess" label="Error Handling" delay={0.45} />

      {/* Pool/Lane */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.5 }}
        style={{
          position: "absolute", left: "3%", top: "78%", right: "3%", height: 50,
          border: "1.5px solid #E5E7EB", borderRadius: 10,
          background: "rgba(249,250,251,0.3)",
        }}
      >
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 26,
          background: "rgba(238,242,255,0.5)", borderRadius: "10px 0 0 10px",
          display: "flex", alignItems: "center", justifyContent: "center",
          writingMode: "vertical-rl", fontSize: 8, color: "#818CF8", fontWeight: 600,
        }}>Pool</div>
      </motion.div>
    </>
  );
}

/* ─── Stepper ─── */
function Stepper({ step, onStepClick }: { step: number; onStepClick: (s: number) => void }) {
  const labels = ["Details", "Business Doc", "Canvas"];
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      style={{
        position: "absolute", top: 14, zIndex: 30,
        left: 0, right: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center",
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)",
        padding: "8px 22px", borderRadius: 12,
        border: "1px solid rgba(229,231,235,0.6)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
      }}>
      {labels.map((label, i) => {
        const isDone = i + 1 < step;
        const isActive = i + 1 === step;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center" }}>
            <div
              onClick={() => isDone && onStepClick(i + 1)}
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: isDone ? "pointer" : "default" }}
            >
              <motion.div
                animate={{
                  background: isDone ? "#10B981" : isActive ? "#4F46E5" : "#F3F4F6",
                  borderColor: isDone ? "#10B981" : isActive ? "#4F46E5" : "#E5E7EB",
                  scale: isActive ? 1.05 : 1,
                }}
                transition={{ duration: 0.3 }}
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700,
                  color: isDone || isActive ? "#fff" : "#9CA3AF",
                  border: "2px solid #E5E7EB",
                }}
              >
                {isDone ? "✓" : i + 1}
              </motion.div>
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: isDone ? "#10B981" : isActive ? "#111827" : "#9CA3AF",
                transition: "color 0.3s ease",
              }}>{label}</span>
            </div>
            {i < 2 && (
              <motion.div
                animate={{ background: isDone ? "#A7F3D0" : isActive ? "#C7D2FE" : "#E5E7EB" }}
                transition={{ duration: 0.4 }}
                style={{ width: 50, height: 2, margin: "0 14px", borderRadius: 1 }}
              />
            )}
          </div>
        );
      })}
      </div>
    </motion.div>
  );
}

/* ─── Spotlight Overlay ─── */
function SpotlightOverlay({ focusX, focusY }: { focusX: string; focusY: string }) {
  return (
    <motion.div
      animate={{
        background: `radial-gradient(ellipse 550px 450px at ${focusX} ${focusY}, transparent 0%, rgba(15,23,42,0.6) 100%)`,
      }}
      transition={{ duration: 1, ease: [0.4, 0, 0.2, 1] }}
      style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}
    />
  );
}

/* ─── Glassmorphism card wrapper with 3D ─── */
function WizardCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, rotateX: 6, scale: 0.96, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -20, rotateX: -4, scale: 0.96, filter: "blur(3px)" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "absolute", zIndex: 20,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.6)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.8)",
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

/* ─── Step 1: Process Details ─── */
function StepDetails({ onNext }: { onNext: () => void }) {
  const processMeta = useCanvasStore((s) => s.processMeta);
  const setProcessMeta = useCanvasStore((s) => s.setProcessMeta);
  const canContinue = processMeta.name.trim().length > 0;

  const inputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "#818CF8";
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.08)";
  };
  const inputBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "#E5E7EB";
    e.currentTarget.style.boxShadow = "none";
  };

  return (
    <WizardCard style={{ left: "32%", top: "24%", width: 380, padding: "26px 26px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: "linear-gradient(135deg, #EEF2FF, #E0E7FF)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 8px rgba(99,102,241,0.12)",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="1.5" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>Create new process</div>
          <div style={{ fontSize: 12, color: "#9CA3AF" }}>Step 1 of 2</div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 5, display: "block" }}>Process Name *</label>
        <input
          type="text"
          value={processMeta.name}
          onChange={(e) => setProcessMeta({ name: e.target.value })}
          placeholder="e.g. Vendor Onboarding"
          autoFocus
          style={{
            width: "100%", padding: "11px 14px",
            border: "1.5px solid #E5E7EB", borderRadius: 10,
            fontSize: 14, color: "#111827", fontFamily: "inherit", outline: "none",
            background: "#fff", transition: "all 0.15s ease",
          }}
          onFocus={inputFocus} onBlur={inputBlur}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 5, display: "block" }}>Description</label>
        <textarea
          value={processMeta.description}
          onChange={(e) => setProcessMeta({ description: e.target.value })}
          placeholder="What does this process do?"
          style={{
            width: "100%", padding: "11px 14px", minHeight: 80, resize: "vertical",
            border: "1.5px solid #E5E7EB", borderRadius: 10,
            fontSize: 13, color: "#111827", fontFamily: "inherit", outline: "none",
            background: "#fff", transition: "all 0.15s ease",
          }}
          onFocus={inputFocus} onBlur={inputBlur}
        />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button style={{
          padding: "10px 18px", borderRadius: 10,
          border: "1.5px solid #E5E7EB", background: "rgba(255,255,255,0.8)",
          color: "#374151", fontSize: 13, fontWeight: 500,
          cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s ease",
        }}>Cancel</button>
        <button
          onClick={() => canContinue && onNext()}
          style={{
            flex: 1, padding: "10px 18px", borderRadius: 10, border: "none",
            background: canContinue ? "linear-gradient(135deg, #4F46E5, #6366F1)" : "#E5E7EB",
            color: canContinue ? "#fff" : "#9CA3AF",
            fontSize: 13, fontWeight: 600,
            cursor: canContinue ? "pointer" : "not-allowed",
            fontFamily: "inherit",
            boxShadow: canContinue ? "0 4px 16px rgba(79,70,229,0.3)" : "none",
            transition: "all 0.2s ease",
          }}
        >Continue →</button>
      </div>
    </WizardCard>
  );
}

/* ─── Step 2: Business Document ─── */
function StepDocument({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const setProcessMeta = useCanvasStore((s) => s.setProcessMeta);
  const [tab, setTab] = useState<"existing" | "json" | "build">("existing");
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [jsonInput, setJsonInput] = useState("");

  const selectedSchema = MOCK_DOCS.find((d) => d.id === selectedDoc)?.schema;
  const schemaToShow = tab === "existing" ? selectedSchema : tab === "json" ? (() => { try { return JSON.parse(jsonInput); } catch { return null; } })() : null;
  const canContinue = tab === "existing" ? !!selectedDoc : tab === "json" ? !!schemaToShow : false;

  const handleOpenCanvas = () => {
    const doc = MOCK_DOCS.find((d) => d.id === selectedDoc);
    setProcessMeta({ businessDoc: schemaToShow || null, businessDocName: doc?.name || "Custom Schema" });
    onNext();
  };

  return (
    <WizardCard style={{
      left: "4%", top: "10%",
      width: "min(88%, 760px)", maxHeight: "80%",
      display: "grid", gridTemplateColumns: "1fr 1fr",
      padding: 0, overflow: "hidden",
    }}>
      {/* Left: selector */}
      <div style={{ padding: "24px 24px 20px", borderRight: "1px solid #F2F4F7", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: "linear-gradient(135deg, #F0FDF4, #DCFCE7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(16,185,129,0.12)",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>Business Document</div>
            <div style={{ fontSize: 12, color: "#9CA3AF" }}>Step 2 of 2</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "2px solid #F2F4F7" }}>
          {([["existing", "Existing"], ["json", "Paste JSON"], ["build", "Build"]] as const).map(([key, label]) => (
            <button
              key={key} onClick={() => setTab(key)}
              style={{
                padding: "7px 14px", border: "none", background: "none",
                fontSize: 12, fontWeight: tab === key ? 600 : 500,
                color: tab === key ? "#4F46E5" : "#9CA3AF",
                borderBottom: tab === key ? "2px solid #4F46E5" : "2px solid transparent",
                marginBottom: -2, cursor: "pointer", fontFamily: "inherit",
              }}
            >{label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {tab === "existing" && MOCK_DOCS.map((doc, i) => (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.08 }}
              onClick={() => setSelectedDoc(doc.id)}
              style={{
                padding: "12px 14px", borderRadius: 10, marginBottom: 8,
                border: `1.5px solid ${selectedDoc === doc.id ? "#818CF8" : "#E5E7EB"}`,
                background: selectedDoc === doc.id ? "#EEF2FF" : "#fff",
                display: "flex", alignItems: "center", gap: 10,
                cursor: "pointer", transition: "all 0.15s ease",
              }}
            >
              <div style={{
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                background: selectedDoc === doc.id ? "#EEF2FF" : "#F3F4F6",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={selectedDoc === doc.id ? "#4F46E5" : "#6B7280"} strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{doc.name}</div>
                <div style={{ fontSize: 10, color: "#6B7280", marginTop: 1 }}>{doc.fields} fields · {doc.usedIn} process{doc.usedIn !== 1 ? "es" : ""}</div>
              </div>
              {selectedDoc === doc.id && <span style={{ color: "#4F46E5", fontWeight: 700, fontSize: 14 }}>✓</span>}
            </motion.div>
          ))}

          {tab === "json" && (
            <textarea
              value={jsonInput} onChange={(e) => setJsonInput(e.target.value)}
              placeholder={'{ "fieldName": "dataType", ... }'}
              style={{
                width: "100%", padding: "12px 14px", minHeight: 180, resize: "vertical",
                border: "1.5px solid #E5E7EB", borderRadius: 10,
                fontSize: 12, color: "#111827", fontFamily: "'JetBrains Mono', monospace",
                lineHeight: 1.7, outline: "none", background: "#F9FAFB",
              }}
            />
          )}

          {tab === "build" && (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>
              Field builder coming soon — use "Paste JSON" for now.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, paddingTop: 14, borderTop: "1px solid #F2F4F7" }}>
          <button onClick={onBack} style={{
            padding: "10px 16px", borderRadius: 10,
            border: "1.5px solid #E5E7EB", background: "rgba(255,255,255,0.8)",
            color: "#374151", fontSize: 13, fontWeight: 500,
            cursor: "pointer", fontFamily: "inherit",
          }}>← Back</button>
          <button
            onClick={() => canContinue && handleOpenCanvas()}
            style={{
              flex: 1, padding: "10px 16px", borderRadius: 10, border: "none",
              background: canContinue ? "linear-gradient(135deg, #4F46E5, #6366F1)" : "#E5E7EB",
              color: canContinue ? "#fff" : "#9CA3AF",
              fontSize: 13, fontWeight: 600,
              cursor: canContinue ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              boxShadow: canContinue ? "0 4px 16px rgba(79,70,229,0.3)" : "none",
            }}
          >Open Canvas →</button>
        </div>
      </div>

      {/* Right: schema preview */}
      <div style={{ padding: "24px 24px 20px", background: "rgba(249,250,251,0.6)", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 12 }}>Schema Preview</div>
        <pre style={{
          flex: 1, minHeight: 160,
          background: "#1E293B", borderRadius: 12, padding: "18px 20px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11.5, lineHeight: 1.8, color: "#94A3B8",
          overflow: "auto", whiteSpace: "pre", margin: 0,
          boxShadow: "inset 0 2px 8px rgba(0,0,0,0.1)",
        }}>
          {schemaToShow ? JSON.stringify(schemaToShow, null, 2)
            .split("\n").map((line, i) => {
              const parts = line.split(/("(?:[^"\\]|\\.)*")/g);
              return (
                <div key={i}>
                  {parts.map((part, j) => {
                    if (part.startsWith('"') && part.endsWith('"')) {
                      const rest = parts.slice(j + 1).join("");
                      if (rest.trimStart().startsWith(":"))
                        return <span key={j} style={{ color: "#7DD3FC" }}>{part}</span>;
                      return <span key={j} style={{ color: "#86EFAC" }}>{part}</span>;
                    }
                    return <span key={j} style={{ color: "#64748B" }}>{part}</span>;
                  })}
                </div>
              );
            }) : (
            <span style={{ color: "#475569", fontStyle: "italic" }}>Select a document or paste JSON to preview</span>
          )}
        </pre>
        {selectedDoc && tab === "existing" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{
              marginTop: 12, padding: "10px 14px", borderRadius: 10,
              background: "#EEF2FF", border: "1px solid #C7D2FE",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: "#4F46E5", marginBottom: 2 }}>📄 Selected</div>
            <div style={{ fontSize: 11, color: "#475467", lineHeight: 1.4 }}>
              {MOCK_DOCS.find((d) => d.id === selectedDoc)?.name}
            </div>
          </motion.div>
        )}
      </div>
    </WizardCard>
  );
}

/* ─── Main Wizard ─── */
export default function ProcessWizard() {
  const wizardStep = useCanvasStore((s) => s.wizardStep);
  const setWizardStep = useCanvasStore((s) => s.setWizardStep);

  const stepNum = wizardStep === "details" ? 1 : wizardStep === "document" ? 2 : 3;
  const spotlightPos = wizardStep === "details"
    ? { x: "55%", y: "35%" }
    : { x: "30%", y: "55%" };

  const handleStepClick = (s: number) => {
    const keys = ["details", "document", "canvas"] as const;
    setWizardStep(keys[s - 1]);
  };

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 20,
      background: "#F8FAFC",
      overflow: "hidden",
      perspective: 1200,
    }}>
      {/* Camera pan + 3D tilt — canvas shifts per step */}
      <motion.div
        animate={{
          x: wizardStep === "details" ? 0 : wizardStep === "document" ? -100 : 0,
          y: wizardStep === "details" ? 0 : wizardStep === "document" ? -60 : 0,
          scale: wizardStep === "canvas" ? 0.85 : 1,
          rotateY: wizardStep === "details" ? 0 : wizardStep === "document" ? 1.5 : 0,
          rotateX: wizardStep === "details" ? 0 : wizardStep === "document" ? 0.5 : 0,
        }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        style={{ position: "absolute", inset: -80, transformOrigin: "center center", transformStyle: "preserve-3d" }}
      >
        <CanvasBackground step={wizardStep} />
      </motion.div>

      <SpotlightOverlay focusX={spotlightPos.x} focusY={spotlightPos.y} />
      <Stepper step={stepNum} onStepClick={handleStepClick} />

      <AnimatePresence mode="wait">
        {wizardStep === "details" && (
          <StepDetails key="step-details" onNext={() => setWizardStep("document")} />
        )}
        {wizardStep === "document" && (
          <StepDocument key="step-document" onNext={() => setWizardStep("canvas")} onBack={() => setWizardStep("details")} />
        )}
      </AnimatePresence>
    </div>
  );
}
