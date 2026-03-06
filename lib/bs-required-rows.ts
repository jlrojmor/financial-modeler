/**
 * Balance Sheet rows required by schedules (WC, Capex, Intangibles, Debt).
 * If the user removes one of these, the schedule setup can show "Missing: X. Add it back?" with one-click restore.
 */

import type { Row } from "@/types/finance";
import type { BalanceSheetCategory } from "./bs-impact-rules";
import { getCoreLockedBehavior } from "./bs-core-rows";

export interface RequiredBsRowConfig {
  id: string;
  label: string;
  category: BalanceSheetCategory;
}

/** Row IDs that schedules depend on (WC, Capex, Intangibles, Debt). */
export const REQUIRED_BS_ROW_IDS_FOR_SCHEDULES = [
  "cash",
  "ar",
  "inventory",
  "ap",
  "ppe",
  "intangible_assets",
  "st_debt",
  "lt_debt",
] as const;

/** Config for each required row: label and category for one-click restore. */
export const REQUIRED_BS_ROWS_CONFIG: Record<string, RequiredBsRowConfig> = {
  cash: { id: "cash", label: "Cash", category: "current_assets" },
  ar: { id: "ar", label: "Accounts Receivable", category: "current_assets" },
  inventory: { id: "inventory", label: "Inventory", category: "current_assets" },
  ap: { id: "ap", label: "Accounts Payable", category: "current_liabilities" },
  ppe: { id: "ppe", label: "Property, Plant & Equipment (PP&E)", category: "fixed_assets" },
  intangible_assets: { id: "intangible_assets", label: "Intangible Assets", category: "fixed_assets" },
  st_debt: { id: "st_debt", label: "Short-Term Debt", category: "current_liabilities" },
  lt_debt: { id: "lt_debt", label: "Long-Term Debt", category: "non_current_liabilities" },
};

/**
 * Returns which required schedule rows are missing from the balance sheet.
 */
export function getMissingRequiredBsRows(balanceSheet: Row[]): RequiredBsRowConfig[] {
  const existingIds = new Set(balanceSheet.map((r) => r.id));
  return REQUIRED_BS_ROW_IDS_FOR_SCHEDULES.filter((id) => !existingIds.has(id)).map(
    (id) => REQUIRED_BS_ROWS_CONFIG[id]
  );
}

/**
 * Returns a Row object to insert when restoring a required line (one-click restore).
 */
export function getRequiredRowTemplate(id: string): Row | null {
  const config = REQUIRED_BS_ROWS_CONFIG[id];
  if (!config) return null;
  const locked = getCoreLockedBehavior(id);
  const row: Row = {
    id: config.id,
    label: config.label,
    kind: "input",
    valueType: "currency",
    values: {},
    children: [],
  };
  if (locked) {
    row.cashFlowBehavior = locked.cashFlowBehavior;
    if (locked.scheduleOwner != null && locked.scheduleOwner !== "none") {
      row.scheduleOwner = locked.scheduleOwner;
    }
  }
  return row;
}
