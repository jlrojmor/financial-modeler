import type { TaxForecastMethod } from "@/lib/tax-schedule-engine";

export type { TaxForecastMethod };

export type TaxScheduleAiSuggestion = {
  suggestedRatePct: number;
  entityTypeNote: string | null;
  rationale: string;
  erraticFlag: boolean;
  erraticExplanation: string | null;
  confidence: "high" | "medium" | "low";
};

export type InterestIncomeAiSuggestion = {
  suggestedRatePct: number;
  shouldSkip: boolean;
  rationale: string;
  confidence: "high" | "medium" | "low";
};
