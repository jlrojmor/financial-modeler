/**
 * Revenue projection v1: recursive hierarchy.
 * - derived_sum: sum of children (post-order).
 * - independent_driver: growth/fixed; if children, they are allocations of parent.
 * - rev: derived → sum(top-level); independent → project rev then allocate to top lines.
 */

import type { Row } from "@/types/finance";
import type {
  RevenueForecastConfigV1,
  RevenueForecastMethodV1,
  GrowthStartingBasisV1,
  ForecastRevenueNodeV1,
} from "@/types/revenue-forecast-v1";
import { computeRowValue } from "@/lib/calculations";
import { validateRevenueForecastV1 } from "@/lib/revenue-forecast-v1-validation";
import {
  resolveGrowthRatesByYear,
  resolvePrefixedGrowthRatesByYear,
  resolveUtilizationLevelsByYear,
} from "@/lib/revenue-growth-phases-v1";

export type ProjectedRevenueResultV1 = Record<string, Record<string, number>>;

/** Resolved ARPU period basis; missing/invalid config → annual (backward compatible). */
export function resolveArpuBasisFromParams(params: Record<string, unknown>): "monthly" | "annual" {
  return params.arpuBasis === "monthly" ? "monthly" : "annual";
}

/** Resolved revenue-per-location period basis; missing/invalid config → annual (backward compatible). */
export function resolveRevenuePerLocationBasisFromParams(params: Record<string, unknown>): "monthly" | "annual" {
  return params.revenuePerLocationBasis === "monthly" ? "monthly" : "annual";
}

/** ×12 when monetization is monthly (annual revenue model); ×1 when annual. */
export function getArpuAnnualizationMultiplier(params: Record<string, unknown>): number {
  return resolveArpuBasisFromParams(params) === "monthly" ? 12 : 1;
}

/** ×12 when monetization is monthly (annual revenue model); ×1 when annual. */
export function getRevenuePerLocationAnnualizationMultiplier(params: Record<string, unknown>): number {
  return resolveRevenuePerLocationBasisFromParams(params) === "monthly" ? 12 : 1;
}

/** Resolved yield period basis for Capacity × Utilization × Yield; missing/invalid → annual. */
export function resolveYieldBasisFromParams(params: Record<string, unknown>): "monthly" | "annual" {
  return params.yieldBasis === "monthly" ? "monthly" : "annual";
}

/** ×12 when yield is entered as monthly per utilized unit; ×1 when annual. */
export function getYieldAnnualizationMultiplier(params: Record<string, unknown>): number {
  return resolveYieldBasisFromParams(params) === "monthly" ? 12 : 1;
}

function findRow(rows: Row[], id: string): Row | null {
  for (const r of rows) {
    if (r.id === id) return r;
    if (r.children?.length) {
      const found = findRow(r.children, id);
      if (found) return found;
    }
  }
  return null;
}

function getHistoricValue(
  row: Row,
  year: string,
  incomeStatement: Row[],
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] },
  sbcBreakdowns: Record<string, Record<string, number>>,
  danaBreakdowns: Record<string, number>
): number {
  return computeRowValue(row, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns);
}

function walkForecastNodes(nodes: ForecastRevenueNodeV1[], fn: (n: ForecastRevenueNodeV1) => void): void {
  for (const n of nodes) {
    fn(n);
    walkForecastNodes(n.children, fn);
  }
}

export function computeRevenueProjectionsV1(
  incomeStatement: Row[],
  forecastTree: ForecastRevenueNodeV1[],
  config: RevenueForecastConfigV1,
  projectionYears: string[],
  lastHistoricYear: string,
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] },
  sbcBreakdowns: Record<string, Record<string, number>>,
  danaBreakdowns: Record<string, number>
): { result: ProjectedRevenueResultV1; valid: boolean } {
  const rows = config.rows ?? {};
  const lastHistoricByRowId: Record<string, number | null> = {};

  const revRow = incomeStatement.find((r) => r.id === "rev");
  if (revRow && lastHistoricYear) {
    const v = getHistoricValue(revRow, lastHistoricYear, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns);
    lastHistoricByRowId["rev"] = typeof v === "number" && !Number.isNaN(v) ? v : null;
  }

  walkForecastNodes(forecastTree, (node) => {
    const isRow = findRow(incomeStatement, node.id);
    if (isRow && lastHistoricYear) {
      const v = getHistoricValue(isRow, lastHistoricYear, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns);
      lastHistoricByRowId[node.id] = typeof v === "number" && !Number.isNaN(v) ? v : null;
    } else {
      lastHistoricByRowId[node.id] = null;
    }
  });

  const lastHistoricForValidation: Record<string, number> = {};
  for (const [k, v] of Object.entries(lastHistoricByRowId)) {
    lastHistoricForValidation[k] = v !== null && !Number.isNaN(v) ? v : NaN;
  }

  const validation = validateRevenueForecastV1(incomeStatement, config, {
    forecastTree,
    lastHistoricYear,
    lastHistoricByRowId: lastHistoricForValidation,
    projectionYears,
  });
  if (!validation.valid) {
    return { result: {}, valid: false };
  }

  const result: ProjectedRevenueResultV1 = {};
  const revCfg = rows["rev"];
  if (!revCfg) return { result: {}, valid: false };

  const getPriorStored = (rowId: string, yearIndex: number, params: Record<string, unknown>): number | null => {
    if (yearIndex > 0) {
      const y = projectionYears[yearIndex - 1];
      return result[rowId]?.[y] ?? 0;
    }
    const basis = params.startingBasis as GrowthStartingBasisV1 | undefined;
    const startingAmount = params.startingAmount;
    const hasStarting = startingAmount != null && Number.isFinite(Number(startingAmount));
    const lastHistoric = lastHistoricByRowId[rowId] ?? null;
    const hasHistoric = lastHistoric !== null && !Number.isNaN(lastHistoric);

    if (basis === "starting_amount" && hasStarting) return Number(startingAmount);
    if (basis === "last_historical" && hasHistoric) return lastHistoric!;
    return null;
  };

  const projectIndependentRow = (rowId: string) => {
    const cfg = rows[rowId];
    if (cfg?.forecastRole !== "independent_driver" || !cfg.forecastMethod) return;
    const method = cfg.forecastMethod as RevenueForecastMethodV1;
    const params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;

    if (method === "price_volume") {
      const v0 = Number(params.startingVolume);
      const p0 = Number(params.startingPricePerUnit);
      if (!Number.isFinite(v0) || !Number.isFinite(p0) || v0 <= 0 || p0 <= 0) return;
      const volResolved = resolvePrefixedGrowthRatesByYear(params, "volume", projectionYears);
      const priceResolved = resolvePrefixedGrowthRatesByYear(params, "price", projectionYears);
      result[rowId] = {};
      let volPrev = v0;
      let pricePrev = p0;
      for (let i = 0; i < projectionYears.length; i++) {
        const year = projectionYears[i]!;
        const volPct =
          volResolved?.[year] != null && Number.isFinite(Number(volResolved[year]))
            ? Number(volResolved[year])
            : Number(params.volumeRatePercent) ?? 0;
        const pricePct =
          priceResolved?.[year] != null && Number.isFinite(Number(priceResolved[year]))
            ? Number(priceResolved[year])
            : Number(params.priceRatePercent) ?? 0;
        const vol = volPrev * (1 + volPct / 100);
        const price = pricePrev * (1 + pricePct / 100);
        result[rowId][year] = vol * price;
        volPrev = vol;
        pricePrev = price;
      }
      return;
    }

    if (method === "contracts_acv") {
      const c0 = Number(params.startingContracts);
      const a0 = Number(params.startingAcv);
      if (!Number.isFinite(c0) || !Number.isFinite(a0) || c0 <= 0 || a0 <= 0) return;
      const contractResolved = resolvePrefixedGrowthRatesByYear(params, "contract", projectionYears);
      const acvResolved = resolvePrefixedGrowthRatesByYear(params, "acv", projectionYears);
      result[rowId] = {};
      let contractPrev = c0;
      let acvPrev = a0;
      for (let i = 0; i < projectionYears.length; i++) {
        const year = projectionYears[i]!;
        const contractPct =
          contractResolved?.[year] != null && Number.isFinite(Number(contractResolved[year]))
            ? Number(contractResolved[year])
            : Number(params.contractRatePercent) ?? 0;
        const acvPct =
          acvResolved?.[year] != null && Number.isFinite(Number(acvResolved[year]))
            ? Number(acvResolved[year])
            : Number(params.acvRatePercent) ?? 0;
        const contracts = contractPrev * (1 + contractPct / 100);
        const acv = acvPrev * (1 + acvPct / 100);
        result[rowId][year] = contracts * acv;
        contractPrev = contracts;
        acvPrev = acv;
      }
      return;
    }

    if (method === "customers_arpu") {
      const c0 = Number(params.startingCustomers);
      const a0 = Number(params.startingArpu);
      if (!Number.isFinite(c0) || !Number.isFinite(a0) || c0 <= 0 || a0 <= 0) return;
      const arpuAnnualization = getArpuAnnualizationMultiplier(params);
      const customerResolved = resolvePrefixedGrowthRatesByYear(params, "customer", projectionYears);
      const arpuResolved = resolvePrefixedGrowthRatesByYear(params, "arpu", projectionYears);
      result[rowId] = {};
      let customerPrev = c0;
      let arpuPrev = a0;
      for (let i = 0; i < projectionYears.length; i++) {
        const year = projectionYears[i]!;
        const customerPct =
          customerResolved?.[year] != null && Number.isFinite(Number(customerResolved[year]))
            ? Number(customerResolved[year])
            : Number(params.customerRatePercent) ?? 0;
        const arpuPct =
          arpuResolved?.[year] != null && Number.isFinite(Number(arpuResolved[year]))
            ? Number(arpuResolved[year])
            : Number(params.arpuRatePercent) ?? 0;
        const customers = customerPrev * (1 + customerPct / 100);
        const arpu = arpuPrev * (1 + arpuPct / 100);
        result[rowId][year] = customers * arpu * arpuAnnualization;
        customerPrev = customers;
        arpuPrev = arpu;
      }
      return;
    }

    if (method === "locations_revenue_per_location") {
      const l0 = Number(params.startingLocations);
      const r0 = Number(params.startingRevenuePerLocation);
      if (!Number.isFinite(l0) || !Number.isFinite(r0) || l0 <= 0 || r0 <= 0) return;
      const rplAnnualization = getRevenuePerLocationAnnualizationMultiplier(params);
      const locResolved = resolvePrefixedGrowthRatesByYear(params, "location", projectionYears);
      const rplResolved = resolvePrefixedGrowthRatesByYear(params, "revenuePerLocation", projectionYears);
      result[rowId] = {};
      let locPrev = l0;
      let rplPrev = r0;
      for (let i = 0; i < projectionYears.length; i++) {
        const year = projectionYears[i]!;
        const locPct =
          locResolved?.[year] != null && Number.isFinite(Number(locResolved[year]))
            ? Number(locResolved[year])
            : Number(params.locationRatePercent) ?? 0;
        const rplPct =
          rplResolved?.[year] != null && Number.isFinite(Number(rplResolved[year]))
            ? Number(rplResolved[year])
            : Number(params.revenuePerLocationRatePercent) ?? 0;
        const locations = locPrev * (1 + locPct / 100);
        const revenuePerLocation = rplPrev * (1 + rplPct / 100);
        result[rowId][year] = locations * revenuePerLocation * rplAnnualization;
        locPrev = locations;
        rplPrev = revenuePerLocation;
      }
      return;
    }

    if (method === "capacity_utilization_yield") {
      const cap0 = Number(params.startingCapacity);
      const yield0 = Number(params.startingYield);
      if (!Number.isFinite(cap0) || !Number.isFinite(yield0) || cap0 <= 0 || yield0 <= 0) return;
      const utilLevels = resolveUtilizationLevelsByYear(params, projectionYears);
      if (!utilLevels) return;
      const capResolved = resolvePrefixedGrowthRatesByYear(params, "capacity", projectionYears);
      const yieldResolved = resolvePrefixedGrowthRatesByYear(params, "yield", projectionYears);
      const yieldMult = getYieldAnnualizationMultiplier(params);
      result[rowId] = {};
      let capPrev = cap0;
      let yieldPrev = yield0;
      for (let i = 0; i < projectionYears.length; i++) {
        const year = projectionYears[i]!;
        const utilPct = utilLevels[year];
        if (utilPct == null || !Number.isFinite(utilPct)) return;
        const capPct =
          capResolved?.[year] != null && Number.isFinite(Number(capResolved[year]))
            ? Number(capResolved[year])
            : Number(params.capacityRatePercent) ?? 0;
        const yPct =
          yieldResolved?.[year] != null && Number.isFinite(Number(yieldResolved[year]))
            ? Number(yieldResolved[year])
            : Number(params.yieldRatePercent) ?? 0;
        const cap = capPrev * (1 + capPct / 100);
        const yVal = yieldPrev * (1 + yPct / 100);
        result[rowId][year] = cap * (utilPct / 100) * yVal * yieldMult;
        capPrev = cap;
        yieldPrev = yVal;
      }
      return;
    }

    const resolvedRates = method === "growth_rate" ? resolveGrowthRatesByYear(params, projectionYears) : null;
    result[rowId] = {};
    for (let i = 0; i < projectionYears.length; i++) {
      const year = projectionYears[i];
      if (method === "growth_rate") {
        const prior = getPriorStored(rowId, i, params);
        if (prior === null) return;
        const pct =
          resolvedRates?.[year] != null && Number.isFinite(Number(resolvedRates[year]))
            ? Number(resolvedRates[year])
            : Number(params.ratePercent) ?? 0;
        const rate = pct / 100;
        result[rowId][year] = prior * (1 + rate);
      } else {
        const valuesByYear = params.valuesByYear as Record<string, number> | undefined;
        result[rowId][year] = valuesByYear?.[year] ?? Number(params.value) ?? 0;
      }
    }
  };

  const projectAllocChildren = (parentId: string, children: ForecastRevenueNodeV1[]) => {
    for (const child of children) {
      const cCfg = rows[child.id];
      if (cCfg?.forecastRole !== "allocation_of_parent") continue;
      const pct = ((cCfg.forecastParameters?.allocationPercent as number) ?? 0) / 100;
      result[child.id] = {};
      for (const year of projectionYears) {
        const pv = result[parentId]?.[year] ?? 0;
        result[child.id][year] = pv * pct;
      }
    }
  };

  /** Build-from-children subtree: post-order compute children then sum. */
  const projectDerivedSubtree = (node: ForecastRevenueNodeV1, parentDerivedForChildren: string) => {
    const cfg = rows[node.id];
    if (cfg?.forecastRole !== "derived_sum") return;

    for (const child of node.children) {
      const cCfg = rows[child.id];
      if (cCfg?.forecastRole === "derived_sum") {
        projectDerivedSubtree(child, child.id);
      } else if (cCfg?.forecastRole === "independent_driver") {
        projectIndependentRow(child.id);
        if (child.children.length > 0) {
          projectAllocChildren(child.id, child.children);
        }
      }
    }

    result[node.id] = {};
    for (const year of projectionYears) {
      let sum = 0;
      for (const child of node.children) {
        sum += result[child.id]?.[year] ?? 0;
      }
      result[node.id][year] = sum;
    }
  };

  if (revCfg.forecastRole === "independent_driver") {
    projectIndependentRow("rev");
    if (forecastTree.length > 0) {
      projectAllocChildren("rev", forecastTree);
    }
  } else if (revCfg.forecastRole === "derived_sum") {
    for (const stream of forecastTree) {
      const sCfg = rows[stream.id];
      if (sCfg?.forecastRole === "derived_sum") {
        projectDerivedSubtree(stream, stream.id);
      } else if (sCfg?.forecastRole === "independent_driver") {
        projectIndependentRow(stream.id);
        if (stream.children.length > 0) {
          projectAllocChildren(stream.id, stream.children);
        }
      }
    }
    result["rev"] = {};
    for (const year of projectionYears) {
      let sum = 0;
      for (const stream of forecastTree) {
        sum += result[stream.id]?.[year] ?? 0;
      }
      result["rev"][year] = sum;
    }
  }

  return { result, valid: true };
}

/**
 * Read-only: projected units sold per projection year for Price × Volume, using the same
 * volume loop as `projectIndependentRow` (no revenue math; no circular use of revenue/price).
 */
export function projectPriceVolumeUnitsByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> | null {
  const v0 = Number(params.startingVolume);
  const p0 = Number(params.startingPricePerUnit);
  if (!Number.isFinite(v0) || !Number.isFinite(p0) || v0 <= 0 || p0 <= 0) return null;
  if (projectionYears.length === 0) return {};
  const volResolved = resolvePrefixedGrowthRatesByYear(params, "volume", projectionYears);
  const out: Record<string, number> = {};
  let volPrev = v0;
  for (let i = 0; i < projectionYears.length; i++) {
    const year = projectionYears[i]!;
    const volPct =
      volResolved?.[year] != null && Number.isFinite(Number(volResolved[year]))
        ? Number(volResolved[year])
        : Number(params.volumeRatePercent) ?? 0;
    const vol = volPrev * (1 + volPct / 100);
    out[year] = vol;
    volPrev = vol;
  }
  return out;
}

/**
 * Read-only: projected customer count per projection year for Customers × ARPU, using the same
 * customer loop as `projectIndependentRow` (no revenue math; no ARPU compounding here).
 */
export function projectCustomersArpuCustomersByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> | null {
  const c0 = Number(params.startingCustomers);
  const a0 = Number(params.startingArpu);
  if (!Number.isFinite(c0) || !Number.isFinite(a0) || c0 <= 0 || a0 <= 0) return null;
  if (projectionYears.length === 0) return {};
  const customerResolved = resolvePrefixedGrowthRatesByYear(params, "customer", projectionYears);
  const out: Record<string, number> = {};
  let customerPrev = c0;
  for (let i = 0; i < projectionYears.length; i++) {
    const year = projectionYears[i]!;
    const customerPct =
      customerResolved?.[year] != null && Number.isFinite(Number(customerResolved[year]))
        ? Number(customerResolved[year])
        : Number(params.customerRatePercent) ?? 0;
    const customers = customerPrev * (1 + customerPct / 100);
    out[year] = customers;
    customerPrev = customers;
  }
  return out;
}

/**
 * Read-only: projected contract count per projection year for Contracts × ACV, using the same
 * contract loop as `projectIndependentRow` (no revenue math; no ACV compounding here).
 */
export function projectContractsAcvContractsByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> | null {
  const c0 = Number(params.startingContracts);
  const a0 = Number(params.startingAcv);
  if (!Number.isFinite(c0) || !Number.isFinite(a0) || c0 <= 0 || a0 <= 0) return null;
  if (projectionYears.length === 0) return {};
  const contractResolved = resolvePrefixedGrowthRatesByYear(params, "contract", projectionYears);
  const out: Record<string, number> = {};
  let contractPrev = c0;
  for (let i = 0; i < projectionYears.length; i++) {
    const year = projectionYears[i]!;
    const contractPct =
      contractResolved?.[year] != null && Number.isFinite(Number(contractResolved[year]))
        ? Number(contractResolved[year])
        : Number(params.contractRatePercent) ?? 0;
    const contracts = contractPrev * (1 + contractPct / 100);
    out[year] = contracts;
    contractPrev = contracts;
  }
  return out;
}

/**
 * Read-only: projected location count per projection year for Locations × Revenue per Location,
 * using the same location loop as `projectIndependentRow` (no revenue math; no revenue-per-location compounding here).
 */
export function projectLocationsRevenuePerLocationLocationsByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> | null {
  const l0 = Number(params.startingLocations);
  const r0 = Number(params.startingRevenuePerLocation);
  if (!Number.isFinite(l0) || !Number.isFinite(r0) || l0 <= 0 || r0 <= 0) return null;
  if (projectionYears.length === 0) return {};
  const locResolved = resolvePrefixedGrowthRatesByYear(params, "location", projectionYears);
  const out: Record<string, number> = {};
  let locPrev = l0;
  for (let i = 0; i < projectionYears.length; i++) {
    const year = projectionYears[i]!;
    const locPct =
      locResolved?.[year] != null && Number.isFinite(Number(locResolved[year]))
        ? Number(locResolved[year])
        : Number(params.locationRatePercent) ?? 0;
    const locations = locPrev * (1 + locPct / 100);
    out[year] = locations;
    locPrev = locations;
  }
  return out;
}

/**
 * Read-only: projected utilized units per year for Capacity × Utilization × Yield:
 * UtilizedUnits(t) = Capacity(t) × Utilization(t) / 100, matching `projectIndependentRow`
 * (no yield compounding or revenue math here).
 */
export function projectCapacityUtilizationYieldUtilizedUnitsByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> | null {
  const cap0 = Number(params.startingCapacity);
  const yld0 = Number(params.startingYield);
  if (!Number.isFinite(cap0) || !Number.isFinite(yld0) || cap0 <= 0 || yld0 <= 0) return null;
  const utilLevels = resolveUtilizationLevelsByYear(params, projectionYears);
  if (!utilLevels) return null;
  if (projectionYears.length === 0) return {};
  const capResolved = resolvePrefixedGrowthRatesByYear(params, "capacity", projectionYears);
  const out: Record<string, number> = {};
  let capPrev = cap0;
  for (let i = 0; i < projectionYears.length; i++) {
    const year = projectionYears[i]!;
    const utilPct = utilLevels[year];
    if (utilPct == null || !Number.isFinite(utilPct)) return null;
    const capPct =
      capResolved?.[year] != null && Number.isFinite(Number(capResolved[year]))
        ? Number(capResolved[year])
        : Number(params.capacityRatePercent) ?? 0;
    const cap = capPrev * (1 + capPct / 100);
    out[year] = cap * (utilPct / 100);
    capPrev = cap;
  }
  return out;
}

/**
 * Read-only helper for preview UI: starting drivers and volume/price after the first
 * projection year's growth step. Matches the first loop iteration of
 * `projectIndependentRow` for `price_volume` (no change to stored forecast math).
 */
export function getPriceVolumeFirstForecastYearDrivers(
  params: Record<string, unknown>,
  projectionYears: string[]
): {
  startingVolume: number;
  startingPricePerUnit: number;
  firstYearKey: string;
  volumeAfterGrowth: number;
  priceAfterGrowth: number;
} | null {
  const v0 = Number(params.startingVolume);
  const p0 = Number(params.startingPricePerUnit);
  if (!Number.isFinite(v0) || !Number.isFinite(p0) || v0 <= 0 || p0 <= 0) return null;
  if (projectionYears.length === 0) return null;
  const year = projectionYears[0]!;
  const volResolved = resolvePrefixedGrowthRatesByYear(params, "volume", projectionYears);
  const priceResolved = resolvePrefixedGrowthRatesByYear(params, "price", projectionYears);
  const volPct =
    volResolved?.[year] != null && Number.isFinite(Number(volResolved[year]))
      ? Number(volResolved[year])
      : Number(params.volumeRatePercent) ?? 0;
  const pricePct =
    priceResolved?.[year] != null && Number.isFinite(Number(priceResolved[year]))
      ? Number(priceResolved[year])
      : Number(params.priceRatePercent) ?? 0;
  const volumeAfterGrowth = v0 * (1 + volPct / 100);
  const priceAfterGrowth = p0 * (1 + pricePct / 100);
  return {
    startingVolume: v0,
    startingPricePerUnit: p0,
    firstYearKey: year,
    volumeAfterGrowth,
    priceAfterGrowth,
  };
}

/**
 * Read-only helper for preview UI: first projection year drivers for `contracts_acv`
 * (matches first loop iteration of `projectIndependentRow`).
 */
export function getContractsAcvFirstForecastYearDrivers(
  params: Record<string, unknown>,
  projectionYears: string[]
): {
  startingContracts: number;
  startingAcv: number;
  firstYearKey: string;
  contractsAfterGrowth: number;
  acvAfterGrowth: number;
} | null {
  const c0 = Number(params.startingContracts);
  const a0 = Number(params.startingAcv);
  if (!Number.isFinite(c0) || !Number.isFinite(a0) || c0 <= 0 || a0 <= 0) return null;
  if (projectionYears.length === 0) return null;
  const year = projectionYears[0]!;
  const contractResolved = resolvePrefixedGrowthRatesByYear(params, "contract", projectionYears);
  const acvResolved = resolvePrefixedGrowthRatesByYear(params, "acv", projectionYears);
  const contractPct =
    contractResolved?.[year] != null && Number.isFinite(Number(contractResolved[year]))
      ? Number(contractResolved[year])
      : Number(params.contractRatePercent) ?? 0;
  const acvPct =
    acvResolved?.[year] != null && Number.isFinite(Number(acvResolved[year]))
      ? Number(acvResolved[year])
      : Number(params.acvRatePercent) ?? 0;
  const contractsAfterGrowth = c0 * (1 + contractPct / 100);
  const acvAfterGrowth = a0 * (1 + acvPct / 100);
  return {
    startingContracts: c0,
    startingAcv: a0,
    firstYearKey: year,
    contractsAfterGrowth,
    acvAfterGrowth,
  };
}

/**
 * Read-only helper for preview UI: starting customers/ARPU and first projection year
 * drivers after growth step. Matches the first loop iteration of
 * `projectIndependentRow` for `customers_arpu` (including ARPU basis annualization).
 */
export function getCustomersArpuFirstForecastYearDrivers(
  params: Record<string, unknown>,
  projectionYears: string[]
): {
  startingCustomers: number;
  startingArpu: number;
  firstYearKey: string;
  customersAfterGrowth: number;
  arpuAfterGrowth: number;
  arpuBasis: "monthly" | "annual";
} | null {
  const c0 = Number(params.startingCustomers);
  const a0 = Number(params.startingArpu);
  if (!Number.isFinite(c0) || !Number.isFinite(a0) || c0 <= 0 || a0 <= 0) return null;
  if (projectionYears.length === 0) return null;
  const year = projectionYears[0]!;
  const customerResolved = resolvePrefixedGrowthRatesByYear(params, "customer", projectionYears);
  const arpuResolved = resolvePrefixedGrowthRatesByYear(params, "arpu", projectionYears);
  const customerPct =
    customerResolved?.[year] != null && Number.isFinite(Number(customerResolved[year]))
      ? Number(customerResolved[year])
      : Number(params.customerRatePercent) ?? 0;
  const arpuPct =
    arpuResolved?.[year] != null && Number.isFinite(Number(arpuResolved[year]))
      ? Number(arpuResolved[year])
      : Number(params.arpuRatePercent) ?? 0;
  const customersAfterGrowth = c0 * (1 + customerPct / 100);
  const arpuAfterGrowth = a0 * (1 + arpuPct / 100);
  return {
    startingCustomers: c0,
    startingArpu: a0,
    firstYearKey: year,
    customersAfterGrowth,
    arpuAfterGrowth,
    arpuBasis: resolveArpuBasisFromParams(params),
  };
}

/**
 * Read-only helper for preview UI: starting locations/revenue-per-location and first projection year
 * drivers after growth step. Matches the first loop iteration of
 * `projectIndependentRow` for `locations_revenue_per_location` (including monetization basis annualization).
 */
export function getLocationsRevenuePerLocationFirstForecastYearDrivers(
  params: Record<string, unknown>,
  projectionYears: string[]
): {
  startingLocations: number;
  startingRevenuePerLocation: number;
  firstYearKey: string;
  locationsAfterGrowth: number;
  revenuePerLocationAfterGrowth: number;
  revenuePerLocationBasis: "monthly" | "annual";
} | null {
  const l0 = Number(params.startingLocations);
  const r0 = Number(params.startingRevenuePerLocation);
  if (!Number.isFinite(l0) || !Number.isFinite(r0) || l0 <= 0 || r0 <= 0) return null;
  if (projectionYears.length === 0) return null;
  const year = projectionYears[0]!;
  const locResolved = resolvePrefixedGrowthRatesByYear(params, "location", projectionYears);
  const rplResolved = resolvePrefixedGrowthRatesByYear(params, "revenuePerLocation", projectionYears);
  const locPct =
    locResolved?.[year] != null && Number.isFinite(Number(locResolved[year]))
      ? Number(locResolved[year])
      : Number(params.locationRatePercent) ?? 0;
  const rplPct =
    rplResolved?.[year] != null && Number.isFinite(Number(rplResolved[year]))
      ? Number(rplResolved[year])
      : Number(params.revenuePerLocationRatePercent) ?? 0;
  const locationsAfterGrowth = l0 * (1 + locPct / 100);
  const revenuePerLocationAfterGrowth = r0 * (1 + rplPct / 100);
  return {
    startingLocations: l0,
    startingRevenuePerLocation: r0,
    firstYearKey: year,
    locationsAfterGrowth,
    revenuePerLocationAfterGrowth,
    revenuePerLocationBasis: resolveRevenuePerLocationBasisFromParams(params),
  };
}

/**
 * Read-only helper for preview UI: first projection year drivers for
 * `capacity_utilization_yield` (matches first loop iteration of `projectIndependentRow`).
 */
export function getCapacityUtilizationYieldFirstForecastYearDrivers(
  params: Record<string, unknown>,
  projectionYears: string[]
): {
  startingCapacity: number;
  startingUtilizationPct: number;
  startingYield: number;
  firstYearKey: string;
  capacityAfterGrowth: number;
  utilizationPctFirstYear: number;
  yieldAfterGrowth: number;
  yieldBasis: "monthly" | "annual";
} | null {
  const cap0 = Number(params.startingCapacity);
  const yld0 = Number(params.startingYield);
  if (!Number.isFinite(cap0) || !Number.isFinite(yld0) || cap0 <= 0 || yld0 <= 0) return null;
  if (projectionYears.length === 0) return null;
  const year = projectionYears[0]!;
  const utilLevels = resolveUtilizationLevelsByYear(params, projectionYears);
  if (!utilLevels || utilLevels[year] == null || !Number.isFinite(utilLevels[year])) return null;
  const u0 = Number(params.startingUtilizationPct);
  if (!Number.isFinite(u0) || u0 < 0 || u0 > 100) return null;
  const capResolved = resolvePrefixedGrowthRatesByYear(params, "capacity", projectionYears);
  const yieldResolved = resolvePrefixedGrowthRatesByYear(params, "yield", projectionYears);
  const capPct =
    capResolved?.[year] != null && Number.isFinite(Number(capResolved[year]))
      ? Number(capResolved[year])
      : Number(params.capacityRatePercent) ?? 0;
  const yieldPct =
    yieldResolved?.[year] != null && Number.isFinite(Number(yieldResolved[year]))
      ? Number(yieldResolved[year])
      : Number(params.yieldRatePercent) ?? 0;
  const capacityAfterGrowth = cap0 * (1 + capPct / 100);
  const yieldAfterGrowth = yld0 * (1 + yieldPct / 100);
  return {
    startingCapacity: cap0,
    startingUtilizationPct: u0,
    startingYield: yld0,
    firstYearKey: year,
    capacityAfterGrowth,
    utilizationPctFirstYear: utilLevels[year]!,
    yieldAfterGrowth,
    yieldBasis: resolveYieldBasisFromParams(params),
  };
}
