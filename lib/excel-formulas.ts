/**
 * Excel Formula Generator
 * 
 * Converts row relationships into Excel formulas (e.g., "=B2-B3")
 * Uses IB standards: blue for inputs, black for formulas
 */

import type { Row } from "@/types/finance";

/**
 * Get Excel column letter from index (1 = A, 2 = B, etc.)
 */
export function getColumnLetter(col: number): string {
  let result = "";
  while (col > 0) {
    col--;
    result = String.fromCharCode(65 + (col % 26)) + result;
    col = Math.floor(col / 26);
  }
  return result;
}

/**
 * Get Excel cell address from row and column indices
 */
function getCellAddress(row: number, col: number): string {
  return `${getColumnLetter(col)}${row}`;
}

/** Excel Name Manager: sanitize row id for use in defined names (letters, numbers, underscore only) */
export function sanitizeIdForExcel(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Get the defined name for a cell (used when useNames is true so formulas survive reordering) */
export function getCellName(statementPrefix: string, rowId: string, colLetter: string): string {
  return `FM_${statementPrefix}_${sanitizeIdForExcel(rowId)}_${colLetter}`;
}

/** Return either a name reference or cell address for use in formulas */
function cellRef(
  rowNum: number | null,
  rowId: string,
  yearCol: number,
  yearColLetter: string,
  useNames: boolean,
  statementPrefix: string
): string {
  if (useNames && statementPrefix && rowNum != null) {
    return getCellName(statementPrefix, rowId, yearColLetter);
  }
  return rowNum != null ? getCellAddress(rowNum, yearCol) : "";
}

/**
 * Find the Excel row number for a given row ID in a flattened list
 * @param rowOffsets Optional map of row index -> offset (for section headers/category subtitles)
 */
function findExcelRowNumber(
  rows: Array<{ row: Row; depth: number }>,
  targetId: string,
  startRow: number = 1,
  rowOffsets?: (index: number) => number
): number | null {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].row.id === targetId) {
      // startRow is the header row, so data rows start at startRow + 1
      // Index i=0 is the first data row, so it's at startRow + 1 + 0 = startRow + 1
      const offset = rowOffsets ? rowOffsets(i) : 0;
      return startRow + 1 + i + offset;
    }
  }
  return null;
}

/**
 * Generate Excel formula for a row based on its type and relationships.
 * When useNames and statementPrefix are set, formulas use defined names (e.g. FM_BS_cash_B)
 * so that reordering in the web app still produces correct Excel formulas.
 */
export function generateExcelFormula(
  row: Row,
  yearIndex: number,
  flattenedRows: Array<{ row: Row; depth: number }>,
  startCol: number = 2, // Column B (after label column)
  startRow: number = 1, // Header row number
  rowOffsets?: (index: number) => number,
  useNames?: boolean,
  statementPrefix?: string
): string | null {
  const rowId = row.id;
  const excelRow = findExcelRowNumber(flattenedRows, rowId, startRow, rowOffsets);
  if (!excelRow) return null;

  const yearCol = startCol + yearIndex;
  const yearColLetter = getColumnLetter(yearCol);
  const useNameRefs = !!(useNames && statementPrefix);

  // If it has children, sum them (CRITICAL: Only sum direct children, never include parent row itself)
  if (row.children && row.children.length > 0) {
    const childAddresses: string[] = [];
    const parentIndex = flattenedRows.findIndex(r => r.row.id === rowId);
    if (parentIndex === -1) return null;

    for (const child of row.children) {
      const childIndex = flattenedRows.findIndex(r => r.row.id === child.id);
      if (childIndex !== -1 && childIndex > parentIndex) {
        const childRowNum = findExcelRowNumber(flattenedRows, child.id, startRow, rowOffsets);
        if (childRowNum) {
          childAddresses.push(cellRef(childRowNum, child.id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
        }
      }
    }

    if (childAddresses.length > 0) {
      return `=${childAddresses.join("+")}`;
    }
  }

  // Standard IB formulas based on row ID
  // Income Statement
  if (rowId === "gross_profit") {
    const revRow = findExcelRowNumber(flattenedRows, "rev", startRow, rowOffsets);
    const cogsRow = findExcelRowNumber(flattenedRows, "cogs", startRow, rowOffsets);
    if (revRow && cogsRow) {
      return `=${cellRef(revRow, "rev", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}-${cellRef(cogsRow, "cogs", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`;
    }
  }

  if (rowId === "gross_margin") {
    const gpRow = findExcelRowNumber(flattenedRows, "gross_profit", startRow, rowOffsets);
    const revRow = findExcelRowNumber(flattenedRows, "rev", startRow, rowOffsets);
    if (gpRow && revRow) {
      return `=IF(${cellRef(revRow, "rev", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}=0,0,${cellRef(gpRow, "gross_profit", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}/${cellRef(revRow, "rev", yearCol, yearColLetter, useNameRefs, statementPrefix || "")})`;
    }
  }

  if (rowId === "ebitda") {
    const gpRow = findExcelRowNumber(flattenedRows, "gross_profit", startRow, rowOffsets);
    const sgaRow = findExcelRowNumber(flattenedRows, "sga", startRow, rowOffsets);
    
    // Check if R&D and Other Opex are children of SG&A by looking at the flattened structure
    const sgaFlattenedRow = flattenedRows.find(r => r.row.id === "sga");
    const rdIsChildOfSga = sgaFlattenedRow?.row.children?.some(c => c.id === "rd") ?? false;
    const otherOpexIsChildOfSga = sgaFlattenedRow?.row.children?.some(c => c.id === "other_opex") ?? false;
    
    const parts: string[] = [];
    if (gpRow) parts.push(cellRef(gpRow, "gross_profit", yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
    if (sgaRow) parts.push(`-${cellRef(sgaRow, "sga", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`);
    if (!rdIsChildOfSga) {
      const rdRow = findExcelRowNumber(flattenedRows, "rd", startRow, rowOffsets);
      if (rdRow) parts.push(`-${cellRef(rdRow, "rd", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`);
    }
    if (!otherOpexIsChildOfSga) {
      const otherOpexRow = findExcelRowNumber(flattenedRows, "other_opex", startRow, rowOffsets);
      if (otherOpexRow) parts.push(`-${cellRef(otherOpexRow, "other_opex", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`);
    }
    
    if (parts.length > 0) return `=${parts.join("")}`;
  }

  if (rowId === "ebitda_margin") {
    const ebitdaRow = findExcelRowNumber(flattenedRows, "ebitda", startRow, rowOffsets);
    const revRow = findExcelRowNumber(flattenedRows, "rev", startRow, rowOffsets);
    if (ebitdaRow && revRow) {
      return `=IF(${cellRef(revRow, "rev", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}=0,0,${cellRef(ebitdaRow, "ebitda", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}/${cellRef(revRow, "rev", yearCol, yearColLetter, useNameRefs, statementPrefix || "")})`;
    }
  }

  if (rowId === "ebit") {
    const gpRow = findExcelRowNumber(flattenedRows, "gross_profit", startRow, rowOffsets);
    const sgaRow = findExcelRowNumber(flattenedRows, "sga", startRow, rowOffsets);
    const parts: string[] = [];
    if (gpRow) parts.push(cellRef(gpRow, "gross_profit", yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
    if (sgaRow) parts.push(`-${cellRef(sgaRow, "sga", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`);
    if (parts.length > 0) return `=${parts.join("")}`;
  }

  if (rowId === "ebit_margin") {
    const ebitRow = findExcelRowNumber(flattenedRows, "ebit", startRow, rowOffsets);
    const revRow = findExcelRowNumber(flattenedRows, "rev", startRow, rowOffsets);
    if (ebitRow && revRow) {
      return `=IF(${cellRef(revRow, "rev", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}=0,0,${cellRef(ebitRow, "ebit", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}/${cellRef(revRow, "rev", yearCol, yearColLetter, useNameRefs, statementPrefix || "")})`;
    }
  }

  if (rowId === "ebt") {
    // EBT = EBIT + all items between EBIT margin and EBT
    // This dynamically includes all Interest & Other items
    const ebitRow = findExcelRowNumber(flattenedRows, "ebit", startRow, rowOffsets);
    const ebitMarginIndex = flattenedRows.findIndex(r => r.row.id === "ebit_margin");
    const ebtIndex = flattenedRows.findIndex(r => r.row.id === "ebt");
    
    if (ebitMarginIndex >= 0 && ebtIndex > ebitMarginIndex && ebitRow) {
      const parts: string[] = [cellRef(ebitRow, "ebit", yearCol, yearColLetter, useNameRefs, statementPrefix || "")];
      for (let i = ebitMarginIndex + 1; i < ebtIndex; i++) {
        const item = flattenedRows[i].row;
        if (item.id === "ebt") continue;
        const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow, rowOffsets);
        if (!rowNum) continue;
        parts.push(`+${cellRef(rowNum, item.id, yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`);
      }
      if (parts.length > 0) return `=${parts.join("")}`;
    }
    const intExpRow = findExcelRowNumber(flattenedRows, "interest_expense", startRow, rowOffsets);
    const intIncRow = findExcelRowNumber(flattenedRows, "interest_income", startRow, rowOffsets);
    const otherIncRow = findExcelRowNumber(flattenedRows, "other_income", startRow, rowOffsets);
    const parts: string[] = [];
    if (ebitRow) parts.push(cellRef(ebitRow, "ebit", yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
    if (intExpRow) parts.push(`+${cellRef(intExpRow, "interest_expense", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`);
    if (intIncRow) parts.push(`+${cellRef(intIncRow, "interest_income", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`);
    if (otherIncRow) parts.push(`+${cellRef(otherIncRow, "other_income", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`);
    if (parts.length > 0) return `=${parts.join("")}`;
  }

  if (rowId === "net_income") {
    const ebtRow = findExcelRowNumber(flattenedRows, "ebt", startRow, rowOffsets);
    const taxRow = findExcelRowNumber(flattenedRows, "tax", startRow, rowOffsets);
    if (ebtRow && taxRow) {
      return `=${cellRef(ebtRow, "ebt", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}-${cellRef(taxRow, "tax", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`;
    }
  }

  if (rowId === "net_income_margin") {
    const netIncomeRow = findExcelRowNumber(flattenedRows, "net_income", startRow, rowOffsets);
    const revRow = findExcelRowNumber(flattenedRows, "rev", startRow, rowOffsets);
    if (netIncomeRow && revRow) {
      return `=IF(${cellRef(revRow, "rev", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}=0,0,${cellRef(netIncomeRow, "net_income", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}/${cellRef(revRow, "rev", yearCol, yearColLetter, useNameRefs, statementPrefix || "")})`;
    }
  }

  // Balance Sheet - dynamic subtotals that sum all items in category
  if (rowId === "total_current_assets") {
    const totalCurrentAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_current_assets");
    if (totalCurrentAssetsIndex >= 0) {
      const addresses: string[] = [];
      for (let i = 0; i < totalCurrentAssetsIndex; i++) {
        const item = flattenedRows[i].row;
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow, rowOffsets);
          if (rowNum) {
            addresses.push(cellRef(rowNum, item.id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    const rows = ["cash", "ar", "inventory", "other_ca"]
      .map((id) => {
        const r = findExcelRowNumber(flattenedRows, id, startRow, rowOffsets);
        return r ? cellRef(r, id, yearCol, yearColLetter, useNameRefs, statementPrefix || "") : null;
      })
      .filter((r): r is string => r !== null);
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_fixed_assets") {
    const totalCurrentAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_current_assets");
    const totalAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_assets");
    if (totalCurrentAssetsIndex >= 0 && totalAssetsIndex >= 0) {
      const addresses: string[] = [];
      for (let i = totalCurrentAssetsIndex + 1; i < totalAssetsIndex; i++) {
        const item = flattenedRows[i].row;
        if (item.id !== "total_fixed_assets" && !item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow, rowOffsets);
          if (rowNum) {
            addresses.push(cellRef(rowNum, item.id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    const rows = ["ppe", "intangible_assets", "other_assets"]
      .map((id) => {
        const r = findExcelRowNumber(flattenedRows, id, startRow, rowOffsets);
        return r ? cellRef(r, id, yearCol, yearColLetter, useNameRefs, statementPrefix || "") : null;
      })
      .filter((r): r is string => r !== null);
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_assets") {
    const totalFixedAssetsRowNum = findExcelRowNumber(flattenedRows, "total_fixed_assets", startRow, rowOffsets);
    if (totalFixedAssetsRowNum) {
      const currentAssetsRowNum = findExcelRowNumber(flattenedRows, "total_current_assets", startRow, rowOffsets);
      if (currentAssetsRowNum) {
        return `=${cellRef(currentAssetsRowNum, "total_current_assets", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}+${cellRef(totalFixedAssetsRowNum, "total_fixed_assets", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`;
      }
    }
    const totalCurrentAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_current_assets");
    const totalAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_assets");
    if (totalCurrentAssetsIndex >= 0 && totalAssetsIndex >= 0) {
      const addresses: string[] = [];
      const currentAssetsRowNum = findExcelRowNumber(flattenedRows, "total_current_assets", startRow, rowOffsets);
      if (currentAssetsRowNum) addresses.push(cellRef(currentAssetsRowNum, "total_current_assets", yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
      for (let i = totalCurrentAssetsIndex + 1; i < totalAssetsIndex; i++) {
        const item = flattenedRows[i].row;
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow, rowOffsets);
          if (rowNum) {
            addresses.push(cellRef(rowNum, item.id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    const rows = ["total_current_assets", "ppe", "other_assets"]
      .map((id) => {
        const r = findExcelRowNumber(flattenedRows, id, startRow, rowOffsets);
        return r ? cellRef(r, id, yearCol, yearColLetter, useNameRefs, statementPrefix || "") : null;
      })
      .filter((r): r is string => r !== null);
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_current_liabilities") {
    const totalAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_assets");
    const totalCurrentLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_current_liabilities");
    if (totalAssetsIndex >= 0 && totalCurrentLiabIndex >= 0) {
      const addresses: string[] = [];
      for (let i = totalAssetsIndex + 1; i < totalCurrentLiabIndex; i++) {
        const item = flattenedRows[i].row;
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow, rowOffsets);
          if (rowNum) {
            addresses.push(cellRef(rowNum, item.id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    const rows = ["ap", "st_debt", "other_cl"]
      .map((id) => {
        const r = findExcelRowNumber(flattenedRows, id, startRow, rowOffsets);
        return r ? cellRef(r, id, yearCol, yearColLetter, useNameRefs, statementPrefix || "") : null;
      })
      .filter((r): r is string => r !== null);
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_non_current_liabilities") {
    const totalCurrentLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_current_liabilities");
    const totalLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_liabilities");
    if (totalCurrentLiabIndex >= 0 && totalLiabIndex >= 0) {
      const addresses: string[] = [];
      for (let i = totalCurrentLiabIndex + 1; i < totalLiabIndex; i++) {
        const item = flattenedRows[i].row;
        if (item.id !== "total_non_current_liabilities" && !item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow, rowOffsets);
          if (rowNum) {
            addresses.push(cellRef(rowNum, item.id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    const rows = ["lt_debt", "other_liab"]
      .map((id) => {
        const r = findExcelRowNumber(flattenedRows, id, startRow, rowOffsets);
        return r ? cellRef(r, id, yearCol, yearColLetter, useNameRefs, statementPrefix || "") : null;
      })
      .filter((r): r is string => r !== null);
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_liabilities") {
    const totalNonCurrentLiabRowNum = findExcelRowNumber(flattenedRows, "total_non_current_liabilities", startRow, rowOffsets);
    if (totalNonCurrentLiabRowNum) {
      const currentLiabRowNum = findExcelRowNumber(flattenedRows, "total_current_liabilities", startRow, rowOffsets);
      if (currentLiabRowNum) {
        return `=${cellRef(currentLiabRowNum, "total_current_liabilities", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}+${cellRef(totalNonCurrentLiabRowNum, "total_non_current_liabilities", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`;
      }
    }
    const totalCurrentLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_current_liabilities");
    const totalLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_liabilities");
    if (totalCurrentLiabIndex >= 0 && totalLiabIndex >= 0) {
      const addresses: string[] = [];
      const currentLiabRowNum = findExcelRowNumber(flattenedRows, "total_current_liabilities", startRow, rowOffsets);
      if (currentLiabRowNum) addresses.push(cellRef(currentLiabRowNum, "total_current_liabilities", yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
      for (let i = totalCurrentLiabIndex + 1; i < totalLiabIndex; i++) {
        const item = flattenedRows[i].row;
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow, rowOffsets);
          if (rowNum) {
            addresses.push(cellRef(rowNum, item.id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    const rows = ["total_current_liabilities", "lt_debt", "other_liab"]
      .map((id) => {
        const r = findExcelRowNumber(flattenedRows, id, startRow, rowOffsets);
        return r ? cellRef(r, id, yearCol, yearColLetter, useNameRefs, statementPrefix || "") : null;
      })
      .filter((r): r is string => r !== null);
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_equity") {
    const totalLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_liabilities");
    const totalEquityIndex = flattenedRows.findIndex(r => r.row.id === "total_equity");
    if (totalLiabIndex >= 0 && totalEquityIndex >= 0) {
      const addresses: string[] = [];
      for (let i = totalLiabIndex + 1; i < totalEquityIndex; i++) {
        const item = flattenedRows[i].row;
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow, rowOffsets);
          if (rowNum) {
            addresses.push(cellRef(rowNum, item.id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    const rows = ["common_stock", "retained_earnings", "other_equity"]
      .map((id) => {
        const r = findExcelRowNumber(flattenedRows, id, startRow, rowOffsets);
        return r ? cellRef(r, id, yearCol, yearColLetter, useNameRefs, statementPrefix || "") : null;
      })
      .filter((r): r is string => r !== null);
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_liab_and_equity") {
    const liabRow = findExcelRowNumber(flattenedRows, "total_liabilities", startRow, rowOffsets);
    const equityRow = findExcelRowNumber(flattenedRows, "total_equity", startRow, rowOffsets);
    if (liabRow && equityRow) {
      return `=${cellRef(liabRow, "total_liabilities", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}+${cellRef(equityRow, "total_equity", yearCol, yearColLetter, useNameRefs, statementPrefix || "")}`;
    }
  }

  // Cash Flow — inputs are already stored with correct sign; formulas only SUM (no sign logic)
  // CFO: sum only top-level operating items (depth 0). WC row already sums its children, so we must not double-count.
  if (rowId === "operating_cf") {
    const netIncomeIndex = flattenedRows.findIndex(r => r.row.id === "net_income");
    const operatingCfIndex = flattenedRows.findIndex(r => r.row.id === "operating_cf");
    if (netIncomeIndex >= 0 && operatingCfIndex > netIncomeIndex) {
      const parts: string[] = [];
      for (let i = netIncomeIndex; i < operatingCfIndex; i++) {
        const entry = flattenedRows[i];
        if (entry.row.id === "operating_cf") continue;
        if (entry.depth !== 0) continue; // skip WC children (and any other nested rows) — wc_change row itself is depth 0
        const rowNum = findExcelRowNumber(flattenedRows, entry.row.id, startRow, rowOffsets);
        if (!rowNum) continue;
        parts.push(cellRef(rowNum, entry.row.id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
      }
      if (parts.length > 0) return `=${parts.join("+")}`;
    }
    const niRow = findExcelRowNumber(flattenedRows, "net_income", startRow, rowOffsets);
    const dandaRow = findExcelRowNumber(flattenedRows, "danda", startRow, rowOffsets);
    const wcRow = findExcelRowNumber(flattenedRows, "wc_change", startRow, rowOffsets);
    const parts: string[] = [];
    if (niRow) parts.push(cellRef(niRow, "net_income", yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
    if (dandaRow) parts.push(cellRef(dandaRow, "danda", yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
    if (wcRow) parts.push(cellRef(wcRow, "wc_change", yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
    if (parts.length > 0) return `=${parts.join("+")}`;
  }

  if (rowId === "investing_cf") {
    const capexIndex = flattenedRows.findIndex(r => r.row.id === "capex");
    const investingCfIndex = flattenedRows.findIndex(r => r.row.id === "investing_cf");
    if (capexIndex >= 0 && investingCfIndex > capexIndex) {
      const parts: string[] = [];
      for (let i = capexIndex; i < investingCfIndex; i++) {
        const item = flattenedRows[i].row;
        if (item.id === "investing_cf") continue;
        const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow, rowOffsets);
        if (!rowNum) continue;
        parts.push(cellRef(rowNum, item.id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
      }
      if (parts.length > 0) return `=${parts.join("+")}`;
    }
    const capexRow = findExcelRowNumber(flattenedRows, "capex", startRow, rowOffsets);
    const otherRow = findExcelRowNumber(flattenedRows, "other_investing", startRow, rowOffsets);
    const parts: string[] = [];
    if (capexRow) parts.push(cellRef(capexRow, "capex", yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
    if (otherRow) parts.push(cellRef(otherRow, "other_investing", yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
    if (parts.length > 0) return `=${parts.join("+")}`;
    return null;
  }

  if (rowId === "financing_cf") {
    const investingCfIndex = flattenedRows.findIndex(r => r.row.id === "investing_cf");
    const financingCfIndex = flattenedRows.findIndex(r => r.row.id === "financing_cf");
    if (investingCfIndex >= 0 && financingCfIndex > investingCfIndex) {
      const parts: string[] = [];
      for (let i = investingCfIndex + 1; i < financingCfIndex; i++) {
        const item = flattenedRows[i].row;
        if (item.id === "financing_cf") continue;
        const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow, rowOffsets);
        if (!rowNum) continue;
        parts.push(cellRef(rowNum, item.id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
      }
      if (parts.length > 0) return `=${parts.join("+")}`;
    }
    const fallbackParts: string[] = [];
    for (const id of ["debt_issuance", "debt_repayment", "equity_issuance", "dividends"]) {
      const r = findExcelRowNumber(flattenedRows, id, startRow, rowOffsets);
      if (r) fallbackParts.push(cellRef(r, id, yearCol, yearColLetter, useNameRefs, statementPrefix || ""));
    }
    if (fallbackParts.length > 0) return `=${fallbackParts.join("+")}`;
    return null;
  }

  if (rowId === "net_change_cash") {
    const rows = ["operating_cf", "investing_cf", "financing_cf"]
      .map((id) => {
        const r = findExcelRowNumber(flattenedRows, id, startRow, rowOffsets);
        return r ? cellRef(r, id, yearCol, yearColLetter, useNameRefs, statementPrefix || "") : null;
      })
      .filter((r): r is string => r !== null);
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  return null;
}
