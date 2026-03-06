/**
 * Finance-aware fallback classifier for IS custom rows when AI is not available or has not returned.
 * Used to set sectionOwner and isOperating from label keywords so defaults are correct (e.g. R&D → rd, Sales & Marketing → sga).
 */

import type { Row } from "@/types/finance";

export type FallbackResult = {
  sectionOwner: Row["sectionOwner"];
  isOperating: boolean;
};

const LOWER = (s: string) => s.toLowerCase();

/**
 * Returns sectionOwner and isOperating based on label keywords.
 * Only use other_operating when there is no stronger match.
 */
export function getFallbackIsClassification(label: string): FallbackResult {
  const lower = LOWER(label.trim());
  if (!lower) return { sectionOwner: "other_operating", isOperating: true };

  // R&D / product development
  if (/\b(r&d|r and d|research|development|product development)\b/.test(lower)) {
    return { sectionOwner: "rd", isOperating: true };
  }
  // SG&A
  if (/\b(sales|marketing|g&a|g and a|general|administrative)\b/.test(lower)) {
    return { sectionOwner: "sga", isOperating: true };
  }
  // Other operating (restructuring, one-time, etc.)
  if (/\b(restructuring|impairment|reorganization|one-time operating)\b/.test(lower)) {
    return { sectionOwner: "other_operating", isOperating: true };
  }
  // Non-operating (interest, investments, FX, gains/losses)
  if (
    /\b(interest|investment gain|investment loss|fx gain|fx loss|fair value|gain on sale|loss on sale|strategic investment|gain|loss)\b/.test(lower)
  ) {
    return { sectionOwner: "non_operating", isOperating: false };
  }
  // Tax
  if (/\b(tax|deferred tax|income tax|tax benefit|tax expense)\b/.test(lower)) {
    return { sectionOwner: "tax", isOperating: false };
  }
  // Revenue / COGS - less common for custom adds but support
  if (/\b(revenue|sales|subscription|fee)\b/.test(lower) && !/\b(expense|cost)\b/.test(lower)) {
    return { sectionOwner: "revenue", isOperating: true };
  }
  if (/\b(cogs|cost of goods|direct cost)\b/.test(lower)) {
    return { sectionOwner: "cogs", isOperating: true };
  }

  return { sectionOwner: "other_operating", isOperating: true };
}
