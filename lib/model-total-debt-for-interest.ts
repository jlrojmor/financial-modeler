/**
 * Funded debt totals for interest / debt schedule. Prefers detected BS lines (metadata + taxonomy);
 * falls back to template st_debt + lt_debt when detection yields nothing.
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";
import { detectFundedDebtTotalsByYear } from "@/lib/historical-bs-debt-detection";

function explicitCell(row: Row | null, year: string): number | null {
  if (!row?.values || !Object.prototype.hasOwnProperty.call(row.values, year)) return null;
  const v = row.values[year];
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

/**
 * Sum funded debt for each year. Uses historical BS detection when possible; otherwise st_debt + lt_debt only.
 */
export function tryBuildModelTotalDebtByYear(
  balanceSheet: Row[],
  years: string[]
): { byYear: Record<string, number>; ok: boolean } {
  if (years.length === 0) return { byYear: {}, ok: false };

  const detected = detectFundedDebtTotalsByYear(balanceSheet, years);
  if (detected.ok && detected.members.length > 0) {
    return { byYear: detected.byYearTotal, ok: true };
  }

  const st = findRowInTree(balanceSheet, "st_debt");
  const lt = findRowInTree(balanceSheet, "lt_debt");
  if (!st || !lt) return { byYear: {}, ok: false };

  const byYear: Record<string, number> = {};
  for (const y of years) {
    const a = explicitCell(st, y);
    const b = explicitCell(lt, y);
    if (a === null || b === null) return { byYear: {}, ok: false };
    byYear[y] = a + b;
  }
  return { byYear, ok: true };
}

export function isModelDebtForecastAvailableForInterest(
  balanceSheet: Row[],
  projectionYears: string[],
  lastHistoricYear: string | null
): boolean {
  const yearsNeed = lastHistoricYear ? [lastHistoricYear, ...projectionYears] : [...projectionYears];
  if (yearsNeed.length === 0) return false;
  const { ok } = tryBuildModelTotalDebtByYear(balanceSheet, yearsNeed);
  return ok;
}
