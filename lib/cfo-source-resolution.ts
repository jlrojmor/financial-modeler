/**
 * Historical CFO source resolution
 *
 * Defines where each key Operating Activities (CFO) row gets its value from.
 * Single source hierarchy per row to avoid double counting.
 * Used by the calculation engine when resolving CFS net_income, sbc, danda, wc_change.
 */

import type { Row } from "@/types/finance";
import type { EmbeddedDisclosureItem } from "@/types/finance";
import { findRowInTree } from "./row-utils";
import { getTotalSbcForYearFromEmbedded } from "./embedded-disclosure-sbc";
import { getTotalAmortizationForYearFromEmbedded } from "./embedded-disclosure-amortization";

/** Source type for a resolved CFO value. */
export type CfoSourceType =
  | "reported"
  | "income_statement"
  | "embedded_disclosure"
  | "derived"
  | "manual";

export interface CfoSourceResult {
  value: number;
  sourceType: CfoSourceType;
  sourceDetail: string;
}

export interface CfoSourceContext {
  cashFlowRows: Row[];
  incomeStatement: Row[];
  balanceSheet: Row[];
  embeddedDisclosures?: EmbeddedDisclosureItem[];
  /** When false, SBC disclosure is not used as fallback for CFS SBC (reported/manual only). */
  sbcDisclosureEnabled?: boolean;
  danaBreakdowns?: Record<string, number>;
}

function getStoredCfsValue(cashFlowRows: Row[], rowId: string, year: string): number | undefined {
  const row = findRowInTree(cashFlowRows, rowId);
  if (!row) return undefined;
  const v = row.values?.[year];
  return v !== undefined ? v : undefined;
}

/** Flatten IS for taxonomy / id lookups (nested opex, D&A, SBC). */
function flattenIncomeStatement(rows: Row[], out: Row[] = []): Row[] {
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) flattenIncomeStatement(r.children, out);
  }
  return out;
}

/** Exported for projected-cfs-engine alignment with CFS recompute logic. */
export function getDandaFromIncomeStatement(incomeStatement: Row[], year: string): number | null {
  const flat = flattenIncomeStatement(incomeStatement);
  const combined =
    flat.find((r) => r.taxonomyType === "opex_danda") ??
    flat.find((r) => r.id === "da" || r.id === "danda");
  const dep = flat.find((r) => r.taxonomyType === "opex_depreciation");
  const amort = flat.find((r) => r.taxonomyType === "opex_amortization");
  if (dep && amort && combined?.id !== dep.id && combined?.id !== amort.id) {
    const v = Math.abs(dep.values?.[year] ?? 0) + Math.abs(amort.values?.[year] ?? 0);
    return v > 0 || dep.values?.[year] !== undefined || amort.values?.[year] !== undefined ? v : null;
  }
  if (combined) {
    const v = Math.abs(combined.values?.[year] ?? 0);
    return combined.values?.[year] !== undefined ? v : null;
  }
  return null;
}

/** Exported for projected-cfs-engine alignment with CFS recompute logic. */
export function getSbcFromIncomeStatement(incomeStatement: Row[], year: string): number | null {
  const flat = flattenIncomeStatement(incomeStatement);
  const row =
    flat.find((r) => r.taxonomyType === "opex_sbc") ?? flat.find((r) => r.id === "sbc");
  if (!row || row.values?.[year] === undefined) return null;
  return Math.abs(row.values[year] ?? 0);
}

/**
 * True only if the user has explicitly entered a value for this CFS row/year.
 * Untouched/default/blank must not block fallback to disclosure or derived source.
 * Reported CFS wins only when this is true.
 */
export function hasMeaningfulHistoricalValue(row: Row, year: string): boolean {
  if (!row.cfsUserSetYears?.includes(year)) return false;
  return row.values?.[year] !== undefined;
}

/**
 * Resolve historical CFO value for a single row/year with explicit source hierarchy.
 * Used only for Operating Activities rows when computing CFS.
 */
export function resolveHistoricalCfoValue(
  rowId: string,
  year: string,
  context: CfoSourceContext
): CfoSourceResult {
  const { cashFlowRows, incomeStatement, balanceSheet, embeddedDisclosures = [], danaBreakdowns = {} } = context;

  // --- Net Income: always from Income Statement (derived/linked) ---
  if (rowId === "net_income") {
    const isRow =
      findRowInTree(incomeStatement, "net_income") ??
      incomeStatement.find((r) => r.taxonomyType === "calc_net_income");
    const value = isRow?.values?.[year] ?? 0;
    return {
      value,
      sourceType: "income_statement",
      sourceDetail: "Income Statement (Net Income)",
    };
  }

  // --- SBC: 1) reported CFS only if user meaningfully entered a value, 2) embedded disclosure total (only when SBC disclosure is enabled), 3) zero. ---
  if (rowId === "sbc") {
    const sbcRow = cashFlowRows.find((r) => r.id === "sbc");
    const reported = getStoredCfsValue(cashFlowRows, "sbc", year);
    if (sbcRow && reported !== undefined && hasMeaningfulHistoricalValue(sbcRow, year)) {
      return { value: reported, sourceType: "reported", sourceDetail: "Reported CFS SBC" };
    }
    const useSbcDisclosure = context.sbcDisclosureEnabled !== false;
    if (useSbcDisclosure) {
      const fromEmbedded = getTotalSbcForYearFromEmbedded(embeddedDisclosures ?? [], year);
      if (fromEmbedded !== 0) {
        return {
          value: fromEmbedded,
          sourceType: "embedded_disclosure",
          sourceDetail: "SBC disclosure total (embedded disclosures)",
        };
      }
    }
    const fromIs = getSbcFromIncomeStatement(incomeStatement, year);
    if (fromIs != null) {
      return { value: fromIs, sourceType: "income_statement", sourceDetail: "Income Statement (SBC / opex_sbc)" };
    }
    return { value: 0, sourceType: "manual", sourceDetail: useSbcDisclosure ? "No SBC (zero)" : "SBC disclosure off; enter value in CFS or turn disclosure on" };
  }

  // --- D&A: 1) reported CFS only if user meaningfully entered a value, 2) IS D&A or danaBreakdowns, 3) zero ---
  if (rowId === "danda") {
    const dandaRow = cashFlowRows.find((r) => r.id === "danda");
    const reported = getStoredCfsValue(cashFlowRows, "danda", year);
    if (dandaRow && reported !== undefined && hasMeaningfulHistoricalValue(dandaRow, year)) {
      return { value: reported, sourceType: "reported", sourceDetail: "Reported CFS D&A" };
    }
    const isDanda =
      findRowInTree(incomeStatement, "danda") ??
      findRowInTree(incomeStatement, "da");
    const fromIsSingle = isDanda?.values?.[year];
    if (fromIsSingle !== undefined && fromIsSingle !== 0) {
      return { value: fromIsSingle, sourceType: "income_statement", sourceDetail: "Income Statement (D&A)" };
    }
    const fromIsCombined = getDandaFromIncomeStatement(incomeStatement, year);
    if (fromIsCombined != null && fromIsCombined !== 0) {
      return { value: fromIsCombined, sourceType: "income_statement", sourceDetail: "Income Statement (depreciation + amortization)" };
    }
    const fromDana = danaBreakdowns[year];
    if (fromDana !== undefined && fromDana !== 0) {
      return { value: fromDana, sourceType: "derived", sourceDetail: "D&A breakdown (danaBreakdowns)" };
    }
    return { value: 0, sourceType: "manual", sourceDetail: "No D&A (zero)" };
  }

  // --- Amortization (separate row): 1) reported CFS only if user meaningfully entered, 2) disclosure total, 3) zero. ---
  if (rowId === "amortization" || rowId === "amortization_intangibles") {
    const amortRow = cashFlowRows.find((r) => r.id === rowId);
    const reported = getStoredCfsValue(cashFlowRows, rowId, year);
    if (amortRow && reported !== undefined && hasMeaningfulHistoricalValue(amortRow, year)) {
      return { value: reported, sourceType: "reported", sourceDetail: "Reported CFS amortization" };
    }
    const fromEmbedded = getTotalAmortizationForYearFromEmbedded(embeddedDisclosures, year);
    if (fromEmbedded !== 0) {
      return {
        value: fromEmbedded,
        sourceType: "embedded_disclosure",
        sourceDetail: "Amortization disclosure total (embedded disclosures)",
      };
    }
    return { value: 0, sourceType: "manual", sourceDetail: "No separate amortization row in CFS template" };
  }

  // --- Working capital: historical = reported only (never BS-derived for historical) ---
  if (rowId === "wc_change") {
    const isHistorical = year.endsWith("A");
    if (isHistorical) {
      const stored = getStoredCfsValue(cashFlowRows, "wc_change", year) ?? 0;
      return {
        value: stored,
        sourceType: "reported",
        sourceDetail: "Reported CFS Working Capital change",
      };
    }
    // Projection: BS-derived is used by the calculation engine elsewhere; we don't resolve here.
    const stored = getStoredCfsValue(cashFlowRows, "wc_change", year) ?? 0;
    return { value: stored, sourceType: "derived", sourceDetail: "Projection (BS-derived in engine)" };
  }

  // --- Other operating: manual only (no derived source in this step) ---
  if (rowId === "other_operating") {
    const stored = getStoredCfsValue(cashFlowRows, "other_operating", year) ?? 0;
    return { value: stored, sourceType: "manual", sourceDetail: "Manual input" };
  }

  return { value: 0, sourceType: "manual", sourceDetail: "Unknown row" };
}

/**
 * Resolve only the numeric value for use in the calculation engine.
 * Delegates to resolveHistoricalCfoValue and returns .value.
 */
export function resolveHistoricalCfoValueOnly(
  rowId: string,
  year: string,
  context: CfoSourceContext
): number {
  return resolveHistoricalCfoValue(rowId, year, context).value;
}

/**
 * True only when SBC disclosure is enabled and there is actual disclosure data for that year.
 * Used by the CFS builder to decide editability: if no disclosure value is available,
 * the SBC row must remain manually editable; if disclosure value is present, row can be read-only/auto-populated.
 */
export function hasSbcDisclosureValueForYear(
  year: string,
  embeddedDisclosures: EmbeddedDisclosureItem[],
  sbcDisclosureEnabled: boolean
): boolean {
  if (!sbcDisclosureEnabled) return false;
  const total = getTotalSbcForYearFromEmbedded(embeddedDisclosures ?? [], year);
  return total !== 0;
}
