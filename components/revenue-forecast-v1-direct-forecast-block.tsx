"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { RevenueForecastRowConfigV1 } from "@/types/revenue-forecast-v1";
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
  expandPhasesToRatesByYear,
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
  { id: "flat_value", label: DIRECT_METHOD_UX.flat_value.title },
  { id: "manual_by_year", label: DIRECT_METHOD_UX.manual_by_year.title },
];

function readPriceVolumeSideFromCfg(
  cfg: RevenueForecastRowConfigV1 | undefined,
  projectionYears: string[],
  side: "volume" | "price",
  fallbackRateStr: string
): { shape: HistGrowthShapeV1; yearStrs: Record<string, string>; phaseRows: PhaseDraftV1[]; rateStr: string } {
  const p = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
  const pre = side === "volume" ? "volume" : "price";
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
  if (c?.forecastMethod === "price_volume") {
    return {
      sub: "price_volume",
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
}) {
  const { phaseRows, setPhaseRows, projectionYears, inp } = props;
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
            Growth %
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
          New phase added — review years and growth % if needed.
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
          title="Fills any missing forecast years using the last growth rate."
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

  const syncFromCfg = useCallback(
    (forceReset: boolean) => {
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
        const vr = readPriceVolumeSideFromCfg(cfg, projectionYears, "volume", "");
        setVolShape(vr.shape);
        setVolGrowthStr(vr.rateStr);
        setVolPhaseRows(vr.phaseRows);
        setVolYearStrs(
          vr.shape === "by_year"
            ? vr.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, vr.yearStrs[y] ?? ""]))
        );
        const pr = readPriceVolumeSideFromCfg(cfg, projectionYears, "price", "");
        setPriceShape(pr.shape);
        setPriceGrowthStr(pr.rateStr);
        setPricePhaseRows(pr.phaseRows);
        setPriceYearStrs(
          pr.shape === "by_year"
            ? pr.yearStrs
            : Object.fromEntries(projectionYears.map((y) => [y, pr.yearStrs[y] ?? ""]))
        );
        setVolUnitLabelStr(typeof p.volumeUnitLabel === "string" ? p.volumeUnitLabel : "");
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
    return "";
  }, [
    sub,
    histShape,
    manualShape,
    volShape,
    priceShape,
    histPhaseRows,
    manualPhaseRows,
    volPhaseRows,
    pricePhaseRows,
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
  const statusLine =
    sub === "price_volume"
      ? phaseValidationMessage || priceVolumeStatusLine
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
      !formValid)
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
    if (focusNonce <= 0) return;
    const t = requestAnimationFrame(() => firstRef.current?.focus());
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
      const vr = readPriceVolumeSideFromCfg(config, projectionYears, "volume", "");
      setVolShape(vr.shape);
      setVolGrowthStr(vr.rateStr);
      setVolPhaseRows(vr.phaseRows);
      if (vr.shape === "by_year") setVolYearStrs(vr.yearStrs);
      else setVolYearStrs(Object.fromEntries(projectionYears.map((y) => [y, vr.yearStrs[y] ?? ""])));
      const pr = readPriceVolumeSideFromCfg(config, projectionYears, "price", "");
      setPriceShape(pr.shape);
      setPriceGrowthStr(pr.rateStr);
      setPricePhaseRows(pr.phaseRows);
      if (pr.shape === "by_year") setPriceYearStrs(pr.yearStrs);
      else setPriceYearStrs(Object.fromEntries(projectionYears.map((y) => [y, pr.yearStrs[y] ?? ""])));
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
            : (sub === "growth_from_historical" && histShape === "phases") ||
                (sub === "growth_from_manual_start" && manualShape === "phases")
              ? GROWTH_PHASES_UX.title
              : ux.title}
        </div>
        <p className="text-slate-400 leading-snug">
          {sub === "price_volume" && (volShape === "phases" || priceShape === "phases")
            ? `${DIRECT_METHOD_UX.price_volume.oneLine} ${GROWTH_PHASES_UX.oneLine}`
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
