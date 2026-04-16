import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseTaskNode from "./base/BaseTaskNode";
import { UserTaskIcon } from "./icons/event-icons";
import { NODE_THEMES } from "../../../types/bpmn-node-data";

const theme = NODE_THEMES.userTask;

const UserTaskNode = memo((props: NodeProps) => (
  <BaseTaskNode
    {...props}
    icon={<UserTaskIcon color={theme.color} />}
    iconBg={theme.iconBg}
    accentColor={theme.color}
    typeName={theme.label}
  />
));
UserTaskNode.displayName = "UserTaskNode";

export default UserTaskNode;
