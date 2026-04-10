/**
 * Non-LLM advisory for interest expense schedule method (source + confidence + reason).
 */

import type { InterestExpenseScheduleMethod } from "@/types/interest-expense-schedule-v1";

export type InterestExpenseAdvisory = {
  suggestedMethod: InterestExpenseScheduleMethod;
  source: string;
  confidencePct: number;
  reason: string;
};

export function getInterestExpenseScheduleAdvisory(): InterestExpenseAdvisory {
  return {
    suggestedMethod: "pct_avg_debt",
    source: "Built-in guidance",
    confidencePct: 72,
    reason:
      "Interest expense usually tracks debt outstanding through the year; % of average debt is the most common convention. Use % of ending debt if you prefer simplicity. Manual by year fits known coupons, swaps, or management guidance.",
  };
}
