/**
 * CFS forecast-driver metadata for Step 5: forecast-ready structure.
 * Controlled vocabulary only; AI must return one of these.
 */

import type { Row } from "@/types/finance";

export type CfsForecastDriver = NonNullable<Row["cfsForecastDriver"]>;

/** Historical nature of a CFS row (reported line type). Enables distinct non-cash vs WC movement rows. */
export type HistoricalCfsNature = NonNullable<Row["historicalCfsNature"]>;

export const HISTORICAL_CFS_NATURE_VOCABULARY: HistoricalCfsNature[] = [
  "reported_non_cash_adjustment",
  "reported_working_capital_movement",
  "reported_operating_other",
  "reported_investing",
  "reported_financing",
  "reported_meta",
];

/** Deterministic historical nature for each fixed CFS anchor row id. */
export const CFS_ANCHOR_HISTORICAL_NATURE: Record<string, HistoricalCfsNature> = {
  net_income: "reported_meta",
  danda: "reported_non_cash_adjustment",
  sbc: "reported_non_cash_adjustment",
  wc_change: "reported_working_capital_movement",
  other_operating: "reported_operating_other",
  operating_cf: "reported_meta",
  capex: "reported_investing",
  acquisitions: "reported_investing",
  asset_sales: "reported_investing",
  investments: "reported_investing",
  other_investing: "reported_investing",
  investing_cf: "reported_meta",
  debt_issued: "reported_financing",
  debt_repaid: "reported_financing",
  equity_issued: "reported_financing",
  share_repurchases: "reported_financing",
  dividends: "reported_financing",
  other_financing: "reported_financing",
  financing_cf: "reported_meta",
  fx_effect_on_cash: "reported_meta",
  net_change_cash: "reported_meta",
};

export function getHistoricalNatureForAnchor(rowId: string): HistoricalCfsNature | undefined {
  return CFS_ANCHOR_HISTORICAL_NATURE[rowId];
}

export const CFS_FORECAST_DRIVER_VOCABULARY: CfsForecastDriver[] = [
  "income_statement",
  "danda_schedule",
  "disclosure_or_assumption",
  "working_capital_schedule",
  "capex_schedule",
  "debt_schedule",
  "financing_assumption",
  "manual_mna",
  "manual_other",
];

/** Deterministic forecast driver for each fixed CFS anchor row id. */
export const CFS_ANCHOR_FORECAST_DRIVER: Record<string, CfsForecastDriver> = {
  // Operating
  net_income: "income_statement",
  danda: "danda_schedule",
  sbc: "disclosure_or_assumption",
  wc_change: "working_capital_schedule",
  other_operating: "manual_other",
  // Investing
  capex: "capex_schedule",
  acquisitions: "manual_mna",
  asset_sales: "manual_other",
  investments: "manual_other",
  other_investing: "manual_other",
  // Financing
  debt_issued: "debt_schedule",
  debt_repaid: "debt_schedule",
  equity_issued: "financing_assumption",
  share_repurchases: "financing_assumption",
  dividends: "financing_assumption",
  other_financing: "manual_other",
  // Cash bridge (below CFI/CFF, above net change in cash)
  fx_effect_on_cash: "manual_other",
};

export function getForecastDriverForAnchor(rowId: string): CfsForecastDriver | undefined {
  return CFS_ANCHOR_FORECAST_DRIVER[rowId];
}

/** Apply deterministic forecast driver to a row if it's a fixed anchor. Preserves existing values. */
export function applyAnchorForecastDriver<T extends { id: string; cfsForecastDriver?: CfsForecastDriver }>(
  row: T
): T {
  const driver = getForecastDriverForAnchor(row.id);
  if (!driver) return row;
  if (row.cfsForecastDriver != null) return row;
  return { ...row, cfsForecastDriver: driver };
}

/** Apply deterministic historicalCfsNature to a row if it's a fixed anchor. Preserves existing values. */
export function applyAnchorHistoricalNature<T extends { id: string; historicalCfsNature?: HistoricalCfsNature }>(
  row: T
): T {
  const nature = getHistoricalNatureForAnchor(row.id);
  if (!nature) return row;
  if (row.historicalCfsNature != null) return row;
  return { ...row, historicalCfsNature: nature };
}
