/* ─── BaseGatewayNode ─────────────────────────────────────────────────
 * Reusable shell for all BPMN gateway types (Exclusive, Parallel, etc.).
 * Provides: rotated diamond shape, inner icon, label, multi-directional
 * handles, and polished visual style.
 * ──────────────────────────────────────────────────────────────────── */

import { memo, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "../../../../lib/utils";

type BaseGatewayProps = NodeProps & {
  icon: ReactNode;
  accentColor: string;    // hex for border/selection
  bgColor: string;        // hex for diamond fill
  bgSelected: string;     // hex for diamond fill when selected
};

const BaseGatewayNode = memo(({
  data,
  selected,
  icon,
  accentColor,
  bgColor,
  bgSelected,
}: BaseGatewayProps) => {
  const label = data.label as string;

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Diamond container */}
      <div className="relative" style={{ width: 50, height: 50 }}>
        {/* Rotated diamond */}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded transition-all duration-200",
          )}
          style={{
            transform: "rotate(45deg)",
            background: selected ? bgSelected : bgColor,
            border: `2px solid ${selected ? accentColor : `${accentColor}66`}`,
            boxShadow: selected
              ? `0 0 0 4px ${accentColor}12, 0 4px 12px ${accentColor}12`
              : `0 2px 6px ${accentColor}0A`,
            borderRadius: 5,
          }}
        />

        {/* Inner icon — counter-rotate so it stays upright */}
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          {icon}
        </div>
      </div>

      {/* Label below diamond */}
      {label && (
        <span
          className="max-w-[90px] text-center text-[11px] font-medium leading-[14px] text-gray-600"
          style={{
            textShadow: "0 1px 2px rgba(255,255,255,0.8)",
            marginTop: 2,
          }}
        >
          {label}
        </span>
      )}

      {/* Handles: left (target), right (source), top (source), bottom (source) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !rounded-full !border-[1.5px] !border-gray-300 !bg-white transition-colors hover:!border-gray-400"
        style={{ left: -4, top: 25 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!h-2 !w-2 !rounded-full !border-[1.5px] !border-gray-300 !bg-white transition-colors hover:!border-gray-400"
        style={{ right: -4, top: 25 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!h-2 !w-2 !rounded-full !border-[1.5px] !border-gray-300 !bg-white transition-colors hover:!border-gray-400"
        style={{ bottom: label ? -20 : -4 }}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className="!h-2 !w-2 !rounded-full !border-[1.5px] !border-gray-300 !bg-white transition-colors hover:!border-gray-400"
        style={{ top: -4 }}
      />
    </div>
  );
});
BaseGatewayNode.displayName = "BaseGatewayNode";

export default BaseGatewayNode;
