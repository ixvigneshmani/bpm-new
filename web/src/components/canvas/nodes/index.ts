/* ─── Node Types Registry ─────────────────────────────────────────────
 * Maps BPMN type strings to React Flow node components.
 * This is the single source of truth for what renders on the canvas.
 * ──────────────────────────────────────────────────────────────────── */

import StartEventNode from "./StartEventNode";
import EndEventNode from "./EndEventNode";
import IntermediateCatchEventNode from "./IntermediateCatchEventNode";
import IntermediateThrowEventNode from "./IntermediateThrowEventNode";
import BoundaryEventNode from "./BoundaryEventNode";
import UserTaskNode from "./UserTaskNode";
import ServiceTaskNode from "./ServiceTaskNode";
import ScriptTaskNode from "./ScriptTaskNode";
import SendTaskNode from "./SendTaskNode";
import ReceiveTaskNode from "./ReceiveTaskNode";
import ManualTaskNode from "./ManualTaskNode";
import BusinessRuleTaskNode from "./BusinessRuleTaskNode";
import CallActivityNode from "./CallActivityNode";
import ExclusiveGatewayNode from "./ExclusiveGatewayNode";
import ParallelGatewayNode from "./ParallelGatewayNode";
import InclusiveGatewayNode from "./InclusiveGatewayNode";
import EventBasedGatewayNode from "./EventBasedGatewayNode";

export const nodeTypes = {
  startEvent: StartEventNode,
  endEvent: EndEventNode,
  intermediateCatchEvent: IntermediateCatchEventNode,
  intermediateThrowEvent: IntermediateThrowEventNode,
  boundaryEvent: BoundaryEventNode,
  userTask: UserTaskNode,
  serviceTask: ServiceTaskNode,
  scriptTask: ScriptTaskNode,
  sendTask: SendTaskNode,
  receiveTask: ReceiveTaskNode,
  manualTask: ManualTaskNode,
  businessRuleTask: BusinessRuleTaskNode,
  callActivity: CallActivityNode,
  exclusiveGateway: ExclusiveGatewayNode,
  parallelGateway: ParallelGatewayNode,
  inclusiveGateway: InclusiveGatewayNode,
  eventBasedGateway: EventBasedGatewayNode,
};
