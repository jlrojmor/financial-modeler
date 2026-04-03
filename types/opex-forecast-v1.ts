import type { GrowthPatternTypeV1, GrowthPhaseV1, GrowthStartingBasisV1 } from "@/types/revenue-forecast-v1";

/** Phase 1 routing — extensible for schedule links (Phase 2) and drivers (Phase 3). */
export type OpExRouteStatusV1 =
  | "forecast_direct"
  | "derive_schedule"
  | "review_required"
  | "excluded_nonrecurring";

/** Who last set `routeStatus` (user override preserved across AI re-runs). */
export type OpExRouteResolvedByV1 = "deterministic" | "ai" | "user";

/** Phase 2 placeholder: schedule module that will own the line. */
export type OpExLinkedFutureScheduleTypeV1 =
  | "depreciation_amortization"
  | "interest"
  | "tax"
  | "stock_compensation"
  | "leases_financing"
  | "other_schedule"
  | null;

export type OpExDirectForecastMethodV1 =
  | "pct_of_revenue"
  | "growth_percent"
  | "flat_value"
  | "manual_by_year";

/** Same shape as COGS % of revenue (constant / by_year / phases on the %). */
export interface OpExPctOfRevenueParamsV1 {
  growthPatternType?: GrowthPatternTypeV1;
  pct?: number;
  pctsByYear?: Record<string, number>;
  growthPhases?: GrowthPhaseV1[];
}

/** Mirrors revenue `growth_rate` params: compound from last historical or manual starting amount. */
export interface OpExGrowthPercentParamsV1 {
  growthPatternType?: GrowthPatternTypeV1;
  ratePercent?: number;
  ratesByYear?: Record<string, number>;
  growthPhases?: GrowthPhaseV1[];
  startingBasis?: GrowthStartingBasisV1;
  startingAmount?: number;
}

export interface OpExFlatValueParamsV1 {
  value?: number;
}

export interface OpExManualByYearParamsV1 {
  valuesByYear?: Record<string, number>;
}

export type OpExForecastParametersV1 =
  | OpExPctOfRevenueParamsV1
  | OpExGrowthPercentParamsV1
  | OpExFlatValueParamsV1
  | OpExManualByYearParamsV1;

export interface OpExForecastLineConfigV1 {
  lineId: string;
  originalLineLabel: string;
  /** Section owner at ingest time (sga | rd | other_operating). */
  sectionOwnerSnapshot?: string;
  parentLineLabel?: string;
  routeStatus: OpExRouteStatusV1;
  routeResolvedBy: OpExRouteResolvedByV1;
  /** When deterministic routing matched first. */
  deterministicRuleId?: string | null;
  linkedFutureScheduleType?: OpExLinkedFutureScheduleTypeV1;
  /** AI advisory (structured; not the sole source for obvious deterministic cases). */
  aiSuggestedRoute?: OpExRouteStatusV1;
  aiSuggestedMethod?: OpExDirectForecastMethodV1;
  aiConfidence?: "high" | "medium" | "low";
  aiExplanation?: string;
  /** Short UI copy from AI routing response. */
  aiUserFacingSummary?: string;
  aiFlags?: string[];
  forecastMethod?: OpExDirectForecastMethodV1;
  forecastParameters?: OpExForecastParametersV1;
}

export interface OpExForecastConfigV1 {
  version: 1;
  lines: Record<string, OpExForecastLineConfigV1>;
}

export const DEFAULT_OPEX_FORECAST_CONFIG_V1: OpExForecastConfigV1 = {
  version: 1,
  lines: {},
};
