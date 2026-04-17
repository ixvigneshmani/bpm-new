import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseTaskNode from "./base/BaseTaskNode";
import { BusinessRuleTaskIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.businessRuleTask;

const BusinessRuleTaskNode = memo((props: NodeProps) => (
  <BaseTaskNode
    {...props}
    icon={<BusinessRuleTaskIcon color={theme.color} />}
    iconBg={theme.iconBg}
    accentColor={theme.color}
    typeName={theme.label}
  />
));
BusinessRuleTaskNode.displayName = "BusinessRuleTaskNode";

export default BusinessRuleTaskNode;
