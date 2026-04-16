/**
 * Working Capital Schedule
 *
 * Derives the list of WC items from CFO (wc_change children) and computes
 * historic drivers (days, % of revenue/COGS) and projected balances from driver inputs.
 * IB-grade: only items that are actually used in Cash Flow from Operations are included.
 * Phase 2: Prefer metadata-based routing (cashFlowBehavior === "working_capital") when available.
 */

import type { Row } from "@/types/finance";
import { getRowsForCategory } from "./bs-category-mapper";
import { getForecastRoutingState } from "./forecast-routing";
import { findRowInTree } from "./row-utils";
import {
  collectYearKeysFromRowTree,
  pickNumericByYearKey,
  pickNumericRecordForYear,
  pickRowValueByYear,
  sortYearsChronologically,
  yearIsHistoricalForWc,
} from "./year-timeline";

/** CFS WC lines use `cfo_${balanceSheetRowId}`; schedule / BS use the bare row id. */
export function cfsWcChildIdToBalanceSheetId(cfsRowId: string): string {
  return cfsRowId.startsWith("cfo_") ? cfsRowId.slice(4) : cfsRowId;
}

/**
 * Whether `map` has an explicit bridge entry for this CFS row (even `{}`), and the line object.
 * Used so the preview still patches when deltas computed to no keys yet vs missing map key.
 */
export function getWcCfsBridgeLineFromMap(
  map: Record<string, Record<string, number>>,
  rowId: string
): { line: Record<string, number>; hasExplicitBridgeKey: boolean } {
  const strip = cfsWcChildIdToBalanceSheetId(rowId);
  const cfoKey = rowId.startsWith("cfo_") ? rowId : `cfo_${strip}`;
  for (const k of [rowId, cfoKey, strip] as const) {
    if (Object.prototype.hasOwnProperty.call(map, k)) {
      return { line: map[k] ?? {}, hasExplicitBridgeKey: true };
    }
  }
  return { line: {}, hasExplicitBridgeKey: false };
}

/** Resolve bridge map key: CFS row may be `cfo_ar`, bare `ar`, or custom `cfo_*` matching BS id. */
export function pickWcCfsBridgeLineByRowId(
  map: Record<string, Record<string, number>>,
  rowId: string
): Record<string, number> | undefined {
  const { line, hasExplicitBridgeKey } = getWcCfsBridgeLineFromMap(map, rowId);
  if (!hasExplicitBridgeKey) return undefined;
  return Object.keys(line).length > 0 ? line : undefined;
}

export type WcScheduleItem = {
  id: string;
  label: string;
  side: "asset" | "liability";
};

/**
 * Get WC item ids from Balance Sheet using forecast routing (metadata-first).
 * Returns row ids that route to working_capital_schedule.
 */
function flattenBsRows(rows: Row[]): Row[] {
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

export function getWcScheduleItemIdsFromRouting(balanceSheet: Row[]): Set<string> {
  const wcIds = new Set<string>();
  for (const row of flattenBsRows(balanceSheet)) {
    if (row.id.startsWith("total_") || row.id === "cash") continue;
    const routing = getForecastRoutingState(row, "balanceSheet");
    if (routing.owner === "working_capital_schedule") {
      wcIds.add(row.id);
    }
  }
  return wcIds;
}

/**
 * Get the ordered list of Working Capital items (Forecast Drivers, Excel, etc.).
 * Routing-first when BS rows declare `working_capital_schedule`; otherwise match `wc_change` children
 * to top-level current asset/liability rows. CFS lines may use `cfo_${bsId}` — normalized when matching.
 */
export function getWcScheduleItems(
  cashFlow: Row[],
  balanceSheet: Row[]
): WcScheduleItem[] {
  const currentAssets = getRowsForCategory(balanceSheet, "current_assets").filter(
    (r) => !["cash", "total_current_assets"].includes(r.id) && !r.id.startsWith("total_")
  );
  const currentLiabilities = getRowsForCategory(balanceSheet, "current_liabilities").filter(
    (r) => !["st_debt", "total_current_liabilities"].includes(r.id) && !r.id.startsWith("total_")
  );

  const wcIdsFromRouting = getWcScheduleItemIdsFromRouting(balanceSheet);
  const useRouting = wcIdsFromRouting.size > 0;

  const out: WcScheduleItem[] = [];
  if (useRouting) {
    for (const r of currentAssets) {
      if (wcIdsFromRouting.has(r.id)) {
        out.push({ id: r.id, label: r.label, side: "asset" });
      }
    }
    for (const r of currentLiabilities) {
      if (wcIdsFromRouting.has(r.id)) {
        out.push({ id: r.id, label: r.label, side: "liability" });
      }
    }
    return out;
  }

  const wcRow = cashFlow.find((r) => r.id === "wc_change");
  const children = wcRow?.children ?? [];
  if (children.length === 0) return [];
  const childBsIds = new Set(children.map((c) => cfsWcChildIdToBalanceSheetId(c.id)));
  for (const r of currentAssets) {
    if (childBsIds.has(r.id)) {
      out.push({ id: r.id, label: r.label, side: "asset" });
    }
  }
  for (const r of currentLiabilities) {
    if (childBsIds.has(r.id)) {
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
 * Store keys may be bare BS id (`ar`) or CFS-style (`cfo_ar`); schedule math uses canonical BS id.
 */
export function resolveWcDriverStoreKey(driverState: WcDriverState, itemId: string): string {
  if (Object.prototype.hasOwnProperty.call(driverState.wcDriverTypeByItemId, itemId)) {
    return itemId;
  }
  const cfoPrefixed = `cfo_${itemId}`;
  if (Object.prototype.hasOwnProperty.call(driverState.wcDriverTypeByItemId, cfoPrefixed)) {
    return cfoPrefixed;
  }
  for (const k of Object.keys(driverState.wcDriverTypeByItemId)) {
    if (cfsWcChildIdToBalanceSheetId(k) === itemId) return k;
  }
  return itemId;
}

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
  const key = resolveWcDriverStoreKey(driverState, itemId);
  const driver = driverState.wcDriverTypeByItemId[key] ?? driverState.wcDriverTypeByItemId[itemId] ?? "manual";
  if (driver === "manual" && manualBalance !== undefined) return manualBalance;
  if (driver === "manual") return 0;

  const rev = pickNumericByYearKey(revenueByYear, year);
  const cogs = pickNumericByYearKey(cogsByYear, year);

  if (driver === "days") {
    const byYear = driverState.wcDaysByItemIdByYear[key] ?? driverState.wcDaysByItemIdByYear[itemId];
    const daysFromYear =
      byYear != null ? pickNumericRecordForYear(byYear, year) : undefined;
    const days =
      daysFromYear ??
      driverState.wcDaysByItemId[key] ??
      driverState.wcDaysByItemId[itemId] ??
      0;
    const base =
      driverState.wcDaysBaseByItemId?.[key] ??
      driverState.wcDaysBaseByItemId?.[itemId] ??
      getDaysBaseForItemId(itemId);
    const denom = base === "revenue" ? rev : cogs;
    if (denom <= 0) return 0;
    return (days / 365) * denom;
  }

  if (driver === "pct_revenue" || driver === "pct_cogs") {
    const pctByY = driverState.wcPctByItemIdByYear[key] ?? driverState.wcPctByItemIdByYear[itemId];
    const pctFromYear = pctByY != null ? pickNumericRecordForYear(pctByY, year) : undefined;
    const pct =
      pctFromYear ??
      driverState.wcPctByItemId[key] ??
      driverState.wcPctByItemId[itemId] ??
      0;
    const base = driver === "pct_revenue" ? "revenue" : "cogs";
    const denom = base === "revenue" ? rev : cogs;
    return denom * (pct / 100);
  }

  return manualBalance ?? 0;
}

/**
 * Single source of truth for WC balance-by-year (Forecast Drivers WC preview and Projected Statements CFS bridge).
 * Timeline = sorted unique union of `years` plus each WC item’s BS row value keys when `unionBsValueKeys` is true.
 */
export function buildWcProjectedBalancesMatrix(params: {
  wcItems: WcScheduleItem[];
  balanceSheet: Row[];
  years: string[];
  historicalYears: string[];
  projectionYears: string[];
  driverState: WcDriverState;
  revByYear: Record<string, number>;
  cogsByYear: Record<string, number>;
  /** Default true: include BS keys so YoY deltas have prior-year anchors. */
  unionBsValueKeys?: boolean;
}): { projectedBalances: Record<string, Record<string, number>>; chron: string[] } {
  const {
    wcItems,
    balanceSheet,
    years,
    historicalYears,
    projectionYears,
    driverState,
    revByYear,
    cogsByYear,
    unionBsValueKeys = true,
  } = params;

  const yearSet = new Set<string>(years);
  if (unionBsValueKeys) {
    for (const item of wcItems) {
      const bsRow = findRowInTree(balanceSheet, item.id);
      for (const k of collectYearKeysFromRowTree(bsRow ? [bsRow] : [])) yearSet.add(k);
    }
  }
  const chron = sortYearsChronologically([...yearSet]);

  const revW: Record<string, number> = { ...revByYear };
  const cogsW: Record<string, number> = { ...cogsByYear };
  for (const y of chron) {
    revW[y] = pickNumericByYearKey(revByYear, y);
    cogsW[y] = pickNumericByYearKey(cogsByYear, y);
  }

  const projectedBalances: Record<string, Record<string, number>> = {};
  for (const item of wcItems) {
    projectedBalances[item.id] = {};
    const bsRow = findRowInTree(balanceSheet, item.id);
    for (const y of chron) {
      if (yearIsHistoricalForWc(y, historicalYears, projectionYears)) {
        projectedBalances[item.id]![y] = pickRowValueByYear(bsRow?.values, y);
      } else {
        const manual = pickRowValueByYear(bsRow?.values, y);
        projectedBalances[item.id]![y] = computeWcProjectedBalance(
          item.id,
          y,
          driverState,
          revW,
          cogsW,
          manual !== 0 ? manual : undefined
        );
      }
    }
  }

  return { projectedBalances, chron };
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
