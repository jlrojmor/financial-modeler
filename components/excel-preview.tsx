"use client";

import React, { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { formatCurrencyDisplay, storedToDisplay, displayToStored, getUnitLabel, type CurrencyUnit } from "@/lib/currency-utils";
import { checkBalanceSheetBalance, computeRowValue, getTotalSbcForYear } from "@/lib/calculations";
import { computeRevenueProjections } from "@/lib/revenue-projection-engine";
import {
  getWcScheduleItems,
  computeWcProjectedBalances,
  type WcDriverState,
} from "@/lib/working-capital-schedule";
import {
  computeCapexDaSchedule,
  computeCapexDaScheduleByBucket,
  computeProjectedCapexByYear,
} from "@/lib/capex-da-engine";
import { findCFIItem } from "@/lib/cfi-intelligence";
import { findCFFItem } from "@/lib/cff-intelligence";

const CAPEX_DEFAULT_BUCKET_IDS_PREVIEW = ["cap_b1", "cap_b2", "cap_b3", "cap_b4", "cap_b5", "cap_b6", "cap_b7", "cap_b8", "cap_b9", "cap_b10"];
const CAPEX_DEFAULT_BUCKET_LABELS_PREVIEW: Record<string, string> = {
  cap_b1: "Land",
  cap_b2: "Buildings & Improvements",
  cap_b3: "Machinery & Equipment",
  cap_b4: "Computer Hardware",
  cap_b5: "Software (Capitalized)",
  cap_b6: "Furniture & Fixtures",
  cap_b7: "Leasehold Improvements",
  cap_b8: "Vehicles",
  cap_b9: "Construction in Progress (CIP)",
  cap_b10: "Other PP&E",
};

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
  options?: FlattenOptions,
  parentId?: string
): Array<{ row: Row; depth: number; parentId?: string }> {
  const out: Array<{ row: Row; depth: number; parentId?: string }> = [];
  const forCashFlow = options?.forStatement === "cashflow";
  const forIncome = options?.forStatement === "income";

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
    out.push({ row: r, depth, parentId });
    // INCOME STATEMENT: do not expand children of SG&A in the main preview. Historicals show R&D, Sales & Marketing, etc. as single lines with the user's fixed values; IS Build breakdown (e.g. R&D → 1, 2) must not appear here.
    const skipExpandUnderSga = forIncome && parentId === "sga";
    if (skipExpandUnderSga) {
      // Show this row only; do not recurse into its children
    } else if (Array.isArray(r.children) && r.children.length > 0 && (expandedRows === null || expandedRows.has(r.id))) {
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
          ...flattenRows(filteredChildren, depth + 1, expandedRows, options, r.id).map((item) => ({
            ...item,
            parentId: item.parentId ?? r.id,
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
  danaBreakdowns,
  projectedRevenue,
  projectedCogs,
  projectedCogsByCogsChild,
  projectedSgaBySgaChild,
  getYearCellClassName,
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
  /** For Income Statement: rev and its direct children use this for projection years (sum of IS Build breakdowns). */
  projectedRevenue?: Record<string, Record<string, number>>;
  /** For Income Statement: total COGS per projection year from revenue × COGS % per line. */
  projectedCogs?: Record<string, number>;
  /** For Income Statement: projected COGS per fixed/mother child row (stream-level from IS Build). */
  projectedCogsByCogsChild?: Record<string, Record<string, number>>;
  /** For Income Statement: projected SG&A per fixed category (sum of IS Build for that row + breakdown). */
  projectedSgaBySgaChild?: Record<string, Record<string, number>>;
  /** Optional: class for each year column (e.g. text-blue-400 for actuals, bg for projections). Used in BS Build preview. */
  getYearCellClassName?: (y: string) => string;
}) {
  const forStatement: FlattenOptions["forStatement"] =
    label === "Cash Flow Statement" ? "cashflow" : label === "Balance Sheet" ? "balance" : "income";
  const flat = useMemo(
    () => flattenRows(rows ?? [], 0, expandedRows, { forStatement }),
    [rows, expandedRows, forStatement]
  );
  const isBalanceSheet = label === "Balance Sheet";
  const isCashFlow = label === "Cash Flow Statement";
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const toggleSectionCollapsed = (section: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const toggleCategoryCollapsed = (category: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

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
        const isSectionCollapsed =
          isBalanceSheet && currentSection ? collapsedSections[currentSection] === true : false;
        const isCategoryCollapsed =
          isBalanceSheet && currentCategory ? collapsedCategories[currentCategory] === true : false;
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

        // For Balance Sheet: when a main section (Assets, Liabilities, Equity) is collapsed,
        // keep only the key totals visible. For category collapse, keep category subtotal.
        const keepWhenSectionCollapsed =
          isBalanceSheet &&
          (row.id === "total_assets" ||
            row.id === "total_liabilities" ||
            row.id === "total_liab_and_equity" ||
            isBalanceSheetSubtotal);
        const shouldHideForSectionCollapse = isBalanceSheet && isSectionCollapsed && !keepWhenSectionCollapsed;
        const shouldHideForCategoryCollapse =
          isBalanceSheet && isCategoryCollapsed && !isBalanceSheetSubtotal;
        const shouldHideRow = shouldHideForSectionCollapse || shouldHideForCategoryCollapse;
        
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
          <>
            {/* Section Header for Balance Sheet (Assets, Liabilities, Shareholders' Equity) */}
            {/* Section Header for Cash Flow Statement (Operating, Investing, Financing) */}
            {isSectionStart && currentSection && (
              <tr key={`section-${currentSection}-${flatIndex}`} className="border-t-2 border-slate-600">
                <td colSpan={1 + years.length} className={`px-3 py-2.5 ${sectionColors[currentSection]?.bg || "bg-slate-900/50"}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isBalanceSheet && currentSection) {
                        toggleSectionCollapsed(currentSection);
                      }
                    }}
                    className={`w-full flex items-center justify-start gap-2 text-sm font-semibold ${sectionColors[currentSection]?.text || "text-slate-300"} underline`}
                  >
                    {isBalanceSheet && (
                      <span className="text-[11px] w-10 text-left">
                        {isSectionCollapsed ? "▶" : "▼"}
                      </span>
                    )}
                    <span>
                      {currentSection === "assets" && "Assets"}
                      {currentSection === "liabilities" && "Liabilities"}
                      {currentSection === "equity" && "Shareholders' Equity"}
                      {currentSection === "operating" && "Operating Activities"}
                      {currentSection === "investing" && "Investing Activities"}
                      {currentSection === "financing" && "Financing Activities"}
                    </span>
                  </button>
                </td>
              </tr>
            )}
            
            {/* Category Subtitle for Balance Sheet (Current assets, Fixed assets, etc.) */}
            {isCategoryStart && currentCategory && (
              <tr key={`category-${currentCategory}-${flatIndex}`}>
                <td colSpan={1 + years.length} className={`px-3 py-1.5 ${categoryColors[currentCategory]?.bg || "bg-transparent"}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isBalanceSheet && currentCategory) {
                        toggleCategoryCollapsed(currentCategory);
                      }
                    }}
                    className={`w-full flex items-center justify-start gap-2 text-xs font-medium ${categoryColors[currentCategory]?.text || "text-slate-400"}`}
                  >
                    <span className="text-[10px] w-8 text-left">
                      {isCategoryCollapsed ? "▶" : "▼"}
                    </span>
                    <span>{categoryLabels[currentCategory]}</span>
                  </button>
                </td>
              </tr>
            )}
            
            {/* Main row */}
            {!shouldHideRow && (
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
              
              // INCOME STATEMENT REVENUE: projection years use engine (sum of IS Build breakdowns per stream)
              const isProjectionYear = y.endsWith("E");
              const isRevenueRow = label === "Income Statement" && (row.id === "rev" || parentId === "rev");
              if (label === "Income Statement" && projectedRevenue && isProjectionYear && isRevenueRow) {
                storedValue = projectedRevenue[row.id]?.[y] ?? storedValue;
              }
              // INCOME STATEMENT COGS: projection years use revenue × COGS % per line when projectedCogs is set
              if (label === "Income Statement" && row.id === "cogs" && isProjectionYear && projectedCogs?.[y] != null) {
                storedValue = projectedCogs[y];
              }
              // INCOME STATEMENT COGS CHILDREN (fixed/mother): use IS Build stream-level projection only
              if (
                label === "Income Statement" &&
                parentId === "cogs" &&
                isProjectionYear &&
                projectedCogsByCogsChild?.[row.id]?.[y] != null
              ) {
                storedValue = projectedCogsByCogsChild[row.id][y];
              }
              // INCOME STATEMENT SG&A FIXED CATEGORIES: projection years use IS Build totals (row + breakdown)
              if (
                label === "Income Statement" &&
                parentId === "sga" &&
                isProjectionYear &&
                projectedSgaBySgaChild?.[row.id]?.[y] != null
              ) {
                storedValue = projectedSgaBySgaChild[row.id][y];
              }
              // INCOME STATEMENT TOTAL SG&A: projection years = sum of fixed categories from IS Build
              if (
                label === "Income Statement" &&
                row.id === "sga" &&
                isProjectionYear &&
                projectedSgaBySgaChild != null
              ) {
                const sgaChildIds = Object.keys(projectedSgaBySgaChild);
                if (sgaChildIds.length > 0) {
                  let total = 0;
                  for (const childId of sgaChildIds) {
                    total += projectedSgaBySgaChild[childId]?.[y] ?? 0;
                  }
                  storedValue = total;
                }
              }
              // INCOME STATEMENT GROSS PROFIT / GROSS MARGIN: use computed values when we have projectedCogs
              if (label === "Income Statement" && isProjectionYear && projectedRevenue && projectedCogs?.[y] != null) {
                const rev = projectedRevenue["rev"]?.[y] ?? 0;
                const cogs = projectedCogs[y];
                if (row.id === "gross_profit") storedValue = rev - cogs;
                if (row.id === "gross_margin") storedValue = rev > 0 ? ((rev - cogs) / rev) * 100 : 0;
              }
              // INCOME STATEMENT EBIT & EBIT MARGIN: projection years = Gross Profit - SG&A, then EBIT/Revenue
              if (label === "Income Statement" && isProjectionYear && projectedRevenue && projectedCogs?.[y] != null) {
                const rev = projectedRevenue["rev"]?.[y] ?? 0;
                const cogs = projectedCogs[y];
                const grossProfit = rev - cogs;
                let sgaTotal = 0;
                if (projectedSgaBySgaChild && Object.keys(projectedSgaBySgaChild).length > 0) {
                  for (const childId of Object.keys(projectedSgaBySgaChild)) {
                    sgaTotal += projectedSgaBySgaChild[childId]?.[y] ?? 0;
                  }
                }
                const ebit = grossProfit - sgaTotal;
                if (row.id === "ebit") storedValue = ebit;
                if (row.id === "ebit_margin") storedValue = rev > 0 ? (ebit / rev) * 100 : 0;
              }
              
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
                <td key={`${row.id}-${y}`} className={`px-3 py-2 ${cellClass} ${getYearCellClassName?.(y) ?? ""} ${shouldBeBold && isBalanceSheet ? "bg-slate-800/20" : ""}`}>
                  {displayValue}
                </td>
              );
            })}
          </tr>
            )}
          </>
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

type ExcelPreviewProps = {
  /** Optional: focus on a single statement ('all' = IS+BS+CFS, 'balance' = Balance Sheet only) */
  focusStatement?: "all" | "balance";
};

export default function ExcelPreview({ focusStatement = "all" }: ExcelPreviewProps) {
  const meta = useModelStore((s) => s.meta);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns || {});
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns || {});
  const revenueProjectionConfig = useModelStore((s) => s.revenueProjectionConfig);
  const cogsPctByRevenueLine = useModelStore((s) => s.cogsPctByRevenueLine ?? {});
  const cogsPctModeByRevenueLine = useModelStore((s) => s.cogsPctModeByRevenueLine ?? {});
  const cogsPctByRevenueLineByYear = useModelStore((s) => s.cogsPctByRevenueLineByYear ?? {});
  const sgaPctByItemId = useModelStore((s) => s.sgaPctByItemId ?? {});
  const sgaPctModeByItemId = useModelStore((s) => s.sgaPctModeByItemId ?? {});
  const sgaPctByItemIdByYear = useModelStore((s) => s.sgaPctByItemIdByYear ?? {});
  const sgaPctOfParentByItemId = useModelStore((s) => s.sgaPctOfParentByItemId ?? {});
  const sgaPctOfParentModeByItemId = useModelStore((s) => s.sgaPctOfParentModeByItemId ?? {});
  const sgaPctOfParentByItemIdByYear = useModelStore((s) => s.sgaPctOfParentByItemIdByYear ?? {});
  const wcDriverTypeByItemId = useModelStore((s) => s.wcDriverTypeByItemId ?? {});
  const wcDaysByItemId = useModelStore((s) => s.wcDaysByItemId ?? {});
  const wcDaysByItemIdByYear = useModelStore((s) => s.wcDaysByItemIdByYear ?? {});
  const wcDaysBaseByItemId = useModelStore((s) => s.wcDaysBaseByItemId ?? {});
  const wcPctBaseByItemId = useModelStore((s) => s.wcPctBaseByItemId ?? {});
  const wcPctByItemId = useModelStore((s) => s.wcPctByItemId ?? {});
  const wcPctByItemIdByYear = useModelStore((s) => s.wcPctByItemIdByYear ?? {});
  const capexForecastMethod = useModelStore((s) => s.capexForecastMethod ?? "pct_revenue");
  const capexPctRevenue = useModelStore((s) => s.capexPctRevenue ?? 0);
  const capexManualByYear = useModelStore((s) => s.capexManualByYear ?? {});
  const capexGrowthPct = useModelStore((s) => s.capexGrowthPct ?? 0);
  const capexTimingConvention = useModelStore((s) => s.capexTimingConvention ?? "mid");
  const capexSplitByBucket = useModelStore((s) => s.capexSplitByBucket ?? true);
  const capexCustomBucketIds = useModelStore((s) => s.capexCustomBucketIds ?? []);
  const ppeUsefulLifeByBucket = useModelStore((s) => s.ppeUsefulLifeByBucket ?? {});
  const ppeUsefulLifeSingle = useModelStore((s) => s.ppeUsefulLifeSingle ?? 10);
  const capexBucketAllocationPct = useModelStore((s) => s.capexBucketAllocationPct ?? {});
  const capexBucketLabels = useModelStore((s) => s.capexBucketLabels ?? {});
  const capexIncludeInAllocationByBucket = useModelStore((s) => s.capexIncludeInAllocationByBucket ?? {});
  const capexHelperPpeByBucketByYear = useModelStore((s) => s.capexHelperPpeByBucketByYear ?? {});
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

  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const isProjectionYear = (y: string) => y.endsWith("E") || projectionYears.includes(y);
  const isFirstProjectionYear = (y: string) => projectionYears[0] === y;
  const yearColClass = (base: string) => (y: string) =>
    [
      base,
      isProjectionYear(y) ? "bg-slate-800/60" : "!text-blue-400",
      isFirstProjectionYear(y) ? "border-l-2 border-amber-500/70" : "",
    ]
      .filter(Boolean)
      .join(" ");
  const lastHistoricYear = useMemo(
    () => (meta?.years?.historical ?? [])[(meta?.years?.historical ?? []).length - 1] ?? "",
    [meta]
  );
  const allStatementsForProj = useMemo(
    () => ({
      incomeStatement: incomeStatement ?? [],
      balanceSheet: balanceSheet ?? [],
      cashFlow: cashFlow ?? [],
    }),
    [incomeStatement, balanceSheet, cashFlow]
  );
  const projectedRevenue = useMemo(() => {
    if (!incomeStatement?.length || !revenueProjectionConfig?.items || projectionYears.length === 0) return undefined;
    return computeRevenueProjections(
      incomeStatement,
      revenueProjectionConfig,
      projectionYears,
      lastHistoricYear,
      allStatementsForProj,
      sbcBreakdowns,
      danaBreakdowns,
      (meta?.currencyUnit ?? "millions") as CurrencyUnit
    );
  }, [
    incomeStatement,
    revenueProjectionConfig,
    projectionYears,
    lastHistoricYear,
    allStatementsForProj,
    sbcBreakdowns,
    danaBreakdowns,
    meta?.currencyUnit,
  ]);

  const projectedCogs = useMemo(() => {
    const hasAnyCogs =
      Object.keys(cogsPctByRevenueLine).length > 0 ||
      Object.keys(cogsPctByRevenueLineByYear).length > 0;
    if (!projectedRevenue || !hasAnyCogs) return undefined;
    const out: Record<string, number> = {};
    const projYears = meta?.years?.projection ?? [];
    const allLineIds = new Set([
      ...Object.keys(cogsPctByRevenueLine),
      ...Object.keys(cogsPctByRevenueLineByYear),
    ]);
    for (const y of projYears) {
      let total = 0;
      for (const lineId of allLineIds) {
        const mode = cogsPctModeByRevenueLine[lineId] ?? "constant";
        const pct =
          mode === "custom" && cogsPctByRevenueLineByYear[lineId]?.[y] != null
            ? cogsPctByRevenueLineByYear[lineId][y]
            : cogsPctByRevenueLine[lineId] ?? 0;
        const rev = projectedRevenue[lineId]?.[y] ?? 0;
        total += rev * (pct / 100);
      }
      out[y] = total;
    }
    return out;
  }, [
    projectedRevenue,
    cogsPctByRevenueLine,
    cogsPctModeByRevenueLine,
    cogsPctByRevenueLineByYear,
    meta?.years?.projection,
  ]);

  /** lineId -> streamId (rev child id) for aggregating COGS by fixed/mother category */
  const lineIdToStreamId = useMemo(() => {
    const rev = incomeStatement?.find((r) => r.id === "rev");
    const streams = rev?.children ?? [];
    const breakdowns = revenueProjectionConfig?.breakdowns ?? {};
    const items = revenueProjectionConfig?.items ?? {};
    const out: Record<string, string> = {};
    for (const stream of streams) {
      out[stream.id] = stream.id;
      const children = breakdowns[stream.id] ?? [];
      for (const b of children) {
        out[b.id] = stream.id;
        const cfg = items[b.id];
        const pl = cfg?.inputs as { items?: Array<{ id?: string; label?: string }> } | undefined;
        if ((cfg?.method === "product_line" || cfg?.method === "channel") && pl?.items?.length) {
          pl.items.forEach((it, idx) => {
            const raw = it.id ?? it.label;
            const lineKey = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${idx}`;
            out[`${b.id}::${lineKey}`] = stream.id;
          });
        }
      }
    }
    return out;
  }, [incomeStatement, revenueProjectionConfig]);

  /** COGS by line by year (for mapping to fixed COGS children) */
  const cogsByLineByYear = useMemo(() => {
    const hasAnyCogs =
      Object.keys(cogsPctByRevenueLine).length > 0 ||
      Object.keys(cogsPctByRevenueLineByYear).length > 0;
    if (!projectedRevenue || !hasAnyCogs) return {};
    const projYears = meta?.years?.projection ?? [];
    const allLineIds = new Set([
      ...Object.keys(cogsPctByRevenueLine),
      ...Object.keys(cogsPctByRevenueLineByYear),
    ]);
    const out: Record<string, Record<string, number>> = {};
    for (const lineId of allLineIds) {
      out[lineId] = {};
      const mode = cogsPctModeByRevenueLine[lineId] ?? "constant";
      for (const y of projYears) {
        const pct =
          mode === "custom" && cogsPctByRevenueLineByYear[lineId]?.[y] != null
            ? cogsPctByRevenueLineByYear[lineId][y]
            : cogsPctByRevenueLine[lineId] ?? 0;
        const rev = projectedRevenue[lineId]?.[y] ?? 0;
        out[lineId][y] = rev * (pct / 100);
      }
    }
    return out;
  }, [
    projectedRevenue,
    cogsPctByRevenueLine,
    cogsPctModeByRevenueLine,
    cogsPctByRevenueLineByYear,
    meta?.years?.projection,
  ]);

  /** Projected COGS per historical/fixed COGS child row (stream-level): cogsChildId -> year -> value. Only IS Build results for those fixed categories. */
  const projectedCogsByCogsChild = useMemo(() => {
    const cogsRow = incomeStatement?.find((r) => r.id === "cogs");
    const cogsChildren = cogsRow?.children ?? [];
    if (cogsChildren.length === 0 || Object.keys(cogsByLineByYear).length === 0) return {};
    const rev = incomeStatement?.find((r) => r.id === "rev");
    const streams = (rev?.children ?? []) as { id: string; label: string }[];
    const projYears = meta?.years?.projection ?? [];
    const out: Record<string, Record<string, number>> = {};
    for (const cogsChild of cogsChildren) {
      const childLabel = (cogsChild.label ?? "").trim();
      const stream = streams.find(
        (s) =>
          childLabel === `${s.label} COGS` ||
          childLabel === `${s.label}s COGS` ||
          childLabel.toLowerCase().includes(s.label.toLowerCase())
      );
      if (!stream) continue;
      out[cogsChild.id] = {};
      for (const y of projYears) {
        let sum = 0;
        for (const [lineId, streamId] of Object.entries(lineIdToStreamId)) {
          if (streamId === stream.id) sum += cogsByLineByYear[lineId]?.[y] ?? 0;
        }
        out[cogsChild.id][y] = sum;
      }
    }
    return out;
  }, [incomeStatement, cogsByLineByYear, lineIdToStreamId, meta?.years?.projection]);

  /** Projected SG&A by row id (projection years only). Same logic as IS Build: top-level = revenue × % of revenue, sub = parent × % of parent. */
  const projectedSgaByRowIdByYear = useMemo(() => {
    const sgaRow = incomeStatement?.find((r) => r.id === "sga");
    if (!sgaRow?.children?.length || !projectedRevenue) return {};
    const projYears = meta?.years?.projection ?? [];
    const revenueTotalByYear: Record<string, number> = {};
    for (const y of projYears) revenueTotalByYear[y] = projectedRevenue["rev"]?.[y] ?? 0;
    const getPct = (itemId: string, year: string, depth: number): number => {
      if (depth === 0) {
        const mode = sgaPctModeByItemId[itemId] ?? "constant";
        if (mode === "custom") return (sgaPctByItemIdByYear[itemId] ?? {})[year] ?? (sgaPctByItemId[itemId] ?? 0);
        return sgaPctByItemId[itemId] ?? 0;
      }
      const mode = sgaPctOfParentModeByItemId[itemId] ?? "constant";
      if (mode === "custom") return (sgaPctOfParentByItemIdByYear[itemId] ?? {})[year] ?? (sgaPctOfParentByItemId[itemId] ?? 0);
      return sgaPctOfParentByItemId[itemId] ?? 0;
    };
    const out: Record<string, Record<string, number>> = {};
    function setProjectionForRow(row: Row, depth: number, parentValueByYear: Record<string, number> | null): void {
      out[row.id] = out[row.id] ?? {};
      for (const y of projYears) {
        if (depth === 0) {
          const pct = getPct(row.id, y, 0);
          out[row.id][y] = (revenueTotalByYear[y] ?? 0) * (pct / 100);
        } else {
          const parentVal = parentValueByYear?.[y] ?? 0;
          const pct = getPct(row.id, y, depth);
          out[row.id][y] = parentVal * (pct / 100);
        }
      }
      if (row.children?.length) {
        const parentByYear: Record<string, number> = {};
        for (const y of projYears) parentByYear[y] = out[row.id][y] ?? 0;
        row.children.forEach((c) => setProjectionForRow(c, depth + 1, parentByYear));
      }
    }
    sgaRow.children.forEach((c) => setProjectionForRow(c, 0, null));
    return out;
  }, [
    incomeStatement,
    projectedRevenue,
    meta?.years?.projection,
    sgaPctByItemId,
    sgaPctModeByItemId,
    sgaPctByItemIdByYear,
    sgaPctOfParentByItemId,
    sgaPctOfParentModeByItemId,
    sgaPctOfParentByItemIdByYear,
  ]);

  /** Projected SG&A per fixed SG&A category for Historicals: sum of LEAVES only under each fixed category (avoids double-counting parent + children). */
  const projectedSgaBySgaChild = useMemo(() => {
    const sgaRow = incomeStatement?.find((r) => r.id === "sga");
    const sgaChildren = sgaRow?.children ?? [];
    if (sgaChildren.length === 0 || Object.keys(projectedSgaByRowIdByYear).length === 0) return {};
    const projYears = meta?.years?.projection ?? [];
    function sumLeavesOnly(row: Row): Record<string, number> {
      const byYear: Record<string, number> = {};
      for (const y of projYears) byYear[y] = 0;
      if (row.children?.length) {
        for (const c of row.children) {
          const childSum = sumLeavesOnly(c);
          for (const y of projYears) byYear[y] = (byYear[y] ?? 0) + (childSum[y] ?? 0);
        }
      } else {
        for (const y of projYears) byYear[y] = projectedSgaByRowIdByYear[row.id]?.[y] ?? 0;
      }
      return byYear;
    }
    const out: Record<string, Record<string, number>> = {};
    for (const child of sgaChildren) {
      out[child.id] = sumLeavesOnly(child);
    }
    return out;
  }, [incomeStatement, projectedSgaByRowIdByYear, meta?.years?.projection]);

  const wcScheduleItems = useMemo(
    () => getWcScheduleItems(cashFlow ?? [], balanceSheet ?? []),
    [cashFlow, balanceSheet]
  );
  const revenueByYearForWc = useMemo(() => {
    const out: Record<string, number> = {};
    const revRow = incomeStatement?.find((r) => r.id === "rev");
    const allSt = { incomeStatement: incomeStatement ?? [], balanceSheet: balanceSheet ?? [], cashFlow: cashFlow ?? [] };
    for (const y of years) {
      if (y.endsWith("E") && projectedRevenue?.["rev"]?.[y] != null) {
        out[y] = projectedRevenue["rev"][y];
      } else if (revRow) {
        try {
          out[y] = computeRowValue(revRow, y, incomeStatement ?? [], incomeStatement ?? [], allSt);
        } catch {
          out[y] = 0;
        }
      } else {
        out[y] = 0;
      }
    }
    return out;
  }, [incomeStatement, years, projectedRevenue]);
  const cogsByYearForWc = useMemo(() => {
    const out: Record<string, number> = {};
    const cogsRow = incomeStatement?.find((r) => r.id === "cogs");
    const allSt = { incomeStatement: incomeStatement ?? [], balanceSheet: balanceSheet ?? [], cashFlow: cashFlow ?? [] };
    for (const y of years) {
      if (y.endsWith("E") && projectedCogs?.[y] != null) {
        out[y] = projectedCogs[y];
      } else if (cogsRow) {
        try {
          out[y] = computeRowValue(cogsRow, y, incomeStatement ?? [], incomeStatement ?? [], allSt);
        } catch {
          out[y] = 0;
        }
      } else {
        out[y] = 0;
      }
    }
    return out;
  }, [incomeStatement, years, projectedCogs]);
  const wcDriverState: WcDriverState = useMemo(
    () => ({
      wcDriverTypeByItemId,
      wcDaysByItemId,
      wcDaysByItemIdByYear,
      wcDaysBaseByItemId,
      wcPctBaseByItemId,
      wcPctByItemId,
      wcPctByItemIdByYear,
    }),
    [
      wcDriverTypeByItemId,
      wcDaysByItemId,
      wcDaysByItemIdByYear,
      wcDaysBaseByItemId,
      wcPctBaseByItemId,
      wcPctByItemId,
      wcPctByItemIdByYear,
    ]
  );
  const balanceByItemByYearForWc = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const item of wcScheduleItems) {
      const row = balanceSheet?.find((r) => r.id === item.id);
      out[item.id] = {};
      for (const y of years) {
        out[item.id][y] = row?.values?.[y] ?? 0;
      }
    }
    return out;
  }, [wcScheduleItems, balanceSheet, years]);
  const wcProjectedBalances = useMemo(() => {
    if (wcScheduleItems.length === 0) return {};
    const projYears = meta?.years?.projection ?? [];
    return computeWcProjectedBalances(
      wcScheduleItems.map((i) => i.id),
      projYears,
      wcDriverState,
      revenueByYearForWc,
      cogsByYearForWc,
      balanceByItemByYearForWc
    );
  }, [
    wcScheduleItems,
    meta?.years?.projection,
    wcDriverState,
    revenueByYearForWc,
    cogsByYearForWc,
    balanceByItemByYearForWc,
  ]);

  const wcAssets = useMemo(() => wcScheduleItems.filter((i) => i.side === "asset"), [wcScheduleItems]);
  const wcLiabilities = useMemo(() => wcScheduleItems.filter((i) => i.side === "liability"), [wcScheduleItems]);

  const { totalOAByYear, totalOLByYear, nowcByYear, deltaNowcByYear } = useMemo(() => {
    const getVal = (itemId: string, y: string) => {
      const isProj = y.endsWith("E");
      if (isProj && wcProjectedBalances[itemId]?.[y] != null) return wcProjectedBalances[itemId][y];
      return balanceByItemByYearForWc[itemId]?.[y] ?? 0;
    };
    const totalOA: Record<string, number> = {};
    const totalOL: Record<string, number> = {};
    const nowc: Record<string, number> = {};
    const deltaNowc: Record<string, number | null> = {};
    for (const y of years) {
      totalOA[y] = wcAssets.reduce((sum, i) => sum + getVal(i.id, y), 0);
      totalOL[y] = wcLiabilities.reduce((sum, i) => sum + getVal(i.id, y), 0);
      nowc[y] = totalOA[y] - totalOL[y];
      const idx = years.indexOf(y);
      deltaNowc[y] = idx > 0 ? nowc[y] - nowc[years[idx - 1]] : null;
    }
    return {
      totalOAByYear: totalOA,
      totalOLByYear: totalOL,
      nowcByYear: nowc,
      deltaNowcByYear: deltaNowc,
    };
  }, [wcScheduleItems, wcAssets, wcLiabilities, years, wcProjectedBalances, balanceByItemByYearForWc]);

  const historicalYears = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const lastHistYear = historicalYears.length > 0 ? historicalYears[historicalYears.length - 1] : null;
  const revenueByYearForCapex = useMemo(() => {
    const out: Record<string, number> = {};
    for (const y of projectionYears) {
      out[y] = revenueByYearForWc[y] ?? 0;
    }
    return out;
  }, [projectionYears, revenueByYearForWc]);
  const lastHistPPE = useMemo(() => {
    if (!lastHistYear || !balanceSheet?.length) return 0;
    const row = balanceSheet.find((r) => r.id === "ppe");
    return row?.values?.[lastHistYear] ?? 0;
  }, [balanceSheet, lastHistYear]);
  const lastHistCapex = useMemo(() => {
    if (!lastHistYear || !cashFlow?.length) return 0;
    const row = cashFlow.find((r) => r.id === "capex");
    return row?.values?.[lastHistYear] ?? 0;
  }, [cashFlow, lastHistYear]);
  const allCapexBucketIds = useMemo(
    () => [...CAPEX_DEFAULT_BUCKET_IDS_PREVIEW, ...capexCustomBucketIds],
    [capexCustomBucketIds]
  );
  const effectiveUsefulLifeCapex = useMemo(() => {
    if (!capexSplitByBucket) return ppeUsefulLifeSingle;
    const lives = allCapexBucketIds.map((id) => ppeUsefulLifeByBucket[id]).filter((n) => n != null && n > 0);
    if (lives.length === 0) return ppeUsefulLifeSingle;
    return lives.reduce((a, b) => a + b, 0) / lives.length;
  }, [capexSplitByBucket, ppeUsefulLifeSingle, ppeUsefulLifeByBucket, allCapexBucketIds]);
  const capexEngineInput = useMemo(
    () => ({
      projectionYears,
      revenueByYear: revenueByYearForCapex,
      lastHistPPE,
      lastHistCapex,
      method: capexForecastMethod,
      pctRevenue: capexPctRevenue,
      manualByYear: capexManualByYear,
      growthPct: capexGrowthPct,
      timingConvention: capexTimingConvention,
      usefulLifeYears: effectiveUsefulLifeCapex,
    }),
    [
      projectionYears,
      revenueByYearForCapex,
      lastHistPPE,
      lastHistCapex,
      capexForecastMethod,
      capexPctRevenue,
      capexManualByYear,
      capexGrowthPct,
      capexTimingConvention,
      effectiveUsefulLifeCapex,
    ]
  );
  const totalCapexByYear = useMemo(() => {
    if (projectionYears.length === 0) return {};
    return computeProjectedCapexByYear(capexEngineInput);
  }, [projectionYears, capexEngineInput]);
  const capexScheduleOutput = useMemo(() => {
    if (projectionYears.length === 0) return null;
    return computeCapexDaSchedule(capexEngineInput);
  }, [projectionYears, capexEngineInput]);
  const capexBucketsToShowInPreview = useMemo(() => {
    const isIncluded = (id: string) => {
      const v = capexIncludeInAllocationByBucket[id];
      if (v !== undefined && v !== null) return v === true;
      return id !== "cap_b1" && id !== "cap_b9";
    };
    return allCapexBucketIds.filter(isIncluded);
  }, [allCapexBucketIds, capexIncludeInAllocationByBucket]);

  const initialLandBalance = useMemo(() => {
    if (!lastHistYear) return 0;
    const landPpeDisplay = capexHelperPpeByBucketByYear["cap_b1"]?.[lastHistYear];
    const land = typeof landPpeDisplay === "number" && !Number.isNaN(landPpeDisplay) ? landPpeDisplay : 0;
    return displayToStored(land, meta?.currencyUnit ?? "millions");
  }, [lastHistYear, capexHelperPpeByBucketByYear, meta?.currencyUnit]);

  const capexScheduleOutputBucketed = useMemo(() => {
    if (!capexSplitByBucket || projectionYears.length === 0 || allCapexBucketIds.length === 0) return null;
    return computeCapexDaScheduleByBucket({
      projectionYears,
      totalCapexByYear,
      lastHistPPE,
      timingConvention: capexTimingConvention,
      bucketIds: allCapexBucketIds,
      allocationPct: capexBucketAllocationPct,
      usefulLifeByBucket: ppeUsefulLifeByBucket,
      initialLandBalance,
    });
  }, [
    capexSplitByBucket,
    projectionYears,
    totalCapexByYear,
    lastHistPPE,
    capexTimingConvention,
    allCapexBucketIds,
    capexBucketAllocationPct,
    ppeUsefulLifeByBucket,
    initialLandBalance,
  ]);

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
                <th
                  key={y}
                  className={yearColClass("px-3 py-2 text-right font-semibold text-slate-400")(y)}
                  title={isProjectionYear(y) ? "Projection" : "Actual"}
                >
                  {y}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {/* Income Statement — only when showing full model */}
            {focusStatement === "all" && (
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
                projectedRevenue={projectedRevenue}
                projectedCogs={projectedCogs}
                projectedCogsByCogsChild={projectedCogsByCogsChild}
                projectedSgaBySgaChild={projectedSgaBySgaChild}
              />
            )}

            {/* Stock-Based Compensation Disclosure */}
            {focusStatement === "all" && (() => {
              const sgaRow = incomeStatement.find((r) => r.id === "sga");
              const cogsRow = incomeStatement.find((r) => r.id === "cogs");
              const rdRow = incomeStatement.find((r) => r.id === "rd");
              const sgaBreakdowns = sgaRow?.children ?? [];
              const cogsBreakdowns = cogsRow?.children ?? [];
              const rdBreakdowns = rdRow?.children ?? [];
              const hasSgaBreakdowns = sgaBreakdowns.length > 0;
              const hasCogsBreakdowns = cogsBreakdowns.length > 0;
              const hasRdBreakdowns = rdBreakdowns.length > 0;
              
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
                if (hasRdBreakdowns) {
                  rdBreakdowns.forEach((b) => {
                    if (sbcBreakdowns[b.id]?.[y]) hasAnySbc = true;
                  });
                } else {
                  if (sbcBreakdowns["rd"]?.[y]) hasAnySbc = true;
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

                  {/* R&D SBC */}
                  {hasRdBreakdowns ? (
                    rdBreakdowns.map((breakdown) => {
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
                    const rdSbc = years.map((y) => sbcBreakdowns["rd"]?.[y] ?? 0);
                    const hasAnySbc = rdSbc.some(v => v !== 0);
                    if (!hasAnySbc) return null;
                    
                    return (
                      <tr className="border-b border-amber-900/30 bg-amber-950/10">
                        <td className="px-3 py-1.5 text-amber-300/90" style={{ paddingLeft: '24px' }}>
                          Research and development
                        </td>
                        {years.map((y) => {
                          const value = sbcBreakdowns["rd"]?.[y] ?? 0;
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
                      if (hasRdBreakdowns) {
                        rdBreakdowns.forEach((b) => {
                          total += sbcBreakdowns[b.id]?.[y] ?? 0;
                        });
                      } else {
                        total += sbcBreakdowns["rd"]?.[y] ?? 0;
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

            {/* Working Capital Schedule — only when BS Build focus (IB: NOWC = Total OA - Total OL, ΔNOWC = change) */}
            {focusStatement === "balance" && wcScheduleItems.length > 0 && (
              <>
                <tr className="border-t-4 border-slate-700">
                  <td colSpan={1 + years.length} className="px-3 py-3 bg-blue-950/50">
                    <h3 className="text-sm font-bold text-blue-200">Working Capital Schedule</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Operating WC items from CFO. Total OA − Total OL = NOWC; ΔNOWC = period change. Columns: Actuals → <span className="text-amber-400/90">Projections</span>.
                    </p>
                  </td>
                </tr>
                <tr className="border-b border-slate-700 bg-slate-800/30">
                  <td className="px-3 py-1.5 text-xs font-semibold text-slate-400">Line Item</td>
                  {years.map((y) => (
                    <td key={y} className={yearColClass("px-3 py-1.5 text-right text-xs font-semibold text-slate-400")(y)}>
                      {y}
                    </td>
                  ))}
                </tr>
                {/* Net Operating Working Capital (NOWC) = Total OA − Total OL */}
                <tr className="border-b-2 border-slate-600 bg-slate-800/50">
                  <td className="px-3 py-2 text-xs font-semibold text-slate-100">Net Operating Working Capital (NOWC)</td>
                  {years.map((y) => (
                    <td key={y} className={yearColClass("px-3 py-2 text-right text-xs font-semibold text-slate-100")(y)}>
                      {formatAccountingNumber(nowcByYear[y], meta?.currencyUnit ?? "millions", showDecimals)}
                    </td>
                  ))}
                </tr>
                {/* ΔNOWC = period-over-period change */}
                <tr className="border-b border-slate-700 bg-slate-800/30">
                  <td className="px-3 py-2 text-xs font-medium text-blue-200/90 pl-6">ΔNOWC</td>
                  {years.map((y) => (
                    <td key={y} className={yearColClass("px-3 py-2 text-right text-xs text-slate-200")(y)}>
                      {deltaNowcByYear[y] === null ? "—" : formatAccountingNumber(deltaNowcByYear[y]!, meta?.currencyUnit ?? "millions", showDecimals)}
                    </td>
                  ))}
                </tr>
                {/* Asset Accounts (total) */}
                <tr className="border-b border-slate-700 bg-slate-800/40">
                  <td className="px-3 py-2 text-xs font-semibold text-slate-200">Asset Accounts</td>
                  {years.map((y) => (
                    <td key={y} className={yearColClass("px-3 py-2 text-right text-xs font-medium text-slate-200")(y)}>
                      {totalOAByYear[y] === 0 ? "—" : formatAccountingNumber(totalOAByYear[y], meta?.currencyUnit ?? "millions", showDecimals)}
                    </td>
                  ))}
                </tr>
                {wcAssets.map((item) => {
                  const isProj = (y: string) => y.endsWith("E");
                  const val = (y: string) =>
                    isProj(y) && wcProjectedBalances[item.id]?.[y] != null
                      ? wcProjectedBalances[item.id][y]
                      : balanceByItemByYearForWc[item.id]?.[y] ?? 0;
                  return (
                    <tr key={item.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                      <td className="px-3 py-2 text-xs text-slate-300 pl-6">{item.label}</td>
                      {years.map((y) => (
                        <td key={y} className={yearColClass("px-3 py-2 text-right text-xs text-slate-200")(y)}>
                          {val(y) === 0 ? "—" : formatAccountingNumber(val(y), meta?.currencyUnit ?? "millions", showDecimals)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {/* Liabilities Accounts (total) */}
                <tr className="border-b border-slate-700 bg-slate-800/40">
                  <td className="px-3 py-2 text-xs font-semibold text-slate-200">Liabilities Accounts</td>
                  {years.map((y) => (
                    <td key={y} className={yearColClass("px-3 py-2 text-right text-xs font-medium text-slate-200")(y)}>
                      {totalOLByYear[y] === 0 ? "—" : formatAccountingNumber(totalOLByYear[y], meta?.currencyUnit ?? "millions", showDecimals)}
                    </td>
                  ))}
                </tr>
                {wcLiabilities.map((item) => {
                  const isProj = (y: string) => y.endsWith("E");
                  const val = (y: string) =>
                    isProj(y) && wcProjectedBalances[item.id]?.[y] != null
                      ? wcProjectedBalances[item.id][y]
                      : balanceByItemByYearForWc[item.id]?.[y] ?? 0;
                  return (
                    <tr key={item.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                      <td className="px-3 py-2 text-xs text-slate-300 pl-6">{item.label}</td>
                      {years.map((y) => (
                        <td key={y} className={yearColClass("px-3 py-2 text-right text-xs text-slate-200")(y)}>
                          {val(y) === 0 ? "—" : formatAccountingNumber(val(y), meta?.currencyUnit ?? "millions", showDecimals)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={1 + years.length} className="h-3 bg-transparent" />
                </tr>
              </>
            )}

            {/* Capex & D&A Schedule — only when BS Build focus */}
            {focusStatement === "balance" && (capexScheduleOutput || capexScheduleOutputBucketed) && (
              <>
                <tr className="border-t-4 border-slate-700">
                  <td colSpan={1 + years.length} className="px-3 py-3 bg-purple-950/40">
                    <h3 className="text-sm font-bold text-purple-200">Capex &amp; D&A Schedule</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {capexScheduleOutputBucketed
                        ? "Per-bucket: Beginning, Capex, Depreciation, End. Timing: " +
                          (capexTimingConvention === "mid" ? "Mid-year" : capexTimingConvention === "start" ? "Start of period" : "End of period") +
                          ". Columns: Actuals → Projections."
                        : "Total Capex, D&A, and Ending PP&E from schedule setup. Columns: Actuals → Projections."}
                    </p>
                  </td>
                </tr>
                <tr className="border-b border-slate-700 bg-slate-800/30">
                  <td className="px-3 py-1.5 text-xs font-semibold text-slate-400">Line Item</td>
                  {years.map((y) => (
                    <td key={y} className={yearColClass("px-3 py-1.5 text-right text-xs font-semibold text-slate-400")(y)}>
                      {y}
                    </td>
                  ))}
                </tr>
                {capexScheduleOutputBucketed ? (
                  <>
                    {capexBucketsToShowInPreview.map((bucketId) => {
                      const label = capexBucketLabels[bucketId] || CAPEX_DEFAULT_BUCKET_LABELS_PREVIEW[bucketId] || bucketId;
                      const sched = capexScheduleOutputBucketed.byBucket[bucketId];
                      if (!sched) return null;
                      return (
                        <React.Fragment key={bucketId}>
                          <tr className="border-b border-slate-700/50 bg-slate-800/20">
                            <td className="px-3 py-1.5 pl-4 text-xs font-medium text-purple-200/90">{label}</td>
                            <td colSpan={years.length} className="px-3 py-1.5" />
                          </tr>
                          <tr className="border-b border-slate-700/50 bg-slate-800/40">
                            <td className="px-3 py-2 pl-6 text-xs text-slate-300">Beginning</td>
                            {years.map((y) => {
                              const isProj = projectionYears.includes(y);
                              const val = isProj ? sched.beginningByYear[y] : null;
                              return (
                                <td key={y} className={yearColClass("px-3 py-2 text-right text-xs text-slate-200")(y)}>
                                  {val != null ? formatAccountingNumber(val, meta?.currencyUnit ?? "millions", showDecimals) : "—"}
                                </td>
                              );
                            })}
                          </tr>
                          <tr className="border-b border-slate-700/50 bg-slate-800/40">
                            <td className="px-3 py-2 pl-6 text-xs text-slate-300">Capex</td>
                            {years.map((y) => {
                              const isProj = projectionYears.includes(y);
                              const val = isProj ? sched.capexByYear[y] : null;
                              return (
                                <td key={y} className={yearColClass("px-3 py-2 text-right text-xs text-slate-200")(y)}>
                                  {val != null ? formatAccountingNumber(val, meta?.currencyUnit ?? "millions", showDecimals) : "—"}
                                </td>
                              );
                            })}
                          </tr>
                          <tr className="border-b border-slate-700/50 bg-slate-800/40">
                            <td className="px-3 py-2 pl-6 text-xs text-slate-300">Depreciation</td>
                            {years.map((y) => {
                              const isProj = projectionYears.includes(y);
                              const val = isProj ? sched.dandaByYear[y] : null;
                              return (
                                <td key={y} className={yearColClass("px-3 py-2 text-right text-xs text-slate-200")(y)}>
                                  {val != null ? formatAccountingNumber(val, meta?.currencyUnit ?? "millions", showDecimals) : "—"}
                                </td>
                              );
                            })}
                          </tr>
                          <tr className="border-b border-slate-700/50 bg-slate-800/40">
                            <td className="px-3 py-2 pl-6 text-xs text-slate-300">End</td>
                            {years.map((y) => {
                              const isProj = projectionYears.includes(y);
                              const val = isProj ? sched.endByYear[y] : null;
                              return (
                                <td key={y} className={yearColClass("px-3 py-2 text-right text-xs text-slate-200")(y)}>
                                  {val != null ? formatAccountingNumber(val, meta?.currencyUnit ?? "millions", showDecimals) : "—"}
                                </td>
                              );
                            })}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                    <tr className="border-t-2 border-slate-600 bg-slate-800/60">
                      <td className="px-3 py-2 text-xs font-semibold text-slate-200">Total Capex</td>
                      {years.map((y) => {
                        const isProj = projectionYears.includes(y);
                        const raw = isProj ? capexScheduleOutputBucketed.totalCapexByYear[y] : (cashFlow?.find((r) => r.id === "capex")?.values?.[y] ?? null);
                        const val = raw != null ? (isProj ? raw : Math.abs(raw)) : null;
                        return (
                          <td key={y} className={yearColClass("px-3 py-2 text-right text-xs font-medium text-slate-200")(y)}>
                            {val == null ? "—" : formatAccountingNumber(val, meta?.currencyUnit ?? "millions", showDecimals)}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="border-b border-slate-700 bg-slate-800/60">
                      <td className="px-3 py-2 text-xs font-semibold text-slate-200">Total D&A</td>
                      {years.map((y) => {
                        const isProj = projectionYears.includes(y);
                        const val = isProj ? capexScheduleOutputBucketed.totalDandaByYear[y] : (danaBreakdowns?.[y] ?? incomeStatement?.find((r) => r.id === "danda")?.values?.[y] ?? null);
                        return (
                          <td key={y} className={yearColClass("px-3 py-2 text-right text-xs font-medium text-slate-200")(y)}>
                            {val == null ? "—" : formatAccountingNumber(val, meta?.currencyUnit ?? "millions", showDecimals)}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="border-b border-slate-700 bg-slate-800/60">
                      <td className="px-3 py-2 text-xs font-semibold text-slate-200">Ending PP&E, net</td>
                      {years.map((y) => {
                        const isProj = projectionYears.includes(y);
                        const val = isProj ? capexScheduleOutputBucketed.totalPpeByYear[y] : (balanceSheet?.find((r) => r.id === "ppe")?.values?.[y] ?? null);
                        return (
                          <td key={y} className={yearColClass("px-3 py-2 text-right text-xs font-medium text-slate-200")(y)}>
                            {val == null ? "—" : formatAccountingNumber(val, meta?.currencyUnit ?? "millions", showDecimals)}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                ) : (
                  <>
                    <tr className="border-b border-slate-700 bg-slate-800/40">
                      <td className="px-3 py-2 text-xs font-medium text-slate-200">Capex</td>
                      {years.map((y) => {
                        const isProj = projectionYears.includes(y);
                        const raw = isProj && capexScheduleOutput ? capexScheduleOutput.capexByYear[y] : (cashFlow?.find((r) => r.id === "capex")?.values?.[y] ?? null);
                        const val = raw != null ? (isProj ? raw : Math.abs(raw)) : null;
                        return (
                          <td key={y} className={yearColClass("px-3 py-2 text-right text-xs text-slate-200")(y)}>
                            {val == null ? "—" : formatAccountingNumber(val, meta?.currencyUnit ?? "millions", showDecimals)}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="border-b border-slate-700 bg-slate-800/40">
                      <td className="px-3 py-2 text-xs font-medium text-slate-200 pl-6">D&A</td>
                      {years.map((y) => {
                        const isProj = projectionYears.includes(y);
                        const val = isProj && capexScheduleOutput ? capexScheduleOutput.dandaByYear[y] : (danaBreakdowns?.[y] ?? incomeStatement?.find((r) => r.id === "danda")?.values?.[y] ?? null);
                        return (
                          <td key={y} className={yearColClass("px-3 py-2 text-right text-xs text-slate-200")(y)}>
                            {val == null ? "—" : formatAccountingNumber(val, meta?.currencyUnit ?? "millions", showDecimals)}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="border-b border-slate-700 bg-slate-800/40">
                      <td className="px-3 py-2 text-xs font-medium text-slate-200">Ending PP&E</td>
                      {years.map((y) => {
                        const isProj = projectionYears.includes(y);
                        const val = isProj && capexScheduleOutput ? capexScheduleOutput.ppeByYear[y] : (balanceSheet?.find((r) => r.id === "ppe")?.values?.[y] ?? null);
                        return (
                          <td key={y} className={yearColClass("px-3 py-2 text-right text-xs text-slate-200")(y)}>
                            {val == null ? "—" : formatAccountingNumber(val, meta?.currencyUnit ?? "millions", showDecimals)}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                )}
                <tr>
                  <td colSpan={1 + years.length} className="h-3 bg-transparent" />
                </tr>
              </>
            )}

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
                  getYearCellClassName={
                    focusStatement === "balance"
                      ? (y) =>
                          [
                            isProjectionYear(y) ? "bg-slate-800/60" : "!text-blue-400",
                            isFirstProjectionYear(y) ? "border-l-2 border-amber-500/70" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")
                      : undefined
                  }
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
            {focusStatement === "all" && cashFlow && cashFlow.length > 0 && (
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
