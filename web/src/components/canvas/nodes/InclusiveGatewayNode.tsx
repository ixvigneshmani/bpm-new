import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseGatewayNode from "./base/BaseGatewayNode";
import { InclusiveGatewayIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.inclusiveGateway;

const InclusiveGatewayNode = memo((props: NodeProps) => (
  <BaseGatewayNode
    {...props}
    icon={<InclusiveGatewayIcon color={theme.color} />}
    accentColor={theme.color}
    bgColor={theme.bgLight}
    bgSelected={theme.bgSelected}
  />
));
InclusiveGatewayNode.displayName = "InclusiveGatewayNode";

export default InclusiveGatewayNode;
