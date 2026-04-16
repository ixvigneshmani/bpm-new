/* ─── BaseTaskNode ────────────────────────────────────────────────────
 * Reusable shell for all BPMN task types (User, Service, Script, etc.).
 * Provides: rounded card, icon slot, label, type subtitle, handles,
 * selection ring, markers slot, and a polished visual style.
 * ──────────────────────────────────────────────────────────────────── */

import { memo, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "../../../../lib/utils";

type BaseTaskProps = NodeProps & {
  icon: ReactNode;
  iconBg: string;        // Tailwind bg class or hex
  accentColor: string;    // hex for border/selection ring
  typeName: string;       // "User Task", "Service Task", etc.
  markers?: ReactNode;    // loop/MI/compensation badges (Phase 2)
  borderStyle?: string;   // "solid" | "double" for call activity
};

const BaseTaskNode = memo(({
  data,
  selected,
  icon,
  iconBg,
  accentColor,
  typeName,
  markers,
  borderStyle = "solid",
}: BaseTaskProps) => {
  const label = data.label as string;
  const description = (data as Record<string, unknown>).description as string | undefined;

  return (
    <div
      className={cn(
        "group relative min-w-[160px] max-w-[220px] rounded-xl bg-white transition-all duration-200",
        selected && "ring-2 ring-offset-1"
      )}
      style={{
        border: `${borderStyle === "double" ? "3px double" : "1.5px solid"} ${selected ? accentColor : "#E5E7EB"}`,
        boxShadow: selected
          ? `0 0 0 3px ${accentColor}18, 0 4px 12px rgba(0,0,0,0.08)`
          : "0 1px 4px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.02)",
        // ring color set via className
      }}
    >
      {/* Top accent bar */}
      <div
        className="absolute top-0 left-3 right-3 h-[2px] rounded-b-full opacity-60"
        style={{ background: accentColor }}
      />

      <div className="px-3.5 py-3">
        {/* Icon + text row */}
        <div className="flex items-start gap-2.5">
          {/* Icon container */}
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm"
            style={{
              background: iconBg,
              border: `1px solid ${accentColor}20`,
            }}
          >
            {icon}
          </div>

          {/* Label + type */}
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="truncate text-[12.5px] font-semibold leading-tight text-gray-900">
              {label}
            </div>
            <div
              className="mt-0.5 text-[10px] font-medium"
              style={{ color: accentColor }}
            >
              {typeName}
            </div>
          </div>
        </div>

        {/* Optional description preview */}
        {description && (
          <div className="mt-2 line-clamp-2 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-400">
            {description}
          </div>
        )}

        {/* Markers row (loop, MI, compensation) */}
        {markers && (
          <div className="mt-2 flex items-center gap-1 border-t border-gray-100 pt-1.5">
            {markers}
          </div>
        )}
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-gray-300 !bg-white transition-colors group-hover:!border-gray-400"
        style={{ left: -6 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-gray-300 !bg-white transition-colors group-hover:!border-gray-400"
        style={{ right: -6 }}
      />
    </div>
  );
});
BaseTaskNode.displayName = "BaseTaskNode";

export default BaseTaskNode;
