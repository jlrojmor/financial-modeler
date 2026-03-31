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
  resolveArpuBasisFromParams,
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

export function hasPersistedCogsLineForecast(
  cfg: CogsForecastLineConfigV1 | undefined,
  projectionYears: string[]
): boolean {
  return (
    hasPersistedCogsPctConfig(cfg, projectionYears) ||
    hasPersistedCogsCpuConfig(cfg, projectionYears) ||
    hasPersistedCogsCpcConfig(cfg, projectionYears)
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
  const start = Number(cogsParams.startingCostPerCustomer);
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
      return { suggestion: "Cost per Contract", reason: "Suggested next method: Cost per Contract, because revenue is driven by contract count and ACV." };
    case "locations_revenue_per_location":
      return { suggestion: "Cost per Location", reason: "Suggested next method: Cost per Location, because revenue is driven by location count and productivity." };
    case "capacity_utilization_yield":
      return { suggestion: "Cost per Utilized Unit", reason: "Suggested next method: Cost per Utilized Unit, because revenue is driven by utilized capacity and yield." };
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
