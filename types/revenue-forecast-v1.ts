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

/** Parameters for growth_rate: constant % or per-year %. Base from last historical or optional starting amount. */
export interface GrowthRateParamsV1 {
  /** Constant growth % (e.g. 5 for 5%). Used when ratesByYear is absent. */
  ratePercent?: number;
  /** Per-year growth % when not constant. year -> percent */
  ratesByYear?: Record<string, number>;
  /** Optional starting/base amount (stored units). Used as first projection-year base when no last historical value. */
  startingAmount?: number;
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
  /** growth_rate: { ratePercent?, ratesByYear?, startingAmount? }. fixed_value: { value?, valuesByYear? }. allocation_of_parent: { allocationPercent? } or { allocationByYear? }. */
  forecastParameters?: Record<string, number | Record<string, number> | undefined>;
  forecastReferenceId?: string | null;
  forecastReason?: string;
  forecastConfidence?: ForecastConfidenceV1;
}

export interface RevenueForecastConfigV1 {
  /** rowId -> config. Must include "rev" (Total Revenue) and each revenue stream/child. */
  rows: Record<string, RevenueForecastRowConfigV1>;
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
