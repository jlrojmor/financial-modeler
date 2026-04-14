/**
 * Apply-time utilities for the debt schedule builder.
 * Separated from the component so they can be unit-tested without a React environment.
 */

import type { AmortizationMethodV1, DebtTrancheConfigV1 } from "@/types/debt-schedule-v1";
import type { Row } from "@/types/finance";
import { resolveTrancheOpeningBalance } from "@/lib/debt-schedule-engine";

/**
 * Given a straight-line tranche, fills in `mandatoryRepaymentByYear` for every
 * projection year by dividing the opening balance evenly over the repayment term.
 *
 * Two term modes:
 *  - beyondForecastTermYears provided  → annual = opening / termYears; year offset from repaymentStartYear
 *  - within-forecast (no option)       → annual = opening / count(projectionYears in [start, maturity])
 *
 * For amortizationMethod="none": zeros every projection year (no-amort LOC).
 * For amortizationMethod="manual_by_year" or any other: returns tranche unchanged.
 */
export function applyStraightLineMandatoriesOnTranche(
  tranche: DebtTrancheConfigV1,
  projectionYears: string[],
  lastHistoricYear: string | null,
  balanceSheet: Row[],
  opts?: { beyondForecastTermYears?: number }
): DebtTrancheConfigV1 {
  const method: AmortizationMethodV1 = tranche.amortizationMethod ?? "manual_by_year";
  if (method === "none") {
    const zero: Record<string, number> = { ...tranche.mandatoryRepaymentByYear };
    for (const y of projectionYears) zero[y] = 0;
    return { ...tranche, mandatoryRepaymentByYear: zero };
  }
  if (method !== "straight_line") return tranche;
  const start = tranche.repaymentStartYear;
  if (!start) return tranche;
  const open = resolveTrancheOpeningBalance(tranche, lastHistoricYear, balanceSheet);
  if (open == null || !Number.isFinite(open) || open <= 0) return tranche;
  const nextMand: Record<string, number> = { ...tranche.mandatoryRepaymentByYear };

  const termYears = opts?.beyondForecastTermYears;
  if (termYears != null && termYears > 0) {
    const annual = open / termYears;
    const sy = parseInt(start, 10);
    if (!Number.isFinite(sy)) return tranche;
    for (const y of projectionYears) {
      const yy = parseInt(y, 10);
      if (!Number.isFinite(yy)) {
        nextMand[y] = 0;
        continue;
      }
      const k = yy - sy;
      nextMand[y] = k >= 0 && k < termYears ? annual : 0;
    }
    return { ...tranche, mandatoryRepaymentByYear: nextMand };
  }

  const mat = tranche.maturityYear;
  if (!mat) return tranche;
  const yearsInRange = projectionYears.filter((y) => y >= start && y <= mat);
  const n = yearsInRange.length;
  if (n <= 0) return tranche;
  const annual = open / n;
  for (const y of projectionYears) {
    nextMand[y] = yearsInRange.includes(y) ? annual : 0;
  }
  return { ...tranche, mandatoryRepaymentByYear: nextMand };
}
