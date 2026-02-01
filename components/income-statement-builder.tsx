"use client";

import { useMemo } from "react";
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
            const glossaryItem = findGlossaryItem(row.label);
            // Only mark as calculated if it's truly a calculated row (not input rows that sum children)
            // Input rows like rev, cogs, sga can have children but should still be editable
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
              <div key={row.id} className="space-y-2">
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
                />
                
                {/* Breakdown Section - for Revenue, COGS, SG&A */}
                {canHaveBreakdowns && (
                  <div className="ml-6 space-y-2">
                    {/* Show existing breakdowns */}
                    {hasChildren && (
                      <div className="space-y-2">
                        {row.children!.map((child) => {
                          const childGlossaryItem = findGlossaryItem(child.label);
                          return (
                            <UnifiedItemCard
                              key={child.id}
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
                            />
                          );
                        })}
                      </div>
                    )}
                    
                    {/* Add Breakdown Button */}
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => {
                          const label = prompt(
                            row.id === "rev" 
                              ? "Enter revenue stream name (e.g., Product Revenue, Service Revenue):"
                              : row.id === "cogs"
                              ? "Enter COGS breakdown name:"
                              : "Enter breakdown name:"
                          );
                          if (label && label.trim()) {
                            if (row.id === "rev") {
                              // For Revenue, also add corresponding COGS stream
                              addChildRow("incomeStatement", "rev", label.trim());
                              const cogsRow = incomeStatement.find(r => r.id === "cogs");
                              if (cogsRow) {
                                addChildRow("incomeStatement", "cogs", `${label.trim()} COGS`);
                              }
                            } else {
                              addChildRow("incomeStatement", row.id, label.trim());
                            }
                          }
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 underline"
                      >
                        + Add {row.id === "rev" ? "Revenue Stream" : row.id === "cogs" ? "COGS Breakdown" : "Breakdown"}
                      </button>
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
                <button
                  type="button"
                  onClick={() => setShowAddDialog(true)}
                  className="text-xs text-slate-400 hover:text-slate-300 underline"
                >
                  + Add custom item
                </button>
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
