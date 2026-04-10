/**
 * Phase 2 — Debt schedule (v1). First-class capital structure schedule; interest expense is an output.
 * Future: floating rates, fees, PIK, sweep automation, circularity (see engine comments).
 */

export const DEBT_SCHEDULE_PHASE2_ID = "phase2_debt_schedule_v1";

export type DebtScheduleTypeV1 = "debt_schedule";

export type DebtTrancheTypeV1 = "revolver" | "term_debt" | "other";

export type OpeningBalanceSourceV1 = "historical" | "manual";

export type InterestRateMethodV1 = "fixed_rate" | "manual_by_year";

/** v1: simple fixed or year-specific nominal rates. Future: floating + spread. */
export type InterestComputationBasisV1 = "average_balance" | "ending_balance";

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
  /** Beginning balance at start of first projection year when openingBalanceSource === "manual" (model units). */
  openingBalanceManual?: number;
  /**
   * When openingBalanceSource === "historical": share of BS total debt (st_debt + lt_debt) at last historical year.
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
};

export type DebtScheduleConfigBodyV1 = {
  scheduleType: DebtScheduleTypeV1;
  tranches: DebtTrancheConfigV1[];
};

export type DebtSchedulePhase2Persist = {
  draft: DebtScheduleConfigBodyV1;
  applied: DebtScheduleConfigBodyV1 | null;
};

/** @deprecated use DEBT_SCHEDULE_PHASE2_ID */
export const DEBT_SCHEDULE_PHASE2_PLACEHOLDER_ID = DEBT_SCHEDULE_PHASE2_ID;
