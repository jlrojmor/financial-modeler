/**
 * Tax Schedule Engine.
 * Pure function — no IS/BS/CFS writes. Applies an effective tax rate (ETR)
 * to projected EBT to derive tax expense and net income.
 *
 * IB standard: ETR × max(0, EBT) — no tax benefit on losses unless explicitly enabled.
 */

export type TaxForecastMethod = "flat_rate" | "rate_by_year" | "flat_expense";

export type TaxScheduleInput = {
  projectionYears: string[];
  /** EBT (pre-tax income) by year — positive = profit, negative = loss */
  ebtByYear: Record<string, number>;
  method: TaxForecastMethod;
  /** Used when method === "flat_rate" */
  flatRatePct: number;
  /** Used when method === "rate_by_year" — keyed by year, falls back to flatRatePct */
  rateByYear: Record<string, number>;
  /** Used when method === "flat_expense" (absolute value, always positive expense) */
  flatExpense: number;
  /**
   * If false (IB standard): tax = 0 when EBT <= 0.
   * If true: apply full rate to negative EBT (tax benefit on losses).
   */
  allowTaxBenefit: boolean;
};

export type TaxScheduleOutput = {
  /** Tax expense by year (positive = expense, matches IS convention) */
  taxExpenseByYear: Record<string, number>;
  /** Effective rate applied by year (0–1) */
  effectiveRateByYear: Record<string, number>;
  /** Net income = EBT - tax expense */
  netIncomeByYear: Record<string, number>;
};

export type HistoricalEtrRow = {
  year: string;
  ebt: number;
  tax: number;
  etr: number | null; // null when EBT <= 0
  flagged: boolean;   // true when ETR is erratic (>±10pp from median)
};

/**
 * Compute projected tax expense, effective rate, and net income by year.
 */
export function computeTaxSchedule(input: TaxScheduleInput): TaxScheduleOutput {
  const { projectionYears, ebtByYear, method, flatRatePct, rateByYear, flatExpense, allowTaxBenefit } = input;

  const taxExpenseByYear: Record<string, number> = {};
  const effectiveRateByYear: Record<string, number> = {};
  const netIncomeByYear: Record<string, number> = {};

  for (const y of projectionYears) {
    const ebt = ebtByYear[y] ?? 0;
    const isLoss = ebt <= 0;

    let taxExpense: number;
    let rate: number;

    if (method === "flat_expense") {
      taxExpense = isLoss && !allowTaxBenefit ? 0 : Math.abs(flatExpense);
      rate = ebt !== 0 ? taxExpense / Math.abs(ebt) : 0;
    } else {
      rate = (method === "rate_by_year" ? (rateByYear[y] ?? flatRatePct) : flatRatePct) / 100;
      if (isLoss && !allowTaxBenefit) {
        taxExpense = 0;
      } else {
        taxExpense = ebt * rate;
        // If taxExpense is negative (benefit on loss), cap at 0 unless benefit allowed
        if (taxExpense < 0 && !allowTaxBenefit) taxExpense = 0;
      }
    }

    taxExpenseByYear[y] = taxExpense;
    effectiveRateByYear[y] = rate;
    netIncomeByYear[y] = ebt - taxExpense;
  }

  return { taxExpenseByYear, effectiveRateByYear, netIncomeByYear };
}

/**
 * Compute historical ETR diagnostic from IS rows.
 * Returns one row per historical year with EBT, tax, ETR, and a flag for erratic values.
 */
export function computeHistoricalEtr(
  historicalYears: string[],
  ebtByYear: Record<string, number>,
  taxByYear: Record<string, number>
): HistoricalEtrRow[] {
  const rows: HistoricalEtrRow[] = historicalYears.map((y) => {
    const ebt = ebtByYear[y] ?? 0;
    const tax = taxByYear[y] ?? 0;
    const etr = ebt > 0 ? tax / ebt : null;
    return { year: y, ebt, tax, etr, flagged: false };
  });

  // Flag years where ETR deviates >10pp from the median
  const validEtrs = rows.map((r) => r.etr).filter((e): e is number => e != null);
  if (validEtrs.length >= 2) {
    const sorted = [...validEtrs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
      : sorted[mid]!;
    for (const row of rows) {
      if (row.etr != null && Math.abs(row.etr - median) > 0.10) {
        row.flagged = true;
      }
    }
  }

  return rows;
}
