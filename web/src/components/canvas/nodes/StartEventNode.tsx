import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseEventNode from "./base/BaseEventNode";
import { NoneStartIcon, TimerIcon, MessageIcon, SignalIcon, ConditionalIcon } from "./icons/event-icons";
import type { StartEventData, EventDefinition } from "../../../types/bpmn-node-data";

function getEventIcon(def: EventDefinition | undefined, color: string) {
  switch (def?.kind) {
    case "timer":       return <TimerIcon color={color} />;
    case "message":     return <MessageIcon color={color} />;
    case "signal":      return <SignalIcon color={color} />;
    case "conditional": return <ConditionalIcon color={color} />;
    default:            return <NoneStartIcon color={color} />;
  }
}

const StartEventNode = memo((props: NodeProps) => {
  const nodeData = props.data as StartEventData;
  const color = "#16A34A";
  const def = nodeData.eventDefinition;

  return (
    <BaseEventNode
      {...props}
      icon={getEventIcon(def, color)}
      accentColor={color}
      bgColor="#F0FDF4"
      variant="start"
    />
  );
});
StartEventNode.displayName = "StartEventNode";

export default StartEventNode;
