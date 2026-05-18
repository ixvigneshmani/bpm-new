import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import { useAuth } from "../lib/auth";

// ─── Types mirroring api/src/connectors/* ────────────────────────────

type ConnectorFieldSchema =
  | { type: "string"; required?: boolean; secret?: boolean; placeholder?: string; description?: string; maxLength?: number }
  | { type: "email"; required?: boolean; placeholder?: string; description?: string }
  | { type: "integer"; required?: boolean; min?: number; max?: number; default?: number; description?: string }
  | { type: "boolean"; default?: boolean; description?: string }
  | { type: "url"; required?: boolean; placeholder?: string; description?: string }
  | { type: "enum"; required?: boolean; options: string[]; default?: string; description?: string };

type ConnectorSchema = Record<string, ConnectorFieldSchema>;

type ConnectorOperationSpec = {
  id: string;
  name: string;
  description?: string;
  inputSchema: ConnectorSchema;
  outputKeys: string[];
};

type ConnectorDefinitionSpec = {
  id: string;
  name: string;
  description: string;
  connectionSchema: ConnectorSchema;
  secretFields: string[];
  connectionRequired: boolean;
  hasTestAction: boolean;
  operations: ConnectorOperationSpec[];
};

type ConnectionRow = {
  id: string;
  connectorType: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  config: Record<string, unknown>;
  secretsSet: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
};

// ─── Styles ──────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #EAECF0",
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};
const groupHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: 14,
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#344054",
  marginBottom: 6,
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #D0D5DD",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};
const row: React.CSSProperties = { marginBottom: 14 };
const btn: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 6,
  border: "1px solid #4F46E5",
  background: "#4F46E5",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 6,
  border: "1px solid #D0D5DD",
  background: "#fff",
  color: "#344054",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 4,
  border: "none",
  background: "transparent",
  color: "#6366F1",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const btnDanger: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 4,
  border: "none",
  background: "transparent",
  color: "#B42318",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const pill: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 9999,
  fontSize: 11,
  fontWeight: 600,
};

// ─── Component ───────────────────────────────────────────────────────

export default function ConnectionsSettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.systemRole === "owner" || user?.systemRole === "admin";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [definitions, setDefinitions] = useState<ConnectorDefinitionSpec[]>([]);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);

  // Drawer state for add/edit.
  const [drawer, setDrawer] = useState<
    | { mode: "add"; connector: ConnectorDefinitionSpec }
    | { mode: "edit"; connector: ConnectorDefinitionSpec; connection: ConnectionRow }
    | { mode: "test"; connector: ConnectorDefinitionSpec; connection: ConnectionRow }
    | null
  >(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [defs, conns] = await Promise.all([
        apiGet<ConnectorDefinitionSpec[]>("/connectors/definitions"),
        apiGet<ConnectionRow[]>("/connectors/connections"),
      ]);
      setDefinitions(defs);
      setConnections(conns);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load connectors.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    refresh();
  }, [isAdmin, refresh]);

  const byType = useMemo(() => {
    const map = new Map<string, ConnectionRow[]>();
    for (const c of connections) {
      const arr = map.get(c.connectorType) ?? [];
      arr.push(c);
      map.set(c.connectorType, arr);
    }
    return map;
  }, [connections]);

  if (!isAdmin) {
    return (
      <div style={{ padding: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Connections</h1>
        <p style={{ color: "#667085" }}>
          Only owner / admin users may view or change tenant connections.
        </p>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 32 }}>Loading…</div>;

  return (
    <div style={{ padding: 32, maxWidth: 880 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Connections</h1>
      <p style={{ color: "#667085", marginTop: 0, marginBottom: 20 }}>
        Configure reusable accounts for external services. Processes pick a connection by name; secrets are encrypted at rest.
      </p>

      {error && (
        <div style={{ marginBottom: 16, padding: 10, background: "#FEF3F2", border: "1px solid #FECDCA", borderRadius: 6, color: "#B42318", fontSize: 13 }}>
          {error}
        </div>
      )}

      {definitions.map((def) => {
        const conns = byType.get(def.id) ?? [];
        return (
          <div key={def.id} style={card}>
            <div style={groupHeader}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{def.name}</h2>
                <p style={{ fontSize: 13, color: "#667085", margin: "4px 0 0 0" }}>{def.description}</p>
              </div>
              <button
                style={btn}
                onClick={() => setDrawer({ mode: "add", connector: def })}
              >
                + Add connection
              </button>
            </div>
            {conns.length === 0 ? (
              <div style={{ fontSize: 13, color: "#98A2B3", fontStyle: "italic" }}>
                No connections yet.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ fontSize: 11, fontWeight: 600, color: "#667085", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #EAECF0" }}>Name</th>
                    <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #EAECF0" }}>Summary</th>
                    <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #EAECF0" }}>State</th>
                    <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid #EAECF0" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {conns.map((c) => (
                    <tr key={c.id} style={{ fontSize: 13 }}>
                      <td style={{ padding: "10px 6px", borderBottom: "1px solid #F2F4F7" }}>
                        <strong>{c.name}</strong>
                        {c.isDefault && (
                          <span style={{ ...pill, background: "#EEF4FF", color: "#3538CD", marginLeft: 8 }}>Default</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 6px", borderBottom: "1px solid #F2F4F7", color: "#475467" }}>
                        {summarize(def, c)}
                      </td>
                      <td style={{ padding: "10px 6px", borderBottom: "1px solid #F2F4F7" }}>
                        <span style={{ ...pill, background: c.enabled ? "#ECFDF3" : "#FEF3F2", color: c.enabled ? "#067647" : "#B42318" }}>
                          {c.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 6px", borderBottom: "1px solid #F2F4F7", textAlign: "right" }}>
                        {def.hasTestAction && (
                          <button style={btnGhost} onClick={() => setDrawer({ mode: "test", connector: def, connection: c })}>Test</button>
                        )}
                        <button style={btnGhost} onClick={() => setDrawer({ mode: "edit", connector: def, connection: c })}>Edit</button>
                        <button
                          style={btnDanger}
                          onClick={async () => {
                            if (!window.confirm(`Delete "${c.name}"? This cannot be undone.`)) return;
                            try {
                              await apiDelete<void>(`/connectors/connections/${c.id}`);
                              await refresh();
                            } catch (e: any) {
                              setError(e?.message ?? "Delete failed.");
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {drawer && (
        <ConnectionDrawer
          state={drawer}
          onClose={() => setDrawer(null)}
          onSaved={async () => {
            setDrawer(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function summarize(def: ConnectorDefinitionSpec, c: ConnectionRow): string {
  // Try to surface the first meaningful non-secret field. For Mail
  // that's host:port; for REST it'd be baseUrl (Sprint 3); generic
  // fallback shows up to two non-secret values.
  const fields = Object.entries(def.connectionSchema).filter(
    ([k]) => !def.secretFields.includes(k),
  );
  const pieces: string[] = [];
  for (const [k, _spec] of fields) {
    const v = c.config[k];
    if (v == null || v === "") continue;
    pieces.push(typeof v === "boolean" ? `${k}=${v}` : `${k}: ${v}`);
    if (pieces.length >= 2) break;
  }
  return pieces.join("  •  ") || "—";
}

// ─── Drawer (add / edit / test) ─────────────────────────────────────

type DrawerState =
  | { mode: "add"; connector: ConnectorDefinitionSpec }
  | { mode: "edit"; connector: ConnectorDefinitionSpec; connection: ConnectionRow }
  | { mode: "test"; connector: ConnectorDefinitionSpec; connection: ConnectionRow };

function ConnectionDrawer({
  state,
  onClose,
  onSaved,
}: {
  state: DrawerState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const def = state.connector;
  const editing = state.mode === "edit" ? state.connection : null;
  const testing = state.mode === "test" ? state.connection : null;

  const [name, setName] = useState(editing?.name ?? "");
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [isDefault, setIsDefault] = useState(editing?.isDefault ?? false);
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    if (editing) {
      // Pre-fill with stored config but blank out secrets so the
      // placeholder hint shows "(•• stored)" instead of "<encrypted>".
      const v: Record<string, unknown> = { ...editing.config };
      for (const k of def.secretFields) v[k] = "";
      return v;
    }
    // Defaults from schema.
    const v: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(def.connectionSchema)) {
      if (spec.type === "boolean") v[k] = spec.default ?? false;
      else if (spec.type === "integer" && "default" in spec && spec.default != null) v[k] = spec.default;
      else v[k] = "";
    }
    return v;
  });

  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  // Test-state.
  const [testInput, setTestInput] = useState<Record<string, unknown>>({});
  const [testOk, setTestOk] = useState<{ summary: string; details?: Record<string, unknown> } | null>(null);
  const [showTestDetails, setShowTestDetails] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrMsg("");
    try {
      // For edit, only send password (or any secret) if the operator
      // typed something — empty string means "keep stored".
      const config: Record<string, unknown> = { ...values };
      if (editing) {
        for (const k of def.secretFields) {
          if (typeof config[k] === "string" && (config[k] as string).length === 0) {
            delete config[k];
          }
        }
      }
      if (state.mode === "add") {
        await apiPost<ConnectionRow>("/connectors/connections", {
          connectorType: def.id,
          name: name.trim(),
          config,
          enabled,
          isDefault,
        });
      } else if (state.mode === "edit") {
        await apiPut<ConnectionRow>(`/connectors/connections/${editing!.id}`, {
          name: name.trim(),
          config,
          enabled,
          isDefault,
        });
      }
      onSaved();
    } catch (e: any) {
      const msg = e?.message ?? "Save failed.";
      setErrMsg(Array.isArray(msg) ? msg.join(" • ") : String(msg));
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    if (!testing) return;
    setBusy(true);
    setErrMsg("");
    setTestOk(null);
    setShowTestDetails(false);
    try {
      const res = await apiPost<{ ok: true; summary: string; details?: Record<string, unknown> }>(
        `/connectors/connections/${testing.id}/test`,
        { input: testInput },
      );
      setTestOk({ summary: res.summary, details: res.details });
    } catch (e: any) {
      const msg = e?.message ?? "Test failed.";
      setErrMsg(Array.isArray(msg) ? msg.join(" • ") : String(msg));
    } finally {
      setBusy(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────

  const isTest = state.mode === "test";
  const title = isTest
    ? `Test "${testing!.name}"`
    : state.mode === "add"
      ? `New ${def.name} connection`
      : `Edit "${editing!.name}"`;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(16,24,40,0.4)", zIndex: 100,
      display: "flex", justifyContent: "flex-end",
    }}>
      <div style={{
        width: 480, background: "#fff", height: "100%", overflowY: "auto",
        padding: 24, boxShadow: "-8px 0 24px rgba(0,0,0,0.1)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
          <button style={btnGhost} onClick={onClose}>Close</button>
        </div>

        {isTest ? (
          // ── Test action UI ──
          <>
            <p style={{ fontSize: 13, color: "#667085", marginTop: 0 }}>
              Verify that the connection works end-to-end.
            </p>
            {/* Render the testAction's inputSchema fields */}
            {def.hasTestAction && def.id === "mail" && (
              <div style={row}>
                <label style={label}>Recipient *</label>
                <input
                  style={input}
                  type="email"
                  value={(testInput.to as string) ?? ""}
                  onChange={(e) => setTestInput({ ...testInput, to: e.target.value })}
                  placeholder="you@yourdomain.com"
                  required
                />
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button style={btn} onClick={onTest} disabled={busy}>{busy ? "Sending…" : "Run test"}</button>
              <button style={btnSecondary} onClick={onClose}>Cancel</button>
            </div>
            {errMsg && (
              <div style={{ marginTop: 12, padding: 10, background: "#FEF3F2", border: "1px solid #FECDCA", borderRadius: 6, color: "#B42318", fontSize: 13 }}>
                {errMsg}
              </div>
            )}
            {testOk && (
              <div style={{ marginTop: 12, padding: 10, background: "#ECFDF3", border: "1px solid #ABEFC6", borderRadius: 6, color: "#067647", fontSize: 13 }}>
                ✓ {testOk.summary}
                {testOk.details && (
                  <div style={{ marginTop: 6 }}>
                    <button type="button" onClick={() => setShowTestDetails((v) => !v)} style={{ background: "transparent", border: "none", padding: 0, color: "#067647", cursor: "pointer", textDecoration: "underline", fontSize: 12 }}>
                      {showTestDetails ? "Hide" : "Show"} delivery details
                    </button>
                    {showTestDetails && (
                      <pre style={{ marginTop: 6, padding: 8, background: "#F6FEF9", border: "1px solid #DCFAE6", borderRadius: 4, fontSize: 11, color: "#475467", maxHeight: 200, overflow: "auto" }}>
                        {JSON.stringify(testOk.details, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          // ── Add/Edit form ──
          <form onSubmit={onSubmit}>
            <div style={row}>
              <label style={label}>Connection name *</label>
              <input
                style={input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`e.g. "Default", "Marketing relay"`}
                required
              />
              <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 4 }}>
                The cross-environment identity. Used by D1 export bundles.
              </div>
            </div>

            {Object.entries(def.connectionSchema).map(([key, spec]) => (
              <SchemaField
                key={key}
                fieldKey={key}
                spec={spec}
                value={values[key]}
                onChange={(v) => setValues({ ...values, [key]: v })}
                isSecret={def.secretFields.includes(key)}
                isStored={!!editing?.secretsSet?.[key]}
              />
            ))}

            <div style={row}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#344054" }}>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                Enabled (engine will use this connection)
              </label>
            </div>
            <div style={row}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#344054" }}>
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                Default for this connector type
              </label>
              <div style={{ fontSize: 11, color: "#98A2B3", marginLeft: 24 }}>
                Tasks that don't pick a specific connection fall back to this one.
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button type="submit" style={btn} disabled={busy}>
                {busy ? "Saving…" : state.mode === "add" ? "Create" : "Save changes"}
              </button>
              <button type="button" style={btnSecondary} onClick={onClose}>Cancel</button>
            </div>

            {errMsg && (
              <div style={{ marginTop: 12, padding: 10, background: "#FEF3F2", border: "1px solid #FECDCA", borderRadius: 6, color: "#B42318", fontSize: 13 }}>
                {errMsg}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function SchemaField({
  fieldKey,
  spec,
  value,
  onChange,
  isSecret,
  isStored,
}: {
  fieldKey: string;
  spec: ConnectorFieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  isSecret: boolean;
  isStored: boolean;
}) {
  const required = "required" in spec && spec.required;
  const description = "description" in spec ? spec.description : undefined;

  if (spec.type === "boolean") {
    return (
      <div style={row}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#344054" }}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
          {humanize(fieldKey)} {description && <span style={{ color: "#98A2B3", fontSize: 12, fontWeight: 400 }}>— {description}</span>}
        </label>
      </div>
    );
  }

  let inputEl: React.ReactNode;
  if (spec.type === "integer") {
    inputEl = (
      <input
        style={input}
        type="number"
        min={spec.min}
        max={spec.max}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
        required={required}
      />
    );
  } else if (spec.type === "email") {
    inputEl = (
      <input
        style={input}
        type="email"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"placeholder" in spec ? spec.placeholder : undefined}
        required={required}
      />
    );
  } else if (spec.type === "url") {
    inputEl = (
      <input
        style={input}
        type="url"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"placeholder" in spec ? spec.placeholder : undefined}
        required={required}
      />
    );
  } else if (spec.type === "enum") {
    inputEl = (
      <select
        style={input}
        value={typeof value === "string" ? value : (spec.default ?? "")}
        onChange={(e) => onChange(e.target.value)}
      >
        {spec.options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  } else {
    inputEl = (
      <input
        style={input}
        type={isSecret ? "password" : "text"}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          isSecret && isStored ? "Leave blank to keep existing"
            : ("placeholder" in spec ? spec.placeholder : undefined)
        }
        maxLength={"maxLength" in spec ? spec.maxLength : undefined}
        autoComplete={isSecret ? "new-password" : undefined}
        required={required && !(isSecret && isStored)}
      />
    );
  }

  return (
    <div style={row}>
      <label style={label}>
        {humanize(fieldKey)} {required && "*"}
        {isSecret && isStored && <span style={{ color: "#667085", fontWeight: 400 }}> (••• stored)</span>}
      </label>
      {inputEl}
      {description && <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 4 }}>{description}</div>}
    </div>
  );
}

function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
