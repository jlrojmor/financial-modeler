"use client";

import { useMemo, useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import type { RevenueProjectionMethod, RevenueProjectionInputs } from "@/types/revenue-projection";
import { formatCurrencyDisplay } from "@/lib/currency-utils";
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
  const meta = useModelStore((s) => s.meta);
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

  const [newBreakdownLabel, setNewBreakdownLabel] = useState("");
  const [addingForParent, setAddingForParent] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [editingBreakdown, setEditingBreakdown] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [confirmedBreakdowns, setConfirmedBreakdowns] = useState<Set<string>>(new Set());
  const [breakdownsExpanded, setBreakdownsExpanded] = useState<Set<string>>(new Set());

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
        </div>
      )}
    </div>
  );
}
