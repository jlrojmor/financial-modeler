"use client";

import { ReactNode, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";

interface CollapsibleSectionProps {
  sectionId: string;
  title: string;
  description?: string;
  borderColor?: string;
  bgColor?: string;
  textColor?: string;
  colorClass?: "blue" | "green" | "orange" | "red" | "purple" | "amber" | "slate";
  children: ReactNode;
  onConfirm?: () => void;
  confirmButtonLabel?: string;
  defaultExpanded?: boolean;
}

/**
 * Reusable collapsible section component for Builder Panel
 * 
 * Features:
 * - Lock/unlock functionality
 * - Expand/collapse functionality
 * - Confirm button to lock and collapse
 * - Unlock button when locked
 */
// Color class mappings
const COLOR_MAP: Record<string, { border: string; bg: string; text: string }> = {
  blue: { border: "border-blue-800/40", bg: "bg-blue-950/20", text: "text-blue-200" },
  green: { border: "border-green-800/40", bg: "bg-green-950/20", text: "text-green-200" },
  orange: { border: "border-orange-800/40", bg: "bg-orange-950/20", text: "text-orange-200" },
  red: { border: "border-red-800/40", bg: "bg-red-950/20", text: "text-red-200" },
  purple: { border: "border-purple-800/40", bg: "bg-purple-950/20", text: "text-purple-200" },
  amber: { border: "border-amber-800/40", bg: "bg-amber-950/20", text: "text-amber-200" },
  slate: { border: "border-slate-800/40", bg: "bg-slate-950/20", text: "text-slate-200" },
};

export default function CollapsibleSection({
  sectionId,
  title,
  description,
  borderColor,
  bgColor,
  textColor,
  colorClass,
  children,
  onConfirm,
  confirmButtonLabel = "Done",
  defaultExpanded = true,
}: CollapsibleSectionProps) {
  // Use colorClass if provided, otherwise use individual props
  const colors = colorClass 
    ? COLOR_MAP[colorClass] || COLOR_MAP.blue
    : {
        border: borderColor || "border-blue-800/40",
        bg: bgColor || "bg-blue-950/20",
        text: textColor || "text-blue-200",
      };
  const isLocked = useModelStore((s) => s.sectionLocks[sectionId] ?? false);
  const sectionExpanded = useModelStore((s) => s.sectionExpanded[sectionId]);
  const setSectionExpanded = useModelStore((s) => s.setSectionExpanded);
  
  // Use stored state if exists, otherwise use defaultExpanded
  const isExpanded = sectionExpanded !== undefined ? sectionExpanded : defaultExpanded;
  
  // Initialize expanded state if not set
  useEffect(() => {
    if (sectionExpanded === undefined) {
      setSectionExpanded(sectionId, defaultExpanded);
    }
  }, [sectionId, defaultExpanded, sectionExpanded, setSectionExpanded]);
  const lockSection = useModelStore((s) => s.lockSection);
  const unlockSection = useModelStore((s) => s.unlockSection);
  const toggleSectionExpanded = useModelStore((s) => s.toggleSectionExpanded);

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    lockSection(sectionId);
    // Collapse the section when "Done" is clicked
    setSectionExpanded(sectionId, false);
  };

  const handleUnlock = () => {
    unlockSection(sectionId);
    // Auto-expand when unlocked
    toggleSectionExpanded(sectionId);
  };

  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} p-4`}>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleSectionExpanded(sectionId)}
              className={`text-sm font-semibold ${colors.text} hover:opacity-80 transition-opacity flex items-center gap-1`}
              type="button"
            >
              <span className="text-xs">{isExpanded ? "▼" : "▶"}</span>
              <span>{title}</span>
              {isLocked && (
                <span className="ml-2 text-xs text-slate-400">(Locked)</span>
              )}
            </button>
          </div>
          {description && (
            <p className={`mt-1 text-xs ${colors.text.replace("200", "300/80")}`}>
              {description}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          {isLocked ? (
            <button
              onClick={handleUnlock}
              className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-600 transition"
              type="button"
            >
              Unlock
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition"
              type="button"
            >
              {confirmButtonLabel}
            </button>
          )}
        </div>
      </div>

      {/* Content - only show when expanded */}
      {isExpanded && (
        <div className={isLocked ? "opacity-60 pointer-events-none" : ""}>
          {children}
        </div>
      )}
    </div>
  );
}
