/**
 * Single source of truth for Restructuring Charges disclosure data from embedded disclosures.
 * Builder and preview must both use these helpers so totals always match.
 */

import type { EmbeddedDisclosureItem } from "@/types/finance";

const RESTRUCTURING_TYPE = "restructuring_charges" as const;

/** All restructuring disclosure items from store (same list used by builder and preview). */
export function getRestructuringDisclosures(
  embeddedDisclosures: EmbeddedDisclosureItem[]
): EmbeddedDisclosureItem[] {
  return embeddedDisclosures.filter((d) => d.type === RESTRUCTURING_TYPE);
}

/** Total restructuring for one year — sum of all restructuring disclosure row values for that year. */
export function getTotalRestructuringForYearFromEmbedded(
  embeddedDisclosures: EmbeddedDisclosureItem[],
  year: string
): number {
  return getRestructuringDisclosures(embeddedDisclosures).reduce(
    (sum, d) => sum + (d.values[year] ?? 0),
    0
  );
}

/** Totals by year — use this in both builder and preview for identical math. */
export function getTotalRestructuringByYearFromEmbedded(
  embeddedDisclosures: EmbeddedDisclosureItem[],
  years: string[]
): Record<string, number> {
  const out: Record<string, number> = {};
  years.forEach((y) => {
    out[y] = getTotalRestructuringForYearFromEmbedded(embeddedDisclosures, y);
  });
  return out;
}
