/**
 * Income Statement row classification (sectionOwner, isOperating).
 * Used to enforce metadata on custom rows and block/confirm before proceeding.
 */

import type { Row } from "@/types/finance";

/** Known template IS row IDs + calculated rows that must never require classification (e.g. EBITDA). */
const TEMPLATE_IS_ROW_IDS = new Set([
  "rev", "cogs", "gross_profit", "gross_margin", "operating_expenses", "sga", "ebit", "ebit_margin",
  "rd", "other_opex", "danda", "interest_expense", "interest_income", "other_income",
  "ebt", "ebt_margin", "tax", "net_income", "net_income_margin",
  "ebitda", "ebitda_margin",
]);

function flattenIsRows(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) out.push(...flattenIsRows(r.children));
  }
  return out;
}

/**
 * Returns IS rows that are missing sectionOwner or isOperating (custom rows only).
 * Template rows (isTemplateRow === true) and known template IDs are never included.
 */
export function getIsRowsMissingClassification(incomeStatement: Row[]): Row[] {
  const flat = flattenIsRows(incomeStatement ?? []);
  return flat.filter((r) => {
    if (r.isTemplateRow === true) return false;
    if (TEMPLATE_IS_ROW_IDS.has(r.id)) return false;
    const missingSection = r.sectionOwner == null || r.sectionOwner === undefined;
    const missingOperating = r.isOperating === undefined || r.isOperating === null;
    return missingSection || missingOperating;
  });
}

/**
 * Returns custom IS rows that already have sectionOwner and isOperating set (for "Classified rows" section).
 * Excludes template rows so they never appear in the panel.
 */
export function getIsRowsClassifiedCustom(incomeStatement: Row[]): Row[] {
  const flat = flattenIsRows(incomeStatement ?? []);
  return flat.filter((r) => {
    if (r.isTemplateRow === true) return false;
    if (TEMPLATE_IS_ROW_IDS.has(r.id)) return false;
    const hasSection = r.sectionOwner != null && r.sectionOwner !== undefined;
    const hasOperating = r.isOperating === true || r.isOperating === false;
    return hasSection && hasOperating;
  });
}

/** Section key used for placement and display order. operating_expenses = structural parent row (children are sga, rd, other_operating). */
export type ISSectionKey =
  | "revenue"
  | "cogs"
  | "gross_profit"
  | "operating_expenses"
  | "sga"
  | "rd"
  | "other_operating"
  | "ebit"
  | "interest"
  | "ebt"
  | "tax"
  | "net_income"
  | "other";

/** Canonical order of top-level IS rows. operating_expenses is the single parent; sga/rd/other_operating are its children. */
export const IS_SECTION_ORDER: ISSectionKey[] = [
  "revenue",
  "cogs",
  "gross_profit",
  "operating_expenses",
  "ebit",
  "interest",
  "ebt",
  "tax",
  "net_income",
  "other",
];

/**
 * Returns the section key for a single IS row. Used for placement and formulas.
 * Template rows use id; custom rows use sectionOwner (so classification drives structure).
 */
export function getIsSectionKey(row: Row): ISSectionKey {
  const so = row.sectionOwner;
  if (so != null && so !== undefined) {
    // non_operating rows (Interest & Other custom items) belong to the interest block for builder and preview
    if (so === "non_operating") return "interest";
    return so as ISSectionKey;
  }
  switch (row.id) {
    case "rev":
      return "revenue";
    case "cogs":
      return "cogs";
    case "gross_profit":
    case "gross_margin":
      return "gross_profit";
    case "operating_expenses":
      return "operating_expenses";
    case "sga":
      return "sga";
    case "rd":
      return "rd";
    case "other_opex":
    case "danda":
      return "other_operating";
    case "ebit":
    case "ebit_margin":
      return "ebit";
    case "interest_expense":
    case "interest_income":
    case "other_income":
      return "interest";
    case "ebt":
    case "ebt_margin":
      return "ebt";
    case "tax":
      return "tax";
    case "net_income":
    case "net_income_margin":
      return "net_income";
    default:
      return "other";
  }
}

/** True if the row is an operating expense (affects EBIT): sga, rd, other_operating. */
export function isOperatingExpenseRow(row: Row): boolean {
  const key = getIsSectionKey(row);
  return key === "sga" || key === "rd" || key === "other_operating";
}

/** True if the row is non-operating (affects EBT only). */
export function isNonOperatingRow(row: Row): boolean {
  return getIsSectionKey(row) === "interest";
}

/** True if the row is in the tax section (affects Net Income only). */
export function isTaxRow(row: Row): boolean {
  return getIsSectionKey(row) === "tax";
}

/** Fixed top-level IS row id order for preview. operating_expenses is always after gross_margin and before ebit. */
export const IS_TOP_LEVEL_ORDER: string[] = [
  "rev",
  "cogs",
  "gross_profit",
  "gross_margin",
  "operating_expenses",
  "ebit",
  "ebit_margin",
  "interest_expense",
  "interest_income",
  "other_income",
  "ebt",
  "ebt_margin",
  "tax",
  "net_income",
  "net_income_margin",
];

/**
 * Returns top-level IS rows in explicit display order for preview.
 * Section-based: rows are grouped by getIsSectionKey so custom non_operating rows appear in the interest block (below EBIT, before EBT), not at the end.
 */
export function getIncomeStatementDisplayOrder(incomeStatement: Row[]): Row[] {
  const rows = incomeStatement ?? [];
  const bySection = new Map<ISSectionKey, Row[]>();
  for (const row of rows) {
    const key = getIsSectionKey(row);
    const safeKey = IS_SECTION_ORDER.includes(key) ? key : "other";
    if (!bySection.has(safeKey)) bySection.set(safeKey, []);
    bySection.get(safeKey)!.push(row);
  }
  const ordered: Row[] = [];
  for (const sectionKey of IS_SECTION_ORDER) {
    const bucket = bySection.get(sectionKey);
    if (bucket) ordered.push(...bucket);
  }
  return ordered;
}

