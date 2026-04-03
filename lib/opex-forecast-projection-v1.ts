import type { Row } from "@/types/finance";
import type { GrowthStartingBasisV1 } from "@/types/revenue-forecast-v1";
import type { OpExDirectForecastMethodV1, OpExForecastLineConfigV1 } from "@/types/opex-forecast-v1";
import { computeRowValue } from "@/lib/calculations";
import { resolveCogsPctOfRevenueByYear } from "@/lib/cogs-forecast-v1";
import { resolveGrowthRatesByYear, validateGrowthPhases } from "@/lib/revenue-growth-phases-v1";
import type { GrowthPhaseV1 } from "@/lib/revenue-growth-phases-v1";

function findRowInTree(rows: Row[], id: string): Row | null {
  for (const r of rows) {
    if (r.id === id) return r;
    if (r.children?.length) {
      const f = findRowInTree(r.children, id);
      if (f) return f;
    }
  }
  return null;
}

export function getOpExLineLastHistoricalValue(
  lineId: string,
  incomeStatement: Row[],
  lastHistoricYear: string,
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] },
  sbcBreakdowns: Record<string, Record<string, number>>,
  danaBreakdowns: Record<string, number>
): number | null {
  if (!lastHistoricYear) return null;
  const row = findRowInTree(incomeStatement, lineId);
  if (!row) return null;
  const v = computeRowValue(row, lastHistoricYear, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns);
  if (typeof v !== "number" || Number.isNaN(v)) return null;
  return v;
}

function growthPriorForYear(
  yearIndex: number,
  projectionYears: string[],
  accumulated: Record<string, number>,
  params: Record<string, unknown>,
  lastHistValue: number | null
): number | null {
  if (yearIndex > 0) {
    const py = projectionYears[yearIndex - 1];
    const p = accumulated[py];
    return p != null && Number.isFinite(p) ? p : null;
  }
  const basis = params.startingBasis as GrowthStartingBasisV1 | undefined;
  const startingAmount = Number(params.startingAmount);
  if (basis === "starting_amount" && Number.isFinite(startingAmount)) return startingAmount;
  if (lastHistValue != null && Number.isFinite(lastHistValue)) return lastHistValue;
  if (Number.isFinite(startingAmount)) return startingAmount;
  return null;
}

/**
 * Project a single OpEx line for forecast years. Returns empty when incomplete / wrong route.
 */
export function projectOpExLineForecastByYear(
  cfg: OpExForecastLineConfigV1 | undefined,
  opts: {
    projectionYears: string[];
    revenueTotalByYear: Record<string, number>;
    lastHistValue: number | null;
  }
): Record<string, number> {
  const { projectionYears, revenueTotalByYear, lastHistValue } = opts;
  if (!cfg || cfg.routeStatus !== "forecast_direct") return {};
  const method = cfg.forecastMethod as OpExDirectForecastMethodV1 | undefined;
  if (!method) return {};
  const params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = {};

  if (method === "pct_of_revenue") {
    const pctByY = resolveCogsPctOfRevenueByYear(params, projectionYears);
    if (Object.keys(pctByY).length === 0) return {};
    for (const y of projectionYears) {
      const rev = revenueTotalByYear[y];
      const pct = pctByY[y];
      if (!Number.isFinite(rev) || rev === 0 || pct == null || !Number.isFinite(pct)) continue;
      out[y] = rev * (pct / 100);
    }
    return out;
  }

  if (method === "growth_percent") {
    const resolvedRates = resolveGrowthRatesByYear(params, projectionYears);
    const acc: Record<string, number> = {};
    for (let i = 0; i < projectionYears.length; i++) {
      const y = projectionYears[i]!;
      const prior = growthPriorForYear(i, projectionYears, acc, params, lastHistValue);
      if (prior === null) return {};
      const pct =
        resolvedRates?.[y] != null && Number.isFinite(Number(resolvedRates[y]))
          ? Number(resolvedRates[y])
          : Number(params.ratePercent) ?? 0;
      acc[y] = prior * (1 + pct / 100);
    }
    return acc;
  }

  if (method === "flat_value") {
    const v = Number((params as { value?: number }).value);
    if (!Number.isFinite(v)) return {};
    for (const y of projectionYears) out[y] = v;
    return out;
  }

  if (method === "manual_by_year") {
    const by = (params as { valuesByYear?: Record<string, number> }).valuesByYear ?? {};
    for (const y of projectionYears) {
      const n = by[y];
      if (n != null && Number.isFinite(Number(n))) out[y] = Number(n);
    }
    return Object.keys(out).length > 0 ? out : {};
  }

  return {};
}

export function sumOpExDirectForecastsByYear(
  lineConfigs: OpExForecastLineConfigV1[],
  projectLine: (cfg: OpExForecastLineConfigV1) => Record<string, number>
): Record<string, number | null> {
  const years = new Set<string>();
  for (const cfg of lineConfigs) {
    const o = projectLine(cfg);
    for (const y of Object.keys(o)) years.add(y);
  }
  const out: Record<string, number | null> = {};
  for (const y of years) {
    let sum = 0;
    let has = false;
    for (const cfg of lineConfigs) {
      const o = projectLine(cfg);
      const v = o[y];
      if (v != null && Number.isFinite(v)) {
        sum += v;
        has = true;
      }
    }
    out[y] = has ? sum : null;
  }
  return out;
}

export function hasPersistedOpExPctOfRevenue(
  cfg: OpExForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  if (cfg?.forecastMethod !== "pct_of_revenue") return false;
  const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const pType = (p.growthPatternType as string | undefined) ?? "constant";
  if (pType === "by_year") {
    const by = (p.pctsByYear ?? {}) as Record<string, number>;
    if (projectionYears.length === 0) return Object.keys(by).length > 0;
    return projectionYears.some((y) => {
      const v = by[y];
      return v != null && Number.isFinite(Number(v));
    });
  }
  if (pType === "phases") {
    const raw = Array.isArray(p.growthPhases) ? (p.growthPhases as GrowthPhaseV1[]) : [];
    return raw.some(
      (ph) =>
        String(ph.startYear ?? "").trim() &&
        String(ph.endYear ?? "").trim() &&
        ph.ratePercent != null &&
        Number.isFinite(Number(ph.ratePercent))
    );
  }
  return p.pct != null && Number.isFinite(Number(p.pct));
}

export function hasPersistedOpExGrowthPercent(
  cfg: OpExForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  if (cfg?.forecastMethod !== "growth_percent") return false;
  const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const pType = (p.growthPatternType as string | undefined) ?? "constant";
  if (pType === "by_year") {
    const by = (p.ratesByYear ?? {}) as Record<string, number>;
    if (projectionYears.length === 0) return Object.keys(by).length > 0;
    return projectionYears.every(
      (y) => by[y] != null && Number.isFinite(Number(by[y]))
    );
  }
  if (pType === "phases") {
    const raw = Array.isArray(p.growthPhases) ? (p.growthPhases as GrowthPhaseV1[]) : [];
    const { ok } = validateGrowthPhases(raw, projectionYears);
    return ok && raw.length > 0;
  }
  return p.ratePercent != null && Number.isFinite(Number(p.ratePercent));
}

export function hasPersistedOpExFlatValue(cfg: OpExForecastLineConfigV1 | undefined): boolean {
  if (cfg?.forecastMethod !== "flat_value") return false;
  const p = (cfg.forecastParameters ?? {}) as { value?: number };
  return p.value != null && Number.isFinite(Number(p.value));
}

export function hasPersistedOpExManualByYear(
  cfg: OpExForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  if (cfg?.forecastMethod !== "manual_by_year") return false;
  const p = (cfg.forecastParameters ?? {}) as { valuesByYear?: Record<string, number> };
  const by = p.valuesByYear ?? {};
  if (projectionYears.length === 0) return Object.keys(by).length > 0;
  return projectionYears.every((y) => {
    const v = by[y];
    return v != null && Number.isFinite(Number(v));
  });
}

export function hasPersistedOpExDirectForecast(
  cfg: OpExForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  if (!cfg || cfg.routeStatus !== "forecast_direct") return false;
  return (
    hasPersistedOpExPctOfRevenue(cfg, projectionYears) ||
    hasPersistedOpExGrowthPercent(cfg, projectionYears) ||
    hasPersistedOpExFlatValue(cfg) ||
    hasPersistedOpExManualByYear(cfg, projectionYears)
  );
}
