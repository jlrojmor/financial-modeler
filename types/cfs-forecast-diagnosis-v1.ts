/**
 * AI + user workflow for mapping historic CFS lines to Forecast Drivers coverage.
 */

export type CfsDiagnosisUserStatus = "pending" | "accepted" | "edited" | "dismissed";

export type CfsAiSuggestedMapping = "none" | "balance_sheet" | "income_statement" | "schedule" | "unmapped";

export type CfsAiRecommendedTreatment =
  | "map_to_bs"
  | "use_is_bridge"
  | "flat_last"
  | "pct_revenue"
  | "zero"
  | "exclude"
  | "manual_grid";

/** IB-style materiality judgment from AI (optional). */
export type CfsAiMaterialityNote = "immaterial" | "standard" | "material";

export type CfsLineAiDiagnosisPayload = {
  suggestedMapping: CfsAiSuggestedMapping;
  linkedRowId?: string;
  /** Short line-level note; may be adjusted by validation. */
  rationale: string;
  recommendedTreatment: CfsAiRecommendedTreatment;
  confidence: number;
  flags?: string[];
  /** 2–4 sentences: economic meaning, cross-statement view, stance. */
  executiveSummary?: string;
  /** Prefer BS vs IS bridge vs CFS-only assumption, with reasoning. */
  bridgeRecommendation?: string;
  /** One sentence on double-count or overlap risk with IS/BS. */
  doubleCountRisk?: string;
  /** Up to 3 alternatives considered and why rejected. */
  rejectedAlternatives?: string[];
  materialityNote?: CfsAiMaterialityNote;
};

/** Per CFS row: latest AI run + user review state. */
export type CfsLineForecastDiagnosisV1 = {
  cfsRowId: string;
  lastAiRunAt?: number;
  ai?: CfsLineAiDiagnosisPayload;
  userStatus: CfsDiagnosisUserStatus;
  editedLinkedRowId?: string;
  editedTreatment?: CfsAiRecommendedTreatment;
};
