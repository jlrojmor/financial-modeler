"use client";

import { useState, useEffect } from "react";
import type { Row } from "@/types/finance";
import { storedToDisplay, displayToStored, getUnitLabel } from "@/lib/currency-utils";
import type { GlossaryItem } from "@/lib/financial-glossary";

interface UnifiedItemCardProps {
  row: Row;
  years: string[];
  meta: any;
  glossaryItem?: GlossaryItem; // Optional glossary reference for description
  isLocked?: boolean;
  isCalculated?: boolean;
  autoValue?: number | null; // For auto-populated values
  /** When set, show read-only value per year (e.g. parent row = sum of children) */
  computedValueByYear?: Record<string, number> | null;
  linkInfo?: { text: string; isAutoPopulated: boolean } | null;
  signIndicator?: "+" | "-" | null; // For CFS items (+ or -)
  colorClass?: "blue" | "green" | "orange" | "purple" | "amber" | "slate" | "red";
  onUpdateValue: (rowId: string, year: string, value: number) => void;
  onRemove: (rowId: string) => void;
  onConfirm?: (rowId: string) => void; // Optional confirm callback
  showRemove?: boolean;
  showConfirm?: boolean;
  protectedRows?: string[]; // Rows that cannot be removed
  customDescription?: string; // Override description from glossary
  draggable?: boolean; // Whether this item can be dragged
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  dragOverId?: string | null; // ID of item being dragged over
}

/**
 * Unified Item Card Component
 * 
 * Used across all financial statement builders (IS, BS, CFS)
 * Features:
 * - Expand/collapse functionality
 * - Edit mode (expanded) vs confirmed mode (collapsed)
 * - Description display from glossary
 * - Input fields for historical years
 * - Remove and Confirm buttons
 */
export default function UnifiedItemCard({
  row,
  years,
  meta,
  glossaryItem,
  isLocked = false,
  isCalculated = false,
  autoValue = null,
  computedValueByYear = null,
  linkInfo = null,
  signIndicator = null,
  colorClass = "slate",
  onUpdateValue,
  onRemove,
  onConfirm,
  showRemove = true,
  showConfirm = true,
  protectedRows = [],
  customDescription,
  draggable = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOverId = null,
}: UnifiedItemCardProps) {
  const [isExpanded, setIsExpanded] = useState(true); // Start expanded so users can edit immediately
  const [isConfirmed, setIsConfirmed] = useState(false);
  
  // Ensure items always show Confirm when expanded - reset confirmed state if expanded
  useEffect(() => {
    if (isExpanded && isConfirmed) {
      setIsConfirmed(false);
    }
  }, [isExpanded]);

  const colorMap = {
    blue: {
      border: "border-blue-800/40",
      bg: "bg-blue-950/20",
      text: "text-blue-200",
      textLight: "text-blue-300/80",
    },
    green: {
      border: "border-green-800/40",
      bg: "bg-green-950/20",
      text: "text-green-200",
      textLight: "text-green-300/80",
    },
    orange: {
      border: "border-orange-800/40",
      bg: "bg-orange-950/20",
      text: "text-orange-200",
      textLight: "text-orange-300/80",
    },
    purple: {
      border: "border-purple-800/40",
      bg: "bg-purple-950/20",
      text: "text-purple-200",
      textLight: "text-purple-300/80",
    },
    amber: {
      border: "border-amber-800/40",
      bg: "bg-amber-950/20",
      text: "text-amber-200",
      textLight: "text-amber-300/80",
    },
    slate: {
      border: "border-slate-800/40",
      bg: "bg-slate-950/20",
      text: "text-slate-200",
      textLight: "text-slate-300/80",
    },
    red: {
      border: "border-red-800/40",
      bg: "bg-red-950/20",
      text: "text-red-200",
      textLight: "text-red-300/80",
    },
  };
  
  const colors = colorMap[colorClass] || colorMap.slate;

  const isProtected = protectedRows.includes(row.id);
  const canRemove = showRemove && !isProtected && !isLocked;
  const canEdit = !isLocked && !isCalculated;
  const description = customDescription || glossaryItem?.description || linkInfo?.text || "";
  const isTotalRow = row.id.startsWith("total_") || row.kind === "total" || row.kind === "subtotal";
  // Always show Confirm for non-total, non-calculated items that can be edited
  const shouldShowConfirm = showConfirm && !isTotalRow && canEdit && !isCalculated;

  const handleToggleExpand = () => {
    if (!isLocked) {
      if (!isExpanded && isConfirmed) {
        // When expanding a confirmed item, reset confirmed state so Confirm button shows
        setIsConfirmed(false);
      }
      setIsExpanded(!isExpanded);
    }
  };

  const handleConfirm = () => {
    setIsConfirmed(true);
    setIsExpanded(false);
    if (onConfirm) {
      onConfirm(row.id);
    }
  };

  const handleEdit = () => {
    setIsConfirmed(false);
    setIsExpanded(true);
  };

  // Collapsed state - show when not expanded (regardless of confirmed state)
  if (!isExpanded) {
    const isDraggingOver = dragOverId === row.id;
    return (
      <div
        className={`rounded-lg border-2 ${isDraggingOver ? "ring-2 ring-emerald-500" : colors.border} ${colors.bg} p-3 cursor-pointer hover:opacity-80 transition-opacity`}
        onClick={handleToggleExpand}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {draggable && !isLocked && !isTotalRow && (
              <span
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  if (onDragStart) onDragStart(e);
                }}
                onClick={(e) => e.stopPropagation()}
                className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 touch-none shrink-0"
                title="Drag to reorder"
                aria-hidden
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><path d="M3 4h2v2H3V4zm4 0h2v2H7V4zm4 0h2v2h-2V4zM3 8h2v2H3V8zm4 0h2v2H7V8zm4 0h2v2h-2V8zM3 12h2v2H3v-2zm4 0h2v2H7v-2zm4 0h2v2h-2v-2z"/></svg>
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleExpand();
              }}
              className="text-xs text-slate-400 hover:text-slate-300"
            >
              ▶
            </button>
            <span className={`text-sm font-medium ${colors.text}`}>
              {row.label}
            </span>
            {isCalculated && (
              <span className="text-xs text-slate-400 italic">(Calculated)</span>
            )}
            {linkInfo && (
              <span className={`text-xs ${linkInfo.isAutoPopulated ? "text-emerald-400" : "text-slate-400"}`}>
                {linkInfo.isAutoPopulated ? "✨" : "🔗"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isConfirmed ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEdit();
                }}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleExpand();
                }}
                className="text-xs text-emerald-400 hover:text-emerald-300"
              >
                Expand
              </button>
            )}
            {canRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(row.id);
                }}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Expanded state - show full details and inputs
  const isDraggingOver = dragOverId === row.id;
  return (
    <div
      className={`rounded-lg border-2 ${isDraggingOver ? "ring-2 ring-emerald-500" : colors.border} ${colors.bg} p-3`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {draggable && !isLocked && !isTotalRow && (
              <span
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  if (onDragStart) onDragStart(e);
                }}
                onClick={(e) => e.stopPropagation()}
                className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 touch-none shrink-0"
                title="Drag to reorder"
                aria-hidden
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><path d="M3 4h2v2H3V4zm4 0h2v2H7V4zm4 0h2v2h-2V4zM3 8h2v2H3V8zm4 0h2v2H7V8zm4 0h2v2h-2V8zM3 12h2v2H3v-2zm4 0h2v2H7v-2zm4 0h2v2h-2v-2z"/></svg>
              </span>
            )}
            <button
              type="button"
              onClick={handleToggleExpand}
              className="text-xs text-slate-400 hover:text-slate-300"
            >
              {isExpanded ? "▼" : "▶"}
            </button>
            {signIndicator && (
              <span className={`text-sm font-semibold ${signIndicator === "+" ? "text-green-400" : "text-red-400"}`}>
                ({signIndicator})
              </span>
            )}
            <span className={`text-sm font-medium ${colors.text}`}>
              {row.label}
            </span>
            {isCalculated && (
              <span className="text-xs text-slate-400 italic">(Calculated)</span>
            )}
            {linkInfo && (
              <span className={`text-xs ${linkInfo.isAutoPopulated ? "text-emerald-400" : "text-slate-400"}`}>
                {linkInfo.isAutoPopulated ? "✨ " : "🔗 "}{linkInfo.text}
              </span>
            )}
          </div>
          
          {/* Description */}
          {description && (
            <p className={`text-xs ${colors.textLight} ml-5 mb-2`}>
              {description}
            </p>
          )}
          
          {/* Auto-populated value notice */}
          {autoValue !== null && autoValue !== undefined && linkInfo?.isAutoPopulated && (
            <div className="ml-5 mb-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
              <div className="text-xs text-emerald-300">
                ✨ Auto-populated: {storedToDisplay(autoValue, meta?.currencyUnit)} {getUnitLabel(meta?.currencyUnit)}
              </div>
            </div>
          )}
        </div>
        
        {/* Action buttons */}
        <div className="flex gap-2">
          {shouldShowConfirm && isExpanded && (
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition"
            >
              Confirm
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              onClick={() => onRemove(row.id)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Input fields - only show if expanded and not calculated (or show read-only per-year when computedValueByYear) */}
      {isExpanded && (!isCalculated || (isCalculated && computedValueByYear)) && (
        <div className="ml-5">
          {/* Show read-only for auto-populated items */}
          {computedValueByYear ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {years.map((year) => {
                const value = computedValueByYear[year] ?? 0;
                const displayValue = storedToDisplay(value, meta?.currencyUnit);
                const unitLabel = getUnitLabel(meta?.currencyUnit);
                const decimals = meta?.currencyUnit === "millions" ? 2 : meta?.currencyUnit === "thousands" ? 1 : 0;
                const displayRounded = displayValue === 0 ? "0" : Number(displayValue.toFixed(decimals));
                return (
                  <div key={year} className="flex flex-col">
                    <label className={`text-xs ${colors.textLight} mb-1`}>
                      {year}
                    </label>
                    <div className="rounded-md border border-slate-600 bg-slate-800/50 px-2 py-1.5 text-sm text-slate-300">
                      {displayRounded} {unitLabel}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : linkInfo?.isAutoPopulated && autoValue !== null ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {years.map((year) => {
                const value = autoValue; // Use auto-populated value
                const displayValue = storedToDisplay(value, meta?.currencyUnit);
                const unitLabel = getUnitLabel(meta?.currencyUnit);
                
                return (
                  <div key={year} className="flex flex-col">
                    <label className={`text-xs ${colors.textLight} mb-1`}>
                      {year}
                    </label>
                    <div className="rounded-md border border-emerald-700/40 bg-emerald-950/40 px-2 py-1.5 text-sm font-semibold text-emerald-200">
                      {displayValue} {unitLabel}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Regular input fields - round display/save to avoid floating point noise */
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {years.map((year) => {
                let storedValue = row.values?.[year] ?? 0;
                const displayValue = storedToDisplay(storedValue, meta?.currencyUnit);
                const unitLabel = getUnitLabel(meta?.currencyUnit);
                const decimals = meta?.currencyUnit === "millions" ? 2 : meta?.currencyUnit === "thousands" ? 1 : 0;
                const displayRounded = displayValue === 0 ? "" : Number(displayValue.toFixed(decimals));
                
                return (
                  <div key={year} className="flex flex-col">
                    <label className={`text-xs ${colors.textLight} mb-1`}>
                      {year}
                    </label>
                    <input
                      type="number"
                      step={decimals > 0 ? "0.01" : "1"}
                      value={displayRounded}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "" || val === "-") {
                          onUpdateValue(row.id, year, 0);
                          return;
                        }
                        const displayNum = Number(val);
                        if (!isNaN(displayNum)) {
                          const storedNum = displayToStored(displayNum, meta?.currencyUnit);
                          onUpdateValue(row.id, year, Math.round(storedNum));
                        }
                      }}
                      onBlur={(e) => {
                        if (e.target.value === "") {
                          onUpdateValue(row.id, year, 0);
                        } else {
                          const displayNum = Number(e.target.value);
                          if (!isNaN(displayNum)) {
                            const storedNum = displayToStored(displayNum, meta?.currencyUnit);
                            onUpdateValue(row.id, year, Math.round(storedNum));
                          }
                        }
                      }}
                      placeholder="0"
                      disabled={isLocked}
                      className={`w-full rounded border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
                    />
                    {unitLabel && (
                      <span className="text-xs text-slate-500 mt-0.5">{unitLabel}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Calculated value display (only when no per-year values shown) */}
      {isCalculated && !computedValueByYear && (
        <div className="ml-5 mt-2 text-xs text-slate-400 italic">
          Value calculated automatically from linked statements
        </div>
      )}
    </div>
  );
}
