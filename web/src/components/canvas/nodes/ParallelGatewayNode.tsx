import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseGatewayNode from "./base/BaseGatewayNode";
import { ParallelGatewayIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.parallelGateway;

const ParallelGatewayNode = memo((props: NodeProps) => (
  <BaseGatewayNode
    {...props}
    icon={<ParallelGatewayIcon color={theme.color} />}
    accentColor={theme.color}
    bgColor={theme.bgLight}
    bgSelected={theme.bgSelected}
  />
));
ParallelGatewayNode.displayName = "ParallelGatewayNode";

export default ParallelGatewayNode;
