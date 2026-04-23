/* ─── Step-scoped business document snapshot ─────────────────────────
 * For the selected node on the instance canvas, reconstruct the
 * variable bag as it looked at ENTRY to the step and (if the step
 * completed) at EXIT, plus a diff of what changed. Derived entirely
 * from the audit trail — no new API needed.
 *
 * Why this is novel: Camunda Cockpit and Zeebe Operate show either
 * the current variables or historic scope variables, but never "here's
 * exactly what the business document looked like when the token
 * entered task-2." Operators today have to correlate events + variable
 * changes across tabs. This puts the answer one click away.
 * ──────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";

type Event = {
  id: string;
  eventType: string;
  nodeId: string | null;
  userId: string | null;
  payload: unknown;
  createdAt: string;
};

export default function StepSnapshot(props: {
  nodeId: string;
  events: Event[];
  /** Fallback — usually equals the variables field of the running
   *  instance. Only used when the audit trail doesn't include
   *  variable-set events (e.g. events were trimmed/paginated away). */
  currentVariables: Record<string, unknown>;
}) {
  const { nodeId, events, currentVariables } = props;

  const snapshots = useMemo(() => {
    // API returns events newest-first. Reconstruction needs oldest-first.
    const ordered = [...events].reverse();

    // Walk the trail, maintaining a running bag. Record snapshots at
    // the moment the node is entered (pre-entry bag = "at entry") and
    // at the moment the node is exited for the LAST time (bag after
    // any variable-set events that belong to this step = "after").
    const bag: Record<string, unknown> = {};
    let entrySnapshot: Record<string, unknown> | null = null;
    let exitSnapshot: Record<string, unknown> | null = null;
    let lastActor: string | null = null;
    let lastCompletedAt: string | null = null;
    let lastEnteredAt: string | null = null;

    // Track whether the "current step" scope is open. A userTask can
    // emit variable-set events *between* node-entered and node-exited
    // (via completeTask). Service tasks typically emit variable-set
    // inside the same logical step too.
    let insideStep = false;

    // Count visits so we can show "iteration N" for loops / multi-instance.
    let visitCount = 0;

    for (const e of ordered) {
      // Apply variable-set to the running bag regardless of scope —
      // it always mutates global instance variables in our engine.
      if (e.eventType === "variable-set" && e.payload && typeof e.payload === "object") {
        const p = e.payload as { key?: string; value?: unknown };
        if (typeof p.key === "string") bag[p.key] = p.value;
      }

      if (e.nodeId !== nodeId) continue;

      if (e.eventType === "node-entered") {
        // Snapshot the bag BEFORE applying step-internal variable-sets.
        // We clone so later mutations don't leak into this snapshot.
        entrySnapshot = { ...bag };
        // CRITICAL: reset exit on re-entry so a previous iteration's
        // exit panel doesn't linger while the new iteration is running.
        exitSnapshot = null;
        insideStep = true;
        lastEnteredAt = e.createdAt;
        visitCount += 1;
      } else if (e.eventType === "node-exited" && insideStep) {
        // Clone current bag (which now reflects any variable-sets that
        // happened during the step) as the exit snapshot.
        exitSnapshot = { ...bag };
        insideStep = false;
        lastCompletedAt = e.createdAt;
      } else if (e.eventType === "task-completed" && e.userId) {
        lastActor = e.userId;
      }
    }

    return { entrySnapshot, exitSnapshot, lastActor, lastCompletedAt, lastEnteredAt, visitCount };
  }, [nodeId, events]);

  const { entrySnapshot, exitSnapshot, lastActor, lastCompletedAt, lastEnteredAt, visitCount } = snapshots;

  // If the node was never entered (unvisited), show a friendly state
  // instead of an empty snapshot. Fall back to current variables as
  // "expected-on-entry" so the operator still has context.
  const neverEntered = entrySnapshot === null;
  const entry = entrySnapshot ?? currentVariables;
  const exit = exitSnapshot;
  // Heuristic: getInstance caps recentEvents at 50. If we have exactly
  // 50 events, the trail MAY be truncated and the reconstruction MAY
  // be missing older variable-sets. Warn the operator so silently-
  // wrong snapshots don't destroy trust.
  const possiblyTruncated = events.length >= 50;
  const changed = useMemo(() => diffKeysShallow(entry, exit), [JSON.stringify(entry), JSON.stringify(exit)]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Meta strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "#475467" }}>
        <span><strong>Node:</strong> <code style={{ background: "#F2F4F7", padding: "1px 6px", borderRadius: 4 }}>{nodeId}</code></span>
        {lastEnteredAt && <span><strong>Entered:</strong> {new Date(lastEnteredAt).toLocaleString()}</span>}
        {lastCompletedAt && <span><strong>Exited:</strong> {new Date(lastCompletedAt).toLocaleString()}</span>}
        {lastActor && <span><strong>Actor:</strong> <code style={{ fontFamily: "var(--font-mono, monospace)" }}>{lastActor.slice(0, 8)}…</code></span>}
        {visitCount > 1 && <span style={{ color: "#7C3AED" }}><strong>Visits:</strong> {visitCount} (showing last)</span>}
        {neverEntered && <span style={{ color: "#92400E" }}>Not yet reached</span>}
      </div>

      {possiblyTruncated && (
        <div style={{ padding: "8px 12px", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 6, fontSize: 12, color: "#92400E" }}>
          <strong>Trail may be truncated.</strong> Showing reconstructed state from the most recent 50 events — older variable changes may not be reflected. Full history will be available once a paginated audit endpoint ships.
        </div>
      )}

      {/* Entry / Exit snapshots side-by-side when both exist */}
      <div style={{ display: "grid", gridTemplateColumns: exit ? "1fr 1fr" : "1fr", gap: 12 }}>
        <SnapshotBlock label={neverEntered ? "Current (step not yet reached)" : "At step entry"} bag={entry} other={null} highlight={changed} side="entry" />
        {exit && <SnapshotBlock label="After step" bag={exit} other={entry} highlight={changed} side="exit" />}
      </div>

      {/* Diff summary */}
      {exit && changed.size > 0 && (
        <div style={{ padding: "8px 12px", background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 8, fontSize: 12, color: "#3730A3" }}>
          <strong>Changes at this step:</strong>{" "}
          {[...changed].map((k) => <code key={k} style={{ background: "#fff", padding: "1px 6px", borderRadius: 4, marginRight: 6, fontFamily: "var(--font-mono, monospace)" }}>{k}</code>)}
        </div>
      )}
    </div>
  );
}

function SnapshotBlock(props: {
  label: string;
  bag: Record<string, unknown>;
  other: Record<string, unknown> | null;
  highlight: Set<string>;
  side: "entry" | "exit";
}) {
  const keys = Object.keys(props.bag).sort();
  // Removed-on-exit: keys that existed on entry but not on exit.
  const removedKeys = props.side === "exit" && props.other
    ? Object.keys(props.other).filter((k) => !(k in props.bag)).sort()
    : [];
  return (
    <div style={{ padding: 12, background: "#F9FAFB", border: "1px solid #EAECF0", borderRadius: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        {props.label}
      </div>
      {keys.length === 0 && removedKeys.length === 0 ? (
        <div style={{ fontSize: 12, color: "#98A2B3" }}>Empty</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontFamily: "var(--font-mono, monospace)" }}>
          {keys.map((k) => {
            const isChanged = props.highlight.has(k);
            const prevValue = props.side === "exit" && props.other ? props.other[k] : undefined;
            const isAdded = props.side === "exit" && props.other && !(k in props.other);
            return (
              <div key={k} style={{
                display: "grid", gridTemplateColumns: "minmax(110px, 1fr) 2fr auto", gap: 8,
                padding: "3px 6px", borderRadius: 4,
                background: isChanged && props.side === "exit" ? "#FEF3C7" : "transparent",
                alignItems: "center",
              }}>
                <span style={{ color: isChanged ? "#92400E" : "#475467", fontWeight: isChanged ? 600 : 400, display: "flex", alignItems: "center", gap: 6 }}>
                  {isAdded && <span title="Added at this step" style={{ background: "#10B981", color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: 3, fontFamily: "inherit", fontWeight: 700 }}>NEW</span>}
                  {k}
                  <TypeBadge value={props.bag[k]} />
                </span>
                <span style={{ color: "#111827", wordBreak: "break-all", maxHeight: 140, overflow: "auto" }}>
                  {isChanged && props.side === "exit" && !isAdded && (
                    <span style={{ color: "#B42318", textDecoration: "line-through", marginRight: 6 }}>
                      {formatValue(prevValue)}
                    </span>
                  )}
                  <span>{formatValue(props.bag[k])}</span>
                </span>
                <CopyBtn value={formatValue(props.bag[k])} />
              </div>
            );
          })}
          {removedKeys.map((k) => (
            <div key={`removed-${k}`} style={{
              display: "grid", gridTemplateColumns: "minmax(110px, 1fr) 2fr auto", gap: 8,
              padding: "3px 6px", borderRadius: 4, background: "#FEF2F2", alignItems: "center",
            }}>
              <span style={{ color: "#B42318", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <span title="Removed at this step" style={{ background: "#EF4444", color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: 3, fontFamily: "inherit", fontWeight: 700 }}>REM</span>
                <span style={{ textDecoration: "line-through" }}>{k}</span>
              </span>
              <span style={{ color: "#B42318", textDecoration: "line-through" }}>{formatValue(props.other![k])}</span>
              <span />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeBadge({ value }: { value: unknown }) {
  let t: string;
  if (value === null) t = "null";
  else if (Array.isArray(value)) t = "array";
  else t = typeof value;
  const palette: Record<string, { bg: string; fg: string }> = {
    string:  { bg: "#EFF6FF", fg: "#1D4ED8" },
    number:  { bg: "#ECFDF5", fg: "#065F46" },
    boolean: { bg: "#F5F3FF", fg: "#6D28D9" },
    object:  { bg: "#FFF7ED", fg: "#C2410C" },
    array:   { bg: "#FFF7ED", fg: "#C2410C" },
    null:    { bg: "#F3F4F6", fg: "#6B7280" },
    undefined:{ bg: "#F3F4F6", fg: "#6B7280" },
  };
  const p = palette[t] ?? { bg: "#F3F4F6", fg: "#6B7280" };
  return (
    <span style={{ fontSize: 9, background: p.bg, color: p.fg, padding: "1px 5px", borderRadius: 3, fontWeight: 600, fontFamily: "inherit" }}>
      {t}
    </span>
  );
}

function CopyBtn({ value }: { value: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (navigator.clipboard) navigator.clipboard.writeText(value);
      }}
      title="Copy value"
      style={{
        border: "none", background: "transparent", cursor: "pointer", padding: 4,
        color: "#98A2B3", display: "flex", alignItems: "center",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
    </button>
  );
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "(unset)";
  if (typeof v === "string") return JSON.stringify(v);
  // Pretty-print objects + arrays so a 5-field object is readable
  // without horizontal scroll. Single-line for primitives.
  if (typeof v === "object") {
    const s = JSON.stringify(v, null, 2);
    return s.length > 200 ? s.slice(0, 200) + "… (truncated)" : s;
  }
  return JSON.stringify(v);
}

/** Shallow diff on the top-level keys — which keys' serialized values
 *  differ between entry and exit. Caller memoises on stringified
 *  snapshots so a new currentVariables ref on poll doesn't re-diff. */
function diffKeysShallow(a: Record<string, unknown>, b: Record<string, unknown> | null): Set<string> {
  if (!b) return new Set();
  const out = new Set<string>();
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.add(k);
  }
  return out;
}
