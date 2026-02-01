/**
 * Calculation Engine for Financial Model
 * 
 * This module computes calculated rows based on their relationships.
 * IB-grade standards: formulas are computed and stored for Excel export.
 */

import type { Row } from "@/types/finance";
import { getBSCategoryForRow, getRowsForCategory } from "./bs-category-mapper";

/**
 * Get the computed value for a row in a specific year
 * Handles: sum of children, formulas, inputs
 */
export function computeRowValue(
  row: Row,
  year: string,
  allRows: Row[],
  statementRows: Row[],
  allStatements?: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] },
  sbcBreakdowns?: Record<string, Record<string, number>>,
  danaBreakdowns?: Record<string, number>
): number {
  // Special case: WC Change is input for all historical years, calculated for projection years
  if (row.id === "wc_change" && allStatements) {
    // Check if year is historical (ends with "A") or projection (ends with "E")
    const isHistorical = year.endsWith("A");
    const isProjection = year.endsWith("E");
    
    if (isHistorical) {
      // All historical years are manual input
      return row.values?.[year] ?? 0;
    } else if (isProjection) {
      // Projection years are calculated from BS changes
      return computeFormula(row, year, statementRows, allStatements, sbcBreakdowns);
    }
    // Default: treat as input if year format is unclear
    return row.values?.[year] ?? 0;
  }
  
  // If it's an input, return the stored value
  if (row.kind === "input") {
    return row.values?.[year] ?? 0;
  }

  // If it's a calc/subtotal/total, compute based on children or formula
  if (row.kind === "calc" || row.kind === "subtotal" || row.kind === "total") {
      // If it has children, sum them
      if (row.children && row.children.length > 0) {
        return row.children.reduce((sum, child) => {
          return sum + computeRowValue(child, year, allRows, statementRows, allStatements, sbcBreakdowns);
        }, 0);
      }

    // Otherwise, use a formula based on row ID (standard IB patterns)
    return computeFormula(row, year, statementRows, allStatements, sbcBreakdowns);
  }

  return 0;
}

/**
 * Compute formula-based values for standard IB row patterns
 * @param allStatements - Optional: all statements (IS, BS, CFS) for cross-statement references
 */
function computeFormula(
  row: Row, 
  year: string, 
  statementRows: Row[], 
  allStatements?: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] },
  sbcBreakdowns?: Record<string, Record<string, number>>
): number {
  const rowId = row.id;
  
  // Helper to find value across all statements if available
  const findValueAnywhere = (targetId: string): number => {
    if (allStatements) {
      // Check IS first
      const isValue = findRowValue(allStatements.incomeStatement, targetId, year);
      if (isValue !== 0 || allStatements.incomeStatement.some(r => r.id === targetId)) {
        return isValue;
      }
      // Check BS
      const bsValue = findRowValue(allStatements.balanceSheet, targetId, year);
      if (bsValue !== 0 || allStatements.balanceSheet.some(r => r.id === targetId)) {
        return bsValue;
      }
      // Check CFS
      const cfsValue = findRowValue(allStatements.cashFlow, targetId, year);
      if (cfsValue !== 0 || allStatements.cashFlow.some(r => r.id === targetId)) {
        return cfsValue;
      }
    }
    // Fallback to current statement
    return findRowValue(statementRows, targetId, year);
  };

  // Cash Flow formulas - MUST CHECK FIRST before IS formulas (since CFS has net_income, danda that pull from IS)
  // Detect if we're in CFS by checking if statementRows contains CFS-specific rows
  // IMPORTANT: Only check statementRows, NOT allStatements.cashFlow, to avoid false positives when computing IS values
  const isInCFS = allStatements && statementRows.some(r => r.id === "operating_cf" || r.id === "investing_cf" || r.id === "financing_cf" || r.id === "net_change_cash");
  
  // CFO Intelligence items - calculate from BS changes
  if (rowId.startsWith("cfo_") && isInCFS && allStatements) {
    const bsRowId = rowId.replace("cfo_", "");
    const bsRow = allStatements.balanceSheet.find(r => r.id === bsRowId);
    
    if (bsRow && row.cfsLink) {
      // Calculate change from previous year
      const currentValue = bsRow.values?.[year] ?? 0;
      // Find previous year from the years array
      const years = allStatements.balanceSheet[0]?.values ? 
        Object.keys(allStatements.balanceSheet[0].values).sort() : [];
      const yearIndex = years.indexOf(year);
      const previousYear = yearIndex > 0 ? years[yearIndex - 1] : null;
      const previousValue = previousYear ? (bsRow.values?.[previousYear] ?? 0) : 0;
      const change = currentValue - previousValue;
      
      // Apply impact based on cfsLink.impact
      if (row.cfsLink.impact === "positive") {
        return change; // Increase in liability = positive CF
      } else if (row.cfsLink.impact === "negative") {
        return -change; // Increase in liability = negative CF
      } else {
        return change; // Neutral - just return the change
      }
    }
    return 0;
  }
  
  if (rowId === "net_income" && isInCFS && allStatements) {
    // This is CFS net_income - pull from IS
    // CRITICAL: Only use stored values to avoid recursion
    // The IS net_income should already be computed and stored by recomputeCalculations
    const isNetIncomeRow = allStatements.incomeStatement.find(r => r.id === "net_income");
    if (isNetIncomeRow && isNetIncomeRow.values?.[year] !== undefined) {
      return isNetIncomeRow.values[year];
    }
    // If no stored value, return 0 (don't try to compute - that would cause recursion)
    return 0;
  }
  
  if (rowId === "danda" && isInCFS) {
    // This is CFS danda - pull from IS D&A row
    const isDandaRow = allStatements?.incomeStatement.find(r => r.id === "danda");
    if (isDandaRow && isDandaRow.values?.[year] !== undefined) {
      return isDandaRow.values[year];
    }
    // Fallback to danaBreakdowns if available
    if (danaBreakdowns && danaBreakdowns[year] !== undefined) {
      return danaBreakdowns[year];
    }
    return 0;
  }
  
  if (rowId === "sbc" && isInCFS && sbcBreakdowns) {
    // Calculate total SBC from all breakdowns for this year
    let total = 0;
    Object.keys(sbcBreakdowns).forEach(categoryId => {
      total += sbcBreakdowns[categoryId]?.[year] ?? 0;
    });
    return total;
  }
  
  // Working Capital Change calculation from Balance Sheet
  if (rowId === "wc_change" && isInCFS && allStatements) {
    // Check if year is historical (ends with "A") or projection (ends with "E")
    const isHistorical = year.endsWith("A");
    const isProjection = year.endsWith("E");
    
    // Historical years are manual input - return stored value
    if (isHistorical) {
      const storedValue = findRowValue(statementRows, "wc_change", year);
      return storedValue;
    }
    
    // Projection years are calculated from BS changes
    if (!isProjection) {
      // If year format is unclear, treat as input
      return findRowValue(statementRows, "wc_change", year);
    }
    
    // Get all years to find previous year - try multiple sources
    let allYears: string[] = [];
    if (allStatements.balanceSheet[0]?.values) {
      allYears = Object.keys(allStatements.balanceSheet[0].values).sort();
    } else if (allStatements.incomeStatement[0]?.values) {
      allYears = Object.keys(allStatements.incomeStatement[0].values).sort();
    } else if (statementRows[0]?.values) {
      allYears = Object.keys(statementRows[0].values).sort();
    }
    const yearIndex = allYears.indexOf(year);
    const previousYear = yearIndex > 0 ? allYears[yearIndex - 1] : null;
    if (!previousYear) return 0;
    
    // Get Current Assets (excluding Cash) using getRowsForCategory
    const allCurrentAssets = getRowsForCategory(allStatements.balanceSheet, "current_assets");
    const currentAssetsRows = allCurrentAssets.filter(r => r.id !== "cash" && r.id !== "total_current_assets");
    
    // Get Current Liabilities (excluding Short-Term Debt) using getRowsForCategory
    const allCurrentLiabilities = getRowsForCategory(allStatements.balanceSheet, "current_liabilities");
    const currentLiabilitiesRows = allCurrentLiabilities.filter(r => r.id !== "st_debt" && r.id !== "total_current_liabilities");
    
    // Calculate current year working capital (excluding cash and short-term debt)
    let currentWC = 0;
    currentAssetsRows.forEach(r => {
      currentWC += r.values?.[year] ?? 0;
    });
    currentLiabilitiesRows.forEach(r => {
      currentWC -= r.values?.[year] ?? 0;
    });
    
    // Calculate previous year working capital
    let previousWC = 0;
    currentAssetsRows.forEach(r => {
      previousWC += r.values?.[previousYear] ?? 0;
    });
    currentLiabilitiesRows.forEach(r => {
      previousWC -= r.values?.[previousYear] ?? 0;
    });
    
    // Change in Working Capital = Current WC - Previous WC
    // Negative change = cash outflow (increase in WC uses cash)
    // Positive change = cash inflow (decrease in WC frees cash)
    const wcChange = currentWC - previousWC;
    
    // In CFO, we subtract WC change (increase in WC = negative CF)
    return -wcChange;
  }
  
  if (rowId === "operating_cf") {
    // For CFS operating_cf, pull net_income and danda from IS, SBC from breakdowns
    const netIncome = isInCFS && allStatements 
      ? findRowValue(allStatements.incomeStatement, "net_income", year)
      : findRowValue(statementRows, "net_income", year);
    const danda = isInCFS && allStatements
      ? findRowValue(allStatements.incomeStatement, "danda", year)
      : findRowValue(statementRows, "danda", year);
    const sbc = isInCFS && sbcBreakdowns
      ? (() => {
          let total = 0;
          Object.keys(sbcBreakdowns).forEach(categoryId => {
            total += sbcBreakdowns[categoryId]?.[year] ?? 0;
          });
          return total;
        })()
      : findRowValue(statementRows, "sbc", year);
    const wcChange = findRowValue(statementRows, "wc_change", year);
    const otherOperating = findRowValue(statementRows, "other_operating", year);
    
    // Add CFO intelligence items (auto-detected BS items that flow to CFO)
    // These are items with IDs like "cfo_${bsRowId}" that are calculated from BS changes
    let cfoIntelligenceItems = 0;
    if (isInCFS && allStatements) {
      // Find all CFO intelligence items (rows with IDs starting with "cfo_")
      const cfoItems = statementRows.filter(r => r.id.startsWith("cfo_"));
      for (const cfoItem of cfoItems) {
        // Extract the original BS row ID (remove "cfo_" prefix)
        const bsRowId = cfoItem.id.replace("cfo_", "");
        const bsRow = allStatements.balanceSheet.find(r => r.id === bsRowId);
        
        if (bsRow && cfoItem.cfsLink) {
          // Calculate change from previous year
          const currentValue = bsRow.values?.[year] ?? 0;
          // Find previous year
          const yearIndex = allStatements.balanceSheet[0]?.values ? 
            Object.keys(allStatements.balanceSheet[0].values).indexOf(year) : -1;
          const previousYear = yearIndex > 0 ? 
            Object.keys(allStatements.balanceSheet[0].values)[yearIndex - 1] : null;
          const previousValue = previousYear ? (bsRow.values?.[previousYear] ?? 0) : 0;
          const change = currentValue - previousValue;
          
          // Apply impact based on cfsLink.impact
          if (cfoItem.cfsLink.impact === "positive") {
            cfoIntelligenceItems += change; // Increase in liability = positive CF
          } else if (cfoItem.cfsLink.impact === "negative") {
            cfoIntelligenceItems -= change; // Increase in liability = negative CF
          } else {
            cfoIntelligenceItems += change; // Neutral - just add the change
          }
        }
      }
    }
    
    return netIncome + danda + sbc - wcChange + otherOperating + cfoIntelligenceItems;
  }

  if (rowId === "investing_cf") {
    // Dynamically sum all investing items (between capex and investing_cf)
    // Find the start and end indices
    const capexIndex = statementRows.findIndex(r => r.id === "capex");
    const investingCfIndex = statementRows.findIndex(r => r.id === "investing_cf");
    
    if (capexIndex >= 0 && investingCfIndex > capexIndex) {
      let total = 0;
      // Sum all items between capex and investing_cf
      for (let i = capexIndex; i < investingCfIndex; i++) {
        const item = statementRows[i];
        // Skip the investing_cf row itself
        if (item.id === "investing_cf") continue;
        
        const value = findRowValue(statementRows, item.id, year);
        
        // Apply sign based on cfsLink.impact or default behavior
        // Note: Values may already be stored with their signs (negative for outflows, positive for inflows)
        // So we just add them directly - the sign is already in the value
        if (item.cfsLink && item.cfsLink.section === "investing") {
          // Values are stored with their correct signs, so just add them
          total += value;
        } else {
          // Default behavior: values are stored with their signs
          // CapEx is typically stored as negative, others can be positive or negative
          total += value;
        }
      }
      return total;
    }
    
    // Fallback to hardcoded calculation if structure is unexpected
    const capex = findRowValue(statementRows, "capex", year);
    const otherInvesting = findRowValue(statementRows, "other_investing", year);
    return -capex + otherInvesting;
  }

  if (rowId === "financing_cf") {
    // Dynamically sum all financing items (between investing_cf and financing_cf)
    // Use position-based detection to match the builder's logic
    const investingCfIndex = statementRows.findIndex(r => r.id === "investing_cf");
    const financingCfIndex = statementRows.findIndex(r => r.id === "financing_cf");
    
    if (investingCfIndex >= 0 && financingCfIndex > investingCfIndex) {
      let total = 0;
      // Sum all items between investing_cf and financing_cf
      for (let i = investingCfIndex + 1; i < financingCfIndex; i++) {
        const item = statementRows[i];
        // Skip the financing_cf row itself
        if (item.id === "financing_cf") continue;
        
        const value = findRowValue(statementRows, item.id, year);
        
        // Values are stored with their correct signs (negative for outflows, positive for inflows)
        // So we just add them directly - the sign is already in the value
        total += value;
      }
      return total;
    }
    
    // Fallback: try to find items by cfsLink.section === "financing"
    const financingItems = statementRows.filter(r => 
      r.cfsLink?.section === "financing" && r.id !== "financing_cf"
    );
    if (financingItems.length > 0) {
      let total = 0;
      for (const item of financingItems) {
        const value = findRowValue(statementRows, item.id, year);
        total += value;
      }
      return total;
    }
    
    // Final fallback to hardcoded calculation if structure is unexpected
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

  if (rowId === "ebit") {
    // EBIT = Gross Profit - SG&A - D&A
    // Check if R&D and Other Opex are children of SG&A (in which case they're already included in SG&A)
    const grossProfit = findRowValue(statementRows, "gross_profit", year);
    const sga = findRowValue(statementRows, "sga", year); // This will sum all SG&A breakdowns if they exist
    const sgaRow = statementRows.find(r => r.id === "sga");
    const rdIsChildOfSga = sgaRow?.children?.some(c => c.id === "rd") ?? false;
    const otherOpexIsChildOfSga = sgaRow?.children?.some(c => c.id === "other_opex") ?? false;
    
    // Only subtract R&D and Other Opex separately if they're NOT children of SG&A
    const rd = rdIsChildOfSga ? 0 : findRowValue(statementRows, "rd", year);
    const otherOpEx = otherOpexIsChildOfSga ? 0 : findRowValue(statementRows, "other_opex", year);
    const danda = findRowValue(statementRows, "danda", year);
    
    return grossProfit - sga - rd - otherOpEx - danda;
  }

  if (rowId === "ebit_margin") {
    const ebit = findRowValue(statementRows, "ebit", year);
    const revenue = findRowValue(statementRows, "rev", year);
    if (revenue === 0) return 0;
    return (ebit / revenue) * 100; // Return as percentage (e.g., 25.5 for 25.5%)
  }

  if (rowId === "ebt") {
    const ebit = findRowValue(statementRows, "ebit", year);
    const interestExpense = findRowValue(statementRows, "interest_expense", year);
    const interestIncome = findRowValue(statementRows, "interest_income", year);
    const otherIncome = findRowValue(statementRows, "other_income", year);
    return ebit - interestExpense + interestIncome + otherIncome;
  }

  // Income Statement net_income (only if NOT in CFS - CFS net_income is handled above)
  if (rowId === "net_income" && !isInCFS) {
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

  if (rowId === "total_fixed_assets") {
    // Sum all fixed assets items (everything between total_current_assets and total_assets)
    const totalCurrentAssetsIndex = statementRows.findIndex(r => r.id === "total_current_assets");
    const totalAssetsIndex = statementRows.findIndex(r => r.id === "total_assets");
    if (totalCurrentAssetsIndex >= 0 && totalAssetsIndex >= 0) {
      let sum = 0;
      for (let i = totalCurrentAssetsIndex + 1; i < totalAssetsIndex; i++) {
        const item = statementRows[i];
        // Skip the total_fixed_assets row itself and other subtotals
        if (item.id !== "total_fixed_assets" && !item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          sum += findRowValue(statementRows, item.id, year);
        }
      }
      return sum;
    }
    // Fallback
    const ppe = findRowValue(statementRows, "ppe", year);
    const intangible = findRowValue(statementRows, "intangible_assets", year);
    const otherAssets = findRowValue(statementRows, "other_assets", year);
    return ppe + intangible + otherAssets;
  }

  if (rowId === "total_assets") {
    // Sum total_current_assets + total_fixed_assets (or all fixed assets items if subtotal doesn't exist)
    const currentAssets = findRowValue(statementRows, "total_current_assets", year);
    const totalFixedAssets = findRowValue(statementRows, "total_fixed_assets", year);
    // If total_fixed_assets exists, use it; otherwise calculate manually
    const totalFixedAssetsIndex = statementRows.findIndex(r => r.id === "total_fixed_assets");
    if (totalFixedAssetsIndex >= 0) {
      return currentAssets + totalFixedAssets;
    }
    // Fallback: calculate manually if subtotal doesn't exist
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
    // Final fallback
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

  if (rowId === "total_non_current_liabilities") {
    // Sum all non-current liabilities items (everything between total_current_liabilities and total_liabilities)
    const totalCurrentLiabIndex = statementRows.findIndex(r => r.id === "total_current_liabilities");
    const totalLiabIndex = statementRows.findIndex(r => r.id === "total_liabilities");
    if (totalCurrentLiabIndex >= 0 && totalLiabIndex >= 0) {
      let sum = 0;
      for (let i = totalCurrentLiabIndex + 1; i < totalLiabIndex; i++) {
        const item = statementRows[i];
        // Skip the total_non_current_liabilities row itself and other subtotals
        if (item.id !== "total_non_current_liabilities" && !item.id.startsWith("total_") && item.kind !== "total" && item.kind !== "subtotal") {
          sum += findRowValue(statementRows, item.id, year);
        }
      }
      return sum;
    }
    // Fallback
    const ltDebt = findRowValue(statementRows, "lt_debt", year);
    const otherLiab = findRowValue(statementRows, "other_liab", year);
    return ltDebt + otherLiab;
  }

  if (rowId === "total_liabilities") {
    // Sum total_current_liabilities + total_non_current_liabilities (or all non-current items if subtotal doesn't exist)
    const currentLiab = findRowValue(statementRows, "total_current_liabilities", year);
    const totalNonCurrentLiab = findRowValue(statementRows, "total_non_current_liabilities", year);
    // If total_non_current_liabilities exists, use it; otherwise calculate manually
    const totalCurrentLiabIndex = statementRows.findIndex(r => r.id === "total_current_liabilities");
    const totalNonCurrentLiabIndex = statementRows.findIndex(r => r.id === "total_non_current_liabilities");
    if (totalNonCurrentLiabIndex >= 0) {
      return currentLiab + totalNonCurrentLiab;
    }
    // Fallback: calculate manually if subtotal doesn't exist
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
    // Final fallback
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
  statementRows: Row[],
  allStatements?: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] },
  sbcBreakdowns?: Record<string, Record<string, number>>,
  danaBreakdowns?: Record<string, number>
): Row[] {
  // First pass: update all rows and their children
  const updatedRows = rows.map((row) => {
      // Recursively update children first
        const newChildren = row.children
        ? recomputeCalculations(row.children, year, statementRows, allStatements, sbcBreakdowns, danaBreakdowns)
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

    // Special case: WC Change is input for all historical years, calculated for projection years
    if (row.id === "wc_change" && allStatements) {
      // Check if year is historical (ends with "A") or projection (ends with "E")
      const isHistorical = year.endsWith("A");
      const isProjection = year.endsWith("E");
      
      if (isProjection) {
        // Projection years - calculate from BS changes and store it
        const calculatedValue = computeRowValue(row, year, statementRows, statementRows, allStatements, sbcBreakdowns, danaBreakdowns);
        const newValues = { ...(row.values ?? {}), [year]: calculatedValue };
        return {
          ...row,
          values: newValues,
          children: newChildren,
        };
      }
      // Historical years (or unclear format) - keep as input (stored value)
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
        // For CFS rows, we need to pass allStatements and sbcBreakdowns to computeFormula
        // Use computeRowValue to get the computed value (it handles all the logic)
        const computed = computeRowValue(row, year, currentRows, currentRows, allStatements, sbcBreakdowns, danaBreakdowns);
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
