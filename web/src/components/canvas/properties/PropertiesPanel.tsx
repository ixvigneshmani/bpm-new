/* ─── Properties Panel ────────────────────────────────────────────────
 * Main properties panel shell. Reads selected node type, renders matching
 * collapsible sections. Always shows General + Variables sections.
 * ──────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import useCanvasStore from "../../../store/canvas-store";
import type {
  StartEventData,
  EndEventData,
  UserTaskData,
  ServiceTaskData,
  ScriptTaskData,
  SendTaskData,
  ReceiveTaskData,
  ManualTaskData,
  BusinessRuleTaskData,
  CallActivityData,
  ExclusiveGatewayData,
  InclusiveGatewayData,
  EventBasedGatewayData,
  EventDefinition,
  Assignment,
  SchedulingConfig,
  SlaConfig,
  ServiceImplementation,
  ResilienceConfig,
  ScriptConfig,
  SendMessageConfig,
  ReceiveMessageConfig,
  BusinessRuleConfig,
  CallActivityConfig,
  LoopMarker,
  CompensationMarker,
  VariableMapping,
  KeyValuePair,
} from "../../../types/bpmn-node-data";
import type { GatewayKind } from "./sections/GatewayFlowsSection";
import GeneralSection from "./sections/GeneralSection";
import EventDefinitionSection from "./sections/EventDefinitionSection";
import AssignmentSection from "./sections/AssignmentSection";
import SchedulingSection from "./sections/SchedulingSection";
import ImplementationSection from "./sections/ImplementationSection";
import ResilienceSection from "./sections/ResilienceSection";
import GatewayFlowsSection from "./sections/GatewayFlowsSection";
import VariablesSection from "./sections/VariablesSection";
import ScriptSection from "./sections/ScriptSection";
import MessageSection from "./sections/MessageSection";
import ManualInstructionsSection from "./sections/ManualInstructionsSection";
import BusinessRuleSection from "./sections/BusinessRuleSection";
import CallActivitySection from "./sections/CallActivitySection";
import MultiInstanceSection from "./sections/MultiInstanceSection";

/** BPMN types that support activity markers (loop / multi-instance / compensation). */
const ACTIVITY_TYPES = new Set([
  "userTask", "serviceTask", "scriptTask", "sendTask", "receiveTask",
  "manualTask", "businessRuleTask", "callActivity",
]);

/** Maps a gateway bpmnType to its behavioural kind. */
const GATEWAY_KIND_BY_TYPE: Record<string, GatewayKind | undefined> = {
  exclusiveGateway: "exclusive",
  inclusiveGateway: "inclusive",
  parallelGateway: "parallel",
  eventBasedGateway: "eventBased",
};

type SectionConfig = {
  id: string;
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
  defaultOpen?: boolean;
};

export default function PropertiesPanel() {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeLabel = useCanvasStore((s) => s.updateNodeLabel);
  const updateEdgeLabel = useCanvasStore((s) => s.updateEdgeLabel);
  const setEdgeCondition = useCanvasStore((s) => s.setEdgeCondition);
  const setGatewayDefaultFlow = useCanvasStore((s) => s.setGatewayDefaultFlow);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return <EmptyState />;
  }

  const data = selectedNode.data as Record<string, unknown>;
  const bpmnType = (data.bpmnType as string) || selectedNode.type || "unknown";

  // Helpers to update specific data fields
  const update = (patch: Record<string, unknown>) => updateNodeData(selectedNode.id, patch as any);

  // Build section list based on node type
  const sections: SectionConfig[] = [];

  // General — always first
  sections.push({
    id: "general",
    title: "General",
    icon: <SectionIcon d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />,
    defaultOpen: true,
    content: (
      <GeneralSection
        nodeId={selectedNode.id}
        bpmnType={bpmnType}
        label={(data.label as string) || ""}
        onLabelChange={(label) => updateNodeLabel(selectedNode.id, label)}
      />
    ),
  });

  // Node-specific sections
  if (bpmnType === "startEvent") {
    const d = data as unknown as StartEventData;
    sections.push({
      id: "eventDef",
      title: "Event Definition",
      icon: <SectionIcon d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />,
      defaultOpen: true,
      content: (
        <EventDefinitionSection
          definition={d.eventDefinition || { kind: "none" }}
          onChange={(def: EventDefinition) => update({ eventDefinition: def })}
          isStart
        />
      ),
    });
  }

  if (bpmnType === "endEvent") {
    const d = data as unknown as EndEventData;
    sections.push({
      id: "eventDef",
      title: "Event Definition",
      icon: <SectionIcon d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />,
      defaultOpen: true,
      content: (
        <EventDefinitionSection
          definition={d.eventDefinition || { kind: "none" }}
          onChange={(def: EventDefinition) => update({ eventDefinition: def })}
          isStart={false}
        />
      ),
    });
  }

  if (bpmnType === "userTask") {
    const d = data as unknown as UserTaskData;
    sections.push({
      id: "assignment",
      title: "Assignment",
      icon: <SectionIcon d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" extra={<circle cx="12" cy="7" r="4" />} />,
      defaultOpen: true,
      content: (
        <AssignmentSection
          assignment={d.assignment}
          onChange={(a: Assignment) => update({ assignment: a })}
        />
      ),
    });
    sections.push({
      id: "scheduling",
      title: "Scheduling & SLA",
      icon: <SectionIcon d="M12 2a10 10 0 100 20 10 10 0 000-20z" extra={<><polyline points="12 6 12 12 16 14" /></>} />,
      content: (
        <SchedulingSection
          scheduling={d.scheduling}
          sla={d.sla}
          onSchedulingChange={(s: SchedulingConfig) => update({ scheduling: s })}
          onSlaChange={(s: SlaConfig) => update({ sla: s })}
        />
      ),
    });
  }

  if (bpmnType === "serviceTask") {
    const d = data as unknown as ServiceTaskData;
    sections.push({
      id: "implementation",
      title: "Implementation",
      icon: <SectionIcon d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />,
      defaultOpen: true,
      content: (
        <ImplementationSection
          implementation={d.implementation}
          onChange={(impl: ServiceImplementation) => update({ implementation: impl })}
        />
      ),
    });
    sections.push({
      id: "resilience",
      title: "Resilience",
      icon: <SectionIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
      content: (
        <ResilienceSection
          resilience={d.resilience}
          onChange={(r: ResilienceConfig) => update({ resilience: r })}
        />
      ),
    });
  }

  if (bpmnType === "scriptTask") {
    const d = data as unknown as ScriptTaskData;
    sections.push({
      id: "script",
      title: "Script",
      icon: <SectionIcon d="M16 18l6-6-6-6" extra={<path d="M8 6l-6 6 6 6" />} />,
      defaultOpen: true,
      content: (
        <ScriptSection
          script={d.script}
          onChange={(s: ScriptConfig) => update({ script: s })}
        />
      ),
    });
  }

  if (bpmnType === "sendTask") {
    const d = data as unknown as SendTaskData;
    sections.push({
      id: "message",
      title: "Message",
      icon: <SectionIcon d="M22 2L11 13" extra={<polygon points="22 2 15 22 11 13 2 9 22 2" />} />,
      defaultOpen: true,
      content: (
        <MessageSection
          mode="send"
          config={d.message}
          onChange={(c) => update({ message: c as SendMessageConfig })}
        />
      ),
    });
  }

  if (bpmnType === "receiveTask") {
    const d = data as unknown as ReceiveTaskData;
    sections.push({
      id: "message",
      title: "Message",
      icon: <SectionIcon d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" extra={<polyline points="22,6 12,13 2,6" />} />,
      defaultOpen: true,
      content: (
        <MessageSection
          mode="receive"
          config={d.message}
          onChange={(c) => update({ message: c as ReceiveMessageConfig })}
          instantiate={d.instantiate}
          onInstantiateChange={(v) => update({ instantiate: v })}
        />
      ),
    });
  }

  if (bpmnType === "manualTask") {
    const d = data as unknown as ManualTaskData;
    sections.push({
      id: "instructions",
      title: "Instructions",
      icon: <SectionIcon d="M9 12h6M9 16h6M9 8h6" extra={<path d="M14 3v4a1 1 0 001 1h4M5 5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5z" />} />,
      defaultOpen: true,
      content: (
        <ManualInstructionsSection
          instructions={d.instructions}
          onChange={(v) => update({ instructions: v })}
        />
      ),
    });
  }

  if (bpmnType === "businessRuleTask") {
    const d = data as unknown as BusinessRuleTaskData;
    sections.push({
      id: "rule",
      title: "Decision Rule",
      icon: <SectionIcon d="M3 3h18v18H3z" extra={<><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /></>} />,
      defaultOpen: true,
      content: (
        <BusinessRuleSection
          rule={d.rule}
          onChange={(r: BusinessRuleConfig) => update({ rule: r })}
        />
      ),
    });
  }

  if (bpmnType === "callActivity") {
    const d = data as unknown as CallActivityData;
    sections.push({
      id: "call",
      title: "Called Process",
      icon: <SectionIcon d="M6 3h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z" extra={<polyline points="9 10 12 13 15 10" />} />,
      defaultOpen: true,
      content: (
        <CallActivitySection
          call={d.call}
          onChange={(c: CallActivityConfig) => update({ call: c })}
        />
      ),
    });
  }

  const gatewayKind = GATEWAY_KIND_BY_TYPE[bpmnType];
  if (gatewayKind) {
    // Only exclusive and inclusive gateways carry a default flow per BPMN spec.
    const defaultFlowId =
      gatewayKind === "exclusive" || gatewayKind === "inclusive"
        ? (data as unknown as ExclusiveGatewayData | InclusiveGatewayData).defaultFlowId
        : undefined;

    sections.push({
      id: "flows",
      title: "Outgoing Flows",
      icon: <SectionIcon d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />,
      defaultOpen: true,
      content: (
        <GatewayFlowsSection
          nodeId={selectedNode.id}
          kind={gatewayKind}
          edges={edges}
          nodes={nodes.map((n) => ({ id: n.id, type: n.type, data: n.data as Record<string, unknown> }))}
          defaultFlowId={defaultFlowId}
          onDefaultFlowChange={(id) => setGatewayDefaultFlow(selectedNode.id, id ?? null)}
          onEdgeConditionChange={(edgeId, condition) => setEdgeCondition(edgeId, condition)}
          onEdgeLabelChange={(edgeId, label) => updateEdgeLabel(edgeId, label)}
        />
      ),
    });

    // Event-based: extra instantiate toggle
    if (gatewayKind === "eventBased") {
      const dEb = data as unknown as EventBasedGatewayData;
      sections.push({
        id: "ebConfig",
        title: "Event-Based Config",
        icon: <SectionIcon d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" />,
        content: (
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-[12px] text-gray-700">
              <input
                type="checkbox"
                checked={!!dEb.instantiate}
                onChange={(e) => update({ instantiate: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Instantiating</span>
                <span className="block text-[10px] text-gray-500">
                  When checked, the first arriving event starts a new process instance (no incoming flow needed).
                </span>
              </span>
            </label>
          </div>
        ),
      });
    }
  }

  // Multi-Instance / Loop Markers — shared by all activity types
  if (ACTIVITY_TYPES.has(bpmnType)) {
    sections.push({
      id: "multiInstance",
      title: "Multi-Instance & Loop",
      icon: <SectionIcon d="M17 4v4h-4" extra={<><path d="M20 11a8 8 0 00-15-3" /><path d="M7 20v-4h4" /><path d="M4 13a8 8 0 0015 3" /></>} />,
      content: (
        <MultiInstanceSection
          loopMarker={data.loopMarker as LoopMarker | undefined}
          compensation={data.compensation as CompensationMarker | undefined}
          onLoopChange={(lm) => update({ loopMarker: lm })}
          onCompensationChange={(c) => update({ compensation: c })}
        />
      ),
    });
  }

  // Variables — always last
  sections.push({
    id: "variables",
    title: "Variables & Mappings",
    icon: <SectionIcon d="M20 7h-3a2 2 0 01-2-2V2" extra={<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />} />,
    content: (
      <VariablesSection
        inputMappings={(data.inputMappings as VariableMapping[]) || []}
        outputMappings={(data.outputMappings as VariableMapping[]) || []}
        extensionProperties={(data.extensionProperties as KeyValuePair[]) || []}
        onInputMappingsChange={(m) => update({ inputMappings: m })}
        onOutputMappingsChange={(m) => update({ outputMappings: m })}
        onExtensionPropertiesChange={(p) => update({ extensionProperties: p })}
      />
    ),
  });

  return (
    <div style={{
      position: "absolute",
      top: 0, right: 0, bottom: 0,
      width: "50%",
      minWidth: 420,
      zIndex: 10,
      background: "#ffffff",
      borderLeft: "1px solid #E5E7EB",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "18px 28px 16px",
        borderBottom: "1px solid #f2f4f7",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#101828", letterSpacing: "-0.01em" }}>Properties</div>
          <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 2 }}>Configure element behavior</div>
        </div>
        {/* Close button */}
        <button
          type="button"
          onClick={() => useCanvasStore.getState().setSelectedNode(null)}
          style={{
            width: 32, height: 32, borderRadius: 8, border: "none",
            background: "transparent", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#98a2b3", transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#f2f4f7"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          title="Close properties"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Sections */}
      <div className="props-panel" style={{ flex: 1, overflowY: "auto" }}>
        {sections.map((section) => (
          <CollapsibleSection
            key={section.id}
            title={section.title}
            icon={section.icon}
            defaultOpen={section.defaultOpen}
          >
            {section.content}
          </CollapsibleSection>
        ))}
      </div>
    </div>
  );
}

/* ─── Collapsible Section ─── */

function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: "1px solid #f2f4f7" }}>
      <button
        type="button"
        className="section-header"
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          width: "100%", padding: "16px 28px",
          background: "transparent", border: "none", borderRadius: 0,
          cursor: "pointer", textAlign: "left",
          transition: "background 0.15s ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#f9fafb"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <div style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", color: "#98a2b3" }}>
          {icon}
        </div>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#344054" }}>{title}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9CA3AF"
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={{ padding: "4px 28px 28px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── Empty state ─── */

function EmptyState() {
  // When nothing is selected, don't show the floating panel at all
  return null;
}

/* ─── Section icon helper ─── */

function SectionIcon({ d, extra }: { d: string; extra?: React.ReactNode }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
      {extra}
    </svg>
  );
}
