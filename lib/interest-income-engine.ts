/**
 * Interest Income Schedule Engine.
 * Pure function — no IS/BS/CFS writes. Computes projected interest income
 * from one of four forecast methods.
 */

export type InterestIncomeMethod =
  | "pct_avg_cash"
  | "flat_value"
  | "growth_pct"
  | "manual_by_year";

export type InterestIncomeEngineInput = {
  projectionYears: string[];
  /** BS cash row values keyed by year — may include historical + projected */
  cashByYear: Record<string, number>;
  /** Last historical cash balance, used as prior-year anchor for first projection */
  lastHistCash: number;
  /** Last historical interest income (absolute value) */
  lastHistInterestIncome: number;
  method: InterestIncomeMethod;
  /** Used when method === "pct_avg_cash" */
  ratePct: number;
  /** Used when method === "flat_value" */
  flatValue: number;
  /** Used when method === "growth_pct" */
  growthPct: number;
  /** Used when method === "manual_by_year" */
  manualByYear: Record<string, number>;
};

export type InterestIncomeEngineOutput = {
  /** Projected interest income by year (positive = income) */
  interestIncomeByYear: Record<string, number>;
  /** Average cash balance used per year (for pct_avg_cash display) */
  avgCashByYear: Record<string, number>;
};

/**
 * Compute projected interest income by year.
 * Returns positive values (income), not sign-flipped.
 */
export function computeInterestIncomeSchedule(
  input: InterestIncomeEngineInput
): InterestIncomeEngineOutput {
  const {
    projectionYears,
    cashByYear,
    lastHistCash,
    lastHistInterestIncome,
    method,
    ratePct,
    flatValue,
    growthPct,
    manualByYear,
  } = input;

  const interestIncomeByYear: Record<string, number> = {};
  const avgCashByYear: Record<string, number> = {};

  const rate = (ratePct ?? 0) / 100;

  let prevIncome = Math.abs(lastHistInterestIncome);

  for (let i = 0; i < projectionYears.length; i++) {
    const y = projectionYears[i]!;
    const prevYear = i === 0 ? null : projectionYears[i - 1]!;
    const cashThis = cashByYear[y] ?? lastHistCash;
    const cashPrev = prevYear != null ? (cashByYear[prevYear] ?? lastHistCash) : lastHistCash;
    const avgCash = (cashThis + cashPrev) / 2;
    avgCashByYear[y] = avgCash;

    if (method === "pct_avg_cash") {
      interestIncomeByYear[y] = avgCash * rate;
    } else if (method === "flat_value") {
      interestIncomeByYear[y] = flatValue ?? 0;
    } else if (method === "growth_pct") {
      const g = (growthPct ?? 0) / 100;
      prevIncome = i === 0 ? prevIncome : (interestIncomeByYear[prevYear!] ?? prevIncome);
      interestIncomeByYear[y] = prevIncome * (1 + g);
      prevIncome = interestIncomeByYear[y]!;
    } else {
      // manual_by_year
      interestIncomeByYear[y] = manualByYear[y] ?? 0;
    }
  }

  return { interestIncomeByYear, avgCashByYear };
}
