"use client";

import { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { CurrencyUnit, OtherBsItemMethod } from "@/store/useModelStore";
import { computeRowValue } from "@/lib/calculations";
import {
  getOtherBsItems,
  OTHER_BS_GROUP_LABELS,
  IB_METHOD_LABELS,
  IB_METHOD_DESCRIPTIONS,
  computeOtherBsProjectedBalance,
  type OtherBsGroup,
} from "@/lib/other-bs-items";
import { computeProjectedRevCogs } from "@/lib/projected-ebit";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import EquityRollforwardPanel from "@/components/equity-rollforward-panel";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtBalance(v: number, unit: CurrencyUnit): string {
  if (v === 0 || !Number.isFinite(v)) return "—";
  const d = storedToDisplay(v, unit);
  const lbl = getUnitLabel(unit);
  return `${d.toLocaleString(undefined, { maximumFractionDigits: 0 })}${lbl ? ` ${lbl}` : ""}`;
}

const GROUP_ORDER: OtherBsGroup[] = ["fixed_assets", "other_current", "non_current_liab", "equity"];

const GROUP_COLORS: Record<OtherBsGroup, { header: string; badge: string }> = {
  fixed_assets:     { header: "text-violet-300/80",  badge: "bg-violet-950/30 border-violet-700/40 text-violet-300" },
  other_current:    { header: "text-sky-300/80",      badge: "bg-sky-950/30 border-sky-700/40 text-sky-300" },
  non_current_liab: { header: "text-orange-300/80",   badge: "bg-orange-950/30 border-orange-700/40 text-orange-300" },
  equity:           { header: "text-amber-300/80",    badge: "bg-amber-950/30 border-amber-700/40 text-amber-300" },
};

// ─── component ────────────────────────────────────────────────────────────────

export default function OtherBsItemsPanel() {
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

  const setOtherBsForecast = useModelStore((s) => s.setOtherBsForecast);
  const setOtherBsConfirmed = useModelStore((s) => s.setOtherBsConfirmed);

  const unit = (meta?.currencyUnit ?? "millions") as CurrencyUnit;
  const historicYears = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const lastHistYear = historicYears[historicYears.length - 1] ?? null;

  const allStatements = useMemo(
    () => ({ incomeStatement: incomeStatement ?? [], balanceSheet: balanceSheet ?? [], cashFlow: cashFlow ?? [] }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  // Other BS items
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

  // Projected revenue for % Revenue method
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

  // Per-item open state
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const toggleItem = (id: string) => setOpenItems((p) => ({ ...p, [id]: !p[id] }));

  // How many items are configured (non-flat or explicitly set)
  const configuredCount = items.filter((item) => otherBsForecastByItemId[item.id] != null).length;

  const applyIbDefaults = () => {
    for (const item of items) {
      if (!otherBsForecastByItemId[item.id]) {
        setOtherBsForecast(item.id, { method: item.ibDefaultMethod });
      }
    }
  };

  const handleConfirm = () => {
    // Apply IB defaults for any unconfigured items
    for (const item of items) {
      if (!otherBsForecastByItemId[item.id]) {
        setOtherBsForecast(item.id, { method: item.ibDefaultMethod });
      }
    }
    setOtherBsConfirmed(true);
  };

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-6 space-y-2">
        <p className="text-sm font-semibold text-slate-200">Other Balance Sheet Items</p>
        <p className="text-xs text-slate-400">
          No other Balance Sheet items detected. These would include goodwill, deferred tax, investments, lease
          obligations, and equity line items that aren't already managed by other schedules.
        </p>
      </div>
    );
  }

  const renderItem = (item: (typeof items)[0]) => {
    const forecast = otherBsForecastByItemId[item.id];
    const method: OtherBsItemMethod = forecast?.method ?? item.ibDefaultMethod;
    const isOpen = openItems[item.id] ?? false;
    const bsRow = balanceSheet?.find((r) => r.id === item.id);
    const lastHistValue = lastHistYear != null ? (bsRow?.values?.[lastHistYear] ?? 0) : 0;
    const isExplicitlySet = otherBsForecastByItemId[item.id] != null;

    // Collapsed summary text
    const summaryText = (() => {
      if (!isExplicitlySet) return `IB default: ${IB_METHOD_LABELS[item.ibDefaultMethod]}`;
      if (method === "flat") return `Flat · ${fmtBalance(lastHistValue, unit)} every year`;
      if (method === "growth_pct") {
        const g = forecast?.growthPct ?? 0;
        return `${g >= 0 ? "+" : ""}${g.toFixed(1)}% / yr growth`;
      }
      if (method === "pct_revenue") return `${(forecast?.pctRevenue ?? 0).toFixed(1)}% of revenue`;
      return "Manual entry";
    })();

    return (
      <div key={item.id} className="rounded-md border border-slate-700/80 bg-slate-900/50 overflow-hidden">
        {/* Card header */}
        <button
          type="button"
          onClick={() => toggleItem(item.id)}
          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-800/30 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-sm font-medium text-slate-200 truncate">{item.label}</span>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border shrink-0 ${
              isExplicitlySet
                ? "bg-emerald-950/60 text-emerald-300 border-emerald-800/50"
                : "bg-slate-800 text-slate-400 border-slate-700"
            }`}>
              {isExplicitlySet ? IB_METHOD_LABELS[method] : "Default"}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-[10px] text-slate-500 hidden sm:block">{summaryText}</span>
            <span className="text-slate-500 text-xs">{isOpen ? "▲" : "▼"}</span>
          </div>
        </button>

        {isOpen && (
          <div className="px-3 pb-3 pt-1 space-y-3 border-t border-slate-800/60">
            {/* IB note */}
            <div className="rounded bg-slate-800/40 px-2.5 py-1.5 text-[10px] text-slate-400 leading-relaxed">
              <span className="font-semibold text-slate-300">IB note: </span>{item.ibNote}
            </div>

            {/* Historical snapshot */}
            {historicYears.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                {historicYears.slice(-3).map((y) => {
                  const v = bsRow?.values?.[y] ?? 0;
                  return (
                    <div key={y} className="text-[10px] text-slate-500">
                      <span className="text-slate-400">{y}: </span>
                      <span className="text-slate-300 font-medium">{fmtBalance(v, unit)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Method selector */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Forecast method</p>
              <div className="flex flex-wrap gap-1.5">
                {(["flat", "growth_pct", "pct_revenue", "manual"] as OtherBsItemMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setOtherBsForecast(item.id, { method: m })}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors border ${
                      method === m
                        ? "bg-blue-600/30 border-blue-500/60 text-blue-200"
                        : "bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                    }`}
                  >
                    {IB_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 italic">{IB_METHOD_DESCRIPTIONS[method]}</p>
            </div>

            {/* Method-specific inputs */}
            {method === "flat" && (
              <div className="rounded bg-slate-800/30 border border-slate-700/50 px-3 py-2 text-[11px] text-slate-400">
                Last historical value <span className="text-slate-200 font-semibold">{fmtBalance(lastHistValue, unit)}</span> will be used for all forecast years.
                No further input needed.
              </div>
            )}

            {method === "growth_pct" && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-400">Annual growth rate (all years):</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step={0.1}
                      value={forecast?.growthPct ?? ""}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        if (!Number.isNaN(n)) setOtherBsForecast(item.id, { method: "growth_pct", growthPct: n });
                      }}
                      placeholder="0.0"
                      className="rounded border border-slate-600 bg-slate-800 text-blue-300 text-[11px] px-2 py-1 w-20 focus:outline-none focus:border-blue-500"
                    />
                    <span className="text-[11px] text-slate-500">% / yr</span>
                  </div>
                </div>
                {/* Per-year overrides */}
                {projectionYears.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-slate-500">Optional: override growth rate for individual years</p>
                    <div className="flex flex-wrap gap-2">
                      {projectionYears.map((y) => {
                        const override = forecast?.growthPctByYear?.[y];
                        return (
                          <div key={y} className="flex flex-col items-center gap-0.5">
                            <span className="text-[9px] text-slate-500">{y}</span>
                            <input
                              type="number"
                              step={0.1}
                              value={override ?? ""}
                              onChange={(e) => {
                                const n = parseFloat(e.target.value);
                                const current = otherBsForecastByItemId[item.id] ?? { method: "growth_pct", growthPct: 0, growthPctByYear: {}, pctRevenue: 0, manualByYear: {} };
                                if (!Number.isNaN(n)) {
                                  setOtherBsForecast(item.id, {
                                    ...current,
                                    growthPctByYear: { ...current.growthPctByYear, [y]: n },
                                  });
                                }
                              }}
                              placeholder={`${(forecast?.growthPct ?? 0).toFixed(1)}`}
                              className="rounded border border-slate-700 bg-slate-800/80 text-blue-300 text-[10px] px-1 py-0.5 w-14 text-right focus:outline-none focus:border-blue-500"
                            />
                            <span className="text-[9px] text-slate-600">%</span>
                          </div>
                        );
                      })}
                    </div>
                    {/* Preview row */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {projectionYears.map((y) => {
                        const projected = computeOtherBsProjectedBalance(item.id, y, projectionYears, forecast ?? { method: "growth_pct", growthPct: 0, growthPctByYear: {}, pctRevenue: 0, manualByYear: {} }, lastHistValue, revByYear);
                        return (
                          <div key={y} className="flex flex-col items-center">
                            <span className="text-[9px] text-slate-500">{y}</span>
                            <span className="text-[10px] text-blue-300 font-medium">{fmtBalance(projected, unit)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {method === "pct_revenue" && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-400">% of Revenue (all years):</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={200}
                      step={0.1}
                      value={forecast?.pctRevenue ?? ""}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        if (!Number.isNaN(n)) setOtherBsForecast(item.id, { method: "pct_revenue", pctRevenue: n });
                      }}
                      placeholder="0.0"
                      className="rounded border border-slate-600 bg-slate-800 text-blue-300 text-[11px] px-2 py-1 w-20 focus:outline-none focus:border-blue-500"
                    />
                    <span className="text-[11px] text-slate-500">% of Rev</span>
                  </div>
                </div>
                {/* Historical pct hint */}
                {lastHistYear && (revByYear[lastHistYear] ?? 0) > 0 && lastHistValue !== 0 && (
                  <p className="text-[10px] text-slate-500">
                    Historical reference ({lastHistYear}):{" "}
                    <span className="text-slate-300 font-medium">
                      {((Math.abs(lastHistValue) / Math.abs(revByYear[lastHistYear] ?? 1)) * 100).toFixed(1)}% of revenue
                    </span>
                  </p>
                )}
                {/* Projected preview */}
                {projectionYears.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {projectionYears.map((y) => {
                      const projected = computeOtherBsProjectedBalance(item.id, y, projectionYears, forecast ?? { method: "pct_revenue", growthPct: 0, growthPctByYear: {}, pctRevenue: 0, manualByYear: {} }, lastHistValue, revByYear);
                      return (
                        <div key={y} className="flex flex-col items-center">
                          <span className="text-[9px] text-slate-500">{y}</span>
                          <span className="text-[10px] text-blue-300 font-medium">{fmtBalance(projected, unit)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {method === "manual" && (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-500">Enter the balance for each forecast year:</p>
                <div className="flex flex-wrap gap-2">
                  {projectionYears.map((y) => (
                    <div key={y} className="flex flex-col items-center gap-0.5">
                      <span className="text-[9px] text-slate-500">{y}</span>
                      <input
                        type="number"
                        step={1}
                        value={forecast?.manualByYear?.[y] != null
                          ? storedToDisplay(forecast.manualByYear[y], unit)
                          : ""}
                        onChange={(e) => {
                          const n = parseFloat(e.target.value);
                          const stored = Number.isNaN(n) ? 0 : n / storedToDisplay(1, unit);
                          const current = otherBsForecastByItemId[item.id] ?? { method: "manual", growthPct: 0, growthPctByYear: {}, pctRevenue: 0, manualByYear: {} };
                          setOtherBsForecast(item.id, {
                            ...current,
                            manualByYear: { ...current.manualByYear, [y]: stored * storedToDisplay(1, unit) === 0 ? n : n * (1 / storedToDisplay(1, unit)) },
                          });
                        }}
                        placeholder={fmtBalance(lastHistValue, unit).replace(/[^0-9.-]/g, "") || "—"}
                        className="rounded border border-slate-700 bg-slate-800/80 text-blue-300 text-[10px] px-1.5 py-1 w-20 text-right focus:outline-none focus:border-blue-500"
                      />
                      <span className="text-[9px] text-slate-600">{getUnitLabel(unit)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Done button */}
            <div className="flex items-center justify-between pt-1">
              {method !== "flat" && (
                <button
                  type="button"
                  onClick={() => setOtherBsForecast(item.id, { method: "flat" })}
                  className="text-[10px] text-slate-500 hover:text-slate-300 underline"
                >
                  Reset to flat
                </button>
              )}
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={() => {
                    if (!otherBsForecastByItemId[item.id]) {
                      setOtherBsForecast(item.id, { method: item.ibDefaultMethod });
                    }
                    toggleItem(item.id);
                  }}
                  className="rounded border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  ✓ Done — collapse
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-slate-100">Other Balance Sheet Items</h2>
          {otherBsConfirmed ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
              ✓ Active
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/40 text-amber-300 border border-amber-800/40">
              {configuredCount}/{items.length} configured
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 max-w-xl">
          Set forecast methods for remaining Balance Sheet items — goodwill, deferred taxes, lease assets/obligations,
          investments, and equity line items. Most can be held flat; adjust where specific activity is expected.
        </p>
      </div>

      {/* IB defaults banner */}
      {!otherBsConfirmed && (
        <div className="rounded-md border border-sky-800/40 bg-sky-950/20 px-3 py-2.5 flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-[11px] font-semibold text-sky-200">IB defaults: most items held flat</p>
            <p className="text-[10px] text-sky-300/80 leading-relaxed">
              Goodwill · Investments · ROU assets · Equity accounts → Flat.{" "}
              Deferred Tax (A/L) → % of Revenue. NCI → slight growth. Click to apply all IB defaults at once.
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

      {/* Groups */}
      {GROUP_ORDER.map((group) => {
        const groupItems = itemsByGroup[group];
        if (!groupItems || groupItems.length === 0) return null;
        const colors = GROUP_COLORS[group];
        return (
          <div key={group} className="space-y-2">
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${colors.header}`}>
              {OTHER_BS_GROUP_LABELS[group]}
            </p>
            {groupItems.map(renderItem)}
          </div>
        );
      })}

      {/* Section-level confirm */}
      <div className="rounded-md border border-slate-700 bg-slate-900/40 px-3 py-3 flex flex-wrap items-center gap-3">
        {otherBsConfirmed ? (
          <>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
              ✓ Other BS Items active — projections applied to Balance Sheet
            </span>
            <button
              type="button"
              onClick={() => setOtherBsConfirmed(false)}
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
              ✓ Confirm & Apply Other BS Items
            </button>
            <span className="text-[10px] text-slate-500">
              Unconfigured items use their IB default (flat). You can edit anytime.
            </span>
          </>
        )}
      </div>

      <p className="text-[10px] text-slate-600 leading-relaxed">
        Cash is derived from the Cash Flow Statement. PP&amp;E is managed by the Capex &amp; D&amp;A schedule.
        Debt is managed by the Debt Schedule. Retained Earnings is derived from Net Income less dividends.
      </p>

      {/* ── Equity Roll-Forward (Phase 3) ──────────────────────── */}
      <EquityRollforwardPanel />
    </div>
  );
}
