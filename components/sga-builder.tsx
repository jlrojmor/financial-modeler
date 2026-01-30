"use client";

import { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
  formatCurrencyDisplay,
} from "@/lib/currency-utils";

/**
 * Standard SG&A breakdown suggestions (IB-grade)
 */
const STANDARD_SGA_BREAKDOWNS = [
  { label: "Sales & Marketing", description: "Sales team, marketing campaigns, advertising" },
  { label: "General & Administrative", description: "Executive, HR, legal, office costs" },
  { label: "Customer Support", description: "Support team, customer service operations" },
  { label: "Professional Services", description: "Consulting, legal fees, accounting" },
  { label: "Other SG&A", description: "Other selling, general, or administrative expenses" },
];

/**
 * Guided SG&A Builder
 * 
 * Provides a friendly interface for:
 * 1. Entering SG&A total directly OR breaking it down
 * 2. Suggesting standard SG&A components
 * 3. Validating inputs to prevent model-breaking entries
 * 4. Guiding users with helpful suggestions
 */
export default function SgaBuilder() {
  // Subscribe to store changes - this ensures re-renders when incomeStatement changes
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const meta = useModelStore((s) => s.meta);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const addChildRow = useModelStore((s) => s.addChildRow);
  const removeRow = useModelStore((s) => s.removeRow);

  const [newSgaItem, setNewSgaItem] = useState("");
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    return hist;
  }, [meta]);

  // Find SG&A row - same pattern as RevenueCogsBuilder
  const sgaRow = incomeStatement.find((r) => r.id === "sga");
  const sgaBreakdowns = sgaRow?.children ?? [];
  const hasBreakdowns = sgaBreakdowns.length > 0;

  // Get available standard suggestions (exclude ones already added)
  const availableSuggestions = STANDARD_SGA_BREAKDOWNS.filter(
    (suggestion) => !sgaBreakdowns.some((b) => b.label.toLowerCase() === suggestion.label.toLowerCase())
  );

  const handleAddStandard = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;

    // Just add it - same as RevenueCogsBuilder does
    addChildRow("incomeStatement", "sga", trimmed);
    setValidationError(null);
  };

  const handleAddCustom = () => {
    const trimmed = newSgaItem.trim();
    if (!trimmed) return;

    // Just add it - same as RevenueCogsBuilder does
    addChildRow("incomeStatement", "sga", trimmed);
    setNewSgaItem("");
    setShowAddCustom(false);
    setValidationError(null);
  };

  const handleRemoveBreakdown = (breakdownId: string) => {
    removeRow("incomeStatement", breakdownId);
  };

  // Debug: Log current state
  console.log("SgaBuilder render - hasBreakdowns:", hasBreakdowns, "availableSuggestions:", availableSuggestions.length, "showAddCustom:", showAddCustom);

  return (
    <div className="space-y-6" style={{ position: 'relative', zIndex: 1 }}>
      {/* SG&A Section */}
      <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 p-4" style={{ position: 'relative', zIndex: 1 }}>
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-purple-200 mb-1">
            Selling, General & Administrative (SG&A)
          </h3>
          <p className="text-xs text-purple-300/80">
            {hasBreakdowns
              ? "SG&A is calculated from the sum of components below. Enter values for each component."
              : "Enter total SG&A directly, or break it down into components (Sales & Marketing, G&A, etc.)."}
          </p>
        </div>

        {/* Validation Error */}
        {validationError && (
          <div className="mb-4 rounded-md border border-red-800/40 bg-red-950/40 p-3">
            <p className="text-xs text-red-300">{validationError}</p>
          </div>
        )}

        {/* SG&A Total - Input when no breakdowns, Calculated when breakdowns exist */}
        <div className="mb-4 rounded-md border border-purple-700/40 bg-purple-950/40 p-3">
          <div className="mb-2 text-xs font-semibold text-purple-200">
            {hasBreakdowns ? "Total SG&A (calculated)" : "Total SG&A"}
          </div>
          {hasBreakdowns ? (
            // Show calculated value
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {years.map((y) => {
                const storedValue = sgaRow?.values?.[y] ?? 0;
                const display = formatCurrencyDisplay(
                  storedValue,
                  meta.currencyUnit,
                  meta.currency
                );
                return (
                  <div key={y} className="block">
                    <div className="mb-1 text-[10px] text-purple-400">{y}</div>
                    <div className="rounded-md border border-purple-800 bg-purple-950/60 px-2 py-1 text-xs font-semibold text-purple-200">
                      {storedValue !== 0 ? display : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // Show input fields
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {years.map((y) => {
                const storedValue = sgaRow?.values?.[y] ?? 0;
                const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
                const unitLabel = getUnitLabel(meta.currencyUnit);
                return (
                  <label key={y} className="block">
                    <div className="mb-1 text-[10px] text-purple-400">
                      {y} {unitLabel && `(${unitLabel})`}
                    </div>
                    <input
                      type="number"
                      step="any"
                      className="w-full rounded-md border border-purple-800 bg-purple-950 px-2 py-1 text-xs text-purple-100"
                      value={displayValue === 0 ? "" : String(displayValue)}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "" || val === "-") {
                          updateRowValue("incomeStatement", "sga", y, 0);
                          return;
                        }
                        const displayNum = Number(val);
                        if (!isNaN(displayNum)) {
                          // Validate: Don't allow negative values
                          if (displayNum < 0) {
                            setValidationError("SG&A cannot be negative. Please enter a positive value.");
                            setTimeout(() => setValidationError(null), 3000);
                            return;
                          }
                          const storedNum = displayToStored(displayNum, meta.currencyUnit);
                          updateRowValue("incomeStatement", "sga", y, storedNum);
                        }
                      }}
                      onBlur={(e) => {
                        if (e.target.value === "") {
                          updateRowValue("incomeStatement", "sga", y, 0);
                        }
                      }}
                      placeholder="0"
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Add Breakdown Section */}
        {!hasBreakdowns && (
          <div className="space-y-3">
            {/* Standard Suggestions */}
            {availableSuggestions.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold text-purple-200">
                  Suggested SG&A Components:
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {availableSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.label}
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleAddStandard(suggestion.label);
                      }}
                      className="rounded-md border border-purple-700/40 bg-purple-950/40 p-3 text-left hover:bg-purple-950/60 transition cursor-pointer"
                      style={{ position: 'relative', zIndex: 10, pointerEvents: 'auto' }}
                    >
                      <div className="text-xs font-semibold text-purple-200">
                        {suggestion.label}
                      </div>
                      <div className="mt-1 text-[10px] text-purple-400">
                        {suggestion.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Custom Add */}
            <div>
              {!showAddCustom ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log("Custom add button clicked");
                    setShowAddCustom(true);
                  }}
                  className="rounded-md border border-purple-700/40 bg-purple-950/40 px-4 py-2 text-xs font-semibold text-purple-200 hover:bg-purple-950/60 transition cursor-pointer"
                  style={{ position: 'relative', zIndex: 10, pointerEvents: 'auto' }}
                >
                  + Add Custom SG&A Component
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 rounded-md border border-purple-700 bg-purple-950/40 px-3 py-2 text-xs text-purple-100 placeholder:text-purple-400"
                      placeholder="e.g., Customer Success, Operations..."
                      value={newSgaItem}
                      onChange={(e) => {
                        setNewSgaItem(e.target.value);
                        setValidationError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddCustom();
                        } else if (e.key === "Escape") {
                          setShowAddCustom(false);
                          setNewSgaItem("");
                          setValidationError(null);
                        }
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleAddCustom();
                      }}
                      className="rounded-md bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 cursor-pointer"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowAddCustom(false);
                        setNewSgaItem("");
                        setValidationError(null);
                      }}
                      className="rounded-md bg-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-600 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="text-[10px] text-purple-300/60">
                    Tip: Use descriptive names like "Sales & Marketing" or "Customer Support"
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SG&A Breakdowns */}
        {hasBreakdowns && (
          <div className="mt-4 space-y-3">
            <div className="text-xs font-semibold text-purple-200 mb-2">
              SG&A Components:
            </div>
            {sgaBreakdowns.map((breakdown) => {
              const unitLabel = getUnitLabel(meta.currencyUnit);
              const hasBreakdownChildren = breakdown.children && breakdown.children.length > 0;
              const actualChildren = breakdown.children || [];
              
              return (
                <div
                  key={breakdown.id}
                  id={`sga-breakdown-${breakdown.label.toLowerCase().replace(/\s+/g, '-')}`}
                  className="rounded-md border border-purple-700/40 bg-purple-950/40 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-purple-200">
                        {breakdown.label}
                      </span>
                      {hasBreakdownChildren && (
                        <span className="text-[10px] text-purple-400 italic">
                          (calculated from breakdown)
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveBreakdown(breakdown.id)}
                      className="text-[10px] text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                  
                  {/* Show calculated total if this breakdown has children */}
                  {hasBreakdownChildren ? (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                      {years.map((y) => {
                        const storedValue = breakdown.values?.[y] ?? 0;
                        const display = formatCurrencyDisplay(
                          storedValue,
                          meta.currencyUnit,
                          meta.currency
                        );
                        return (
                          <div key={y} className="block">
                            <div className="mb-1 text-[10px] text-purple-400">{y}</div>
                            <div className="rounded-md border border-purple-800 bg-purple-950/60 px-2 py-1 text-xs font-semibold text-purple-200">
                              {storedValue !== 0 ? display : "—"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    // Show input fields when no breakdown
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                      {years.map((y) => {
                        const storedValue = breakdown.values?.[y] ?? 0;
                        const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
                        return (
                          <label key={y} className="block">
                            <div className="mb-1 text-[10px] text-purple-400">
                              {y} {unitLabel && `(${unitLabel})`}
                            </div>
                            <input
                              type="number"
                              step="any"
                              className="w-full rounded-md border border-purple-800 bg-purple-950 px-2 py-1 text-xs text-purple-100"
                              value={displayValue === 0 ? "" : String(displayValue)}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "" || val === "-") {
                                  updateRowValue("incomeStatement", breakdown.id, y, 0);
                                  return;
                                }
                                const displayNum = Number(val);
                                if (!isNaN(displayNum)) {
                                  // Validate: Don't allow negative values
                                  if (displayNum < 0) {
                                    setValidationError("SG&A components cannot be negative. Please enter a positive value.");
                                    setTimeout(() => setValidationError(null), 3000);
                                    return;
                                  }
                                  const storedNum = displayToStored(displayNum, meta.currencyUnit);
                                  updateRowValue("incomeStatement", breakdown.id, y, storedNum);
                                }
                              }}
                              onBlur={(e) => {
                                if (e.target.value === "") {
                                  updateRowValue("incomeStatement", breakdown.id, y, 0);
                                }
                              }}
                              placeholder="0"
                              autoFocus={sgaBreakdowns.length === 1 && sgaBreakdowns[0].id === breakdown.id}
                            />
                          </label>
                        );
                      })}
                    </div>
                  )}
                  
                  {/* Option to add breakdown to this component */}
                  {!hasBreakdownChildren && (
                    <div className="mt-2">
                      <button
                        onClick={() => {
                          const breakdownLabel = prompt(`Enter a sub-component name for "${breakdown.label}":`);
                          if (breakdownLabel && breakdownLabel.trim()) {
                            // Check for duplicates within this breakdown
                            if (actualChildren.some((c) => c.label.toLowerCase() === breakdownLabel.trim().toLowerCase())) {
                              setValidationError(`"${breakdownLabel}" already exists under "${breakdown.label}".`);
                              setTimeout(() => setValidationError(null), 3000);
                              return;
                            }
                            addChildRow("incomeStatement", breakdown.id, breakdownLabel.trim());
                          }
                        }}
                        className="text-[10px] text-purple-400 hover:text-purple-300"
                      >
                        + Break down {breakdown.label}
                      </button>
                    </div>
                  )}
                  
                  {/* Show children if they exist */}
                  {hasBreakdownChildren && actualChildren.length > 0 && (
                    <div className="mt-3 ml-4 space-y-2 border-l-2 border-purple-700/40 pl-3">
                      {actualChildren.map((child) => {
                        return (
                          <div
                            key={child.id}
                            className="rounded-md border border-purple-600/30 bg-purple-900/20 p-2"
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-[11px] font-medium text-purple-300">
                                {child.label}
                              </span>
                              <button
                                onClick={() => removeRow("incomeStatement", child.id)}
                                className="text-[9px] text-red-400 hover:text-red-300"
                              >
                                Remove
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                              {years.map((y) => {
                                const storedValue = child.values?.[y] ?? 0;
                                const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
                                return (
                                  <label key={y} className="block">
                                    <div className="mb-1 text-[9px] text-purple-500">
                                      {y} {unitLabel && `(${unitLabel})`}
                                    </div>
                                    <input
                                      type="number"
                                      step="any"
                                      className="w-full rounded-md border border-purple-700 bg-purple-950 px-2 py-1 text-[11px] text-purple-100"
                                      value={displayValue === 0 ? "" : String(displayValue)}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === "" || val === "-") {
                                          updateRowValue("incomeStatement", child.id, y, 0);
                                          return;
                                        }
                                        const displayNum = Number(val);
                                        if (!isNaN(displayNum)) {
                                          if (displayNum < 0) {
                                            setValidationError("Values cannot be negative.");
                                            setTimeout(() => setValidationError(null), 3000);
                                            return;
                                          }
                                          const storedNum = displayToStored(displayNum, meta.currencyUnit);
                                          updateRowValue("incomeStatement", child.id, y, storedNum);
                                        }
                                      }}
                                      onBlur={(e) => {
                                        if (e.target.value === "") {
                                          updateRowValue("incomeStatement", child.id, y, 0);
                                        }
                                      }}
                                      placeholder="0"
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => {
                          const breakdownLabel = prompt(`Enter a sub-component name for "${breakdown.label}":`);
                          if (breakdownLabel && breakdownLabel.trim()) {
                            if (actualChildren.some((c) => c.label.toLowerCase() === breakdownLabel.trim().toLowerCase())) {
                              setValidationError(`"${breakdownLabel}" already exists.`);
                              setTimeout(() => setValidationError(null), 3000);
                              return;
                            }
                            addChildRow("incomeStatement", breakdown.id, breakdownLabel.trim());
                          }
                        }}
                        className="text-[10px] text-purple-400 hover:text-purple-300"
                      >
                        + Add sub-component to {breakdown.label}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add More Breakdowns */}
            <div className="mt-4">
              {availableSuggestions.length > 0 && (
                <div className="mb-3">
                  <div className="mb-2 text-xs font-semibold text-purple-200">
                    Add More Components:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.label}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log("Suggestion button clicked (hasBreakdowns section):", suggestion.label);
                          handleAddStandard(suggestion.label);
                        }}
                        className="rounded-md border border-purple-700/40 bg-purple-950/40 px-3 py-1.5 text-xs text-purple-200 hover:bg-purple-950/60 transition cursor-pointer"
                      >
                        + {suggestion.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!showAddCustom ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log("Custom add button clicked (hasBreakdowns section)");
                    setShowAddCustom(true);
                  }}
                  className="rounded-md border border-purple-700/40 bg-purple-950/40 px-4 py-2 text-xs font-semibold text-purple-200 hover:bg-purple-950/60 transition cursor-pointer"
                  style={{ position: 'relative', zIndex: 10, pointerEvents: 'auto' }}
                >
                  + Add Custom Component
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 rounded-md border border-purple-700 bg-purple-950/40 px-3 py-2 text-xs text-purple-100 placeholder:text-purple-400"
                      placeholder="e.g., Customer Success, Operations..."
                      value={newSgaItem}
                      onChange={(e) => {
                        setNewSgaItem(e.target.value);
                        setValidationError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddCustom();
                        } else if (e.key === "Escape") {
                          setShowAddCustom(false);
                          setNewSgaItem("");
                          setValidationError(null);
                        }
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleAddCustom();
                      }}
                      className="rounded-md bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 cursor-pointer"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowAddCustom(false);
                        setNewSgaItem("");
                        setValidationError(null);
                      }}
                      className="rounded-md bg-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-600 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
