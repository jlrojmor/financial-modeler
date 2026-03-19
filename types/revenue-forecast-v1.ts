/**
 * Revenue Forecasting v1: structured config and roles.
 * Supports only: independent_driver, derived_sum, allocation_of_parent.
 * Methods: growth_rate, fixed_value.
 * No price_volume, customers_arpu, percent_of_reference, plug, or circular resolution.
 */

export type RevenueForecastRoleV1 =
  | "independent_driver"
  | "derived_sum"
  | "allocation_of_parent";

export type RevenueForecastMethodV1 = "growth_rate" | "fixed_value";

export type ForecastConfidenceV1 = "high" | "medium" | "low";

/** How the first projection year base is determined for growth_rate (historical vs manual start only). */
export type GrowthStartingBasisV1 = "last_historical" | "starting_amount";

/** How per-year growth is defined (direct growth methods only). */
export type GrowthPatternTypeV1 = "constant" | "phases" | "by_year";

/** One contiguous phase of constant growth % (projection years inclusive). */
export interface GrowthPhaseV1 {
  startYear: string;
  endYear: string;
  ratePercent: number;
}

/**
 * Parameters for growth_rate: constant %, phased % (expanded to ratesByYear in engine), or by_year %.
 * Base from last historical or manual starting amount.
 */
export interface GrowthRateParamsV1 {
  ratePercent?: number;
  ratesByYear?: Record<string, number>;
  startingAmount?: number;
  startingBasis?: GrowthStartingBasisV1;
  growthPatternType?: GrowthPatternTypeV1;
  growthPhases?: GrowthPhaseV1[];
}

/** Parameters for fixed_value: flat (same value each year) or manual by year. */
export interface FixedValueParamsV1 {
  /** Flat: single value (stored units) for all projection years. Used when valuesByYear is absent or empty. */
  value?: number;
  /** Manual by year: explicit value per projection year (stored units). When present, at least one year must have a value. */
  valuesByYear?: Record<string, number>;
}

export type ForecastParametersV1 = GrowthRateParamsV1 | FixedValueParamsV1;

/**
 * Per-row revenue forecast config (v1).
 * - independent_driver: has forecastMethod (growth_rate | fixed_value) and forecastParameters.
 * - derived_sum: no method; value = sum(children).
 * - allocation_of_parent: only allocation % (stored in forecastParameters as allocationPercent, or per-year).
 */
export interface RevenueForecastRowConfigV1 {
  rowId: string;
  forecastRole: RevenueForecastRoleV1;
  forecastMethod?: RevenueForecastMethodV1;
  /** growth_rate: includes growthPhases, growthPatternType when phased. fixed_value / allocation as before. */
  forecastParameters?: Record<
    string,
    number | Record<string, number> | string | undefined | GrowthPhaseV1[] | unknown[]
  >;
  forecastReferenceId?: string | null;
  forecastReason?: string;
  forecastConfidence?: ForecastConfidenceV1;
}

export interface RevenueForecastConfigV1 {
  /** rowId -> config. Must include "rev" (Total Revenue) and each revenue stream/child. */
  rows: Record<string, RevenueForecastRowConfigV1>;
}

/**
 * Forecast-only revenue hierarchy. Independent from incomeStatement rev.children.
 * Edited only in Forecast Drivers; Historicals never sees these nodes except when id matches a historical row (isForecastOnly: false).
 */
export interface ForecastRevenueNodeV1 {
  id: string;
  label: string;
  children: ForecastRevenueNodeV1[];
  /** True if this line was added in Forecast Drivers only (no row in historical IS). */
  isForecastOnly: boolean;
}

export const DEFAULT_REVENUE_FORECAST_CONFIG_V1: RevenueForecastConfigV1 = {
  rows: {},
};

/** Validation error for revenue structure (v1). */
export interface RevenueForecastValidationError {
  rowId?: string;
  message: string;
  code?: string;
}

export interface RevenueForecastValidationResult {
  valid: boolean;
  errors: RevenueForecastValidationError[];
}
