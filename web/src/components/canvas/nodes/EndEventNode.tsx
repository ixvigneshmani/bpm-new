import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseEventNode from "./base/BaseEventNode";
import {
  NoneEndIcon, ErrorIcon, TerminateIcon, EscalationIcon,
  MessageIcon, SignalIcon, CompensationIcon, CancelIcon,
} from "./icons/event-icons";
import type { EndEventData, EventDefinition } from "../../../types/bpmn-node-data";

function getEventIcon(def: EventDefinition | undefined, color: string) {
  switch (def?.kind) {
    case "error":        return <ErrorIcon color={color} filled />;
    case "terminate":    return <TerminateIcon color={color} />;
    case "escalation":   return <EscalationIcon color={color} filled />;
    case "message":      return <MessageIcon color={color} filled />;
    case "signal":       return <SignalIcon color={color} filled />;
    case "compensation": return <CompensationIcon color={color} filled />;
    case "cancel":       return <CancelIcon color={color} />;
    default:             return <NoneEndIcon color={color} />;
  }
}

const EndEventNode = memo((props: NodeProps) => {
  const nodeData = props.data as EndEventData;
  const color = "#DC2626";
  const def = nodeData.eventDefinition;

  return (
    <BaseEventNode
      {...props}
      icon={getEventIcon(def, color)}
      accentColor={color}
      bgColor="#FEF2F2"
      variant="end"
    />
  );
});
EndEventNode.displayName = "EndEventNode";

export default EndEventNode;
