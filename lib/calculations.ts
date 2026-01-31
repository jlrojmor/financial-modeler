/**
 * Calculation Engine for Financial Model
 * 
 * This module computes calculated rows based on their relationships.
 * IB-grade standards: formulas are computed and stored for Excel export.
 */

import type { Row } from "@/types/finance";

/**
 * Get the computed value for a row in a specific year
 * Handles: sum of children, formulas, inputs
 */
export function computeRowValue(
  row: Row,
  year: string,
  allRows: Row[],
  statementRows: Row[]
): number {
  // If it's an input, return the stored value
  if (row.kind === "input") {
    return row.values?.[year] ?? 0;
  }

  // If it's a calc/subtotal/total, compute based on children or formula
  if (row.kind === "calc" || row.kind === "subtotal" || row.kind === "total") {
    // If it has children, sum them
    if (row.children && row.children.length > 0) {
      return row.children.reduce((sum, child) => {
        return sum + computeRowValue(child, year, allRows, statementRows);
      }, 0);
    }

    // Otherwise, use a formula based on row ID (standard IB patterns)
    return computeFormula(row, year, statementRows);
  }

  return 0;
}

/**
 * Compute formula-based values for standard IB row patterns
 */
function computeFormula(row: Row, year: string, statementRows: Row[]): number {
  const rowId = row.id;

  // Income Statement formulas
  if (rowId === "gross_profit") {
    const revenue = findRowValue(statementRows, "rev", year);
    const cogs = findRowValue(statementRows, "cogs", year);
    return revenue - cogs;
  }

  if (rowId === "gross_margin") {
    const grossProfit = findRowValue(statementRows, "gross_profit", year);
    const revenue = findRowValue(statementRows, "rev", year);
    if (revenue === 0) return 0;
    return (grossProfit / revenue) * 100; // Return as percentage (e.g., 75.5 for 75.5%)
  }

  if (rowId === "ebitda") {
    const grossProfit = findRowValue(statementRows, "gross_profit", year);
    const sga = findRowValue(statementRows, "sga", year); // This will sum all SG&A breakdowns if they exist
    
    // Check if R&D and Other Opex are children of SG&A (in which case they're already included in SG&A)
    const sgaRow = statementRows.find(r => r.id === "sga");
    const rdIsChildOfSga = sgaRow?.children?.some(c => c.id === "rd") ?? false;
    const otherOpexIsChildOfSga = sgaRow?.children?.some(c => c.id === "other_opex") ?? false;
    
    // Only subtract R&D and Other Opex separately if they're NOT children of SG&A
    const rd = rdIsChildOfSga ? 0 : findRowValue(statementRows, "rd", year);
    const otherOpEx = otherOpexIsChildOfSga ? 0 : findRowValue(statementRows, "other_opex", year);
    
    return grossProfit - sga - rd - otherOpEx;
  }

  if (rowId === "ebitda_margin") {
    const ebitda = findRowValue(statementRows, "ebitda", year);
    const revenue = findRowValue(statementRows, "rev", year);
    if (revenue === 0) return 0;
    return (ebitda / revenue) * 100; // Return as percentage (e.g., 25.5 for 25.5%)
  }

  if (rowId === "ebit") {
    const ebitda = findRowValue(statementRows, "ebitda", year);
    const danda = findRowValue(statementRows, "danda", year);
    return ebitda - danda;
  }

  if (rowId === "ebt") {
    const ebit = findRowValue(statementRows, "ebit", year);
    const interestExpense = findRowValue(statementRows, "interest_expense", year);
    const interestIncome = findRowValue(statementRows, "interest_income", year);
    const otherIncome = findRowValue(statementRows, "other_income", year);
    return ebit - interestExpense + interestIncome + otherIncome;
  }

  if (rowId === "net_income") {
    const ebt = findRowValue(statementRows, "ebt", year);
    const tax = findRowValue(statementRows, "tax", year);
    return ebt - tax;
  }

  if (rowId === "net_income_margin") {
    const netIncome = findRowValue(statementRows, "net_income", year);
    const revenue = findRowValue(statementRows, "rev", year);
    if (revenue === 0) return 0;
    return (netIncome / revenue) * 100; // Return as percentage (e.g., 15.5 for 15.5%)
  }

  // Balance Sheet formulas - subtotals should sum all items in their category dynamically
  if (rowId === "total_current_assets") {
    // Find all current assets items (everything before total_current_assets that's not a total/subtotal)
    const totalCurrentAssetsIndex = statementRows.findIndex(r => r.id === "total_current_assets");
    if (totalCurrentAssetsIndex >= 0) {
      let sum = 0;
      for (let i = 0; i < totalCurrentAssetsIndex; i++) {
        const item = statementRows[i];
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          sum += findRowValue(statementRows, item.id, year);
        }
      }
      return sum;
    }
    // Fallback to hardcoded items if structure is unexpected
    const cash = findRowValue(statementRows, "cash", year);
    const ar = findRowValue(statementRows, "ar", year);
    const inventory = findRowValue(statementRows, "inventory", year);
    const otherCA = findRowValue(statementRows, "other_ca", year);
    return cash + ar + inventory + otherCA;
  }

  if (rowId === "total_assets") {
    // Sum total_current_assets + all fixed assets items
    const currentAssets = findRowValue(statementRows, "total_current_assets", year);
    const totalCurrentAssetsIndex = statementRows.findIndex(r => r.id === "total_current_assets");
    const totalAssetsIndex = statementRows.findIndex(r => r.id === "total_assets");
    if (totalCurrentAssetsIndex >= 0 && totalAssetsIndex >= 0) {
      let fixedAssetsSum = 0;
      for (let i = totalCurrentAssetsIndex + 1; i < totalAssetsIndex; i++) {
        const item = statementRows[i];
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          fixedAssetsSum += findRowValue(statementRows, item.id, year);
        }
      }
      return currentAssets + fixedAssetsSum;
    }
    // Fallback
    const ppe = findRowValue(statementRows, "ppe", year);
    const otherAssets = findRowValue(statementRows, "other_assets", year);
    return currentAssets + ppe + otherAssets;
  }

  if (rowId === "total_current_liabilities") {
    // Find all current liabilities items dynamically
    const totalAssetsIndex = statementRows.findIndex(r => r.id === "total_assets");
    const totalCurrentLiabIndex = statementRows.findIndex(r => r.id === "total_current_liabilities");
    if (totalAssetsIndex >= 0 && totalCurrentLiabIndex >= 0) {
      let sum = 0;
      for (let i = totalAssetsIndex + 1; i < totalCurrentLiabIndex; i++) {
        const item = statementRows[i];
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          sum += findRowValue(statementRows, item.id, year);
        }
      }
      return sum;
    }
    // Fallback
    const ap = findRowValue(statementRows, "ap", year);
    const stDebt = findRowValue(statementRows, "st_debt", year);
    const otherCL = findRowValue(statementRows, "other_cl", year);
    return ap + stDebt + otherCL;
  }

  if (rowId === "total_liabilities") {
    // Sum total_current_liabilities + all non-current liabilities items
    const currentLiab = findRowValue(statementRows, "total_current_liabilities", year);
    const totalCurrentLiabIndex = statementRows.findIndex(r => r.id === "total_current_liabilities");
    const totalLiabIndex = statementRows.findIndex(r => r.id === "total_liabilities");
    if (totalCurrentLiabIndex >= 0 && totalLiabIndex >= 0) {
      let nonCurrentLiabSum = 0;
      for (let i = totalCurrentLiabIndex + 1; i < totalLiabIndex; i++) {
        const item = statementRows[i];
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          nonCurrentLiabSum += findRowValue(statementRows, item.id, year);
        }
      }
      return currentLiab + nonCurrentLiabSum;
    }
    // Fallback
    const ltDebt = findRowValue(statementRows, "lt_debt", year);
    const otherLiab = findRowValue(statementRows, "other_liab", year);
    return currentLiab + ltDebt + otherLiab;
  }

  if (rowId === "total_equity") {
    // Sum all equity items dynamically
    const totalLiabIndex = statementRows.findIndex(r => r.id === "total_liabilities");
    const totalEquityIndex = statementRows.findIndex(r => r.id === "total_equity");
    if (totalLiabIndex >= 0 && totalEquityIndex >= 0) {
      let equitySum = 0;
      for (let i = totalLiabIndex + 1; i < totalEquityIndex; i++) {
        const item = statementRows[i];
        if (!item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          equitySum += findRowValue(statementRows, item.id, year);
        }
      }
      return equitySum;
    }
    // Fallback
    const commonStock = findRowValue(statementRows, "common_stock", year);
    const retainedEarnings = findRowValue(statementRows, "retained_earnings", year);
    const otherEquity = findRowValue(statementRows, "other_equity", year);
    return commonStock + retainedEarnings + otherEquity;
  }

  if (rowId === "total_liab_and_equity") {
    const totalLiab = findRowValue(statementRows, "total_liabilities", year);
    const totalEquity = findRowValue(statementRows, "total_equity", year);
    return totalLiab + totalEquity;
  }

  // Cash Flow formulas
  if (rowId === "operating_cf") {
    const netIncome = findRowValue(statementRows, "net_income", year);
    const danda = findRowValue(statementRows, "danda", year);
    const wcChange = findRowValue(statementRows, "wc_change", year);
    return netIncome + danda - wcChange;
  }

  if (rowId === "investing_cf") {
    const capex = findRowValue(statementRows, "capex", year);
    const otherInvesting = findRowValue(statementRows, "other_investing", year);
    return -capex + otherInvesting;
  }

  if (rowId === "financing_cf") {
    const debtIssuance = findRowValue(statementRows, "debt_issuance", year);
    const debtRepayment = findRowValue(statementRows, "debt_repayment", year);
    const equityIssuance = findRowValue(statementRows, "equity_issuance", year);
    const dividends = findRowValue(statementRows, "dividends", year);
    return debtIssuance - debtRepayment + equityIssuance - dividends;
  }

  if (rowId === "net_change_cash") {
    const operating = findRowValue(statementRows, "operating_cf", year);
    const investing = findRowValue(statementRows, "investing_cf", year);
    const financing = findRowValue(statementRows, "financing_cf", year);
    return operating + investing + financing;
  }

  return 0;
}

/**
 * Check if Balance Sheet balances: Total Assets = Total Liabilities + Total Equity
 * Returns an object with balance status and difference for each year
 * Uses findRowValue internally to get computed values
 */
export function checkBalanceSheetBalance(
  balanceSheet: Row[],
  years: string[]
): { year: string; balances: boolean; totalAssets: number; totalLiabAndEquity: number; difference: number }[] {
  const results = years.map(year => {
    // Use findRowValue to get the computed values (it handles children, formulas, etc.)
    const totalAssets = findRowValue(balanceSheet, "total_assets", year);
    const totalLiabilities = findRowValue(balanceSheet, "total_liabilities", year);
    const totalEquity = findRowValue(balanceSheet, "total_equity", year);
    const totalLiabAndEquity = totalLiabilities + totalEquity;
    
    // Calculate difference (should be 0 if balanced)
    const difference = totalAssets - totalLiabAndEquity;
    
    // Consider it balanced if difference is within rounding tolerance (0.01)
    const balances = Math.abs(difference) < 0.01;
    
    return {
      year,
      balances,
      totalAssets,
      totalLiabAndEquity,
      difference,
    };
  });
  
  return results;
}

/**
 * Find a row by ID and get its computed value
 * If row has children, sums them; otherwise returns stored value
 */
function findRowValue(rows: Row[], rowId: string, year: string): number {
  function search(rs: Row[]): Row | null {
    for (const r of rs) {
      if (r.id === rowId) {
        return r;
      }
      if (r.children) {
        const found = search(r.children);
        if (found) return found;
      }
    }
    return null;
  }
  
  const row = search(rows);
  if (!row) return 0;
  
  // For input rows with stored value, use it (this is the computed sum from first pass for rows with children)
  // This ensures we use the computed COGS value (8,541) instead of recomputing
  if (row.kind === "input" && row.values?.[year] !== undefined) {
    return row.values[year];
  }
  
  // For calc rows with children, always compute from children (ensures accuracy)
  if ((row.kind === "calc" || row.kind === "subtotal" || row.kind === "total") && row.children && row.children.length > 0) {
    return row.children.reduce((sum, child) => {
      const childValue = child.children && child.children.length > 0
        ? findRowValue([child], child.id, year)
        : child.values?.[year] ?? 0;
      return sum + childValue;
    }, 0);
  }
  
  // If input row has children but no stored value, sum them
  if (row.kind === "input" && row.children && row.children.length > 0) {
    return row.children.reduce((sum, child) => {
      const childValue = child.children && child.children.length > 0
        ? findRowValue([child], child.id, year)
        : child.values?.[year] ?? 0;
      return sum + childValue;
    }, 0);
  }
  
  // Return stored value (or 0 if not set)
  return row.values?.[year] ?? 0;
}

/**
 * Recompute all calculated rows for a given year
 * This should be called whenever an input value changes
 */
export function recomputeCalculations(
  rows: Row[],
  year: string,
  statementRows: Row[]
): Row[] {
  // First pass: update all rows and their children
  const updatedRows = rows.map((row) => {
    // Recursively update children first
    const newChildren = row.children
      ? recomputeCalculations(row.children, year, statementRows)
      : undefined;

    // CRITICAL: For input rows with children, compute the sum and store it FIRST
    // This allows formulas to reference the parent (e.g., COGS, SG&A) and get the sum of children
    // This must happen BEFORE calc rows are computed, so formulas can reference the correct totals
    if (row.kind === "input" && newChildren && newChildren.length > 0) {
      // Sum all children values (handles nested children recursively)
      const sum = newChildren.reduce((total, child) => {
        // If child has its own children, recursively sum them
        if (child.children && child.children.length > 0) {
          const childSum = child.children.reduce((childTotal, grandchild) => {
            return childTotal + (grandchild.values?.[year] ?? 0);
          }, 0);
          return total + childSum;
        }
        return total + (child.values?.[year] ?? 0);
      }, 0);
      const newValues = { ...(row.values ?? {}), [year]: sum };

      return {
        ...row,
        values: newValues,
        children: newChildren,
      };
    }

    // For input rows without children, just update children if they exist
    if (row.kind === "input" && row.children) {
      return {
        ...row,
        children: newChildren,
      };
    }

    // For calc rows, we'll compute in second pass after all inputs are updated
    return {
      ...row,
      children: newChildren,
    };
  });

  // Second pass: compute all calc rows using the updated rows
  // We need to compute in multiple passes to handle dependencies (e.g., Revenue before Gross Profit)
  let currentRows = updatedRows;
  let changed = true;
  let iterations = 0;
  const maxIterations = 10; // Safety limit
  
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    
    currentRows = currentRows.map((row) => {
      if (row.kind === "calc" || row.kind === "subtotal" || row.kind === "total") {
        const computed = computeRowValue(row, year, currentRows, currentRows);
        const currentValue = row.values?.[year] ?? 0;
        
        // Only update if value changed (to detect when we've stabilized)
        if (Math.abs(computed - currentValue) > 0.01) {
          changed = true;
        }
        
        const newValues = { ...(row.values ?? {}), [year]: computed };
        return {
          ...row,
          values: newValues,
        };
      }
      return row;
    });
  }
  
  return currentRows;
}
