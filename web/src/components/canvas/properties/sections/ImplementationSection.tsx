/* ─── Implementation Section ──────────────────────────────────────────
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import type {
  ServiceImplementation,
  RestConfig,
  BindingType,
  KeyValuePair,
} from "../../../../types/bpmn-node-data";
import { EXECUTABLE_SERVICE_TASK_IMPL_TYPES } from "../../../../lib/bpmn/capabilities";
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
      case "connector": onChange({ type: "connector", config: { connectorType: "", config: {} } }); break;
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

      {/* Connector */}
      {implementation?.type === "connector" && (
        <div style={configBox}>
          <div style={labelStyle}>Connector Type</div>
          <select
            value={implementation.config.connectorType}
            onChange={(e) => onChange({ ...implementation, config: { ...implementation.config, connectorType: e.target.value } })}
            style={{ ...inputStyle, paddingRight: 28 }}
          >
            <option value="">Select a connector...</option>
            <option value="kafka">Kafka</option>
            <option value="rabbitmq">RabbitMQ</option>
            <option value="smtp">SMTP</option>
            <option value="sftp">SFTP</option>
            <option value="s3">S3 / Azure Blob</option>
            <option value="jdbc">JDBC</option>
            <option value="mongodb">MongoDB</option>
            <option value="redis">Redis</option>
            <option value="graphql">GraphQL</option>
            <option value="grpc">gRPC</option>
          </select>
        </div>
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
