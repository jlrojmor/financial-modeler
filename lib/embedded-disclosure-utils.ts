/**
 * Single source of truth for embedded disclosure (SBC) totals.
 * Builder and preview must use these helpers so totals always match.
 */

import type { EmbeddedDisclosureItem } from "@/types/finance";

const SBC_TYPE = "sbc" as const;

/** All SBC disclosure items from store (same list for builder and preview). */
export function getSbcDisclosures(
  embeddedDisclosures: EmbeddedDisclosureItem[] | null | undefined
): EmbeddedDisclosureItem[] {
  return (embeddedDisclosures ?? []).filter((d) => d.type === SBC_TYPE);
}

/** Total SBC per year from embedded disclosures. Same formula as builder. */
export function getTotalSbcByYear(
  embeddedDisclosures: EmbeddedDisclosureItem[] | null | undefined,
  years: string[]
): Record<string, number> {
  const sbc = getSbcDisclosures(embeddedDisclosures);
  const out: Record<string, number> = {};
  years.forEach((y) => {
    out[y] = sbc.reduce((sum, d) => sum + (d.values[y] ?? 0), 0);
  });
  return out;
}
