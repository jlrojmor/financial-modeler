"use client";

import { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { findGlossaryItem } from "@/lib/financial-glossary";
import { getCommonISItems, filterAlreadyAdded } from "@/lib/common-suggestions";
import UnifiedItemCard from "@/components/unified-item-card";
import CollapsibleSection from "@/components/collapsible-section";
import { computeRowValue } from "@/lib/calculations";
import SbcOptionalSection from "@/components/sbc-optional-section";

/**
 * Unified Income Statement Builder
 * 
 * Replaces fragmented builders (revenue-cogs, sga, dana, etc.) with a single
 * unified builder that uses the same pattern as BS and CFS builders.
 * 
 * Features:
 * - Common suggestions from glossary
 * - AI matching for manual additions
 * - Expand/collapse items
 * - Edit/Confirm/Remove functionality
 * - Organized by sections
 */
export default function IncomeStatementBuilder() {
  const meta = useModelStore((s) => s.meta);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const insertRow = useModelStore((s) => s.insertRow);
  const removeRow = useModelStore((s) => s.removeRow);
  const addChildRow = useModelStore((s) => s.addChildRow);
  const reorderIncomeStatementChildren = useModelStore((s) => s.reorderIncomeStatementChildren);
  const reorderIncomeStatementRows = useModelStore((s) => s.reorderIncomeStatementRows);
  
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverTopLevelId, setDragOverTopLevelId] = useState<string | null>(null);
  const [newBreakdownLabels, setNewBreakdownLabels] = useState<Record<string, string>>({});
  const [showAddBreakdown, setShowAddBreakdown] = useState<Record<string, boolean>>({});
  const [showAddInterestDialog, setShowAddInterestDialog] = useState(false);
  const [newInterestLabel, setNewInterestLabel] = useState("");
  
  const years = useMemo(() => {
    return meta?.years?.historical ?? [];
  }, [meta]);
  
  const isLocked = useModelStore((s) => s.sectionLocks["income_statement"] ?? false);
  
  // Organize IS items by section
  const sections = useMemo(() => {
    // Get main rows (not children - children are nested in children arrays, not at top level)
    // Since children are nested, ALL items in incomeStatement are top-level rows
    // Include ALL top-level rows to ensure the builder shows everything that appears in the Excel preview
    const mainRows = incomeStatement;
    
    // Find key marker indices in the FULL incomeStatement array (not filtered mainRows)
    // This ensures position-based detection works correctly
    const ebitMarginIndex = incomeStatement.findIndex(r => r.id === "ebit_margin");
    const ebtIndex = incomeStatement.findIndex(r => r.id === "ebt");
    
    const revenue = mainRows.filter(r => r.id === "rev");
    const cogs = mainRows.filter(r => r.id === "cogs");
    const grossProfit = mainRows.filter(r => r.id === "gross_profit" || r.id === "gross_margin");
    const operatingExpenses = mainRows.filter(r => 
      r.id === "sga" || 
      r.id === "rd"
    );
    const danda = mainRows.filter(r => r.id === "danda");
    const ebit = mainRows.filter(r => r.id === "ebit" || r.id === "ebit_margin");
    
    // Interest & Other section: items between EBIT margin and EBT (position-based)
    // Use the FULL incomeStatement array to find items by position, then filter to mainRows
    // This ensures ALL items that appear in the Excel preview also appear in the builder
    const interest = mainRows.filter((r) => {
      // Include known interest items by ID (from template)
      if (r.id === "interest_expense" || r.id === "interest_income" || r.id === "other_income") {
        return true;
      }
      // Include items by position (between EBIT margin and EBT) in the FULL incomeStatement array
      // This catches user-added items and any items that might be in the wrong position
      if (ebitMarginIndex >= 0 && ebtIndex > ebitMarginIndex) {
        const rowIndex = incomeStatement.findIndex(item => item.id === r.id);
        if (rowIndex > ebitMarginIndex && rowIndex < ebtIndex) {
          return true;
        }
      }
      // Fallback: if EBT index is not found, include items after EBIT margin that aren't in other sections
      // This ensures we don't miss items even if EBT is missing
      if (ebitMarginIndex >= 0 && ebtIndex === -1) {
        const rowIndex = incomeStatement.findIndex(item => item.id === r.id);
        // Only include if it's after EBIT margin and not a known item from other sections
        if (rowIndex > ebitMarginIndex && 
            r.id !== "tax" && 
            r.id !== "net_income" && 
            r.id !== "net_income_margin") {
          return true;
        }
      }
      return false;
    });
    
    const ebt = mainRows.filter(r => r.id === "ebt" || r.id === "ebt_margin");
    const tax = mainRows.filter(r => r.id === "tax");
    const netIncome = mainRows.filter(r => r.id === "net_income" || r.id === "net_income_margin");
    const other = mainRows.filter(r => 
      !revenue.includes(r) &&
      !cogs.includes(r) &&
      !grossProfit.includes(r) &&
      !operatingExpenses.includes(r) &&
      !danda.includes(r) &&
      !ebit.includes(r) &&
      !interest.includes(r) &&
      !ebt.includes(r) &&
      !tax.includes(r) &&
      !netIncome.includes(r)
    );
    
    return {
      revenue,
      cogs,
      grossProfit,
      operatingExpenses,
      danda,
      ebit,
      interest,
      ebt,
      tax,
      netIncome,
      other,
    };
  }, [incomeStatement]);
  
  // Get suggestions for Interest & Other section (items that go below EBIT)
  const interestOtherSuggestions = useMemo(() => {
    // Get items that are common/mandatory and typically appear below EBIT
    const interestOtherItems = getCommonISItems().filter(item => {
      const concept = item.concept.toLowerCase();
      return concept.includes("interest") || 
             concept.includes("other income") || 
             concept.includes("strategic investment") ||
             concept.includes("foreign currency") ||
             concept.includes("asset sale") ||
             concept.includes("gain") ||
             concept.includes("loss");
    });
    const existingInterestItems = sections.interest.map(r => ({ label: r.label, id: r.id }));
    return filterAlreadyAdded(interestOtherItems, existingInterestItems);
  }, [sections.interest]);
  
  
  const handleDragStart = (e: React.DragEvent, payload: { parentId: string; childId: string; fromIndex: number }) => {
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(targetId);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (
    e: React.DragEvent,
    target: { parentId: string; childId: string; toIndex: number }
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    let payload: { parentId: string; childId: string; fromIndex: number };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const { parentId: draggedParentId, childId: draggedChildId, fromIndex } = payload;
    
    // Only allow drops within the same parent
    if (draggedParentId !== target.parentId) return;
    // Don't reorder if dropping on itself
    if (draggedChildId === target.childId) return;
    
    const toIndex = target.toIndex;
    const adjustedToIndex = fromIndex < toIndex ? toIndex : toIndex;
    
    if (fromIndex !== adjustedToIndex) {
      reorderIncomeStatementChildren(draggedParentId, fromIndex, adjustedToIndex);
    }
  };

  // Drag-and-drop for top-level rows (Interest & Other section)
  const handleDragStartTopLevel = (e: React.DragEvent, fromIndex: number) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ fromIndex, type: "is_top_level" }));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOverTopLevel = (e: React.DragEvent, rowId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTopLevelId(rowId);
  };

  const handleDragLeaveTopLevel = () => {
    setDragOverTopLevelId(null);
  };

  const handleDropTopLevel = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTopLevelId(null);
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    let payload: { fromIndex: number; type: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.type !== "is_top_level") return;
    const { fromIndex } = payload;
    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    if (fromIndex !== adjustedToIndex) {
      reorderIncomeStatementRows(fromIndex, adjustedToIndex);
    }
  };

  const handleRemoveItem = (rowId: string) => {
    // All calculated output items (cannot be removed - they're calculations)
    const calculatedOutputItems = [
      "gross_profit", "gross_margin",
      "ebit", "ebit_margin",
      "ebt", "ebt_margin",
      "net_income", "net_income_margin"
    ];
    
    // Core input items that form the skeleton (can be edited but not removed)
    // Note: interest_expense, interest_income, and other_income are NOT protected
    // because users should be able to remove them if they want (they can always re-add via suggestions)
    const coreInputItems = [
      "rev", "cogs", "sga", "danda", "tax"
    ];
    
    const protectedRows = [...calculatedOutputItems, ...coreInputItems];
    if (protectedRows.includes(rowId)) {
      return; // Don't allow removing protected rows
    }
    removeRow("incomeStatement", rowId);
  };
  
  const renderSection = (
    title: string,
    items: Row[],
    colorClass: "blue" | "green" | "purple" | "amber" | "slate" | "orange" = "slate",
    sectionId: string,
    showSuggestions: boolean = false
  ) => {
    // For Interest & Other section, always show it (to show suggestions and allow adding items)
    // For other sections, only show if they have items
    if (!showSuggestions && items.length === 0) {
      return null;
    }
    
    const isInterestSection = sectionId === "is_interest";
    
    return (
      <CollapsibleSection
        sectionId={sectionId}
        title={title}
        description={`${title} items in the Income Statement`}
        colorClass={colorClass}
        defaultExpanded={true}
      >
        <div className="space-y-3">
          {items.map((row) => {
            const globalIndex = incomeStatement.findIndex((r) => r.id === row.id);
            const glossaryItem = findGlossaryItem(row.label);
            const isCalculated = (row.kind === "calc" || row.kind === "total") && 
                                 !["rev", "cogs", "sga", "danda", "tax", "interest_expense", "interest_income", "other_income"].includes(row.id);
            
            // All calculated/output items that cannot be removed
            // These are outputs/calculations, not user inputs
            const calculatedOutputItems = [
              "gross_profit", "gross_margin",
              "ebit", "ebit_margin",
              "ebt", "ebt_margin",
              "net_income", "net_income_margin"
            ];
            
            // Core input items that form the skeleton (can be edited but not removed)
            // Note: interest_expense, interest_income, and other_income are NOT protected
            // because users should be able to remove them if they want (they can always re-add via suggestions)
            const coreInputItems = [
              "rev", "cogs", "sga", "danda", "tax"
            ];
            
            // All protected items (calculated outputs + core inputs)
            const allProtectedItems = [...calculatedOutputItems, ...coreInputItems];
            
            // Check if this is a calculated output (should never show remove button)
            const isCalculatedOutput = calculatedOutputItems.includes(row.id);
            
            // Check if it's a calculated row that needs special handling
            let computedValue: number | null = null;
            if (isCalculated || isCalculatedOutput) {
              try {
                computedValue = computeRowValue(
                  row,
                  years[0] || "",
                  incomeStatement,
                  incomeStatement,
                  { incomeStatement, balanceSheet: [], cashFlow: [] }
                );
              } catch {
                computedValue = null;
              }
            }
            
            // Check if this row can have breakdowns (children)
            const canHaveBreakdowns = ["rev", "cogs", "sga", "rd"].includes(row.id);
            const hasChildren = row.children && row.children.length > 0;
            
            return (
              <div
                key={row.id}
                className="space-y-2"
                {...(isInterestSection && {
                  onDragOver: (e: React.DragEvent) => handleDragOverTopLevel(e, row.id),
                  onDragLeave: handleDragLeaveTopLevel,
                  onDrop: (e: React.DragEvent) => handleDropTopLevel(e, globalIndex),
                })}
              >
                <UnifiedItemCard
                  row={row}
                  years={years}
                  meta={meta}
                  glossaryItem={glossaryItem}
                  isLocked={isLocked}
                  isCalculated={isCalculated || isCalculatedOutput}
                  autoValue={computedValue}
                  colorClass={colorClass}
                  onUpdateValue={updateRowValue.bind(null, "incomeStatement")}
                  onRemove={handleRemoveItem}
                  showRemove={!isCalculatedOutput && !allProtectedItems.includes(row.id)}
                  showConfirm={!isCalculatedOutput}
                  protectedRows={allProtectedItems}
                  draggable={isInterestSection && !isLocked}
                  onDragStart={isInterestSection ? (e) => { e.stopPropagation(); handleDragStartTopLevel(e, globalIndex); } : undefined}
                  onDragOver={isInterestSection ? (e) => handleDragOverTopLevel(e, row.id) : undefined}
                  onDragLeave={isInterestSection ? handleDragLeaveTopLevel : undefined}
                  onDrop={isInterestSection ? (e) => handleDropTopLevel(e, globalIndex) : undefined}
                  dragOverId={isInterestSection ? dragOverTopLevelId : undefined}
                />
                
                {/* Breakdown Section - for Revenue, COGS, SG&A */}
                {canHaveBreakdowns && (
                  <div className="ml-6 space-y-2">
                    {/* Show existing breakdowns */}
                    {hasChildren && (
                      <div className="space-y-2">
                        {row.children!.map((child, childIndex) => {
                          const childGlossaryItem = findGlossaryItem(child.label);
                          return (
                            <div
                              key={child.id}
                              onDragOver={(e) => handleDragOver(e, child.id)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, { parentId: row.id, childId: child.id, toIndex: childIndex })}
                            >
                              <UnifiedItemCard
                                row={child}
                                years={years}
                                meta={meta}
                                glossaryItem={childGlossaryItem}
                                isLocked={isLocked}
                                isCalculated={false}
                                colorClass={colorClass}
                                onUpdateValue={updateRowValue.bind(null, "incomeStatement")}
                                onRemove={handleRemoveItem}
                                showRemove={true}
                                showConfirm={true}
                                protectedRows={[]}
                                draggable={!isLocked}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  handleDragStart(e, { parentId: row.id, childId: child.id, fromIndex: childIndex });
                                }}
                                onDragOver={(e) => handleDragOver(e, child.id)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, { parentId: row.id, childId: child.id, toIndex: childIndex })}
                                dragOverId={dragOverId}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                    
                    {/* Add Breakdown - Proper input field instead of prompt */}
                    {!isLocked && (
                      <div className="mt-2">
                        {!showAddBreakdown[row.id] ? (
                          <button
                            type="button"
                            onClick={() => {
                              setShowAddBreakdown((prev) => ({ ...prev, [row.id]: true }));
                              setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: "" }));
                            }}
                            className="text-xs text-blue-400 hover:text-blue-300 underline"
                          >
                            + Add {row.id === "rev" ? "Revenue Stream" : row.id === "cogs" ? "COGS Breakdown" : row.id === "sga" ? "Operating Expense Item" : "Breakdown"}
                          </button>
                        ) : (
                          <div className="flex gap-2 items-center">
                            <input
                              type="text"
                              value={newBreakdownLabels[row.id] || ""}
                              onChange={(e) => {
                                setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: e.target.value }));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const label = newBreakdownLabels[row.id]?.trim();
                                  if (label) {
                                    if (row.id === "rev") {
                                      addChildRow("incomeStatement", "rev", label);
                                      const cogsRow = incomeStatement.find(r => r.id === "cogs");
                                      if (cogsRow) {
                                        addChildRow("incomeStatement", "cogs", `${label} COGS`);
                                      }
                                    } else {
                                      addChildRow("incomeStatement", row.id, label);
                                    }
                                    setShowAddBreakdown((prev) => ({ ...prev, [row.id]: false }));
                                    setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: "" }));
                                  }
                                } else if (e.key === "Escape") {
                                  setShowAddBreakdown((prev) => ({ ...prev, [row.id]: false }));
                                  setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: "" }));
                                }
                              }}
                              placeholder={
                                row.id === "rev"
                                  ? "e.g., Product Revenue, Service Revenue"
                                  : row.id === "cogs"
                                  ? "e.g., Product COGS"
                                  : row.id === "sga"
                                  ? "e.g., Sales & Marketing, Customer Support"
                                  : "Enter breakdown name"
                              }
                              className="flex-1 rounded-md border border-slate-700 bg-slate-900/50 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const label = newBreakdownLabels[row.id]?.trim();
                                if (label) {
                                  if (row.id === "rev") {
                                    addChildRow("incomeStatement", "rev", label);
                                    const cogsRow = incomeStatement.find(r => r.id === "cogs");
                                    if (cogsRow) {
                                      addChildRow("incomeStatement", "cogs", `${label} COGS`);
                                    }
                                  } else {
                                    addChildRow("incomeStatement", row.id, label);
                                  }
                                  setShowAddBreakdown((prev) => ({ ...prev, [row.id]: false }));
                                  setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: "" }));
                                }
                              }}
                              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowAddBreakdown((prev) => ({ ...prev, [row.id]: false }));
                                setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: "" }));
                              }}
                              className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          
          {/* Suggestions for Interest & Other Section */}
          {showSuggestions && !isLocked && (
            <div className="mt-4 space-y-2">
              {interestOtherSuggestions.length > 0 && (
                <>
                  <div className="text-xs text-slate-400 italic mb-2">
                    💡 Suggested items for {title}:
                  </div>
                  {interestOtherSuggestions.map((item, idx) => {
                    return (
                      <div
                        key={idx}
                        className={`rounded-lg border ${colorClass === "orange" ? "border-orange-700/40 bg-orange-950/20" : "border-slate-700/40 bg-slate-950/20"} p-3`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="text-sm font-medium text-slate-200">
                              {item.concept}
                            </div>
                            <p className="text-xs text-slate-300/70 mt-1">
                              {item.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              // Find where to insert - after EBIT margin, before EBT
                              const ebitMarginIndex = incomeStatement.findIndex(r => r.id === "ebit_margin");
                              const ebtIndex = incomeStatement.findIndex(r => r.id === "ebt");
                              const insertIndex = ebtIndex >= 0 ? ebtIndex : 
                                                 ebitMarginIndex >= 0 ? ebitMarginIndex + 1 : 
                                                 incomeStatement.length;
                              
                              const newRow: Row = {
                                id: `is_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                label: item.concept,
                                kind: "input",
                                valueType: "currency",
                                values: {},
                                children: [],
                              };
                              insertRow("incomeStatement", insertIndex, newRow);
                            }}
                            className={`rounded-md ${colorClass === "orange" ? "bg-orange-700 hover:bg-orange-600" : "bg-slate-700 hover:bg-slate-600"} px-3 py-1.5 text-xs font-semibold text-white transition`}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              
              {/* Manual Add Option - Always show for Interest & Other section */}
              <div className="mt-3">
                {!showAddInterestDialog ? (
                  <button
                    type="button"
                    onClick={() => setShowAddInterestDialog(true)}
                    className="text-xs text-slate-400 hover:text-slate-300 underline"
                  >
                    + Add custom item
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={newInterestLabel}
                      onChange={(e) => setNewInterestLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const trimmed = newInterestLabel.trim();
                          if (!trimmed) return;
                          const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
                          const ebtIndex = incomeStatement.findIndex((r) => r.id === "ebt");
                          const insertIndex = ebtIndex >= 0 ? ebtIndex : ebitMarginIndex >= 0 ? ebitMarginIndex + 1 : incomeStatement.length;
                          const newRow: Row = {
                            id: `is_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            label: trimmed,
                            kind: "input",
                            valueType: "currency",
                            values: {},
                            children: [],
                          };
                          insertRow("incomeStatement", insertIndex, newRow);
                          setShowAddInterestDialog(false);
                          setNewInterestLabel("");
                        }
                        if (e.key === "Escape") {
                          setShowAddInterestDialog(false);
                          setNewInterestLabel("");
                        }
                      }}
                      placeholder="Label for new item"
                      className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 placeholder-slate-500 w-48"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const trimmed = newInterestLabel.trim();
                        if (!trimmed) return;
                        const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
                        const ebtIndex = incomeStatement.findIndex((r) => r.id === "ebt");
                        const insertIndex = ebtIndex >= 0 ? ebtIndex : ebitMarginIndex >= 0 ? ebitMarginIndex + 1 : incomeStatement.length;
                        const newRow: Row = {
                          id: `is_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                          label: trimmed,
                          kind: "input",
                          valueType: "currency",
                          values: {},
                          children: [],
                        };
                        insertRow("incomeStatement", insertIndex, newRow);
                        setShowAddInterestDialog(false);
                        setNewInterestLabel("");
                      }}
                      disabled={!newInterestLabel.trim()}
                      className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddInterestDialog(false);
                        setNewInterestLabel("");
                      }}
                      className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>
    );
  };
  
  return (
    <CollapsibleSection
      sectionId="income_statement_all"
      title="Income Statement Builder"
      description="Build your Income Statement with revenue, expenses, and key metrics. All items are organized by section."
      colorClass="blue"
      defaultExpanded={true}
    >
      <div className="space-y-6">
        {/* Revenue Section */}
        {renderSection("Revenue", sections.revenue, "blue", "is_revenue")}
        
        {/* COGS Section */}
        {renderSection("Cost of Goods Sold (COGS)", sections.cogs, "red", "is_cogs")}
        
        {/* Gross Profit Section */}
        {renderSection("Gross Profit", sections.grossProfit, "green", "is_gross_profit")}
        
        {/* Operating Expenses Section */}
        {renderSection("Operating Expenses", sections.operatingExpenses, "purple", "is_operating_expenses")}
        
        {/* D&A Section */}
        {renderSection("Depreciation & Amortization", sections.danda, "amber", "is_danda")}
        
        {/* EBIT Section */}
        {renderSection("EBIT (Operating Income)", sections.ebit, "green", "is_ebit")}
        
        {/* Interest & Other Section */}
        {renderSection("Interest & Other", sections.interest, "orange", "is_interest", true)}
        
        {/* EBT Section */}
        {sections.ebt.length > 0 && renderSection("EBT (Earnings Before Tax)", sections.ebt, "green", "is_ebt")}
        
        {/* Tax Section */}
        {renderSection("Income Tax", sections.tax, "slate", "is_tax")}
        
        {/* Net Income Section */}
        {renderSection("Net Income", sections.netIncome, "green", "is_net_income")}
        
        {/* Other Items Section */}
        {sections.other.length > 0 && renderSection("Other Items", sections.other, "slate", "is_other")}
        
        {/* Stock-Based Compensation (SBC) Section - Optional */}
        {!isLocked && <SbcOptionalSection />}
      </div>
    </CollapsibleSection>
  );
}
