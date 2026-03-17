/**
 * Revenue Forecast v1: validation rules.
 * Enforces approved architectures: independent stream build, or parent + allocation build.
 */

import type { Row } from "@/types/finance";
import type {
  RevenueForecastConfigV1,
  RevenueForecastRowConfigV1,
  RevenueForecastRoleV1,
  RevenueForecastValidationResult,
} from "@/types/revenue-forecast-v1";

function err(message: string, rowId?: string, code?: string): RevenueForecastValidationResult {
  return { valid: false, errors: [{ rowId, message, code }] };
}

function ok(): RevenueForecastValidationResult {
  return { valid: true, errors: [] };
}

function findRowLabel(incomeStatement: Row[], rowId: string): string {
  const rev = incomeStatement.find((r) => r.id === "rev");
  if (!rev) return rowId;
  if (rev.id === rowId) return rev.label ?? rowId;
  for (const s of rev.children ?? []) {
    if (s.id === rowId) return s.label ?? rowId;
    for (const c of s.children ?? []) {
      if (c.id === rowId) return c.label ?? rowId;
    }
  }
  return rowId;
}

export interface ValidateRevenueForecastV1Options {
  /** Last historical year (e.g. "2024"). When provided with lastHistoricByRowId, growth_rate rows are checked for a base. */
  lastHistoricYear?: string;
  /** Map of rowId -> stored value for last historical year. If a growth_rate row has no entry or NaN and no startingAmount, validation fails. */
  lastHistoricByRowId?: Record<string, number>;
}

/**
 * Validate revenue tree and v1 config. Returns errors; if valid, projections can run.
 * Pass options.lastHistoricByRowId to validate that growth_rate rows have a base (last historical or starting amount).
 */
export function validateRevenueForecastV1(
  incomeStatement: Row[],
  config: RevenueForecastConfigV1,
  options?: ValidateRevenueForecastV1Options
): RevenueForecastValidationResult {
  const errors: RevenueForecastValidationResult["errors"] = [];
  const rev = incomeStatement.find((r) => r.id === "rev");
  if (!rev) {
    errors.push({ message: "Total Revenue row (rev) not found.", code: "NO_REV" });
    return { valid: false, errors };
  }

  const rows = config.rows ?? {};
  const revConfig = rows["rev"];
  const lastHistoricByRowId = options?.lastHistoricByRowId;

  // Total Revenue must be derived_sum
  if (!revConfig) {
    errors.push({ rowId: "rev", message: "Total Revenue must have a forecast role (derived_sum).", code: "REV_NO_CONFIG" });
  } else if (revConfig.forecastRole !== "derived_sum") {
    errors.push({
      rowId: "rev",
      message: "Total Revenue must be derived_sum (sum of streams).",
      code: "REV_NOT_DERIVED",
    });
  }

  // derived_sum row cannot have a method
  if (revConfig?.forecastRole === "derived_sum" && revConfig.forecastMethod) {
    errors.push({
      rowId: "rev",
      message: "A derived_sum row cannot have a forecast method.",
      code: "DERIVED_HAS_METHOD",
    });
  }

  const children = rev.children ?? [];
  const streamIds = new Set(children.map((r) => r.id));

  for (const stream of children) {
    const cfg = rows[stream.id];
    const hasChildren = (stream.children?.length ?? 0) > 0;

    if (!cfg) {
      errors.push({
        rowId: stream.id,
        message: `Revenue stream "${stream.label}" has no forecast config. Set role: independent_driver or derived_sum.`,
        code: "STREAM_NO_CONFIG",
      });
      continue;
    }

    if (cfg.forecastRole === "derived_sum") {
      if (cfg.forecastMethod) {
        errors.push({ rowId: stream.id, message: "derived_sum row cannot have a forecast method.", code: "DERIVED_HAS_METHOD" });
      }
      if (hasChildren) {
        for (const child of stream.children ?? []) {
          const childCfg = rows[child.id];
          if (childCfg && childCfg.forecastRole === "allocation_of_parent") {
            errors.push({
              rowId: child.id,
              message: "Children of a derived_sum parent must be independent_driver (forecast each child directly), not allocation_of_parent.",
              code: "DERIVED_CHILD_ALLOCATION",
            });
          }
        }
      } else {
        errors.push({
          rowId: stream.id,
          message: `"${stream.label}" is derived_sum but has no child rows. Add breakdowns and set each to independent_driver, or switch this stream to independent_driver.`,
          code: "DERIVED_SUM_NO_CHILDREN",
        });
      }
    } else if (cfg.forecastRole === "independent_driver") {
      if (hasChildren) {
        // Children must be allocation_of_parent only
        for (const child of stream.children ?? []) {
          const childCfg = rows[child.id];
          if (!childCfg) {
            errors.push({
              rowId: child.id,
              message: `Child "${child.label}" needs a forecast role (allocation_of_parent).`,
              code: "CHILD_NO_CONFIG",
            });
          } else if (childCfg.forecastRole !== "allocation_of_parent") {
            errors.push({
              rowId: child.id,
              message: "Children of an independent_driver parent must be allocation_of_parent only.",
              code: "INDEPENDENT_CHILD_NOT_ALLOC",
            });
          }
          if (childCfg?.forecastRole === "allocation_of_parent" && childCfg.forecastMethod) {
            errors.push({
              rowId: child.id,
              message: "allocation_of_parent rows cannot have an independent forecast method.",
              code: "ALLOC_HAS_METHOD",
            });
          }
        }
      }
      if (!cfg.forecastMethod) {
        errors.push({
          rowId: stream.id,
          message: "independent_driver must have a forecast method (growth_rate or fixed_value).",
          code: "INDEPENDENT_NO_METHOD",
        });
      }
      if (cfg.forecastMethod && cfg.forecastMethod !== "growth_rate" && cfg.forecastMethod !== "fixed_value") {
        errors.push({
          rowId: stream.id,
          message: "v1 supports only growth_rate or fixed_value.",
          code: "INVALID_METHOD",
        });
      }
      // Growth rate: must have last historical value or starting amount (when options provided)
      if (cfg.forecastMethod === "growth_rate" && lastHistoricByRowId) {
        const params = cfg.forecastParameters as { startingAmount?: number } | undefined;
        const lastVal = lastHistoricByRowId[stream.id];
        const hasHistoric = typeof lastVal === "number" && !Number.isNaN(lastVal);
        const hasStarting = params?.startingAmount != null && Number.isFinite(Number(params.startingAmount));
        if (!hasHistoric && !hasStarting) {
          const label = findRowLabel(incomeStatement, stream.id);
          errors.push({
            rowId: stream.id,
            message: `"${label}": Growth rate requires a historical value or starting amount. Enter a starting amount or switch to fixed/manual.`,
            code: "GROWTH_RATE_NEEDS_BASE",
          });
        }
      }
      // Fixed value manual-by-year: must have at least one projected value
      if (cfg.forecastMethod === "fixed_value") {
        const params = cfg.forecastParameters as { value?: number; valuesByYear?: Record<string, number> } | undefined;
        const valuesByYear = params?.valuesByYear;
        if (valuesByYear && typeof valuesByYear === "object" && Object.keys(valuesByYear).length > 0) {
          const hasAny = Object.values(valuesByYear).some((v) => v != null && Number.isFinite(Number(v)));
          if (!hasAny) {
            const label = findRowLabel(incomeStatement, stream.id);
            errors.push({
              rowId: stream.id,
              message: `"${label}": Manual-by-year requires at least one projected value.`,
              code: "MANUAL_BY_YEAR_NEEDS_VALUES",
            });
          }
        }
      }
    } else if (cfg.forecastRole === "allocation_of_parent") {
      // allocation_of_parent is only valid as child of a stream (not for top-level streams)
      errors.push({
        rowId: stream.id,
        message: "allocation_of_parent is only valid for child lines under a stream, not for top-level streams.",
        code: "ALLOC_AT_TOP",
      });
    }
  }

  // Allocation children: must sum to 100%
  for (const stream of children) {
    const cfg = rows[stream.id];
    if (cfg?.forecastRole !== "independent_driver") continue;
    const childList = stream.children ?? [];
    if (childList.length === 0) continue;
    let sum = 0;
    for (const child of childList) {
      const cCfg = rows[child.id];
      const pct = cCfg?.forecastParameters?.allocationPercent ?? 0;
      sum += pct;
    }
    if (Math.abs(sum - 100) > 0.01) {
      errors.push({
        rowId: stream.id,
        message: `Allocation % for children of "${stream.label}" must sum to 100% (current: ${sum.toFixed(1)}%). Set each child's allocation so the total is 100%.`,
        code: "ALLOC_SUM",
      });
    }
  }

  // derived_sum stream must have at least one child with independent_driver and a method
  for (const stream of children) {
    const cfg = rows[stream.id];
    if (cfg?.forecastRole !== "derived_sum") continue;
    const childList = stream.children ?? [];
    const validDrivers = childList.filter((c) => {
      const cCfg = rows[c.id];
      return cCfg?.forecastRole === "independent_driver" && cCfg.forecastMethod;
    });
    if (childList.length > 0 && validDrivers.length === 0) {
      errors.push({
        rowId: stream.id,
        message: `"${stream.label}" is built from breakdowns but no child has role "Forecast this breakdown directly" with a method. Set each breakdown to that role and choose growth rate or fixed value.`,
        code: "DERIVED_NO_VALID_DRIVERS",
      });
    }
    // Growth rate / fixed_value validation for children of derived_sum
    for (const child of childList) {
      const cCfg = rows[child.id];
      if (cCfg?.forecastRole !== "independent_driver" || !cCfg.forecastMethod) continue;
      if (cCfg.forecastMethod === "growth_rate" && lastHistoricByRowId) {
        const params = cCfg.forecastParameters as { startingAmount?: number } | undefined;
        const lastVal = lastHistoricByRowId[child.id];
        const hasHistoric = typeof lastVal === "number" && !Number.isNaN(lastVal);
        const hasStarting = params?.startingAmount != null && Number.isFinite(Number(params.startingAmount));
        if (!hasHistoric && !hasStarting) {
          errors.push({
            rowId: child.id,
            message: `"${child.label}": Growth rate requires a historical value or starting amount. Enter a starting amount or switch to fixed/manual.`,
            code: "GROWTH_RATE_NEEDS_BASE",
          });
        }
      }
      if (cCfg.forecastMethod === "fixed_value") {
        const params = cCfg.forecastParameters as { value?: number; valuesByYear?: Record<string, number> } | undefined;
        const valuesByYear = params?.valuesByYear;
        if (valuesByYear && typeof valuesByYear === "object" && Object.keys(valuesByYear).length > 0) {
          const hasAny = Object.values(valuesByYear).some((v) => v != null && Number.isFinite(Number(v)));
          if (!hasAny) {
            errors.push({
              rowId: child.id,
              message: `"${child.label}": Manual-by-year requires at least one projected value.`,
              code: "MANUAL_BY_YEAR_NEEDS_VALUES",
            });
          }
        }
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : ok();
}

/**
 * Get allowed forecast roles for a row given its position in the tree.
 */
export function getAllowedRolesV1(
  rowId: string,
  isTotalRev: boolean,
  isTopLevelStream: boolean,
  hasChildren: boolean
): RevenueForecastRoleV1[] {
  if (isTotalRev) return ["derived_sum"];
  if (isTopLevelStream) return ["independent_driver", "derived_sum"];
  return ["allocation_of_parent"];
}

/**
 * Allowed role(s) for a child row given the parent stream's role.
 * v1: parent independent_driver => child allocation_of_parent only; parent derived_sum => child independent_driver only.
 */
export function getAllowedRolesForChild(parentRole: RevenueForecastRoleV1 | undefined): RevenueForecastRoleV1[] {
  if (parentRole === "independent_driver") return ["allocation_of_parent"];
  if (parentRole === "derived_sum") return ["independent_driver"];
  return ["allocation_of_parent", "independent_driver"];
}

/**
 * Get allowed methods for a row (only when role is independent_driver).
 */
export function getAllowedMethodsV1(): ("growth_rate" | "fixed_value")[] {
  return ["growth_rate", "fixed_value"];
}
