/**
 * Single source of truth for SBC disclosure data from embedded disclosures.
 * Builder and preview must both use these helpers so totals always match.
 */

import type { EmbeddedDisclosureItem } from "@/types/finance";

const SBC_TYPE = "sbc" as const;

/** All SBC disclosure items from store (same list used by builder and preview). */
export function getSbcDisclosures(
  embeddedDisclosures: EmbeddedDisclosureItem[]
): EmbeddedDisclosureItem[] {
  return embeddedDisclosures.filter((d) => d.type === SBC_TYPE);
}

/** Total SBC for one year — sum of all SBC disclosure row values for that year. */
export function getTotalSbcForYearFromEmbedded(
  embeddedDisclosures: EmbeddedDisclosureItem[],
  year: string
): number {
  return getSbcDisclosures(embeddedDisclosures).reduce(
    (sum, d) => sum + (d.values[year] ?? 0),
    0
  );
}

/** Totals by year — use this in both builder and preview for identical math. */
export function getTotalSbcByYearFromEmbedded(
  embeddedDisclosures: EmbeddedDisclosureItem[],
  years: string[]
): Record<string, number> {
  const out: Record<string, number> = {};
  years.forEach((y) => {
    out[y] = getTotalSbcForYearFromEmbedded(embeddedDisclosures, y);
  });
  return out;
}
