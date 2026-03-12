/**
 * Single source of truth for CFS Operating Activities subgroup allocation.
 * Builder and preview MUST both use getFinalOperatingSubgroup only — no fallbacks or order-based logic.
 * Each operating row belongs to exactly one subgroup.
 */

import type { Row } from "@/types/finance";

export type OperatingSubgroupId =
  | "earnings_base"
  | "non_cash"
  | "working_capital"
  | "other_operating"
  | "total";

export const OPERATING_SUBGROUP_ORDER: readonly OperatingSubgroupId[] = [
  "earnings_base",
  "non_cash",
  "working_capital",
  "other_operating",
] as const;

export const OPERATING_SUBGROUP_LABELS: Record<OperatingSubgroupId, string> = {
  earnings_base: "Earnings Base",
  non_cash: "Non-Cash Adjustments",
  working_capital: "Working Capital Adjustments",
  other_operating: "Other Operating Activities",
  total: "Cash from Operating Activities",
};

/**
 * Final operating subgroup for a row. This is the only source of truth for builder and preview.
 *
 * Priority 1 — canonical structure (fixed row ids / parent):
 *   net_income → earnings_base; danda | sbc → non_cash; wc_change | parentId===wc_change → working_capital;
 *   other_operating → other_operating; operating_cf → total.
 *
 * Priority 2 — explicit historical metadata (any other operating row):
 *   historicalCfsNature === "reported_non_cash_adjustment" → non_cash
 *   historicalCfsNature === "reported_working_capital_movement" → working_capital
 *   historicalCfsNature === "reported_operating_other" → other_operating
 *
 * Priority 3 — safe fallback:
 *   default → other_operating
 *
 * Do not use row order or transition-based logic to override this.
 */
export function getFinalOperatingSubgroup(
  row: Row,
  parentId?: string
): OperatingSubgroupId | null {
  const rowId = row.id;

  // Priority 1: canonical structure
  if (rowId === "net_income") return "earnings_base";
  if (rowId === "danda" || rowId === "sbc") return "non_cash";
  if (rowId === "wc_change") return "working_capital";
  if (parentId === "wc_change") return "working_capital";
  if (rowId === "other_operating") return "other_operating";
  if (rowId === "operating_cf") return "total";

  // Priority 2: explicit historical nature (custom / non-anchor rows)
  const nature = row.historicalCfsNature;
  if (nature === "reported_non_cash_adjustment") return "non_cash";
  if (nature === "reported_working_capital_movement") return "working_capital";
  if (nature === "reported_operating_other") return "other_operating";

  // Priority 3: fallback
  return "other_operating";
}

/** @deprecated Use getFinalOperatingSubgroup. Kept for compatibility. */
export function getOperatingSubgroup(row: Row, parentId?: string): OperatingSubgroupId | null {
  return getFinalOperatingSubgroup(row, parentId);
}

export type OperatingEntry = { row: Row; parentId?: string };

export type OperatingBuckets = {
  earnings_base: OperatingEntry[];
  non_cash: OperatingEntry[];
  working_capital: OperatingEntry[];
  other_operating: OperatingEntry[];
};

/**
 * Puts each operating row into exactly one subgroup bucket in fixed order.
 * Rows classified as working_capital never appear in other_operating.
 * Preserves order within each bucket (by order of appearance in entries).
 */
export function groupOperatingRowsIntoBuckets(
  entries: OperatingEntry[]
): OperatingBuckets {
  const buckets: OperatingBuckets = {
    earnings_base: [],
    non_cash: [],
    working_capital: [],
    other_operating: [],
  };

  for (const entry of entries) {
    const sg = getFinalOperatingSubgroup(entry.row, entry.parentId);
    if (sg && sg !== "total" && buckets[sg]) {
      buckets[sg].push(entry);
    }
  }

  return buckets;
}

/**
 * Flatten CFS rows with parentId for validation (top-level has no parentId; children have parent row id).
 */
function flattenCfsWithParentId(rows: Row[], parentId?: string): Array<{ row: Row; parentId?: string }> {
  const out: Array<{ row: Row; parentId?: string }> = [];
  for (const r of rows) {
    out.push({ row: r, parentId });
    if (r.children?.length) {
      out.push(...flattenCfsWithParentId(r.children, r.id));
    }
  }
  return out;
}

/**
 * Dev validation: ensure every operating row's final subgroup matches its structural placement.
 * - working_capital ⇒ must be wc_change or child of wc_change (parentId === "wc_change")
 * - parentId === "wc_change" or row.id === "wc_change" ⇒ subgroup must be working_capital
 * Logs console warnings when mismatched. Call after normalization or from console (e.g. __validateOperatingCfsStructure(store.getState().cashFlow)).
 */
export function validateOperatingCfsStructure(cashFlow: Row[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const entries = flattenCfsWithParentId(cashFlow ?? []);
  const operatingSectionIds = new Set(["net_income", "danda", "sbc", "wc_change", "other_operating", "operating_cf"]);
  for (const { row, parentId } of entries) {
    const inOperating =
      operatingSectionIds.has(row.id) ||
      (parentId != null && operatingSectionIds.has(parentId)) ||
      row.cfsLink?.section === "operating";
    if (!inOperating) continue;
    const sg = getFinalOperatingSubgroup(row, parentId);
    if (sg === "working_capital") {
      if (row.id !== "wc_change" && parentId !== "wc_change") {
        errors.push(`Row "${row.label}" (id=${row.id}) has subgroup working_capital but is not under wc_change (parentId=${parentId ?? "top-level"}).`);
      }
    }
    if ((row.id === "wc_change" || parentId === "wc_change") && sg !== "working_capital") {
      errors.push(`Row "${row.label}" (id=${row.id}) is structurally WC (parentId=${parentId}) but subgroup is ${sg ?? "null"}.`);
    }
  }
  if (errors.length > 0 && typeof console !== "undefined" && console.warn) {
    console.warn("[CFS structure validation]", errors);
  }
  return { valid: errors.length === 0, errors };
}

if (typeof window !== "undefined") {
  (window as unknown as { __validateOperatingCfsStructure?: typeof validateOperatingCfsStructure }).__validateOperatingCfsStructure = validateOperatingCfsStructure;
}
