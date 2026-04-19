import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseEventNode from "./base/BaseEventNode";
import {
  MessageIcon, SignalIcon, EscalationIcon, CompensationIcon, LinkIcon,
  NoneStartIcon,
} from "./icons/event-icons";
import type { IntermediateThrowEventData, EventDefinition } from "../../../types/bpmn-node-data";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.intermediateThrowEvent;

/** Throw events use the filled (solid) variant of each icon by BPMN
 *  convention — the solid fill visually signals "this event is being
 *  emitted" vs a catch event which is outlined ("being awaited"). */
function getThrowIcon(def: EventDefinition | undefined, color: string) {
  switch (def?.kind) {
    case "message":      return <MessageIcon color={color} filled />;
    case "signal":       return <SignalIcon color={color} filled />;
    case "escalation":   return <EscalationIcon color={color} filled />;
    case "compensation": return <CompensationIcon color={color} filled />;
    case "link":         return <LinkIcon color={color} filled />;
    default:             return <NoneStartIcon color={color} />;
  }
}

const IntermediateThrowEventNode = memo((props: NodeProps) => {
  const def = (props.data as IntermediateThrowEventData).eventDefinition;
  return (
    <BaseEventNode
      {...props}
      icon={getThrowIcon(def, theme.color)}
      accentColor={theme.color}
      bgColor={theme.bgLight}
      variant="intermediateThrow"
    />
  );
});
IntermediateThrowEventNode.displayName = "IntermediateThrowEventNode";

export default IntermediateThrowEventNode;
