import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseTaskNode from "./base/BaseTaskNode";
import BaseSubprocessFrame from "./base/BaseSubprocessFrame";
import { NODE_THEMES } from "../../../types/bpmn-node-data";
import { CollapsedMarker } from "./icons/subprocess-icons";

const theme = NODE_THEMES.eventSubProcess;

const EventSubProcessNode = memo((props: NodeProps) => {
  const d = props.data as { isExpanded?: boolean };
  const isExpanded = d.isExpanded !== false;
  if (isExpanded) {
    return (
      <BaseSubprocessFrame
        {...props}
        accentColor={theme.color}
        typeName={theme.label}
        borderStyle="dashed"
      />
    );
  }
  const { width: _w, height: _h, ...collapsedData } = props.data as Record<string, unknown>;
  void _w; void _h;
  return (
    <BaseTaskNode
      {...props}
      data={collapsedData}
      icon={<CollapsedMarker color={theme.color} kind="plus" />}
      iconBg={theme.iconBg}
      accentColor={theme.color}
      typeName={theme.label}
    />
  );
});
EventSubProcessNode.displayName = "EventSubProcessNode";
export default EventSubProcessNode;
