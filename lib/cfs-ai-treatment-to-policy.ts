/**
 * Map AI recommendedTreatment to persisted CfsDisclosureProjectionSpec (when user accepts).
 */

import type { Row } from "@/types/finance";
import type { CfsDisclosureProjectionSpec } from "@/lib/cfs-disclosure-projection";
import type { CfsAiRecommendedTreatment } from "@/types/cfs-forecast-diagnosis-v1";

function estimatePctOfRevenueFromHistoric(
  row: Row,
  lastHistYear: string | null,
  lastHistRevenue: number | undefined
): number {
  if (!lastHistYear || lastHistRevenue == null || !Number.isFinite(lastHistRevenue) || lastHistRevenue === 0) {
    return 0;
  }
  const v = row.values?.[lastHistYear];
  if (v == null || !Number.isFinite(v)) return 0;
  return Math.abs(v / lastHistRevenue) * 100;
}

/**
 * Returns a disclosure policy when the model can apply it automatically.
 * `map_to_bs` / `use_is_bridge` need Historicals mapping first — returns null.
 */
export function mapAiTreatmentToDisclosureSpec(
  treatment: CfsAiRecommendedTreatment,
  row: Row,
  lastHistYear: string | null,
  lastHistRevenue: number | undefined
): CfsDisclosureProjectionSpec | null {
  switch (treatment) {
    case "flat_last":
      return { mode: "flat_last_historical" };
    case "pct_revenue":
      return {
        mode: "pct_of_revenue",
        pct: estimatePctOfRevenueFromHistoric(row, lastHistYear, lastHistRevenue),
      };
    case "zero":
      return { mode: "zero" };
    case "exclude":
      return { mode: "excluded" };
    case "manual_grid":
      return { mode: "manual_by_year", byYear: {} };
    case "map_to_bs":
    case "use_is_bridge":
      return null;
    default:
      return null;
  }
}
