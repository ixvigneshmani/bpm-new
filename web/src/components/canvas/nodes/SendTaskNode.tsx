import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseTaskNode from "./base/BaseTaskNode";
import { SendTaskIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.sendTask;

const SendTaskNode = memo((props: NodeProps) => (
  <BaseTaskNode
    {...props}
    icon={<SendTaskIcon color={theme.color} />}
    iconBg={theme.iconBg}
    accentColor={theme.color}
    typeName={theme.label}
  />
));
SendTaskNode.displayName = "SendTaskNode";

export default SendTaskNode;
