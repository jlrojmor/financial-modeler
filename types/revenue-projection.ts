/**
 * Revenue projection config and method types.
 * Used only in IS Build; Historicals are untouched.
 */

export type RevenueProjectionMethod =
  | "growth_rate"
  | "price_volume"
  | "customers_arpu"
  | "pct_of_total"
  | "product_line"
  | "channel";

/** Growth rate: constant % or custom per year */
export interface GrowthRateInputs {
  growthType: "constant" | "custom_per_year";
  ratePercent?: number; // e.g. 5 for 5%
  ratesByYear?: Record<string, number>; // year -> % e.g. { "2026E": 8, "2027E": 6 }
  baseYear?: string; // last historic if not set
  /** Optional base $ (display units) to project from. When set, overrides allocation-derived base so growth is not tied to allocation weight. */
  baseAmount?: number;
}

/** Price × Volume; optional annualize from monthly (×12) */
export interface PriceVolumeInputs {
  baseYear: string;
  price: number; // display units (e.g. per unit or per month)
  volume: number;
  priceGrowthPercent?: number;
  volumeGrowthPercent?: number;
  annualizeFromMonthly?: boolean; // if true, revenue = price * volume * 12 for base
}

/** Customers × ARPU */
export interface CustomersArpuInputs {
  baseYear: string;
  customers: number;
  arpu: number; // avg revenue per user (annual)
  customerGrowthPercent?: number;
  arpuGrowthPercent?: number;
}

/** % of a reference revenue total (that year). Reference = Total Revenue or a fixed stream. */
export interface PctOfTotalInputs {
  /** Id of the line whose total we take a % of: "rev" = Total Revenue, or a stream id */
  referenceId: string;
  /** Target share (e.g. 30 for 30%) */
  pctOfTotal: number;
}

/** Product line or channel: list of lines with base-year share (%) and growth % each. Sum of shares = 100%. */
export interface ProductLineInputs {
  items: Array<{ id: string; label: string; sharePercent: number; growthPercent: number }>;
  /** Optional base $ (display units) for the stream total. When set, overrides allocation-derived base. */
  baseAmount?: number;
}

export type RevenueProjectionInputs =
  | GrowthRateInputs
  | PriceVolumeInputs
  | CustomersArpuInputs
  | PctOfTotalInputs
  | ProductLineInputs;

export interface RevenueProjectionItemConfig {
  method: RevenueProjectionMethod;
  inputs: RevenueProjectionInputs;
}

/** User-added breakdown under a stream (e.g. Subscriptions → "Recurring from monthly", "Subscribed companies") */
export interface RevenueBreakdownItem {
  id: string;
  label: string;
}

/** Allocation of parent's historic base to breakdown items (percentages or amounts) — legacy/optional */
export interface BreakdownAllocation {
  mode: "percentages" | "amounts";
  allocations: Record<string, number>;
  year: string;
}

/** Allocation for projection years only: % share of stream total (first projection year onwards). Sum = 100%. */
export interface ProjectionAllocation {
  /** breakdown item id -> percentage (0-100). Sum across items = 100. */
  percentages: Record<string, number>;
}

export interface RevenueProjectionConfig {
  /** Per-item (stream or breakdown item) forecast method + inputs */
  items: Record<string, RevenueProjectionItemConfig>;
  /** Breakdown sub-items per parent stream id */
  breakdowns: Record<string, RevenueBreakdownItem[]>;
  /** Legacy: allocation of historic base per year */
  allocations: Record<string, BreakdownAllocation>;
  /** Allocation for projection years: % per breakdown (applies to first projection year onwards). */
  projectionAllocations: Record<string, ProjectionAllocation>;
}

export const DEFAULT_REVENUE_PROJECTION_CONFIG: RevenueProjectionConfig = {
  items: {},
  breakdowns: {},
  allocations: {},
  projectionAllocations: {},
};

export function isGrowthRateInputs(
  m: RevenueProjectionMethod,
  i: RevenueProjectionInputs
): i is GrowthRateInputs {
  return m === "growth_rate";
}
export function isPriceVolumeInputs(
  m: RevenueProjectionMethod,
  i: RevenueProjectionInputs
): i is PriceVolumeInputs {
  return m === "price_volume";
}
export function isCustomersArpuInputs(
  m: RevenueProjectionMethod,
  i: RevenueProjectionInputs
): i is CustomersArpuInputs {
  return m === "customers_arpu";
}
export function isPctOfTotalInputs(
  m: RevenueProjectionMethod,
  i: RevenueProjectionInputs
): i is PctOfTotalInputs {
  return m === "pct_of_total";
}

/** Classification for allocation rules: at most two of these in one stream. */
export type BreakdownProjectionType = "growth" | "dollar" | "pct_of_stream";

const GROWTH_METHODS: RevenueProjectionMethod[] = ["growth_rate", "product_line", "channel"];
const DOLLAR_METHODS: RevenueProjectionMethod[] = ["price_volume", "customers_arpu"];

/**
 * Get the projection type for a breakdown (method + reference when pct_of_total).
 * pct_of_stream only when referenceId is the parent stream id.
 */
export function getBreakdownProjectionType(
  method: RevenueProjectionMethod | undefined,
  inputs: RevenueProjectionInputs | undefined,
  parentStreamId: string
): BreakdownProjectionType | null {
  if (!method) return null;
  if (GROWTH_METHODS.includes(method)) return "growth";
  if (DOLLAR_METHODS.includes(method)) return "dollar";
  if (method === "pct_of_total") {
    const refId = (inputs as PctOfTotalInputs | undefined)?.referenceId ?? "rev";
    return refId === parentStreamId ? "pct_of_stream" : null; // "% of other" doesn't count as pct_of_stream for this stream
  }
  return null;
}

/**
 * Check if this stream has an invalid mix: growth + dollar + pct_of_stream all present.
 * Valid = at most two of the three types.
 */
export function getBreakdownTypesPresent(
  breakdownIds: string[],
  items: Record<string, RevenueProjectionItemConfig>,
  parentStreamId: string
): Set<BreakdownProjectionType> {
  const set = new Set<BreakdownProjectionType>();
  for (const id of breakdownIds) {
    const cfg = items[id];
    const t = getBreakdownProjectionType(cfg?.method, cfg?.inputs, parentStreamId);
    if (t) set.add(t);
  }
  return set;
}

export function hasInvalidBreakdownMix(
  breakdownIds: string[],
  items: Record<string, RevenueProjectionItemConfig>,
  parentStreamId: string
): boolean {
  const types = getBreakdownTypesPresent(breakdownIds, items, parentStreamId);
  return types.has("growth") && types.has("dollar") && types.has("pct_of_stream");
}
