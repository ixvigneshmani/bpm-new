import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseTaskNode from "./base/BaseTaskNode";
import { CallActivityIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.callActivity;

const CallActivityNode = memo((props: NodeProps) => (
  <BaseTaskNode
    {...props}
    icon={<CallActivityIcon color={theme.color} />}
    iconBg={theme.iconBg}
    accentColor={theme.color}
    typeName={theme.label}
    borderStyle="double"
  />
));
CallActivityNode.displayName = "CallActivityNode";

export default CallActivityNode;
