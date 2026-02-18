"use client";

import React, { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { formatCurrencyDisplay, storedToDisplay, getUnitLabel, type CurrencyUnit } from "@/lib/currency-utils";
import { checkBalanceSheetBalance, computeRowValue, getTotalSbcForYear } from "@/lib/calculations";
import { findCFIItem } from "@/lib/cfi-intelligence";
import { findCFFItem } from "@/lib/cff-intelligence";

/**
 * Format a number for display in accounting format (negatives in parentheses)
 * Only used in Excel Preview
 */
function formatAccountingNumber(
  value: number,
  unit: CurrencyUnit,
  showDecimals: boolean = false
): string {
  if (value === 0) return "—";
  
  const displayValue = storedToDisplay(value, unit);
  const unitLabel = getUnitLabel(unit);
  const decimals = showDecimals ? 2 : 0;
  
  const formatted = Math.abs(displayValue).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  
  const formattedWithUnit = `${formatted}${unitLabel ? ` ${unitLabel}` : ""}`;
  
  // If negative, wrap in parentheses
  if (displayValue < 0) {
    return `(${formattedWithUnit})`;
  }
  
  return formattedWithUnit;
}

// Helper function to get CFO/CFI/CFF sign indicator — only line items get a sign; subtotals/totals get none
function getCFOSign(
  rowId: string,
  row?: Row,
  section?: "operating" | "investing" | "financing",
  parentId?: string
): string | null {
  // Subtotals/totals: no sign (user request)
  if (
    rowId === "operating_cf" ||
    rowId === "investing_cf" ||
    rowId === "financing_cf" ||
    rowId === "net_change_cash"
  ) {
    return null;
  }

  // CFO items (operating section)
  if (section === "operating") {
    // Standard CFO items with known signs
    if (rowId === "net_income" || rowId === "danda" || rowId === "sbc") {
      return "+";
    }
    if (rowId === "wc_change") {
      return "-";
    }
    if (rowId === "other_operating") {
      return "+";
    }

    // Working capital children: infer from label (asset increase = use of cash = -, liability increase = source = +)
    if (parentId === "wc_change" && row?.label) {
      const L = row.label.toLowerCase();
      if (
        L.includes("receivable") ||
        L.includes("inventory") ||
        L.includes("prepaid") ||
        L.includes("other current asset") ||
        L.includes("capitalized") ||
        L.includes("costs capitalized")
      ) {
        return "-";
      }
      if (
        L.includes("payable") ||
        L.includes("unearned") ||
        L.includes("other current liab") ||
        L.includes("deferred")
      ) {
        return "+";
      }
      // Default for WC component
      return "-";
    }

    // Custom operating items by label
    if (row?.label) {
      const L = row.label.toLowerCase();
      if ((L.includes("operating lease") && L.includes("liab")) || L.includes("lease liab")) return "-";
      if (L.includes("amortization of") || L.includes("amortization of costs")) return "+";
      if (L.includes("losses in strategic") || L.includes("losses in investment")) return "+";
    }

    // CFO intelligence items - check the impact
    if ((rowId.startsWith("cfo_") || row?.cfsLink?.section === "operating") && row?.cfsLink) {
      if (row.cfsLink.impact === "positive") return "+";
      if (row.cfsLink.impact === "negative") return "-";
      return "+";
    }
  }
  
  // CFI items (investing section)
  if (section === "investing") {
    // Standard CFI items by ID
    if (rowId === "capex") {
      return "-"; // CapEx is cash outflow
    }
    if (rowId === "other_investing") {
      return "+"; // Can be positive or negative, but shown as + (value itself can be negative)
    }
    
    // CFI items with cfsLink - check the impact
    if (row?.cfsLink && row.cfsLink.section === "investing") {
      if (row.cfsLink.impact === "positive") {
        return "+";
      } else if (row.cfsLink.impact === "negative") {
        return "-";
      }
    }
    
    // Try to match by label using CFI intelligence
    if (row?.label) {
      const cfiItem = findCFIItem(row.label);
      if (cfiItem) {
        return cfiItem.impact === "positive" ? "+" : "-";
      }
    }
  }
  
  // CFF items (financing section)
  if (section === "financing") {
    // Standard CFF items
    if (rowId === "debt_issuance" || rowId === "equity_issuance") {
      return "+"; // Issuances are cash inflows
    }
    if (rowId === "debt_repayment" || rowId === "dividends") {
      return "-"; // Repayments and dividends are cash outflows
    }
    
    // CFF items with cfsLink - check the impact
    if (row?.cfsLink && row.cfsLink.section === "financing") {
      if (row.cfsLink.impact === "positive") {
        return "+";
      } else if (row.cfsLink.impact === "negative") {
        return "-";
      }
    }
    
    // Try to match by label using CFF intelligence
    if (row?.label) {
      const cffItem = findCFFItem(row.label);
      if (cffItem) {
        return cffItem.impact === "positive" ? "+" : "-";
      }
    }
  }
  
  // Default: show + for unknown so every item has a sign
  return "+";
}

type FlattenOptions = { forStatement?: "income" | "balance" | "cashflow" };

function flattenRows(
  rows: Row[],
  depth = 0,
  expandedRows: Set<string> | null = null,
  options?: FlattenOptions
): Array<{ row: Row; depth: number; parentId?: string }> {
  const out: Array<{ row: Row; depth: number; parentId?: string }> = [];
  const forCashFlow = options?.forStatement === "cashflow";

  for (const r of rows) {
    // Skip EBITDA, EBITDA Margin, and SBC only for Income Statement (SBC stays in CFS)
    const labelLower = r.label.toLowerCase();
    const skipSbc =
      !forCashFlow &&
      (r.id === "sbc" ||
        labelLower.includes("stock-based compensation") ||
        labelLower.includes("stock based compensation") ||
        (labelLower.includes("sbc") && !labelLower.includes("sub")));
    if (
      r.id === "ebitda" ||
      r.id === "ebitda_margin" ||
      skipSbc
    ) {
      continue;
    }
    out.push({ row: r, depth });
    if (Array.isArray(r.children) && r.children.length > 0 && (expandedRows === null || expandedRows.has(r.id))) {
      const filteredChildren = r.children.filter((child) => {
        const childLabelLower = child.label.toLowerCase();
        const skipChildSbc =
          !forCashFlow &&
          (child.id === "sbc" ||
            childLabelLower.includes("stock-based compensation") ||
            childLabelLower.includes("stock based compensation") ||
            (childLabelLower.includes("sbc") && !childLabelLower.includes("sub")));
        return (
          child.id !== "ebitda" &&
          child.id !== "ebitda_margin" &&
          !skipChildSbc
        );
      });
      if (filteredChildren.length > 0) {
        out.push(
          ...flattenRows(filteredChildren, depth + 1, expandedRows, options).map((item) => ({
            ...item,
            parentId: r.id,
          }))
        );
      }
    }
  }
  return out;
}

// Helper function to get Balance Sheet category for a row based on its position relative to total rows
function getBSCategory(rowId: string, rows: Row[]): string | null {
  // Check if this is a total row - these don't belong to a category
  if (["total_assets", "total_liabilities", "total_liab_and_equity"].includes(rowId)) {
    return null;
  }
  
  const rowIndex = rows.findIndex(r => r.id === rowId);
  if (rowIndex === -1) return null;
  
  const totalCurrentAssetsIndex = rows.findIndex(r => r.id === "total_current_assets");
  const totalAssetsIndex = rows.findIndex(r => r.id === "total_assets");
  const totalCurrentLiabIndex = rows.findIndex(r => r.id === "total_current_liabilities");
  const totalLiabIndex = rows.findIndex(r => r.id === "total_liabilities");
  const totalEquityIndex = rows.findIndex(r => r.id === "total_equity");
  
  // Current Assets: before total_current_assets
  if (totalCurrentAssetsIndex >= 0 && rowIndex < totalCurrentAssetsIndex) {
    return "current_assets";
  }
  
  // Fixed Assets: after total_current_assets, before total_assets
  if (totalCurrentAssetsIndex >= 0 && totalAssetsIndex >= 0 && 
      rowIndex > totalCurrentAssetsIndex && rowIndex < totalAssetsIndex) {
    return "fixed_assets";
  }
  
  // Current Liabilities: after total_assets, before total_current_liabilities
  if (totalAssetsIndex >= 0 && totalCurrentLiabIndex >= 0 && 
      rowIndex > totalAssetsIndex && rowIndex < totalCurrentLiabIndex) {
    return "current_liabilities";
  }
  
  // Non-Current Liabilities: after total_current_liabilities, before total_liabilities
  if (totalCurrentLiabIndex >= 0 && totalLiabIndex >= 0 && 
      rowIndex > totalCurrentLiabIndex && rowIndex < totalLiabIndex) {
    return "non_current_liabilities";
  }
  
  // Equity: after total_liabilities, before total_equity
  if (totalLiabIndex >= 0 && totalEquityIndex >= 0 && 
      rowIndex > totalLiabIndex && rowIndex < totalEquityIndex) {
    return "equity";
  }
  
  return null;
}

// Helper component to render a statement table
function StatementTable({ 
  rows, 
  label, 
  years, 
  meta, 
  showDecimals, 
  expandedRows, 
  toggleRow,
  allStatements,
  sbcBreakdowns,
  danaBreakdowns
}: { 
  rows: Row[]; 
  label: string; 
  years: string[]; 
  meta: any; 
  showDecimals: boolean; 
  expandedRows: Set<string> | null; 
  toggleRow: (rowId: string) => void;
  allStatements?: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] };
  sbcBreakdowns?: Record<string, Record<string, number>>;
  danaBreakdowns?: Record<string, number>;
}) {
  const forStatement: FlattenOptions["forStatement"] =
    label === "Cash Flow Statement" ? "cashflow" : label === "Balance Sheet" ? "balance" : "income";
  const flat = useMemo(
    () => flattenRows(rows ?? [], 0, expandedRows, { forStatement }),
    [rows, expandedRows, forStatement]
  );
  const isBalanceSheet = label === "Balance Sheet";
  const isCashFlow = label === "Cash Flow Statement";

  // For Cash Flow Statement, detect section (use parent's section for child rows to avoid duplicate headers)
  // Section = by position only (and cfsLink), so preview exactly mirrors builder: CFI = capex..investing_cf only
  const getCFSSection = (
    rowId: string,
    rows: Row[],
    parentId?: string
  ): "operating" | "investing" | "financing" | null => {
    if (parentId) return getCFSSection(parentId, rows);
    const row = rows.find((r) => r.id === rowId);
    if (row?.cfsLink?.section) {
      return row.cfsLink.section as "operating" | "investing" | "financing";
    }
    // Only assign section by ID for the section total rows; everything else by position
    if (rowId === "operating_cf") return "operating";
    if (rowId === "investing_cf") return "investing";
    if (rowId === "financing_cf" || rowId === "net_change_cash") return "financing";
    const operatingEndIndex = rows.findIndex((r) => r.id === "operating_cf");
    const investingStartIndex = rows.findIndex((r) => r.id === "capex");
    const investingEndIndex = rows.findIndex((r) => r.id === "investing_cf");
    const financingStartIndex = rows.findIndex((r) => r.id === "debt_issuance");
    const financingEndIndex = rows.findIndex((r) => r.id === "financing_cf");
    const rowIndex = rows.findIndex((r) => r.id === rowId);
    if (rowIndex === -1) return null;
    if (operatingEndIndex >= 0 && rowIndex <= operatingEndIndex) return "operating";
    // Rows between operating_cf and capex → operating
    if (operatingEndIndex >= 0 && investingStartIndex >= 0 && rowIndex > operatingEndIndex && rowIndex < investingStartIndex) return "operating";
    const investingStart = investingStartIndex >= 0 ? investingStartIndex : operatingEndIndex + 1;
    if (investingEndIndex >= 0 && rowIndex >= investingStart && rowIndex <= investingEndIndex) return "investing";
    const financingStart = financingStartIndex >= 0 ? financingStartIndex : investingEndIndex + 1;
    if (financingEndIndex >= 0 && rowIndex >= financingStart && rowIndex <= financingEndIndex) return "financing";
    return "financing";
  };
  
  // For Balance Sheet, detect section changes (Assets, Liabilities, Equity)
  const getBSSection = (rowId: string, rows: Row[]): "assets" | "liabilities" | "equity" | null => {
    const totalAssetsIndex = rows.findIndex(r => r.id === "total_assets");
    const totalLiabIndex = rows.findIndex(r => r.id === "total_liabilities");
    const rowIndex = rows.findIndex(r => r.id === rowId);
    
    if (rowIndex === -1) return null;
    
    if (totalAssetsIndex >= 0 && rowIndex <= totalAssetsIndex) {
      return "assets";
    }
    if (totalLiabIndex >= 0 && rowIndex <= totalLiabIndex) {
      return "liabilities";
    }
    return "equity";
  };
  
  // Track section and category changes for Balance Sheet
  const categoryLabels: Record<string, string> = {
    current_assets: "Current assets",
    fixed_assets: "Fixed assets",
    current_liabilities: "Current liabilities",
    non_current_liabilities: "Non-current liabilities",
    equity: "Shareholders' equity",
  };

  return (
    <>
      {/* Statement Header */}
      <tr className="border-t-4 border-slate-700">
        <td colSpan={1 + years.length} className="px-3 py-3 bg-slate-900/50">
          <h3 className="text-sm font-bold text-slate-100">{label}</h3>
        </td>
      </tr>
      
      {/* Statement Rows */}
      {flat.map(({ row, depth, parentId }, flatIndex) => {
        const currentSection = isBalanceSheet ? getBSSection(row.id, rows) : isCashFlow ? getCFSSection(row.id, rows, parentId) : null;
        const currentCategory = isBalanceSheet ? getBSCategory(row.id, rows) : null;
        const prevRow = flatIndex > 0 ? flat[flatIndex - 1] : null;
        const prevSection =
          (isBalanceSheet || isCashFlow) && prevRow
            ? isBalanceSheet
              ? getBSSection(prevRow.row.id, rows)
              : getCFSSection(prevRow.row.id, rows, prevRow.parentId)
            : null;
        const prevCategory = isBalanceSheet && prevRow ? getBSCategory(prevRow.row.id, rows) : null;
        // Show section header only when section actually changes (prevSection !== currentSection). First row of CFS: prevSection is null, so show once.
        const isSectionStart = (isBalanceSheet || isCashFlow) && currentSection != null && currentSection !== prevSection;
        // Show category subtitle if: (1) category changed, or (2) it's the first category in a new section
        const isCategoryStart = isBalanceSheet && currentCategory && (currentCategory !== prevCategory || isSectionStart);
        
        const isInput = row.kind === "input";
        const isGrossMargin = row.id === "gross_margin";
        const isEbitMargin = row.id === "ebit_margin";
        const isNetIncomeMargin = row.id === "net_income_margin";
        const isMargin = isGrossMargin || isEbitMargin || isNetIncomeMargin;
        const isLink = row.excelFormula?.includes("!") || false;
        const hasChildren = Array.isArray(row.children) && row.children.length > 0;
        const isExpanded = expandedRows === null || expandedRows.has(row.id);
        
        const isSubtotal = row.kind === "subtotal" || row.kind === "total";
        const isCalculatedWithChildren = row.kind === "calc" && hasChildren;
        const isKeyCalculation = ["gross_profit", "ebitda", "ebit", "ebt", "net_income"].includes(row.id);
        const isBalanceSheetSubtotal = ["total_current_assets", "total_fixed_assets", "total_assets", "total_current_liabilities", "total_non_current_liabilities", "total_liabilities", "total_equity", "total_liab_and_equity"].includes(row.id);
        const isCFSSubtotal = ["operating_cf", "investing_cf", "financing_cf", "net_change_cash"].includes(row.id);
        const isParentSubtotal = (row.id === "rev" || row.id === "cogs" || row.id === "sga") && hasChildren;
        const hasTopBorder = isSubtotal || isCalculatedWithChildren || isKeyCalculation || isParentSubtotal || isBalanceSheetSubtotal || isCFSSubtotal;
        const shouldBeBold = isSubtotal || isKeyCalculation || isParentSubtotal || isCalculatedWithChildren || isBalanceSheetSubtotal || isCFSSubtotal;
        
        // Section colors for Balance Sheet (Assets = green, Liabilities = orange, Equity = purple)
        // Section colors for Cash Flow (Operating = blue, Investing = green, Financing = orange)
        const sectionColors: Record<string, { bg: string; text: string; border: string }> = {
          assets: { bg: "bg-green-950/20", text: "text-green-300", border: "border-green-700/30" },
          liabilities: { bg: "bg-orange-950/20", text: "text-orange-300", border: "border-orange-700/30" },
          equity: { bg: "bg-purple-950/20", text: "text-purple-300", border: "border-purple-700/30" },
          operating: { bg: "bg-blue-950/20", text: "text-blue-300", border: "border-blue-700/30" },
          investing: { bg: "bg-green-950/20", text: "text-green-300", border: "border-green-700/30" },
          financing: { bg: "bg-orange-950/20", text: "text-orange-300", border: "border-orange-700/30" },
        };
        
        // Category subtitle colors (same as section but lighter)
        const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
          current_assets: { bg: "bg-green-950/10", text: "text-green-400", border: "border-green-700/20" },
          fixed_assets: { bg: "bg-green-950/10", text: "text-green-400", border: "border-green-700/20" },
          current_liabilities: { bg: "bg-orange-950/10", text: "text-orange-400", border: "border-orange-700/20" },
          non_current_liabilities: { bg: "bg-orange-950/10", text: "text-orange-400", border: "border-orange-700/20" },
          equity: { bg: "bg-purple-950/10", text: "text-purple-400", border: "border-purple-700/20" },
        };
        
        const labelClass = isMargin
          ? "text-slate-400 italic text-[11px]"
          : shouldBeBold
          ? "text-slate-200 font-bold"
          : "text-slate-200";
        
        // Enhanced spacing for Balance Sheet subtotals (removed - Excel format doesn't need extra spacing)
        const isBSCategorySubtotal = isBalanceSheet && isBalanceSheetSubtotal && !["total_assets", "total_liabilities", "total_liab_and_equity"].includes(row.id);
        
        return (
          <React.Fragment key={`fragment-${row.id}-${flatIndex}`}>
            {/* Section Header for Balance Sheet (Assets, Liabilities, Shareholders' Equity) */}
            {/* Section Header for Cash Flow Statement (Operating, Investing, Financing) */}
            {isSectionStart && currentSection && (
              <tr key={`section-${currentSection}-${flatIndex}`} className="border-t-2 border-slate-600">
                <td colSpan={1 + years.length} className={`px-3 py-2.5 ${sectionColors[currentSection]?.bg || "bg-slate-900/50"}`}>
                  <div className={`text-sm font-semibold ${sectionColors[currentSection]?.text || "text-slate-300"} underline`}>
                    {currentSection === "assets" && "Assets"}
                    {currentSection === "liabilities" && "Liabilities"}
                    {currentSection === "equity" && "Shareholders' Equity"}
                    {currentSection === "operating" && "Operating Activities"}
                    {currentSection === "investing" && "Investing Activities"}
                    {currentSection === "financing" && "Financing Activities"}
                  </div>
                </td>
              </tr>
            )}
            
            {/* Category Subtitle for Balance Sheet (Current assets, Fixed assets, etc.) */}
            {isCategoryStart && currentCategory && (
              <tr key={`category-${currentCategory}-${flatIndex}`}>
                <td colSpan={1 + years.length} className={`px-3 py-1.5 ${categoryColors[currentCategory]?.bg || "bg-transparent"}`}>
                  <div className={`text-xs font-medium ${categoryColors[currentCategory]?.text || "text-slate-400"}`}>
                    {categoryLabels[currentCategory]}
                  </div>
                </td>
              </tr>
            )}
            
            {/* Main row */}
            <tr
            key={`${row.id}-${flatIndex}`} 
            className={`border-b border-slate-900 hover:bg-slate-900/40 ${hasTopBorder ? "border-t-2 border-slate-300" : ""} ${shouldBeBold && isBalanceSheet ? "bg-slate-800/30" : ""}`}
          >
            <td className={`px-3 py-2 ${labelClass} ${shouldBeBold && isBalanceSheet ? "bg-slate-800/20" : ""}`}>
              <div
                style={{
                  paddingLeft: isCashFlow && parentId === "wc_change" ? 28 : depth * 14,
                }}
                className="flex items-center gap-1"
              >
                {hasChildren ? (
                  <button
                    onClick={() => toggleRow(row.id)}
                    className="flex items-center justify-center w-4 h-4 text-slate-400 hover:text-slate-200 transition-colors"
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    <span className="text-[10px]">{isExpanded ? "▼" : "▶"}</span>
                  </button>
                ) : (
                  <span className="w-4" />
                )}
                {/* Show (+) or (-) for every CFS item */}
                {isCashFlow && (() => {
                  const cfsSection = getCFSSection(row.id, rows, parentId);
                  const sign = getCFOSign(row.id, row, cfsSection || undefined, parentId);
                  if (sign && (cfsSection === "operating" || cfsSection === "investing" || cfsSection === "financing")) {
                    return (
                      <span className={`text-sm font-semibold ${sign === "+" ? "text-green-400" : "text-red-400"}`}>
                        ({sign})
                      </span>
                    );
                  }
                  return null;
                })()}
                <span className="inline-block">
                  {row.label}
                </span>
              </div>
            </td>

            {years.map((y) => {
              // For calculated CFS items, use stored values (computed by recomputeCalculations)
              // Don't recompute here to avoid recursion - values should already be stored
              let storedValue = row.values?.[y] ?? 0;
              
              // FOR BALANCE SHEET TOTALS: ALWAYS RECALCULATE ON THE FLY
              // This ensures totals reflect ONLY items that are actually in the builder
              // When items are removed, totals must immediately reflect the change
              if (isBalanceSheet && (row.kind === "subtotal" || row.kind === "total" || isBalanceSheetSubtotal)) {
                // Always recalculate Balance Sheet totals to ensure they're accurate
                try {
                  storedValue = computeRowValue(row, y, rows, rows, allStatements, sbcBreakdowns, danaBreakdowns);
                } catch (e) {
                  // If recursion error, fall back to stored value
                  storedValue = row.values?.[y] ?? 0;
                }
              }
              // For CFS items that pull from IS/BS, the values should already be computed and stored
              // Only recompute if absolutely necessary and we can do it safely
              else if (isCashFlow && allStatements) {
                const isCalculatedCFSItem = row.kind === "calc" || 
                  ["operating_cf", "investing_cf", "financing_cf", "net_change_cash", "net_income", "danda", "sbc", "wc_change"].includes(row.id) ||
                  row.id.startsWith("cfo_");
                
                if (isCalculatedCFSItem) {
                  // For WC Change, historical years are input, projection years are calculated
                  if (row.id === "wc_change") {
                    const isHistorical = y.endsWith("A");
                    const isProjection = y.endsWith("E");
                    
                    if (isHistorical) {
                      // Historical year - use stored input value
                      storedValue = row.values?.[y] ?? 0;
                    } else if (isProjection) {
                      // Projection year - calculate from BS changes
                      // First try stored value (from recomputeCalculations), then compute if needed
                      if (row.values?.[y] !== undefined) {
                        storedValue = row.values[y];
                      } else {
                        try {
                          storedValue = computeRowValue(row, y, rows, rows, allStatements, sbcBreakdowns, danaBreakdowns);
                        } catch (e) {
                          storedValue = 0;
                        }
                      }
                    } else {
                      // Year format unclear - treat as input
                      storedValue = row.values?.[y] ?? 0;
                    }
                    } else {
                      // Use stored value first (should be there after recomputeCalculations)
                      // But also compute if value is 0 or undefined to ensure we show calculated values
                      if (row.values?.[y] !== undefined && row.values[y] !== 0) {
                        storedValue = row.values[y];
                      } else {
                        // Only compute if no stored value exists, but be very careful to avoid recursion
                        // For net_income, danda, sbc - these pull from IS/SBC/D&A breakdowns
                        if (row.id === "net_income") {
                          // Get from IS directly
                          const isRow = allStatements.incomeStatement.find(r => r.id === row.id);
                          if (isRow && isRow.values?.[y] !== undefined) {
                            storedValue = isRow.values[y];
                          }
                        } else if (row.id === "danda") {
                          // D&A is now a manual input in CFO - use stored value
                          storedValue = row.values?.[y] ?? 0;
                        } else if (row.id === "sbc" && sbcBreakdowns && allStatements) {
                          // Total SBC without double-counting (same logic as IS Total SBC row)
                          storedValue = getTotalSbcForYear(allStatements.incomeStatement, sbcBreakdowns, y);
                        } else {
                          // For other calculated items, try to compute (but this might cause recursion)
                          // Only do this as last resort
                          try {
                            storedValue = computeRowValue(row, y, rows, rows, allStatements, sbcBreakdowns, danaBreakdowns);
                          } catch (e) {
                            // If recursion error, just use 0
                            storedValue = 0;
                          }
                        }
                      }
                    }
                } else if (row.kind === "input") {
                  // For input items, use stored value
                  storedValue = row.values?.[y] ?? 0;
                }
              }
              
              const isCurrency = row.valueType === "currency";
              const isPercent = row.valueType === "percent";
              
              let display = "";
              if (typeof storedValue === "number") {
                if (storedValue === 0) {
                  display = "—";
                } else if (isCurrency && meta?.currencyUnit) {
                  display = formatAccountingNumber(storedValue, meta.currencyUnit, showDecimals);
                } else if (isPercent) {
                  // For percentages, show negatives in parentheses too
                  const absValue = Math.abs(storedValue);
                  display = storedValue < 0 ? `(${absValue.toFixed(2)}%)` : `${storedValue.toFixed(2)}%`;
                } else {
                  // For non-currency numbers, also use parentheses format
                  const decimals = showDecimals ? 2 : 0;
                  const absValue = Math.abs(storedValue);
                  const formatted = absValue.toLocaleString(undefined, {
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals,
                  });
                  display = storedValue < 0 ? `(${formatted})` : formatted;
                }
              }
              
              let cellClass = "text-right";
              if (isInput) {
                cellClass += " text-blue-400 font-medium";
              } else if (isLink) {
                cellClass += " text-green-400";
              } else if (isPercent) {
                cellClass += " text-slate-400";
              } else {
                cellClass += " text-slate-100";
              }
              
              if (isMargin) {
                cellClass += " italic text-[11px]";
              }
              
              if (shouldBeBold) {
                cellClass += " font-bold";
              }
              
              const isZero = typeof storedValue === "number" && storedValue === 0;
              // For subtotals and totals, always show the value (even if 0) to make them visible
              const isSubtotalOrTotal = row.kind === "subtotal" || row.kind === "total" || isBalanceSheetSubtotal || isCFSSubtotal;
              // For calculated CFS items, always show the value (even if 0) since they're auto-populated
              // WC Change is calculated for subsequent years, so include it
              const isCalculatedCFS = isCashFlow && (row.kind === "calc" || ["operating_cf", "investing_cf", "financing_cf", "net_change_cash", "net_income", "danda", "sbc", "wc_change"].includes(row.id));
              if (isZero && !isSubtotalOrTotal && !isCalculatedCFS) {
                cellClass += " text-slate-500";
              }
              
              // For subtotals/totals and calculated CFS items, show "0" or the calculated value, not "—"
              const displayValue = (isSubtotalOrTotal || isCalculatedCFS) && storedValue === 0 
                ? "0" 
                : (display || (isInput ? "" : "—"));
              
              return (
                <td key={`${row.id}-${y}`} className={`px-3 py-2 ${cellClass} ${shouldBeBold && isBalanceSheet ? "bg-slate-800/20" : ""}`}>
                  {displayValue}
                </td>
              );
            })}
          </tr>
          </React.Fragment>
        );
      })}

      {flat.length === 0 && (
        <tr>
          <td colSpan={Math.max(1, 1 + years.length)} className="px-3 py-8 text-center text-slate-500">
            No rows yet. Start building your {label.toLowerCase()} in the Builder Panel.
          </td>
        </tr>
      )}
    </>
  );
}

export default function ExcelPreview() {
  const meta = useModelStore((s) => s.meta);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns || {});
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns || {});
  const [showDecimals, setShowDecimals] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string> | null>(null);

  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    const proj = meta?.years?.projection ?? [];
    return [...hist, ...proj];
  }, [meta]);

  const toggleRow = (rowId: string) => {
    setExpandedRows((prev) => {
      if (prev === null) {
        const allRowsWithChildren = new Set<string>();
        const findRowsWithChildren = (rows: Row[]) => {
          for (const r of rows) {
            if (Array.isArray(r.children) && r.children.length > 0) {
              allRowsWithChildren.add(r.id);
              findRowsWithChildren(r.children);
            }
          }
        };
        findRowsWithChildren(incomeStatement ?? []);
        findRowsWithChildren(balanceSheet ?? []);
        findRowsWithChildren(cashFlow ?? []);
        const next = new Set(allRowsWithChildren);
        next.delete(rowId);
        return next;
      }
      
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  // Calculate total rows for display (use same flatten options as StatementTable so CFS includes SBC)
  const totalRows = useMemo(() => {
    const isFlat = flattenRows(incomeStatement ?? [], 0, expandedRows, { forStatement: "income" });
    const bsFlat = flattenRows(balanceSheet ?? [], 0, expandedRows, { forStatement: "balance" });
    const cfsFlat = flattenRows(cashFlow ?? [], 0, expandedRows, { forStatement: "cashflow" });
    return isFlat.length + bsFlat.length + cfsFlat.length;
  }, [incomeStatement, balanceSheet, cashFlow, expandedRows]);

  return (
    <section className="h-full w-full rounded-xl border border-slate-800 bg-slate-950/50 flex flex-col overflow-hidden">
      {/* Header - Fixed */}
      <div className="flex-shrink-0 p-4 pb-2 border-b border-slate-800">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Real-time Excel Preview</h2>
            <p className="text-xs text-slate-500">
              <span className="text-slate-300">{meta?.companyName ?? "—"}</span> ·{" "}
              <span className="text-slate-300 capitalize">{meta?.companyType ?? "—"}</span> ·{" "}
              <span className="text-slate-300 uppercase">{meta?.modelType ?? "—"}</span> ·{" "}
              <span className="text-slate-300">{meta?.currency ?? "—"}</span>
              {meta?.currencyUnit && (
                <> · <span className="text-slate-300">({getUnitLabel(meta.currencyUnit) || meta.currencyUnit})</span></>
              )}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showDecimals}
                onChange={(e) => setShowDecimals(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900"
              />
              <span>Show decimals</span>
            </label>
            <button
              onClick={() => {
                if (expandedRows === null) {
                  setExpandedRows(new Set());
                } else {
                  setExpandedRows(null);
                }
              }}
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded border border-slate-700 hover:border-slate-600 transition-colors"
              title={expandedRows === null ? "Collapse all" : "Expand all"}
            >
              {expandedRows === null ? "Collapse All" : "Expand All"}
            </button>
            <div className="text-xs text-slate-500">
              Rows: <span className="text-slate-300">{totalRows}</span> · Years:{" "}
              <span className="text-slate-300">{years.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Table - Scrollable */}
      <div className="flex-1 overflow-y-auto overflow-x-auto p-4">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-950 z-10">
            <tr className="border-b border-slate-800">
              <th className="w-[280px] px-3 py-2 text-left font-semibold text-slate-300">
                Line Item
              </th>
              {years.map((y) => (
                <th key={y} className="px-3 py-2 text-right font-semibold text-slate-400">
                  {y}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {/* Income Statement */}
            <StatementTable
              rows={incomeStatement.filter(r => 
                r.id !== "ebitda" && 
                r.id !== "ebitda_margin" && 
                r.id !== "sbc" &&
                !r.label.toLowerCase().includes("stock-based compensation") &&
                !r.label.toLowerCase().includes("stock based compensation") &&
                !r.label.toLowerCase().includes("sbc")
              )}
              label="Income Statement"
              years={years}
              meta={meta}
              showDecimals={showDecimals}
              expandedRows={expandedRows}
              toggleRow={toggleRow}
              allStatements={{ incomeStatement, balanceSheet, cashFlow }}
              sbcBreakdowns={sbcBreakdowns}
              danaBreakdowns={danaBreakdowns}
            />

            {/* Stock-Based Compensation Disclosure */}
            {(() => {
              const sgaRow = incomeStatement.find((r) => r.id === "sga");
              const cogsRow = incomeStatement.find((r) => r.id === "cogs");
              const sgaBreakdowns = sgaRow?.children ?? [];
              const cogsBreakdowns = cogsRow?.children ?? [];
              const hasSgaBreakdowns = sgaBreakdowns.length > 0;
              const hasCogsBreakdowns = cogsBreakdowns.length > 0;
              
              // Check if there's any SBC data
              let hasAnySbc = false;
              years.forEach((y) => {
                if (hasSgaBreakdowns) {
                  sgaBreakdowns.forEach((b) => {
                    if (sbcBreakdowns[b.id]?.[y]) hasAnySbc = true;
                  });
                } else {
                  if (sbcBreakdowns["sga"]?.[y]) hasAnySbc = true;
                }
                if (hasCogsBreakdowns) {
                  cogsBreakdowns.forEach((b) => {
                    if (sbcBreakdowns[b.id]?.[y]) hasAnySbc = true;
                  });
                } else {
                  if (sbcBreakdowns["cogs"]?.[y]) hasAnySbc = true;
                }
              });
              
              if (!hasAnySbc) return null;
              
              return (
                <>
                  {/* SBC Header */}
                  <tr className="border-t-4 border-amber-700/50">
                    <td colSpan={1 + years.length} className="px-3 py-3 bg-amber-950/30">
                      <h3 className="text-sm font-bold text-amber-200">Stock-Based Compensation Expense</h3>
                      <p className="text-[10px] text-amber-300/70 italic mt-1">
                        Amounts include stock-based compensation expense, as follows:
                      </p>
                    </td>
                  </tr>
                  
                  {/* COGS SBC */}
                  {hasCogsBreakdowns ? (
                    cogsBreakdowns.map((breakdown) => {
                      const breakdownSbc = years.map((y) => sbcBreakdowns[breakdown.id]?.[y] ?? 0);
                      const hasAnySbc = breakdownSbc.some(v => v !== 0);
                      if (!hasAnySbc) return null;
                      
                      return (
                        <tr key={breakdown.id} className="border-b border-amber-900/30 bg-amber-950/10">
                          <td className="px-3 py-1.5 text-amber-300/90" style={{ paddingLeft: '24px' }}>
                            Cost of revenues — {breakdown.label}
                          </td>
                          {years.map((y) => {
                            const value = sbcBreakdowns[breakdown.id]?.[y] ?? 0;
                            return (
                              <td key={y} className="px-3 py-1.5 text-right text-amber-200/90">
                                {formatAccountingNumber(value, meta.currencyUnit, showDecimals)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    }).filter(Boolean)
                  ) : (() => {
                    const cogsSbc = years.map((y) => sbcBreakdowns["cogs"]?.[y] ?? 0);
                    const hasAnySbc = cogsSbc.some(v => v !== 0);
                    if (!hasAnySbc) return null;
                    
                    return (
                      <tr className="border-b border-amber-900/30 bg-amber-950/10">
                        <td className="px-3 py-1.5 text-amber-300/90" style={{ paddingLeft: '24px' }}>
                          Cost of revenues
                        </td>
                        {years.map((y) => {
                          const value = sbcBreakdowns["cogs"]?.[y] ?? 0;
                          return (
                            <td key={y} className="px-3 py-1.5 text-right text-amber-200/90">
                              {formatAccountingNumber(value, meta.currencyUnit, showDecimals)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })()}

                  {/* SG&A SBC */}
                  {hasSgaBreakdowns ? (
                    sgaBreakdowns.map((breakdown) => {
                      const breakdownSbc = years.map((y) => sbcBreakdowns[breakdown.id]?.[y] ?? 0);
                      const hasAnySbc = breakdownSbc.some(v => v !== 0);
                      if (!hasAnySbc) return null;
                      
                      return (
                        <tr key={breakdown.id} className="border-b border-amber-900/30 bg-amber-950/10">
                          <td className="px-3 py-1.5 text-amber-300/90" style={{ paddingLeft: '24px' }}>
                            {breakdown.label}
                          </td>
                          {years.map((y) => {
                            const value = sbcBreakdowns[breakdown.id]?.[y] ?? 0;
                            return (
                              <td key={y} className="px-3 py-1.5 text-right text-amber-200/90">
                                {formatAccountingNumber(value, meta.currencyUnit, showDecimals)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    }).filter(Boolean)
                  ) : (() => {
                    const sgaSbc = years.map((y) => sbcBreakdowns["sga"]?.[y] ?? 0);
                    const hasAnySbc = sgaSbc.some(v => v !== 0);
                    if (!hasAnySbc) return null;
                    
                    return (
                      <tr className="border-b border-amber-900/30 bg-amber-950/10">
                        <td className="px-3 py-1.5 text-amber-300/90" style={{ paddingLeft: '24px' }}>
                          Selling, General & Administrative
                        </td>
                        {years.map((y) => {
                          const value = sbcBreakdowns["sga"]?.[y] ?? 0;
                          return (
                            <td key={y} className="px-3 py-1.5 text-right text-amber-200/90">
                              {formatAccountingNumber(value, meta.currencyUnit, showDecimals)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })()}

                  {/* Total SBC Row */}
                  {(() => {
                    const totalSbcByYear = years.map((y) => {
                      let total = 0;
                      if (hasSgaBreakdowns) {
                        sgaBreakdowns.forEach((b) => {
                          total += sbcBreakdowns[b.id]?.[y] ?? 0;
                        });
                      } else {
                        total += sbcBreakdowns["sga"]?.[y] ?? 0;
                      }
                      if (hasCogsBreakdowns) {
                        cogsBreakdowns.forEach((b) => {
                          total += sbcBreakdowns[b.id]?.[y] ?? 0;
                        });
                      } else {
                        total += sbcBreakdowns["cogs"]?.[y] ?? 0;
                      }
                      return total;
                    });
                    
                    const hasAnySbc = totalSbcByYear.some(v => v !== 0);
                    if (!hasAnySbc) return null;
                    
                    return (
                      <tr className="border-t-2 border-amber-700/50 bg-amber-950/30">
                        <td className="px-3 py-2 font-semibold text-amber-200">
                          Total stock-based compensation expense
                        </td>
                        {years.map((y, idx) => {
                          const value = totalSbcByYear[idx];
                          return (
                            <td key={y} className="px-3 py-2 text-right font-semibold text-amber-100">
                              {formatAccountingNumber(value, meta.currencyUnit, showDecimals)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })()}
                </>
              );
            })()}

            {/* Balance Sheet */}
            {balanceSheet && balanceSheet.length > 0 && (
              <>
                <StatementTable
                  rows={balanceSheet}
                  label="Balance Sheet"
                  years={years}
                  meta={meta}
                  showDecimals={showDecimals}
                  expandedRows={expandedRows}
                  toggleRow={toggleRow}
                  allStatements={{ incomeStatement, balanceSheet, cashFlow }}
                  sbcBreakdowns={sbcBreakdowns}
                  danaBreakdowns={danaBreakdowns}
                />
                
                {/* Balance Check */}
                {(() => {
                  const balanceCheck = checkBalanceSheetBalance(balanceSheet, years);
                  const allBalanced = balanceCheck.every(b => b.balances);
                  const hasAnyData = balanceCheck.some(b => b.totalAssets !== 0 || b.totalLiabAndEquity !== 0);
                  
                  if (!hasAnyData) return null;
                  
                  return (
                    <>
                      {/* Spacing */}
                      <tr>
                        <td colSpan={1 + years.length} className="h-4 bg-transparent"></td>
                      </tr>
                      
                      {/* Balance Check Header */}
                      <tr className={`border-t-4 ${allBalanced ? "border-emerald-600" : "border-red-600"}`}>
                        <td colSpan={1 + years.length} className={`px-3 py-3 ${allBalanced ? "bg-emerald-950/30" : "bg-red-950/30"}`}>
                          <div className="flex items-center gap-2">
                            <span className={`text-lg ${allBalanced ? "text-emerald-400" : "text-red-400"}`}>
                              {allBalanced ? "✓" : "✗"}
                            </span>
                            <h3 className={`text-sm font-bold ${allBalanced ? "text-emerald-200" : "text-red-200"}`}>
                              Balance Check: {allBalanced ? "BALANCED" : "OUT OF BALANCE"}
                            </h3>
                          </div>
                          <p className={`text-xs mt-1 ${allBalanced ? "text-emerald-300/80" : "text-red-300/80"}`}>
                            {allBalanced 
                              ? "Total Assets = Total Liabilities + Total Equity ✓" 
                              : "⚠️ Total Assets ≠ Total Liabilities + Total Equity. Please review your inputs."}
                          </p>
                        </td>
                      </tr>
                      
                      {/* Balance Check Details */}
                      <tr className={`border-b-2 ${allBalanced ? "border-emerald-700/50" : "border-red-700/50"}`}>
                        <td className={`px-3 py-2 font-semibold ${allBalanced ? "text-emerald-200" : "text-red-200"}`}>
                          Total Assets
                        </td>
                        {years.map((y) => {
                          const check = balanceCheck.find(b => b.year === y);
                          if (!check) return <td key={y} className="px-3 py-2"></td>;
                          return (
                            <td key={y} className={`px-3 py-2 text-right font-semibold ${allBalanced ? "text-emerald-100" : "text-red-100"}`}>
                              {formatAccountingNumber(check.totalAssets, meta.currencyUnit, showDecimals)}
                            </td>
                          );
                        })}
                      </tr>
                      
                      <tr className={`border-b ${allBalanced ? "border-emerald-800/30" : "border-red-800/30"}`}>
                        <td className={`px-3 py-2 font-semibold ${allBalanced ? "text-emerald-200" : "text-red-200"}`}>
                          Total Liabilities + Equity
                        </td>
                        {years.map((y) => {
                          const check = balanceCheck.find(b => b.year === y);
                          if (!check) return <td key={y} className="px-3 py-2"></td>;
                          return (
                            <td key={y} className={`px-3 py-2 text-right font-semibold ${allBalanced ? "text-emerald-100" : "text-red-100"}`}>
                              {formatAccountingNumber(check.totalLiabAndEquity, meta.currencyUnit, showDecimals)}
                            </td>
                          );
                        })}
                      </tr>
                      
                      {/* Difference Row - only show if not balanced */}
                      {!allBalanced && (
                        <tr className="border-b-2 border-red-700/50 bg-red-950/20">
                          <td className="px-3 py-2 font-bold text-red-300">
                            Difference (Out of Balance)
                          </td>
                          {years.map((y) => {
                            const check = balanceCheck.find(b => b.year === y);
                            if (!check || check.balances) return <td key={y} className="px-3 py-2"></td>;
                            return (
                              <td key={y} className="px-3 py-2 text-right font-bold text-red-200">
                                {formatAccountingNumber(check.difference, meta.currencyUnit, showDecimals)}
                              </td>
                            );
                          })}
                        </tr>
                      )}
                    </>
                  );
                })()}
              </>
            )}

            {/* Cash Flow Statement */}
            {cashFlow && cashFlow.length > 0 && (
              <StatementTable
                rows={cashFlow}
                label="Cash Flow Statement"
                years={years}
                meta={meta}
                showDecimals={showDecimals}
                expandedRows={expandedRows}
                toggleRow={toggleRow}
                allStatements={{ incomeStatement, balanceSheet, cashFlow }}
                sbcBreakdowns={sbcBreakdowns}
                danaBreakdowns={danaBreakdowns}
              />
            )}

            {years.length === 0 && (
              <tr>
                <td colSpan={1} className="px-3 py-8 text-center text-slate-500">
                  No years found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
