/**
 * Eligible rows for embedded disclosures (e.g. SBC) in the Historicals IS Builder.
 * Only expense rows that can contain embedded SBC/amortization; excludes revenue, margins, calculated subtotals, tax, non-operating.
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";

/** Row IDs that must never appear as eligible for SBC (revenue, margins, calculated subtotals, tax, non-operating). */
const EXCLUDED_ROW_IDS = new Set([
  "rev",
  "gross_profit",
  "gross_margin",
  "ebit",
  "ebit_margin",
  "ebt",
  "ebt_margin",
  "net_income",
  "net_income_margin",
  "operating_expenses",
  "tax",
  "interest_expense",
  "interest_income",
  "other_income",
  "ebitda",
  "ebitda_margin",
]);

/**
 * Returns IS rows eligible for SBC (and future disclosure types):
 * - COGS: the cogs row itself if it has no children, otherwise each direct child of COGS
 * - Operating expenses: direct children of operating_expenses only (sga, rd, other_opex, danda, custom)
 * Excludes revenue, Gross Profit, EBIT, EBT, Net Income, margin rows, tax, non-operating.
 */
export function getEligibleRowsForSbc(incomeStatement: Row[]): Row[] {
  const rows: Row[] = [];
  const is = incomeStatement ?? [];

  const cogsRow = findRowInTree(is, "cogs");
  if (cogsRow) {
    const children = cogsRow.children ?? [];
    if (children.length > 0) {
      children.forEach((c) => {
        if (!EXCLUDED_ROW_IDS.has(c.id)) rows.push(c);
      });
    } else {
      if (!EXCLUDED_ROW_IDS.has(cogsRow.id)) rows.push(cogsRow);
    }
  }

  const opExRow = findRowInTree(is, "operating_expenses");
  if (opExRow?.children?.length) {
    opExRow.children.forEach((c) => {
      if (!EXCLUDED_ROW_IDS.has(c.id)) rows.push(c);
    });
  }

  return rows;
}
