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
import { resolveGrowthRatesByYear } from "@/lib/revenue-growth-phases-v1";

export type ProjectedRevenueResultV1 = Record<string, Record<string, number>>;

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
