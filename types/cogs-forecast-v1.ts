import type { GrowthPatternTypeV1, GrowthPhaseV1, RevenueForecastMethodV1 } from "@/types/revenue-forecast-v1";

export type CogsForecastMethodV1 =
  | "pct_of_revenue"
  | "cost_per_unit"
  | "cost_per_customer"
  | "cost_per_contract"
  | "cost_per_location"
  | "cost_per_utilized_unit";

export interface CogsPctOfRevenueParamsV1 {
  growthPatternType?: GrowthPatternTypeV1;
  pct?: number;
  pctsByYear?: Record<string, number>;
  growthPhases?: GrowthPhaseV1[];
}

/** YoY % growth applied to cost per unit (same compounding discipline as revenue Price × Volume drivers). */
export interface CogsCostPerUnitParamsV1 {
  growthPatternType?: GrowthPatternTypeV1;
  /** Currency per unit at start of forecast (not K/M scaled). */
  startingCostPerUnit?: number;
  /** Constant-mode YoY % on cost per unit. */
  costPerUnitRatePercent?: number;
  costPerUnitRatesByYear?: Record<string, number>;
  costPerUnitGrowthPhases?: GrowthPhaseV1[];
}

/** YoY % on cost per customer (parallel to Cost per Unit). */
export interface CogsCostPerCustomerParamsV1 {
  growthPatternType?: GrowthPatternTypeV1;
  /** Whether `startingCostPerCustomer` and the projected cost series are entered per month or per year. Missing = annual (legacy). */
  costPerCustomerBasis?: "monthly" | "annual";
  startingCostPerCustomer?: number;
  costPerCustomerRatePercent?: number;
  costPerCustomerRatesByYear?: Record<string, number>;
  costPerCustomerGrowthPhases?: GrowthPhaseV1[];
}

/** YoY % on cost per contract (parallel to Cost per Unit / Cost per Customer). */
export interface CogsCostPerContractParamsV1 {
  growthPatternType?: GrowthPatternTypeV1;
  startingCostPerContract?: number;
  costPerContractRatePercent?: number;
  costPerContractRatesByYear?: Record<string, number>;
  costPerContractGrowthPhases?: GrowthPhaseV1[];
}

/** YoY % on cost per location (parallel to other unit-based COGS methods). */
export interface CogsCostPerLocationParamsV1 {
  growthPatternType?: GrowthPatternTypeV1;
  startingCostPerLocation?: number;
  costPerLocationRatePercent?: number;
  costPerLocationRatesByYear?: Record<string, number>;
  costPerLocationGrowthPhases?: GrowthPhaseV1[];
}

/** YoY % on cost per utilized unit (Capacity × Utilization × Yield revenue driver). */
export interface CogsCostPerUtilizedUnitParamsV1 {
  growthPatternType?: GrowthPatternTypeV1;
  startingCostPerUtilizedUnit?: number;
  costPerUtilizedUnitRatePercent?: number;
  costPerUtilizedUnitRatesByYear?: Record<string, number>;
  costPerUtilizedUnitGrowthPhases?: GrowthPhaseV1[];
}

export interface CogsForecastLineConfigV1 {
  lineId: string;
  linkedRevenueRowId: string;
  lineLabel: string;
  linkedRevenueMethod?: RevenueForecastMethodV1;
  forecastMethod?: CogsForecastMethodV1;
  forecastParameters?:
    | CogsPctOfRevenueParamsV1
    | CogsCostPerUnitParamsV1
    | CogsCostPerCustomerParamsV1
    | CogsCostPerContractParamsV1
    | CogsCostPerLocationParamsV1
    | CogsCostPerUtilizedUnitParamsV1;
}

export interface CogsForecastConfigV1 {
  lines: Record<string, CogsForecastLineConfigV1>;
}

export const DEFAULT_COGS_FORECAST_CONFIG_V1: CogsForecastConfigV1 = {
  lines: {},
};
