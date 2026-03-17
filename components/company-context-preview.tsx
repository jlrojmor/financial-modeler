"use client";

import { useModelStore } from "@/store/useModelStore";
import type { CompRole } from "@/types/company-context";

const COMP_ROLE_LABEL: Record<CompRole, string> = {
  operating_comp: "Op",
  valuation_comp: "Val",
  beta_comp: "Beta",
};

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function CompanyContextPreview() {
  const companyContext = useModelStore((s) => s.companyContext);
  const u = companyContext.user_inputs;
  const wacc = companyContext.wacc_context ?? {};
  const market = companyContext.market_data ?? {};
  const comps = companyContext.suggested_comps ?? [];
  const acceptedComps = comps.filter((c) => c.status === "accepted");
  const hasGenerated = companyContext.generatedAt != null;
  const isStale = Boolean(companyContext.isContextStale);
  const betaDisplay = companyContext.user_overrides?.["beta"] ?? wacc.betaEstimate ?? market.beta;
  const overrideCount = Object.keys(companyContext.user_overrides ?? {}).filter(
    (k) => companyContext.user_overrides![k] !== undefined
  ).length;

  return (
    <div className="h-full rounded-lg border border-slate-800 bg-slate-950 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-2.5 py-1.5 border-b border-slate-800">
        <h2 className="text-[11px] font-semibold text-slate-200">Intelligence</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
        {/* Company */}
        <section className="rounded border border-slate-700/50 bg-slate-900/50 px-2 py-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Company</h3>
          {u.companyName ? (
            <ul className="space-y-0.5 text-[11px]">
              <li className="text-slate-200 font-medium truncate">{u.companyName}</li>
              <li className="text-slate-400">{u.publicPrivate === "public" ? (u.ticker ? `${u.ticker} · Public` : "Public") : "Private"}</li>
              {u.industry && <li className="text-slate-400">{u.industry}</li>}
              {u.headquartersCountry && <li className="text-slate-400">{u.headquartersCountry}</li>}
              {market.reportingCurrency && <li className="text-slate-500">{market.reportingCurrency}</li>}
            </ul>
          ) : (
            <p className="text-[11px] text-slate-500">Enter details in builder.</p>
          )}
        </section>

        {/* WACC Snapshot */}
        <section className="rounded border border-slate-700/50 bg-slate-900/50 px-2 py-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">WACC Snapshot</h3>
          {hasGenerated && (wacc.riskFreeRateMarket || betaDisplay != null || wacc.equityRiskPremiumBasis) ? (
            <ul className="space-y-0.5 text-[11px] text-slate-300">
              {wacc.riskFreeRateMarket && <li><span className="text-slate-500">RFR:</span> {wacc.riskFreeRateMarket}</li>}
              {wacc.equityRiskPremiumBasis && <li><span className="text-slate-500">ERP:</span> {wacc.equityRiskPremiumBasis}</li>}
              {betaDisplay != null && <li><span className="text-slate-500">β:</span> {betaDisplay}</li>}
              {(wacc.peerBetaRangeMin != null || wacc.peerBetaRangeMax != null) && (
                <li><span className="text-slate-500">Peer β:</span> {[wacc.peerBetaRangeMin, wacc.peerBetaRangeMax].filter((x) => x != null).join("–")}</li>
              )}
              {wacc.leverageBenchmark && <li className="truncate" title={wacc.leverageBenchmark}><span className="text-slate-500">Leverage:</span> {wacc.leverageBenchmark}</li>}
            </ul>
          ) : (
            <p className="text-[11px] text-slate-500">Generate to populate.</p>
          )}
        </section>

        {/* Comp Set — accepted only */}
        <section className="rounded border border-slate-700/50 bg-slate-900/50 px-2 py-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Comp Set</h3>
          {acceptedComps.length > 0 ? (
            <ul className="space-y-0.5">
              {acceptedComps.slice(0, 8).map((c) => (
                <li key={c.id} className="text-[11px] flex items-baseline gap-1.5">
                  <span className="text-slate-200 truncate">{c.companyName}</span>
                  {c.ticker && <span className="text-slate-500 shrink-0">({c.ticker})</span>}
                  <span className="text-slate-500 shrink-0">{COMP_ROLE_LABEL[c.role]}</span>
                </li>
              ))}
              {acceptedComps.length > 8 && <li className="text-[11px] text-slate-500">+{acceptedComps.length - 8} more</li>}
            </ul>
          ) : comps.length > 0 ? (
            <p className="text-[11px] text-slate-500">{comps.length} suggested · accept in builder</p>
          ) : (
            <p className="text-[11px] text-slate-500">Generate for suggestions.</p>
          )}
        </section>

        {/* Status */}
        <section className="rounded border border-slate-700/50 bg-slate-900/50 px-2 py-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Status</h3>
          <ul className="space-y-0.5 text-[11px] text-slate-400">
            {hasGenerated ? (
              <>
                <li>Generated {companyContext.generatedAt ? formatDate(companyContext.generatedAt) : ""}</li>
                <li>{isStale ? <span className="text-amber-400">Stale</span> : <span className="text-emerald-400/90">Up to date</span>}</li>
                {overrideCount > 0 && <li>{overrideCount} override{overrideCount !== 1 ? "s" : ""}</li>}
              </>
            ) : (
              <li>Not generated</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
