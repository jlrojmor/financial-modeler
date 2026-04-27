/**
 * Classify CFS rows for projected statements: driver-backed vs CF-disclosure-only (10-K style lines).
 * Used by Projected Statements builder routing and optional diagnostics inventory.
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";
import { CFS_ANCHOR_FORECAST_DRIVER } from "@/lib/cfs-forecast-drivers";
import { isCfsComputedRollupRowId } from "@/lib/cfs-structural-row-ids";
import { isOtherBsSyntheticCfsRowId } from "@/lib/other-bs-cfs-bridge";

function bsRowExists(balanceSheet: Row[], bsRowId: string): boolean {
  return findRowInTree(balanceSheet, bsRowId) != null;
}

export type CfsLineProjectionClass =
  | "maps_to_bs"
  | "maps_to_is"
  | "schedule"
  | "cf_disclosure_only";

const ANCHOR_IDS = new Set(Object.keys(CFS_ANCHOR_FORECAST_DRIVER));

/** BS account id this CFS row can bridge to (cfsItemId or same id on BS). */
function bsKeyForCfsLinkedBsRow(row: Row, balanceSheet: Row[]): string | null {
  if (row.cfsLink?.cfsItemId && bsRowExists(balanceSheet, row.cfsLink.cfsItemId)) {
    return row.cfsLink.cfsItemId;
  }
  if (bsRowExists(balanceSheet, row.id)) return row.id;
  return null;
}

/** Drivers that imply the line is model-backed (IS/BS/schedules), not 10-K disclosure-only. */
const MODEL_BACKED_CFS_DRIVERS = new Set<string>([
  "income_statement",
  "danda_schedule",
  "working_capital_schedule",
  "capex_schedule",
  "debt_schedule",
  "financing_assumption",
  "manual_mna",
]);

/** Template financing ids used by some imports (not in CFS_ANCHOR_FORECAST_DRIVER keys). */
const LEGACY_FINANCING_ANCHOR_IDS = new Set(["debt_issuance", "debt_repayment", "equity_issuance"]);

/**
 * Single-row classification for projection / routing (not historical filing audit).
 */
export function classifyCfsLineForProjection(row: Row | null, balanceSheet: Row[]): CfsLineProjectionClass {
  if (!row) return "cf_disclosure_only";

  /** Section totals / net change in cash — derived by the CFS engine, not disclosure policies. */
  if (isCfsComputedRollupRowId(row.id)) return "schedule";

  if (ANCHOR_IDS.has(row.id)) return "schedule";

  const tt = row.taxonomyType as string | undefined;

  if (isOtherBsSyntheticCfsRowId(row.id)) return "schedule";

  if (row.id.startsWith("cfo_")) return "maps_to_bs";

  if (row.isLink?.isItemId) return "maps_to_is";

  if (
    tt?.startsWith("opex_") ||
    tt === "cfo_net_income" ||
    tt === "cfo_danda" ||
    tt === "cfo_da" ||
    tt === "cfo_sbc"
  ) {
    return "maps_to_is";
  }

  if (tt?.startsWith("cfo_wc_") || tt?.startsWith("cfi_") || tt?.startsWith("cff_")) {
    return "schedule";
  }

  if (row.cfsForecastDriver === "working_capital_schedule") return "schedule";
  if (row.cfsForecastDriver === "danda_schedule" || row.cfsForecastDriver === "capex_schedule") return "schedule";
  if (row.cfsForecastDriver === "debt_schedule" || row.cfsForecastDriver === "financing_assumption") return "schedule";
  if (row.cfsForecastDriver === "income_statement") return "maps_to_is";

  if (row.cfsLink?.section === "operating" && bsKeyForCfsLinkedBsRow(row, balanceSheet)) {
    return "maps_to_bs";
  }

  // Investing / financing: do NOT treat section alone as forecasted — historic filing lines
  // often have cfsLink.section set with no BS bridge or schedule driver.
  if (row.cfsLink?.section === "investing" || row.cfsLink?.section === "financing") {
    const driver = row.cfsForecastDriver as string | undefined;
    if (driver && MODEL_BACKED_CFS_DRIVERS.has(driver)) {
      return "schedule";
    }
    if (driver === "manual_other" && bsKeyForCfsLinkedBsRow(row, balanceSheet)) {
      return "maps_to_bs";
    }
    if (driver === "disclosure_or_assumption" && bsKeyForCfsLinkedBsRow(row, balanceSheet)) {
      return "maps_to_bs";
    }
    if (bsKeyForCfsLinkedBsRow(row, balanceSheet)) {
      return "maps_to_bs";
    }
    if (LEGACY_FINANCING_ANCHOR_IDS.has(row.id)) {
      return "schedule";
    }
    return "cf_disclosure_only";
  }

  return "cf_disclosure_only";
}

export type CfsLineInventoryEntry = {
  id: string;
  label: string;
  classification: CfsLineProjectionClass;
  /** Metadata gaps for diagnostics (Phase 0 inventory). */
  missingMetadata: string[];
  cfsForecastDriver?: Row["cfsForecastDriver"];
  historicalCfsNature?: Row["historicalCfsNature"];
  hasCfsLink: boolean;
};

function collectMissingMetadata(row: Row): string[] {
  const missing: string[] = [];
  if (!row.cfsForecastDriver) missing.push("cfsForecastDriver");
  if (!row.historicalCfsNature) missing.push("historicalCfsNature");
  if (!row.cfsLink && !row.id.startsWith("cfo_")) missing.push("cfsLink");
  return missing;
}

/**
 * Flatten CFS tree with inventory rows for dev / diagnostics.
 */
export function inventoryCfsLinesForDiagnostics(cashFlow: Row[], balanceSheet: Row[]): CfsLineInventoryEntry[] {
  const flat: Row[] = [];
  const walk = (rows: Row[]) => {
    for (const r of rows) {
      flat.push(r);
      if (r.children?.length) walk(r.children);
    }
  };
  walk(cashFlow ?? []);

  return flat.map((row) => ({
    id: row.id,
    label: row.label,
    classification: classifyCfsLineForProjection(row, balanceSheet),
    missingMetadata: collectMissingMetadata(row),
    cfsForecastDriver: row.cfsForecastDriver,
    historicalCfsNature: row.historicalCfsNature,
    hasCfsLink: row.cfsLink != null,
  }));
}

/** True when the line is issuer-style disclosure without an automatic driver (needs policy or mapping). */
export function isCfDisclosureOnlyLine(row: Row | null, balanceSheet: Row[]): boolean {
  return classifyCfsLineForProjection(row, balanceSheet) === "cf_disclosure_only";
}
