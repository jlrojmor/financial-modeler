import type { GrowthPatternTypeV1, GrowthPhaseV1, RevenueForecastMethodV1 } from "@/types/revenue-forecast-v1";

export type CogsForecastMethodV1 = "pct_of_revenue" | "cost_per_unit" | "cost_per_customer";

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
  startingCostPerCustomer?: number;
  costPerCustomerRatePercent?: number;
  costPerCustomerRatesByYear?: Record<string, number>;
  costPerCustomerGrowthPhases?: GrowthPhaseV1[];
}

export interface CogsForecastLineConfigV1 {
  lineId: string;
  linkedRevenueRowId: string;
  lineLabel: string;
  linkedRevenueMethod?: RevenueForecastMethodV1;
  forecastMethod?: CogsForecastMethodV1;
  forecastParameters?: CogsPctOfRevenueParamsV1 | CogsCostPerUnitParamsV1 | CogsCostPerCustomerParamsV1;
}

export interface CogsForecastConfigV1 {
  lines: Record<string, CogsForecastLineConfigV1>;
}

export const DEFAULT_COGS_FORECAST_CONFIG_V1: CogsForecastConfigV1 = {
  lines: {},
};
