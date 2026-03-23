import type { RevenueForecastConfigV1 } from "@/types/revenue-forecast-v1";

/**
 * Stable string for any change under `revenueForecastConfigV1.rows` (including nested
 * `forecastParameters` such as `arpuBasis` / `revenuePerLocationBasis`).
 * Use in React/Zustand dependency lists so previews recompute when monetization basis
 * or other nested params change, not only when the top-level config object identity changes.
 */
export function getRevenueForecastConfigV1RowsFingerprint(
  cfg: RevenueForecastConfigV1 | undefined | null
): string {
  try {
    return JSON.stringify(cfg?.rows ?? {});
  } catch {
    return "";
  }
}
