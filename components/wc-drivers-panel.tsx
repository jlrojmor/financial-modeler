"use client";

import { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { CurrencyUnit } from "@/store/useModelStore";
import { computeRowValue } from "@/lib/calculations";
import {
  getWcScheduleItems,
  getDaysBaseForItemId,
  getRecommendedWcMethod,
  computeHistoricDays,
  computeHistoricPct,
  computeWcProjectedBalance,
} from "@/lib/working-capital-schedule";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import { computeProjectedRevCogs } from "@/lib/projected-ebit";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtBalance(v: number, unit: CurrencyUnit): string {
  if (v === 0 || !Number.isFinite(v)) return "—";
  const d = storedToDisplay(v, unit);
  const lbl = getUnitLabel(unit);
  return `${d.toLocaleString(undefined, { maximumFractionDigits: 0 })}${lbl ? ` ${lbl}` : ""}`;
}

function fmtDays(d: number | null): string {
  if (d == null || !Number.isFinite(d)) return "—";
  return `${d.toFixed(1)} d`;
}

function fmtPct(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${p.toFixed(1)}%`;
}

// ─── component ────────────────────────────────────────────────────────────────

export default function WcDriversPanel() {
  const meta = useModelStore((s) => s.meta);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const incomeStatement = useModelStore((s) => s.incomeStatement);

  // Forecast engine inputs (for projected revenue + COGS)
  const revenueForecastConfigV1 = useModelStore((s) => s.revenueForecastConfigV1);
  const revenueForecastTreeV1 = useModelStore((s) => s.revenueForecastTreeV1);
  const revenueProjectionConfig = useModelStore((s) => s.revenueProjectionConfig);
  const cogsForecastConfigV1 = useModelStore((s) => s.cogsForecastConfigV1);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns ?? {});
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns ?? {});

  // WC driver state
  const wcDriverTypeByItemId = useModelStore((s) => s.wcDriverTypeByItemId ?? {});
  const wcDaysByItemId = useModelStore((s) => s.wcDaysByItemId ?? {});
  const wcDaysByItemIdByYear = useModelStore((s) => s.wcDaysByItemIdByYear ?? {});
  const wcDaysBaseByItemId = useModelStore((s) => s.wcDaysBaseByItemId ?? {});
  const wcPctByItemId = useModelStore((s) => s.wcPctByItemId ?? {});
  const wcPctByItemIdByYear = useModelStore((s) => s.wcPctByItemIdByYear ?? {});
  const wcDriversConfirmed = useModelStore((s) => s.wcDriversConfirmed ?? false);

  // Setters
  const setWcDriverType = useModelStore((s) => s.setWcDriverType);
  const setWcDaysForItem = useModelStore((s) => s.setWcDaysForItem);
  const setWcDaysForItemYear = useModelStore((s) => s.setWcDaysForItemYear);
  const setWcDaysBaseForItem = useModelStore((s) => s.setWcDaysBaseForItem);
  const setWcPctForItem = useModelStore((s) => s.setWcPctForItem);
  const setWcPctForItemYear = useModelStore((s) => s.setWcPctForItemYear);
  const setWcDriversConfirmed = useModelStore((s) => s.setWcDriversConfirmed);
  const applyBsBuildProjectionsToModel = useModelStore((s) => s.applyBsBuildProjectionsToModel);

  const unit = (meta?.currencyUnit ?? "millions") as CurrencyUnit;
  const historicYears = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const lastHistoricYear = historicYears[historicYears.length - 1] ?? null;

  const wcItems = useMemo(
    () => getWcScheduleItems(cashFlow ?? [], balanceSheet ?? []),
    [cashFlow, balanceSheet]
  );
  const assetItems = wcItems.filter((i) => i.side === "asset");
  const liabItems = wcItems.filter((i) => i.side === "liability");

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
    // Historical: read directly from stored IS row values
    const histRevByYear: Record<string, number> = {};
    const histCogsByYear: Record<string, number> = {};
    const revRow = incomeStatement?.find((r) => r.id === "rev");
    const cogsRow = incomeStatement?.find((r) => r.id === "cogs");
    for (const y of historicYears) {
      try {
        if (revRow) histRevByYear[y] = computeRowValue(revRow, y, incomeStatement ?? [], incomeStatement ?? [], allStatements);
        if (cogsRow) histCogsByYear[y] = Math.abs(computeRowValue(cogsRow, y, incomeStatement ?? [], incomeStatement ?? [], allStatements));
      } catch { /* noop */ }
    }

    if (projectionYears.length === 0 || !lastHistoricYear) {
      return { revByYear: histRevByYear, cogsByYear: histCogsByYear };
    }

    // Projected: use the full forecast engines (Revenue + COGS)
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

  // Per-item open state
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const toggleItem = (id: string) => setOpenItems((prev) => ({ ...prev, [id]: !prev[id] }));

  // Section-level configured count
  const configuredCount = useMemo(() => {
    return wcItems.filter((item) => {
      const driver = wcDriverTypeByItemId[item.id];
      if (!driver || driver === "manual") return false;
      if (driver === "days") {
        return (
          wcDaysByItemId[item.id] != null ||
          Object.keys(wcDaysByItemIdByYear[item.id] ?? {}).length > 0
        );
      }
      return (
        wcPctByItemId[item.id] != null ||
        Object.keys(wcPctByItemIdByYear[item.id] ?? {}).length > 0
      );
    }).length;
  }, [wcItems, wcDriverTypeByItemId, wcDaysByItemId, wcDaysByItemIdByYear, wcPctByItemId, wcPctByItemIdByYear]);

  const applyIbDefaults = () => {
    for (const item of wcItems) {
      const rec = getRecommendedWcMethod(item.id, item.label);
      if (!rec) continue;
      setWcDriverType(item.id, rec.driver);
      if (rec.driver === "days" && rec.daysBase) setWcDaysBaseForItem(item.id, rec.daysBase);
    }
  };

  const handleConfirm = () => {
    applyBsBuildProjectionsToModel();
    setWcDriversConfirmed(true);
  };

  const renderItem = (item: { id: string; label: string; side: "asset" | "liability" }) => {
    const bsRow = balanceSheet?.find((r) => r.id === item.id);
    const driver = wcDriverTypeByItemId[item.id];
    const effectiveDriver = driver && driver !== "manual" ? driver : "days";
    const inferredDaysBase = getDaysBaseForItemId(item.id, item.label);
    const daysBase = wcDaysBaseByItemId[item.id] ?? inferredDaysBase;
    const isOpen = openItems[item.id] ?? true;

    // Determine status
    const isConfigured = (() => {
      if (!driver || driver === "manual") return false;
      if (driver === "days") {
        return (
          wcDaysByItemId[item.id] != null ||
          Object.keys(wcDaysByItemIdByYear[item.id] ?? {}).length > 0
        );
      }
      return (
        wcPctByItemId[item.id] != null ||
        Object.keys(wcPctByItemIdByYear[item.id] ?? {}).length > 0
      );
    })();

    // Summary for collapsed state
    const driverLabel =
      effectiveDriver === "days"
        ? daysBase === "revenue"
          ? "DSO (Revenue)"
          : daysBase === "cogs"
          ? driver === "manual" || !driver ? "Days" : "DPO/DIO (COGS)"
          : "Days"
        : effectiveDriver === "pct_revenue"
        ? "% of Revenue"
        : "% of COGS";

    const driverValue =
      effectiveDriver === "days"
        ? wcDaysByItemId[item.id] != null
          ? `${wcDaysByItemId[item.id].toFixed(1)} days`
          : "—"
        : wcPctByItemId[item.id] != null
        ? `${wcPctByItemId[item.id].toFixed(1)}%`
        : "—";

    // Build driver state for computeWcProjectedBalance
    const driverState = {
      wcDriverTypeByItemId,
      wcDaysByItemId,
      wcDaysByItemIdByYear,
      wcDaysBaseByItemId,
      wcPctBaseByItemId: {},
      wcPctByItemId,
      wcPctByItemIdByYear,
    };

    return (
      <div key={item.id} className="rounded-md border border-slate-700/80 bg-slate-900/50 overflow-hidden">
        {/* Card header */}
        <button
          type="button"
          onClick={() => toggleItem(item.id)}
          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-800/30 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-slate-200 truncate">{item.label}</span>
            {isConfigured ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 shrink-0">
                ✓ {driverLabel} · {driverValue}
              </span>
            ) : (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-600 shrink-0">
                Not configured
              </span>
            )}
          </div>
          <span className="text-slate-500 text-xs shrink-0 ml-2">{isOpen ? "▲" : "▼"}</span>
        </button>

        {isOpen && (
          <div className="px-3 pb-3 pt-1 space-y-3 border-t border-slate-800/60">
            {/* Method selector */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] text-slate-400 font-medium">Forecast method:</span>
              <div className="flex gap-1">
                {(["days", "pct_revenue", "pct_cogs"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setWcDriverType(item.id, m);
                      if (m === "days" && !wcDaysBaseByItemId[item.id]) {
                        setWcDaysBaseForItem(item.id, inferredDaysBase);
                      }
                    }}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors border ${
                      effectiveDriver === m
                        ? "bg-blue-600/30 border-blue-500/60 text-blue-200"
                        : "bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                    }`}
                  >
                    {m === "days" ? "Days" : m === "pct_revenue" ? "% Revenue" : "% COGS"}
                  </button>
                ))}
              </div>
            </div>

            {/* Days base selector */}
            {effectiveDriver === "days" && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">Base:</span>
                <div className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 p-0.5">
                  {(["revenue", "cogs"] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setWcDaysBaseForItem(item.id, b)}
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                        daysBase === b
                          ? "bg-blue-500/30 text-blue-200"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {b === "revenue" ? "Revenue" : "COGS"}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-slate-500">
                  {daysBase === "revenue" ? "(DSO — accounts receivable style)" : "(DPO/DIO — payables/inventory style)"}
                </span>
              </div>
            )}

            {/* Constant driver input */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-400">
                {effectiveDriver === "days" ? "Constant days (all forecast years):" : "Constant % (all forecast years):"}
              </span>
              <div className="flex items-center gap-1">
                {effectiveDriver === "days" ? (
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={wcDaysByItemId[item.id] ?? ""}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (!Number.isNaN(n)) setWcDaysForItem(item.id, n);
                    }}
                    placeholder="—"
                    className="rounded border border-slate-600 bg-slate-800 text-blue-300 text-[11px] px-2 py-1 w-20 focus:outline-none focus:border-blue-500"
                  />
                ) : (
                  <input
                    type="number"
                    min={0}
                    max={200}
                    step={0.1}
                    value={wcPctByItemId[item.id] ?? ""}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (!Number.isNaN(n)) setWcPctForItem(item.id, n);
                    }}
                    placeholder="—"
                    className="rounded border border-slate-600 bg-slate-800 text-blue-300 text-[11px] px-2 py-1 w-20 focus:outline-none focus:border-blue-500"
                  />
                )}
                <span className="text-[11px] text-slate-500">
                  {effectiveDriver === "days" ? "days" : "%"}
                </span>
              </div>
            </div>

            {/* Historical data + per-year overrides */}
            <div className="overflow-x-auto rounded border border-slate-800 bg-slate-950/40">
              <table className="min-w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="px-2 py-1.5 text-left text-slate-500 font-medium">Year</th>
                    {[...historicYears, ...projectionYears].map((y) => (
                      <th key={y} className="px-2 py-1.5 text-right text-slate-500 font-medium whitespace-nowrap">
                        {y}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Balance row */}
                  <tr className="border-b border-slate-800/50">
                    <td className="px-2 py-1.5 text-slate-400">Balance</td>
                    {historicYears.map((y) => {
                      const val = bsRow?.values?.[y] ?? 0;
                      return (
                        <td key={y} className="px-2 py-1.5 text-right text-slate-300 font-medium">
                          {fmtBalance(val, unit)}
                        </td>
                      );
                    })}
                    {projectionYears.map((y) => {
                      const manualVal = bsRow?.values?.[y];
                      const projected = computeWcProjectedBalance(
                        item.id,
                        y,
                        driverState,
                        revByYear,
                        cogsByYear,
                        manualVal
                      );
                      const hasRevCogs = (revByYear[y] ?? 0) !== 0 || (cogsByYear[y] ?? 0) !== 0;
                      return (
                        <td key={y} className={`px-2 py-1.5 text-right font-medium ${hasRevCogs && projected !== 0 ? "text-blue-300" : "text-slate-500"}`}>
                          {projected !== 0 ? fmtBalance(projected, unit) : "—"}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Driver metric row (historical actual + projected input) */}
                  <tr>
                    <td className="px-2 py-1.5 text-slate-500">
                      {effectiveDriver === "days"
                        ? `Days (${daysBase === "revenue" ? "rev" : "COGS"})`
                        : effectiveDriver === "pct_revenue"
                        ? "% Revenue"
                        : "% COGS"}
                    </td>
                    {historicYears.map((y) => {
                      const val = bsRow?.values?.[y] ?? 0;
                      const rev = revByYear[y] ?? 0;
                      const cogs = cogsByYear[y] ?? 0;
                      const metric =
                        effectiveDriver === "days"
                          ? computeHistoricDays(val, rev, cogs, daysBase)
                          : computeHistoricPct(
                              val,
                              rev,
                              cogs,
                              effectiveDriver === "pct_cogs" ? "cogs" : "revenue"
                            );
                      return (
                        <td key={y} className="px-2 py-1.5 text-right text-slate-500">
                          {effectiveDriver === "days" ? fmtDays(metric) : fmtPct(metric)}
                        </td>
                      );
                    })}
                    {projectionYears.map((y) => {
                      const perYearVal =
                        effectiveDriver === "days"
                          ? wcDaysByItemIdByYear[item.id]?.[y]
                          : wcPctByItemIdByYear[item.id]?.[y];
                      const constantVal =
                        effectiveDriver === "days"
                          ? wcDaysByItemId[item.id]
                          : wcPctByItemId[item.id];
                      const displayVal = perYearVal ?? constantVal;
                      return (
                        <td key={y} className="px-2 py-1.5 text-right">
                          {effectiveDriver === "days" ? (
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={wcDaysByItemIdByYear[item.id]?.[y] ?? ""}
                              onChange={(e) => {
                                const n = parseFloat(e.target.value);
                                if (!Number.isNaN(n)) setWcDaysForItemYear(item.id, y, n);
                              }}
                              placeholder={constantVal != null ? String(constantVal.toFixed(1)) : "—"}
                              className="rounded border border-slate-700 bg-slate-800/80 text-blue-300 text-[10px] px-1 py-0.5 w-16 text-right focus:outline-none focus:border-blue-500"
                            />
                          ) : (
                            <input
                              type="number"
                              min={0}
                              max={200}
                              step={0.1}
                              value={wcPctByItemIdByYear[item.id]?.[y] ?? ""}
                              onChange={(e) => {
                                const n = parseFloat(e.target.value);
                                if (!Number.isNaN(n)) setWcPctForItemYear(item.id, y, n);
                              }}
                              placeholder={constantVal != null ? `${constantVal.toFixed(1)}%` : "—"}
                              className="rounded border border-slate-700 bg-slate-800/80 text-blue-300 text-[10px] px-1 py-0.5 w-16 text-right focus:outline-none focus:border-blue-500"
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Historical driver hint */}
            {historicYears.length > 0 && (
              <p className="text-[10px] text-slate-500 leading-relaxed">
                {effectiveDriver === "days"
                  ? `Historical days shown above (${daysBase} base). Use recent history as a guide — enter your target for forecast years above or set a constant.`
                  : `Historical % shown above. Use recent history as a guide — enter your target for forecast years above or set a constant.`}
              </p>
            )}

            {/* Done button */}
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => toggleItem(item.id)}
                className="rounded border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-700 transition-colors"
              >
                ✓ Done — collapse
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (wcItems.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-6 space-y-2">
        <p className="text-sm font-semibold text-slate-200">Working Capital Drivers</p>
        <p className="text-xs text-slate-400">
          No working capital items detected on your Balance Sheet. Operating current assets and liabilities (AR, AP, inventory,
          deferred revenue, accrued liabilities, etc.) with <code className="text-slate-300">cashFlowBehavior = working_capital</code> will
          appear here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Section header */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-100">Working Capital Drivers</h2>
            {wcDriversConfirmed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
                ✓ Active
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/40 text-amber-300 border border-amber-800/40">
                {configuredCount}/{wcItems.length} configured
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Set forecast drivers for each operating WC item. Projected balances flow into the Balance Sheet and drive the
            Working Capital change in Cash Flow from Operations.
          </p>
        </div>
      </div>

      {/* IB defaults banner */}
      {!wcDriversConfirmed && (
        <div className="rounded-md border border-sky-800/40 bg-sky-950/20 px-3 py-2.5 flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-[11px] font-semibold text-sky-200">IB-grade standard methods</p>
            <p className="text-[10px] text-sky-300/80 leading-relaxed">
              AR → DSO (days on revenue) · Inventory → DIO (days on COGS) · AP → DPO (days on COGS) · All others → % of revenue.
              Click to apply these defaults instantly, then fine-tune below.
            </p>
          </div>
          <button
            type="button"
            onClick={applyIbDefaults}
            className="shrink-0 rounded border border-sky-700/50 bg-sky-900/40 px-2.5 py-1.5 text-[11px] text-sky-200 hover:bg-sky-800/50 font-medium transition-colors"
          >
            Apply IB defaults
          </button>
        </div>
      )}

      {/* Asset items */}
      {assetItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-emerald-300/80 uppercase tracking-wide">
            Operating current assets
          </p>
          {assetItems.map(renderItem)}
        </div>
      )}

      {/* Liability items */}
      {liabItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-orange-300/80 uppercase tracking-wide">
            Operating current liabilities
          </p>
          {liabItems.map(renderItem)}
        </div>
      )}

      {/* Section-level confirm / edit */}
      <div className="rounded-md border border-slate-700 bg-slate-900/40 px-3 py-3 flex flex-wrap items-center gap-3">
        {wcDriversConfirmed ? (
          <>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
              ✓ WC Drivers active — projected balances applied to Balance Sheet
            </span>
            <button
              type="button"
              onClick={() => setWcDriversConfirmed(false)}
              className="rounded border border-slate-600 bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
            >
              Edit
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 transition-colors"
            >
              ✓ Confirm & Apply WC Drivers
            </button>
            <span className="text-[10px] text-slate-500">
              Applies projected balances to the Balance Sheet · drives ΔWC in Cash Flow from Operations
            </span>
          </>
        )}
      </div>

      {/* Footer note */}
      <p className="text-[10px] text-slate-600 leading-relaxed">
        Only Balance Sheet items tagged as <span className="text-slate-500">working_capital</span> in Cash Flow from Operations appear
        here. Cash, short-term debt, and long-term debt are managed separately.
      </p>
    </div>
  );
}
