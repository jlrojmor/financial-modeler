/**
 * Projected Statements CFS preview: SBC add-back amounts by projection year.
 * Mirrors `applyBsBuildProjectionsToModel` equity roll-forward `sbcByYear` logic
 * so CFS preview matches Other BS / Equity drivers when IS `opex_sbc` is empty.
 */

import type { Row } from "@/types/finance";

export type EquitySbcMethod = "auto" | "flat_hist" | "pct_revenue" | "manual_by_year";

export function computeProjectedSbcCfoByYear(params: {
  equityRollforwardConfirmed: boolean;
  projectionYears: string[];
  equitySbcMethod: EquitySbcMethod;
  equitySbcPctRevenue: number;
  equityManualSbcByYear: Record<string, number>;
  /** Same revenue series as equity roll-forward (`projRevByYear` in store). */
  revByYear: Record<string, number>;
  sbcBreakdowns: Record<string, Record<string, number>>;
  incomeStatement: Row[];
  cashFlow: Row[];
}): Record<string, number> {
  const {
    equityRollforwardConfirmed,
    projectionYears,
    equitySbcMethod,
    equitySbcPctRevenue,
    equityManualSbcByYear,
    revByYear,
    sbcBreakdowns,
    incomeStatement,
    cashFlow,
  } = params;

  if (!equityRollforwardConfirmed || projectionYears.length === 0) {
    return {};
  }

  const sbcByYear: Record<string, number> = {};
  const isRows = incomeStatement ?? [];
  const cfsRows = cashFlow ?? [];

  if (equitySbcMethod === "manual_by_year") {
    for (const y of projectionYears) sbcByYear[y] = Math.max(0, equityManualSbcByYear[y] ?? 0);
  } else if (equitySbcMethod === "pct_revenue") {
    for (const y of projectionYears) {
      sbcByYear[y] = (revByYear[y] ?? 0) * (equitySbcPctRevenue / 100);
    }
  } else if (equitySbcMethod === "flat_hist") {
    const isRow = isRows.find((r) => r.taxonomyType === "opex_sbc");
    const cfsRow = cfsRows.find((r) => r.taxonomyType === "cfo_sbc" || r.id === "sbc");
    const histYrs = Object.keys(isRow?.values ?? cfsRow?.values ?? {})
      .filter((y) => !projectionYears.includes(y))
      .sort();
    const lastHistSbc = Math.abs(
      (isRow?.values?.[histYrs[histYrs.length - 1]] ?? 0) || (cfsRow?.values?.[histYrs[histYrs.length - 1]] ?? 0)
    );
    for (const y of projectionYears) sbcByYear[y] = lastHistSbc;
  } else {
    let hasBreakdowns = false;
    for (const y of projectionYears) {
      let sum = 0;
      for (const bucket of Object.values(sbcBreakdowns ?? {})) sum += Math.abs(bucket[y] ?? 0);
      sbcByYear[y] = sum;
      if (sum > 0) hasBreakdowns = true;
    }
    if (!hasBreakdowns) {
      const isRow = isRows.find((r) => r.taxonomyType === "opex_sbc");
      const cfsRow = cfsRows.find((r) => r.taxonomyType === "cfo_sbc" || r.id === "sbc");
      for (const y of projectionYears) {
        const fromIs = Math.abs(isRow?.values?.[y] ?? 0);
        const fromCfs = Math.abs(cfsRow?.values?.[y] ?? 0);
        sbcByYear[y] = fromIs > 0 ? fromIs : fromCfs;
      }
    }
  }

  return sbcByYear;
}
