/**
 * Detect whether BS short-term + long-term debt have explicit values for each requested year.
 * Returns ok: false if any year is missing on either row — avoids silent zeros as "forecast debt".
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";

function explicitCell(row: Row | null, year: string): number | null {
  if (!row?.values || !Object.prototype.hasOwnProperty.call(row.values, year)) return null;
  const v = row.values[year];
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

/**
 * Sum st_debt + lt_debt for each year when both rows have an explicit value for that year.
 */
export function tryBuildModelTotalDebtByYear(
  balanceSheet: Row[],
  years: string[]
): { byYear: Record<string, number>; ok: boolean } {
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
