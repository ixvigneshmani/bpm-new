import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

/* ─── Shared handle style ─── */
const handleStyle = {
  width: 8,
  height: 8,
  background: "#fff",
  border: "2px solid #94A3B8",
  transition: "all 0.15s ease",
};

/* ─── Start Event ─── */
export const StartEventNode = memo(({ data, selected }: NodeProps) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: selected ? "#DCFCE7" : "#F0FDF4",
        border: `2px solid ${selected ? "#16A34A" : "#86EFAC"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: selected ? "0 0 0 3px rgba(22,163,74,0.15)" : "0 1px 3px rgba(0,0,0,0.06)",
        transition: "all 0.2s ease",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#16A34A" stroke="none">
        <polygon points="8,5 19,12 8,19" />
      </svg>
    </div>
    {data.label && (
      <span style={{ fontSize: 11, color: "#475467", fontWeight: 500, maxWidth: 80, textAlign: "center", lineHeight: "14px" }}>
        {data.label as string}
      </span>
    )}
    <Handle type="source" position={Position.Right} style={{ ...handleStyle, right: -4, top: 22 }} />
  </div>
));
StartEventNode.displayName = "StartEventNode";

/* ─── End Event ─── */
export const EndEventNode = memo(({ data, selected }: NodeProps) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: selected ? "#FEE2E2" : "#FEF2F2",
        border: `3px solid ${selected ? "#DC2626" : "#FCA5A5"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: selected ? "0 0 0 3px rgba(220,38,38,0.15)" : "0 1px 3px rgba(0,0,0,0.06)",
        transition: "all 0.2s ease",
      }}
    >
      <div style={{ width: 14, height: 14, borderRadius: 2, background: "#DC2626" }} />
    </div>
    {data.label && (
      <span style={{ fontSize: 11, color: "#475467", fontWeight: 500, maxWidth: 80, textAlign: "center", lineHeight: "14px" }}>
        {data.label as string}
      </span>
    )}
    <Handle type="target" position={Position.Left} style={{ ...handleStyle, left: -4, top: 22 }} />
  </div>
));
EndEventNode.displayName = "EndEventNode";

/* ─── User Task ─── */
export const UserTaskNode = memo(({ data, selected }: NodeProps) => (
  <div
    style={{
      background: "#fff",
      border: `1.5px solid ${selected ? "#6366F1" : "#E5E7EB"}`,
      borderRadius: 10,
      padding: "10px 16px",
      minWidth: 140,
      boxShadow: selected ? "0 0 0 3px rgba(99,102,241,0.12)" : "0 1px 3px rgba(0,0,0,0.06)",
      transition: "all 0.2s ease",
    }}
  >
    <Handle type="target" position={Position.Left} style={{ ...handleStyle, left: -5 }} />
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
        background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", lineHeight: "16px" }}>
          {data.label as string}
        </div>
        <div style={{ fontSize: 10, color: "#9CA3AF" }}>User Task</div>
      </div>
    </div>
    <Handle type="source" position={Position.Right} style={{ ...handleStyle, right: -5 }} />
  </div>
));
UserTaskNode.displayName = "UserTaskNode";

/* ─── Service Task ─── */
export const ServiceTaskNode = memo(({ data, selected }: NodeProps) => (
  <div
    style={{
      background: "#fff",
      border: `1.5px solid ${selected ? "#6366F1" : "#E5E7EB"}`,
      borderRadius: 10,
      padding: "10px 16px",
      minWidth: 140,
      boxShadow: selected ? "0 0 0 3px rgba(99,102,241,0.12)" : "0 1px 3px rgba(0,0,0,0.06)",
      transition: "all 0.2s ease",
    }}
  >
    <Handle type="target" position={Position.Left} style={{ ...handleStyle, left: -5 }} />
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
        background: "#FFF7ED", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EA580C" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", lineHeight: "16px" }}>
          {data.label as string}
        </div>
        <div style={{ fontSize: 10, color: "#9CA3AF" }}>Service Task</div>
      </div>
    </div>
    <Handle type="source" position={Position.Right} style={{ ...handleStyle, right: -5 }} />
  </div>
));
ServiceTaskNode.displayName = "ServiceTaskNode";

/* ─── Exclusive Gateway ─── */
export const ExclusiveGatewayNode = memo(({ data, selected }: NodeProps) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
    <div
      style={{
        width: 44,
        height: 44,
        transform: "rotate(45deg)",
        background: selected ? "#FEF9C3" : "#FFFBEB",
        border: `2px solid ${selected ? "#CA8A04" : "#FDE68A"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: selected ? "0 0 0 3px rgba(202,138,4,0.15)" : "0 1px 3px rgba(0,0,0,0.06)",
        transition: "all 0.2s ease",
        borderRadius: 4,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CA8A04" strokeWidth="2.5" strokeLinecap="round" style={{ transform: "rotate(-45deg)" }}>
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </div>
    {data.label && (
      <span style={{ fontSize: 11, color: "#475467", fontWeight: 500, maxWidth: 80, textAlign: "center", lineHeight: "14px", marginTop: 2 }}>
        {data.label as string}
      </span>
    )}
    <Handle type="target" position={Position.Left} style={{ ...handleStyle, left: -4, top: 22 }} />
    <Handle type="source" position={Position.Right} style={{ ...handleStyle, right: -4, top: 22 }} />
    <Handle type="source" id="bottom" position={Position.Bottom} style={{ ...handleStyle, bottom: data.label ? -20 : -4 }} />
  </div>
));
ExclusiveGatewayNode.displayName = "ExclusiveGatewayNode";

/* ─── Node type map for React Flow ─── */
export const nodeTypes = {
  startEvent: StartEventNode,
  endEvent: EndEventNode,
  userTask: UserTaskNode,
  serviceTask: ServiceTaskNode,
  exclusiveGateway: ExclusiveGatewayNode,
};
