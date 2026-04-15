import { useEffect, useRef, useCallback, type DragEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useSidebar } from "../components/layout/sidebar-context";
import useCanvasStore from "../store/canvas-store";
import { nodeTypes } from "../components/canvas/bpmn-nodes";
import ElementPalette from "../components/canvas/element-palette";
import PropertiesPanel from "../components/canvas/properties-panel";
import CanvasToolbar from "../components/canvas/canvas-toolbar";
import ProcessWizard from "../components/canvas/process-wizard";

function CanvasInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const wizardStep = useCanvasStore((s) => s.wizardStep);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const addNode = useCanvasStore((s) => s.addNode);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow-type");
      const label = event.dataTransfer.getData("application/reactflow-label");
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(type, position, label);
    },
    [screenToFlowPosition, addNode]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const showWizard = wizardStep !== "canvas";

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", position: "relative" }}>
      {/* Wizard overlay */}
      {showWizard && <ProcessWizard />}

      {/* Center canvas */}
      <div ref={reactFlowWrapper} style={{ flex: 1, position: "relative" }}>
        {/* Floating palette */}
        {!showWizard && <ElementPalette />}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={(instance) => { reactFlowInstance.current = instance; }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView={false}
          snapToGrid
          snapGrid={[16, 16]}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: { stroke: "#94A3B8", strokeWidth: 1.5 },
          }}
          connectionLineStyle={{ stroke: "#6366F1", strokeWidth: 1.5 }}
          connectionLineType="smoothstep"
          proOptions={{ hideAttribution: true }}
          style={{ background: "#F8FAFC" }}
        >
          {/* Visible indigo dots on subtle off-white */}
          <Background id="dots" color="#A5B4FC" gap={20} size={1.2} variant={BackgroundVariant.Dots} />
          <MiniMap
            nodeStrokeWidth={2}
            pannable
            zoomable
            style={{
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 8,
            }}
          />
          <CanvasToolbar />
        </ReactFlow>

        {/* Empty state overlay */}
        {nodes.length === 0 && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: "#F3F4F6", border: "1px solid #E5E7EB",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 12px",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round">
                <rect x="2" y="2" width="20" height="20" rx="3" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#344054", marginBottom: 4 }}>
              Design your process
            </div>
            <div style={{ fontSize: 13, color: "#9CA3AF", maxWidth: 240 }}>
              Drag elements from the palette on the left to start building your BPMN workflow
            </div>
          </div>
        )}
      </div>

      {/* Right properties — hidden during wizard */}
      {!showWizard && <PropertiesPanel />}
    </div>
  );
}

export default function DesignCanvasPage() {
  const { collapsed, setCollapsed } = useSidebar();
  const prevCollapsed = useRef(collapsed);

  useEffect(() => {
    prevCollapsed.current = collapsed;
    setCollapsed(true);
    return () => {
      setCollapsed(prevCollapsed.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
