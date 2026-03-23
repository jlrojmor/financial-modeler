/**
 * Revenue Forecasting v1: structured config and roles.
 * Supports only: independent_driver, derived_sum, allocation_of_parent.
 * Methods: growth_rate, fixed_value, price_volume (direct rows only).
 */

export type RevenueForecastRoleV1 =
  | "independent_driver"
  | "derived_sum"
  | "allocation_of_parent";

export type RevenueForecastMethodV1 =
  | "growth_rate"
  | "fixed_value"
  | "price_volume"
  | "customers_arpu"
  | "locations_revenue_per_location"
  | "capacity_utilization_yield"
  | "contracts_acv";

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

/** Monetization driver period: monthly inputs are annualized (×12) to match annual revenue output. */
export type MonetizationPeriodBasisV1 = "monthly" | "annual";

/**
 * Direct-only: revenue = customers × ARPU; each side can use constant/phases/by_year growth.
 */
export interface CustomersArpuParamsV1 {
  /** Starting paying customer base (plain count, not K/M-scaled). */
  startingCustomers?: number;
  /** Starting ARPU in absolute model currency (not statement display-unit scaled). */
  startingArpu?: number;
  /**
   * Whether `startingArpu` / projected ARPU are **monthly** or **annual** per customer.
   * Omitted or invalid values are treated as `"annual"` for backward compatibility.
   */
  arpuBasis?: MonetizationPeriodBasisV1;
  /** Optional display label for customer base (e.g. subscribers, members, accounts). */
  customerUnitLabel?: string;
  customerGrowthPatternType?: GrowthPatternTypeV1;
  customerRatePercent?: number;
  customerRatesByYear?: Record<string, number>;
  customerGrowthPhases?: GrowthPhaseV1[];
  arpuGrowthPatternType?: GrowthPatternTypeV1;
  arpuRatePercent?: number;
  arpuRatesByYear?: Record<string, number>;
  arpuGrowthPhases?: GrowthPhaseV1[];
}

/**
 * Direct-only: revenue = locations × revenue per location; each side can use constant/phases/by_year growth.
 */
export interface LocationsRevenuePerLocationParamsV1 {
  /** Starting location count (plain count, not K/M-scaled). */
  startingLocations?: number;
  /** Starting revenue per location in absolute model currency (not statement display-unit scaled). */
  startingRevenuePerLocation?: number;
  /**
   * Whether `startingRevenuePerLocation` / projected values are **monthly** or **annual** per location.
   * Omitted or invalid values are treated as `"annual"` for backward compatibility.
   */
  revenuePerLocationBasis?: MonetizationPeriodBasisV1;
  /** Optional display label for location base (e.g. stores, branches, clinics). */
  locationUnitLabel?: string;
  locationGrowthPatternType?: GrowthPatternTypeV1;
  locationRatePercent?: number;
  locationRatesByYear?: Record<string, number>;
  locationGrowthPhases?: GrowthPhaseV1[];
  revenuePerLocationGrowthPatternType?: GrowthPatternTypeV1;
  revenuePerLocationRatePercent?: number;
  revenuePerLocationRatesByYear?: Record<string, number>;
  revenuePerLocationGrowthPhases?: GrowthPhaseV1[];
}

/** Utilization path: levels (% of capacity used), not compounding growth. */
export type UtilizationPatternTypeV1 = "constant" | "by_year" | "phases";

/** One phase of constant target utilization % (inclusive projection years). */
export interface UtilizationPhaseV1 {
  startYear: string;
  endYear: string;
  /** Target utilization 0–100 for all years in [startYear, endYear]. */
  utilizationPct: number;
}

/**
 * Direct-only: revenue = capacity × utilization × yield;
 * capacity and yield compound with growth patterns; utilization is a level path by year.
 */
export interface CapacityUtilizationYieldParamsV1 {
  startingCapacity?: number;
  startingUtilizationPct?: number;
  startingYield?: number;
  /** Optional label for capacity units (seats, rooms, MW, etc.). */
  capacityUnitLabel?: string;
  /**
   * Period basis for yield only (currency per utilized unit).
   * Monthly yield is annualized ×12 for annual revenue output.
   */
  yieldBasis?: MonetizationPeriodBasisV1;
  capacityGrowthPatternType?: GrowthPatternTypeV1;
  capacityRatePercent?: number;
  capacityRatesByYear?: Record<string, number>;
  capacityGrowthPhases?: GrowthPhaseV1[];
  utilizationPatternType?: UtilizationPatternTypeV1;
  /** Constant-path level (0–100); if omitted, engine uses startingUtilizationPct. */
  utilizationPct?: number;
  utilizationPctsByYear?: Record<string, number>;
  utilizationPhases?: UtilizationPhaseV1[];
  yieldGrowthPatternType?: GrowthPatternTypeV1;
  yieldRatePercent?: number;
  yieldRatesByYear?: Record<string, number>;
  yieldGrowthPhases?: GrowthPhaseV1[];
}

/**
 * Direct-only: revenue = contracts × ACV (annual contract value per contract).
 * Same growth-pattern architecture as Price × Volume; no monthly/annual basis — ACV is annual by definition.
 */
export interface ContractsAcvParamsV1 {
  /** Contract / account count (plain number, not K/M-scaled). */
  startingContracts?: number;
  /** Annual contract value per contract in absolute model currency (not statement K/M). */
  startingAcv?: number;
  /** Optional label (e.g. contracts, enterprise accounts, agreements). */
  contractUnitLabel?: string;
  contractGrowthPatternType?: GrowthPatternTypeV1;
  contractRatePercent?: number;
  contractRatesByYear?: Record<string, number>;
  contractGrowthPhases?: GrowthPhaseV1[];
  acvGrowthPatternType?: GrowthPatternTypeV1;
  acvRatePercent?: number;
  acvRatesByYear?: Record<string, number>;
  acvGrowthPhases?: GrowthPhaseV1[];
}

export type ForecastParametersV1 =
  | GrowthRateParamsV1
  | FixedValueParamsV1
  | PriceVolumeParamsV1
  | CustomersArpuParamsV1
  | LocationsRevenuePerLocationParamsV1
  | CapacityUtilizationYieldParamsV1
  | ContractsAcvParamsV1;

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
