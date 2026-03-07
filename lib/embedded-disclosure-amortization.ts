/**
 * Single source of truth for Amortization of Acquired Intangibles disclosure data from embedded disclosures.
 * Builder and preview must both use these helpers so totals always match.
 */

import type { EmbeddedDisclosureItem } from "@/types/finance";

const AMORTIZATION_TYPE = "amortization_intangibles" as const;

/** All amortization disclosure items from store (same list used by builder and preview). */
export function getAmortizationDisclosures(
  embeddedDisclosures: EmbeddedDisclosureItem[]
): EmbeddedDisclosureItem[] {
  return embeddedDisclosures.filter((d) => d.type === AMORTIZATION_TYPE);
}

/** Total amortization for one year — sum of all amortization disclosure row values for that year. */
export function getTotalAmortizationForYearFromEmbedded(
  embeddedDisclosures: EmbeddedDisclosureItem[],
  year: string
): number {
  return getAmortizationDisclosures(embeddedDisclosures).reduce(
    (sum, d) => sum + (d.values[year] ?? 0),
    0
  );
}

/** Totals by year — use this in both builder and preview for identical math. */
export function getTotalAmortizationByYearFromEmbedded(
  embeddedDisclosures: EmbeddedDisclosureItem[],
  years: string[]
): Record<string, number> {
  const out: Record<string, number> = {};
  years.forEach((y) => {
    out[y] = getTotalAmortizationForYearFromEmbedded(embeddedDisclosures, y);
  });
  return out;
}
