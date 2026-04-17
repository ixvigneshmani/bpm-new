import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseTaskNode from "./base/BaseTaskNode";
import { ManualTaskIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.manualTask;

const ManualTaskNode = memo((props: NodeProps) => (
  <BaseTaskNode
    {...props}
    icon={<ManualTaskIcon color={theme.color} />}
    iconBg={theme.iconBg}
    accentColor={theme.color}
    typeName={theme.label}
  />
));
ManualTaskNode.displayName = "ManualTaskNode";

export default ManualTaskNode;
