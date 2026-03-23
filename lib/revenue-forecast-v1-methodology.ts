/**
 * IB-style methodology copy for Revenue Forecast v1.
 */

import type {
  ForecastRevenueNodeV1,
  RevenueForecastConfigV1,
  RevenueForecastRowConfigV1,
  RevenueForecastMethodV1,
} from "@/types/revenue-forecast-v1";
import {
  validateGrowthPhases,
  resolveUtilizationLevelsByYear,
  type GrowthPhaseV1,
} from "@/lib/revenue-growth-phases-v1";
import {
  getAllocationPercentSum,
  REVENUE_ALLOC_SUM_TOLERANCE,
} from "@/lib/revenue-forecast-v1-validation";

export const GROWTH_PHASES_UX = {
  title: "Growth phases",
  oneLine: "Uses different growth rates across defined forecast periods.",
  formula:
    "For each phase, projected years grow at the selected rate until the next phase begins.",
  required: "Needs: full year coverage + growth % for each phase",
} as const;

function phasesFromParams(p: Record<string, unknown>): GrowthPhaseV1[] {
  const raw = p.growthPhases;
  if (!Array.isArray(raw)) return [];
  return raw.map((x: unknown) => {
    const o = x as Record<string, unknown>;
    return {
      startYear: String(o.startYear ?? ""),
      endYear: String(o.endYear ?? ""),
      ratePercent: Number(o.ratePercent),
    };
  });
}

/** User-facing status line for saved growth phases (collapsed row). */
export function getGrowthPhasesStatusLabel(
  cfg: RevenueForecastRowConfigV1 | undefined,
  projectionYears: string[]
): string {
  const p = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
  if (p.growthPatternType !== "phases") return "Ready";
  const phases = phasesFromParams(p);
  const { ok, errors } = validateGrowthPhases(phases, projectionYears);
  if (ok) return "Ready";
  if (errors.some((e) => e.includes("overlap"))) return "Overlapping phases";
  if (errors.some((e) => e.includes("without gaps"))) return "Gaps in phases";
  if (errors.some((e) => e.includes("cover all"))) return "Missing years";
  if (errors.some((e) => e.includes("growth %"))) return "Enter growth % for all phases";
  return "Incomplete";
}

function formatPhasesCompact(phases: GrowthPhaseV1[]): string {
  const sorted = [...phases].sort((a, b) => a.startYear.localeCompare(b.startYear));
  return sorted
    .map((ph) =>
      ph.startYear === ph.endYear
        ? `${ph.startYear}: ${ph.ratePercent}%`
        : `${ph.startYear}–${ph.endYear}: ${ph.ratePercent}%`
    )
    .join(", ");
}

export type DirectForecastSubModeV1 =
  | "growth_from_historical"
  | "growth_from_manual_start"
  | "flat_value"
  | "manual_by_year"
  | "price_volume"
  | "customers_arpu"
  | "locations_revenue_per_location"
  | "capacity_utilization_yield"
  | "contracts_acv";

export function getDirectForecastSubMode(
  cfg: RevenueForecastRowConfigV1 | undefined,
  allowGrowthFromHistorical: boolean
): DirectForecastSubModeV1 {
  const m = cfg?.forecastMethod as RevenueForecastMethodV1 | undefined;
  const p = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
  if (m === "price_volume") return "price_volume";
  if (m === "customers_arpu") return "customers_arpu";
  if (m === "locations_revenue_per_location") return "locations_revenue_per_location";
  if (m === "capacity_utilization_yield") return "capacity_utilization_yield";
  if (m === "contracts_acv") return "contracts_acv";
  if (m === "fixed_value") {
    const vByY = p.valuesByYear as Record<string, number> | undefined;
    if (vByY && typeof vByY === "object" && Object.keys(vByY).length > 0) return "manual_by_year";
    return "flat_value";
  }
  const basis = p.startingBasis as string | undefined;
  if (basis === "starting_amount") return "growth_from_manual_start";
  if (!allowGrowthFromHistorical) return "growth_from_manual_start";
  return "growth_from_historical";
}

/** Concise UX copy for direct-forecast method picker + methodology panel */
export const DIRECT_METHOD_UX: Record<
  DirectForecastSubModeV1,
  {
    title: string;
    oneLine: string;
    formula: string;
    required: string;
    ready: string;
    missingGrowth: string;
    missingStart: string;
    missingHist: string;
    missingFlat: string;
    missingYear: string;
  }
> = {
  growth_from_historical: {
    title: "Growth from historical actual",
    oneLine: "Uses this line’s last historical actual and grows it forward.",
    formula: "2026E = 2025A × (1 + growth %)",
    required: "Needs: growth %",
    ready: "Ready",
    missingGrowth: "Enter growth %",
    missingStart: "",
    missingHist: "Historical actual not available",
    missingFlat: "",
    missingYear: "",
  },
  growth_from_manual_start: {
    title: "Growth from manual starting amount",
    oneLine: "Starts from a manual first-year amount and grows from there.",
    formula: "2026E = Starting amount × (1 + growth %)",
    required: "Needs: growth % + starting amount",
    ready: "Ready",
    missingGrowth: "Enter growth %",
    missingStart: "Missing starting amount",
    missingHist: "",
    missingFlat: "",
    missingYear: "",
  },
  flat_value: {
    title: "Flat value",
    oneLine: "Keeps this line flat across projected years.",
    formula: "Proj(t) = same amount each year",
    required: "Needs: flat amount",
    ready: "Ready",
    missingGrowth: "",
    missingStart: "",
    missingHist: "",
    missingFlat: "Enter flat amount",
    missingYear: "",
  },
  manual_by_year: {
    title: "Manual by year",
    oneLine: "Uses user-entered projected values by year.",
    formula: "Proj(year) = entered value",
    required: "Needs: at least one projected year value",
    ready: "Ready",
    missingGrowth: "",
    missingStart: "",
    missingHist: "",
    missingFlat: "",
    missingYear: "Enter at least one year",
  },
  price_volume: {
    title: "Price × Volume",
    oneLine: "Forecasts revenue as projected units × projected price per unit.",
    formula: "Revenue(t) = Volume(t) × Price(t); each series grows with its own pattern.",
    required:
      "Needs: starting volume & price/unit (both > 0), complete volume & price growth; optional volume unit label",
    ready: "Ready",
    missingGrowth: "Complete volume and price growth inputs",
    missingStart: "Enter starting volume and price per unit (both > 0)",
    missingHist: "",
    missingFlat: "",
    missingYear: "",
  },
  customers_arpu: {
    title: "Customers × ARPU",
    oneLine: "Forecasts revenue as projected customers × projected ARPU (annual, or monthly ARPU × 12).",
    formula:
      "Revenue(t) = Customers(t) × ARPU(t) × (12 if ARPU basis is monthly, else 1); each series grows with its own pattern.",
    required:
      "Needs: starting customers & starting ARPU (both > 0), ARPU basis (annual default), complete customer & ARPU growth; optional customer unit label",
    ready: "Ready",
    missingGrowth: "Complete customer and ARPU growth inputs",
    missingStart: "Enter starting customers and ARPU (both > 0)",
    missingHist: "",
    missingFlat: "",
    missingYear: "",
  },
  locations_revenue_per_location: {
    title: "Locations × Revenue per Location",
    oneLine:
      "Forecasts revenue as projected location count × projected revenue per location (annual, or monthly × 12).",
    formula:
      "Revenue(t) = Locations(t) × Revenue per Location(t) × (12 if revenue/location basis is monthly, else 1); each series grows with its own pattern.",
    required:
      "Needs: starting locations & starting revenue/location (both > 0), revenue/location basis (annual default), complete location & revenue/location growth; optional location unit label",
    ready: "Ready",
    missingGrowth: "Complete location and revenue per location growth inputs",
    missingStart: "Enter starting locations and revenue per location (both > 0)",
    missingHist: "",
    missingFlat: "",
    missingYear: "",
  },
  capacity_utilization_yield: {
    title: "Capacity × Utilization × Yield",
    oneLine:
      "Forecasts revenue as capacity × utilization % × yield per utilized unit; capacity and yield grow with patterns; utilization is a level path by year.",
    formula:
      "Revenue(t) = Capacity(t) × Utilization(t)% × Yield(t) × (12 if yield basis is monthly, else 1).",
    required:
      "Needs: starting capacity, utilization (0–100%), and yield (all valid); complete capacity growth, utilization path, and yield growth; yield basis (annual default)",
    ready: "Ready",
    missingGrowth: "Complete capacity growth, utilization path, and yield growth",
    missingStart: "Enter starting capacity, utilization %, and yield",
    missingHist: "",
    missingFlat: "",
    missingYear: "",
  },
  contracts_acv: {
    title: "Contracts × ACV",
    oneLine:
      "Forecasts revenue as projected contract count × projected annual contract value (ACV); each series grows with its own pattern.",
    formula:
      "Revenue(t) = Contracts(t) × ACV(t). ACV is annual contract value per contract — no monthly/annual basis toggle.",
    required:
      "Needs: starting contracts & starting ACV (both > 0), complete contract & ACV growth; optional contract unit label",
    ready: "Ready",
    missingGrowth: "Complete contract and ACV growth inputs",
    missingStart: "Enter starting contracts and ACV (both > 0)",
    missingHist: "",
    missingFlat: "",
    missingYear: "",
  },
};

/** True when one side of a two-driver method has a complete growth definition. */
export function isPrefixedGrowthSideComplete(
  p: Record<string, unknown>,
  prefix: string,
  projectionYears: string[]
): boolean {
  const pType = p[`${prefix}GrowthPatternType`] as string | undefined;
  const proj = projectionYears;
  if (pType === "phases") {
    const raw = p[`${prefix}GrowthPhases`];
    const phases = Array.isArray(raw)
      ? raw.map((x: unknown) => {
          const o = x as Record<string, unknown>;
          return {
            startYear: String(o.startYear ?? ""),
            endYear: String(o.endYear ?? ""),
            ratePercent: Number(o.ratePercent),
          };
        })
      : [];
    const { ok } = validateGrowthPhases(phases, proj);
    const rp = p[`${prefix}RatePercent`];
    return ok && proj.length > 0 && rp != null && Number.isFinite(Number(rp));
  }
  if (pType === "by_year") {
    const rby = p[`${prefix}RatesByYear`] as Record<string, number> | undefined;
    if (!proj.length) return false;
    const yearsOk = proj.every((y) => rby?.[y] != null && Number.isFinite(Number(rby[y])));
    const rp = p[`${prefix}RatePercent`];
    return yearsOk && rp != null && Number.isFinite(Number(rp));
  }
  const g = p[`${prefix}RatePercent`];
  return g != null && Number.isFinite(Number(g));
}

/** Whether saved direct-forecast config passes minimum completeness for projections. */
export function isDirectForecastConfigComplete(
  cfg: RevenueForecastRowConfigV1 | undefined,
  rowId: string,
  lastHistoricByRowId?: Record<string, number>,
  allowGrowthFromHistorical = true,
  projectionYears?: string[]
): boolean {
  if (!cfg || cfg.forecastRole !== "independent_driver" || !cfg.forecastMethod) return false;
  const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const hasHist =
    allowGrowthFromHistorical &&
    typeof lastHistoricByRowId?.[rowId] === "number" &&
    !Number.isNaN(lastHistoricByRowId[rowId]!);
  if (cfg.forecastMethod === "price_volume") {
    const sv = Number(p.startingVolume);
    const sp = Number(p.startingPricePerUnit);
    if (!(sv > 0 && Number.isFinite(sv) && sp > 0 && Number.isFinite(sp))) return false;
    const proj = projectionYears ?? [];
    if (!proj.length) return false;
    return (
      isPrefixedGrowthSideComplete(p, "volume", proj) &&
      isPrefixedGrowthSideComplete(p, "price", proj)
    );
  }
  if (cfg.forecastMethod === "customers_arpu") {
    const sc = Number(p.startingCustomers);
    const sa = Number(p.startingArpu);
    if (!(sc > 0 && Number.isFinite(sc) && sa > 0 && Number.isFinite(sa))) return false;
    const proj = projectionYears ?? [];
    if (!proj.length) return false;
    return (
      isPrefixedGrowthSideComplete(p, "customer", proj) &&
      isPrefixedGrowthSideComplete(p, "arpu", proj)
    );
  }
  if (cfg.forecastMethod === "locations_revenue_per_location") {
    const sl = Number(p.startingLocations);
    const srpl = Number(p.startingRevenuePerLocation);
    if (!(sl > 0 && Number.isFinite(sl) && srpl > 0 && Number.isFinite(srpl))) return false;
    const proj = projectionYears ?? [];
    if (!proj.length) return false;
    return (
      isPrefixedGrowthSideComplete(p, "location", proj) &&
      isPrefixedGrowthSideComplete(p, "revenuePerLocation", proj)
    );
  }
  if (cfg.forecastMethod === "capacity_utilization_yield") {
    const sc = Number(p.startingCapacity);
    const su = Number(p.startingUtilizationPct);
    const sy = Number(p.startingYield);
    if (!(sc > 0 && Number.isFinite(sc) && sy > 0 && Number.isFinite(sy))) return false;
    if (!(Number.isFinite(su) && su >= 0 && su <= 100)) return false;
    const proj = projectionYears ?? [];
    if (!proj.length) return false;
    const utilOk = resolveUtilizationLevelsByYear(p, proj);
    if (!utilOk) return false;
    return (
      isPrefixedGrowthSideComplete(p, "capacity", proj) &&
      isPrefixedGrowthSideComplete(p, "yield", proj)
    );
  }
  if (cfg.forecastMethod === "contracts_acv") {
    const sc = Number(p.startingContracts);
    const sa = Number(p.startingAcv);
    if (!(sc > 0 && Number.isFinite(sc) && sa > 0 && Number.isFinite(sa))) return false;
    const proj = projectionYears ?? [];
    if (!proj.length) return false;
    return (
      isPrefixedGrowthSideComplete(p, "contract", proj) &&
      isPrefixedGrowthSideComplete(p, "acv", proj)
    );
  }
  if (cfg.forecastMethod === "growth_rate") {
    const basis = p.startingBasis as string | undefined;
    const proj = projectionYears ?? [];
    if (p.growthPatternType === "phases" && proj.length > 0) {
      const { ok } = validateGrowthPhases(phasesFromParams(p), proj);
      const g = p.ratePercent;
      if (!ok || g == null || !Number.isFinite(Number(g))) return false;
      if (basis === "last_historical") return hasHist;
      const sa = p.startingAmount;
      return sa != null && Number.isFinite(Number(sa));
    }
    if (basis === "last_historical") {
      if (!hasHist) return false;
      const rby = p.ratesByYear as Record<string, number> | undefined;
      if (
        p.growthPatternType === "by_year" ||
        (rby && typeof rby === "object" && Object.keys(rby).length > 0 && proj.length)
      ) {
        if (!proj.length) return false;
        return projectionYears!.every((y) => rby?.[y] != null && Number.isFinite(Number(rby[y])));
      }
      const g = p.ratePercent;
      return g != null && Number.isFinite(Number(g));
    }
    if (p.growthPatternType === "by_year") {
      const rby = p.ratesByYear as Record<string, number> | undefined;
      const sa = p.startingAmount;
      if (sa == null || !Number.isFinite(Number(sa)) || !proj.length) return false;
      return projectionYears!.every((y) => rby?.[y] != null && Number.isFinite(Number(rby[y])));
    }
    const g = p.ratePercent;
    if (g == null || !Number.isFinite(Number(g))) return false;
    const sa = p.startingAmount;
    return sa != null && Number.isFinite(Number(sa));
  }
  if (cfg.forecastMethod === "fixed_value") {
    const vByY = p.valuesByYear as Record<string, number> | undefined;
    if (vByY && typeof vByY === "object" && Object.keys(vByY).length > 0) {
      return Object.values(vByY).some((v) => v != null && Number.isFinite(Number(v)));
    }
    return p.value != null && Number.isFinite(Number(p.value));
  }
  return false;
}

/** Ready / Incomplete / Invalid for collapsed direct row summary. */
export function getDirectForecastRowUiStatus(
  cfg: RevenueForecastRowConfigV1 | undefined,
  rowId: string,
  lastHistoricByRowId: Record<string, number> | undefined,
  allowGrowthFromHistorical: boolean,
  projectionYears: string[]
): "ready" | "incomplete" | "invalid" {
  const sub = getDirectForecastSubMode(cfg, allowGrowthFromHistorical);
  const hasHist =
    allowGrowthFromHistorical &&
    typeof lastHistoricByRowId?.[rowId] === "number" &&
    !Number.isNaN(lastHistoricByRowId[rowId]!);
  if (sub === "growth_from_historical" && !hasHist) return "invalid";
  if (isDirectForecastConfigComplete(cfg, rowId, lastHistoricByRowId, allowGrowthFromHistorical, projectionYears)) {
    return "ready";
  }
  return "incomplete";
}

/**
 * Direct row status including mandatory 100% split when sub-lines are allocation-only.
 */
export function getDirectForecastRowUiStatusWithAlloc(
  cfg: RevenueForecastRowConfigV1 | undefined,
  rowId: string,
  node: ForecastRevenueNodeV1,
  rows: RevenueForecastConfigV1["rows"],
  lastHistoricByRowId: Record<string, number> | undefined,
  allowGrowthFromHistorical: boolean,
  projectionYears: string[]
): "ready" | "incomplete" | "invalid" {
  const kids = node.children;
  if (kids.length > 0) {
    const allAlloc = kids.every((c) => rows[c.id]?.forecastRole === "allocation_of_parent");
    if (allAlloc) {
      const sum = getAllocationPercentSum(kids, rows);
      if (sum > 100 + REVENUE_ALLOC_SUM_TOLERANCE) return "invalid";
      if (Math.abs(sum - 100) > REVENUE_ALLOC_SUM_TOLERANCE) return "incomplete";
    }
  }
  return getDirectForecastRowUiStatus(
    cfg,
    rowId,
    lastHistoricByRowId,
    allowGrowthFromHistorical,
    projectionYears
  );
}

function formatSignedPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n * 10) / 10;
  return `${r >= 0 ? "+" : ""}${r}%`;
}

function fmtAssumptionAmt(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 20, useGrouping: true })
    : "—";
}

export function getDirectForecastCompactSummary(
  cfg: RevenueForecastRowConfigV1 | undefined,
  rowId: string,
  allowGrowthFromHistorical: boolean,
  lastHistoricByRowId?: Record<string, number>,
  projectionYears: string[] = []
): string {
  const p = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
  const sub = getDirectForecastSubMode(cfg, allowGrowthFromHistorical);
  const fmtN = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "—");

  switch (sub) {
    case "growth_from_historical": {
      if (p.growthPatternType === "phases") {
        const phases = phasesFromParams(p);
        const status = getGrowthPhasesStatusLabel(cfg, projectionYears);
        const seg = phases.length ? formatPhasesCompact(phases) : "—";
        return `Direct · Growth phases · ${seg} · ${status}`;
      }
      const rby = p.ratesByYear as Record<string, number> | undefined;
      if (rby && Object.keys(rby).length > 0 && p.growthPatternType !== "constant") {
        const ys = Object.entries(rby).filter(([, v]) => v != null && Number.isFinite(Number(v)));
        if (ys.length === 0) return `Direct · ${DIRECT_METHOD_UX.growth_from_historical.title} · By year`;
        return `Direct · Growth from historical · By year · ${ys[0]![0]}: ${ys[0]![1]}%${ys.length > 1 ? " …" : ""}`;
      }
      return `Direct · ${DIRECT_METHOD_UX.growth_from_historical.title} · ${fmtN(p.ratePercent)}%`;
    }
    case "growth_from_manual_start": {
      if (p.growthPatternType === "phases") {
        const phases = phasesFromParams(p);
        const status = getGrowthPhasesStatusLabel(cfg, projectionYears);
        const seg = phases.length ? formatPhasesCompact(phases) : "—";
        return `Direct · Growth phases · ${seg} · ${status}`;
      }
      if (p.growthPatternType === "by_year") {
        const rby = p.ratesByYear as Record<string, number> | undefined;
        const ys = Object.entries(rby ?? {}).filter(([, v]) => v != null && Number.isFinite(Number(v)));
        const bit =
          ys.length === 0 ? "By year" : `${ys[0]![0]}: ${ys[0]![1]}%${ys.length > 1 ? " …" : ""}`;
        return `Direct · ${DIRECT_METHOD_UX.growth_from_manual_start.title} · By year · ${bit} · Start: ${fmtAssumptionAmt(p.startingAmount)}`;
      }
      return `Direct · ${DIRECT_METHOD_UX.growth_from_manual_start.title} · ${fmtN(p.ratePercent)}% · Start: ${fmtAssumptionAmt(p.startingAmount)}`;
    }
    case "flat_value":
      return `Direct · ${DIRECT_METHOD_UX.flat_value.title} · ${fmtAssumptionAmt(p.value)}`;
    case "manual_by_year": {
      const vByY = (p.valuesByYear ?? {}) as Record<string, number>;
      const filled = Object.entries(vByY).filter(([, v]) => v != null && Number.isFinite(Number(v)));
      if (filled.length === 0) return `Direct · ${DIRECT_METHOD_UX.manual_by_year.title} · (no values yet)`;
      const [y, v] = filled[0]!;
      return `Direct · ${DIRECT_METHOD_UX.manual_by_year.title} · ${y}: ${fmtAssumptionAmt(Number(v))}${
        filled.length > 1 ? ` +${filled.length - 1}` : ""
      }`;
    }
    case "price_volume": {
      const volT = p.volumeGrowthPatternType as string | undefined;
      const priceT = p.priceGrowthPatternType as string | undefined;
      const customVol = volT === "phases" || volT === "by_year";
      const customPrice = priceT === "phases" || priceT === "by_year";
      const bothConstant = volT === "constant" && priceT === "constant";
      const unitLbl =
        typeof p.volumeUnitLabel === "string" && p.volumeUnitLabel.trim()
          ? p.volumeUnitLabel.trim().slice(0, 18)
          : "";
      const unitBit = unitLbl ? ` · ${unitLbl}` : "";

      let driver: string;
      if (bothConstant && !customVol && !customPrice) {
        const vg = Number(p.volumeRatePercent);
        const pg = Number(p.priceRatePercent);
        if (Number.isFinite(vg) && Number.isFinite(pg)) {
          driver = `Volume ${formatSignedPct(vg)} · Price ${formatSignedPct(pg)}`;
        } else {
          driver = "phased/custom growth";
        }
      } else if (customVol || customPrice) {
        driver = "phased/custom growth";
      } else {
        driver = "phased/custom growth";
      }

      return `Direct · Price × Volume${unitBit} · ${driver}`;
    }
    case "customers_arpu": {
      const custT = p.customerGrowthPatternType as string | undefined;
      const arpuT = p.arpuGrowthPatternType as string | undefined;
      const customCust = custT === "phases" || custT === "by_year";
      const customArpu = arpuT === "phases" || arpuT === "by_year";
      const bothConstant = custT === "constant" && arpuT === "constant";
      const unitLbl =
        typeof p.customerUnitLabel === "string" && p.customerUnitLabel.trim()
          ? p.customerUnitLabel.trim().slice(0, 18)
          : "";
      const unitBit = unitLbl ? ` · ${unitLbl}` : "";

      let driver: string;
      if (bothConstant && !customCust && !customArpu) {
        const cg = Number(p.customerRatePercent);
        const ag = Number(p.arpuRatePercent);
        if (Number.isFinite(cg) && Number.isFinite(ag)) {
          driver = `Customers ${formatSignedPct(cg)} · ARPU ${formatSignedPct(ag)}`;
        } else {
          driver = "phased/custom growth";
        }
      } else if (customCust || customArpu) {
        driver = "phased/custom growth";
      } else {
        driver = "phased/custom growth";
      }

      const basisBit =
        p.arpuBasis === "monthly" ? " · ARPU monthly→annual (×12)" : "";
      return `Direct · Customers × ARPU${unitBit}${basisBit} · ${driver}`;
    }
    case "locations_revenue_per_location": {
      const locT = p.locationGrowthPatternType as string | undefined;
      const rplT = p.revenuePerLocationGrowthPatternType as string | undefined;
      const customLoc = locT === "phases" || locT === "by_year";
      const customRpl = rplT === "phases" || rplT === "by_year";
      const bothConstant = locT === "constant" && rplT === "constant";
      const unitLbl =
        typeof p.locationUnitLabel === "string" && p.locationUnitLabel.trim()
          ? p.locationUnitLabel.trim().slice(0, 18)
          : "";
      const unitBit = unitLbl ? ` · ${unitLbl}` : "";

      let driver: string;
      if (bothConstant && !customLoc && !customRpl) {
        const lg = Number(p.locationRatePercent);
        const rg = Number(p.revenuePerLocationRatePercent);
        if (Number.isFinite(lg) && Number.isFinite(rg)) {
          driver = `Locations ${formatSignedPct(lg)} · Rev/location ${formatSignedPct(rg)}`;
        } else {
          driver = "phased/custom growth";
        }
      } else if (customLoc || customRpl) {
        driver = "phased/custom growth";
      } else {
        driver = "phased/custom growth";
      }

      const basisBit =
        p.revenuePerLocationBasis === "monthly" ? " · Rev/loc monthly→annual (×12)" : "";
      return `Direct · Locations × Revenue per Location${unitBit}${basisBit} · ${driver}`;
    }
    case "capacity_utilization_yield": {
      const capT = p.capacityGrowthPatternType as string | undefined;
      const yldT = p.yieldGrowthPatternType as string | undefined;
      const utilT = p.utilizationPatternType as string | undefined;
      const customCap = capT === "phases" || capT === "by_year";
      const customYld = yldT === "phases" || yldT === "by_year";
      const customUtil = utilT === "phases" || utilT === "by_year";
      const bothGrowthConstant = capT === "constant" && yldT === "constant";
      const unitLbl =
        typeof p.capacityUnitLabel === "string" && p.capacityUnitLabel.trim()
          ? p.capacityUnitLabel.trim().slice(0, 18)
          : "";
      const unitBit = unitLbl ? ` · ${unitLbl}` : "";
      let driver: string;
      if (bothGrowthConstant && !customCap && !customYld && !customUtil) {
        const cg = Number(p.capacityRatePercent);
        const yg = Number(p.yieldRatePercent);
        if (Number.isFinite(cg) && Number.isFinite(yg)) {
          driver = `Capacity ${formatSignedPct(cg)} · Yield ${formatSignedPct(yg)} · Util ${utilT ?? "constant"}`;
        } else {
          driver = "custom capacity / utilization / yield path";
        }
      } else {
        driver = "custom capacity / utilization / yield path";
      }
      const basisBit = p.yieldBasis === "monthly" ? " · Yield monthly→annual (×12)" : "";
      return `Direct · Capacity × Utilization × Yield${unitBit}${basisBit} · ${driver}`;
    }
    case "contracts_acv": {
      const conT = p.contractGrowthPatternType as string | undefined;
      const acvT = p.acvGrowthPatternType as string | undefined;
      const customCon = conT === "phases" || conT === "by_year";
      const customAcv = acvT === "phases" || acvT === "by_year";
      const bothConstant = conT === "constant" && acvT === "constant";
      const unitLbl =
        typeof p.contractUnitLabel === "string" && p.contractUnitLabel.trim()
          ? p.contractUnitLabel.trim().slice(0, 18)
          : "";
      const unitBit = unitLbl ? ` · ${unitLbl}` : "";
      let driver: string;
      if (bothConstant && !customCon && !customAcv) {
        const cg = Number(p.contractRatePercent);
        const ag = Number(p.acvRatePercent);
        if (Number.isFinite(cg) && Number.isFinite(ag)) {
          driver = `Contracts ${formatSignedPct(cg)} · ACV ${formatSignedPct(ag)}`;
        } else {
          driver = "phased/custom growth";
        }
      } else if (customCon || customAcv) {
        driver = "phased/custom growth";
      } else {
        driver = "phased/custom growth";
      }
      return `Direct · Contracts × ACV${unitBit} · ${driver}`;
    }
    default:
      return "Direct";
  }
}

export const METHODOLOGY = {
  growth_from_historical: {
    title: "Growth from historical actual",
    formula: "Proj(t₁) = Hist(last) × (1 + g). Proj(t) = Proj(t−1) × (1 + g).",
    inputs: "Growth % g; last historical actual for this line",
    validation: "Historical actual required for this line",
  },
  growth_from_manual_start: {
    title: "Growth from manual starting amount",
    formula: "Proj(t₁) = Starting amount × (1 + g). Proj(t) = Proj(t−1) × (1 + g).",
    inputs: "Growth % g; starting amount (base for first projection year)",
    validation: "Starting amount required",
  },
  flat_value: {
    title: "Flat value",
    formula: "Same projected value every projection year.",
    inputs: "Flat amount",
    validation: "Flat amount required",
  },
  manual_by_year: {
    title: "Manual by year",
    formula: "Proj(y) = value entered for year y.",
    inputs: "One or more yearly projected values",
    validation: "At least one projection year value required",
  },
  allocate_from_parent: {
    title: "Split by % of the row above",
    formula: "Each projection year = row above × this %",
    inputs: "% for each sub-line (must total exactly 100%)",
    validation: "All sub-lines must total exactly 100%",
  },
  build_from_children: {
    title: "Built from the lines below",
    formula: "Each year = sum of component lines below.",
    inputs: "Component lines forecast directly or built from further sub-lines",
    validation: "At least one component line; subtree must include a direct forecast",
  },
} as const;

export const DIRECT_FORECAST_EXPLAINER =
  "Forecast this row directly, then optionally split it into component lines by %. Those sub-lines are not forecast separately — they split this row’s projected total.";

export const DERIVED_PARENT_EXPLAINER =
  "This row is built from the lines below. Each year equals the sum of its component lines. Those lines may be forecast directly or built from further sub-lines.";

export const ALLOCATION_LINE_TITLE = "This line is a % of Total Revenue";
export const ALLOCATION_LINE_TITLE_PARENT = "This line is a % of the row above";
export const ALLOCATION_FORMULA_LINE = "Each year = Total Revenue × this %";
export const ALLOCATION_FORMULA_PARENT = "Each year = row above × this %";

export const ALLOCATION_CHILD_EXPLAINER = [
  "This line is a % of the row above. It is not forecast independently.",
  "Each projection year = row above × this %.",
  "Sub-lines below this split must total exactly 100%.",
] as const;
