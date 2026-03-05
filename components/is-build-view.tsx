"use client";

import { useMemo, useState, useEffect, Fragment } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import type { RevenueProjectionMethod, RevenueProjectionInputs } from "@/types/revenue-projection";
import { formatCurrencyDisplay, displayToStored, storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import { computeRowValue } from "@/lib/calculations";
import CollapsibleSection from "@/components/collapsible-section";
import RevenueForecastInputs from "@/components/revenue-forecast-inputs";
import RevenueBreakdownAllocation from "@/components/revenue-breakdown-allocation";

const METHOD_LABELS: Record<RevenueProjectionMethod, string> = {
  growth_rate: "% growth rate",
  price_volume: "Price × Volume",
  customers_arpu: "Customers × ARPU",
  pct_of_total: "% of total revenue",
  product_line: "By product line",
  channel: "By channel",
};

/**
 * IS Build — Revenue: identify streams, optional breakdown, then how to forecast each.
 */
export default function ISBuildView() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns ?? {});
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns ?? {});
  const meta = useModelStore((s) => s.meta);

  const allStatements = useMemo(
    () => ({
      incomeStatement: incomeStatement ?? [],
      balanceSheet: balanceSheet ?? [],
      cashFlow: cashFlow ?? [],
    }),
    [incomeStatement, balanceSheet, cashFlow]
  );
  const revenueProjectionConfig = useModelStore((s) => s.revenueProjectionConfig);
  const setRevenueProjectionMethod = useModelStore((s) => s.setRevenueProjectionMethod);
  const setRevenueProjectionInputs = useModelStore((s) => s.setRevenueProjectionInputs);
  const addRevenueBreakdown = useModelStore((s) => s.addRevenueBreakdown);
  const removeRevenueBreakdown = useModelStore((s) => s.removeRevenueBreakdown);
  const renameRevenueBreakdown = useModelStore((s) => s.renameRevenueBreakdown);
  const setCogsPctForRevenueLine = useModelStore((s) => s.setCogsPctForRevenueLine);
  const setCogsPctModeForRevenueLine = useModelStore((s) => s.setCogsPctModeForRevenueLine);
  const setCogsPctForRevenueLineYear = useModelStore((s) => s.setCogsPctForRevenueLineYear);
  const cogsPctByRevenueLine = useModelStore((s) => s.cogsPctByRevenueLine ?? {});
  const cogsPctModeByRevenueLine = useModelStore((s) => s.cogsPctModeByRevenueLine ?? {});
  const cogsPctByRevenueLineByYear = useModelStore((s) => s.cogsPctByRevenueLineByYear ?? {});
  const sgaPctByItemId = useModelStore((s) => s.sgaPctByItemId ?? {});
  const sgaPctModeByItemId = useModelStore((s) => s.sgaPctModeByItemId ?? {});
  const sgaPctByItemIdByYear = useModelStore((s) => s.sgaPctByItemIdByYear ?? {});
  const setSgaPctForItem = useModelStore((s) => s.setSgaPctForItem);
  const setSgaPctModeForItem = useModelStore((s) => s.setSgaPctModeForItem);
  const setSgaPctForItemYear = useModelStore((s) => s.setSgaPctForItemYear);
  const sgaPctOfParentByItemId = useModelStore((s) => s.sgaPctOfParentByItemId ?? {});
  const sgaPctOfParentModeByItemId = useModelStore((s) => s.sgaPctOfParentModeByItemId ?? {});
  const sgaPctOfParentByItemIdByYear = useModelStore((s) => s.sgaPctOfParentByItemIdByYear ?? {});
  const sgaHistoricAmountByItemIdByYear = useModelStore((s) => s.sgaHistoricAmountByItemIdByYear ?? {});
  const setSgaPctOfParentForItem = useModelStore((s) => s.setSgaPctOfParentForItem);
  const setSgaPctOfParentModeForItem = useModelStore((s) => s.setSgaPctOfParentModeForItem);
  const setSgaPctOfParentForItemYear = useModelStore((s) => s.setSgaPctOfParentForItemYear);
  const setSgaHistoricAmountForItemYear = useModelStore((s) => s.setSgaHistoricAmountForItemYear);
  const addChildRow = useModelStore((s) => s.addChildRow);
  const removeRow = useModelStore((s) => s.removeRow);
  const renameRow = useModelStore((s) => s.renameRow);

  const [newBreakdownLabel, setNewBreakdownLabel] = useState("");
  const [addingForParent, setAddingForParent] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [editingBreakdown, setEditingBreakdown] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editingSgaItemId, setEditingSgaItemId] = useState<string | null>(null);
  const [editSgaLabel, setEditSgaLabel] = useState("");
  const [confirmedSgaItems, setConfirmedSgaItems] = useState<Set<string>>(new Set());
  const [addingSgaSubItemParentId, setAddingSgaSubItemParentId] = useState<string | null>(null);
  const [newSgaSubItemLabel, setNewSgaSubItemLabel] = useState("");
  const [sgaBreakdownHelperModeByParentId, setSgaBreakdownHelperModeByParentId] = useState<Record<string, "historic_amounts" | "weights">>({});
  const [confirmedBreakdowns, setConfirmedBreakdowns] = useState<Set<string>>(new Set());
  const [breakdownsExpanded, setBreakdownsExpanded] = useState<Set<string>>(new Set());

  // Forecast helper (historicals) – independent advisory tool
  type HelperMode = "growth" | "pct_of_ref";
  type GrowthRow = { year: string; value: string };
  type PctRow = { year: string; value: string; reference: string };

  const [helperMode, setHelperMode] = useState<HelperMode>("growth");
  const [helperOpen, setHelperOpen] = useState<boolean>(true);
  const [growthRows, setGrowthRows] = useState<GrowthRow[]>([
    { year: "", value: "" },
    { year: "", value: "" },
    { year: "", value: "" },
  ]);
  const [pctRows, setPctRows] = useState<PctRow[]>([
    { year: "", value: "", reference: "" },
    { year: "", value: "", reference: "" },
    { year: "", value: "", reference: "" },
  ]);
  const [pctItemLabel, setPctItemLabel] = useState<string>("");
  const [pctReferenceLabel, setPctReferenceLabel] = useState<string>("");

  const copyToClipboard = async (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // ignore clipboard errors
      }
    }
  };

  const expandAllStreams = () => {
    setExpandedItems(new Set(streams.map((s) => s.id)));
    setBreakdownsExpanded(new Set()); // show all breakdown blocks
  };
  const collapseAllStreams = () => {
    setExpandedItems(new Set());
    const cfg = useModelStore.getState().revenueProjectionConfig;
    const breakdowns = cfg?.breakdowns ?? {};
    setBreakdownsExpanded(new Set(Object.keys(breakdowns)));
  };
  const toggleBreakdowns = (streamId: string) => {
    setBreakdownsExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(streamId)) next.delete(streamId);
      else next.add(streamId);
      return next;
    });
  };

  const rev = useMemo(
    () => incomeStatement?.find((r) => r.id === "rev"),
    [incomeStatement]
  );
  const streams = useMemo(() => rev?.children ?? [], [rev]);
  const revenueStreamOptions = useMemo(
    () => [{ id: "rev", label: "Total Revenue" }, ...streams.map((s) => ({ id: s.id, label: s.label }))],
    [streams]
  );
  const historicalYears = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const lastHistoricYear = useMemo(
    () => historicalYears[historicalYears.length - 1] ?? "",
    [historicalYears]
  );
  const unit = (meta?.currencyUnit ?? "millions") as "units" | "thousands" | "millions";

  const toggleExpanded = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddBreakdown = (parentId: string) => {
    const label = newBreakdownLabel.trim();
    if (!label) return;
    const newId = addRevenueBreakdown(parentId, label);
    if (newId) {
      setRevenueProjectionMethod(newId, "pct_of_total");
      setRevenueProjectionInputs(newId, { referenceId: "rev", pctOfTotal: 0 });
    }
    setNewBreakdownLabel("");
    setAddingForParent(null);
  };

  const config = revenueProjectionConfig ?? { items: {}, breakdowns: {} };

  // COGS: income statement rows for Gross Profit / Gross Margin; Total COGS is computed from revenue × % per line
  const cogsRow = incomeStatement.find((r) => r.id === "cogs");
  const grossProfitRow = incomeStatement.find((r) => r.id === "gross_profit");
  const grossMarginRow = incomeStatement.find((r) => r.id === "gross_margin");
  const sgaRow = incomeStatement.find((r) => r.id === "sga");
  const hasRevenueStreams = streams.length > 0;
  const years = historicalYears;

  // Leaf revenue line items (each projected line): streams with no breakdown, or each breakdown, or each product_line/channel sub-row
  const leafRevenueLines = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const breakdowns = config.breakdowns ?? {};
    const items = config.items ?? {};
    for (const stream of streams) {
      const children = breakdowns[stream.id] ?? [];
      if (children.length === 0) {
        out.push({ id: stream.id, label: stream.label });
        continue;
      }
      for (const b of children) {
        const itemCfg = items[b.id];
        const method = itemCfg?.method;
        const pl = itemCfg?.inputs as { items?: Array<{ id?: string; label?: string }> } | undefined;
        if ((method === "product_line" || method === "channel") && pl?.items?.length) {
          pl.items.forEach((it, idx) => {
            const raw = it.id ?? it.label;
            const lineKey = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${idx}`;
            out.push({ id: `${b.id}::${lineKey}`, label: (it.label ?? it.id ?? lineKey) as string });
          });
        } else {
          out.push({ id: b.id, label: b.label });
        }
      }
    }
    return out;
  }, [streams, config.breakdowns, config.items]);

  // Default every leaf revenue item (stream with no breakdowns, or any breakdown) to "% of revenue" when it has no projection config yet.
  useEffect(() => {
    if (!rev || !revenueProjectionConfig) return;
    const breakdowns = revenueProjectionConfig.breakdowns ?? {};
    const items = revenueProjectionConfig.items ?? {};
    // Leaf streams: streams with no breakdowns
    for (const stream of streams) {
      if ((breakdowns[stream.id]?.length ?? 0) > 0) continue;
      if (items[stream.id] != null) continue;
      setRevenueProjectionMethod(stream.id, "pct_of_total");
      setRevenueProjectionInputs(stream.id, { referenceId: "rev", pctOfTotal: 0 });
    }
    // Leaf breakdowns: every breakdown item under any stream
    for (const stream of streams) {
      const children = breakdowns[stream.id] ?? [];
      for (const sub of children) {
        if (items[sub.id] != null) continue;
        setRevenueProjectionMethod(sub.id, "pct_of_total");
        setRevenueProjectionInputs(sub.id, { referenceId: "rev", pctOfTotal: 0 });
      }
    }
  }, [rev, streams, revenueProjectionConfig]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 p-4">
        <h3 className="text-sm font-semibold text-blue-200 mb-2">
          IS Build — Revenue
        </h3>
        <p className="text-xs text-blue-300/80">
          First, identify your revenue streams (from Historicals). You can add a breakdown under any stream. Then choose how to forecast each item. The preview on the right shows historic + projected values and the methodology.
        </p>
      </div>

      {/* Forecast helper (historicals) – standalone advisory tool at top */}
      <div className="rounded-lg border border-indigo-500/70 bg-indigo-950/40 p-3 sm:p-4 space-y-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => setHelperOpen((v) => !v)}
            className="flex flex-1 items-start gap-3 text-left"
          >
            <div className="mt-1 text-indigo-200">
              {helperOpen ? "▾" : "▸"}
            </div>
            <div>
              <div className="mb-0.5 inline-flex items-center gap-2 rounded-full border border-indigo-400/60 bg-indigo-950/80 px-2 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-300" />
                <span className="text-[10px] font-medium uppercase tracking-wide text-indigo-200">
                  Helper tool (no impact on model)
                </span>
              </div>
              <h3 className="mt-1 text-sm font-semibold text-slate-50">Forecast helper — historical guidance</h3>
              <p className="text-[11px] text-slate-200/80">
                Paste or type historic values to see past growth or % of a reference line. Use the suggestions as
                starting points for your projections; you will manually decide what to input in the builder.
              </p>
            </div>
          </button>
          <div className="mt-2 flex gap-2 sm:mt-0">
            <button
              type="button"
              onClick={() => setHelperMode("growth")}
              className={`rounded-full px-3 py-1 text-[11px] border ${
                helperMode === "growth"
                  ? "border-blue-400 bg-blue-950 text-blue-100"
                  : "border-slate-700 bg-slate-900 text-slate-300"
              }`}
            >
              Growth rates
            </button>
            <button
              type="button"
              onClick={() => setHelperMode("pct_of_ref")}
              className={`rounded-full px-3 py-1 text-[11px] border ${
                helperMode === "pct_of_ref"
                  ? "border-emerald-400 bg-emerald-950 text-emerald-100"
                  : "border-slate-700 bg-slate-900 text-slate-300"
              }`}
            >
              % of reference
            </button>
          </div>
        </div>

        {helperOpen && (
          helperMode === "growth" ? (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-300">
              Use this for any series (revenue, price, volume, users, etc.). Enter at least two years to see
              year-over-year growth and suggested ranges (conservative / base / aggressive).
            </p>
            <div className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/60">
              <table className="min-w-full border-collapse text-[11px] text-slate-200">
                <thead className="bg-slate-900/80">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium text-slate-300">Year</th>
                    <th className="px-2 py-1 text-right font-medium text-slate-300">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {growthRows.map((row, idx) => (
                    <tr key={idx} className="border-t border-slate-800">
                          <td className="px-2 py-1">
                        <input
                          type="text"
                          className="w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
                          value={row.year}
                          onChange={(e) => {
                            const next = [...growthRows];
                            next[idx] = { ...next[idx], year: e.target.value };
                            setGrowthRows(next);
                          }}
                          placeholder="2022"
                        />
                      </td>
                          <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          className="w-28 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
                          value={row.value}
                          onChange={(e) => {
                            const next = [...growthRows];
                            next[idx] = { ...next[idx], value: e.target.value };
                            setGrowthRows(next);
                          }}
                          placeholder="e.g. 1200"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setGrowthRows((rows) => [...rows, { year: "", value: "" }])}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 hover:border-slate-500"
              >
                + Add year
              </button>
              <button
                type="button"
                onClick={() =>
                  setGrowthRows([
                    { year: "", value: "" },
                    { year: "", value: "" },
                    { year: "", value: "" },
                  ])
                }
                className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
              >
                Clear
              </button>
            </div>

            {(() => {
              const parsed = growthRows
                .map((r) => ({
                  year: r.year.trim(),
                  value: Number(r.value),
                }))
                .filter((r) => r.year && !Number.isNaN(r.value));
              if (parsed.length < 2) {
                return (
                  <p className="text-[11px] text-slate-500">
                    Enter at least two non-empty years to see growth calculations.
                  </p>
                );
              }
              const rowsWithGrowth: { year: string; value: number; yoy?: number }[] = [];
              for (let i = 0; i < parsed.length; i++) {
                const current = parsed[i];
                const prev = i > 0 ? parsed[i - 1] : null;
                const yoy = prev && prev.value !== 0 ? current.value / prev.value - 1 : undefined;
                rowsWithGrowth.push({ year: current.year, value: current.value, yoy });
              }
              const yoyValues = rowsWithGrowth
                .map((r) => r.yoy)
                .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
              const avgYoY =
                yoyValues.length > 0 ? yoyValues.reduce((sum, v) => sum + v, 0) / yoyValues.length : undefined;
              const last3 = yoyValues.slice(-3);
              const last3Avg =
                last3.length > 0 ? last3.reduce((sum, v) => sum + v, 0) / last3.length : undefined;
              const first = parsed[0];
              const last = parsed[parsed.length - 1];
              const periods = parsed.length - 1;
              const cagr =
                periods > 0 && first.value > 0 ? Math.pow(last.value / first.value, 1 / periods) - 1 : undefined;

              const baseGrowth = typeof last3Avg === "number" ? last3Avg : avgYoY;
              const conservativeGrowth =
                typeof baseGrowth === "number" ? baseGrowth * 0.8 : undefined;
              const aggressiveGrowth =
                typeof baseGrowth === "number" ? baseGrowth * 1.2 : undefined;

              return (
                <div className="space-y-3">
                  <div className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/60">
                    <table className="min-w-full border-collapse text-[11px] text-slate-200">
                      <thead className="bg-slate-900/80">
                        <tr>
                          <th className="px-2 py-1 text-left font-medium text-slate-300">Year</th>
                          <th className="px-2 py-1 text-right font-medium text-slate-300">Value</th>
                          <th className="px-2 py-1 text-right font-medium text-slate-300">YoY %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowsWithGrowth.map((r) => (
                          <tr key={r.year} className="border-t border-slate-800">
                            <td className="px-2 py-1">{r.year}</td>
                            <td className="px-2 py-1 text-right">
                              {r.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 py-1 text-right text-slate-300">
                              {typeof r.yoy === "number" ? `${(r.yoy * 100).toFixed(2)}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-1 text-[11px] text-slate-300">
                    {typeof avgYoY === "number" && (
                      <div className="flex items-center gap-2">
                        <span>
                          Average YoY growth: <span className="font-semibold">{(avgYoY * 100).toFixed(2)}%</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard((avgYoY * 100).toFixed(2))}
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                        >
                          Copy %
                        </button>
                      </div>
                    )}
                    {typeof last3Avg === "number" && (
                      <div className="flex items-center gap-2">
                        <span>
                          Last 3 years average:{" "}
                          <span className="font-semibold">{(last3Avg * 100).toFixed(2)}%</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard((last3Avg * 100).toFixed(2))}
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                        >
                          Copy %
                        </button>
                      </div>
                    )}
                    {typeof cagr === "number" && Number.isFinite(cagr) && (
                      <div className="flex items-center gap-2">
                        <span>
                          CAGR (first to last):{" "}
                          <span className="font-semibold">{(cagr * 100).toFixed(2)}%</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard((cagr * 100).toFixed(2))}
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                        >
                          Copy %
                        </button>
                      </div>
                    )}
                  </div>

                  {typeof baseGrowth === "number" && (
                    <div className="mt-1 rounded-md border border-indigo-700/70 bg-indigo-950/60 px-2 py-2 text-[11px] text-slate-100">
                      <div className="mb-1 font-semibold text-indigo-100">AI-style guidance (you still decide):</div>
                      <div className="space-y-1">
                        {typeof conservativeGrowth === "number" && (
                          <div className="flex items-center gap-2">
                            <span>
                              Conservative (slower than history):{" "}
                              <span className="font-semibold">
                                {(conservativeGrowth * 100).toFixed(2)}%
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard((conservativeGrowth * 100).toFixed(2))}
                              className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                            >
                              Copy %
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <span>
                            Base (close to recent trend):{" "}
                            <span className="font-semibold">{(baseGrowth * 100).toFixed(2)}%</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard((baseGrowth * 100).toFixed(2))}
                            className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                          >
                            Copy %
                          </button>
                        </div>
                        {typeof aggressiveGrowth === "number" && (
                          <div className="flex items-center gap-2">
                            <span>
                              Aggressive (faster than history):{" "}
                              <span className="font-semibold">
                                {(aggressiveGrowth * 100).toFixed(2)}%
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard((aggressiveGrowth * 100).toFixed(2))}
                              className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                            >
                              Copy %
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-300">
              Use this to understand an item as % of a reference (e.g. COGS as % of revenue, Marketing as % of total
              opex). Enter both series for each year. If you tell us what the item and reference represent, we can
              suggest conservative/base/aggressive % values.
            </p>
            <div className="flex flex-wrap gap-3 text-[11px]">
              <label className="flex flex-1 min-w-[160px] flex-col gap-1">
                <span className="text-slate-300">What is the item?</span>
                <input
                  type="text"
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100"
                  value={pctItemLabel}
                  onChange={(e) => setPctItemLabel(e.target.value)}
                  placeholder="e.g. COGS, Marketing, SG&A"
                />
              </label>
              <label className="flex flex-1 min-w-[160px] flex-col gap-1">
                <span className="text-slate-300">What is the reference?</span>
                <input
                  type="text"
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100"
                  value={pctReferenceLabel}
                  onChange={(e) => setPctReferenceLabel(e.target.value)}
                  placeholder="e.g. Revenue, Total opex"
                />
              </label>
            </div>
            <div className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/60">
              <table className="min-w-full border-collapse text-[11px] text-slate-200">
                <thead className="bg-slate-900/80">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium text-slate-300">Year</th>
                    <th className="px-2 py-1 text-right font-medium text-slate-300">Item</th>
                    <th className="px-2 py-1 text-right font-medium text-slate-300">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {pctRows.map((row, idx) => (
                    <tr key={idx} className="border-t border-slate-800">
                          <td className="px-2 py-1">
                        <input
                          type="text"
                          className="w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
                          value={row.year}
                          onChange={(e) => {
                            const next = [...pctRows];
                            next[idx] = { ...next[idx], year: e.target.value };
                            setPctRows(next);
                          }}
                          placeholder="2022"
                        />
                      </td>
                          <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          className="w-28 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
                          value={row.value}
                          onChange={(e) => {
                            const next = [...pctRows];
                            next[idx] = { ...next[idx], value: e.target.value };
                            setPctRows(next);
                          }}
                          placeholder="Item (e.g. COGS)"
                        />
                      </td>
                          <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          className="w-28 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
                          value={row.reference}
                          onChange={(e) => {
                            const next = [...pctRows];
                            next[idx] = { ...next[idx], reference: e.target.value };
                            setPctRows(next);
                          }}
                          placeholder="Reference (e.g. Revenue)"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPctRows((rows) => [...rows, { year: "", value: "", reference: "" }])}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 hover:border-slate-500"
              >
                + Add year
              </button>
              <button
                type="button"
                onClick={() =>
                  setPctRows([
                    { year: "", value: "", reference: "" },
                    { year: "", value: "", reference: "" },
                    { year: "", value: "", reference: "" },
                  ])
                }
                className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
              >
                Clear
              </button>
            </div>

            {(() => {
              const parsed = pctRows
                .map((r) => ({
                  year: r.year.trim(),
                  value: Number(r.value),
                  reference: Number(r.reference),
                }))
                .filter(
                  (r) =>
                    r.year &&
                    !Number.isNaN(r.value) &&
                    !Number.isNaN(r.reference) &&
                    r.reference !== 0
                );
              if (parsed.length === 0) {
                return (
                  <p className="text-[11px] text-slate-500">
                    Enter item and reference values (reference ≠ 0) to see % of reference.
                  </p>
                );
              }
              const rowsWithPct = parsed.map((r) => ({
                year: r.year,
                value: r.value,
                reference: r.reference,
                pct: r.value / r.reference,
              }));
              const pctValues = rowsWithPct.map((r) => r.pct).filter((v) => Number.isFinite(v));
              const avgPct =
                pctValues.length > 0 ? pctValues.reduce((sum, v) => sum + v, 0) / pctValues.length : undefined;
              const last3 = pctValues.slice(-3);
              const last3Avg =
                last3.length > 0 ? last3.reduce((sum, v) => sum + v, 0) / last3.length : undefined;
              const minPct = pctValues.length > 0 ? Math.min(...pctValues) : undefined;
              const maxPct = pctValues.length > 0 ? Math.max(...pctValues) : undefined;

              const basePct = typeof last3Avg === "number" ? last3Avg : avgPct;

              // Only make directional suggestions when user has told us what the item and reference are
              const hasLabels =
                pctItemLabel.trim().length > 0 && pctReferenceLabel.trim().length > 0 && typeof basePct === "number";
              const labelLower = pctItemLabel.trim().toLowerCase();
              const isCostLike =
                /cogs|cost|expense|opex|operating expense|marketing|selling|s&m|sg&a|g&a|overhead|rent|payroll|salary|wage/.test(
                  labelLower
                );
              const conservativePct =
                hasLabels && typeof basePct === "number"
                  ? basePct * (isCostLike ? 1.05 : 0.95)
                  : undefined;
              const aggressivePct =
                hasLabels && typeof basePct === "number"
                  ? basePct * (isCostLike ? 0.95 : 1.05)
                  : undefined;

              return (
                <div className="space-y-3">
                  <div className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/60">
                    <table className="min-w-full border-collapse text-[11px] text-slate-200">
                      <thead className="bg-slate-900/80">
                        <tr>
                          <th className="px-2 py-1 text-left font-medium text-slate-300">Year</th>
                          <th className="px-2 py-1 text-right font-medium text-slate-300">Item</th>
                          <th className="px-2 py-1 text-right font-medium text-slate-300">Reference</th>
                          <th className="px-2 py-1 text-right font-medium text-slate-300">% of reference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowsWithPct.map((r) => (
                          <tr key={r.year} className="border-t border-slate-800">
                            <td className="px-2 py-1">{r.year}</td>
                            <td className="px-2 py-1 text-right">
                              {r.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 py-1 text-right">
                              {r.reference.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 py-1 text-right text-slate-300">
                              {(r.pct * 100).toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-1 text-[11px] text-slate-300">
                    {typeof avgPct === "number" && (
                      <div className="flex items-center gap-2">
                        <span>
                          Average % of reference:{" "}
                          <span className="font-semibold">{(avgPct * 100).toFixed(2)}%</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard((avgPct * 100).toFixed(2))}
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                        >
                          Copy %
                        </button>
                      </div>
                    )}
                    {typeof last3Avg === "number" && (
                      <div className="flex items-center gap-2">
                        <span>
                          Last 3 years average:{" "}
                          <span className="font-semibold">{(last3Avg * 100).toFixed(2)}%</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard((last3Avg * 100).toFixed(2))}
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                        >
                          Copy %
                        </button>
                      </div>
                    )}
                    {typeof minPct === "number" && typeof maxPct === "number" && (
                      <div className="text-slate-400">
                        Range across years: {(minPct * 100).toFixed(2)}% – {(maxPct * 100).toFixed(2)}%
                      </div>
                    )}
                  </div>

                  {hasLabels && typeof basePct === "number" && (
                    <div className="mt-1 rounded-md border border-indigo-700/70 bg-indigo-950/60 px-2 py-2 text-[11px] text-slate-100">
                      <div className="mb-1 font-semibold text-indigo-100">
                        Suggested % of reference for {pctItemLabel || "item"} as % of{" "}
                        {pctReferenceLabel || "reference"}:
                      </div>
                      <div className="space-y-1">
                        {typeof conservativePct === "number" && (
                          <div className="flex items-center gap-2">
                            <span>
                              {isCostLike ? "Conservative (slightly higher cost share): " : "Conservative (slightly lower share): "}
                              <span className="font-semibold">
                                {(conservativePct * 100).toFixed(2)}%
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard((conservativePct * 100).toFixed(2))}
                              className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                            >
                              Copy %
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <span>
                            Base (close to recent mix):{" "}
                            <span className="font-semibold">{(basePct * 100).toFixed(2)}%</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard((basePct * 100).toFixed(2))}
                            className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                          >
                            Copy %
                          </button>
                        </div>
                        {typeof aggressivePct === "number" && (
                          <div className="flex items-center gap-2">
                            <span>
                              {isCostLike ? "Aggressive (lower cost share): " : "Aggressive (higher share): "}
                              <span className="font-semibold">
                                {(aggressivePct * 100).toFixed(2)}%
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard((aggressivePct * 100).toFixed(2))}
                              className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500"
                            >
                              Copy %
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          )
        )}
      </div>

      {!rev ? (
        <div className="rounded border border-amber-800/40 bg-amber-950/20 p-4 text-sm text-amber-200">
          No Revenue line found. Complete the Income Statement in Historicals.
        </div>
      ) : (
        <div className="space-y-4">
          <CollapsibleSection
            sectionId="is_build_revenue_streams"
            title="Revenue streams"
            description={`You have ${streams.length} stream(s). Add breakdowns or set forecast method for each.`}
            colorClass="blue"
            defaultExpanded={true}
          >
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={expandAllStreams}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Expand all
              </button>
              <span className="text-slate-600">|</span>
              <button
                type="button"
                onClick={collapseAllStreams}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Collapse all
              </button>
            </div>
            <ul className="space-y-4">
              {streams.map((stream) => {
                const children = config.breakdowns?.[stream.id] ?? [];
                const hasChildren = children.length > 0;
                const isExpanded = expandedItems.has(stream.id);
                const itemConfig = config.items[stream.id];
                const method = itemConfig?.method ?? null;

                return (
                  <li
                    key={stream.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(stream.id)}
                        className="text-left font-medium text-slate-200 flex items-center gap-2"
                      >
                        <span className="text-slate-400">{isExpanded ? "▼" : "▶"}</span>
                        {stream.label}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="ml-4 space-y-3">
                        {/* No breakdowns: forecast the stream directly. With breakdowns: stream is a result (sum of breakdowns). */}
                        {!hasChildren && (
                          <div className="space-y-2">
                            <label className="block text-xs text-slate-400">
                              How to forecast <strong className="text-slate-300">{stream.label}</strong>?
                            </label>
                            <select
                              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 w-full max-w-xs"
                              value={method ?? ""}
                              onChange={(e) => {
                                const v = e.target.value as RevenueProjectionMethod;
                                setRevenueProjectionMethod(stream.id, v);
                              }}
                            >
                              <option value="">Select method...</option>
                              {(Object.keys(METHOD_LABELS) as RevenueProjectionMethod[]).map((m) => (
                                <option key={m} value={m}>
                                  {METHOD_LABELS[m]}
                                </option>
                              ))}
                            </select>
                            {itemConfig && (
                              <div className="mt-2 pl-2 border-l-2 border-slate-700">
                                <RevenueForecastInputs
                                  method={itemConfig.method}
                                  inputs={itemConfig.inputs}
                                  lastHistoricYear={lastHistoricYear}
                                  projectionYears={projectionYears}
                                  currencyUnit={unit}
                                  revenueStreamOptions={revenueStreamOptions}
                                  onChange={(next) =>
                                    setRevenueProjectionInputs(stream.id, next)
                                  }
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* When stream has breakdowns: collapsible block for allocation + breakdown cards */}
                        {hasChildren && (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleBreakdowns(stream.id)}
                              className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 w-full text-left"
                            >
                              <span className="text-slate-500">
                                {breakdownsExpanded.has(stream.id) ? "▶" : "▼"}
                              </span>
                              <span>Breakdowns ({children.length})</span>
                            </button>
                            {!breakdownsExpanded.has(stream.id) && (
                              <div className="ml-4 space-y-3">
                            <p className="text-xs text-slate-500">
                              <strong>{stream.label}</strong> is the sum of the breakdowns below. Set each breakdown’s share (%) and how to project it.
                            </p>
                            <RevenueBreakdownAllocation
                              parentStream={stream}
                              breakdownItems={children}
                              firstProjectionYear={projectionYears[0] ?? ""}
                            />
                            {children.map((sub) => {
                              const subConfig = config.items[sub.id];
                              const subMethod = subConfig?.method ?? null;
                              const isEditing = editingBreakdown === sub.id;
                              const isConfirmed = confirmedBreakdowns.has(sub.id);
                              return (
                                <div
                                  key={sub.id}
                                  className="rounded border border-slate-800 bg-slate-950/60 p-3 space-y-2"
                                >
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    {isEditing ? (
                                      <div className="flex gap-2 items-center flex-1 min-w-0">
                                        <input
                                          type="text"
                                          className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 min-w-0"
                                          value={editLabel}
                                          onChange={(e) => setEditLabel(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                              const trimmed = editLabel.trim();
                                              if (trimmed) renameRevenueBreakdown(stream.id, sub.id, trimmed);
                                              setEditingBreakdown(null);
                                            }
                                            if (e.key === "Escape") setEditingBreakdown(null);
                                          }}
                                          autoFocus
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const trimmed = editLabel.trim();
                                            if (trimmed) renameRevenueBreakdown(stream.id, sub.id, trimmed);
                                            setEditingBreakdown(null);
                                          }}
                                          className="text-xs text-blue-400 hover:text-blue-300"
                                        >
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingBreakdown(null)}
                                          className="text-xs text-slate-400"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-xs font-medium text-slate-300">{sub.label}</span>
                                    )}
                                    {!isEditing && (
                                      <div className="flex gap-2 items-center">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingBreakdown(sub.id);
                                            setEditLabel(sub.label);
                                          }}
                                          className="text-[10px] text-blue-400 hover:text-blue-300"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setConfirmedBreakdowns((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(sub.id)) next.delete(sub.id);
                                              else next.add(sub.id);
                                              return next;
                                            })
                                          }
                                          className={`text-[10px] ${isConfirmed ? "text-green-400" : "text-slate-400 hover:text-slate-300"}`}
                                        >
                                          {isConfirmed ? "Confirmed" : "Confirm"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => removeRevenueBreakdown(stream.id, sub.id)}
                                          className="text-[10px] text-red-400 hover:text-red-300"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <div className="mt-2">
                                    <label className="block text-[10px] text-slate-500 mb-1">How to project this item?</label>
                                    <select
                                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 w-full max-w-xs"
                                      value={subMethod ?? ""}
                                      onChange={(e) => {
                                        const v = e.target.value as RevenueProjectionMethod;
                                        setRevenueProjectionMethod(sub.id, v);
                                      }}
                                    >
                                      <option value="">Select method...</option>
                                      {(Object.keys(METHOD_LABELS) as RevenueProjectionMethod[]).map((m) => (
                                        <option key={m} value={m}>
                                          {METHOD_LABELS[m]}
                                        </option>
                                      ))}
                                    </select>
                                    {subConfig && (
                                      <div className="mt-2 pl-2 border-l-2 border-slate-700">
                                        <RevenueForecastInputs
                                          method={subConfig.method}
                                          inputs={subConfig.inputs}
                                          lastHistoricYear={lastHistoricYear}
                                          projectionYears={projectionYears}
                                          currencyUnit={unit}
                                          revenueStreamOptions={revenueStreamOptions}
                                          onChange={(next) =>
                                            setRevenueProjectionInputs(sub.id, next)
                                          }
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                              </div>
                            )}
                          </>
                        )}

                        {/* Add breakdown - always visible when stream expanded */}
                        <div className="mt-2">
                          {addingForParent === stream.id ? (
                            <div className="flex gap-2 items-end">
                              <input
                                type="text"
                                className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                                placeholder="e.g. Recurring from monthly subscribers"
                                value={newBreakdownLabel}
                                onChange={(e) => setNewBreakdownLabel(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleAddBreakdown(stream.id);
                                  if (e.key === "Escape") {
                                    setAddingForParent(null);
                                    setNewBreakdownLabel("");
                                  }
                                }}
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => handleAddBreakdown(stream.id)}
                                className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500"
                              >
                                Add
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAddingForParent(null);
                                  setNewBreakdownLabel("");
                                }}
                                className="rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-300"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAddingForParent(stream.id)}
                              className="text-xs text-blue-400 hover:text-blue-300"
                            >
                              + Add breakdown
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CollapsibleSection>

          {/* COGS card — one COGS % of revenue input per projected revenue line */}
          <CollapsibleSection
            sectionId="is_build_cogs"
            title="Cost of Goods Sold (COGS)"
            description={
              leafRevenueLines.length > 0
                ? "For each projected revenue line below, enter the % of that line's revenue that is COGS. Total COGS is calculated in the preview."
                : "Add revenue streams and configure projections above; then COGS % inputs will appear here for each projected line."
            }
            colorClass="orange"
            defaultExpanded={true}
          >
            {leafRevenueLines.length === 0 ? (
              <div className="rounded-md border border-orange-700/40 bg-orange-950/40 p-3 text-center">
                <p className="text-xs text-orange-400">
                  Configure revenue streams and their breakdowns above. Each projected line will get a COGS % input here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[10px] text-orange-400">
                  COGS % of revenue by line (0–100). Choose constant % for all projection years or a different % each year.
                </p>
                {leafRevenueLines.map(({ id, label }) => {
                  const mode = cogsPctModeByRevenueLine[id] ?? "constant";
                  const constantPct = cogsPctByRevenueLine[id] ?? 0;
                  const byYear = cogsPctByRevenueLineByYear[id] ?? {};
                  return (
                    <div
                      key={id}
                      className="rounded-md border border-orange-700/40 bg-orange-950/40 p-3 space-y-2"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs font-medium text-orange-200 min-w-0 truncate" title={label}>
                          {label}
                        </span>
                        <div className="flex items-center gap-2 text-[10px]">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name={`cogs-mode-${id}`}
                              checked={mode === "constant"}
                              onChange={() => setCogsPctModeForRevenueLine(id, "constant")}
                              className="rounded border-orange-700"
                            />
                            <span className="text-orange-300">Constant %</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name={`cogs-mode-${id}`}
                              checked={mode === "custom"}
                              onChange={() => setCogsPctModeForRevenueLine(id, "custom")}
                              className="rounded border-orange-700"
                            />
                            <span className="text-orange-300">Different each year</span>
                          </label>
                        </div>
                      </div>
                      {mode === "constant" ? (
                        <label className="flex shrink-0 items-center gap-2">
                          <span className="text-[10px] text-orange-400">COGS %</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            className="w-20 rounded-md border border-orange-800 bg-orange-950 px-2 py-1 text-xs text-orange-100"
                            value={constantPct === 0 ? "" : constantPct}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "" || v === "-") {
                                setCogsPctForRevenueLine(id, 0);
                                return;
                              }
                              const n = Number(v);
                              if (!Number.isNaN(n)) setCogsPctForRevenueLine(id, n);
                            }}
                            onBlur={(e) => {
                              if (e.target.value === "") setCogsPctForRevenueLine(id, 0);
                            }}
                            placeholder="0"
                          />
                          <span className="text-[10px] text-orange-500">%</span>
                        </label>
                      ) : (
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {projectionYears.map((y) => {
                            const pct = byYear[y] ?? 0;
                            return (
                              <label key={y} className="flex items-center gap-1.5">
                                <span className="text-[10px] text-orange-400 w-10">{y}</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.1}
                                  className="w-16 rounded border border-orange-800 bg-orange-950 px-1.5 py-0.5 text-xs text-orange-100"
                                  value={pct === 0 ? "" : pct}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === "" || v === "-") {
                                      setCogsPctForRevenueLineYear(id, y, 0);
                                      return;
                                    }
                                    const n = Number(v);
                                    if (!Number.isNaN(n)) setCogsPctForRevenueLineYear(id, y, n);
                                  }}
                                  onBlur={(e) => {
                                    if (e.target.value === "") setCogsPctForRevenueLineYear(id, y, 0);
                                  }}
                                  placeholder="0"
                                />
                                <span className="text-[10px] text-orange-500">%</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CollapsibleSection>

          {/* Gross Profit & Gross Margin (calculated) */}
          {cogsRow && grossProfitRow && grossMarginRow && (
            <>
              <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-emerald-200 mb-1">Gross Profit (calculated)</h3>
                  <p className="text-xs text-emerald-300/80">Gross Profit = Total Revenue − Total COGS</p>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                  {(years.length > 0 ? years : (meta?.years?.historical ?? [])).map((y) => {
                    const storedValue = grossProfitRow.values?.[y] ?? 0;
                    const display = formatCurrencyDisplay(storedValue, unit, meta?.currency ?? "USD");
                    return (
                      <div key={y} className="block">
                        <div className="mb-1 text-[10px] text-emerald-400">{y}</div>
                        <div className="rounded-md border border-emerald-800 bg-emerald-950/60 px-2 py-1 text-xs font-semibold text-emerald-200">
                          {storedValue !== 0 ? display : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-emerald-200 mb-1">Gross Margin % (calculated)</h3>
                  <p className="text-xs text-emerald-300/80">Gross Margin % = (Gross Profit / Revenue) × 100</p>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                  {(years.length > 0 ? years : (meta?.years?.historical ?? [])).map((y) => {
                    const storedValue = grossMarginRow.values?.[y] ?? 0;
                    const display = storedValue !== 0 ? `${storedValue.toFixed(2)}%` : "—";
                    return (
                      <div key={y} className="block">
                        <div className="mb-1 text-[10px] text-emerald-400">{y}</div>
                        <div className="rounded-md border border-emerald-800 bg-emerald-950/60 px-2 py-1 text-xs font-semibold text-emerald-200">
                          {display}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* SG&A card – forecast SG&A as % of total revenue by item; supports breakdown (sub-items) */}
          <CollapsibleSection
            sectionId="is_build_sga"
            title="Selling, General & Administrative (SG&A)"
            description="Project SG&A items as a % of total revenue. Use Break down to add sub-items; only leaf items have a % input (parents = sum of children)."
            colorClass="purple"
            defaultExpanded={true}
          >
            {!sgaRow || !sgaRow.children || sgaRow.children.length === 0 ? (
              <div className="rounded-md border border-purple-700/40 bg-purple-950/30 p-3 text-xs text-purple-100">
                No SG&A items found. Add SG&A breakdowns under the SG&A row in the Historicals Income Statement, then
                return here to set SG&A % of revenue.
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-purple-200/80">
                  For each <strong>leaf</strong> item below, enter the % of total revenue (0–100) for projection years.
                  Parent rows are the sum of their sub-items. Use &quot;Break down&quot; to add sub-items to an item.
                </p>
                {(() => {
                  // Flatten SG&A tree into { row, depth } for display; leaves have no children
                  function flattenSga(rows: Row[], depth: number): Array<{ row: Row; depth: number }> {
                    const out: Array<{ row: Row; depth: number }> = [];
                    for (const r of rows) {
                      out.push({ row: r, depth });
                      if (r.children?.length) {
                        out.push(...flattenSga(r.children, depth + 1));
                      }
                    }
                    return out;
                  }
                  const sgaFlat = flattenSga(sgaRow.children, 0);

                  const unit = (meta?.currencyUnit ?? "millions") as "units" | "thousands" | "millions";

                  // Find row anywhere in tree by id (for reading canonical fixed-category values)
                  function findRowDeep(rows: Row[], rowId: string): Row | null {
                    for (const r of rows) {
                      if (r.id === rowId) return r;
                      if (r.children?.length) {
                        const found = findRowDeep(r.children, rowId);
                        if (found) return found;
                      }
                    }
                    return null;
                  }

                  // Find row by label match (e.g. "R&D" or "Research & Development") anywhere in tree
                  function findRowDeepByLabel(rows: Row[], labelPattern: RegExp): Row | null {
                    for (const r of rows) {
                      if (labelPattern.test((r.label ?? "").trim())) return r;
                      if (r.children?.length) {
                        const found = findRowDeepByLabel(r.children, labelPattern);
                        if (found) return found;
                      }
                    }
                    return null;
                  }

                  // Known fixed SG&A category ids and label patterns (user inputs historic data in Historicals for these)
                  const FIXED_SGA_LOOKUP: { id: string; labelPattern: RegExp }[] = [
                    { id: "rd", labelPattern: /r&d|research\s*&\s*development/i },
                    { id: "other_opex", labelPattern: /other\s*operating|other\s*op\s*ex/i },
                    { id: "danda", labelPattern: /d&a|depreciation\s*&\s*amortization/i },
                  ];
                  function getCanonicalRowForFixedCategory(row: Row, isRows: Row[]): Row | null {
                    const label = (row.label ?? "").trim().toLowerCase();
                    if (row.id === "rd" || row.id === "other_opex" || row.id === "danda") {
                      const found = findRowDeep(isRows, row.id);
                      if (found) return found;
                    }
                    for (const { id, labelPattern } of FIXED_SGA_LOOKUP) {
                      if (labelPattern.test(row.label ?? "")) {
                        const byId = findRowDeep(isRows, id);
                        if (byId) return byId;
                        const byLabel = findRowDeepByLabel(isRows, labelPattern);
                        if (byLabel) return byLabel;
                        return null;
                      }
                    }
                    return null;
                  }

                  function renderSgaItem(item: Row, depth: number, parentItem: Row | null) {
                    const isLeaf = !item.children?.length;
                    const isSubItem = depth > 0;
                    const mode = isSubItem
                      ? (sgaPctOfParentModeByItemId[item.id] ?? "constant")
                      : (sgaPctModeByItemId[item.id] ?? "constant");
                    const constantPct = isSubItem
                      ? (sgaPctOfParentByItemId[item.id] ?? 0)
                      : (sgaPctByItemId[item.id] ?? 0);
                    const byYear = isSubItem
                      ? (sgaPctOfParentByItemIdByYear[item.id] ?? {})
                      : (sgaPctByItemIdByYear[item.id] ?? {});
                    const isEditing = editingSgaItemId === item.id;
                    const isConfirmed = confirmedSgaItems.has(item.id);
                    const breakdownMode = sgaBreakdownHelperModeByParentId[item.id] ?? "weights";

                    // Fixed category amount: always use stored/computed values from the row that has the user's historic input (this row or canonical row by id/label), then sum of children / breakdown helper.
                    const getFixedCategoryAmount = (row: Row, year: string): number => {
                      const selfVal = (row.values ?? {})[year] ?? 0;
                      if (selfVal !== 0) return selfVal;
                      const canonicalRow = getCanonicalRowForFixedCategory(row, incomeStatement);
                      if (canonicalRow && canonicalRow.id !== row.id) {
                        const canonicalStored = (canonicalRow.values ?? {})[year] ?? 0;
                        if (canonicalStored !== 0) return canonicalStored;
                        const canonicalComputed = computeRowValue(
                          canonicalRow,
                          year,
                          incomeStatement,
                          incomeStatement,
                          allStatements,
                          sbcBreakdowns,
                          danaBreakdowns
                        ) ?? 0;
                        if (canonicalComputed !== 0) return canonicalComputed;
                      }
                      if (row.children?.length) {
                        const fromIS = row.children.reduce((s, c) => s + ((c.values ?? {})[year] ?? 0), 0);
                        if (fromIS !== 0) return fromIS;
                        return row.children.reduce(
                          (s, c) => s + ((sgaHistoricAmountByItemIdByYear[c.id] ?? {})[year] ?? 0),
                          0
                        );
                      }
                      return 0;
                    };

                    // Historic % of revenue: always show the fixed category amount from the IS (informational only).
                    const histPcts: { year: string; pct: number }[] = [];
                    if (rev) {
                      for (const y of historicalYears) {
                        let itemVal =
                          depth === 0 ? getFixedCategoryAmount(item, y) : (computeRowValue(
                                item,
                                y,
                                incomeStatement,
                                incomeStatement,
                                allStatements,
                                sbcBreakdowns,
                                danaBreakdowns
                              ) ?? 0);
                        // If fixed amount is 0 (e.g. parent has children, no values on tree), use computed row value so R&D etc. show historic %
                        if (depth === 0 && itemVal === 0) {
                          itemVal = computeRowValue(
                            item,
                            y,
                            incomeStatement,
                            incomeStatement,
                            allStatements,
                            sbcBreakdowns,
                            danaBreakdowns
                          ) ?? 0;
                        }
                        const revVal =
                          computeRowValue(
                            rev,
                            y,
                            incomeStatement,
                            incomeStatement,
                            allStatements,
                            sbcBreakdowns,
                            danaBreakdowns
                          ) ?? 0;
                        if (revVal !== 0) {
                          const pct = (itemVal / revVal) * 100;
                          histPcts.push({ year: y, pct });
                        }
                      }
                    }
                    const pctValues = histPcts.map((p) => p.pct);
                    const avg = pctValues.length > 0 ? pctValues.reduce((s, v) => s + v, 0) / pctValues.length : undefined;
                    const last3 = pctValues.slice(-3);
                    const last3Avg = last3.length > 0 ? last3.reduce((s, v) => s + v, 0) / last3.length : undefined;

                    return (
                      <div
                        key={item.id}
                        className="rounded-md border border-purple-700/50 bg-purple-950/40 p-3 space-y-2"
                        style={{ marginLeft: depth * 12 }}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          {isEditing ? (
                            <div className="flex gap-2 items-center flex-1 min-w-0">
                              <input
                                type="text"
                                className="flex-1 rounded border border-purple-700 bg-purple-950 px-2 py-1 text-xs text-purple-100 min-w-0"
                                value={editSgaLabel}
                                onChange={(e) => setEditSgaLabel(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    const trimmed = editSgaLabel.trim();
                                    if (trimmed) renameRow("incomeStatement", item.id, trimmed);
                                    setEditingSgaItemId(null);
                                  }
                                  if (e.key === "Escape") setEditingSgaItemId(null);
                                }}
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const trimmed = editSgaLabel.trim();
                                  if (trimmed) renameRow("incomeStatement", item.id, trimmed);
                                  setEditingSgaItemId(null);
                                }}
                                className="text-[10px] text-blue-300 hover:text-blue-200"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingSgaItemId(null)}
                                className="text-[10px] text-purple-300/70"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs font-medium text-purple-50">{item.label}</span>
                          )}
                          {!isEditing && (
                            <div className="flex items-center gap-2 flex-wrap">
                              {(isLeaf || depth === 0) && (
                                <div className="flex items-center gap-2 text-[10px]">
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={`sga-mode-${item.id}`}
                                      checked={mode === "constant"}
                                      onChange={() =>
                                        isSubItem
                                          ? setSgaPctOfParentModeForItem(item.id, "constant")
                                          : setSgaPctModeForItem(item.id, "constant")
                                      }
                                      className="rounded border-purple-700"
                                    />
                                    <span className="text-purple-200">Constant %</span>
                                  </label>
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={`sga-mode-${item.id}`}
                                      checked={mode === "custom"}
                                      onChange={() =>
                                        isSubItem
                                          ? setSgaPctOfParentModeForItem(item.id, "custom")
                                          : setSgaPctModeForItem(item.id, "custom")
                                      }
                                      className="rounded border-purple-700"
                                    />
                                    <span className="text-purple-200">Different each year</span>
                                  </label>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setAddingSgaSubItemParentId(item.id);
                                  setNewSgaSubItemLabel("");
                                }}
                                className="text-[10px] text-purple-400 hover:text-purple-300"
                              >
                                {isLeaf ? "+ Break down" : "+ Add sub-item"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSgaItemId(item.id);
                                  setEditSgaLabel(item.label);
                                }}
                                className="text-[10px] text-blue-300 hover:text-blue-200"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmedSgaItems((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(item.id)) next.delete(item.id);
                                    else next.add(item.id);
                                    return next;
                                  })
                                }
                                className={`text-[10px] ${
                                  isConfirmed ? "text-green-400" : "text-purple-300/80 hover:text-purple-100"
                                }`}
                              >
                                {isConfirmed ? "Confirmed" : "Confirm"}
                              </button>
                              {depth > 0 && (
                                <button
                                  type="button"
                                  onClick={() => removeRow("incomeStatement", item.id)}
                                  className="text-[10px] text-red-400 hover:text-red-300"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {addingSgaSubItemParentId === item.id && (
                          <div className="mt-2 rounded-md border border-purple-600/50 bg-purple-950/50 p-2 flex flex-wrap items-center gap-2">
                            <label className="text-[10px] text-purple-300">Sub-item name</label>
                            <input
                              type="text"
                              value={newSgaSubItemLabel}
                              onChange={(e) => setNewSgaSubItemLabel(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const trimmed = newSgaSubItemLabel.trim();
                                  if (trimmed) {
                                    addChildRow("incomeStatement", item.id, trimmed);
                                    setAddingSgaSubItemParentId(null);
                                    setNewSgaSubItemLabel("");
                                  }
                                }
                                if (e.key === "Escape") {
                                  setAddingSgaSubItemParentId(null);
                                  setNewSgaSubItemLabel("");
                                }
                              }}
                              placeholder="New sub-item"
                              className="flex-1 min-w-[120px] rounded border border-purple-700 bg-purple-950 px-2 py-1 text-xs text-purple-100 placeholder:text-purple-500"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const trimmed = newSgaSubItemLabel.trim();
                                if (trimmed) {
                                  addChildRow("incomeStatement", item.id, trimmed);
                                  setAddingSgaSubItemParentId(null);
                                  setNewSgaSubItemLabel("");
                                }
                              }}
                              className="text-[10px] text-purple-200 bg-purple-800/80 hover:bg-purple-700/80 px-2 py-1 rounded"
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAddingSgaSubItemParentId(null);
                                setNewSgaSubItemLabel("");
                              }}
                              className="text-[10px] text-purple-400 hover:text-purple-200"
                            >
                              Cancel
                            </button>
                          </div>
                        )}

                        {(isLeaf || depth === 0) && (
                          <>
                            {mode === "constant" ? (
                              <div className="mt-2 flex flex-wrap items-center gap-3">
                                <label className="flex items-center gap-2">
                                  <span className="text-[10px] text-purple-300">
                                    {isSubItem ? `% of ${parentItem?.label ?? "parent"}` : "SG&A % of Revenue"}
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={0.1}
                                    className="w-20 rounded-md border border-purple-800 bg-purple-950 px-2 py-1 text-xs text-purple-50"
                                    value={constantPct === 0 ? "" : (isSubItem ? Number(constantPct).toFixed(1) : constantPct)}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (v === "" || v === "-") {
                                        if (isSubItem) setSgaPctOfParentForItem(item.id, 0);
                                        else setSgaPctForItem(item.id, 0);
                                        return;
                                      }
                                      const n = Number(v);
                                      if (!Number.isNaN(n)) {
                                        if (isSubItem) setSgaPctOfParentForItem(item.id, Math.round(n * 10) / 10);
                                        else setSgaPctForItem(item.id, n);
                                      }
                                    }}
                                    onBlur={(e) => {
                                      if (e.target.value === "") {
                                        if (isSubItem) setSgaPctOfParentForItem(item.id, 0);
                                        else setSgaPctForItem(item.id, 0);
                                      }
                                    }}
                                    placeholder="0"
                                  />
                                  <span className="text-[10px] text-purple-400">%</span>
                                </label>
                                {!isSubItem && (
                                  <div className="text-[10px] text-purple-300 space-x-2">
                                    {typeof avg === "number" && (
                                      <span>
                                        Avg hist: <span className="font-semibold">{avg.toFixed(2)}%</span>
                                      </span>
                                    )}
                                    {typeof last3Avg === "number" && (
                                      <span>
                                        Last 3y: <span className="font-semibold">{last3Avg.toFixed(2)}%</span>
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="mt-2 space-y-1">
                                <div className="text-[10px] text-purple-300">
                                  {isSubItem ? `% of ${parentItem?.label ?? "parent"} by year` : "SG&A % of Revenue by projection year"}
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-2">
                                  {projectionYears.map((y) => {
                                    const pct = byYear[y] ?? 0;
                                    return (
                                      <label key={y} className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-purple-300 w-10">{y}</span>
                                        <input
                                          type="number"
                                          min={0}
                                          max={100}
                                          step={0.1}
                                          className="w-16 rounded border border-purple-800 bg-purple-950 px-1.5 py-0.5 text-xs text-purple-50"
                                          value={pct === 0 ? "" : pct}
                                          onChange={(e) => {
                                            const v = e.target.value;
                                            if (v === "" || v === "-") {
                                              if (isSubItem) setSgaPctOfParentForItemYear(item.id, y, 0);
                                              else setSgaPctForItemYear(item.id, y, 0);
                                              return;
                                            }
                                            const n = Number(v);
                                            if (!Number.isNaN(n)) {
                                              if (isSubItem) setSgaPctOfParentForItemYear(item.id, y, n);
                                              else setSgaPctForItemYear(item.id, y, n);
                                            }
                                          }}
                                          onBlur={(e) => {
                                            if (e.target.value === "") {
                                              if (isSubItem) setSgaPctOfParentForItemYear(item.id, y, 0);
                                              else setSgaPctForItemYear(item.id, y, 0);
                                            }
                                          }}
                                          placeholder="0"
                                        />
                                        <span className="text-[10px] text-purple-400">%</span>
                                      </label>
                                    );
                                  })}
                                </div>
                                {!isSubItem && histPcts.length > 0 && (
                                  <div className="mt-1 text-[10px] text-purple-300">
                                    Hist % of Revenue:{" "}
                                    {histPcts.map((p) => `${p.year}: ${p.pct.toFixed(2)}%`).join(" · ")}
                                  </div>
                                )}
                              </div>
                            )}
                            {mode === "constant" && !isSubItem && histPcts.length > 0 && (
                              <div className="mt-1 text-[10px] text-purple-300">
                                Hist % of Revenue:{" "}
                                {histPcts.map((p) => `${p.year}: ${p.pct.toFixed(2)}%`).join(" · ")}
                              </div>
                            )}
                          </>
                        )}

                        {!isLeaf && item.children && item.children.length > 0 && (
                          <>
                            <div className="mt-3 rounded-md border border-purple-600/60 bg-purple-950/60 p-3 space-y-3">
                              <div className="text-[11px] font-medium text-purple-200">Breakdown helper</div>
                              <p className="text-[10px] text-purple-300/90">
                                Set the category total as % of revenue above. Then split that total between sub-items using historic amounts or weights.
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {historicalYears.map((y) => {
                                  let parentStored = getFixedCategoryAmount(item, y);
                                  if (parentStored === 0) {
                                    parentStored = computeRowValue(item, y, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
                                  }
                                  const displayVal = storedToDisplay(parentStored, unit);
                                  return (
                                    <span key={y} className="text-[10px] text-purple-400">
                                      {y}:{" "}
                                      <span className="font-semibold text-purple-200">
                                        {displayVal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                      </span>
                                      {getUnitLabel(unit) ? ` ${getUnitLabel(unit)}` : ""}
                                    </span>
                                  );
                                })}
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSgaBreakdownHelperModeByParentId((prev) => ({ ...prev, [item.id]: "historic_amounts" }))}
                                  className={`text-[10px] px-2 py-1 rounded ${breakdownMode === "historic_amounts" ? "bg-purple-700 text-purple-100" : "bg-purple-900/80 text-purple-300 hover:bg-purple-800"}`}
                                >
                                  Split by historic amounts
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSgaBreakdownHelperModeByParentId((prev) => ({ ...prev, [item.id]: "weights" }))}
                                  className={`text-[10px] px-2 py-1 rounded ${breakdownMode === "weights" ? "bg-purple-700 text-purple-100" : "bg-purple-900/80 text-purple-300 hover:bg-purple-800"}`}
                                >
                                  Split by % weights
                                </button>
                              </div>
                              {breakdownMode === "historic_amounts" && (
                                <div className="space-y-2">
                                  {(() => {
                                    const parentTotalsByYear: Record<string, number> = {};
                                    const childSumsByYear: Record<string, number> = {};
                                    for (const y of historicalYears) {
                                      let fixedCategoryTotal = getFixedCategoryAmount(item, y);
                                      if (fixedCategoryTotal === 0) {
                                        fixedCategoryTotal = computeRowValue(item, y, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
                                      }
                                      let sum = 0;
                                      for (const c of item.children ?? []) {
                                        sum += (sgaHistoricAmountByItemIdByYear[c.id] ?? {})[y] ?? 0;
                                      }
                                      parentTotalsByYear[y] = fixedCategoryTotal;
                                      childSumsByYear[y] = sum;
                                    }

                                    // Pick the most recent year where the user entered any child amounts and parent total exists
                                    let impliedYear: string | null = null;
                                    for (let i = historicalYears.length - 1; i >= 0; i--) {
                                      const y = historicalYears[i];
                                      if ((childSumsByYear[y] ?? 0) > 0) {
                                        impliedYear = y;
                                        break;
                                      }
                                    }

                                    const unitLabel = getUnitLabel(unit);

                                    const toleranceFor = (parentTotal: number) =>
                                      Math.max(1, Math.abs(parentTotal) * 0.001); // 0.1% or $1 (stored)

                                    return (
                                      <div className="rounded-md border border-purple-700/40 bg-purple-950/40 p-2">
                                        <div className="text-[10px] text-purple-300">
                                          Validation (child totals vs fixed category total)
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                                          {historicalYears.map((y) => {
                                            const parentTotal = parentTotalsByYear[y] ?? 0;
                                            const childSum = childSumsByYear[y] ?? 0;
                                            const diff = childSum - parentTotal;
                                            const ok = Math.abs(diff) <= toleranceFor(parentTotal);
                                            const parentDisp = storedToDisplay(parentTotal, unit);
                                            const childDisp = storedToDisplay(childSum, unit);
                                            const diffDisp = storedToDisplay(diff, unit);
                                            return (
                                              <div key={y} className="text-[10px]">
                                                <span className="text-purple-400">{y}:</span>{" "}
                                                <span className={ok ? "text-green-300" : "text-amber-300"}>
                                                  Sum {childDisp.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                                  {unitLabel ? ` ${unitLabel}` : ""}{" "}
                                                  / Total {parentDisp.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                                  {unitLabel ? ` ${unitLabel}` : ""}
                                                  {parentTotal > 0 && (childSum > 0 || parentTotal > 0) && (
                                                    <>
                                                      {" "}
                                                      (Diff {diffDisp.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                                      {unitLabel ? ` ${unitLabel}` : ""})
                                                    </>
                                                  )}
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                        <div className="mt-1 text-[10px] text-purple-400/90">
                                          Implied % is based on{" "}
                                          <span className="font-semibold text-purple-200">
                                            {impliedYear ?? "the latest year with inputs"}
                                          </span>
                                          .
                                        </div>
                                      </div>
                                    );
                                  })()}
                                  <div className="overflow-x-auto rounded border border-purple-700/50">
                                    <table className="w-full text-[10px]">
                                      <thead>
                                        <tr className="border-b border-purple-700/50">
                                          <th className="text-left py-1.5 px-2 text-purple-300">Sub-item</th>
                                          {historicalYears.map((y) => (
                                            <th key={y} className="text-right py-1.5 px-2 text-purple-300">{y}</th>
                                          ))}
                                          <th className="text-right py-1.5 px-2 text-purple-300">Implied %</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {item.children.map((child) => {
                                          // Implied % should be based on the most recent year the user actually entered data for
                                          let impliedYear: string | null = null;
                                          const childAmounts = sgaHistoricAmountByItemIdByYear[child.id] ?? {};
                                          for (let i = historicalYears.length - 1; i >= 0; i--) {
                                            const y = historicalYears[i];
                                            const amt = childAmounts[y] ?? 0;
                                            if (amt > 0) {
                                              impliedYear = y;
                                              break;
                                            }
                                          }

                                          const impliedAmount = impliedYear ? (childAmounts[impliedYear] ?? 0) : 0;
                                          const totalChildrenForImpliedYear =
                                            impliedYear && item.children
                                              ? item.children.reduce(
                                                  (sum, c) =>
                                                    sum +
                                                    ((sgaHistoricAmountByItemIdByYear[c.id] ?? {})[impliedYear] ?? 0),
                                                  0
                                                )
                                              : 0;
                                          const rawParentImplied = impliedYear
                                            ? computeRowValue(item, impliedYear, incomeStatement, incomeStatement) ?? 0
                                            : 0;
                                          const denom =
                                            rawParentImplied > 0 ? rawParentImplied : totalChildrenForImpliedYear;
                                          const impliedPct = denom > 0 ? (impliedAmount / denom) * 100 : 0;
                                          return (
                                            <tr key={child.id} className="border-b border-purple-800/50">
                                              <td className="py-1.5 px-2 text-purple-200">{child.label}</td>
                                              {historicalYears.map((y) => {
                                                const stored = (childAmounts[y] ?? 0);
                                                const display = storedToDisplay(stored, unit);
                                                const parentTotalY = getFixedCategoryAmount(item, y);
                                                const pctOfTotal = parentTotalY > 0 && stored > 0 ? (stored / parentTotalY) * 100 : null;
                                                return (
                                                  <td key={y} className="py-1 px-2 text-right">
                                                    <div className="flex flex-col items-end gap-0.5">
                                                      <input
                                                        type="number"
                                                        step="any"
                                                        className="w-16 rounded border border-purple-700 bg-purple-950 px-1 py-0.5 text-right text-purple-100 text-[10px]"
                                                        value={display === 0 ? "" : display}
                                                        onChange={(e) => {
                                                          const v = e.target.value;
                                                          if (v === "" || v === "-") {
                                                            setSgaHistoricAmountForItemYear(child.id, y, 0);
                                                            return;
                                                          }
                                                          const n = Number(v);
                                                          if (!Number.isNaN(n)) setSgaHistoricAmountForItemYear(child.id, y, displayToStored(n, unit));
                                                        }}
                                                        placeholder="0"
                                                      />
                                                      {pctOfTotal != null && (
                                                        <span className="text-[9px] text-purple-400 tabular-nums">
                                                          {pctOfTotal.toFixed(1)}% of total
                                                        </span>
                                                      )}
                                                    </div>
                                                  </td>
                                                );
                                              })}
                                              <td className="py-1.5 px-2 text-right text-purple-300 tabular-nums">
                                                {impliedPct > 0 ? `${impliedPct.toFixed(1)}%` : "—"}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const lastY = historicalYears[historicalYears.length - 1];
                                        if (!lastY) return;
                                        const parentLast = getFixedCategoryAmount(item, lastY);
                                        if (parentLast <= 0) return;
                                        item.children?.forEach((c) => {
                                          const amt = (sgaHistoricAmountByItemIdByYear[c.id] ?? {})[lastY] ?? 0;
                                          const pct = (amt / parentLast) * 100;
                                          setSgaPctOfParentForItem(c.id, Math.round(pct * 10) / 10);
                                        });
                                      }}
                                      className="text-[10px] text-purple-200 bg-purple-800/80 hover:bg-purple-700/80 px-2 py-1 rounded"
                                    >
                                      Apply last year mix
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        let totalParent = 0;
                                        const sums: Record<string, number> = {};
                                        item.children?.forEach((c) => { sums[c.id] = 0; });
                                        historicalYears.forEach((y) => {
                                          totalParent += getFixedCategoryAmount(item, y);
                                          item.children?.forEach((c) => {
                                            sums[c.id] = (sums[c.id] ?? 0) + ((sgaHistoricAmountByItemIdByYear[c.id] ?? {})[y] ?? 0);
                                          });
                                        });
                                        if (totalParent <= 0) return;
                                        item.children?.forEach((c) => {
                                          const sum = sums[c.id] ?? 0;
                                          const pct = (sum / totalParent) * 100;
                                          setSgaPctOfParentForItem(c.id, Math.round(pct * 10) / 10);
                                        });
                                      }}
                                      className="text-[10px] text-purple-200 bg-purple-800/80 hover:bg-purple-700/80 px-2 py-1 rounded"
                                    >
                                      Apply avg mix
                                    </button>
                                  </div>
                                </div>
                              )}
                              {breakdownMode === "weights" && (
                                <div className="space-y-1">
                                  {item.children.map((c) => {
                                    const pct = sgaPctOfParentByItemId[c.id] ?? 0;
                                    return (
                                      <div key={c.id} className="flex items-center gap-2 text-[10px]">
                                        <span className="text-purple-300 w-32 truncate">{c.label}</span>
                                        <input
                                          type="number"
                                          min={0}
                                          max={100}
                                          step={0.1}
                                          className="w-14 rounded border border-purple-700 bg-purple-950 px-1.5 py-0.5 text-purple-100 text-right"
                                          value={pct === 0 ? "" : Number(pct).toFixed(1)}
                                          onChange={(e) => {
                                            const v = e.target.value;
                                            if (v === "" || v === "-") { setSgaPctOfParentForItem(c.id, 0); return; }
                                            const n = Number(v);
                                            if (!Number.isNaN(n)) setSgaPctOfParentForItem(c.id, Math.round(n * 10) / 10);
                                          }}
                                        />
                                        <span className="text-purple-400">% of {item.label}</span>
                                      </div>
                                    );
                                  })}
                                  {(() => {
                                    const total = (item.children ?? []).reduce((s, c) => s + (sgaPctOfParentByItemId[c.id] ?? 0), 0);
                                    return (
                                      <p className={`text-[10px] mt-1 ${Math.abs(total - 100) < 0.01 ? "text-green-400" : "text-amber-400"}`}>
                                        Sub-items total: {total.toFixed(1)}% {Math.abs(total - 100) >= 0.01 ? "(should be 100%)" : ""}
                                      </p>
                                    );
                                  })()}
                                </div>
                              )}
                            </div>
                            <div className="mt-2 space-y-2 border-l-2 border-purple-700/40 pl-3">
                              {item.children.map((child) => (
                                <Fragment key={child.id}>{renderSgaItem(child, depth + 1, item)}</Fragment>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  }

                  return (
                    <>
                      {sgaRow.children.map((item) => (
                        <Fragment key={item.id}>{renderSgaItem(item, 0, null)}</Fragment>
                      ))}
                    </>
                  );
                })()}
              </div>
            )}
          </CollapsibleSection>

        </div>
      )}
    </div>
  );
}
