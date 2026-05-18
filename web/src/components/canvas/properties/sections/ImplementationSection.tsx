/* ─── Implementation Section ──────────────────────────────────────────
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import type {
  ServiceImplementation,
  RestConfig,
  BindingType,
  KeyValuePair,
  ConnectorConfig,
} from "../../../../types/bpmn-node-data";
import { EXECUTABLE_SERVICE_TASK_IMPL_TYPES } from "../../../../lib/bpmn/capabilities";
import { apiGet } from "../../../../lib/api";
import FeelExpressionInput from "../fields/FeelExpressionInput";
import AiAssistButton from "../fields/AiAssistButton";

type Props = {
  implementation: ServiceImplementation | undefined;
  onChange: (impl: ServiceImplementation) => void;
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.05em", color: "#98a2b3", marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 10,
  border: "1px solid #e5e7eb", fontSize: 13, color: "#111827",
  fontFamily: "inherit", outline: "none", background: "#fff",
  lineHeight: "1.5",
};

const monoInput: React.CSSProperties = {
  ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 12,
};

const configBox: React.CSSProperties = {
  border: "1px solid #f2f4f7", borderRadius: 12, background: "#f9fafb",
  padding: 16, display: "flex", flexDirection: "column", gap: 12,
};

const BINDING_TYPES: { type: BindingType; label: string; icon: string }[] = [
  { type: "rest", label: "REST API", icon: "🌐" },
  { type: "externalWorker", label: "Job Worker", icon: "⚙️" },
  { type: "inlineScript", label: "Script", icon: "📜" },
  { type: "connector", label: "Connector", icon: "🔌" },
  { type: "soap", label: "SOAP", icon: "📡" },
  { type: "wasmModule", label: "WASM", icon: "📦" },
];

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export default function ImplementationSection({ implementation, onChange }: Props) {
  const currentType = implementation?.type || "rest";
  /* GAP-T2-C: warn when the persisted implementation type isn't
   * something the engine knows how to execute. Without this, processes
   * authored on (or migrated through) a card that the engine silently
   * no-ops — REST API / Script / Connector / SOAP / WASM today —
   * appear to be configured correctly while service tasks pass through
   * with no side effects. The banner only renders for already-saved
   * data; un-implemented cards are also visually disabled in the
   * picker (GAP-T2-A) so a fresh authoring session can't reach this
   * state in the first place. */
  const isExecutableType =
    !implementation || EXECUTABLE_SERVICE_TASK_IMPL_TYPES.has(implementation.type);

  const setType = (type: BindingType) => {
    switch (type) {
      case "rest": onChange({ type: "rest", config: { method: "GET", url: "", headers: [], queryParams: [], body: "" } }); break;
      case "externalWorker": onChange({ type: "externalWorker", config: { jobType: "", headers: [] } }); break;
      case "inlineScript": onChange({ type: "inlineScript", config: { language: "feel", script: "" } }); break;
      case "connector": onChange({ type: "connector", config: { connector: "", connectionId: null, operation: "", input: {} } }); break;
      case "soap": onChange({ type: "soap", config: { wsdlUrl: "", operation: "" } }); break;
      case "wasmModule": onChange({ type: "wasmModule", config: { moduleRef: "" } }); break;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Binding type selector */}
      <div>
        <div style={labelStyle}>Implementation</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {BINDING_TYPES.map((bt) => {
            const active = currentType === bt.type;
            /* GAP-T2-A: cards whose runtime type isn't in the
             * executable set are disabled in the picker. Selecting one
             * of them used to silently fall through to the engine's
             * noop handler — service tasks pretended to succeed
             * without doing anything. The GAP-T2-C banner still
             * surfaces if a process was already saved with one of
             * these types before this change. */
            const isExecutable = EXECUTABLE_SERVICE_TASK_IMPL_TYPES.has(bt.type);
            return (
              <button
                key={bt.type}
                type="button"
                disabled={!isExecutable}
                onClick={isExecutable ? () => setType(bt.type) : undefined}
                title={
                  isExecutable
                    ? bt.label
                    : `${bt.label} isn't executable yet — track on the I-series roadmap (Mail / REST / Script / Connectors)`
                }
                style={{
                  position: "relative",
                  padding: "10px 8px", borderRadius: 10, textAlign: "center",
                  border: `1.5px solid ${active ? "#fdba74" : "#e5e7eb"}`,
                  background: active ? "#fff7ed" : isExecutable ? "#fff" : "#f9fafb",
                  cursor: isExecutable ? "pointer" : "not-allowed",
                  opacity: isExecutable ? 1 : 0.55,
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 2 }}>{bt.icon}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: active ? "#ea580c" : "#667085" }}>
                  {bt.label}
                </div>
                {!isExecutable && (
                  <div
                    style={{
                      position: "absolute", top: 4, right: 4,
                      fontSize: 8, fontWeight: 700, letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      padding: "1px 5px", borderRadius: 999,
                      background: "#e5e7eb", color: "#475467",
                    }}
                  >
                    Soon
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Non-executable type banner (GAP-T2-C) */}
      {!isExecutableType && (
        <div
          role="alert"
          style={{
            padding: "10px 12px", borderRadius: 10,
            background: "#fffbeb", border: "1px solid #fde68a",
            display: "flex", gap: 10, alignItems: "flex-start",
            fontSize: 12, color: "#92400e", lineHeight: 1.5,
          }}
        >
          <span aria-hidden style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              This implementation type isn't executable yet
            </div>
            <div>
              The engine doesn't run <code style={{
                fontFamily: "var(--font-mono, monospace)",
                background: "#fef3c7", padding: "1px 4px", borderRadius: 3,
              }}>{implementation?.type}</code> service tasks today.
              Configuration round-trips cleanly, but at runtime the task is
              silently no-op'd. Switch to <strong>Job Worker</strong> to
              actually exercise this step until the integration ships.
            </div>
          </div>
        </div>
      )}

      {/* REST */}
      {implementation?.type === "rest" && (
        <RestConfigPanel config={implementation.config} onChange={(c) => onChange({ type: "rest", config: c })} />
      )}

      {/* External Worker */}
      {implementation?.type === "externalWorker" && (
        <div style={configBox}>
          <div>
            <div style={labelStyle}>Job Type</div>
            <input
              type="text"
              value={implementation.config.jobType}
              onChange={(e) => onChange({ ...implementation, config: { ...implementation.config, jobType: e.target.value } })}
              style={monoInput}
              placeholder="payment-processing"
            />
            <div style={{ marginTop: 4, fontSize: 10, color: "#98a2b3" }}>Workers subscribe to this job type via gRPC</div>
          </div>
        </div>
      )}

      {/* Inline Script */}
      {implementation?.type === "inlineScript" && (
        <div style={configBox}>
          <div>
            <div style={labelStyle}>Language</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["feel", "javascript", "python"] as const).map((lang) => {
                const active = implementation.config.language === lang;
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => onChange({ ...implementation, config: { ...implementation.config, language: lang } })}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                      border: `1px solid ${active ? "#67e8f9" : "#e5e7eb"}`,
                      background: active ? "#ecfeff" : "#fff",
                      color: active ? "#0891b2" : "#667085",
                      cursor: "pointer", transition: "all 0.15s",
                      textTransform: lang === "feel" ? "uppercase" : "capitalize",
                    }}
                  >
                    {lang === "feel" ? "FEEL" : lang.charAt(0).toUpperCase() + lang.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>Script</span>
              <AiAssistButton tooltip="AI: Generate script" />
            </div>
            <textarea
              value={implementation.config.script}
              onChange={(e) => onChange({ ...implementation, config: { ...implementation.config, script: e.target.value } })}
              rows={5}
              style={{ ...monoInput, resize: "vertical", minHeight: 80 }}
              placeholder={implementation.config.language === "feel" ? "= order.total * 0.1" : "// Your code here"}
              spellCheck={false}
            />
          </div>
        </div>
      )}

      {/* Connector — schema-driven picker fed by the live registry. */}
      {implementation?.type === "connector" && (
        <ConnectorConfigPanel
          config={implementation.config}
          onChange={(c) => onChange({ type: "connector", config: c })}
        />
      )}
    </div>
  );
}

/* ─── REST Config ────────────────────────────────────────────────────
 * Driver of the runtime restHandler in
 * `api/src/engine/service-task-registry.ts`. Every field here has a
 * matching read in the handler — keep the two in sync when adding
 * new knobs.
 *
 * Sections rendered (in order):
 *   1. Method + URL           — single row; URL grows to fill via flex:1
 *   2. Authentication         — type dropdown + per-type inputs
 *   3. Headers                — KV editor (key text + value FEEL)
 *   4. Query parameters       — same KV editor
 *   5. Body                   — only on POST/PUT/PATCH
 *
 * KV rows accept FEEL on the value side so values can interpolate
 * variables (`= tenantId` → "acme") at runtime. Keys are plain text
 * because HTTP header / query-param names aren't expressions.
 * ──────────────────────────────────────────────────────────────────── */

function RestConfigPanel({ config, onChange }: { config: RestConfig; onChange: (c: RestConfig) => void }) {
  const configBox: React.CSSProperties = {
    border: "1px solid #f2f4f7", borderRadius: 10, background: "#f9fafb",
    padding: 14, display: "flex", flexDirection: "column", gap: 12,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.05em", color: "#98a2b3", marginBottom: 6,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 8,
    border: "1px solid #e5e7eb", fontSize: 12, color: "#111827",
    fontFamily: "inherit", outline: "none", background: "#fff",
    boxSizing: "border-box",
  };

  const auth = config.auth;
  const headers = config.headers ?? [];
  const queryParams = config.queryParams ?? [];

  const updateHeaders = (next: KeyValuePair[]) => onChange({ ...config, headers: next });
  const updateQueryParams = (next: KeyValuePair[]) => onChange({ ...config, queryParams: next });

  return (
    <div style={configBox}>
      {/* Method + URL — flex: 1 wrapper so the URL field fills the row.
          Without this the FEEL input collapses to its content width
          and leaves a chunk of empty gutter on the right. */}
      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <select
          value={config.method}
          onChange={(e) => onChange({ ...config, method: e.target.value as RestConfig["method"] })}
          style={{ ...inputStyle, width: 90, flexShrink: 0, fontWeight: 700, fontSize: 11, paddingRight: 24 }}
        >
          {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FeelExpressionInput
            value={config.url}
            onChange={(v) => onChange({ ...config, url: v })}
            placeholder="https://api.example.com/orders/${order.id}"
            showAiAssist={false}
          />
        </div>
      </div>

      {/* Authentication */}
      <div>
        <div style={labelStyle}>Authentication</div>
        <select
          value={auth?.type || "none"}
          onChange={(e) => {
            const t = e.target.value;
            if (t === "none") onChange({ ...config, auth: { type: "none" } });
            else if (t === "bearer") onChange({ ...config, auth: { type: "bearer", token: "" } });
            else if (t === "basic") onChange({ ...config, auth: { type: "basic", username: "", password: "" } });
            else if (t === "apiKey") onChange({ ...config, auth: { type: "apiKey", headerName: "X-API-Key", value: "" } });
            else if (t === "credentialRef") onChange({ ...config, auth: { type: "credentialRef", refId: "" } });
          }}
          style={inputStyle}
        >
          <option value="none">No Auth</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="apiKey">API Key Header</option>
          <option value="credentialRef">Credential Reference</option>
        </select>

        {/* Per-type inputs — render directly under the dropdown so the
            relationship is visually obvious. All FEEL-typed fields
            accept `${var}` interpolation (the engine evaluates them
            at request time). */}
        {auth?.type === "bearer" && (
          <div style={{ marginTop: 10 }}>
            <div style={labelStyle}>Token (FEEL)</div>
            <FeelExpressionInput
              value={auth.token}
              onChange={(v) => onChange({ ...config, auth: { type: "bearer", token: v } })}
              placeholder='${apiToken}'
              showAiAssist={false}
            />
          </div>
        )}

        {auth?.type === "basic" && (
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={labelStyle}>Username (FEEL)</div>
              <FeelExpressionInput
                value={auth.username}
                onChange={(v) => onChange({ ...config, auth: { type: "basic", username: v, password: auth.password } })}
                placeholder='alice'
                showAiAssist={false}
              />
            </div>
            <div>
              <div style={labelStyle}>Password (FEEL)</div>
              <FeelExpressionInput
                value={auth.password}
                onChange={(v) => onChange({ ...config, auth: { type: "basic", username: auth.username, password: v } })}
                placeholder='${apiPassword}'
                showAiAssist={false}
              />
            </div>
          </div>
        )}

        {auth?.type === "apiKey" && (
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <div style={{ width: 180, flexShrink: 0 }}>
              <div style={labelStyle}>Header name</div>
              <input
                type="text"
                value={auth.headerName}
                onChange={(e) => onChange({ ...config, auth: { type: "apiKey", headerName: e.target.value, value: auth.value } })}
                placeholder="X-API-Key"
                style={inputStyle}
                spellCheck={false}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={labelStyle}>Value (FEEL)</div>
              <FeelExpressionInput
                value={auth.value}
                onChange={(v) => onChange({ ...config, auth: { type: "apiKey", headerName: auth.headerName, value: v } })}
                placeholder='${apiKey}'
                showAiAssist={false}
              />
            </div>
          </div>
        )}

        {auth?.type === "credentialRef" && (
          <div style={{ marginTop: 10 }}>
            <div style={labelStyle}>Credential ID</div>
            <input
              type="text"
              value={auth.refId}
              onChange={(e) => onChange({ ...config, auth: { type: "credentialRef", refId: e.target.value } })}
              placeholder="prod-billing-api"
              style={inputStyle}
              spellCheck={false}
            />
            <div style={{
              marginTop: 6, padding: "8px 10px", borderRadius: 8,
              background: "#fffbeb", border: "1px solid #fde68a",
              fontSize: 11, color: "#92400e",
            }}>
              Credential reference store isn't shipped yet — engine will
              reject this auth type at runtime. Use Bearer / Basic / API
              Key for now.
            </div>
          </div>
        )}
      </div>

      {/* Headers — KV editor */}
      <KvEditor
        label="Headers"
        rows={headers}
        onChange={updateHeaders}
        keyPlaceholder="X-Tenant-Id"
        valuePlaceholder='${tenant}'
        emptyHint="No custom headers. Add Authorization here only if you want to override the auth section."
      />

      {/* Query parameters — KV editor */}
      <KvEditor
        label="Query parameters"
        rows={queryParams}
        onChange={updateQueryParams}
        keyPlaceholder="env"
        valuePlaceholder='${env}'
        emptyHint="No query parameters. Each row appends ?key=value to the URL at request time."
      />

      {/* Body — only meaningful on body methods */}
      {["POST", "PUT", "PATCH"].includes(config.method) && (
        <div>
          <div style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Body</span>
            <AiAssistButton tooltip="AI: Generate request body" />
          </div>
          <textarea
            value={config.body || ""}
            onChange={(e) => onChange({ ...config, body: e.target.value })}
            rows={4}
            style={{
              ...inputStyle, fontFamily: "var(--font-mono, monospace)",
              fontSize: 11, resize: "vertical", minHeight: 64,
            }}
            placeholder='{ "orderId": "${order.id}" }'
            spellCheck={false}
          />
          <div style={{ marginTop: 4, fontSize: 10, color: "#98a2b3" }}>
            Defaults to <code>application/json</code> Content-Type unless
            you set one in Headers.
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── KV editor (used by Headers + Query parameters) ──────────────── */

function KvEditor(props: {
  label: string;
  rows: KeyValuePair[];
  onChange: (next: KeyValuePair[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  emptyHint: string;
}) {
  const { label, rows, onChange, keyPlaceholder, valuePlaceholder, emptyHint } = props;

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.05em", color: "#98a2b3",
  };
  const keyInputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 8,
    border: "1px solid #e5e7eb", fontSize: 12, color: "#111827",
    fontFamily: "inherit", outline: "none", background: "#fff",
    boxSizing: "border-box",
  };

  const addRow = () => onChange([...rows, { key: "", value: "" }]);
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<KeyValuePair>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={labelStyle}>{label}{rows.length > 0 ? ` (${rows.length})` : ""}</div>
        <button
          type="button"
          onClick={addRow}
          style={{
            padding: "3px 10px", borderRadius: 6, border: "1px solid #e5e7eb",
            background: "#fff", color: "#475467", fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          + Add
        </button>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: "#98a2b3", lineHeight: 1.5 }}>
          {emptyHint}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
              <div style={{ width: 180, flexShrink: 0 }}>
                <input
                  type="text"
                  value={row.key}
                  onChange={(e) => updateRow(i, { key: e.target.value })}
                  placeholder={keyPlaceholder}
                  style={keyInputStyle}
                  spellCheck={false}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <FeelExpressionInput
                  value={row.value}
                  onChange={(v) => updateRow(i, { value: v })}
                  placeholder={valuePlaceholder}
                  showAiAssist={false}
                />
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label={`Remove ${row.key || `row ${i + 1}`}`}
                style={{
                  width: 32, flexShrink: 0, borderRadius: 8, border: "1px solid #e5e7eb",
                  background: "#fff", color: "#98a2b3", cursor: "pointer", fontSize: 14,
                  fontFamily: "inherit",
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Connector Config Panel ──────────────────────────────────────────
 * Schema-driven picker. Fetches connector definitions + tenant
 * connections from the API; renders connector type → connection (when
 * required) → operation → operation input fields.
 *
 * Why fetch live: the connector registry lives in the API. Hard-coding
 * the list in the canvas would mean every new connector requires a
 * front-end change. Now they don't.
 * ──────────────────────────────────────────────────────────────────── */

type ConnectorFieldSpec =
  | { type: "string"; required?: boolean; secret?: boolean; placeholder?: string; description?: string; maxLength?: number }
  | { type: "email"; required?: boolean; placeholder?: string; description?: string }
  | { type: "integer"; required?: boolean; min?: number; max?: number; default?: number; description?: string }
  | { type: "boolean"; default?: boolean; description?: string }
  | { type: "url"; required?: boolean; placeholder?: string; description?: string }
  | { type: "enum"; required?: boolean; options: string[]; default?: string; description?: string };

type ConnectorOperationSpec = {
  id: string;
  name: string;
  description?: string;
  inputSchema: Record<string, ConnectorFieldSpec>;
  outputKeys: string[];
};

type ConnectorDefinitionSpec = {
  id: string;
  name: string;
  description: string;
  connectionSchema: Record<string, ConnectorFieldSpec>;
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
};

function ConnectorConfigPanel({
  config,
  onChange,
}: {
  config: ConnectorConfig;
  onChange: (c: ConnectorConfig) => void;
}) {
  const [defs, setDefs] = useState<ConnectorDefinitionSpec[] | null>(null);
  const [conns, setConns] = useState<ConnectionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [d, c] = await Promise.all([
          apiGet<ConnectorDefinitionSpec[]>("/connectors/definitions"),
          apiGet<ConnectionRow[]>("/connectors/connections"),
        ]);
        if (cancelled) return;
        setDefs(d);
        setConns(c);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? "Failed to load connectors.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const def = defs?.find((d) => d.id === config.connector);
  const op = def?.operations.find((o) => o.id === config.operation);
  const typeConnections = (conns ?? []).filter(
    (c) => c.connectorType === config.connector && c.enabled,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {loadError && (
        <div style={{ padding: 8, background: "#FEF3F2", border: "1px solid #FECDCA", borderRadius: 6, color: "#B42318", fontSize: 12 }}>
          {loadError}
        </div>
      )}

      {/* Connector type */}
      <div>
        <div style={labelStyle}>Connector</div>
        <select
          value={config.connector}
          onChange={(e) => {
            const next = e.target.value;
            const d = defs?.find((dd) => dd.id === next);
            // Auto-pick the only operation; auto-pick the default
            // connection of the chosen type (if any).
            const opId = d?.operations.length === 1 ? d.operations[0].id : "";
            const defaultConn = (conns ?? []).find(
              (c) => c.connectorType === next && c.isDefault && c.enabled,
            );
            onChange({
              connector: next,
              connectionId: defaultConn?.id ?? null,
              operation: opId,
              input: {},
            });
          }}
          style={{ ...inputStyle, paddingRight: 28 }}
          disabled={!defs}
        >
          <option value="">{defs ? "Select a connector…" : "Loading…"}</option>
          {(defs ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {def && (
          <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 4 }}>{def.description}</div>
        )}
      </div>

      {/* Connection picker — shown when the connector exposes any
          connection schema. Optional for connectionRequired=false
          (REST) — operator can run standalone. */}
      {def && Object.keys(def.connectionSchema).length > 0 && (
        <div>
          <div style={labelStyle}>
            Connection {def.connectionRequired ? "*" : "(optional)"}
          </div>
          <select
            value={config.connectionId ?? ""}
            onChange={(e) => onChange({ ...config, connectionId: e.target.value || null })}
            style={{ ...inputStyle, paddingRight: 28 }}
          >
            <option value="">
              {def.connectionRequired ? "Select a connection…" : "(no connection — task carries full config)"}
            </option>
            {typeConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
          {typeConnections.length === 0 && def.connectionRequired && (
            <div style={{ fontSize: 11, color: "#B42318", marginTop: 4 }}>
              No enabled {def.name} connections. Add one under Settings → Connections.
            </div>
          )}
        </div>
      )}

      {/* Operation — auto-collapse to a single-line label when there's
          only one to pick. */}
      {def && def.operations.length > 1 && (
        <div>
          <div style={labelStyle}>Operation *</div>
          <select
            value={config.operation}
            onChange={(e) => onChange({ ...config, operation: e.target.value, input: {} })}
            style={{ ...inputStyle, paddingRight: 28 }}
          >
            <option value="">Select an operation…</option>
            {def.operations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {def && def.operations.length === 1 && (
        <div style={{ fontSize: 11, color: "#98A2B3" }}>
          Operation: <strong>{def.operations[0].name}</strong>
        </div>
      )}

      {/* Operation input — schema-driven. */}
      {op && (
        <div style={configBox}>
          <div style={{ ...labelStyle, marginBottom: 4 }}>{op.name} input</div>
          {op.description && (
            <div style={{ fontSize: 11, color: "#667085", marginBottom: 4 }}>{op.description}</div>
          )}
          {Object.entries(op.inputSchema).map(([key, spec]) => (
            <ConnectorInputField
              key={key}
              fieldKey={key}
              spec={spec}
              value={(config.input as Record<string, unknown>)[key]}
              onChange={(v) =>
                onChange({
                  ...config,
                  input: { ...(config.input as Record<string, unknown>), [key]: v },
                })
              }
            />
          ))}
          {op.outputKeys.length > 0 && (
            <div style={{ fontSize: 11, color: "#98A2B3" }}>
              Returns: {op.outputKeys.map((k) => <code key={k} style={{ background: "#fff", padding: "1px 5px", borderRadius: 3, marginRight: 4 }}>{k}</code>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectorInputField({
  fieldKey,
  spec,
  value,
  onChange,
}: {
  fieldKey: string;
  spec: ConnectorFieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const required = "required" in spec && spec.required;
  const description = "description" in spec ? spec.description : undefined;
  const placeholder = "placeholder" in spec ? spec.placeholder : undefined;

  let inputEl: React.ReactNode;
  if (spec.type === "boolean") {
    return (
      <div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#344054" }}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          {humanizeKey(fieldKey)}
        </label>
        {description && <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 4 }}>{description}</div>}
      </div>
    );
  }
  if (spec.type === "integer") {
    inputEl = (
      <input
        type="number"
        min={spec.min}
        max={spec.max}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
        required={required}
        style={inputStyle}
      />
    );
  } else if (spec.type === "enum") {
    inputEl = (
      <select
        value={typeof value === "string" ? value : (spec.default ?? "")}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, paddingRight: 28 }}
      >
        {spec.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  } else {
    // string / email / url — text input with ${var} hint.
    inputEl = (
      <input
        type={spec.type === "email" ? "email" : spec.type === "url" ? "url" : "text"}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        style={monoInput}
      />
    );
  }

  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: 4 }}>
        {humanizeKey(fieldKey)} {required && "*"}
      </div>
      {inputEl}
      {description && <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 4 }}>{description}</div>}
    </div>
  );
}

function humanizeKey(k: string): string {
  return k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

