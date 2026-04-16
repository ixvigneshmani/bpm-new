import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseGatewayNode from "./base/BaseGatewayNode";
import { ExclusiveGatewayIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.exclusiveGateway;

const ExclusiveGatewayNode = memo((props: NodeProps) => (
  <BaseGatewayNode
    {...props}
    icon={<ExclusiveGatewayIcon color={theme.color} />}
    accentColor={theme.color}
    bgColor={theme.bgLight}
    bgSelected={theme.bgSelected}
  />
));
ExclusiveGatewayNode.displayName = "ExclusiveGatewayNode";

export default ExclusiveGatewayNode;
