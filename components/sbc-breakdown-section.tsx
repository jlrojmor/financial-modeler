"use client";

import { useMemo, useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
} from "@/lib/currency-utils";

/**
 * SBC Breakdown Section for Income Statement Builder
 * 
 * Allows users to break down Stock-Based Compensation (SBC) into
 * existing COGS and Operating Expenses categories.
 * Each category has edit/confirm/collapse functionality.
 */
export default function SbcBreakdownSection() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const meta = useModelStore((s) => s.meta);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns || {});
  const updateSbcValue = useModelStore((s) => s.updateSbcValue);

  const years = useMemo(() => {
    return meta?.years?.historical ?? [];
  }, [meta]);

  // Find SG&A and COGS rows to get their breakdowns
  const sgaRow = incomeStatement.find((r) => r.id === "sga");
  const cogsRow = incomeStatement.find((r) => r.id === "cogs");

  const sgaBreakdowns = sgaRow?.children ?? [];
  const cogsBreakdowns = cogsRow?.children ?? [];

  // Get all available categories (COGS and Operating Expenses breakdowns)
  const availableCategories = useMemo(() => {
    const categories: Array<{ id: string; label: string; type: "COGS" | "Operating Expenses" }> = [];
    
    // Add COGS breakdowns
    cogsBreakdowns.forEach((breakdown) => {
      categories.push({
        id: breakdown.id,
        label: breakdown.label,
        type: "COGS",
      });
    });
    
    // Add Operating Expenses breakdowns (SG&A breakdowns)
    sgaBreakdowns.forEach((breakdown) => {
      categories.push({
        id: breakdown.id,
        label: breakdown.label,
        type: "Operating Expenses",
      });
    });
    
    return categories;
  }, [cogsBreakdowns, sgaBreakdowns]);

  // Calculate total SBC for each year
  const totalSbcByYear = useMemo(() => {
    const totals: Record<string, number> = {};
    years.forEach((y) => {
      let sum = 0;
      availableCategories.forEach((cat) => {
        sum += sbcBreakdowns[cat.id]?.[y] ?? 0;
      });
      totals[y] = sum;
    });
    return totals;
  }, [sbcBreakdowns, availableCategories, years]);

  return (
    <div className="space-y-3">
      {/* SBC Breakdown by Category */}
      {availableCategories.length > 0 && (
        <>
          {availableCategories.map((category) => (
            <SbcCategoryCard
              key={category.id}
              categoryId={category.id}
              categoryLabel={category.label}
              categoryType={category.type}
              years={years}
              meta={meta}
              sbcBreakdowns={sbcBreakdowns}
              updateSbcValue={updateSbcValue}
            />
          ))}
        </>
      )}

      {/* Total SBC Summary - only show if there's data */}
      {(() => {
        const hasAnyData = Object.values(totalSbcByYear).some(v => v !== 0);
        if (!hasAnyData) return null;
        
        return (
          <div className="rounded-md border border-amber-700/30 bg-amber-950/30 p-3">
            <div className="mb-2 text-xs font-medium text-amber-300/90">
              Total SBC (sum of all categories)
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {years.map((y) => {
                const total = totalSbcByYear[y] ?? 0;
                const displayValue = storedToDisplay(total, meta?.currencyUnit);
                const unitLabel = getUnitLabel(meta?.currencyUnit);
                return (
                  <div key={y} className="block">
                    <div className="mb-1 text-[10px] text-amber-400/70">
                      {y} {unitLabel && `(${unitLabel})`}
                    </div>
                    <div className="rounded-md border border-amber-700/50 bg-amber-950/40 px-2 py-1 text-xs font-medium text-amber-100">
                      {displayValue === 0 ? "—" : displayValue.toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}{unitLabel ? ` ${unitLabel}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/**
 * Individual SBC Category Card with edit/confirm/collapse functionality
 */
function SbcCategoryCard({
  categoryId,
  categoryLabel,
  categoryType,
  years,
  meta,
  sbcBreakdowns,
  updateSbcValue,
}: {
  categoryId: string;
  categoryLabel: string;
  categoryType: "COGS" | "Operating Expenses";
  years: string[];
  meta: any;
  sbcBreakdowns: Record<string, Record<string, number>>;
  updateSbcValue: (categoryId: string, year: string, value: number) => void;
}) {
  // Get SBC value for this category
  const getSbcValue = (year: string): number => {
    return sbcBreakdowns[categoryId]?.[year] ?? 0;
  };

  // Check if this category has any data
  const hasData = years.some(y => getSbcValue(y) !== 0);

  // Initialize local values from store
  const initializeLocalValues = useMemo(() => {
    const values: Record<string, string> = {};
    years.forEach((y) => {
      const storedValue = getSbcValue(y);
      const displayValue = storedToDisplay(storedValue, meta?.currencyUnit);
      values[y] = displayValue === 0 ? "" : String(displayValue);
    });
    return values;
  }, [years, categoryId, sbcBreakdowns, meta?.currencyUnit]);
  
  const [isExpanded, setIsExpanded] = useState(true);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [localValues, setLocalValues] = useState<Record<string, string>>(initializeLocalValues);

  // Re-initialize local values when expanding (to get latest from store)
  useEffect(() => {
    if (isExpanded && !isConfirmed) {
      setLocalValues(initializeLocalValues);
    }
  }, [isExpanded, isConfirmed, initializeLocalValues]);

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
    if (!isExpanded) {
      // Expanding - re-initialize local values from store
      setLocalValues(initializeLocalValues);
    }
  };

  const handleConfirm = () => {
    // Save all local values to store
    years.forEach((y) => {
      const localVal = localValues[y] || "";
      if (localVal === "" || localVal === "-") {
        updateSbcValue(categoryId, y, 0);
      } else {
        const displayNum = Number(localVal);
        if (!isNaN(displayNum) && displayNum >= 0) {
          const storedNum = displayToStored(displayNum, meta?.currencyUnit);
          updateSbcValue(categoryId, y, storedNum);
        }
      }
    });
    setIsConfirmed(true);
    setIsExpanded(false);
  };

  const handleEdit = () => {
    setIsConfirmed(false);
    setIsExpanded(true);
    initializeLocalValues();
  };

  const handleValueChange = (year: string, value: string) => {
    setLocalValues(prev => ({ ...prev, [year]: value }));
    setIsConfirmed(false);
  };

  const unitLabel = getUnitLabel(meta?.currencyUnit);

  // Collapsed state - just show name with Edit button
  if (!isExpanded && isConfirmed) {
    return (
      <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleExpand}
              className="text-xs text-amber-400 hover:text-amber-300"
            >
              ▶
            </button>
            <span className="text-sm font-medium text-amber-200">
              {categoryLabel} ({categoryType})
            </span>
            {hasData && (
              <span className="text-xs text-amber-400/70">
                {years.map(y => {
                  const val = getSbcValue(y);
                  return val !== 0 ? `${y}: ${storedToDisplay(val, meta?.currencyUnit)}${unitLabel ? ` ${unitLabel}` : ""}` : null;
                }).filter(Boolean).join(", ")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleEdit}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Edit
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Expanded state - show full details and inputs
  return (
    <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <button
              type="button"
              onClick={handleToggleExpand}
              className="text-xs text-amber-400 hover:text-amber-300"
            >
              {isExpanded ? "▼" : "▶"}
            </button>
            <span className="text-sm font-medium text-amber-200">
              {categoryLabel} ({categoryType})
            </span>
          </div>
          <p className="text-xs text-amber-300/70 mt-1">
            Enter Stock-Based Compensation amounts for this category by year.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isConfirmed && (
            <button
              type="button"
              onClick={handleEdit}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Edit
            </button>
          )}
          {!isConfirmed && (
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition"
            >
              Confirm
            </button>
          )}
        </div>
      </div>

      {/* Input fields */}
      {isExpanded && (
        <div className="ml-5 mt-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {years.map((year) => {
              // Get current value from local state or store
              const storedValue = getSbcValue(year);
              const displayValue = storedToDisplay(storedValue, meta?.currencyUnit);
              const localValue = localValues[year] ?? (displayValue === 0 ? "" : String(displayValue));
              
              return (
                <div key={year} className="flex flex-col">
                  <label className={`text-xs text-amber-300/70 mb-1`}>
                    {year} {unitLabel && `(${unitLabel})`}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={localValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleValueChange(year, val);
                    }}
                    onBlur={(e) => {
                      if (e.target.value === "") {
                        handleValueChange(year, "");
                      }
                    }}
                    placeholder="0"
                    disabled={false}
                    className={`w-full rounded border border-amber-700 bg-amber-950/50 px-2 py-1.5 text-sm text-amber-100 placeholder-amber-500/50 focus:border-amber-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
