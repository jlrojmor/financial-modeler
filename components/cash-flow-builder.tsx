"use client";

import { useMemo, useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
} from "@/lib/currency-utils";
import CollapsibleSection from "@/components/collapsible-section";
import { findTermKnowledge } from "@/lib/financial-terms-knowledge";
import { analyzeBSItemsForCFO, type CFOItem } from "@/lib/cfo-intelligence";
import { getSuggestedCFIItems, validateCFIItem, findCFIItem, type CFIItem } from "@/lib/cfi-intelligence";
import { getSuggestedCFFItems, validateCFFItem, findCFFItem, type CFFItem } from "@/lib/cff-intelligence";
import { computeRowValue } from "@/lib/calculations";
// UUID helper
function uuid() {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

type CFSSection = "operating" | "investing" | "financing";

interface CFSSectionConfig {
  id: CFSSection;
  label: string;
  description: string;
  colorClass: "blue" | "green" | "orange";
  sectionId: string;
  totalRowId: string;
  standardItems: string[]; // IDs of standard items in this section
}

const CFS_SECTIONS: CFSSectionConfig[] = [
  {
    id: "operating",
    label: "Operating Activities",
    description: "Cash flows from operating activities. ✨ Net Income, D&A, and SBC auto-populate from Income Statement. 📊 Working Capital changes: input first year, then auto-calculated from Balance Sheet.",
    colorClass: "blue",
    sectionId: "cfs_operating",
    totalRowId: "operating_cf",
    standardItems: ["net_income", "danda", "sbc", "wc_change", "other_operating"],
  },
  {
    id: "investing",
    label: "Investing Activities",
    description: "Cash flows from investing activities. CapEx and other investing transactions.",
    colorClass: "green",
    sectionId: "cfs_investing",
    totalRowId: "investing_cf",
    standardItems: ["capex", "other_investing"],
  },
  {
    id: "financing",
    label: "Financing Activities",
    description: "Cash flows from financing activities. Debt, equity, and dividend transactions.",
    colorClass: "orange",
    sectionId: "cfs_financing",
    totalRowId: "financing_cf",
    standardItems: ["debt_issuance", "debt_repayment", "equity_issuance", "dividends"],
  },
];

/**
 * CFS Section Component - displays items for a specific CFS section
 */
function CFSSectionComponent({
  section,
  rows,
  years,
  meta,
  updateRowValue,
  insertRow,
  removeRow,
  incomeStatement,
  sbcBreakdowns,
  allStatements,
  cfoIntelligence = [],
  balanceSheet,
  danaBreakdowns,
  danaLocation,
}: {
  section: CFSSectionConfig;
  rows: Row[];
  years: string[];
  meta: any;
  updateRowValue: (statement: "cashFlow", rowId: string, year: string, value: number) => void;
  insertRow: (statement: "cashFlow", index: number, row: Row) => void;
  removeRow: (statement: "cashFlow", rowId: string) => void;
  incomeStatement: Row[];
  sbcBreakdowns: Record<string, Record<string, number>>;
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] };
  cfoIntelligence?: CFOItem[];
  balanceSheet: Row[];
  danaBreakdowns: Record<string, number>;
  danaLocation: "cogs" | "sga" | "both" | null;
}) {
  // Get current cashFlow from store to ensure we have the latest state
  // This ensures we always have the most up-to-date data after insertions
  const currentCashFlow = useModelStore((s) => s.cashFlow);
  // Always use currentCashFlow from store as the source of truth
  const currentRows = currentCashFlow;
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [termKnowledge, setTermKnowledge] = useState<any>(null);
  
  // Check if label is recognized - use CFI validation for investing section
  useEffect(() => {
    if (newItemLabel.trim()) {
      if (section.id === "investing") {
        // Use CFI intelligence for investing section
        const validation = validateCFIItem(newItemLabel.trim());
        const matchedItem = findCFIItem(newItemLabel.trim());
        
        if (matchedItem) {
          setTermKnowledge({ cfiItem: matchedItem });
          setValidationError(null);
        } else if (validation.isValid) {
          setTermKnowledge({ cfiItem: null, validation });
          setValidationError(null);
        } else {
          setTermKnowledge(null);
          setValidationError(validation.suggestion || validation.reason || "⚠️ This term may not be appropriate for Investing Activities.");
        }
      } else if (section.id === "financing") {
        // Use CFF intelligence for financing section
        const validation = validateCFFItem(newItemLabel.trim());
        const matchedItem = findCFFItem(newItemLabel.trim());
        
        if (matchedItem) {
          setTermKnowledge({ cffItem: matchedItem });
          setValidationError(null);
        } else if (validation.isValid) {
          setTermKnowledge({ cffItem: null, validation });
          setValidationError(null);
        } else {
          setTermKnowledge(null);
          setValidationError(validation.suggestion || validation.reason || "⚠️ This term may not be appropriate for Financing Activities.");
        }
      } else {
        // Use financial terms knowledge for other sections
        const knowledge = findTermKnowledge(newItemLabel.trim());
        setTermKnowledge(knowledge);
        if (!knowledge && !section.standardItems.some(id => currentRows.some(r => r.id === id && r.label.toLowerCase() === newItemLabel.trim().toLowerCase()))) {
          setValidationError("This term is not recognized. Please use standard financial terminology or select a suggestion.");
        } else {
          setValidationError(null);
        }
      }
    } else {
      setValidationError(null);
      setTermKnowledge(null);
    }
  }, [newItemLabel, currentRows, section.standardItems, section.id]);

  // Get items for this section
  const sectionItems = useMemo(() => {
    const sectionStartIndex = currentRows.findIndex(r => {
      if (section.id === "operating") return r.id === "net_income";
      if (section.id === "investing") return r.id === "capex";
      if (section.id === "financing") return r.id === "debt_issuance";
      return false;
    });

    const sectionEndIndex = currentRows.findIndex((r, idx) => {
      if (idx <= sectionStartIndex) return false;
      if (section.id === "operating") return r.id === "operating_cf";
      if (section.id === "investing") return r.id === "investing_cf";
      if (section.id === "financing") return r.id === "financing_cf";
      return false;
    });

    // For investing and financing sections, include all items from start marker up to and including the total row
    // This ensures newly added items (inserted before the total) are included
    let result: Row[] = [];
    
    if (sectionStartIndex !== -1) {
      // Standard case: start marker exists, get items from start to end
      result = sectionEndIndex === -1 
        ? currentRows.slice(sectionStartIndex) 
        : currentRows.slice(sectionStartIndex, sectionEndIndex + 1);
    }
    
    // For investing and financing sections, also include any items with matching cfsLink.section
    // This handles cases where start marker doesn't exist or items are inserted outside normal range
    if (section.id === "investing" || section.id === "financing") {
      const itemsWithCfsLink = currentRows.filter(r => r.cfsLink?.section === section.id);
      
      const additionalItems = itemsWithCfsLink.filter(r => 
        !result.some(existing => existing.id === r.id)
      );
      if (additionalItems.length > 0) {
        // Insert additional items before the total row if it exists, otherwise append
        const totalIndexInResult = result.findIndex(r => r.id === section.totalRowId);
        if (totalIndexInResult >= 0) {
          result = [
            ...result.slice(0, totalIndexInResult),
            ...additionalItems,
            ...result.slice(totalIndexInResult)
          ];
        } else {
          result = [...result, ...additionalItems];
        }
      }
      
      // If no items found and start marker doesn't exist, still try to find items by cfsLink
      if (result.length === 0 && sectionStartIndex === -1) {
        const itemsByLink = currentRows.filter(r => r.cfsLink?.section === section.id);
        if (itemsByLink.length > 0) {
          result = itemsByLink;
          // Also include the total row if it exists
          const totalRow = currentRows.find(r => r.id === section.totalRowId);
          if (totalRow) {
            result.push(totalRow);
          }
        }
      }
      
      // Check for items between investing_cf and financing_cf that might be financing items
      // but don't have cfsLink (position-based detection like Excel preview uses)
      if (section.id === "financing") {
        const investingCfIndex = currentRows.findIndex(r => r.id === "investing_cf");
        const financingCfIndex = currentRows.findIndex(r => r.id === "financing_cf");
        
        if (investingCfIndex >= 0 && financingCfIndex >= 0) {
          const itemsBetween = currentRows.slice(investingCfIndex + 1, financingCfIndex);
          const missingItems = itemsBetween.filter(r => 
            !result.some(existing => existing.id === r.id) &&
            r.id !== section.totalRowId
          );
          
          if (missingItems.length > 0) {
            // Add missing items that are positioned in financing section
            const totalIndexInResult = result.findIndex(r => r.id === section.totalRowId);
            if (totalIndexInResult >= 0) {
              result = [
                ...result.slice(0, totalIndexInResult),
                ...missingItems,
                ...result.slice(totalIndexInResult)
              ];
            } else {
              result = [...result, ...missingItems];
            }
          }
          
          // Ensure the total row (financing_cf) is always included
          const totalRow = currentRows.find(r => r.id === section.totalRowId);
          if (totalRow && !result.some(r => r.id === section.totalRowId)) {
            result.push(totalRow);
          }
        }
      }
    }
    
    return result;
  }, [currentRows, section.id]);

  const totalRow = sectionItems.find(r => r.id === section.totalRowId);
  const isLocked = useModelStore((s) => s.sectionLocks[section.sectionId] ?? false);

  // Get the sign indicator for CFO/CFI items
  const getCFOSign = (row: Row): string | null => {
    // Show signs for operating and investing section items
    if (section.id === "operating") {
      // Standard CFO items with known signs
      if (row.id === "net_income" || row.id === "danda" || row.id === "sbc") {
        return "+";
      }
      if (row.id === "wc_change") {
        return "-";
      }
      if (row.id === "other_operating") {
        return "+"; // Can be negative, but shown as + (value itself can be negative)
      }
      
      // CFO intelligence items - check the impact
      if (row.id.startsWith("cfo_") && row.cfsLink) {
        if (row.cfsLink.impact === "positive") {
          return "+";
        } else if (row.cfsLink.impact === "negative") {
          return "-";
        } else {
          return "+"; // Neutral defaults to +
        }
      }
    } else if (section.id === "investing") {
      // Standard CFI items
      if (row.id === "capex") {
        return "-"; // CapEx is cash outflow
      }
      if (row.id === "other_investing") {
        return "+"; // Can be positive or negative, but shown as + (value itself can be negative)
      }
      
      // CFI items with cfsLink - check the impact
      if (row.cfsLink && row.cfsLink.section === "investing") {
        if (row.cfsLink.impact === "positive") {
          return "+";
        } else if (row.cfsLink.impact === "negative") {
          return "-";
        }
      }
      
      // Try to match by label using CFI intelligence
      if (row.label) {
        const cfiItem = findCFIItem(row.label);
        if (cfiItem) {
          return cfiItem.impact === "positive" ? "+" : "-";
        }
      }
    } else if (section.id === "financing") {
      // Standard CFF items
      if (row.id === "debt_issuance" || row.id === "equity_issuance") {
        return "+"; // Issuances are cash inflows
      }
      if (row.id === "debt_repayment" || row.id === "dividends") {
        return "-"; // Repayments and dividends are cash outflows
      }
      
      // CFF items with cfsLink - check the impact
      if (row.cfsLink && row.cfsLink.section === "financing") {
        if (row.cfsLink.impact === "positive") {
          return "+";
        } else if (row.cfsLink.impact === "negative") {
          return "-";
        }
      }
      
      // Try to match by label using CFF intelligence
      if (row.label) {
        const cffItem = findCFFItem(row.label);
        if (cffItem) {
          return cffItem.impact === "positive" ? "+" : "-";
        }
      }
    }
    
    // Default: no sign for unknown items
    return null;
  };

  // Get link information and auto-population status for display
  const getLinkInfo = (row: Row): { text: string; isAutoPopulated: boolean } | null => {
    if (row.cfsLink) {
      return { text: row.cfsLink.description, isAutoPopulated: false };
    }
    if (row.isLink) {
      return { text: `Links to IS: ${row.isLink.description}`, isAutoPopulated: true };
    }
    // Standard links
    if (row.id === "net_income") return { text: "✨ Auto-populated from Income Statement", isAutoPopulated: true };
    // D&A is now a manual input - no auto-population
    if (row.id === "sbc") return { text: "✨ Auto-calculated from SBC breakdowns", isAutoPopulated: true };
    if (row.id === "wc_change") {
      // All historical years are manual input, projection years are calculated
      return { 
        text: "📝 Input required for all historical years (from 10-K). Projection years will be auto-calculated from Balance Sheet changes",
        isAutoPopulated: false
      };
    }
    return null;
  };
  
  // Get auto-populated value for display
  const getAutoPopulatedValue = (row: Row, year: string): number | null => {
    if (row.id === "net_income") {
      const isRow = incomeStatement.find(r => r.id === "net_income");
      if (isRow?.values?.[year] !== undefined) {
        return isRow.values[year];
      }
      // Try computing it if not stored
      try {
        const computed = computeRowValue(isRow || row, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns);
        return computed !== 0 ? computed : null;
      } catch {
        return null;
      }
    }
    // D&A is now a manual input - no auto-population
    if (row.id === "sbc") {
      // Sum all SBC breakdowns for this year
      let total = 0;
      Object.keys(sbcBreakdowns).forEach(categoryId => {
        total += sbcBreakdowns[categoryId]?.[year] ?? 0;
      });
      return total > 0 ? total : null;
    }
    if (row.id === "wc_change") {
      // All historical years are manual input
      // Projection years are calculated from BS changes
      const isHistorical = year.endsWith("A");
      const isProjection = year.endsWith("E");
      
      if (isHistorical) {
        // Historical year - return stored input value
        const storedValue = row.values?.[year];
        return storedValue !== undefined && storedValue !== 0 ? storedValue : null;
      } else if (isProjection) {
        // Projection year - calculate from BS changes
        try {
          const computed = computeRowValue(row, year, allStatements.cashFlow, allStatements.cashFlow, allStatements, sbcBreakdowns);
          return computed;
        } catch {
          return null;
        }
      }
      // Default: treat as input
      const storedValue = row.values?.[year];
      return storedValue !== undefined && storedValue !== 0 ? storedValue : null;
    }
    return null;
  };

  const handleAddCustomItem = () => {
    if (!newItemLabel.trim()) return;
    
    // Validation: must be recognized term or have validation passed
    if (validationError && !termKnowledge) {
      return; // Don't add if validation failed
    }

    // Find insertion point (before the total row)
    const totalIndex = currentRows.findIndex(r => r.id === section.totalRowId);
    const insertIndex = totalIndex >= 0 ? totalIndex : currentRows.length;

    const newRow: Row = {
      id: uuid(),
      label: newItemLabel.trim(),
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    
    // If term is recognized, store its knowledge
    if (termKnowledge) {
      // CFI item (for investing section)
      if (termKnowledge.cfiItem) {
        const cfiItem = termKnowledge.cfiItem as CFIItem;
        newRow.cfsLink = {
          section: "investing",
          cfsItemId: newRow.id,
          impact: cfiItem.impact,
          description: cfiItem.description,
        };
      }
      // CFF item (for financing section)
      else if ((termKnowledge as any).cffItem) {
        const cffItem = (termKnowledge as any).cffItem as CFFItem;
        newRow.cfsLink = {
          section: "financing",
          cfsItemId: newRow.id,
          impact: cffItem.impact,
          description: cffItem.description,
        };
      }
      // Financial terms knowledge (for other sections)
      else if (termKnowledge.cfsTreatment) {
        newRow.cfsLink = {
          section: termKnowledge.cfsTreatment.section,
          cfsItemId: termKnowledge.cfsTreatment.cfsItemId,
          impact: termKnowledge.cfsTreatment.impact,
          description: termKnowledge.cfsTreatment.description,
        };
      }
      if (termKnowledge.isLink) {
        newRow.isLink = {
          isItemId: termKnowledge.isLink.isItemId,
          description: termKnowledge.isLink.description,
        };
      }
    }

    insertRow("cashFlow", insertIndex, newRow);
    setNewItemLabel("");
    setShowAddDialog(false);
    setValidationError(null);
    setTermKnowledge(null);
  };

  const handleRemoveItem = (rowId: string) => {
    // Protect critical totals and calculated rows that are essential for the model
    const protectedRows = [
      "operating_cf",
      "investing_cf", 
      "financing_cf",
      "net_change_cash",
      "net_income", // Critical for CFO calculation
    ];
    
    // Don't allow removing protected rows
    if (protectedRows.includes(rowId) || rowId === section.totalRowId) {
      return;
    }
    
    // Allow removing any other item (standard items, user-added items, etc.)
    removeRow("cashFlow", rowId);
  };

  const colors = {
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
  }[section.colorClass];

  return (
    <CollapsibleSection
      sectionId={section.sectionId}
      title={section.label}
      description={section.description}
      colorClass={section.colorClass}
      defaultExpanded={true}
    >
      <div className="space-y-4">
        {/* Items List */}
        {sectionItems.length > 0 ? (
          sectionItems
            .filter(r => r.id !== section.totalRowId) // Don't show total in the list
            .map((row) => {
            const linkInfo = getLinkInfo(row);
            const isStandard = section.standardItems.includes(row.id);
            // D&A and WC Change are editable even if marked as "calc"
            // For D&A, always treat as input (not calculated)
            const isCalculated = row.id === "danda" ? false : (row.kind === "calc" && row.id !== "wc_change");
            const autoValue = linkInfo?.isAutoPopulated ? getAutoPopulatedValue(row, years[0] || "") : null;

            return (
              <div
                key={row.id}
                className={`rounded-lg border ${colors.border} ${colors.bg} p-3`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {getCFOSign(row) && (
                        <span className={`text-sm font-semibold ${getCFOSign(row) === "+" ? "text-green-400" : "text-red-400"}`}>
                          ({getCFOSign(row)})
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
                      {autoValue !== null && autoValue !== undefined && (
                        <span className="text-xs text-emerald-300">
                          (Value: {storedToDisplay(autoValue, meta?.currencyUnit)} {getUnitLabel(meta?.currencyUnit)})
                        </span>
                      )}
                    </div>
                  </div>
                  {(() => {
                    // Protect critical totals and calculated rows
                    const protectedRows = [
                      "operating_cf",
                      "investing_cf",
                      "financing_cf", 
                      "net_change_cash",
                      "net_income",
                    ];
                    const isProtected = protectedRows.includes(row.id) || row.id === section.totalRowId;
                    
                    // Show Remove button for all items except protected ones, and only when not locked
                    return !isProtected && !isLocked ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(row.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    ) : null;
                  })()}
                </div>

                {/* Show auto-populated value or input fields */}
                {/* For Net Income and SBC: show read-only auto-populated value */}
                {/* For D&A and WC Change: show auto-populated value as suggestion, but allow input */}
                {linkInfo?.isAutoPopulated && autoValue !== null && (row.id === "net_income" || row.id === "sbc") ? (
                  <div className="mt-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
                    <div className="text-xs text-emerald-300">
                      ✨ Auto-populated from linked statement: {storedToDisplay(autoValue, meta?.currencyUnit)} {getUnitLabel(meta?.currencyUnit)}
                    </div>
                    <div className="text-[10px] text-emerald-400/70 mt-1">
                      {row.id === "net_income" 
                        ? "This value is automatically pulled from the Income Statement (Net Income row). No manual input needed."
                        : row.id === "sbc"
                        ? "This value is automatically calculated from all SBC breakdowns (SG&A and COGS categories). No manual input needed."
                        : "This value is automatically pulled from the Income Statement or SBC breakdowns. No manual input needed."}
                    </div>
                  </div>
                ) : !isCalculated || row.id === "danda" || row.id === "wc_change" || row.kind === "input" ? (
                  <div>
                    
                    {/* Guidance for WC Change */}
                    {row.id === "wc_change" && years.length > 0 && (
                      <div className="mb-2 rounded-md border border-blue-700/40 bg-blue-950/20 p-2">
                        <div className="text-xs text-blue-300">
                          📊 <strong>Working Capital Change:</strong>
                        </div>
                        <div className="text-[10px] text-blue-400/80 mt-1">
                          {years.length === 1 
                            ? "Input required for the first historical year (no prior year to calculate change)."
                            : `Input required for ${years[0]}. For ${years.slice(1).join(", ")}, this will be automatically calculated from Balance Sheet changes: (Current Assets - Current Liabilities), excluding Cash and Short-Term Debt.`
                          }
                        </div>
                        <div className="text-[10px] text-blue-400/60 mt-1 italic">
                          Formula: Change in (Current Assets - Current Liabilities), excluding Cash & Short-Term Debt
                        </div>
                      </div>
                    )}
                    
                    {/* Input fields for historical years */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                    {years.map((year) => {
                      // Get stored value - simple for all fields
                      let storedValue = row.values?.[year] ?? 0;
                      
                      // For Net Income and SBC: use auto-populated value (read-only)
                      if (row.id === "net_income" || row.id === "sbc") {
                        const autoValue = getAutoPopulatedValue(row, year);
                        if (autoValue !== null) {
                          storedValue = autoValue;
                        }
                      }
                      
                      // D&A is now a simple manual input - no auto-population
                      
                      // For WC Change, all historical years are input, projection years are calculated
                      if (row.id === "wc_change") {
                        const isHistorical = year.endsWith("A");
                        const isProjection = year.endsWith("E");
                        
                        if (isHistorical) {
                          // Historical year - use stored input
                          storedValue = row.values?.[year] ?? 0;
                        } else if (isProjection) {
                          // Projection year - calculate from BS changes
                          try {
                            const computed = computeRowValue(row, year, allStatements.cashFlow, allStatements.cashFlow, allStatements, sbcBreakdowns);
                            storedValue = computed;
                          } catch {
                            // Fallback to stored value if computation fails
                            storedValue = row.values?.[year] ?? 0;
                          }
                        } else {
                          // Default: treat as input
                          storedValue = row.values?.[year] ?? 0;
                        }
                      }
                      
                      const displayValue = storedToDisplay(storedValue, meta?.currencyUnit);
                      const unitLabel = getUnitLabel(meta?.currencyUnit);
                      
                      // Determine if field is read-only
                      // WC Change: historical years are editable, projection years are calculated (read-only)
                      const isWcChangeProjection = row.id === "wc_change" && year.endsWith("E");
                      const isReadOnly = (row.id === "net_income" || row.id === "sbc") || isWcChangeProjection;
                      const isDanda = row.id === "danda";

                      return (
                        <div key={year} className="flex flex-col">
                          <label className={`text-xs ${colors.textLight} mb-1`}>
                            {year}
                            {isWcChangeProjection && <span className="text-[10px] text-slate-500 ml-1">(calculated)</span>}
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={displayValue === 0 ? "" : String(displayValue)}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || val === "-") {
                                updateRowValue("cashFlow", row.id, year, 0);
                                return;
                              }
                              const displayNum = Number(val);
                              if (!isNaN(displayNum)) {
                                const storedNum = displayToStored(displayNum, meta?.currencyUnit);
                                updateRowValue("cashFlow", row.id, year, storedNum);
                              }
                            }}
                            onBlur={(e) => {
                              if (e.target.value === "") {
                                updateRowValue("cashFlow", row.id, year, 0);
                              }
                            }}
                            placeholder="0"
                            disabled={row.id === "danda" ? false : (isLocked || isReadOnly)}
                            className={`w-full rounded border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${isReadOnly && row.id !== "danda" ? "bg-slate-800/30" : ""}`}
                          />
                          {unitLabel && (
                            <span className="text-xs text-slate-500 mt-0.5">{unitLabel}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-400 italic">
                    Value calculated automatically from linked statements
                  </div>
                )}

                {/* Calculated value display */}
                {isCalculated && (
                  <div className="mt-2 text-xs text-slate-400 italic">
                    Value calculated automatically from linked statements
                  </div>
                )}
              </div>
            );
          })
        ) : null}

        {/* CFI Suggestions (only for Investing Activities) */}
        {section.id === "investing" && (() => {
          const existingItemIds = sectionItems.map(r => r.id);
          const suggestedCFI = getSuggestedCFIItems(existingItemIds);
          return suggestedCFI.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-xs text-slate-400 italic mb-2">
                💡 Suggested CFI Items:
              </div>
              {suggestedCFI.map((item, idx) => {
                const alreadyAdded = currentRows.some(r => 
                  r.label.toLowerCase() === item.label.toLowerCase() ||
                  item.commonNames.some(name => r.label.toLowerCase() === name.toLowerCase())
                );
                
                if (alreadyAdded) return null;
                
                return (
                  <div
                    key={idx}
                    className="rounded-lg border border-green-700/40 bg-green-950/20 p-3"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold ${item.impact === "positive" ? "text-green-400" : "text-red-400"}`}>
                            ({item.impact === "positive" ? "+" : "-"})
                          </span>
                          <span className="text-sm font-medium text-green-200">
                            {item.label}
                          </span>
                        </div>
                        <p className="text-xs text-green-300/70 mt-1">
                          {item.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          // Use currentRows to get the latest state
                          const totalIndex = currentRows.findIndex(r => r.id === section.totalRowId);
                          const insertIndex = totalIndex >= 0 ? totalIndex : currentRows.length;
                          
                          // Generate ID first to avoid temporal dead zone error
                          const newRowId = uuid();
                          
                          const newRow: Row = {
                            id: newRowId,
                            label: item.label,
                            kind: "input",
                            valueType: "currency",
                            values: {},
                            children: [],
                            cfsLink: {
                              section: "investing",
                              cfsItemId: newRowId,
                              impact: item.impact,
                              description: item.description,
                            },
                          };
                          
                          insertRow("cashFlow", insertIndex, newRow);
                        }}
                        className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-600 transition"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* CFF Suggestions (only for Financing Activities) */}
        {section.id === "financing" && (() => {
          const existingItemIds = sectionItems.map(r => r.id);
          const suggestedCFF = getSuggestedCFFItems(existingItemIds);
          return suggestedCFF.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-xs text-slate-400 italic mb-2">
                💡 Suggested CFF Items:
              </div>
              {suggestedCFF.map((item, idx) => {
                const alreadyAdded = currentRows.some(r => 
                  r.label.toLowerCase() === item.label.toLowerCase() ||
                  item.commonNames.some(name => r.label.toLowerCase() === name.toLowerCase())
                );
                
                if (alreadyAdded) return null;
                
                return (
                  <div
                    key={idx}
                    className="rounded-lg border border-orange-700/40 bg-orange-950/20 p-3"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold ${item.impact === "positive" ? "text-green-400" : "text-red-400"}`}>
                            ({item.impact === "positive" ? "+" : "-"})
                          </span>
                          <span className="text-sm font-medium text-orange-200">
                            {item.label}
                          </span>
                        </div>
                        <p className="text-xs text-orange-300/70 mt-1">
                          {item.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          // Get the latest state from the store to ensure we have the most up-to-date cashFlow array
                          const store = useModelStore.getState();
                          const latestCashFlow = store.cashFlow;
                          
                          // Find the index of financing_cf (the total row for financing section)
                          const totalIndex = latestCashFlow.findIndex(r => r.id === section.totalRowId);
                          
                          // Always insert BEFORE financing_cf (the total row)
                          // If financing_cf doesn't exist, find the last financing item or insert after investing_cf
                          let insertIndex: number;
                          if (totalIndex >= 0) {
                            // Insert right before financing_cf
                            insertIndex = totalIndex;
                          } else {
                            // financing_cf doesn't exist, find the last financing item or insert after investing_cf
                            const dividendsIndex = latestCashFlow.findIndex(r => r.id === "dividends");
                            const equityIssuanceIndex = latestCashFlow.findIndex(r => r.id === "equity_issuance");
                            const debtRepaymentIndex = latestCashFlow.findIndex(r => r.id === "debt_repayment");
                            const debtIssuanceIndex = latestCashFlow.findIndex(r => r.id === "debt_issuance");
                            const investingCfIndex = latestCashFlow.findIndex(r => r.id === "investing_cf");
                            
                            // Find the last financing item
                            const lastFinancingIndex = Math.max(
                              dividendsIndex,
                              equityIssuanceIndex,
                              debtRepaymentIndex,
                              debtIssuanceIndex
                            );
                            
                            insertIndex = lastFinancingIndex >= 0 
                              ? lastFinancingIndex + 1 
                              : investingCfIndex >= 0 
                              ? investingCfIndex + 1 
                              : latestCashFlow.length;
                          }
                          
                          // Generate ID first to avoid temporal dead zone error
                          const newRowId = uuid();
                          
                          const newRow: Row = {
                            id: newRowId,
                            label: item.label,
                            kind: "input",
                            valueType: "currency",
                            values: {},
                            children: [],
                            cfsLink: {
                              section: "financing",
                              cfsItemId: newRowId,
                              impact: item.impact,
                              description: item.description,
                            },
                          };
                          
                          insertRow("cashFlow", insertIndex, newRow);
                        }}
                        className="rounded-md bg-orange-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 transition"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* CFO Intelligence Suggestions (only for Operating Activities) */}
        {section.id === "operating" && (
          <>
            {cfoIntelligence.length > 0 && (
              <div className="mb-2 text-xs text-slate-400 italic">
                💡 CFO Intelligence: Found {cfoIntelligence.length} items ({cfoIntelligence.filter(i => i.treatment === "auto_add").length} auto-added, {cfoIntelligence.filter(i => i.treatment === "suggest_review").length} suggestions)
              </div>
            )}
          </>
        )}
        {section.id === "operating" && cfoIntelligence.length > 0 && (
          <div className="mt-4 space-y-2">
            {cfoIntelligence
              .filter(item => item.treatment === "suggest_review")
              .map(item => {
                const alreadyAdded = currentRows.some(r => r.id === `cfo_${item.rowId}`);
                
                if (alreadyAdded) return null;
                
                return (
                  <div
                    key={item.rowId}
                    className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-amber-200">
                            💡 Suggested: {item.label}
                          </span>
                          <span className="text-xs text-amber-400/80">(Review needed)</span>
                        </div>
                        <p className="text-xs text-amber-300/70 mt-1">
                          {item.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const otherOperatingIndex = rows.findIndex(r => r.id === "other_operating");
                          const operatingCfIndex = rows.findIndex(r => r.id === "operating_cf");
                          const insertIndex = otherOperatingIndex >= 0 ? otherOperatingIndex : 
                                           operatingCfIndex >= 0 ? operatingCfIndex : 
                                           rows.length;
                          
                          const newRow: Row = {
                            id: `cfo_${item.rowId}`,
                            label: `Change in ${item.label}`,
                            kind: "calc",
                            valueType: "currency",
                            values: {},
                            children: [],
                            cfsLink: {
                              section: "operating",
                              cfsItemId: "other_operating",
                              impact: item.impact,
                              description: item.description,
                            },
                          };
                          
                          insertRow("cashFlow", insertIndex, newRow);
                        }}
                        className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition"
                      >
                        Add to CFO
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* Total Row Display */}
        {totalRow && (
          <div className={`rounded-lg border-2 ${colors.border} ${colors.bg} p-3 mt-4`}>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-bold ${colors.text}`}>
                {totalRow.label}
              </span>
              <span className="text-xs text-slate-400 italic">(Calculated)</span>
            </div>
          </div>
        )}

        {/* Add Custom Item */}
        {!isLocked && (
          <div className="mt-4">
            {!showAddDialog ? (
              <button
                type="button"
                onClick={() => setShowAddDialog(true)}
                className={`rounded-md border ${colors.border} ${colors.bg} px-4 py-2 text-xs font-semibold ${colors.text} hover:opacity-80 transition`}
              >
                + Add Custom {section.label} Item
              </button>
            ) : (
              <div className={`rounded-lg border ${colors.border} ${colors.bg} p-3`}>
                <input
                  type="text"
                  value={newItemLabel}
                  onChange={(e) => setNewItemLabel(e.target.value)}
                  placeholder="Enter item label..."
                  className="w-full rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none mb-2"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddCustomItem();
                    } else if (e.key === "Escape") {
                      setShowAddDialog(false);
                      setNewItemLabel("");
                    }
                  }}
                  autoFocus
                />
                {/* Validation Error */}
                {validationError && (
                  <div className="mb-2 rounded-md border border-red-700/40 bg-red-950/20 p-2">
                    <div className="text-xs text-red-300">⚠️ {validationError}</div>
                  </div>
                )}
                
                {/* Term Recognition Notice */}
                {termKnowledge && !validationError && (
                  <div className="mb-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
                    <div className="text-xs text-emerald-300">
                      ✅ {(termKnowledge as any).cfiItem 
                        ? `Recognized: ${(termKnowledge as any).cfiItem.label} - ${(termKnowledge as any).cfiItem.description}`
                        : (termKnowledge as any).cffItem
                        ? `Recognized: ${(termKnowledge as any).cffItem.label} - ${(termKnowledge as any).cffItem.description}`
                        : termKnowledge.cfsTreatment?.description || "Standard financial term"}
                    </div>
                  </div>
                )}
                
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddCustomItem}
                    disabled={!newItemLabel.trim() || (validationError && !termKnowledge) ? true : false}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddDialog(false);
                      setNewItemLabel("");
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

/**
 * Cash Flow Statement Builder Component
 */
export default function CashFlowBuilder() {
  const meta = useModelStore((s) => s.meta);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns);
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns || {});
  const danaLocation = useModelStore((s) => s.danaLocation);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const insertRow = useModelStore((s) => s.insertRow);
  const removeRow = useModelStore((s) => s.removeRow);
  
  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    return hist;
  }, [meta]);
  
  const allStatements = useMemo(() => ({
    incomeStatement,
    balanceSheet,
    cashFlow,
  }), [incomeStatement, balanceSheet, cashFlow]);
  
  // Analyze Balance Sheet items for CFO intelligence
  const cfoIntelligence = useMemo(() => {
    if (balanceSheet.length === 0 || years.length === 0) return [];
    return analyzeBSItemsForCFO(balanceSheet, years);
  }, [balanceSheet, years]);
  
  // Auto-add items that should be automatically added to CFO
  useEffect(() => {
    if (cfoIntelligence.length === 0) return;
    
    const operatingSection = CFS_SECTIONS.find(s => s.id === "operating");
    if (!operatingSection) return;
    
    // Find the index to insert before "other_operating" or "operating_cf"
    const otherOperatingIndex = cashFlow.findIndex(r => r.id === "other_operating");
    const operatingCfIndex = cashFlow.findIndex(r => r.id === "operating_cf");
    const insertIndex = otherOperatingIndex >= 0 ? otherOperatingIndex : 
                       operatingCfIndex >= 0 ? operatingCfIndex : 
                       cashFlow.length;
    
    // Auto-add items marked as "auto_add" that don't already exist
    cfoIntelligence.forEach(item => {
      if (item.treatment === "auto_add") {
        // Check if item already exists in CFS
        const exists = cashFlow.some(r => r.id === `cfo_${item.rowId}`);
        
        if (!exists) {
          const newRow: Row = {
            id: `cfo_${item.rowId}`, // Prefix to avoid conflicts
            label: `Change in ${item.label}`,
            kind: "calc", // Will be calculated from BS changes
            valueType: "currency",
            values: {},
            children: [],
            cfsLink: {
              section: "operating",
              cfsItemId: "other_operating",
              impact: item.impact,
              description: item.description,
            },
          };
          
          insertRow("cashFlow", insertIndex, newRow);
        }
      }
    });
  }, [cfoIntelligence, cashFlow, insertRow]);

  return (
    <CollapsibleSection
      sectionId="cash_flow_all"
      title="Cash Flow Statement Builder"
      description="Build your Cash Flow Statement with three main sections: Operating, Investing, and Financing activities. Many items link automatically to IS and BS."
      colorClass="purple"
      defaultExpanded={true}
    >
      <div className="space-y-6">
        {/* Operating Activities */}
        <CFSSectionComponent
          section={CFS_SECTIONS[0]}
          rows={cashFlow}
          years={years}
          meta={meta}
          updateRowValue={updateRowValue}
          insertRow={insertRow}
          removeRow={removeRow}
          incomeStatement={incomeStatement}
          sbcBreakdowns={sbcBreakdowns}
          allStatements={allStatements}
          cfoIntelligence={cfoIntelligence}
          balanceSheet={balanceSheet}
          danaBreakdowns={danaBreakdowns}
          danaLocation={danaLocation}
        />

        {/* Investing Activities */}
        <CFSSectionComponent
          section={CFS_SECTIONS[1]}
          rows={cashFlow}
          years={years}
          meta={meta}
          updateRowValue={updateRowValue}
          insertRow={insertRow}
          removeRow={removeRow}
          incomeStatement={incomeStatement}
          sbcBreakdowns={sbcBreakdowns}
          allStatements={allStatements}
          cfoIntelligence={[]}
          balanceSheet={balanceSheet}
          danaBreakdowns={danaBreakdowns}
          danaLocation={danaLocation}
        />

        {/* Financing Activities */}
        <CFSSectionComponent
          section={CFS_SECTIONS[2]}
          rows={cashFlow}
          years={years}
          meta={meta}
          updateRowValue={updateRowValue}
          insertRow={insertRow}
          removeRow={removeRow}
          incomeStatement={incomeStatement}
          sbcBreakdowns={sbcBreakdowns}
          allStatements={allStatements}
          cfoIntelligence={[]}
          balanceSheet={balanceSheet}
          danaBreakdowns={danaBreakdowns}
          danaLocation={danaLocation}
        />

        {/* Net Change in Cash */}
        {(() => {
          const netChangeCashRow = cashFlow.find(r => r.id === "net_change_cash");
          if (!netChangeCashRow) return null;
          
          return (
            <div className="rounded-lg border-2 border-purple-800/40 bg-purple-950/20 p-4 mt-6">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-bold text-purple-200">
                  Net Change in Cash
                </span>
                <span className="text-xs text-slate-400 italic">(Calculated: Operating + Investing + Financing)</span>
              </div>
              
              {/* Display calculated values for each year */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {years.map((year) => {
                  let computedValue: number;
                  try {
                    computedValue = computeRowValue(
                      netChangeCashRow,
                      year,
                      cashFlow,
                      cashFlow,
                      allStatements,
                      sbcBreakdowns,
                      danaBreakdowns
                    );
                  } catch {
                    computedValue = 0;
                  }
                  
                  const displayValue = storedToDisplay(computedValue, meta?.currencyUnit);
                  const unitLabel = getUnitLabel(meta?.currencyUnit);
                  
                  return (
                    <div key={year} className="flex flex-col">
                      <label className="text-xs text-purple-300/80 mb-1">
                        {year}
                      </label>
                      <div className="rounded-md border border-purple-700/40 bg-purple-950/40 px-2 py-1.5 text-sm font-semibold text-purple-200">
                        {computedValue !== 0 ? `${displayValue}${unitLabel ? ` ${unitLabel}` : ""}` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
    </CollapsibleSection>
  );
}
