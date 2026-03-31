"use client";

import { useEffect, useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import { detectCogsLinesFromIncomeStatement } from "@/lib/cogs-line-detection";
import {
  buildForecastableCogsLinesFromRevenue,
  mergeForecastableLinesWithConfig,
  hasPersistedCogsCpcConfig,
  hasPersistedCogsPctConfig,
  hasPersistedCogsCpuConfig,
  revenueRowUsesCustomersArpuForCogsEligibility,
  revenueRowUsesPriceVolumeForCogsEligibility,
  resolveCustomersArpuStartingDriversForCogsLinkedRow,
  resolvePriceVolumeStartingDriversForCogsLinkedRow,
  type ForecastableCogsLine,
} from "@/lib/cogs-forecast-v1";
import {
  formatDriverAbsoluteCurrency,
  formatDriverPercentOneDecimal,
  formatDriverVolumeCount,
} from "@/lib/forecast-driver-display-format";
import { getRevenueForecastConfigV1RowsFingerprint } from "@/lib/revenue-forecast-v1-fingerprint";
import type { ForecastRevenueNodeV1, RevenueForecastConfigV1 } from "@/types/revenue-forecast-v1";
import type { CogsForecastLineConfigV1 } from "@/types/cogs-forecast-v1";
import { RevenueForecastDecimalInput } from "@/components/revenue-forecast-decimal-input";
import { GrowthPhaseEditor, type PhaseDraftV1 } from "@/components/revenue-forecast-v1-direct-forecast-block";
import { formatNumberInputDisplayOnBlur } from "@/lib/revenue-forecast-numeric-format";
import {
  validateGrowthPhases,
  expandPhasesToRatesByYear,
  GROWTH_PHASE_MESSAGES,
  type GrowthPhaseV1,
} from "@/lib/revenue-growth-phases-v1";

type HistGrowthShapeV1 = "constant" | "phases" | "by_year";

const COGS_PHASE_INP =
  "rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 text-right";

function mapCogsPhaseValidationErrors(errors: string[]): string[] {
  const map: Record<string, string> = {
    [GROWTH_PHASE_MESSAGES.overlap]: "COGS phases cannot overlap.",
    [GROWTH_PHASE_MESSAGES.gaps]:
      "Each COGS phase must start after the previous phase ends, with no gaps or backward ranges.",
    [GROWTH_PHASE_MESSAGES.needRate]: "Each COGS phase needs a %.",
    [GROWTH_PHASE_MESSAGES.coverAll]: "COGS phases must cover all projection years in order.",
    [GROWTH_PHASE_MESSAGES.count]: "Use 1–4 COGS % phases.",
  };
  return [...new Set(errors.map((e) => map[e] ?? e))];
}

function mapCogsCpuPhaseValidationErrors(errors: string[]): string[] {
  const map: Record<string, string> = {
    [GROWTH_PHASE_MESSAGES.overlap]: "Cost per unit phases cannot overlap.",
    [GROWTH_PHASE_MESSAGES.gaps]:
      "Each phase must start after the previous phase ends, with no gaps or backward ranges.",
    [GROWTH_PHASE_MESSAGES.needRate]: "Each phase needs a growth %.",
    [GROWTH_PHASE_MESSAGES.coverAll]: "Phases must cover all projection years in order.",
    [GROWTH_PHASE_MESSAGES.count]: "Use 1–4 cost per unit growth phases.",
  };
  return [...new Set(errors.map((e) => map[e] ?? e))];
}

function mapCogsCpcPhaseValidationErrors(errors: string[]): string[] {
  const map: Record<string, string> = {
    [GROWTH_PHASE_MESSAGES.overlap]: "Cost per customer phases cannot overlap.",
    [GROWTH_PHASE_MESSAGES.gaps]:
      "Each phase must start after the previous phase ends, with no gaps or backward ranges.",
    [GROWTH_PHASE_MESSAGES.needRate]: "Each phase needs a growth %.",
    [GROWTH_PHASE_MESSAGES.coverAll]: "Phases must cover all projection years in order.",
    [GROWTH_PHASE_MESSAGES.count]: "Use 1–4 cost per customer growth phases.",
  };
  return [...new Set(errors.map((e) => map[e] ?? e))];
}

function newPhaseId(): string {
  return `cogs-ph-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultFullRangePhase(projectionYears: string[], rateStr: string): PhaseDraftV1[] {
  if (!projectionYears.length) return [{ id: newPhaseId(), startYear: "", endYear: "", rateStr }];
  return [
    {
      id: newPhaseId(),
      startYear: projectionYears[0] ?? "",
      endYear: projectionYears[projectionYears.length - 1] ?? "",
      rateStr,
    },
  ];
}

function draftsToPhases(drafts: PhaseDraftV1[]): GrowthPhaseV1[] {
  return drafts.map((d) => ({
    startYear: d.startYear,
    endYear: d.endYear,
    ratePercent: parseFloat(String(d.rateStr ?? "").replace(/,/g, "").trim()),
  }));
}

function confidenceTone(c: "high" | "medium" | "low"): string {
  if (c === "high") return "text-emerald-300";
  if (c === "medium") return "text-amber-300";
  return "text-slate-400";
}

function fmtNumericDisplay(n: number): string {
  if (!Number.isFinite(n)) return "";
  return formatNumberInputDisplayOnBlur(String(n));
}

function parseNumericInput(v: string): number | null {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** Compare saved line config to local draft UI — independent of validation / Apply payload coercion. */
function buildSavedUiSnapshot(
  cfg: CogsForecastLineConfigV1 | undefined,
  projectionYears: string[]
): string {
  if (!cfg?.forecastMethod || cfg.forecastMethod !== "pct_of_revenue") {
    return JSON.stringify({
      method: "",
      shape: "constant",
      pctStr: "",
      yearStrs: {} as Record<string, string>,
      phaseTuples: [] as Array<{ startYear: string; endYear: string; rateStr: string }>,
    });
  }
  const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const pType = (p.growthPatternType as string | undefined) ?? "constant";
  if (pType === "by_year") {
    const by = (p.pctsByYear ?? {}) as Record<string, number>;
    const orderedEntries = projectionYears.map((y) => {
      const raw = by[y];
      const n = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : 0;
      return [y, fmtNumericDisplay(n)] as const;
    });
    const yearStrs = Object.fromEntries(orderedEntries);
    const pctStr =
      projectionYears.length > 0 ? (orderedEntries[0]?.[1] ?? "") : "";
    return JSON.stringify({
      method: "pct_of_revenue",
      shape: "by_year",
      pctStr,
      yearStrs,
      phaseTuples: [],
    });
  }
  if (pType === "phases") {
    const raw = Array.isArray(p.growthPhases) ? (p.growthPhases as GrowthPhaseV1[]) : [];
    const phaseTuples = raw.map((ph) => ({
      startYear: String(ph.startYear ?? ""),
      endYear: String(ph.endYear ?? ""),
      rateStr:
        ph.ratePercent != null && Number.isFinite(Number(ph.ratePercent))
          ? fmtNumericDisplay(Number(ph.ratePercent))
          : "",
    }));
    return JSON.stringify({
      method: "pct_of_revenue",
      shape: "phases",
      pctStr: "",
      yearStrs: {},
      phaseTuples,
    });
  }
  return JSON.stringify({
    method: "pct_of_revenue",
    shape: "constant",
    pctStr: p.pct != null && Number.isFinite(Number(p.pct)) ? fmtNumericDisplay(Number(p.pct)) : "",
    yearStrs: {},
    phaseTuples: [],
  });
}

/**
 * Must mirror `buildSavedUiSnapshot` structure per shape so `hasUnsavedChanges` matches store after Apply
 * (saved uses {} / [] for unused fields; by-year & % use canonical fmtNumericDisplay).
 */
function buildDraftUiSnapshot(
  method: "" | "pct_of_revenue" | "cost_per_unit",
  shape: HistGrowthShapeV1,
  pctStr: string,
  yearStrs: Record<string, string>,
  phaseRows: PhaseDraftV1[],
  projectionYears: string[]
): string {
  if (!method || method !== "pct_of_revenue") {
    return JSON.stringify({
      method: "",
      shape: "constant",
      pctStr: "",
      yearStrs: {} as Record<string, string>,
      phaseTuples: [] as Array<{ startYear: string; endYear: string; rateStr: string }>,
    });
  }
  if (shape === "by_year") {
    const orderedYearStrs = Object.fromEntries(
      projectionYears.map((y) => {
        const n = parseNumericInput(yearStrs[y] ?? "") ?? 0;
        return [y, fmtNumericDisplay(n)];
      })
    );
    const firstN =
      projectionYears.length > 0 ? parseNumericInput(yearStrs[projectionYears[0]!] ?? "") ?? 0 : 0;
    return JSON.stringify({
      method: "pct_of_revenue",
      shape: "by_year",
      pctStr: fmtNumericDisplay(firstN),
      yearStrs: orderedYearStrs,
      phaseTuples: [],
    });
  }
  if (shape === "phases") {
    const phaseTuples = phaseRows.map((r) => {
      const p = parseFloat(String(r.rateStr ?? "").replace(/,/g, "").trim());
      return {
        startYear: r.startYear,
        endYear: r.endYear,
        rateStr: Number.isFinite(p) ? fmtNumericDisplay(p) : "",
      };
    });
    return JSON.stringify({
      method: "pct_of_revenue",
      shape: "phases",
      pctStr: "",
      yearStrs: {},
      phaseTuples,
    });
  }
  const p = parseNumericInput(pctStr);
  return JSON.stringify({
    method: "pct_of_revenue",
    shape: "constant",
    pctStr: p != null ? fmtNumericDisplay(p) : "",
    yearStrs: {},
    phaseTuples: [],
  });
}

function buildSavedCpuSnapshot(cfg: CogsForecastLineConfigV1 | undefined, projectionYears: string[]): string {
  if (!cfg?.forecastMethod || cfg.forecastMethod !== "cost_per_unit") {
    return JSON.stringify({
      method: "",
      shape: "constant",
      startingStr: "",
      growthRateStr: "",
      yearStrs: {} as Record<string, string>,
      phaseTuples: [] as Array<{ startYear: string; endYear: string; rateStr: string }>,
    });
  }
  const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const pType = (p.growthPatternType as string | undefined) ?? "constant";
  const startingStr =
    p.startingCostPerUnit != null && Number.isFinite(Number(p.startingCostPerUnit))
      ? fmtNumericDisplay(Number(p.startingCostPerUnit))
      : "";
  if (pType === "by_year") {
    const by = (p.costPerUnitRatesByYear ?? {}) as Record<string, number>;
    const orderedEntries = projectionYears.map((y) => {
      const raw = by[y];
      const n = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : 0;
      return [y, fmtNumericDisplay(n)] as const;
    });
    const yearStrs = Object.fromEntries(orderedEntries);
    const growthRateStr =
      projectionYears.length > 0 ? (orderedEntries[0]?.[1] ?? "") : "";
    return JSON.stringify({
      method: "cost_per_unit",
      shape: "by_year",
      startingStr,
      growthRateStr,
      yearStrs,
      phaseTuples: [],
    });
  }
  if (pType === "phases") {
    const raw = Array.isArray(p.costPerUnitGrowthPhases)
      ? (p.costPerUnitGrowthPhases as GrowthPhaseV1[])
      : [];
    const phaseTuples = raw.map((ph) => ({
      startYear: String(ph.startYear ?? ""),
      endYear: String(ph.endYear ?? ""),
      rateStr:
        ph.ratePercent != null && Number.isFinite(Number(ph.ratePercent))
          ? fmtNumericDisplay(Number(ph.ratePercent))
          : "",
    }));
    return JSON.stringify({
      method: "cost_per_unit",
      shape: "phases",
      startingStr,
      growthRateStr: "",
      yearStrs: {},
      phaseTuples,
    });
  }
  const gr =
    p.costPerUnitRatePercent != null && Number.isFinite(Number(p.costPerUnitRatePercent))
      ? fmtNumericDisplay(Number(p.costPerUnitRatePercent))
      : "";
  return JSON.stringify({
    method: "cost_per_unit",
    shape: "constant",
    startingStr,
    growthRateStr: gr,
    yearStrs: {},
    phaseTuples: [],
  });
}

function buildDraftCpuSnapshot(
  method: "" | "pct_of_revenue" | "cost_per_unit" | "cost_per_customer",
  cpuShape: HistGrowthShapeV1,
  startingCostStr: string,
  growthRateStr: string,
  cpuYearStrs: Record<string, string>,
  cpuPhaseRows: PhaseDraftV1[],
  projectionYears: string[]
): string {
  if (!method || method !== "cost_per_unit") {
    return JSON.stringify({
      method: "",
      shape: "constant",
      startingStr: "",
      growthRateStr: "",
      yearStrs: {} as Record<string, string>,
      phaseTuples: [] as Array<{ startYear: string; endYear: string; rateStr: string }>,
    });
  }
  const startN = parseNumericInput(startingCostStr);
  const startingCanon = startN != null ? fmtNumericDisplay(startN) : "";
  if (cpuShape === "by_year") {
    const orderedYearStrs = Object.fromEntries(
      projectionYears.map((y) => {
        const n = parseNumericInput(cpuYearStrs[y] ?? "") ?? 0;
        return [y, fmtNumericDisplay(n)];
      })
    );
    const firstN =
      projectionYears.length > 0 ? parseNumericInput(cpuYearStrs[projectionYears[0]!] ?? "") ?? 0 : 0;
    return JSON.stringify({
      method: "cost_per_unit",
      shape: "by_year",
      startingStr: startingCanon,
      growthRateStr: fmtNumericDisplay(firstN),
      yearStrs: orderedYearStrs,
      phaseTuples: [],
    });
  }
  if (cpuShape === "phases") {
    const phaseTuples = cpuPhaseRows.map((r) => {
      const pv = parseFloat(String(r.rateStr ?? "").replace(/,/g, "").trim());
      return {
        startYear: r.startYear,
        endYear: r.endYear,
        rateStr: Number.isFinite(pv) ? fmtNumericDisplay(pv) : "",
      };
    });
    return JSON.stringify({
      method: "cost_per_unit",
      shape: "phases",
      startingStr: startingCanon,
      growthRateStr: "",
      yearStrs: {},
      phaseTuples,
    });
  }
  const gr = parseNumericInput(growthRateStr);
  return JSON.stringify({
    method: "cost_per_unit",
    shape: "constant",
    startingStr: startingCanon,
    growthRateStr: gr != null ? fmtNumericDisplay(gr) : "",
    yearStrs: {},
    phaseTuples: [],
  });
}

function buildSavedCpcSnapshot(cfg: CogsForecastLineConfigV1 | undefined, projectionYears: string[]): string {
  if (!cfg?.forecastMethod || cfg.forecastMethod !== "cost_per_customer") {
    return JSON.stringify({
      method: "",
      shape: "constant",
      startingStr: "",
      growthRateStr: "",
      yearStrs: {} as Record<string, string>,
      phaseTuples: [] as Array<{ startYear: string; endYear: string; rateStr: string }>,
    });
  }
  const p = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
  const pType = (p.growthPatternType as string | undefined) ?? "constant";
  const startingStr =
    p.startingCostPerCustomer != null && Number.isFinite(Number(p.startingCostPerCustomer))
      ? fmtNumericDisplay(Number(p.startingCostPerCustomer))
      : "";
  if (pType === "by_year") {
    const by = (p.costPerCustomerRatesByYear ?? {}) as Record<string, number>;
    const orderedEntries = projectionYears.map((y) => {
      const raw = by[y];
      const n = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : 0;
      return [y, fmtNumericDisplay(n)] as const;
    });
    const yearStrs = Object.fromEntries(orderedEntries);
    const growthRateStr =
      projectionYears.length > 0 ? (orderedEntries[0]?.[1] ?? "") : "";
    return JSON.stringify({
      method: "cost_per_customer",
      shape: "by_year",
      startingStr,
      growthRateStr,
      yearStrs,
      phaseTuples: [],
    });
  }
  if (pType === "phases") {
    const raw = Array.isArray(p.costPerCustomerGrowthPhases)
      ? (p.costPerCustomerGrowthPhases as GrowthPhaseV1[])
      : [];
    const phaseTuples = raw.map((ph) => ({
      startYear: String(ph.startYear ?? ""),
      endYear: String(ph.endYear ?? ""),
      rateStr:
        ph.ratePercent != null && Number.isFinite(Number(ph.ratePercent))
          ? fmtNumericDisplay(Number(ph.ratePercent))
          : "",
    }));
    return JSON.stringify({
      method: "cost_per_customer",
      shape: "phases",
      startingStr,
      growthRateStr: "",
      yearStrs: {},
      phaseTuples,
    });
  }
  const gr =
    p.costPerCustomerRatePercent != null && Number.isFinite(Number(p.costPerCustomerRatePercent))
      ? fmtNumericDisplay(Number(p.costPerCustomerRatePercent))
      : "";
  return JSON.stringify({
    method: "cost_per_customer",
    shape: "constant",
    startingStr,
    growthRateStr: gr,
    yearStrs: {},
    phaseTuples: [],
  });
}

function buildDraftCpcSnapshot(
  method: "" | "pct_of_revenue" | "cost_per_unit" | "cost_per_customer",
  cpcShape: HistGrowthShapeV1,
  startingCpcStr: string,
  cpcGrowthRateStr: string,
  cpcYearStrs: Record<string, string>,
  cpcPhaseRows: PhaseDraftV1[],
  projectionYears: string[]
): string {
  if (!method || method !== "cost_per_customer") {
    return JSON.stringify({
      method: "",
      shape: "constant",
      startingStr: "",
      growthRateStr: "",
      yearStrs: {} as Record<string, string>,
      phaseTuples: [] as Array<{ startYear: string; endYear: string; rateStr: string }>,
    });
  }
  const startN = parseNumericInput(startingCpcStr);
  const startingCanon = startN != null ? fmtNumericDisplay(startN) : "";
  if (cpcShape === "by_year") {
    const orderedYearStrs = Object.fromEntries(
      projectionYears.map((y) => {
        const n = parseNumericInput(cpcYearStrs[y] ?? "") ?? 0;
        return [y, fmtNumericDisplay(n)];
      })
    );
    const firstN =
      projectionYears.length > 0 ? parseNumericInput(cpcYearStrs[projectionYears[0]!] ?? "") ?? 0 : 0;
    return JSON.stringify({
      method: "cost_per_customer",
      shape: "by_year",
      startingStr: startingCanon,
      growthRateStr: fmtNumericDisplay(firstN),
      yearStrs: orderedYearStrs,
      phaseTuples: [],
    });
  }
  if (cpcShape === "phases") {
    const phaseTuples = cpcPhaseRows.map((r) => {
      const pv = parseFloat(String(r.rateStr ?? "").replace(/,/g, "").trim());
      return {
        startYear: r.startYear,
        endYear: r.endYear,
        rateStr: Number.isFinite(pv) ? fmtNumericDisplay(pv) : "",
      };
    });
    return JSON.stringify({
      method: "cost_per_customer",
      shape: "phases",
      startingStr: startingCanon,
      growthRateStr: "",
      yearStrs: {},
      phaseTuples,
    });
  }
  const gr = parseNumericInput(cpcGrowthRateStr);
  return JSON.stringify({
    method: "cost_per_customer",
    shape: "constant",
    startingStr: startingCanon,
    growthRateStr: gr != null ? fmtNumericDisplay(gr) : "",
    yearStrs: {},
    phaseTuples: [],
  });
}

function cogsPatternLabel(shape: HistGrowthShapeV1): string {
  if (shape === "constant") return "Constant";
  if (shape === "by_year") return "By year";
  return "Phases";
}

function fmtMethodLabel(m?: string): string {
  if (!m) return "—";
  if (m === "growth_rate") return "Growth %";
  if (m === "fixed_value") return "Fixed/Manual";
  if (m === "price_volume") return "Price × Volume";
  if (m === "customers_arpu") return "Customers × ARPU";
  if (m === "locations_revenue_per_location") return "Locations × Revenue/Location";
  if (m === "capacity_utilization_yield") return "Capacity × Utilization × Yield";
  if (m === "contracts_acv") return "Contracts × ACV";
  return m;
}

function ForecastableCogsLineCard({
  line,
  cfg,
  projectionYears,
  setCogsForecastLineV1,
  revenueCfgRows,
  revenueTree,
  revenueRowsFingerprint,
}: {
  line: ForecastableCogsLine;
  cfg: CogsForecastLineConfigV1 | undefined;
  projectionYears: string[];
  setCogsForecastLineV1: (lineId: string, patch: Partial<CogsForecastLineConfigV1>) => void;
  revenueCfgRows: RevenueForecastConfigV1["rows"];
  revenueTree: ForecastRevenueNodeV1[];
  revenueRowsFingerprint: string;
}) {
  const allowCostPerUnit = useMemo(
    () => revenueRowUsesPriceVolumeForCogsEligibility(line.linkedRevenueRowId, revenueCfgRows, revenueTree),
    [line.linkedRevenueRowId, revenueCfgRows, revenueTree, revenueRowsFingerprint]
  );
  const allowCostPerCustomer = useMemo(
    () => revenueRowUsesCustomersArpuForCogsEligibility(line.linkedRevenueRowId, revenueCfgRows, revenueTree),
    [line.linkedRevenueRowId, revenueCfgRows, revenueTree, revenueRowsFingerprint]
  );
  const showCpuOption = allowCostPerUnit || cfg?.forecastMethod === "cost_per_unit";
  const showCpcOption = allowCostPerCustomer || cfg?.forecastMethod === "cost_per_customer";

  const currencyCode = useModelStore((s) => s.meta?.currency ?? "USD");
  const pvStartingDrivers = useMemo(
    () => resolvePriceVolumeStartingDriversForCogsLinkedRow(line.linkedRevenueRowId, revenueCfgRows, revenueTree),
    [line.linkedRevenueRowId, revenueCfgRows, revenueTree, revenueRowsFingerprint]
  );
  const impliedStartingRevenue = useMemo(
    () =>
      pvStartingDrivers
        ? pvStartingDrivers.startingVolume * pvStartingDrivers.startingPricePerUnit
        : null,
    [pvStartingDrivers]
  );
  const caStartingDrivers = useMemo(
    () => resolveCustomersArpuStartingDriversForCogsLinkedRow(line.linkedRevenueRowId, revenueCfgRows, revenueTree),
    [line.linkedRevenueRowId, revenueCfgRows, revenueTree, revenueRowsFingerprint]
  );

  const [method, setMethod] = useState<"" | "pct_of_revenue" | "cost_per_unit" | "cost_per_customer">(() => {
    if (cfg?.forecastMethod === "pct_of_revenue") return "pct_of_revenue";
    if (cfg?.forecastMethod === "cost_per_unit") return "cost_per_unit";
    if (cfg?.forecastMethod === "cost_per_customer") return "cost_per_customer";
    return "";
  });
  const [shape, setShape] = useState<HistGrowthShapeV1>("constant");
  const [pctStr, setPctStr] = useState("");
  const [yearStrs, setYearStrs] = useState<Record<string, string>>({});
  const [phaseRows, setPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [cpuShape, setCpuShape] = useState<HistGrowthShapeV1>("constant");
  const [startingCostStr, setStartingCostStr] = useState("");
  const [growthRateStr, setGrowthRateStr] = useState("");
  const [cpuYearStrs, setCpuYearStrs] = useState<Record<string, string>>({});
  const [cpuPhaseRows, setCpuPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [cpcShape, setCpcShape] = useState<HistGrowthShapeV1>("constant");
  const [startingCpcStr, setStartingCpcStr] = useState("");
  const [cpcGrowthRateStr, setCpcGrowthRateStr] = useState("");
  const [cpcYearStrs, setCpcYearStrs] = useState<Record<string, string>>({});
  const [cpcPhaseRows, setCpcPhaseRows] = useState<PhaseDraftV1[]>(() =>
    defaultFullRangePhase(projectionYears, "")
  );
  const [cardExpanded, setCardExpanded] = useState(true);

  const impliedMarginAtStart = useMemo(() => {
    if (!pvStartingDrivers) return null;
    const c = parseNumericInput(startingCostStr);
    if (c == null || !Number.isFinite(c) || c < 0) return null;
    const price = pvStartingDrivers.startingPricePerUnit;
    if (!Number.isFinite(price) || price <= 0) return null;
    const m = ((price - c) / price) * 100;
    return Number.isFinite(m) ? { startCost: c, marginPct: m } : null;
  }, [pvStartingDrivers, startingCostStr]);

  const impliedGrossMarginCpcAtStart = useMemo(() => {
    if (!caStartingDrivers) return null;
    const c = parseNumericInput(startingCpcStr);
    if (c == null || !Number.isFinite(c) || c < 0) return null;
    const arpuEff =
      caStartingDrivers.arpuBasis === "monthly"
        ? caStartingDrivers.startingArpu * 12
        : caStartingDrivers.startingArpu;
    if (!Number.isFinite(arpuEff) || arpuEff <= 0) return null;
    const m = ((arpuEff - c) / arpuEff) * 100;
    return Number.isFinite(m) ? { startCost: c, marginPct: m } : null;
  }, [caStartingDrivers, startingCpcStr]);

  const savedUnifiedKey =
    cfg?.forecastMethod === "pct_of_revenue"
      ? `p:${buildSavedUiSnapshot(cfg, projectionYears)}`
      : cfg?.forecastMethod === "cost_per_unit"
        ? `c:${buildSavedCpuSnapshot(cfg, projectionYears)}`
        : cfg?.forecastMethod === "cost_per_customer"
          ? `k:${buildSavedCpcSnapshot(cfg, projectionYears)}`
          : "n:";
  const projectionYearsKey = projectionYears.join("|");

  const resetPctDefaults = () => {
    setShape("constant");
    setPctStr("");
    setYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
    setPhaseRows(defaultFullRangePhase(projectionYears, ""));
  };
  const resetCpuDefaults = () => {
    setCpuShape("constant");
    setStartingCostStr("");
    setGrowthRateStr("");
    setCpuYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
    setCpuPhaseRows(defaultFullRangePhase(projectionYears, ""));
  };
  const resetCpcDefaults = () => {
    setCpcShape("constant");
    setStartingCpcStr("");
    setCpcGrowthRateStr("");
    setCpcYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
    setCpcPhaseRows(defaultFullRangePhase(projectionYears, ""));
  };

  useEffect(() => {
    const fm = cfg?.forecastMethod;
    const nextP = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
    if (fm === "cost_per_customer") {
      setMethod("cost_per_customer");
      resetPctDefaults();
      resetCpuDefaults();
      const pType = (nextP.growthPatternType as string | undefined) ?? "constant";
      const startFmt =
        nextP.startingCostPerCustomer != null && Number.isFinite(Number(nextP.startingCostPerCustomer))
          ? fmtNumericDisplay(Number(nextP.startingCostPerCustomer))
          : "";
      if (pType === "phases") {
        const raw = Array.isArray(nextP.costPerCustomerGrowthPhases)
          ? (nextP.costPerCustomerGrowthPhases as GrowthPhaseV1[])
          : [];
        setCpcShape("phases");
        setStartingCpcStr(startFmt);
        setCpcGrowthRateStr("");
        setCpcYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
        setCpcPhaseRows(
          raw.length
            ? raw.map((ph, i) => ({
                id: `cpc-ph-${line.lineId}-${i}`,
                startYear: String(ph.startYear),
                endYear: String(ph.endYear),
                rateStr:
                  ph.ratePercent != null && Number.isFinite(Number(ph.ratePercent))
                    ? fmtNumericDisplay(Number(ph.ratePercent))
                    : "",
              }))
            : defaultFullRangePhase(projectionYears, "")
        );
        return;
      }
      if (pType === "by_year") {
        const by = (nextP.costPerCustomerRatesByYear ?? {}) as Record<string, number>;
        setCpcShape("by_year");
        setStartingCpcStr(startFmt);
        setCpcGrowthRateStr("");
        setCpcYearStrs(
          Object.fromEntries(
            projectionYears.map((y) => [
              y,
              by[y] != null && Number.isFinite(Number(by[y])) ? fmtNumericDisplay(Number(by[y])) : "",
            ])
          )
        );
        setCpcPhaseRows(defaultFullRangePhase(projectionYears, ""));
        return;
      }
      setCpcShape("constant");
      setStartingCpcStr(startFmt);
      setCpcGrowthRateStr(
        nextP.costPerCustomerRatePercent != null && Number.isFinite(Number(nextP.costPerCustomerRatePercent))
          ? fmtNumericDisplay(Number(nextP.costPerCustomerRatePercent))
          : ""
      );
      setCpcYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
      setCpcPhaseRows(
        defaultFullRangePhase(
          projectionYears,
          nextP.costPerCustomerRatePercent != null && Number.isFinite(Number(nextP.costPerCustomerRatePercent))
            ? fmtNumericDisplay(Number(nextP.costPerCustomerRatePercent))
            : ""
        )
      );
      return;
    }
    if (fm === "cost_per_unit") {
      setMethod("cost_per_unit");
      resetPctDefaults();
      resetCpcDefaults();
      const pType = (nextP.growthPatternType as string | undefined) ?? "constant";
      const startFmt =
        nextP.startingCostPerUnit != null && Number.isFinite(Number(nextP.startingCostPerUnit))
          ? fmtNumericDisplay(Number(nextP.startingCostPerUnit))
          : "";
      if (pType === "phases") {
        const raw = Array.isArray(nextP.costPerUnitGrowthPhases)
          ? (nextP.costPerUnitGrowthPhases as GrowthPhaseV1[])
          : [];
        setCpuShape("phases");
        setStartingCostStr(startFmt);
        setGrowthRateStr("");
        setCpuYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
        setCpuPhaseRows(
          raw.length
            ? raw.map((ph, i) => ({
                id: `cpu-ph-${line.lineId}-${i}`,
                startYear: String(ph.startYear),
                endYear: String(ph.endYear),
                rateStr:
                  ph.ratePercent != null && Number.isFinite(Number(ph.ratePercent))
                    ? fmtNumericDisplay(Number(ph.ratePercent))
                    : "",
              }))
            : defaultFullRangePhase(projectionYears, "")
        );
        return;
      }
      if (pType === "by_year") {
        const by = (nextP.costPerUnitRatesByYear ?? {}) as Record<string, number>;
        setCpuShape("by_year");
        setStartingCostStr(startFmt);
        setGrowthRateStr("");
        setCpuYearStrs(
          Object.fromEntries(
            projectionYears.map((y) => [
              y,
              by[y] != null && Number.isFinite(Number(by[y])) ? fmtNumericDisplay(Number(by[y])) : "",
            ])
          )
        );
        setCpuPhaseRows(defaultFullRangePhase(projectionYears, ""));
        return;
      }
      setCpuShape("constant");
      setStartingCostStr(startFmt);
      setGrowthRateStr(
        nextP.costPerUnitRatePercent != null && Number.isFinite(Number(nextP.costPerUnitRatePercent))
          ? fmtNumericDisplay(Number(nextP.costPerUnitRatePercent))
          : ""
      );
      setCpuYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
      setCpuPhaseRows(
        defaultFullRangePhase(
          projectionYears,
          nextP.costPerUnitRatePercent != null && Number.isFinite(Number(nextP.costPerUnitRatePercent))
            ? fmtNumericDisplay(Number(nextP.costPerUnitRatePercent))
            : ""
        )
      );
      return;
    }
    if (fm === "pct_of_revenue") {
      setMethod("pct_of_revenue");
      resetCpuDefaults();
      resetCpcDefaults();
      const pType = (nextP.growthPatternType as string | undefined) ?? "constant";
      if (pType === "phases") {
        const raw = Array.isArray(nextP.growthPhases) ? (nextP.growthPhases as GrowthPhaseV1[]) : [];
        setShape("phases");
        setPhaseRows(
          raw.length
            ? raw.map((ph, i) => ({
                id: `ph-${line.lineId}-${i}`,
                startYear: String(ph.startYear),
                endYear: String(ph.endYear),
                rateStr:
                  ph.ratePercent != null && Number.isFinite(Number(ph.ratePercent))
                    ? fmtNumericDisplay(Number(ph.ratePercent))
                    : "",
              }))
            : defaultFullRangePhase(projectionYears, "")
        );
        setPctStr(nextP.pct != null && Number.isFinite(Number(nextP.pct)) ? fmtNumericDisplay(Number(nextP.pct)) : "");
        setYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
        return;
      }
      if (pType === "by_year") {
        const by = (nextP.pctsByYear ?? {}) as Record<string, number>;
        setShape("by_year");
        setPctStr(nextP.pct != null && Number.isFinite(Number(nextP.pct)) ? fmtNumericDisplay(Number(nextP.pct)) : "");
        setYearStrs(
          Object.fromEntries(
            projectionYears.map((y) => [
              y,
              by[y] != null && Number.isFinite(Number(by[y])) ? fmtNumericDisplay(Number(by[y])) : "",
            ])
          )
        );
        setPhaseRows(defaultFullRangePhase(projectionYears, ""));
        return;
      }
      setShape("constant");
      setPctStr(nextP.pct != null && Number.isFinite(Number(nextP.pct)) ? fmtNumericDisplay(Number(nextP.pct)) : "");
      setYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
      setPhaseRows(
        defaultFullRangePhase(
          projectionYears,
          nextP.pct != null && Number.isFinite(Number(nextP.pct)) ? fmtNumericDisplay(Number(nextP.pct)) : ""
        )
      );
      return;
    }
    setMethod("");
    resetPctDefaults();
    resetCpuDefaults();
    resetCpcDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cfg read when savedUnifiedKey changes; omit cfg ref to avoid draft reset on store object churn
  }, [savedUnifiedKey, line.lineId, projectionYearsKey]);

  const parsedPct = parseNumericInput(pctStr);
  const hasConstant = parsedPct != null;
  const byYearOk =
    projectionYears.length > 0 &&
    projectionYears.every((y) => parseNumericInput(yearStrs[y] ?? "") != null);
  const phaseValidation = useMemo(
    () => validateGrowthPhases(draftsToPhases(phaseRows), projectionYears),
    [phaseRows, projectionYears]
  );
  const phaseOk = projectionYears.length > 0 && phaseValidation.ok;
  const phaseErrorLines = useMemo(
    () => (shape === "phases" ? mapCogsPhaseValidationErrors(phaseValidation.errors) : []),
    [shape, phaseValidation.errors]
  );

  const parsedStartingCost = parseNumericInput(startingCostStr);
  const hasStartingCost = parsedStartingCost != null && parsedStartingCost > 0;
  const parsedGrowthRate = parseNumericInput(growthRateStr);
  const hasCpuConstantGrowth = parsedGrowthRate != null;
  const cpuByYearOk =
    projectionYears.length > 0 &&
    projectionYears.every((y) => parseNumericInput(cpuYearStrs[y] ?? "") != null);
  const cpuPhaseValidation = useMemo(
    () => validateGrowthPhases(draftsToPhases(cpuPhaseRows), projectionYears),
    [cpuPhaseRows, projectionYears]
  );
  const cpuPhaseOk = projectionYears.length > 0 && cpuPhaseValidation.ok;
  const cpuPhaseErrorLines = useMemo(
    () => (cpuShape === "phases" ? mapCogsCpuPhaseValidationErrors(cpuPhaseValidation.errors) : []),
    [cpuShape, cpuPhaseValidation.errors]
  );

  const parsedStartingCpc = parseNumericInput(startingCpcStr);
  const hasStartingCpc = parsedStartingCpc != null && parsedStartingCpc > 0;
  const parsedCpcGrowthRate = parseNumericInput(cpcGrowthRateStr);
  const hasCpcConstantGrowth = parsedCpcGrowthRate != null;
  const cpcByYearOk =
    projectionYears.length > 0 &&
    projectionYears.every((y) => parseNumericInput(cpcYearStrs[y] ?? "") != null);
  const cpcPhaseValidation = useMemo(
    () => validateGrowthPhases(draftsToPhases(cpcPhaseRows), projectionYears),
    [cpcPhaseRows, projectionYears]
  );
  const cpcPhaseOk = projectionYears.length > 0 && cpcPhaseValidation.ok;
  const cpcPhaseErrorLines = useMemo(
    () => (cpcShape === "phases" ? mapCogsCpcPhaseValidationErrors(cpcPhaseValidation.errors) : []),
    [cpcShape, cpcPhaseValidation.errors]
  );

  const buildCogsPctConfig = useMemo(() => {
    if (method !== "pct_of_revenue") {
      return { forecastMethod: undefined, forecastParameters: undefined, valid: true };
    }
    const params: Record<string, unknown> = {};
    if (shape === "constant") {
      params.growthPatternType = "constant";
      params.pct = hasConstant ? parsedPct : 0;
    } else if (shape === "by_year") {
      const pctsByYear: Record<string, number> = {};
      for (const y of projectionYears) pctsByYear[y] = parseNumericInput(yearStrs[y] ?? "") ?? 0;
      params.growthPatternType = "by_year";
      params.pctsByYear = pctsByYear;
      params.pct = projectionYears.length ? pctsByYear[projectionYears[0]] ?? 0 : 0;
    } else {
      const phases = draftsToPhases(phaseRows);
      const expanded = expandPhasesToRatesByYear(phases, projectionYears);
      params.growthPatternType = "phases";
      params.growthPhases = phases;
      params.pct =
        projectionYears.length > 0
          ? expanded[projectionYears[0]] ?? phases[0]?.ratePercent ?? 0
          : phases[0]?.ratePercent ?? 0;
    }
    return {
      forecastMethod: "pct_of_revenue" as const,
      forecastParameters: params,
      valid: shape === "constant" ? hasConstant : shape === "by_year" ? byYearOk : phaseOk,
    };
  }, [method, shape, pctStr, yearStrs, phaseRows, projectionYears.join("|"), hasConstant, parsedPct, byYearOk, phaseOk]);

  const buildCogsCpuConfig = useMemo(() => {
    if (method !== "cost_per_unit") {
      return { forecastMethod: undefined, forecastParameters: undefined, valid: true };
    }
    const params: Record<string, unknown> = {};
    const start = hasStartingCost ? parsedStartingCost! : 0;
    if (cpuShape === "constant") {
      params.growthPatternType = "constant";
      params.startingCostPerUnit = start;
      params.costPerUnitRatePercent = hasCpuConstantGrowth ? parsedGrowthRate! : 0;
    } else if (cpuShape === "by_year") {
      const costPerUnitRatesByYear: Record<string, number> = {};
      for (const y of projectionYears) costPerUnitRatesByYear[y] = parseNumericInput(cpuYearStrs[y] ?? "") ?? 0;
      params.growthPatternType = "by_year";
      params.startingCostPerUnit = start;
      params.costPerUnitRatesByYear = costPerUnitRatesByYear;
      params.costPerUnitRatePercent = projectionYears.length ? costPerUnitRatesByYear[projectionYears[0]] ?? 0 : 0;
    } else {
      const phases = draftsToPhases(cpuPhaseRows);
      const expanded = expandPhasesToRatesByYear(phases, projectionYears);
      params.growthPatternType = "phases";
      params.startingCostPerUnit = start;
      params.costPerUnitGrowthPhases = phases;
      params.costPerUnitRatePercent =
        projectionYears.length > 0
          ? expanded[projectionYears[0]] ?? phases[0]?.ratePercent ?? 0
          : phases[0]?.ratePercent ?? 0;
    }
    return {
      forecastMethod: "cost_per_unit" as const,
      forecastParameters: params,
      valid:
        hasStartingCost &&
        (cpuShape === "constant"
          ? hasCpuConstantGrowth
          : cpuShape === "by_year"
            ? cpuByYearOk
            : cpuPhaseOk),
    };
  }, [
    method,
    cpuShape,
    startingCostStr,
    growthRateStr,
    cpuYearStrs,
    cpuPhaseRows,
    projectionYears.join("|"),
    hasStartingCost,
    parsedStartingCost,
    hasCpuConstantGrowth,
    parsedGrowthRate,
    cpuByYearOk,
    cpuPhaseOk,
  ]);

  const buildCogsCpcConfig = useMemo(() => {
    if (method !== "cost_per_customer") {
      return { forecastMethod: undefined, forecastParameters: undefined, valid: true };
    }
    const params: Record<string, unknown> = {};
    const start = hasStartingCpc ? parsedStartingCpc! : 0;
    if (cpcShape === "constant") {
      params.growthPatternType = "constant";
      params.startingCostPerCustomer = start;
      params.costPerCustomerRatePercent = hasCpcConstantGrowth ? parsedCpcGrowthRate! : 0;
    } else if (cpcShape === "by_year") {
      const costPerCustomerRatesByYear: Record<string, number> = {};
      for (const y of projectionYears) costPerCustomerRatesByYear[y] = parseNumericInput(cpcYearStrs[y] ?? "") ?? 0;
      params.growthPatternType = "by_year";
      params.startingCostPerCustomer = start;
      params.costPerCustomerRatesByYear = costPerCustomerRatesByYear;
      params.costPerCustomerRatePercent = projectionYears.length
        ? costPerCustomerRatesByYear[projectionYears[0]] ?? 0
        : 0;
    } else {
      const phases = draftsToPhases(cpcPhaseRows);
      const expanded = expandPhasesToRatesByYear(phases, projectionYears);
      params.growthPatternType = "phases";
      params.startingCostPerCustomer = start;
      params.costPerCustomerGrowthPhases = phases;
      params.costPerCustomerRatePercent =
        projectionYears.length > 0
          ? expanded[projectionYears[0]] ?? phases[0]?.ratePercent ?? 0
          : phases[0]?.ratePercent ?? 0;
    }
    return {
      forecastMethod: "cost_per_customer" as const,
      forecastParameters: params,
      valid:
        hasStartingCpc &&
        (cpcShape === "constant"
          ? hasCpcConstantGrowth
          : cpcShape === "by_year"
            ? cpcByYearOk
            : cpcPhaseOk),
    };
  }, [
    method,
    cpcShape,
    startingCpcStr,
    cpcGrowthRateStr,
    cpcYearStrs,
    cpcPhaseRows,
    projectionYears.join("|"),
    hasStartingCpc,
    parsedStartingCpc,
    hasCpcConstantGrowth,
    parsedCpcGrowthRate,
    cpcByYearOk,
    cpcPhaseOk,
  ]);

  const draftUnifiedKey = useMemo(() => {
    if (method === "pct_of_revenue") {
      return `p:${buildDraftUiSnapshot(method, shape, pctStr, yearStrs, phaseRows, projectionYears)}`;
    }
    if (method === "cost_per_unit") {
      return `c:${buildDraftCpuSnapshot(method, cpuShape, startingCostStr, growthRateStr, cpuYearStrs, cpuPhaseRows, projectionYears)}`;
    }
    if (method === "cost_per_customer") {
      return `k:${buildDraftCpcSnapshot(method, cpcShape, startingCpcStr, cpcGrowthRateStr, cpcYearStrs, cpcPhaseRows, projectionYears)}`;
    }
    return "n:";
  }, [
    method,
    shape,
    pctStr,
    yearStrs,
    phaseRows,
    cpuShape,
    startingCostStr,
    growthRateStr,
    cpuYearStrs,
    cpuPhaseRows,
    cpcShape,
    startingCpcStr,
    cpcGrowthRateStr,
    cpcYearStrs,
    cpcPhaseRows,
    projectionYears,
  ]);

  const hasSavedConfig =
    hasPersistedCogsPctConfig(cfg, projectionYears) ||
    hasPersistedCogsCpuConfig(cfg, projectionYears) ||
    hasPersistedCogsCpcConfig(cfg, projectionYears);
  const hasUnsavedChanges = draftUnifiedKey !== savedUnifiedKey;

  const canApply =
    method === "pct_of_revenue"
      ? buildCogsPctConfig.valid
      : method === "cost_per_unit"
        ? buildCogsCpuConfig.valid
        : method === "cost_per_customer"
          ? buildCogsCpcConfig.valid
          : false;
  const applyDisabled = !canApply || !hasUnsavedChanges;
  const resetDisabled = !hasUnsavedChanges;

  const collapsedSummaryLine = useMemo(() => {
    const revDriver = fmtMethodLabel(line.linkedRevenueMethod);
    if (method === "pct_of_revenue") {
      return `% of Revenue · ${cogsPatternLabel(shape)} · Revenue: ${line.lineLabel} (${revDriver})`;
    }
    if (method === "cost_per_unit") {
      return `Cost per Unit · ${cogsPatternLabel(cpuShape)} · Revenue: ${line.lineLabel} (${revDriver})`;
    }
    if (method === "cost_per_customer") {
      return `Cost per Customer · ${cogsPatternLabel(cpcShape)} · Revenue: ${line.lineLabel} (${revDriver})`;
    }
    return `No forecast method selected · Revenue: ${line.lineLabel} (${revDriver})`;
  }, [method, shape, cpuShape, cpcShape, line.lineLabel, line.linkedRevenueMethod]);

  const toggleCardExpanded = () => setCardExpanded((v) => !v);

  const apply = () => {
    if (method === "pct_of_revenue") {
      if (!buildCogsPctConfig.valid) return;
      setCogsForecastLineV1(line.lineId, {
        lineId: line.lineId,
        linkedRevenueRowId: line.linkedRevenueRowId,
        lineLabel: line.lineLabel,
        linkedRevenueMethod: line.linkedRevenueMethod,
        forecastMethod: buildCogsPctConfig.forecastMethod,
        forecastParameters: buildCogsPctConfig.forecastParameters as Record<string, unknown> | undefined,
      });
      return;
    }
    if (method === "cost_per_unit") {
      if (!buildCogsCpuConfig.valid) return;
      setCogsForecastLineV1(line.lineId, {
        lineId: line.lineId,
        linkedRevenueRowId: line.linkedRevenueRowId,
        lineLabel: line.lineLabel,
        linkedRevenueMethod: line.linkedRevenueMethod,
        forecastMethod: buildCogsCpuConfig.forecastMethod,
        forecastParameters: buildCogsCpuConfig.forecastParameters as Record<string, unknown> | undefined,
      });
      return;
    }
    if (method === "cost_per_customer") {
      if (!buildCogsCpcConfig.valid) return;
      setCogsForecastLineV1(line.lineId, {
        lineId: line.lineId,
        linkedRevenueRowId: line.linkedRevenueRowId,
        lineLabel: line.lineLabel,
        linkedRevenueMethod: line.linkedRevenueMethod,
        forecastMethod: buildCogsCpcConfig.forecastMethod,
        forecastParameters: buildCogsCpcConfig.forecastParameters as Record<string, unknown> | undefined,
      });
      return;
    }
  };

  const reset = () => {
    const fm = cfg?.forecastMethod;
    const next = cfg?.forecastParameters as Record<string, unknown> | undefined;
    if (fm === "cost_per_customer" && next) {
      setMethod("cost_per_customer");
      resetPctDefaults();
      resetCpuDefaults();
      const pType = (next.growthPatternType as string | undefined) ?? "constant";
      const startFmt =
        next.startingCostPerCustomer != null && Number.isFinite(Number(next.startingCostPerCustomer))
          ? fmtNumericDisplay(Number(next.startingCostPerCustomer))
          : "";
      if (pType === "phases") {
        const raw = Array.isArray(next.costPerCustomerGrowthPhases)
          ? (next.costPerCustomerGrowthPhases as GrowthPhaseV1[])
          : [];
        setCpcShape("phases");
        setStartingCpcStr(startFmt);
        setCpcGrowthRateStr("");
        setCpcYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
        setCpcPhaseRows(
          raw.length
            ? raw.map((ph, i) => ({
                id: `cpc-ph-${line.lineId}-${i}-r`,
                startYear: String(ph.startYear),
                endYear: String(ph.endYear),
                rateStr:
                  ph.ratePercent != null && Number.isFinite(Number(ph.ratePercent))
                    ? fmtNumericDisplay(Number(ph.ratePercent))
                    : "",
              }))
            : defaultFullRangePhase(projectionYears, "")
        );
        return;
      }
      if (pType === "by_year") {
        const by = (next.costPerCustomerRatesByYear ?? {}) as Record<string, number>;
        setCpcShape("by_year");
        setStartingCpcStr(startFmt);
        setCpcGrowthRateStr("");
        setCpcYearStrs(
          Object.fromEntries(
            projectionYears.map((y) => [
              y,
              by[y] != null && Number.isFinite(Number(by[y])) ? fmtNumericDisplay(Number(by[y])) : "",
            ])
          )
        );
        setCpcPhaseRows(defaultFullRangePhase(projectionYears, ""));
        return;
      }
      setCpcShape("constant");
      setStartingCpcStr(startFmt);
      setCpcGrowthRateStr(
        next.costPerCustomerRatePercent != null && Number.isFinite(Number(next.costPerCustomerRatePercent))
          ? fmtNumericDisplay(Number(next.costPerCustomerRatePercent))
          : ""
      );
      setCpcYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
      setCpcPhaseRows(
        defaultFullRangePhase(
          projectionYears,
          next.costPerCustomerRatePercent != null && Number.isFinite(Number(next.costPerCustomerRatePercent))
            ? fmtNumericDisplay(Number(next.costPerCustomerRatePercent))
            : ""
        )
      );
      return;
    }
    if (fm === "cost_per_unit" && next) {
      setMethod("cost_per_unit");
      resetPctDefaults();
      resetCpcDefaults();
      const pType = (next.growthPatternType as string | undefined) ?? "constant";
      const startFmt =
        next.startingCostPerUnit != null && Number.isFinite(Number(next.startingCostPerUnit))
          ? fmtNumericDisplay(Number(next.startingCostPerUnit))
          : "";
      if (pType === "phases") {
        const raw = Array.isArray(next.costPerUnitGrowthPhases)
          ? (next.costPerUnitGrowthPhases as GrowthPhaseV1[])
          : [];
        setCpuShape("phases");
        setStartingCostStr(startFmt);
        setGrowthRateStr("");
        setCpuYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
        setCpuPhaseRows(
          raw.length
            ? raw.map((ph, i) => ({
                id: `cpu-ph-${line.lineId}-${i}-r`,
                startYear: String(ph.startYear),
                endYear: String(ph.endYear),
                rateStr:
                  ph.ratePercent != null && Number.isFinite(Number(ph.ratePercent))
                    ? fmtNumericDisplay(Number(ph.ratePercent))
                    : "",
              }))
            : defaultFullRangePhase(projectionYears, "")
        );
        return;
      }
      if (pType === "by_year") {
        const by = (next.costPerUnitRatesByYear ?? {}) as Record<string, number>;
        setCpuShape("by_year");
        setStartingCostStr(startFmt);
        setGrowthRateStr("");
        setCpuYearStrs(
          Object.fromEntries(
            projectionYears.map((y) => [
              y,
              by[y] != null && Number.isFinite(Number(by[y])) ? fmtNumericDisplay(Number(by[y])) : "",
            ])
          )
        );
        setCpuPhaseRows(defaultFullRangePhase(projectionYears, ""));
        return;
      }
      setCpuShape("constant");
      setStartingCostStr(startFmt);
      setGrowthRateStr(
        next.costPerUnitRatePercent != null && Number.isFinite(Number(next.costPerUnitRatePercent))
          ? fmtNumericDisplay(Number(next.costPerUnitRatePercent))
          : ""
      );
      setCpuYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
      setCpuPhaseRows(
        defaultFullRangePhase(
          projectionYears,
          next.costPerUnitRatePercent != null && Number.isFinite(Number(next.costPerUnitRatePercent))
            ? fmtNumericDisplay(Number(next.costPerUnitRatePercent))
            : ""
        )
      );
      return;
    }
    if (fm === "pct_of_revenue" && next) {
      setMethod("pct_of_revenue");
      resetCpuDefaults();
      resetCpcDefaults();
      const pType = (next.growthPatternType as string | undefined) ?? "constant";
      if (pType === "by_year") {
        const by = (next.pctsByYear ?? {}) as Record<string, number>;
        setShape("by_year");
        setPctStr(next.pct != null && Number.isFinite(Number(next.pct)) ? fmtNumericDisplay(Number(next.pct)) : "");
        setYearStrs(
          Object.fromEntries(
            projectionYears.map((y) => [
              y,
              by[y] != null && Number.isFinite(Number(by[y])) ? fmtNumericDisplay(Number(by[y])) : "",
            ])
          )
        );
        setPhaseRows(defaultFullRangePhase(projectionYears, ""));
        return;
      }
      if (pType === "phases") {
        const raw = Array.isArray(next.growthPhases) ? (next.growthPhases as GrowthPhaseV1[]) : [];
        setShape("phases");
        setPhaseRows(
          raw.length
            ? raw.map((ph, i) => ({
                id: `ph-${line.lineId}-${i}-r`,
                startYear: String(ph.startYear),
                endYear: String(ph.endYear),
                rateStr:
                  ph.ratePercent != null && Number.isFinite(Number(ph.ratePercent))
                    ? fmtNumericDisplay(Number(ph.ratePercent))
                    : "",
              }))
            : defaultFullRangePhase(projectionYears, "")
        );
        setPctStr(next.pct != null && Number.isFinite(Number(next.pct)) ? fmtNumericDisplay(Number(next.pct)) : "");
        setYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
        return;
      }
      setShape("constant");
      setPctStr(next.pct != null && Number.isFinite(Number(next.pct)) ? fmtNumericDisplay(Number(next.pct)) : "");
      setYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
      setPhaseRows(
        defaultFullRangePhase(
          projectionYears,
          next.pct != null && Number.isFinite(Number(next.pct)) ? fmtNumericDisplay(Number(next.pct)) : ""
        )
      );
      return;
    }
    setMethod("");
    resetPctDefaults();
    resetCpuDefaults();
    resetCpcDefaults();
  };

  return (
    <div className="rounded-lg border border-blue-500/50 bg-slate-900/70 shadow-sm shadow-black/35 ring-1 ring-blue-500/25 overflow-hidden mb-1">
      <div className={`px-3 py-2.5 bg-slate-900/80 border-slate-700/90 ${cardExpanded ? "border-b" : ""}`}>
        <div className="flex flex-wrap items-center gap-2 gap-y-1">
          <button
            type="button"
            onClick={toggleCardExpanded}
            className="text-slate-400 hover:text-slate-200 w-6 text-xs shrink-0 text-left"
            aria-expanded={cardExpanded}
            aria-label={cardExpanded ? "Collapse COGS line" : "Expand COGS line"}
          >
            {cardExpanded ? "▼" : "▶"}
          </button>
          <span className="text-sm font-semibold text-slate-100 tracking-tight">{line.lineLabel}</span>
          <span className="rounded border border-sky-900/55 bg-sky-950/50 px-1.5 py-0.5 text-[10px] font-medium text-sky-200/90">
            COGS
          </span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded font-medium ${
              hasUnsavedChanges
                ? "bg-amber-900/45 text-amber-100 border border-amber-800/40"
                : hasSavedConfig
                  ? "bg-slate-800/90 text-slate-400 border border-slate-700/80"
                  : "bg-slate-800/70 text-slate-500 border border-slate-700/60"
            }`}
          >
            {hasUnsavedChanges ? "Unsaved" : hasSavedConfig ? "Saved" : "Not started"}
          </span>
        </div>
        {!cardExpanded ? (
          <p className="text-[10px] text-slate-400 mt-1.5 pl-8 leading-snug">{collapsedSummaryLine}</p>
        ) : null}
      </div>

      {cardExpanded ? (
        <div className="px-3 py-3 space-y-2 bg-slate-900/60">
          <div className="text-[11px] text-slate-500">
            Linked to revenue: <span className="text-slate-300">{line.lineLabel}</span>
            <span className="text-slate-600"> · </span>
            <span className="text-slate-400">{fmtMethodLabel(line.linkedRevenueMethod)}</span>
          </div>
          <p className="text-[11px] text-slate-400">{line.suggestionReason}</p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-[11px] text-slate-400 flex flex-col gap-1 min-w-[12rem]">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Method</span>
          <select
            value={method}
            className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
            onChange={(e) =>
              setMethod(e.target.value as "" | "pct_of_revenue" | "cost_per_unit" | "cost_per_customer")
            }
          >
            <option value="">Select method</option>
            <option value="pct_of_revenue">% of Revenue</option>
            {showCpuOption ? <option value="cost_per_unit">Cost per Unit</option> : null}
            {showCpcOption ? <option value="cost_per_customer">Cost per Customer</option> : null}
          </select>
        </label>
      </div>
      {!allowCostPerUnit && cfg?.forecastMethod === "cost_per_unit" ? (
        <p className="text-[11px] text-amber-300/90">
          This line is saved as Cost per Unit, but the linked revenue row is no longer Price × Volume. Preview may not
          resolve volume until the revenue driver matches.
        </p>
      ) : null}
      {!allowCostPerCustomer && cfg?.forecastMethod === "cost_per_customer" ? (
        <p className="text-[11px] text-amber-300/90">
          This line is saved as Cost per Customer, but the linked revenue row is no longer Customers × ARPU. Customer-driver
          preview context may not resolve correctly until the revenue driver matches.
        </p>
      ) : null}
      {method !== "pct_of_revenue" && method !== "cost_per_unit" && method !== "cost_per_customer" ? (
        <div className="rounded border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
          Select a method to forecast this COGS line
        </div>
      ) : null}
      {method === "pct_of_revenue" ? (
        <>
          <div className="rounded border border-slate-700 bg-slate-950/40 px-3 py-2 space-y-1">
            <div className="text-xs font-semibold text-slate-200">% of Revenue</div>
            <div className="text-[11px] text-slate-400">COGS is forecast as a percentage of the linked revenue line.</div>
            <div className="text-[11px] text-slate-500">COGS(t) = Revenue(t) × %</div>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="text-[11px] text-slate-400 flex flex-col gap-1 min-w-[10rem]">
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">% Pattern</span>
              <select
                value={shape}
                onChange={(e) => setShape(e.target.value as HistGrowthShapeV1)}
                className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant</option>
                <option value="by_year">By year</option>
                <option value="phases">Phases</option>
              </select>
            </label>
            {shape === "constant" ? (
              <label className="text-[11px] text-slate-400 flex flex-col gap-1 min-w-[8rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">COGS %</span>
                <span className="flex items-center gap-1">
                  <RevenueForecastDecimalInput value={pctStr} onChange={setPctStr} className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-24 text-right" />
                  <span className="text-slate-500">%</span>
                </span>
              </label>
            ) : null}
          </div>
          {shape === "by_year" ? (
            <div className="flex flex-wrap gap-2">
              {projectionYears.map((y) => (
                <label key={y} className="text-[10px] text-slate-500 flex flex-col gap-0.5">
                  <span>{y} %</span>
                  <span className="flex items-center gap-1">
                    <RevenueForecastDecimalInput
                      value={yearStrs[y] ?? ""}
                      onChange={(n) => setYearStrs((p2) => ({ ...p2, [y]: n }))}
                      className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-24 text-right"
                    />
                    <span>%</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {shape === "phases" ? (
            <div className="space-y-2">
              <GrowthPhaseEditor
                phaseRows={phaseRows}
                setPhaseRows={setPhaseRows}
                projectionYears={projectionYears}
                inp={COGS_PHASE_INP}
                rateColumnLabel="COGS %"
                afterAddHint="New phase added — review years and COGS % if needed."
                fillRemainingTitle="Fills any missing forecast years using the last COGS %."
              />
              {phaseErrorLines.length > 0 ? (
                <ul className="text-[11px] text-amber-300/95 space-y-0.5 list-disc pl-4">
                  {phaseErrorLines.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      {method === "cost_per_unit" ? (
        <>
          <div className="rounded border border-slate-700 bg-slate-950/40 px-3 py-2 space-y-1">
            <div className="text-xs font-semibold text-slate-200">Cost per Unit</div>
            <div className="text-[11px] text-slate-500">COGS(t) = Volume(t) × Cost per Unit(t)</div>
          </div>

          {pvStartingDrivers && impliedStartingRevenue != null ? (
            <div className="rounded border border-slate-700 bg-slate-950/50 px-3 py-2.5 space-y-2">
              <div className="text-xs font-semibold text-slate-200">Revenue Driver Context</div>
              <p className="text-[10px] text-slate-500 leading-snug">
                Read-only · from the linked Price × Volume revenue driver (same inputs as Revenue; not editable here).
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
                <div>
                  <dt className="text-[10px] text-slate-500 uppercase tracking-wide">Starting volume</dt>
                  <dd className="text-slate-100 tabular-nums mt-0.5">
                    {formatDriverVolumeCount(pvStartingDrivers.startingVolume)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-slate-500 uppercase tracking-wide">Starting price / unit</dt>
                  <dd className="text-slate-100 tabular-nums mt-0.5">
                    {formatDriverAbsoluteCurrency(pvStartingDrivers.startingPricePerUnit, currencyCode)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-slate-500 uppercase tracking-wide">Implied starting revenue</dt>
                  <dd className="text-slate-100 tabular-nums mt-0.5">
                    {formatDriverAbsoluteCurrency(impliedStartingRevenue, currencyCode)}
                  </dd>
                </div>
              </dl>
              <div className="border-t border-slate-800/90 pt-2 space-y-1 text-[10px] text-slate-500 leading-snug">
                <p>
                  <span className="text-slate-400">Units are inherited from Revenue.</span> Forecast only the cost per
                  unit here.
                </p>
                <p>Price per unit is shown as context only. It remains controlled by the Revenue section.</p>
              </div>
            </div>
          ) : (
            <div className="rounded border border-slate-800 bg-slate-950/30 px-3 py-2 text-[11px] text-slate-500">
              Linked Revenue driver context unavailable.
            </div>
          )}

          {impliedMarginAtStart ? (
            <div className="rounded border border-slate-700/90 bg-slate-950/35 px-3 py-2.5 space-y-2">
              <div className="text-xs font-semibold text-slate-200">Implied Margin Context</div>
              <p className="text-[10px] text-slate-500">Read-only sanity check at the starting point — not saved.</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                <div>
                  <dt className="text-[10px] text-slate-500 uppercase tracking-wide">Starting cost / unit</dt>
                  <dd className="text-slate-100 tabular-nums mt-0.5">
                    {formatDriverAbsoluteCurrency(impliedMarginAtStart.startCost, currencyCode)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-slate-500 uppercase tracking-wide">Implied Gross Margin at Start</dt>
                  <dd className="text-slate-100 tabular-nums mt-0.5">
                    {formatDriverPercentOneDecimal(impliedMarginAtStart.marginPct)}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3 items-end">
            <label className="text-[11px] text-slate-400 flex flex-col gap-1 min-w-[11rem]">
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">Starting cost / unit</span>
              <RevenueForecastDecimalInput
                value={startingCostStr}
                onChange={setStartingCostStr}
                className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-28 text-right"
              />
            </label>
            <label className="text-[11px] text-slate-400 flex flex-col gap-1 min-w-[10rem]">
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">Cost / unit growth</span>
              <select
                value={cpuShape}
                onChange={(e) => setCpuShape(e.target.value as HistGrowthShapeV1)}
                className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant</option>
                <option value="by_year">By year</option>
                <option value="phases">Phases</option>
              </select>
            </label>
            {cpuShape === "constant" ? (
              <label className="text-[11px] text-slate-400 flex flex-col gap-1 min-w-[8rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">YoY %</span>
                <span className="flex items-center gap-1">
                  <RevenueForecastDecimalInput
                    value={growthRateStr}
                    onChange={setGrowthRateStr}
                    className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-24 text-right"
                  />
                  <span className="text-slate-500">%</span>
                </span>
              </label>
            ) : null}
          </div>
          {cpuShape === "by_year" ? (
            <div className="flex flex-wrap gap-2">
              {projectionYears.map((y) => (
                <label key={`cpu-${y}`} className="text-[10px] text-slate-500 flex flex-col gap-0.5">
                  <span>
                    {y} growth %
                  </span>
                  <span className="flex items-center gap-1">
                    <RevenueForecastDecimalInput
                      value={cpuYearStrs[y] ?? ""}
                      onChange={(n) => setCpuYearStrs((p2) => ({ ...p2, [y]: n }))}
                      className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-24 text-right"
                    />
                    <span>%</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {cpuShape === "phases" ? (
            <div className="space-y-2">
              <GrowthPhaseEditor
                phaseRows={cpuPhaseRows}
                setPhaseRows={setCpuPhaseRows}
                projectionYears={projectionYears}
                inp={COGS_PHASE_INP}
                rateColumnLabel="YoY %"
                afterAddHint="New phase added — review years and growth % if needed."
                fillRemainingTitle="Fills any missing forecast years using the last YoY %."
              />
              {cpuPhaseErrorLines.length > 0 ? (
                <ul className="text-[11px] text-amber-300/95 space-y-0.5 list-disc pl-4">
                  {cpuPhaseErrorLines.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      {method === "cost_per_customer" ? (
        <>
          <div className="rounded border border-slate-700 bg-slate-950/40 px-3 py-2 space-y-1">
            <div className="text-xs font-semibold text-slate-200">Cost per Customer</div>
            <div className="text-[11px] text-slate-400">
              Forecasts COGS as linked revenue customers × projected cost per customer.
            </div>
            <div className="text-[11px] text-slate-500">COGS(t) = Customers(t) × Cost per Customer(t)</div>
          </div>

          {caStartingDrivers ? (
            <div className="rounded border border-slate-700 bg-slate-950/50 px-3 py-2.5 space-y-2">
              <div className="text-xs font-semibold text-slate-200">Revenue Driver Context</div>
              <p className="text-[10px] text-slate-500 leading-snug">
                Read-only · from the linked Customers × ARPU revenue driver (not duplicated into COGS config).
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                <div>
                  <dt className="text-[10px] text-slate-500 uppercase tracking-wide">Starting customers</dt>
                  <dd className="text-slate-100 tabular-nums mt-0.5">
                    {formatDriverVolumeCount(caStartingDrivers.startingCustomers)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-slate-500 uppercase tracking-wide">Starting ARPU</dt>
                  <dd className="text-slate-100 tabular-nums mt-0.5">
                    {formatDriverAbsoluteCurrency(caStartingDrivers.startingArpu, currencyCode)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-slate-500 uppercase tracking-wide">ARPU basis</dt>
                  <dd className="text-slate-100 mt-0.5">
                    {caStartingDrivers.arpuBasis === "monthly" ? "Monthly" : "Annual"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-slate-500 uppercase tracking-wide">Implied starting revenue</dt>
                  <dd className="text-slate-100 tabular-nums mt-0.5">
                    {formatDriverAbsoluteCurrency(caStartingDrivers.impliedStartingRevenue, currencyCode)}
                  </dd>
                </div>
              </dl>
              <div className="border-t border-slate-800/90 pt-2 space-y-1 text-[10px] text-slate-500 leading-snug">
                <p>
                  <span className="text-slate-400">Customers are inherited from Revenue.</span> Forecast only the cost per
                  customer here.
                </p>
                <p>ARPU is shown as context only and remains controlled by Revenue.</p>
              </div>
            </div>
          ) : (
            <div className="rounded border border-slate-800 bg-slate-950/30 px-3 py-2 text-[11px] text-slate-500">
              Linked Revenue driver context unavailable.
            </div>
          )}

          {impliedGrossMarginCpcAtStart ? (
            <div className="rounded border border-slate-700/90 bg-slate-950/35 px-3 py-2.5 space-y-2">
              <div className="text-xs font-semibold text-slate-200">Implied Gross Margin at Start</div>
              <p className="text-[10px] text-slate-500">
                Read-only sanity check — uses annualized ARPU vs. cost per customer; not saved.
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                <div>
                  <dt className="text-[10px] text-slate-500 uppercase tracking-wide">Starting cost / customer</dt>
                  <dd className="text-slate-100 tabular-nums mt-0.5">
                    {formatDriverAbsoluteCurrency(impliedGrossMarginCpcAtStart.startCost, currencyCode)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-slate-500 uppercase tracking-wide">Implied Gross Margin at Start</dt>
                  <dd className="text-slate-100 tabular-nums mt-0.5">
                    {formatDriverPercentOneDecimal(impliedGrossMarginCpcAtStart.marginPct)}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3 items-end">
            <label className="text-[11px] text-slate-400 flex flex-col gap-1 min-w-[11rem]">
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">Starting cost / customer</span>
              <RevenueForecastDecimalInput
                value={startingCpcStr}
                onChange={setStartingCpcStr}
                className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-28 text-right"
              />
            </label>
            <label className="text-[11px] text-slate-400 flex flex-col gap-1 min-w-[10rem]">
              <span className="text-[10px] text-slate-500 uppercase tracking-wide">Cost / customer growth</span>
              <select
                value={cpcShape}
                onChange={(e) => setCpcShape(e.target.value as HistGrowthShapeV1)}
                className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-2"
              >
                <option value="constant">Constant</option>
                <option value="by_year">By year</option>
                <option value="phases">Phases</option>
              </select>
            </label>
            {cpcShape === "constant" ? (
              <label className="text-[11px] text-slate-400 flex flex-col gap-1 min-w-[8rem]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">YoY %</span>
                <span className="flex items-center gap-1">
                  <RevenueForecastDecimalInput
                    value={cpcGrowthRateStr}
                    onChange={setCpcGrowthRateStr}
                    className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-24 text-right"
                  />
                  <span className="text-slate-500">%</span>
                </span>
              </label>
            ) : null}
          </div>
          {cpcShape === "by_year" ? (
            <div className="flex flex-wrap gap-2">
              {projectionYears.map((y) => (
                <label key={`cpc-${y}`} className="text-[10px] text-slate-500 flex flex-col gap-0.5">
                  <span>{y} growth %</span>
                  <span className="flex items-center gap-1">
                    <RevenueForecastDecimalInput
                      value={cpcYearStrs[y] ?? ""}
                      onChange={(n) => setCpcYearStrs((p2) => ({ ...p2, [y]: n }))}
                      className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 w-24 text-right"
                    />
                    <span>%</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {cpcShape === "phases" ? (
            <div className="space-y-2">
              <GrowthPhaseEditor
                phaseRows={cpcPhaseRows}
                setPhaseRows={setCpcPhaseRows}
                projectionYears={projectionYears}
                inp={COGS_PHASE_INP}
                rateColumnLabel="YoY %"
                afterAddHint="New phase added — review years and growth % if needed."
                fillRemainingTitle="Fills any missing forecast years using the last YoY %."
              />
              {cpcPhaseErrorLines.length > 0 ? (
                <ul className="text-[11px] text-amber-300/95 space-y-0.5 list-disc pl-4">
                  {cpcPhaseErrorLines.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
          <div className="flex gap-2 pt-1 border-t border-slate-700/50">
            <button
              type="button"
              disabled={applyDisabled}
              onClick={apply}
              aria-disabled={applyDisabled}
              className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${
                applyDisabled
                  ? "cursor-not-allowed border-slate-700 bg-slate-800/90 text-slate-500"
                  : "cursor-pointer border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500 hover:border-emerald-500"
              }`}
            >
              Apply
            </button>
            <button
              type="button"
              disabled={resetDisabled}
              onClick={reset}
              aria-disabled={resetDisabled}
              className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${
                resetDisabled
                  ? "cursor-not-allowed border-slate-800 bg-slate-900/60 text-slate-600"
                  : "cursor-pointer border-slate-500 bg-slate-700 text-slate-100 hover:bg-slate-600 hover:border-slate-400"
              }`}
            >
              Reset
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function CogsOpexForecastV1Tab() {
  const incomeStatement = useModelStore((s) => s.incomeStatement ?? []);
  const revenueTree = useModelStore((s) => s.revenueForecastTreeV1 ?? []);
  const revenueCfgRows = useModelStore((s) => s.revenueForecastConfigV1?.rows ?? {});
  const revenueRowsFingerprint = useModelStore((s) =>
    getRevenueForecastConfigV1RowsFingerprint(s.revenueForecastConfigV1)
  );
  const cogsCfg = useModelStore((s) => s.cogsForecastConfigV1);
  const setCogsForecastConfigV1 = useModelStore((s) => s.setCogsForecastConfigV1);
  const setCogsForecastLineV1 = useModelStore((s) => s.setCogsForecastLineV1);
  const projectionYears = useModelStore((s) => s.meta?.years?.projection ?? []);

  const revenueTreeEffective = useMemo(() => {
    if (revenueTree.length > 0) return revenueTree;
    const rev = incomeStatement.find((r) => r.id === "rev");
    return (rev?.children ?? []).map((c) => ({ id: c.id, label: c.label, children: [], isForecastOnly: false }));
  }, [revenueTree, incomeStatement]);
  const forecastableLines = useMemo(
    () => buildForecastableCogsLinesFromRevenue(revenueTreeEffective, revenueCfgRows),
    [revenueTreeEffective, revenueCfgRows, revenueRowsFingerprint]
  );

  useEffect(() => {
    const merged = mergeForecastableLinesWithConfig(
      forecastableLines,
      cogsCfg?.lines ?? {}
    );
    const prev = JSON.stringify(cogsCfg?.lines ?? {});
    const next = JSON.stringify(merged);
    if (prev !== next) {
      setCogsForecastConfigV1({ lines: merged });
    }
  }, [forecastableLines, cogsCfg?.lines, setCogsForecastConfigV1]);

  const detected = useMemo(
    () => detectCogsLinesFromIncomeStatement(incomeStatement),
    [incomeStatement]
  );

  const cogsItems = detected.filter((d) => d.detectedBucket === "cogs");
  const reviewItems = detected.filter((d) => d.detectedBucket === "review");

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3">
        <p className="text-xs text-slate-300">
          COGS forecast lines were created from your revenue forecast structure. Review how each revenue stream should
          convert into direct costs.
        </p>
      </div>

      <section className="rounded-lg border border-slate-700 bg-slate-900/40">
        <div className="border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">Forecastable COGS Lines</h3>
        </div>
        {forecastableLines.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-500">
            No forecastable COGS lines found from the current revenue forecast structure.
          </div>
        ) : (
          <div className="p-3 space-y-4 bg-slate-950/25">
            {forecastableLines.map((line) => (
              <ForecastableCogsLineCard
                key={line.lineId}
                line={line}
                cfg={cogsCfg?.lines?.[line.lineId]}
                projectionYears={projectionYears}
                setCogsForecastLineV1={setCogsForecastLineV1}
                revenueCfgRows={revenueCfgRows}
                revenueTree={revenueTreeEffective}
                revenueRowsFingerprint={revenueRowsFingerprint}
              />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900/40">
        <div className="border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">Historical COGS Context</h3>
        </div>
        {cogsItems.length === 0 ? (
          <div className="px-4 py-4 text-xs text-slate-500">
            No clear historical COGS lines detected.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {cogsItems.map((line) => (
              <div key={line.sourceHistoricalLineId} className="px-4 py-3 space-y-1">
                <div className="text-sm text-slate-100">{line.lineLabel}</div>
                <div className="text-[11px] text-slate-500">
                  Confidence: <span className={confidenceTone(line.confidence)}>{line.confidence}</span> ·{" "}
                  {line.detectionReason}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900/40">
        <div className="border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">Review Items</h3>
        </div>
        {reviewItems.length === 0 ? (
          <div className="px-4 py-4 text-xs text-slate-500">
            No ambiguous items detected.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {reviewItems.map((line) => (
              <div key={line.sourceHistoricalLineId} className="px-4 py-3 space-y-1">
                <div className="text-sm text-slate-200">{line.lineLabel}</div>
                <div className="text-[11px] text-slate-500">
                  Confidence: <span className={confidenceTone(line.confidence)}>{line.confidence}</span> ·{" "}
                  {line.detectionReason}
                </div>
                <div className="text-[11px] text-amber-300/80">
                  Likely derived from schedule or non-recurring; review before forecasting here.
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
