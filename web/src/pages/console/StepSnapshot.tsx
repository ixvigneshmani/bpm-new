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
        insideStep = true;
        lastEnteredAt = e.createdAt;
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

    return { entrySnapshot, exitSnapshot, lastActor, lastCompletedAt, lastEnteredAt };
  }, [nodeId, events]);

  const { entrySnapshot, exitSnapshot, lastActor, lastCompletedAt, lastEnteredAt } = snapshots;

  // If the node was never entered (unvisited), show a friendly state
  // instead of an empty snapshot. Fall back to current variables as
  // "expected-on-entry" so the operator still has context.
  const neverEntered = entrySnapshot === null;
  const entry = entrySnapshot ?? currentVariables;
  const exit = exitSnapshot;
  const changed = useMemo(() => diffKeys(entry, exit), [entry, exit]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Meta strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "#475467" }}>
        <span><strong>Node:</strong> <code style={{ background: "#F2F4F7", padding: "1px 6px", borderRadius: 4 }}>{nodeId}</code></span>
        {lastEnteredAt && <span><strong>Entered:</strong> {new Date(lastEnteredAt).toLocaleTimeString()}</span>}
        {lastCompletedAt && <span><strong>Exited:</strong> {new Date(lastCompletedAt).toLocaleTimeString()}</span>}
        {lastActor && <span><strong>Actor:</strong> <code style={{ fontFamily: "var(--font-mono, monospace)" }}>{lastActor.slice(0, 8)}…</code></span>}
        {neverEntered && <span style={{ color: "#92400E" }}>Not yet reached</span>}
      </div>

      {/* Entry / Exit snapshots side-by-side when both exist */}
      <div style={{ display: "grid", gridTemplateColumns: exit ? "1fr 1fr" : "1fr", gap: 12 }}>
        <SnapshotBlock label={neverEntered ? "Variables (current, not yet seen by this step)" : "At step entry"} bag={entry} highlight={changed} side="entry" />
        {exit && <SnapshotBlock label="After step" bag={exit} highlight={changed} side="exit" />}
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
  highlight: Set<string>;
  side: "entry" | "exit";
}) {
  const keys = Object.keys(props.bag).sort();
  return (
    <div style={{ padding: 12, background: "#F9FAFB", border: "1px solid #EAECF0", borderRadius: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        {props.label}
      </div>
      {keys.length === 0 ? (
        <div style={{ fontSize: 12, color: "#98A2B3" }}>Empty</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontFamily: "var(--font-mono, monospace)" }}>
          {keys.map((k) => {
            const changed = props.highlight.has(k);
            return (
              <div key={k} style={{
                display: "grid", gridTemplateColumns: "minmax(110px, 1fr) 2fr", gap: 8,
                padding: "3px 6px", borderRadius: 4,
                background: changed && props.side === "exit" ? "#FEF3C7" : "transparent",
              }}>
                <span style={{ color: changed ? "#92400E" : "#475467", fontWeight: changed ? 600 : 400 }}>{k}</span>
                <span style={{ color: "#111827", wordBreak: "break-all" }}>{formatValue(props.bag[k])}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "(unset)";
  if (typeof v === "string") return JSON.stringify(v);
  return JSON.stringify(v);
}

function diffKeys(a: Record<string, unknown>, b: Record<string, unknown> | null): Set<string> {
  if (!b) return new Set();
  const out = new Set<string>();
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.add(k);
  }
  return out;
}
