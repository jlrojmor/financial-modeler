/**
 * Phase 2 preview only: project applied direct non-operating forecast bodies to projection years.
 * Does not write the income statement; schedule engines are out of scope.
 */

import type { Row } from "@/types/finance";
import type { CurrencyUnit } from "@/store/useModelStore";
import type { ForecastRevenueNodeV1, RevenueForecastConfigV1 } from "@/types/revenue-forecast-v1";
import type { RevenueProjectionConfig } from "@/types/revenue-projection";
import { computeRevenueProjectionsV1 } from "@/lib/revenue-projection-engine-v1";
import { computeRevenueProjections } from "@/lib/revenue-projection-engine";
import { getOpExLineLastHistoricalValue } from "@/lib/opex-forecast-projection-v1";
import type { NonOperatingPhase2DirectPersistBody } from "@/lib/non-operating-phase2-ui-persist";
import {
  collectNonOperatingIncomeLeaves,
  defaultPhase2Bucket,
  findIsRowById,
  type NonOperatingLeafLine,
  type Phase2LineBucket,
} from "@/lib/non-operating-phase2-lines";

export type NonOperatingDirectPreviewLineDetail = {
  lineId: string;
  label: string;
  byYear: Record<string, number>;
};

/**
 * Total revenue by projection year (same basis as Forecast Drivers revenue preview).
 */
export function getProjectedRevenueTotalByYear(input: {
  incomeStatement: Row[];
  revenueForecastConfigV1: RevenueForecastConfigV1 | undefined;
  revenueForecastTreeV1: ForecastRevenueNodeV1[];
  revenueProjectionConfig: RevenueProjectionConfig | undefined;
  projectionYears: string[];
  lastHistoricYear: string;
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] };
  sbcBreakdowns: Record<string, Record<string, number>>;
  danaBreakdowns: Record<string, number>;
  currencyUnit: CurrencyUnit;
}): Record<string, number> {
  const {
    incomeStatement,
    revenueForecastConfigV1,
    revenueForecastTreeV1,
    revenueProjectionConfig,
    projectionYears,
    lastHistoricYear,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
    currencyUnit,
  } = input;

  const out: Record<string, number> = {};
  if (!projectionYears.length || !lastHistoricYear) return out;

  const v1Config = revenueForecastConfigV1 ?? { rows: {} };
  const v1HasRows = Object.keys(v1Config.rows ?? {}).length > 0;
  if (v1HasRows) {
    const { result, valid } = computeRevenueProjectionsV1(
      incomeStatement,
      revenueForecastTreeV1,
      v1Config,
      projectionYears,
      lastHistoricYear,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns
    );
    if (valid && result.rev) {
      for (const y of projectionYears) {
        const v = result.rev[y];
        if (v != null && Number.isFinite(v)) out[y] = v;
      }
      return out;
    }
  }

  if (
    revenueProjectionConfig?.items &&
    Object.keys(revenueProjectionConfig.items).length > 0
  ) {
    const legacy = computeRevenueProjections(
      incomeStatement,
      revenueProjectionConfig,
      projectionYears,
      lastHistoricYear,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
      currencyUnit
    );
    const rev = legacy["rev"];
    if (rev) {
      for (const y of projectionYears) {
        const v = rev[y];
        if (v != null && Number.isFinite(v)) out[y] = v;
      }
    }
  }

  return out;
}

/**
 * Project one line from applied (saved) direct non-operating config. Values are stored units; signs preserved.
 */
export function projectAppliedNonOperatingDirectBody(
  applied: NonOperatingPhase2DirectPersistBody,
  input: {
    projectionYears: string[];
    revenueTotalByYear: Record<string, number>;
    lastHistLineValue: number | null;
  }
): Record<string, number> {
  const { projectionYears, revenueTotalByYear, lastHistLineValue } = input;
  const out: Record<string, number> = {};
  const { method, pct, growth, flat, manualByYear } = applied;

  if (method === "pct_of_revenue") {
    const p = Number(pct);
    if (!Number.isFinite(p)) return {};
    for (const y of projectionYears) {
      const rev = revenueTotalByYear[y];
      if (rev == null || !Number.isFinite(rev)) continue;
      out[y] = rev * (p / 100);
    }
    return out;
  }

  if (method === "growth_percent") {
    const g = Number(growth);
    if (!Number.isFinite(g)) return {};
    if (lastHistLineValue == null || !Number.isFinite(lastHistLineValue)) return {};
    let prior = lastHistLineValue;
    for (const y of projectionYears) {
      const v = prior * (1 + g / 100);
      out[y] = v;
      prior = v;
    }
    return out;
  }

  if (method === "flat_value") {
    const f = Number(flat);
    if (!Number.isFinite(f)) return {};
    for (const y of projectionYears) out[y] = f;
    return out;
  }

  if (method === "manual_by_year") {
    for (const y of projectionYears) {
      const n = manualByYear[y];
      if (n != null && Number.isFinite(Number(n))) out[y] = Number(n);
    }
    return out;
  }

  return {};
}

export function buildNonOperatingPhase2DirectPreview(input: {
  leaves: NonOperatingLeafLine[];
  incomeStatement: Row[];
  bucketOverrides: Record<string, Phase2LineBucket>;
  directByLine: Record<
    string,
    { draft: NonOperatingPhase2DirectPersistBody; applied: NonOperatingPhase2DirectPersistBody | null }
  >;
  projectionYears: string[];
  lastHistoricYear: string;
  revenueTotalByYear: Record<string, number>;
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] };
  sbcBreakdowns: Record<string, Record<string, number>>;
  danaBreakdowns: Record<string, number>;
}): {
  totalByYear: Record<string, number>;
  lineDetails: NonOperatingDirectPreviewLineDetail[];
  hasAnyAppliedProjection: boolean;
} {
  const {
    leaves,
    incomeStatement,
    bucketOverrides,
    directByLine,
    projectionYears,
    lastHistoricYear,
    revenueTotalByYear,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
  } = input;

  const effectiveBucket = (line: NonOperatingLeafLine): Phase2LineBucket => {
    const row = findIsRowById(incomeStatement, line.lineId);
    const base = row ? defaultPhase2Bucket(row) : "review";
    return bucketOverrides[line.lineId] ?? base;
  };

  const lineDetails: NonOperatingDirectPreviewLineDetail[] = [];
  const totalByYear: Record<string, number> = {};
  for (const y of projectionYears) totalByYear[y] = 0;

  for (const leaf of leaves) {
    if (effectiveBucket(leaf) !== "direct") continue;
    const st = directByLine[leaf.lineId];
    const applied = st?.applied;
    if (!applied) continue;

    const lastHist = lastHistoricYear
      ? getOpExLineLastHistoricalValue(
          leaf.lineId,
          incomeStatement,
          lastHistoricYear,
          allStatements,
          sbcBreakdowns,
          danaBreakdowns
        )
      : null;

    const byYear = projectAppliedNonOperatingDirectBody(applied, {
      projectionYears,
      revenueTotalByYear,
      lastHistLineValue: lastHist,
    });

    if (Object.keys(byYear).length === 0) continue;

    lineDetails.push({ lineId: leaf.lineId, label: leaf.label, byYear });
    for (const y of projectionYears) {
      const v = byYear[y];
      if (v != null && Number.isFinite(v)) totalByYear[y] = (totalByYear[y] ?? 0) + v;
    }
  }

  const hasAnyAppliedProjection = lineDetails.length > 0;
  return { totalByYear, lineDetails, hasAnyAppliedProjection };
}

/** True if the row has a numeric historical value for the last historic year (for growth % anchor). */