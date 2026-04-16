/* ─── Node Types Registry ─────────────────────────────────────────────
 * Maps BPMN type strings to React Flow node components.
 * This is the single source of truth for what renders on the canvas.
 * ──────────────────────────────────────────────────────────────────── */

import StartEventNode from "./StartEventNode";
import EndEventNode from "./EndEventNode";
import UserTaskNode from "./UserTaskNode";
import ServiceTaskNode from "./ServiceTaskNode";
import ExclusiveGatewayNode from "./ExclusiveGatewayNode";

export const nodeTypes = {
  startEvent: StartEventNode,
  endEvent: EndEventNode,
  userTask: UserTaskNode,
  serviceTask: ServiceTaskNode,
  exclusiveGateway: ExclusiveGatewayNode,
};
