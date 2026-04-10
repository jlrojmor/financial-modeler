/**
 * Deterministic interest expense from legacy Phase 2 **standalone** schedule config (not used in the active UI).
 * Intended for reuse when the **debt schedule** engine computes interest and may borrow this math for prototyping.
 * Stored / returned values are positive expense magnitudes.
 */

import type { InterestExpenseScheduleConfigBody } from "@/types/interest-expense-schedule-v1";
import { tryBuildModelTotalDebtByYear } from "@/lib/model-total-debt-for-interest";
import type { Row } from "@/types/finance";

export type InterestExpenseEngineInput = {
  applied: InterestExpenseScheduleConfigBody;
  projectionYears: string[];
  /** Last historical year label (e.g. "2024A"); used for average-debt prior endpoint. */
  lastHistoricYear: string | null;
  balanceSheet: Row[];
};

/**
 * Build ending debt lookup for projection + (if needed) last historic year.
 * Returns null for a year when that year's debt cannot be resolved (no silent invention).
 */
function endingDebtForYear(
  cfg: InterestExpenseScheduleConfigBody,
  year: string,
  modelByYear: Record<string, number> | null
): number | null {
  if (cfg.method === "manual_by_year") return null;
  if (cfg.debtSource === "model") {
    if (!modelByYear) return null;
    const v = modelByYear[year];
    return v != null && Number.isFinite(v) ? v : null;
  }
  const raw = cfg.manualDebtByYear[year];
  if (raw == null || !Number.isFinite(raw)) return null;
  return raw;
}

function buildModelDebtMap(balanceSheet: Row[], years: string[]): Record<string, number> | null {
  const { byYear, ok } = tryBuildModelTotalDebtByYear(balanceSheet, years);
  return ok ? byYear : null;
}

/**
 * Positive expense per projection year. Omits years that cannot be computed honestly.
 */
export function computeAppliedInterestExpenseByYear(input: InterestExpenseEngineInput): Record<string, number> {
  const { applied, projectionYears, lastHistoricYear, balanceSheet } = input;
  const out: Record<string, number> = {};

  if (applied.method === "manual_by_year") {
    for (const y of projectionYears) {
      const v = applied.manualInterestByYear[y];
      if (v != null && Number.isFinite(v) && v >= 0) out[y] = v;
    }
    return out;
  }

  const rate = applied.interestRatePct / 100;
  if (!Number.isFinite(rate) || rate < 0) return out;

  const yearsForModel =
    applied.debtSource === "model" && lastHistoricYear
      ? [lastHistoricYear, ...projectionYears]
      : applied.debtSource === "model"
        ? [...projectionYears]
        : [];

  const modelMap =
    applied.debtSource === "model" ? buildModelDebtMap(balanceSheet, yearsForModel) : null;

  if (applied.debtSource === "model" && !modelMap) return out;

  for (let i = 0; i < projectionYears.length; i++) {
    const y = projectionYears[i]!;
    if (applied.method === "pct_ending_debt") {
      const end = endingDebtForYear(applied, y, modelMap);
      if (end === null) continue;
      out[y] = rate * end;
      continue;
    }

    // pct_avg_debt
    const endCurr = endingDebtForYear(applied, y, modelMap);
    if (endCurr === null) continue;

    let endPrev: number | null = null;
    if (i > 0) {
      endPrev = endingDebtForYear(applied, projectionYears[i - 1]!, modelMap);
    } else if (lastHistoricYear) {
      endPrev = endingDebtForYear(applied, lastHistoricYear, modelMap);
    }

    let avg: number;
    if (endPrev !== null) {
      avg = (endPrev + endCurr) / 2;
    } else {
      /**
       * No prior-year ending debt: cannot form a true average. Use current-year ending only
       * (same as ending-debt method for that year) — conservative, documented, no fabricated prior.
       */
      avg = endCurr;
    }
    out[y] = rate * avg;
  }

  return out;
}
