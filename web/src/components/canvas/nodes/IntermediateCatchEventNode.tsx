import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseEventNode from "./base/BaseEventNode";
import {
  TimerIcon, MessageIcon, SignalIcon, ConditionalIcon,
  EscalationIcon, CompensationIcon, LinkIcon, CancelIcon, ErrorIcon,
  NoneStartIcon,
} from "./icons/event-icons";
import type { IntermediateCatchEventData, EventDefinition } from "../../../types/bpmn-node-data";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.intermediateCatchEvent;

function getCatchIcon(def: EventDefinition | undefined, color: string) {
  switch (def?.kind) {
    case "timer":        return <TimerIcon color={color} />;
    case "message":      return <MessageIcon color={color} />;
    case "signal":       return <SignalIcon color={color} />;
    case "conditional":  return <ConditionalIcon color={color} />;
    case "error":        return <ErrorIcon color={color} />;
    case "escalation":   return <EscalationIcon color={color} />;
    case "compensation": return <CompensationIcon color={color} />;
    case "link":         return <LinkIcon color={color} />;
    case "cancel":       return <CancelIcon color={color} />;
    default:             return <NoneStartIcon color={color} />;
  }
}

const IntermediateCatchEventNode = memo((props: NodeProps) => {
  const def = (props.data as IntermediateCatchEventData).eventDefinition;
  return (
    <BaseEventNode
      {...props}
      icon={getCatchIcon(def, theme.color)}
      accentColor={theme.color}
      bgColor={theme.bgLight}
      variant="intermediateCatch"
    />
  );
});
IntermediateCatchEventNode.displayName = "IntermediateCatchEventNode";

export default IntermediateCatchEventNode;
