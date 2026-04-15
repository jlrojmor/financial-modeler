"use client";

import { useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { CurrencyUnit } from "@/store/useModelStore";
import { computeRowValue } from "@/lib/calculations";
import {
  getOtherBsItems,
  OTHER_BS_GROUP_LABELS,
  IB_METHOD_LABELS,
  computeOtherBsProjectedBalance,
  type OtherBsGroup,
} from "@/lib/other-bs-items";
import { computeProjectedRevCogs } from "@/lib/projected-ebit";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import EquityRollforwardPreview from "@/components/equity-rollforward-preview";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtVal(v: number, unit: CurrencyUnit): string {
  if (v === 0 || !Number.isFinite(v)) return "—";
  const d = storedToDisplay(v, unit);
  const lbl = getUnitLabel(unit);
  return `${d.toLocaleString(undefined, { maximumFractionDigits: 0 })}${lbl ? ` ${lbl}` : ""}`;
}

const GROUP_ORDER: OtherBsGroup[] = ["fixed_assets", "other_current", "non_current_liab", "equity"];

const GROUP_STYLES: Record<OtherBsGroup, { header: string; bg: string }> = {
  fixed_assets:     { header: "text-violet-300/70", bg: "bg-violet-950/10" },
  other_current:    { header: "text-sky-300/70",    bg: "bg-sky-950/10" },
  non_current_liab: { header: "text-orange-300/70", bg: "bg-orange-950/10" },
  equity:           { header: "text-amber-300/70",  bg: "bg-amber-950/10" },
};

// ─── component ────────────────────────────────────────────────────────────────

export default function OtherBsItemsPreview() {
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

  const otherBsForecastByItemId = useModelStore((s) => s.otherBsForecastByItemId ?? {});
  const otherBsConfirmed = useModelStore((s) => s.otherBsConfirmed ?? false);

  const unit = (meta?.currencyUnit ?? "millions") as CurrencyUnit;
  const historicYears = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const allYears = useMemo(() => [...historicYears, ...projectionYears], [historicYears, projectionYears]);
  const lastHistYear = historicYears[historicYears.length - 1] ?? null;

  const allStatements = useMemo(
    () => ({ incomeStatement: incomeStatement ?? [], balanceSheet: balanceSheet ?? [], cashFlow: cashFlow ?? [] }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  const items = useMemo(
    () => getOtherBsItems(balanceSheet ?? [], cashFlow ?? [], historicYears),
    [balanceSheet, cashFlow, historicYears]
  );

  const itemsByGroup = useMemo(() => {
    const map: Partial<Record<OtherBsGroup, typeof items>> = {};
    for (const item of items) {
      if (!map[item.group]) map[item.group] = [];
      map[item.group]!.push(item);
    }
    return map;
  }, [items]);

  // Revenue for % Revenue method
  const revByYear = useMemo(() => {
    const histRev: Record<string, number> = {};
    const revRow = incomeStatement?.find((r) => r.id === "rev");
    for (const y of historicYears) {
      try {
        if (revRow) histRev[y] = computeRowValue(revRow, y, incomeStatement ?? [], incomeStatement ?? [], allStatements);
      } catch { /* noop */ }
    }
    if (projectionYears.length === 0 || !lastHistYear) return histRev;
    const { revByYear: projRev } = computeProjectedRevCogs({
      incomeStatement: incomeStatement ?? [],
      projectionYears,
      lastHistoricYear: lastHistYear,
      revenueForecastConfigV1,
      revenueForecastTreeV1: revenueForecastTreeV1 ?? [],
      revenueProjectionConfig,
      cogsForecastConfigV1,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
      currencyUnit: unit,
    });
    return { ...histRev, ...projRev };
  }, [incomeStatement, historicYears, projectionYears, lastHistYear, revenueForecastConfigV1, revenueForecastTreeV1, revenueProjectionConfig, cogsForecastConfigV1, allStatements, sbcBreakdowns, danaBreakdowns, unit]);

  // Compute all projected balances
  const projectedBalances = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const item of items) {
      out[item.id] = {};
      const bsRow = balanceSheet?.find((r) => r.id === item.id);
      const lastHistValue = lastHistYear != null ? (bsRow?.values?.[lastHistYear] ?? 0) : 0;
      for (const y of allYears) {
        if (historicYears.includes(y)) {
          out[item.id][y] = bsRow?.values?.[y] ?? 0;
        } else {
          const forecast = otherBsForecastByItemId[item.id] ?? { method: item.ibDefaultMethod, growthPct: 0, growthPctByYear: {}, pctRevenue: 0, manualByYear: {} };
          out[item.id][y] = computeOtherBsProjectedBalance(
            item.id, y, projectionYears, forecast, lastHistValue, revByYear
          );
        }
      }
    }
    return out;
  }, [items, balanceSheet, allYears, historicYears, projectionYears, lastHistYear, otherBsForecastByItemId, revByYear]);

  return (
    <section className="h-full w-full rounded-xl border border-slate-800 bg-slate-950/50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-4 pb-3 border-b border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Other BS Items Preview</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="text-slate-300">Forecast Drivers · Other BS Items</span>
              {meta?.companyName && (
                <>{" · "}<span className="text-slate-300">{meta.companyName}</span></>
              )}
            </p>
          </div>
          <div>
            {otherBsConfirmed ? (
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

      {/* No items */}
      {items.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div className="space-y-2">
            <p className="text-sm text-slate-400">No other BS items detected.</p>
            <p className="text-[11px] text-slate-600">Goodwill, deferred tax, investments, and equity line items will appear here automatically.</p>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="flex-1 overflow-y-auto overflow-x-auto p-4 space-y-5">

          {/* Projection table by group */}
          {GROUP_ORDER.map((group) => {
            const groupItems = itemsByGroup[group];
            if (!groupItems || groupItems.length === 0) return null;
            const styles = GROUP_STYLES[group];

            return (
              <div key={group} className="space-y-1.5">
                <p className={`text-[10px] font-semibold uppercase tracking-wide ${styles.header}`}>
                  {OTHER_BS_GROUP_LABELS[group]}
                </p>
                <div className="overflow-x-auto rounded border border-slate-800 bg-slate-950/40">
                  <table className="min-w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="px-3 py-1.5 text-left text-slate-400 font-medium min-w-[150px]">Line item</th>
                        <th className="px-2 py-1.5 text-left text-slate-500 font-medium text-[10px] min-w-[80px]">Method</th>
                        {allYears.map((y) => (
                          <th key={y} className={`px-2 py-1.5 text-right font-medium whitespace-nowrap text-[11px] ${y.endsWith("A") ? "text-slate-400" : "text-blue-400/80"}`}>
                            {y}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupItems.map((item) => {
                        const forecast = otherBsForecastByItemId[item.id];
                        const method = forecast?.method ?? item.ibDefaultMethod;
                        const isSet = forecast != null;

                        return (
                          <tr key={item.id} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                            <td className="px-3 py-2 text-slate-300 font-medium">{item.label}</td>
                            <td className="px-2 py-2">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                isSet
                                  ? "bg-emerald-950/40 text-emerald-300 border-emerald-800/40"
                                  : "bg-slate-800 text-slate-500 border-slate-700"
                              }`}>
                                {IB_METHOD_LABELS[method]}{!isSet ? "*" : ""}
                              </span>
                            </td>
                            {allYears.map((y) => {
                              const val = projectedBalances[item.id]?.[y] ?? 0;
                              const isProj = y.endsWith("E");
                              return (
                                <td key={y} className="px-2 py-2 text-right">
                                  <span className={`font-medium ${isProj ? "text-blue-300" : "text-slate-300"}`}>
                                    {fmtVal(val, unit)}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Legend */}
          <div className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 space-y-1">
            <p className="text-[10px] font-semibold text-slate-400">Method key</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-slate-500">
              <div><span className="text-slate-400">Flat</span> — stays at last historical balance</div>
              <div><span className="text-slate-400">% Growth</span> — compounded annually from last historical</div>
              <div><span className="text-slate-400">% Revenue</span> — % of forecasted revenue each year</div>
              <div><span className="text-slate-400">Manual</span> — user-entered balance per year</div>
            </div>
            <p className="text-[9px] text-slate-600 mt-1">
              * = IB default applied (not yet explicitly confirmed). Configure in the builder panel.
            </p>
          </div>

          {/* Excluded items note */}
          <div className="rounded-md border border-slate-800/60 bg-slate-900/20 px-3 py-2">
            <p className="text-[10px] text-slate-500 leading-relaxed">
              <span className="text-slate-400 font-medium">Not shown here:</span>{" "}
              Cash (CFS closure) · PP&amp;E &amp; Intangibles (Capex/D&amp;A schedule) ·
              Short &amp; Long-term Debt (Debt schedule) · Retained Earnings (NI − Dividends) ·
              Common Stock, APIC, Treasury Stock (see Equity Roll-Forward below) ·
              Working Capital items (WC Drivers tab).
            </p>
          </div>

          {/* ── Equity Roll-Forward Preview (Phase 3) ──────────────── */}
          <div className="mt-4 pt-4 border-t border-slate-700/40">
            <EquityRollforwardPreview />
          </div>
        </div>
      )}
    </section>
  );
}
