"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import {
  collectOperatingExpenseLeafLines,
  type IngestedOpExLineV1,
} from "@/lib/opex-line-ingest";
import { buildOpExForecastConfigMerged } from "@/lib/opex-forecast-config-merge";
import { getOpExForecastConfigFingerprint } from "@/lib/opex-forecast-fingerprint";
import {
  getOpExLineLastHistoricalValue,
  hasPersistedOpExDirectForecast,
} from "@/lib/opex-forecast-projection-v1";
import { formatNumberInputDisplayOnBlur } from "@/lib/revenue-forecast-numeric-format";
import {
  validateGrowthPhases,
  expandPhasesToRatesByYear,
  GROWTH_PHASE_MESSAGES,
  type GrowthPhaseV1,
} from "@/lib/revenue-growth-phases-v1";
import { RevenueForecastDecimalInput } from "@/components/revenue-forecast-decimal-input";
import { GrowthPhaseEditor, type PhaseDraftV1 } from "@/components/revenue-forecast-v1-direct-forecast-block";
import type { OpExForecastLineConfigV1, OpExRouteStatusV1 } from "@/types/opex-forecast-v1";
import type { GrowthStartingBasisV1 } from "@/types/revenue-forecast-v1";
import type { Row } from "@/types/finance";

type HistShape = "constant" | "by_year" | "phases";

/** Stable fallbacks for Zustand selectors — `?? []` / `?? {}` / inline objects break getSnapshot (new ref every subscribe tick). */
const EMPTY_ROWS: Row[] = [];
const EMPTY_YEAR_LIST: string[] = [];
const EMPTY_SBC: Record<string, Record<string, number>> = {};
const EMPTY_DANA: Record<string, number> = {};

const OPEX_PHASE_INP =
  "rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5 text-right";

function newPhaseId(): string {
  return `opex-ph-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function draftsToPhases(drafts: PhaseDraftV1[]): GrowthPhaseV1[] {
  return drafts.map((d) => ({
    startYear: d.startYear,
    endYear: d.endYear,
    ratePercent: parseFloat(String(d.rateStr ?? "").replace(/,/g, "").trim()),
  }));
}

function mapPhaseErrors(errors: string[]): string[] {
  const map: Record<string, string> = {
    [GROWTH_PHASE_MESSAGES.overlap]: "Phases cannot overlap.",
    [GROWTH_PHASE_MESSAGES.gaps]: "Phases must run in order without gaps.",
    [GROWTH_PHASE_MESSAGES.needRate]: "Each phase needs a value.",
    [GROWTH_PHASE_MESSAGES.coverAll]: "Phases must cover all projection years.",
    [GROWTH_PHASE_MESSAGES.count]: "Use 1–4 phases.",
  };
  return [...new Set(errors.map((e) => map[e] ?? e))];
}

function parseNum(s: string): number | null {
  const n = Number(String(s ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function fmtDisplay(n: number): string {
  if (!Number.isFinite(n)) return "";
  return formatNumberInputDisplayOnBlur(String(n));
}

const ROUTE_LABELS: Record<OpExRouteStatusV1, string> = {
  forecast_direct: "Forecast here (direct)",
  derive_schedule: "Derived from schedule (later)",
  review_required: "Review required",
  excluded_nonrecurring: "Excluded / non-recurring",
};

function OpExPhase1LineCard(props: {
  line: IngestedOpExLineV1;
  cfg: OpExForecastLineConfigV1 | undefined;
  projectionYears: string[];
  lastHistValue: number | null;
  setOpexForecastLineV1: (lineId: string, patch: Partial<OpExForecastLineConfigV1>) => void;
}) {
  const { line, cfg, projectionYears, lastHistValue, setOpexForecastLineV1 } = props;
  const [cardExpanded, setCardExpanded] = useState(false);

  const method = (cfg?.forecastMethod ?? "") as
    | ""
    | "pct_of_revenue"
    | "growth_percent"
    | "flat_value"
    | "manual_by_year";

  const [localMethod, setLocalMethod] = useState(method || "growth_percent");
  useEffect(() => {
    if (method) setLocalMethod(method);
  }, [method, cfg?.lineId]);

  const p = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
  const pType = ((p.growthPatternType as string) ?? "constant") as HistShape;

  const [pctShape, setPctShape] = useState<HistShape>(method === "pct_of_revenue" ? pType : "constant");
  const [pctStr, setPctStr] = useState(
    p.pct != null && Number.isFinite(Number(p.pct)) ? fmtDisplay(Number(p.pct)) : ""
  );
  const [pctYearStrs, setPctYearStrs] = useState<Record<string, string>>(() => {
    const by = (p.pctsByYear ?? {}) as Record<string, number>;
    return Object.fromEntries(projectionYears.map((y) => [y, by[y] != null ? fmtDisplay(Number(by[y])) : ""]));
  });
  const [pctPhaseRows, setPctPhaseRows] = useState<PhaseDraftV1[]>(() => {
    const raw = Array.isArray(p.growthPhases) ? (p.growthPhases as GrowthPhaseV1[]) : [];
    if (raw.length > 0) {
      return raw.map((ph) => ({
        id: newPhaseId(),
        startYear: ph.startYear,
        endYear: ph.endYear,
        rateStr: fmtDisplay(ph.ratePercent),
      }));
    }
    if (projectionYears.length > 0) {
      return [
        {
          id: newPhaseId(),
          startYear: projectionYears[0]!,
          endYear: projectionYears[projectionYears.length - 1]!,
          rateStr: "",
        },
      ];
    }
    return [];
  });

  const [growthShape, setGrowthShape] = useState<HistShape>(
    method === "growth_percent" ? pType : "constant"
  );
  const [growthRateStr, setGrowthRateStr] = useState(
    p.ratePercent != null && Number.isFinite(Number(p.ratePercent))
      ? fmtDisplay(Number(p.ratePercent))
      : ""
  );
  const [startingBasis, setStartingBasis] = useState<GrowthStartingBasisV1>(
    (p.startingBasis as GrowthStartingBasisV1) ?? "last_historical"
  );
  const [startingAmtStr, setStartingAmtStr] = useState(
    p.startingAmount != null && Number.isFinite(Number(p.startingAmount))
      ? fmtDisplay(Number(p.startingAmount))
      : ""
  );
  const [growthYearStrs, setGrowthYearStrs] = useState<Record<string, string>>(() => {
    const by = (p.ratesByYear ?? {}) as Record<string, number>;
    return Object.fromEntries(projectionYears.map((y) => [y, by[y] != null ? fmtDisplay(Number(by[y])) : ""]));
  });
  const [growthPhaseRows, setGrowthPhaseRows] = useState<PhaseDraftV1[]>(() => {
    const raw = Array.isArray(p.growthPhases) ? (p.growthPhases as GrowthPhaseV1[]) : [];
    if (raw.length > 0) {
      return raw.map((ph) => ({
        id: newPhaseId(),
        startYear: ph.startYear,
        endYear: ph.endYear,
        rateStr: fmtDisplay(ph.ratePercent),
      }));
    }
    if (projectionYears.length > 0) {
      return [
        {
          id: newPhaseId(),
          startYear: projectionYears[0]!,
          endYear: projectionYears[projectionYears.length - 1]!,
          rateStr: "",
        },
      ];
    }
    return [];
  });

  const [flatStr, setFlatStr] = useState(
    (p as { value?: number }).value != null && Number.isFinite(Number((p as { value?: number }).value))
      ? fmtDisplay(Number((p as { value?: number }).value))
      : ""
  );
  const [manualYearStrs, setManualYearStrs] = useState<Record<string, string>>(() => {
    const by = ((p as { valuesByYear?: Record<string, number> }).valuesByYear ?? {}) as Record<string, number>;
    return Object.fromEntries(projectionYears.map((y) => [y, by[y] != null ? fmtDisplay(Number(by[y])) : ""]));
  });

  const buildSavedKey = useMemo(() => {
    return JSON.stringify({
      method: cfg?.forecastMethod ?? "",
      params: cfg?.forecastParameters ?? {},
    });
  }, [cfg?.forecastMethod, cfg?.forecastParameters]);

  const buildDraftKey = useMemo(() => {
    if (localMethod === "pct_of_revenue") {
      return JSON.stringify({
        localMethod,
        pctShape,
        pctStr,
        pctYearStrs,
        pctPhaseRows,
      });
    }
    if (localMethod === "growth_percent") {
      return JSON.stringify({
        localMethod,
        growthShape,
        growthRateStr,
        startingBasis,
        startingAmtStr,
        growthYearStrs,
        growthPhaseRows,
      });
    }
    if (localMethod === "flat_value") {
      return JSON.stringify({ localMethod, flatStr });
    }
    if (localMethod === "manual_by_year") {
      return JSON.stringify({ localMethod, manualYearStrs });
    }
    return JSON.stringify({ localMethod });
  }, [
    localMethod,
    pctShape,
    pctStr,
    pctYearStrs,
    pctPhaseRows,
    growthShape,
    growthRateStr,
    startingBasis,
    startingAmtStr,
    growthYearStrs,
    growthPhaseRows,
    flatStr,
    manualYearStrs,
  ]);

  const hasUnsaved = buildDraftKey !== buildSavedKey;
  const hasSaved = hasPersistedOpExDirectForecast(cfg, projectionYears);

  const buildApplyPayload = useCallback((): {
    forecastMethod: OpExForecastLineConfigV1["forecastMethod"];
    forecastParameters: Record<string, unknown>;
    valid: boolean;
  } | null => {
    if (localMethod === "pct_of_revenue") {
      const params: Record<string, unknown> = {};
      if (pctShape === "constant") {
        const pct = parseNum(pctStr);
        if (pct == null) return null;
        params.growthPatternType = "constant";
        params.pct = pct;
      } else if (pctShape === "by_year") {
        const pctsByYear: Record<string, number> = {};
        for (const y of projectionYears) {
          const n = parseNum(pctYearStrs[y] ?? "");
          if (n == null) return null;
          pctsByYear[y] = n;
        }
        params.growthPatternType = "by_year";
        params.pctsByYear = pctsByYear;
        params.pct = projectionYears[0] ? pctsByYear[projectionYears[0]!] : 0;
      } else {
        const phases = draftsToPhases(pctPhaseRows);
        const { ok } = validateGrowthPhases(phases, projectionYears);
        if (!ok) return null;
        params.growthPatternType = "phases";
        params.growthPhases = phases;
        const ex = expandPhasesToRatesByYear(phases, projectionYears);
        params.pct = projectionYears[0] != null ? ex[projectionYears[0]!] : phases[0]?.ratePercent;
      }
      return { forecastMethod: "pct_of_revenue", forecastParameters: params, valid: true };
    }
    if (localMethod === "growth_percent") {
      const params: Record<string, unknown> = {
        startingBasis,
      };
      if (startingBasis === "starting_amount") {
        const sa = parseNum(startingAmtStr);
        if (sa == null) return null;
        params.startingAmount = sa;
      }
      if (growthShape === "constant") {
        const r = parseNum(growthRateStr);
        if (r == null) return null;
        params.growthPatternType = "constant";
        params.ratePercent = r;
      } else if (growthShape === "by_year") {
        const ratesByYear: Record<string, number> = {};
        for (const y of projectionYears) {
          const n = parseNum(growthYearStrs[y] ?? "");
          if (n == null) return null;
          ratesByYear[y] = n;
        }
        params.growthPatternType = "by_year";
        params.ratesByYear = ratesByYear;
        params.ratePercent = projectionYears[0] ? ratesByYear[projectionYears[0]!] : 0;
      } else {
        const phases = draftsToPhases(growthPhaseRows);
        const { ok } = validateGrowthPhases(phases, projectionYears);
        if (!ok) return null;
        params.growthPatternType = "phases";
        params.growthPhases = phases;
        const ex = expandPhasesToRatesByYear(phases, projectionYears);
        params.ratePercent = projectionYears[0] != null ? ex[projectionYears[0]!] : phases[0]?.ratePercent;
      }
      return { forecastMethod: "growth_percent", forecastParameters: params, valid: true };
    }
    if (localMethod === "flat_value") {
      const v = parseNum(flatStr);
      if (v == null) return null;
      return { forecastMethod: "flat_value", forecastParameters: { value: v }, valid: true };
    }
    if (localMethod === "manual_by_year") {
      const valuesByYear: Record<string, number> = {};
      for (const y of projectionYears) {
        const n = parseNum(manualYearStrs[y] ?? "");
        if (n == null) return null;
        valuesByYear[y] = n;
      }
      return { forecastMethod: "manual_by_year", forecastParameters: { valuesByYear }, valid: true };
    }
    return null;
  }, [
    localMethod,
    pctShape,
    pctStr,
    pctYearStrs,
    pctPhaseRows,
    growthShape,
    growthRateStr,
    startingBasis,
    startingAmtStr,
    growthYearStrs,
    growthPhaseRows,
    flatStr,
    manualYearStrs,
    projectionYears,
  ]);

  const applyPayload = buildApplyPayload();
  const canApply = applyPayload?.valid === true;
  const phaseErrPct =
    pctShape === "phases" ? mapPhaseErrors(validateGrowthPhases(draftsToPhases(pctPhaseRows), projectionYears).errors) : [];
  const phaseErrGr =
    growthShape === "phases"
      ? mapPhaseErrors(validateGrowthPhases(draftsToPhases(growthPhaseRows), projectionYears).errors)
      : [];

  const resetDraft = () => {
    const pm = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
    const m = cfg?.forecastMethod;
    if (m) setLocalMethod(m);
    if (m === "pct_of_revenue") {
      const t = ((pm.growthPatternType as string) ?? "constant") as HistShape;
      setPctShape(t);
      setPctStr(pm.pct != null ? fmtDisplay(Number(pm.pct)) : "");
      const by = (pm.pctsByYear ?? {}) as Record<string, number>;
      setPctYearStrs(
        Object.fromEntries(projectionYears.map((y) => [y, by[y] != null ? fmtDisplay(Number(by[y])) : ""]))
      );
      const raw = Array.isArray(pm.growthPhases) ? (pm.growthPhases as GrowthPhaseV1[]) : [];
      setPctPhaseRows(
        raw.length > 0
          ? raw.map((ph) => ({
              id: newPhaseId(),
              startYear: ph.startYear,
              endYear: ph.endYear,
              rateStr: fmtDisplay(ph.ratePercent),
            }))
          : projectionYears.length > 0
            ? [
                {
                  id: newPhaseId(),
                  startYear: projectionYears[0]!,
                  endYear: projectionYears[projectionYears.length - 1]!,
                  rateStr: "",
                },
              ]
            : []
      );
    }
    if (m === "growth_percent") {
      setGrowthShape(((pm.growthPatternType as string) ?? "constant") as HistShape);
      setGrowthRateStr(pm.ratePercent != null ? fmtDisplay(Number(pm.ratePercent)) : "");
      setStartingBasis((pm.startingBasis as GrowthStartingBasisV1) ?? "last_historical");
      setStartingAmtStr(pm.startingAmount != null ? fmtDisplay(Number(pm.startingAmount)) : "");
      const by = (pm.ratesByYear ?? {}) as Record<string, number>;
      setGrowthYearStrs(
        Object.fromEntries(projectionYears.map((y) => [y, by[y] != null ? fmtDisplay(Number(by[y])) : ""]))
      );
      const raw = Array.isArray(pm.growthPhases) ? (pm.growthPhases as GrowthPhaseV1[]) : [];
      setGrowthPhaseRows(
        raw.length > 0
          ? raw.map((ph) => ({
              id: newPhaseId(),
              startYear: ph.startYear,
              endYear: ph.endYear,
              rateStr: fmtDisplay(ph.ratePercent),
            }))
          : projectionYears.length > 0
            ? [
                {
                  id: newPhaseId(),
                  startYear: projectionYears[0]!,
                  endYear: projectionYears[projectionYears.length - 1]!,
                  rateStr: "",
                },
              ]
            : []
      );
    }
    if (m === "flat_value") {
      const v = (pm as { value?: number }).value;
      setFlatStr(v != null ? fmtDisplay(Number(v)) : "");
    }
    if (m === "manual_by_year") {
      const by = ((pm as { valuesByYear?: Record<string, number> }).valuesByYear ?? {}) as Record<string, number>;
      setManualYearStrs(
        Object.fromEntries(projectionYears.map((y) => [y, by[y] != null ? fmtDisplay(Number(by[y])) : ""]))
      );
    }
  };

  const apply = () => {
    if (!applyPayload?.valid) return;
    setOpexForecastLineV1(line.lineId, {
      lineId: line.lineId,
      originalLineLabel: line.label,
      routeStatus: "forecast_direct",
      forecastMethod: applyPayload.forecastMethod,
      forecastParameters: applyPayload.forecastParameters as OpExForecastLineConfigV1["forecastParameters"],
    });
  };

  if (cfg?.routeStatus !== "forecast_direct") return null;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setCardExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-800/40"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-100 truncate">{line.label}</div>
          <div className="text-[10px] text-slate-500 truncate">
            {line.parentLabel ? `Under: ${line.parentLabel}` : null}
            {lastHistValue != null && Number.isFinite(lastHistValue) ? (
              <span className="ml-2">· Last actual: {fmtDisplay(lastHistValue)}</span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[10px] font-medium uppercase ${
              hasUnsaved ? "text-amber-300" : hasSaved ? "text-emerald-300" : "text-slate-500"
            }`}
          >
            {hasUnsaved ? "Unsaved" : hasSaved ? "Saved" : "Not started"}
          </span>
          <span className="text-slate-500 text-xs">{cardExpanded ? "▼" : "▶"}</span>
        </div>
      </button>
      {cardExpanded ? (
        <div className="border-t border-slate-800 px-3 py-3 space-y-3 text-xs">
          {cfg?.aiExplanation ? (
            <div className="rounded border border-slate-700/80 bg-slate-900/50 px-2 py-2 text-[11px] text-slate-400">
              <span className="text-slate-500">AI note: </span>
              {cfg.aiUserFacingSummary ?? cfg.aiExplanation}
              {cfg.aiSuggestedMethod && cfg.aiConfidence ? (
                <span className="block mt-1 text-slate-500">
                  Suggested: {cfg.aiSuggestedMethod.replace(/_/g, " ")} ({cfg.aiConfidence} confidence)
                </span>
              ) : null}
            </div>
          ) : null}

          <div>
            <label className="block text-[10px] uppercase text-slate-500 mb-1">Method</label>
            <select
              className="w-full rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-2 py-1.5"
              value={localMethod}
              onChange={(e) => setLocalMethod(e.target.value as typeof localMethod)}
            >
              <option value="pct_of_revenue">% of revenue (total)</option>
              <option value="growth_percent">Growth %</option>
              <option value="flat_value">Flat value</option>
              <option value="manual_by_year">Manual by year</option>
            </select>
          </div>

          {localMethod === "pct_of_revenue" ? (
            <div className="space-y-2">
              <select
                className="w-full rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-2 py-1.5"
                value={pctShape}
                onChange={(e) => setPctShape(e.target.value as HistShape)}
              >
                <option value="constant">Constant %</option>
                <option value="by_year">By year</option>
                <option value="phases">Growth phases (% of revenue)</option>
              </select>
              {pctShape === "constant" ? (
                <RevenueForecastDecimalInput
                  className={OPEX_PHASE_INP + " w-full"}
                  value={pctStr}
                  onChange={setPctStr}
                  placeholder="% of revenue"
                />
              ) : null}
              {pctShape === "by_year" ? (
                <div className="grid gap-1">
                  {projectionYears.map((y) => (
                    <div key={y} className="flex items-center gap-2">
                      <span className="w-14 text-slate-500">{y}</span>
                      <RevenueForecastDecimalInput
                        className={OPEX_PHASE_INP + " flex-1"}
                        value={pctYearStrs[y] ?? ""}
                        onChange={(v) => setPctYearStrs((s) => ({ ...s, [y]: v }))}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              {pctShape === "phases" ? (
                <div className="space-y-1">
                  <GrowthPhaseEditor
                    projectionYears={projectionYears}
                    phaseRows={pctPhaseRows}
                    setPhaseRows={setPctPhaseRows}
                    inp={OPEX_PHASE_INP}
                    rateColumnLabel="% of rev."
                  />
                  {phaseErrPct.length > 0 ? (
                    <div className="text-amber-300 text-[10px]">{phaseErrPct[0]}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {localMethod === "growth_percent" ? (
            <div className="space-y-2">
              <div>
                <label className="block text-[10px] uppercase text-slate-500 mb-1">Starting from</label>
                <select
                  className="w-full rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-2 py-1.5"
                  value={startingBasis}
                  onChange={(e) => setStartingBasis(e.target.value as GrowthStartingBasisV1)}
                >
                  <option value="last_historical">Last historical (this line)</option>
                  <option value="starting_amount">Manual starting amount</option>
                </select>
              </div>
              {startingBasis === "starting_amount" ? (
                <RevenueForecastDecimalInput
                  className={OPEX_PHASE_INP + " w-full"}
                  value={startingAmtStr}
                  onChange={setStartingAmtStr}
                  placeholder="Starting amount"
                />
              ) : null}
              <select
                className="w-full rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-2 py-1.5"
                value={growthShape}
                onChange={(e) => setGrowthShape(e.target.value as HistShape)}
              >
                <option value="constant">Constant growth %</option>
                <option value="by_year">By year</option>
                <option value="phases">Phases</option>
              </select>
              {growthShape === "constant" ? (
                <RevenueForecastDecimalInput
                  className={OPEX_PHASE_INP + " w-full"}
                  value={growthRateStr}
                  onChange={setGrowthRateStr}
                  placeholder="YoY %"
                />
              ) : null}
              {growthShape === "by_year" ? (
                <div className="grid gap-1">
                  {projectionYears.map((y) => (
                    <div key={y} className="flex items-center gap-2">
                      <span className="w-14 text-slate-500">{y}</span>
                      <RevenueForecastDecimalInput
                        className={OPEX_PHASE_INP + " flex-1"}
                        value={growthYearStrs[y] ?? ""}
                        onChange={(v) => setGrowthYearStrs((s) => ({ ...s, [y]: v }))}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              {growthShape === "phases" ? (
                <div className="space-y-1">
                  <GrowthPhaseEditor
                    projectionYears={projectionYears}
                    phaseRows={growthPhaseRows}
                    setPhaseRows={setGrowthPhaseRows}
                    inp={OPEX_PHASE_INP}
                    rateColumnLabel="YoY %"
                  />
                  {phaseErrGr.length > 0 ? (
                    <div className="text-amber-300 text-[10px]">{phaseErrGr[0]}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {localMethod === "flat_value" ? (
            <RevenueForecastDecimalInput
              className={OPEX_PHASE_INP + " w-full"}
              value={flatStr}
              onChange={setFlatStr}
              placeholder="Same amount each forecast year"
            />
          ) : null}

          {localMethod === "manual_by_year" ? (
            <div className="grid gap-1">
              {projectionYears.map((y) => (
                <div key={y} className="flex items-center gap-2">
                  <span className="w-14 text-slate-500">{y}</span>
                  <RevenueForecastDecimalInput
                    className={OPEX_PHASE_INP + " flex-1"}
                    value={manualYearStrs[y] ?? ""}
                    onChange={(v) => setManualYearStrs((s) => ({ ...s, [y]: v }))}
                  />
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={!canApply || !hasUnsaved}
              onClick={apply}
              className="rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs px-3 py-1.5"
            >
              Apply
            </button>
            <button
              type="button"
              disabled={!hasUnsaved}
              onClick={resetDraft}
              className="rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-40 text-xs px-3 py-1.5"
            >
              Reset
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RouteOverrideRow(props: {
  line: IngestedOpExLineV1;
  cfg: OpExForecastLineConfigV1 | undefined;
  setOpexForecastLineV1: (lineId: string, patch: Partial<OpExForecastLineConfigV1>) => void;
}) {
  const { line, cfg, setOpexForecastLineV1 } = props;
  const status = cfg?.routeStatus ?? "forecast_direct";
  return (
    <div className="px-4 py-3 space-y-2 border-b border-slate-800/90 last:border-b-0">
      <div className="text-sm text-slate-200">{line.label}</div>
      {cfg?.deterministicRuleId ? (
        <div className="text-[10px] text-slate-500">Rule: {cfg.deterministicRuleId}</div>
      ) : null}
      {cfg?.aiExplanation ? (
        <div className="text-[11px] text-slate-400">{cfg.aiUserFacingSummary ?? cfg.aiExplanation}</div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[10px] text-slate-500">Route</label>
        <select
          className="rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1"
          value={status}
          onChange={(e) => {
            const routeStatus = e.target.value as OpExRouteStatusV1;
            setOpexForecastLineV1(line.lineId, {
              lineId: line.lineId,
              originalLineLabel: line.label,
              routeStatus,
              routeResolvedBy: "user",
            });
          }}
        >
          {(Object.keys(ROUTE_LABELS) as OpExRouteStatusV1[]).map((k) => (
            <option key={k} value={k}>
              {ROUTE_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default function OperatingExpensesPhase1Panel() {
  const incomeStatement = useModelStore((s) => s.incomeStatement) ?? EMPTY_ROWS;
  const balanceSheet = useModelStore((s) => s.balanceSheet) ?? EMPTY_ROWS;
  const cashFlow = useModelStore((s) => s.cashFlow) ?? EMPTY_ROWS;
  const allStatements = useMemo(
    () => ({
      incomeStatement,
      balanceSheet,
      cashFlow,
    }),
    [incomeStatement, balanceSheet, cashFlow]
  );
  const opexCfg = useModelStore((s) => s.opexForecastConfigV1);
  const setOpexForecastConfigV1 = useModelStore((s) => s.setOpexForecastConfigV1);
  const setOpexForecastLineV1 = useModelStore((s) => s.setOpexForecastLineV1);
  const projectionYears = useModelStore((s) => s.meta?.years?.projection) ?? EMPTY_YEAR_LIST;
  const historicalYears = useModelStore((s) => s.meta?.years?.historical) ?? EMPTY_YEAR_LIST;
  const lastHistoricYear = historicalYears[historicalYears.length - 1] ?? "";
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns) ?? EMPTY_SBC;
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns) ?? EMPTY_DANA;
  const companyContext = useModelStore((s) => s.companyContext);

  const ingested = useMemo(() => collectOperatingExpenseLeafLines(incomeStatement), [incomeStatement]);
  /** Includes labels so relabeling in IS re-runs merge without relying on unstable array identity. */
  const ingestMergeKey = useMemo(
    () => ingested.map((x) => `${x.lineId}:${x.label}:${x.parentLabel}`).join("|"),
    [ingested]
  );
  const opexLinesJson = useMemo(() => JSON.stringify(opexCfg?.lines ?? {}), [opexCfg]);

  useEffect(() => {
    const merged = buildOpExForecastConfigMerged(ingested, opexCfg);
    const next = JSON.stringify(merged.lines);
    if (opexLinesJson !== next) {
      setOpexForecastConfigV1(merged);
    }
    // ingestMergeKey + opexLinesJson subsume ingested / opexCfg.lines identity for merge idempotency
  }, [ingestMergeKey, opexLinesJson, setOpexForecastConfigV1, ingested, opexCfg]);

  const opexLinesFingerprint = useMemo(() => getOpExForecastConfigFingerprint(opexCfg), [opexCfg]);

  const linesByRoute = useMemo(() => {
    const direct: IngestedOpExLineV1[] = [];
    const schedule: IngestedOpExLineV1[] = [];
    const review: IngestedOpExLineV1[] = [];
    for (const row of ingested) {
      const st = opexCfg?.lines?.[row.lineId]?.routeStatus ?? "forecast_direct";
      if (st === "forecast_direct") direct.push(row);
      else if (st === "derive_schedule") schedule.push(row);
      else review.push(row);
    }
    return { direct, schedule, review };
  }, [ingested, opexLinesFingerprint]);

  const lastHistByLine = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const row of ingested) {
      out[row.lineId] = getOpExLineLastHistoricalValue(
        row.lineId,
        incomeStatement,
        lastHistoricYear,
        allStatements,
        sbcBreakdowns,
        danaBreakdowns
      );
    }
    return out;
  }, [ingested, incomeStatement, lastHistoricYear, allStatements, sbcBreakdowns, danaBreakdowns]);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const runAiRouting = async () => {
    setAiError(null);
    setAiLoading(true);
    try {
      const items = ingested.map((row) => {
        const c = opexCfg?.lines?.[row.lineId];
        return {
          lineId: row.lineId,
          label: row.label,
          parentLabel: row.parentLabel,
          sectionOwner: row.sectionOwner ?? undefined,
          deterministicRoute: c?.routeStatus,
          deterministicRuleId: c?.deterministicRuleId,
        };
      });
      const res = await fetch("/api/ai/opex-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, companyContext }),
      });
      const data = (await res.json()) as {
        suggestions?: Array<{
          lineId: string;
          suggestedRoute: OpExRouteStatusV1;
          suggestedMethod: string | null;
          confidence: string;
          explanation: string;
          userFacingSummary: string;
          flags: string[];
        }>;
        error?: string;
      };
      if (!res.ok) {
        setAiError(data.error ?? "AI request failed");
        return;
      }
      const sugs = data.suggestions ?? [];
      for (const s of sugs) {
        const line = ingested.find((x) => x.lineId === s.lineId);
        if (!line) continue;
        const cur = opexCfg?.lines?.[s.lineId];
        if (cur?.routeResolvedBy === "user") continue;
        setOpexForecastLineV1(s.lineId, {
          lineId: s.lineId,
          originalLineLabel: line.label,
          routeStatus: s.suggestedRoute,
          routeResolvedBy: "ai",
          aiSuggestedRoute: s.suggestedRoute,
          aiSuggestedMethod:
            s.suggestedMethod === "pct_of_revenue" ||
            s.suggestedMethod === "growth_percent" ||
            s.suggestedMethod === "flat_value" ||
            s.suggestedMethod === "manual_by_year"
              ? s.suggestedMethod
              : undefined,
          aiConfidence:
            s.confidence === "high" || s.confidence === "medium" || s.confidence === "low"
              ? s.confidence
              : "medium",
          aiExplanation: s.explanation,
          aiUserFacingSummary: s.userFacingSummary,
          aiFlags: s.flags,
        });
      }
    } catch {
      setAiError("Network error");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-3 space-y-2">
        <h3 className="text-sm font-semibold text-emerald-100">Operating expenses (Phase 1)</h3>
        <p className="text-xs text-slate-400">
          Lines come from your historical P&amp;L under Operating Expenses. Deterministic rules classify obvious
          schedule and non-recurring items; use AI for the rest. User route overrides are preserved.
        </p>
        <button
          type="button"
          disabled={aiLoading || ingested.length === 0}
          onClick={() => void runAiRouting()}
          className="rounded bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs px-3 py-1.5"
        >
          {aiLoading ? "Running AI…" : "Run AI routing (advisory)"}
        </button>
        {aiError ? <div className="text-xs text-red-400">{aiError}</div> : null}
      </div>

      <section className="rounded-lg border border-slate-700 bg-slate-900/40">
        <div className="border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">Forecastable operating expense lines</h3>
          <p className="text-[11px] text-slate-500 mt-1">
            Direct methods only: % of revenue (vs total revenue), growth %, flat, manual by year, phased %.
          </p>
        </div>
        {linesByRoute.direct.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-500">No lines routed to direct forecast.</div>
        ) : (
          <div className="p-3 space-y-3 bg-slate-950/25">
            {linesByRoute.direct.map((row) => (
              <OpExPhase1LineCard
                key={row.lineId}
                line={row}
                cfg={opexCfg?.lines?.[row.lineId]}
                projectionYears={projectionYears}
                lastHistValue={lastHistByLine[row.lineId] ?? null}
                setOpexForecastLineV1={setOpexForecastLineV1}
              />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900/40">
        <div className="border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">Derived from schedule (Phase 2)</h3>
          <p className="text-[11px] text-slate-500 mt-1">
            Not forecast here. Depreciation, interest, taxes, and similar items will link to schedules in a later
            release.
          </p>
        </div>
        {linesByRoute.schedule.length === 0 ? (
          <div className="px-4 py-4 text-xs text-slate-500">No schedule-routed lines.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {linesByRoute.schedule.map((row) => (
              <RouteOverrideRow key={row.lineId} line={row} cfg={opexCfg?.lines?.[row.lineId]} setOpexForecastLineV1={setOpexForecastLineV1} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900/40">
        <div className="border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">Review &amp; excluded items</h3>
        </div>
        {linesByRoute.review.length === 0 ? (
          <div className="px-4 py-4 text-xs text-slate-500">No review or excluded lines.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {linesByRoute.review.map((row) => (
              <RouteOverrideRow key={row.lineId} line={row} cfg={opexCfg?.lines?.[row.lineId]} setOpexForecastLineV1={setOpexForecastLineV1} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900/40">
        <div className="border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">Historical operating expense context</h3>
        </div>
        {ingested.length === 0 ? (
          <div className="px-4 py-4 text-xs text-slate-500">No operating expense lines under the P&amp;L OpEx section.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {ingested.map((row) => {
              const v = lastHistByLine[row.lineId];
              return (
                <div key={row.lineId} className="px-4 py-2 flex justify-between gap-2 text-xs">
                  <span className="text-slate-300">{row.label}</span>
                  <span className="text-slate-500 tabular-nums">
                    {v != null && Number.isFinite(v) ? fmtDisplay(v) : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
