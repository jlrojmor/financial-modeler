"use client";

import { useMemo, useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { findGlossaryItem } from "@/lib/financial-glossary";
import { getCommonBSItems, filterAlreadyAdded } from "@/lib/common-suggestions";
import { suggestBestMatch, validateConceptForStatement } from "@/lib/ai-item-matcher";
import { getRowsForCategory, getInsertionIndexForCategory } from "@/lib/bs-category-mapper";
import type { BalanceSheetCategory } from "@/lib/bs-impact-rules";
import UnifiedItemCard from "@/components/unified-item-card";
import CollapsibleSection from "@/components/collapsible-section";
import { computeRowValue } from "@/lib/calculations";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";

// UUID helper
function uuid() {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Unified Balance Sheet Builder
 * 
 * Replaces the complex category-based builder with a unified pattern
 * that matches IS and CFS builders.
 * 
 * Features:
 * - Common suggestions from glossary
 * - AI matching for manual additions
 * - Expand/collapse items
 * - Edit/Confirm/Remove functionality
 * - Organized by categories (Assets, Liabilities, Equity)
 */
export default function BalanceSheetBuilderUnified() {
  const meta = useModelStore((s) => s.meta);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const insertRow = useModelStore((s) => s.insertRow);
  const removeRow = useModelStore((s) => s.removeRow);
  
  const years = useMemo(() => {
    return meta?.years?.historical ?? [];
  }, [meta]);
  
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<BalanceSheetCategory | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<any>(null);
  const [isMatching, setIsMatching] = useState(false);
  
  const isLocked = useModelStore((s) => s.sectionLocks["balance_sheet"] ?? false);
  
  // Get common suggestions by category
  const commonSuggestions = useMemo(() => {
    const assets = getCommonBSItems("Assets");
    const liabilities = getCommonBSItems("Liabilities");
    const equity = getCommonBSItems("Equity");
    
    return {
      assets: filterAlreadyAdded(assets, balanceSheet.map(r => ({ label: r.label, id: r.id }))),
      liabilities: filterAlreadyAdded(liabilities, balanceSheet.map(r => ({ label: r.label, id: r.id }))),
      equity: filterAlreadyAdded(equity, balanceSheet.map(r => ({ label: r.label, id: r.id }))),
    };
  }, [balanceSheet]);
  
  // Organize BS items by category
  const sections = useMemo(() => {
    const currentAssets = getRowsForCategory(balanceSheet, "current_assets");
    const fixedAssets = getRowsForCategory(balanceSheet, "fixed_assets");
    const currentLiabilities = getRowsForCategory(balanceSheet, "current_liabilities");
    const nonCurrentLiabilities = getRowsForCategory(balanceSheet, "non_current_liabilities");
    const equity = getRowsForCategory(balanceSheet, "equity");
    
    // Get total rows
    const totalCurrentAssets = balanceSheet.find(r => r.id === "total_current_assets");
    const totalAssets = balanceSheet.find(r => r.id === "total_assets");
    const totalCurrentLiab = balanceSheet.find(r => r.id === "total_current_liabilities");
    const totalLiab = balanceSheet.find(r => r.id === "total_liabilities");
    const totalEquity = balanceSheet.find(r => r.id === "total_equity");
    const totalLiabAndEquity = balanceSheet.find(r => r.id === "total_liab_and_equity");
    
    return {
      currentAssets,
      fixedAssets,
      currentLiabilities,
      nonCurrentLiabilities,
      equity,
      totals: {
        totalCurrentAssets,
        totalAssets,
        totalCurrentLiab,
        totalLiab,
        totalEquity,
        totalLiabAndEquity,
      },
    };
  }, [balanceSheet]);
  
  // Validate new item as user types
  useEffect(() => {
    if (newItemLabel.trim() && selectedCategory) {
      setIsMatching(true);
      const validateAndMatch = async () => {
        const validation = validateConceptForStatement(newItemLabel.trim(), "BS");
        const match = await suggestBestMatch(newItemLabel.trim(), "BS");
        
        setValidationError(validation.isValid ? null : (validation.reason || "Invalid concept"));
        setMatchResult(match);
        setIsMatching(false);
      };
      validateAndMatch();
    } else {
      setValidationError(null);
      setMatchResult(null);
      setIsMatching(false);
    }
  }, [newItemLabel, selectedCategory]);
  
  const handleAddFromSuggestion = (item: any, category: BalanceSheetCategory) => {
    const insertIndex = getInsertionIndexForCategory(balanceSheet, category);
    const newRow: Row = {
      id: `bs_${uuid()}`,
      label: item.concept,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    
    // Add CFS link if item has one
    const glossaryItem = findGlossaryItem(item.concept);
    if (glossaryItem?.cfsSection) {
      newRow.cfsLink = {
        section: glossaryItem.cfsSection,
        cfsItemId: newRow.id,
        impact: "positive", // Default, can be refined
        description: glossaryItem.description,
      };
    }
    
    insertRow("balanceSheet", insertIndex, newRow);
  };
  
  const handleAddCustom = async () => {
    const trimmed = newItemLabel.trim();
    if (!trimmed || !selectedCategory) return;
    
    if (validationError && !matchResult?.shouldAllow) {
      return;
    }
    
    const label = matchResult?.suggestedLabel || trimmed;
    const insertIndex = getInsertionIndexForCategory(balanceSheet, selectedCategory);
    
    const newRow: Row = {
      id: `bs_${uuid()}`,
      label,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    
    // Add CFS link if matched item has one
    if (matchResult?.matchedConcept) {
      const glossaryItem = matchResult.matchedConcept;
      if (glossaryItem.cfsSection) {
        newRow.cfsLink = {
          section: glossaryItem.cfsSection,
          cfsItemId: newRow.id,
          impact: "positive",
          description: glossaryItem.description,
        };
      }
    }
    
    insertRow("balanceSheet", insertIndex, newRow);
    setNewItemLabel("");
    setShowAddDialog(false);
    setSelectedCategory(null);
    setValidationError(null);
    setMatchResult(null);
  };
  
  const handleRemoveItem = (rowId: string) => {
    const protectedRows = [
      "cash", "ar", "inventory", "other_ca", "total_current_assets",
      "ppe", "intangible_assets", "goodwill", "other_assets", "total_assets",
      "ap", "st_debt", "other_cl", "total_current_liabilities",
      "lt_debt", "other_liab", "total_liabilities",
      "common_stock", "retained_earnings", "other_equity", "total_equity",
      "total_liab_and_equity",
    ];
    if (protectedRows.includes(rowId)) {
      return;
    }
    removeRow("balanceSheet", rowId);
  };
  
  const renderSection = (
    title: string,
    items: Row[],
    colorClass: "blue" | "green" | "orange" | "purple" | "amber" | "slate" | "red",
    sectionId: string,
    suggestions?: any[]
  ) => {
    if (items.length === 0 && (!suggestions || suggestions.length === 0)) return null;
    
    return (
      <CollapsibleSection
        sectionId={sectionId}
        title={title}
        description={`${title} items in the Balance Sheet`}
        colorClass={colorClass}
        defaultExpanded={true}
      >
        <div className="space-y-3">
          {items.map((row) => {
            const glossaryItem = findGlossaryItem(row.label);
            const isCalculated = row.kind === "calc" || row.kind === "total" || row.kind === "subtotal";
            
            let computedValue: number | null = null;
            if (isCalculated) {
              try {
                computedValue = computeRowValue(
                  row,
                  years[0] || "",
                  balanceSheet,
                  balanceSheet,
                  { incomeStatement: [], balanceSheet, cashFlow: [] }
                );
              } catch {
                computedValue = null;
              }
            }
            
            return (
              <UnifiedItemCard
                key={row.id}
                row={row}
                years={years}
                meta={meta}
                glossaryItem={glossaryItem}
                isLocked={isLocked}
                isCalculated={isCalculated}
                autoValue={computedValue}
                colorClass={colorClass}
                onUpdateValue={updateRowValue.bind(null, "balanceSheet")}
                onRemove={handleRemoveItem}
                showRemove={!row.id.startsWith("total_")}
                showConfirm={true}
                protectedRows={[
                  "cash", "ar", "inventory", "other_ca", "total_current_assets",
                  "ppe", "intangible_assets", "goodwill", "other_assets", "total_assets",
                  "ap", "st_debt", "other_cl", "total_current_liabilities",
                  "lt_debt", "other_liab", "total_liabilities",
                  "common_stock", "retained_earnings", "other_equity", "total_equity",
                  "total_liab_and_equity",
                ]}
              />
            );
          })}
        </div>
        
        {/* Suggestions for this section */}
        {!isLocked && suggestions && suggestions.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold text-slate-300">
              💡 Common {title} Items:
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {suggestions.slice(0, 6).map((item) => (
                <div
                  key={item.concept}
                  className="rounded-lg border border-blue-700/40 bg-blue-950/20 p-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-blue-200">
                        {item.concept}
                      </div>
                      <p className="text-xs text-blue-300/70 mt-1">
                        {item.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const category = title.includes("Asset") 
                          ? (title.includes("Current") ? "current_assets" : "fixed_assets")
                          : title.includes("Liability")
                          ? (title.includes("Current") ? "current_liabilities" : "non_current_liabilities")
                          : "equity";
                        handleAddFromSuggestion(item, category as BalanceSheetCategory);
                      }}
                      className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 transition ml-2"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CollapsibleSection>
    );
  };
  
  return (
    <CollapsibleSection
      sectionId="balance_sheet_all"
      title="Balance Sheet Builder"
      description="Build your Balance Sheet with Assets, Liabilities, and Equity. All items are organized by category."
      colorClass="green"
      defaultExpanded={true}
    >
      <div className="space-y-6">
        {/* Assets Section */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-green-200">ASSETS</h3>
          {renderSection("Current Assets", sections.currentAssets, "blue", "bs_current_assets", commonSuggestions.assets.filter(a => a.category === "Assets"))}
          {renderSection("Fixed Assets", sections.fixedAssets, "green", "bs_fixed_assets", commonSuggestions.assets.filter(a => a.category === "Assets"))}
        </div>
        
        {/* Liabilities Section */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-orange-200">LIABILITIES</h3>
          {renderSection("Current Liabilities", sections.currentLiabilities, "orange", "bs_current_liabilities", commonSuggestions.liabilities.filter(l => l.category === "Liabilities"))}
          {renderSection("Non-Current Liabilities", sections.nonCurrentLiabilities, "red", "bs_non_current_liabilities", commonSuggestions.liabilities.filter(l => l.category === "Liabilities"))}
        </div>
        
        {/* Equity Section */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-purple-200">EQUITY</h3>
          {renderSection("Equity", sections.equity, "purple", "bs_equity", commonSuggestions.equity.filter(e => e.category === "Equity"))}
        </div>
        
        {/* Total Rows */}
        {sections.totals.totalAssets && (
          <div className="mt-6 rounded-lg border-2 border-green-800/40 bg-green-950/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-green-200">
                {sections.totals.totalAssets.label}
              </span>
              <span className="text-xs text-slate-400 italic">(Calculated)</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {years.map((year) => {
                let computedValue: number;
                try {
                  computedValue = computeRowValue(
                    sections.totals.totalAssets!,
                    year,
                    balanceSheet,
                    balanceSheet,
                    { incomeStatement: [], balanceSheet, cashFlow: [] }
                  );
                } catch {
                  computedValue = 0;
                }
                const displayValue = storedToDisplay(computedValue, meta?.currencyUnit);
                const unitLabel = getUnitLabel(meta?.currencyUnit);
                
                return (
                  <div key={year} className="flex flex-col">
                    <label className="text-xs text-green-300/80 mb-1">{year}</label>
                    <div className="rounded-md border border-green-700/40 bg-green-950/40 px-2 py-1.5 text-sm font-semibold text-green-200">
                      {computedValue !== 0 ? `${displayValue}${unitLabel ? ` ${unitLabel}` : ""}` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* Add Custom Item */}
        {!isLocked && (
          <div className="mt-6">
            {!showAddDialog ? (
              <button
                type="button"
                onClick={() => setShowAddDialog(true)}
                className="rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:opacity-80 transition"
              >
                + Add Custom Balance Sheet Item
              </button>
            ) : (
              <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                <div className="mb-3">
                  <label className="mb-2 block text-xs font-semibold text-slate-300">
                    Select Category:
                  </label>
                  <select
                    value={selectedCategory || ""}
                    onChange={(e) => setSelectedCategory(e.target.value as BalanceSheetCategory)}
                    className="w-full rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select a category...</option>
                    <option value="current_assets">Current Assets</option>
                    <option value="fixed_assets">Fixed Assets</option>
                    <option value="current_liabilities">Current Liabilities</option>
                    <option value="non_current_liabilities">Non-Current Liabilities</option>
                    <option value="equity">Equity</option>
                  </select>
                </div>
                
                <input
                  type="text"
                  value={newItemLabel}
                  onChange={(e) => setNewItemLabel(e.target.value)}
                  placeholder="Enter item name (e.g., Prepaid Expenses)..."
                  className="w-full rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none mb-2"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !validationError && matchResult?.shouldAllow && selectedCategory) {
                      handleAddCustom();
                    } else if (e.key === "Escape") {
                      setShowAddDialog(false);
                      setNewItemLabel("");
                      setSelectedCategory(null);
                    }
                  }}
                  disabled={!selectedCategory}
                  autoFocus
                />
                
                {/* Validation Error */}
                {validationError && (
                  <div className="mb-2 rounded-md border border-red-700/40 bg-red-950/20 p-2">
                    <div className="text-xs text-red-300">⚠️ {validationError}</div>
                  </div>
                )}
                
                {/* Match Result */}
                {matchResult && matchResult.matchedConcept && !validationError && (
                  <div className="mb-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
                    <div className="text-xs text-emerald-300">
                      ✅ Matched: <strong>{matchResult.matchedConcept.concept}</strong>
                    </div>
                    <div className="text-xs text-emerald-300/70 mt-1">
                      {matchResult.matchedConcept.description}
                    </div>
                    {matchResult.confidence < 0.8 && (
                      <div className="text-xs text-amber-300/70 mt-1">
                        ⚠️ Confidence: {Math.round(matchResult.confidence * 100)}% - Please verify this is correct
                      </div>
                    )}
                  </div>
                )}
                
                {/* Suggestions */}
                {matchResult && matchResult.suggestions.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs text-slate-400 mb-1">Did you mean:</div>
                    {matchResult.suggestions.slice(0, 3).map((suggestion: any) => (
                      <button
                        key={suggestion.concept}
                        type="button"
                        onClick={() => {
                          setNewItemLabel(suggestion.concept);
                        }}
                        className="mr-2 mb-1 rounded-md border border-blue-700/40 bg-blue-950/20 px-2 py-1 text-xs text-blue-300 hover:bg-blue-900/40"
                      >
                        {suggestion.concept}
                      </button>
                    ))}
                  </div>
                )}
                
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddCustom}
                    disabled={!newItemLabel.trim() || !selectedCategory || (validationError && !matchResult?.shouldAllow) || isMatching}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isMatching ? "Matching..." : "Add"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddDialog(false);
                      setNewItemLabel("");
                      setSelectedCategory(null);
                      setValidationError(null);
                      setMatchResult(null);
                    }}
                    className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
