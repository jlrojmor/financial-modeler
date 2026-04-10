import type { OpExDirectForecastMethodV1 } from "@/types/opex-forecast-v1";
import type { Phase2LineBucket } from "@/lib/non-operating-phase2-lines";

/** API / LLM bucket names before map to Phase2LineBucket. */
export type NonOperatingPhase2AiRouteBucket =
  | "scheduled_item"
  | "direct_forecast"
  | "review_required"
  | "excluded_nonrecurring";

export type NonOperatingPhase2ScheduleTypeAi =
  | "interest"
  | "amortization"
  | "taxes"
  | "depreciation"
  | "lease"
  | "stock_compensation"
  | "other";

export type NonOperatingPhase2DirectMethodAi =
  | OpExDirectForecastMethodV1
  | "phased_growth";

export type NonOperatingPhase2SignExpectation =
  | "usually_expense"
  | "usually_income"
  | "mixed_or_ambiguous";

export type NonOperatingPhase2RecurringJudgment = "recurring" | "non_recurring" | "unclear";

/** Persisted per line after an AI classification run (advisory; never overwrites user bucket). */
export type NonOperatingPhase2AiLineSuggestion = {
  lineId: string;
  suggestedBucket: Phase2LineBucket;
  suggestedScheduleType: NonOperatingPhase2ScheduleTypeAi | null;
  suggestedDirectMethod: OpExDirectForecastMethodV1 | null;
  confidencePct: number;
  explanation: string;
  detectedSignals: string[];
  ambiguityFlags: string[];
  recurringJudgment: NonOperatingPhase2RecurringJudgment;
  signExpectation: NonOperatingPhase2SignExpectation;
  suggestedNextAction: string;
  userFacingSummary: string;
  /** Whether a direct forecast in this section is appropriate at all. */
  directForecastAppropriate: boolean | null;
  /** Short rationale for direct vs schedule vs review (Other income / expense focus). */
  directVsScheduleRationale: string;
};

export type NonOperatingPhase2RouteSourceLabel =
  | "built_in_template"
  | "deterministic_rule"
  | "ai_suggestion"
  | "user_override";
