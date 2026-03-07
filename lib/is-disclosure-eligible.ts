/**
 * Eligibility for embedded disclosures (SBC, future: amortization of intangibles).
 * Used to build the list of IS rows that can have disclosure amounts attached.
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";

/** Row IDs that must never appear in SBC (or other embedded disclosure) eligible list. */
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
 * Returns IS rows eligible for SBC disclosure: COGS (row or its children) + direct children of operating_expenses.
 * Revenue, Gross Profit, EBIT, EBT, Net Income, margins, tax, non-operating, and parent rows are excluded.
 */
export function getEligibleRowsForSbc(incomeStatement: Row[]): Row[] {
  const rows = incomeStatement ?? [];
  const out: Row[] = [];

  const cogsRow = findRowInTree(rows, "cogs");
  if (cogsRow) {
    if (cogsRow.children?.length) {
      cogsRow.children.forEach((c) => {
        if (!EXCLUDED_ROW_IDS.has(c.id)) out.push(c);
      });
    } else {
      out.push(cogsRow);
    }
  }

  const opExRow = findRowInTree(rows, "operating_expenses");
  if (opExRow?.children?.length) {
    opExRow.children.forEach((c) => {
      if (!EXCLUDED_ROW_IDS.has(c.id)) out.push(c);
    });
  }

  return out;
}
