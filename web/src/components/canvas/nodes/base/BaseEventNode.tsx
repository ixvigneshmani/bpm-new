/* ─── BaseEventNode ───────────────────────────────────────────────────
 * Reusable shell for all BPMN event types (Start, End, Intermediate).
 * Provides: circle shape, inner icon slot, label, handles, and a
 * polished visual style with event-type-specific ring styles.
 * ──────────────────────────────────────────────────────────────────── */

import { memo, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "../../../../lib/utils";

export type EventVariant = "start" | "end" | "intermediateThrow" | "intermediateCatch" | "boundary";

type BaseEventProps = NodeProps & {
  icon: ReactNode;
  accentColor: string;    // hex for border/ring
  bgColor: string;        // hex for circle background
  variant: EventVariant;
  isInterrupting?: boolean; // for boundary events
};

const BaseEventNode = memo(({
  data,
  selected,
  icon,
  accentColor,
  bgColor,
  variant,
  isInterrupting = true,
}: BaseEventProps) => {
  const label = data.label as string;

  // Event circle style varies by variant
  const size = variant === "end" ? 48 : 46;
  const borderWidth = variant === "end" ? 3 : variant === "start" ? 2 : 2;
  const isDouble = variant === "intermediateCatch" || variant === "intermediateThrow" || variant === "boundary";
  const isDashed = !isInterrupting && variant === "boundary";

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Circle */}
      <div
        className={cn(
          "relative flex items-center justify-center transition-all duration-200",
          selected && "scale-105"
        )}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: selected ? bgColor : `${bgColor}CC`,
          border: `${borderWidth}px ${isDashed ? "dashed" : "solid"} ${selected ? accentColor : `${accentColor}88`}`,
          boxShadow: selected
            ? `0 0 0 4px ${accentColor}15, 0 4px 12px ${accentColor}15`
            : `0 2px 8px ${accentColor}10`,
          transition: "all 0.2s ease",
        }}
      >
        {/* Double ring for intermediate/boundary */}
        {isDouble && (
          <div
            className="absolute inset-[3px] rounded-full"
            style={{
              border: `1.5px ${isDashed ? "dashed" : "solid"} ${selected ? accentColor : `${accentColor}66`}`,
            }}
          />
        )}

        {/* Inner icon */}
        <div className="relative z-10 flex items-center justify-center">
          {icon}
        </div>
      </div>

      {/* Label */}
      {label && (
        <span
          className="max-w-[90px] text-center text-[11px] font-medium leading-[14px] text-gray-600"
          style={{
            textShadow: "0 1px 2px rgba(255,255,255,0.8)",
          }}
        >
          {label}
        </span>
      )}

      {/* Handles — vary by event variant */}
      {(variant === "start" || variant === "intermediateCatch" || variant === "boundary") && (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-2 !w-2 !rounded-full !border-[1.5px] !border-gray-300 !bg-white transition-colors hover:!border-gray-400"
          style={{ right: -4, top: size / 2 }}
        />
      )}

      {variant === "start" && null /* no target handle on start */}

      {(variant === "end" || variant === "intermediateThrow") && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2 !w-2 !rounded-full !border-[1.5px] !border-gray-300 !bg-white transition-colors hover:!border-gray-400"
          style={{ left: -4, top: size / 2 }}
        />
      )}

      {(variant === "intermediateCatch" || variant === "boundary") && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2 !w-2 !rounded-full !border-[1.5px] !border-gray-300 !bg-white transition-colors hover:!border-gray-400"
          style={{ left: -4, top: size / 2 }}
        />
      )}

      {variant === "intermediateThrow" && (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-2 !w-2 !rounded-full !border-[1.5px] !border-gray-300 !bg-white transition-colors hover:!border-gray-400"
          style={{ right: -4, top: size / 2 }}
        />
      )}
    </div>
  );
});
BaseEventNode.displayName = "BaseEventNode";

export default BaseEventNode;
