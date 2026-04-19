import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseEventNode from "./base/BaseEventNode";
import {
  TimerIcon, MessageIcon, SignalIcon, ConditionalIcon,
  EscalationIcon, CompensationIcon, ErrorIcon, CancelIcon,
  NoneStartIcon,
} from "./icons/event-icons";
import type { BoundaryEventData, EventDefinition } from "../../../types/bpmn-node-data";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.boundaryEvent;

function getBoundaryIcon(def: EventDefinition | undefined, color: string) {
  switch (def?.kind) {
    case "timer":        return <TimerIcon color={color} />;
    case "message":      return <MessageIcon color={color} />;
    case "signal":       return <SignalIcon color={color} />;
    case "conditional":  return <ConditionalIcon color={color} />;
    case "error":        return <ErrorIcon color={color} />;
    case "escalation":   return <EscalationIcon color={color} />;
    case "compensation": return <CompensationIcon color={color} />;
    case "cancel":       return <CancelIcon color={color} />;
    default:             return <NoneStartIcon color={color} />;
  }
}

const BoundaryEventNode = memo((props: NodeProps) => {
  const data = props.data as BoundaryEventData;
  // cancelActivity === false → non-interrupting → dashed ring per spec.
  const isInterrupting = data.cancelActivity !== false;
  return (
    <BaseEventNode
      {...props}
      icon={getBoundaryIcon(data.eventDefinition, theme.color)}
      accentColor={theme.color}
      bgColor={theme.bgLight}
      variant="boundary"
      isInterrupting={isInterrupting}
    />
  );
});
BoundaryEventNode.displayName = "BoundaryEventNode";

export default BoundaryEventNode;
