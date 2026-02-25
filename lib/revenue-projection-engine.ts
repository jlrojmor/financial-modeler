/**
 * Revenue projection engine.
 * Computes projected values for each revenue line and projection year.
 * Uses historic values from incomeStatement; does not modify Historicals.
 */

import type { Row } from "@/types/finance";
import type {
  RevenueProjectionConfig,
  RevenueProjectionMethod,
  RevenueProjectionInputs,
  GrowthRateInputs,
  PriceVolumeInputs,
  CustomersArpuInputs,
  PctOfTotalInputs,
  ProductLineInputs,
} from "@/types/revenue-projection";
import { displayToStored } from "@/lib/currency-utils";
import type { CurrencyUnit } from "@/lib/currency-utils";
import { computeRowValue } from "@/lib/calculations";

export type ProjectedRevenueResult = Record<string, Record<string, number>>; // itemId -> year -> stored value

/**
 * Get historic value for a row in a given year (from IS or computed).
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
 * Compute projected value for one item in one year using growth_rate.
 */
function projectGrowthRate(
  itemId: string,
  year: string,
  priorYearValue: number,
  inputs: GrowthRateInputs,
  projectionYears: string[],
  lastHistoricYear: string
): number {
  const idx = projectionYears.indexOf(year);
  if (idx < 0) return priorYearValue;
  const rate =
    inputs.growthType === "constant"
      ? (inputs.ratePercent ?? 0) / 100
      : (inputs.ratesByYear?.[year] ?? inputs.ratePercent ?? 0) / 100;
  return priorYearValue * (1 + rate);
}

/**
 * Compute projected value for price_volume in one year.
 * price/volume are in display units; we return stored.
 */
function projectPriceVolume(
  year: string,
  inputs: PriceVolumeInputs,
  projectionYears: string[],
  lastHistoricYear: string,
  unit: CurrencyUnit
): number {
  const baseYear = inputs.baseYear || lastHistoricYear;
  let price = inputs.price ?? 0;
  let volume = inputs.volume ?? 0;
  const mult = inputs.annualizeFromMonthly ? 12 : 1;
  const priceGrowth = (inputs.priceGrowthPercent ?? 0) / 100;
  const volumeGrowth = (inputs.volumeGrowthPercent ?? 0) / 100;

  const allYears = [baseYear, ...projectionYears];
  const yearIdx = allYears.indexOf(year);
  if (yearIdx < 0) return 0;
  for (let i = 1; i <= yearIdx; i++) {
    price *= 1 + priceGrowth;
    volume *= 1 + volumeGrowth;
  }
  const displayRevenue = price * volume * mult;
  return displayToStored(displayRevenue, unit);
}

/**
 * Compute projected value for customers_arpu in one year.
 */
function projectCustomersArpu(
  year: string,
  inputs: CustomersArpuInputs,
  projectionYears: string[],
  lastHistoricYear: string,
  unit: CurrencyUnit
): number {
  const baseYear = inputs.baseYear || lastHistoricYear;
  let customers = inputs.customers ?? 0;
  let arpu = inputs.arpu ?? 0;
  const customerGrowth = (inputs.customerGrowthPercent ?? 0) / 100;
  const arpuGrowth = (inputs.arpuGrowthPercent ?? 0) / 100;

  const allYears = [baseYear, ...projectionYears];
  const yearIdx = allYears.indexOf(year);
  if (yearIdx < 0) return 0;
  for (let i = 1; i <= yearIdx; i++) {
    customers *= 1 + customerGrowth;
    arpu *= 1 + arpuGrowth;
  }
  const displayRevenue = customers * arpu;
  return displayToStored(displayRevenue, unit);
}

/**
 * Compute projected values for all revenue items and projection years.
 * Order: base items first (growth_rate, price_volume, customers_arpu, product_line), then total, then pct_of_total.
 */
export function computeRevenueProjections(
  incomeStatement: Row[],
  config: RevenueProjectionConfig,
  projectionYears: string[],
  lastHistoricYear: string,
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] },
  sbcBreakdowns: Record<string, Record<string, number>>,
  danaBreakdowns: Record<string, number>,
  currencyUnit: CurrencyUnit
): ProjectedRevenueResult {
  const result: ProjectedRevenueResult = {};
  const rev = incomeStatement.find((r) => r.id === "rev");
  if (!rev) return result;

  const streamIds = (rev.children ?? []).map((r) => r.id);
  const findRow = (rows: Row[], id: string): Row | null => {
    for (const r of rows) {
      if (r.id === id) return r;
      if (r.children?.length) {
        const found = findRow(r.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  // Build list of item ids that have their own forecast: rev, streams WITHOUT breakdowns, and all breakdowns
  const streamsWithBreakdowns = new Set(
    (rev.children ?? []).filter((s) => (config.breakdowns?.[s.id]?.length ?? 0) > 0).map((s) => s.id)
  );

  const getPriorValue = (
    itemId: string,
    year: string,
    yearIndex: number,
    breakdownBase?: number
  ): number => {
    if (yearIndex === 0) {
      if (breakdownBase !== undefined) return breakdownBase;
      const row = findRow(incomeStatement, itemId);
      if (!row) return 0;
      return getHistoricValue(
        row,
        lastHistoricYear,
        incomeStatement,
        allStatements,
        sbcBreakdowns,
        danaBreakdowns
      );
    }
    const prevYear = projectionYears[yearIndex - 1];
    return result[itemId]?.[prevYear] ?? 0;
  };

  const projectOneItem = (
    itemId: string,
    itemConfig: { method: RevenueProjectionMethod; inputs: RevenueProjectionInputs } | null | undefined,
    year: string,
    yearIndex: number,
    priorValue: number
  ): number => {
    if (!itemConfig) return 0;
    const { method, inputs } = itemConfig;
    if (method === "growth_rate") {
      return projectGrowthRate(
        itemId,
        year,
        priorValue,
        inputs as GrowthRateInputs,
        projectionYears,
        lastHistoricYear
      );
    }
    if (method === "price_volume") {
      return projectPriceVolume(
        year,
        inputs as PriceVolumeInputs,
        projectionYears,
        lastHistoricYear,
        currencyUnit
      );
    }
    if (method === "customers_arpu") {
      return projectCustomersArpu(
        year,
        inputs as CustomersArpuInputs,
        projectionYears,
        lastHistoricYear,
        currencyUnit
      );
    }
    if (method === "product_line" || method === "channel") {
      const pl = inputs as ProductLineInputs;
      const items = pl.items ?? [];
      if (items.length === 0) return priorValue;
      const baseTotal = priorValue;
      const n = items.length;
      let sum = 0;
      for (const it of items) {
        const share = (it.sharePercent ?? (n ? 100 / n : 0)) / 100;
        const g = (it.growthPercent ?? 0) / 100;
        const yearIdx = projectionYears.indexOf(year);
        if (yearIdx < 0) continue;
        sum += baseTotal * share * Math.pow(1 + g, yearIdx);
      }
      return sum;
    }
    if (method === "pct_of_total") return 0;
    return 0;
  };

  /** Write per-line values for product_line/channel so preview can show sub-rows. Key: parentId::lineId (stable fallback if id missing). */
  function writeProductLineChannelSubValues(
    parentId: string,
    baseTotal: number,
    projectionYears: string[],
    pl: ProductLineInputs,
    out: ProjectedRevenueResult
  ): void {
    const items = pl.items ?? [];
    if (items.length === 0) return;
    const n = items.length;
    items.forEach((it, idx) => {
      const raw = it.id ?? (it as { label?: string }).label;
      const lineKey = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${idx}`;
      const subId = `${parentId}::${lineKey}`;
      if (!out[subId]) out[subId] = {};
      const share = (it.sharePercent ?? (n ? 100 / n : 0)) / 100;
      const g = (it.growthPercent ?? 0) / 100;
      projectionYears.forEach((year, yearIdx) => {
        out[subId][year] = baseTotal * share * Math.pow(1 + g, yearIdx);
      });
    });
  }

  // First pass: project rev and streams that have NO breakdowns (they forecast themselves)
  result["rev"] = {};
  for (const streamRow of rev.children ?? []) {
    if (streamsWithBreakdowns.has(streamRow.id)) {
          result[streamRow.id] = {}; // will be sum of breakdowns in second pass
          continue;
    }
    result[streamRow.id] = {};
    const itemConfig = config.items[streamRow.id];
    for (let i = 0; i < projectionYears.length; i++) {
      const year = projectionYears[i];
      let prior = getPriorValue(streamRow.id, year, i);
      const method = itemConfig?.method;
      const inp = itemConfig?.inputs;
      if (i === 0 && method && inp != null) {
        if (method === "growth_rate" && (inp as GrowthRateInputs).baseAmount != null) {
          prior = displayToStored((inp as GrowthRateInputs).baseAmount!, currencyUnit);
        } else if ((method === "product_line" || method === "channel") && (inp as ProductLineInputs).baseAmount != null) {
          prior = displayToStored((inp as ProductLineInputs).baseAmount!, currencyUnit);
        }
      }
      result[streamRow.id][year] = projectOneItem(streamRow.id, itemConfig, year, i, prior);
    }
    const method = itemConfig?.method;
    const inp = itemConfig?.inputs;
    if ((method === "product_line" || method === "channel") && inp != null) {
      const baseTotal = result[streamRow.id][projectionYears[0]] ?? 0;
      writeProductLineChannelSubValues(streamRow.id, baseTotal, projectionYears, inp as ProductLineInputs, result);
    }
  }

  /** Methods that output absolute $ (not driven by allocation base). */
  const DRIVER_METHODS: RevenueProjectionMethod[] = ["price_volume", "customers_arpu"];

  // First pass B: For streams WITH breakdowns, project each breakdown (base = parent historic × allocation %)
  for (const streamRow of rev.children ?? []) {
    const breakdownList = config.breakdowns?.[streamRow.id] ?? [];
    const projAlloc = config.projectionAllocations?.[streamRow.id];
    if (breakdownList.length === 0) continue;
    const parentHistoric = getHistoricValue(
      streamRow,
      lastHistoricYear,
      incomeStatement,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns
    );
    for (const b of breakdownList) {
      result[b.id] = {};
      const pct = projAlloc?.percentages?.[b.id] ?? 0;
      let base = (parentHistoric * pct) / 100;
      const itemConfig = config.items[b.id];
      const method = itemConfig?.method;
      const inp = itemConfig?.inputs;
      if (method === "growth_rate" && (inp as GrowthRateInputs)?.baseAmount != null) {
        base = displayToStored((inp as GrowthRateInputs).baseAmount!, currencyUnit);
      } else if ((method === "product_line" || method === "channel") && (inp as ProductLineInputs)?.baseAmount != null) {
        base = displayToStored((inp as ProductLineInputs).baseAmount!, currencyUnit);
      }
      for (let i = 0; i < projectionYears.length; i++) {
        const year = projectionYears[i];
        const prior = getPriorValue(b.id, year, i, base);
        result[b.id][year] = projectOneItem(b.id, itemConfig, year, i, prior);
      }
      if ((method === "product_line" || method === "channel") && inp != null) {
        const baseTotal = result[b.id][projectionYears[0]] ?? 0;
        writeProductLineChannelSubValues(b.id, baseTotal, projectionYears, inp as ProductLineInputs, result);
      }
    }
  }

  // First pass B2: Resolve circular reference. Two modes:
  // Mode B (has "% of this stream"): T = sum(independents) / (1 - pct_of_parent_sum). Independents (driver $, growth, product_line, channel) keep their value — growth is respected. pct_of_parent = T × method %.
  // Mode A (driver only, no pct_of_parent): T = driver $ / (user-set driver %). Non-drivers = T × alloc % (residual plug; growth not respected).
  for (const streamRow of rev.children ?? []) {
    const breakdownList = config.breakdowns?.[streamRow.id] ?? [];
    const projAlloc = config.projectionAllocations?.[streamRow.id];
    if (breakdownList.length === 0) continue;
    const driverIds = new Set(
      breakdownList
        .filter((b) => DRIVER_METHODS.includes(config.items[b.id]?.method as RevenueProjectionMethod))
        .map((b) => b.id)
    );
    const pctOfParentIds = new Set(
      breakdownList
        .filter((b) => {
          const cfg = config.items[b.id];
          if (cfg?.method !== "pct_of_total") return false;
          const refId = (cfg.inputs as PctOfTotalInputs).referenceId ?? "rev";
          return refId === streamRow.id;
        })
        .map((b) => b.id)
    );
    const independentIds = breakdownList.filter(
      (b) => !pctOfParentIds.has(b.id)
    ).map((b) => b.id);
    const residualIds = breakdownList.filter(
      (b) => !driverIds.has(b.id) && !pctOfParentIds.has(b.id)
    ).map((b) => b.id);

    // Invalid mix: growth + $ + pct_of_stream in same stream. Skip B2; Second pass will sum breakdowns as-is.
    if (driverIds.size > 0 && pctOfParentIds.size > 0 && residualIds.length > 0) continue;

    const pctOfParentPctSum = breakdownList
      .filter((b) => pctOfParentIds.has(b.id))
      .reduce((s, b) => {
        const cfg = config.items[b.id];
        const pt = cfg?.inputs as PctOfTotalInputs | undefined;
        return s + (pt?.pctOfTotal ?? 0);
      }, 0) / 100;

    const allocPct = (id: string) => projAlloc?.percentages?.[id] ?? 0;
    const driverAllocSum = breakdownList
      .filter((b) => driverIds.has(b.id))
      .reduce((s, b) => s + allocPct(b.id), 0);

    for (const year of projectionYears) {
      if (pctOfParentIds.size > 0 && pctOfParentPctSum < 1) {
        // Mode B: respect growth and driver $; solve T from independents so pct_of_parent = T × method %
        const independentSum = independentIds.reduce((s, id) => s + (result[id]?.[year] ?? 0), 0);
        const T = independentSum / (1 - pctOfParentPctSum);
        for (const b of breakdownList) {
          if (pctOfParentIds.has(b.id)) {
            const pt = (config.items[b.id]?.inputs as PctOfTotalInputs) ?? {};
            result[b.id][year] = T * ((pt.pctOfTotal ?? 0) / 100);
          }
          // independents already have their value; do not overwrite
        }
        result[streamRow.id][year] = T;
      } else if (driverIds.size > 0 && driverAllocSum >= 1e-6) {
        // Mode A: residuals with baseAmount keep their projection; others are plug. T derived so stream is consistent.
        const driverTotal = breakdownList
          .filter((b) => driverIds.has(b.id))
          .reduce((s, b) => s + (result[b.id]?.[year] ?? 0), 0);
        const residualWithBase = residualIds.filter((id) => {
          const inp = config.items[id]?.inputs;
          const method = config.items[id]?.method;
          if (method === "growth_rate") return (inp as GrowthRateInputs)?.baseAmount != null;
          if (method === "product_line" || method === "channel") return (inp as ProductLineInputs)?.baseAmount != null;
          return false;
        });
        const keepSum = residualWithBase.reduce((s, id) => s + (result[id]?.[year] ?? 0), 0);
        const plugIds = residualIds.filter((id) => !residualWithBase.includes(id));
        const plugAllocSumPct = plugIds.reduce((s, id) => s + allocPct(id), 0) / 100;
        let T: number;
        if (plugIds.length === 0) {
          T = driverTotal + keepSum;
        } else if (plugAllocSumPct >= 1 - 1e-6) {
          T = driverTotal / (driverAllocSum / 100);
        } else {
          T = (driverTotal + keepSum) / (1 - plugAllocSumPct);
        }
        const pctOfParentTotal = T * pctOfParentPctSum;
        for (const b of breakdownList) {
          if (driverIds.has(b.id)) continue;
          if (pctOfParentIds.has(b.id)) {
            const pt = (config.items[b.id]?.inputs as PctOfTotalInputs) ?? {};
            result[b.id][year] = T * ((pt.pctOfTotal ?? 0) / 100);
          }
        }
        if (plugIds.length === 1) {
          result[plugIds[0]][year] = T - driverTotal - keepSum - pctOfParentTotal;
        } else if (plugIds.length > 1) {
          const remainder = T - driverTotal - keepSum - pctOfParentTotal;
          const scale = plugAllocSumPct > 1e-6 ? remainder / plugAllocSumPct : remainder / plugIds.length;
          for (const id of plugIds) {
            result[id][year] = scale * (allocPct(id) / 100);
          }
        }
        result[streamRow.id][year] = T;
      }
    }
  }

  // Second pass: stream total = sum of breakdowns for every stream with breakdowns (B2 already set values when driver alloc % was set)
  for (const streamRow of rev.children ?? []) {
    const breakdownList = config.breakdowns?.[streamRow.id] ?? [];
    if (breakdownList.length === 0) continue;
    for (const year of projectionYears) {
      let sum = 0;
      breakdownList.forEach((b) => { sum += result[b.id]?.[year] ?? 0; });
      result[streamRow.id][year] = sum;
    }
  }
  for (let i = 0; i < projectionYears.length; i++) {
    const year = projectionYears[i];
    let totalRevenue = 0;
    for (const sid of streamIds) {
      totalRevenue += result[sid]?.[year] ?? 0;
    }
    result["rev"][year] = totalRevenue;
  }

  // All item ids that can have pct_of_total: streams + every breakdown
  const allItemIds = new Set<string>([...streamIds]);
  for (const breakdownList of Object.values(config.breakdowns ?? {})) {
    for (const b of breakdownList) {
      allItemIds.add(b.id);
    }
  }

  // Parent stream id for each breakdown (so we can skip pct_of_total of parent in Third pass — already set in B2)
  const breakdownParentId: Record<string, string> = {};
  for (const streamId of streamIds) {
    for (const b of config.breakdowns?.[streamId] ?? []) {
      breakdownParentId[b.id] = streamId;
    }
  }

  // Third pass: apply pct_of_total (reference = Total Revenue or a stream). Skip breakdowns whose reference is their parent (set in B2).
  for (let i = 0; i < projectionYears.length; i++) {
    const year = projectionYears[i];
    for (const itemId of allItemIds) {
      const itemConfig = config.items[itemId];
      if (itemConfig?.method !== "pct_of_total") continue;
      const pt = itemConfig.inputs as PctOfTotalInputs;
      const refId = pt.referenceId ?? "rev";
      if (breakdownParentId[itemId] === refId) continue;
      const refTotal = result[refId]?.[year] ?? 0;
      result[itemId][year] = refTotal * ((pt.pctOfTotal ?? 0) / 100);
    }
  }

  // Fourth pass: recompute streams with breakdowns. If stream has pct_of_total of self but was not set in B2 (no driver or driver % not set), solve T so that pct_of_parent = T × method % and total = T.
  for (const streamRow of rev.children ?? []) {
    const breakdownList = config.breakdowns?.[streamRow.id] ?? [];
    if (breakdownList.length === 0) continue;
    const pctOfParentHere = breakdownList.filter((b) => {
      const cfg = config.items[b.id];
      return cfg?.method === "pct_of_total" && ((cfg.inputs as PctOfTotalInputs).referenceId ?? "rev") === streamRow.id;
    });
    const pctOfParentSumHere = pctOfParentHere.reduce(
      (s, b) => s + ((config.items[b.id]?.inputs as PctOfTotalInputs)?.pctOfTotal ?? 0) / 100,
      0
    );

    for (const year of projectionYears) {
      if (pctOfParentHere.length > 0 && pctOfParentSumHere < 1) {
        const otherSum = breakdownList
          .filter((b) => !pctOfParentHere.some((p) => p.id === b.id))
          .reduce((s, b) => s + (result[b.id]?.[year] ?? 0), 0);
        const T = otherSum / (1 - pctOfParentSumHere);
        result[streamRow.id][year] = T;
        for (const b of pctOfParentHere) {
          const pt = (config.items[b.id]?.inputs as PctOfTotalInputs) ?? {};
          result[b.id][year] = T * ((pt.pctOfTotal ?? 0) / 100);
        }
      } else {
        let sum = 0;
        breakdownList.forEach((b) => { sum += result[b.id]?.[year] ?? 0; });
        result[streamRow.id][year] = sum;
      }
    }
  }
  for (let i = 0; i < projectionYears.length; i++) {
    const year = projectionYears[i];
    let totalRevenue = 0;
    for (const sid of streamIds) {
      totalRevenue += result[sid]?.[year] ?? 0;
    }
    result["rev"][year] = totalRevenue;
  }

  // Final pass: ensure product_line/channel sub-rows sum to parent (scale to final total per year)
  for (const streamRow of rev.children ?? []) {
    const breakdownList = config.breakdowns?.[streamRow.id] ?? [];
    const toCheck = streamsWithBreakdowns.has(streamRow.id)
      ? breakdownList
      : [{ id: streamRow.id, label: streamRow.label }];
    for (const b of toCheck) {
      const cfg = config.items[b.id];
      const method = cfg?.method;
      const pl = cfg?.inputs as ProductLineInputs | undefined;
      if ((method !== "product_line" && method !== "channel") || !pl?.items?.length) continue;
      const items = pl.items;
      const n = items.length;
      for (let y = 0; y < projectionYears.length; y++) {
        const year = projectionYears[y];
        const total = result[b.id]?.[year] ?? 0;
        let denom = 0;
        for (const it of items) {
          const share = (it.sharePercent ?? (n ? 100 / n : 0)) / 100;
          const g = (it.growthPercent ?? 0) / 100;
          denom += share * Math.pow(1 + g, y);
        }
        if (denom < 1e-9) continue;
        items.forEach((it, idx) => {
          const raw = it.id ?? (it as { label?: string }).label;
          const lineKey = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${idx}`;
          const subId = `${b.id}::${lineKey}`;
          if (!result[subId]) result[subId] = {};
          const share = (it.sharePercent ?? (n ? 100 / n : 0)) / 100;
          const g = (it.growthPercent ?? 0) / 100;
          result[subId][year] = total * (share * Math.pow(1 + g, y)) / denom;
        });
      }
    }
  }

  return result;
}
