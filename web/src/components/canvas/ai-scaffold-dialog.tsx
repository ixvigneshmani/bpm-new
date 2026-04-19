/* ─── AI Scaffold Dialog ─────────────────────────────────────────────
 * Modal: user types a plain-language process description, backend
 * calls Claude with a structured-output tool, and we get back a
 * canvas-ready {nodes, edges} payload. User previews the AI's notes,
 * then applies (replacing the current canvas) or regenerates.
 *
 * Deliberate choices for the v1 UX:
 *  - Apply fully replaces the canvas. Merging with existing nodes
 *    risks collisions + confusing layout; a "regenerate in place"
 *    flow is a follow-up.
 *  - We surface the AI's `notes` so the user has a readable summary
 *    before the canvas changes. No diff UI yet.
 * ──────────────────────────────────────────────────────────────────── */

import { useState, type CSSProperties } from "react";
import type { Node, Edge } from "@xyflow/react";
import useCanvasStore from "../../store/canvas-store";
import { apiPost } from "../../lib/api";

type ScaffoldResponse = {
  processName: string;
  processDescription: string;
  nodes: Node[];
  edges: Edge[];
  notes: string;
};

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(16, 24, 40, 0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 100,
};

const cardStyle: CSSProperties = {
  width: "min(720px, calc(100vw - 48px))",
  maxHeight: "calc(100vh - 80px)",
  background: "#fff",
  borderRadius: 14,
  boxShadow: "0 20px 50px rgba(16, 24, 40, 0.25)",
  display: "flex", flexDirection: "column",
  overflow: "hidden",
};

type Props = { onClose: () => void };

export default function AiScaffoldDialog({ onClose }: Props) {
  const loadCanvasData = useCanvasStore((s) => s.loadCanvasData);
  const setProcessMeta = useCanvasStore((s) => s.setProcessMeta);
  const setDocumentDirty = useCanvasStore((s) => s.setDocumentDirty);
  const businessDoc = useCanvasStore((s) => s.processMeta.businessDoc);

  const [description, setDescription] = useState("");
  const [result, setResult] = useState<ScaffoldResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canGenerate = description.trim().length >= 8 && !busy;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<ScaffoldResponse>("/ai/scaffold-process", {
        description,
        ...(businessDoc ? { businessDocSchema: businessDoc } : {}),
      });
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!result) return;
    loadCanvasData(result.nodes, result.edges);
    if (result.processName) {
      setProcessMeta({ name: result.processName, description: result.processDescription || "" });
    }
    setDocumentDirty(true);
    onClose();
  }

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={cardStyle} onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: "20px 28px 16px",
          borderBottom: "1px solid #f2f4f7",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#101828", display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden>✨</span> AI Process Scaffold
            </div>
            <div style={{ fontSize: 12, color: "#667085", marginTop: 2 }}>
              Describe the process in plain language — Claude drafts the nodes, flows, and gateways.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#667085" }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: "18px 28px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#98a2b3", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Example: 3-step invoice approval with manager review, finance check for amounts over $1000, and director sign-off. Escalate if no response in 48h."
              rows={5}
              style={{
                width: "100%", padding: "10px 12px",
                borderRadius: 8, border: "1px solid #E5E7EB",
                fontSize: 13, fontFamily: "inherit", color: "#101828",
                outline: "none", resize: "vertical",
                lineHeight: 1.45,
              }}
              disabled={busy}
            />
            <span style={{ fontSize: 10, color: "#98a2b3" }}>
              {businessDoc
                ? "Business document schema is attached — Claude will use your real variable names."
                : "Tip: attach a business document first to get richer gateway conditions."}
            </span>
          </label>

          {error && (
            <div style={{
              padding: "8px 12px", borderRadius: 6,
              background: "#FEE4E2", color: "#B42318",
              fontSize: 12, lineHeight: 1.4,
            }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{
              padding: "12px 14px", borderRadius: 8,
              background: "#F8FAFC", border: "1px solid #E5E7EB",
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#101828" }}>
                {result.processName || "Scaffold ready"}
              </div>
              <div style={{ fontSize: 11, color: "#475467", lineHeight: 1.5 }}>
                {result.notes}
              </div>
              <div style={{ fontSize: 10, color: "#667085", display: "flex", gap: 12 }}>
                <span>{result.nodes.length} node(s)</span>
                <span>{result.edges.length} edge(s)</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 28px",
          borderTop: "1px solid #f2f4f7",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 12,
        }}>
          <div style={{ fontSize: 10, color: "#98a2b3" }}>
            {result ? "Applying replaces the current canvas." : ""}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={btnStyle("ghost")}
              disabled={busy}
            >
              Cancel
            </button>
            {!result ? (
              <button
                type="button"
                onClick={generate}
                disabled={!canGenerate}
                style={btnStyle("primary", !canGenerate)}
              >
                {busy ? "Generating…" : "Generate"}
              </button>
            ) : (
              <>
                <button type="button" onClick={generate} disabled={busy} style={btnStyle("ghost", busy)}>
                  {busy ? "Regenerating…" : "Regenerate"}
                </button>
                <button type="button" onClick={apply} style={btnStyle("primary")}>
                  Apply to canvas
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function btnStyle(variant: "primary" | "ghost", disabled = false): CSSProperties {
  const base: CSSProperties = {
    padding: "8px 14px", borderRadius: 6,
    fontSize: 12, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.15s ease",
    fontFamily: "inherit",
    opacity: disabled ? 0.6 : 1,
  };
  if (variant === "primary") {
    return {
      ...base,
      background: "#4F46E5", color: "#fff", border: "1px solid #4F46E5",
    };
  }
  return {
    ...base,
    background: "#fff", color: "#344054", border: "1px solid #E5E7EB",
  };
}
