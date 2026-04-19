import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import BaseTaskNode from "./base/BaseTaskNode";
import BaseSubprocessFrame from "./base/BaseSubprocessFrame";
import { NODE_THEMES } from "../../../types/bpmn-node-data";
import { CollapsedMarker } from "./icons/subprocess-icons";

const theme = NODE_THEMES.transaction;

const TransactionNode = memo((props: NodeProps) => {
  const d = props.data as { isExpanded?: boolean };
  const isExpanded = d.isExpanded !== false;
  if (isExpanded) {
    return (
      <BaseSubprocessFrame
        {...props}
        accentColor={theme.color}
        typeName={theme.label}
        borderStyle="double"
      />
    );
  }
  return (
    <BaseTaskNode
      {...props}
      icon={<CollapsedMarker color={theme.color} kind="plus" />}
      iconBg={theme.iconBg}
      accentColor={theme.color}
      typeName={theme.label}
      borderStyle="double"
    />
  );
});
TransactionNode.displayName = "TransactionNode";
export default TransactionNode;
