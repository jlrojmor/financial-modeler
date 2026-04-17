/**
 * User-selected projection policies for CFS lines that are CF-disclosure-only (no BS/IS bridge).
 */

export type CfsDisclosureProjectionSpec =
  | { mode: "flat_last_historical" }
  | { mode: "pct_of_revenue"; pct: number }
  | { mode: "manual_by_year"; byYear: Record<string, number> }
  | { mode: "zero" }
  /** Intentionally exclude from forecast (rollup elsewhere or immaterial). */
  | { mode: "excluded" };

export function applyCfsDisclosureProjectionForYear(
  spec: CfsDisclosureProjectionSpec,
  year: string,
  lastHistoricalYear: string | null,
  revenueForYear: number | undefined,
  lastActualFromRow: number | undefined
): number {
  switch (spec.mode) {
    case "zero":
    case "excluded":
      return 0;
    case "flat_last_historical": {
      if (lastHistoricalYear) {
        return lastActualFromRow ?? 0;
      }
      return lastActualFromRow ?? 0;
    }
    case "pct_of_revenue": {
      const rev = revenueForYear ?? 0;
      return rev * (spec.pct / 100);
    }
    case "manual_by_year": {
      const v = spec.byYear[year];
      return v !== undefined && Number.isFinite(v) ? v : 0;
    }
    default:
      return 0;
  }
}

/** Value to carry forward for flat_last_historical in projection years (last actual YoY in row.values). */
export function getLastHistoricalCfsValue(
  rowValues: Record<string, number> | undefined,
  historicalYears: string[]
): number | undefined {
  if (!rowValues || historicalYears.length === 0) return undefined;
  const last = historicalYears[historicalYears.length - 1];
  const v = rowValues[last];
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}
