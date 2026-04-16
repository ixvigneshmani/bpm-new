/* ─── Implementation Section ──────────────────────────────────────────
 * Uses inline styles (Tailwind preflight disabled for Ant Design compat).
 * ──────────────────────────────────────────────────────────────────── */

import type { ServiceImplementation, RestConfig, BindingType } from "../../../../types/bpmn-node-data";
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
            return (
              <button
                key={bt.type}
                type="button"
                onClick={() => setType(bt.type)}
                style={{
                  padding: "10px 8px", borderRadius: 10, textAlign: "center",
                  border: `1.5px solid ${active ? "#fdba74" : "#e5e7eb"}`,
                  background: active ? "#fff7ed" : "#fff",
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 2 }}>{bt.icon}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: active ? "#ea580c" : "#667085" }}>
                  {bt.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

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

/* ─── REST Config ─── */

function RestConfigPanel({ config, onChange }: { config: RestConfig; onChange: (c: RestConfig) => void }) {
  const configBox: React.CSSProperties = {
    border: "1px solid #f2f4f7", borderRadius: 10, background: "#f9fafb",
    padding: 14, display: "flex", flexDirection: "column", gap: 10,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.05em", color: "#98a2b3", marginBottom: 6,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 8,
    border: "1px solid #e5e7eb", fontSize: 12, color: "#111827",
    fontFamily: "inherit", outline: "none", background: "#fff",
  };

  return (
    <div style={configBox}>
      {/* Method + URL */}
      <div style={{ display: "flex", gap: 6 }}>
        <select
          value={config.method}
          onChange={(e) => onChange({ ...config, method: e.target.value as RestConfig["method"] })}
          style={{ ...inputStyle, width: 90, flexShrink: 0, fontWeight: 700, fontSize: 11, paddingRight: 24 }}
        >
          {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <FeelExpressionInput
          value={config.url}
          onChange={(v) => onChange({ ...config, url: v })}
          placeholder="https://api.example.com/orders"
          showAiAssist={false}
        />
      </div>

      {/* Auth */}
      <div>
        <div style={labelStyle}>Authentication</div>
        <select
          value={config.auth?.type || "none"}
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
          <option value="apiKey">API Key</option>
          <option value="credentialRef">Credential Reference</option>
        </select>
      </div>

      {/* Body */}
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
            placeholder='{ "orderId": "= order.id" }'
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}
