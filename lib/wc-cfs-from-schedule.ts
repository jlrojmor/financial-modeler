/**
 * Cash flow effect of WC line items from projected BS balances (indirect method).
 * Asset: cash impact = -(balance[y] − balance[prev])
 * Liability: cash impact = +(balance[y] − balance[prev])
 * Matches the ΔNWC → CFO bridge when summed with WC scope.
 */

import type { WcScheduleItem } from "@/lib/working-capital-schedule";
import { resolveTimelineYearKey } from "@/lib/year-timeline";

/**
 * @param allChronologicalYears — full model timeline [ ...historical, ...projection ]
 * @param projectionYears — years to fill (must be a suffix chain after historical)
 */
export function computeWcCfsCashEffectByProjectionYears(
  wcItems: WcScheduleItem[],
  projectedBalances: Record<string, Record<string, number>>,
  allChronologicalYears: string[],
  projectionYears: string[]
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};

  for (const item of wcItems) {
    out[item.id] = {};
    for (const y of projectionYears) {
      const yearOnTimeline = resolveTimelineYearKey(y, allChronologicalYears);
      if (yearOnTimeline == null) continue;
      const i = allChronologicalYears.indexOf(yearOnTimeline);
      if (i <= 0) continue;
      const prevY = allChronologicalYears[i - 1];
      if (prevY == null) continue;
      const curr = projectedBalances[item.id]?.[yearOnTimeline] ?? 0;
      const prevB = projectedBalances[item.id]?.[prevY] ?? 0;
      const rawDelta = curr - prevB;
      /** Store under the caller’s projection key so UI columns (e.g. 2026 vs 2026E) still match. */
      out[item.id][y] = item.side === "asset" ? -rawDelta : rawDelta;
    }
  }
  return out;
}

/** One-period WC cash effect (CFO sign): same rule as computeWcCfsCashEffectByProjectionYears for y vs prevY. */
export function wcCashEffectSingleYear(
  item: WcScheduleItem,
  y: string,
  prevY: string,
  projectedBalances: Record<string, Record<string, number>>
): number {
  const curr = projectedBalances[item.id]?.[y] ?? 0;
  const prevB = projectedBalances[item.id]?.[prevY] ?? 0;
  const rawDelta = curr - prevB;
  return item.side === "asset" ? -rawDelta : rawDelta;
}
