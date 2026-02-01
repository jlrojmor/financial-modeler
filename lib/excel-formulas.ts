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
function getColumnLetter(col: number): string {
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

/**
 * Find the Excel row number for a given row ID in a flattened list
 */
function findExcelRowNumber(
  rows: Array<{ row: Row; depth: number }>,
  targetId: string,
  startRow: number = 1
): number | null {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].row.id === targetId) {
      // startRow is the header row, so data rows start at startRow + 1
      // Index i=0 is the first data row, so it's at startRow + 1 + 0 = startRow + 1
      return startRow + 1 + i;
    }
  }
  return null;
}

/**
 * Generate Excel formula for a row based on its type and relationships
 */
export function generateExcelFormula(
  row: Row,
  yearIndex: number,
  flattenedRows: Array<{ row: Row; depth: number }>,
  startCol: number = 2, // Column B (after label column)
  startRow: number = 1 // Header row number
): string | null {
  const rowId = row.id;
  const excelRow = findExcelRowNumber(flattenedRows, rowId, startRow);
  if (!excelRow) return null;

  const yearCol = startCol + yearIndex;
  const yearColLetter = getColumnLetter(yearCol);

  // If it has children, sum them (CRITICAL: Only sum direct children, never include parent row itself)
  if (row.children && row.children.length > 0) {
    // Find all DIRECT child rows in the flattened list (they appear immediately after the parent)
    const childAddresses: string[] = [];
    
    // Get the parent's index in flattened list
    const parentIndex = flattenedRows.findIndex(r => r.row.id === rowId);
    if (parentIndex === -1) return null;
    
    // Find each DIRECT child in the flattened list
    // Children appear after the parent in the flattened list
    for (const child of row.children) {
      const childIndex = flattenedRows.findIndex(r => r.row.id === child.id);
      if (childIndex !== -1 && childIndex > parentIndex) {
        // Child found and comes after parent - use findExcelRowNumber for consistency
        const childRowNum = findExcelRowNumber(flattenedRows, child.id, startRow);
        if (childRowNum) {
          childAddresses.push(getCellAddress(childRowNum, yearCol));
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
    const revRow = findExcelRowNumber(flattenedRows, "rev", startRow);
    const cogsRow = findExcelRowNumber(flattenedRows, "cogs", startRow);
    if (revRow && cogsRow) {
      return `=${getCellAddress(revRow, yearCol)}-${getCellAddress(cogsRow, yearCol)}`;
    }
  }

  if (rowId === "gross_margin") {
    const gpRow = findExcelRowNumber(flattenedRows, "gross_profit", startRow);
    const revRow = findExcelRowNumber(flattenedRows, "rev", startRow);
    if (gpRow && revRow) {
      // Excel percentage format expects decimal (0.755 for 75.5%), so divide by 100
      // The percentage number format will automatically display it as 75.50%
      return `=IF(${getCellAddress(revRow, yearCol)}=0,0,${getCellAddress(gpRow, yearCol)}/${getCellAddress(revRow, yearCol)})`;
    }
  }

  if (rowId === "ebitda") {
    const gpRow = findExcelRowNumber(flattenedRows, "gross_profit", startRow);
    const sgaRow = findExcelRowNumber(flattenedRows, "sga", startRow);
    
    // Check if R&D and Other Opex are children of SG&A by looking at the flattened structure
    const sgaFlattenedRow = flattenedRows.find(r => r.row.id === "sga");
    const rdIsChildOfSga = sgaFlattenedRow?.row.children?.some(c => c.id === "rd") ?? false;
    const otherOpexIsChildOfSga = sgaFlattenedRow?.row.children?.some(c => c.id === "other_opex") ?? false;
    
    const parts: string[] = [];
    if (gpRow) parts.push(getCellAddress(gpRow, yearCol));
    if (sgaRow) parts.push(`-${getCellAddress(sgaRow, yearCol)}`);
    
    // Only include R&D and Other Opex if they're NOT children of SG&A
    if (!rdIsChildOfSga) {
      const rdRow = findExcelRowNumber(flattenedRows, "rd", startRow);
      if (rdRow) parts.push(`-${getCellAddress(rdRow, yearCol)}`);
    }
    if (!otherOpexIsChildOfSga) {
      const otherOpexRow = findExcelRowNumber(flattenedRows, "other_opex", startRow);
      if (otherOpexRow) parts.push(`-${getCellAddress(otherOpexRow, yearCol)}`);
    }
    
    if (parts.length > 0) return `=${parts.join("")}`;
  }

  if (rowId === "ebitda_margin") {
    const ebitdaRow = findExcelRowNumber(flattenedRows, "ebitda", startRow);
    const revRow = findExcelRowNumber(flattenedRows, "rev", startRow);
    if (ebitdaRow && revRow) {
      // Excel percentage format expects decimal (0.255 for 25.5%), so divide by 100
      // The percentage number format will automatically display it as 25.50%
      return `=IF(${getCellAddress(revRow, yearCol)}=0,0,${getCellAddress(ebitdaRow, yearCol)}/${getCellAddress(revRow, yearCol)})`;
    }
  }

  if (rowId === "ebit") {
    // EBIT = Gross Profit - SG&A - R&D - Other Opex - D&A
    const gpRow = findExcelRowNumber(flattenedRows, "gross_profit", startRow);
    const sgaRow = findExcelRowNumber(flattenedRows, "sga", startRow);
    
    // Check if R&D and Other Opex are children of SG&A
    const sgaFlattenedRow = flattenedRows.find(r => r.row.id === "sga");
    const rdIsChildOfSga = sgaFlattenedRow?.row.children?.some(c => c.id === "rd") ?? false;
    const otherOpexIsChildOfSga = sgaFlattenedRow?.row.children?.some(c => c.id === "other_opex") ?? false;
    
    const parts: string[] = [];
    if (gpRow) parts.push(getCellAddress(gpRow, yearCol));
    if (sgaRow) parts.push(`-${getCellAddress(sgaRow, yearCol)}`);
    
    // Only subtract R&D and Other Opex separately if they're NOT children of SG&A
    if (!rdIsChildOfSga) {
      const rdRow = findExcelRowNumber(flattenedRows, "rd", startRow);
      if (rdRow) parts.push(`-${getCellAddress(rdRow, yearCol)}`);
    }
    if (!otherOpexIsChildOfSga) {
      const otherOpexRow = findExcelRowNumber(flattenedRows, "other_opex", startRow);
      if (otherOpexRow) parts.push(`-${getCellAddress(otherOpexRow, yearCol)}`);
    }
    
    const dandaRow = findExcelRowNumber(flattenedRows, "danda", startRow);
    if (dandaRow) parts.push(`-${getCellAddress(dandaRow, yearCol)}`);
    
    if (parts.length > 0) return `=${parts.join("")}`;
  }

  if (rowId === "ebit_margin") {
    const ebitRow = findExcelRowNumber(flattenedRows, "ebit", startRow);
    const revRow = findExcelRowNumber(flattenedRows, "rev", startRow);
    if (ebitRow && revRow) {
      // Excel percentage format expects decimal (0.145 for 14.5%), so divide by 100
      // The percentage number format will automatically display it as 14.50%
      return `=IF(${getCellAddress(revRow, yearCol)}=0,0,${getCellAddress(ebitRow, yearCol)}/${getCellAddress(revRow, yearCol)})`;
    }
  }

  if (rowId === "ebt") {
    const ebitRow = findExcelRowNumber(flattenedRows, "ebit", startRow);
    const intExpRow = findExcelRowNumber(flattenedRows, "interest_expense", startRow);
    const intIncRow = findExcelRowNumber(flattenedRows, "interest_income", startRow);
    const otherIncRow = findExcelRowNumber(flattenedRows, "other_income", startRow);
    const parts: string[] = [];
    if (ebitRow) parts.push(getCellAddress(ebitRow, yearCol));
    if (intExpRow) parts.push(`-${getCellAddress(intExpRow, yearCol)}`);
    if (intIncRow) parts.push(`+${getCellAddress(intIncRow, yearCol)}`);
    if (otherIncRow) parts.push(`+${getCellAddress(otherIncRow, yearCol)}`);
    if (parts.length > 0) return `=${parts.join("")}`;
  }

  if (rowId === "net_income") {
    const ebtRow = findExcelRowNumber(flattenedRows, "ebt", startRow);
    const taxRow = findExcelRowNumber(flattenedRows, "tax", startRow);
    if (ebtRow && taxRow) {
      return `=${getCellAddress(ebtRow, yearCol)}-${getCellAddress(taxRow, yearCol)}`;
    }
  }

  if (rowId === "net_income_margin") {
    const netIncomeRow = findExcelRowNumber(flattenedRows, "net_income", startRow);
    const revRow = findExcelRowNumber(flattenedRows, "rev", startRow);
    if (netIncomeRow && revRow) {
      // Excel percentage format expects decimal (0.155 for 15.5%), so divide by 100
      // The percentage number format will automatically display it as 15.50%
      return `=IF(${getCellAddress(revRow, yearCol)}=0,0,${getCellAddress(netIncomeRow, yearCol)}/${getCellAddress(revRow, yearCol)})`;
    }
  }

  // Balance Sheet - dynamic subtotals that sum all items in category
  if (rowId === "total_current_assets") {
    // Find all current assets items dynamically (everything before total_current_assets)
    const totalCurrentAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_current_assets");
    if (totalCurrentAssetsIndex >= 0) {
      const addresses: string[] = [];
      for (let i = 0; i < totalCurrentAssetsIndex; i++) {
        const item = flattenedRows[i].row;
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow);
          if (rowNum) {
            addresses.push(getCellAddress(rowNum, yearCol));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    // Fallback to hardcoded items
    const rows = ["cash", "ar", "inventory", "other_ca"]
      .map((id) => findExcelRowNumber(flattenedRows, id, startRow))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_fixed_assets") {
    // Sum all fixed assets items (everything between total_current_assets and total_assets)
    const totalCurrentAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_current_assets");
    const totalAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_assets");
    if (totalCurrentAssetsIndex >= 0 && totalAssetsIndex >= 0) {
      const addresses: string[] = [];
      for (let i = totalCurrentAssetsIndex + 1; i < totalAssetsIndex; i++) {
        const item = flattenedRows[i].row;
        // Skip the total_fixed_assets row itself and other subtotals
        if (item.id !== "total_fixed_assets" && !item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow);
          if (rowNum) {
            addresses.push(getCellAddress(rowNum, yearCol));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    // Fallback
    const rows = ["ppe", "intangible_assets", "other_assets"]
      .map((id) => findExcelRowNumber(flattenedRows, id, startRow))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_assets") {
    // Sum total_current_assets + total_fixed_assets (or all fixed assets items if subtotal doesn't exist)
    const totalFixedAssetsRowNum = findExcelRowNumber(flattenedRows, "total_fixed_assets", startRow);
    if (totalFixedAssetsRowNum) {
      // Use the subtotal if it exists
      const currentAssetsRowNum = findExcelRowNumber(flattenedRows, "total_current_assets", startRow);
      if (currentAssetsRowNum) {
        return `=${getCellAddress(currentAssetsRowNum, yearCol)}+${getCellAddress(totalFixedAssetsRowNum, yearCol)}`;
      }
    }
    // Fallback: calculate manually if subtotal doesn't exist
    const totalCurrentAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_current_assets");
    const totalAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_assets");
    if (totalCurrentAssetsIndex >= 0 && totalAssetsIndex >= 0) {
      const addresses: string[] = [];
      // Add total_current_assets
      const currentAssetsRowNum = findExcelRowNumber(flattenedRows, "total_current_assets", startRow);
      if (currentAssetsRowNum) addresses.push(getCellAddress(currentAssetsRowNum, yearCol));
      // Add all fixed assets items
      for (let i = totalCurrentAssetsIndex + 1; i < totalAssetsIndex; i++) {
        const item = flattenedRows[i].row;
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow);
          if (rowNum) {
            addresses.push(getCellAddress(rowNum, yearCol));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    // Final fallback
    const rows = ["total_current_assets", "ppe", "other_assets"]
      .map((id) => findExcelRowNumber(flattenedRows, id, startRow))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_current_liabilities") {
    // Find all current liabilities items dynamically
    const totalAssetsIndex = flattenedRows.findIndex(r => r.row.id === "total_assets");
    const totalCurrentLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_current_liabilities");
    if (totalAssetsIndex >= 0 && totalCurrentLiabIndex >= 0) {
      const addresses: string[] = [];
      for (let i = totalAssetsIndex + 1; i < totalCurrentLiabIndex; i++) {
        const item = flattenedRows[i].row;
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow);
          if (rowNum) {
            addresses.push(getCellAddress(rowNum, yearCol));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    // Fallback
    const rows = ["ap", "st_debt", "other_cl"]
      .map((id) => findExcelRowNumber(flattenedRows, id, startRow))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_non_current_liabilities") {
    // Sum all non-current liabilities items (everything between total_current_liabilities and total_liabilities)
    const totalCurrentLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_current_liabilities");
    const totalLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_liabilities");
    if (totalCurrentLiabIndex >= 0 && totalLiabIndex >= 0) {
      const addresses: string[] = [];
      for (let i = totalCurrentLiabIndex + 1; i < totalLiabIndex; i++) {
        const item = flattenedRows[i].row;
        // Skip the total_non_current_liabilities row itself and other subtotals
        if (item.id !== "total_non_current_liabilities" && !item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow);
          if (rowNum) {
            addresses.push(getCellAddress(rowNum, yearCol));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    // Fallback
    const rows = ["lt_debt", "other_liab"]
      .map((id) => findExcelRowNumber(flattenedRows, id, startRow))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_liabilities") {
    // Sum total_current_liabilities + total_non_current_liabilities (or all non-current items if subtotal doesn't exist)
    const totalNonCurrentLiabRowNum = findExcelRowNumber(flattenedRows, "total_non_current_liabilities", startRow);
    if (totalNonCurrentLiabRowNum) {
      // Use the subtotal if it exists
      const currentLiabRowNum = findExcelRowNumber(flattenedRows, "total_current_liabilities", startRow);
      if (currentLiabRowNum) {
        return `=${getCellAddress(currentLiabRowNum, yearCol)}+${getCellAddress(totalNonCurrentLiabRowNum, yearCol)}`;
      }
    }
    // Fallback: calculate manually if subtotal doesn't exist
    const totalCurrentLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_current_liabilities");
    const totalLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_liabilities");
    if (totalCurrentLiabIndex >= 0 && totalLiabIndex >= 0) {
      const addresses: string[] = [];
      // Add total_current_liabilities
      const currentLiabRowNum = findExcelRowNumber(flattenedRows, "total_current_liabilities", startRow);
      if (currentLiabRowNum) addresses.push(getCellAddress(currentLiabRowNum, yearCol));
      // Add all non-current liabilities items
      for (let i = totalCurrentLiabIndex + 1; i < totalLiabIndex; i++) {
        const item = flattenedRows[i].row;
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow);
          if (rowNum) {
            addresses.push(getCellAddress(rowNum, yearCol));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    // Final fallback
    const rows = ["total_current_liabilities", "lt_debt", "other_liab"]
      .map((id) => findExcelRowNumber(flattenedRows, id, startRow))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_equity") {
    // Sum all equity items dynamically
    const totalLiabIndex = flattenedRows.findIndex(r => r.row.id === "total_liabilities");
    const totalEquityIndex = flattenedRows.findIndex(r => r.row.id === "total_equity");
    if (totalLiabIndex >= 0 && totalEquityIndex >= 0) {
      const addresses: string[] = [];
      for (let i = totalLiabIndex + 1; i < totalEquityIndex; i++) {
        const item = flattenedRows[i].row;
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow);
          if (rowNum) {
            addresses.push(getCellAddress(rowNum, yearCol));
          }
        }
      }
      if (addresses.length > 0) return `=${addresses.join("+")}`;
    }
    // Fallback
    const rows = ["common_stock", "retained_earnings", "other_equity"]
      .map((id) => findExcelRowNumber(flattenedRows, id, startRow))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_liab_and_equity") {
    const liabRow = findExcelRowNumber(flattenedRows, "total_liabilities", startRow);
    const equityRow = findExcelRowNumber(flattenedRows, "total_equity", startRow);
    if (liabRow && equityRow) {
      return `=${getCellAddress(liabRow, yearCol)}+${getCellAddress(equityRow, yearCol)}`;
    }
  }

  // Cash Flow
  if (rowId === "operating_cf") {
    const niRow = findExcelRowNumber(flattenedRows, "net_income");
    const dandaRow = findExcelRowNumber(flattenedRows, "danda");
    const wcRow = findExcelRowNumber(flattenedRows, "wc_change");
    const parts: string[] = [];
    if (niRow) parts.push(getCellAddress(niRow, yearCol));
    if (dandaRow) parts.push(`+${getCellAddress(dandaRow, yearCol)}`);
    if (wcRow) parts.push(`-${getCellAddress(wcRow, yearCol)}`);
    if (parts.length > 0) return `=${parts.join("")}`;
  }

  if (rowId === "investing_cf") {
    // Dynamically sum all investing items (between capex and investing_cf)
    const capexIndex = flattenedRows.findIndex(r => r.row.id === "capex");
    const investingCfIndex = flattenedRows.findIndex(r => r.row.id === "investing_cf");
    
    if (capexIndex >= 0 && investingCfIndex > capexIndex) {
      const parts: string[] = [];
      // Sum all items between capex and investing_cf
      for (let i = capexIndex; i < investingCfIndex; i++) {
        const item = flattenedRows[i].row;
        // Skip the investing_cf row itself
        if (item.id === "investing_cf") continue;
        
        const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow);
        if (!rowNum) continue;
        
        const cellAddress = getCellAddress(rowNum, yearCol);
        
        // Apply sign based on cfsLink.impact or default behavior
        if (item.cfsLink && item.cfsLink.section === "investing") {
          if (item.cfsLink.impact === "positive") {
            parts.push(`+${cellAddress}`);
          } else if (item.cfsLink.impact === "negative") {
            parts.push(`-${cellAddress}`);
          } else {
            parts.push(`+${cellAddress}`);
          }
        } else {
          // Default behavior: negative for outflows (capex), positive for others
          if (item.id === "capex") {
            parts.push(`-${cellAddress}`);
          } else {
            parts.push(`+${cellAddress}`);
          }
        }
      }
      if (parts.length > 0) return `=${parts.join("")}`;
    }
    
    // Fallback to hardcoded calculation if structure is unexpected
    const capexRow = findExcelRowNumber(flattenedRows, "capex", startRow);
    const otherRow = findExcelRowNumber(flattenedRows, "other_investing", startRow);
    const parts: string[] = [];
    if (capexRow) parts.push(`-${getCellAddress(capexRow, yearCol)}`);
    if (otherRow) parts.push(`+${getCellAddress(otherRow, yearCol)}`);
    if (parts.length > 0) return `=${parts.join("")}`;
    return null;
  }

  if (rowId === "financing_cf") {
    // Dynamically sum all financing items (between investing_cf and financing_cf)
    const investingCfIndex = flattenedRows.findIndex(r => r.row.id === "investing_cf");
    const financingCfIndex = flattenedRows.findIndex(r => r.row.id === "financing_cf");
    
    if (investingCfIndex >= 0 && financingCfIndex > investingCfIndex) {
      const parts: string[] = [];
      // Sum all items between investing_cf and financing_cf
      for (let i = investingCfIndex + 1; i < financingCfIndex; i++) {
        const item = flattenedRows[i].row;
        // Skip the financing_cf row itself
        if (item.id === "financing_cf") continue;
        
        const rowNum = findExcelRowNumber(flattenedRows, item.id, startRow);
        if (!rowNum) continue;
        
        const cellAddress = getCellAddress(rowNum, yearCol);
        
        // Apply sign based on cfsLink.impact or default behavior
        if (item.cfsLink && item.cfsLink.section === "financing") {
          if (item.cfsLink.impact === "positive") {
            parts.push(`+${cellAddress}`);
          } else if (item.cfsLink.impact === "negative") {
            parts.push(`-${cellAddress}`);
          } else {
            parts.push(`+${cellAddress}`);
          }
        } else {
          // Default behavior: positive for issuances, negative for repayments/dividends
          if (item.id === "debt_issuance" || item.id === "equity_issuance") {
            parts.push(`+${cellAddress}`);
          } else if (item.id === "debt_repayment" || item.id === "dividends") {
            parts.push(`-${cellAddress}`);
          } else {
            // Unknown item - default to positive
            parts.push(`+${cellAddress}`);
          }
        }
      }
      if (parts.length > 0) return `=${parts.join("")}`;
    }
    
    // Fallback to hardcoded calculation if structure is unexpected
    const rows = [
      { id: "debt_issuance", sign: "+" },
      { id: "debt_repayment", sign: "-" },
      { id: "equity_issuance", sign: "+" },
      { id: "dividends", sign: "-" },
    ]
      .map(({ id, sign }) => {
        const r = findExcelRowNumber(flattenedRows, id, startRow);
        return r ? `${sign}${getCellAddress(r, yearCol)}` : null;
      })
      .filter((r): r is string => r !== null);
    if (rows.length > 0) return `=${rows.join("")}`;
    return null;
  }

  if (rowId === "net_change_cash") {
    const rows = ["operating_cf", "investing_cf", "financing_cf"]
      .map((id) => findExcelRowNumber(flattenedRows, id, startRow))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  return null;
}
