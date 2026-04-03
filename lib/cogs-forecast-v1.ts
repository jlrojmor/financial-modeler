import type { CogsForecastLineConfigV1 } from "@/types/cogs-forecast-v1";
import type {
  RevenueForecastConfigV1,
  RevenueForecastMethodV1,
  ForecastRevenueNodeV1,
  RevenueForecastRoleV1,
} from "@/types/revenue-forecast-v1";
import { buildForecastRevenueParentIdMap } from "@/lib/revenue-forecast-tree-v1";
import { expandPhasesToRatesByYear, validateGrowthPhases, type GrowthPhaseV1 } from "@/lib/revenue-growth-phases-v1";
import {
  getArpuAnnualizationMultiplier,
  getRevenuePerLocationAnnualizationMultiplier,
  resolveArpuBasisFromParams,
  resolveRevenuePerLocationBasisFromParams,
  resolveYieldBasisFromParams,
} from "@/lib/revenue-projection-engine-v1";

/** Stable fingerprint for preview memos when nested line configs change. */
export function getCogsForecastConfigLinesFingerprint(
  config: { lines?: Record<string, CogsForecastLineConfigV1> } | undefined
): string {
  return JSON.stringify(config?.lines ?? {});
}

/** True when the line has an applied % of revenue config (not merge metadata alone). */
export function hasPersistedCogsPctConfig(
  cfg: CogsForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  if (!cfg?.forecastMethod || cfg.forecastMethod !== "pct_of_revenue") return false;
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
    if (raw.length === 0) return false;
    return raw.some(
      (ph) =>
        String(ph.startYear ?? "").trim() !== "" &&
        String(ph.endYear ?? "").trim() !== "" &&
        ph.ratePercent != null &&
        Number.isFinite(Number(ph.ratePercent))
    );
  }
  return p.pct != null && Number.isFinite(Number(p.pct));
}

/** True when the line has an applied cost per unit config. */
export function hasPersistedCogsCpuConfig(
  cfg: CogsForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  if (!cfg?.forecastMethod || cfg.forecastMethod !== "cost_per_unit") return false;
  const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const start = Number(p.startingCostPerUnit);
  if (!Number.isFinite(start) || start <= 0) return false;
  const pType = (p.growthPatternType as string | undefined) ?? "constant";
  if (pType === "by_year") {
    const by = (p.costPerUnitRatesByYear ?? {}) as Record<string, number>;
    if (projectionYears.length === 0) return Object.keys(by).length > 0;
    return projectionYears.some((y) => {
      const v = by[y];
      return v != null && Number.isFinite(Number(v));
    });
  }
  if (pType === "phases") {
    const raw = Array.isArray(p.costPerUnitGrowthPhases)
      ? (p.costPerUnitGrowthPhases as GrowthPhaseV1[])
      : [];
    if (raw.length === 0) return false;
    return raw.some(
      (ph) =>
        String(ph.startYear ?? "").trim() !== "" &&
        String(ph.endYear ?? "").trim() !== "" &&
        ph.ratePercent != null &&
        Number.isFinite(Number(ph.ratePercent))
    );
  }
  return p.costPerUnitRatePercent != null && Number.isFinite(Number(p.costPerUnitRatePercent));
}

/** True when the line has an applied cost per customer config. */
export function hasPersistedCogsCpcConfig(
  cfg: CogsForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  if (!cfg?.forecastMethod || cfg.forecastMethod !== "cost_per_customer") return false;
  const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const start = Number(p.startingCostPerCustomer);
  if (!Number.isFinite(start) || start <= 0) return false;
  const pType = (p.growthPatternType as string | undefined) ?? "constant";
  if (pType === "by_year") {
    const by = (p.costPerCustomerRatesByYear ?? {}) as Record<string, number>;
    if (projectionYears.length === 0) return Object.keys(by).length > 0;
    return projectionYears.some((y) => {
      const v = by[y];
      return v != null && Number.isFinite(Number(v));
    });
  }
  if (pType === "phases") {
    const raw = Array.isArray(p.costPerCustomerGrowthPhases)
      ? (p.costPerCustomerGrowthPhases as GrowthPhaseV1[])
      : [];
    if (raw.length === 0) return false;
    return raw.some(
      (ph) =>
        String(ph.startYear ?? "").trim() !== "" &&
        String(ph.endYear ?? "").trim() !== "" &&
        ph.ratePercent != null &&
        Number.isFinite(Number(ph.ratePercent))
    );
  }
  return p.costPerCustomerRatePercent != null && Number.isFinite(Number(p.costPerCustomerRatePercent));
}

/** True when the line has an applied cost per contract config. */
export function hasPersistedCogsCptConfig(
  cfg: CogsForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  if (!cfg?.forecastMethod || cfg.forecastMethod !== "cost_per_contract") return false;
  const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const start = Number(p.startingCostPerContract);
  if (!Number.isFinite(start) || start <= 0) return false;
  const pType = (p.growthPatternType as string | undefined) ?? "constant";
  if (pType === "by_year") {
    const by = (p.costPerContractRatesByYear ?? {}) as Record<string, number>;
    if (projectionYears.length === 0) return Object.keys(by).length > 0;
    return projectionYears.some((y) => {
      const v = by[y];
      return v != null && Number.isFinite(Number(v));
    });
  }
  if (pType === "phases") {
    const raw = Array.isArray(p.costPerContractGrowthPhases)
      ? (p.costPerContractGrowthPhases as GrowthPhaseV1[])
      : [];
    if (raw.length === 0) return false;
    return raw.some(
      (ph) =>
        String(ph.startYear ?? "").trim() !== "" &&
        String(ph.endYear ?? "").trim() !== "" &&
        ph.ratePercent != null &&
        Number.isFinite(Number(ph.ratePercent))
    );
  }
  return p.costPerContractRatePercent != null && Number.isFinite(Number(p.costPerContractRatePercent));
}

/** True when the line has an applied cost per location config. */
export function hasPersistedCogsCplConfig(
  cfg: CogsForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  if (!cfg?.forecastMethod || cfg.forecastMethod !== "cost_per_location") return false;
  const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const start = Number(p.startingCostPerLocation);
  if (!Number.isFinite(start) || start <= 0) return false;
  const pType = (p.growthPatternType as string | undefined) ?? "constant";
  if (pType === "by_year") {
    const by = (p.costPerLocationRatesByYear ?? {}) as Record<string, number>;
    if (projectionYears.length === 0) return Object.keys(by).length > 0;
    return projectionYears.some((y) => {
      const v = by[y];
      return v != null && Number.isFinite(Number(v));
    });
  }
  if (pType === "phases") {
    const raw = Array.isArray(p.costPerLocationGrowthPhases)
      ? (p.costPerLocationGrowthPhases as GrowthPhaseV1[])
      : [];
    if (raw.length === 0) return false;
    return raw.some(
      (ph) =>
        String(ph.startYear ?? "").trim() !== "" &&
        String(ph.endYear ?? "").trim() !== "" &&
        ph.ratePercent != null &&
        Number.isFinite(Number(ph.ratePercent))
    );
  }
  return p.costPerLocationRatePercent != null && Number.isFinite(Number(p.costPerLocationRatePercent));
}

/** True when the line has an applied cost per utilized unit config. */
export function hasPersistedCogsCpuuConfig(
  cfg: CogsForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  if (!cfg?.forecastMethod || cfg.forecastMethod !== "cost_per_utilized_unit") return false;
  const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const start = Number(p.startingCostPerUtilizedUnit);
  if (!Number.isFinite(start) || start <= 0) return false;
  const pType = (p.growthPatternType as string | undefined) ?? "constant";
  if (pType === "by_year") {
    const by = (p.costPerUtilizedUnitRatesByYear ?? {}) as Record<string, number>;
    if (projectionYears.length === 0) return Object.keys(by).length > 0;
    return projectionYears.some((y) => {
      const v = by[y];
      return v != null && Number.isFinite(Number(v));
    });
  }
  if (pType === "phases") {
    const raw = Array.isArray(p.costPerUtilizedUnitGrowthPhases)
      ? (p.costPerUtilizedUnitGrowthPhases as GrowthPhaseV1[])
      : [];
    if (raw.length === 0) return false;
    return raw.some(
      (ph) =>
        String(ph.startYear ?? "").trim() !== "" &&
        String(ph.endYear ?? "").trim() !== "" &&
        ph.ratePercent != null &&
        Number.isFinite(Number(ph.ratePercent))
    );
  }
  return p.costPerUtilizedUnitRatePercent != null && Number.isFinite(Number(p.costPerUtilizedUnitRatePercent));
}

export function hasPersistedCogsLineForecast(
  cfg: CogsForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  return (
    hasPersistedCogsPctConfig(cfg, projectionYears) ||
    hasPersistedCogsCpuConfig(cfg, projectionYears) ||
    hasPersistedCogsCpcConfig(cfg, projectionYears) ||
    hasPersistedCogsCptConfig(cfg, projectionYears) ||
    hasPersistedCogsCplConfig(cfg, projectionYears) ||
    hasPersistedCogsCpuuConfig(cfg, projectionYears)
  );
}

/**
 * Map each projection year → COGS % of revenue (0–100) from % of Revenue forecast parameters.
 * Contract: matches what the COGS builder saves (pct, pctsByYear, growthPhases), not revenue growth_rate (ratesByYear, ratePercent).
 */
export function resolveCogsPctOfRevenueByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> {
  if (projectionYears.length === 0) return {};
  const pType = (params.growthPatternType as string | undefined) ?? "constant";

  if (pType === "phases") {
    const raw = params.growthPhases;
    if (!Array.isArray(raw) || raw.length === 0) return {};
    const phases: GrowthPhaseV1[] = raw.map((x: unknown) => {
      const o = x as Record<string, unknown>;
      return {
        startYear: String(o.startYear ?? ""),
        endYear: String(o.endYear ?? ""),
        ratePercent: Number(o.ratePercent),
      };
    });
    const { ok } = validateGrowthPhases(phases, projectionYears);
    if (!ok) return {};
    return expandPhasesToRatesByYear(phases, projectionYears);
  }

  if (pType === "by_year") {
    const pby = params.pctsByYear as Record<string, number> | undefined;
    if (!pby || typeof pby !== "object") return {};
    const out: Record<string, number> = {};
    for (const y of projectionYears) {
      const v = pby[y];
      if (v != null && Number.isFinite(Number(v))) out[y] = Number(v);
    }
    return out;
  }

  const pct = Number(params.pct);
  if (!Number.isFinite(pct)) return {};
  const out: Record<string, number> = {};
  for (const y of projectionYears) out[y] = pct;
  return out;
}

/**
 * YoY % growth on cost per unit per projection year (builder keys: costPerUnit*).
 * Mirrors `resolveCogsPctOfRevenueByYear` discipline for phases / by_year / constant.
 */
export function resolveCogsCostPerUnitGrowthPctByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> {
  if (projectionYears.length === 0) return {};
  const pType = (params.growthPatternType as string | undefined) ?? "constant";

  if (pType === "phases") {
    const raw = params.costPerUnitGrowthPhases;
    if (!Array.isArray(raw) || raw.length === 0) return {};
    const phases: GrowthPhaseV1[] = raw.map((x: unknown) => {
      const o = x as Record<string, unknown>;
      return {
        startYear: String(o.startYear ?? ""),
        endYear: String(o.endYear ?? ""),
        ratePercent: Number(o.ratePercent),
      };
    });
    const { ok } = validateGrowthPhases(phases, projectionYears);
    if (!ok) return {};
    return expandPhasesToRatesByYear(phases, projectionYears);
  }

  if (pType === "by_year") {
    const pby = params.costPerUnitRatesByYear as Record<string, number> | undefined;
    if (!pby || typeof pby !== "object") return {};
    const out: Record<string, number> = {};
    for (const y of projectionYears) {
      const v = pby[y];
      if (v != null && Number.isFinite(Number(v))) out[y] = Number(v);
    }
    return out;
  }

  const pct = Number(params.costPerUnitRatePercent);
  if (!Number.isFinite(pct)) return {};
  const out: Record<string, number> = {};
  for (const y of projectionYears) out[y] = pct;
  return out;
}

/** Compounded cost per unit by year: CPU_t = CPU_{t-1} × (1 + g_t/100), CPU_0 = startingCostPerUnit before first forecast year step. */
export function projectCostPerUnitByYear(
  startingCostPerUnit: number,
  growthPctByYear: Record<string, number>,
  projectionYears: string[]
): Record<string, number> {
  let prev = startingCostPerUnit;
  const out: Record<string, number> = {};
  for (const y of projectionYears) {
    const g = growthPctByYear[y];
    const pct = g != null && Number.isFinite(Number(g)) ? Number(g) : 0;
    const next = prev * (1 + pct / 100);
    out[y] = next;
    prev = next;
  }
  return out;
}

/**
 * YoY % growth on cost per customer per projection year (builder keys: costPerCustomer*).
 * Mirrors `resolveCogsCostPerUnitGrowthPctByYear` for the parallel COGS method.
 */
export function resolveCogsCostPerCustomerGrowthPctByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> {
  if (projectionYears.length === 0) return {};
  const pType = (params.growthPatternType as string | undefined) ?? "constant";

  if (pType === "phases") {
    const raw = params.costPerCustomerGrowthPhases;
    if (!Array.isArray(raw) || raw.length === 0) return {};
    const phases: GrowthPhaseV1[] = raw.map((x: unknown) => {
      const o = x as Record<string, unknown>;
      return {
        startYear: String(o.startYear ?? ""),
        endYear: String(o.endYear ?? ""),
        ratePercent: Number(o.ratePercent),
      };
    });
    const { ok } = validateGrowthPhases(phases, projectionYears);
    if (!ok) return {};
    return expandPhasesToRatesByYear(phases, projectionYears);
  }

  if (pType === "by_year") {
    const pby = params.costPerCustomerRatesByYear as Record<string, number> | undefined;
    if (!pby || typeof pby !== "object") return {};
    const out: Record<string, number> = {};
    for (const y of projectionYears) {
      const v = pby[y];
      if (v != null && Number.isFinite(Number(v))) out[y] = Number(v);
    }
    return out;
  }

  const pct = Number(params.costPerCustomerRatePercent);
  if (!Number.isFinite(pct)) return {};
  const out: Record<string, number> = {};
  for (const y of projectionYears) out[y] = pct;
  return out;
}

/** Compounded cost per customer by year (same compounding as cost per unit). */
export function projectCostPerCustomerByYear(
  startingCostPerCustomer: number,
  growthPctByYear: Record<string, number>,
  projectionYears: string[]
): Record<string, number> {
  return projectCostPerUnitByYear(startingCostPerCustomer, growthPctByYear, projectionYears);
}

export type CostPerCustomerBasisV1 = "monthly" | "annual";

/** Read stored cost-per-customer basis; default annual for legacy configs. */
export function parseCostPerCustomerBasisFromParams(
  params: Record<string, unknown> | undefined | null
): CostPerCustomerBasisV1 {
  if (!params || typeof params !== "object") return "annual";
  return params.costPerCustomerBasis === "monthly" ? "monthly" : "annual";
}

/**
 * Convert stored starting cost to **annual** $/customer before growth compounding.
 * Revenue in this path uses annualized ARPU × customers; COGS must use matching annual $/customer.
 */
export function startingCostPerCustomerStoredToAnnual(
  startingStored: number,
  basis: CostPerCustomerBasisV1
): number {
  if (!Number.isFinite(startingStored) || startingStored <= 0) return NaN;
  return basis === "monthly" ? startingStored * 12 : startingStored;
}

/** COGS_y = volume_y × costPerUnit_y; volume from Price × Volume driver path only. */
export function computeCogsCostPerUnitForecastByYear(
  cogsParams: Record<string, unknown>,
  volumeByYear: Record<string, number> | null | undefined,
  projectionYears: string[]
): Record<string, number> {
  if (!volumeByYear || projectionYears.length === 0) return {};
  const start = Number(cogsParams.startingCostPerUnit);
  if (!Number.isFinite(start) || start <= 0) return {};
  const growth = resolveCogsCostPerUnitGrowthPctByYear(cogsParams, projectionYears);
  if (Object.keys(growth).length === 0) return {};
  const cpuByY = projectCostPerUnitByYear(start, growth, projectionYears);
  const out: Record<string, number> = {};
  for (const y of projectionYears) {
    const v = volumeByYear[y];
    const c = cpuByY[y];
    if (v != null && Number.isFinite(v) && c != null && Number.isFinite(c)) {
      out[y] = v * c;
    }
  }
  return out;
}

/** COGS_y = customers_y × costPerCustomer_y; customers from linked Customers × ARPU driver path only. */
export function computeCogsCostPerCustomerForecastByYear(
  cogsParams: Record<string, unknown>,
  customersByYear: Record<string, number> | null | undefined,
  projectionYears: string[]
): Record<string, number> {
  if (!customersByYear || projectionYears.length === 0) return {};
  const basis = parseCostPerCustomerBasisFromParams(cogsParams);
  const startStored = Number(cogsParams.startingCostPerCustomer);
  const start = startingCostPerCustomerStoredToAnnual(startStored, basis);
  if (!Number.isFinite(start) || start <= 0) return {};
  const growth = resolveCogsCostPerCustomerGrowthPctByYear(cogsParams, projectionYears);
  if (Object.keys(growth).length === 0) return {};
  const cpcByY = projectCostPerCustomerByYear(start, growth, projectionYears);
  const out: Record<string, number> = {};
  for (const y of projectionYears) {
    const cust = customersByYear[y];
    const c = cpcByY[y];
    if (cust != null && Number.isFinite(cust) && c != null && Number.isFinite(c)) {
      out[y] = cust * c;
    }
  }
  return out;
}

/**
 * YoY % growth on cost per contract per projection year (builder keys: costPerContract*).
 */
export function resolveCogsCostPerContractGrowthPctByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> {
  if (projectionYears.length === 0) return {};
  const pType = (params.growthPatternType as string | undefined) ?? "constant";

  if (pType === "phases") {
    const raw = params.costPerContractGrowthPhases;
    if (!Array.isArray(raw) || raw.length === 0) return {};
    const phases: GrowthPhaseV1[] = raw.map((x: unknown) => {
      const o = x as Record<string, unknown>;
      return {
        startYear: String(o.startYear ?? ""),
        endYear: String(o.endYear ?? ""),
        ratePercent: Number(o.ratePercent),
      };
    });
    const { ok } = validateGrowthPhases(phases, projectionYears);
    if (!ok) return {};
    return expandPhasesToRatesByYear(phases, projectionYears);
  }

  if (pType === "by_year") {
    const pby = params.costPerContractRatesByYear as Record<string, number> | undefined;
    if (!pby || typeof pby !== "object") return {};
    const out: Record<string, number> = {};
    for (const y of projectionYears) {
      const v = pby[y];
      if (v != null && Number.isFinite(Number(v))) out[y] = Number(v);
    }
    return out;
  }

  const pct = Number(params.costPerContractRatePercent);
  if (!Number.isFinite(pct)) return {};
  const out: Record<string, number> = {};
  for (const y of projectionYears) out[y] = pct;
  return out;
}

export function projectCostPerContractByYear(
  startingCostPerContract: number,
  growthPctByYear: Record<string, number>,
  projectionYears: string[]
): Record<string, number> {
  return projectCostPerUnitByYear(startingCostPerContract, growthPctByYear, projectionYears);
}

/** COGS_y = contracts_y × costPerContract_y; contracts from linked Contracts × ACV driver path only. */
export function computeCogsCostPerContractForecastByYear(
  cogsParams: Record<string, unknown>,
  contractsByYear: Record<string, number> | null | undefined,
  projectionYears: string[]
): Record<string, number> {
  if (!contractsByYear || projectionYears.length === 0) return {};
  const start = Number(cogsParams.startingCostPerContract);
  if (!Number.isFinite(start) || start <= 0) return {};
  const growth = resolveCogsCostPerContractGrowthPctByYear(cogsParams, projectionYears);
  if (Object.keys(growth).length === 0) return {};
  const cptByY = projectCostPerContractByYear(start, growth, projectionYears);
  const out: Record<string, number> = {};
  for (const y of projectionYears) {
    const n = contractsByYear[y];
    const c = cptByY[y];
    if (n != null && Number.isFinite(n) && c != null && Number.isFinite(c)) {
      out[y] = n * c;
    }
  }
  return out;
}

/**
 * YoY % growth on cost per location per projection year (builder keys: costPerLocation*).
 */
export function resolveCogsCostPerLocationGrowthPctByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> {
  if (projectionYears.length === 0) return {};
  const pType = (params.growthPatternType as string | undefined) ?? "constant";

  if (pType === "phases") {
    const raw = params.costPerLocationGrowthPhases;
    if (!Array.isArray(raw) || raw.length === 0) return {};
    const phases: GrowthPhaseV1[] = raw.map((x: unknown) => {
      const o = x as Record<string, unknown>;
      return {
        startYear: String(o.startYear ?? ""),
        endYear: String(o.endYear ?? ""),
        ratePercent: Number(o.ratePercent),
      };
    });
    const { ok } = validateGrowthPhases(phases, projectionYears);
    if (!ok) return {};
    return expandPhasesToRatesByYear(phases, projectionYears);
  }

  if (pType === "by_year") {
    const pby = params.costPerLocationRatesByYear as Record<string, number> | undefined;
    if (!pby || typeof pby !== "object") return {};
    const out: Record<string, number> = {};
    for (const y of projectionYears) {
      const v = pby[y];
      if (v != null && Number.isFinite(Number(v))) out[y] = Number(v);
    }
    return out;
  }

  const pct = Number(params.costPerLocationRatePercent);
  if (!Number.isFinite(pct)) return {};
  const out: Record<string, number> = {};
  for (const y of projectionYears) out[y] = pct;
  return out;
}

export function projectCostPerLocationByYear(
  startingCostPerLocation: number,
  growthPctByYear: Record<string, number>,
  projectionYears: string[]
): Record<string, number> {
  return projectCostPerUnitByYear(startingCostPerLocation, growthPctByYear, projectionYears);
}

/** COGS_y = locations_y × costPerLocation_y; locations from linked Locations × Revenue/Location driver path only. */
export function computeCogsCostPerLocationForecastByYear(
  cogsParams: Record<string, unknown>,
  locationsByYear: Record<string, number> | null | undefined,
  projectionYears: string[]
): Record<string, number> {
  if (!locationsByYear || projectionYears.length === 0) return {};
  const start = Number(cogsParams.startingCostPerLocation);
  if (!Number.isFinite(start) || start <= 0) return {};
  const growth = resolveCogsCostPerLocationGrowthPctByYear(cogsParams, projectionYears);
  if (Object.keys(growth).length === 0) return {};
  const cplByY = projectCostPerLocationByYear(start, growth, projectionYears);
  const out: Record<string, number> = {};
  for (const y of projectionYears) {
    const loc = locationsByYear[y];
    const c = cplByY[y];
    if (loc != null && Number.isFinite(loc) && c != null && Number.isFinite(c)) {
      out[y] = loc * c;
    }
  }
  return out;
}

/**
 * YoY % growth on cost per utilized unit per projection year (builder keys: costPerUtilizedUnit*).
 */
export function resolveCogsCostPerUtilizedUnitGrowthPctByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> {
  if (projectionYears.length === 0) return {};
  const pType = (params.growthPatternType as string | undefined) ?? "constant";

  if (pType === "phases") {
    const raw = params.costPerUtilizedUnitGrowthPhases;
    if (!Array.isArray(raw) || raw.length === 0) return {};
    const phases: GrowthPhaseV1[] = raw.map((x: unknown) => {
      const o = x as Record<string, unknown>;
      return {
        startYear: String(o.startYear ?? ""),
        endYear: String(o.endYear ?? ""),
        ratePercent: Number(o.ratePercent),
      };
    });
    const { ok } = validateGrowthPhases(phases, projectionYears);
    if (!ok) return {};
    return expandPhasesToRatesByYear(phases, projectionYears);
  }

  if (pType === "by_year") {
    const pby = params.costPerUtilizedUnitRatesByYear as Record<string, number> | undefined;
    if (!pby || typeof pby !== "object") return {};
    const out: Record<string, number> = {};
    for (const y of projectionYears) {
      const v = pby[y];
      if (v != null && Number.isFinite(Number(v))) out[y] = Number(v);
    }
    return out;
  }

  const pct = Number(params.costPerUtilizedUnitRatePercent);
  if (!Number.isFinite(pct)) return {};
  const out: Record<string, number> = {};
  for (const y of projectionYears) out[y] = pct;
  return out;
}

export function projectCostPerUtilizedUnitByYear(
  startingCostPerUtilizedUnit: number,
  growthPctByYear: Record<string, number>,
  projectionYears: string[]
): Record<string, number> {
  return projectCostPerUnitByYear(startingCostPerUtilizedUnit, growthPctByYear, projectionYears);
}

/** COGS_y = utilizedUnits_y × costPerUtilizedUnit_y; utilized units from linked Capacity × Utilization × Yield path only. */
export function computeCogsCostPerUtilizedUnitForecastByYear(
  cogsParams: Record<string, unknown>,
  utilizedUnitsByYear: Record<string, number> | null | undefined,
  projectionYears: string[]
): Record<string, number> {
  if (!utilizedUnitsByYear || projectionYears.length === 0) return {};
  const start = Number(cogsParams.startingCostPerUtilizedUnit);
  if (!Number.isFinite(start) || start <= 0) return {};
  const growth = resolveCogsCostPerUtilizedUnitGrowthPctByYear(cogsParams, projectionYears);
  if (Object.keys(growth).length === 0) return {};
  const cpuuByY = projectCostPerUtilizedUnitByYear(start, growth, projectionYears);
  const out: Record<string, number> = {};
  for (const y of projectionYears) {
    const u = utilizedUnitsByYear[y];
    const c = cpuuByY[y];
    if (u != null && Number.isFinite(u) && c != null && Number.isFinite(c)) {
      out[y] = u * c;
    }
  }
  return out;
}

export type CogsAiSuggestion =
  | "Cost per Unit"
  | "Cost per Customer"
  | "Cost per Contract"
  | "Cost per Location"
  | "Cost per Utilized Unit"
  | "% of Revenue";

export interface ForecastableCogsLine {
  lineId: string;
  linkedRevenueRowId: string;
  lineLabel: string;
  linkedRevenueMethod?: RevenueForecastMethodV1;
  depth: number;
  suggestion: CogsAiSuggestion;
  suggestionReason: string;
}

/**
 * Whether the linked revenue row should expose **Cost per Unit** in the COGS builder.
 * Source of truth: live `revenueForecastConfigV1.rows`, not `ForecastableCogsLine.linkedRevenueMethod`.
 * - `independent_driver` leaf: row's own `forecastMethod === "price_volume"`.
 * - `allocation_of_parent`: walk ancestors until an `independent_driver` row; CPU if that row is `price_volume`.
 */
export function revenueRowUsesPriceVolumeForCogsEligibility(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): boolean {
  const cfg = revenueCfg[rowId];
  if (!cfg) return false;
  const role = cfg.forecastRole as RevenueForecastRoleV1 | undefined;
  if (role === "independent_driver") {
    return cfg.forecastMethod === "price_volume";
  }
  if (role === "allocation_of_parent") {
    const parentById = buildForecastRevenueParentIdMap(revenueTree);
    let pid: string | null | undefined = parentById.get(rowId) ?? null;
    while (pid) {
      const p = revenueCfg[pid];
      if (p?.forecastRole === "independent_driver") {
        return p.forecastMethod === "price_volume";
      }
      pid = parentById.get(pid) ?? null;
    }
    return false;
  }
  return false;
}

/**
 * Whether the linked revenue row should expose **Cost per Customer** in the COGS builder.
 * Same ancestor-walk pattern as Price × Volume eligibility, for `customers_arpu`.
 */
export function revenueRowUsesCustomersArpuForCogsEligibility(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): boolean {
  const cfg = revenueCfg[rowId];
  if (!cfg) return false;
  const role = cfg.forecastRole as RevenueForecastRoleV1 | undefined;
  if (role === "independent_driver") {
    return cfg.forecastMethod === "customers_arpu";
  }
  if (role === "allocation_of_parent") {
    const parentById = buildForecastRevenueParentIdMap(revenueTree);
    let pid: string | null | undefined = parentById.get(rowId) ?? null;
    while (pid) {
      const p = revenueCfg[pid];
      if (p?.forecastRole === "independent_driver") {
        return p.forecastMethod === "customers_arpu";
      }
      pid = parentById.get(pid) ?? null;
    }
    return false;
  }
  return false;
}

/**
 * Whether the linked revenue row should expose **Cost per Contract** in the COGS builder.
 * Same ancestor-walk pattern, for `contracts_acv`.
 */
export function revenueRowUsesContractsAcvForCogsEligibility(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): boolean {
  const cfg = revenueCfg[rowId];
  if (!cfg) return false;
  const role = cfg.forecastRole as RevenueForecastRoleV1 | undefined;
  if (role === "independent_driver") {
    return cfg.forecastMethod === "contracts_acv";
  }
  if (role === "allocation_of_parent") {
    const parentById = buildForecastRevenueParentIdMap(revenueTree);
    let pid: string | null | undefined = parentById.get(rowId) ?? null;
    while (pid) {
      const p = revenueCfg[pid];
      if (p?.forecastRole === "independent_driver") {
        return p.forecastMethod === "contracts_acv";
      }
      pid = parentById.get(pid) ?? null;
    }
    return false;
  }
  return false;
}

/**
 * Whether the linked revenue row should expose **Cost per Location** in the COGS builder.
 * Same ancestor-walk pattern, for `locations_revenue_per_location`.
 */
export function revenueRowUsesLocationsRevenuePerLocationForCogsEligibility(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): boolean {
  const cfg = revenueCfg[rowId];
  if (!cfg) return false;
  const role = cfg.forecastRole as RevenueForecastRoleV1 | undefined;
  if (role === "independent_driver") {
    return cfg.forecastMethod === "locations_revenue_per_location";
  }
  if (role === "allocation_of_parent") {
    const parentById = buildForecastRevenueParentIdMap(revenueTree);
    let pid: string | null | undefined = parentById.get(rowId) ?? null;
    while (pid) {
      const p = revenueCfg[pid];
      if (p?.forecastRole === "independent_driver") {
        return p.forecastMethod === "locations_revenue_per_location";
      }
      pid = parentById.get(pid) ?? null;
    }
    return false;
  }
  return false;
}

/**
 * Whether the linked revenue row should expose **Cost per Utilized Unit** in the COGS builder.
 * Same ancestor-walk pattern, for `capacity_utilization_yield`.
 */
export function revenueRowUsesCapacityUtilizationYieldForCogsEligibility(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): boolean {
  const cfg = revenueCfg[rowId];
  if (!cfg) return false;
  const role = cfg.forecastRole as RevenueForecastRoleV1 | undefined;
  if (role === "independent_driver") {
    return cfg.forecastMethod === "capacity_utilization_yield";
  }
  if (role === "allocation_of_parent") {
    const parentById = buildForecastRevenueParentIdMap(revenueTree);
    let pid: string | null | undefined = parentById.get(rowId) ?? null;
    while (pid) {
      const p = revenueCfg[pid];
      if (p?.forecastRole === "independent_driver") {
        return p.forecastMethod === "capacity_utilization_yield";
      }
      pid = parentById.get(pid) ?? null;
    }
    return false;
  }
  return false;
}

/**
 * Revenue Contracts × ACV parameters for the linked row or nearest qualifying ancestor.
 */
export function resolveContractsAcvParamsForCogsLinkedRow(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): Record<string, unknown> | null {
  const cfg = revenueCfg[rowId];
  if (!cfg) return null;
  const role = cfg.forecastRole as RevenueForecastRoleV1 | undefined;

  let params: Record<string, unknown> | undefined;

  if (role === "independent_driver" && cfg.forecastMethod === "contracts_acv") {
    params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  } else if (role === "allocation_of_parent") {
    const parentById = buildForecastRevenueParentIdMap(revenueTree);
    let pid: string | null | undefined = parentById.get(rowId) ?? null;
    while (pid) {
      const p = revenueCfg[pid];
      if (p?.forecastRole === "independent_driver" && p.forecastMethod === "contracts_acv") {
        params = (p.forecastParameters ?? {}) as Record<string, unknown>;
        break;
      }
      pid = parentById.get(pid) ?? null;
    }
  }

  return params ?? null;
}

/**
 * Read-only Contracts × ACV starting drivers for COGS Cost per Contract context.
 * Implied starting revenue = contracts × ACV (annual contract value).
 */
export function resolveContractsAcvStartingDriversForCogsLinkedRow(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): {
  startingContracts: number;
  startingAcv: number;
  impliedStartingRevenue: number;
} | null {
  const params = resolveContractsAcvParamsForCogsLinkedRow(rowId, revenueCfg, revenueTree);
  if (!params) return null;
  const sc = Number(params.startingContracts);
  const sa = Number(params.startingAcv);
  if (!Number.isFinite(sc) || !Number.isFinite(sa) || sc <= 0 || sa <= 0) return null;
  const impliedStartingRevenue = sc * sa;
  return { startingContracts: sc, startingAcv: sa, impliedStartingRevenue };
}

/**
 * Revenue Locations × Revenue per Location parameters for the linked row or nearest qualifying ancestor.
 */
export function resolveLocationsRevenuePerLocationParamsForCogsLinkedRow(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): Record<string, unknown> | null {
  const cfg = revenueCfg[rowId];
  if (!cfg) return null;
  const role = cfg.forecastRole as RevenueForecastRoleV1 | undefined;

  let params: Record<string, unknown> | undefined;

  if (role === "independent_driver" && cfg.forecastMethod === "locations_revenue_per_location") {
    params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  } else if (role === "allocation_of_parent") {
    const parentById = buildForecastRevenueParentIdMap(revenueTree);
    let pid: string | null | undefined = parentById.get(rowId) ?? null;
    while (pid) {
      const p = revenueCfg[pid];
      if (p?.forecastRole === "independent_driver" && p.forecastMethod === "locations_revenue_per_location") {
        params = (p.forecastParameters ?? {}) as Record<string, unknown>;
        break;
      }
      pid = parentById.get(pid) ?? null;
    }
  }

  return params ?? null;
}

/**
 * Read-only Locations × Revenue per Location starting drivers for COGS Cost per Location context.
 * Implied starting revenue matches the revenue projection frame (annualized when basis is monthly).
 */
export function resolveLocationsRevenuePerLocationStartingDriversForCogsLinkedRow(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): {
  startingLocations: number;
  startingRevenuePerLocation: number;
  revenuePerLocationBasis: "monthly" | "annual";
  impliedStartingRevenue: number;
} | null {
  const params = resolveLocationsRevenuePerLocationParamsForCogsLinkedRow(rowId, revenueCfg, revenueTree);
  if (!params) return null;
  const sl = Number(params.startingLocations);
  const sr = Number(params.startingRevenuePerLocation);
  if (!Number.isFinite(sl) || !Number.isFinite(sr) || sl <= 0 || sr <= 0) return null;
  const revenuePerLocationBasis = resolveRevenuePerLocationBasisFromParams(params);
  const mult = getRevenuePerLocationAnnualizationMultiplier(params);
  const impliedStartingRevenue = sl * sr * mult;
  return { startingLocations: sl, startingRevenuePerLocation: sr, revenuePerLocationBasis, impliedStartingRevenue };
}

/**
 * Revenue Capacity × Utilization × Yield parameters for the linked row or nearest qualifying ancestor.
 */
export function resolveCapacityUtilizationYieldParamsForCogsLinkedRow(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): Record<string, unknown> | null {
  const cfg = revenueCfg[rowId];
  if (!cfg) return null;
  const role = cfg.forecastRole as RevenueForecastRoleV1 | undefined;

  let params: Record<string, unknown> | undefined;

  if (role === "independent_driver" && cfg.forecastMethod === "capacity_utilization_yield") {
    params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  } else if (role === "allocation_of_parent") {
    const parentById = buildForecastRevenueParentIdMap(revenueTree);
    let pid: string | null | undefined = parentById.get(rowId) ?? null;
    while (pid) {
      const p = revenueCfg[pid];
      if (p?.forecastRole === "independent_driver" && p.forecastMethod === "capacity_utilization_yield") {
        params = (p.forecastParameters ?? {}) as Record<string, unknown>;
        break;
      }
      pid = parentById.get(pid) ?? null;
    }
  }

  return params ?? null;
}

/**
 * Read-only Capacity × Utilization × Yield starting drivers for COGS Cost per Utilized Unit context.
 */
export function resolveCapacityUtilizationYieldStartingDriversForCogsLinkedRow(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): {
  startingCapacity: number;
  startingUtilizationPct: number;
  startingUtilizedUnits: number;
  startingYield: number;
  yieldBasis: "monthly" | "annual";
  impliedStartingRevenue: number;
  capacityUnitLabel?: string;
} | null {
  const params = resolveCapacityUtilizationYieldParamsForCogsLinkedRow(rowId, revenueCfg, revenueTree);
  if (!params) return null;
  const cap = Number(params.startingCapacity);
  const u0 = Number(params.startingUtilizationPct);
  const y0 = Number(params.startingYield);
  if (!Number.isFinite(cap) || !Number.isFinite(u0) || !Number.isFinite(y0) || cap <= 0 || y0 <= 0) return null;
  if (!Number.isFinite(u0) || u0 < 0 || u0 > 100) return null;
  const startingUtilizedUnits = cap * (u0 / 100);
  const yieldBasis = resolveYieldBasisFromParams(params);
  const effectiveYield = yieldBasis === "monthly" ? y0 * 12 : y0;
  const impliedStartingRevenue = startingUtilizedUnits * effectiveYield;
  const rawLabel = params.capacityUnitLabel;
  const capacityUnitLabel =
    typeof rawLabel === "string" && rawLabel.trim() !== "" ? rawLabel.trim() : undefined;
  return {
    startingCapacity: cap,
    startingUtilizationPct: u0,
    startingUtilizedUnits,
    startingYield: y0,
    yieldBasis,
    impliedStartingRevenue,
    capacityUnitLabel,
  };
}

/**
 * Revenue Customers × ARPU parameters for the linked row or nearest qualifying ancestor
 * (allocation child under a `customers_arpu` independent driver).
 */
export function resolveCustomersArpuParamsForCogsLinkedRow(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): Record<string, unknown> | null {
  const cfg = revenueCfg[rowId];
  if (!cfg) return null;
  const role = cfg.forecastRole as RevenueForecastRoleV1 | undefined;

  let params: Record<string, unknown> | undefined;

  if (role === "independent_driver" && cfg.forecastMethod === "customers_arpu") {
    params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  } else if (role === "allocation_of_parent") {
    const parentById = buildForecastRevenueParentIdMap(revenueTree);
    let pid: string | null | undefined = parentById.get(rowId) ?? null;
    while (pid) {
      const p = revenueCfg[pid];
      if (p?.forecastRole === "independent_driver" && p.forecastMethod === "customers_arpu") {
        params = (p.forecastParameters ?? {}) as Record<string, unknown>;
        break;
      }
      pid = parentById.get(pid) ?? null;
    }
  }

  return params ?? null;
}

/**
 * Read-only Customers × ARPU starting drivers for COGS Cost per Customer context.
 * Implied starting revenue = customers × ARPU × annualization (same frame as revenue projection).
 */
export function resolveCustomersArpuStartingDriversForCogsLinkedRow(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): {
  startingCustomers: number;
  startingArpu: number;
  arpuBasis: "monthly" | "annual";
  impliedStartingRevenue: number;
} | null {
  const params = resolveCustomersArpuParamsForCogsLinkedRow(rowId, revenueCfg, revenueTree);
  if (!params) return null;
  const sc = Number(params.startingCustomers);
  const sa = Number(params.startingArpu);
  if (!Number.isFinite(sc) || !Number.isFinite(sa) || sc <= 0 || sa <= 0) return null;
  const arpuBasis = resolveArpuBasisFromParams(params);
  const mult = getArpuAnnualizationMultiplier(params);
  const impliedStartingRevenue = sc * sa * mult;
  return { startingCustomers: sc, startingArpu: sa, arpuBasis, impliedStartingRevenue };
}

/**
 * Read-only Price × Volume starting drivers for COGS Cost per Unit context.
 * Reads `startingVolume` / `startingPricePerUnit` from the linked row or, for allocation children,
 * from the nearest ancestor `independent_driver` with `price_volume`. No inference from revenue totals.
 */
export function resolvePriceVolumeStartingDriversForCogsLinkedRow(
  rowId: string,
  revenueCfg: RevenueForecastConfigV1["rows"],
  revenueTree: ForecastRevenueNodeV1[]
): { startingVolume: number; startingPricePerUnit: number } | null {
  const cfg = revenueCfg[rowId];
  if (!cfg) return null;
  const role = cfg.forecastRole as RevenueForecastRoleV1 | undefined;

  let params: Record<string, unknown> | undefined;

  if (role === "independent_driver" && cfg.forecastMethod === "price_volume") {
    params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  } else if (role === "allocation_of_parent") {
    const parentById = buildForecastRevenueParentIdMap(revenueTree);
    let pid: string | null | undefined = parentById.get(rowId) ?? null;
    while (pid) {
      const p = revenueCfg[pid];
      if (p?.forecastRole === "independent_driver" && p.forecastMethod === "price_volume") {
        params = (p.forecastParameters ?? {}) as Record<string, unknown>;
        break;
      }
      pid = parentById.get(pid) ?? null;
    }
  }

  if (!params) return null;
  const sv = Number(params.startingVolume);
  const sp = Number(params.startingPricePerUnit);
  if (!Number.isFinite(sv) || !Number.isFinite(sp) || sv <= 0 || sp <= 0) return null;
  return { startingVolume: sv, startingPricePerUnit: sp };
}

function suggestionFromRevenueMethod(method: RevenueForecastMethodV1 | undefined): {
  suggestion: CogsAiSuggestion;
  reason: string;
} {
  switch (method) {
    case "price_volume":
      return {
        suggestion: "Cost per Unit",
        reason: "Suggested: Cost per Unit, because the linked revenue line is forecast from units × price.",
      };
    case "customers_arpu":
      return {
        suggestion: "Cost per Customer",
        reason:
          "Suggested: Cost per Customer, because the linked revenue line is forecast from customers and ARPU. Customer counts are automatically inherited from Revenue.",
      };
    case "contracts_acv":
      return {
        suggestion: "Cost per Contract",
        reason:
          "Suggested: Cost per Contract, because the linked revenue line is forecast from contracts and ACV. Contract counts are automatically inherited from Revenue.",
      };
    case "locations_revenue_per_location":
      return {
        suggestion: "Cost per Location",
        reason:
          "Suggested: Cost per Location, because the linked revenue line is forecast from locations and revenue per location. Location counts are automatically inherited from Revenue.",
      };
    case "capacity_utilization_yield":
      return {
        suggestion: "Cost per Utilized Unit",
        reason:
          "Suggested: Cost per Utilized Unit, because the linked revenue line is forecast from capacity, utilization, and yield. Utilized units are automatically inherited from Revenue.",
      };
    default:
      return {
        suggestion: "% of Revenue",
        reason: "Suggested: % of Revenue, because this revenue line is forecast directly without a linked operational cost driver method.",
      };
  }
}

/**
 * COGS is modeled at **terminal economic forecast nodes** only:
 * - **allocation_of_parent**: always (children are the costed split units; parent is not costed separately).
 * - **independent_driver** / **derived_sum**: only when this node has **no** revenue-tree children — i.e. costing
 *   applies at leaves, or at allocation rows, never at a parent whose revenue is fully explained by descendants
 *   (rollup, built-from-children, or allocation split under a direct parent).
 */
function shouldIncludeRevenueNodeForCogs(
  node: ForecastRevenueNodeV1,
  revenueCfg: RevenueForecastConfigV1["rows"]
): boolean {
  if (node.id === "rev") return false;
  const cfg = revenueCfg[node.id];
  if (!cfg) return false;
  const role = cfg.forecastRole as RevenueForecastRoleV1 | undefined;
  if (!role) return false;

  const hasTreeChildren = node.children.length > 0;

  if (role === "allocation_of_parent") {
    return true;
  }

  if (role === "derived_sum") {
    if (hasTreeChildren) return false;
    return true;
  }

  if (role === "independent_driver") {
    if (hasTreeChildren) return false;
    return true;
  }

  return false;
}

export function buildForecastableCogsLinesFromRevenue(
  revenueTree: ForecastRevenueNodeV1[],
  revenueCfg: RevenueForecastConfigV1["rows"]
): ForecastableCogsLine[] {
  const out: ForecastableCogsLine[] = [];
  const walk = (nodes: ForecastRevenueNodeV1[], depth: number) => {
    for (const n of nodes) {
      if (shouldIncludeRevenueNodeForCogs(n, revenueCfg)) {
        const method = revenueCfg[n.id]?.forecastMethod as RevenueForecastMethodV1 | undefined;
        const { suggestion, reason } = suggestionFromRevenueMethod(method);
        out.push({
          lineId: `cogs_${n.id}`,
          linkedRevenueRowId: n.id,
          lineLabel: n.label,
          linkedRevenueMethod: method,
          depth,
          suggestion,
          suggestionReason: reason,
        });
      }
      if (n.children.length > 0) walk(n.children, depth + 1);
    }
  };
  walk(revenueTree, 0);
  return out;
}

export function mergeForecastableLinesWithConfig(
  forecastable: ForecastableCogsLine[],
  existing: Record<string, CogsForecastLineConfigV1>
): Record<string, CogsForecastLineConfigV1> {
  const next: Record<string, CogsForecastLineConfigV1> = {};
  for (const f of forecastable) {
    const prev = existing[f.lineId];
    next[f.lineId] = {
      lineId: f.lineId,
      linkedRevenueRowId: f.linkedRevenueRowId,
      lineLabel: f.lineLabel,
      linkedRevenueMethod: f.linkedRevenueMethod,
      forecastMethod: prev?.forecastMethod,
      forecastParameters: prev?.forecastParameters,
    };
  }
  return next;
}
