"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type {
  MonetizationPeriodBasisV1,
  RevenueForecastRowConfigV1,
  UtilizationPhaseV1,
} from "@/types/revenue-forecast-v1";
import {
  getDirectForecastSubMode,
  DIRECT_METHOD_UX,
  DERIVED_PARENT_EXPLAINER,
  ALLOCATION_CHILD_EXPLAINER,
  METHODOLOGY,
  isDirectForecastConfigComplete,
  type DirectForecastSubModeV1,
} from "@/lib/revenue-forecast-v1-methodology";
import { getCurrencySymbol } from "@/lib/currency-utils";
import { formatNumberInputDisplayOnBlur } from "@/lib/revenue-forecast-numeric-format";
import { RevenueForecastDecimalInput } from "@/components/revenue-forecast-decimal-input";
import { RowStatusPill, type AllocationRowStatus } from "@/components/revenue-forecast-v1-allocation-row";
import {
  validateGrowthPhases,
  validateUtilizationPhases,
  expandPhasesToRatesByYear,
  expandUtilizationPhasesToLevelsByYear,
  GROWTH_PHASE_MESSAGES,
  type GrowthPhaseV1,
} from "@/lib/revenue-growth-phases-v1";
import { REVENUE_ALLOC_SUM_TOLERANCE } from "@/lib/revenue-forecast-v1-validation";
import { GROWTH_PHASES_UX } from "@/lib/revenue-forecast-v1-methodology";

/** Stored per-unit price → input string (absolute currency; comma-grouped when loaded). */
function perUnitPriceStoredToInputString(storedAbsolute: number): string {
  if (!Number.isFinite(storedAbsolute) || storedAbsolute <= 0) return "";
  return formatNumberInputDisplayOnBlur(String(storedAbsolute));
}

/** Format a numeric value for initial display (commas on load / after commit). */
function fmtNumericDisplay(n: number): string {
  if (!Number.isFinite(n)) return "";
  return formatNumberInputDisplayOnBlur(String(n));
}

export type HistGrowthShapeV1 = "constant" | "phases" | "by_year";

/** Utilization path: target % levels by year (not compounding growth). */
type UtilizationPathShapeV1 = "constant" | "phases" | "by_year";

export type PhaseDraftV1 = { id: string; startYear: string; endYear: string; rateStr: string };

function newPhaseId(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultFullRangePhase(projectionYears: string[], rateStr: string): PhaseDraftV1[] {
  if (!projectionYears.length) return [{ id: newPhaseId(), startYear: "", endYear: "", rateStr }];
  const a = projectionYears[0]!;
  const b = projectionYears[projectionYears.length - 1]!;
  return [{ id: newPhaseId(), startYear: a, endYear: b, rateStr }];
}

function draftsToPhases(drafts: PhaseDraftV1[]): GrowthPhaseV1[] {
  return drafts.map((d) => ({
    startYear: d.startYear,
    endYear: d.endYear,
    ratePercent: parseFloat(String(d.rateStr).replace(/,/g, "").trim()),
  }));
}

function readHistShapeFromCfg(
  cfg: RevenueForecastRowConfigV1 | undefined,
  projectionYears: string[],
  sub: DirectForecastSubModeV1,
  fallbackRateStr: string
): { histShape: HistGrowthShapeV1; histYearStrs: Record<string, string>; histPhaseRows: PhaseDraftV1[] } {
  if (sub !== "growth_from_historical") {
    return { histShape: "constant", histYearStrs: {}, histPhaseRows: defaultFullRangePhase(projectionYears, "") };
  }
  const p = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
  if (p.growthPatternType === "phases" && Array.isArray(p.growthPhases) && (p.growthPhases as unknown[]).length > 0) {
    const rows: PhaseDraftV1[] = (p.growthPhases as GrowthPhaseV1[]).map((ph, i) => ({
      id: `c-${i}-${ph.startYear}`,
      startYear: String(ph.startYear),
      endYear: String(ph.endYear),
      rateStr: fmtNumericDisplay(Number(ph.ratePercent)),
    }));
    return { histShape: "phases", histYearStrs: {}, histPhaseRows: rows };
  }
  const rby = p.ratesByYear as Record<string, number> | undefined;
  const histYearStrs: Record<string, string> = {};
  if (rby && typeof rby === "object" && Object.keys(rby).length > 0) {
    for (const y of projectionYears) {
      histYearStrs[y] =
        rby[y] != null && Number.isFinite(Number(rby[y])) ? fmtNumericDisplay(Number(rby[y])) : "";
    }
    return { histShape: "by_year", histYearStrs, histPhaseRows: defaultFullRangePhase(projectionYears, fallbackRateStr) };
  }
  return {
    histShape: "constant",
    histYearStrs: {},
    histPhaseRows: defaultFullRangePhase(projectionYears, fallbackRateStr),
  };
}

function readManualGrowthFromCfg(
  cfg: RevenueForecastRowConfigV1 | undefined,
  projectionYears: string[],
  sub: DirectForecastSubModeV1,
  fallbackRateStr: string
): {
  manualShape: HistGrowthShapeV1;
  manualYearStrs: Record<string, string>;
  manualPhaseRows: PhaseDraftV1[];
} {
  if (sub !== "growth_from_manual_start") {
    return {
      manualShape: "constant",
      manualYearStrs: {},
      manualPhaseRows: defaultFullRangePhase(projectionYears, ""),
    };
  }
  const p = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
  if (p.growthPatternType === "phases" && Array.isArray(p.growthPhases) && (p.growthPhases as unknown[]).length > 0) {
    const rows: PhaseDraftV1[] = (p.growthPhases as GrowthPhaseV1[]).map((ph, i) => ({
      id: `m-${i}-${ph.startYear}`,
      startYear: String(ph.startYear),
      endYear: String(ph.endYear),
      rateStr: fmtNumericDisplay(Number(ph.ratePercent)),
    }));
    return { manualShape: "phases", manualYearStrs: {}, manualPhaseRows: rows };
  }
  if (p.growthPatternType === "by_year") {
    const rby = p.ratesByYear as Record<string, number> | undefined;
    const manualYearStrs: Record<string, string> = {};
    for (const y of projectionYears) {
      manualYearStrs[y] =
        rby?.[y] != null && Number.isFinite(Number(rby[y])) ? fmtNumericDisplay(Number(rby[y])) : "";
    }
    return {
      manualShape: "by_year",
      manualYearStrs,
      manualPhaseRows: defaultFullRangePhase(projectionYears, fallbackRateStr),
    };
  }
  return {
    manualShape: "constant",
    manualYearStrs: Object.fromEntries(projectionYears.map((y) => [y, ""])),
    manualPhaseRows: defaultFullRangePhase(projectionYears, fallbackRateStr),
  };
}

const ALL_SUB_MODES: { id: DirectForecastSubModeV1; label: string }[] = [
  { id: "growth_from_historical", label: DIRECT_METHOD_UX.growth_from_historical.title },
  { id: "growth_from_manual_start", label: DIRECT_METHOD_UX.growth_from_manual_start.title },
  { id: "price_volume", label: DIRECT_METHOD_UX.price_volume.title },
  { id: "customers_arpu", label: DIRECT_METHOD_UX.customers_arpu.title },
  {
    id: "locations_revenue_per_location",
    label: DIRECT_METHOD_UX.locations_revenue_per_location.title,
  },
  {
    id: "capacity_utilization_yield",
    label: DIRECT_METHOD_UX.capacity_utilization_yield.title,
  },
  { id: "contracts_acv", label: DIRECT_METHOD_UX.contracts_acv.title },
  { id: "flat_value", label: DIRECT_METHOD_UX.flat_value.title },
  { id: "manual_by_year", label: DIRECT_METHOD_UX.manual_by_year.title },
];

function readTwoDriverSideFromCfg(
  cfg: RevenueForecastRowConfigV1 | undefined,
  projectionYears: string[],
  side:
    | "volume"
    | "price"
    | "customer"
    | "arpu"
    | "location"
    | "revenuePerLocation"
    | "capacity"
    | "yield"
    | "contract"
    | "acv",
  fallbackRateStr: string
): { shape: HistGrowthShapeV1; yearStrs: Record<string, string>; phaseRows: PhaseDraftV1[]; rateStr: string } {
  const p = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
  const pre = side;
  const pType = p[`${pre}GrowthPatternType`] as string | undefined;
  const phasesKey = `${pre}GrowthPhases` as const;
  if (pType === "phases" && Array.isArray(p[phasesKey]) && (p[phasesKey] as unknown[]).length > 0) {
    const rows: PhaseDraftV1[] = (p[phasesKey] as GrowthPhaseV1[]).map((ph, i) => ({
      id: `${pre}-${i}-${ph.startYear}`,
      startYear: String(ph.startYear),
      endYear: String(ph.endYear),
      rateStr: fmtNumericDisplay(Number(ph.ratePercent)),
    }));
    const rp = p[`${pre}RatePercent`];
    return {
      shape: "phases",
      yearStrs: {},
      phaseRows: rows,
      rateStr: rp != null && Number.isFinite(Number(rp)) ? fmtNumericDisplay(Number(rp)) : "",
    };
  }
  if (pType === "by_year") {
    const rby = p[`${pre}RatesByYear`] as Record<string, number> | undefined;
    const yearStrs: Record<string, string> = {};
    for (const y of projectionYears) {
      yearStrs[y] =
        rby?.[y] != null && Number.isFinite(Number(rby[y])) ? fmtNumericDisplay(Number(rby[y])) : "";
    }
    return {
      shape: "by_year",
      yearStrs,
      phaseRows: defaultFullRangePhase(projectionYears, fallbackRateStr),
      rateStr: "",
    };
  }
  const rp = p[`${pre}RatePercent`];
  const rateStr = rp != null && Number.isFinite(Number(rp)) ? fmtNumericDisplay(Number(rp)) : "";
  return {
    shape: "constant",
    yearStrs: Object.fromEntries(projectionYears.map((y) => [y, ""])),
    phaseRows: defaultFullRangePhase(projectionYears, rateStr || fallbackRateStr),
    rateStr,
  };
}

function readUtilizationPathFromCfg(
  cfg: RevenueForecastRowConfigV1 | undefined,
  projectionYears: string[]
): {
  shape: UtilizationPathShapeV1;
  yearStrs: Record<string, string>;
  phaseRows: PhaseDraftV1[];
} {
  const p = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
  const uType = (p.utilizationPatternType as string | undefined) ?? "constant";
  if (uType === "phases" && Array.isArray(p.utilizationPhases) && (p.utilizationPhases as unknown[]).length > 0) {
    const rows: PhaseDraftV1[] = (p.utilizationPhases as UtilizationPhaseV1[]).map((ph, i) => ({
      id: `util-${i}-${ph.startYear}`,
      startYear: String(ph.startYear),
      endYear: String(ph.endYear),
      rateStr: fmtNumericDisplay(Number(ph.utilizationPct)),
    }));
    return { shape: "phases", yearStrs: {}, phaseRows: rows };
  }
  if (uType === "by_year") {
    const rby = p.utilizationPctsByYear as Record<string, number> | undefined;
    const yearStrs: Record<string, string> = {};
    for (const y of projectionYears) {
      yearStrs[y] =
        rby?.[y] != null && Number.isFinite(Number(rby[y])) ? fmtNumericDisplay(Number(rby[y])) : "";
    }
    return {
      shape: "by_year",
      yearStrs,
      phaseRows: defaultFullRangePhase(projectionYears, ""),
    };
  }
  return {
    shape: "constant",
    yearStrs: Object.fromEntries(projectionYears.map((y) => [y, ""])),
    phaseRows: defaultFullRangePhase(projectionYears, ""),
  };
}

function cfgToStrings(
  cfg: RevenueForecastRowConfigV1 | undefined,
  rowId: string,
  projectionYears: string[],
  allowGrowthFromHistorical: boolean
): {
  sub: DirectForecastSubModeV1;
  growthStr: string;
  startStr: string;
  flatStr: string;
  yearStrs: Record<string, string>;
} {
  const c = cfg?.forecastMethod && cfg.forecastRole === "independent_driver" ? cfg : null;
  if (
    c?.forecastMethod === "price_volume" ||
    c?.forecastMethod === "customers_arpu" ||
    c?.forecastMethod === "locations_revenue_per_location" ||
    c?.forecastMethod === "capacity_utilization_yield" ||
    c?.forecastMethod === "contracts_acv"
  ) {
    return {
      sub: c.forecastMethod,
      growthStr: "",
      startStr: "",
      flatStr: "",
      yearStrs: {},
    };
  }
  const p = (c?.forecastParameters ?? {}) as Record<string, unknown>;
  const sub = getDirectForecastSubMode(
    (c as RevenueForecastRowConfigV1 | undefined) ??
      ({
        rowId,
        forecastRole: "independent_driver" as const,
        forecastMethod: "growth_rate" as const,
        forecastParameters: { ratePercent: 0, startingBasis: "starting_amount" as const, startingAmount: 0 },
      } satisfies RevenueForecastRowConfigV1),
    allowGrowthFromHistorical
  );
  const growthStr =
    p.ratePercent != null && Number.isFinite(Number(p.ratePercent))
      ? fmtNumericDisplay(Number(p.ratePercent))
      : "";
  const startStr =
    p.startingAmount != null && Number.isFinite(Number(p.startingAmount))
      ? fmtNumericDisplay(Number(p.startingAmount))
      : "";
  const flatStr =
    p.value != null && Number.isFinite(Number(p.value)) ? fmtNumericDisplay(Number(p.value)) : "";
  const vByY = (p.valuesByYear ?? {}) as Record<string, number>;
  const yearStrs: Record<string, string> = {};
  for (const y of projectionYears) {
    const v = vByY[y];
    yearStrs[y] =
      v != null && Number.isFinite(Number(v)) ? fmtNumericDisplay(Number(v)) : "";
  }
  return { sub, growthStr, startStr, flatStr, yearStrs };
}

function buildConfigFromForm(
  sub: DirectForecastSubModeV1,
  growthStr: string,
  startStr: string,
  flatStr: string,
  yearStrs: Record<string, string>,
  projectionYears: string[],
  rowId: string,
  histShape: HistGrowthShapeV1,
  histYearStrs: Record<string, string>,
  histPhaseRows: PhaseDraftV1[],
  manualShape: HistGrowthShapeV1,
  manualYearStrs: Record<string, string>,
  manualPhaseRows: PhaseDraftV1[]
): { config: RevenueForecastRowConfigV1; valid: boolean } {
  const g = parseFloat(String(growthStr).replace(/,/g, "").trim());
  const hasG = Number.isFinite(g);

  if (sub === "growth_from_historical") {
    if (histShape === "phases") {
      const phases = draftsToPhases(histPhaseRows);
      const { ok } = validateGrowthPhases(phases, projectionYears);
      if (!ok || projectionYears.length === 0) {
        return { valid: false, config: placeholderConfig(rowId, sub, g, projectionYears) };
      }
      const expanded = expandPhasesToRatesByYear(phases, projectionYears);
      const y0 = projectionYears[0]!;
      const rp = expanded[y0] ?? phases[0]!.ratePercent;
      return {
        valid: true,
        config: {
          rowId,
          forecastRole: "independent_driver",
          forecastMethod: "growth_rate",
          forecastParameters: {
            growthPatternType: "phases",
            growthPhases: phases,
            ratePercent: rp,
            startingBasis: "last_historical",
          },
        },
      };
    }
    if (histShape === "by_year") {
      const ratesByYear: Record<string, number> = {};
      for (const y of projectionYears) {
        const t = (histYearStrs[y] ?? "").replace(/,/g, "").trim();
        const v = parseFloat(t);
        if (!Number.isFinite(v)) {
          return { valid: false, config: placeholderConfig(rowId, sub, g, projectionYears) };
        }
        ratesByYear[y] = v;
      }
      if (projectionYears.length === 0) {
        return { valid: false, config: placeholderConfig(rowId, sub, g, projectionYears) };
      }
      const y0 = projectionYears[0]!;
      return {
        valid: true,
        config: {
          rowId,
          forecastRole: "independent_driver",
          forecastMethod: "growth_rate",
          forecastParameters: {
            growthPatternType: "by_year",
            startingBasis: "last_historical",
            ratesByYear,
            ratePercent: ratesByYear[y0] ?? 0,
          },
        },
      };
    }
    if (!hasG) return { valid: false, config: placeholderConfig(rowId, sub, g, projectionYears) };
    return {
      valid: true,
      config: {
        rowId,
        forecastRole: "independent_driver",
        forecastMethod: "growth_rate",
        forecastParameters: {
          growthPatternType: "constant",
          ratePercent: g,
          startingBasis: "last_historical",
        },
      },
    };
  }
  if (sub === "growth_from_manual_start") {
    const t = startStr.replace(/,/g, "").trim();
    const disp = parseFloat(t);
    if (!Number.isFinite(disp)) {
      return { valid: false, config: placeholderConfig(rowId, sub, g, projectionYears) };
    }
    const realAmount = disp;
    if (manualShape === "phases") {
      const phases = draftsToPhases(manualPhaseRows);
      const { ok } = validateGrowthPhases(phases, projectionYears);
      if (!ok || projectionYears.length === 0) {
        return { valid: false, config: placeholderConfig(rowId, sub, g, projectionYears) };
      }
      const expanded = expandPhasesToRatesByYear(phases, projectionYears);
      const y0 = projectionYears[0]!;
      const rp = expanded[y0] ?? phases[0]!.ratePercent;
      return {
        valid: true,
        config: {
          rowId,
          forecastRole: "independent_driver",
          forecastMethod: "growth_rate",
          forecastParameters: {
            growthPatternType: "phases",
            growthPhases: phases,
            ratePercent: rp,
            startingBasis: "starting_amount",
            startingAmount: realAmount,
          },
        },
      };
    }
    if (manualShape === "by_year") {
      const ratesByYear: Record<string, number> = {};
      for (const y of projectionYears) {
        const tt = (manualYearStrs[y] ?? "").replace(/,/g, "").trim();
        const v = parseFloat(tt);
        if (!Number.isFinite(v)) {
          return { valid: false, config: placeholderConfig(rowId, sub, g, projectionYears) };
        }
        ratesByYear[y] = v;
      }
      if (projectionYears.length === 0) {
        return { valid: false, config: placeholderConfig(rowId, sub, g, projectionYears) };
      }
      const y0 = projectionYears[0]!;
      return {
        valid: true,
        config: {
          rowId,
          forecastRole: "independent_driver",
          forecastMethod: "growth_rate",
          forecastParameters: {
            growthPatternType: "by_year",
            startingBasis: "starting_amount",
            startingAmount: realAmount,
            ratesByYear,
            ratePercent: ratesByYear[y0] ?? 0,
          },
        },
      };
    }
    if (!hasG) return { valid: false, config: placeholderConfig(rowId, sub, g, projectionYears) };
    return {
      valid: true,
      config: {
        rowId,
        forecastRole: "independent_driver",
        forecastMethod: "growth_rate",
        forecastParameters: {
          growthPatternType: "constant",
          ratePercent: g,
          startingBasis: "starting_amount",
          startingAmount: realAmount,
        },
      },
    };
  }
  if (sub === "flat_value") {
    const t = flatStr.replace(/,/g, "").trim();
    const disp = parseFloat(t);
    if (!Number.isFinite(disp))
      return { valid: false, config: placeholderConfig(rowId, sub, g, projectionYears) };
    return {
      valid: true,
      config: {
        rowId,
        forecastRole: "independent_driver",
        forecastMethod: "fixed_value",
        forecastParameters: { value: disp },
      },
    };
  }
  const valuesByYear: Record<string, number> = {};
  let any = false;
  for (const y of projectionYears) {
    const t = (yearStrs[y] ?? "").replace(/,/g, "").trim();
    if (t === "") continue;
    const disp = parseFloat(t);
    if (Number.isFinite(disp)) {
      valuesByYear[y] = disp;
      any = true;
    }
  }
  if (!any) return { valid: false, config: placeholderConfig(rowId, sub, g, projectionYears) };
  return {
    valid: true,
    config: {
      rowId,
      forecastRole: "independent_driver",
      forecastMethod: "fixed_value",
      forecastParameters: { valuesByYear },
    },
  };
}

function buildPriceVolumeConfig(
  rowId: string,
  projectionYears: string[],
  volStartStr: string,
  priceStartStr: string,
  volumeUnitLabelStr: string,
  volShape: HistGrowthShapeV1,
  volGrowthStr: string,
  volYearStrs: Record<string, string>,
  volPhaseRows: PhaseDraftV1[],
  priceShape: HistGrowthShapeV1,
  priceGrowthStr: string,
  priceYearStrs: Record<string, string>,
  pricePhaseRows: PhaseDraftV1[]
): { valid: boolean; config: RevenueForecastRowConfigV1 } {
  const bad = (): RevenueForecastRowConfigV1 => ({
    rowId,
    forecastRole: "independent_driver",
    forecastMethod: "price_volume",
    forecastParameters: {
      startingVolume: 0,
      startingPricePerUnit: 0,
      volumeGrowthPatternType: "constant",
      volumeRatePercent: 0,
      priceGrowthPatternType: "constant",
      priceRatePercent: 0,
    },
  });

  const volParsed = parseFloat(String(volStartStr).replace(/,/g, "").trim());
  if (!Number.isFinite(volParsed) || volParsed <= 0) {
    return { valid: false, config: bad() };
  }
  const priceDisp = parseFloat(String(priceStartStr).replace(/,/g, "").trim());
  if (!Number.isFinite(priceDisp) || priceDisp <= 0) {
    return { valid: false, config: bad() };
  }
  /** Absolute price per unit — do not apply statement display-unit (K/M) scaling. */
  const startingPricePerUnit = priceDisp;

  const buildSide = (
    side: "volume" | "price",
    shape: HistGrowthShapeV1,
    gStr: string,
    yStrs: Record<string, string>,
    phRows: PhaseDraftV1[]
  ): { ok: boolean; params: Record<string, unknown> } => {
    const prefix = side === "volume" ? "volume" : "price";
    const g = parseFloat(String(gStr).replace(/,/g, "").trim());
    const hasG = Number.isFinite(g);
    if (shape === "phases") {
      const phases = draftsToPhases(phRows);
      const { ok } = validateGrowthPhases(phases, projectionYears);
      if (!ok || projectionYears.length === 0) return { ok: false, params: {} };
      const expanded = expandPhasesToRatesByYear(phases, projectionYears);
      const y0 = projectionYears[0]!;
      const rp = expanded[y0] ?? phases[0]!.ratePercent;
      return {
        ok: true,
        params: {
          [`${prefix}GrowthPatternType`]: "phases",
          [`${prefix}GrowthPhases`]: phases,
          [`${prefix}RatePercent`]: rp,
        },
      };
    }
    if (shape === "by_year") {
      const ratesByYear: Record<string, number> = {};
      for (const y of projectionYears) {
        const t = (yStrs[y] ?? "").replace(/,/g, "").trim();
        const v = parseFloat(t);
        if (!Number.isFinite(v)) return { ok: false, params: {} };
        ratesByYear[y] = v;
      }
      if (projectionYears.length === 0) return { ok: false, params: {} };
      const y0 = projectionYears[0]!;
      return {
        ok: true,
        params: {
          [`${prefix}GrowthPatternType`]: "by_year",
          [`${prefix}RatesByYear`]: ratesByYear,
          [`${prefix}RatePercent`]: ratesByYear[y0] ?? 0,
        },
      };
    }
    if (!hasG) return { ok: false, params: {} };
    return {
      ok: true,
      params: {
        [`${prefix}GrowthPatternType`]: "constant",
        [`${prefix}RatePercent`]: g,
      },
    };
  };

  const vSide = buildSide("volume", volShape, volGrowthStr, volYearStrs, volPhaseRows);
  const pSide = buildSide("price", priceShape, priceGrowthStr, priceYearStrs, pricePhaseRows);
  if (!vSide.ok || !pSide.ok) return { valid: false, config: bad() };

  const labelTrim = String(volumeUnitLabelStr).trim().slice(0, 64);

  return {
    valid: true,
    config: {
      rowId,
      forecastRole: "independent_driver",
      forecastMethod: "price_volume",
      forecastParameters: {
        startingVolume: volParsed,
        startingPricePerUnit,
        ...(labelTrim ? { volumeUnitLabel: labelTrim } : {}),
        ...vSide.params,
        ...pSide.params,
      },
    },
  };
}

function buildContractsAcvConfig(
  rowId: string,
  projectionYears: string[],
  contractsStartStr: string,
  acvStartStr: string,
  contractUnitLabelStr: string,
  contractShape: HistGrowthShapeV1,
  contractGrowthStr: string,
  contractYearStrs: Record<string, string>,
  contractPhaseRows: PhaseDraftV1[],
  acvShape: HistGrowthShapeV1,
  acvGrowthStr: string,
  acvYearStrs: Record<string, string>,
  acvPhaseRows: PhaseDraftV1[]
): { valid: boolean; config: RevenueForecastRowConfigV1 } {
  const bad = (): RevenueForecastRowConfigV1 => ({
    rowId,
    forecastRole: "independent_driver",
    forecastMethod: "contracts_acv",
    forecastParameters: {
      startingContracts: 0,
      startingAcv: 0,
      contractGrowthPatternType: "constant",
      contractRatePercent: 0,
      acvGrowthPatternType: "constant",
      acvRatePercent: 0,
    },
  });

  const contractsParsed = parseFloat(String(contractsStartStr).replace(/,/g, "").trim());
  if (!Number.isFinite(contractsParsed) || contractsParsed <= 0) {
    return { valid: false, config: bad() };
  }
  const acvDisp = parseFloat(String(acvStartStr).replace(/,/g, "").trim());
  if (!Number.isFinite(acvDisp) || acvDisp <= 0) {
    return { valid: false, config: bad() };
  }
  const startingAcv = acvDisp;

  const buildSide = (
    side: "contract" | "acv",
    shape: HistGrowthShapeV1,
    gStr: string,
    yStrs: Record<string, string>,
    phRows: PhaseDraftV1[]
  ): { ok: boolean; params: Record<string, unknown> } => {
    const prefix = side;
    const g = parseFloat(String(gStr).replace(/,/g, "").trim());
    const hasG = Number.isFinite(g);
    if (shape === "phases") {
      const phases = draftsToPhases(phRows);
      const { ok } = validateGrowthPhases(phases, projectionYears);
      if (!ok || projectionYears.length === 0) return { ok: false, params: {} };
      const expanded = expandPhasesToRatesByYear(phases, projectionYears);
      const y0 = projectionYears[0]!;
      const rp = expanded[y0] ?? phases[0]!.ratePercent;
      return {
        ok: true,
        params: {
          [`${prefix}GrowthPatternType`]: "phases",
          [`${prefix}GrowthPhases`]: phases,
          [`${prefix}RatePercent`]: rp,
        },
      };
    }
    if (shape === "by_year") {
      const ratesByYear: Record<string, number> = {};
      for (const y of projectionYears) {
        const t = (yStrs[y] ?? "").replace(/,/g, "").trim();
        const v = parseFloat(t);
        if (!Number.isFinite(v)) return { ok: false, params: {} };
        ratesByYear[y] = v;
      }
      if (projectionYears.length === 0) return { ok: false, params: {} };
      const y0 = projectionYears[0]!;
      return {
        ok: true,
        params: {
          [`${prefix}GrowthPatternType`]: "by_year",
          [`${prefix}RatesByYear`]: ratesByYear,
          [`${prefix}RatePercent`]: ratesByYear[y0] ?? 0,
        },
      };
    }
    if (!hasG) return { ok: false, params: {} };
    return {
      ok: true,
      params: {
        [`${prefix}GrowthPatternType`]: "constant",
        [`${prefix}RatePercent`]: g,
      },
    };
  };

  const cSide = buildSide("contract", contractShape, contractGrowthStr, contractYearStrs, contractPhaseRows);
  const aSide = buildSide("acv", acvShape, acvGrowthStr, acvYearStrs, acvPhaseRows);
  if (!cSide.ok || !aSide.ok) return { valid: false, config: bad() };

  const labelTrim = String(contractUnitLabelStr).trim().slice(0, 64);

  return {
    valid: true,
    config: {
      rowId,
      forecastRole: "independent_driver",
      forecastMethod: "contracts_acv",
      forecastParameters: {
        startingContracts: contractsParsed,
        startingAcv,
        ...(labelTrim ? { contractUnitLabel: labelTrim } : {}),
        ...cSide.params,
        ...aSide.params,
      },
    },
  };
}

function buildCustomersArpuConfig(
  rowId: string,
  projectionYears: string[],
  customersStartStr: string,
  arpuStartStr: string,
  customerUnitLabelStr: string,
  customerShape: HistGrowthShapeV1,
  customerGrowthStr: string,
  customerYearStrs: Record<string, string>,
  customerPhaseRows: PhaseDraftV1[],
  arpuShape: HistGrowthShapeV1,
  arpuGrowthStr: string,
  arpuYearStrs: Record<string, string>,
  arpuPhaseRows: PhaseDraftV1[],
  arpuBasis: MonetizationPeriodBasisV1
): { valid: boolean; config: RevenueForecastRowConfigV1 } {
  const bad = (): RevenueForecastRowConfigV1 => ({
    rowId,
    forecastRole: "independent_driver",
    forecastMethod: "customers_arpu",
    forecastParameters: {
      startingCustomers: 0,
      startingArpu: 0,
      arpuBasis: "annual",
      customerGrowthPatternType: "constant",
      customerRatePercent: 0,
      arpuGrowthPatternType: "constant",
      arpuRatePercent: 0,
    },
  });

  const customersParsed = parseFloat(String(customersStartStr).replace(/,/g, "").trim());
  if (!Number.isFinite(customersParsed) || customersParsed <= 0) {
    return { valid: false, config: bad() };
  }
  const arpuParsed = parseFloat(String(arpuStartStr).replace(/,/g, "").trim());
  if (!Number.isFinite(arpuParsed) || arpuParsed <= 0) {
    return { valid: false, config: bad() };
  }

  const buildSide = (
    side: "customer" | "arpu",
    shape: HistGrowthShapeV1,
    gStr: string,
    yStrs: Record<string, string>,
    phRows: PhaseDraftV1[]
  ): { ok: boolean; params: Record<string, unknown> } => {
    const prefix = side;
    const g = parseFloat(String(gStr).replace(/,/g, "").trim());
    const hasG = Number.isFinite(g);
    if (shape === "phases") {
      const phases = draftsToPhases(phRows);
      const { ok } = validateGrowthPhases(phases, projectionYears);
      if (!ok || projectionYears.length === 0) return { ok: false, params: {} };
      const expanded = expandPhasesToRatesByYear(phases, projectionYears);
      const y0 = projectionYears[0]!;
      const rp = expanded[y0] ?? phases[0]!.ratePercent;
      return {
        ok: true,
        params: {
          [`${prefix}GrowthPatternType`]: "phases",
          [`${prefix}GrowthPhases`]: phases,
          [`${prefix}RatePercent`]: rp,
        },
      };
    }
    if (shape === "by_year") {
      const ratesByYear: Record<string, number> = {};
      for (const y of projectionYears) {
        const t = (yStrs[y] ?? "").replace(/,/g, "").trim();
        const v = parseFloat(t);
        if (!Number.isFinite(v)) return { ok: false, params: {} };
        ratesByYear[y] = v;
      }
      if (projectionYears.length === 0) return { ok: false, params: {} };
      const y0 = projectionYears[0]!;
      return {
        ok: true,
        params: {
          [`${prefix}GrowthPatternType`]: "by_year",
          [`${prefix}RatesByYear`]: ratesByYear,
          [`${prefix}RatePercent`]: ratesByYear[y0] ?? 0,
        },
      };
    }
    if (!hasG) return { ok: false, params: {} };
    return {
      ok: true,
      params: {
        [`${prefix}GrowthPatternType`]: "constant",
        [`${prefix}RatePercent`]: g,
      },
    };
  };

  const cSide = buildSide("customer", customerShape, customerGrowthStr, customerYearStrs, customerPhaseRows);
  const aSide = buildSide("arpu", arpuShape, arpuGrowthStr, arpuYearStrs, arpuPhaseRows);
  if (!cSide.ok || !aSide.ok) return { valid: false, config: bad() };

  const labelTrim = String(customerUnitLabelStr).trim().slice(0, 64);

  return {
    valid: true,
    config: {
      rowId,
      forecastRole: "independent_driver",
      forecastMethod: "customers_arpu",
      forecastParameters: {
        startingCustomers: customersParsed,
        startingArpu: arpuParsed,
        arpuBasis,
        ...(labelTrim ? { customerUnitLabel: labelTrim } : {}),
        ...cSide.params,
        ...aSide.params,
      },
    },
  };
}

function buildLocationsRevenuePerLocationConfig(
  rowId: string,
  projectionYears: string[],
  locationsStartStr: string,
  revenuePerLocationStartStr: string,
  locationUnitLabelStr: string,
  locationShape: HistGrowthShapeV1,
  locationGrowthStr: string,
  locationYearStrs: Record<string, string>,
  locationPhaseRows: PhaseDraftV1[],
  revenuePerLocationShape: HistGrowthShapeV1,
  revenuePerLocationGrowthStr: string,
  revenuePerLocationYearStrs: Record<string, string>,
  revenuePerLocationPhaseRows: PhaseDraftV1[],
  revenuePerLocationBasis: MonetizationPeriodBasisV1
): { valid: boolean; config: RevenueForecastRowConfigV1 } {
  const bad = (): RevenueForecastRowConfigV1 => ({
    rowId,
    forecastRole: "independent_driver",
    forecastMethod: "locations_revenue_per_location",
    forecastParameters: {
      startingLocations: 0,
      startingRevenuePerLocation: 0,
      revenuePerLocationBasis: "annual",
      locationGrowthPatternType: "constant",
      locationRatePercent: 0,
      revenuePerLocationGrowthPatternType: "constant",
      revenuePerLocationRatePercent: 0,
    },
  });

  const locationsParsed = parseFloat(String(locationsStartStr).replace(/,/g, "").trim());
  if (!Number.isFinite(locationsParsed) || locationsParsed <= 0) {
    return { valid: false, config: bad() };
  }
  const revenuePerLocationParsed = parseFloat(
    String(revenuePerLocationStartStr).replace(/,/g, "").trim()
  );
  if (!Number.isFinite(revenuePerLocationParsed) || revenuePerLocationParsed <= 0) {
    return { valid: false, config: bad() };
  }

  const buildSide = (
    side: "location" | "revenuePerLocation",
    shape: HistGrowthShapeV1,
    gStr: string,
    yStrs: Record<string, string>,
    phRows: PhaseDraftV1[]
  ): { ok: boolean; params: Record<string, unknown> } => {
    const prefix = side;
    const g = parseFloat(String(gStr).replace(/,/g, "").trim());
    const hasG = Number.isFinite(g);
    if (shape === "phases") {
      const phases = draftsToPhases(phRows);
      const { ok } = validateGrowthPhases(phases, projectionYears);
      if (!ok || projectionYears.length === 0) return { ok: false, params: {} };
      const expanded = expandPhasesToRatesByYear(phases, projectionYears);
      const y0 = projectionYears[0]!;
      const rp = expanded[y0] ?? phases[0]!.ratePercent;
      return {
        ok: true,
        params: {
          [`${prefix}GrowthPatternType`]: "phases",
          [`${prefix}GrowthPhases`]: phases,
          [`${prefix}RatePercent`]: rp,
        },
      };
    }
    if (shape === "by_year") {
      const ratesByYear: Record<string, number> = {};
      for (const y of projectionYears) {
        const t = (yStrs[y] ?? "").replace(/,/g, "").trim();
        const v = parseFloat(t);
        if (!Number.isFinite(v)) return { ok: false, params: {} };
        ratesByYear[y] = v;
      }
      if (projectionYears.length === 0) return { ok: false, params: {} };
      const y0 = projectionYears[0]!;
      return {
        ok: true,
        params: {
          [`${prefix}GrowthPatternType`]: "by_year",
          [`${prefix}RatesByYear`]: ratesByYear,
          [`${prefix}RatePercent`]: ratesByYear[y0] ?? 0,
        },
      };
    }
    if (!hasG) return { ok: false, params: {} };
    return {
      ok: true,
      params: {
        [`${prefix}GrowthPatternType`]: "constant",
        [`${prefix}RatePercent`]: g,
      },
    };
  };

  const lSide = buildSide(
    "location",
    locationShape,
    locationGrowthStr,
    locationYearStrs,
    locationPhaseRows
  );
  const rplSide = buildSide(
    "revenuePerLocation",
    revenuePerLocationShape,
    revenuePerLocationGrowthStr,
    revenuePerLocationYearStrs,
    revenuePerLocationPhaseRows
  );
  if (!lSide.ok || !rplSide.ok) return { valid: false, config: bad() };

  const labelTrim = String(locationUnitLabelStr).trim().slice(0, 64);
  return {
    valid: true,
    config: {
      rowId,
      forecastRole: "independent_driver",
      forecastMethod: "locations_revenue_per_location",
      forecastParameters: {
        startingLocations: locationsParsed,
        startingRevenuePerLocation: revenuePerLocationParsed,
        revenuePerLocationBasis,
        ...(labelTrim ? { locationUnitLabel: labelTrim } : {}),
        ...lSide.params,
        ...rplSide.params,
      },
    },
  };
}

function buildCapacityUtilizationYieldConfig(
  rowId: string,
  projectionYears: string[],
  capacityStartStr: string,
  capacityUnitLabelStr: string,
  capacityShape: HistGrowthShapeV1,
  capacityGrowthStr: string,
  capacityYearStrs: Record<string, string>,
  capacityPhaseRows: PhaseDraftV1[],
  utilizationStartStr: string,
  utilShape: UtilizationPathShapeV1,
  utilYearStrs: Record<string, string>,
  utilPhaseRows: PhaseDraftV1[],
  yieldStartStr: string,
  yieldShape: HistGrowthShapeV1,
  yieldGrowthStr: string,
  yieldYearStrs: Record<string, string>,
  yieldPhaseRows: PhaseDraftV1[],
  yieldBasis: MonetizationPeriodBasisV1
): { valid: boolean; config: RevenueForecastRowConfigV1 } {
  const bad = (): RevenueForecastRowConfigV1 => ({
    rowId,
    forecastRole: "independent_driver",
    forecastMethod: "capacity_utilization_yield",
    forecastParameters: {
      startingCapacity: 0,
      startingUtilizationPct: 0,
      startingYield: 0,
      yieldBasis: "annual",
      capacityGrowthPatternType: "constant",
      capacityRatePercent: 0,
      utilizationPatternType: "constant",
      utilizationPct: 0,
      yieldGrowthPatternType: "constant",
      yieldRatePercent: 0,
    },
  });

  const capParsed = parseFloat(String(capacityStartStr).replace(/,/g, "").trim());
  if (!Number.isFinite(capParsed) || capParsed <= 0) {
    return { valid: false, config: bad() };
  }
  const utilParsed = parseFloat(String(utilizationStartStr).replace(/,/g, "").trim());
  if (!Number.isFinite(utilParsed) || utilParsed < 0 || utilParsed > 100) {
    return { valid: false, config: bad() };
  }
  const yieldParsed = parseFloat(String(yieldStartStr).replace(/,/g, "").trim());
  if (!Number.isFinite(yieldParsed) || yieldParsed <= 0) {
    return { valid: false, config: bad() };
  }

  const buildGrowthSide = (
    side: "capacity" | "yield",
    shape: HistGrowthShapeV1,
    gStr: string,
    yStrs: Record<string, string>,
    phRows: PhaseDraftV1[]
  ): { ok: boolean; params: Record<string, unknown> } => {
    const prefix = side;
    const g = parseFloat(String(gStr).replace(/,/g, "").trim());
    const hasG = Number.isFinite(g);
    if (shape === "phases") {
      const phases = draftsToPhases(phRows);
      const { ok } = validateGrowthPhases(phases, projectionYears);
      if (!ok || projectionYears.length === 0) return { ok: false, params: {} };
      const expanded = expandPhasesToRatesByYear(phases, projectionYears);
      const y0 = projectionYears[0]!;
      const rp = expanded[y0] ?? phases[0]!.ratePercent;
      return {
        ok: true,
        params: {
          [`${prefix}GrowthPatternType`]: "phases",
          [`${prefix}GrowthPhases`]: phases,
          [`${prefix}RatePercent`]: rp,
        },
      };
    }
    if (shape === "by_year") {
      const ratesByYear: Record<string, number> = {};
      for (const y of projectionYears) {
        const t = (yStrs[y] ?? "").replace(/,/g, "").trim();
        const v = parseFloat(t);
        if (!Number.isFinite(v)) return { ok: false, params: {} };
        ratesByYear[y] = v;
      }
      if (projectionYears.length === 0) return { ok: false, params: {} };
      const y0 = projectionYears[0]!;
      return {
        ok: true,
        params: {
          [`${prefix}GrowthPatternType`]: "by_year",
          [`${prefix}RatesByYear`]: ratesByYear,
          [`${prefix}RatePercent`]: ratesByYear[y0] ?? 0,
        },
      };
    }
    if (!hasG) return { ok: false, params: {} };
    return {
      ok: true,
      params: {
        [`${prefix}GrowthPatternType`]: "constant",
        [`${prefix}RatePercent`]: g,
      },
    };
  };

  const buildUtilParams = (): { ok: boolean; params: Record<string, unknown> } => {
    if (utilShape === "phases") {
      const phases: UtilizationPhaseV1[] = utilPhaseRows.map((d) => ({
        startYear: d.startYear,
        endYear: d.endYear,
        utilizationPct: parseFloat(String(d.rateStr).replace(/,/g, "").trim()),
      }));
      const { ok } = validateUtilizationPhases(phases, projectionYears);
      if (!ok || projectionYears.length === 0) return { ok: false, params: {} };
      const expanded = expandUtilizationPhasesToLevelsByYear(phases, projectionYears);
      const y0 = projectionYears[0]!;
      const anchor = expanded[y0] ?? phases[0]!.utilizationPct;
      return {
        ok: true,
        params: {
          utilizationPatternType: "phases",
          utilizationPhases: phases,
          utilizationPct: anchor,
        },
      };
    }
    if (utilShape === "by_year") {
      const utilizationPctsByYear: Record<string, number> = {};
      for (const y of projectionYears) {
        const t = (utilYearStrs[y] ?? "").replace(/,/g, "").trim();
        const v = parseFloat(t);
        if (!Number.isFinite(v) || v < 0 || v > 100) return { ok: false, params: {} };
        utilizationPctsByYear[y] = v;
      }
      if (projectionYears.length === 0) return { ok: false, params: {} };
      const y0 = projectionYears[0]!;
      return {
        ok: true,
        params: {
          utilizationPatternType: "by_year",
          utilizationPctsByYear,
          utilizationPct: utilizationPctsByYear[y0] ?? utilParsed,
        },
      };
    }
    return {
      ok: true,
      params: {
        utilizationPatternType: "constant",
        utilizationPct: utilParsed,
      },
    };
  };

  const capSide = buildGrowthSide(
    "capacity",
    capacityShape,
    capacityGrowthStr,
    capacityYearStrs,
    capacityPhaseRows
  );
  const ySide = buildGrowthSide("yield", yieldShape, yieldGrowthStr, yieldYearStrs, yieldPhaseRows);
  const uSide = buildUtilParams();
  if (!capSide.ok || !ySide.ok || !uSide.ok) return { valid: false, config: bad() };

  const labelTrim = String(capacityUnitLabelStr).trim().slice(0, 64);

  return {
    valid: true,
    config: {
      rowId,
      forecastRole: "independent_driver",
      forecastMethod: "capacity_utilization_yield",
      forecastParameters: {
        startingCapacity: capParsed,
        startingUtilizationPct: utilParsed,
        startingYield: yieldParsed,
        yieldBasis,
        ...(labelTrim ? { capacityUnitLabel: labelTrim } : {}),
        ...capSide.params,
        ...uSide.params,
        ...ySide.params,
      },
    },
  };
}

function placeholderConfig(
  rowId: string,
  sub: DirectForecastSubModeV1,
  g: number,
  projectionYears: string[]
): RevenueForecastRowConfigV1 {
  if (sub === "growth_from_historical" || sub === "growth_from_manual_start") {
    return {
      rowId,
      forecastRole: "independent_driver",
      forecastMethod: "growth_rate",
      forecastParameters:
        sub === "growth_from_historical"
          ? { ratePercent: hasG(g) ? g : 0, startingBasis: "last_historical" }
          : { ratePercent: hasG(g) ? g : 0, startingBasis: "starting_amount", startingAmount: 0 },
    };
  }
  if (sub === "flat_value") {
    return {
      rowId,
      forecastRole: "independent_driver",
      forecastMethod: "fixed_value",
      forecastParameters: { value: 0 },
    };
  }
  return {
    rowId,
    forecastRole: "independent_driver",
    forecastMethod: "fixed_value",
    forecastParameters: {
      valuesByYear: Object.fromEntries(projectionYears.map((y) => [y, 0])),
    },
  };
}

function hasG(g: number) {
  return Number.isFinite(g);
}

function configsMatchStore(a: RevenueForecastRowConfigV1, cfg: RevenueForecastRowConfigV1 | undefined): boolean {
  if (!cfg?.forecastMethod || cfg.forecastRole !== "independent_driver") return false;
  return (
    a.forecastMethod === cfg.forecastMethod &&
    JSON.stringify(a.forecastParameters) === JSON.stringify(cfg.forecastParameters)
  );
}

function uncoveredBlocks(projectionYears: string[], rows: PhaseDraftV1[]): string[][] {
  const covered = new Set<string>();
  for (const r of rows) {
    if (!r.startYear || !r.endYear) continue;
    for (const y of projectionYears) {
      if (y >= r.startYear && y <= r.endYear) covered.add(y);
    }
  }
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const y of projectionYears) {
    if (covered.has(y)) {
      if (cur.length) {
        blocks.push(cur);
        cur = [];
      }
    } else {
      cur.push(y);
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** 4-column grid: From | To | Growth % | Action — min-width avoids overlap on narrow containers */
const PHASE_ROW_GRID =
  "grid w-full min-w-[min(100%,520px)] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5.5rem_2.75rem] gap-x-3 gap-y-2 items-center";

function GrowthPhaseEditor(props: {
  phaseRows: PhaseDraftV1[];
  setPhaseRows: (fn: (prev: PhaseDraftV1[]) => PhaseDraftV1[]) => void;
  projectionYears: string[];
  inp: string;
  /** Header for the numeric column (default: growth %). */
  rateColumnLabel?: string;
  /** Shown after adding a phase. */
  afterAddHint?: string;
  /** Tooltip for “fill remaining” action. */
  fillRemainingTitle?: string;
}) {
  const {
    phaseRows,
    setPhaseRows,
    projectionYears,
    inp,
    rateColumnLabel = "Growth %",
    afterAddHint = "New phase added — review years and growth % if needed.",
    fillRemainingTitle = "Fills any missing forecast years using the last growth rate.",
  } = props;
  const yearOpts = projectionYears;
  const [highlightedPhaseId, setHighlightedPhaseId] = useState<string | null>(null);
  const [fillSuccess, setFillSuccess] = useState(false);
  const yearIndex = useMemo(
    () => Object.fromEntries(projectionYears.map((y, i) => [y, i])) as Record<string, number>,
    [projectionYears]
  );
  const uncovered = useMemo(() => uncoveredBlocks(projectionYears, phaseRows), [projectionYears, phaseRows]);
  const firstUncoveredYear = uncovered[0]?.[0] ?? null;
  const allYearsCovered = uncovered.length === 0;

  const addPhase = () => {
    setPhaseRows((prev) => {
      if (prev.length >= 4) return prev;
      if (prev.length === 0) {
        if (projectionYears.length === 0) return prev;
        return [
          {
            id: newPhaseId(),
            startYear: projectionYears[0]!,
            endYear: projectionYears[projectionYears.length - 1]!,
            rateStr: "",
          },
        ];
      }
      const blocks = uncoveredBlocks(projectionYears, prev);
      if (!blocks.length) return prev;
      const b = blocks[0]!;
      return [
        ...prev,
        { id: newPhaseId(), startYear: b[0]!, endYear: b[b.length - 1]!, rateStr: "" },
      ];
    });
  };

  const fillRemainingWithLastRate = () => {
    let addedId: string | null = null;
    setPhaseRows((prev) => {
      const blocks = uncoveredBlocks(projectionYears, prev);
      if (!blocks.length) return prev;
      const b = blocks[0]!;
      const lastRate = prev.length > 0 ? String(prev[prev.length - 1]!.rateStr ?? "").trim() : "";
      addedId = newPhaseId();
      return [
        ...prev,
        { id: addedId!, startYear: b[0]!, endYear: b[b.length - 1]!, rateStr: lastRate },
      ];
    });
    if (addedId) {
      setHighlightedPhaseId(addedId);
      setFillSuccess(true);
      window.setTimeout(() => setHighlightedPhaseId(null), 2400);
      window.setTimeout(() => setFillSuccess(false), 2000);
    }
  };

  const sel =
    "min-w-0 w-full rounded border border-slate-600 bg-slate-900 text-xs text-slate-200 px-2 py-2 shrink-0";
  const pctInp = `${inp} min-w-0 w-full max-w-[5.5rem] justify-self-stretch`;
  const finalYear = projectionYears[projectionYears.length - 1] ?? "";
  const updatePhaseStartYear = useCallback(
    (rowId: string, value: string) => {
      setPhaseRows((rows) =>
        rows.map((r) => {
          if (r.id !== rowId) return r;
          return {
            ...r,
            startYear: value,
            endYear: r.endYear < value ? value : r.endYear,
          };
        })
      );
    },
    [setPhaseRows]
  );
  const updatePhaseEndYear = useCallback(
    (rowId: string, value: string) => {
      setPhaseRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, endYear: value } : r)));
    },
    [setPhaseRows]
  );
  const updatePhaseRate = useCallback(
    (rowId: string, value: string) => {
      setPhaseRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, rateStr: value } : r)));
    },
    [setPhaseRows]
  );

  return (
    <div className="space-y-3 w-full">
      <div
        className={`rounded-lg border border-slate-500/65 bg-slate-950/50 px-3 py-3 transition-colors duration-300 ${
          fillSuccess ? "border-emerald-700/40 bg-emerald-950/10" : ""
        }`}
      >
        <div className={`${PHASE_ROW_GRID} px-0.5 pb-2 mb-1 border-b border-slate-700/60`}>
          <span className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">From year</span>
          <span className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">To year</span>
          <span className="text-[10px] text-slate-500 uppercase tracking-wide font-medium text-right pr-0.5">
            {rateColumnLabel}
          </span>
          <span className="text-[10px] text-slate-500 uppercase tracking-wide text-right font-medium pr-0.5">
            Action
          </span>
        </div>
        <div className="flex flex-col gap-3">
          {phaseRows.map((row, idx) => {
            const isHighlighted = highlightedPhaseId === row.id;
            const prevEnd = idx > 0 ? phaseRows[idx - 1]?.endYear : undefined;
            const minStartYear =
              idx === 0
                ? firstUncoveredYear ?? projectionYears[0] ?? row.startYear
                : (() => {
                    const prevIdx = prevEnd != null ? yearIndex[prevEnd] : undefined;
                    if (prevIdx == null) return row.startYear;
                    return projectionYears[Math.min(prevIdx + 1, projectionYears.length - 1)] ?? row.startYear;
                  })();
            const minStartIdx = yearIndex[minStartYear] ?? 0;
            const startBase = yearOpts.filter((y) => (yearIndex[y] ?? -1) >= minStartIdx);
            const startOptions = startBase.includes(row.startYear) ? startBase : [row.startYear, ...startBase];
            const curStartIdx = yearIndex[row.startYear] ?? minStartIdx;
            const endBase = yearOpts.filter((y) => (yearIndex[y] ?? -1) >= curStartIdx);
            const endOptions = endBase.includes(row.endYear) ? endBase : [row.endYear, ...endBase];
            return (
              <div
                key={row.id}
                className={`rounded-md border px-3 py-3 transition-all duration-500 ${
                  isHighlighted
                    ? "border-emerald-500/60 bg-emerald-950/25 shadow-[0_0_0_1px_rgba(52,211,153,0.25)]"
                    : "border-slate-700/55 bg-slate-900/35"
                }`}
              >
                <div className={PHASE_ROW_GRID}>
                  <div className="min-w-0">
                    <select
                      value={row.startYear}
                      onChange={(e) => updatePhaseStartYear(row.id, e.target.value)}
                      className={sel}
                    >
                      {startOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0">
                    <select
                      value={row.endYear}
                      onChange={(e) => updatePhaseEndYear(row.id, e.target.value)}
                      className={sel}
                    >
                      {endOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0 flex justify-end">
                    <RevenueForecastDecimalInput
                      placeholder="%"
                      value={row.rateStr}
                      onChange={(next) => updatePhaseRate(row.id, next)}
                      className={pctInp}
                    />
                  </div>
                  <div className="flex justify-end items-center self-center">
                    <button
                      type="button"
                      disabled={phaseRows.length <= 1}
                      onClick={() => setPhaseRows((p) => p.filter((_, i) => i !== idx))}
                      title="Remove phase"
                      aria-label="Remove phase"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-600/80 bg-slate-800/90 text-slate-400 hover:bg-red-950/40 hover:text-red-300 hover:border-red-800/50 disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-slate-800/90"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {fillSuccess ? (
        <p
          className="text-[11px] text-emerald-400/95 pl-0.5"
          role="status"
        >
          {afterAddHint}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={phaseRows.length >= 4 || allYearsCovered || !finalYear}
          onClick={addPhase}
          className="rounded border border-slate-600 bg-slate-800 text-slate-300 text-[10px] px-2 py-1.5 disabled:opacity-35"
        >
          Add phase
        </button>
        <button
          type="button"
          disabled={allYearsCovered || !finalYear}
          onClick={fillRemainingWithLastRate}
          title={fillRemainingTitle}
          className="rounded border border-slate-600 bg-slate-800 text-slate-300 text-[10px] px-2 py-1.5 disabled:opacity-35"
        >
          Fill remaining years with last rate
        </button>
      </div>
      {phaseRows.length >= 4 ? (
        <p className="text-[10px] text-slate-500">{GROWTH_PHASE_MESSAGES.count}</p>
      ) : null}
    </div>
  );
}

/** Draft check for one growth side (mirrors buildPriceVolumeConfig buildSide). */
function isPriceVolumeSideDraftOk(
  shape: HistGrowthShapeV1,
  gStr: string,
  yStrs: Record<string, string>,
  phRows: PhaseDraftV1[],
  projectionYears: string[]
): boolean {
  const g = parseFloat(String(gStr).replace(/,/g, "").trim());
  const hasG = Number.isFinite(g);
  if (shape === "phases") {
    const phases = draftsToPhases(phRows);
    const { ok } = validateGrowthPhases(phases, projectionYears);
    return ok && projectionYears.length > 0;
  }
  if (shape === "by_year") {
    if (projectionYears.length === 0) return false;
    return projectionYears.every((y) => {
      const t = (yStrs[y] ?? "").replace(/,/g, "").trim();
      return Number.isFinite(parseFloat(t));
    });
  }
  return hasG;
}

function isCustomersArpuSideDraftOk(
  shape: HistGrowthShapeV1,
  gStr: string,
  yStrs: Record<string, string>,
  phRows: PhaseDraftV1[],
  projectionYears: string[]
): boolean {
  const g = parseFloat(String(gStr).replace(/,/g, "").trim());
  const hasG = Number.isFinite(g);
  if (shape === "phases") {
    const phases = draftsToPhases(phRows);
    const { ok } = validateGrowthPhases(phases, projectionYears);
    return ok && projectionYears.length > 0;
  }
  if (shape === "by_year") {
    if (projectionYears.length === 0) return false;
    return projectionYears.every((y) => {
      const t = (yStrs[y] ?? "").replace(/,/g, "").trim();
      return Number.isFinite(parseFloat(t));
    });
  }
  return hasG;
}

/** Compact status copy for the Price × Volume panel (matches validation tone). */
function getPriceVolumePanelStatus(
  volStartStr: string,
  priceStartStr: string,
  volShape: HistGrowthShapeV1,
  volGrowthStr: string,
  volYearStrs: Record<string, string>,
  volPhaseRows: PhaseDraftV1[],
  priceShape: HistGrowthShapeV1,
  priceGrowthStr: string,
  priceYearStrs: Record<string, string>,
  pricePhaseRows: PhaseDraftV1[],
  projectionYears: string[]
): string {
  const volTrim = String(volStartStr).trim();
  const vv = parseFloat(volTrim.replace(/,/g, ""));
  if (!volTrim) return "Enter a starting volume";
  if (!Number.isFinite(vv)) return "Enter a starting volume";
  if (vv <= 0) return "Starting volume must be greater than 0";

  const priceTrim = String(priceStartStr).trim();
  const pp = parseFloat(priceTrim.replace(/,/g, ""));
  if (!priceTrim) return "Enter a starting price per unit";
  if (!Number.isFinite(pp)) return "Enter a starting price per unit";
  if (pp <= 0) return "Starting price per unit must be greater than 0";

  if (!isPriceVolumeSideDraftOk(volShape, volGrowthStr, volYearStrs, volPhaseRows, projectionYears)) {
    return "Complete the volume growth setup";
  }
  if (!isPriceVolumeSideDraftOk(priceShape, priceGrowthStr, priceYearStrs, pricePhaseRows, projectionYears)) {
    return "Complete the price growth setup";
  }
  return "Ready";
}

function getContractsAcvPanelStatus(
  contractsStartStr: string,
  acvStartStr: string,
  contractShape: HistGrowthShapeV1,
  contractGrowthStr: string,
  contractYearStrs: Record<string, string>,
  contractPhaseRows: PhaseDraftV1[],
  acvShape: HistGrowthShapeV1,
  acvGrowthStr: string,
  acvYearStrs: Record<string, string>,
  acvPhaseRows: PhaseDraftV1[],
  projectionYears: string[]
): string {
  const conTrim = String(contractsStartStr).trim();
  const cc = parseFloat(conTrim.replace(/,/g, ""));
  if (!conTrim) return "Enter a starting contract count.";
  if (!Number.isFinite(cc)) return "Enter a starting contract count.";
  if (cc <= 0) return "Starting contract count must be greater than 0.";

  const acvTrim = String(acvStartStr).trim();
  const aa = parseFloat(acvTrim.replace(/,/g, ""));
  if (!acvTrim) return "Enter a starting ACV.";
  if (!Number.isFinite(aa)) return "Enter a starting ACV.";
  if (aa <= 0) return "Starting ACV must be greater than 0.";

  if (!isPriceVolumeSideDraftOk(contractShape, contractGrowthStr, contractYearStrs, contractPhaseRows, projectionYears)) {
    return "Complete the contract growth setup.";
  }
  if (!isPriceVolumeSideDraftOk(acvShape, acvGrowthStr, acvYearStrs, acvPhaseRows, projectionYears)) {
    return "Complete the ACV growth setup.";
  }
  return "Ready";
}

function getCustomersArpuPanelStatus(
  customersStartStr: string,
  arpuStartStr: string,
  customerShape: HistGrowthShapeV1,
  customerGrowthStr: string,
  customerYearStrs: Record<string, string>,
  customerPhaseRows: PhaseDraftV1[],
  arpuShape: HistGrowthShapeV1,
  arpuGrowthStr: string,
  arpuYearStrs: Record<string, string>,
  arpuPhaseRows: PhaseDraftV1[],
  projectionYears: string[]
): string {
  const customersTrim = String(customersStartStr).trim();
  const cc = parseFloat(customersTrim.replace(/,/g, ""));
  if (!customersTrim) return "Enter a starting customer base.";
  if (!Number.isFinite(cc)) return "Enter a starting customer base.";
  if (cc <= 0) return "Starting customer base must be greater than 0.";

  const arpuTrim = String(arpuStartStr).trim();
  const aa = parseFloat(arpuTrim.replace(/,/g, ""));
  if (!arpuTrim) return "Enter a starting ARPU.";
  if (!Number.isFinite(aa)) return "Enter a starting ARPU.";
  if (aa <= 0) return "Starting ARPU must be greater than 0.";

  if (
    !isCustomersArpuSideDraftOk(
      customerShape,
      customerGrowthStr,
      customerYearStrs,
      customerPhaseRows,
      projectionYears
    )
  ) {
    return "Complete the customer growth setup.";
  }
  if (!isCustomersArpuSideDraftOk(arpuShape, arpuGrowthStr, arpuYearStrs, arpuPhaseRows, projectionYears)) {
    return "Complete the ARPU growth setup.";
  }
  return "Ready";
}

function getLocationsRevenuePerLocationPanelStatus(
  locationsStartStr: string,
  revenuePerLocationStartStr: string,
  locationShape: HistGrowthShapeV1,
  locationGrowthStr: string,
  locationYearStrs: Record<string, string>,
  locationPhaseRows: PhaseDraftV1[],
  revenuePerLocationShape: HistGrowthShapeV1,
  revenuePerLocationGrowthStr: string,
  revenuePerLocationYearStrs: Record<string, string>,
  revenuePerLocationPhaseRows: PhaseDraftV1[],
  projectionYears: string[]
): string {
  const locationsTrim = String(locationsStartStr).trim();
  const ll = parseFloat(locationsTrim.replace(/,/g, ""));
  if (!locationsTrim) return "Enter a starting location count.";
  if (!Number.isFinite(ll)) return "Enter a starting location count.";
  if (ll <= 0) return "Starting location count must be greater than 0.";

  const rplTrim = String(revenuePerLocationStartStr).trim();
  const rr = parseFloat(rplTrim.replace(/,/g, ""));
  if (!rplTrim) return "Enter a starting revenue per location.";
  if (!Number.isFinite(rr)) return "Enter a starting revenue per location.";
  if (rr <= 0) return "Starting revenue per location must be greater than 0.";

  if (
    !isCustomersArpuSideDraftOk(
      locationShape,
      locationGrowthStr,
      locationYearStrs,
      locationPhaseRows,
      projectionYears
    )
  ) {
    return "Complete the location growth setup.";
  }
  if (
    !isCustomersArpuSideDraftOk(
      revenuePerLocationShape,
      revenuePerLocationGrowthStr,
      revenuePerLocationYearStrs,
      revenuePerLocationPhaseRows,
      projectionYears
    )
  ) {
    return "Complete the revenue per location growth setup.";
  }
  return "Ready";
}

function isUtilizationPathDraftOk(
  utilShape: UtilizationPathShapeV1,
  utilYearStrs: Record<string, string>,
  utilPhaseRows: PhaseDraftV1[],
  projectionYears: string[]
): boolean {
  if (utilShape === "phases") {
    const phases: UtilizationPhaseV1[] = utilPhaseRows.map((d) => ({
      startYear: d.startYear,
      endYear: d.endYear,
      utilizationPct: parseFloat(String(d.rateStr).replace(/,/g, "").trim()),
    }));
    const { ok } = validateUtilizationPhases(phases, projectionYears);
    return ok && projectionYears.length > 0;
  }
  if (utilShape === "by_year") {
    if (projectionYears.length === 0) return false;
    return projectionYears.every((y) => {
      const t = (utilYearStrs[y] ?? "").replace(/,/g, "").trim();
      const v = parseFloat(t);
      return Number.isFinite(v) && v >= 0 && v <= 100;
    });
  }
  return true;
}

function getCapacityUtilizationYieldPanelStatus(
  capacityStartStr: string,
  utilizationStartStr: string,
  yieldStartStr: string,
  capacityShape: HistGrowthShapeV1,
  capacityGrowthStr: string,
  capacityYearStrs: Record<string, string>,
  capacityPhaseRows: PhaseDraftV1[],
  utilShape: UtilizationPathShapeV1,
  utilYearStrs: Record<string, string>,
  utilPhaseRows: PhaseDraftV1[],
  yieldShape: HistGrowthShapeV1,
  yieldGrowthStr: string,
  yieldYearStrs: Record<string, string>,
  yieldPhaseRows: PhaseDraftV1[],
  projectionYears: string[]
): string {
  const capTrim = String(capacityStartStr).trim();
  const cc = parseFloat(capTrim.replace(/,/g, ""));
  if (!capTrim) return "Enter a starting capacity.";
  if (!Number.isFinite(cc)) return "Enter a starting capacity.";
  if (cc <= 0) return "Starting capacity must be greater than 0.";

  const utilTrim = String(utilizationStartStr).trim();
  const uu = parseFloat(utilTrim.replace(/,/g, ""));
  if (!utilTrim) return "Enter a starting utilization.";
  if (!Number.isFinite(uu)) return "Enter a starting utilization.";
  if (uu < 0 || uu > 100) return "Starting utilization must be between 0% and 100%.";

  const yTrim = String(yieldStartStr).trim();
  const yy = parseFloat(yTrim.replace(/,/g, ""));
  if (!yTrim) return "Enter a starting yield.";
  if (!Number.isFinite(yy)) return "Enter a starting yield.";
  if (yy <= 0) return "Starting yield must be greater than 0.";

  if (
    !isCustomersArpuSideDraftOk(
      capacityShape,
      capacityGrowthStr,
      capacityYearStrs,
      capacityPhaseRows,
      projectionYears
    )
  ) {
    return "Complete the capacity growth setup.";
  }
  if (!isUtilizationPathDraftOk(utilShape, utilYearStrs, utilPhaseRows, projectionYears)) {
    return "Complete the utilization setup.";
  }
  if (
    !isCustomersArpuSideDraftOk(
      yieldShape,
      yieldGrowthStr,
      yieldYearStrs,
      yieldPhaseRows,
      projectionYears
    )
  ) {
    return "Complete the yield growth setup.";
  }
  return "Ready";
}

function validationStatus(
  sub: DirectForecastSubModeV1,
  valid: boolean,
  ux: (typeof DIRECT_METHOD_UX)[DirectForecastSubModeV1],
  hasHistoric: boolean,
  growthStr: string,
  startStr: string
): string {
  if (sub === "growth_from_historical" && !hasHistoric) return ux.missingHist;
  if (!valid) {
    if (sub === "growth_from_historical") {
      return Number.isFinite(parseFloat(growthStr.replace(/,/g, ""))) ? ux.missingHist : ux.missingGrowth;
    }
    if (sub === "growth_from_manual_start") {
      const g = parseFloat(growthStr.replace(/,/g, ""));
      const t = startStr.replace(/,/g, "").trim();
      if (!Number.isFinite(g)) return ux.missingGrowth;
      if (!t || !Number.isFinite(parseFloat(t))) return ux.missingStart;
      return "Incomplete";
    }
    if (sub === "flat_value") return ux.missingFlat;
    if (sub === "manual_by_year") return ux.missingYear;
    return "Incomplete";
  }
  return ux.ready;
}

export function RevenueForecastV1DirectForecastBlock(props: {
  rowId: string;
  cfg: RevenueForecastRowConfigV1 | undefined;
  setRevenueForecastRowV1: (id: string, patch: Record<string, unknown>) => void;
  lastHistoricByRowId: Record<string, number> | undefined;
  projectionYears: string[];
  allowGrowthFromHistorical: boolean;
  /** Model currency code for Price × Volume price/unit label only (not K/M display). */
  currencyCode?: string;
  /** Increment to focus first meaningful input (e.g. new row). */
  focusNonce?: number;
  /** Shorter top copy when embedded in hierarchy card. */
  compactExplainer?: boolean;
}) {
  const {
    rowId,
    cfg,
    setRevenueForecastRowV1,
    lastHistoricByRowId,
    projectionYears,
    allowGrowthFromHistorical,
    currencyCode = "USD",
    focusNonce = 0,
    compactExplainer = false,
  } = props;
  const currencySymbol = getCurrencySymbol(currencyCode);
  const firstRef = useRef<HTMLInputElement>(null);
  const lastAppliedFocusNonceRef = useRef(0);

  const [sub, setSub] = useState<DirectForecastSubModeV1>(() =>
    cfgToStrings(cfg, rowId, projectionYears, allowGrowthFromHistorical).sub
  );
  const [growthStr, setGrowthStr] = useState("");
  const [startStr, setStartStr] = useState("");
  const [flatStr, setFlatStr] = useState("");
  const [yearStrs, setYearStrs] = useState<Record<string, string>>({});
  const [histShape, setHistShape] = useState<HistGrowthShapeV1>("constant");
  const [histYearStrs, setHistYearStrs] = useState<Record<string, string>>({});
  const [histPhaseRows, setHistPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [manualShape, setManualShape] = useState<HistGrowthShapeV1>("constant");
  const [manualYearStrs, setManualYearStrs] = useState<Record<string, string>>({});
  const [manualPhaseRows, setManualPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [volStartStr, setVolStartStr] = useState("");
  const [priceStartStr, setPriceStartStr] = useState("");
  const [volShape, setVolShape] = useState<HistGrowthShapeV1>("constant");
  const [volGrowthStr, setVolGrowthStr] = useState("");
  const [volYearStrs, setVolYearStrs] = useState<Record<string, string>>({});
  const [volPhaseRows, setVolPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [priceShape, setPriceShape] = useState<HistGrowthShapeV1>("constant");
  const [priceGrowthStr, setPriceGrowthStr] = useState("");
  const [priceYearStrs, setPriceYearStrs] = useState<Record<string, string>>({});
  const [pricePhaseRows, setPricePhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [volUnitLabelStr, setVolUnitLabelStr] = useState("");
  const [customersStartStr, setCustomersStartStr] = useState("");
  const [arpuStartStr, setArpuStartStr] = useState("");
  const [customerShape, setCustomerShape] = useState<HistGrowthShapeV1>("constant");
  const [customerGrowthStr, setCustomerGrowthStr] = useState("");
  const [customerYearStrs, setCustomerYearStrs] = useState<Record<string, string>>({});
  const [customerPhaseRows, setCustomerPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [arpuShape, setArpuShape] = useState<HistGrowthShapeV1>("constant");
  const [arpuGrowthStr, setArpuGrowthStr] = useState("");
  const [arpuYearStrs, setArpuYearStrs] = useState<Record<string, string>>({});
  const [arpuPhaseRows, setArpuPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [customerUnitLabelStr, setCustomerUnitLabelStr] = useState("");
  const [locationsStartStr, setLocationsStartStr] = useState("");
  const [revenuePerLocationStartStr, setRevenuePerLocationStartStr] = useState("");
  const [locationShape, setLocationShape] = useState<HistGrowthShapeV1>("constant");
  const [locationGrowthStr, setLocationGrowthStr] = useState("");
  const [locationYearStrs, setLocationYearStrs] = useState<Record<string, string>>({});
  const [locationPhaseRows, setLocationPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [revenuePerLocationShape, setRevenuePerLocationShape] = useState<HistGrowthShapeV1>("constant");
  const [revenuePerLocationGrowthStr, setRevenuePerLocationGrowthStr] = useState("");
  const [revenuePerLocationYearStrs, setRevenuePerLocationYearStrs] = useState<Record<string, string>>({});
  const [revenuePerLocationPhaseRows, setRevenuePerLocationPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [locationUnitLabelStr, setLocationUnitLabelStr] = useState("");
  const [arpuBasis, setArpuBasis] = useState<MonetizationPeriodBasisV1>("annual");
  const [revenuePerLocationBasis, setRevenuePerLocationBasis] =
    useState<MonetizationPeriodBasisV1>("annual");

  const [capacityStartStr, setCapacityStartStr] = useState("");
  const [capacityUnitLabelStr, setCapacityUnitLabelStr] = useState("");
  const [capacityShape, setCapacityShape] = useState<HistGrowthShapeV1>("constant");
  const [capacityGrowthStr, setCapacityGrowthStr] = useState("");
  const [capacityYearStrs, setCapacityYearStrs] = useState<Record<string, string>>({});
  const [capacityPhaseRows, setCapacityPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [utilizationStartStr, setUtilizationStartStr] = useState("");
  const [utilShape, setUtilShape] = useState<UtilizationPathShapeV1>("constant");
  const [utilYearStrs, setUtilYearStrs] = useState<Record<string, string>>({});
  const [utilPhaseRows, setUtilPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [yieldStartStr, setYieldStartStr] = useState("");
  const [yieldShape, setYieldShape] = useState<HistGrowthShapeV1>("constant");
  const [yieldGrowthStr, setYieldGrowthStr] = useState("");
  const [yieldYearStrs, setYieldYearStrs] = useState<Record<string, string>>({});
  const [yieldPhaseRows, setYieldPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [yieldBasis, setYieldBasis] = useState<MonetizationPeriodBasisV1>("annual");

  const [contractsStartStr, setContractsStartStr] = useState("");
  const [contractUnitLabelStr, setContractUnitLabelStr] = useState("");
  const [contractShape, setContractShape] = useState<HistGrowthShapeV1>("constant");
  const [contractGrowthStr, setContractGrowthStr] = useState("");
  const [contractYearStrs, setContractYearStrs] = useState<Record<string, string>>({});
  const [contractPhaseRows, setContractPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [acvStartStr, setAcvStartStr] = useState("");
  const [acvShape, setAcvShape] = useState<HistGrowthShapeV1>("constant");
  const [acvGrowthStr, setAcvGrowthStr] = useState("");
  const [acvYearStrs, setAcvYearStrs] = useState<Record<string, string>>({});
  const [acvPhaseRows, setAcvPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );

  const syncFromCfg = useCallback(
    (forceReset: boolean) => {
      // Avoid overwriting local P×V / CA / growth drafts when the store briefly has no row config
      // (e.g. re-render before Zustand hydrates) — that used to reset `sub` and clear volume via the else branch.
      if (
        !forceReset &&
        (!cfg || cfg.forecastRole !== "independent_driver" || !cfg.forecastMethod)
      ) {
        return;
      }
      const s = cfgToStrings(cfg, rowId, projectionYears, allowGrowthFromHistorical);
      setSub(s.sub);
      setGrowthStr(s.growthStr);
      setStartStr(s.startStr);
      setFlatStr(s.flatStr);
      setYearStrs(s.yearStrs);
      const rateFallback = s.growthStr;
      const h = readHistShapeFromCfg(cfg, projectionYears, s.sub, rateFallback);
      setHistShape(h.histShape);
      setHistPhaseRows(h.histPhaseRows);
      setHistYearStrs(
        h.histShape === "by_year"
          ? h.histYearStrs
          : Object.fromEntries(projectionYears.map((y) => [y, h.histYearStrs[y] ?? ""]))
      );
      const m = readManualGrowthFromCfg(cfg, projectionYears, s.sub, rateFallback);
      setManualShape(m.manualShape);
      setManualPhaseRows(m.manualPhaseRows);
      setManualYearStrs(
        m.manualShape === "by_year"
          ? m.manualYearStrs
          : Object.fromEntries(projectionYears.map((y) => [y, m.manualYearStrs[y] ?? ""]))
      );

      if (cfg?.forecastMethod === "price_volume") {
        const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
        const sv = Number(p.startingVolume);
        const sp = Number(p.startingPricePerUnit);
        setVolStartStr(sv > 0 && Number.isFinite(sv) ? fmtNumericDisplay(sv) : "");
        setPriceStartStr(sp > 0 && Number.isFinite(sp) ? perUnitPriceStoredToInputString(sp) : "");
        const vr = readTwoDriverSideFromCfg(cfg, projectionYears, "volume", "");
        setVolShape(vr.shape);
        setVolGrowthStr(vr.rateStr);
        setVolPhaseRows(vr.phaseRows);
        setVolYearStrs(
          vr.shape === "by_year"
            ? vr.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, vr.yearStrs[y] ?? ""]))
        );
        const pr = readTwoDriverSideFromCfg(cfg, projectionYears, "price", "");
        setPriceShape(pr.shape);
        setPriceGrowthStr(pr.rateStr);
        setPricePhaseRows(pr.phaseRows);
        setPriceYearStrs(
          pr.shape === "by_year"
            ? pr.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, pr.yearStrs[y] ?? ""]))
        );
        setVolUnitLabelStr(typeof p.volumeUnitLabel === "string" ? p.volumeUnitLabel : "");
      } else if (cfg?.forecastMethod === "customers_arpu") {
        const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
        const sc = Number(p.startingCustomers);
        const sa = Number(p.startingArpu);
        setCustomersStartStr(sc > 0 && Number.isFinite(sc) ? fmtNumericDisplay(sc) : "");
        setArpuStartStr(sa > 0 && Number.isFinite(sa) ? perUnitPriceStoredToInputString(sa) : "");
        const cs = readTwoDriverSideFromCfg(cfg, projectionYears, "customer", "");
        setCustomerShape(cs.shape);
        setCustomerGrowthStr(cs.rateStr);
        setCustomerPhaseRows(cs.phaseRows);
        setCustomerYearStrs(
          cs.shape === "by_year"
            ? cs.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, cs.yearStrs[y] ?? ""]))
        );
        const as = readTwoDriverSideFromCfg(cfg, projectionYears, "arpu", "");
        setArpuShape(as.shape);
        setArpuGrowthStr(as.rateStr);
        setArpuPhaseRows(as.phaseRows);
        setArpuYearStrs(
          as.shape === "by_year"
            ? as.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, as.yearStrs[y] ?? ""]))
        );
        setCustomerUnitLabelStr(typeof p.customerUnitLabel === "string" ? p.customerUnitLabel : "");
        setArpuBasis(p.arpuBasis === "monthly" ? "monthly" : "annual");
      } else if (cfg?.forecastMethod === "locations_revenue_per_location") {
        const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
        const sl = Number(p.startingLocations);
        const sr = Number(p.startingRevenuePerLocation);
        setLocationsStartStr(sl > 0 && Number.isFinite(sl) ? fmtNumericDisplay(sl) : "");
        setRevenuePerLocationStartStr(
          sr > 0 && Number.isFinite(sr) ? perUnitPriceStoredToInputString(sr) : ""
        );
        const ls = readTwoDriverSideFromCfg(cfg, projectionYears, "location", "");
        setLocationShape(ls.shape);
        setLocationGrowthStr(ls.rateStr);
        setLocationPhaseRows(ls.phaseRows);
        setLocationYearStrs(
          ls.shape === "by_year"
            ? ls.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, ls.yearStrs[y] ?? ""]))
        );
        const rs = readTwoDriverSideFromCfg(cfg, projectionYears, "revenuePerLocation", "");
        setRevenuePerLocationShape(rs.shape);
        setRevenuePerLocationGrowthStr(rs.rateStr);
        setRevenuePerLocationPhaseRows(rs.phaseRows);
        setRevenuePerLocationYearStrs(
          rs.shape === "by_year"
            ? rs.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, rs.yearStrs[y] ?? ""]))
        );
        setLocationUnitLabelStr(typeof p.locationUnitLabel === "string" ? p.locationUnitLabel : "");
        setRevenuePerLocationBasis(p.revenuePerLocationBasis === "monthly" ? "monthly" : "annual");
      } else if (cfg?.forecastMethod === "capacity_utilization_yield") {
        const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
        const sc = Number(p.startingCapacity);
        const su = Number(p.startingUtilizationPct);
        const sy = Number(p.startingYield);
        setCapacityStartStr(sc > 0 && Number.isFinite(sc) ? fmtNumericDisplay(sc) : "");
        setUtilizationStartStr(
          su >= 0 && su <= 100 && Number.isFinite(su) ? fmtNumericDisplay(su) : ""
        );
        setYieldStartStr(sy > 0 && Number.isFinite(sy) ? perUnitPriceStoredToInputString(sy) : "");
        const caps = readTwoDriverSideFromCfg(cfg, projectionYears, "capacity", "");
        setCapacityShape(caps.shape);
        setCapacityGrowthStr(caps.rateStr);
        setCapacityPhaseRows(caps.phaseRows);
        setCapacityYearStrs(
          caps.shape === "by_year"
            ? caps.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, caps.yearStrs[y] ?? ""]))
        );
        const up = readUtilizationPathFromCfg(cfg, projectionYears);
        setUtilShape(up.shape);
        setUtilYearStrs(
          up.shape === "by_year"
            ? up.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, up.yearStrs[y] ?? ""]))
        );
        setUtilPhaseRows(up.phaseRows);
        const ys = readTwoDriverSideFromCfg(cfg, projectionYears, "yield", "");
        setYieldShape(ys.shape);
        setYieldGrowthStr(ys.rateStr);
        setYieldPhaseRows(ys.phaseRows);
        setYieldYearStrs(
          ys.shape === "by_year"
            ? ys.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, ys.yearStrs[y] ?? ""]))
        );
        setCapacityUnitLabelStr(typeof p.capacityUnitLabel === "string" ? p.capacityUnitLabel : "");
        setYieldBasis(p.yieldBasis === "monthly" ? "monthly" : "annual");
      } else if (cfg?.forecastMethod === "contracts_acv") {
        const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
        const sct = Number(p.startingContracts);
        const sac = Number(p.startingAcv);
        setContractsStartStr(sct > 0 && Number.isFinite(sct) ? fmtNumericDisplay(sct) : "");
        setAcvStartStr(sac > 0 && Number.isFinite(sac) ? perUnitPriceStoredToInputString(sac) : "");
        const cr = readTwoDriverSideFromCfg(cfg, projectionYears, "contract", "");
        setContractShape(cr.shape);
        setContractGrowthStr(cr.rateStr);
        setContractPhaseRows(cr.phaseRows);
        setContractYearStrs(
          cr.shape === "by_year"
            ? cr.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, cr.yearStrs[y] ?? ""]))
        );
        const av = readTwoDriverSideFromCfg(cfg, projectionYears, "acv", "");
        setAcvShape(av.shape);
        setAcvGrowthStr(av.rateStr);
        setAcvPhaseRows(av.phaseRows);
        setAcvYearStrs(
          av.shape === "by_year"
            ? av.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, av.yearStrs[y] ?? ""]))
        );
        setContractUnitLabelStr(typeof p.contractUnitLabel === "string" ? p.contractUnitLabel : "");
      } else {
        const method = cfg?.forecastMethod as string | undefined;
        const shouldClearPv =
          forceReset ||
          (cfg != null &&
            cfg.forecastRole === "independent_driver" &&
            method != null &&
            method !== "price_volume");
        if (shouldClearPv) {
          setVolStartStr("");
          setPriceStartStr("");
          setVolUnitLabelStr("");
          setVolShape("constant");
          setVolGrowthStr("");
          setVolPhaseRows(defaultFullRangePhase(projectionYears, ""));
          setVolYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
          setPriceShape("constant");
          setPriceGrowthStr("");
          setPricePhaseRows(defaultFullRangePhase(projectionYears, ""));
          setPriceYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
        }
        const shouldClearCa =
          forceReset ||
          (cfg != null &&
            cfg.forecastRole === "independent_driver" &&
            method != null &&
            method !== "customers_arpu");
        if (shouldClearCa) {
          setCustomersStartStr("");
          setArpuStartStr("");
          setCustomerUnitLabelStr("");
          setCustomerShape("constant");
          setCustomerGrowthStr("");
          setCustomerPhaseRows(defaultFullRangePhase(projectionYears, ""));
          setCustomerYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
          setArpuShape("constant");
          setArpuGrowthStr("");
          setArpuPhaseRows(defaultFullRangePhase(projectionYears, ""));
          setArpuYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
          setArpuBasis("annual");
        }
        const shouldClearLrpl =
          forceReset ||
          (cfg != null &&
            cfg.forecastRole === "independent_driver" &&
            method != null &&
            method !== "locations_revenue_per_location");
        if (shouldClearLrpl) {
          setLocationsStartStr("");
          setRevenuePerLocationStartStr("");
          setLocationUnitLabelStr("");
          setLocationShape("constant");
          setLocationGrowthStr("");
          setLocationPhaseRows(defaultFullRangePhase(projectionYears, ""));
          setLocationYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
          setRevenuePerLocationShape("constant");
          setRevenuePerLocationGrowthStr("");
          setRevenuePerLocationPhaseRows(defaultFullRangePhase(projectionYears, ""));
          setRevenuePerLocationYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
          setRevenuePerLocationBasis("annual");
        }
        const shouldClearCuy =
          forceReset ||
          (cfg != null &&
            cfg.forecastRole === "independent_driver" &&
            method != null &&
            method !== "capacity_utilization_yield");
        if (shouldClearCuy) {
          setCapacityStartStr("");
          setCapacityUnitLabelStr("");
          setCapacityShape("constant");
          setCapacityGrowthStr("");
          setCapacityPhaseRows(defaultFullRangePhase(projectionYears, ""));
          setCapacityYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
          setUtilizationStartStr("");
          setUtilShape("constant");
          setUtilPhaseRows(defaultFullRangePhase(projectionYears, ""));
          setUtilYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
          setYieldStartStr("");
          setYieldShape("constant");
          setYieldGrowthStr("");
          setYieldPhaseRows(defaultFullRangePhase(projectionYears, ""));
          setYieldYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
          setYieldBasis("annual");
        }
        const shouldClearCacv =
          forceReset ||
          (cfg != null &&
            cfg.forecastRole === "independent_driver" &&
            method != null &&
            method !== "contracts_acv");
        if (shouldClearCacv) {
          setContractsStartStr("");
          setContractUnitLabelStr("");
          setContractShape("constant");
          setContractGrowthStr("");
          setContractPhaseRows(defaultFullRangePhase(projectionYears, ""));
          setContractYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
          setAcvStartStr("");
          setAcvShape("constant");
          setAcvGrowthStr("");
          setAcvPhaseRows(defaultFullRangePhase(projectionYears, ""));
          setAcvYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
        }
      }
    },
    [cfg, rowId, projectionYears, allowGrowthFromHistorical]
  );

  /** Sync local draft from store only when committed config actually changes (avoid wiping inputs on parent re-renders). */
  const committedFingerprint = useMemo(() => {
    if (!cfg || cfg.forecastRole !== "independent_driver" || !cfg.forecastMethod) {
      return `${rowId}:none`;
    }
    return JSON.stringify({
      rowId,
      method: cfg.forecastMethod,
      params: cfg.forecastParameters ?? {},
    });
  }, [rowId, cfg]);

  const lastSyncedRowIdRef = useRef(rowId);
  const lastSyncedFingerprintRef = useRef<string>("");
  const syncFromCfgRef = useRef(syncFromCfg);
  syncFromCfgRef.current = syncFromCfg;

  useEffect(() => {
    if (lastSyncedRowIdRef.current !== rowId) {
      lastSyncedRowIdRef.current = rowId;
      lastSyncedFingerprintRef.current = "";
      syncFromCfgRef.current(true);
      lastSyncedFingerprintRef.current = committedFingerprint;
      return;
    }
    if (lastSyncedFingerprintRef.current === committedFingerprint) return;
    lastSyncedFingerprintRef.current = committedFingerprint;
    syncFromCfgRef.current(false);
  }, [rowId, committedFingerprint]);

  const { config: tentative, valid: formValid } = useMemo(() => {
    if (sub === "price_volume") {
      return buildPriceVolumeConfig(
        rowId,
        projectionYears,
        volStartStr,
        priceStartStr,
        volUnitLabelStr,
        volShape,
        volGrowthStr,
        volYearStrs,
        volPhaseRows,
        priceShape,
        priceGrowthStr,
        priceYearStrs,
        pricePhaseRows
      );
    }
    if (sub === "customers_arpu") {
      return buildCustomersArpuConfig(
        rowId,
        projectionYears,
        customersStartStr,
        arpuStartStr,
        customerUnitLabelStr,
        customerShape,
        customerGrowthStr,
        customerYearStrs,
        customerPhaseRows,
        arpuShape,
        arpuGrowthStr,
        arpuYearStrs,
        arpuPhaseRows,
        arpuBasis
      );
    }
    if (sub === "locations_revenue_per_location") {
      return buildLocationsRevenuePerLocationConfig(
        rowId,
        projectionYears,
        locationsStartStr,
        revenuePerLocationStartStr,
        locationUnitLabelStr,
        locationShape,
        locationGrowthStr,
        locationYearStrs,
        locationPhaseRows,
        revenuePerLocationShape,
        revenuePerLocationGrowthStr,
        revenuePerLocationYearStrs,
        revenuePerLocationPhaseRows,
        revenuePerLocationBasis
      );
    }
    if (sub === "capacity_utilization_yield") {
      return buildCapacityUtilizationYieldConfig(
        rowId,
        projectionYears,
        capacityStartStr,
        capacityUnitLabelStr,
        capacityShape,
        capacityGrowthStr,
        capacityYearStrs,
        capacityPhaseRows,
        utilizationStartStr,
        utilShape,
        utilYearStrs,
        utilPhaseRows,
        yieldStartStr,
        yieldShape,
        yieldGrowthStr,
        yieldYearStrs,
        yieldPhaseRows,
        yieldBasis
      );
    }
    if (sub === "contracts_acv") {
      return buildContractsAcvConfig(
        rowId,
        projectionYears,
        contractsStartStr,
        acvStartStr,
        contractUnitLabelStr,
        contractShape,
        contractGrowthStr,
        contractYearStrs,
        contractPhaseRows,
        acvShape,
        acvGrowthStr,
        acvYearStrs,
        acvPhaseRows
      );
    }
    return buildConfigFromForm(
      sub,
      growthStr,
      startStr,
      flatStr,
      yearStrs,
      projectionYears,
      rowId,
      histShape,
      histYearStrs,
      histPhaseRows,
      manualShape,
      manualYearStrs,
      manualPhaseRows
    );
  }, [
    sub,
    growthStr,
    startStr,
    flatStr,
    yearStrs,
    projectionYears,
    rowId,
    histShape,
    histYearStrs,
    histPhaseRows,
    manualShape,
    manualYearStrs,
    manualPhaseRows,
    volStartStr,
    priceStartStr,
    volUnitLabelStr,
    volShape,
    volGrowthStr,
    volYearStrs,
    volPhaseRows,
    priceShape,
    priceGrowthStr,
    priceYearStrs,
    pricePhaseRows,
    customersStartStr,
    arpuStartStr,
    customerUnitLabelStr,
    customerShape,
    customerGrowthStr,
    customerYearStrs,
    customerPhaseRows,
    arpuShape,
    arpuGrowthStr,
    arpuYearStrs,
    arpuPhaseRows,
    locationsStartStr,
    revenuePerLocationStartStr,
    locationUnitLabelStr,
    locationShape,
    locationGrowthStr,
    locationYearStrs,
    locationPhaseRows,
    revenuePerLocationShape,
    revenuePerLocationGrowthStr,
    revenuePerLocationYearStrs,
    revenuePerLocationPhaseRows,
    arpuBasis,
    revenuePerLocationBasis,
    capacityStartStr,
    capacityUnitLabelStr,
    capacityShape,
    capacityGrowthStr,
    capacityYearStrs,
    capacityPhaseRows,
    utilizationStartStr,
    utilShape,
    utilYearStrs,
    utilPhaseRows,
    yieldStartStr,
    yieldShape,
    yieldGrowthStr,
    yieldYearStrs,
    yieldPhaseRows,
    yieldBasis,
    contractsStartStr,
    acvStartStr,
    contractUnitLabelStr,
    contractShape,
    contractGrowthStr,
    contractYearStrs,
    contractPhaseRows,
    acvShape,
    acvGrowthStr,
    acvYearStrs,
    acvPhaseRows,
  ]);

  const phaseValidationMessage = useMemo(() => {
    if (sub === "growth_from_historical" && histShape === "phases") {
      const { errors } = validateGrowthPhases(draftsToPhases(histPhaseRows), projectionYears);
      return errors[0] ?? "";
    }
    if (sub === "growth_from_manual_start" && manualShape === "phases") {
      const { errors } = validateGrowthPhases(draftsToPhases(manualPhaseRows), projectionYears);
      return errors[0] ?? "";
    }
    if (sub === "price_volume") {
      if (volShape === "phases") {
        const { ok } = validateGrowthPhases(draftsToPhases(volPhaseRows), projectionYears);
        if (!ok) return "Complete the volume growth setup";
      }
      if (priceShape === "phases") {
        const { ok } = validateGrowthPhases(draftsToPhases(pricePhaseRows), projectionYears);
        if (!ok) return "Complete the price growth setup";
      }
    }
    if (sub === "customers_arpu") {
      if (customerShape === "phases") {
        const { ok } = validateGrowthPhases(draftsToPhases(customerPhaseRows), projectionYears);
        if (!ok) return "Complete the customer growth setup";
      }
      if (arpuShape === "phases") {
        const { ok } = validateGrowthPhases(draftsToPhases(arpuPhaseRows), projectionYears);
        if (!ok) return "Complete the ARPU growth setup";
      }
    }
    if (sub === "locations_revenue_per_location") {
      if (locationShape === "phases") {
        const { ok } = validateGrowthPhases(draftsToPhases(locationPhaseRows), projectionYears);
        if (!ok) return "Complete the location growth setup";
      }
      if (revenuePerLocationShape === "phases") {
        const { ok } = validateGrowthPhases(
          draftsToPhases(revenuePerLocationPhaseRows),
          projectionYears
        );
        if (!ok) return "Complete the revenue per location growth setup";
      }
    }
    if (sub === "capacity_utilization_yield") {
      if (capacityShape === "phases") {
        const { ok } = validateGrowthPhases(draftsToPhases(capacityPhaseRows), projectionYears);
        if (!ok) return "Complete the capacity growth setup";
      }
      if (utilShape === "phases") {
        const phases: UtilizationPhaseV1[] = utilPhaseRows.map((d) => ({
          startYear: d.startYear,
          endYear: d.endYear,
          utilizationPct: parseFloat(String(d.rateStr).replace(/,/g, "").trim()),
        }));
        const { ok } = validateUtilizationPhases(phases, projectionYears);
        if (!ok) return "Complete the utilization setup";
      }
      if (yieldShape === "phases") {
        const { ok } = validateGrowthPhases(draftsToPhases(yieldPhaseRows), projectionYears);
        if (!ok) return "Complete the yield growth setup";
      }
    }
    if (sub === "contracts_acv") {
      if (contractShape === "phases") {
        const { ok } = validateGrowthPhases(draftsToPhases(contractPhaseRows), projectionYears);
        if (!ok) return "Complete the contract growth setup";
      }
      if (acvShape === "phases") {
        const { ok } = validateGrowthPhases(draftsToPhases(acvPhaseRows), projectionYears);
        if (!ok) return "Complete the ACV growth setup";
      }
    }
    return "";
  }, [
    sub,
    histShape,
    manualShape,
    volShape,
    priceShape,
    customerShape,
    arpuShape,
    histPhaseRows,
    manualPhaseRows,
    volPhaseRows,
    pricePhaseRows,
    customerPhaseRows,
    arpuPhaseRows,
    locationShape,
    revenuePerLocationShape,
    locationPhaseRows,
    revenuePerLocationPhaseRows,
    capacityShape,
    utilShape,
    yieldShape,
    capacityPhaseRows,
    utilPhaseRows,
    yieldPhaseRows,
    contractShape,
    acvShape,
    contractPhaseRows,
    acvPhaseRows,
    projectionYears,
  ]);

  const hasHistoric =
    allowGrowthFromHistorical &&
    typeof lastHistoricByRowId?.[rowId] === "number" &&
    !Number.isNaN(lastHistoricByRowId[rowId]!);

  const structurallyOk =
    formValid && (sub !== "growth_from_historical" || hasHistoric);

  const matchesCommitted = configsMatchStore(tentative, cfg);
  const unsaved = !matchesCommitted;
  const ux = DIRECT_METHOD_UX[sub];
  const priceVolumeStatusLine = useMemo(
    () =>
      getPriceVolumePanelStatus(
        volStartStr,
        priceStartStr,
        volShape,
        volGrowthStr,
        volYearStrs,
        volPhaseRows,
        priceShape,
        priceGrowthStr,
        priceYearStrs,
        pricePhaseRows,
        projectionYears
      ),
    [
      volStartStr,
      priceStartStr,
      volShape,
      volGrowthStr,
      volYearStrs,
      volPhaseRows,
      priceShape,
      priceGrowthStr,
      priceYearStrs,
      pricePhaseRows,
      projectionYears,
    ]
  );
  const customersArpuStatusLine = useMemo(
    () =>
      getCustomersArpuPanelStatus(
        customersStartStr,
        arpuStartStr,
        customerShape,
        customerGrowthStr,
        customerYearStrs,
        customerPhaseRows,
        arpuShape,
        arpuGrowthStr,
        arpuYearStrs,
        arpuPhaseRows,
        projectionYears
      ),
    [
      customersStartStr,
      arpuStartStr,
      customerShape,
      customerGrowthStr,
      customerYearStrs,
      customerPhaseRows,
      arpuShape,
      arpuGrowthStr,
      arpuYearStrs,
      arpuPhaseRows,
      projectionYears,
    ]
  );
  const locationsRevenuePerLocationStatusLine = useMemo(
    () =>
      getLocationsRevenuePerLocationPanelStatus(
        locationsStartStr,
        revenuePerLocationStartStr,
        locationShape,
        locationGrowthStr,
        locationYearStrs,
        locationPhaseRows,
        revenuePerLocationShape,
        revenuePerLocationGrowthStr,
        revenuePerLocationYearStrs,
        revenuePerLocationPhaseRows,
        projectionYears
      ),
    [
      locationsStartStr,
      revenuePerLocationStartStr,
      locationShape,
      locationGrowthStr,
      locationYearStrs,
      locationPhaseRows,
      revenuePerLocationShape,
      revenuePerLocationGrowthStr,
      revenuePerLocationYearStrs,
      revenuePerLocationPhaseRows,
      projectionYears,
    ]
  );
  const capacityUtilizationYieldStatusLine = useMemo(
    () =>
      getCapacityUtilizationYieldPanelStatus(
        capacityStartStr,
        utilizationStartStr,
        yieldStartStr,
        capacityShape,
        capacityGrowthStr,
        capacityYearStrs,
        capacityPhaseRows,
        utilShape,
        utilYearStrs,
        utilPhaseRows,
        yieldShape,
        yieldGrowthStr,
        yieldYearStrs,
        yieldPhaseRows,
        projectionYears
      ),
    [
      capacityStartStr,
      utilizationStartStr,
      yieldStartStr,
      capacityShape,
      capacityGrowthStr,
      capacityYearStrs,
      capacityPhaseRows,
      utilShape,
      utilYearStrs,
      utilPhaseRows,
      yieldShape,
      yieldGrowthStr,
      yieldYearStrs,
      yieldPhaseRows,
      projectionYears,
    ]
  );
  const contractsAcvStatusLine = useMemo(
    () =>
      getContractsAcvPanelStatus(
        contractsStartStr,
        acvStartStr,
        contractShape,
        contractGrowthStr,
        contractYearStrs,
        contractPhaseRows,
        acvShape,
        acvGrowthStr,
        acvYearStrs,
        acvPhaseRows,
        projectionYears
      ),
    [
      contractsStartStr,
      acvStartStr,
      contractShape,
      contractGrowthStr,
      contractYearStrs,
      contractPhaseRows,
      acvShape,
      acvGrowthStr,
      acvYearStrs,
      acvPhaseRows,
      projectionYears,
    ]
  );
  const statusLine =
    sub === "price_volume"
      ? phaseValidationMessage || priceVolumeStatusLine
      : sub === "customers_arpu"
        ? phaseValidationMessage || customersArpuStatusLine
        : sub === "locations_revenue_per_location"
          ? phaseValidationMessage || locationsRevenuePerLocationStatusLine
          : sub === "capacity_utilization_yield"
            ? phaseValidationMessage || capacityUtilizationYieldStatusLine
            : sub === "contracts_acv"
              ? phaseValidationMessage || contractsAcvStatusLine
              : (sub === "growth_from_historical" && histShape === "phases") ||
                  (sub === "growth_from_manual_start" && manualShape === "phases")
                ? phaseValidationMessage || (formValid ? "Ready" : "Incomplete")
                : validationStatus(sub, formValid, ux, hasHistoric, growthStr, startStr);

  const forecastComplete = isDirectForecastConfigComplete(
    cfg,
    rowId,
    lastHistoricByRowId,
    allowGrowthFromHistorical,
    projectionYears
  );
  let rowStatus: AllocationRowStatus = "incomplete";
  if (sub === "growth_from_historical" && !hasHistoric) rowStatus = "invalid";
  else if (
    (sub === "growth_from_historical" && histShape === "phases" && !formValid) ||
    (sub === "growth_from_manual_start" && manualShape === "phases" && !formValid) ||
    (sub === "price_volume" &&
      (volShape === "phases" || priceShape === "phases") &&
      !formValid) ||
    (sub === "customers_arpu" &&
      (customerShape === "phases" || arpuShape === "phases") &&
      !formValid)
    || (sub === "locations_revenue_per_location" &&
      (locationShape === "phases" || revenuePerLocationShape === "phases") &&
      !formValid) ||
    (sub === "capacity_utilization_yield" &&
      (capacityShape === "phases" || utilShape === "phases" || yieldShape === "phases") &&
      !formValid) ||
    (sub === "contracts_acv" && (contractShape === "phases" || acvShape === "phases") && !formValid)
  ) {
    rowStatus = "incomplete";
  } else if (forecastComplete && !unsaved) rowStatus = "ready";
  else if (!forecastComplete && !unsaved) rowStatus = "incomplete";

  useEffect(() => {
    if (allowGrowthFromHistorical) return;
    if (sub !== "growth_from_historical") return;
    setSub("growth_from_manual_start");
    setGrowthStr((g) => g);
    setStartStr((s) => s);
  }, [allowGrowthFromHistorical, sub]);

  useEffect(() => {
    lastAppliedFocusNonceRef.current = 0;
  }, [rowId]);

  useEffect(() => {
    if (focusNonce <= 0) return;
    if (focusNonce === lastAppliedFocusNonceRef.current) return;
    lastAppliedFocusNonceRef.current = focusNonce;
    const t = requestAnimationFrame(() => firstRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(t);
  }, [focusNonce, rowId]);

  const applySubChange = (id: DirectForecastSubModeV1) => {
    const gRaw = growthStr.trim();
    const startRaw = startStr.trim();
    const flatRaw = flatStr.trim();
    setSub(id);
    if (id === "growth_from_historical") {
      setHistShape("constant");
      setGrowthStr((prev) => prev);
      setHistYearStrs((prev) => {
        const next: Record<string, string> = {};
        for (const y of projectionYears) next[y] = prev[y] || gRaw || "";
        return next;
      });
    } else if (id === "growth_from_manual_start") {
      setGrowthStr((s) => s || gRaw || "");
      setStartStr((s) => s || flatRaw || startRaw || "");
    } else if (id === "price_volume") {
      setVolStartStr((v) => v || "1");
      setPriceStartStr((p) => p || flatRaw || startRaw || "1");
      setVolShape("constant");
      setPriceShape("constant");
      setVolGrowthStr((s) => s || gRaw || "");
      setPriceGrowthStr((s) => s || gRaw || "");
      setVolPhaseRows(defaultFullRangePhase(projectionYears, gRaw || ""));
      setPricePhaseRows(defaultFullRangePhase(projectionYears, gRaw || ""));
      setVolYearStrs(Object.fromEntries(projectionYears.map((y) => [y, gRaw || ""])));
      setPriceYearStrs(Object.fromEntries(projectionYears.map((y) => [y, gRaw || ""])));
    } else if (id === "customers_arpu") {
      setCustomersStartStr((c) => c || "1");
      setArpuStartStr((a) => a || flatRaw || startRaw || "1");
      setArpuBasis("annual");
      setCustomerShape("constant");
      setArpuShape("constant");
      setCustomerGrowthStr((s) => s || gRaw || "");
      setArpuGrowthStr((s) => s || gRaw || "");
      setCustomerPhaseRows(defaultFullRangePhase(projectionYears, gRaw || ""));
      setArpuPhaseRows(defaultFullRangePhase(projectionYears, gRaw || ""));
      setCustomerYearStrs(Object.fromEntries(projectionYears.map((y) => [y, gRaw || ""])));
      setArpuYearStrs(Object.fromEntries(projectionYears.map((y) => [y, gRaw || ""])));
    } else if (id === "locations_revenue_per_location") {
      setLocationsStartStr((l) => l || "1");
      setRevenuePerLocationStartStr((r) => r || flatRaw || startRaw || "1");
      setRevenuePerLocationBasis("annual");
      setLocationShape("constant");
      setRevenuePerLocationShape("constant");
      setLocationGrowthStr((s) => s || gRaw || "");
      setRevenuePerLocationGrowthStr((s) => s || gRaw || "");
      setLocationPhaseRows(defaultFullRangePhase(projectionYears, gRaw || ""));
      setRevenuePerLocationPhaseRows(defaultFullRangePhase(projectionYears, gRaw || ""));
      setLocationYearStrs(Object.fromEntries(projectionYears.map((y) => [y, gRaw || ""])));
      setRevenuePerLocationYearStrs(Object.fromEntries(projectionYears.map((y) => [y, gRaw || ""])));
    } else if (id === "capacity_utilization_yield") {
      setCapacityStartStr((c) => c || "1");
      setUtilizationStartStr((u) => u || "80");
      setYieldStartStr((y) => y || flatRaw || startRaw || "1");
      setYieldBasis("annual");
      setCapacityShape("constant");
      setUtilShape("constant");
      setYieldShape("constant");
      setCapacityGrowthStr((s) => s || gRaw || "");
      setYieldGrowthStr((s) => s || gRaw || "");
      setCapacityPhaseRows(defaultFullRangePhase(projectionYears, gRaw || ""));
      setUtilPhaseRows(defaultFullRangePhase(projectionYears, ""));
      setYieldPhaseRows(defaultFullRangePhase(projectionYears, gRaw || ""));
      setCapacityYearStrs(Object.fromEntries(projectionYears.map((y) => [y, gRaw || ""])));
      setUtilYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
      setYieldYearStrs(Object.fromEntries(projectionYears.map((y) => [y, gRaw || ""])));
    } else if (id === "contracts_acv") {
      setContractsStartStr((c) => c || "1");
      setAcvStartStr((a) => a || flatRaw || startRaw || "1");
      setContractShape("constant");
      setAcvShape("constant");
      setContractGrowthStr((s) => s || gRaw || "");
      setAcvGrowthStr((s) => s || gRaw || "");
      setContractPhaseRows(defaultFullRangePhase(projectionYears, gRaw || ""));
      setAcvPhaseRows(defaultFullRangePhase(projectionYears, gRaw || ""));
      setContractYearStrs(Object.fromEntries(projectionYears.map((y) => [y, gRaw || ""])));
      setAcvYearStrs(Object.fromEntries(projectionYears.map((y) => [y, gRaw || ""])));
    } else if (id === "flat_value") {
      setFlatStr((f) => f || startRaw || flatRaw || "");
    } else {
      const next: Record<string, string> = { ...yearStrs };
      for (const y of projectionYears) {
        if (!next[y]) next[y] = flatRaw || startRaw || "";
      }
      setYearStrs(next);
    }
  };

  const commit = useCallback(() => {
    if (sub === "price_volume") {
      const { config, valid } = buildPriceVolumeConfig(
        rowId,
        projectionYears,
        volStartStr,
        priceStartStr,
        volUnitLabelStr,
        volShape,
        volGrowthStr,
        volYearStrs,
        volPhaseRows,
        priceShape,
        priceGrowthStr,
        priceYearStrs,
        pricePhaseRows
      );
      if (!valid) return;
      setRevenueForecastRowV1(rowId, {
        forecastRole: "independent_driver",
        forecastMethod: config.forecastMethod,
        forecastParameters: config.forecastParameters,
      });
      const p = (config.forecastParameters ?? {}) as Record<string, unknown>;
      const sv = Number(p.startingVolume);
      const sp = Number(p.startingPricePerUnit);
      setVolStartStr(sv > 0 && Number.isFinite(sv) ? fmtNumericDisplay(sv) : "");
      setPriceStartStr(sp > 0 && Number.isFinite(sp) ? perUnitPriceStoredToInputString(sp) : "");
      setVolUnitLabelStr(typeof p.volumeUnitLabel === "string" ? p.volumeUnitLabel : "");
      const vr = readTwoDriverSideFromCfg(config, projectionYears, "volume", "");
      setVolShape(vr.shape);
      setVolGrowthStr(vr.rateStr);
      setVolPhaseRows(vr.phaseRows);
      if (vr.shape === "by_year") setVolYearStrs(vr.yearStrs);
      else setVolYearStrs(Object.fromEntries(projectionYears.map((y) => [y, vr.yearStrs[y] ?? ""])));
      const pr = readTwoDriverSideFromCfg(config, projectionYears, "price", "");
      setPriceShape(pr.shape);
      setPriceGrowthStr(pr.rateStr);
      setPricePhaseRows(pr.phaseRows);
      if (pr.shape === "by_year") setPriceYearStrs(pr.yearStrs);
      else setPriceYearStrs(Object.fromEntries(projectionYears.map((y) => [y, pr.yearStrs[y] ?? ""])));
      return;
    }
    if (sub === "customers_arpu") {
      const { config, valid } = buildCustomersArpuConfig(
        rowId,
        projectionYears,
        customersStartStr,
        arpuStartStr,
        customerUnitLabelStr,
        customerShape,
        customerGrowthStr,
        customerYearStrs,
        customerPhaseRows,
        arpuShape,
        arpuGrowthStr,
        arpuYearStrs,
        arpuPhaseRows,
        arpuBasis
      );
      if (!valid) return;
      setRevenueForecastRowV1(rowId, {
        forecastRole: "independent_driver",
        forecastMethod: config.forecastMethod,
        forecastParameters: config.forecastParameters,
      });
      const p = (config.forecastParameters ?? {}) as Record<string, unknown>;
      const sc = Number(p.startingCustomers);
      const sa = Number(p.startingArpu);
      setCustomersStartStr(sc > 0 && Number.isFinite(sc) ? fmtNumericDisplay(sc) : "");
      setArpuStartStr(sa > 0 && Number.isFinite(sa) ? perUnitPriceStoredToInputString(sa) : "");
      setCustomerUnitLabelStr(typeof p.customerUnitLabel === "string" ? p.customerUnitLabel : "");
      setArpuBasis(p.arpuBasis === "monthly" ? "monthly" : "annual");
      const cs = readTwoDriverSideFromCfg(config, projectionYears, "customer", "");
      setCustomerShape(cs.shape);
      setCustomerGrowthStr(cs.rateStr);
      setCustomerPhaseRows(cs.phaseRows);
      if (cs.shape === "by_year") setCustomerYearStrs(cs.yearStrs);
      else setCustomerYearStrs(Object.fromEntries(projectionYears.map((y) => [y, cs.yearStrs[y] ?? ""])));
      const as = readTwoDriverSideFromCfg(config, projectionYears, "arpu", "");
      setArpuShape(as.shape);
      setArpuGrowthStr(as.rateStr);
      setArpuPhaseRows(as.phaseRows);
      if (as.shape === "by_year") setArpuYearStrs(as.yearStrs);
      else setArpuYearStrs(Object.fromEntries(projectionYears.map((y) => [y, as.yearStrs[y] ?? ""])));
      return;
    }
    if (sub === "locations_revenue_per_location") {
      const { config, valid } = buildLocationsRevenuePerLocationConfig(
        rowId,
        projectionYears,
        locationsStartStr,
        revenuePerLocationStartStr,
        locationUnitLabelStr,
        locationShape,
        locationGrowthStr,
        locationYearStrs,
        locationPhaseRows,
        revenuePerLocationShape,
        revenuePerLocationGrowthStr,
        revenuePerLocationYearStrs,
        revenuePerLocationPhaseRows,
        revenuePerLocationBasis
      );
      if (!valid) return;
      setRevenueForecastRowV1(rowId, {
        forecastRole: "independent_driver",
        forecastMethod: config.forecastMethod,
        forecastParameters: config.forecastParameters,
      });
      const p = (config.forecastParameters ?? {}) as Record<string, unknown>;
      const sl = Number(p.startingLocations);
      const sr = Number(p.startingRevenuePerLocation);
      setLocationsStartStr(sl > 0 && Number.isFinite(sl) ? fmtNumericDisplay(sl) : "");
      setRevenuePerLocationStartStr(
        sr > 0 && Number.isFinite(sr) ? perUnitPriceStoredToInputString(sr) : ""
      );
      setLocationUnitLabelStr(typeof p.locationUnitLabel === "string" ? p.locationUnitLabel : "");
      setRevenuePerLocationBasis(p.revenuePerLocationBasis === "monthly" ? "monthly" : "annual");
      const ls = readTwoDriverSideFromCfg(config, projectionYears, "location", "");
      setLocationShape(ls.shape);
      setLocationGrowthStr(ls.rateStr);
      setLocationPhaseRows(ls.phaseRows);
      if (ls.shape === "by_year") setLocationYearStrs(ls.yearStrs);
      else setLocationYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ls.yearStrs[y] ?? ""])));
      const rs = readTwoDriverSideFromCfg(config, projectionYears, "revenuePerLocation", "");
      setRevenuePerLocationShape(rs.shape);
      setRevenuePerLocationGrowthStr(rs.rateStr);
      setRevenuePerLocationPhaseRows(rs.phaseRows);
      if (rs.shape === "by_year") setRevenuePerLocationYearStrs(rs.yearStrs);
      else {
        setRevenuePerLocationYearStrs(
          Object.fromEntries(projectionYears.map((y) => [y, rs.yearStrs[y] ?? ""]))
        );
      }
      return;
    }
    if (sub === "capacity_utilization_yield") {
      const { config, valid } = buildCapacityUtilizationYieldConfig(
        rowId,
        projectionYears,
        capacityStartStr,
        capacityUnitLabelStr,
        capacityShape,
        capacityGrowthStr,
        capacityYearStrs,
        capacityPhaseRows,
        utilizationStartStr,
        utilShape,
        utilYearStrs,
        utilPhaseRows,
        yieldStartStr,
        yieldShape,
        yieldGrowthStr,
        yieldYearStrs,
        yieldPhaseRows,
        yieldBasis
      );
      if (!valid) return;
      setRevenueForecastRowV1(rowId, {
        forecastRole: "independent_driver",
        forecastMethod: config.forecastMethod,
        forecastParameters: config.forecastParameters,
      });
      const p = (config.forecastParameters ?? {}) as Record<string, unknown>;
      const sc = Number(p.startingCapacity);
      const su = Number(p.startingUtilizationPct);
      const sy = Number(p.startingYield);
      setCapacityStartStr(sc > 0 && Number.isFinite(sc) ? fmtNumericDisplay(sc) : "");
      setUtilizationStartStr(
        su >= 0 && su <= 100 && Number.isFinite(su) ? fmtNumericDisplay(su) : ""
      );
      setYieldStartStr(sy > 0 && Number.isFinite(sy) ? perUnitPriceStoredToInputString(sy) : "");
      setCapacityUnitLabelStr(typeof p.capacityUnitLabel === "string" ? p.capacityUnitLabel : "");
      setYieldBasis(p.yieldBasis === "monthly" ? "monthly" : "annual");
      const caps = readTwoDriverSideFromCfg(config, projectionYears, "capacity", "");
      setCapacityShape(caps.shape);
      setCapacityGrowthStr(caps.rateStr);
      setCapacityPhaseRows(caps.phaseRows);
      if (caps.shape === "by_year") setCapacityYearStrs(caps.yearStrs);
      else setCapacityYearStrs(Object.fromEntries(projectionYears.map((y) => [y, caps.yearStrs[y] ?? ""])));
      const up = readUtilizationPathFromCfg(config, projectionYears);
      setUtilShape(up.shape);
      if (up.shape === "by_year") setUtilYearStrs(up.yearStrs);
      else setUtilYearStrs(Object.fromEntries(projectionYears.map((y) => [y, up.yearStrs[y] ?? ""])));
      setUtilPhaseRows(up.phaseRows);
      const ys = readTwoDriverSideFromCfg(config, projectionYears, "yield", "");
      setYieldShape(ys.shape);
      setYieldGrowthStr(ys.rateStr);
      setYieldPhaseRows(ys.phaseRows);
      if (ys.shape === "by_year") setYieldYearStrs(ys.yearStrs);
      else setYieldYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ys.yearStrs[y] ?? ""])));
      return;
    }
    if (sub === "contracts_acv") {
      const { config, valid } = buildContractsAcvConfig(
        rowId,
        projectionYears,
        contractsStartStr,
        acvStartStr,
        contractUnitLabelStr,
        contractShape,
        contractGrowthStr,
        contractYearStrs,
        contractPhaseRows,
        acvShape,
        acvGrowthStr,
        acvYearStrs,
        acvPhaseRows
      );
      if (!valid) return;
      setRevenueForecastRowV1(rowId, {
        forecastRole: "independent_driver",
        forecastMethod: config.forecastMethod,
        forecastParameters: config.forecastParameters,
      });
      const p = (config.forecastParameters ?? {}) as Record<string, unknown>;
      const sct = Number(p.startingContracts);
      const sac = Number(p.startingAcv);
      setContractsStartStr(sct > 0 && Number.isFinite(sct) ? fmtNumericDisplay(sct) : "");
      setAcvStartStr(sac > 0 && Number.isFinite(sac) ? perUnitPriceStoredToInputString(sac) : "");
      setContractUnitLabelStr(typeof p.contractUnitLabel === "string" ? p.contractUnitLabel : "");
      const cr = readTwoDriverSideFromCfg(config, projectionYears, "contract", "");
      setContractShape(cr.shape);
      setContractGrowthStr(cr.rateStr);
      setContractPhaseRows(cr.phaseRows);
      if (cr.shape === "by_year") setContractYearStrs(cr.yearStrs);
      else setContractYearStrs(Object.fromEntries(projectionYears.map((y) => [y, cr.yearStrs[y] ?? ""])));
      const av = readTwoDriverSideFromCfg(config, projectionYears, "acv", "");
      setAcvShape(av.shape);
      setAcvGrowthStr(av.rateStr);
      setAcvPhaseRows(av.phaseRows);
      if (av.shape === "by_year") setAcvYearStrs(av.yearStrs);
      else setAcvYearStrs(Object.fromEntries(projectionYears.map((y) => [y, av.yearStrs[y] ?? ""])));
      return;
    }

    const { config, valid } = buildConfigFromForm(
      sub,
      growthStr,
      startStr,
      flatStr,
      yearStrs,
      projectionYears,
      rowId,
      histShape,
      histYearStrs,
      histPhaseRows,
      manualShape,
      manualYearStrs,
      manualPhaseRows
    );
    if (!valid) return;
    if (sub === "growth_from_historical" && !hasHistoric) return;
    setRevenueForecastRowV1(rowId, {
      forecastRole: "independent_driver",
      forecastMethod: config.forecastMethod,
      forecastParameters: config.forecastParameters,
    });
    const s = cfgToStrings(config, rowId, projectionYears, allowGrowthFromHistorical);
    setGrowthStr(s.growthStr);
    setStartStr(s.startStr);
    setFlatStr(s.flatStr);
    setYearStrs(s.yearStrs);
    const h = readHistShapeFromCfg(config, projectionYears, s.sub, s.growthStr);
    setHistShape(h.histShape);
    setHistPhaseRows(h.histPhaseRows);
    if (h.histShape === "by_year") {
      setHistYearStrs(h.histYearStrs);
    } else {
      setHistYearStrs(Object.fromEntries(projectionYears.map((y) => [y, h.histYearStrs[y] ?? ""])));
    }
    const m = readManualGrowthFromCfg(config, projectionYears, s.sub, s.growthStr);
    setManualShape(m.manualShape);
    setManualPhaseRows(m.manualPhaseRows);
    if (m.manualShape === "by_year") {
      setManualYearStrs(m.manualYearStrs);
    } else {
      setManualYearStrs(Object.fromEntries(projectionYears.map((y) => [y, m.manualYearStrs[y] ?? ""])));
    }
  }, [
    sub,
    growthStr,
    startStr,
    flatStr,
    yearStrs,
    projectionYears,
    rowId,
    hasHistoric,
    setRevenueForecastRowV1,
    allowGrowthFromHistorical,
    histShape,
    histYearStrs,
    histPhaseRows,
    manualShape,
    manualYearStrs,
    manualPhaseRows,
    volStartStr,
    priceStartStr,
    volUnitLabelStr,
    volShape,
    volGrowthStr,
    volYearStrs,
    volPhaseRows,
    priceShape,
    priceGrowthStr,
    priceYearStrs,
    pricePhaseRows,
    customersStartStr,
    arpuStartStr,
    customerUnitLabelStr,
    customerShape,
    customerGrowthStr,
    customerYearStrs,
    customerPhaseRows,
    arpuShape,
    arpuGrowthStr,
    arpuYearStrs,
    arpuPhaseRows,
    arpuBasis,
    locationsStartStr,
    revenuePerLocationStartStr,
    locationUnitLabelStr,
    locationShape,
    locationGrowthStr,
    locationYearStrs,
    locationPhaseRows,
    revenuePerLocationShape,
    revenuePerLocationGrowthStr,
    revenuePerLocationYearStrs,
    revenuePerLocationPhaseRows,
    revenuePerLocationBasis,
    capacityStartStr,
    capacityUnitLabelStr,
    capacityShape,
    capacityGrowthStr,
    capacityYearStrs,
    capacityPhaseRows,
    utilizationStartStr,
    utilShape,
    utilYearStrs,
    utilPhaseRows,
    yieldStartStr,
    yieldShape,
    yieldGrowthStr,
    yieldYearStrs,
    yieldPhaseRows,
    yieldBasis,
    contractsStartStr,
    acvStartStr,
    contractUnitLabelStr,
    contractShape,
    contractGrowthStr,
    contractYearStrs,
    contractPhaseRows,
    acvShape,
    acvGrowthStr,
    acvYearStrs,
    acvPhaseRows,
  ]);

  const reset = useCallback(() => {
    syncFromCfg(true);
  }, [syncFromCfg]);

  const subModeOptions = useMemo(
    () =>
      allowGrowthFromHistorical ? ALL_SUB_MODES : ALL_SUB_MODES.filter((o) => o.id !== "growth_from_historical"),
    [allowGrowthFromHistorical]
  );

  const canApply = structurallyOk && unsaved;

  const inp =
    "rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 tabular-nums w-24 text-right";

  return (
    <div className="space-y-3 w-full max-w-3xl">
      {!compactExplainer ? (
        <p className="text-[10px] text-slate-500 border-l-2 border-slate-600 pl-2">
          Edits apply to the model only when you click <strong className="text-slate-400">Apply</strong>.
        </p>
      ) : null}
      {!compactExplainer ? (
        <p className="text-[10px] text-slate-500 border-l-2 border-slate-600 pl-2">
          <strong className="text-slate-400">Amounts</strong> (revenue, flat, by-year, starting base) are full real
          values — not scaled to the model&apos;s K/M display unit. Preview still shows statement scale.
        </p>
      ) : (
        <p className="text-[9px] text-slate-500 pl-0.5">
          Assumptions: enter <span className="text-slate-400">full real amounts</span> (not K/M).
        </p>
      )}
      {!allowGrowthFromHistorical ? (
        <p className="text-[10px] text-amber-200/85 bg-amber-950/25 border border-amber-800/35 rounded px-2 py-1">
          No historical row — growth from actual unavailable. Use manual start, flat, or by-year.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <RowStatusPill status={rowStatus} />
        <span
          className={`text-[10px] rounded px-2 py-0.5 ${
            unsaved ? "bg-amber-900/50 text-amber-100/90" : "bg-slate-800 text-slate-500"
          }`}
        >
          {unsaved ? "Unsaved changes" : "Matches saved forecast"}
        </span>
        <button
          type="button"
          disabled={!canApply}
          onClick={commit}
          className="rounded bg-emerald-700 text-white text-xs px-3 py-1.5 font-medium disabled:opacity-35 disabled:cursor-not-allowed hover:bg-emerald-600"
        >
          Apply
        </button>
        <button
          type="button"
          disabled={!unsaved}
          onClick={reset}
          className="rounded border border-slate-600 bg-slate-800 text-slate-300 text-xs px-3 py-1.5 disabled:opacity-35 hover:bg-slate-700"
        >
          Reset
        </button>
      </div>

      <div>
        <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Method</label>
        <select
          value={subModeOptions.some((o) => o.id === sub) ? sub : subModeOptions[0]!.id}
          onChange={(e) => applySubChange(e.target.value as DirectForecastSubModeV1)}
          className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
        >
          {subModeOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div
        className={`rounded-md border px-3 py-2.5 text-[11px] space-y-1.5 ${
          structurallyOk && matchesCommitted
            ? "border-emerald-800/45 bg-emerald-950/15 text-emerald-100/90"
            : "border-slate-600/60 bg-slate-950/40 text-slate-200"
        }`}
      >
        <div className="font-semibold text-slate-100">
          {sub === "price_volume" && (volShape === "phases" || priceShape === "phases")
            ? `${DIRECT_METHOD_UX.price_volume.title} · ${GROWTH_PHASES_UX.title}`
            : sub === "customers_arpu" && (customerShape === "phases" || arpuShape === "phases")
              ? `${DIRECT_METHOD_UX.customers_arpu.title} · ${GROWTH_PHASES_UX.title}`
            : sub === "locations_revenue_per_location" &&
                (locationShape === "phases" || revenuePerLocationShape === "phases")
              ? `${DIRECT_METHOD_UX.locations_revenue_per_location.title} · ${GROWTH_PHASES_UX.title}`
            : sub === "capacity_utilization_yield" &&
                (capacityShape === "phases" || utilShape === "phases" || yieldShape === "phases")
              ? `${DIRECT_METHOD_UX.capacity_utilization_yield.title} · ${GROWTH_PHASES_UX.title}`
            : sub === "contracts_acv" && (contractShape === "phases" || acvShape === "phases")
              ? `${DIRECT_METHOD_UX.contracts_acv.title} · ${GROWTH_PHASES_UX.title}`
            : (sub === "growth_from_historical" && histShape === "phases") ||
                (sub === "growth_from_manual_start" && manualShape === "phases")
              ? GROWTH_PHASES_UX.title
              : ux.title}
        </div>
        <p className="text-slate-400 leading-snug">
          {sub === "price_volume" && (volShape === "phases" || priceShape === "phases")
            ? `${DIRECT_METHOD_UX.price_volume.oneLine} ${GROWTH_PHASES_UX.oneLine}`
            : sub === "customers_arpu" && (customerShape === "phases" || arpuShape === "phases")
              ? `${DIRECT_METHOD_UX.customers_arpu.oneLine} ${GROWTH_PHASES_UX.oneLine}`
            : sub === "locations_revenue_per_location" &&
                (locationShape === "phases" || revenuePerLocationShape === "phases")
              ? `${DIRECT_METHOD_UX.locations_revenue_per_location.oneLine} ${GROWTH_PHASES_UX.oneLine}`
            : sub === "capacity_utilization_yield" &&
                (capacityShape === "phases" || utilShape === "phases" || yieldShape === "phases")
              ? `${DIRECT_METHOD_UX.capacity_utilization_yield.oneLine} ${GROWTH_PHASES_UX.oneLine}`
            : sub === "contracts_acv" && (contractShape === "phases" || acvShape === "phases")
              ? `${DIRECT_METHOD_UX.contracts_acv.oneLine} ${GROWTH_PHASES_UX.oneLine}`
            : (sub === "growth_from_historical" && histShape === "phases") ||
                (sub === "growth_from_manual_start" && manualShape === "phases")
              ? GROWTH_PHASES_UX.oneLine
              : ux.oneLine}
        </p>
        <div>
          <span className="text-slate-500">Formula · </span>
          <span className="text-slate-300 font-mono text-[10px]">
            {sub === "price_volume" && (volShape === "phases" || priceShape === "phases")
              ? `${DIRECT_METHOD_UX.price_volume.formula} ${GROWTH_PHASES_UX.formula}`
              : sub === "customers_arpu" && (customerShape === "phases" || arpuShape === "phases")
                ? `${DIRECT_METHOD_UX.customers_arpu.formula} ${GROWTH_PHASES_UX.formula}`
              : sub === "locations_revenue_per_location" &&
                  (locationShape === "phases" || revenuePerLocationShape === "phases")
                ? `${DIRECT_METHOD_UX.locations_revenue_per_location.formula} ${GROWTH_PHASES_UX.formula}`
              : sub === "capacity_utilization_yield" &&
                  (capacityShape === "phases" || utilShape === "phases" || yieldShape === "phases")
                ? `${DIRECT_METHOD_UX.capacity_utilization_yield.formula} ${GROWTH_PHASES_UX.formula}`
              : sub === "contracts_acv" && (contractShape === "phases" || acvShape === "phases")
                ? `${DIRECT_METHOD_UX.contracts_acv.formula} ${GROWTH_PHASES_UX.formula}`
              : (sub === "growth_from_historical" && histShape === "phases") ||
                  (sub === "growth_from_manual_start" && manualShape === "phases")
                ? GROWTH_PHASES_UX.formula
                : ux.formula}
          </span>
        </div>
        <div>
          <span className="text-slate-500">Required · </span>
          <span className="text-slate-300">
            {sub === "price_volume" && (volShape === "phases" || priceShape === "phases")
              ? `${DIRECT_METHOD_UX.price_volume.required} ${GROWTH_PHASES_UX.required}`
              : sub === "customers_arpu" && (customerShape === "phases" || arpuShape === "phases")
                ? `${DIRECT_METHOD_UX.customers_arpu.required} ${GROWTH_PHASES_UX.required}`
              : sub === "locations_revenue_per_location" &&
                  (locationShape === "phases" || revenuePerLocationShape === "phases")
                ? `${DIRECT_METHOD_UX.locations_revenue_per_location.required} ${GROWTH_PHASES_UX.required}`
              : sub === "capacity_utilization_yield" &&
                  (capacityShape === "phases" || utilShape === "phases" || yieldShape === "phases")
                ? `${DIRECT_METHOD_UX.capacity_utilization_yield.required} ${GROWTH_PHASES_UX.required}`
              : sub === "contracts_acv" && (contractShape === "phases" || acvShape === "phases")
                ? `${DIRECT_METHOD_UX.contracts_acv.required} ${GROWTH_PHASES_UX.required}`
              : (sub === "growth_from_historical" && histShape === "phases") ||
                  (sub === "growth_from_manual_start" && manualShape === "phases")
                ? GROWTH_PHASES_UX.required
                : ux.required}
          </span>
        </div>
        <div className="pt-1 border-t border-slate-700/50">
          <span className="text-slate-500">Status · </span>
          <span className={structurallyOk ? "text-emerald-400/90" : "text-amber-300/90"}>{statusLine}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        {sub === "price_volume" ? (
          <div className="w-full space-y-4">
            <p className="text-[11px] text-slate-400 leading-snug">
              Forecasts revenue as <span className="text-slate-300">units × price per unit</span>, each with its
              own growth pattern. Use when topline depends on how much you sell and the average realized price.
            </p>
            <p className="text-[10px] text-slate-500 -mt-2">
              This method builds revenue from operational drivers (units × pricing).
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[8rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Starting volume</span>
                <RevenueForecastDecimalInput
                  ref={firstRef}
                  value={volStartStr}
                  onChange={setVolStartStr}
                  className={inp}
                  title="Plain quantity — not scaled by statement K/M"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 flex-1 min-w-[12rem] max-w-md">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  Volume unit label <span className="normal-case text-slate-600">(optional)</span>
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="units, subscribers, kg, cases"
                  value={volUnitLabelStr}
                  onChange={(e) => setVolUnitLabelStr(e.target.value)}
                  className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-full"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[9rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  Starting price / unit
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="text-slate-500 tabular-nums text-xs shrink-0 font-medium"
                    aria-hidden
                  >
                    {currencySymbol}
                  </span>
                  <RevenueForecastDecimalInput
                    value={priceStartStr}
                    onChange={setPriceStartStr}
                    className={inp}
                    title="Actual price per unit — not statement thousands/millions"
                  />
                </span>
              </label>
            </div>
            <p className="text-[10px] text-slate-600 leading-relaxed space-y-0.5">
              <span className="block">
                <span className="text-slate-500">Drivers ·</span> Starting volume = count of units / subscribers /
                cases / kg / etc. (plain number, not K/M).
              </span>
              <span className="block">
                Starting price / unit = actual selling price per unit ({currencySymbol} amount), not scaled by the
                model&apos;s revenue K/M display.
              </span>
            </p>
            {volUnitLabelStr.trim() ? (
              <p className="text-[10px] text-slate-600">
                Volume unit: <span className="text-slate-400">{volUnitLabelStr.trim()}</span>
              </p>
            ) : null}

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">
                Volume growth
              </label>
              <select
                value={volShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = volShape;
                  setVolShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(volPhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setVolYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = volGrowthStr.trim();
                        setVolYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) {
                            if (!n[y]) n[y] = base;
                          }
                          return n;
                        });
                      }
                    } else {
                      const base = volGrowthStr.trim();
                      setVolYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) {
                          if (!n[y]) n[y] = base;
                        }
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setVolPhaseRows(defaultFullRangePhase(projectionYears, volGrowthStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (volYearStrs[y0] ?? "").trim();
                      const fallbackRate = volGrowthStr.trim();
                      setVolPhaseRows(defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
              {volShape === "phases" ? (
                <GrowthPhaseEditor
                  phaseRows={volPhaseRows}
                  setPhaseRows={setVolPhaseRows}
                  projectionYears={projectionYears}
                  inp={inp}
                />
              ) : null}
              {volShape === "constant" ? (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500 shrink-0">Growth %</span>
                  <RevenueForecastDecimalInput value={volGrowthStr} onChange={setVolGrowthStr} className={inp} />
                  <span className="text-slate-500 font-medium">%</span>
                </label>
              ) : null}
              {volShape === "by_year" ? (
                <div className="flex flex-wrap gap-2 w-full">
                  {projectionYears.map((y) => (
                    <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                      <span>{y} growth</span>
                      <span className="flex items-center gap-1">
                        <RevenueForecastDecimalInput
                          value={volYearStrs[y] ?? ""}
                          onChange={(next) => setVolYearStrs((prev) => ({ ...prev, [y]: next }))}
                          className={inp}
                        />
                        <span className="text-slate-500">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">
                Price growth
              </label>
              <select
                value={priceShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = priceShape;
                  setPriceShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(pricePhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setPriceYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = priceGrowthStr.trim();
                        setPriceYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) {
                            if (!n[y]) n[y] = base;
                          }
                          return n;
                        });
                      }
                    } else {
                      const base = priceGrowthStr.trim();
                      setPriceYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) {
                          if (!n[y]) n[y] = base;
                        }
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setPricePhaseRows(defaultFullRangePhase(projectionYears, priceGrowthStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (priceYearStrs[y0] ?? "").trim();
                      const fallbackRate = priceGrowthStr.trim();
                      setPricePhaseRows(defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
              {priceShape === "phases" ? (
                <GrowthPhaseEditor
                  phaseRows={pricePhaseRows}
                  setPhaseRows={setPricePhaseRows}
                  projectionYears={projectionYears}
                  inp={inp}
                />
              ) : null}
              {priceShape === "constant" ? (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500 shrink-0">Growth %</span>
                  <RevenueForecastDecimalInput
                    value={priceGrowthStr}
                    onChange={setPriceGrowthStr}
                    className={inp}
                  />
                  <span className="text-slate-500 font-medium">%</span>
                </label>
              ) : null}
              {priceShape === "by_year" ? (
                <div className="flex flex-wrap gap-2 w-full">
                  {projectionYears.map((y) => (
                    <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                      <span>{y} growth</span>
                      <span className="flex items-center gap-1">
                        <RevenueForecastDecimalInput
                          value={priceYearStrs[y] ?? ""}
                          onChange={(next) => setPriceYearStrs((prev) => ({ ...prev, [y]: next }))}
                          className={inp}
                        />
                        <span className="text-slate-500">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {sub === "customers_arpu" ? (
          <div className="w-full space-y-4">
            <p className="text-[11px] text-slate-400 leading-snug">
              Forecasts revenue as <span className="text-slate-300">customers × ARPU</span>, each with its own growth
              pattern. ARPU means average revenue per user/customer/member/account.
            </p>
            <p className="text-[10px] text-slate-500 -mt-2">
              This method builds revenue from user growth and monetization (ARPU).
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[8rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Starting customers</span>
                <RevenueForecastDecimalInput
                  ref={firstRef}
                  value={customersStartStr}
                  onChange={setCustomersStartStr}
                  className={inp}
                  title="Plain customer count — not scaled by statement K/M"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 flex-1 min-w-[12rem] max-w-md">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  Customer unit label <span className="normal-case text-slate-600">(optional)</span>
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="users, subscribers, members, accounts"
                  value={customerUnitLabelStr}
                  onChange={(e) => setCustomerUnitLabelStr(e.target.value)}
                  className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-full"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[9rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Starting ARPU</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-slate-500 tabular-nums text-xs shrink-0 font-medium" aria-hidden>
                    {currencySymbol}
                  </span>
                  <RevenueForecastDecimalInput
                    value={arpuStartStr}
                    onChange={setArpuStartStr}
                    className={inp}
                    title="Actual ARPU — not statement thousands/millions"
                  />
                </span>
              </label>
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[10rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">ARPU basis</span>
                <select
                  value={arpuBasis}
                  onChange={(e) => setArpuBasis(e.target.value as MonetizationPeriodBasisV1)}
                  className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2 w-full max-w-xs"
                >
                  <option value="annual">Annual</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <p className="text-[10px] text-slate-500 max-w-xl flex-1 pb-1 leading-snug">
                If Monthly is selected, the model annualizes ARPU by multiplying by 12. If Annual is selected, no
                further conversion is applied.
              </p>
            </div>
            <p className="text-[10px] text-slate-600 leading-relaxed space-y-0.5">
              <span className="block">
                <span className="text-slate-500">Drivers ·</span> Starting customers = paying users / subscribers /
                members / accounts (plain count, not K/M).
              </span>
              <span className="block">
                Starting ARPU = actual revenue per user/customer/member/account ({currencySymbol} amount), not scaled
                by the model&apos;s revenue K/M display.
              </span>
            </p>
            {customerUnitLabelStr.trim() ? (
              <p className="text-[10px] text-slate-600">
                Customer unit: <span className="text-slate-400">{customerUnitLabelStr.trim()}</span>
              </p>
            ) : null}

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Customer growth</label>
              <select
                value={customerShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = customerShape;
                  setCustomerShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(customerPhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setCustomerYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = customerGrowthStr.trim();
                        setCustomerYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) if (!n[y]) n[y] = base;
                          return n;
                        });
                      }
                    } else {
                      const base = customerGrowthStr.trim();
                      setCustomerYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) if (!n[y]) n[y] = base;
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setCustomerPhaseRows(defaultFullRangePhase(projectionYears, customerGrowthStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (customerYearStrs[y0] ?? "").trim();
                      const fallbackRate = customerGrowthStr.trim();
                      setCustomerPhaseRows(defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
              {customerShape === "phases" ? (
                <GrowthPhaseEditor
                  phaseRows={customerPhaseRows}
                  setPhaseRows={setCustomerPhaseRows}
                  projectionYears={projectionYears}
                  inp={inp}
                />
              ) : null}
              {customerShape === "constant" ? (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500 shrink-0">Growth %</span>
                  <RevenueForecastDecimalInput
                    value={customerGrowthStr}
                    onChange={setCustomerGrowthStr}
                    className={inp}
                  />
                  <span className="text-slate-500 font-medium">%</span>
                </label>
              ) : null}
              {customerShape === "by_year" ? (
                <div className="flex flex-wrap gap-2 w-full">
                  {projectionYears.map((y) => (
                    <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                      <span>{y} growth</span>
                      <span className="flex items-center gap-1">
                        <RevenueForecastDecimalInput
                          value={customerYearStrs[y] ?? ""}
                          onChange={(next) => setCustomerYearStrs((prev) => ({ ...prev, [y]: next }))}
                          className={inp}
                        />
                        <span className="text-slate-500">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">ARPU growth</label>
              <select
                value={arpuShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = arpuShape;
                  setArpuShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(arpuPhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setArpuYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = arpuGrowthStr.trim();
                        setArpuYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) if (!n[y]) n[y] = base;
                          return n;
                        });
                      }
                    } else {
                      const base = arpuGrowthStr.trim();
                      setArpuYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) if (!n[y]) n[y] = base;
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setArpuPhaseRows(defaultFullRangePhase(projectionYears, arpuGrowthStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (arpuYearStrs[y0] ?? "").trim();
                      const fallbackRate = arpuGrowthStr.trim();
                      setArpuPhaseRows(defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
              {arpuShape === "phases" ? (
                <GrowthPhaseEditor
                  phaseRows={arpuPhaseRows}
                  setPhaseRows={setArpuPhaseRows}
                  projectionYears={projectionYears}
                  inp={inp}
                />
              ) : null}
              {arpuShape === "constant" ? (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500 shrink-0">Growth %</span>
                  <RevenueForecastDecimalInput value={arpuGrowthStr} onChange={setArpuGrowthStr} className={inp} />
                  <span className="text-slate-500 font-medium">%</span>
                </label>
              ) : null}
              {arpuShape === "by_year" ? (
                <div className="flex flex-wrap gap-2 w-full">
                  {projectionYears.map((y) => (
                    <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                      <span>{y} growth</span>
                      <span className="flex items-center gap-1">
                        <RevenueForecastDecimalInput
                          value={arpuYearStrs[y] ?? ""}
                          onChange={(next) => setArpuYearStrs((prev) => ({ ...prev, [y]: next }))}
                          className={inp}
                        />
                        <span className="text-slate-500">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {sub === "locations_revenue_per_location" ? (
          <div className="w-full space-y-4">
            <p className="text-[11px] text-slate-400 leading-snug">
              Forecasts revenue as{" "}
              <span className="text-slate-300">locations × revenue per location</span>, each with its own growth
              pattern.
            </p>
            <p className="text-[10px] text-slate-500 -mt-2">
              Use this when revenue depends on footprint growth and average productivity per location.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[8rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Starting locations</span>
                <RevenueForecastDecimalInput
                  ref={firstRef}
                  value={locationsStartStr}
                  onChange={setLocationsStartStr}
                  className={inp}
                  title="Plain location count — not scaled by statement K/M"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 flex-1 min-w-[12rem] max-w-md">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  Location unit label <span className="normal-case text-slate-600">(optional)</span>
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="stores, branches, clinics, restaurants, gyms, sites"
                  value={locationUnitLabelStr}
                  onChange={(e) => setLocationUnitLabelStr(e.target.value)}
                  className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-full"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[11rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  Starting revenue / location
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-slate-500 tabular-nums text-xs shrink-0 font-medium" aria-hidden>
                    {currencySymbol}
                  </span>
                  <RevenueForecastDecimalInput
                    value={revenuePerLocationStartStr}
                    onChange={setRevenuePerLocationStartStr}
                    className={inp}
                    title="Actual revenue per location — not statement thousands/millions"
                  />
                </span>
              </label>
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[12rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  Revenue per location basis
                </span>
                <select
                  value={revenuePerLocationBasis}
                  onChange={(e) =>
                    setRevenuePerLocationBasis(e.target.value as MonetizationPeriodBasisV1)
                  }
                  className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2 w-full max-w-xs"
                >
                  <option value="annual">Annual</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <p className="text-[10px] text-slate-500 max-w-xl flex-1 pb-1 leading-snug">
                If Monthly is selected, the model annualizes revenue per location by multiplying by 12. If Annual is
                selected, no further conversion is applied.
              </p>
            </div>
            <p className="text-[10px] text-slate-600 leading-relaxed space-y-0.5">
              <span className="block">
                <span className="text-slate-500">Drivers ·</span> Starting locations = active stores / branches /
                clinics / sites (plain count, not K/M).
              </span>
              <span className="block">
                Starting revenue per location = actual revenue generated per location ({currencySymbol} amount), not
                scaled by the model&apos;s revenue K/M display.
              </span>
            </p>
            {locationUnitLabelStr.trim() ? (
              <p className="text-[10px] text-slate-600">
                Location unit: <span className="text-slate-400">{locationUnitLabelStr.trim()}</span>
              </p>
            ) : null}

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Location growth</label>
              <select
                value={locationShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = locationShape;
                  setLocationShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(locationPhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setLocationYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = locationGrowthStr.trim();
                        setLocationYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) if (!n[y]) n[y] = base;
                          return n;
                        });
                      }
                    } else {
                      const base = locationGrowthStr.trim();
                      setLocationYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) if (!n[y]) n[y] = base;
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setLocationPhaseRows(defaultFullRangePhase(projectionYears, locationGrowthStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (locationYearStrs[y0] ?? "").trim();
                      const fallbackRate = locationGrowthStr.trim();
                      setLocationPhaseRows(defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
              {locationShape === "phases" ? (
                <GrowthPhaseEditor
                  phaseRows={locationPhaseRows}
                  setPhaseRows={setLocationPhaseRows}
                  projectionYears={projectionYears}
                  inp={inp}
                />
              ) : null}
              {locationShape === "constant" ? (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500 shrink-0">Growth %</span>
                  <RevenueForecastDecimalInput
                    value={locationGrowthStr}
                    onChange={setLocationGrowthStr}
                    className={inp}
                  />
                  <span className="text-slate-500 font-medium">%</span>
                </label>
              ) : null}
              {locationShape === "by_year" ? (
                <div className="flex flex-wrap gap-2 w-full">
                  {projectionYears.map((y) => (
                    <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                      <span>{y} growth</span>
                      <span className="flex items-center gap-1">
                        <RevenueForecastDecimalInput
                          value={locationYearStrs[y] ?? ""}
                          onChange={(next) => setLocationYearStrs((prev) => ({ ...prev, [y]: next }))}
                          className={inp}
                        />
                        <span className="text-slate-500">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">
                Revenue per location growth
              </label>
              <select
                value={revenuePerLocationShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = revenuePerLocationShape;
                  setRevenuePerLocationShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(revenuePerLocationPhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setRevenuePerLocationYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = revenuePerLocationGrowthStr.trim();
                        setRevenuePerLocationYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) if (!n[y]) n[y] = base;
                          return n;
                        });
                      }
                    } else {
                      const base = revenuePerLocationGrowthStr.trim();
                      setRevenuePerLocationYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) if (!n[y]) n[y] = base;
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setRevenuePerLocationPhaseRows(
                        defaultFullRangePhase(projectionYears, revenuePerLocationGrowthStr.trim())
                      );
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (revenuePerLocationYearStrs[y0] ?? "").trim();
                      const fallbackRate = revenuePerLocationGrowthStr.trim();
                      setRevenuePerLocationPhaseRows(
                        defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate)
                      );
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
              {revenuePerLocationShape === "phases" ? (
                <GrowthPhaseEditor
                  phaseRows={revenuePerLocationPhaseRows}
                  setPhaseRows={setRevenuePerLocationPhaseRows}
                  projectionYears={projectionYears}
                  inp={inp}
                />
              ) : null}
              {revenuePerLocationShape === "constant" ? (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500 shrink-0">Growth %</span>
                  <RevenueForecastDecimalInput
                    value={revenuePerLocationGrowthStr}
                    onChange={setRevenuePerLocationGrowthStr}
                    className={inp}
                  />
                  <span className="text-slate-500 font-medium">%</span>
                </label>
              ) : null}
              {revenuePerLocationShape === "by_year" ? (
                <div className="flex flex-wrap gap-2 w-full">
                  {projectionYears.map((y) => (
                    <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                      <span>{y} growth</span>
                      <span className="flex items-center gap-1">
                        <RevenueForecastDecimalInput
                          value={revenuePerLocationYearStrs[y] ?? ""}
                          onChange={(next) =>
                            setRevenuePerLocationYearStrs((prev) => ({ ...prev, [y]: next }))
                          }
                          className={inp}
                        />
                        <span className="text-slate-500">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {sub === "capacity_utilization_yield" ? (
          <div className="w-full space-y-4">
            <p className="text-[11px] text-slate-400 leading-snug">
              Forecasts revenue from{" "}
              <span className="text-slate-300">available capacity</span>,{" "}
              <span className="text-slate-300">expected utilization</span>, and{" "}
              <span className="text-slate-300">revenue earned per utilized unit (yield)</span>.
            </p>
            <p className="text-[10px] text-slate-500 -mt-2">
              Use this when revenue is limited by operational capacity rather than only by demand.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[8rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Starting capacity</span>
                <RevenueForecastDecimalInput
                  ref={firstRef}
                  value={capacityStartStr}
                  onChange={setCapacityStartStr}
                  className={inp}
                  title="Plain capacity count — not scaled by statement K/M"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 flex-1 min-w-[12rem] max-w-md">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  Capacity unit label <span className="normal-case text-slate-600">(optional)</span>
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="seats, rooms, MW, tons, slots, flights, hours, units"
                  value={capacityUnitLabelStr}
                  onChange={(e) => setCapacityUnitLabelStr(e.target.value)}
                  className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-full"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[9rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Starting utilization</span>
                <span className="flex items-center gap-1.5">
                  <RevenueForecastDecimalInput
                    value={utilizationStartStr}
                    onChange={setUtilizationStartStr}
                    className={inp}
                    title="Target utilization as a level (0–100%), not a growth rate"
                  />
                  <span className="text-slate-500 font-medium">%</span>
                </span>
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[11rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Starting yield</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-slate-500 tabular-nums text-xs shrink-0 font-medium" aria-hidden>
                    {currencySymbol}
                  </span>
                  <RevenueForecastDecimalInput
                    value={yieldStartStr}
                    onChange={setYieldStartStr}
                    className={inp}
                    title="Revenue per utilized unit — actual currency, not statement thousands/millions"
                  />
                </span>
              </label>
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[12rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Yield basis</span>
                <select
                  value={yieldBasis}
                  onChange={(e) => setYieldBasis(e.target.value as MonetizationPeriodBasisV1)}
                  className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2 w-full max-w-xs"
                >
                  <option value="annual">Annual</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <p className="text-[10px] text-slate-500 max-w-xl flex-1 pb-1 leading-snug">
                Period basis applies to yield only. If Monthly is selected, the model annualizes yield by ×12. Capacity
                and utilization stay natural levels each year.
              </p>
            </div>
            <p className="text-[10px] text-slate-600 leading-relaxed space-y-0.5">
              <span className="block">
                <span className="text-slate-500">Drivers ·</span> Starting capacity = operational limit (plain count,
                not K/M). Utilization = share of capacity used (0–100%), entered as a level, not compounded like revenue
                growth.
              </span>
              <span className="block">
                Starting yield = revenue per utilized unit ({currencySymbol} amount) at the basis you select — not scaled
                by the model&apos;s revenue K/M display.
              </span>
            </p>
            {capacityUnitLabelStr.trim() ? (
              <p className="text-[10px] text-slate-600">
                Capacity unit: <span className="text-slate-400">{capacityUnitLabelStr.trim()}</span>
              </p>
            ) : null}
            <p className="text-[10px] text-slate-500 border border-slate-700/60 rounded-md px-2.5 py-2 bg-slate-950/40">
              <span className="font-semibold text-slate-400">Formula · </span>
              Revenue = Capacity × (Utilization ÷ 100) × Yield
              {yieldBasis === "monthly" ? (
                <span className="text-slate-500"> × 12 (monthly yield annualized)</span>
              ) : null}
              .
            </p>

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Capacity growth</label>
              <select
                value={capacityShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = capacityShape;
                  setCapacityShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(capacityPhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setCapacityYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = capacityGrowthStr.trim();
                        setCapacityYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) if (!n[y]) n[y] = base;
                          return n;
                        });
                      }
                    } else {
                      const base = capacityGrowthStr.trim();
                      setCapacityYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) if (!n[y]) n[y] = base;
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setCapacityPhaseRows(defaultFullRangePhase(projectionYears, capacityGrowthStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (capacityYearStrs[y0] ?? "").trim();
                      const fallbackRate = capacityGrowthStr.trim();
                      setCapacityPhaseRows(defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
              {capacityShape === "phases" ? (
                <GrowthPhaseEditor
                  phaseRows={capacityPhaseRows}
                  setPhaseRows={setCapacityPhaseRows}
                  projectionYears={projectionYears}
                  inp={inp}
                />
              ) : null}
              {capacityShape === "constant" ? (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500 shrink-0">Growth %</span>
                  <RevenueForecastDecimalInput
                    value={capacityGrowthStr}
                    onChange={setCapacityGrowthStr}
                    className={inp}
                  />
                  <span className="text-slate-500 font-medium">%</span>
                </label>
              ) : null}
              {capacityShape === "by_year" ? (
                <div className="flex flex-wrap gap-2 w-full">
                  {projectionYears.map((y) => (
                    <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                      <span>{y} growth</span>
                      <span className="flex items-center gap-1">
                        <RevenueForecastDecimalInput
                          value={capacityYearStrs[y] ?? ""}
                          onChange={(next) => setCapacityYearStrs((prev) => ({ ...prev, [y]: next }))}
                          className={inp}
                        />
                        <span className="text-slate-500">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">
                Utilization path (levels by year)
              </label>
              <p className="text-[10px] text-slate-600 -mt-1 mb-1 max-w-2xl">
                Utilization is a <span className="text-slate-400">target % of capacity</span> each year — not a compounding
                growth rate. Use constant, by-year targets, or phased targets.
              </p>
              <select
                value={utilShape}
                onChange={(e) => {
                  const v = e.target.value as UtilizationPathShapeV1;
                  const prev = utilShape;
                  setUtilShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases: UtilizationPhaseV1[] = utilPhaseRows.map((d) => ({
                        startYear: d.startYear,
                        endYear: d.endYear,
                        utilizationPct: parseFloat(String(d.rateStr).replace(/,/g, "").trim()),
                      }));
                      if (validateUtilizationPhases(phases, projectionYears).ok) {
                        const r = expandUtilizationPhasesToLevelsByYear(phases, projectionYears);
                        setUtilYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = utilizationStartStr.trim();
                        setUtilYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) if (!n[y]) n[y] = base;
                          return n;
                        });
                      }
                    } else {
                      const base = utilizationStartStr.trim();
                      setUtilYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) if (!n[y]) n[y] = base;
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setUtilPhaseRows(defaultFullRangePhase(projectionYears, utilizationStartStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const first = (utilYearStrs[y0] ?? "").trim();
                      const fallback = utilizationStartStr.trim();
                      setUtilPhaseRows(defaultFullRangePhase(projectionYears, first || fallback));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant utilization</option>
                <option value="phases">Phased utilization targets</option>
                <option value="by_year">By year</option>
              </select>
              {utilShape === "phases" ? (
                <GrowthPhaseEditor
                  phaseRows={utilPhaseRows}
                  setPhaseRows={setUtilPhaseRows}
                  projectionYears={projectionYears}
                  inp={inp}
                  rateColumnLabel="Utilization %"
                  afterAddHint="New phase added — review years and utilization % if needed."
                  fillRemainingTitle="Fills any missing forecast years using the last utilization target."
                />
              ) : null}
              {utilShape === "constant" ? (
                <p className="text-[10px] text-slate-500">
                  Each forecast year uses the <span className="text-slate-400">starting utilization %</span> above.
                </p>
              ) : null}
              {utilShape === "by_year" ? (
                <div className="flex flex-wrap gap-2 w-full">
                  {projectionYears.map((y) => (
                    <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                      <span>{y} utilization</span>
                      <span className="flex items-center gap-1">
                        <RevenueForecastDecimalInput
                          value={utilYearStrs[y] ?? ""}
                          onChange={(next) => setUtilYearStrs((prev) => ({ ...prev, [y]: next }))}
                          className={inp}
                        />
                        <span className="text-slate-500">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Yield growth</label>
              <select
                value={yieldShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = yieldShape;
                  setYieldShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(yieldPhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setYieldYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = yieldGrowthStr.trim();
                        setYieldYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) if (!n[y]) n[y] = base;
                          return n;
                        });
                      }
                    } else {
                      const base = yieldGrowthStr.trim();
                      setYieldYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) if (!n[y]) n[y] = base;
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setYieldPhaseRows(defaultFullRangePhase(projectionYears, yieldGrowthStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (yieldYearStrs[y0] ?? "").trim();
                      const fallbackRate = yieldGrowthStr.trim();
                      setYieldPhaseRows(defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
              {yieldShape === "phases" ? (
                <GrowthPhaseEditor
                  phaseRows={yieldPhaseRows}
                  setPhaseRows={setYieldPhaseRows}
                  projectionYears={projectionYears}
                  inp={inp}
                />
              ) : null}
              {yieldShape === "constant" ? (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500 shrink-0">Growth %</span>
                  <RevenueForecastDecimalInput
                    value={yieldGrowthStr}
                    onChange={setYieldGrowthStr}
                    className={inp}
                  />
                  <span className="text-slate-500 font-medium">%</span>
                </label>
              ) : null}
              {yieldShape === "by_year" ? (
                <div className="flex flex-wrap gap-2 w-full">
                  {projectionYears.map((y) => (
                    <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                      <span>{y} growth</span>
                      <span className="flex items-center gap-1">
                        <RevenueForecastDecimalInput
                          value={yieldYearStrs[y] ?? ""}
                          onChange={(next) => setYieldYearStrs((prev) => ({ ...prev, [y]: next }))}
                          className={inp}
                        />
                        <span className="text-slate-500">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {sub === "contracts_acv" ? (
          <div className="w-full space-y-4">
            <p className="text-[11px] text-slate-400 leading-snug">
              Forecasts revenue as{" "}
              <span className="text-slate-300">projected contract count × projected annual contract value (ACV)</span>,
              each with its own growth pattern.
            </p>
            <p className="text-[10px] text-slate-500 -mt-2">
              Use this when revenue is driven by enterprise or account contracts and ACV. ACV means{" "}
              <span className="text-slate-400">Annual Contract Value</span> — annual revenue per contract — so no
              monthly/annual basis selector is needed here (unlike ARPU / revenue-per-location methods).
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[8rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Starting contracts</span>
                <RevenueForecastDecimalInput
                  ref={firstRef}
                  value={contractsStartStr}
                  onChange={setContractsStartStr}
                  className={inp}
                  title="Plain contract count — not scaled by statement K/M"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 flex-1 min-w-[12rem] max-w-md">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  Contract unit label <span className="normal-case text-slate-600">(optional)</span>
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="contracts, enterprise accounts, customers, accounts, subscriptions, agreements"
                  value={contractUnitLabelStr}
                  onChange={(e) => setContractUnitLabelStr(e.target.value)}
                  className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-full"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400 min-w-[11rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Starting ACV</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-slate-500 tabular-nums text-xs shrink-0 font-medium" aria-hidden>
                    {currencySymbol}
                  </span>
                  <RevenueForecastDecimalInput
                    value={acvStartStr}
                    onChange={setAcvStartStr}
                    className={inp}
                    title="Annual contract value per contract — actual currency, not K/M display"
                  />
                </span>
              </label>
            </div>
            <p className="text-[10px] text-slate-600 leading-relaxed space-y-0.5">
              <span className="block">
                <span className="text-slate-500">Drivers ·</span> Starting contracts = count of active contracts /
                accounts (plain number). ACV = <span className="text-slate-400">annual</span> revenue per contract (
                {currencySymbol} per year), not per month.
              </span>
            </p>
            {contractUnitLabelStr.trim() ? (
              <p className="text-[10px] text-slate-600">
                Contract unit: <span className="text-slate-400">{contractUnitLabelStr.trim()}</span>
              </p>
            ) : null}

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">
                Contract growth
              </label>
              <select
                value={contractShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = contractShape;
                  setContractShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(contractPhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setContractYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = contractGrowthStr.trim();
                        setContractYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) if (!n[y]) n[y] = base;
                          return n;
                        });
                      }
                    } else {
                      const base = contractGrowthStr.trim();
                      setContractYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) if (!n[y]) n[y] = base;
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setContractPhaseRows(defaultFullRangePhase(projectionYears, contractGrowthStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (contractYearStrs[y0] ?? "").trim();
                      const fallbackRate = contractGrowthStr.trim();
                      setContractPhaseRows(defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
              {contractShape === "phases" ? (
                <GrowthPhaseEditor
                  phaseRows={contractPhaseRows}
                  setPhaseRows={setContractPhaseRows}
                  projectionYears={projectionYears}
                  inp={inp}
                />
              ) : null}
              {contractShape === "constant" ? (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500 shrink-0">Growth %</span>
                  <RevenueForecastDecimalInput
                    value={contractGrowthStr}
                    onChange={setContractGrowthStr}
                    className={inp}
                  />
                  <span className="text-slate-500 font-medium">%</span>
                </label>
              ) : null}
              {contractShape === "by_year" ? (
                <div className="flex flex-wrap gap-2 w-full">
                  {projectionYears.map((y) => (
                    <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                      <span>{y} growth</span>
                      <span className="flex items-center gap-1">
                        <RevenueForecastDecimalInput
                          value={contractYearStrs[y] ?? ""}
                          onChange={(next) => setContractYearStrs((prev) => ({ ...prev, [y]: next }))}
                          className={inp}
                        />
                        <span className="text-slate-500">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">ACV growth</label>
              <select
                value={acvShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = acvShape;
                  setAcvShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(acvPhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setAcvYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = acvGrowthStr.trim();
                        setAcvYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) if (!n[y]) n[y] = base;
                          return n;
                        });
                      }
                    } else {
                      const base = acvGrowthStr.trim();
                      setAcvYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) if (!n[y]) n[y] = base;
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setAcvPhaseRows(defaultFullRangePhase(projectionYears, acvGrowthStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (acvYearStrs[y0] ?? "").trim();
                      const fallbackRate = acvGrowthStr.trim();
                      setAcvPhaseRows(defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
              {acvShape === "phases" ? (
                <GrowthPhaseEditor
                  phaseRows={acvPhaseRows}
                  setPhaseRows={setAcvPhaseRows}
                  projectionYears={projectionYears}
                  inp={inp}
                />
              ) : null}
              {acvShape === "constant" ? (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="text-slate-500 shrink-0">Growth %</span>
                  <RevenueForecastDecimalInput
                    value={acvGrowthStr}
                    onChange={setAcvGrowthStr}
                    className={inp}
                  />
                  <span className="text-slate-500 font-medium">%</span>
                </label>
              ) : null}
              {acvShape === "by_year" ? (
                <div className="flex flex-wrap gap-2 w-full">
                  {projectionYears.map((y) => (
                    <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                      <span>{y} growth</span>
                      <span className="flex items-center gap-1">
                        <RevenueForecastDecimalInput
                          value={acvYearStrs[y] ?? ""}
                          onChange={(next) => setAcvYearStrs((prev) => ({ ...prev, [y]: next }))}
                          className={inp}
                        />
                        <span className="text-slate-500">%</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {sub === "growth_from_historical" && hasHistoric ? (
          <div className="w-full space-y-2">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">
                Growth pattern (from historical)
              </label>
              <select
                value={histShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = histShape;
                  setHistShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(histPhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setHistYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = growthStr.trim();
                        setHistYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) {
                            if (!n[y]) n[y] = base;
                          }
                          return n;
                        });
                      }
                    } else {
                      const base = growthStr.trim();
                      setHistYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) {
                          if (!n[y]) n[y] = base;
                        }
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setHistPhaseRows(defaultFullRangePhase(projectionYears, growthStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (histYearStrs[y0] ?? "").trim();
                      const fallbackRate = growthStr.trim();
                      setHistPhaseRows(defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
            </div>
            {histShape === "phases" ? (
              <GrowthPhaseEditor
                phaseRows={histPhaseRows}
                setPhaseRows={setHistPhaseRows}
                projectionYears={projectionYears}
                inp={inp}
              />
            ) : null}
            {histShape === "constant" ? (
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="text-slate-500 shrink-0">Growth %</span>
                <RevenueForecastDecimalInput
                  ref={firstRef}
                  value={growthStr}
                  onChange={setGrowthStr}
                  className={inp}
                />
                <span className="text-slate-500 font-medium">%</span>
              </label>
            ) : null}
            {histShape === "by_year" ? (
              <div className="flex flex-wrap gap-2 w-full">
                {projectionYears.map((y, i) => (
                  <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                    <span>{y} growth</span>
                    <span className="flex items-center gap-1">
                      <RevenueForecastDecimalInput
                        ref={i === 0 ? firstRef : undefined}
                        value={histYearStrs[y] ?? ""}
                        onChange={(next) => setHistYearStrs((prev) => ({ ...prev, [y]: next }))}
                        className={inp}
                      />
                      <span className="text-slate-500">%</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {sub === "growth_from_manual_start" ? (
          <div className="w-full space-y-2">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">
                Growth pattern (manual start)
              </label>
              <select
                value={manualShape}
                onChange={(e) => {
                  const v = e.target.value as HistGrowthShapeV1;
                  const prev = manualShape;
                  setManualShape(v);
                  if (v === "by_year") {
                    if (prev === "phases") {
                      const phases = draftsToPhases(manualPhaseRows);
                      if (validateGrowthPhases(phases, projectionYears).ok) {
                        const r = expandPhasesToRatesByYear(phases, projectionYears);
                        setManualYearStrs(
                          Object.fromEntries(
                            projectionYears.map((y) => [
                              y,
                              r[y] != null && Number.isFinite(Number(r[y])) ? fmtNumericDisplay(Number(r[y])) : "",
                            ])
                          )
                        );
                      } else {
                        const base = growthStr.trim();
                        setManualYearStrs((p) => {
                          const n = { ...p };
                          for (const y of projectionYears) {
                            if (!n[y]) n[y] = base;
                          }
                          return n;
                        });
                      }
                    } else {
                      const base = growthStr.trim();
                      setManualYearStrs((p) => {
                        const n = { ...p };
                        for (const y of projectionYears) {
                          if (!n[y]) n[y] = base;
                        }
                        return n;
                      });
                    }
                  }
                  if (v === "phases") {
                    if (prev === "constant") {
                      setManualPhaseRows(defaultFullRangePhase(projectionYears, growthStr.trim()));
                    } else if (prev === "by_year") {
                      const y0 = projectionYears[0]!;
                      const firstYearRate = (manualYearStrs[y0] ?? "").trim();
                      const fallbackRate = growthStr.trim();
                      setManualPhaseRows(defaultFullRangePhase(projectionYears, firstYearRate || fallbackRate));
                    }
                  }
                }}
                className="w-full max-w-md rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant growth</option>
                <option value="phases">Growth phases</option>
                <option value="by_year">By year</option>
              </select>
            </div>
            {manualShape === "phases" ? (
              <GrowthPhaseEditor
                phaseRows={manualPhaseRows}
                setPhaseRows={setManualPhaseRows}
                projectionYears={projectionYears}
                inp={inp}
              />
            ) : null}
            {manualShape === "constant" ? (
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="text-slate-500 shrink-0">Growth %</span>
                <RevenueForecastDecimalInput
                  ref={firstRef}
                  value={growthStr}
                  onChange={setGrowthStr}
                  className={inp}
                />
                <span className="text-slate-500 font-medium">%</span>
              </label>
            ) : null}
            {manualShape === "by_year" ? (
              <div className="flex flex-wrap gap-2 w-full">
                {projectionYears.map((y, i) => (
                  <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                    <span>{y} growth</span>
                    <span className="flex items-center gap-1">
                      <RevenueForecastDecimalInput
                        ref={i === 0 ? firstRef : undefined}
                        value={manualYearStrs[y] ?? ""}
                        onChange={(next) => setManualYearStrs((prev) => ({ ...prev, [y]: next }))}
                        className={inp}
                      />
                      <span className="text-slate-500">%</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="text-slate-500 shrink-0">Starting amount</span>
              <RevenueForecastDecimalInput
                value={startStr}
                onChange={setStartStr}
                className={`${inp} w-28`}
              />
            </label>
          </div>
        ) : null}
        {sub === "flat_value" && (
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="text-slate-500 shrink-0">Flat amount</span>
            <RevenueForecastDecimalInput
              ref={firstRef}
              value={flatStr}
              onChange={setFlatStr}
              className={`${inp} w-28`}
            />
          </label>
        )}
        {sub === "manual_by_year" && (
          <div className="flex flex-wrap gap-2 w-full">
            {projectionYears.map((y, i) => (
              <label key={y} className="flex flex-col gap-0.5 text-[10px] text-slate-500">
                <span>{y}</span>
                <span className="flex items-center gap-1">
                  <RevenueForecastDecimalInput
                    ref={i === 0 ? firstRef : undefined}
                    value={yearStrs[y] ?? ""}
                    onChange={(next) => setYearStrs((prev) => ({ ...prev, [y]: next }))}
                    className={`${inp} w-20`}
                  />
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { DERIVED_PARENT_EXPLAINER, ALLOCATION_CHILD_EXPLAINER };

export function RevenueForecastV1MethodologyCallout(props: {
  variant: "build_from_children" | "allocate_from_parent";
  allocationSum?: number;
  hasChildren?: boolean;
  allocLineCount?: number;
  showAllocationExplainer?: boolean;
}) {
  const { variant, allocationSum, hasChildren, allocLineCount, showAllocationExplainer } = props;
  if (variant === "build_from_children") {
    const m = METHODOLOGY.build_from_children;
    const ok = hasChildren === true;
    return (
      <div
        className={`rounded-md border px-3 py-2 text-[11px] mb-2 space-y-1 ${
          ok ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-100/90" : "border-amber-800/50 bg-amber-950/20"
        }`}
      >
        <div className="font-semibold text-slate-200">{m.title}</div>
        <p className="text-[10px] text-slate-400 leading-snug">{DERIVED_PARENT_EXPLAINER}</p>
        <div className="text-slate-400">Formula: {m.formula}</div>
        <div>Inputs: {m.inputs}</div>
        <div>Validation: {ok ? `✓ ${m.validation}` : `⚠ ${m.validation}`}</div>
      </div>
    );
  }
  const m = METHODOLOGY.allocate_from_parent;
  const n = allocLineCount ?? 0;
  const sum = allocationSum ?? 0;
  if (n === 0 && !showAllocationExplainer) {
    return (
      <div className="rounded-md border border-slate-600/50 bg-slate-900/50 px-3 py-2 text-[11px] mb-2 text-slate-300 space-y-1">
        <div className="font-semibold text-slate-200">{m.title}</div>
        <div className="text-slate-400">Formula: {m.formula}</div>
        <div>Add lines. When lines exist, all % must add up to 100%.</div>
      </div>
    );
  }
  const ok = n > 0 && Math.abs(sum - 100) <= REVENUE_ALLOC_SUM_TOLERANCE;
  const over = n > 0 && sum > 100 + REVENUE_ALLOC_SUM_TOLERANCE;
  const borderTone =
    n === 0
      ? "border-slate-600/50 bg-slate-900/50 text-slate-300"
      : ok
        ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-100/90"
        : over
          ? "border-red-800/50 bg-red-950/25 text-red-100/90"
          : "border-amber-800/50 bg-amber-950/20 text-amber-100/90";
  return (
    <div className={`rounded-md border px-3 py-2 text-[11px] mb-2 space-y-1 ${borderTone}`}>
      <div className="font-semibold text-slate-200">{m.title}</div>
      {showAllocationExplainer ? (
        <ul className="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">
          {ALLOCATION_CHILD_EXPLAINER.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <>
          <div className="text-slate-400">Formula: {m.formula}</div>
          <div>Inputs: {m.inputs}</div>
        </>
      )}
      {n > 0 ? (
        <div className="pt-1 border-t border-slate-600/40">
          {ok ? (
            <span className="text-emerald-400 font-medium">100% assigned — projections allowed</span>
          ) : over ? (
            <span className="text-red-300/95 font-medium">
              {sum.toFixed(2)}% assigned — exceeds 100% by {(sum - 100).toFixed(2)}% — projections blocked
            </span>
          ) : (
            <span className="text-amber-200/95 font-medium">
              {sum.toFixed(2)}% assigned — missing {(100 - sum).toFixed(2)}% — projections blocked until total is exactly 100%
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
