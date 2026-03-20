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
import { validateGrowthPhases, type GrowthPhaseV1 } from "@/lib/revenue-growth-phases-v1";

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
  if (cfg.forecastMethod !== "growth_rate" && cfg.forecastMethod !== "fixed_value" && cfg.forecastMethod !== "price_volume") {
    errors.push({ rowId: node.id, message: "Only growth, fixed-value, or Price × Volume constructions are supported.", code: "INVALID_METHOD" });
    return;
  }
  const params = cfg.forecastParameters as Record<string, unknown> | undefined;
  const hasCh = (node.children?.length ?? 0) > 0;

  if (cfg.forecastMethod === "price_volume") {
    const p = params ?? {};
    const sv = Number(p.startingVolume);
    const sp = Number(p.startingPricePerUnit);
    if (!(sv > 0 && Number.isFinite(sv))) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Price × Volume needs starting volume greater than zero.`,
        code: "PV_START_VOL",
      });
    }
    if (!(sp > 0 && Number.isFinite(sp))) {
      errors.push({
        rowId: node.id,
        message: `"${node.label}": Price × Volume needs starting price per unit greater than zero.`,
        code: "PV_START_PRICE",
      });
    }
    const validateSide = (side: "volume" | "price") => {
      const pre = side === "volume" ? "volume" : "price";
      const label = side === "volume" ? "Volume" : "Price";
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
        const { ok, errors: phaseErrs } = validateGrowthPhases(phases, proj);
        if (!ok) {
          for (const msg of phaseErrs) {
            errors.push({
              rowId: node.id,
              message: `"${node.label}": ${label} — ${msg}`,
              code: "PV_PHASES_INVALID",
            });
          }
        }
        const rp = p[`${pre}RatePercent`];
        if (rp == null || !Number.isFinite(Number(rp))) {
          errors.push({
            rowId: node.id,
            message: `"${node.label}": ${label} growth needs a valid rate.`,
            code: "PV_RATE_REQUIRED",
          });
        }
      } else if (pType === "by_year") {
        const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
        for (const y of proj) {
          const v = rby?.[y];
          if (v == null || !Number.isFinite(Number(v))) {
            errors.push({
              rowId: node.id,
              message: `"${node.label}": ${label} by-year growth needs a rate for each projection year (${y}).`,
              code: "PV_BY_YEAR_INCOMPLETE",
            });
            break;
          }
        }
        const rp = p[`${pre}RatePercent`];
        if (rp == null || !Number.isFinite(Number(rp))) {
          errors.push({
            rowId: node.id,
            message: `"${node.label}": ${label} growth needs a valid rate.`,
            code: "PV_RATE_REQUIRED",
          });
        }
      } else {
        const rp = p[`${pre}RatePercent`];
        if (rp == null || !Number.isFinite(Number(rp))) {
          errors.push({
            rowId: node.id,
            message: `"${node.label}": ${label} growth % is required.`,
            code: "PV_CONSTANT_RATE_REQUIRED",
          });
        }
      }
    };
    validateSide("volume");
    validateSide("price");
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

export function getAllowedMethodsV1(): ("growth_rate" | "fixed_value" | "price_volume")[] {
  return ["growth_rate", "fixed_value", "price_volume"];
}
