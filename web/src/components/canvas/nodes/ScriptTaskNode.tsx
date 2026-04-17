import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseTaskNode from "./base/BaseTaskNode";
import { ScriptTaskIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.scriptTask;

const ScriptTaskNode = memo((props: NodeProps) => (
  <BaseTaskNode
    {...props}
    icon={<ScriptTaskIcon color={theme.color} />}
    iconBg={theme.iconBg}
    accentColor={theme.color}
    typeName={theme.label}
  />
));
ScriptTaskNode.displayName = "ScriptTaskNode";

export default ScriptTaskNode;
