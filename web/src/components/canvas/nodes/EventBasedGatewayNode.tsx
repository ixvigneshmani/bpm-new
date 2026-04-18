import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseGatewayNode from "./base/BaseGatewayNode";
import { EventBasedGatewayIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.eventBasedGateway;

const EventBasedGatewayNode = memo((props: NodeProps) => (
  <BaseGatewayNode
    {...props}
    icon={<EventBasedGatewayIcon color={theme.color} />}
    accentColor={theme.color}
    bgColor={theme.bgLight}
    bgSelected={theme.bgSelected}
  />
));
EventBasedGatewayNode.displayName = "EventBasedGatewayNode";

export default EventBasedGatewayNode;
