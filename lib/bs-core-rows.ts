/**
 * Core Balance Sheet row IDs and locked cash-flow behavior.
 * Core rows have fixed, correct default cash-flow treatment; the user cannot change these tags.
 * Only custom / non-core rows can be tagged via the UI.
 */

import type { Row } from "@/types/finance";

export type CashFlowBehaviorLocked = "working_capital" | "investing" | "financing" | "non_cash";
export type ScheduleOwnerLocked = "wc" | "capex" | "intangibles" | "debt" | "none";

/** Core BS row IDs (input rows + total/subtotal). No dropdown; behavior is locked. */
export const CORE_BS_ROW_IDS = new Set<string>([
  // Current assets
  "cash",
  "ar",
  "inventory",
  "other_ca",
  // Totals (current/fixed/assets)
  "total_current_assets",
  "total_fixed_assets",
  "total_assets",
  // Fixed assets
  "ppe",
  "intangible_assets",
  "goodwill",
  "other_assets",
  // Current liabilities
  "ap",
  "accrued_liabilities",
  "deferred_revenue",
  "st_debt",
  "other_cl",
  "total_current_liabilities",
  // Non-current liabilities
  "lt_debt",
  "other_liab",
  "total_non_current_liabilities",
  "total_liabilities",
  // Equity
  "common_stock",
  "apic",
  "treasury_stock",
  "retained_earnings",
  "other_equity",
  "total_equity",
  "total_liab_and_equity",
]);

export interface CoreRowLockedBehavior {
  cashFlowBehavior: CashFlowBehaviorLocked;
  scheduleOwner?: ScheduleOwnerLocked; // optional; template uses none, apply can set capex/intangibles
}

/**
 * Locked cash-flow behavior for each core input row.
 * Used by store to enforce/reset core row tags; template and apply use these defaults.
 */
export const CORE_BS_LOCKED_BEHAVIOR: Record<string, CoreRowLockedBehavior> = {
  cash: { cashFlowBehavior: "non_cash" },
  ar: { cashFlowBehavior: "working_capital" },
  inventory: { cashFlowBehavior: "working_capital" },
  other_ca: { cashFlowBehavior: "working_capital" },
  ppe: { cashFlowBehavior: "investing", scheduleOwner: "capex" },
  intangible_assets: { cashFlowBehavior: "investing", scheduleOwner: "intangibles" },
  goodwill: { cashFlowBehavior: "non_cash" },
  other_assets: { cashFlowBehavior: "non_cash" },
  ap: { cashFlowBehavior: "working_capital" },
  accrued_liabilities: { cashFlowBehavior: "working_capital" },
  deferred_revenue: { cashFlowBehavior: "working_capital" },
  st_debt: { cashFlowBehavior: "financing" },
  other_cl: { cashFlowBehavior: "working_capital" },
  lt_debt: { cashFlowBehavior: "financing" },
  other_liab: { cashFlowBehavior: "non_cash" },
  common_stock: { cashFlowBehavior: "financing" },
  apic: { cashFlowBehavior: "financing" },
  treasury_stock: { cashFlowBehavior: "financing" },
  retained_earnings: { cashFlowBehavior: "non_cash" },
  other_equity: { cashFlowBehavior: "non_cash" },
};

export function isCoreBsRow(rowId: string): boolean {
  return CORE_BS_ROW_IDS.has(rowId);
}

export function getCoreLockedBehavior(rowId: string): CoreRowLockedBehavior | undefined {
  return CORE_BS_LOCKED_BEHAVIOR[rowId];
}

/** Rows that need CF treatment: non-core, input, scheduleOwner none/missing, and behavior missing or unclassified. */
export function getUnclassifiedNonCoreBsRows(balanceSheet: Row[]): Row[] {
  if (!balanceSheet?.length) return [];
  return balanceSheet.filter((r) => {
    if (isCoreBsRow(r.id)) return false;
    if (r.kind !== "input") return false;
    const owner = r.scheduleOwner ?? "none";
    if (owner !== "none") return false;
    const behavior = r.cashFlowBehavior;
    return !behavior || behavior === "unclassified";
  });
}
