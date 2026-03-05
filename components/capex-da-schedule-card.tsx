"use client";

import { useEffect, useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import CollapsibleSection from "@/components/collapsible-section";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import { computeCapexDiagnostics } from "@/lib/capex-da-diagnostics";
import { computeCapexDaSchedule } from "@/lib/capex-da-engine";
import { computeRowValue } from "@/lib/calculations";
import {
  CAPEX_DEFAULT_BUCKET_IDS,
  CAPEX_IB_DEFAULT_USEFUL_LIVES,
  CAPEX_IB_TYPICAL_RANGE,
  CAPEX_HELPER_LAND_ID,
  CAPEX_HELPER_CIP_ID,
  isLegacyWrongUsefulLives,
} from "@/lib/capex-defaults";

const CAPEX_DEFAULT_BUCKET_LABELS: Record<string, string> = {
  cap_b1: "Land",
  cap_b2: "Buildings & Improvements",
  cap_b3: "Machinery & Equipment",
  cap_b4: "Computer Hardware",
  cap_b5: "Software (Capitalized)",
  cap_b6: "Furniture & Fixtures",
  cap_b7: "Leasehold Improvements",
  cap_b8: "Vehicles",
  cap_b9: "Construction in Progress (CIP)",
  cap_b10: "Other PP&E",
};

export default function CapexDaScheduleCard() {
  const meta = useModelStore((s) => s.meta);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns);

  const capexForecastMethod = useModelStore((s) => s.capexForecastMethod ?? "pct_revenue");
  const capexPctRevenue = useModelStore((s) => s.capexPctRevenue ?? 0);
  const capexManualByYear = useModelStore((s) => s.capexManualByYear ?? {});
  const capexGrowthPct = useModelStore((s) => s.capexGrowthPct ?? 0);
  const capexSplitByBucket = useModelStore((s) => s.capexSplitByBucket ?? true);
  const capexForecastBucketsIndependently = useModelStore((s) => s.capexForecastBucketsIndependently ?? false);
  const capexTimingConvention = useModelStore((s) => s.capexTimingConvention ?? "mid");
  const capexBucketAllocationPct = useModelStore((s) => s.capexBucketAllocationPct ?? {});
  const capexBucketLabels = useModelStore((s) => s.capexBucketLabels ?? {});

  const setCapexForecastMethod = useModelStore((s) => s.setCapexForecastMethod);
  const setCapexPctRevenue = useModelStore((s) => s.setCapexPctRevenue);
  const setCapexManualByYear = useModelStore((s) => s.setCapexManualByYear);
  const setCapexGrowthPct = useModelStore((s) => s.setCapexGrowthPct);
  const setCapexSplitByBucket = useModelStore((s) => s.setCapexSplitByBucket);
  const setCapexForecastBucketsIndependently = useModelStore((s) => s.setCapexForecastBucketsIndependently);
  const setCapexTimingConvention = useModelStore((s) => s.setCapexTimingConvention);
  const setCapexBucketAllocationPct = useModelStore((s) => s.setCapexBucketAllocationPct);
  const setCapexBucketLabel = useModelStore((s) => s.setCapexBucketLabel);
  const capexCustomBucketIds = useModelStore((s) => s.capexCustomBucketIds ?? []);
  const addCapexBucket = useModelStore((s) => s.addCapexBucket);
  const removeCapexBucket = useModelStore((s) => s.removeCapexBucket);

  const ppeUsefulLifeByBucket = useModelStore((s) => s.ppeUsefulLifeByBucket ?? {});
  const ppeUsefulLifeSingle = useModelStore((s) => s.ppeUsefulLifeSingle ?? 10);
  const capexModelIntangibles = useModelStore((s) => s.capexModelIntangibles ?? false);
  const intangiblesForecastMethod = useModelStore((s) => s.intangiblesForecastMethod ?? "pct_revenue");
  const intangiblesAmortizationLifeYears = useModelStore((s) => s.intangiblesAmortizationLifeYears ?? 7);
  const intangiblesPctRevenue = useModelStore((s) => s.intangiblesPctRevenue ?? 0);
  const intangiblesManualByYear = useModelStore((s) => s.intangiblesManualByYear ?? {});
  const intangiblesGrowthPct = useModelStore((s) => s.intangiblesGrowthPct ?? 0);

  const setPpeUsefulLifeByBucket = useModelStore((s) => s.setPpeUsefulLifeByBucket);
  const setPpeUsefulLifeSingle = useModelStore((s) => s.setPpeUsefulLifeSingle);
  const capexHistoricByBucketByYear = useModelStore((s) => s.capexHistoricByBucketByYear ?? {});
  const setCapexHistoricBucketYear = useModelStore((s) => s.setCapexHistoricBucketYear);
  const capexHelperPpeByBucketByYear = useModelStore((s) => s.capexHelperPpeByBucketByYear ?? {});
  const capexIncludeInAllocationByBucket = useModelStore((s) => s.capexIncludeInAllocationByBucket ?? {});
  const setCapexHelperPpeBucketYear = useModelStore((s) => s.setCapexHelperPpeBucketYear);
  const setCapexIncludeInAllocation = useModelStore((s) => s.setCapexIncludeInAllocation);
  const resetCapexHelperUsefulLivesToDefaults = useModelStore((s) => s.resetCapexHelperUsefulLivesToDefaults);
  const applyCapexHelperWeightsToForecast = useModelStore((s) => s.applyCapexHelperWeightsToForecast);
  const setCapexModelIntangibles = useModelStore((s) => s.setCapexModelIntangibles);
  const setIntangiblesForecastMethod = useModelStore((s) => s.setIntangiblesForecastMethod);
  const setIntangiblesAmortizationLifeYears = useModelStore((s) => s.setIntangiblesAmortizationLifeYears);
  const setIntangiblesPctRevenue = useModelStore((s) => s.setIntangiblesPctRevenue);
  const setIntangiblesManualByYear = useModelStore((s) => s.setIntangiblesManualByYear);
  const setIntangiblesGrowthPct = useModelStore((s) => s.setIntangiblesGrowthPct);

  const historicalYears = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const allYears = useMemo(() => [...historicalYears, ...projectionYears], [historicalYears, projectionYears]);
  const unit = meta?.currencyUnit ?? "millions";
  const unitLabel = getUnitLabel(unit);

  const allBucketIds = useMemo(
    () => [...CAPEX_DEFAULT_BUCKET_IDS, ...capexCustomBucketIds],
    [capexCustomBucketIds]
  );
  const bucketLabels = useMemo(
    () => ({ ...CAPEX_DEFAULT_BUCKET_LABELS, ...capexBucketLabels }),
    [capexBucketLabels]
  );
  const allocationSum = useMemo(
    () => allBucketIds.reduce((s, id) => s + (capexBucketAllocationPct[id] ?? 0), 0),
    [allBucketIds, capexBucketAllocationPct]
  );

  // When the Useful life by bucket / Capex Helper tables deploy with categories on, show IB defaults (seed if empty or legacy wrong values like 2, 1.5, 1)
  useEffect(() => {
    if (!capexSplitByBucket) return;
    const empty = !ppeUsefulLifeByBucket || Object.keys(ppeUsefulLifeByBucket).length === 0;
    const legacyWrong = isLegacyWrongUsefulLives(ppeUsefulLifeByBucket);
    if (empty || legacyWrong) {
      resetCapexHelperUsefulLivesToDefaults();
    }
  }, [capexSplitByBucket, ppeUsefulLifeByBucket, resetCapexHelperUsefulLivesToDefaults]);

  const lastHistYear = historicalYears.length > 0 ? historicalYears[historicalYears.length - 1] : null;
  const revenueByYear = useMemo(() => {
    const revRow = incomeStatement?.find((r) => r.id === "rev");
    if (!revRow || projectionYears.length === 0) return {} as Record<string, number>;
    const allSt = { incomeStatement: incomeStatement ?? [], balanceSheet: balanceSheet ?? [], cashFlow: cashFlow ?? [] };
    const out: Record<string, number> = {};
    for (const y of projectionYears) {
      try {
        out[y] = computeRowValue(revRow, y, incomeStatement ?? [], incomeStatement ?? [], allSt) ?? 0;
      } catch {
        out[y] = 0;
      }
    }
    return out;
  }, [incomeStatement, balanceSheet, cashFlow, projectionYears]);

  const lastHistPPE = useMemo(() => {
    if (!lastHistYear || !balanceSheet?.length) return 0;
    const row = balanceSheet.find((r) => r.id === "ppe");
    return row?.values?.[lastHistYear] ?? 0;
  }, [balanceSheet, lastHistYear]);
  const lastHistCapex = useMemo(() => {
    if (!lastHistYear || !cashFlow?.length) return 0;
    const row = cashFlow.find((r) => r.id === "capex");
    return row?.values?.[lastHistYear] ?? 0;
  }, [cashFlow, lastHistYear]);

  const effectiveUsefulLife = useMemo(() => {
    if (!capexSplitByBucket) return ppeUsefulLifeSingle;
    const lives = allBucketIds.map((id) => ppeUsefulLifeByBucket[id]).filter((n) => n != null && n > 0);
    if (lives.length === 0) return ppeUsefulLifeSingle;
    return lives.reduce((a, b) => a + b, 0) / lives.length;
  }, [capexSplitByBucket, ppeUsefulLifeSingle, ppeUsefulLifeByBucket, allBucketIds]);

  const historicCapexImpliedPct = useMemo(() => {
    const totalByYear: Record<string, number> = {};
    for (const y of historicalYears) {
      totalByYear[y] = allBucketIds.reduce((s, id) => s + (capexHistoricByBucketByYear[id]?.[y] ?? 0), 0);
    }
    const pctByBucketByYear: Record<string, Record<string, number>> = {};
    for (const id of allBucketIds) {
      pctByBucketByYear[id] = {};
      for (const y of historicalYears) {
        const total = totalByYear[y] ?? 0;
        const amt = capexHistoricByBucketByYear[id]?.[y] ?? 0;
        pctByBucketByYear[id][y] = total > 0 ? (amt / total) * 100 : 0;
      }
    }
    return { totalByYear, pctByBucketByYear };
  }, [allBucketIds, historicalYears, capexHistoricByBucketByYear]);

  const includeInAllocation = (id: string) =>
    capexIncludeInAllocationByBucket[id] ?? (id === CAPEX_HELPER_LAND_ID || id === CAPEX_HELPER_CIP_ID ? false : true);

  const revenueByYearHistoric = useMemo(() => {
    const revRow = incomeStatement?.find((r) => r.id === "rev");
    if (!revRow) return {} as Record<string, number>;
    const allSt = { incomeStatement: incomeStatement ?? [], balanceSheet: balanceSheet ?? [], cashFlow: cashFlow ?? [] };
    const out: Record<string, number> = {};
    for (const y of historicalYears) {
      try {
        out[y] = computeRowValue(revRow, y, incomeStatement ?? [], incomeStatement ?? [], allSt) ?? 0;
      } catch {
        out[y] = revRow.values?.[y] ?? 0;
      }
    }
    return out;
  }, [incomeStatement, balanceSheet, cashFlow, historicalYears]);

  const capexHelperComputed = useMemo(() => {
    const impliedMaintByBucketByYear: Record<string, Record<string, number>> = {};
    const totalImpliedMaintByYear: Record<string, number> = {};
    const weightByBucketByYear: Record<string, Record<string, number>> = {};
    const avgWeightByBucket: Record<string, number> = {};
    const impliedMaintPctRevenueByYear: Record<string, number> = {};

    for (const id of allBucketIds) {
      impliedMaintByBucketByYear[id] = {};
      weightByBucketByYear[id] = {};
      const isLand = id === CAPEX_HELPER_LAND_ID;
      const isCip = id === CAPEX_HELPER_CIP_ID;
      const life = ppeUsefulLifeByBucket[id] ?? CAPEX_IB_DEFAULT_USEFUL_LIVES[id] ?? 0;
      const included = includeInAllocation(id) && !isLand && (life > 0 || !isCip);

      for (const y of historicalYears) {
        const ppe = capexHelperPpeByBucketByYear[id]?.[y] ?? 0;
        let implied = 0;
        if (included && life > 0 && ppe > 0) implied = ppe / life;
        impliedMaintByBucketByYear[id][y] = implied;
      }
    }

    for (const y of historicalYears) {
      let total = 0;
      for (const id of allBucketIds) {
        if (includeInAllocation(id) && id !== CAPEX_HELPER_LAND_ID) {
          const life = ppeUsefulLifeByBucket[id] ?? CAPEX_IB_DEFAULT_USEFUL_LIVES[id] ?? 0;
          if (life > 0) total += impliedMaintByBucketByYear[id]?.[y] ?? 0;
        }
      }
      totalImpliedMaintByYear[y] = total;
      for (const id of allBucketIds) {
        const implied = impliedMaintByBucketByYear[id]?.[y] ?? 0;
        weightByBucketByYear[id][y] = total > 0 ? implied / total : 0;
      }
      const rev = revenueByYearHistoric[y] ?? 0;
      impliedMaintPctRevenueByYear[y] = rev > 0 ? (total / rev) * 100 : 0;
    }

    for (const id of allBucketIds) {
      const weights = historicalYears.map((y) => weightByBucketByYear[id]?.[y] ?? 0).filter((_, i) => (totalImpliedMaintByYear[historicalYears[i]] ?? 0) > 0);
      avgWeightByBucket[id] = weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : 0;
    }

    const yearsWithData = historicalYears.filter((y) => (totalImpliedMaintByYear[y] ?? 0) > 0);
    const includedBucketsWithData = allBucketIds.filter((id) => includeInAllocation(id) && id !== CAPEX_HELPER_LAND_ID && (ppeUsefulLifeByBucket[id] ?? CAPEX_IB_DEFAULT_USEFUL_LIVES[id] ?? 0) > 0 && historicalYears.some((y) => (capexHelperPpeByBucketByYear[id]?.[y] ?? 0) > 0));

    return {
      impliedMaintByBucketByYear,
      totalImpliedMaintByYear,
      weightByBucketByYear,
      avgWeightByBucket,
      impliedMaintPctRevenueByYear,
      yearsWithData,
      includedBucketsWithData,
    };
  }, [allBucketIds, historicalYears, capexHelperPpeByBucketByYear, ppeUsefulLifeByBucket, capexIncludeInAllocationByBucket, revenueByYearHistoric]);

  const scheduleOutput = useMemo(() => {
    if (projectionYears.length === 0) return null;
    return computeCapexDaSchedule({
      projectionYears,
      revenueByYear,
      lastHistPPE,
      lastHistCapex,
      method: capexForecastMethod,
      pctRevenue: capexPctRevenue,
      manualByYear: capexManualByYear,
      growthPct: capexGrowthPct,
      timingConvention: capexTimingConvention,
      usefulLifeYears: effectiveUsefulLife,
    });
  }, [
    projectionYears,
    revenueByYear,
    lastHistPPE,
    lastHistCapex,
    capexForecastMethod,
    capexPctRevenue,
    capexManualByYear,
    capexGrowthPct,
    capexTimingConvention,
    effectiveUsefulLife,
  ]);

  const diagnostics = useMemo(() => {
    if (historicalYears.length === 0 || !incomeStatement?.length || !balanceSheet?.length || !cashFlow?.length) {
      return null;
    }
    return computeCapexDiagnostics({
      incomeStatement: incomeStatement ?? [],
      balanceSheet: balanceSheet ?? [],
      cashFlow: cashFlow ?? [],
      historicalYears,
      danaBreakdowns: danaBreakdowns ?? undefined,
    });
  }, [incomeStatement, balanceSheet, cashFlow, historicalYears, danaBreakdowns]);

  const [section1Open, setSection1Open] = useState(true);
  const [section2Open, setSection2Open] = useState(true);
  const [section3Open, setSection3Open] = useState(true);
  const [section4Open, setSection4Open] = useState(true);

  const formatVal = (v: number) => {
    if (v === 0) return "—";
    const d = storedToDisplay(v, unit);
    return `${d.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 0 })}${unitLabel ? ` ${unitLabel}` : ""}`;
  };
  return (
    <CollapsibleSection
      sectionId="capex_da_schedule"
      title="Capex & D&A Schedule"
      description="Forecast capital expenditures and depreciation/amortization. Guided setup with historical diagnostics."
      colorClass="purple"
      defaultExpanded={true}
    >
      <p className="text-xs text-slate-500 mb-4">
        Four sections: (1) Historical diagnostics, (2) Capex forecast setup, (3) D&A setup, (4) Schedule output. Statement links to IS/BS/CF will be connected in a later phase.
      </p>

      {/* Section 1 — Historical Diagnostics */}
      <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3 mb-4">
        <button
          type="button"
          onClick={() => setSection1Open((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span className="text-slate-400">{section1Open ? "▾" : "▸"}</span>
          <span className="text-sm font-semibold text-slate-200">1. Historical Diagnostics</span>
        </button>
        {section1Open && (
          <div className="mt-3 space-y-4 pl-5">
            {!diagnostics ? (
              <p className="text-xs text-slate-500">Enter historical financials (Revenue, Capex, PP&E) to see diagnostics.</p>
            ) : (
              <>
                {/* A) Capex intensity */}
                <div>
                  <div className="text-xs font-medium text-slate-300 mb-1">Capex intensity (Capex % of Revenue)</div>
                  <div className="overflow-x-auto rounded border border-slate-700 bg-slate-950/60">
                    <table className="min-w-full border-collapse text-[11px] text-slate-200">
                      <thead className="bg-slate-800/80">
                        <tr>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-left">Year</th>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-right">Capex</th>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-right">Revenue</th>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-right">Capex % Rev</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnostics.capexIntensity.map((r) => (
                          <tr key={r.year} className="border-b border-slate-700/50 last:border-0">
                            <td className="px-2 py-1.5">{r.year}</td>
                            <td className="px-2 py-1.5 text-right">{formatVal(r.capex)}</td>
                            <td className="px-2 py-1.5 text-right">{formatVal(r.revenue)}</td>
                            <td className="px-2 py-1.5 text-right text-purple-200">
                              {r.capexPctRevenue != null ? `${r.capexPctRevenue.toFixed(1)}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {diagnostics.recommendedCapexPctRevenue != null && (
                    <div className="mt-1.5 inline-flex items-center gap-2 rounded-full border border-purple-500/50 bg-purple-950/30 px-2 py-0.5 text-[10px] text-purple-200">
                      Recommended starting assumption (last 2-year avg): <strong>{diagnostics.recommendedCapexPctRevenue.toFixed(1)}%</strong> of Revenue
                      {diagnostics.capexTrend && (
                        <span className="text-slate-400">
                          · Trend: {diagnostics.capexTrend === "up" ? "↑" : diagnostics.capexTrend === "down" ? "↓" : "→"}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* B) Implied / Observed D&A */}
                <div>
                  <div className="text-xs font-medium text-slate-300 mb-1">Depreciation & Amortization (D&A)</div>
                  {diagnostics.hasObservedDanda ? (
                    <div className="text-[11px] text-slate-300">
                      Observed D&A from Income Statement (by year):{" "}
                      {historicalYears.map((y) => `${y}: ${formatVal(diagnostics.observedDandaByYear[y] ?? 0)}`).join(" · ")}
                    </div>
                  ) : diagnostics.hasImpliedDanda ? (
                    <div>
                      <div className="text-[11px] text-amber-200/90 mb-0.5">Estimated D&A (approximate, from PP&E roll-forward: Beginning PP&E + Capex − Ending PP&E)</div>
                      <div className="text-[11px] text-slate-300">
                        {historicalYears.map((y) => `${y}: ${formatVal(diagnostics.impliedDandaByYear[y] ?? 0)}`).join(" · ")}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">No D&A or PP&E data available to estimate.</p>
                  )}
                </div>

                {/* C) PP&E intensity */}
                <div>
                  <div className="text-xs font-medium text-slate-300 mb-1">PP&E intensity (PP&E / Revenue)</div>
                  <div className="overflow-x-auto rounded border border-slate-700 bg-slate-950/60">
                    <table className="min-w-full border-collapse text-[11px] text-slate-200">
                      <thead className="bg-slate-800/80">
                        <tr>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-left">Year</th>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-right">PP&E</th>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-right">Revenue</th>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-right">PP&E % Rev</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnostics.ppeIntensity.map((r) => (
                          <tr key={r.year} className="border-b border-slate-700/50 last:border-0">
                            <td className="px-2 py-1.5">{r.year}</td>
                            <td className="px-2 py-1.5 text-right">{formatVal(r.ppe)}</td>
                            <td className="px-2 py-1.5 text-right">{formatVal(r.revenue)}</td>
                            <td className="px-2 py-1.5 text-right text-purple-200">
                              {r.ppePctRevenue != null ? `${r.ppePctRevenue.toFixed(1)}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* D) Intangibles */}
                <div>
                  <div className="text-xs font-medium text-slate-300 mb-1">Intangibles (Intangibles / Revenue)</div>
                  <div className="overflow-x-auto rounded border border-slate-700 bg-slate-950/60">
                    <table className="min-w-full border-collapse text-[11px] text-slate-200">
                      <thead className="bg-slate-800/80">
                        <tr>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-left">Year</th>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-right">Intangibles</th>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-right">Revenue</th>
                          <th className="border-b border-slate-600 px-2 py-1.5 text-right">Intang. % Rev</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnostics.intangiblesIntensity.map((r) => (
                          <tr key={r.year} className="border-b border-slate-700/50 last:border-0">
                            <td className="px-2 py-1.5">{r.year}</td>
                            <td className="px-2 py-1.5 text-right">{formatVal(r.intangibles)}</td>
                            <td className="px-2 py-1.5 text-right">{formatVal(r.revenue)}</td>
                            <td className="px-2 py-1.5 text-right text-purple-200">
                              {r.intangiblesPctRevenue != null ? `${r.intangiblesPctRevenue.toFixed(1)}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Section 2 — Capex Forecast Setup */}
      <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3 mb-4">
        <button
          type="button"
          onClick={() => setSection2Open((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span className="text-slate-400">{section2Open ? "▾" : "▸"}</span>
          <span className="text-sm font-semibold text-slate-200">2. Capex Forecast Setup</span>
        </button>
        {section2Open && (
          <div className="mt-3 pl-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Forecast method</label>
              <select
                value={capexForecastMethod}
                onChange={(e) => setCapexForecastMethod(e.target.value as "pct_revenue" | "manual" | "growth")}
                className="w-full max-w-xs rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-200"
              >
                <option value="pct_revenue">% of Revenue</option>
                <option value="manual">Manual by year</option>
                <option value="growth">Growth rate</option>
              </select>
            </div>
            {capexForecastMethod === "pct_revenue" && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Capex % of Revenue</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={capexPctRevenue || ""}
                  onChange={(e) => setCapexPctRevenue(parseFloat(e.target.value) || 0)}
                  placeholder={diagnostics?.recommendedCapexPctRevenue != null ? `${diagnostics.recommendedCapexPctRevenue.toFixed(1)} (from diagnostics)` : "e.g. 3"}
                  className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-200"
                />
                <span className="ml-2 text-xs text-slate-400">%</span>
                {capexSplitByBucket && (
                  <p className="text-[11px] text-slate-500 mt-1">Total Capex = Revenue × this %. If you use categories below, that total is split by allocation %.</p>
                )}
              </div>
            )}
            {capexForecastMethod === "manual" && projectionYears.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Total Capex by year ({unitLabel})</label>
                <p className="text-[11px] text-slate-500 mb-1.5">Enter total Capex for each projection year. If you use categories below, this total is split across buckets by allocation %. Most models use % of Revenue or growth; manual is for specific cases.</p>
                <div className="flex flex-wrap gap-2">
                  {projectionYears.map((y) => (
                    <div key={y} className="flex items-center gap-1">
                      <span className="text-[11px] text-slate-500 w-10">{y}</span>
                      <input
                        type="number"
                        step={0.01}
                        value={capexManualByYear[y] ?? ""}
                        onChange={(e) => setCapexManualByYear(y, parseFloat(e.target.value) || 0)}
                        className="w-20 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-200"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {capexForecastMethod === "growth" && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Capex growth rate (YoY %)</label>
                {lastHistCapex != null && lastHistCapex !== 0 && (
                  <p className="text-[11px] text-slate-500 mb-1">Base (last historic): {formatVal(Math.abs(lastHistCapex))}. Growth applies from there.</p>
                )}
                <input
                  type="number"
                  step={0.1}
                  value={capexGrowthPct || ""}
                  onChange={(e) => setCapexGrowthPct(parseFloat(e.target.value) || 0)}
                  placeholder="e.g. 5"
                  className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-200"
                />
                <span className="ml-2 text-xs text-slate-400">%</span>
                {capexSplitByBucket && (
                  <p className="text-[11px] text-slate-500 mt-1">One growth rate for total Capex. If you use categories below, that total is split by allocation %.</p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={capexSplitByBucket}
                  onChange={(e) => setCapexSplitByBucket(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-800"
                />
                Use categories (buckets) — split total Capex by allocation % and set useful life per bucket in Section 3
              </label>
              <p className="text-[11px] text-slate-500 pl-6">Same forecast method above drives total Capex; allocation % below splits it across Land, Buildings, Technology, etc. Useful life is always set in Section 3 (one value or per bucket).</p>
            </div>
            {capexSplitByBucket && (
              <div>
                <p className="text-[11px] text-slate-500 mb-1.5">Allocate the total Capex across buckets. Weights must sum to 100%.</p>
                <div className="text-xs font-medium text-slate-300 mb-1">Bucket allocation (% of total Capex)</div>
                <div className="rounded border border-slate-700 bg-slate-950/60 overflow-hidden">
                  <table className="min-w-full text-[11px] text-slate-200">
                    <thead className="bg-slate-800/80">
                      <tr>
                        <th className="border-b border-slate-600 px-2 py-1 text-left">Bucket</th>
                        <th className="border-b border-slate-600 px-2 py-1 text-right">%</th>
                        <th className="border-b border-slate-600 px-2 py-1 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {allBucketIds.map((id) => {
                        const isCustom = capexCustomBucketIds.includes(id);
                        return (
                          <tr key={id} className="border-b border-slate-700/50 last:border-0">
                            <td className="px-2 py-1">
                              {isCustom ? (
                                <input
                                  type="text"
                                  value={bucketLabels[id] ?? ""}
                                  onChange={(e) => setCapexBucketLabel(id, e.target.value)}
                                  placeholder="Category name"
                                  className="w-full max-w-[140px] rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-slate-200"
                                />
                              ) : (
                                bucketLabels[id] ?? id
                              )}
                            </td>
                            <td className="px-2 py-1">
                              <input
                                type="number"
                                step={0.1}
                                min={0}
                                max={100}
                                value={capexBucketAllocationPct[id] ?? ""}
                                onChange={(e) => setCapexBucketAllocationPct(id, parseFloat(e.target.value) || 0)}
                                className="w-14 rounded border border-slate-600 bg-slate-800 px-1 text-right text-slate-200"
                              />
                              %
                            </td>
                            <td className="px-2 py-1">
                              {isCustom ? (
                                <button
                                  type="button"
                                  onClick={() => removeCapexBucket(id)}
                                  className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-950/50 hover:text-red-300"
                                  title="Remove category"
                                >
                                  Remove
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between px-2 py-1.5 text-[10px] border-t border-slate-700">
                    <span className="text-slate-500">
                      Total: {allocationSum.toFixed(1)}%
                      {Math.abs(allocationSum - 100) > 0.5 && (
                        <span className="text-amber-400 ml-1">(should be 100%)</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => addCapexBucket()}
                      className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                    >
                      + Add category
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Timing convention</label>
              <div className="flex gap-2">
                {(["mid", "start", "end"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setCapexTimingConvention(t)}
                    className={`rounded px-2 py-1 text-xs ${capexTimingConvention === t ? "bg-purple-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}
                  >
                    {t === "mid" ? "Mid-year" : t === "start" ? "Start of period" : "End of period"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Section 3 — D&A Setup */}
      <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3 mb-4">
        <button
          type="button"
          onClick={() => setSection3Open((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span className="text-slate-400">{section3Open ? "▾" : "▸"}</span>
          <span className="text-sm font-semibold text-slate-200">3. Depreciation / Amortization Setup</span>
        </button>
        {section3Open && (
          <div className="mt-3 pl-5 space-y-4">
            <p className="text-[11px] text-slate-400">Useful life is always required for D&A: one value when forecasting total Capex, or per bucket when using categories in Section 2.</p>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">PP&E useful life (years)</label>
              {capexSplitByBucket ? (
                <p className="text-[11px] text-slate-500 mb-1">You're using categories; set useful life for each bucket below.</p>
              ) : (
                <p className="text-[11px] text-slate-500 mb-1">One useful life applies to total Capex. Turn on categories in Section 2 to set useful life per bucket.</p>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={0.5}
                  min={0.5}
                  value={capexSplitByBucket ? "" : (ppeUsefulLifeSingle || "")}
                  onChange={(e) => setPpeUsefulLifeSingle(parseFloat(e.target.value) || 0)}
                  disabled={capexSplitByBucket}
                  placeholder={capexSplitByBucket ? "Set per bucket below" : "e.g. 10"}
                  className="w-20 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-200 disabled:opacity-50"
                />
                <span className="text-xs text-slate-400">years</span>
              </div>
            </div>
            {capexSplitByBucket && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Useful life by bucket (years)</label>
                <div className="rounded border border-slate-700 bg-slate-950/60 overflow-hidden">
                  <table className="min-w-full text-[11px] text-slate-200">
                    <thead className="bg-slate-800/80">
                      <tr>
                        <th className="border-b border-slate-600 px-2 py-1 text-left">Bucket</th>
                        <th className="border-b border-slate-600 px-2 py-1 text-right">Years</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allBucketIds.map((id) => {
                        const isLand = id === CAPEX_HELPER_LAND_ID;
                        const isCip = id === CAPEX_HELPER_CIP_ID;
                        const stored = ppeUsefulLifeByBucket[id];
                        const displayYears = stored !== undefined && stored !== null
                          ? stored
                          : (CAPEX_IB_DEFAULT_USEFUL_LIVES[id] ?? "");
                        return (
                          <tr key={id} className="border-b border-slate-700/50 last:border-0">
                            <td className="px-2 py-1">{bucketLabels[id] ?? id}</td>
                            <td className="px-2 py-1">
                              {isLand || isCip ? (
                                <span className="text-slate-500">N/A</span>
                              ) : (
                                <input
                                  type="number"
                                  step={0.5}
                                  min={0.5}
                                  value={typeof displayYears === "number" ? displayYears : ""}
                                  onChange={(e) => setPpeUsefulLifeByBucket(id, parseFloat(e.target.value) || 0)}
                                  placeholder={CAPEX_IB_TYPICAL_RANGE[id] ?? "e.g. 10"}
                                  title={CAPEX_IB_TYPICAL_RANGE[id] ? `Typical range: ${CAPEX_IB_TYPICAL_RANGE[id]} years` : undefined}
                                  className="w-16 rounded border border-slate-600 bg-slate-800 px-1 text-right text-slate-200"
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {capexSplitByBucket && historicalYears.length > 0 && (
              <div className="rounded border border-amber-800/40 bg-amber-950/20 p-3">
                <p className="text-xs font-semibold text-amber-200 mb-0.5">Capex Allocation Helper (Optional)</p>
                <p className="text-[11px] text-slate-400 mb-2">
                  Used only to guide allocation. We estimate weights using <strong>asset replacement cycles</strong> (PP&E ÷ useful life), not by asset balance — a smaller category with shorter life (e.g. IT) can require more capex.
                </p>
                {capexHelperComputed.yearsWithData.length === 0 && (
                  <p className="text-[11px] text-amber-300/90 mb-2">No data entered — enter Historical PP&E by bucket below to compute weights.</p>
                )}
                {capexHelperComputed.yearsWithData.length > 0 && capexHelperComputed.includedBucketsWithData.length === 1 && (
                  <p className="text-[11px] text-amber-300/90 mb-2">Only one bucket has data — weight will be 100% for that bucket.</p>
                )}
                {!includeInAllocation(CAPEX_HELPER_LAND_ID) && (
                  <p className="text-[11px] text-slate-500 mb-2" title="Land is non-depreciable and typically not replaced, so we exclude it from maintenance capex allocation.">Land excluded from allocation (non-depreciable).</p>
                )}
                {includeInAllocation(CAPEX_HELPER_LAND_ID) && (
                  <p className="text-[11px] text-amber-300 mb-2">Land is included in allocation. Land is typically non-depreciable and excluded; consider unchecking Include for Land.</p>
                )}
                <div className="overflow-x-auto rounded border border-slate-700 bg-slate-950/60 max-h-[320px] overflow-y-auto">
                  <table className="min-w-full text-[11px] text-slate-200">
                    <thead className="bg-slate-800/80 sticky top-0">
                      <tr>
                        <th className="border-b border-slate-600 px-2 py-1 text-left w-36">Bucket</th>
                        {historicalYears.map((y) => (
                          <th key={y} className="border-b border-slate-600 px-2 py-1 text-right">PP&E {y}</th>
                        ))}
                        <th className="border-b border-slate-600 px-2 py-1 text-right">Life (y)</th>
                        <th className="border-b border-slate-600 px-2 py-1 text-center">Include</th>
                        <th className="border-b border-slate-600 px-2 py-1 text-right text-amber-200">Avg weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allBucketIds.map((id) => {
                        const isLand = id === CAPEX_HELPER_LAND_ID;
                        const isCip = id === CAPEX_HELPER_CIP_ID;
                        const life = ppeUsefulLifeByBucket[id] ?? CAPEX_IB_DEFAULT_USEFUL_LIVES[id] ?? 0;
                        const included = includeInAllocation(id);
                        const avgW = capexHelperComputed.avgWeightByBucket[id] ?? 0;
                        return (
                          <tr key={id} className="border-b border-slate-700/50">
                            <td className="px-2 py-1">
                              <input
                                type="text"
                                value={bucketLabels[id] ?? ""}
                                onChange={(e) => setCapexBucketLabel(id, e.target.value)}
                                placeholder={CAPEX_DEFAULT_BUCKET_LABELS[id] ?? id}
                                title={isLand ? "Land is non-depreciable and typically not replaced; excluded from allocation by default." : isCip ? "CIP is usually not depreciated until placed in service; excluded by default." : undefined}
                                className="w-full rounded border border-slate-600 bg-slate-800 px-1 text-slate-200"
                              />
                            </td>
                            {historicalYears.map((y) => (
                              <td key={y} className="px-2 py-1">
                                <input
                                  type="number"
                                  step={0.01}
                                  min={0}
                                  value={capexHelperPpeByBucketByYear[id]?.[y] ?? ""}
                                  onChange={(e) => setCapexHelperPpeBucketYear(id, y, parseFloat(e.target.value) || 0)}
                                  className="w-14 rounded border border-slate-600 bg-slate-800 px-1 text-right text-slate-200"
                                />
                              </td>
                            ))}
                            <td className="px-2 py-1 text-right">
                              {isLand || isCip ? (
                                <span className="text-slate-500">N/A</span>
                              ) : (
                                <input
                                  type="number"
                                  step={0.5}
                                  min={0}
                                  value={life > 0 ? life : ""}
                                  onChange={(e) => setPpeUsefulLifeByBucket(id, parseFloat(e.target.value) || 0)}
                                  placeholder={CAPEX_IB_TYPICAL_RANGE[id] ?? "y"}
                                  title={CAPEX_IB_TYPICAL_RANGE[id] ? `Typical range: ${CAPEX_IB_TYPICAL_RANGE[id]} years` : undefined}
                                  className="w-10 rounded border border-slate-600 bg-slate-800 px-1 text-right text-slate-200"
                                />
                              )}
                            </td>
                            <td className="px-2 py-1 text-center">
                              <input
                                type="checkbox"
                                checked={included}
                                onChange={(e) => setCapexIncludeInAllocation(id, e.target.checked)}
                                className="rounded border-slate-600 bg-slate-800"
                                title={isLand ? "Land is typically excluded (non-depreciable)." : isCip ? "CIP excluded by default." : "Include in allocation"}
                              />
                            </td>
                            <td className="px-2 py-1 text-right text-amber-200">
                              {included && !isLand ? `${(avgW * 100).toFixed(1)}%` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {capexHelperComputed.yearsWithData.length > 0 && (
                  <div className="mt-2 space-y-0.5 text-[11px] text-slate-400">
                    {historicalYears.map((y) => {
                      const pct = capexHelperComputed.impliedMaintPctRevenueByYear[y] ?? 0;
                      if (pct <= 0) return null;
                      return (
                        <div key={y}>
                          <strong className="text-slate-300">{y}</strong>: Implied maintenance capex as % of revenue = {(pct).toFixed(2)}%
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={resetCapexHelperUsefulLivesToDefaults}
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
                  >
                    Reset useful lives to defaults
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const sum = allBucketIds.reduce((s, id) => s + (includeInAllocation(id) && id !== CAPEX_HELPER_LAND_ID ? capexHelperComputed.avgWeightByBucket[id] ?? 0 : 0), 0);
                      if (sum <= 0) return;
                      const weightsPct: Record<string, number> = {};
                      allBucketIds.forEach((id) => {
                        const raw = includeInAllocation(id) && id !== CAPEX_HELPER_LAND_ID ? ((capexHelperComputed.avgWeightByBucket[id] ?? 0) / sum) * 100 : 0;
                        weightsPct[id] = Math.round(raw * 10) / 10;
                      });
                      applyCapexHelperWeightsToForecast(weightsPct);
                    }}
                    disabled={capexHelperComputed.yearsWithData.length === 0}
                    className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Apply weights to forecast Capex buckets
                  </button>
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={capexModelIntangibles}
                onChange={(e) => setCapexModelIntangibles(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800"
              />
              Model Intangibles & Amortization
            </label>
            {capexModelIntangibles && (
              <div className="space-y-3 pl-2 border-l-2 border-purple-500/30">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Intangibles forecast method</label>
                  <select
                    value={intangiblesForecastMethod}
                    onChange={(e) => setIntangiblesForecastMethod(e.target.value as "pct_revenue" | "manual" | "growth")}
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-200"
                  >
                    <option value="pct_revenue">% of Revenue</option>
                    <option value="manual">Manual by year</option>
                    <option value="growth">Growth rate</option>
                  </select>
                </div>
                {intangiblesForecastMethod === "pct_revenue" && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">Intangibles % of Revenue</label>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={intangiblesPctRevenue || ""}
                      onChange={(e) => setIntangiblesPctRevenue(parseFloat(e.target.value) || 0)}
                      className="w-20 rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
                    />
                    %
                  </div>
                )}
                {intangiblesForecastMethod === "manual" && projectionYears.length > 0 && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">Intangibles by year</label>
                    <div className="flex flex-wrap gap-1">
                      {projectionYears.map((y) => (
                        <input
                          key={y}
                          type="number"
                          step={0.01}
                          value={intangiblesManualByYear[y] ?? ""}
                          onChange={(e) => setIntangiblesManualByYear(y, parseFloat(e.target.value) || 0)}
                          className="w-16 rounded border border-slate-600 bg-slate-800 px-1 text-[11px] text-slate-200"
                          placeholder={y}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {intangiblesForecastMethod === "growth" && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">Intangibles growth %</label>
                    <input
                      type="number"
                      step={0.1}
                      value={intangiblesGrowthPct || ""}
                      onChange={(e) => setIntangiblesGrowthPct(parseFloat(e.target.value) || 0)}
                      className="w-20 rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
                    />
                    %
                  </div>
                )}
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">Amortization useful life (years)</label>
                  <input
                    type="number"
                    step={0.5}
                    min={0.5}
                    value={intangiblesAmortizationLifeYears || ""}
                    onChange={(e) => setIntangiblesAmortizationLifeYears(parseFloat(e.target.value) || 0)}
                    className="w-20 rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 4 — Schedule Output */}
      <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3">
        <button
          type="button"
          onClick={() => setSection4Open((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span className="text-slate-400">{section4Open ? "▾" : "▸"}</span>
          <span className="text-sm font-semibold text-slate-200">4. Schedule Output</span>
        </button>
        {section4Open && (
          <div className="mt-3 pl-5">
            {!scheduleOutput ? (
              <p className="text-xs text-slate-500">Set projection years and Capex/D&A inputs above to see the schedule.</p>
            ) : (
              <div className="overflow-x-auto rounded border border-slate-700 bg-slate-950/60">
                <table className="min-w-full border-collapse text-[11px] text-slate-200">
                  <thead className="bg-slate-800/80">
                    <tr>
                      <th className="border-b border-slate-600 px-2 py-1.5 text-left font-medium">Line</th>
                      {lastHistYear && (
                        <th className="border-b border-slate-600 px-2 py-1.5 text-right text-blue-400">{lastHistYear}</th>
                      )}
                      {projectionYears.map((y) => (
                        <th key={y} className="border-b border-slate-600 px-2 py-1.5 text-right">{y}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-700/50">
                      <td className="px-2 py-1.5 font-medium">Capex</td>
                      {lastHistYear && (
                        <td className="px-2 py-1.5 text-right text-blue-400">{formatVal(Math.abs(lastHistCapex))}</td>
                      )}
                      {projectionYears.map((y) => (
                        <td key={y} className="px-2 py-1.5 text-right">
                          {formatVal(scheduleOutput.capexByYear[y] ?? 0)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-700/50">
                      <td className="px-2 py-1.5 font-medium">D&A</td>
                      {lastHistYear && <td className="px-2 py-1.5 text-right text-blue-400">—</td>}
                      {projectionYears.map((y) => (
                        <td key={y} className="px-2 py-1.5 text-right">
                          {formatVal(scheduleOutput.dandaByYear[y] ?? 0)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-700/50 last:border-0">
                      <td className="px-2 py-1.5 font-medium">Ending PP&E</td>
                      {lastHistYear && (
                        <td className="px-2 py-1.5 text-right text-blue-400">{formatVal(lastHistPPE)}</td>
                      )}
                      {projectionYears.map((y) => (
                        <td key={y} className="px-2 py-1.5 text-right">
                          {formatVal(scheduleOutput.ppeByYear[y] ?? 0)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
