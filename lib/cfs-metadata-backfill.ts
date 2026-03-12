/**
 * One-time CFS metadata backfill: set historicalCfsNature on rows that have
 * cfsLink.section but are missing historicalCfsNature, so the store is complete
 * and we don't rely on inference forever.
 * Additive only — does not overwrite existing historicalCfsNature or user-set values.
 */

import type { Row } from "@/types/finance";

type HistoricalCfsNature = NonNullable<Row["historicalCfsNature"]>;

const SECTION_TO_NATURE: Record<string, HistoricalCfsNature> = {
  investing: "reported_investing",
  financing: "reported_financing",
  cash_bridge: "reported_meta",
};

/**
 * Backfill historicalCfsNature for CFS rows that have cfsLink.section but missing nature.
 * - investing → reported_investing
 * - financing → reported_financing
 * - cash_bridge → reported_meta
 * - operating: only when clearly inferable (e.g. child of wc_change → reported_working_capital_movement); otherwise leave as-is.
 * Does not overwrite rows that already have historicalCfsNature.
 */
function backfillCfsNatureRecursive(rows: Row[], parentId?: string): Row[] {
  return rows.map((row) => {
    const section = row.cfsLink?.section;
    const hasNature = row.historicalCfsNature != null;
    const isUserSet = row.classificationSource === "user";

    if (!section || hasNature || isUserSet) {
      const children = row.children?.length
        ? backfillCfsNatureRecursive(row.children, row.id)
        : row.children;
      return children !== row.children ? { ...row, children } : row;
    }

    let nature: HistoricalCfsNature | undefined;

    if (section === "investing") {
      nature = "reported_investing";
    } else if (section === "financing") {
      nature = "reported_financing";
    } else if (section === "cash_bridge") {
      nature = "reported_meta";
    } else if (section === "operating") {
      if (parentId === "wc_change") {
        nature = "reported_working_capital_movement";
      }
      // else: leave as-is, do not guess for other operating rows
    }

    const children = row.children?.length
      ? backfillCfsNatureRecursive(row.children, row.id)
      : row.children;

    if (nature != null) {
      return { ...row, historicalCfsNature: nature, children };
    }
    return children !== row.children ? { ...row, children } : row;
  });
}

/**
 * Returns a new cashFlow array with historicalCfsNature backfilled where missing.
 * Safe to run on load and init; idempotent for rows that already have nature.
 */
export function backfillCfsMetadataNature(cashFlow: Row[]): Row[] {
  if (!cashFlow?.length) return cashFlow ?? [];
  return backfillCfsNatureRecursive(cashFlow);
}
