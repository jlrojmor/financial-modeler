/**
 * Revenue Forecasting v1: structured config and roles.
 * Supports only: independent_driver, derived_sum, allocation_of_parent.
 * Methods: growth_rate, fixed_value, price_volume (direct rows only).
 */

export type RevenueForecastRoleV1 =
  | "independent_driver"
  | "derived_sum"
  | "allocation_of_parent";

export type RevenueForecastMethodV1 = "growth_rate" | "fixed_value" | "price_volume";

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
  /** Manual-start base: real currency amount (not K/M-scaled display units). */
  startingAmount?: number;
  startingBasis?: GrowthStartingBasisV1;
  growthPatternType?: GrowthPatternTypeV1;
  growthPhases?: GrowthPhaseV1[];
}

/** Parameters for fixed_value: flat (same value each year) or manual by year. */
export interface FixedValueParamsV1 {
  /** Flat: real currency amount (not scaled by model K/M display unit). */
  value?: number;
  /** Manual by year: real currency amount per projection year. */
  valuesByYear?: Record<string, number>;
}

/**
 * Direct-only: revenue = volume × price; each side uses the same growth pattern shapes as growth_rate
 * (constant / phases / by_year) with prefixed keys on forecastParameters.
 */
export interface PriceVolumeParamsV1 {
  startingVolume?: number;
  /**
   * Absolute price per unit in model currency (e.g. USD), **not** scaled by statement display unit (K/M).
   * Revenue = startingVolume × startingPricePerUnit in the same absolute space as other IS amounts.
   */
  startingPricePerUnit?: number;
  /** Optional display label for what “volume” counts (e.g. subscribers, kg). Does not affect math. */
  volumeUnitLabel?: string;
  volumeGrowthPatternType?: GrowthPatternTypeV1;
  volumeRatePercent?: number;
  volumeRatesByYear?: Record<string, number>;
  volumeGrowthPhases?: GrowthPhaseV1[];
  priceGrowthPatternType?: GrowthPatternTypeV1;
  priceRatePercent?: number;
  priceRatesByYear?: Record<string, number>;
  priceGrowthPhases?: GrowthPhaseV1[];
}

export type ForecastParametersV1 = GrowthRateParamsV1 | FixedValueParamsV1 | PriceVolumeParamsV1;

/**
 * Per-row revenue forecast config (v1).
 * - independent_driver: has forecastMethod (growth_rate | fixed_value | price_volume) and forecastParameters.
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
