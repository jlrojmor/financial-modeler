"use client";

import { useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { CurrencyUnit } from "@/store/useModelStore";
import { computeRowValue } from "@/lib/calculations";
import {
  getWcScheduleItems,
  getDaysBaseForItemId,
  computeHistoricDays,
  computeHistoricPct,
  buildWcProjectedBalancesMatrix,
  type WcDriverState,
} from "@/lib/working-capital-schedule";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import { computeProjectedRevCogs } from "@/lib/projected-ebit";
import { findRowInTree } from "@/lib/row-utils";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtVal(v: number, unit: CurrencyUnit): string {
  if (v === 0 || !Number.isFinite(v)) return "—";
  const d = storedToDisplay(v, unit);
  const lbl = getUnitLabel(unit);
  return `${d.toLocaleString(undefined, { maximumFractionDigits: 0 })}${lbl ? ` ${lbl}` : ""}`;
}

function fmtDriver(
  val: number,
  rev: number,
  cogs: number,
  driver: string,
  daysBase: "revenue" | "cogs"
): string {
  if (!Number.isFinite(val) || val === 0) return "—";
  if (driver === "days") {
    const denom = daysBase === "revenue" ? rev : cogs;
    if (denom <= 0) return "—";
    const days = (val / denom) * 365;
    return `${days.toFixed(1)} d`;
  }
  const denom = driver === "pct_cogs" ? cogs : rev;
  if (denom <= 0) return "—";
  const pct = (val / denom) * 100;
  return `${pct.toFixed(1)}%`;
}

// ─── component ────────────────────────────────────────────────────────────────

export default function WcDriversPreview() {
  const meta = useModelStore((s) => s.meta);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const incomeStatement = useModelStore((s) => s.incomeStatement);

  const revenueForecastConfigV1 = useModelStore((s) => s.revenueForecastConfigV1);
  const revenueForecastTreeV1 = useModelStore((s) => s.revenueForecastTreeV1);
  const revenueProjectionConfig = useModelStore((s) => s.revenueProjectionConfig);
  const cogsForecastConfigV1 = useModelStore((s) => s.cogsForecastConfigV1);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns ?? {});
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns ?? {});

  const wcDriverTypeByItemId = useModelStore((s) => s.wcDriverTypeByItemId ?? {});
  const wcDaysByItemId = useModelStore((s) => s.wcDaysByItemId ?? {});
  const wcDaysByItemIdByYear = useModelStore((s) => s.wcDaysByItemIdByYear ?? {});
  const wcDaysBaseByItemId = useModelStore((s) => s.wcDaysBaseByItemId ?? {});
  const wcPctBaseByItemId = useModelStore((s) => s.wcPctBaseByItemId ?? {});
  const wcPctByItemId = useModelStore((s) => s.wcPctByItemId ?? {});
  const wcPctByItemIdByYear = useModelStore((s) => s.wcPctByItemIdByYear ?? {});
  const wcDriversConfirmed = useModelStore((s) => s.wcDriversConfirmed ?? false);

  const unit = (meta?.currencyUnit ?? "millions") as CurrencyUnit;
  const historicYears = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const allYears = useMemo(() => [...historicYears, ...projectionYears], [historicYears, projectionYears]);
  const lastHistoricYear = historicYears[historicYears.length - 1] ?? null;

  const wcItems = useMemo(
    () => getWcScheduleItems(cashFlow ?? [], balanceSheet ?? []),
    [cashFlow, balanceSheet]
  );

  const allStatements = useMemo(
    () => ({
      incomeStatement: incomeStatement ?? [],
      balanceSheet: balanceSheet ?? [],
      cashFlow: cashFlow ?? [],
    }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  // Revenue + COGS by year: historical from IS rows, projected from forecast engines
  const { revByYear, cogsByYear } = useMemo(() => {
    const histRevByYear: Record<string, number> = {};
    const histCogsByYear: Record<string, number> = {};
    const revRow = findRowInTree(incomeStatement ?? [], "rev");
    const cogsRow = findRowInTree(incomeStatement ?? [], "cogs");
    for (const y of historicYears) {
      try {
        if (revRow) histRevByYear[y] = computeRowValue(revRow, y, incomeStatement ?? [], incomeStatement ?? [], allStatements);
        if (cogsRow) histCogsByYear[y] = Math.abs(computeRowValue(cogsRow, y, incomeStatement ?? [], incomeStatement ?? [], allStatements));
      } catch { /* noop */ }
    }

    if (projectionYears.length === 0 || !lastHistoricYear) {
      return { revByYear: histRevByYear, cogsByYear: histCogsByYear };
    }

    const { revByYear: projRev, cogsByYear: projCogs } = computeProjectedRevCogs({
      incomeStatement: incomeStatement ?? [],
      projectionYears,
      lastHistoricYear,
      revenueForecastConfigV1,
      revenueForecastTreeV1: revenueForecastTreeV1 ?? [],
      revenueProjectionConfig,
      cogsForecastConfigV1,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
      currencyUnit: unit,
    });

    return {
      revByYear: { ...histRevByYear, ...projRev },
      cogsByYear: { ...histCogsByYear, ...projCogs },
    };
  }, [
    incomeStatement,
    historicYears,
    projectionYears,
    lastHistoricYear,
    revenueForecastConfigV1,
    revenueForecastTreeV1,
    revenueProjectionConfig,
    cogsForecastConfigV1,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
    unit,
  ]);

  const driverState: WcDriverState = useMemo(
    () => ({
      wcDriverTypeByItemId,
      wcDaysByItemId,
      wcDaysByItemIdByYear,
      wcDaysBaseByItemId,
      wcPctBaseByItemId,
      wcPctByItemId,
      wcPctByItemIdByYear,
    }),
    [
      wcDriverTypeByItemId,
      wcDaysByItemId,
      wcDaysByItemIdByYear,
      wcDaysBaseByItemId,
      wcPctBaseByItemId,
      wcPctByItemId,
      wcPctByItemIdByYear,
    ]
  );

  const { projectedBalances } = useMemo(
    () =>
      buildWcProjectedBalancesMatrix({
        wcItems,
        balanceSheet: balanceSheet ?? [],
        years: allYears,
        historicalYears: historicYears,
        projectionYears,
        driverState,
        revByYear,
        cogsByYear,
        unionBsValueKeys: true,
      }),
    [wcItems, balanceSheet, allYears, historicYears, projectionYears, driverState, revByYear, cogsByYear]
  );

  // NWC = sum(asset balances) - sum(liability balances)
  const nwcByYear = useMemo(() => {
    const out: Record<string, number> = {};
    for (const y of allYears) {
      let assets = 0;
      let liabs = 0;
      for (const item of wcItems) {
        const v = projectedBalances[item.id]?.[y] ?? 0;
        if (item.side === "asset") assets += v;
        else liabs += v;
      }
      out[y] = assets - liabs;
    }
    return out;
  }, [wcItems, projectedBalances, allYears]);

  // ΔNWC by year (positive ΔNWC = use of cash; negative = source)
  const deltaNwcByYear = useMemo(() => {
    const out: Record<string, number> = {};
    for (let i = 0; i < allYears.length; i++) {
      const y = allYears[i];
      const prev = i > 0 ? allYears[i - 1] : null;
      out[y] = prev != null ? (nwcByYear[y] ?? 0) - (nwcByYear[prev] ?? 0) : 0;
    }
    return out;
  }, [nwcByYear, allYears]);

  const hasProjRevenue = projectionYears.some((y) => (revByYear[y] ?? 0) !== 0);

  return (
    <section className="h-full w-full rounded-xl border border-slate-800 bg-slate-950/50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-4 pb-3 border-b border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Working Capital Preview</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="text-slate-300">Forecast Drivers · Working Capital</span>
              {meta?.companyName && (
                <>
                  {" · "}
                  <span className="text-slate-300">{meta.companyName}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {wcDriversConfirmed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
                ✓ Active
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/40 text-amber-300 border border-amber-800/40">
                Pending
              </span>
            )}
          </div>
        </div>
      </div>

      {/* No WC items state */}
      {wcItems.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div className="space-y-2">
            <p className="text-sm text-slate-400">No working capital items detected.</p>
            <p className="text-[11px] text-slate-600">
              Add operating current assets/liabilities to your Balance Sheet to see projections here.
            </p>
          </div>
        </div>
      )}

      {wcItems.length > 0 && (
        <div className="flex-1 overflow-y-auto overflow-x-auto p-4 space-y-5">
          {/* Revenue availability warning */}
          {!hasProjRevenue && projectionYears.length > 0 && (
            <div className="rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2">
              <p className="text-[11px] text-amber-300/90">
                <span className="font-semibold">Heads up:</span> Configure your Revenue forecast in the Revenue tab first — projected WC balances
                that use Days or % methods depend on forecasted revenue and COGS.
              </p>
            </div>
          )}

          {/* WC Balances Table */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-300">WC Balance Sheet by Year</h3>
            <div className="overflow-x-auto rounded border border-slate-800 bg-slate-950/40">
              <table className="min-w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="px-3 py-2 text-left text-slate-400 font-medium min-w-[140px]">Line item</th>
                    <th className="px-2 py-2 text-left text-slate-500 font-medium text-[10px]">Method</th>
                    {allYears.map((y) => (
                      <th
                        key={y}
                        className={`px-2 py-2 text-right font-medium whitespace-nowrap ${
                          y.endsWith("A")
                            ? "text-slate-400"
                            : "text-blue-400/80"
                        }`}
                      >
                        {y}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Asset items */}
                  {wcItems.filter((i) => i.side === "asset").length > 0 && (
                    <tr className="border-b border-slate-800/60">
                      <td
                        colSpan={3 + allYears.length}
                        className="px-3 py-1 text-[10px] font-semibold text-emerald-300/70 uppercase tracking-wide bg-emerald-950/10"
                      >
                        Operating current assets
                      </td>
                    </tr>
                  )}
                  {wcItems
                    .filter((i) => i.side === "asset")
                    .map((item) => {
                      const driver = wcDriverTypeByItemId[item.id];
                      const effectiveDriver = driver && driver !== "manual" ? driver : null;
                      const daysBase =
                        wcDaysBaseByItemId[item.id] ?? getDaysBaseForItemId(item.id, item.label);
                      const methodLabel = !effectiveDriver
                        ? "Manual"
                        : effectiveDriver === "days"
                        ? daysBase === "revenue"
                          ? "DSO"
                          : "DIO"
                        : effectiveDriver === "pct_revenue"
                        ? "% Rev"
                        : "% COGS";

                      return (
                        <tr key={item.id} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                          <td className="px-3 py-2 font-medium">
                            <span className="flex items-baseline gap-1.5">
                              <span className="text-[9px] font-mono font-bold text-emerald-400/70 shrink-0">(+)</span>
                              <span className="text-slate-300">{item.label}</span>
                            </span>
                          </td>
                          <td className="px-2 py-2 text-slate-500 text-[10px]">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                              {methodLabel}
                            </span>
                          </td>
                          {allYears.map((y) => {
                            const val = projectedBalances[item.id]?.[y] ?? 0;
                            const isProj = y.endsWith("E");
                            const driverMetric = effectiveDriver
                              ? fmtDriver(val, revByYear[y] ?? 0, cogsByYear[y] ?? 0, effectiveDriver, daysBase)
                              : null;
                            return (
                              <td key={y} className="px-2 py-2 text-right">
                                <div className={`font-medium ${isProj ? "text-blue-300" : "text-slate-300"}`}>
                                  {fmtVal(val, unit)}
                                </div>
                                {driverMetric && driverMetric !== "—" && (
                                  <div className="text-[9px] text-slate-500 mt-0.5">{driverMetric}</div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}

                  {/* Liability items */}
                  {wcItems.filter((i) => i.side === "liability").length > 0 && (
                    <tr className="border-b border-slate-800/60">
                      <td
                        colSpan={3 + allYears.length}
                        className="px-3 py-1 text-[10px] font-semibold text-orange-300/70 uppercase tracking-wide bg-orange-950/10"
                      >
                        Operating current liabilities
                      </td>
                    </tr>
                  )}
                  {wcItems
                    .filter((i) => i.side === "liability")
                    .map((item) => {
                      const driver = wcDriverTypeByItemId[item.id];
                      const effectiveDriver = driver && driver !== "manual" ? driver : null;
                      const daysBase =
                        wcDaysBaseByItemId[item.id] ?? getDaysBaseForItemId(item.id, item.label);
                      const methodLabel = !effectiveDriver
                        ? "Manual"
                        : effectiveDriver === "days"
                        ? daysBase === "cogs"
                          ? "DPO"
                          : "Days"
                        : effectiveDriver === "pct_revenue"
                        ? "% Rev"
                        : "% COGS";

                      return (
                        <tr key={item.id} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                          <td className="px-3 py-2 font-medium">
                            <span className="flex items-baseline gap-1.5">
                              <span className="text-[9px] font-mono font-bold text-orange-400/70 shrink-0">(−)</span>
                              <span className="text-slate-300">{item.label}</span>
                            </span>
                          </td>
                          <td className="px-2 py-2 text-slate-500 text-[10px]">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                              {methodLabel}
                            </span>
                          </td>
                          {allYears.map((y) => {
                            const val = projectedBalances[item.id]?.[y] ?? 0;
                            const isProj = y.endsWith("E");
                            const driverMetric = effectiveDriver
                              ? fmtDriver(val, revByYear[y] ?? 0, cogsByYear[y] ?? 0, effectiveDriver, daysBase)
                              : null;
                            return (
                              <td key={y} className="px-2 py-2 text-right">
                                <div className={`font-medium ${isProj ? "text-blue-300" : "text-slate-300"}`}>
                                  {fmtVal(val, unit)}
                                </div>
                                {driverMetric && driverMetric !== "—" && (
                                  <div className="text-[9px] text-slate-500 mt-0.5">{driverMetric}</div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}

                  {/* NWC row */}
                  <tr className="border-t border-slate-600 bg-slate-800/20">
                    <td className="px-3 py-2 font-semibold text-[11px]">
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-mono font-bold text-slate-400 shrink-0">(=)</span>
                        <span className="text-slate-200">Net Working Capital</span>
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-500 text-[10px]">CA − CL</td>
                    {allYears.map((y) => {
                      const nwc = nwcByYear[y] ?? 0;
                      const isProj = y.endsWith("E");
                      return (
                        <td key={y} className={`px-2 py-2 text-right font-semibold ${isProj ? "text-blue-200" : "text-slate-200"}`}>
                          {fmtVal(nwc, unit)}
                        </td>
                      );
                    })}
                  </tr>

                  {/* ΔNWC row */}
                  <tr className="border-t border-slate-700/50">
                    <td className="px-3 py-2 font-medium text-[11px]">
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-mono font-bold text-slate-500 shrink-0">(Δ)</span>
                        <span className="text-slate-400">ΔNWC → CFS</span>
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-500 text-[10px]">use / (source)</td>
                    {allYears.map((y, i) => {
                      const delta = deltaNwcByYear[y] ?? 0;
                      const isProj = y.endsWith("E");
                      const isFirst = i === 0;
                      return (
                        <td key={y} className={`px-2 py-2 text-right ${isFirst ? "text-slate-600" : isProj ? "text-blue-300/80" : "text-slate-400"}`}>
                          {isFirst
                            ? "—"
                            : delta === 0
                            ? "—"
                            : delta > 0
                            ? `(${fmtVal(delta, unit)})`
                            : fmtVal(-delta, unit)}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[9px] text-slate-600 leading-relaxed">
              <span className="text-emerald-500/70">(+)</span> assets add to NWC ·{" "}
              <span className="text-orange-500/70">(−)</span> liabilities reduce NWC ·{" "}
              <span className="text-slate-500">(=)</span> NWC = CA − CL ·{" "}
              <span className="text-slate-500">(Δ)</span> ΔNWC &gt; 0 = use of cash shown as (X) · ΔNWC &lt; 0 = source of cash
            </p>
          </div>

          {/* Driver key */}
          <div className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2.5 space-y-1.5">
            <p className="text-[10px] font-semibold text-slate-300">Method key</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-500">
              <div><span className="text-slate-400">DSO</span> — Days Sales Outstanding (AR, days on Revenue)</div>
              <div><span className="text-slate-400">DIO</span> — Days Inventory Outstanding (Inventory, days on COGS)</div>
              <div><span className="text-slate-400">DPO</span> — Days Payable Outstanding (AP, days on COGS)</div>
              <div><span className="text-slate-400">% Rev / % COGS</span> — Percentage of Revenue or COGS</div>
            </div>
          </div>

          {/* CFS linkage note */}
          <div className="rounded-md border border-slate-800/60 bg-slate-900/20 px-3 py-2">
            <p className="text-[10px] text-slate-500 leading-relaxed">
              <span className="font-medium text-slate-400">CFS linkage:</span> Projected WC balances are applied to the Balance Sheet when you click "Confirm & Apply WC Drivers."
              The ΔWC change feeds into Cash Flow from Operations and the CFS balance is reconciled in the final BS check (Phase 4).
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
