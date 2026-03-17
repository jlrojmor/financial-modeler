/**
 * Revenue projection engine v1.
 * Roles: independent_driver, derived_sum, allocation_of_parent.
 * Methods: growth_rate, fixed_value only.
 * Uses historic values from income statement; does not overwrite historicals.
 */

import type { Row } from "@/types/finance";
import type {
  RevenueForecastConfigV1,
  RevenueForecastRowConfigV1,
  RevenueForecastMethodV1,
} from "@/types/revenue-forecast-v1";
import { computeRowValue } from "@/lib/calculations";
import { validateRevenueForecastV1 } from "@/lib/revenue-forecast-v1-validation";

export type ProjectedRevenueResultV1 = Record<string, Record<string, number>>; // rowId -> year -> stored value

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

/**
 * Get historic value for a revenue row in a given year (from IS / computed).
 */
function getHistoricValue(
  row: Row,
  year: string,
  incomeStatement: Row[],
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] },
  sbcBreakdowns: Record<string, Record<string, number>>,
  danaBreakdowns: Record<string, number>
): number {
  return computeRowValue(
    row,
    year,
    incomeStatement,
    incomeStatement,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns
  );
}

/**
 * Compute projected revenue (v1) for projection years only.
 * Returns rowId -> year -> stored value. Does not run if validation fails.
 */
export function computeRevenueProjectionsV1(
  incomeStatement: Row[],
  config: RevenueForecastConfigV1,
  projectionYears: string[],
  lastHistoricYear: string,
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] },
  sbcBreakdowns: Record<string, Record<string, number>>,
  danaBreakdowns: Record<string, number>
): { result: ProjectedRevenueResultV1; valid: boolean } {
  const validation = validateRevenueForecastV1(incomeStatement, config);
  if (!validation.valid) {
    return { result: {}, valid: false };
  }

  const result: ProjectedRevenueResultV1 = {};
  const rev = incomeStatement.find((r) => r.id === "rev");
  if (!rev) return { result: {}, valid: true };

  const rows = config.rows ?? {};
  const streams = rev.children ?? [];

  const getPriorStored = (rowId: string, yearIndex: number, row: Row, params: Record<string, unknown>): number | null => {
    if (yearIndex > 0) {
      const year = projectionYears[yearIndex - 1];
      return result[rowId]?.[year] ?? 0;
    }
    // First projection year: use startingAmount if provided, else last historical
    const startingAmount = params.startingAmount;
    if (startingAmount != null && Number.isFinite(Number(startingAmount))) {
      return Number(startingAmount);
    }
    const year = lastHistoricYear;
    const historic = getHistoricValue(row, year, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns);
    if (typeof historic !== "number" || Number.isNaN(historic)) return null;
    return historic;
  };

  const projectIndependentDriver = (row: Row) => {
    const cfg = rows[row.id];
    if (cfg?.forecastRole !== "independent_driver" || !cfg.forecastMethod) return;
    const method = cfg.forecastMethod as RevenueForecastMethodV1;
    const params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
    result[row.id] = {};
    for (let i = 0; i < projectionYears.length; i++) {
      const year = projectionYears[i];
      if (method === "growth_rate") {
        const prior = getPriorStored(row.id, i, row, params);
        if (prior === null) {
          // No base: do not project this row (validation will have raised an error)
          return;
        }
        const rate =
          (params.ratesByYear as Record<string, number>)?.[year] != null
            ? (params.ratesByYear as Record<string, number>)[year] / 100
            : (Number(params.ratePercent) ?? 0) / 100;
        result[row.id][year] = prior * (1 + rate);
      } else {
        const valuesByYear = params.valuesByYear as Record<string, number> | undefined;
        const val = valuesByYear?.[year] ?? Number(params.value) ?? 0;
        result[row.id][year] = val;
      }
    }
  };

  // 1) Independent drivers: top-level streams
  for (const stream of streams) {
    projectIndependentDriver(stream);
  }
  // 1b) Independent drivers: children of derived_sum streams (nested segments)
  for (const stream of streams) {
    if (rows[stream.id]?.forecastRole !== "derived_sum") continue;
    for (const child of stream.children ?? []) {
      projectIndependentDriver(child);
    }
  }

  // 2) Allocation-of-parent children (parent already computed as independent_driver)
  for (const stream of streams) {
    const streamCfg = rows[stream.id];
    if (streamCfg?.forecastRole !== "independent_driver") continue;
    const children = stream.children ?? [];
    for (const child of children) {
      const childCfg = rows[child.id];
      if (childCfg?.forecastRole !== "allocation_of_parent") continue;
      const pctVal = childCfg.forecastParameters?.allocationPercent;
      const pct = (typeof pctVal === "number" ? pctVal : 0) / 100;
      result[child.id] = {};
      for (const year of projectionYears) {
        const parentVal = result[stream.id]?.[year] ?? 0;
        result[child.id][year] = parentVal * pct;
      }
    }
  }

  // 3) Streams that are derived_sum (sum of their children)
  for (const stream of streams) {
    const cfg = rows[stream.id];
    if (cfg?.forecastRole !== "derived_sum") continue;
    const children = stream.children ?? [];
    result[stream.id] = {};
    for (const year of projectionYears) {
      let sum = 0;
      for (const child of children) {
        sum += result[child.id]?.[year] ?? 0;
      }
      result[stream.id][year] = sum;
    }
  }

  // 4) Total Revenue = sum of all streams
  result["rev"] = {};
  for (const year of projectionYears) {
    let sum = 0;
    for (const stream of streams) {
      sum += result[stream.id]?.[year] ?? 0;
    }
    result["rev"][year] = sum;
  }

  return { result, valid: true };
}
