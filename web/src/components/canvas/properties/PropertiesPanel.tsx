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
  ExclusiveGatewayData,
  EventDefinition,
  Assignment,
  SchedulingConfig,
  SlaConfig,
  ServiceImplementation,
  ResilienceConfig,
  VariableMapping,
  KeyValuePair,
} from "../../../types/bpmn-node-data";
import GeneralSection from "./sections/GeneralSection";
import EventDefinitionSection from "./sections/EventDefinitionSection";
import AssignmentSection from "./sections/AssignmentSection";
import SchedulingSection from "./sections/SchedulingSection";
import ImplementationSection from "./sections/ImplementationSection";
import ResilienceSection from "./sections/ResilienceSection";
import GatewayFlowsSection from "./sections/GatewayFlowsSection";
import VariablesSection from "./sections/VariablesSection";

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
        description={(data.description as string) || ""}
        documentation={(data.documentation as string) || ""}
        showDescriptionDocs={bpmnType !== "startEvent" && bpmnType !== "endEvent"}
        onLabelChange={(label) => updateNodeLabel(selectedNode.id, label)}
        onDescriptionChange={(desc) => update({ description: desc })}
        onDocumentationChange={(doc) => update({ documentation: doc })}
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

  if (bpmnType === "exclusiveGateway") {
    const d = data as unknown as ExclusiveGatewayData;
    sections.push({
      id: "flows",
      title: "Outgoing Flows",
      icon: <SectionIcon d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />,
      defaultOpen: true,
      content: (
        <GatewayFlowsSection
          nodeId={selectedNode.id}
          edges={edges}
          nodes={nodes.map((n) => ({ id: n.id, data: n.data as Record<string, unknown> }))}
          defaultFlowId={d.defaultFlowId}
          onDefaultFlowChange={(id) => update({ defaultFlowId: id })}
          onEdgeConditionChange={(edgeId, condition) => {
            useCanvasStore.setState({
              edges: edges.map((e) =>
                e.id === edgeId
                  ? { ...e, data: { ...((e.data || {}) as Record<string, unknown>), condition } }
                  : e
              ),
            });
          }}
          onEdgeLabelChange={(edgeId, label) => {
            useCanvasStore.setState({
              edges: edges.map((e) =>
                e.id === edgeId ? { ...e, label } : e
              ),
            });
          }}
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
      position: "absolute", top: 12, right: 12, zIndex: 10,
      width: 480,
      maxWidth: "calc(100% - 24px)",
      background: "rgba(255,255,255,0.97)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      border: "1px solid #E5E7EB",
      borderRadius: 14,
      boxShadow: "0 4px 24px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
      display: "flex", flexDirection: "column",
      maxHeight: "calc(100% - 24px)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px 10px", borderBottom: "1px solid #f2f4f7",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Properties</div>
          <div style={{ fontSize: 10, color: "#98a2b3", marginTop: 1 }}>Configure element behavior</div>
        </div>
        {/* Close / collapse button */}
        <button
          type="button"
          onClick={() => useCanvasStore.getState().setSelectedNode(null)}
          style={{
            width: 28, height: 28, borderRadius: 8, border: "none",
            background: "transparent", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#98a2b3", transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#f2f4f7"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          title="Close properties"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
          display: "flex", alignItems: "center", gap: 10,
          width: "100%", padding: "12px 20px",
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
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#344054" }}>{title}</span>
        <svg
          width="12"
          height="12"
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
        <div style={{ padding: "6px 20px 22px" }}>
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
