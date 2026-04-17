import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseTaskNode from "./base/BaseTaskNode";
import { ReceiveTaskIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.receiveTask;

const ReceiveTaskNode = memo((props: NodeProps) => (
  <BaseTaskNode
    {...props}
    icon={<ReceiveTaskIcon color={theme.color} />}
    iconBg={theme.iconBg}
    accentColor={theme.color}
    typeName={theme.label}
  />
));
ReceiveTaskNode.displayName = "ReceiveTaskNode";

export default ReceiveTaskNode;
