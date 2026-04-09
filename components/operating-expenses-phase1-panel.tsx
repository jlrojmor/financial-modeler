"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useModelStore } from "@/store/useModelStore";
import {
  collectOperatingExpenseLeafLines,
  type IngestedOpExLineV1,
} from "@/lib/opex-line-ingest";
import { isOpexLineLabelHiddenOnCogsOpexTab } from "@/lib/opex-cogs-opex-tab-visibility";
import { buildOpExForecastConfigMerged } from "@/lib/opex-forecast-config-merge";
import { getOpExForecastConfigFingerprint } from "@/lib/opex-forecast-fingerprint";
import {
  getOpExLineLastHistoricalValue,
  hasPersistedOpExDirectForecast,
} from "@/lib/opex-forecast-projection-v1";
import {
  getForecastOpExSectionSummary,
  getOpexDirectLineNudges,
  sumAbsHistoricalForLineIds,
  type ForecastOpExSectionSummary,
  type OpexLineNudgeSignal,
} from "@/lib/opex-nudges";
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
import {
  formatOpexClassifierReferencePct,
  formatOpexConfidencePct,
  formatOpexCollapsedDirectRoutePillLabel,
  formatOpexCollapsedDirectRoutingProvenanceSummary,
  getOpexCollapsedDirectRoutePillClassName,
  opexConfidenceBadgeClass,
  opexEffectiveConfidencePct,
  opexPrimaryRouteReason,
  opexRouteSourceLabel,
} from "@/lib/opex-routing-ui";
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

/** Phase row shape for fingerprinting (ignores unstable React row ids). */
type OpexPhaseFingerprint = { startYear: string; endYear: string; rateStr: string };

function normalizeOpexPhaseRowsForFingerprint(rows: PhaseDraftV1[]): OpexPhaseFingerprint[] {
  return rows.map((r) => ({
    startYear: String(r.startYear ?? ""),
    endYear: String(r.endYear ?? ""),
    rateStr: String(r.rateStr ?? ""),
  }));
}

function defaultOpexPhaseFingerprint(projectionYears: string[]): OpexPhaseFingerprint[] {
  if (projectionYears.length === 0) return [];
  return [
    {
      startYear: projectionYears[0]!,
      endYear: projectionYears[projectionYears.length - 1]!,
      rateStr: "",
    },
  ];
}

/**
 * Canonical fingerprint of the **applied** direct forecast for a line — same logical shape as the
 * draft fingerprint so `hasUnsaved` compares local draft vs working store, not draft vs raw JSON params.
 */
function buildOpexDirectAppliedFingerprint(
  forecastMethod: string | undefined,
  rawParams: Record<string, unknown> | undefined,
  projectionYears: string[]
): string {
  const pm = rawParams ?? {};
  const method = forecastMethod ?? "";

  if (!method) {
    return JSON.stringify({
      localMethod: "growth_percent",
      growthShape: "constant",
      growthRateStr: "",
      startingBasis: "last_historical",
      startingAmtStr: "",
      growthYearStrs: Object.fromEntries(projectionYears.map((y) => [y, ""])),
      growthPhaseNorm: defaultOpexPhaseFingerprint(projectionYears),
    });
  }

  if (method === "pct_of_revenue") {
    const pType = ((pm.growthPatternType as string) ?? "constant") as HistShape;
    if (pType === "by_year") {
      const by = (pm.pctsByYear ?? {}) as Record<string, number>;
      return JSON.stringify({
        localMethod: "pct_of_revenue",
        pctShape: "by_year",
        pctStr: pm.pct != null && Number.isFinite(Number(pm.pct)) ? fmtDisplay(Number(pm.pct)) : "",
        pctYearStrs: Object.fromEntries(
          projectionYears.map((y) => [y, by[y] != null ? fmtDisplay(Number(by[y])) : ""])
        ),
        pctPhaseNorm: defaultOpexPhaseFingerprint(projectionYears),
      });
    }
    if (pType === "phases") {
      const raw = Array.isArray(pm.growthPhases) ? (pm.growthPhases as GrowthPhaseV1[]) : [];
      return JSON.stringify({
        localMethod: "pct_of_revenue",
        pctShape: "phases",
        pctStr: pm.pct != null && Number.isFinite(Number(pm.pct)) ? fmtDisplay(Number(pm.pct)) : "",
        pctYearStrs: Object.fromEntries(projectionYears.map((y) => [y, ""])),
        pctPhaseNorm:
          raw.length > 0
            ? raw.map((ph) => ({
                startYear: String(ph.startYear ?? ""),
                endYear: String(ph.endYear ?? ""),
                rateStr:
                  ph.ratePercent != null && Number.isFinite(Number(ph.ratePercent))
                    ? fmtDisplay(Number(ph.ratePercent))
                    : "",
              }))
            : defaultOpexPhaseFingerprint(projectionYears),
      });
    }
    return JSON.stringify({
      localMethod: "pct_of_revenue",
      pctShape: "constant",
      pctStr: pm.pct != null && Number.isFinite(Number(pm.pct)) ? fmtDisplay(Number(pm.pct)) : "",
      pctYearStrs: Object.fromEntries(projectionYears.map((y) => [y, ""])),
      pctPhaseNorm: defaultOpexPhaseFingerprint(projectionYears),
    });
  }

  if (method === "growth_percent") {
    const pType = ((pm.growthPatternType as string) ?? "constant") as HistShape;
    const basis = (pm.startingBasis as GrowthStartingBasisV1) ?? "last_historical";
    if (pType === "by_year") {
      const by = (pm.ratesByYear ?? {}) as Record<string, number>;
      return JSON.stringify({
        localMethod: "growth_percent",
        growthShape: "by_year",
        growthRateStr: pm.ratePercent != null ? fmtDisplay(Number(pm.ratePercent)) : "",
        startingBasis: basis,
        startingAmtStr: pm.startingAmount != null ? fmtDisplay(Number(pm.startingAmount)) : "",
        growthYearStrs: Object.fromEntries(
          projectionYears.map((y) => [y, by[y] != null ? fmtDisplay(Number(by[y])) : ""])
        ),
        growthPhaseNorm: defaultOpexPhaseFingerprint(projectionYears),
      });
    }
    if (pType === "phases") {
      const raw = Array.isArray(pm.growthPhases) ? (pm.growthPhases as GrowthPhaseV1[]) : [];
      return JSON.stringify({
        localMethod: "growth_percent",
        growthShape: "phases",
        growthRateStr: "",
        startingBasis: basis,
        startingAmtStr: pm.startingAmount != null ? fmtDisplay(Number(pm.startingAmount)) : "",
        growthYearStrs: Object.fromEntries(projectionYears.map((y) => [y, ""])),
        growthPhaseNorm:
          raw.length > 0
            ? raw.map((ph) => ({
                startYear: String(ph.startYear ?? ""),
                endYear: String(ph.endYear ?? ""),
                rateStr:
                  ph.ratePercent != null && Number.isFinite(Number(ph.ratePercent))
                    ? fmtDisplay(Number(ph.ratePercent))
                    : "",
              }))
            : defaultOpexPhaseFingerprint(projectionYears),
      });
    }
    return JSON.stringify({
      localMethod: "growth_percent",
      growthShape: "constant",
      growthRateStr: pm.ratePercent != null && Number.isFinite(Number(pm.ratePercent))
        ? fmtDisplay(Number(pm.ratePercent))
        : "",
      startingBasis: basis,
      startingAmtStr: pm.startingAmount != null ? fmtDisplay(Number(pm.startingAmount)) : "",
      growthYearStrs: Object.fromEntries(projectionYears.map((y) => [y, ""])),
      growthPhaseNorm: defaultOpexPhaseFingerprint(projectionYears),
    });
  }

  if (method === "flat_value") {
    const v = (pm as { value?: number }).value;
    return JSON.stringify({
      localMethod: "flat_value",
      flatStr: v != null && Number.isFinite(Number(v)) ? fmtDisplay(Number(v)) : "",
    });
  }

  if (method === "manual_by_year") {
    const by = ((pm as { valuesByYear?: Record<string, number> }).valuesByYear ?? {}) as Record<string, number>;
    return JSON.stringify({
      localMethod: "manual_by_year",
      manualYearStrs: Object.fromEntries(
        projectionYears.map((y) => [y, by[y] != null ? fmtDisplay(Number(by[y])) : ""])
      ),
    });
  }

  return buildOpexDirectAppliedFingerprint(undefined, undefined, projectionYears);
}

const ROUTE_LABELS: Record<OpExRouteStatusV1, string> = {
  forecast_direct: "Forecast here",
  derive_schedule: "Handled in schedules (Phase 2)",
  review_required: "Needs review",
  excluded_nonrecurring: "Excluded",
};

const ROUTE_HELP: Record<OpExRouteStatusV1, string> = {
  forecast_direct: "Forecast directly in this step.",
  derive_schedule: "Modeled later (depreciation, interest, and similar items).",
  review_required: "Requires your confirmation.",
  excluded_nonrecurring: "Not part of the recurring forecast.",
};

type OpExSectionAccordionVariant = "default" | "needs_review" | "excluded";

function buildForecastOpExHeaderSummary(directCount: number, s: ForecastOpExSectionSummary): string {
  if (directCount === 0) return "No lines";
  const bits: string[] = [`${directCount} line${directCount === 1 ? "" : "s"}`];
  if (s.highImpactCount > 0) {
    bits.push(`${s.highImpactCount} high impact`);
  }
  if (s.needAttentionCount > 0) {
    if (s.notForecastedCount > 0) {
      bits.push(`${s.needAttentionCount} need attention`);
    } else {
      bits.push(`${s.needAttentionCount} worth reviewing`);
    }
  }
  return bits.join(" · ");
}

function OpExSectionAccordion(props: {
  title: ReactNode;
  subtitle: ReactNode;
  summary: string;
  defaultExpanded: boolean;
  variant?: OpExSectionAccordionVariant;
  children: ReactNode;
}) {
  const { title, subtitle, summary, defaultExpanded, variant = "default", children } = props;
  const [expanded, setExpanded] = useState(defaultExpanded);

  const outer =
    variant === "needs_review"
      ? "rounded-lg border border-amber-800/40 bg-amber-950/10 ring-1 ring-amber-900/20"
      : variant === "excluded"
        ? "rounded-lg border border-slate-600/70 bg-slate-900/40"
        : "rounded-lg border border-slate-700 bg-slate-900/40";

  const headerBorder =
    variant === "needs_review"
      ? expanded
        ? "border-b border-amber-900/30"
        : ""
      : expanded
        ? "border-b border-slate-800"
        : "";

  return (
    <section className={outer}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={`w-full text-left px-4 py-3 hover:bg-slate-800/25 transition-colors ${headerBorder}`}
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div>{title}</div>
            <div className="text-[11px] text-slate-500 mt-1 leading-snug">{subtitle}</div>
            {summary ? (
              <div className="text-[10px] text-slate-500/85 mt-1.5 leading-snug">{summary}</div>
            ) : null}
          </div>
          <span className="text-slate-500 text-xs shrink-0 mt-0.5 tabular-nums" aria-hidden>
            {expanded ? "▼" : "▶"}
          </span>
        </div>
      </button>
      {expanded ? <div>{children}</div> : null}
    </section>
  );
}

function OpexLineNudgePillsRow({ signals }: { signals: OpexLineNudgeSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1 pl-0">
      {signals.map((s) => (
        <span
          key={s.type}
          title={s.tooltip}
          className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] leading-tight cursor-default ${
            s.severity === "warning"
              ? "border-amber-800/45 bg-amber-950/25 text-amber-100/90"
              : "border-slate-600/50 bg-slate-800/40 text-slate-300"
          }`}
        >
          <span aria-hidden className="shrink-0">
            {s.type === "high_impact" ? "⭐" : "⚠️"}
          </span>
          <span>{s.label}</span>
        </span>
      ))}
    </div>
  );
}

function OpExRouteLegend() {
  return (
    <details className="text-[11px] text-slate-400 group">
      <summary className="cursor-pointer text-slate-300 hover:text-slate-200 list-none flex items-center gap-1 font-medium">
        <span className="text-slate-500 group-open:rotate-90 transition-transform inline-block">▸</span>
        Classification options
      </summary>
      <ul className="mt-2 ml-3 space-y-1.5 text-slate-400 border-l border-slate-600/80 pl-3 leading-snug">
        {(Object.keys(ROUTE_LABELS) as OpExRouteStatusV1[]).map((k) => (
          <li key={k}>
            <span className="text-slate-200 font-medium">{ROUTE_LABELS[k]}</span>
            <span className="text-slate-500"> — {ROUTE_HELP[k]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function OpExRouteMetaStrip(props: {
  cfg: OpExForecastLineConfigV1 | undefined;
  /** Collapsed direct-card header strip */
  mode?: "compact" | "schedule";
}) {
  const { cfg, mode = "schedule" } = props;
  if (!cfg) return null;
  const src = opexRouteSourceLabel(cfg.routeResolvedBy);
  const pct = opexEffectiveConfidencePct(cfg);
  const reason = opexPrimaryRouteReason(cfg);
  const srcClass =
    cfg.routeResolvedBy === "user"
      ? "border-sky-800/50 text-sky-200/90"
      : cfg.routeResolvedBy === "ai"
        ? "border-violet-800/45 text-violet-200/85"
        : "border-slate-600 text-slate-300";
  const pctCls = pct != null ? opexConfidenceBadgeClass(pct) : "text-slate-500 border-slate-700 bg-slate-900/50";

  if (mode === "compact") {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] mt-0.5">
        <span className="text-slate-600">Handled as:</span>
        <span className="text-slate-400 truncate max-w-[10rem]" title={ROUTE_HELP[cfg.routeStatus]}>
          {ROUTE_LABELS[cfg.routeStatus]}
        </span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-600">Source:</span>
        <span className={`rounded px-1.5 py-0.5 border ${srcClass}`}>{src}</span>
        {pct != null ? (
          <span className={`rounded px-1.5 py-0.5 border tabular-nums ${pctCls}`}>
            {cfg.routeResolvedBy === "user" ? formatOpexClassifierReferencePct(pct) : formatOpexConfidencePct(pct)}
          </span>
        ) : null}
        {reason ? (
          <span className="text-slate-500 truncate max-w-[min(100%,18rem)]" title={reason}>
            {reason}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-slate-300" title={ROUTE_HELP[cfg.routeStatus]}>
        {ROUTE_LABELS[cfg.routeStatus]}
      </div>
      {reason ? <div className="text-[11px] text-slate-400 leading-snug">{reason}</div> : null}
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <span className="text-slate-500 shrink-0">Source</span>
        <span className={`rounded px-1.5 py-0.5 border ${srcClass}`}>{src}</span>
        {pct != null ? (
          <span className={`rounded px-1.5 py-0.5 border tabular-nums ${pctCls}`}>
            {cfg.routeResolvedBy === "user" ? formatOpexClassifierReferencePct(pct) : formatOpexConfidencePct(pct)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function OpExPhase1LineCard(props: {
  line: IngestedOpExLineV1;
  cfg: OpExForecastLineConfigV1 | undefined;
  projectionYears: string[];
  lastHistValue: number | null;
  totalDirectSectionHistAbs: number;
  directLineCount: number;
  setOpexForecastLineV1: (lineId: string, patch: Partial<OpExForecastLineConfigV1>) => void;
}) {
  const { line, cfg, projectionYears, lastHistValue, totalDirectSectionHistAbs, directLineCount, setOpexForecastLineV1 } =
    props;
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

  const appliedDirectFingerprint = useMemo(
    () =>
      buildOpexDirectAppliedFingerprint(
        cfg?.forecastMethod,
        cfg?.forecastParameters as Record<string, unknown> | undefined,
        projectionYears
      ),
    [cfg?.forecastMethod, cfg?.forecastParameters, projectionYears]
  );

  const buildDraftKey = useMemo(() => {
    if (localMethod === "pct_of_revenue") {
      return JSON.stringify({
        localMethod,
        pctShape,
        pctStr,
        pctYearStrs,
        pctPhaseNorm: normalizeOpexPhaseRowsForFingerprint(pctPhaseRows),
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
        growthPhaseNorm: normalizeOpexPhaseRowsForFingerprint(growthPhaseRows),
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

  const hasUnsaved = buildDraftKey !== appliedDirectFingerprint;
  const hasSaved = hasPersistedOpExDirectForecast(cfg, projectionYears);

  const lineNudges = useMemo(
    () =>
      getOpexDirectLineNudges({
        cfg,
        localMethod,
        projectionYears,
        lineLastHist: lastHistValue,
        totalDirectSectionHistAbs: totalDirectSectionHistAbs,
        directLineCount,
      }),
    [cfg, localMethod, projectionYears, lastHistValue, totalDirectSectionHistAbs, directLineCount]
  );

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

  const resetDraftToEmptyForLocalMethod = () => {
    if (localMethod === "pct_of_revenue") {
      setPctShape("constant");
      setPctStr("");
      setPctYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
      setPctPhaseRows(
        projectionYears.length > 0
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
    } else if (localMethod === "growth_percent") {
      setGrowthShape("constant");
      setGrowthRateStr("");
      setStartingBasis("last_historical");
      setStartingAmtStr("");
      setGrowthYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
      setGrowthPhaseRows(
        projectionYears.length > 0
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
    } else if (localMethod === "flat_value") {
      setFlatStr("");
    } else if (localMethod === "manual_by_year") {
      setManualYearStrs(Object.fromEntries(projectionYears.map((y) => [y, ""])));
    }
  };

  /** Restore last applied forecast inputs, or clear drafts for the current method if nothing applied yet. Never changes classification. */
  const resetDraft = () => {
    const pm = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;
    const m = cfg?.forecastMethod;
    if (m) {
      setLocalMethod(m);
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
      return;
    }
    resetDraftToEmptyForLocalMethod();
  };

  const projectionYearsKey = projectionYears.join("|");
  useEffect(() => {
    resetDraft();
    // Sync local inputs when applied line config changes (Apply, external load, merge) — not global page save.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetDraft closes over latest cfg; deps are fingerprint + line
  }, [appliedDirectFingerprint, line.lineId, projectionYearsKey]);

  const apply = () => {
    if (!applyPayload?.valid) return;
    setOpexForecastLineV1(line.lineId, {
      forecastMethod: applyPayload.forecastMethod,
      forecastParameters: applyPayload.forecastParameters as OpExForecastLineConfigV1["forecastParameters"],
    });
  };

  if (cfg?.routeStatus !== "forecast_direct") return null;

  const effectiveRoute = cfg.routeStatus;
  const rb = cfg.routeResolvedBy ?? "deterministic";
  const effectiveSource = rb === "user" ? "user" : rb === "ai" ? "ai" : "rule";
  const collapsedRoutePillLabel = formatOpexCollapsedDirectRoutePillLabel(effectiveRoute);
  const collapsedRoutePillClassName = getOpexCollapsedDirectRoutePillClassName(effectiveSource);
  const collapsedRoutingSummary = formatOpexCollapsedDirectRoutingProvenanceSummary(cfg);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setCardExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-800/40"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-100 truncate">{line.label}</div>
          <OpexLineNudgePillsRow signals={lineNudges} />
          <div className="text-[10px] text-slate-500 truncate">
            {line.parentLabel ? `Under: ${line.parentLabel}` : null}
            {lastHistValue != null && Number.isFinite(lastHistValue) ? (
              <span className="ml-2">· Last actual: {fmtDisplay(lastHistValue)}</span>
            ) : null}
          </div>
          {!cardExpanded ? (
            <div className="mt-1 min-w-0">
              <div className="mb-1">
                <span
                  className={[
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
                    collapsedRoutePillClassName,
                  ].join(" ")}
                  title={collapsedRoutePillLabel}
                >
                  {collapsedRoutePillLabel}
                </span>
              </div>

              {collapsedRoutingSummary ? (
                <p className="truncate text-xs text-muted-foreground" title={collapsedRoutingSummary}>
                  {collapsedRoutingSummary}
                </p>
              ) : null}
            </div>
          ) : (
            <OpExRouteMetaStrip cfg={cfg} mode="compact" />
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[10px] font-normal uppercase opacity-80 ${
              hasUnsaved ? "text-amber-400/90" : hasSaved ? "text-emerald-400/85" : "text-slate-500"
            }`}
          >
            {hasUnsaved ? "Unsaved" : hasSaved ? "Applied" : "Not started"}
          </span>
          <span className="text-slate-500 text-xs">{cardExpanded ? "▼" : "▶"}</span>
        </div>
      </button>
      {cardExpanded ? (
        <div className="border-t border-slate-800 px-3 py-3 space-y-3 text-xs">
          <div className="rounded border border-slate-700/90 bg-slate-900/35 px-2.5 py-2 space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">How this line is handled</div>
            <OpExRouteMetaStrip cfg={cfg} mode="schedule" />
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`opex-route-${line.lineId}`} className="text-[10px] text-slate-500 shrink-0">
                Change classification
              </label>
              <select
                id={`opex-route-${line.lineId}`}
                className="flex-1 min-w-[12rem] rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1"
                value={cfg?.routeStatus ?? "forecast_direct"}
                title={ROUTE_HELP[cfg?.routeStatus ?? "forecast_direct"]}
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
                  <option key={k} value={k} title={ROUTE_HELP[k]}>
                    {ROUTE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-slate-600 leading-snug">
              Changing classification moves this line between sections. Applied forecast inputs stay on the line if you
              switch away and return to Forecast here.
            </p>
          </div>

          {(() => {
            const routeReason = opexPrimaryRouteReason(cfg);
            const aiNarrative = (cfg?.aiUserFacingSummary ?? cfg?.aiExplanation ?? "").trim();
            const duplicateNarrative =
              aiNarrative.length > 0 && routeReason != null && aiNarrative === routeReason.trim();
            const showNarrative = !duplicateNarrative && aiNarrative.length > 0;
            const showSuggested = Boolean(cfg?.aiSuggestedMethod && cfg.routeResolvedBy === "ai");
            const showSignals = (cfg?.aiDetectedSignals?.length ?? 0) > 0;
            if (!showNarrative && !showSuggested && !showSignals) return null;
            return (
              <div className="rounded border border-slate-700/80 bg-slate-900/50 px-2 py-2 text-[11px] text-slate-400 space-y-1">
                {showNarrative ? (
                  <div>
                    <span className="text-slate-500">AI suggestion: </span>
                    {aiNarrative}
                  </div>
                ) : null}
                {showSuggested ? (
                  <div className="text-slate-500">
                    Suggested method: {cfg!.aiSuggestedMethod!.replace(/_/g, " ")}
                    {cfg!.aiConfidencePct != null
                      ? ` (${formatOpexConfidencePct(cfg.aiConfidencePct)})`
                      : cfg!.aiConfidence
                        ? ` (${cfg.aiConfidence})`
                        : null}
                  </div>
                ) : null}
                {showSignals ? (
                  <div className="text-[10px] text-slate-500">
                    Signals: {cfg!.aiDetectedSignals!.join(", ")}
                  </div>
                ) : null}
              </div>
            );
          })()}

          <div>
            <label className="block text-[10px] uppercase text-slate-500 mb-1">Forecast method</label>
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
                <option value="constant">Percentage</option>
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
                <option value="constant">Percentage</option>
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
              disabled={projectionYears.length === 0}
              onClick={resetDraft}
              title={
                cfg?.forecastMethod
                  ? "Discard local edits and restore the last applied forecast for this line (classification unchanged)."
                  : "Clear draft inputs for the selected method (nothing applied yet)."
              }
              className="rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-40 text-xs px-3 py-1.5"
            >
              Reset changes
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Collapsed route pill text (short labels for non–Forecast here states). */
function opexNonDirectCollapsedPillLabel(status: OpExRouteStatusV1): string {
  if (status === "derive_schedule") return "Handled in schedules";
  if (status === "review_required") return "Needs review";
  if (status === "excluded_nonrecurring") return "Excluded";
  return ROUTE_LABELS[status];
}

function OpExSourceConfidenceRow({ cfg }: { cfg: OpExForecastLineConfigV1 | undefined }) {
  if (!cfg) return null;
  const src = opexRouteSourceLabel(cfg.routeResolvedBy);
  const pct = opexEffectiveConfidencePct(cfg);
  const srcClass =
    cfg.routeResolvedBy === "user"
      ? "border-sky-800/50 text-sky-200/90"
      : cfg.routeResolvedBy === "ai"
        ? "border-violet-800/45 text-violet-200/85"
        : "border-slate-600 text-slate-300";
  const pctCls = pct != null ? opexConfidenceBadgeClass(pct) : "text-slate-500 border-slate-700 bg-slate-900/50";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px]">
      <span className="text-slate-500 shrink-0">Source</span>
      <span className={`rounded px-1.5 py-0.5 border ${srcClass}`}>{src}</span>
      {pct != null ? (
        <span className={`rounded px-1.5 py-0.5 border tabular-nums ${pctCls}`}>
          {cfg.routeResolvedBy === "user" ? formatOpexClassifierReferencePct(pct) : formatOpexConfidencePct(pct)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Schedules / needs review / excluded lines: same collapsible pattern as direct forecast cards (local expand state only).
 */
function OpExCollapsibleRoutedLineCard(props: {
  line: IngestedOpExLineV1;
  cfg: OpExForecastLineConfigV1 | undefined;
  lastHistValue: number | null;
  setOpexForecastLineV1: (lineId: string, patch: Partial<OpExForecastLineConfigV1>) => void;
}) {
  const { line, cfg, lastHistValue, setOpexForecastLineV1 } = props;
  const [cardExpanded, setCardExpanded] = useState(false);
  const status = cfg?.routeStatus ?? "forecast_direct";
  const rb = cfg?.routeResolvedBy ?? "deterministic";
  const effectiveSource = rb === "user" ? "user" : rb === "ai" ? "ai" : "rule";
  const pillLabel = opexNonDirectCollapsedPillLabel(status);
  const pillClassName = getOpexCollapsedDirectRoutePillClassName(effectiveSource);
  const provenanceSummary = formatOpexCollapsedDirectRoutingProvenanceSummary(cfg);
  const primaryReason = opexPrimaryRouteReason(cfg);
  const explanationLine = primaryReason.trim().length > 0 ? primaryReason : ROUTE_HELP[status];

  const contextBits: string[] = [];
  if (line.parentLabel) contextBits.push(`Under: ${line.parentLabel}`);
  if (lastHistValue != null && Number.isFinite(lastHistValue)) {
    contextBits.push(`Last actual: ${fmtDisplay(lastHistValue)}`);
  }
  const contextLine = contextBits.join(" · ");

  const footerNote =
    status === "derive_schedule"
      ? "These amounts are not in your Phase 1 OpEx total. If you switch back to Forecast here, any applied direct inputs on this line stay available."
      : "Applied direct forecast inputs stay on the line if you move it to Forecast here later.";

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setCardExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-800/40"
        aria-expanded={cardExpanded}
        aria-label={cardExpanded ? "Collapse line" : "Expand line"}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-100 truncate">{line.label}</div>
          {contextLine ? (
            <div className="text-[10px] text-slate-500 truncate" title={contextLine}>
              {contextLine}
            </div>
          ) : null}
          {!cardExpanded ? (
            <div className="mt-1 min-w-0">
              <div className="mb-1">
                <span
                  className={[
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
                    pillClassName,
                  ].join(" ")}
                  title={ROUTE_HELP[status]}
                >
                  {pillLabel}
                </span>
              </div>
              {provenanceSummary ? (
                <p className="truncate text-xs text-muted-foreground" title={provenanceSummary}>
                  {provenanceSummary}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-1 min-w-0 flex flex-col gap-0.5">
              <span
                className={[
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 w-fit",
                  pillClassName,
                ].join(" ")}
                title={ROUTE_HELP[status]}
              >
                {pillLabel}
              </span>
              {provenanceSummary ? (
                <p className="truncate text-[10px] text-slate-500" title={provenanceSummary}>
                  {provenanceSummary}
                </p>
              ) : null}
            </div>
          )}
        </div>
        <span className="text-slate-500 text-xs shrink-0">{cardExpanded ? "▼" : "▶"}</span>
      </button>
      {cardExpanded ? (
        <div className="border-t border-slate-800 px-3 py-3 space-y-3 text-xs">
          <div className="text-sm font-medium text-slate-100">{line.label}</div>
          <p className="text-[11px] text-slate-400 leading-snug">{explanationLine}</p>
          <OpExSourceConfidenceRow cfg={cfg} />
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`opex-routed-route-${line.lineId}`} className="text-[10px] text-slate-500 shrink-0">
              Change classification
            </label>
            <select
              id={`opex-routed-route-${line.lineId}`}
              className="flex-1 min-w-[12rem] rounded border border-slate-600 bg-slate-900 text-xs text-slate-100 px-2 py-1.5"
              value={status}
              title={ROUTE_HELP[status]}
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
                <option key={k} value={k} title={ROUTE_HELP[k]}>
                  {ROUTE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[10px] text-slate-600 leading-snug">{footerNote}</p>
        </div>
      ) : null}
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

  const ingestedAll = useMemo(() => collectOperatingExpenseLeafLines(incomeStatement), [incomeStatement]);
  const ingestedVisible = useMemo(
    () => ingestedAll.filter((r) => !isOpexLineLabelHiddenOnCogsOpexTab(r.label)),
    [ingestedAll]
  );
  /** Full ingest for merge (config preserved for lines hidden on this tab). */
  const ingestMergeKey = useMemo(
    () => ingestedAll.map((x) => `${x.lineId}:${x.label}:${x.parentLabel}`).join("|"),
    [ingestedAll]
  );
  const opexLinesJson = useMemo(() => JSON.stringify(opexCfg?.lines ?? {}), [opexCfg]);

  useEffect(() => {
    const merged = buildOpExForecastConfigMerged(ingestedAll, opexCfg);
    const next = JSON.stringify(merged.lines);
    if (opexLinesJson !== next) {
      setOpexForecastConfigV1(merged);
    }
    // ingestMergeKey + opexLinesJson subsume ingested / opexCfg.lines identity for merge idempotency
  }, [ingestMergeKey, opexLinesJson, setOpexForecastConfigV1, ingestedAll, opexCfg]);

  const opexLinesFingerprint = useMemo(() => getOpExForecastConfigFingerprint(opexCfg), [opexCfg]);

  const linesByRoute = useMemo(() => {
    const direct: IngestedOpExLineV1[] = [];
    const schedule: IngestedOpExLineV1[] = [];
    const needsReview: IngestedOpExLineV1[] = [];
    const excluded: IngestedOpExLineV1[] = [];
    for (const row of ingestedVisible) {
      const st = opexCfg?.lines?.[row.lineId]?.routeStatus ?? "forecast_direct";
      if (st === "forecast_direct") direct.push(row);
      else if (st === "derive_schedule") schedule.push(row);
      else if (st === "excluded_nonrecurring") excluded.push(row);
      else needsReview.push(row);
    }
    return { direct, schedule, needsReview, excluded };
  }, [ingestedVisible, opexLinesFingerprint]);

  const lastHistByLine = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const row of ingestedVisible) {
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
  }, [ingestedVisible, incomeStatement, lastHistoricYear, allStatements, sbcBreakdowns, danaBreakdowns]);

  const directSectionHistTotalAbs = useMemo(
    () => sumAbsHistoricalForLineIds(
      linesByRoute.direct.map((r) => r.lineId),
      lastHistByLine
    ),
    [linesByRoute.direct, lastHistByLine]
  );

  const forecastOpExSectionSummary = useMemo(
    () =>
      getForecastOpExSectionSummary({
        directLines: linesByRoute.direct,
        lineConfig: (id) => opexCfg?.lines?.[id],
        lastHistByLineId: lastHistByLine,
        projectionYears,
      }),
    [linesByRoute.direct, lastHistByLine, projectionYears, opexLinesFingerprint, opexCfg]
  );

  const forecastOpExHeaderSummary = useMemo(
    () => buildForecastOpExHeaderSummary(linesByRoute.direct.length, forecastOpExSectionSummary),
    [linesByRoute.direct.length, forecastOpExSectionSummary]
  );

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRoutingNotice, setAiRoutingNotice] = useState<string | null>(null);

  const runAiRouting = async () => {
    setAiError(null);
    setAiRoutingNotice(null);
    setAiLoading(true);
    try {
      const items = ingestedVisible.map((row) => {
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
          normalizedCategory?: string;
          suggestedRoute: OpExRouteStatusV1;
          suggestedMethod: string | null;
          confidencePct?: number;
          confidence?: string;
          explanation: string;
          userFacingSummary: string;
          flags?: string[];
          detectedSignals?: string[];
          ambiguityFlags?: string[];
          likelyRecurring?: boolean | null;
          likelyScheduleDerived?: boolean | null;
          likelyNonRecurring?: boolean | null;
          reviewRecommended?: boolean;
        }>;
        error?: string;
      };
      if (!res.ok) {
        setAiError(data.error ?? "AI request failed");
        return;
      }
      const sugs = data.suggestions ?? [];
      if (sugs.length > 0) {
        setAiRoutingNotice(
          "Suggestions applied. Review each line below before forecasting. Lines you set manually are not changed when you run AI again."
        );
      }
      for (const s of sugs) {
        const line = ingestedVisible.find((x) => x.lineId === s.lineId);
        if (!line) continue;
        const cur = opexCfg?.lines?.[s.lineId];
        if (cur?.routeResolvedBy === "user") continue;
        const flags = s.flags ?? [];
        const amb = s.ambiguityFlags ?? [];
        const mergedFlags = [...new Set([...flags, ...amb])].slice(0, 12);
        const confPct =
          typeof s.confidencePct === "number" && Number.isFinite(s.confidencePct)
            ? Math.max(0, Math.min(100, Math.round(s.confidencePct)))
            : undefined;
        const confBucket =
          s.confidence === "high" || s.confidence === "medium" || s.confidence === "low"
            ? s.confidence
            : confPct != null
              ? confPct >= 80
                ? "high"
                : confPct >= 55
                  ? "medium"
                  : "low"
              : "medium";
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
          aiConfidence: confBucket,
          aiConfidencePct: confPct,
          aiNormalizedCategory: s.normalizedCategory,
          aiExplanation: s.explanation,
          aiUserFacingSummary: s.userFacingSummary,
          aiFlags: mergedFlags.length ? mergedFlags : undefined,
          aiDetectedSignals: s.detectedSignals,
          aiAmbiguityFlags: amb.length ? amb : undefined,
          aiLikelyRecurring: s.likelyRecurring ?? null,
          aiLikelyScheduleDerived: s.likelyScheduleDerived ?? null,
          aiLikelyNonRecurring: s.likelyNonRecurring ?? null,
          aiReviewRecommended: s.reviewRecommended,
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
      <p className="text-xs text-slate-500">
        Some financing-related lines are handled in later steps.
      </p>

      <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-3 space-y-2">
        <h3 className="text-sm font-semibold text-emerald-100">Operating expenses (Phase 1)</h3>
        <p className="text-xs text-slate-400">
          Forecast recurring operating expenses here. Items handled in schedules or requiring review are separated below.
        </p>
        <div>
          <button
            type="button"
            disabled={aiLoading || ingestedVisible.length === 0}
            onClick={() => void runAiRouting()}
            className="rounded bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs px-3 py-1.5"
          >
            {aiLoading ? "Running AI…" : "Run AI suggestions"}
          </button>
          <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed max-w-prose">
            AI suggests how to classify lines. Your choices are always preserved.
          </p>
        </div>
        {aiRoutingNotice ? <div className="text-[10px] text-emerald-300/90 leading-snug">{aiRoutingNotice}</div> : null}
        {aiError ? <div className="text-xs text-red-400">{aiError}</div> : null}
      </div>

      <div className="rounded-lg border border-slate-700/60 bg-slate-950/35 px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">How this works</div>
        <ol className="text-[11px] text-slate-400 list-decimal pl-4 space-y-1 marker:text-slate-500">
          <li>
            <span className="text-slate-300">Run AI suggestions</span> (optional)
          </li>
          <li>Review how each line is classified</li>
          <li>Adjust any line if needed</li>
          <li>
            Forecast only the lines shown under <span className="text-slate-300">Forecast operating expenses</span>
          </li>
        </ol>
        <div className="mt-2 pt-2 border-t border-slate-800/80">
          <OpExRouteLegend />
        </div>
      </div>

      <OpExSectionAccordion
        defaultExpanded
        variant="default"
        title={<span className="text-sm font-semibold text-slate-100">Forecast operating expenses</span>}
        subtitle="Only lines forecasted here appear below."
        summary={forecastOpExHeaderSummary}
      >
        {forecastOpExSectionSummary.parts.length > 0 ? (
          <div className="px-4 pt-3">
            <p className="text-[11px] text-amber-200/85 leading-snug border border-amber-900/35 bg-amber-950/15 rounded px-2 py-1.5">
              {forecastOpExSectionSummary.parts.join(" · ")}
            </p>
          </div>
        ) : null}
        {linesByRoute.direct.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-500">No lines to forecast here yet.</div>
        ) : (
          <div className="p-3 space-y-3 bg-slate-950/25">
            {linesByRoute.direct.map((row) => (
              <OpExPhase1LineCard
                key={row.lineId}
                line={row}
                cfg={opexCfg?.lines?.[row.lineId]}
                projectionYears={projectionYears}
                lastHistValue={lastHistByLine[row.lineId] ?? null}
                totalDirectSectionHistAbs={directSectionHistTotalAbs}
                directLineCount={linesByRoute.direct.length}
                setOpexForecastLineV1={setOpexForecastLineV1}
              />
            ))}
          </div>
        )}
      </OpExSectionAccordion>

      <OpExSectionAccordion
        defaultExpanded={linesByRoute.schedule.length > 0}
        variant="default"
        title={<span className="text-sm font-semibold text-slate-100">Handled in schedules (Phase 2)</span>}
        subtitle="These lines will be modeled later and are not forecasted here."
        summary={
          linesByRoute.schedule.length === 0
            ? "No lines"
            : `${linesByRoute.schedule.length} line${linesByRoute.schedule.length === 1 ? "" : "s"}`
        }
      >
        {linesByRoute.schedule.length === 0 ? (
          <div className="px-4 py-4 text-xs text-slate-500">No lines in this section yet.</div>
        ) : (
          <div className="p-3 space-y-3 bg-slate-950/25">
            {linesByRoute.schedule.map((row) => (
              <OpExCollapsibleRoutedLineCard
                key={row.lineId}
                line={row}
                cfg={opexCfg?.lines?.[row.lineId]}
                lastHistValue={lastHistByLine[row.lineId] ?? null}
                setOpexForecastLineV1={setOpexForecastLineV1}
              />
            ))}
          </div>
        )}
      </OpExSectionAccordion>

      <OpExSectionAccordion
        defaultExpanded={linesByRoute.needsReview.length > 0}
        variant="needs_review"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-amber-100/95">Needs review</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-amber-400/80">Action</span>
          </span>
        }
        subtitle={
          linesByRoute.needsReview.length > 0
            ? "These lines need your confirmation before forecasting."
            : "When every line is classified, nothing appears here."
        }
        summary={
          linesByRoute.needsReview.length > 0
            ? `${linesByRoute.needsReview.length} item${linesByRoute.needsReview.length === 1 ? "" : "s"} need review`
            : "All lines reviewed ✓"
        }
      >
        {linesByRoute.needsReview.length === 0 ? (
          <div className="px-4 py-2" aria-hidden />
        ) : (
          <div className="p-3 space-y-3 bg-slate-950/25">
            {linesByRoute.needsReview.map((row) => (
              <OpExCollapsibleRoutedLineCard
                key={row.lineId}
                line={row}
                cfg={opexCfg?.lines?.[row.lineId]}
                lastHistValue={lastHistByLine[row.lineId] ?? null}
                setOpexForecastLineV1={setOpexForecastLineV1}
              />
            ))}
          </div>
        )}
      </OpExSectionAccordion>

      <OpExSectionAccordion
        defaultExpanded={false}
        variant="excluded"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">Excluded</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Resolved</span>
          </span>
        }
        subtitle="These lines are not included in the recurring forecast."
        summary={
          linesByRoute.excluded.length === 0
            ? "No lines"
            : `${linesByRoute.excluded.length} line${linesByRoute.excluded.length === 1 ? "" : "s"}`
        }
      >
        {linesByRoute.excluded.length === 0 ? (
          <div className="px-4 py-4 text-xs text-slate-500">No excluded lines.</div>
        ) : (
          <div className="p-3 space-y-3 bg-slate-950/25">
            {linesByRoute.excluded.map((row) => (
              <OpExCollapsibleRoutedLineCard
                key={row.lineId}
                line={row}
                cfg={opexCfg?.lines?.[row.lineId]}
                lastHistValue={lastHistByLine[row.lineId] ?? null}
                setOpexForecastLineV1={setOpexForecastLineV1}
              />
            ))}
          </div>
        )}
      </OpExSectionAccordion>

      <section className="rounded-lg border border-slate-700 bg-slate-900/40">
        <div className="border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">Historical operating expense context</h3>
        </div>
        {ingestedVisible.length === 0 ? (
          <div className="px-4 py-4 text-xs text-slate-500">No operating expense lines under the P&amp;L OpEx section.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {ingestedVisible.map((row) => {
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
