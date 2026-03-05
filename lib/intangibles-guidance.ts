/**
 * Historical guidance for Intangibles additions % of revenue.
 * Computes Δ intangibles, implied additions = Δ + amort when amort history exists,
 * then median implied % and implied $ for first forecast year.
 */

export type IntangiblesGuidanceInput = {
  historicalYears: string[];
  /** Intangible assets, net by year (stored units). From BS row intangible_assets. */
  intangiblesByYear: Record<string, number>;
  /** Revenue by year (stored units). */
  revenueByYearHistoric: Record<string, number>;
  /** Historical amortization by year (stored units). When present, implied additions = Δ intangibles + amort. */
  amortByYear: Record<string, number>;
  /** Revenue for first projection year (stored units). Used for implied $ additions in year 1. */
  revenueFirstProjYear: number | null;
};

export type IntangiblesGuidanceResult = {
  /** Suggested additions as % of revenue (median of historical implied %). Null if no history. */
  suggestedPct: number | null;
  /** Implied $ additions for first forecast year (stored units). Null if no suggested % or no revenue. */
  impliedAdditionsFirstYear: number | null;
  /** True if we had at least one year with valid implied % (intangibles + revenue + amort). */
  hasHistory: boolean;
};

/** Heuristic range when no sufficient history (display copy). */
export const INTANGIBLES_ADDITIONS_PCT_HEURISTIC_MIN = 0.5;
export const INTANGIBLES_ADDITIONS_PCT_HEURISTIC_MAX = 2;
export const INTANGIBLES_ADDITIONS_PCT_HEURISTIC_TYPICAL = 1;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Compute suggested intangibles additions % of revenue from history.
 * When amortization history exists: implied additions = Δ intangibles + amortization; implied % = additions / revenue.
 * Takes median across historical years; returns suggested % and implied $ for first forecast year.
 */
export function computeIntangiblesAdditionsGuidance(input: IntangiblesGuidanceInput): IntangiblesGuidanceResult {
  const {
    historicalYears,
    intangiblesByYear,
    revenueByYearHistoric,
    amortByYear,
    revenueFirstProjYear,
  } = input;

  const impliedPcts: number[] = [];
  for (let i = 1; i < historicalYears.length; i++) {
    const y = historicalYears[i]!;
    const prevY = historicalYears[i - 1]!;
    const intan = intangiblesByYear[y] ?? 0;
    const intanPrev = intangiblesByYear[prevY] ?? 0;
    const deltaIntan = intan - intanPrev;
    const amort = amortByYear[y];
    if (amort == null || amort <= 0) continue;
    const impliedAdditions = deltaIntan + amort;
    const rev = revenueByYearHistoric[y] ?? 0;
    if (rev <= 0) continue;
    const pct = (impliedAdditions / rev) * 100;
    if (Number.isFinite(pct) && pct >= 0) impliedPcts.push(pct);
  }

  const hasHistory = impliedPcts.length > 0;
  const suggestedPct = hasHistory ? median(impliedPcts) : null;
  const impliedAdditionsFirstYear =
    suggestedPct != null && revenueFirstProjYear != null && revenueFirstProjYear > 0
      ? (suggestedPct / 100) * revenueFirstProjYear
      : null;

  return {
    suggestedPct,
    impliedAdditionsFirstYear,
    hasHistory,
  };
}
