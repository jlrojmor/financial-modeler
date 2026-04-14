/**
 * Phase 2 — Debt schedule (v1). First-class capital structure schedule; interest expense is an output.
 * Future: floating rates, fees, PIK, sweep automation, circularity (see engine comments).
 */

export const DEBT_SCHEDULE_PHASE2_ID = "phase2_debt_schedule_v1";

export type DebtScheduleTypeV1 = "debt_schedule";

/** Legacy: revolver / term_debt remain in persisted JSON; map to display labels only (bank line / term loan). */
export type DebtTrancheTypeV1 =
  | "bank_line"
  | "term_loan"
  | "mortgage"
  | "shareholder_loan"
  | "other"
  | "revolver"
  | "term_debt";

/** detected_historical_bs: engine resolves from BS detection (legacy). historical: total × allocation %. manual: openingBalanceManual. */
export type OpeningBalanceSourceV1 = "detected_historical_bs" | "historical" | "manual";

/** Bucket when using detected historical BS balances (legacy engine path). */
export type OpeningDebtBucketV1 = "current_funded" | "long_term_funded" | "all_funded";

export type InterestRateMethodV1 = "fixed_rate" | "manual_by_year";

/** v1: simple fixed or year-specific nominal rates. Future: floating + spread. */
export type InterestComputationBasisV1 = "average_balance" | "ending_balance";

/** How straight-line amortization is applied (mandatory repayments written only on Apply in the builder). */
export type AmortizationMethodV1 = "straight_line" | "manual_by_year" | "none";

/** Global interest convention: when set, overrides per-tranche basis in the engine for interest expense. */
export type DebtScheduleConventionTypeV1 = "mid_year" | "full_year";

/**
 * One debt tranche. Multiple tranches supported; engine aggregates.
 * Revolver uses same cash flow fields for v1 — auto draw/paydown deferred (future circularity / cash bridge).
 */
export type DebtTrancheConfigV1 = {
  trancheId: string;
  trancheName: string;
  trancheType: DebtTrancheTypeV1;
  isEnabled: boolean;
  openingBalanceSource: OpeningBalanceSourceV1;
  /** Which detected funded-debt aggregate feeds opening balance (detected_historical_bs only). */
  openingDebtBucket?: OpeningDebtBucketV1;
  /** Beginning balance at start of first projection year when openingBalanceSource === "manual" (model units). */
  openingBalanceManual?: number;
  /**
   * When openingBalanceSource === "historical": share of BS total debt (st_debt + lt_debt or detected total) at last historical year.
   * Use 100 for a single tranche that takes all reported funded debt; split across tranches as needed.
   */
  openingHistoricalAllocationPct: number;
  drawsByYear: Record<string, number>;
  mandatoryRepaymentByYear: Record<string, number>;
  optionalRepaymentByYear: Record<string, number>;
  interestRateMethod: InterestRateMethodV1;
  /** Nominal % per year when interestRateMethod === "fixed_rate" (e.g. 5.5 = 5.5%). */
  fixedInterestRatePct?: number;
  /** Nominal % per projection year when interestRateMethod === "manual_by_year". */
  interestRateByYear: Record<string, number>;
  interestComputationBasis: InterestComputationBasisV1;

  // --- Optional extensions (backward compatible) ---

  /** Tranche ordering for display / future waterfall (v1 informational). */
  priority?: number;
  maturityYear?: string;
  repaymentStartYear?: string;
  amortizationMethod?: AmortizationMethodV1;
  /** When amortizationMethod === straight_line: optional % of opening per year (builder may derive from years). */
  annualAmortizationPct?: number;
  /** Provenance for opening balance (UI); does not change engine alone — paired with source + manual/historical fields. */
  detectedFromBucket?: "short_term" | "long_term" | "manual";

  // --- Revolver / cash-sweep parameters (bank_line / revolver tranche only) ---
  // Persisted so they survive Apply and are available when the CF statement is connected.

  /** Minimum cash to maintain as % of that year's revenue (e.g. 2 = 2%). */
  minCashPctRevenue?: number;
  /** Absolute minimum cash floor in stored (model) K units. Effective floor = max(minCashPctRevenue × revenue, minCashFloorStoredK). */
  minCashFloorStoredK?: number;
  /** Maximum revolver commitment / borrowing cap in stored K units. Replaces the non-persisted revolverCapKByTrancheId local state. */
  revolverCapStoredK?: number;
};

export type DebtScheduleConfigBodyV1 = {
  scheduleType: DebtScheduleTypeV1;
  tranches: DebtTrancheConfigV1[];
  /** Interest convention: mid_year ≈ average balance, full_year ≈ ending balance. Default when omitted: mid_year. */
  conventionType?: DebtScheduleConventionTypeV1;
};

export type DebtSchedulePhase2Persist = {
  draft: DebtScheduleConfigBodyV1;
  applied: DebtScheduleConfigBodyV1 | null;
};

/** @deprecated use DEBT_SCHEDULE_PHASE2_ID */
export const DEBT_SCHEDULE_PHASE2_PLACEHOLDER_ID = DEBT_SCHEDULE_PHASE2_ID;
