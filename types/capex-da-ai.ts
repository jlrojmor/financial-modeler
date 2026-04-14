/**
 * AI suggestion response type for the Capex & D&A schedule builder.
 * Returned by POST /api/ai/capex-da-suggest.
 */
export type CapexDaAiSuggestion = {
  /** Suggested Capex as % of revenue for the projection period (e.g. 6.6). */
  suggestedCapexPctRevenue: number;
  /** Aggregate average useful life in years (when not using buckets). */
  suggestedUsefulLifeSingle: number;
  /** Per-bucket suggested useful lives in years. Keyed by bucket ID (cap_b1…cap_b10). */
  suggestedUsefulLifeByBucket: Record<string, number>;
  /** Suggested allocation % across buckets (sum of non-Land, non-CIP must equal ~100). */
  suggestedAllocationPct: Record<string, number>;
  /** Human-readable rationale for the Capex % suggestion. */
  rationaleCapex: string;
  /** Human-readable rationale for useful life and allocation suggestions. */
  rationaleUsefulLife: string;
  /** Model confidence level. */
  confidence: "high" | "medium" | "low";
};
