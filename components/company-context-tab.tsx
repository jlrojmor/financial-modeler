"use client";

import { useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { CompanyContextAiContext, CompRole, IndustryBenchmarks, WcIntensityLevel, ModelingImplications, PrimaryBusinessType, MainOperatingGeography, CustomerType, RevenueModel, PeerSuggestionType, CompResolutionState } from "@/types/company-context";

const HEADQUARTERS_COUNTRIES = ["", "United States", "United Kingdom", "Canada", "Mexico", "Germany", "France", "Japan", "China", "India", "Australia", "Brazil", "Netherlands", "Switzerland", "Singapore", "Ireland", "Other"];
const INDUSTRIES = ["", "Technology", "Software", "Consumer Retail", "Healthcare", "Financial Services", "Industrial & Manufacturing", "Energy", "Telecommunications", "Media & Entertainment", "Real Estate", "Biotechnology", "Other"];

const PRIMARY_BUSINESS_TYPES: { value: PrimaryBusinessType; label: string }[] = [
  { value: "manufacturer", label: "Manufacturer" },
  { value: "distributor_wholesaler", label: "Distributor / Wholesaler" },
  { value: "retailer", label: "Retailer" },
  { value: "software_saas", label: "Software / SaaS" },
  { value: "marketplace_platform", label: "Marketplace / Platform" },
  { value: "services", label: "Services" },
  { value: "financial_services", label: "Financial Services" },
  { value: "healthcare_pharma", label: "Healthcare / Pharma" },
  { value: "infrastructure_industrial", label: "Infrastructure / Industrial" },
  { value: "other", label: "Other" },
];
const MAIN_GEOGRAPHY: { value: MainOperatingGeography; label: string }[] = [
  { value: "mexico", label: "Mexico" },
  { value: "us", label: "US" },
  { value: "canada", label: "Canada" },
  { value: "latam", label: "LATAM" },
  { value: "europe", label: "Europe" },
  { value: "global", label: "Global" },
  { value: "other", label: "Other" },
];
const CUSTOMER_TYPES: { value: CustomerType; label: string }[] = [
  { value: "b2b", label: "B2B" },
  { value: "b2c", label: "B2C" },
  { value: "both", label: "Both" },
];
const REVENUE_MODELS: { value: RevenueModel; label: string }[] = [
  { value: "product_sales", label: "Product sales" },
  { value: "services", label: "Services" },
  { value: "subscription", label: "Subscription" },
  { value: "commission_marketplace", label: "Commission / marketplace" },
  { value: "mixed", label: "Mixed" },
];

const CARD_KEYS: { key: keyof CompanyContextAiContext; label: string }[] = [
  { key: "companyOverview", label: "Company Overview" },
  { key: "businessModelSummary", label: "Business Model" },
  { key: "industryContext", label: "Industry Context" },
  { key: "geographyAndMacro", label: "Geography & Macro" },
  { key: "capitalStructureContext", label: "Capital Structure Context" },
  { key: "aiModelingNotes", label: "AI Modeling Notes" },
];

const COMP_ROLES: { value: CompRole; label: string }[] = [
  { value: "operating_comp", label: "Operating comp" },
  { value: "valuation_comp", label: "Valuation comp" },
  { value: "beta_comp", label: "Beta comp" },
];

const BENCHMARK_ROWS: { minKey: keyof IndustryBenchmarks; maxKey: keyof IndustryBenchmarks; label: string; suffix?: string }[] = [
  { minKey: "revenueGrowthMin", maxKey: "revenueGrowthMax", label: "Revenue growth", suffix: "%" },
  { minKey: "grossMarginMin", maxKey: "grossMarginMax", label: "Gross margin", suffix: "%" },
  { minKey: "ebitdaMarginMin", maxKey: "ebitdaMarginMax", label: "EBITDA margin", suffix: "%" },
  { minKey: "ebitMarginMin", maxKey: "ebitMarginMax", label: "EBIT margin", suffix: "%" },
  { minKey: "capexPctRevenueMin", maxKey: "capexPctRevenueMax", label: "Capex / revenue", suffix: "%" },
  { minKey: "leverageNetDebtEbitdaMin", maxKey: "leverageNetDebtEbitdaMax", label: "Net debt / EBITDA", suffix: "x" },
  { minKey: "betaMin", maxKey: "betaMax", label: "Beta range" },
];

const WC_INTENSITY_OPTIONS: { value: WcIntensityLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const IMPLICATION_BLOCKS: { key: keyof ModelingImplications; label: string }[] = [
  { key: "keyForecastDrivers", label: "Key forecast drivers" },
  { key: "wcDrivers", label: "Working capital watchouts" },
  { key: "capexBehavior", label: "Capex / reinvestment profile" },
  { key: "marginStructure", label: "Margin structure" },
  { key: "valuationWatchouts", label: "Valuation / WACC watchouts" },
];

type ContextSource = "user_input" | "ai_generated" | "benchmark" | "user_override";
function SourceBadge({ source }: { source: ContextSource }) {
  const styles: Record<ContextSource, string> = {
    user_input: "bg-slate-600/60 text-slate-200",
    ai_generated: "bg-emerald-800/50 text-emerald-200",
    benchmark: "bg-amber-800/50 text-amber-200",
    user_override: "bg-blue-800/50 text-blue-200",
  };
  const labels: Record<ContextSource, string> = {
    user_input: "User",
    ai_generated: "AI",
    benchmark: "Benchmark",
    user_override: "Override",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide ${styles[source]} ring-1 ring-white/5`}>
      {labels[source]}
    </span>
  );
}

const PEER_SUGGESTION_LABELS: Record<PeerSuggestionType, string> = {
  direct_comp: "Direct comp",
  proxy_peer: "Proxy peer",
  user_hint: "User hint",
  low_confidence_suggestion: "Low confidence",
};
function PeerSuggestionBadge({ type }: { type?: PeerSuggestionType }) {
  if (!type) return null;
  const styles: Record<PeerSuggestionType, string> = {
    direct_comp: "bg-emerald-800/50 text-emerald-200",
    proxy_peer: "bg-blue-800/50 text-blue-200",
    user_hint: "bg-slate-600/60 text-slate-200",
    low_confidence_suggestion: "bg-amber-800/50 text-amber-200",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold ${styles[type]} ring-1 ring-white/5`}>
      {PEER_SUGGESTION_LABELS[type]}
    </span>
  );
}

const RESOLUTION_LABELS: Record<CompResolutionState, string> = {
  resolved: "Resolved",
  unresolved: "Unresolved",
  needs_review: "Needs review",
};

function ResolutionBadge({ state, confidence, matchScore }: { state: CompResolutionState; confidence?: string; matchScore?: number }) {
  const styles: Record<CompResolutionState, string> = {
    resolved: "bg-emerald-800/50 text-emerald-200",
    unresolved: "bg-amber-800/50 text-amber-200",
    needs_review: "bg-slate-600/60 text-slate-200",
  };
  const title = [confidence && `Confidence: ${confidence}`, matchScore != null && `Match score: ${matchScore}`].filter(Boolean).join(" · ") || undefined;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold ${styles[state]} ring-1 ring-white/5`} title={title}>
      {RESOLUTION_LABELS[state]}
    </span>
  );
}

export default function CompanyContextTab() {
  const companyContext = useModelStore((s) => s.companyContext);
  const updateCompanyContextInputs = useModelStore((s) => s.updateCompanyContextInputs);
  const generateCompanyContext = useModelStore((s) => s.generateCompanyContext);
  const updateCompanyContextCard = useModelStore((s) => s.updateCompanyContextCard);
  const updateCompanyContextOverride = useModelStore((s) => s.updateCompanyContextOverride);
  const updateSuggestedComp = useModelStore((s) => s.updateSuggestedComp);
  const enrichSuggestedComp = useModelStore((s) => s.enrichSuggestedComp);
  const addSuggestedComp = useModelStore((s) => s.addSuggestedComp);
  const removeSuggestedComp = useModelStore((s) => s.removeSuggestedComp);
  const acceptSuggestedComp = useModelStore((s) => s.acceptSuggestedComp);
  const updateIndustryBenchmarks = useModelStore((s) => s.updateIndustryBenchmarks);
  const updateModelingImplications = useModelStore((s) => s.updateModelingImplications);
  const updateWaccContext = useModelStore((s) => s.updateWaccContext);

  const [generating, setGenerating] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(() => companyContext.generatedAt == null);
  const [editingCompId, setEditingCompId] = useState<string | null>(null);
  const [compNameError, setCompNameError] = useState<string | null>(null);

  // Autofocus company name when opening a comp for edit (e.g. new manual comp)
  useEffect(() => {
    if (!editingCompId) return;
    const t = setTimeout(() => {
      document.getElementById(`comp-name-${editingCompId}`)?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [editingCompId]);

  const u = companyContext.user_inputs;
  const hasGenerated = companyContext.generatedAt != null;
  const isStale = Boolean(companyContext.isContextStale);
  const ai = companyContext.ai_context;
  const market = companyContext.market_data ?? {};
  const wacc = companyContext.wacc_context ?? {};
  const benchmarks = companyContext.industry_benchmarks ?? {};
  const implications = companyContext.modeling_implications ?? {
    keyForecastDrivers: "", wcDrivers: "", capexBehavior: "", marginStructure: "", valuationWatchouts: "",
  };
  const comps = companyContext.suggested_comps ?? [];
  const compDerivedMetrics = companyContext.compDerivedMetrics;
  const confidence = companyContext.confidence;
  const notEnoughEvidenceMessage = companyContext.notEnoughEvidenceMessage;
  const isLowConfidence = confidence?.overall === "low" || Boolean(notEnoughEvidenceMessage);
  const betaDisplay = companyContext.user_overrides?.["beta"] ?? wacc.betaEstimate ?? market.beta;

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateCompanyContext();
      setDetailsOpen(false);
    } finally {
      setGenerating(false);
    }
  };

  const formatRange = (min: number | undefined, max: number | undefined, suffix = "") => {
    if (min == null && max == null) return "—";
    if (min != null && max != null) return `${min}–${max}${suffix}`;
    if (min != null) return `${min}+${suffix}`;
    return `≤${max}${suffix}`;
  };

  const card = "rounded-xl border border-slate-700/80 bg-slate-950/35 shadow-sm ring-1 ring-white/[0.03]";
  const sectionTitle = "text-base font-semibold text-slate-100 tracking-tight";
  const sectionEyebrow = "text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500";

  return (
    <div className="space-y-8 pb-4">
      <header className="border-b border-slate-800/80 pb-4">
        <p className={sectionEyebrow}>Workspace</p>
        <h1 className="text-lg font-semibold text-slate-50 mt-1">Context builder</h1>
        <p className="text-xs text-slate-500 mt-1 max-w-xl">Capture inputs, refine comps and WACC, then edit benchmarks and guidance. Synthesized readout lives in Intelligence →</p>
      </header>

      {/* 1. Company details — always first (inline so input keeps focus on re-render) */}
      <div className={`${card} overflow-hidden border-l-2 border-l-emerald-800/40`}>
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-900/40 transition-colors"
        >
          <span>
            <span className={`${sectionEyebrow} block mb-0.5`}>Inputs</span>
            <span className="text-sm font-semibold text-slate-100">Company details</span>
          </span>
          <span className="text-slate-500 text-xs tabular-nums">{detailsOpen ? "Hide" : "Show"}</span>
        </button>
        {detailsOpen && (
          <div className="px-4 pb-4 pt-2 border-t border-slate-700/60 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Company name (required)</label>
                <input type="text" value={u.companyName} onChange={(e) => updateCompanyContextInputs({ companyName: e.target.value })} placeholder="e.g. Acme Corp" className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Public / private</label>
                <select value={u.publicPrivate} onChange={(e) => updateCompanyContextInputs({ publicPrivate: e.target.value as "public" | "private" })} className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100">
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </div>
              {u.publicPrivate === "public" && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Ticker (optional)</label>
                  <input type="text" value={u.ticker} onChange={(e) => updateCompanyContextInputs({ ticker: e.target.value })} placeholder="e.g. ACME" className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100" />
                </div>
              )}
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Headquarters country</label>
                <select value={u.headquartersCountry} onChange={(e) => updateCompanyContextInputs({ headquartersCountry: e.target.value })} className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100">
                  {HEADQUARTERS_COUNTRIES.map((c) => <option key={c || "blank"} value={c}>{c || "—"}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Industry</label>
                <select value={u.industry} onChange={(e) => updateCompanyContextInputs({ industry: e.target.value })} className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100">
                  {INDUSTRIES.map((i) => <option key={i || "blank"} value={i}>{i || "—"}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Primary business type</label>
                <select value={u.primaryBusinessType ?? ""} onChange={(e) => updateCompanyContextInputs({ primaryBusinessType: (e.target.value || undefined) as PrimaryBusinessType | undefined })} className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100">
                  <option value="">—</option>
                  {PRIMARY_BUSINESS_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Main operating geography</label>
                <select value={u.mainOperatingGeography ?? ""} onChange={(e) => updateCompanyContextInputs({ mainOperatingGeography: (e.target.value || undefined) as MainOperatingGeography | undefined })} className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100">
                  <option value="">—</option>
                  {MAIN_GEOGRAPHY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Customer type</label>
                <select value={u.customerType ?? ""} onChange={(e) => updateCompanyContextInputs({ customerType: (e.target.value || undefined) as CustomerType | undefined })} className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100">
                  <option value="">—</option>
                  {CUSTOMER_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Revenue model</label>
                <select value={u.revenueModel ?? ""} onChange={(e) => updateCompanyContextInputs({ revenueModel: (e.target.value || undefined) as RevenueModel | undefined })} className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100">
                  <option value="">—</option>
                  {REVENUE_MODELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Known peers or public proxies (optional)</label>
                <input type="text" value={u.knownPeersOrProxies ?? u.manualComparableHints ?? ""} onChange={(e) => updateCompanyContextInputs({ knownPeersOrProxies: e.target.value || undefined, manualComparableHints: e.target.value || undefined })} placeholder="e.g. Nike, Sysco, WALMEX.MX" className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Reporting currency (optional)</label>
                <input type="text" value={u.reportingCurrency ?? ""} onChange={(e) => updateCompanyContextInputs({ reportingCurrency: e.target.value || undefined })} placeholder="e.g. USD, MXN" className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Short business description (optional)</label>
                <textarea value={u.shortBusinessDescription} onChange={(e) => updateCompanyContextInputs({ shortBusinessDescription: e.target.value })} placeholder="Brief description…" rows={2} className="w-full rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 resize-y" />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2 border-t border-slate-800/60">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || !u.companyName.trim()}
                className="rounded-lg px-4 py-2.5 text-sm font-semibold bg-slate-100 text-slate-900 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {generating ? "Generating…" : hasGenerated ? "Regenerate company context" : "Generate company context"}
              </button>
              {isStale && <span className="text-xs text-amber-400">Company details changed</span>}
            </div>
          </div>
        )}
      </div>

      {!hasGenerated && (
        <div className={`${card} p-8 text-center`}>
          <p className="text-sm text-slate-400 max-w-md mx-auto">Enter company details above and click <strong className="text-slate-300">Generate company context</strong>. The dashboard will appear below.</p>
        </div>
      )}

      {hasGenerated && (
        <>
          {isStale && (
            <div className="rounded-xl border border-amber-800/50 bg-amber-950/25 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ring-1 ring-amber-900/20">
              <p className="text-sm text-amber-200">Company details changed. Regenerate company context to refresh comps, benchmarks, and market context.</p>
              <button type="button" onClick={handleGenerate} disabled={generating || !u.companyName.trim()} className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium bg-amber-600/80 text-white hover:bg-amber-600 disabled:opacity-50">Regenerate company context</button>
            </div>
          )}

          {isLowConfidence && notEnoughEvidenceMessage && (
            <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 ring-1 ring-amber-900/15">
              <p className="text-xs font-medium text-amber-300 mb-1">Low confidence — we could not confidently identify the right peer set</p>
              <p className="text-sm text-amber-200/90 mb-2">{notEnoughEvidenceMessage}</p>
              <p className="text-[11px] text-slate-400">Add 1–2 known peer names, set primary business type, or provide a more specific business description to improve comps and benchmarks.</p>
            </div>
          )}

          {/* Market & Valuation Context */}
          <section className={`${card} p-5`}>
            <p className={sectionEyebrow}>Market & WACC</p>
            <h3 className={`${sectionTitle} mt-1 mb-3`}>Market & valuation context</h3>
            <p className="text-[11px] text-slate-500 mb-3">WACC inputs and reference. Override any field as needed. <SourceBadge source="ai_generated" /></p>
            {compDerivedMetrics?.source === "accepted_comps" && (compDerivedMetrics.medianBeta != null || compDerivedMetrics.medianNetDebtEbitda != null) ? (
              <p className="text-[11px] text-emerald-400/90 mb-2">Beta and leverage context from accepted comp set ({compDerivedMetrics.withDataCount} comps with data).</p>
            ) : (
              <p className="text-[11px] text-slate-500 mb-2">Using benchmark family fallback for beta/leverage (no comp-derived data or no accepted comps with data).</p>
            )}
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-slate-800/80 hover:bg-slate-900/50">
                    <td className="py-2.5 px-3 text-slate-500 text-xs w-44">Risk-free reference</td>
                    <td className="py-2 px-3"><input type="text" value={wacc.riskFreeRateMarket ?? ""} onChange={(e) => updateWaccContext({ riskFreeRateMarket: e.target.value || undefined })} placeholder="e.g. US 10Y Treasury" className="w-full max-w-xs rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-slate-100 text-xs" /></td>
                  </tr>
                  <tr className="border-b border-slate-800/80 hover:bg-slate-900/50">
                    <td className="py-2.5 px-3 text-slate-500 text-xs">Country / sovereign risk</td>
                    <td className="py-2 px-3"><input type="text" value={wacc.countrySovereignRisk ?? ""} onChange={(e) => updateWaccContext({ countrySovereignRisk: e.target.value || undefined })} placeholder="e.g. Canada" className="w-full max-w-xs rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-slate-100 text-xs" /></td>
                  </tr>
                  <tr className="border-b border-slate-800/80 hover:bg-slate-900/50">
                    <td className="py-2.5 px-3 text-slate-500 text-xs">ERP basis</td>
                    <td className="py-2 px-3"><input type="text" value={wacc.equityRiskPremiumBasis ?? ""} onChange={(e) => updateWaccContext({ equityRiskPremiumBasis: e.target.value || undefined })} placeholder="e.g. Damodaran implied ERP" className="w-full max-w-xs rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-slate-100 text-xs" /></td>
                  </tr>
                  <tr className="border-b border-slate-800/80 hover:bg-slate-900/50">
                    <td className="py-2.5 px-3 text-slate-500 text-xs">Beta estimate</td>
                    <td className="py-2 px-3"><input type="number" step={0.1} value={betaDisplay ?? ""} onChange={(e) => { const v = e.target.value === "" ? undefined : parseFloat(e.target.value); updateCompanyContextOverride("beta", v !== undefined && !Number.isNaN(v) ? v : undefined); updateWaccContext({ betaEstimate: v }); }} className="w-16 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-slate-100 text-xs" /></td>
                  </tr>
                  <tr className="border-b border-slate-800/80 hover:bg-slate-900/50">
                    <td className="py-2.5 px-3 text-slate-500 text-xs">Peer beta range</td>
                    <td className="py-2 px-3 flex items-center gap-1"><input type="number" step={0.1} value={wacc.peerBetaRangeMin ?? ""} onChange={(e) => updateWaccContext({ peerBetaRangeMin: e.target.value === "" ? undefined : parseFloat(e.target.value) })} placeholder="Min" className="w-14 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-slate-100 text-xs" /><span className="text-slate-500">–</span><input type="number" step={0.1} value={wacc.peerBetaRangeMax ?? ""} onChange={(e) => updateWaccContext({ peerBetaRangeMax: e.target.value === "" ? undefined : parseFloat(e.target.value) })} placeholder="Max" className="w-14 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-slate-100 text-xs" /></td>
                  </tr>
                  <tr className="border-b border-slate-800/80 hover:bg-slate-900/50">
                    <td className="py-2.5 px-3 text-slate-500 text-xs">Leverage benchmark</td>
                    <td className="py-2 px-3"><input type="text" value={wacc.leverageBenchmark ?? ""} onChange={(e) => updateWaccContext({ leverageBenchmark: e.target.value || undefined })} placeholder="e.g. Net debt / EBITDA 0.5–2.0x" className="w-full max-w-xs rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-slate-100 text-xs" /></td>
                  </tr>
                  <tr className="hover:bg-slate-900/50">
                    <td className="py-2.5 px-3 text-slate-500 text-xs">Cost of debt context</td>
                    <td className="py-2 px-3"><input type="text" value={wacc.costOfDebtContext ?? ""} onChange={(e) => updateWaccContext({ costOfDebtContext: e.target.value || undefined })} placeholder="Optional" className="w-full max-w-xs rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-slate-100 text-xs" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Comparable companies */}
          <section className={`${card} p-5`}>
            <p className={sectionEyebrow}>Peer set</p>
            <h3 className={`${sectionTitle} mt-1 mb-1`}>Comparable companies</h3>
            <p className="text-[11px] text-slate-500 mb-3">Accept, replace, or remove. Peer-derived metrics and snapshot tags are summarized in <span className="text-slate-400">Intelligence</span>.</p>
            <ul className="space-y-2.5">
                {comps.map((c) => (
                  <li key={c.id} className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-3 ring-1 ring-white/[0.02]">
                    {editingCompId === c.id ? (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-0.5">Company name (required)</label>
                          <input
                            id={`comp-name-${c.id}`}
                            type="text"
                            value={c.companyName}
                            onChange={(e) => { setCompNameError(null); updateSuggestedComp(c.id, { companyName: e.target.value }); }}
                            placeholder="e.g. Nike Inc"
                            className={`w-full rounded border px-2 py-1.5 text-sm text-slate-100 ${compNameError ? "border-red-500 bg-red-900/20" : "border-slate-600 bg-slate-800"}`}
                          />
                          {compNameError && <p className="text-[11px] text-red-400 mt-0.5">{compNameError}</p>}
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-0.5">Ticker (optional)</label>
                          <input type="text" value={c.ticker ?? ""} onChange={(e) => updateSuggestedComp(c.id, { ticker: e.target.value || undefined })} placeholder="e.g. NKE" className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100" />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-0.5">Comp role</label>
                          <select value={c.role} onChange={(e) => updateSuggestedComp(c.id, { role: e.target.value as CompRole })} className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100">
                            {COMP_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-0.5">Rationale / why relevant</label>
                          <input type="text" value={c.reason} onChange={(e) => updateSuggestedComp(c.id, { reason: e.target.value })} placeholder="Short reason" className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-100" />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              const name = (comps.find((x) => x.id === c.id)?.companyName ?? "").trim();
                              if (!name) { setCompNameError("Company name is required."); return; }
                              setCompNameError(null);
                              enrichSuggestedComp(c.id);
                              setEditingCompId(null);
                            }}
                            className="rounded px-2 py-1 text-xs font-medium bg-emerald-700/60 text-emerald-200 hover:bg-emerald-600/60"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCompNameError(null);
                              const name = (comps.find((x) => x.id === c.id)?.companyName ?? "").trim();
                              if (!name) { removeSuggestedComp(c.id); }
                              setEditingCompId(null);
                            }}
                            className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200 border border-slate-600"
                          >
                            Cancel
                          </button>
                          <button type="button" onClick={() => { removeSuggestedComp(c.id); setEditingCompId(null); setCompNameError(null); }} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-200">{c.companyName}</span>
                            {c.ticker && <span className="text-slate-500 text-xs">({c.ticker})</span>}
                            <span className="text-slate-500 text-xs">— {COMP_ROLES.find((r) => r.value === c.role)?.label ?? c.role}</span>
                            <PeerSuggestionBadge type={c.suggestionType} />
                            {c.resolutionState && (
                              <ResolutionBadge state={c.resolutionState} confidence={c.resolutionConfidence} matchScore={c.resolutionMatchScore} />
                            )}
                          </div>
                          {c.resolutionState === "unresolved" && (
                            <p className="text-[11px] text-amber-400 mt-1">
                              Unresolved — add ticker or check company name to enrich.
                              {c.resolutionMatchScore != null && (
                                <span className="text-slate-500 ml-1">(Best match score: {c.resolutionMatchScore})</span>
                              )}
                            </p>
                          )}
                          {c.resolutionState === "needs_review" && (
                            <p className="text-[11px] text-slate-400 mt-1">Needs review — possible match; verify company.</p>
                          )}
                          <p className="text-[11px] text-slate-400 mt-0.5">{c.reason}</p>
                          {c.matchSummary && <p className="text-[10px] text-slate-500 mt-0.5">Why selected: {c.matchSummary}</p>}
                          {c.country && <p className="text-[10px] text-slate-500">Country: {c.country}{c.sector ? ` · ${c.sector}` : ""}</p>}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {c.status === "suggested" && (
                            <button type="button" onClick={() => acceptSuggestedComp(c.id)} className="rounded px-2 py-1 text-[11px] font-medium bg-emerald-700/60 text-emerald-200 hover:bg-emerald-600/60">Accept</button>
                          )}
                          <button type="button" onClick={() => setEditingCompId(c.id)} className="rounded px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-slate-200 border border-slate-600">Replace</button>
                          <button type="button" onClick={() => removeSuggestedComp(c.id)} className="rounded px-2 py-1 text-[11px] font-medium text-red-400 hover:text-red-300">Remove</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  const newId = addSuggestedComp({ companyName: "", reason: "", role: "operating_comp" });
                  setEditingCompId(newId);
                  setCompNameError(null);
                }}
                className="mt-3 w-full rounded-lg border border-dashed border-slate-600/80 px-3 py-2.5 text-xs font-medium text-slate-400 hover:text-slate-200 hover:border-slate-500 hover:bg-slate-900/30"
              >
                + Add manual comp
              </button>
          </section>

          {/* Industry benchmarks */}
          <section className={`${card} p-5`}>
            <p className={sectionEyebrow}>Reference ranges</p>
            <h3 className={`${sectionTitle} mt-1 mb-2`}>Industry benchmarks</h3>
              <p className="text-[11px] text-slate-500 mb-3">Analyst reference ranges. Override where needed. <SourceBadge source="benchmark" /></p>
              <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {BENCHMARK_ROWS.map(({ minKey, maxKey, label, suffix = "" }) => (
                      <tr key={minKey} className="border-b border-slate-800/80 last:border-0 hover:bg-slate-900/50">
                        <td className="py-2.5 px-3 text-slate-500 text-xs w-40">{label}</td>
                        <td className="py-2 px-3 text-slate-200">
                          {formatRange(
                            typeof benchmarks[minKey] === "number" ? benchmarks[minKey] : undefined,
                            typeof benchmarks[maxKey] === "number" ? benchmarks[maxKey] : undefined,
                            suffix
                          )}
                        </td>
                        <td className="py-2 px-3 w-32">
                          <div className="flex gap-1">
                            <input
                              type="number"
                              step={0.1}
                              value={typeof benchmarks[minKey] === "number" ? benchmarks[minKey] : ""}
                              onChange={(e) => updateIndustryBenchmarks({ [minKey]: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
                              placeholder="Min"
                              className="w-14 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100 text-right"
                            />
                            <span className="text-slate-500">–</span>
                            <input
                              type="number"
                              step={0.1}
                              value={typeof benchmarks[maxKey] === "number" ? benchmarks[maxKey] : ""}
                              onChange={(e) => updateIndustryBenchmarks({ [maxKey]: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
                              placeholder="Max"
                              className="w-14 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100 text-right"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                    <tr className="hover:bg-slate-900/50">
                      <td className="py-2.5 px-3 text-slate-500 text-xs">Working capital intensity</td>
                      <td className="py-2 px-3 text-slate-200">
                        {benchmarks.wcIntensityLevel ? WC_INTENSITY_OPTIONS.find((o) => o.value === benchmarks.wcIntensityLevel)?.label : "—"}
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={benchmarks.wcIntensityLevel ?? ""}
                          onChange={(e) => updateIndustryBenchmarks({ wcIntensityLevel: (e.target.value || undefined) as WcIntensityLevel | undefined })}
                          className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                        >
                          <option value="">—</option>
                          {WC_INTENSITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
          </section>

          {/* Modeling guidance */}
          <section className={`${card} p-5 border-slate-800/90`}>
            <p className={sectionEyebrow}>Narrative</p>
            <h3 className={`${sectionTitle} mt-1 mb-3`}>Modeling guidance</h3>
            <p className="text-[11px] text-slate-500 mb-4">Structured guidance for building the model. <SourceBadge source="ai_generated" /></p>
            <div className="space-y-5">
              {IMPLICATION_BLOCKS.map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{label}</label>
                  <textarea
                    value={implications[key] ?? ""}
                    onChange={(e) => updateModelingImplications({ [key]: e.target.value })}
                    rows={3}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 resize-y focus:outline-none focus:ring-1 focus:ring-emerald-900/50"
                    placeholder="…"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Company snapshot */}
          <section className={`${card} p-5 border-slate-800/90`}>
            <p className={sectionEyebrow}>AI snapshot cards</p>
            <h3 className={`${sectionTitle} mt-1 mb-3`}>Company snapshot</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {CARD_KEYS.map(({ key, label }) => (
                <div key={key} className="flex flex-col">
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{label}</label>
                  <textarea
                    value={companyContext.user_overrides?.[`ai_context.${key}`] ?? ai[key]}
                    onChange={(e) => updateCompanyContextCard(key, e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 resize-y focus:outline-none focus:ring-1 focus:ring-emerald-900/50"
                    placeholder={`${label}…`}
                  />
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
