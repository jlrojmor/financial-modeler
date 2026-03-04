/**
 * Working Capital Schedule
 *
 * Derives the list of WC items from CFO (wc_change children) and computes
 * historic drivers (days, % of revenue/COGS) and projected balances from driver inputs.
 * IB-grade: only items that are actually used in Cash Flow from Operations are included.
 */

import type { Row } from "@/types/finance";
import { getRowsForCategory } from "./bs-category-mapper";

export type WcScheduleItem = {
  id: string;
  label: string;
  side: "asset" | "liability";
};

/**
 * Get the ordered list of Working Capital items from the Cash Flow Statement.
 * Uses only wc_change children (synced from BS: current assets except cash, current liabilities except short-term debt).
 * Order: current assets first (BS order), then current liabilities (BS order).
 */
export function getWcScheduleItems(
  cashFlow: Row[],
  balanceSheet: Row[]
): WcScheduleItem[] {
  const wcRow = cashFlow.find((r) => r.id === "wc_change");
  const children = wcRow?.children ?? [];
  if (children.length === 0) return [];

  const childIds = new Set(children.map((c) => c.id));
  const currentAssets = getRowsForCategory(balanceSheet, "current_assets").filter(
    (r) => !["cash", "total_current_assets"].includes(r.id) && !r.id.startsWith("total_")
  );
  const currentLiabilities = getRowsForCategory(balanceSheet, "current_liabilities").filter(
    (r) => !["st_debt", "total_current_liabilities"].includes(r.id) && !r.id.startsWith("total_")
  );

  const out: WcScheduleItem[] = [];
  for (const r of currentAssets) {
    if (childIds.has(r.id)) {
      out.push({ id: r.id, label: r.label, side: "asset" });
    }
  }
  for (const r of currentLiabilities) {
    if (childIds.has(r.id)) {
      out.push({ id: r.id, label: r.label, side: "liability" });
    }
  }
  return out;
}

/** IB-grade default forecast method for WC/BS items (guidance only). */
export type WcRecommendation = {
  driver: "days" | "pct_revenue" | "pct_cogs";
  daysBase?: "revenue" | "cogs";
  methodLabel: string;
};

/** Standard table for help UI: line item type → recommended method. */
export const IB_GRADE_WC_RECOMMENDATIONS: { lineItem: string; method: string }[] = [
  { lineItem: "AR (Accounts Receivable)", method: "DSO (Days on Revenue)" },
  { lineItem: "Inventory", method: "DIO (Days on COGS)" },
  { lineItem: "AP (Accounts Payable)", method: "DPO (Days on COGS)" },
  { lineItem: "Prepaids", method: "% of Revenue" },
  { lineItem: "Accrued expenses", method: "% of Revenue" },
  { lineItem: "Deferred revenue", method: "% of Revenue" },
  { lineItem: "Other CA", method: "% of Revenue" },
  { lineItem: "Other CL", method: "% of Revenue" },
];

/**
 * Get IB-grade recommended forecast method for a WC item by id/label (guidance only).
 */
export function getRecommendedWcMethod(itemId: string, label?: string): WcRecommendation | null {
  const id = (itemId ?? "").toLowerCase();
  const lbl = (label ?? "").toLowerCase();
  if (id.includes("receivable") || lbl.includes("receivable") || id === "ar") {
    return { driver: "days", daysBase: "revenue", methodLabel: "DSO (Days on Revenue)" };
  }
  if (id.includes("inventory") || lbl.includes("inventory") || id === "inv") {
    return { driver: "days", daysBase: "cogs", methodLabel: "DIO (Days on COGS)" };
  }
  if (id.includes("payable") || lbl.includes("payable") || id === "ap") {
    return { driver: "days", daysBase: "cogs", methodLabel: "DPO (Days on COGS)" };
  }
  if (id.includes("prepaid") || lbl.includes("prepaid")) {
    return { driver: "pct_revenue", methodLabel: "% of Revenue" };
  }
  if (id.includes("accrued") || lbl.includes("accrued")) {
    return { driver: "pct_revenue", methodLabel: "% of Revenue" };
  }
  if (
    id.includes("deferred") ||
    lbl.includes("deferred") ||
    id.includes("unearned") ||
    lbl.includes("unearned")
  ) {
    return { driver: "pct_revenue", methodLabel: "% of Revenue" };
  }
  if (id.includes("other") || lbl.includes("other")) {
    return { driver: "pct_revenue", methodLabel: "% of Revenue" };
  }
  return { driver: "pct_revenue", methodLabel: "% of Revenue" };
}

/**
 * Infer the correct base for "days" driver by item: AR uses Revenue, Inventory/AP use COGS.
 * Used so historic and projected days are never tied to the % base (Revenue/COGS) selector.
 */
export function getDaysBaseForItemId(itemId: string, label?: string): "revenue" | "cogs" {
  const id = (itemId ?? "").toLowerCase();
  const lbl = (label ?? "").toLowerCase();
  if (id.includes("receivable") || lbl.includes("receivable") || id === "ar") return "revenue";
  if (
    id.includes("inventory") ||
    lbl.includes("inventory") ||
    id.includes("payable") ||
    lbl.includes("payable") ||
    id === "ap" ||
    id === "inv"
  )
    return "cogs";
  return "revenue";
}

/**
 * Compute historic "days" for an item: balance / (revenue or cogs) * 365.
 * Used for AR (revenue), Inventory (COGS), AP (COGS).
 */
export function computeHistoricDays(
  balance: number,
  revenue: number,
  cogs: number,
  base: "revenue" | "cogs"
): number | null {
  const denom = base === "revenue" ? revenue : cogs;
  if (denom <= 0) return null;
  return (balance / denom) * 365;
}

/**
 * Compute historic % of revenue or COGS for an item.
 */
export function computeHistoricPct(
  balance: number,
  revenue: number,
  cogs: number,
  base: "revenue" | "cogs"
): number | null {
  const denom = base === "revenue" ? revenue : cogs;
  if (denom <= 0) return null;
  return (balance / denom) * 100;
}

export type WcDriverState = {
  wcDriverTypeByItemId: Record<string, "days" | "pct_revenue" | "pct_cogs" | "manual">;
  wcDaysByItemId: Record<string, number>;
  wcDaysByItemIdByYear: Record<string, Record<string, number>>;
  wcDaysBaseByItemId: Record<string, "revenue" | "cogs">;
  wcPctBaseByItemId: Record<string, "revenue" | "cogs">;
  wcPctByItemId: Record<string, number>;
  wcPctByItemIdByYear: Record<string, Record<string, number>>;
};

/**
 * Compute projected balance for one WC item in one year from driver state and revenue/COGS.
 * Returns stored value (e.g. from BS) for manual or when no driver; otherwise computed.
 */
export function computeWcProjectedBalance(
  itemId: string,
  year: string,
  driverState: WcDriverState,
  revenueByYear: Record<string, number>,
  cogsByYear: Record<string, number>,
  manualBalance?: number
): number {
  const driver = driverState.wcDriverTypeByItemId[itemId] ?? "manual";
  if (driver === "manual" && manualBalance !== undefined) return manualBalance;
  if (driver === "manual") return 0;

  const rev = revenueByYear[year] ?? 0;
  const cogs = cogsByYear[year] ?? 0;

  if (driver === "days") {
    const days =
      driverState.wcDaysByItemIdByYear[itemId]?.[year] ??
      driverState.wcDaysByItemId[itemId] ??
      0;
    const base = driverState.wcDaysBaseByItemId?.[itemId] ?? getDaysBaseForItemId(itemId);
    const denom = base === "revenue" ? rev : cogs;
    if (denom <= 0) return 0;
    return (days / 365) * denom;
  }

  if (driver === "pct_revenue" || driver === "pct_cogs") {
    const pct =
      driverState.wcPctByItemIdByYear[itemId]?.[year] ??
      driverState.wcPctByItemId[itemId] ??
      0;
    const base = driver === "pct_revenue" ? "revenue" : "cogs";
    const denom = base === "revenue" ? rev : cogs;
    return denom * (pct / 100);
  }

  return manualBalance ?? 0;
}

/**
 * Compute all projected WC balances by item and year.
 * Used for BS Build preview and for applying to BS rows in recalc.
 */
export function computeWcProjectedBalances(
  itemIds: string[],
  projectionYears: string[],
  driverState: WcDriverState,
  revenueByYear: Record<string, number>,
  cogsByYear: Record<string, number>,
  balanceByItemByYear: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const itemId of itemIds) {
    out[itemId] = {};
    for (const y of projectionYears) {
      const manual = balanceByItemByYear[itemId]?.[y];
      out[itemId][y] = computeWcProjectedBalance(
        itemId,
        y,
        driverState,
        revenueByYear,
        cogsByYear,
        manual
      );
    }
  }
  return out;
}
