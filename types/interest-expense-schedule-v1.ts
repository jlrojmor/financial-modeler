/**
 * Phase 2 — Interest expense schedule (v1). Extensible for fees, floating rates, tranches later.
 */

export type InterestExpenseScheduleType = "interest_expense";

/** v1 methods only */
export type InterestExpenseScheduleMethod = "pct_avg_debt" | "pct_ending_debt" | "manual_by_year";

export type InterestExpenseDebtSource = "model" | "manual";

export type InterestExpenseScheduleConfigBody = {
  scheduleType: InterestExpenseScheduleType;
  method: InterestExpenseScheduleMethod;
  /** Annual nominal rate, e.g. 5.5 = 5.5% per year (debt-based methods). */
  interestRatePct: number;
  debtSource: InterestExpenseDebtSource;
  /** Ending debt by year (model currency units); used when debtSource === "manual". */
  manualDebtByYear: Record<string, number>;
  /** Positive = expense magnitude (manual method). */
  manualInterestByYear: Record<string, number>;
};

/** Per IS line (e.g. interest_expense); lineId mirrors the map key for export/snapshots. */
export type InterestExpenseScheduleLinePersist = {
  lineId: string;
  draft: InterestExpenseScheduleConfigBody;
  applied: InterestExpenseScheduleConfigBody | null;
};
