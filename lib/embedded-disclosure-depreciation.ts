/**
 * Single source of truth for Depreciation Embedded in Expenses disclosure data from embedded disclosures.
 * Builder and preview must both use these helpers so totals always match.
 */

import type { EmbeddedDisclosureItem } from "@/types/finance";

const DEPRECIATION_TYPE = "depreciation_embedded" as const;

/** All depreciation (embedded) disclosure items from store (same list used by builder and preview). */
export function getDepreciationDisclosures(
  embeddedDisclosures: EmbeddedDisclosureItem[]
): EmbeddedDisclosureItem[] {
  return embeddedDisclosures.filter((d) => d.type === DEPRECIATION_TYPE);
}

/** Total depreciation embedded for one year — sum of all depreciation disclosure row values for that year. */
export function getTotalDepreciationForYearFromEmbedded(
  embeddedDisclosures: EmbeddedDisclosureItem[],
  year: string
): number {
  return getDepreciationDisclosures(embeddedDisclosures).reduce(
    (sum, d) => sum + (d.values[year] ?? 0),
    0
  );
}

/** Totals by year — use this in both builder and preview for identical math. */
export function getTotalDepreciationByYearFromEmbedded(
  embeddedDisclosures: EmbeddedDisclosureItem[],
  years: string[]
): Record<string, number> {
  const out: Record<string, number> = {};
  years.forEach((y) => {
    out[y] = getTotalDepreciationForYearFromEmbedded(embeddedDisclosures, y);
  });
  return out;
}
