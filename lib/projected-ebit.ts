/**
 * Utility: compute projected EBIT by year using the forecast engines.
 * Used by the Non-Operating bridge preview and Tax Schedule builder
 * to show forecasted EBIT/EBT without waiting for full IS linkage.
 *
 * Formula: EBIT = Revenue − COGS − Direct OpEx
 *
 * COGS: handles all configured methods (mirrors is-build-preview.tsx logic).
 * OpEx: sums all lines configured as "forecast_direct".
 */

import type { Row } from "@/types/finance";
import type { CurrencyUnit } from "@/store/useModelStore";
import type { CogsForecastConfigV1 } from "@/types/cogs-forecast-v1";
import type { OpExForecastConfigV1 } from "@/types/opex-forecast-v1";
import type { RevenueForecastConfigV1, ForecastRevenueNodeV1 } from "@/types/revenue-forecast-v1";
import type { RevenueProjectionConfig } from "@/types/revenue-projection";
import { computeRevenueProjectionsV1 } from "@/lib/revenue-projection-engine-v1";
import { computeRevenueProjections } from "@/lib/revenue-projection-engine";
import {
  buildForecastableCogsLinesFromRevenue,
  resolveCogsPctOfRevenueByYear,
  computeCogsCostPerUnitForecastByYear,
  computeCogsCostPerCustomerForecastByYear,
  computeCogsCostPerContractForecastByYear,
  computeCogsCostPerLocationForecastByYear,
  computeCogsCostPerUtilizedUnitForecastByYear,
  resolveCustomersArpuParamsForCogsLinkedRow,
  resolveContractsAcvParamsForCogsLinkedRow,
  resolveLocationsRevenuePerLocationParamsForCogsLinkedRow,
  resolveCapacityUtilizationYieldParamsForCogsLinkedRow,
} from "@/lib/cogs-forecast-v1";
import {
  projectPriceVolumeUnitsByYear,
  projectCustomersArpuCustomersByYear,
  projectContractsAcvContractsByYear,
  projectLocationsRevenuePerLocationLocationsByYear,
  projectCapacityUtilizationYieldUtilizedUnitsByYear,
} from "@/lib/revenue-projection-engine-v1";
import { collectOperatingExpenseLeafLines } from "@/lib/opex-line-ingest";
import {
  getOpExLineLastHistoricalValue,
  projectOpExLineForecastByYear,
} from "@/lib/opex-forecast-projection-v1";

export interface ComputeProjectedEbitInput {
  incomeStatement: Row[];
  projectionYears: string[];
  lastHistoricYear: string;
  revenueForecastConfigV1: RevenueForecastConfigV1 | undefined;
  revenueForecastTreeV1: ForecastRevenueNodeV1[];
  revenueProjectionConfig: RevenueProjectionConfig | undefined;
  cogsForecastConfigV1: CogsForecastConfigV1 | undefined;
  opexForecastConfigV1: OpExForecastConfigV1 | undefined;
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] };
  sbcBreakdowns: Record<string, Record<string, number>>;
  danaBreakdowns: Record<string, number>;
  currencyUnit: CurrencyUnit;
}

export function computeProjectedEbitByYear(
  input: ComputeProjectedEbitInput
): Record<string, number | null> {
  const {
    incomeStatement,
    projectionYears,
    lastHistoricYear,
    revenueForecastConfigV1,
    revenueForecastTreeV1,
    revenueProjectionConfig,
    cogsForecastConfigV1,
    opexForecastConfigV1,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
    currencyUnit,
  } = input;

  const out: Record<string, number | null> = {};
  if (projectionYears.length === 0 || !lastHistoricYear) return out;

  // ── 1. Per-row revenue projections ──────────────────────────────────────
  let projectedRevByRowId: Record<string, Record<string, number>> = {};
  const v1Config = revenueForecastConfigV1 ?? { rows: {} };
  const rowsCfg = v1Config.rows ?? {};
  const v1HasRows = Object.keys(rowsCfg).length > 0;

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
    if (valid && Object.keys(result).length > 0) {
      projectedRevByRowId = result as Record<string, Record<string, number>>;
    }
  }

  if (
    Object.keys(projectedRevByRowId).length === 0 &&
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
    projectedRevByRowId = legacy as Record<string, Record<string, number>>;
  }

  // Total revenue by year (key "rev" from the engine)
  const revTotalByYear: Record<string, number> = {};
  for (const y of projectionYears) {
    const v = Number(projectedRevByRowId["rev"]?.[y]);
    if (Number.isFinite(v)) revTotalByYear[y] = v;
  }

  // No projected revenue = can't compute EBIT
  if (Object.keys(revTotalByYear).length === 0) {
    for (const y of projectionYears) out[y] = null;
    return out;
  }

  // ── 2. Projected COGS (all methods, mirrors is-build-preview.tsx) ────────
  const cogsTotalByYear: Record<string, number> = {};
  const forecastableCogsLines = buildForecastableCogsLinesFromRevenue(
    revenueForecastTreeV1,
    rowsCfg
  );

  // Build a per-line COGS value map (same logic as cogsValueByLineByYear in is-build-preview)
  const cogsValueByLineByYear: Record<string, Record<string, number>> = {};
  for (const line of forecastableCogsLines) {
    const cfg = cogsForecastConfigV1?.lines?.[line.lineId];
    if (!cfg?.forecastMethod) continue;

    if (cfg.forecastMethod === "pct_of_revenue") {
      const params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      const pctByYear = resolveCogsPctOfRevenueByYear(params, projectionYears);
      const vals: Record<string, number> = {};
      for (const y of projectionYears) {
        // Use linked revenue row projection; fall back to total revenue
        const rev = Number(
          projectedRevByRowId[line.linkedRevenueRowId]?.[y] ?? revTotalByYear[y] ?? 0
        );
        const pct = Number(pctByYear[y] ?? 0);
        if (Number.isFinite(rev) && Number.isFinite(pct)) {
          vals[y] = rev * (pct / 100);
        }
      }
      cogsValueByLineByYear[line.lineId] = vals;
      continue;
    }

    if (cfg.forecastMethod === "cost_per_unit") {
      const revCfg = rowsCfg[line.linkedRevenueRowId];
      const revParams = (revCfg?.forecastParameters ?? {}) as Record<string, unknown>;
      const volByY =
        revCfg?.forecastRole === "independent_driver" && revCfg.forecastMethod === "price_volume"
          ? projectPriceVolumeUnitsByYear(revParams, projectionYears)
          : null;
      const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      cogsValueByLineByYear[line.lineId] = computeCogsCostPerUnitForecastByYear(cogsParams, volByY, projectionYears);
      continue;
    }

    if (cfg.forecastMethod === "cost_per_customer") {
      const revParams = resolveCustomersArpuParamsForCogsLinkedRow(
        line.linkedRevenueRowId,
        rowsCfg,
        revenueForecastTreeV1
      );
      const custByY = revParams ? projectCustomersArpuCustomersByYear(revParams, projectionYears) : null;
      const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      cogsValueByLineByYear[line.lineId] = computeCogsCostPerCustomerForecastByYear(cogsParams, custByY, projectionYears);
      continue;
    }

    if (cfg.forecastMethod === "cost_per_contract") {
      const revParams = resolveContractsAcvParamsForCogsLinkedRow(
        line.linkedRevenueRowId,
        rowsCfg,
        revenueForecastTreeV1
      );
      const ctrByY = revParams ? projectContractsAcvContractsByYear(revParams, projectionYears) : null;
      const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      cogsValueByLineByYear[line.lineId] = computeCogsCostPerContractForecastByYear(cogsParams, ctrByY, projectionYears);
      continue;
    }

    if (cfg.forecastMethod === "cost_per_location") {
      const revParams = resolveLocationsRevenuePerLocationParamsForCogsLinkedRow(
        line.linkedRevenueRowId,
        rowsCfg,
        revenueForecastTreeV1
      );
      const locByY = revParams
        ? projectLocationsRevenuePerLocationLocationsByYear(revParams, projectionYears)
        : null;
      const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      cogsValueByLineByYear[line.lineId] = computeCogsCostPerLocationForecastByYear(cogsParams, locByY, projectionYears);
      continue;
    }

    if (cfg.forecastMethod === "cost_per_utilized_unit") {
      const revParams = resolveCapacityUtilizationYieldParamsForCogsLinkedRow(
        line.linkedRevenueRowId,
        rowsCfg,
        revenueForecastTreeV1
      );
      const uuByY = revParams
        ? projectCapacityUtilizationYieldUtilizedUnitsByYear(revParams, projectionYears)
        : null;
      const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      cogsValueByLineByYear[line.lineId] = computeCogsCostPerUtilizedUnitForecastByYear(cogsParams, uuByY, projectionYears);
    }
  }

  // Sum COGS across all forecastable lines
  for (const y of projectionYears) {
    let cogsSum = 0;
    let cogsHas = false;
    for (const line of forecastableCogsLines) {
      const v = cogsValueByLineByYear[line.lineId]?.[y];
      if (v != null && Number.isFinite(v)) {
        cogsSum += v;
        cogsHas = true;
      }
    }
    if (cogsHas) cogsTotalByYear[y] = cogsSum;
  }

  // ── 3. Projected direct OpEx ─────────────────────────────────────────────
  const opexTotalByYear: Record<string, number> = {};
  const ingestedOpexLines = collectOperatingExpenseLeafLines(incomeStatement);
  for (const y of projectionYears) {
    let opexSum = 0;
    let opexHas = false;
    for (const row of ingestedOpexLines) {
      const cfg = opexForecastConfigV1?.lines?.[row.lineId];
      if (!cfg || cfg.routeStatus !== "forecast_direct") continue;
      const lh = getOpExLineLastHistoricalValue(
        row.lineId,
        incomeStatement,
        lastHistoricYear,
        allStatements,
        sbcBreakdowns,
        danaBreakdowns
      );
      const opexByYear = projectOpExLineForecastByYear(cfg, {
        projectionYears,
        revenueTotalByYear: revTotalByYear,
        lastHistValue: lh != null && Number.isFinite(lh) ? lh : null,
      });
      const v = opexByYear[y];
      if (v != null && Number.isFinite(v)) {
        opexSum += v;
        opexHas = true;
      }
    }
    if (opexHas) opexTotalByYear[y] = opexSum;
  }

  // ── 4. EBIT = Revenue − COGS − OpEx ──────────────────────────────────────
  for (const y of projectionYears) {
    const rev = revTotalByYear[y];
    if (rev == null || !Number.isFinite(rev)) {
      out[y] = null;
      continue;
    }
    const cogs = cogsTotalByYear[y] ?? 0;
    const opex = opexTotalByYear[y] ?? 0;
    out[y] = rev - cogs - opex;
  }

  return out;
}

/**
 * Compute projected Revenue and COGS totals by year using the forecast engines.
 * Subset of computeProjectedEbitByYear — excludes OpEx, returns intermediate values.
 * Used by Working Capital drivers to size DSO/DIO/DPO calculations.
 */
export type ProjectedRevCogsResult = {
  revByYear: Record<string, number>;
  cogsByYear: Record<string, number>;
};

export interface ComputeProjectedRevCogsInput {
  incomeStatement: Row[];
  projectionYears: string[];
  lastHistoricYear: string;
  revenueForecastConfigV1: RevenueForecastConfigV1 | undefined;
  revenueForecastTreeV1: ForecastRevenueNodeV1[];
  revenueProjectionConfig: RevenueProjectionConfig | undefined;
  cogsForecastConfigV1: CogsForecastConfigV1 | undefined;
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] };
  sbcBreakdowns: Record<string, Record<string, number>>;
  danaBreakdowns: Record<string, number>;
  currencyUnit: CurrencyUnit;
}

export function computeProjectedRevCogs(
  input: ComputeProjectedRevCogsInput
): ProjectedRevCogsResult {
  const {
    incomeStatement,
    projectionYears,
    lastHistoricYear,
    revenueForecastConfigV1,
    revenueForecastTreeV1,
    revenueProjectionConfig,
    cogsForecastConfigV1,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
    currencyUnit,
  } = input;

  const revByYear: Record<string, number> = {};
  const cogsByYear: Record<string, number> = {};

  if (projectionYears.length === 0 || !lastHistoricYear) {
    return { revByYear, cogsByYear };
  }

  // ── 1. Revenue projections ────────────────────────────────────────────────
  let projectedRevByRowId: Record<string, Record<string, number>> = {};
  const v1Config = revenueForecastConfigV1 ?? { rows: {} };
  const rowsCfg = v1Config.rows ?? {};
  const v1HasRows = Object.keys(rowsCfg).length > 0;

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
    if (valid && Object.keys(result).length > 0) {
      projectedRevByRowId = result as Record<string, Record<string, number>>;
    }
  }

  if (
    Object.keys(projectedRevByRowId).length === 0 &&
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
    projectedRevByRowId = legacy as Record<string, Record<string, number>>;
  }

  for (const y of projectionYears) {
    const v = Number(projectedRevByRowId["rev"]?.[y]);
    if (Number.isFinite(v)) revByYear[y] = v;
  }

  if (Object.keys(revByYear).length === 0) {
    return { revByYear, cogsByYear };
  }

  // ── 2. COGS projections (mirrors computeProjectedEbitByYear) ─────────────
  const forecastableCogsLines = buildForecastableCogsLinesFromRevenue(
    revenueForecastTreeV1,
    rowsCfg
  );
  const cogsValueByLineByYear: Record<string, Record<string, number>> = {};

  for (const line of forecastableCogsLines) {
    const cfg = cogsForecastConfigV1?.lines?.[line.lineId];
    if (!cfg?.forecastMethod) continue;

    if (cfg.forecastMethod === "pct_of_revenue") {
      const params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      const pctByYear = resolveCogsPctOfRevenueByYear(params, projectionYears);
      const vals: Record<string, number> = {};
      for (const y of projectionYears) {
        const rev = Number(
          projectedRevByRowId[line.linkedRevenueRowId]?.[y] ?? revByYear[y] ?? 0
        );
        const pct = Number(pctByYear[y] ?? 0);
        if (Number.isFinite(rev) && Number.isFinite(pct)) vals[y] = rev * (pct / 100);
      }
      cogsValueByLineByYear[line.lineId] = vals;
      continue;
    }

    if (cfg.forecastMethod === "cost_per_unit") {
      const revCfg = rowsCfg[line.linkedRevenueRowId];
      const revParams = (revCfg?.forecastParameters ?? {}) as Record<string, unknown>;
      const volByY =
        revCfg?.forecastRole === "independent_driver" && revCfg.forecastMethod === "price_volume"
          ? projectPriceVolumeUnitsByYear(revParams, projectionYears)
          : null;
      const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      cogsValueByLineByYear[line.lineId] = computeCogsCostPerUnitForecastByYear(cogsParams, volByY, projectionYears);
      continue;
    }

    if (cfg.forecastMethod === "cost_per_customer") {
      const revParams = resolveCustomersArpuParamsForCogsLinkedRow(
        line.linkedRevenueRowId,
        rowsCfg,
        revenueForecastTreeV1
      );
      const custByY = revParams ? projectCustomersArpuCustomersByYear(revParams, projectionYears) : null;
      const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      cogsValueByLineByYear[line.lineId] = computeCogsCostPerCustomerForecastByYear(cogsParams, custByY, projectionYears);
      continue;
    }

    if (cfg.forecastMethod === "cost_per_contract") {
      const revParams = resolveContractsAcvParamsForCogsLinkedRow(
        line.linkedRevenueRowId,
        rowsCfg,
        revenueForecastTreeV1
      );
      const ctrByY = revParams ? projectContractsAcvContractsByYear(revParams, projectionYears) : null;
      const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      cogsValueByLineByYear[line.lineId] = computeCogsCostPerContractForecastByYear(cogsParams, ctrByY, projectionYears);
      continue;
    }

    if (cfg.forecastMethod === "cost_per_location") {
      const revParams = resolveLocationsRevenuePerLocationParamsForCogsLinkedRow(
        line.linkedRevenueRowId,
        rowsCfg,
        revenueForecastTreeV1
      );
      const locByY = revParams
        ? projectLocationsRevenuePerLocationLocationsByYear(revParams, projectionYears)
        : null;
      const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      cogsValueByLineByYear[line.lineId] = computeCogsCostPerLocationForecastByYear(cogsParams, locByY, projectionYears);
      continue;
    }

    if (cfg.forecastMethod === "cost_per_utilized_unit") {
      const revParams = resolveCapacityUtilizationYieldParamsForCogsLinkedRow(
        line.linkedRevenueRowId,
        rowsCfg,
        revenueForecastTreeV1
      );
      const uuByY = revParams
        ? projectCapacityUtilizationYieldUtilizedUnitsByYear(revParams, projectionYears)
        : null;
      const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      cogsValueByLineByYear[line.lineId] = computeCogsCostPerUtilizedUnitForecastByYear(cogsParams, uuByY, projectionYears);
    }
  }

  for (const y of projectionYears) {
    let cogsSum = 0;
    let cogsHas = false;
    for (const line of forecastableCogsLines) {
      const v = cogsValueByLineByYear[line.lineId]?.[y];
      if (v != null && Number.isFinite(v)) {
        cogsSum += v;
        cogsHas = true;
      }
    }
    if (cogsHas) cogsByYear[y] = cogsSum;
  }

  return { revByYear, cogsByYear };
}
