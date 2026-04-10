import type { Row } from "@/types/finance";
import type { OpExDirectForecastMethodV1 } from "@/types/opex-forecast-v1";
import type {
  NonOperatingPhase2AiLineSuggestion,
  NonOperatingPhase2AiRouteBucket,
  NonOperatingPhase2DirectMethodAi,
  NonOperatingPhase2RouteSourceLabel,
  NonOperatingPhase2ScheduleTypeAi,
} from "@/types/non-operating-phase2-ai";
import {
  defaultPhase2Bucket,
  type Phase2LineBucket,
} from "@/lib/non-operating-phase2-lines";

export function mapAiRouteBucketToPhase2(b: NonOperatingPhase2AiRouteBucket): Phase2LineBucket {
  switch (b) {
    case "scheduled_item":
      return "scheduled";
    case "direct_forecast":
      return "direct";
    case "review_required":
      return "review";
    case "excluded_nonrecurring":
      return "excluded";
    default:
      return "review";
  }
}

export function normalizeDirectMethodAi(
  m: NonOperatingPhase2DirectMethodAi | null | undefined
): OpExDirectForecastMethodV1 | null {
  if (m == null) return null;
  if (m === "phased_growth") return "growth_percent";
  const allowed: OpExDirectForecastMethodV1[] = [
    "pct_of_revenue",
    "growth_percent",
    "flat_value",
    "manual_by_year",
  ];
  return allowed.includes(m as OpExDirectForecastMethodV1) ? (m as OpExDirectForecastMethodV1) : "growth_percent";
}

export function isTemplateRowId(id: string): boolean {
  return id === "interest_expense" || id === "interest_income" || id === "other_income";
}

export function resolvePhase2RouteSource(input: {
  row: Row | null;
  effectiveBucket: Phase2LineBucket;
  classificationLocked: boolean;
}): NonOperatingPhase2RouteSourceLabel {
  if (input.classificationLocked) return "user_override";
  const def = input.row ? defaultPhase2Bucket(input.row) : "review";
  if (input.row && isTemplateRowId(input.row.id) && input.effectiveBucket === def) {
    return "built_in_template";
  }
  return "deterministic_rule";
}

export function formatRouteSourceLabel(src: NonOperatingPhase2RouteSourceLabel): string {
  switch (src) {
    case "built_in_template":
      return "Built-in template";
    case "deterministic_rule":
      return "Deterministic rule";
    case "ai_suggestion":
      return "AI suggestion";
    case "user_override":
      return "User override";
    default:
      return "—";
  }
}

/** UI line for “AI suggestion” reference row (parallel to effective route). */
export function formatAiAdvisorySourceLine(s: NonOperatingPhase2AiLineSuggestion | undefined): string {
  if (!s) return "";
  return `AI suggestion · ${s.confidencePct}% confidence`;
}
