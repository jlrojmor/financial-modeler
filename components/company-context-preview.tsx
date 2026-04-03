/**
 * Company Context — Intelligence panel (read-only).
 *
 * Information architecture (each block maps store → meaning → visual):
 *
 * LAYER 1 HEADER
 * - Reads: user_inputs.*, market_data.reportingCurrency, generatedAt, isContextStale, confidence.overall
 * - Meaning: which entity is loaded, whether outputs match current inputs, aggregate quality gate
 * - Visual: headline + descriptor row + status pills (scan identity in one pass)
 *
 * LAYER 2 HERO — LEFT “Positioning”
 * - Reads: ai_context.companyOverview, ai_context.businessModelSummary (+ user_overrides ai_context.*),
 *   user_inputs.primaryBusinessType | revenueModel | customerType
 * - Meaning: what the company is and how it earns (narrative + user classification)
 * - Visual: single lead line + 2 short bullets + few chips (density control, not a wall of text)
 *
 * LAYER 2 HERO — RIGHT “Watchouts”
 * - Reads: modeling_implications.valuationWatchouts | marginStructure | capexBehavior; confidence.overall (spectrum only)
 * - Meaning: generated modeling caveats; spectrum shows inference/evidence strength — NOT operational “business risk”
 * - Visual: confidence spectrum + bullet list, balanced weight with left column
 *
 * LAYER 3 QUANT — KPI strip
 * - Reads: user_overrides.beta, wacc_context.*, market_data.beta
 * - Meaning: headline WACC / COE reference inputs
 * - Visual: 5-tile strip, β emphasized
 *
 * LAYER 3 — Peer-derived bars
 * - Reads: compDerivedMetrics ranges + medians (+ range mid where no median)
 * - Meaning: dispersion implied by accepted peer set
 * - Visual: horizontal span + optional midpoint tick (distribution, not a verdict)
 *
 * LAYER 3 — Comps + benchmarks
 * - Reads: suggested_comps (accepted), industry_benchmarks
 * - Meaning: who anchors peers; what “normal” ranges are for the nameplate industry family
 * - Visual: dense list + aligned value column (read-only executive summary)
 */
"use client";

import type { ReactNode } from "react";
import { useModelStore } from "@/store/useModelStore";
import type {
  CompRole,
  CompanyContextAiContext,
  ConfidenceLevel,
  IndustryBenchmarks,
  ModelingImplications,
  PrimaryBusinessType,
  RevenueModel,
  CustomerType,
} from "@/types/company-context";

/* ---------- label maps (display only) ---------- */

const COMP_ROLE_LABEL: Record<CompRole, string> = {
  operating_comp: "OPERATING",
  valuation_comp: "VALUATION",
  beta_comp: "BETA",
};

const PRIMARY_BUSINESS_LABEL: Record<PrimaryBusinessType, string> = {
  manufacturer: "Manufacturer",
  distributor_wholesaler: "Distributor / wholesaler",
  retailer: "Retailer",
  software_saas: "Software / SaaS",
  marketplace_platform: "Marketplace / platform",
  services: "Services",
  financial_services: "Financial services",
  healthcare_pharma: "Healthcare / pharma",
  infrastructure_industrial: "Infrastructure / industrial",
  other: "Other",
};

const REVENUE_MODEL_LABEL: Record<RevenueModel, string> = {
  product_sales: "Product sales",
  services: "Services",
  subscription: "Subscription",
  commission_marketplace: "Commission / marketplace",
  mixed: "Mixed",
};

const CUSTOMER_LABEL: Record<CustomerType, string> = {
  b2b: "B2B",
  b2c: "B2C",
  both: "B2B & B2C",
};

const BENCHMARK_ROWS: { minKey: keyof IndustryBenchmarks; maxKey: keyof IndustryBenchmarks; label: string; suffix?: string }[] = [
  { minKey: "revenueGrowthMin", maxKey: "revenueGrowthMax", label: "Revenue growth", suffix: "%" },
  { minKey: "grossMarginMin", maxKey: "grossMarginMax", label: "Gross margin", suffix: "%" },
  { minKey: "ebitdaMarginMin", maxKey: "ebitdaMarginMax", label: "EBITDA margin", suffix: "%" },
  { minKey: "ebitMarginMin", maxKey: "ebitMarginMax", label: "EBIT margin", suffix: "%" },
  { minKey: "capexPctRevenueMin", maxKey: "capexPctRevenueMax", label: "Capex / revenue", suffix: "%" },
  { minKey: "leverageNetDebtEbitdaMin", maxKey: "leverageNetDebtEbitdaMax", label: "Net debt / EBITDA", suffix: "x" },
];

const WC_LABELS: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

const LAYER4_KEYS: { key: keyof ModelingImplications; label: string }[] = [
  { key: "keyForecastDrivers", label: "Forecast drivers" },
  { key: "wcDrivers", label: "Working capital" },
  { key: "capexBehavior", label: "Capex behavior" },
  { key: "marginStructure", label: "Margin structure" },
];

/* ---------- formatting ---------- */

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatRange(min: number | undefined, max: number | undefined, suffix = ""): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `${min}–${max}${suffix}`;
  if (min != null) return `${min}${suffix}+`;
  return `≤${max}${suffix}`;
}

/** Split stored prose into scannable bullets (real text only). */
function toBulletLines(raw: string, max: number): string[] {
  const t = raw.trim();
  if (!t) return [];
  const byNewline = t
    .split(/\n+/)
    .map((s) => s.replace(/^[•\-\d.)]+\s*/, "").trim())
    .filter(Boolean);
  if (byNewline.length >= 2) return byNewline.slice(0, max);
  const bySentence = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return bySentence.slice(0, max);
}

/** One strong lead: first sentence or first line, capped (overview / thesis). */
function leadStatement(raw: string, maxLen = 132): string {
  const t = raw.trim();
  if (!t) return "";
  const line = t.split(/\n/)[0]?.trim() ?? t;
  const end = line.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? line.slice(0, end + 1) : line;
  if (sentence.length <= maxLen) return sentence;
  const cut = sentence.slice(0, maxLen - 1).trimEnd();
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + "…";
}

/**
 * Map confidence.overall to horizontal position on the spectrum.
 * Left = stronger aggregate context confidence (more trust in generated inference).
 * Right = weaker — not “safer company”, weaker evidence chain for this run.
 */
function contextConfidenceMarkerPercent(overall: ConfidenceLevel | undefined): number {
  if (overall === "high") return 14;
  if (overall === "medium") return 50;
  if (overall === "low") return 86;
  return 50;
}

/** Midpoint on [min,max] for marker; returns null if invalid. */
function midpointPercent(min: number, max: number, mid: number | undefined): number | null {
  if (mid == null || max <= min) return null;
  const p = ((mid - min) / (max - min)) * 100;
  if (p < 0 || p > 100 || Number.isNaN(p)) return null;
  return p;
}

function midOfRange(min: number | undefined, max: number | undefined): number | undefined {
  if (min == null || max == null) return undefined;
  return (min + max) / 2;
}

/* ---------- inline visual primitives ---------- */

function StatusPill({ children, variant }: { children: ReactNode; variant: "neutral" | "ok" | "warn" | "info" }) {
  const v = {
    neutral: "bg-slate-800/90 text-slate-200 ring-slate-600/40",
    ok: "bg-emerald-950/70 text-emerald-200 ring-emerald-800/35",
    warn: "bg-amber-950/50 text-amber-200 ring-amber-800/40",
    info: "bg-slate-800/80 text-slate-300 ring-slate-600/35",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${v[variant]}`}>{children}</span>;
}

/**
 * Peer-derived range bar: reads numeric min/max/mid from compDerivedMetrics.
 * Meaning: spread across accepted comps; dot = median (or range midpoint when no median).
 * Visual: span shows width of peer-implied band; dot encodes central tendency within that band.
 */
function PeerRangeBar({
  label,
  min,
  max,
  mid,
  suffix = "",
  display,
}: {
  label: string;
  min?: number;
  max?: number;
  mid?: number;
  suffix?: string;
  display: string;
}) {
  const hasSpan = min != null && max != null && max > min;
  const pct = hasSpan && mid != null ? midpointPercent(min!, max!, mid) : null;

  return (
    <div className="py-1.5 border-b border-slate-800/50 last:border-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <span className="text-[10px] font-medium tabular-nums text-slate-200">{display}</span>
      </div>
      {hasSpan ? (
        <div className="relative h-2 rounded-full bg-slate-800/90 overflow-visible">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-slate-600/40 to-emerald-800/45"
            style={{ width: "100%" }}
            aria-hidden
          />
          {pct != null && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-950 shadow-sm"
              style={{ left: `calc(${pct}% - 4px)` }}
              title={`Mid: ${mid}${suffix}`}
            />
          )}
        </div>
      ) : (
        <div className="h-0.5 rounded-full bg-slate-800/60" aria-hidden />
      )}
      {hasSpan && (
        <div className="flex justify-between mt-0.5 text-[9px] tabular-nums text-slate-600">
          <span>{min}{suffix}</span>
          <span>{max}{suffix}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Spectrum driven solely by confidence.overall — shows strength of *context inference*,
 * not corporate or market “risk”. Same gradient weight as before, honest labeling.
 */
function ContextConfidenceSpectrum({ level }: { level: ConfidenceLevel | undefined }) {
  const p = contextConfidenceMarkerPercent(level);
  return (
    <div className="mb-3 rounded-lg bg-slate-900/40 border border-slate-800/70 px-2.5 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Context confidence</p>
      <div className="flex justify-between text-[8px] uppercase tracking-wider text-slate-500 mb-1">
        <span>Stronger evidence</span>
        <span>Weaker evidence</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-gradient-to-r from-emerald-900/50 via-amber-800/40 to-rose-900/50 ring-1 ring-slate-700/50">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-slate-100 ring-2 ring-slate-950 shadow"
          style={{ left: `clamp(4px, ${p}%, calc(100% - 14px))` }}
          aria-label={`Aggregate context confidence: ${level ?? "unknown"}`}
        />
      </div>
      <p className="text-[9px] text-slate-600 mt-1.5 leading-snug">
        Marker reflects <span className="text-slate-500">confidence.overall</span> for this generation (peers, benchmarks, classification — not firm-level risk).
      </p>
    </div>
  );
}

export default function CompanyContextPreview() {
  const companyContext = useModelStore((s) => s.companyContext);
  const u = companyContext.user_inputs;
  const wacc = companyContext.wacc_context ?? {};
  const market = companyContext.market_data ?? {};
  const benchmarks = companyContext.industry_benchmarks ?? {};
  const implications = companyContext.modeling_implications ?? {};
  const ai = companyContext.ai_context ?? {};
  const overrides = companyContext.user_overrides ?? {};
  const comps = companyContext.suggested_comps ?? [];
  const acceptedComps = comps.filter((c) => c.status === "accepted");
  const hasGenerated = companyContext.generatedAt != null;
  const isStale = Boolean(companyContext.isContextStale);
  const confidence = companyContext.confidence;

  const betaDisplay = overrides["beta"] ?? wacc.betaEstimate ?? market.beta;
  const reportingCurrency = market.reportingCurrency ?? "USD";
  const riskFreeDisplay = wacc.riskFreeRateMarket ?? wacc.riskFreeReference ?? "";

  const overviewEff = (overrides["ai_context.companyOverview"] ?? ai.companyOverview ?? "") as string;
  const businessEff = (overrides["ai_context.businessModelSummary"] ?? ai.businessModelSummary ?? "") as string;
  const notesEff = (overrides["ai_context.aiModelingNotes"] ?? ai.aiModelingNotes ?? "") as string;

  const positioningLead = leadStatement(overviewEff);
  const thesisBullets = toBulletLines(businessEff, 2);

  /* Right hero: modeling_implications — valuation, margin, capex caveats (text is model guidance, not a risk score). */
  const watchoutSources = [
    (implications.valuationWatchouts as string) ?? "",
    (implications.marginStructure as string) ?? "",
    (implications.capexBehavior as string) ?? "",
  ];
  const watchoutBullets = watchoutSources.flatMap((t) => toBulletLines(t, 2)).slice(0, 4);

  /* At most two classification chips to avoid crowding. */
  const classificationChips: string[] = [];
  if (u.primaryBusinessType) classificationChips.push(PRIMARY_BUSINESS_LABEL[u.primaryBusinessType]);
  if (u.revenueModel && u.customerType) {
    classificationChips.push(`${REVENUE_MODEL_LABEL[u.revenueModel]} · ${CUSTOMER_LABEL[u.customerType]}`);
  } else if (u.revenueModel) {
    classificationChips.push(REVENUE_MODEL_LABEL[u.revenueModel]);
  } else if (u.customerType) {
    classificationChips.push(CUSTOMER_LABEL[u.customerType]);
  }
  const visibleChips = classificationChips.slice(0, 2);

  const peerBetaStr =
    wacc.peerBetaRangeMin != null || wacc.peerBetaRangeMax != null
      ? [wacc.peerBetaRangeMin, wacc.peerBetaRangeMax].filter((x) => x != null).join(" – ")
      : "—";

  const compDerived = companyContext.compDerivedMetrics;

  const tickerPart = u.publicPrivate === "public" && u.ticker?.trim() ? u.ticker.trim() : "—";
  const typePart = u.publicPrivate === "public" ? "Public" : "Private";

  return (
    <div className="h-full flex flex-col overflow-hidden rounded-xl border border-slate-800/90 bg-[#040508] ring-1 ring-white/[0.05] shadow-2xl shadow-black/45">
      {/* ========== LAYER 1 — HEADER / IDENTITY ========== */}
      <header className="flex-shrink-0 border-b border-slate-800/80 bg-gradient-to-b from-slate-900/50 to-slate-950/80 px-3 sm:px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600 mb-1">Intelligence</p>
            {u.companyName ? (
              <>
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-50 leading-tight">{u.companyName}</h1>
                <p className="text-[11px] text-slate-400 mt-2 leading-snug">
                  <span className="text-slate-300 tabular-nums">{tickerPart}</span>
                  <span className="text-slate-600"> · </span>
                  <span>{typePart}</span>
                  {u.industry ? (
                    <>
                      <span className="text-slate-600"> · </span>
                      {u.industry}
                    </>
                  ) : null}
                  {u.headquartersCountry ? (
                    <>
                      <span className="text-slate-600"> · </span>
                      {u.headquartersCountry}
                    </>
                  ) : null}
                  <span className="text-slate-600"> · </span>
                  <span className="tabular-nums">{reportingCurrency}</span>
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Enter company details in the builder.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:max-w-[220px]">
            {hasGenerated && companyContext.generatedAt ? (
              <StatusPill variant="info">Generated {formatDate(companyContext.generatedAt)}</StatusPill>
            ) : null}
            {hasGenerated ? (
              isStale ? (
                <StatusPill variant="warn">Stale</StatusPill>
              ) : (
                <StatusPill variant="ok">Up to date</StatusPill>
              )
            ) : (
              <StatusPill variant="neutral">Not generated</StatusPill>
            )}
            {confidence ? (
              <StatusPill variant={confidence.overall === "low" ? "warn" : confidence.overall === "high" ? "ok" : "neutral"}>
                Context: {confidence.overall}
              </StatusPill>
            ) : hasGenerated ? (
              <StatusPill variant="neutral">Context: —</StatusPill>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto min-h-0">
        {!hasGenerated && u.companyName ? (
          <p className="text-center text-[11px] text-slate-500 py-6 px-4">Generate company context to load qualitative and quantitative layers.</p>
        ) : null}

        {hasGenerated && (
          <div className="p-3 sm:p-4 space-y-4">
            {/* ========== LAYER 2 — QUALITATIVE HERO (split dashboard, not stacked cards) ========== */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4 lg:items-stretch">
              {/*
                Positioning: ai_context.companyOverview (lead) + businessModelSummary (bullets) + user_inputs classification chips.
                Visual: one typographic lead + tight bullets — scan thesis without a paragraph wall.
              */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 sm:p-3.5 ring-1 ring-white/[0.03] flex flex-col lg:min-h-[200px]">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-600/90">Company positioning</h2>
                  {visibleChips.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1">
                      {visibleChips.map((label) => (
                        <span
                          key={label}
                          className="text-[8px] font-medium px-1.5 py-0.5 rounded-md bg-slate-800/90 text-slate-400 ring-1 ring-slate-700/40 max-w-[140px] truncate"
                          title={label}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[13px] sm:text-sm font-medium text-slate-100 leading-snug tracking-tight">
                  {positioningLead || "—"}
                </p>
                <div className="h-px bg-gradient-to-r from-emerald-900/40 via-slate-800/80 to-transparent my-3" aria-hidden />
                <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-600 mb-2">Business model cues</p>
                <ul className="space-y-2 flex-1">
                  {thesisBullets.length > 0 ? (
                    thesisBullets.map((line, i) => (
                      <li key={i} className="flex gap-2 text-[11px] text-slate-400 leading-snug">
                        <span className="text-emerald-600/70 shrink-0 font-mono text-[10px]">·</span>
                        <span className="line-clamp-3">{line}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-[11px] text-slate-600">—</li>
                  )}
                </ul>
              </div>

              {/*
                Watchouts: modeling_implications (valuation / margin / capex prose).
                Spectrum: confidence.overall only — inference strength for this context pack (labeled honestly).
              */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 sm:p-3.5 ring-1 ring-amber-900/10 flex flex-col lg:min-h-[200px]">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200/70 mb-3">Modeling watchouts</h2>
                <ContextConfidenceSpectrum level={confidence?.overall} />
                <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-600 mb-1.5">Generated constraints</p>
                <p className="text-[9px] text-slate-600 mb-2 leading-snug">
                  From <span className="text-slate-500">valuationWatchouts</span>, <span className="text-slate-500">marginStructure</span>,{" "}
                  <span className="text-slate-500">capexBehavior</span>.
                </p>
                <ul className="space-y-2 flex-1">
                  {watchoutBullets.length > 0 ? (
                    watchoutBullets.map((line, i) => (
                      <li key={i} className="flex gap-2 text-[11px] text-slate-400 leading-snug">
                        <span className="text-amber-600/60 shrink-0 font-mono text-[10px]">·</span>
                        <span className="line-clamp-3">{line}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-[11px] text-slate-600">—</li>
                  )}
                </ul>
              </div>
            </div>

            {/* ========== LAYER 3 — QUANTITATIVE DASHBOARD (single composed surface; asymmetric split below) ========== */}
            <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 overflow-hidden ring-1 ring-white/[0.02]">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600 px-3 pt-3">Quantitative intelligence</p>

              {/* 3A — KPI strip: wacc_context + beta (override path) — headline COE / WACC references */}
              <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                <div className="rounded-lg bg-gradient-to-b from-emerald-950/35 to-slate-950 border border-emerald-800/30 px-2.5 py-2 ring-1 ring-emerald-900/25">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Beta</p>
                  <p className="text-lg font-semibold tabular-nums text-emerald-400 mt-0.5">{betaDisplay != null ? betaDisplay : "—"}</p>
                </div>
                <div className="rounded-lg bg-slate-950/80 border border-slate-700/50 px-2.5 py-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Peer β range</p>
                  <p className="text-sm font-semibold tabular-nums text-slate-100 mt-0.5 leading-tight">{peerBetaStr}</p>
                </div>
                <div className="rounded-lg bg-slate-950/80 border border-slate-700/50 px-2.5 py-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">ERP</p>
                  <p className="text-[11px] font-medium text-slate-200 mt-1 line-clamp-3 leading-snug">{wacc.equityRiskPremiumBasis?.trim() || "—"}</p>
                </div>
                <div className="rounded-lg bg-slate-950/80 border border-slate-700/50 px-2.5 py-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Risk-free</p>
                  <p className="text-[11px] font-medium text-slate-200 mt-1 line-clamp-3 leading-snug">{riskFreeDisplay || "—"}</p>
                </div>
                <div className="rounded-lg bg-slate-950/80 border border-slate-700/50 px-2.5 py-2 col-span-2 sm:col-span-1 lg:col-span-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Leverage</p>
                  <p className="text-[11px] font-medium text-slate-200 mt-1 line-clamp-3 leading-snug">{wacc.leverageBenchmark?.trim() || "—"}</p>
                </div>
              </div>

              {/* 3C left | 3B + 3D right */}
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-0 border-t border-slate-800/60">
                {/* 3C — compDerivedMetrics: peer-set distributions (bars), not benchmarks */}
                <div className="p-3 border-b lg:border-b-0 lg:border-r border-slate-800/60 bg-slate-950/25">
                  <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Peer-derived metrics</h3>
                  {compDerived && compDerived.acceptedCount > 0 ? (
                    <div>
                      <PeerRangeBar
                        label="Beta"
                        min={compDerived.betaRangeMin}
                        max={compDerived.betaRangeMax}
                        mid={compDerived.medianBeta}
                        display={compDerived.medianBeta != null ? compDerived.medianBeta.toFixed(2) : formatRange(compDerived.betaRangeMin, compDerived.betaRangeMax)}
                      />
                      <PeerRangeBar
                        label="Leverage (N.D./EBITDA)"
                        min={compDerived.leverageRangeMin}
                        max={compDerived.leverageRangeMax}
                        mid={compDerived.medianNetDebtEbitda}
                        suffix="x"
                        display={
                          compDerived.medianNetDebtEbitda != null
                            ? `${compDerived.medianNetDebtEbitda.toFixed(2)}x`
                            : formatRange(compDerived.leverageRangeMin, compDerived.leverageRangeMax, "x")
                        }
                      />
                      <PeerRangeBar
                        label="Revenue growth"
                        min={compDerived.revenueGrowthMin}
                        max={compDerived.revenueGrowthMax}
                        mid={midOfRange(compDerived.revenueGrowthMin, compDerived.revenueGrowthMax)}
                        suffix="%"
                        display={formatRange(compDerived.revenueGrowthMin, compDerived.revenueGrowthMax, "%")}
                      />
                      <PeerRangeBar
                        label="EBITDA margin"
                        min={compDerived.ebitdaMarginMin}
                        max={compDerived.ebitdaMarginMax}
                        mid={midOfRange(compDerived.ebitdaMarginMin, compDerived.ebitdaMarginMax)}
                        suffix="%"
                        display={formatRange(compDerived.ebitdaMarginMin, compDerived.ebitdaMarginMax, "%")}
                      />
                      <PeerRangeBar
                        label="Capex / revenue"
                        min={compDerived.capexPctRevenueMin}
                        max={compDerived.capexPctRevenueMax}
                        mid={midOfRange(compDerived.capexPctRevenueMin, compDerived.capexPctRevenueMax)}
                        suffix="%"
                        display={formatRange(compDerived.capexPctRevenueMin, compDerived.capexPctRevenueMax, "%")}
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-600 py-2">Accept comps with data to populate peer-derived ranges.</p>
                  )}
                </div>

                {/* 3B + 3D — column */}
                <div className="flex flex-col min-h-0">
                  <div className="p-3 border-b border-slate-800/60 flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Accepted comps</h3>
                      <span className="text-[10px] text-slate-600 tabular-nums">{acceptedComps.length}</span>
                    </div>
                    {acceptedComps.length > 0 ? (
                      <ul className="space-y-0 max-h-[200px] overflow-y-auto">
                        {acceptedComps.slice(0, 10).map((c) => (
                          <li
                            key={c.id}
                            className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-800/40 text-[11px] last:border-0"
                          >
                            <span className="text-slate-200 truncate font-medium">{c.companyName}</span>
                            <span className="text-[8px] font-bold text-emerald-500/90 tracking-wide shrink-0">{COMP_ROLE_LABEL[c.role]}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-slate-600">{comps.length > 0 ? `${comps.length} suggested — accept in builder.` : "None."}</p>
                    )}
                  </div>
                  <div className="p-3 bg-slate-950/30 flex-1">
                    {/* industry_benchmarks: family reference ranges + WC intensity — read-only executive scan */}
                    <h3 className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Industry benchmarks</h3>
                    <ul className="space-y-1">
                      {BENCHMARK_ROWS.map(({ minKey, maxKey, label, suffix = "" }) => {
                        const minV = typeof benchmarks[minKey] === "number" ? (benchmarks[minKey] as number) : undefined;
                        const maxV = typeof benchmarks[maxKey] === "number" ? (benchmarks[maxKey] as number) : undefined;
                        return (
                          <li key={String(minKey)} className="flex items-baseline justify-between gap-2 text-[10px]">
                            <span className="text-slate-500 truncate">{label}</span>
                            <span className="text-slate-200 font-medium tabular-nums shrink-0">{formatRange(minV, maxV, suffix)}</span>
                          </li>
                        );
                      })}
                      <li className="flex items-baseline justify-between gap-2 text-[10px] pt-1 border-t border-slate-800/50">
                        <span className="text-slate-500">WC intensity</span>
                        <span className="text-slate-200 font-medium">
                          {benchmarks.wcIntensityLevel ? WC_LABELS[benchmarks.wcIntensityLevel] ?? benchmarks.wcIntensityLevel : "—"}
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* ========== LAYER 4 — modeling_implications subset (2×2 grid; drivers + WC, separate from hero watchouts) ========== */}
            <div>
              <h2 className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600 mb-2">Modeling readout</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {LAYER4_KEYS.map(({ key, label }) => {
                  const text = ((implications[key] as string) ?? "").trim();
                  return (
                    <div key={key} className="rounded-lg border border-slate-800/70 bg-slate-950/50 px-2.5 py-2 min-h-[64px]">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-600">{label}</p>
                      <p className="text-[10px] text-slate-400 mt-1 leading-snug line-clamp-4 whitespace-pre-wrap">{text || "—"}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ========== LAYER 5 — ai_context.aiModelingNotes (+ override); lowest visual weight ========== */}
            <div className="rounded-lg border border-slate-800/40 bg-slate-950/20 px-2.5 py-2 opacity-80">
              <h2 className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-700 mb-1">Narrative support</h2>
              <p className="text-[9px] text-slate-600 mb-1">AI modeling notes</p>
              <p className="text-[10px] text-slate-500 leading-snug line-clamp-4 whitespace-pre-wrap">{notesEff.trim() || "—"}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
