/**
 * Excel Export Utility
 * 
 * Converts the financial model state into an Excel workbook with:
 * - IB-grade formatting (blue inputs, black formulas)
 * - Actual formulas in cells
 * - Proper number formatting
 */

import type { Row } from "@/types/finance";
import { generateExcelFormula } from "./excel-formulas";

function flattenRows(rows: Row[], depth = 0): Array<{ row: Row; depth: number }> {
  const out: Array<{ row: Row; depth: number }> = [];
  for (const r of rows) {
    out.push({ row: r, depth });
    if (r.children?.length) out.push(...flattenRows(r.children, depth + 1));
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
  currencyUnit?: string
): number {
  const flattened = flattenRows(rows);
  
  // Add currency unit note if provided (only applies to currency values)
  if (currencyUnit && currencyUnit !== "units") {
    const unitLabel = currencyUnit === "millions" ? "M" : currencyUnit === "thousands" ? "K" : "";
    if (unitLabel) {
      ws.getCell(startRow, 1).value = `All currency amounts in ${unitLabel} (${currencyUnit}). Other values (shares, percentages, etc.) are in actual units.`;
      ws.getCell(startRow, 1).font = { italic: true, color: { argb: "FF94A3B8" }, size: 10 };
      startRow += 1;
    }
  }
  
  // Headers
  ws.getCell(startRow, 1).value = "Line Item";
  years.forEach((year, idx) => {
    ws.getCell(startRow, 2 + idx).value = year;
  });
  
  // Style header row
  ws.getRow(startRow).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(startRow).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };
  
  // Data rows
  flattened.forEach(({ row, depth }, idx) => {
    const excelRow = startRow + 1 + idx;
    const isInput = row.kind === "input";
    const isGrossMargin = row.id === "gross_margin";
    const isEbitdaMargin = row.id === "ebitda_margin";
    const isMargin = isGrossMargin || isEbitdaMargin;
    const isPercent = row.valueType === "percent";
    const isCurrency = row.valueType === "currency";
    
    // Label with indentation
    const indent = "  ".repeat(depth);
    ws.getCell(excelRow, 1).value = indent + row.label;
    
    // Label styling: Margins (Gross Margin, EBITDA Margin) in italic, smaller font, light grey
    if (isMargin) {
      ws.getCell(excelRow, 1).font = { 
        italic: true, 
        size: 10, // 1pt smaller (default is 11)
        color: { argb: "FF94A3B8" } // Light grey
      };
    } else {
      ws.getCell(excelRow, 1).font = { color: { argb: "FFE2E8F0" } }; // White for labels
    }
    
    // Values for each year
    years.forEach((year, yearIdx) => {
      const col = 2 + yearIdx;
      const value = row.values?.[year];
      const isLink = row.excelFormula?.includes("!") || false; // Links reference other sheets
      
      // Generate formula if it's a calc row
      if (!isInput && (row.kind === "calc" || row.kind === "subtotal" || row.kind === "total")) {
        const formula = generateExcelFormula(row, yearIdx, flattened, 2);
        if (formula) {
          ws.getCell(excelRow, col).value = { formula: formula.replace(/^=/, "") };
          
          // IB styling rules:
          // - Links (from other sheets): green
          // - Percent outputs: grey
          // - Currency outputs: white
          // - Other outputs: white
          if (isLink) {
            ws.getCell(excelRow, col).font = { color: { argb: "FF22C55E" } }; // Green for links
          } else if (isPercent) {
            ws.getCell(excelRow, col).font = { color: { argb: "FF94A3B8" } }; // Grey for percentages
          } else {
            ws.getCell(excelRow, col).font = { color: { argb: "FFFFFFFF" } }; // White for currency and other outputs
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
        } else if (typeof value === "number") {
          // For percentages, Excel expects decimal (0.755 for 75.5%), so divide by 100
          const excelValue = isPercent ? value / 100 : value;
          ws.getCell(excelRow, col).value = excelValue;
          
          // Apply same color rules
          if (isLink) {
            ws.getCell(excelRow, col).font = { color: { argb: "FF22C55E" } };
          } else if (isPercent) {
            ws.getCell(excelRow, col).font = { color: { argb: "FF94A3B8" } };
          } else {
            ws.getCell(excelRow, col).font = { color: { argb: "FFFFFFFF" } };
          }
          
          if (isGrossMargin) {
            const currentFont = ws.getCell(excelRow, col).font || {};
            ws.getCell(excelRow, col).font = {
              ...currentFont,
              italic: true,
              size: 10,
            };
          }
        }
      } else {
        // Input value (blue)
        ws.getCell(excelRow, col).value = typeof value === "number" ? value : null;
        ws.getCell(excelRow, col).font = { color: { argb: "FF2563EB" } }; // Blue for inputs
      }
      
      // Number formatting
      if (row.valueType === "currency") {
        ws.getCell(excelRow, col).numFmt = '"$"#,##0';
      } else if (row.valueType === "percent") {
        ws.getCell(excelRow, col).numFmt = "0.00%";
      } else if (row.valueType === "number") {
        ws.getCell(excelRow, col).numFmt = "#,##0";
      }
    });
  });
  
  // Column widths
  ws.getColumn(1).width = 32;
  years.forEach((_, idx) => {
    ws.getColumn(2 + idx).width = 18;
  });
  
  return startRow + 1 + flattened.length;
}
