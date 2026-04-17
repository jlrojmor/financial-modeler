/**
 * CFS row ids that are engine rollups / section totals / cash bridge — never issuer CF-disclosure policy lines.
 * Must stay aligned with getCfsProjectedStatementLineRouting "Computed (CFS totals)" branch.
 */

export const CFS_COMPUTED_ROLLUP_ROW_IDS = new Set([
  "operating_cf",
  "investing_cf",
  "financing_cf",
  "net_change_cash",
  "net_cash_change",
  "total_operating_cf",
  "total_investing_cf",
  "total_financing_cf",
]);

export function isCfsComputedRollupRowId(rowId: string): boolean {
  return CFS_COMPUTED_ROLLUP_ROW_IDS.has(rowId);
}
