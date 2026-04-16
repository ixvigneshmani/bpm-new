import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseTaskNode from "./base/BaseTaskNode";
import { ServiceTaskIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.serviceTask;

const ServiceTaskNode = memo((props: NodeProps) => (
  <BaseTaskNode
    {...props}
    icon={<ServiceTaskIcon color={theme.color} />}
    iconBg={theme.iconBg}
    accentColor={theme.color}
    typeName={theme.label}
  />
));
ServiceTaskNode.displayName = "ServiceTaskNode";

export default ServiceTaskNode;
