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
import { generateExcelFormula } from "./excel-formulas";
import { storedToDisplay } from "./currency-utils";

function flattenRows(rows: Row[], depth = 0): Array<{ row: Row; depth: number }> {
  const out: Array<{ row: Row; depth: number }> = [];
  for (const r of rows) {
    // Skip EBITDA, EBITDA Margin, and SBC rows (removed from IS - SBC is shown as disclosure only)
    if (r.id === "ebitda" || r.id === "ebitda_margin" || r.id === "sbc") {
      continue;
    }
    out.push({ row: r, depth });
    if (r.children?.length) {
      // Also filter out EBITDA/EBITDA Margin and SBC from children
      const filteredChildren = r.children.filter(child => 
        child.id !== "ebitda" && child.id !== "ebitda_margin" && child.id !== "sbc"
      );
      if (filteredChildren.length > 0) {
        out.push(...flattenRows(filteredChildren, depth + 1));
      }
    }
  }
  return out;
}

/**
 * Export Income Statement to Excel worksheet
 */
export function exportStatementToExcel(
  ws: any,
  rows: Row[],
  years: string[],
  startRow: number = 1,
  currencyUnit?: string,
  statementLabel?: string,
  isFirstStatement: boolean = true
): number {
  if (!rows || rows.length === 0) {
    return startRow;
  }
  if (!years || years.length === 0) {
    return startRow;
  }
  const flattened = flattenRows(rows);
  
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
  
  // Data rows
  flattened.forEach(({ row, depth }, idx) => {
    const excelRow = startRow + 1 + idx;
    const isInput = row.kind === "input";
    const isGrossMargin = row.id === "gross_margin";
    const isEbitMargin = row.id === "ebit_margin";
    const isNetIncomeMargin = row.id === "net_income_margin";
    const isMargin = isGrossMargin || isEbitMargin || isNetIncomeMargin;
    const isPercent = row.valueType === "percent";
    const isCurrency = row.valueType === "currency";
    
    // Label with indentation
    const indent = "  ".repeat(depth);
    ws.getCell(excelRow, 1).value = indent + row.label;
    
    // Check for children - needed for formatting decisions
    const hasChildren = row.children && row.children.length > 0;
    
    // IB Standard Excel Formatting:
    // - White background for all rows
    // - Black text for labels (readable on white)
    // - Margins: italic, smaller font, grey text
    // - Bold for totals and key calculations
    const isSubtotal = row.kind === "subtotal" || row.kind === "total";
    const isKeyCalculation = ["gross_profit", "ebit", "ebt", "net_income"].includes(row.id);
    const isParentWithChildren = (row.id === "rev" || row.id === "cogs" || row.id === "sga") && hasChildren;
    const shouldBeBold = isSubtotal || isKeyCalculation || isParentWithChildren;
    
    // Set row background to white
    ws.getRow(excelRow).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFFFF" }, // White background
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
    
    // Add top border for key rows (like in preview)
    if (shouldBeBold || isKeyCalculation) {
      ws.getRow(excelRow).border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
    }
    
    // Values for each year
    years.forEach((year, yearIdx) => {
      const col = 2 + yearIdx;
      const value = row.values?.[year];
      const isLink = row.excelFormula?.includes("!") || false; // Links reference other sheets
      // hasChildren is already defined above for this row
      
      // CRITICAL: Generate formula for ANY row that should be calculated (calc rows OR input rows with children)
      // Input rows with children (Revenue, COGS, SG&A when broken down) should show SUM formulas, not hardcoded values
      const shouldHaveFormula = (!isInput && (row.kind === "calc" || row.kind === "subtotal" || row.kind === "total")) ||
                                (isInput && hasChildren); // Input rows with children need formulas too
      
      if (shouldHaveFormula) {
        try {
          const formula = generateExcelFormula(row, yearIdx, flattened, 2, startRow);
          if (formula && formula.trim()) {
            // ExcelJS expects formula without the leading =
            const formulaStr = formula.replace(/^=/, "").trim();
            if (formulaStr) {
              ws.getCell(excelRow, col).value = { formula: formulaStr };
              
              // IB Standard Excel Formatting (white background):
              // - Input rows with children: blue text (they're still inputs, just calculated from children)
              // - Links (from other sheets): green text
              // - Percent outputs: black text (readable on white)
              // - Currency outputs: black text (readable on white)
              // - Bold for totals and key calculations
              const isSubtotal = row.kind === "subtotal" || row.kind === "total";
              const isKeyCalculation = ["gross_profit", "ebit", "ebt", "net_income"].includes(row.id);
              const isParentWithChildren = (row.id === "rev" || row.id === "cogs" || row.id === "sga") && hasChildren;
              const shouldBeBold = isSubtotal || isKeyCalculation || isParentWithChildren;
              
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
              // Formula was empty or invalid, fall through to value assignment
              if (typeof value === "number") {
                const excelValue = isPercent ? value / 100 : value;
                ws.getCell(excelRow, col).value = excelValue;
              }
            }
          } else {
            // No formula generated, use value
            if (typeof value === "number") {
              const excelValue = isPercent ? value / 100 : value;
              ws.getCell(excelRow, col).value = excelValue;
            }
          }
        } catch (formulaError) {
          console.error(`Error generating formula for row ${row.id}, year ${year}:`, formulaError);
          // Fallback to value if formula generation fails
          if (typeof value === "number") {
            const excelValue = isPercent ? value / 100 : value;
            ws.getCell(excelRow, col).value = excelValue;
          }
        }
      } else if (typeof value === "number") {
        // Fallback: if no formula generated, use the calculated value
        // For percentages, Excel expects decimal (0.755 for 75.5%), so divide by 100
        const excelValue = isPercent ? value / 100 : value;
        ws.getCell(excelRow, col).value = excelValue;
        
        // Apply same color rules (with white background)
        const isSubtotal = row.kind === "subtotal" || row.kind === "total";
        const isKeyCalculation = ["gross_profit", "ebit", "ebt", "net_income"].includes(row.id);
        const isParentWithChildren = (row.id === "rev" || row.id === "cogs" || row.id === "sga") && hasChildren;
        const shouldBeBold = isSubtotal || isKeyCalculation || isParentWithChildren;
        
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
        // Pure input value (no children, no calculation) - blue text on white background
        ws.getCell(excelRow, col).value = typeof value === "number" ? value : null;
        ws.getCell(excelRow, col).font = { color: { argb: "FF0066CC" } }; // Blue for inputs
      }
      
      // Ensure cell background is white
      ws.getCell(excelRow, col).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFFFF" }, // White background
      };
      
      // Number formatting - IB standard
      if (row.valueType === "currency") {
        // Format as currency with thousands separator
        ws.getCell(excelRow, col).numFmt = '"$"#,##0';
      } else if (row.valueType === "percent") {
        // Format as percentage (Excel will display 0.755 as 75.50%)
        ws.getCell(excelRow, col).numFmt = "0.00%";
      } else if (row.valueType === "number") {
        ws.getCell(excelRow, col).numFmt = "#,##0";
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
  
  return startRow + 1 + flattened.length;
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
  const sgaBreakdowns = sgaRow?.children ?? [];
  const cogsBreakdowns = cogsRow?.children ?? [];
  const hasSgaBreakdowns = sgaBreakdowns.length > 0;
  const hasCogsBreakdowns = cogsBreakdowns.length > 0;
  
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
          ws.getCell(startRow, 2 + idx).numFmt = '"$"#,##0';
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
          ws.getCell(startRow, 2 + idx).numFmt = '"$"#,##0';
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
      ws.getCell(startRow, col).numFmt = '"$"#,##0';
      ws.getCell(startRow, col).font = { bold: true, color: { argb: "FFFFD700" } };
    });
    startRow += 1;
  }
  
  return startRow;
}

/**
 * Export Balance Check to Excel worksheet
 * Shows Total Assets, Total Liabilities + Equity, Difference, and Balance Status
 * @param bsStartRow The Excel row number where the Balance Sheet data starts (after headers)
 */
export function exportBalanceCheckToExcel(
  ws: any,
  balanceSheet: Row[],
  years: string[],
  startRow: number,
  bsStartRow: number, // Balance Sheet data start row
  currencyUnit?: string
): number {
  if (!balanceSheet || balanceSheet.length === 0) {
    return startRow;
  }
  if (!years || years.length === 0) {
    return startRow;
  }

  // Import checkBalanceSheetBalance dynamically to avoid circular dependency
  const { checkBalanceSheetBalance } = require("./calculations");
  const balanceCheck = checkBalanceSheetBalance(balanceSheet, years);
  
  const hasAnyData = balanceCheck.some(b => b.totalAssets !== 0 || b.totalLiabAndEquity !== 0);
  if (!hasAnyData) {
    return startRow;
  }

  // Helper to get column letter
  const getColumnLetter = (col: number): string => {
    let result = "";
    let temp = col;
    while (temp > 0) {
      temp--;
      result = String.fromCharCode(65 + (temp % 26)) + result;
      temp = Math.floor(temp / 26);
    }
    return result;
  };

  // Find the row numbers for total_assets and total_liab_and_equity in the balance sheet
  function flattenRows(rows: Row[], depth = 0): Array<{ row: Row; depth: number }> {
    const out: Array<{ row: Row; depth: number }> = [];
    for (const r of rows) {
      out.push({ row: r, depth });
      if (r.children?.length) out.push(...flattenRows(r.children, depth + 1));
    }
    return out;
  }
  
  const flattened = flattenRows(balanceSheet);
  const findBSRowNumber = (targetId: string): number | null => {
    for (let i = 0; i < flattened.length; i++) {
      if (flattened[i].row.id === targetId) {
        // bsStartRow is already the first data row, so just add the index
        return bsStartRow + i;
      }
    }
    return null;
  };

  const totalAssetsBSRow = findBSRowNumber("total_assets");
  const totalLiabEquityBSRow = findBSRowNumber("total_liab_and_equity");
  
  if (!totalAssetsBSRow || !totalLiabEquityBSRow) {
    // If we can't find the rows, skip balance check
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

  // Total Assets row (with formula referencing balance sheet)
  const totalAssetsCheckRow = startRow;
  ws.getCell(startRow, 1).value = "Total Assets";
  ws.getCell(startRow, 1).font = { bold: true, color: { argb: "FF000000" } };
  
  years.forEach((y, idx) => {
    const col = 2 + idx;
    const colLetter = getColumnLetter(col);
    // Formula references the total_assets row in the balance sheet
    const formula = `=${colLetter}${totalAssetsBSRow}`;
    ws.getCell(startRow, col).value = { formula: formula };
    ws.getCell(startRow, col).numFmt = '"$"#,##0';
    ws.getCell(startRow, col).font = { bold: true, color: { argb: "FF000000" } };
  });
  startRow += 1;

  // Total Liabilities + Equity row (with formula)
  const totalLiabEquityCheckRow = startRow;
  ws.getCell(startRow, 1).value = "Total Liabilities + Equity";
  ws.getCell(startRow, 1).font = { bold: true, color: { argb: "FF000000" } };
  
  years.forEach((y, idx) => {
    const col = 2 + idx;
    const colLetter = getColumnLetter(col);
    // Formula references the total_liab_and_equity row in the balance sheet
    const formula = `=${colLetter}${totalLiabEquityBSRow}`;
    ws.getCell(startRow, col).value = { formula: formula };
    ws.getCell(startRow, col).numFmt = '"$"#,##0';
    ws.getCell(startRow, col).font = { bold: true, color: { argb: "FF000000" } };
  });
  startRow += 1;

  // Difference row (only show if not balanced)
  const allBalanced = balanceCheck.every(b => b.balances);
  if (!allBalanced) {
    ws.getCell(startRow, 1).value = "Difference (Out of Balance)";
    ws.getCell(startRow, 1).font = { bold: true, color: { argb: "FFFF0000" } };
    
    years.forEach((y, idx) => {
      const col = 2 + idx;
      const colLetter = getColumnLetter(col);
      // Formula: =Total Assets - Total Liabilities + Equity
      const formula = `=${colLetter}${totalAssetsCheckRow}-${colLetter}${totalLiabEquityCheckRow}`;
      ws.getCell(startRow, col).value = { formula: formula };
      ws.getCell(startRow, col).numFmt = '"$"#,##0';
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
