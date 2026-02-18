/**
 * Excel Export Utility
 * 
 * Converts the financial model state into an Excel workbook with:
 * - IB-grade formatting (blue inputs, black formulas)
 * - Actual formulas in cells
 * - Proper number formatting
 */

import type { Row } from "@/types/finance";
import type { CurrencyUnit } from "@/lib/currency-utils";
import { generateExcelFormula, getCellName, getColumnLetter } from "./excel-formulas";
import { storedToDisplay, getUnitLabel } from "./currency-utils";
import { findCFIItem } from "./cfi-intelligence";
import { findCFFItem } from "./cff-intelligence";
import { computeRowValue } from "@/lib/calculations";

type FlattenOptions = {
  forStatement?: "income" | "balance" | "cashflow";
};

function flattenRows(
  rows: Row[],
  depth = 0,
  options?: FlattenOptions,
  expandedRows: Set<string> | null = null // Always expand all for Excel export (null = all expanded)
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
    out.push({ row: r, depth, parentId: undefined });
    // Always expand children for Excel export (expandedRows === null means all expanded)
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
          ...flattenRows(filteredChildren, depth + 1, options, expandedRows).map((item) => ({
            ...item,
            parentId: r.id,
          }))
        );
      }
    }
  }
  return out;
}

// Helper function to get CFS section for a row (matching preview logic)
function getCFSSection(
  rowId: string,
  rows: Row[],
  parentId?: string
): "operating" | "investing" | "financing" | null {
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
}

// Helper function to get Balance Sheet section
function getBSSection(rowId: string, rows: Row[]): "assets" | "liabilities" | "equity" | null {
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
}

// Helper function to get Balance Sheet category
function getBSCategory(rowId: string, rows: Row[]): string | null {
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
  
  if (totalCurrentAssetsIndex >= 0 && rowIndex < totalCurrentAssetsIndex) {
    return "current_assets";
  }
  if (totalCurrentAssetsIndex >= 0 && totalAssetsIndex >= 0 && 
      rowIndex > totalCurrentAssetsIndex && rowIndex < totalAssetsIndex) {
    return "fixed_assets";
  }
  if (totalAssetsIndex >= 0 && totalCurrentLiabIndex >= 0 && 
      rowIndex > totalAssetsIndex && rowIndex < totalCurrentLiabIndex) {
    return "current_liabilities";
  }
  if (totalCurrentLiabIndex >= 0 && totalLiabIndex >= 0 && 
      rowIndex > totalCurrentLiabIndex && rowIndex < totalLiabIndex) {
    return "non_current_liabilities";
  }
  if (totalLiabIndex >= 0 && totalEquityIndex >= 0 && 
      rowIndex > totalLiabIndex && rowIndex < totalEquityIndex) {
    return "equity";
  }
  
  return null;
}

// Helper function to get CFO/CFI/CFF sign indicator (matching preview logic)
function getCFOSign(
  rowId: string,
  row?: Row,
  section?: "operating" | "investing" | "financing",
  parentId?: string
): string | null {
  // Subtotals/totals: no sign
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
    if (rowId === "net_income" || rowId === "danda" || rowId === "sbc") {
      return "+";
    }
    if (rowId === "wc_change") {
      return "-";
    }
    if (rowId === "other_operating") {
      return "+";
    }

    // Working capital children
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
      return "-";
    }

    // Custom operating items by label
    if (row?.label) {
      const L = row.label.toLowerCase();
      if ((L.includes("operating lease") && L.includes("liab")) || L.includes("lease liab")) return "-";
      if (L.includes("amortization of") || L.includes("amortization of costs")) return "+";
      if (L.includes("losses in strategic") || L.includes("losses in investment")) return "+";
    }

    // CFO intelligence items
    if ((rowId.startsWith("cfo_") || row?.cfsLink?.section === "operating") && row?.cfsLink) {
      if (row.cfsLink.impact === "positive") return "+";
      if (row.cfsLink.impact === "negative") return "-";
      return "+";
    }
  }
  
  // CFI items (investing section)
  if (section === "investing") {
    if (rowId === "capex") {
      return "-";
    }
    if (rowId === "other_investing") {
      return "+";
    }
    
    if (row?.cfsLink && row.cfsLink.section === "investing") {
      if (row.cfsLink.impact === "positive") {
        return "+";
      } else if (row.cfsLink.impact === "negative") {
        return "-";
      }
    }
    
    if (row?.label) {
      const cfiItem = findCFIItem(row.label);
      if (cfiItem) {
        return cfiItem.impact === "positive" ? "+" : "-";
      }
    }
  }
  
  // CFF items (financing section)
  if (section === "financing") {
    if (rowId === "debt_issuance" || rowId === "equity_issuance") {
      return "+";
    }
    if (rowId === "debt_repayment" || rowId === "dividends") {
      return "-";
    }
    
    if (row?.cfsLink && row.cfsLink.section === "financing") {
      if (row.cfsLink.impact === "positive") {
        return "+";
      } else if (row.cfsLink.impact === "negative") {
        return "-";
      }
    }
    
    if (row?.label) {
      const cffItem = findCFFItem(row.label);
      if (cffItem) {
        return cffItem.impact === "positive" ? "+" : "-";
      }
    }
  }
  
  // Default: show + for unknown
  return "+";
}

/**
 * Define a workbook-level name for a single cell so formulas can reference by name (survives reorder).
 * sheetName = worksheet name (e.g. "Financial Model"); statementPrefix = "IS" | "BS" | "CFS".
 */
function defineCellName(
  wb: any,
  sheetName: string,
  statementPrefix: string,
  rowId: string,
  col: number,
  excelRow: number
): void {
  if (!wb || !statementPrefix || !wb.definedNames || typeof wb.definedNames.add !== "function") return;
  const colLetter = getColumnLetter(col);
  const name = getCellName(statementPrefix, rowId, colLetter);
  const ref = `'${sheetName.replace(/'/g, "''")}'!$${colLetter}$${excelRow}`;
  try {
    wb.definedNames.add(ref, name);
  } catch {
    // Ignore duplicate or invalid name
  }
}

/**
 * Export Income Statement to Excel worksheet.
 * When wb and statementPrefix are provided, defines names for each data cell and formulas use those names (robust to reorder).
 */
export type ExportStatementContext = {
  allStatements?: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] };
  sbcBreakdowns?: Record<string, Record<string, number>>;
  danaBreakdowns?: Record<string, number>;
};

export function exportStatementToExcel(
  ws: any,
  rows: Row[],
  years: string[],
  startRow: number = 1,
  currencyUnit?: string,
  statementLabel?: string,
  isFirstStatement: boolean = true,
  wb?: any,
  statementPrefix?: string,
  context?: ExportStatementContext
): number {
  if (!rows || rows.length === 0) {
    return startRow;
  }
  if (!years || years.length === 0) {
    return startRow;
  }
  
  // Detect statement type based on label or row IDs
  const isCashFlow = statementLabel === "Cash Flow Statement" || 
                     rows.some(r => r.id === "operating_cf" || r.id === "investing_cf" || r.id === "financing_cf");
  const isBalanceSheet = statementLabel === "Balance Sheet" ||
                         rows.some(r => r.id === "total_assets" || r.id === "total_liabilities");
  const forStatement: "income" | "balance" | "cashflow" = isCashFlow ? "cashflow" : isBalanceSheet ? "balance" : "income";
  // When wb is provided, use name-based formulas. Derive statementPrefix if not passed.
  const useNames = !!(wb && (statementPrefix ?? (isBalanceSheet ? "BS" : isCashFlow ? "CFS" : "IS")));
  const prefix = statementPrefix ?? (isBalanceSheet ? "BS" : isCashFlow ? "CFS" : "IS");
  const sheetName = typeof ws.name === "string" ? ws.name : "Financial Model";
  
  // Always expand all rows for Excel export (null = all expanded, matching preview when expandedRows === null)
  const flattened = flattenRows(rows, 0, { forStatement }, null);
  
  // Add statement label header if provided and not first statement
  if (statementLabel && !isFirstStatement) {
    // Add spacing before new statement
    startRow += 2;
    ws.getCell(startRow, 1).value = statementLabel;
    ws.getCell(startRow, 1).font = { bold: true, size: 12, color: { argb: "FF000000" } };
    ws.getRow(startRow).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" }, // Light grey background for statement header
    };
    startRow += 1;
  }
  
  // Add currency unit note if provided (only for first statement)
  if (isFirstStatement && currencyUnit && currencyUnit !== "units") {
    const unitLabel = currencyUnit === "millions" ? "M" : currencyUnit === "thousands" ? "K" : "";
    if (unitLabel) {
      ws.getCell(startRow, 1).value = `All currency amounts in ${unitLabel} (${currencyUnit}). Other values (shares, percentages, etc.) are in actual units.`;
      ws.getCell(startRow, 1).font = { italic: true, color: { argb: "FF94A3B8" }, size: 10 };
      startRow += 1;
    }
  }
  
  // Headers (only add if this is the first statement, otherwise reuse existing headers)
  if (isFirstStatement) {
    ws.getCell(startRow, 1).value = "Line Item";
    years.forEach((year, idx) => {
      ws.getCell(startRow, 2 + idx).value = year;
    });
    
    // Style header row - IB standard: dark background, white text
    ws.getRow(startRow).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    ws.getRow(startRow).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E293B" }, // Dark slate background
    };
    ws.getRow(startRow).alignment = { horizontal: "left", vertical: "middle" };
    startRow += 1;
  }
  
  // Track section and category changes for headers/subtitles
  const categoryLabels: Record<string, string> = {
    current_assets: "Current assets",
    fixed_assets: "Fixed assets",
    current_liabilities: "Current liabilities",
    non_current_liabilities: "Non-current liabilities",
    equity: "Shareholders' equity",
  };
  
  // First pass: calculate row offsets for each row (how many section headers/category subtitles appear before it)
  const rowOffsets: number[] = [];
  let currentOffset = 0;
  
  flattened.forEach(({ row, depth, parentId }, idx) => {
    const currentSection = isCashFlow ? getCFSSection(row.id, rows, parentId) : 
                          isBalanceSheet ? getBSSection(row.id, rows) : null;
    const currentCategory = isBalanceSheet ? getBSCategory(row.id, rows) : null;
    
    const prevRow = idx > 0 ? flattened[idx - 1] : null;
    const prevSection = prevRow && (isCashFlow || isBalanceSheet)
      ? isCashFlow ? getCFSSection(prevRow.row.id, rows, prevRow.parentId)
      : getBSSection(prevRow.row.id, rows)
      : null;
    const prevCategory = isBalanceSheet && prevRow ? getBSCategory(prevRow.row.id, rows) : null;
    
    const isSectionStart = (isCashFlow || isBalanceSheet) && currentSection != null && currentSection !== prevSection;
    const isCategoryStart = isBalanceSheet && currentCategory && (currentCategory !== prevCategory || isSectionStart);
    
    // Store offset for this row (before adding headers)
    rowOffsets[idx] = currentOffset;
    
    // Increment offset if we need to add headers
    if (isSectionStart) currentOffset += 1;
    if (isCategoryStart) currentOffset += 1;
    
    // Add blank row after "Total Current Assets" (before first Fixed Assets item)
    if (isBalanceSheet && row.id === "total_current_assets") {
      currentOffset += 1;
    }
  });
  
  // Helper to get actual Excel row number accounting for offsets
  const getActualExcelRow = (flattenedIndex: number): number => {
    return startRow + 1 + flattenedIndex + rowOffsets[flattenedIndex];
  };
  
  let rowOffset = 0; // Track extra rows added for section headers/category subtitles
  
  // Data rows with section headers and category subtitles
  flattened.forEach(({ row, depth, parentId }, idx) => {
    const baseRow = startRow + 1 + idx;
    
    // Detect section and category changes
    const currentSection = isCashFlow ? getCFSSection(row.id, rows, parentId) : 
                          isBalanceSheet ? getBSSection(row.id, rows) : null;
    const currentCategory = isBalanceSheet ? getBSCategory(row.id, rows) : null;
    
    const prevRow = idx > 0 ? flattened[idx - 1] : null;
    const prevSection = prevRow && (isCashFlow || isBalanceSheet)
      ? isCashFlow ? getCFSSection(prevRow.row.id, rows, prevRow.parentId)
      : getBSSection(prevRow.row.id, rows)
      : null;
    const prevCategory = isBalanceSheet && prevRow ? getBSCategory(prevRow.row.id, rows) : null;
    
    // Show section header when section changes
    const isSectionStart = (isCashFlow || isBalanceSheet) && currentSection != null && currentSection !== prevSection;
    const isCategoryStart = isBalanceSheet && currentCategory && (currentCategory !== prevCategory || isSectionStart);
    
    // Add section header row if needed (BEFORE current row)
    // When isSectionStart is true, we need to insert the header BEFORE this item
    if (isSectionStart && currentSection) {
      // Insert header at the position where this item would be, then push item down
      const sectionRow = baseRow + rowOffset;
      rowOffset += 1; // Increment BEFORE writing item, so item goes to next row
      ws.getCell(sectionRow, 1).value = 
        currentSection === "assets" ? "Assets" :
        currentSection === "liabilities" ? "Liabilities" :
        currentSection === "equity" ? "Shareholders' Equity" :
        currentSection === "operating" ? "Operating Activities" :
        currentSection === "investing" ? "Investing Activities" :
        currentSection === "financing" ? "Financing Activities" : "";
      ws.getCell(sectionRow, 1).font = { bold: true, size: 11, color: { argb: "FF000000" } };
      ws.getRow(sectionRow).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" }, // Light grey background
      };
      ws.getRow(sectionRow).border = {
        top: { style: "medium", color: { argb: "FF94A3B8" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
      // Fill year columns
      years.forEach((_, yearIdx) => {
        ws.getCell(sectionRow, 2 + yearIdx).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE5E7EB" },
        };
      });
    }
    
    // Add category subtitle row if needed (BEFORE current row)
    // When isCategoryStart is true, we need to insert the subtitle BEFORE this item
    if (isCategoryStart && currentCategory) {
      // Insert subtitle at the position where this item would be, then push item down
      const categoryRow = baseRow + rowOffset;
      rowOffset += 1; // Increment BEFORE writing item, so item goes to next row
      ws.getCell(categoryRow, 1).value = categoryLabels[currentCategory] || currentCategory;
      ws.getCell(categoryRow, 1).font = { size: 10, color: { argb: "FF64748B" } };
      ws.getRow(categoryRow).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF8F9FA" }, // Very light grey
      };
      // Fill year columns
      years.forEach((_, yearIdx) => {
        ws.getCell(categoryRow, 2 + yearIdx).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8F9FA" },
        };
      });
    }
    
    // Add blank row after "Total Current Assets" and before first Fixed Assets item
    if (isBalanceSheet && row.id === "total_current_assets") {
      rowOffset += 1;
      // Blank row - no content needed, just spacing
    }
    
    // Now write the actual item row (after headers/subtitles/blank rows if any)
    const excelRow = baseRow + rowOffset;
    const isInput = row.kind === "input";
    const isGrossMargin = row.id === "gross_margin";
    const isEbitMargin = row.id === "ebit_margin";
    const isNetIncomeMargin = row.id === "net_income_margin";
    const isMargin = isGrossMargin || isEbitMargin || isNetIncomeMargin;
    const isPercent = row.valueType === "percent";
    const isCurrency = row.valueType === "currency";
    
    // Label with indentation and CFS signs
    const indent = "  ".repeat(depth);
    let labelText = indent + row.label;
    
    // Add CFS sign if applicable
    if (isCashFlow) {
      const cfsSection = getCFSSection(row.id, rows, parentId);
      const sign = getCFOSign(row.id, row, cfsSection || undefined, parentId);
      if (sign && (cfsSection === "operating" || cfsSection === "investing" || cfsSection === "financing")) {
        labelText = indent + `(${sign}) ` + row.label;
      }
    }
    
    ws.getCell(excelRow, 1).value = labelText;
    
    // Check for children - needed for formatting decisions
    const hasChildren = row.children && row.children.length > 0;
    
    // IB Standard Excel Formatting (top-tier IB style):
    // - Bold for section totals (CFO, CFI, CFF) and Net Change in Cash
    // - Net Change in Cash: bold + distinct background
    const isSubtotal = row.kind === "subtotal" || row.kind === "total";
    const isKeyCalculation = ["gross_profit", "ebit", "ebt", "net_income"].includes(row.id);
    const isParentWithChildren = (row.id === "rev" || row.id === "cogs" || row.id === "sga") && hasChildren;
    const isCfsSectionTotal = ["operating_cf", "investing_cf", "financing_cf"].includes(row.id);
    const isNetChangeCash = row.id === "net_change_cash";
    const shouldBeBold = isSubtotal || isKeyCalculation || isParentWithChildren || isCfsSectionTotal || isNetChangeCash;

    const rowBgColor = isNetChangeCash ? "FFF1F5F9" : "FFFFFFFF"; // Slate-100 for net change (IB bottom-line style)
    ws.getRow(excelRow).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: rowBgColor },
    };
    
    // Label styling
    if (isMargin) {
      ws.getCell(excelRow, 1).font = { 
        italic: true, 
        size: 10,
        color: { argb: "FF64748B" } // Grey for margins
      };
    } else if (shouldBeBold) {
      ws.getCell(excelRow, 1).font = { 
        bold: true,
        color: { argb: "FF000000" } // Black, bold for totals
      };
    } else {
      ws.getCell(excelRow, 1).font = { 
        color: { argb: "FF000000" } // Black for regular labels
      };
    }
    
    // Top border for key rows; double bottom for Net Change in Cash (IB bottom-line emphasis)
    if (shouldBeBold || isKeyCalculation) {
      ws.getRow(excelRow).border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        ...(isNetChangeCash ? { bottom: { style: "double", color: { argb: "FF64748B" } } } : {}),
      };
    }
    
    // Values for each year (use same computation as preview when allStatements provided)
    years.forEach((year, yearIdx) => {
      const col = 2 + yearIdx;
      const allStatements = context?.allStatements;
      const sbcBreakdowns = context?.sbcBreakdowns ?? {};
      const danaBreakdowns = context?.danaBreakdowns;
      const value =
        allStatements != null
          ? computeRowValue(row, year, rows, rows, allStatements, sbcBreakdowns, danaBreakdowns)
          : (row.values?.[year] ?? 0);
      const isLink = row.excelFormula?.includes("!") || false; // Links reference other sheets
      // hasChildren is already defined above for this row
      
      // CRITICAL: Generate formula for ANY row that should be calculated (calc rows OR input rows with children)
      // Input rows with children (Revenue, COGS, SG&A when broken down) should show SUM formulas, not hardcoded values
      const shouldHaveFormula = (!isInput && (row.kind === "calc" || row.kind === "subtotal" || row.kind === "total")) ||
                                (isInput && hasChildren); // Input rows with children need formulas too
      
      if (shouldHaveFormula) {
        try {
          // Create a function to get row offset for a given index
          const getRowOffset = (index: number): number => {
            return rowOffsets[index] || 0;
          };
          
          // Generate formula with row offsets accounted for (use names when wb/prefix provided)
          const formula = generateExcelFormula(row, yearIdx, flattened, 2, startRow, getRowOffset, useNames, prefix);
          if (formula && formula.trim()) {
            const formulaStr = formula.replace(/^=/, "").trim();
            if (formulaStr) {
              ws.getCell(excelRow, col).value = { formula: formulaStr };
              if (useNames && row.id) defineCellName(wb, sheetName, prefix, row.id, col, excelRow);
              
              const isSubtotal = row.kind === "subtotal" || row.kind === "total";
              const isKeyCalculation = ["gross_profit", "ebit", "ebt", "net_income"].includes(row.id);
              const isParentWithChildren = (row.id === "rev" || row.id === "cogs" || row.id === "sga") && hasChildren;
              const isCfsSectionTotal = ["operating_cf", "investing_cf", "financing_cf"].includes(row.id);
              const isNetChangeCashCell = row.id === "net_change_cash";
              const shouldBeBold = isSubtotal || isKeyCalculation || isParentWithChildren || isCfsSectionTotal || isNetChangeCashCell;
              
              if (isInput && hasChildren) {
                ws.getCell(excelRow, col).font = { 
                  color: { argb: "FF0066CC" }, // Blue for input rows with children
                  bold: shouldBeBold
                };
              } else if (isLink) {
                ws.getCell(excelRow, col).font = { 
                  color: { argb: "FF22C55E" }, // Green for links
                  bold: shouldBeBold
                };
              } else if (isPercent) {
                ws.getCell(excelRow, col).font = { 
                  color: { argb: "FF64748B" }, // Grey for percentages
                  italic: true,
                  size: 10
                };
              } else {
                ws.getCell(excelRow, col).font = { 
                  color: { argb: "FF000000" }, // Black for currency and other outputs (readable on white)
                  bold: shouldBeBold
                };
              }
              
              // Margins (Gross Margin, EBITDA Margin): italic and smaller font
              if (isMargin) {
                const currentFont = ws.getCell(excelRow, col).font || {};
                ws.getCell(excelRow, col).font = {
                  ...currentFont,
                  italic: true,
                  size: 10, // 1pt smaller
                };
              }
            } else {
              if (typeof value === "number") {
                const excelValue = isPercent ? value / 100 : value;
                ws.getCell(excelRow, col).value = excelValue;
                if (useNames && row.id) defineCellName(wb, sheetName, prefix, row.id, col, excelRow);
              }
            }
          } else {
            if (typeof value === "number") {
              const excelValue = isPercent ? value / 100 : value;
              ws.getCell(excelRow, col).value = excelValue;
              if (useNames && row.id) defineCellName(wb, sheetName, prefix, row.id, col, excelRow);
            }
          }
        } catch (formulaError) {
          console.error(`Error generating formula for row ${row.id}, year ${year}:`, formulaError);
          if (typeof value === "number") {
            const excelValue = isPercent ? value / 100 : value;
            ws.getCell(excelRow, col).value = excelValue;
            if (useNames && row.id) defineCellName(wb, sheetName, prefix, row.id, col, excelRow);
          }
        }
      } else if (typeof value === "number") {
        const excelValue = isPercent ? value / 100 : value;
        ws.getCell(excelRow, col).value = excelValue;
        if (useNames && row.id) defineCellName(wb, sheetName, prefix, row.id, col, excelRow);
        
        const isSubtotal = row.kind === "subtotal" || row.kind === "total";
        const isKeyCalculation = ["gross_profit", "ebit", "ebt", "net_income"].includes(row.id);
        const isParentWithChildren = (row.id === "rev" || row.id === "cogs" || row.id === "sga") && hasChildren;
        const isCfsSectionTotal = ["operating_cf", "investing_cf", "financing_cf"].includes(row.id);
        const shouldBeBold = isSubtotal || isKeyCalculation || isParentWithChildren || isCfsSectionTotal || row.id === "net_change_cash";
        
        if (isInput && hasChildren) {
          ws.getCell(excelRow, col).font = { 
            color: { argb: "FF0066CC" }, // Blue
            bold: shouldBeBold
          };
        } else if (isLink) {
          ws.getCell(excelRow, col).font = { 
            color: { argb: "FF22C55E" }, // Green
            bold: shouldBeBold
          };
        } else if (isPercent) {
          ws.getCell(excelRow, col).font = { 
            color: { argb: "FF64748B" }, // Grey
            italic: true,
            size: 10
          };
        } else {
          ws.getCell(excelRow, col).font = { 
            color: { argb: "FF000000" }, // Black (readable on white)
            bold: shouldBeBold
          };
        }
        
        if (isMargin) {
          const currentFont = ws.getCell(excelRow, col).font || {};
          ws.getCell(excelRow, col).font = {
            ...currentFont,
            italic: true,
            size: 10,
          };
        }
      } else {
        ws.getCell(excelRow, col).value = typeof value === "number" ? value : null;
        ws.getCell(excelRow, col).font = { color: { argb: "FF0066CC" } };
        if (useNames && row.id) defineCellName(wb, sheetName, prefix, row.id, col, excelRow);
      }
      
      // Cell background: match row (white, or slate for Net Change in Cash)
      const cellBg = row.id === "net_change_cash" ? "FFF1F5F9" : "FFFFFFFF";
      ws.getCell(excelRow, col).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: cellBg },
      };
      
      // Number formatting - IB standard with accounting format (negatives in parentheses)
      if (row.valueType === "currency") {
        // Accounting format: negatives in parentheses, e.g., ($1,234) or $1,234
        ws.getCell(excelRow, col).numFmt = '"$"#,##0_);("$"#,##0)';
      } else if (row.valueType === "percent") {
        // Format as percentage (Excel will display 0.755 as 75.50%)
        ws.getCell(excelRow, col).numFmt = "0.00%";
      } else if (row.valueType === "number") {
        // Accounting format for numbers too
        ws.getCell(excelRow, col).numFmt = "#,##0_);(#,##0)";
      }
      
      // Alignment
      ws.getCell(excelRow, col).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(excelRow, 1).alignment = { horizontal: "left", vertical: "middle" };
    });
  });
  
  // Column widths
  ws.getColumn(1).width = 32;
  years.forEach((_, idx) => {
    ws.getColumn(2 + idx).width = 18;
  });
  
  // Return the final row number (accounting for section headers and category subtitles)
  // Also return a map of rowId -> actual Excel row number for Balance Check
  const finalRow = startRow + 1 + flattened.length + rowOffset;
  
  // Build rowId -> Excel row number map for Balance Check (if Balance Sheet)
  const rowIdToExcelRow: Record<string, number> = {};
  if (isBalanceSheet) {
    flattened.forEach((item, i) => {
      const actualRow = startRow + 1 + i + (rowOffsets[i] || 0);
      rowIdToExcelRow[item.row.id] = actualRow;
    });
  }
  
  // Store the map in a way that exportBalanceCheckToExcel can access it
  // We'll pass it as a return value or store it on the worksheet
  if (isBalanceSheet && rowIdToExcelRow) {
    // Store in worksheet metadata (ExcelJS allows custom properties)
    (ws as any)._balanceSheetRowMap = rowIdToExcelRow;
    (ws as any)._balanceSheetHeaderRow = startRow;
  }
  
  return finalRow;
}

/**
 * Export SBC Disclosure to Excel worksheet (10-K style)
 */
export function exportSbcDisclosureToExcel(
  ws: any,
  incomeStatement: Row[],
  sbcBreakdowns: Record<string, Record<string, number>>,
  years: string[],
  startRow: number,
  currencyUnit?: string
): number {
  const sgaRow = incomeStatement.find((r) => r.id === "sga");
  const cogsRow = incomeStatement.find((r) => r.id === "cogs");
  const rdRow = incomeStatement.find((r) => r.id === "rd");
  const sgaBreakdowns = sgaRow?.children ?? [];
  const cogsBreakdowns = cogsRow?.children ?? [];
  const rdBreakdowns = rdRow?.children ?? [];
  const hasSgaBreakdowns = sgaBreakdowns.length > 0;
  const hasCogsBreakdowns = cogsBreakdowns.length > 0;
  const hasRdBreakdowns = rdBreakdowns.length > 0;
  
  // Helper to get SBC value
  const getSbcValue = (categoryId: string, year: string): number => {
    return sbcBreakdowns[categoryId]?.[year] ?? 0;
  };
  
  // Check if there's any SBC data to show
  let hasAnySbc = false;
  years.forEach((y) => {
    if (hasSgaBreakdowns) {
      sgaBreakdowns.forEach((b) => {
        if (getSbcValue(b.id, y) !== 0) hasAnySbc = true;
      });
    } else {
      if (getSbcValue("sga", y) !== 0) hasAnySbc = true;
    }
    if (hasCogsBreakdowns) {
      cogsBreakdowns.forEach((b) => {
        if (getSbcValue(b.id, y) !== 0) hasAnySbc = true;
      });
    } else {
      if (getSbcValue("cogs", y) !== 0) hasAnySbc = true;
    }
    if (hasRdBreakdowns) {
      rdBreakdowns.forEach((b) => {
        if (getSbcValue(b.id, y) !== 0) hasAnySbc = true;
      });
    } else {
      if (getSbcValue("rd", y) !== 0) hasAnySbc = true;
    }
  });
  
  if (!hasAnySbc) return startRow; // Skip if no SBC data
  
  // Add spacing
  startRow += 2;
  
  // Title
  ws.getCell(startRow, 1).value = "Stock-Based Compensation Expense";
  ws.getCell(startRow, 1).font = { bold: true, size: 11, color: { argb: "FFFFD700" } };
  startRow += 1;
  
  // Note
  ws.getCell(startRow, 1).value = "Amounts include stock-based compensation expense, as follows:";
  ws.getCell(startRow, 1).font = { italic: true, size: 10, color: { argb: "FFFFD700" } };
  startRow += 1;
  
  // Headers
  ws.getCell(startRow, 1).value = "Category";
  years.forEach((year, idx) => {
    ws.getCell(startRow, 2 + idx).value = year;
  });
  ws.getRow(startRow).font = { bold: true, color: { argb: "FFFFD700" } };
  ws.getRow(startRow).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF78350F" }, // Dark amber background
  };
  startRow += 1;
  
  // Track row numbers for SBC components to build formulas
  const sbcComponentRows: number[] = [];
  
  // Helper to get column letter (A=1, B=2, etc.)
  const getColumnLetter = (col: number): string => {
    let result = "";
    while (col > 0) {
      col--;
      result = String.fromCharCode(65 + (col % 26)) + result;
      col = Math.floor(col / 26);
    }
    return result;
  };
  
  // COGS SBC
  if (hasCogsBreakdowns) {
    cogsBreakdowns.forEach((breakdown) => {
      const breakdownSbc = years.map((y) => getSbcValue(breakdown.id, y));
      if (breakdownSbc.some(v => v !== 0)) {
        ws.getCell(startRow, 1).value = `Cost of revenues — ${breakdown.label}`;
        years.forEach((y, idx) => {
          const storedValue = getSbcValue(breakdown.id, y);
          // Convert stored value to display value for Excel (SBC values are stored in same format as IS values)
          const displayValue = currencyUnit && currencyUnit !== "units" 
            ? storedToDisplay(storedValue, currencyUnit as CurrencyUnit)
            : storedValue;
          ws.getCell(startRow, 2 + idx).value = displayValue;
          ws.getCell(startRow, 2 + idx).numFmt = '"$"#,##0_);("$"#,##0)';
        });
        ws.getRow(startRow).font = { color: { argb: "FFFFD700" } };
        sbcComponentRows.push(startRow); // Track this row for total formula
        startRow += 1;
      }
    });
  } else {
    const cogsSbc = years.map((y) => getSbcValue("cogs", y));
    if (cogsSbc.some(v => v !== 0)) {
      ws.getCell(startRow, 1).value = "Cost of revenues";
      years.forEach((y, idx) => {
        const storedValue = getSbcValue("cogs", y);
        const displayValue = currencyUnit && currencyUnit !== "units" 
          ? storedToDisplay(storedValue, currencyUnit as CurrencyUnit)
          : storedValue;
        ws.getCell(startRow, 2 + idx).value = displayValue;
        ws.getCell(startRow, 2 + idx).numFmt = '"$"#,##0';
      });
      ws.getRow(startRow).font = { color: { argb: "FFFFD700" } };
      sbcComponentRows.push(startRow); // Track this row for total formula
      startRow += 1;
    }
  }
  
  // SG&A SBC
  if (hasSgaBreakdowns) {
    sgaBreakdowns.forEach((breakdown) => {
      const breakdownSbc = years.map((y) => getSbcValue(breakdown.id, y));
      if (breakdownSbc.some(v => v !== 0)) {
        ws.getCell(startRow, 1).value = breakdown.label;
        years.forEach((y, idx) => {
          const storedValue = getSbcValue(breakdown.id, y);
          const displayValue = currencyUnit && currencyUnit !== "units" 
            ? storedToDisplay(storedValue, currencyUnit as CurrencyUnit)
            : storedValue;
          ws.getCell(startRow, 2 + idx).value = displayValue;
          ws.getCell(startRow, 2 + idx).numFmt = '"$"#,##0_);("$"#,##0)';
        });
        ws.getRow(startRow).font = { color: { argb: "FFFFD700" } };
        sbcComponentRows.push(startRow); // Track this row for total formula
        startRow += 1;
      }
    });
  } else {
    const sgaSbc = years.map((y) => getSbcValue("sga", y));
    if (sgaSbc.some(v => v !== 0)) {
      ws.getCell(startRow, 1).value = "Selling, General & Administrative";
      years.forEach((y, idx) => {
        const storedValue = getSbcValue("sga", y);
        const displayValue = currencyUnit && currencyUnit !== "units" 
          ? storedToDisplay(storedValue, currencyUnit as CurrencyUnit)
          : storedValue;
        ws.getCell(startRow, 2 + idx).value = displayValue;
        ws.getCell(startRow, 2 + idx).numFmt = '"$"#,##0';
      });
      ws.getRow(startRow).font = { color: { argb: "FFFFD700" } };
      sbcComponentRows.push(startRow); // Track this row for total formula
      startRow += 1;
    }
  }
  
  // R&D SBC
  if (hasRdBreakdowns) {
    rdBreakdowns.forEach((breakdown) => {
      const breakdownSbc = years.map((y) => getSbcValue(breakdown.id, y));
      if (breakdownSbc.some(v => v !== 0)) {
        ws.getCell(startRow, 1).value = breakdown.label;
        years.forEach((y, idx) => {
          const storedValue = getSbcValue(breakdown.id, y);
          const displayValue = currencyUnit && currencyUnit !== "units" 
            ? storedToDisplay(storedValue, currencyUnit as CurrencyUnit)
            : storedValue;
          ws.getCell(startRow, 2 + idx).value = displayValue;
          ws.getCell(startRow, 2 + idx).numFmt = '"$"#,##0_);("$"#,##0)';
        });
        ws.getRow(startRow).font = { color: { argb: "FFFFD700" } };
        sbcComponentRows.push(startRow);
        startRow += 1;
      }
    });
  } else {
    const rdSbc = years.map((y) => getSbcValue("rd", y));
    if (rdSbc.some(v => v !== 0)) {
      ws.getCell(startRow, 1).value = "Research and development";
      years.forEach((y, idx) => {
        const storedValue = getSbcValue("rd", y);
        const displayValue = currencyUnit && currencyUnit !== "units" 
          ? storedToDisplay(storedValue, currencyUnit as CurrencyUnit)
          : storedValue;
        ws.getCell(startRow, 2 + idx).value = displayValue;
        ws.getCell(startRow, 2 + idx).numFmt = '"$"#,##0';
      });
      ws.getRow(startRow).font = { color: { argb: "FFFFD700" } };
      sbcComponentRows.push(startRow);
      startRow += 1;
    }
  }
  
  // Total SBC (with formula that sums all component rows)
  if (sbcComponentRows.length > 0) {
    ws.getCell(startRow, 1).value = "Total stock-based compensation expense";
    ws.getCell(startRow, 1).font = { bold: true, color: { argb: "FFFFD700" } };
    years.forEach((y, idx) => {
      const col = 2 + idx; // Column B=2, C=3, etc.
      const colLetter = getColumnLetter(col);
      
      // Build SUM formula that references all component rows for this column
      const cellReferences = sbcComponentRows.map(rowNum => `${colLetter}${rowNum}`);
      const formula = `=SUM(${cellReferences.join(",")})`;
      
      ws.getCell(startRow, col).value = { formula: formula };
      ws.getCell(startRow, col).numFmt = '"$"#,##0_);("$"#,##0)';
      ws.getCell(startRow, col).font = { bold: true, color: { argb: "FFFFD700" } };
    });
    startRow += 1;
  }
  
  return startRow;
}

/**
 * Export Balance Check to Excel worksheet
 * When statementPrefix (e.g. "BS") is provided, formulas reference defined names so they stay correct if rows are reordered.
 */
export function exportBalanceCheckToExcel(
  ws: any,
  balanceSheet: Row[],
  years: string[],
  startRow: number,
  bsStartRow: number,
  currencyUnit?: string,
  statementPrefix?: string
): number {
  if (!balanceSheet || balanceSheet.length === 0) {
    return startRow;
  }
  if (!years || years.length === 0) {
    return startRow;
  }

  const { checkBalanceSheetBalance } = require("./calculations");
  const balanceCheck = checkBalanceSheetBalance(balanceSheet, years) as Array<{
    year: string;
    balances: boolean;
    totalAssets: number;
    totalLiabAndEquity: number;
    difference: number;
  }>;
  const hasAnyData = balanceCheck.some((b) => b.totalAssets !== 0 || b.totalLiabAndEquity !== 0);
  if (!hasAnyData) {
    return startRow;
  }

  const rowMap = (ws as any)._balanceSheetRowMap as Record<string, number> | undefined;
  let totalAssetsBSRow: number | null = null;
  let totalLiabEquityBSRow: number | null = null;

  if (rowMap) {
    totalAssetsBSRow = rowMap["total_assets"] || null;
    totalLiabEquityBSRow = rowMap["total_liab_and_equity"] || null;
  } else {
    // Fallback: use the same flattenRows logic as exportStatementToExcel
    // This ensures consistency even if the map wasn't stored
    const flattened = flattenRows(balanceSheet, 0, { forStatement: "balance" }, null);
    const findBSRowNumber = (targetId: string): number | null => {
      for (let i = 0; i < flattened.length; i++) {
        if (flattened[i].row.id === targetId) {
          // Account for section headers/category subtitles by checking offsets
          // But we don't have the offset map here, so use bsStartRow as fallback
          // This is not ideal but better than nothing
          return bsStartRow + i;
        }
      }
      return null;
    };

    totalAssetsBSRow = findBSRowNumber("total_assets");
    totalLiabEquityBSRow = findBSRowNumber("total_liab_and_equity");
  }

  // When using names we don't need row numbers for the BS refs; otherwise we do
  if (!statementPrefix && (!totalAssetsBSRow || !totalLiabEquityBSRow)) {
    return startRow;
  }

  // Add spacing
  startRow += 2;
  
  // Balance Check Header
  ws.getCell(startRow, 1).value = "Balance Check";
  ws.getCell(startRow, 1).font = { bold: true, size: 12, color: { argb: "FF000000" } };
  ws.getRow(startRow).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFFFFF" },
  };
  startRow += 1;

  // Note
  ws.getCell(startRow, 1).value = "Total Assets must equal Total Liabilities + Total Equity";
  ws.getCell(startRow, 1).font = { italic: true, size: 10, color: { argb: "FF666666" } };
  startRow += 1;

  // Total Assets row: use defined name when statementPrefix set, else cell ref
  const totalAssetsCheckRow = startRow;
  ws.getCell(startRow, 1).value = "Total Assets";
  ws.getCell(startRow, 1).font = { bold: true, color: { argb: "FF000000" } };
  years.forEach((y, idx) => {
    const col = 2 + idx;
    const colLetter = getColumnLetter(col);
    const formula = statementPrefix
      ? `=${getCellName(statementPrefix, "total_assets", colLetter)}`
      : `=${colLetter}${totalAssetsBSRow}`;
    ws.getCell(startRow, col).value = { formula };
    ws.getCell(startRow, col).numFmt = '"$"#,##0_);("$"#,##0)';
    ws.getCell(startRow, col).font = { bold: true, color: { argb: "FF000000" } };
  });
  startRow += 1;

  const totalLiabEquityCheckRow = startRow;
  ws.getCell(startRow, 1).value = "Total Liabilities + Equity";
  ws.getCell(startRow, 1).font = { bold: true, color: { argb: "FF000000" } };
  years.forEach((y, idx) => {
    const col = 2 + idx;
    const colLetter = getColumnLetter(col);
    const formula = statementPrefix
      ? `=${getCellName(statementPrefix, "total_liab_and_equity", colLetter)}`
      : `=${colLetter}${totalLiabEquityBSRow}`;
    ws.getCell(startRow, col).value = { formula };
    ws.getCell(startRow, col).numFmt = '"$"#,##0_);("$"#,##0)';
    ws.getCell(startRow, col).font = { bold: true, color: { argb: "FF000000" } };
  });
  startRow += 1;

  const allBalanced = balanceCheck.every((b) => b.balances);
  if (!allBalanced) {
    ws.getCell(startRow, 1).value = "Difference (Out of Balance)";
    ws.getCell(startRow, 1).font = { bold: true, color: { argb: "FFFF0000" } };
    
    years.forEach((y, idx) => {
      const col = 2 + idx;
      const colLetter = getColumnLetter(col);
      // Formula: =Total Assets - Total Liabilities + Equity
      const formula = `=${colLetter}${totalAssetsCheckRow}-${colLetter}${totalLiabEquityCheckRow}`;
      ws.getCell(startRow, col).value = { formula: formula };
      ws.getCell(startRow, col).numFmt = '"$"#,##0_);("$"#,##0)';
      ws.getCell(startRow, col).font = { bold: true, color: { argb: "FFFF0000" } };
    });
    startRow += 1;
  }

  // Balance Status row
  ws.getCell(startRow, 1).value = "Balance Status";
  ws.getCell(startRow, 1).font = { bold: true, color: { argb: "FF000000" } };
  
  years.forEach((y, idx) => {
    const col = 2 + idx;
    const colLetter = getColumnLetter(col);
    // Formula: =IF(ABS(Total Assets - Total Liabilities + Equity) < 0.01, "BALANCED", "OUT OF BALANCE")
    const formula = `=IF(ABS(${colLetter}${totalAssetsCheckRow}-${colLetter}${totalLiabEquityCheckRow})<0.01,"BALANCED","OUT OF BALANCE")`;
    ws.getCell(startRow, col).value = { formula: formula };
    ws.getCell(startRow, col).font = { bold: true };
  });
  startRow += 1;

  return startRow;
}
