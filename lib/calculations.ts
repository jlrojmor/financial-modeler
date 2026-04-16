/**
 * Calculation Engine for Financial Model
 * 
 * This module computes calculated rows based on their relationships.
 * IB-grade standards: formulas are computed and stored for Excel export.
 */

import type { Row, EmbeddedDisclosureItem } from "@/types/finance";
import { getBSCategoryForRow, getRowsForCategory } from "./bs-category-mapper";
import { isOperatingExpenseRow, isNonOperatingRow, isTaxRow } from "./is-classification";
import { findRowInTree } from "./row-utils";
import {
  buildModelYearTimeline,
  collectYearKeysFromRowTree,
  resolvePriorYear,
} from "./year-timeline";

/** All CFS rows in tree order (for WC cfo_* lines nested under wc_change). */
function flattenCashFlowRows(rows: Row[]): Row[] {
  const out: Row[] = [];
  const walk = (rs: Row[]) => {
    for (const r of rs) {
      out.push(r);
      if (r.children?.length) walk(r.children);
    }
  };
  walk(rows);
  return out;
}

function findBsRowForCfo(balanceSheet: Row[], bsRowId: string): Row | null {
  return findRowInTree(balanceSheet, bsRowId);
}
import { resolveHistoricalCfoValueOnly, hasMeaningfulHistoricalValue } from "./cfo-source-resolution";

/** WC exclusions for BS-based WC: cash and st_debt (and totals). */
const WC_BS_EXCLUDE_IDS = new Set([
  "cash",
  "st_debt",
  "total_current_assets",
  "total_current_liabilities",
]);

/**
 * Working capital from BS using only WC-tagged rows (cashFlowBehavior === "working_capital").
 * WC_BS = sum(CA WC) - sum(CL WC). Used for ΔWC_BS and projection wc_change.
 */
export function getWcBsBalance(balanceSheet: Row[], year: string): number {
  const currentAssets = getRowsForCategory(balanceSheet, "current_assets");
  const currentLiabilities = getRowsForCategory(balanceSheet, "current_liabilities");
  const isWcRow = (r: Row) =>
    !WC_BS_EXCLUDE_IDS.has(r.id) &&
    !r.id.startsWith("total") &&
    r.cashFlowBehavior === "working_capital";
  let wc = 0;
  currentAssets.filter(isWcRow).forEach((r) => {
    wc += r.values?.[year] ?? 0;
  });
  currentLiabilities.filter(isWcRow).forEach((r) => {
    wc -= r.values?.[year] ?? 0;
  });
  return wc;
}

/**
 * ΔWC from BS (model-implied) for a given year: WC_BS(y) - WC_BS(y-1).
 * Uses only WC-tagged rows. For first year in list there is no previous year.
 */
export function getDeltaWcBs(
  balanceSheet: Row[],
  year: string,
  previousYear: string | null
): number {
  if (!previousYear) return 0;
  const wcCurrent = getWcBsBalance(balanceSheet, year);
  const wcPrev = getWcBsBalance(balanceSheet, previousYear);
  return wcCurrent - wcPrev;
}

/**
 * Total SBC for a year without double-counting.
 * If SG&A / COGS / R&D have breakdown children, sum those category values; otherwise use "sga" / "cogs" / "rd".
 * (Summing all keys in sbcBreakdowns would double-count when both parent and breakdown keys exist.)
 */
export function getTotalSbcForYear(
  incomeStatement: Row[],
  sbcBreakdowns: Record<string, Record<string, number>>,
  year: string
): number {
  let total = 0;
  const sgaRow = findRowInTree(incomeStatement, "sga");
  const cogsRow = findRowInTree(incomeStatement, "cogs");
  const rdRow = findRowInTree(incomeStatement, "rd");
  const sgaBreakdowns = sgaRow?.children ?? [];
  const cogsBreakdowns = cogsRow?.children ?? [];
  const rdBreakdowns = rdRow?.children ?? [];
  if (sgaBreakdowns.length > 0) {
    sgaBreakdowns.forEach((b) => {
      total += sbcBreakdowns[b.id]?.[year] ?? 0;
    });
  } else {
    total += sbcBreakdowns["sga"]?.[year] ?? 0;
  }
  if (cogsBreakdowns.length > 0) {
    cogsBreakdowns.forEach((b) => {
      total += sbcBreakdowns[b.id]?.[year] ?? 0;
    });
  } else {
    total += sbcBreakdowns["cogs"]?.[year] ?? 0;
  }
  if (rdBreakdowns.length > 0) {
    rdBreakdowns.forEach((b) => {
      total += sbcBreakdowns[b.id]?.[year] ?? 0;
    });
  } else {
    total += sbcBreakdowns["rd"]?.[year] ?? 0;
  }
  return total;
}

/** IS rows that when they have children must use parent = sum(children); parent input disabled. */
const IS_PARENT_ROW_IDS = new Set(["rev", "cogs", "sga", "rd"]);

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
  danaBreakdowns?: Record<string, number>,
  embeddedDisclosures?: EmbeddedDisclosureItem[],
  sbcDisclosureEnabled?: boolean
): number {
  // Parent-child enforcement: Revenue, COGS, SG&A, R&D with children = sum(children) only
  if (row.kind === "input" && IS_PARENT_ROW_IDS.has(row.id) && row.children && row.children.length > 0) {
    return row.children.reduce(
      (sum, child) =>
        sum + computeRowValue(child, year, allRows, statementRows, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled),
      0
    );
  }

  // Special case: WC Change is input for all historical years, calculated for projection years
  if (row.id === "wc_change" && allStatements) {
    const isHistorical = year.endsWith("A");
    const isProjection = year.endsWith("E");

    if (isHistorical) {
      // Historical: reported only (if we have component children, sum them; otherwise use aggregate input)
      if (row.children && row.children.length > 0) {
        return row.children.reduce(
          (sum, child) =>
            sum +
            computeRowValue(
              child,
              year,
              allRows,
              statementRows,
              allStatements,
              sbcBreakdowns,
              danaBreakdowns,
              embeddedDisclosures,
              sbcDisclosureEnabled
            ),
          0
        );
      }
      return row.values?.[year] ?? 0;
    }
    if (isProjection) {
      return computeFormula(row, year, statementRows, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled);
    }
    return row.values?.[year] ?? 0;
  }

  // WC component lines (cfo_*), including nested under wc_change: always BS bridge, not raw input
  const isCashFlowStatement =
    !!allStatements &&
    statementRows.some(
      (r) =>
        r.id === "operating_cf" ||
        r.id === "investing_cf" ||
        r.id === "financing_cf" ||
        r.id === "net_change_cash"
    );
  if (row.id.startsWith("cfo_") && isCashFlowStatement && allStatements) {
    return computeFormula(
      row,
      year,
      statementRows,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
      embeddedDisclosures,
      sbcDisclosureEnabled
    );
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
          return sum + computeRowValue(child, year, allRows, statementRows, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled);
        }, 0);
      }

    // Otherwise, use a formula based on row ID (standard IB patterns)
    return computeFormula(row, year, statementRows, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled);
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
  sbcBreakdowns?: Record<string, Record<string, number>>,
  danaBreakdowns?: Record<string, number>,
  embeddedDisclosures?: EmbeddedDisclosureItem[],
  sbcDisclosureEnabled?: boolean
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
    const bsRow = findBsRowForCfo(allStatements.balanceSheet, bsRowId);
    
    if (bsRow && row.cfsLink) {
      // Calculate change from previous year (timeline = union of all BS value keys, not balanceSheet[0])
      const currentValue = bsRow.values?.[year] ?? 0;
      const timeline = collectYearKeysFromRowTree(allStatements.balanceSheet);
      const previousYear = resolvePriorYear(year, timeline);
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
  
  // Historical CFO source hierarchy: use single resolver (no sbcBreakdowns in CFS path for SBC)
  if (rowId === "net_income" && isInCFS && allStatements) {
    return resolveHistoricalCfoValueOnly(rowId, year, {
      cashFlowRows: statementRows,
      incomeStatement: allStatements.incomeStatement,
      balanceSheet: allStatements.balanceSheet,
      embeddedDisclosures: embeddedDisclosures ?? [],
      danaBreakdowns: danaBreakdowns ?? {},
    });
  }

  if (rowId === "danda" && isInCFS && allStatements) {
    return resolveHistoricalCfoValueOnly(rowId, year, {
      cashFlowRows: statementRows,
      incomeStatement: allStatements.incomeStatement,
      balanceSheet: allStatements.balanceSheet,
      embeddedDisclosures: embeddedDisclosures ?? [],
      danaBreakdowns: danaBreakdowns ?? {},
    });
  }

  if (rowId === "sbc" && isInCFS && allStatements) {
    return resolveHistoricalCfoValueOnly(rowId, year, {
      cashFlowRows: statementRows,
      incomeStatement: allStatements.incomeStatement,
      balanceSheet: allStatements.balanceSheet,
      embeddedDisclosures: embeddedDisclosures ?? [],
      sbcDisclosureEnabled,
    });
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
    
    const timeline = buildModelYearTimeline(allStatements);
    const previousYear = resolvePriorYear(year, timeline);
    if (!previousYear) return 0;

    // Forecast: ΔWC only from projected BS WC balances (WC-tagged rows only)
    const deltaWcBs = getDeltaWcBs(allStatements.balanceSheet, year, previousYear);
    // In CFO, we subtract WC change (increase in WC = negative CF)
    return -deltaWcBs;
  }
  
  if (rowId === "operating_cf") {
    // Sum all operating section items (between net_income and operating_cf).
    // Only TOP-LEVEL rows are iterated, so wc_change is included exactly once (its value
    // is the sum of its children or stored aggregate; children are not added again).
    // All line items use the same rule: add the row value. For wc_change, the stored value
    // is already the CF impact (projection: -rawChange; historical: sum of signed components).
    const netIncomeIndex = statementRows.findIndex((r) => r.id === "net_income");
    const operatingCfIndex = statementRows.findIndex((r) => r.id === "operating_cf");

    if (netIncomeIndex >= 0 && operatingCfIndex > netIncomeIndex) {
      let total = 0;
      for (let i = netIncomeIndex; i < operatingCfIndex; i++) {
        const item = statementRows[i];
        if (item.id === "operating_cf") continue;
        const value = findRowValue(statementRows, item.id, year);
        total += value;
      }
      return total;
    }

    // Fallback: use same CFO source hierarchy when in CFS
    const cfoContext = isInCFS && allStatements
      ? {
          cashFlowRows: statementRows,
          incomeStatement: allStatements.incomeStatement,
          balanceSheet: allStatements.balanceSheet,
          embeddedDisclosures: embeddedDisclosures ?? [],
          danaBreakdowns: danaBreakdowns ?? {},
          sbcDisclosureEnabled,
        }
      : null;
    const netIncome =
      cfoContext != null
        ? resolveHistoricalCfoValueOnly("net_income", year, cfoContext)
        : findRowValue(statementRows, "net_income", year);
    const danda =
      cfoContext != null
        ? resolveHistoricalCfoValueOnly("danda", year, cfoContext)
        : findRowValue(statementRows, "danda", year);
    const sbc =
      cfoContext != null
        ? resolveHistoricalCfoValueOnly("sbc", year, cfoContext)
        : findRowValue(statementRows, "sbc", year);
    const wcChange = findRowValue(statementRows, "wc_change", year);
    const otherOperating = findRowValue(statementRows, "other_operating", year);
    let cfoIntelligenceItems = 0;
    if (isInCFS && allStatements) {
      for (const r of flattenCashFlowRows(statementRows)) {
        if (!r.id.startsWith("cfo_") || !r.cfsLink) continue;
        const bsRowId = r.id.replace("cfo_", "");
        const bsRow = findBsRowForCfo(allStatements.balanceSheet, bsRowId);
        if (!bsRow) continue;
        const timeline = collectYearKeysFromRowTree(allStatements.balanceSheet);
        const prevYear = resolvePriorYear(year, timeline);
        const curr = bsRow.values?.[year] ?? 0;
        const prev = prevYear ? (bsRow.values?.[prevYear] ?? 0) : 0;
        const change = curr - prev;
        if (r.cfsLink.impact === "negative") cfoIntelligenceItems -= change;
        else cfoIntelligenceItems += change;
      }
    }
    return netIncome + danda + sbc + wcChange + otherOperating + cfoIntelligenceItems;
  }

  if (rowId === "investing_cf") {
    // Sum ALL investing items: items between capex and investing_cf, plus any with cfsLink.section === "investing"
    const capexIndex = statementRows.findIndex(r => r.id === "capex");
    const investingCfIndex = statementRows.findIndex(r => r.id === "investing_cf");
    
    let total = 0;
    
    // Sum items between capex and investing_cf (main investing section)
    if (capexIndex >= 0 && investingCfIndex > capexIndex) {
      for (let i = capexIndex; i < investingCfIndex; i++) {
        const item = statementRows[i];
        if (item.id === "investing_cf") continue; // Skip the total row
        const value = findRowValue(statementRows, item.id, year);
        total += value; // Values are already stored with correct signs
      }
    }
    
    // Also include any items with cfsLink.section === "investing" that are outside the slice
    // (e.g., items added after investing_cf or before capex)
    for (const item of statementRows) {
      if (item.id === "investing_cf") continue; // Skip the total row
      if (item.cfsLink?.section === "investing") {
        const itemIndex = statementRows.findIndex(r => r.id === item.id);
        const alreadyCounted = capexIndex >= 0 && investingCfIndex > capexIndex && 
                              itemIndex >= capexIndex && itemIndex < investingCfIndex;
        if (!alreadyCounted) {
          const value = findRowValue(statementRows, item.id, year);
          total += value;
        }
      }
    }
    
    return total;
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
    // Use computed section totals (same as preview) so builder and preview match when row.values are not yet written
    const operatingCfRow = statementRows.find((r) => r.id === "operating_cf");
    const investingCfRow = statementRows.find((r) => r.id === "investing_cf");
    const financingCfRow = statementRows.find((r) => r.id === "financing_cf");
    const operatingCf = operatingCfRow
      ? computeRowValue(operatingCfRow, year, statementRows, statementRows, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled)
      : 0;
    const investingCf = investingCfRow
      ? computeRowValue(investingCfRow, year, statementRows, statementRows, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled)
      : 0;
    const financingCf = financingCfRow
      ? computeRowValue(financingCfRow, year, statementRows, statementRows, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled)
      : 0;
    const coreNetCashChange = operatingCf + investingCf + financingCf;
    let cashBridgeSum = 0;
    for (const r of statementRows) {
      if (r.id === "net_change_cash") continue;
      const inBridge = r.id === "fx_effect_on_cash" || r.cfsLink?.section === "cash_bridge";
      if (inBridge) cashBridgeSum += findRowValue(statementRows, r.id, year);
    }
    return coreNetCashChange + cashBridgeSum;
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

  // Operating Expenses = sum(children of operating_expenses row). Structural parent; children are SG&A, R&D, Other Operating, D&A, custom.
  if (rowId === "operating_expenses") {
    const opExRow = statementRows.find((r) => r.id === "operating_expenses");
    if (!opExRow?.children?.length) {
      // Legacy: no structural parent, sum top-level operating expense rows by sectionOwner
      let sum = 0;
      for (const r of statementRows) {
        if (isOperatingExpenseRow(r)) sum += findRowValue(statementRows, r.id, year);
      }
      return sum;
    }
    return opExRow.children.reduce((sum, child) => sum + findRowValue(statementRows, child.id, year), 0);
  }

  if (rowId === "ebit") {
    // EBIT = Gross Profit - Operating Expenses (structural parent row; fallback to sum of operating expense rows if no parent)
    const grossProfit = findRowValue(statementRows, "gross_profit", year);
    const hasOpExRow = statementRows.some((r) => r.id === "operating_expenses");
    const operatingExpenses = hasOpExRow
      ? findRowValue(statementRows, "operating_expenses", year)
      : (() => {
          let sum = 0;
          for (const r of statementRows) {
            if (isOperatingExpenseRow(r)) sum += findRowValue(statementRows, r.id, year);
          }
          return sum;
        })();
    return grossProfit - operatingExpenses;
  }

  if (rowId === "ebit_margin") {
    const ebit = findRowValue(statementRows, "ebit", year);
    const revenue = findRowValue(statementRows, "rev", year);
    if (revenue === 0) return 0;
    return (ebit / revenue) * 100; // Return as percentage (e.g., 25.5 for 25.5%)
  }

  if (rowId === "ebt") {
    // EBT = EBIT − interest_expense + interest_income + other non-op
    // Interest expense may be stored as positive or negative depending on import/projection.
    // We always subtract Math.abs to be sign-agnostic.
    const ebit = findRowValue(statementRows, "ebit", year);
    let total = ebit;
    for (const r of statementRows) {
      if (!isNonOperatingRow(r)) continue;
      const value = findRowValue(statementRows, r.id, year);
      if (r.id === "interest_expense") {
        total -= Math.abs(value);
      } else {
        total += value;
      }
    }
    return total;
  }

  // Income Statement net_income (only if NOT in CFS - CFS net_income is handled above)
  // NI = EBT − tax_expense. Tax may be stored positive or negative; always subtract Math.abs.
  if (rowId === "net_income" && !isInCFS) {
    const ebt = findRowValue(statementRows, "ebt", year);
    let taxTotal = 0;
    for (const r of statementRows) {
      if (isTaxRow(r)) {
        taxTotal += Math.abs(findRowValue(statementRows, r.id, year));
      }
    }
    return ebt - taxTotal;
  }

  if (rowId === "net_income_margin") {
    const netIncome = findRowValue(statementRows, "net_income", year);
    const revenue = findRowValue(statementRows, "rev", year);
    if (revenue === 0) return 0;
    return (netIncome / revenue) * 100; // Return as percentage (e.g., 15.5 for 15.5%)
  }

  // Balance Sheet formulas - subtotals should sum all items in their category dynamically
  if (rowId === "total_current_assets") {
    // SUM ONLY ITEMS THAT ARE ACTUALLY IN THE BUILDER - NOTHING MORE, NOTHING LESS
    // Use getRowsForCategory to get the exact list of current assets items that are shown in the builder
    const currentAssetsItems = getRowsForCategory(statementRows, "current_assets");
    // Filter out the total row itself and any other totals/subtotals - ONLY sum actual line items
    const itemsToSum = currentAssetsItems.filter(
      item => item.id !== "total_current_assets" && 
               !item.id.startsWith("total_") && 
               item.kind !== "total" && 
               item.kind !== "subtotal"
    );
    // Sum ONLY these items - use their actual values directly
    let sum = 0;
    for (const item of itemsToSum) {
      // Use the item's stored value directly - this is what's shown in the builder
      const itemValue = item.values?.[year] ?? 0;
      sum += itemValue;
    }
    return sum;
  }

  if (rowId === "total_fixed_assets") {
    // SUM ONLY ITEMS THAT ARE ACTUALLY IN THE BUILDER - same logic as total_current_assets
    const fixedAssetsItems = getRowsForCategory(statementRows, "fixed_assets");
    const itemsToSum = fixedAssetsItems.filter(
      item => item.id !== "total_fixed_assets" &&
               !item.id.startsWith("total_") &&
               item.kind !== "total" &&
               item.kind !== "subtotal"
    );
    let sum = 0;
    for (const item of itemsToSum) {
      sum += item.values?.[year] ?? 0;
    }
    return sum;
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
    // SUM ONLY ITEMS THAT ARE ACTUALLY IN THE BUILDER - same logic as total_current_assets / total_fixed_assets
    const currentLiabilitiesItems = getRowsForCategory(statementRows, "current_liabilities");
    const itemsToSum = currentLiabilitiesItems.filter(
      item => item.id !== "total_current_liabilities" &&
               !item.id.startsWith("total_") &&
               item.kind !== "total" &&
               item.kind !== "subtotal"
    );
    let sum = 0;
    for (const item of itemsToSum) {
      sum += item.values?.[year] ?? 0;
    }
    return sum;
  }

  if (rowId === "total_non_current_liabilities") {
    // SUM ONLY ITEMS THAT ARE ACTUALLY IN THE BUILDER - same logic as other category totals
    const nonCurrentLiabilitiesItems = getRowsForCategory(statementRows, "non_current_liabilities");
    const itemsToSum = nonCurrentLiabilitiesItems.filter(
      item => item.id !== "total_non_current_liabilities" &&
               !item.id.startsWith("total_") &&
               item.kind !== "total" &&
               item.kind !== "subtotal"
    );
    let sum = 0;
    for (const item of itemsToSum) {
      sum += item.values?.[year] ?? 0;
    }
    return sum;
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
    // SUM ONLY ITEMS THAT ARE ACTUALLY IN THE BUILDER - same logic as other category totals
    const equityItems = getRowsForCategory(statementRows, "equity");
    const itemsToSum = equityItems.filter(
      item => item.id !== "total_equity" &&
               !item.id.startsWith("total_") &&
               item.kind !== "total" &&
               item.kind !== "subtotal"
    );
    let sum = 0;
    for (const item of itemsToSum) {
      sum += item.values?.[year] ?? 0;
    }
    return sum;
  }

  if (rowId === "total_liab_and_equity") {
    const totalLiab = findRowValue(statementRows, "total_liabilities", year);
    const totalEquity = findRowValue(statementRows, "total_equity", year);
    return totalLiab + totalEquity;
  }


  return 0;
}

/**
 * Effective value for a row in a given year (override or stored).
 * Used by BS Build preview to compute subtotals/totals from schedule overrides.
 */
function effectiveValue(
  row: Row,
  year: string,
  overrides?: Record<string, Record<string, number>>
): number {
  if (overrides?.[row.id]?.[year] !== undefined) return overrides[row.id][year];
  return row.values?.[year] ?? 0;
}

/**
 * Compute Balance Sheet category total by summing line items with effective values (override or stored).
 * Used in BS Build preview so subtotals/totals reflect WC, PP&E, Intangibles schedule overrides.
 */
function sumCategoryWithOverrides(
  statementRows: Row[],
  category: "current_assets" | "fixed_assets" | "current_liabilities" | "non_current_liabilities" | "equity",
  year: string,
  overrides?: Record<string, Record<string, number>>
): number {
  const items = getRowsForCategory(statementRows, category);
  const excludeIds = [
    "total_current_assets",
    "total_fixed_assets",
    "total_assets",
    "total_current_liabilities",
    "total_non_current_liabilities",
    "total_liabilities",
    "total_equity",
    "total_liab_and_equity",
  ];
  const itemsToSum = items.filter(
    (item) =>
      !excludeIds.includes(item.id) &&
      !item.id.startsWith("total_") &&
      item.kind !== "total" &&
      item.kind !== "subtotal"
  );
  let sum = 0;
  for (const item of itemsToSum) {
    sum += effectiveValue(item, year, overrides);
  }
  return sum;
}

/**
 * Compute all Balance Sheet subtotals and totals for a single year, optionally using overrides.
 * Used in BS Build preview so totals reflect WC/PP&E/Intangibles schedule outputs.
 */
export function computeBalanceSheetTotalsWithOverrides(
  balanceSheet: Row[],
  year: string,
  overrides?: Record<string, Record<string, number>>
): Record<string, number> {
  const total_current_assets = sumCategoryWithOverrides(
    balanceSheet,
    "current_assets",
    year,
    overrides
  );
  const total_fixed_assets = sumCategoryWithOverrides(
    balanceSheet,
    "fixed_assets",
    year,
    overrides
  );
  const total_assets = total_current_assets + total_fixed_assets;
  const total_current_liabilities = sumCategoryWithOverrides(
    balanceSheet,
    "current_liabilities",
    year,
    overrides
  );
  const total_non_current_liabilities = sumCategoryWithOverrides(
    balanceSheet,
    "non_current_liabilities",
    year,
    overrides
  );
  const total_liabilities = total_current_liabilities + total_non_current_liabilities;
  const total_equity = sumCategoryWithOverrides(
    balanceSheet,
    "equity",
    year,
    overrides
  );
  const total_liab_and_equity = total_liabilities + total_equity;
  return {
    total_current_assets,
    total_fixed_assets,
    total_assets,
    total_current_liabilities,
    total_non_current_liabilities,
    total_liabilities,
    total_equity,
    total_liab_and_equity,
  };
}

/**
 * Balance check: for each year, compare Total Assets to (Total Liabilities + Total Equity).
 * Totals are computed by summing line items: L = current + non-current liabilities, E = equity items, A = current + fixed assets.
 * Per-year: balanced when A ≈ L + E (within tolerance). Years with only one side filled are "incomplete" and do not trigger OUT OF BALANCE.
 */
export function checkBalanceSheetBalance(
  balanceSheet: Row[],
  years: string[],
  overrides?: Record<string, Record<string, number>>
): { year: string; balances: boolean; totalAssets: number; totalLiabAndEquity: number; difference: number; incomplete?: boolean }[] {
  const results = years.map((year) => {
    const totals = computeBalanceSheetTotalsWithOverrides(balanceSheet, year, overrides);
    const totalAssets = totals.total_assets;
    const totalLiabAndEquity = totals.total_liab_and_equity;

    const difference = totalAssets - totalLiabAndEquity;
    const bothHaveData = Math.abs(totalAssets) >= 0.01 && Math.abs(totalLiabAndEquity) >= 0.01;
    const incomplete = !bothHaveData && (Math.abs(totalAssets) >= 0.01 || Math.abs(totalLiabAndEquity) >= 0.01);
    const balances = Math.abs(difference) < 0.01 || incomplete;

    return {
      year,
      balances,
      totalAssets,
      totalLiabAndEquity,
      difference,
      incomplete,
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
/** Parent row IDs that have IS Build–only breakdowns; we don't overwrite their value with sum of children so Historicals stays editable. */
export type ParentIdsWithProjectionBreakdowns = Set<string>;

export function recomputeCalculations(
  rows: Row[],
  year: string,
  statementRows: Row[],
  allStatements?: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] },
  sbcBreakdowns?: Record<string, Record<string, number>>,
  danaBreakdowns?: Record<string, number>,
  parentIdsWithProjectionBreakdowns?: ParentIdsWithProjectionBreakdowns,
  embeddedDisclosures?: EmbeddedDisclosureItem[],
  sbcDisclosureEnabled?: boolean
): Row[] {
  // First pass: update all rows and their children
  const updatedRows = rows.map((row) => {
      // Recursively update children first
        const newChildren = row.children
        ? recomputeCalculations(row.children, year, statementRows, allStatements, sbcBreakdowns, danaBreakdowns, parentIdsWithProjectionBreakdowns, embeddedDisclosures, sbcDisclosureEnabled)
        : undefined;

    // Other WC / Reclass: do NOT auto-plug. It only affects CFO if the user has entered a meaningful value (see sum below).
    const finalChildren = newChildren;

    // CRITICAL: For input rows with children, compute the sum and store it FIRST
    // Parent-child enforcement: rev, cogs, sga, rd ALWAYS use sum(children); no manual parent input.
    // Other rows with IS Build breakdowns skip storing sum so projection logic can use parent.
    if (row.kind === "input" && finalChildren && finalChildren.length > 0) {
      const isIsParentWithChildren = IS_PARENT_ROW_IDS.has(row.id);
      if (!isIsParentWithChildren && parentIdsWithProjectionBreakdowns?.has(row.id)) {
        return { ...row, children: finalChildren };
      }
      // Sum all children values. For wc_change, Other WC / Reclass counts only if user has entered a meaningful value (no auto-plug).
      const sum = finalChildren.reduce((total, child) => {
        if (child.children && child.children.length > 0) {
          const childSum = child.children.reduce((childTotal, grandchild) => {
            return childTotal + (grandchild.values?.[year] ?? 0);
          }, 0);
          return total + childSum;
        }
        if (row.id === "wc_change" && child.id === "other_wc_reclass") {
          return total + (hasMeaningfulHistoricalValue(child, year) ? (child.values?.[year] ?? 0) : 0);
        }
        return total + (child.values?.[year] ?? 0);
      }, 0);
      const newValues = { ...(row.values ?? {}), [year]: sum };

      return {
        ...row,
        values: newValues,
        children: finalChildren,
      };
    }

    // Special case: WC Change projection years - value is computed from BS (handled in computeFormula)
    if (row.id === "wc_change" && allStatements && finalChildren?.length) {
      const isProjection = year.endsWith("E");
      if (isProjection) {
        const calculatedValue = computeRowValue(row, year, statementRows, statementRows, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled);
        const newValues = { ...(row.values ?? {}), [year]: calculatedValue };
        return {
          ...row,
          values: newValues,
          children: finalChildren,
        };
      }
    }

    // For input rows without children, just update children if they exist
    if (row.kind === "input" && row.children) {
      return {
        ...row,
        children: finalChildren ?? newChildren,
      };
    }

    // For calc rows, we'll compute in second pass after all inputs are updated
    return {
      ...row,
      children: finalChildren ?? newChildren,
    };
  });

  // Second pass: compute all calc rows (and nested CFS cfo_* WC lines) using the updated rows
  // Recursive so wc_change children get BS bridge values; multiple passes for IS-style dependencies.
  let currentRows: Row[] = updatedRows;
  let changed = true;
  let iterations = 0;
  const maxIterations = 10;

  const applySecondPassRecursive = (level: Row[]): { rows: Row[]; changed: boolean } => {
    let anyChanged = false;
    const rows = level.map((row) => {
      const newChildren = row.children
        ? applySecondPassRecursive(row.children)
        : { rows: undefined as Row[] | undefined, changed: false };
      if (newChildren.changed) anyChanged = true;
      const kids = newChildren.rows ?? row.children;
      const base: Row = kids !== row.children ? { ...row, children: kids } : { ...row };

      if (base.kind === "calc" || base.kind === "subtotal" || base.kind === "total") {
        const computed = computeRowValue(
          base,
          year,
          currentRows,
          currentRows,
          allStatements,
          sbcBreakdowns,
          danaBreakdowns,
          embeddedDisclosures,
          sbcDisclosureEnabled
        );
        const currentValue = base.values?.[year] ?? 0;
        if (Math.abs(computed - currentValue) > 0.01) anyChanged = true;
        return {
          ...base,
          values: { ...(base.values ?? {}), [year]: computed },
        };
      }

      if (base.kind === "input" && base.id.startsWith("cfo_")) {
        const computed = computeRowValue(
          base,
          year,
          currentRows,
          currentRows,
          allStatements,
          sbcBreakdowns,
          danaBreakdowns,
          embeddedDisclosures,
          sbcDisclosureEnabled
        );
        const currentValue = base.values?.[year] ?? 0;
        if (Math.abs(computed - currentValue) > 0.01) anyChanged = true;
        return {
          ...base,
          values: { ...(base.values ?? {}), [year]: computed },
        };
      }

      return kids !== row.children ? { ...row, children: kids } : row;
    });
    return { rows: rows as Row[], changed: anyChanged };
  };

  while (changed && iterations < maxIterations) {
    const { rows: nextRows, changed: passChanged } = applySecondPassRecursive(currentRows);
    changed = passChanged;
    currentRows = nextRows;
    iterations++;
  }

  return currentRows;
}
