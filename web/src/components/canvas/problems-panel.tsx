/* ─── Problems Panel ──────────────────────────────────────────────────
 * Bottom-docked panel listing validation issues in the current canvas.
 * Click an issue to select the offending node. The trigger lives as a
 * floating chip in the bottom-left so users see the count even when
 * the panel is collapsed.
 * ──────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from "react";
import useCanvasStore from "../../store/canvas-store";
import { useValidationIssues } from "../../store/validation-hook";
import type { IssueSeverity } from "../../lib/validation/types";

type SeverityFilter = "all" | IssueSeverity;

const SEVERITY_STYLE: Record<IssueSeverity, { color: string; bg: string; icon: string }> = {
  error: { color: "#B42318", bg: "#FEE4E2", icon: "✕" },
  warning: { color: "#B54708", bg: "#FEF0C7", icon: "!" },
  info: { color: "#175CD3", bg: "#D1E9FF", icon: "i" },
};

export default function ProblemsPanel() {
  const issues = useValidationIssues();
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const selectEdge = useCanvasStore((s) => s.selectEdge);
  const open = useCanvasStore((s) => s.problemsPanelOpen);
  const setOpen = useCanvasStore((s) => s.setProblemsPanelOpen);
  const focusedIssueId = useCanvasStore((s) => s.focusedIssueId);
  const clearFocusedIssue = useCanvasStore((s) => s.clearFocusedIssue);

  // Sweep-B cleanup #10 — severity filter when issue lists get long.
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const filteredIssues = useMemo(
    () => (severityFilter === "all" ? issues : issues.filter((i) => i.severity === severityFilter)),
    [issues, severityFilter],
  );

  // Sweep-B cleanup #11 — Cmd/Ctrl+Shift+M toggles the Problems panel,
  // matching VS Code / IntelliJ / Camunda conventions.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "m") return;
      if (!e.shiftKey) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      // Bail if the user is typing into a form field — Cmd+Shift+M
      // shouldn't fight Slack-style keystrokes inside an input.
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      e.preventDefault();
      setOpen(!open);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  const issueRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  useEffect(() => {
    if (!open || !focusedIssueId) return;
    const el = issueRefs.current.get(focusedIssueId);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const prev = el.style.background;
    el.style.background = "#FEF3C7";
    const t = window.setTimeout(() => {
      el.style.background = prev;
      clearFocusedIssue();
    }, 1400);
    return () => window.clearTimeout(t);
  }, [open, focusedIssueId, clearFocusedIssue]);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  // Floating trigger chip — always visible in the bottom-left
  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      title={`${issues.length} problem${issues.length === 1 ? "" : "s"}`}
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        background: "#fff",
        border: `1px solid ${errorCount > 0 ? "#FDA29B" : warningCount > 0 ? "#FEC84B" : "#E5E7EB"}`,
        borderRadius: 999,
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 500,
        color: errorCount > 0 ? "#B42318" : warningCount > 0 ? "#B54708" : "#475467",
        fontFamily: "inherit",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      {issues.length === 0 ? (
        <span>No problems</span>
      ) : (
        <>
          {errorCount > 0 && <span>{errorCount} error{errorCount === 1 ? "" : "s"}</span>}
          {errorCount > 0 && warningCount > 0 && <span style={{ opacity: 0.5 }}>·</span>}
          {warningCount > 0 && <span>{warningCount} warning{warningCount === 1 ? "" : "s"}</span>}
        </>
      )}
    </button>
  );

  if (!open) return trigger;

  return (
    <>
      {trigger}
      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: 56,
          zIndex: 11,
          width: 420,
          maxHeight: "50%",
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderBottom: "1px solid #F2F4F7",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#101828" }}>
              Problems <span style={{ color: "#98A2B3", fontWeight: 500 }}>({issues.length})</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {(["all", "error", "warning", "info"] as SeverityFilter[]).map((f) => {
                const count =
                  f === "all" ? issues.length : issues.filter((i) => i.severity === f).length;
                const active = severityFilter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSeverityFilter(f)}
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: `1px solid ${active ? "#818cf8" : "#E5E7EB"}`,
                      background: active ? "#eef2ff" : "#fff",
                      color: active ? "#4f46e5" : "#667085",
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "capitalize",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                    title={`Show ${f}`}
                  >
                    {f} {count > 0 && <span style={{ opacity: 0.7 }}>{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "#98A2B3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Close"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Issue list */}
        <div style={{ overflowY: "auto", padding: "4px 0" }}>
          {filteredIssues.length === 0 ? (
            <div style={{ padding: "24px 14px", textAlign: "center", fontSize: 12, color: "#98A2B3" }}>
              {issues.length === 0
                ? "This canvas has no validation issues."
                : `No ${severityFilter} issues. Clear the filter to see all ${issues.length}.`}
            </div>
          ) : (
            filteredIssues.map((issue) => {
              const s = SEVERITY_STYLE[issue.severity];
              const clickable = Boolean(issue.nodeId || issue.edgeId);
              return (
                <button
                  key={issue.id}
                  ref={(el) => {
                    if (el) issueRefs.current.set(issue.id, el);
                    else issueRefs.current.delete(issue.id);
                  }}
                  type="button"
                  disabled={!clickable}
                  onClick={() => {
                    if (issue.nodeId) setSelectedNode(issue.nodeId);
                    else if (issue.edgeId) selectEdge(issue.edgeId);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    width: "100%",
                    padding: "8px 14px",
                    border: "none",
                    background: "transparent",
                    textAlign: "left",
                    cursor: clickable ? "pointer" : "default",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => clickable && (e.currentTarget.style.background = "#F9FAFB")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: s.bg,
                      color: s.color,
                      fontSize: 11,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 1,
                    }}
                  >
                    {s.icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "#344054", lineHeight: "16px" }}>{issue.message}</div>
                    <div style={{ fontSize: 10, color: "#98A2B3", marginTop: 2 }}>{issue.ruleId}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
