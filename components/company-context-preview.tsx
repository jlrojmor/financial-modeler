"use client";

import type { ReactNode } from "react";
import { useModelStore } from "@/store/useModelStore";
import type {
  CompRole,
  CompanyContextAiContext,
  IndustryBenchmarks,
  ModelingImplications,
  ResearchConfidence,
} from "@/types/company-context";

const COMP_ROLE_LABEL: Record<CompRole, string> = {
  operating_comp: "Operating",
  valuation_comp: "Valuation",
  beta_comp: "Beta",
};

const BENCHMARK_ROWS: { minKey: keyof IndustryBenchmarks; maxKey: keyof IndustryBenchmarks; label: string; suffix?: string }[] = [
  { minKey: "revenueGrowthMin", maxKey: "revenueGrowthMax", label: "Revenue growth", suffix: "%" },
  { minKey: "grossMarginMin", maxKey: "grossMarginMax", label: "Gross margin", suffix: "%" },
  { minKey: "ebitdaMarginMin", maxKey: "ebitdaMarginMax", label: "EBITDA margin", suffix: "%" },
  { minKey: "ebitMarginMin", maxKey: "ebitMarginMax", label: "EBIT margin", suffix: "%" },
  { minKey: "capexPctRevenueMin", maxKey: "capexPctRevenueMax", label: "Capex / revenue", suffix: "%" },
  { minKey: "leverageNetDebtEbitdaMin", maxKey: "leverageNetDebtEbitdaMax", label: "Net debt / EBITDA", suffix: "x" },
  { minKey: "betaMin", maxKey: "betaMax", label: "Beta range" },
];

const IMPLICATION_LABELS: { key: keyof ModelingImplications; label: string }[] = [
  { key: "keyForecastDrivers", label: "Forecast drivers" },
  { key: "wcDrivers", label: "Working capital" },
  { key: "capexBehavior", label: "Capex / reinvestment" },
  { key: "marginStructure", label: "Margin structure" },
  { key: "valuationWatchouts", label: "Valuation / WACC" },
];

const CARD_KEYS: { key: keyof CompanyContextAiContext; label: string }[] = [
  { key: "companyOverview", label: "Overview" },
  { key: "businessModelSummary", label: "Business model" },
  { key: "industryContext", label: "Industry" },
  { key: "geographyAndMacro", label: "Geography & macro" },
  { key: "capitalStructureContext", label: "Capital structure" },
  { key: "aiModelingNotes", label: "Modeling notes" },
];

const WC_LABELS: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatRange(min: number | undefined, max: number | undefined, suffix = ""): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `${min}–${max}${suffix}`;
  if (min != null) return `${min}${suffix}+`;
  return `≤${max}${suffix}`;
}

function formatMetricRange(min: number | undefined, max: number | undefined, suffix = ""): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `${min}–${max}${suffix}`;
  if (min != null) return `${min}${suffix}+`;
  return `≤${max}${suffix}`;
}

function researchChipClass(rc: ResearchConfidence | undefined): string {
  if (rc === "research_backed") return "bg-emerald-950/80 text-emerald-200 ring-1 ring-emerald-800/40";
  if (rc === "mixed_evidence") return "bg-amber-950/60 text-amber-200 ring-1 ring-amber-800/35";
  return "bg-slate-800 text-slate-300 ring-1 ring-slate-600/50";
}

function researchLabel(rc: ResearchConfidence | undefined): string {
  if (rc === "research_backed") return "Research-backed";
  if (rc === "mixed_evidence") return "Mixed evidence";
  return "Limited evidence";
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 mb-2">{children}</h3>
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
  const betaDisplay = overrides["beta"] ?? wacc.betaEstimate ?? market.beta;
  const reportingCurrency = market.reportingCurrency ?? "USD";
  const marketType = market.marketType ?? "developed";
  const researchConfidence = companyContext.companyResearch?.researchConfidence;
  const compDerived = companyContext.compDerivedMetrics;
  const overrideCount = Object.keys(overrides).filter((k) => overrides[k] !== undefined).length;

  const waccPopulated =
    hasGenerated && Boolean(wacc.riskFreeRateMarket || betaDisplay != null || wacc.equityRiskPremiumBasis);

  return (
    <div className="h-full rounded-xl border border-slate-800/90 bg-gradient-to-b from-slate-950 to-[#0a0c10] flex flex-col overflow-hidden shadow-xl shadow-black/40 ring-1 ring-white/[0.04]">
      <div className="flex-shrink-0 px-4 py-3 border-b border-slate-800/80 bg-slate-950/80">
        <div className="flex items-center gap-2">
          <div className="h-6 w-1 rounded-full bg-emerald-600/70" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-slate-100">Intelligence</h2>
            <p className="text-[10px] text-slate-500 mt-0.5">Executive readout · edit in builder</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 min-h-0">
        {/* Hero + status */}
        <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-3">
          {u.companyName ? (
            <>
              <p className="text-lg font-semibold text-slate-50 tracking-tight leading-tight">{u.companyName}</p>
              <p className="text-xs text-slate-400 mt-1">
                {u.publicPrivate === "public" ? (u.ticker ? `${u.ticker} · Public` : "Public") : "Private"}
                {u.industry ? ` · ${u.industry}` : ""}
                {u.headquartersCountry ? ` · ${u.headquartersCountry}` : ""}
                {reportingCurrency ? ` · ${reportingCurrency}` : ""}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">Enter company details in the builder to begin.</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            {hasGenerated ? (
              <>
                <span className="rounded-md bg-slate-800/80 px-2 py-1 text-slate-300 ring-1 ring-slate-700/60">
                  Generated {companyContext.generatedAt ? formatDate(companyContext.generatedAt) : ""}
                </span>
                {isStale ? (
                  <span className="rounded-md bg-amber-950/50 px-2 py-1 text-amber-200 ring-1 ring-amber-800/40">Stale — regenerate</span>
                ) : (
                  <span className="rounded-md bg-emerald-950/40 px-2 py-1 text-emerald-300/90 ring-1 ring-emerald-800/30">Up to date</span>
                )}
                {overrideCount > 0 && (
                  <span className="rounded-md bg-blue-950/40 px-2 py-1 text-blue-200/90 ring-1 ring-blue-900/40">
                    {overrideCount} override{overrideCount !== 1 ? "s" : ""}
                  </span>
                )}
              </>
            ) : (
              <span className="text-slate-500">Not generated</span>
            )}
          </div>
        </div>

        {hasGenerated && (
          <>
            {/* Snapshot — profile vs market */}
            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-3">
              <SectionTitle>Profile & market tags</SectionTitle>
              <div className="space-y-2">
                <p className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Entity</p>
                <div className="flex flex-wrap gap-1.5">
                  {researchConfidence && (
                    <span
                      className={`px-2 py-1 rounded-md text-[11px] font-medium ${researchChipClass(researchConfidence)}`}
                      title={
                        researchConfidence === "research_backed"
                          ? "Overview uses external company evidence"
                          : researchConfidence === "mixed_evidence"
                            ? "Overview uses your description and inferred evidence"
                            : "Limited evidence"
                      }
                    >
                      {researchLabel(researchConfidence)}
                    </span>
                  )}
                  {u.industry && (
                    <span className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800/90 text-slate-200 ring-1 ring-slate-600/40">{u.industry}</span>
                  )}
                  <span className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800/90 text-slate-200 ring-1 ring-slate-600/40">
                    {u.publicPrivate === "public" ? "Public" : "Private"}
                  </span>
                  {u.headquartersCountry && (
                    <span className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800/90 text-slate-200 ring-1 ring-slate-600/40">{u.headquartersCountry}</span>
                  )}
                  <span className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800/90 text-slate-200 ring-1 ring-slate-600/40">{reportingCurrency}</span>
                  <span className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800/90 text-slate-200 ring-1 ring-slate-600/40">
                    {marketType === "developed" ? "Developed" : "Emerging"}
                  </span>
                </div>
                <p className="text-[9px] uppercase tracking-wider text-slate-600 mb-1 mt-2">Valuation reference</p>
                <div className="flex flex-wrap gap-1.5">
                  {wacc.riskFreeRateMarket && (
                    <span className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800/90 text-slate-200 ring-1 ring-slate-600/40">Rf: {wacc.riskFreeRateMarket}</span>
                  )}
                  {wacc.equityRiskPremiumBasis && (
                    <span className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800/90 text-slate-200 ring-1 ring-slate-600/40">ERP: {wacc.equityRiskPremiumBasis}</span>
                  )}
                  {betaDisplay != null && (
                    <span className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800/90 text-slate-200 ring-1 ring-slate-600/40">β {betaDisplay}</span>
                  )}
                  {(wacc.peerBetaRangeMin != null || wacc.peerBetaRangeMax != null) && (
                    <span className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800/90 text-slate-200 ring-1 ring-slate-600/40">
                      Peer β {formatRange(wacc.peerBetaRangeMin, wacc.peerBetaRangeMax)}
                    </span>
                  )}
                  {wacc.leverageBenchmark && (
                    <span className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800/90 text-slate-200 ring-1 ring-slate-600/40 max-w-full truncate" title={wacc.leverageBenchmark}>
                      {wacc.leverageBenchmark}
                    </span>
                  )}
                </div>
              </div>
            </section>

            {/* WACC KPI grid */}
            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-3">
              <SectionTitle>WACC & capital</SectionTitle>
              {waccPopulated ? (
                <div className="grid grid-cols-2 gap-2">
                  {wacc.riskFreeRateMarket && (
                    <div className="rounded-md bg-slate-950/60 border border-slate-700/40 px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">Risk-free</p>
                      <p className="text-xs font-medium text-slate-100 mt-0.5 leading-snug">{wacc.riskFreeRateMarket}</p>
                    </div>
                  )}
                  {wacc.equityRiskPremiumBasis && (
                    <div className="rounded-md bg-slate-950/60 border border-slate-700/40 px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">ERP basis</p>
                      <p className="text-xs font-medium text-slate-100 mt-0.5 leading-snug line-clamp-2">{wacc.equityRiskPremiumBasis}</p>
                    </div>
                  )}
                  {betaDisplay != null && (
                    <div className="rounded-md bg-slate-950/60 border border-slate-700/40 px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">Beta</p>
                      <p className="text-sm font-semibold text-emerald-400/95 tabular-nums">{betaDisplay}</p>
                    </div>
                  )}
                  {(wacc.peerBetaRangeMin != null || wacc.peerBetaRangeMax != null) && (
                    <div className="rounded-md bg-slate-950/60 border border-slate-700/40 px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">Peer β range</p>
                      <p className="text-sm font-semibold text-slate-100 tabular-nums">{[wacc.peerBetaRangeMin, wacc.peerBetaRangeMax].filter((x) => x != null).join(" – ")}</p>
                    </div>
                  )}
                  {wacc.leverageBenchmark && (
                    <div className="rounded-md bg-slate-950/60 border border-slate-700/40 px-2.5 py-2 col-span-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">Leverage benchmark</p>
                      <p className="text-xs font-medium text-slate-200 mt-0.5">{wacc.leverageBenchmark}</p>
                    </div>
                  )}
                  {wacc.costOfDebtContext && (
                    <div className="rounded-md bg-slate-950/60 border border-slate-700/40 px-2.5 py-2 col-span-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">Cost of debt</p>
                      <p className="text-xs text-slate-300 mt-0.5">{wacc.costOfDebtContext}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No WACC context yet.</p>
              )}
            </section>

            {/* Accepted comps */}
            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-3">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <SectionTitle>Accepted comp set</SectionTitle>
                {acceptedComps.length > 0 && (
                  <span className="text-[10px] font-medium text-slate-500">{acceptedComps.length} accepted</span>
                )}
              </div>
              {acceptedComps.length > 0 ? (
                <ul className="space-y-1.5">
                  {acceptedComps.slice(0, 8).map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-slate-700/40 bg-slate-950/50 px-2.5 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium text-slate-100 truncate block">{c.companyName}</span>
                        {c.ticker && <span className="text-[11px] text-slate-500">{c.ticker}</span>}
                      </div>
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-emerald-600/90 bg-emerald-950/40 px-1.5 py-0.5 rounded">
                        {COMP_ROLE_LABEL[c.role]}
                      </span>
                    </li>
                  ))}
                  {acceptedComps.length > 8 && (
                    <li className="text-xs text-slate-500 pl-1">+{acceptedComps.length - 8} more in builder</li>
                  )}
                </ul>
              ) : comps.length > 0 ? (
                <p className="text-xs text-slate-500">{comps.length} suggested — accept comps in the builder to anchor metrics.</p>
              ) : (
                <p className="text-xs text-slate-500">No comps yet. Regenerate or add manual comps.</p>
              )}
            </section>

            {/* Comp-derived metrics */}
            {compDerived && compDerived.acceptedCount > 0 && (
              <section className="rounded-lg border border-emerald-900/30 bg-emerald-950/10 p-3 ring-1 ring-emerald-900/20">
                <SectionTitle>Peer-derived metrics</SectionTitle>
                <p className="text-[11px] text-slate-500 mb-3">
                  {compDerived.source === "accepted_comps"
                    ? `${compDerived.acceptedCount} accepted · ${compDerived.withDataCount} with data`
                    : "Benchmark fallback for beta/leverage"}
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div className="flex justify-between gap-2 border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-500">Median β</span>
                    <span className="font-medium text-slate-100 tabular-nums">{compDerived.medianBeta != null ? compDerived.medianBeta.toFixed(2) : "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-500">β range</span>
                    <span className="font-medium text-slate-100 tabular-nums">{formatMetricRange(compDerived.betaRangeMin, compDerived.betaRangeMax)}</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-500">Med. N.D./EBITDA</span>
                    <span className="font-medium text-slate-100 tabular-nums">
                      {compDerived.medianNetDebtEbitda != null ? `${compDerived.medianNetDebtEbitda.toFixed(2)}x` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-500">Lev. range</span>
                    <span className="font-medium text-slate-100 tabular-nums">{formatMetricRange(compDerived.leverageRangeMin, compDerived.leverageRangeMax)}</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-500">Rev. growth</span>
                    <span className="font-medium text-slate-100 tabular-nums">{formatMetricRange(compDerived.revenueGrowthMin, compDerived.revenueGrowthMax, "%")}</span>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-500">EBITDA margin</span>
                    <span className="font-medium text-slate-100 tabular-nums">{formatMetricRange(compDerived.ebitdaMarginMin, compDerived.ebitdaMarginMax, "%")}</span>
                  </div>
                  <div className="flex justify-between gap-2 col-span-2">
                    <span className="text-slate-500">Capex / revenue</span>
                    <span className="font-medium text-slate-100 tabular-nums">{formatMetricRange(compDerived.capexPctRevenueMin, compDerived.capexPctRevenueMax, "%")}</span>
                  </div>
                </div>
              </section>
            )}

            {/* Benchmark highlights */}
            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-3">
              <SectionTitle>Industry benchmark ranges</SectionTitle>
              <div className="rounded-md border border-slate-700/40 overflow-hidden">
                <table className="w-full text-[11px]">
                  <tbody>
                    {BENCHMARK_ROWS.map(({ minKey, maxKey, label, suffix = "" }) => (
                      <tr key={String(minKey)} className="border-b border-slate-800/80 last:border-0">
                        <td className="py-1.5 px-2 text-slate-500 w-[42%]">{label}</td>
                        <td className="py-1.5 px-2 text-slate-200 font-medium tabular-nums text-right">
                          {formatRange(
                            typeof benchmarks[minKey] === "number" ? (benchmarks[minKey] as number) : undefined,
                            typeof benchmarks[maxKey] === "number" ? (benchmarks[maxKey] as number) : undefined,
                            suffix
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-1.5 px-2 text-slate-500">WC intensity</td>
                      <td className="py-1.5 px-2 text-slate-200 font-medium text-right">
                        {benchmarks.wcIntensityLevel ? WC_LABELS[benchmarks.wcIntensityLevel] ?? benchmarks.wcIntensityLevel : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Modeling readout */}
            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-3">
              <SectionTitle>Modeling guidance</SectionTitle>
              <div className="space-y-3">
                {IMPLICATION_LABELS.map(({ key, label }) => {
                  const text = (implications[key] as string) ?? "";
                  return (
                    <div key={key} className="rounded-md border border-slate-800/60 bg-slate-950/40 px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</p>
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{text.trim() || "—"}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Company narrative signals */}
            <section className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-3">
              <SectionTitle>Company context</SectionTitle>
              <div className="space-y-3">
                {CARD_KEYS.map(({ key, label }) => {
                  const text = (overrides[`ai_context.${key}`] ?? ai[key] ?? "") as string;
                  return (
                    <div key={key} className="rounded-md border border-slate-800/60 bg-slate-950/40 px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</p>
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap max-h-28 overflow-y-auto">{text.trim() || "—"}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {!hasGenerated && u.companyName && (
          <p className="text-xs text-slate-500 text-center py-2 border border-dashed border-slate-700/50 rounded-lg">
            Run <span className="text-slate-400 font-medium">Generate company context</span> to populate intelligence.
          </p>
        )}
      </div>
    </div>
  );
}
