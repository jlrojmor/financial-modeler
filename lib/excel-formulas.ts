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
  targetId: string
): number | null {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].row.id === targetId) {
      return i + 2; // +2 because row 1 is header
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
  startCol: number = 2 // Column B (after label column)
): string | null {
  const rowId = row.id;
  const excelRow = findExcelRowNumber(flattenedRows, rowId);
  if (!excelRow) return null;

  const yearCol = startCol + yearIndex;
  const yearColLetter = getColumnLetter(yearCol);

  // If it has children, sum them
  if (row.children && row.children.length > 0) {
    const childAddresses = row.children
      .map((child) => findExcelRowNumber(flattenedRows, child.id))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));

    if (childAddresses.length > 0) {
      return `=${childAddresses.join("+")}`;
    }
  }

  // Standard IB formulas based on row ID
  // Income Statement
  if (rowId === "gross_profit") {
    const revRow = findExcelRowNumber(flattenedRows, "rev");
    const cogsRow = findExcelRowNumber(flattenedRows, "cogs");
    if (revRow && cogsRow) {
      return `=${getCellAddress(revRow, yearCol)}-${getCellAddress(cogsRow, yearCol)}`;
    }
  }

  if (rowId === "gross_margin") {
    const gpRow = findExcelRowNumber(flattenedRows, "gross_profit");
    const revRow = findExcelRowNumber(flattenedRows, "rev");
    if (gpRow && revRow) {
      // Excel percentage format expects decimal (0.755 for 75.5%), so divide by 100
      // The percentage number format will automatically display it as 75.50%
      return `=IF(${getCellAddress(revRow, yearCol)}=0,0,${getCellAddress(gpRow, yearCol)}/${getCellAddress(revRow, yearCol)})`;
    }
  }

  if (rowId === "ebitda") {
    const gpRow = findExcelRowNumber(flattenedRows, "gross_profit");
    const sgaRow = findExcelRowNumber(flattenedRows, "sga");
    const rdRow = findExcelRowNumber(flattenedRows, "rd");
    const otherOpexRow = findExcelRowNumber(flattenedRows, "other_opex");
    const parts: string[] = [];
    if (gpRow) parts.push(getCellAddress(gpRow, yearCol));
    if (sgaRow) parts.push(`-${getCellAddress(sgaRow, yearCol)}`);
    if (rdRow) parts.push(`-${getCellAddress(rdRow, yearCol)}`);
    if (otherOpexRow) parts.push(`-${getCellAddress(otherOpexRow, yearCol)}`);
    if (parts.length > 0) return `=${parts.join("")}`;
  }

  if (rowId === "ebitda_margin") {
    const ebitdaRow = findExcelRowNumber(flattenedRows, "ebitda");
    const revRow = findExcelRowNumber(flattenedRows, "rev");
    if (ebitdaRow && revRow) {
      // Excel percentage format expects decimal (0.255 for 25.5%), so divide by 100
      // The percentage number format will automatically display it as 25.50%
      return `=IF(${getCellAddress(revRow, yearCol)}=0,0,${getCellAddress(ebitdaRow, yearCol)}/${getCellAddress(revRow, yearCol)})`;
    }
  }

  if (rowId === "ebit") {
    const ebitdaRow = findExcelRowNumber(flattenedRows, "ebitda");
    const dandaRow = findExcelRowNumber(flattenedRows, "danda");
    if (ebitdaRow && dandaRow) {
      return `=${getCellAddress(ebitdaRow, yearCol)}-${getCellAddress(dandaRow, yearCol)}`;
    }
  }

  if (rowId === "ebt") {
    const ebitRow = findExcelRowNumber(flattenedRows, "ebit");
    const intExpRow = findExcelRowNumber(flattenedRows, "interest_expense");
    const intIncRow = findExcelRowNumber(flattenedRows, "interest_income");
    const otherIncRow = findExcelRowNumber(flattenedRows, "other_income");
    const parts: string[] = [];
    if (ebitRow) parts.push(getCellAddress(ebitRow, yearCol));
    if (intExpRow) parts.push(`-${getCellAddress(intExpRow, yearCol)}`);
    if (intIncRow) parts.push(`+${getCellAddress(intIncRow, yearCol)}`);
    if (otherIncRow) parts.push(`+${getCellAddress(otherIncRow, yearCol)}`);
    if (parts.length > 0) return `=${parts.join("")}`;
  }

  if (rowId === "net_income") {
    const ebtRow = findExcelRowNumber(flattenedRows, "ebt");
    const taxRow = findExcelRowNumber(flattenedRows, "tax");
    if (ebtRow && taxRow) {
      return `=${getCellAddress(ebtRow, yearCol)}-${getCellAddress(taxRow, yearCol)}`;
    }
  }

  // Balance Sheet
  if (rowId === "total_current_assets") {
    const rows = ["cash", "ar", "inventory", "other_ca"]
      .map((id) => findExcelRowNumber(flattenedRows, id))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_assets") {
    const rows = ["total_current_assets", "ppe", "other_assets"]
      .map((id) => findExcelRowNumber(flattenedRows, id))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_current_liabilities") {
    const rows = ["ap", "st_debt", "other_cl"]
      .map((id) => findExcelRowNumber(flattenedRows, id))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_liabilities") {
    const rows = ["total_current_liabilities", "lt_debt", "other_liab"]
      .map((id) => findExcelRowNumber(flattenedRows, id))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_equity") {
    const rows = ["common_stock", "retained_earnings", "other_equity"]
      .map((id) => findExcelRowNumber(flattenedRows, id))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  if (rowId === "total_liab_and_equity") {
    const liabRow = findExcelRowNumber(flattenedRows, "total_liabilities");
    const equityRow = findExcelRowNumber(flattenedRows, "total_equity");
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
    const capexRow = findExcelRowNumber(flattenedRows, "capex");
    const otherRow = findExcelRowNumber(flattenedRows, "other_investing");
    const parts: string[] = [];
    if (capexRow) parts.push(`-${getCellAddress(capexRow, yearCol)}`);
    if (otherRow) parts.push(`+${getCellAddress(otherRow, yearCol)}`);
    if (parts.length > 0) return `=${parts.length === 1 ? parts[0] : `=${parts.join("")}`}`;
  }

  if (rowId === "financing_cf") {
    const rows = [
      { id: "debt_issuance", sign: "+" },
      { id: "debt_repayment", sign: "-" },
      { id: "equity_issuance", sign: "+" },
      { id: "dividends", sign: "-" },
    ]
      .map(({ id, sign }) => {
        const r = findExcelRowNumber(flattenedRows, id);
        return r ? `${sign}${getCellAddress(r, yearCol)}` : null;
      })
      .filter((r): r is string => r !== null);
    if (rows.length > 0) return `=${rows.join("")}`;
  }

  if (rowId === "net_change_cash") {
    const rows = ["operating_cf", "investing_cf", "financing_cf"]
      .map((id) => findExcelRowNumber(flattenedRows, id))
      .filter((r): r is number => r !== null)
      .map((r) => getCellAddress(r, yearCol));
    if (rows.length > 0) return `=${rows.join("+")}`;
  }

  return null;
}
