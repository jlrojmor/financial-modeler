/**
 * Revenue Forecast v1: recursive hierarchy validation.
 * - Direct parent (independent_driver): optional allocation children only; if any, sum 100%.
 * - Build-from-children (derived_sum): children are independent_driver or derived_sum (recursive).
 * - Total Revenue (rev): forecast directly OR build from top-level lines.
 */

import type { Row } from "@/types/finance";
import type {
  RevenueForecastConfigV1,
  RevenueForecastRowConfigV1,
  RevenueForecastRoleV1,
  RevenueForecastValidationResult,
  GrowthStartingBasisV1,
  ForecastRevenueNodeV1,
} from "@/types/revenue-forecast-v1";
import {
  validateGrowthPhases,
  validateUtilizationPhases,
  type GrowthPhaseV1,
} from "@/lib/revenue-growth-phases-v1";
import type { UtilizationPhaseV1 } from "@/types/revenue-forecast-v1";

/** Sum of allocation % under a direct row must match 100 within this tolerance (floating-point safe). */
export const REVENUE_ALLOC_SUM_TOLERANCE = 1e-6;

function ok(): RevenueForecastValidationResult {
  return { valid: true, errors: [] };
}

export interface ValidateRevenueForecastV1Options {
  forecastTree: ForecastRevenueNodeV1[];
  lastHistoricYear?: string;
  lastHistoricByRowId?: Record<string, number>;
  /** Required for growth phases / by-year checks. */
  projectionYears?: string[];
}

function subtreeContributes(node: ForecastRevenueNodeV1, rows: Record<string, RevenueForecastRowConfigV1>): boolean {
  const cfg = rows[node.id];
  if (!cfg) return false;
  if (cfg.forecastRole === "independent_driver" && cfg.forecastMethod) return true;
  if (cfg.forecastRole === "derived_sum") {
    return (node.children ?? []).some((c) => subtreeContributes(c, rows));
  }
  return false;
}

function validateIndependentLeafOrParent(
  node: ForecastRevenueNodeV1,
  cfg: RevenueForecastRowConfigV1,
  rows: Record<string, RevenueForecastRowConfigV1>,
  lastHistoricByRowId: Record<string, number> | undefined,
  errors: RevenueForecastValidationResult["errors"],
  projectionYears: string[]
): void {
  if (!cfg.forecastMethod) {
    errors.push({
      rowId: node.id,
      message: `"${node.label}": Forecast this line directly requires a construction method.`,
      code: "INDEPENDENT_NO_METHOD",
    });
    return;
  }
  if (
    cfg.forecastMethod !== "growth_rate" &&
    cfg.forecastMethod !== "fixed_value" &&
    cfg.forecastMethod !== "price_volume" &&
    cfg.forecastMethod !== "customers_arpu" &&
    cfg.forecastMethod !== "locations_revenue_per_location" &&
    cfg.forecastMethod !== "capacity_utilization_yield" &&
    cfg.forecastMethod !== "contracts_acv"
  ) {
    errors.push({
      rowId: node.id,
      message:
        "Only growth, fixed-value, Price × Volume, Customers × ARPU, Locations × Revenue per Location, Capacity × Utilization × Yield, or Contracts × ACV constructions are supported.",
      code: "INVALID_METHOD",
    });
    return;
  }
  const params = cfg.forecastParameters as Record<string, unknown> | undefined;
  const hasCh = (node.children?.length ?? 0) > 0;

  if (cfg.forecastMethod === "price_volume") {
    const p = params ?? {};
    const sv = Number(p.startingVolume);
    const sp = Number(p.startingPricePerUnit);
    const volPresent = p.startingVolume != null && Number.isFinite(sv);
    if (!volPresent) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Enter a starting volume.`,
        code: "PV_START_VOL",
      });
    } else if (sv <= 0) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Starting volume must be greater than 0.`,
        code: "PV_START_VOL_POS",
      });
    }
    const pricePresent = p.startingPricePerUnit != null && Number.isFinite(sp);
    if (!pricePresent) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Enter a starting price per unit.`,
        code: "PV_START_PRICE",
      });
    } else if (sp <= 0) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Starting price per unit must be greater than 0.`,
        code: "PV_START_PRICE_POS",
      });
    }

    const volumeGrowthComplete = (): boolean => {
      const pre = "volume";
      const pType = p[`${pre}GrowthPatternType`] as string | undefined;
      const proj = projectionYears.length ? projectionYears : [];
      if (pType === "phases") {
        const raw = p[`${pre}GrowthPhases`];
        const phases: GrowthPhaseV1[] = Array.isArray(raw)
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
        const rp = p[`${pre}RatePercent`];
        return ok && proj.length > 0 && rp != null && Number.isFinite(Number(rp));
      }
      if (pType === "by_year") {
        const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
        const yearsOk = proj.every((y) => {
          const v = rby?.[y];
          return v != null && Number.isFinite(Number(v));
        });
        const rp = p[`${pre}RatePercent`];
        return yearsOk && rp != null && Number.isFinite(Number(rp));
      }
      const rp = p[`${pre}RatePercent`];
      return rp != null && Number.isFinite(Number(rp));
    };

    const priceGrowthComplete = (): boolean => {
      const pre = "price";
      const pType = p[`${pre}GrowthPatternType`] as string | undefined;
      const proj = projectionYears.length ? projectionYears : [];
      if (pType === "phases") {
        const raw = p[`${pre}GrowthPhases`];
        const phases: GrowthPhaseV1[] = Array.isArray(raw)
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
        const rp = p[`${pre}RatePercent`];
        return ok && proj.length > 0 && rp != null && Number.isFinite(Number(rp));
      }
      if (pType === "by_year") {
        const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
        const yearsOk = proj.every((y) => {
          const v = rby?.[y];
          return v != null && Number.isFinite(Number(v));
        });
        const rp = p[`${pre}RatePercent`];
        return yearsOk && rp != null && Number.isFinite(Number(rp));
      }
      const rp = p[`${pre}RatePercent`];
      return rp != null && Number.isFinite(Number(rp));
    };

    if (volPresent && sv > 0 && !volumeGrowthComplete()) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Complete the volume growth setup.`,
        code: "PV_VOL_GROWTH_INCOMPLETE",
      });
    }
    if (pricePresent && sp > 0 && !priceGrowthComplete()) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Complete the price growth setup.`,
        code: "PV_PRICE_GROWTH_INCOMPLETE",
      });
    }
  }

  if (cfg.forecastMethod === "customers_arpu") {
    const p = params ?? {};
    const sc = Number(p.startingCustomers);
    const sa = Number(p.startingArpu);
    const custPresent = p.startingCustomers != null && Number.isFinite(sc);
    if (!custPresent) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Enter a starting customer base.`,
        code: "CA_START_CUSTOMERS",
      });
    } else if (sc <= 0) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Starting customer base must be greater than 0.`,
        code: "CA_START_CUSTOMERS_POS",
      });
    }
    const arpuPresent = p.startingArpu != null && Number.isFinite(sa);
    if (!arpuPresent) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Enter a starting ARPU.`,
        code: "CA_START_ARPU",
      });
    } else if (sa <= 0) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Starting ARPU must be greater than 0.`,
        code: "CA_START_ARPU_POS",
      });
    }

    const customerGrowthComplete = (): boolean => {
      const pre = "customer";
      const pType = p[`${pre}GrowthPatternType`] as string | undefined;
      const proj = projectionYears.length ? projectionYears : [];
      if (pType === "phases") {
        const raw = p[`${pre}GrowthPhases`];
        const phases: GrowthPhaseV1[] = Array.isArray(raw)
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
        const rp = p[`${pre}RatePercent`];
        return ok && proj.length > 0 && rp != null && Number.isFinite(Number(rp));
      }
      if (pType === "by_year") {
        const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
        const yearsOk = proj.every((y) => {
          const v = rby?.[y];
          return v != null && Number.isFinite(Number(v));
        });
        const rp = p[`${pre}RatePercent`];
        return yearsOk && rp != null && Number.isFinite(Number(rp));
      }
      const rp = p[`${pre}RatePercent`];
      return rp != null && Number.isFinite(Number(rp));
    };

    const arpuGrowthComplete = (): boolean => {
      const pre = "arpu";
      const pType = p[`${pre}GrowthPatternType`] as string | undefined;
      const proj = projectionYears.length ? projectionYears : [];
      if (pType === "phases") {
        const raw = p[`${pre}GrowthPhases`];
        const phases: GrowthPhaseV1[] = Array.isArray(raw)
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
        const rp = p[`${pre}RatePercent`];
        return ok && proj.length > 0 && rp != null && Number.isFinite(Number(rp));
      }
      if (pType === "by_year") {
        const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
        const yearsOk = proj.every((y) => {
          const v = rby?.[y];
          return v != null && Number.isFinite(Number(v));
        });
        const rp = p[`${pre}RatePercent`];
        return yearsOk && rp != null && Number.isFinite(Number(rp));
      }
      const rp = p[`${pre}RatePercent`];
      return rp != null && Number.isFinite(Number(rp));
    };

    if (custPresent && sc > 0 && !customerGrowthComplete()) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Complete the customer growth setup.`,
        code: "CA_CUSTOMER_GROWTH_INCOMPLETE",
      });
    }
    if (arpuPresent && sa > 0 && !arpuGrowthComplete()) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Complete the ARPU growth setup.`,
        code: "CA_ARPU_GROWTH_INCOMPLETE",
      });
    }
    const arpuBasis = p.arpuBasis;
    if (arpuBasis != null && arpuBasis !== "monthly" && arpuBasis !== "annual") {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": ARPU basis must be Monthly or Annual.`,
        code: "CA_ARPU_BASIS_INVALID",
      });
    }
  }

  if (cfg.forecastMethod === "locations_revenue_per_location") {
    const p = params ?? {};
    const sl = Number(p.startingLocations);
    const sr = Number(p.startingRevenuePerLocation);
    const locPresent = p.startingLocations != null && Number.isFinite(sl);
    if (!locPresent) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Enter a starting location count.`,
        code: "LRPL_START_LOCATIONS",
      });
    } else if (sl <= 0) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Starting location count must be greater than 0.`,
        code: "LRPL_START_LOCATIONS_POS",
      });
    }
    const revPerLocPresent = p.startingRevenuePerLocation != null && Number.isFinite(sr);
    if (!revPerLocPresent) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Enter a starting revenue per location.`,
        code: "LRPL_START_RPL",
      });
    } else if (sr <= 0) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Starting revenue per location must be greater than 0.`,
        code: "LRPL_START_RPL_POS",
      });
    }

    const locationGrowthComplete = (): boolean => {
      const pre = "location";
      const pType = p[`${pre}GrowthPatternType`] as string | undefined;
      const proj = projectionYears.length ? projectionYears : [];
      if (pType === "phases") {
        const raw = p[`${pre}GrowthPhases`];
        const phases: GrowthPhaseV1[] = Array.isArray(raw)
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
        const rp = p[`${pre}RatePercent`];
        return ok && proj.length > 0 && rp != null && Number.isFinite(Number(rp));
      }
      if (pType === "by_year") {
        const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
        const yearsOk = proj.every((y) => {
          const v = rby?.[y];
          return v != null && Number.isFinite(Number(v));
        });
        const rp = p[`${pre}RatePercent`];
        return yearsOk && rp != null && Number.isFinite(Number(rp));
      }
      const rp = p[`${pre}RatePercent`];
      return rp != null && Number.isFinite(Number(rp));
    };

    const revenuePerLocationGrowthComplete = (): boolean => {
      const pre = "revenuePerLocation";
      const pType = p[`${pre}GrowthPatternType`] as string | undefined;
      const proj = projectionYears.length ? projectionYears : [];
      if (pType === "phases") {
        const raw = p[`${pre}GrowthPhases`];
        const phases: GrowthPhaseV1[] = Array.isArray(raw)
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
        const rp = p[`${pre}RatePercent`];
        return ok && proj.length > 0 && rp != null && Number.isFinite(Number(rp));
      }
      if (pType === "by_year") {
        const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
        const yearsOk = proj.every((y) => {
          const v = rby?.[y];
          return v != null && Number.isFinite(Number(v));
        });
        const rp = p[`${pre}RatePercent`];
        return yearsOk && rp != null && Number.isFinite(Number(rp));
      }
      const rp = p[`${pre}RatePercent`];
      return rp != null && Number.isFinite(Number(rp));
    };

    if (locPresent && sl > 0 && !locationGrowthComplete()) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Complete the location growth setup.`,
        code: "LRPL_LOCATION_GROWTH_INCOMPLETE",
      });
    }
    if (revPerLocPresent && sr > 0 && !revenuePerLocationGrowthComplete()) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Complete the revenue per location growth setup.`,
        code: "LRPL_RPL_GROWTH_INCOMPLETE",
      });
    }
    const rplBasis = p.revenuePerLocationBasis;
    if (rplBasis != null && rplBasis !== "monthly" && rplBasis !== "annual") {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Revenue per location basis must be Monthly or Annual.`,
        code: "LRPL_RPL_BASIS_INVALID",
      });
    }
  }

  if (cfg.forecastMethod === "capacity_utilization_yield") {
    const p = params ?? {};
    const scap = Number(p.startingCapacity);
    const capPresent = p.startingCapacity != null && Number.isFinite(scap);
    if (!capPresent) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Enter a starting capacity.`,
        code: "CUY_START_CAP",
      });
    } else if (scap <= 0) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Starting capacity must be greater than 0.`,
        code: "CUY_START_CAP_POS",
      });
    }

    const su = Number(p.startingUtilizationPct);
    const utilStartPresent = p.startingUtilizationPct != null && Number.isFinite(su);
    if (!utilStartPresent) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Enter a starting utilization.`,
        code: "CUY_START_UTIL",
      });
    } else if (su < 0 || su > 100) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Starting utilization must be between 0% and 100%.`,
        code: "CUY_START_UTIL_RANGE",
      });
    }

    const sy = Number(p.startingYield);
    const yieldPresent = p.startingYield != null && Number.isFinite(sy);
    if (!yieldPresent) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Enter a starting yield.`,
        code: "CUY_START_YIELD",
      });
    } else if (sy <= 0) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Starting yield must be greater than 0.`,
        code: "CUY_START_YIELD_POS",
      });
    }

    const yieldBasis = p.yieldBasis;
    if (yieldBasis != null && yieldBasis !== "monthly" && yieldBasis !== "annual") {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Yield basis must be Monthly or Annual.`,
        code: "CUY_YIELD_BASIS_INVALID",
      });
    }

    const capacityGrowthComplete = (): boolean => {
      const pre = "capacity";
      const pType = p[`${pre}GrowthPatternType`] as string | undefined;
      const proj = projectionYears.length ? projectionYears : [];
      if (pType === "phases") {
        const raw = p[`${pre}GrowthPhases`];
        const phases: GrowthPhaseV1[] = Array.isArray(raw)
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
        const rp = p[`${pre}RatePercent`];
        return ok && proj.length > 0 && rp != null && Number.isFinite(Number(rp));
      }
      if (pType === "by_year") {
        const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
        const yearsOk = proj.every((y) => {
          const v = rby?.[y];
          return v != null && Number.isFinite(Number(v));
        });
        const rp = p[`${pre}RatePercent`];
        return yearsOk && rp != null && Number.isFinite(Number(rp));
      }
      const rp = p[`${pre}RatePercent`];
      return rp != null && Number.isFinite(Number(rp));
    };

    const yieldGrowthComplete = (): boolean => {
      const pre = "yield";
      const pType = p[`${pre}GrowthPatternType`] as string | undefined;
      const proj = projectionYears.length ? projectionYears : [];
      if (pType === "phases") {
        const raw = p[`${pre}GrowthPhases`];
        const phases: GrowthPhaseV1[] = Array.isArray(raw)
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
        const rp = p[`${pre}RatePercent`];
        return ok && proj.length > 0 && rp != null && Number.isFinite(Number(rp));
      }
      if (pType === "by_year") {
        const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
        const yearsOk = proj.every((y) => {
          const v = rby?.[y];
          return v != null && Number.isFinite(Number(v));
        });
        const rp = p[`${pre}RatePercent`];
        return yearsOk && rp != null && Number.isFinite(Number(rp));
      }
      const rp = p[`${pre}RatePercent`];
      return rp != null && Number.isFinite(Number(rp));
    };

    const utilizationSetupComplete = (): boolean => {
      const uType = p.utilizationPatternType as string | undefined;
      const proj = projectionYears.length ? projectionYears : [];
      const anchor =
        p.utilizationPct != null && Number.isFinite(Number(p.utilizationPct))
          ? Number(p.utilizationPct)
          : su;
      if (uType === "phases") {
        const raw = p.utilizationPhases;
        const phases: UtilizationPhaseV1[] = Array.isArray(raw)
          ? raw.map((x: unknown) => {
              const o = x as Record<string, unknown>;
              return {
                startYear: String(o.startYear ?? ""),
                endYear: String(o.endYear ?? ""),
                utilizationPct: Number(o.utilizationPct),
              };
            })
          : [];
        const { ok } = validateUtilizationPhases(phases, proj);
        return ok && proj.length > 0 && Number.isFinite(anchor);
      }
      if (uType === "by_year") {
        const rby = p.utilizationPctsByYear as Record<string, number> | undefined;
        const yearsOk = proj.every((y) => {
          const v = rby?.[y];
          return v != null && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100;
        });
        return yearsOk && Number.isFinite(anchor);
      }
      return Number.isFinite(anchor) && anchor >= 0 && anchor <= 100;
    };

    if (capPresent && scap > 0 && !capacityGrowthComplete()) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Complete the capacity growth setup.`,
        code: "CUY_CAPACITY_GROWTH_INCOMPLETE",
      });
    }
    if (utilStartPresent && su >= 0 && su <= 100 && !utilizationSetupComplete()) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Complete the utilization setup.`,
        code: "CUY_UTIL_INCOMPLETE",
      });
    }
    if (yieldPresent && sy > 0 && !yieldGrowthComplete()) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Complete the yield growth setup.`,
        code: "CUY_YIELD_GROWTH_INCOMPLETE",
      });
    }
  }

  if (cfg.forecastMethod === "contracts_acv") {
    const p = params ?? {};
    const sct = Number(p.startingContracts);
    const sac = Number(p.startingAcv);
    const contractsPresent = p.startingContracts != null && Number.isFinite(sct);
    if (!contractsPresent) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Enter a starting contract count.`,
        code: "CACV_START_CONTRACTS",
      });
    } else if (sct <= 0) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Starting contract count must be greater than 0.`,
        code: "CACV_START_CONTRACTS_POS",
      });
    }
    const acvPresent = p.startingAcv != null && Number.isFinite(sac);
    if (!acvPresent) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Enter a starting ACV.`,
        code: "CACV_START_ACV",
      });
    } else if (sac <= 0) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Starting ACV must be greater than 0.`,
        code: "CACV_START_ACV_POS",
      });
    }

    const contractGrowthComplete = (): boolean => {
      const pre = "contract";
      const pType = p[`${pre}GrowthPatternType`] as string | undefined;
      const proj = projectionYears.length ? projectionYears : [];
      if (pType === "phases") {
        const raw = p[`${pre}GrowthPhases`];
        const phases: GrowthPhaseV1[] = Array.isArray(raw)
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
        const rp = p[`${pre}RatePercent`];
        return ok && proj.length > 0 && rp != null && Number.isFinite(Number(rp));
      }
      if (pType === "by_year") {
        const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
        const yearsOk = proj.every((y) => {
          const v = rby?.[y];
          return v != null && Number.isFinite(Number(v));
        });
        const rp = p[`${pre}RatePercent`];
        return yearsOk && rp != null && Number.isFinite(Number(rp));
      }
      const rp = p[`${pre}RatePercent`];
      return rp != null && Number.isFinite(Number(rp));
    };

    const acvGrowthComplete = (): boolean => {
      const pre = "acv";
      const pType = p[`${pre}GrowthPatternType`] as string | undefined;
      const proj = projectionYears.length ? projectionYears : [];
      if (pType === "phases") {
        const raw = p[`${pre}GrowthPhases`];
        const phases: GrowthPhaseV1[] = Array.isArray(raw)
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
        const rp = p[`${pre}RatePercent`];
        return ok && proj.length > 0 && rp != null && Number.isFinite(Number(rp));
      }
      if (pType === "by_year") {
        const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
        const yearsOk = proj.every((y) => {
          const v = rby?.[y];
          return v != null && Number.isFinite(Number(v));
        });
        const rp = p[`${pre}RatePercent`];
        return yearsOk && rp != null && Number.isFinite(Number(rp));
      }
      const rp = p[`${pre}RatePercent`];
      return rp != null && Number.isFinite(Number(rp));
    };

    if (contractsPresent && sct > 0 && !contractGrowthComplete()) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Complete the contract growth setup.`,
        code: "CACV_CONTRACT_GROWTH_INCOMPLETE",
      });
    }
    if (acvPresent && sac > 0 && !acvGrowthComplete()) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Complete the ACV growth setup.`,
        code: "CACV_ACV_GROWTH_INCOMPLETE",
      });
    }
  }

  if (cfg.forecastMethod === "growth_rate") {
    const rawBasis = params?.startingBasis as string | undefined;
    if (rawBasis === "parent_share" || params?.parentSharePercentForBase != null) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Use "Allocate from parent" for percentage splits—not as a growth starting basis.`,
        code: "OBSOLETE_PARENT_SHARE",
      });
      return;
    }
    const basis = params?.startingBasis as GrowthStartingBasisV1 | undefined;
    const growthPatternType = params?.growthPatternType as string | undefined;
    const rby = params?.ratesByYear as Record<string, number> | undefined;
    const hasRby = rby && typeof rby === "object" && Object.keys(rby).length > 0;
    const proj = projectionYears.length ? projectionYears : Object.keys(rby ?? {});
    const legacyHistByYear =
      basis === "last_historical" && hasRby && growthPatternType !== "phases";
    const byYearStored = growthPatternType === "by_year" && hasRby;

    if (growthPatternType === "phases") {
      const raw = params?.growthPhases;
      const phases: GrowthPhaseV1[] = Array.isArray(raw)
        ? raw.map((x: unknown) => {
            const o = x as Record<string, unknown>;
            return {
              startYear: String(o.startYear ?? ""),
              endYear: String(o.endYear ?? ""),
              ratePercent: Number(o.ratePercent),
            };
          })
        : [];
      const { ok, errors: phaseErrs } = validateGrowthPhases(phases, proj);
      if (!ok) {
        for (const msg of phaseErrs) {
          errors.push({ rowId: node.id, message: `"${node.label}": ${msg}`, code: "GROWTH_PHASES_INVALID" });
        }
      }
      const rp = params?.ratePercent;
      if (rp == null || !Number.isFinite(Number(rp))) {
        errors.push({
          rowId: node.id,
          message: `"${node.label}": Growth % is required.`,
          code: "GROWTH_RATE_PCT_REQUIRED",
        });
      }
    } else if (byYearStored || legacyHistByYear) {
      const years = proj.length ? proj : Object.keys(rby ?? {});
      for (const y of years) {
        const v = rby?.[y];
        if (v == null || !Number.isFinite(Number(v))) {
          errors.push({
            rowId: node.id,
            message: `"${node.label}": By-year growth needs a rate for each projection year (${y}).`,
            code: "GROWTH_BY_YEAR_INCOMPLETE",
          });
          break;
        }
      }
      const rp = params?.ratePercent;
      if (rp == null || !Number.isFinite(Number(rp))) {
        errors.push({
          rowId: node.id,
          message: `"${node.label}": Growth % is required.`,
          code: "GROWTH_RATE_PCT_REQUIRED",
        });
      }
    } else {
      const rp = params?.ratePercent;
      if (rp == null || !Number.isFinite(Number(rp))) {
        errors.push({
          rowId: node.id,
          message: `"${node.label}": Growth % is required.`,
          code: "GROWTH_RATE_PCT_REQUIRED",
        });
      }
    }
    const lastVal = lastHistoricByRowId?.[node.id];
    const hasHistoric = typeof lastVal === "number" && !Number.isNaN(lastVal);
    const hasStarting = params?.startingAmount != null && Number.isFinite(Number(params.startingAmount));
    if (basis !== "last_historical" && basis !== "starting_amount") {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Choose growth from last historical actual or from manual starting amount.`,
        code: "GROWTH_BASIS_REQUIRED",
      });
    } else if (basis === "last_historical" && node.isForecastOnly) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Forecast-only lines cannot use growth from historical actual. Use manual starting amount, flat value, or manual by year.`,
        code: "FORECAST_ONLY_NO_HISTORICAL_GROWTH",
      });
    } else if (basis === "last_historical" && !hasHistoric) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Growth from historical requires last historical actual for this line.`,
        code: "GROWTH_HIST_NEEDS_ACTUAL",
      });
    } else if (basis === "starting_amount" && !hasStarting) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Growth from manual start requires a starting amount.`,
        code: "GROWTH_START_NEEDS_AMOUNT",
      });
    }
  }

  if (cfg.forecastMethod === "fixed_value") {
    const vByY = params?.valuesByYear as Record<string, number> | undefined;
    if (vByY && typeof vByY === "object" && Object.keys(vByY).length > 0) {
      const hasAny = Object.values(vByY).some((v) => v != null && Number.isFinite(Number(v)));
      if (!hasAny) {
        errors.push({
          rowId: node.id,
          message: `"${node.label}": Manual by year requires at least one projected year value.`,
          code: "MANUAL_BY_YEAR_NEEDS_VALUES",
        });
      }
    } else {
      const v = params?.value;
      if (v == null || !Number.isFinite(Number(v))) {
        errors.push({
          rowId: node.id,
          message: `"${node.label}": Flat value requires a numeric value.`,
          code: "FLAT_VALUE_REQUIRED",
        });
      }
    }
  }

  if (hasCh) {
    let sum = 0;
    for (const child of node.children) {
      const cCfg = rows[child.id];
      if (!cCfg) {
        errors.push({
          rowId: child.id,
          message: `Child "${child.label}" must be "Allocate from parent" under a direct-forecast row.`,
          code: "CHILD_NO_CONFIG",
        });
        continue;
      }
      if (cCfg.forecastRole !== "allocation_of_parent") {
        errors.push({
          rowId: child.id,
          message: `Under a direct-forecast row, children must be "Allocate from parent".`,
          code: "DIRECT_PARENT_NON_ALLOC_CHILD",
        });
      }
      if (cCfg.forecastMethod) {
        errors.push({ rowId: child.id, message: "Allocate-from-parent rows cannot have a forecast method.", code: "ALLOC_HAS_METHOD" });
      }
      if ((child.children?.length ?? 0) > 0) {
        errors.push({
          rowId: child.id,
          message: "Allocate-from-parent lines cannot have sub-lines.",
          code: "ALLOC_HAS_CHILDREN",
        });
      }
      const pct = cCfg.forecastParameters?.allocationPercent;
      sum += typeof pct === "number" ? pct : 0;
    }
    if (sum > 100 + REVENUE_ALLOC_SUM_TOLERANCE) {
      errors.push({
        rowId: node.id,
        message: `Split by % under "${node.label}" exceeds 100% (currently ${sum.toFixed(2)}%; reduce by ${(sum - 100).toFixed(2)}%).`,
        code: "ALLOC_SUM_OVER_100",
      });
    } else if (sum < 100 - REVENUE_ALLOC_SUM_TOLERANCE) {
      errors.push({
        rowId: node.id,
        message: `Split by % under "${node.label}" must total exactly 100% (currently ${sum.toFixed(2)}%; missing ${(100 - sum).toFixed(2)}%).`,
        code: "ALLOC_SUM_NOT_100",
      });
    }
  }
}

function validateDerivedNode(
  node: ForecastRevenueNodeV1,
  rows: Record<string, RevenueForecastRowConfigV1>,
  lastHistoricByRowId: Record<string, number> | undefined,
  errors: RevenueForecastValidationResult["errors"],
  projectionYears: string[]
): void {
  const cfg = rows[node.id];
  if (!cfg) {
    errors.push({ rowId: node.id, message: `"${node.label}" needs forecast config.`, code: "NODE_NO_CONFIG" });
    return;
  }
  if (cfg.forecastRole !== "derived_sum") return;
  if (cfg.forecastMethod) {
    errors.push({ rowId: node.id, message: "Build from child lines: no direct forecast method on this row.", code: "DERIVED_HAS_METHOD" });
  }
  if (!node.children?.length) {
    errors.push({
      rowId: node.id,
      message: `"${node.label}": Build from child lines requires at least one child.`,
      code: "DERIVED_SUM_NO_CHILDREN",
    });
    return;
  }
  for (const child of node.children) {
    validateDriverOrDerivedChild(child, node.id, rows, lastHistoricByRowId, errors, projectionYears);
  }
  if (!subtreeContributes(node, rows)) {
    errors.push({
      rowId: node.id,
      message: `"${node.label}": At least one descendant must forecast directly so the sum is defined.`,
      code: "DERIVED_NO_CONTRIBUTOR",
    });
  }
}

function validateDriverOrDerivedChild(
  node: ForecastRevenueNodeV1,
  _parentDerivedId: string,
  rows: Record<string, RevenueForecastRowConfigV1>,
  lastHistoricByRowId: Record<string, number> | undefined,
  errors: RevenueForecastValidationResult["errors"],
  projectionYears: string[]
): void {
  const cfg = rows[node.id];
  if (!cfg) {
    errors.push({ rowId: node.id, message: `"${node.label}" needs a role.`, code: "CHILD_NO_CONFIG" });
    return;
  }
  if (cfg.forecastRole === "allocation_of_parent") {
    errors.push({
      rowId: node.id,
      message: `Under "Build from child lines", use "Forecast this line directly" or "Build from child lines"—not allocation.`,
      code: "DERIVED_CHILD_ALLOCATION",
    });
    return;
  }
  if (cfg.forecastRole === "independent_driver") {
    validateIndependentLeafOrParent(node, cfg, rows, lastHistoricByRowId, errors, projectionYears);
    return;
  }
  if (cfg.forecastRole === "derived_sum") {
    validateDerivedNode(node, rows, lastHistoricByRowId, errors, projectionYears);
  }
}

export function validateRevenueForecastV1(
  incomeStatement: Row[],
  config: RevenueForecastConfigV1,
  options: ValidateRevenueForecastV1Options
): RevenueForecastValidationResult {
  const errors: RevenueForecastValidationResult["errors"] = [];
  const rev = incomeStatement.find((r) => r.id === "rev");
  if (!rev) {
    errors.push({ message: "Total Revenue row (rev) not found.", code: "NO_REV" });
    return { valid: false, errors };
  }

  const rows = config.rows ?? {};
  const revCfg = rows["rev"];
  const streams = options.forecastTree ?? [];
  const lastHistoricByRowId = options.lastHistoricByRowId;

  if (!revCfg) {
    errors.push({ rowId: "rev", message: "Total Revenue needs a forecast mode.", code: "REV_NO_CONFIG" });
    return { valid: false, errors };
  }

  if (revCfg.forecastRole === "allocation_of_parent") {
    errors.push({ rowId: "rev", message: "Total Revenue cannot be an allocation row.", code: "REV_ALLOC" });
  }

  if (revCfg.forecastRole === "derived_sum") {
    if (revCfg.forecastMethod) {
      errors.push({ rowId: "rev", message: "Build Total Revenue from lines: no method on Total Revenue.", code: "REV_DERIVED_HAS_METHOD" });
    }
    if (streams.length === 0) {
      errors.push({
        message: "Add at least one top-level line, or forecast Total Revenue directly.",
        code: "EMPTY_FORECAST_TREE",
      });
      return { valid: false, errors };
    }
    for (const stream of streams) {
      validateDriverOrDerivedChild(stream, "rev", rows, lastHistoricByRowId, errors, options.projectionYears ?? []);
    }
    if (!streams.some((s) => subtreeContributes(s, rows))) {
      errors.push({
        rowId: "rev",
        message: "At least one top-level line must forecast directly (or contain a valid build-from-children subtree).",
        code: "REV_NO_CONTRIBUTOR",
      });
    }
  } else if (revCfg.forecastRole === "independent_driver") {
    validateIndependentLeafOrParent(
      { id: "rev", label: "Total Revenue", children: streams, isForecastOnly: false },
      revCfg,
      rows,
      lastHistoricByRowId,
      errors,
      options.projectionYears ?? []
    );
  } else {
    errors.push({ rowId: "rev", message: "Total Revenue must be forecast directly or built from child lines.", code: "REV_BAD_ROLE" });
  }

  return errors.length > 0 ? { valid: false, errors } : ok();
}

export function getAllocationPercentSum(
  children: ForecastRevenueNodeV1[],
  rows: Record<string, RevenueForecastRowConfigV1>
): number {
  let sum = 0;
  for (const c of children) {
    const pct = rows[c.id]?.forecastParameters?.allocationPercent;
    sum += typeof pct === "number" ? pct : 0;
  }
  return sum;
}

export function getAllowedRolesForChild(parentRole: RevenueForecastRoleV1 | undefined): RevenueForecastRoleV1[] {
  if (parentRole === "independent_driver") return ["allocation_of_parent"];
  if (parentRole === "derived_sum") return ["independent_driver", "derived_sum"];
  return ["allocation_of_parent", "independent_driver"];
}

export function getAllowedMethodsV1(): (
  | "growth_rate"
  | "fixed_value"
  | "price_volume"
  | "customers_arpu"
  | "locations_revenue_per_location"
  | "capacity_utilization_yield"
  | "contracts_acv"
)[] {
  return [
    "growth_rate",
    "fixed_value",
    "price_volume",
    "customers_arpu",
    "locations_revenue_per_location",
    "capacity_utilization_yield",
    "contracts_acv",
  ];
}
