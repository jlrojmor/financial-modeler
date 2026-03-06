"use client";

import { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { computeRowValue, getDeltaWcBs } from "@/lib/calculations";
import {
  getWcScheduleItems,
  getDaysBaseForItemId,
  getRecommendedWcMethod,
  IB_GRADE_WC_RECOMMENDATIONS,
  computeHistoricDays,
  computeHistoricPct,
} from "@/lib/working-capital-schedule";
import { getRowsForCategory } from "@/lib/bs-category-mapper";
import CollapsibleSection from "@/components/collapsible-section";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import { getGuidanceReply, type GuidanceChatContext } from "@/lib/guidance-chat";

export default function WorkingCapitalScheduleCard() {
  const meta = useModelStore((s) => s.meta);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const incomeStatement = useModelStore((s) => s.incomeStatement);

  const wcDriverTypeByItemId = useModelStore((s) => s.wcDriverTypeByItemId ?? {});
  const wcDaysByItemId = useModelStore((s) => s.wcDaysByItemId ?? {});
  const wcDaysByItemIdByYear = useModelStore((s) => s.wcDaysByItemIdByYear ?? {});
  const wcDaysBaseByItemId = useModelStore((s) => s.wcDaysBaseByItemId ?? {});
  const wcPctBaseByItemId = useModelStore((s) => s.wcPctBaseByItemId ?? {});
  const wcPctByItemId = useModelStore((s) => s.wcPctByItemId ?? {});
  const wcPctByItemIdByYear = useModelStore((s) => s.wcPctByItemIdByYear ?? {});

  const setWcDriverType = useModelStore((s) => s.setWcDriverType);
  const setWcDaysForItem = useModelStore((s) => s.setWcDaysForItem);
  const setWcDaysForItemYear = useModelStore((s) => s.setWcDaysForItemYear);
  const setWcDaysBaseForItem = useModelStore((s) => s.setWcDaysBaseForItem);
  const setWcPctBaseForItem = useModelStore((s) => s.setWcPctBaseForItem);
  const setWcPctForItem = useModelStore((s) => s.setWcPctForItem);
  const setWcPctForItemYear = useModelStore((s) => s.setWcPctForItemYear);

  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    const proj = meta?.years?.projection ?? [];
    return [...hist, ...proj];
  }, [meta]);

  const historicYears = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);

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

  const revenueByYear = useMemo(() => {
    const revRow = incomeStatement?.find((r) => r.id === "rev");
    if (!revRow) return {} as Record<string, number>;
    const out: Record<string, number> = {};
    for (const y of years) {
      try {
        out[y] = computeRowValue(revRow, y, incomeStatement ?? [], incomeStatement ?? [], allStatements);
      } catch {
        out[y] = 0;
      }
    }
    return out;
  }, [incomeStatement, years, allStatements]);

  const cogsByYear = useMemo(() => {
    const cogsRow = incomeStatement?.find((r) => r.id === "cogs");
    if (!cogsRow) return {} as Record<string, number>;
    const out: Record<string, number> = {};
    for (const y of years) {
      try {
        out[y] = computeRowValue(cogsRow, y, incomeStatement ?? [], incomeStatement ?? [], allStatements);
      } catch {
        out[y] = 0;
      }
    }
    return out;
  }, [incomeStatement, years, allStatements]);

  const unit = meta?.currencyUnit ?? "millions";
  const [recommendationsOpen, setRecommendationsOpen] = useState(true);
  const [wcReconOpen, setWcReconOpen] = useState(false);
  const [guidanceMessages, setGuidanceMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [guidanceInput, setGuidanceInput] = useState("");
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const guidanceContext: GuidanceChatContext = "wc_schedule";

  // Historical WC reconciliation: ΔWC from BS (WC-tagged only) vs ΔWC from CFO (reported); Other WC / Reclass = difference
  type ReconRow = { year: string; deltaWcBs: number; deltaWcCfo: number; deltaWcCfoMissing?: boolean; reclass: number };
  const wcReconciliation = useMemo(() => {
    if (!balanceSheet?.length || !cashFlow?.length || historicYears.length < 2) return null;
    const wcRow = cashFlow.find((r) => r.id === "wc_change");
    const wcChildIds = new Set((wcRow?.children ?? []).filter((c) => c.id !== "other_wc_reclass").map((c) => c.id));
    const rows: ReconRow[] = [];
    for (let i = 0; i < historicYears.length; i++) {
      const y = historicYears[i];
      const prevY = i > 0 ? historicYears[i - 1] : null;
      const deltaWcBs = getDeltaWcBs(balanceSheet, y, prevY);
      let deltaWcCfo: number | null = 0;
      if (wcRow?.children?.length) {
        const sum = wcRow.children
          .filter((c) => c.id !== "other_wc_reclass")
          .reduce((s, c) => s + (c.values?.[y] ?? 0), 0);
        deltaWcCfo = sum;
      } else if (wcRow?.values?.[y] != null) {
        deltaWcCfo = wcRow.values[y];
      } else {
        deltaWcCfo = null;
      }
      // First historical year: no prior year, so no reconciliation; reclass = 0
      const reclass =
        i === 0 ? 0 : deltaWcCfo != null ? deltaWcCfo - deltaWcBs : 0;
      rows.push({
        year: y,
        deltaWcBs,
        deltaWcCfo: deltaWcCfo ?? 0,
        deltaWcCfoMissing: deltaWcCfo === null,
        reclass,
      });
    }
    const caRows = getRowsForCategory(balanceSheet, "current_assets").filter(
      (r) => r.id !== "cash" && !r.id.startsWith("total_") && r.cashFlowBehavior === "working_capital"
    );
    const clRows = getRowsForCategory(balanceSheet, "current_liabilities").filter(
      (r) => r.id !== "st_debt" && !r.id.startsWith("total_") && r.cashFlowBehavior === "working_capital"
    );
    return { rows, wcChildIds, caRows, clRows };
  }, [balanceSheet, cashFlow, historicYears]);

  // Variance warning: years where |ΔWC_CFO - ΔWC_BS| exceeds threshold, plus largest-changing rows to review
  const reconciliationVariance = useMemo(() => {
    if (!wcReconciliation || !revenueByYear) return null;
    const { rows, wcChildIds, caRows, clRows } = wcReconciliation;
    const allCaCl = [...caRows, ...clRows];
    const varianceYears: { year: string; reclass: number; threshold: number }[] = [];
    const highlightsByYear: Record<string, { wcRows: { label: string; delta: number }[]; nonWcRows: { label: string; delta: number }[] }> = {};
    const RECON_THRESHOLD_PCT = 0.01;
    const RECON_THRESHOLD_MIN = 1000;
    const TOP_N = 5;

    for (let i = 1; i < historicYears.length; i++) {
      const y = historicYears[i];
      const prevY = historicYears[i - 1];
      const rowData = rows.find((r) => r.year === y);
      if (!rowData) continue;
      const revenue = Math.abs(revenueByYear[y] ?? 0);
      const threshold = Math.max(RECON_THRESHOLD_MIN, revenue * RECON_THRESHOLD_PCT);
      if (Math.abs(rowData.reclass) <= threshold) continue;
      varianceYears.push({ year: y, reclass: rowData.reclass, threshold });

      const withDelta = allCaCl.map((r) => {
        const v = r.values?.[y] ?? 0;
        const prevV = r.values?.[prevY] ?? 0;
        return { row: r, delta: v - prevV };
      });
      const wcTagged = withDelta.filter((x) => wcChildIds.has(x.row.id)).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, TOP_N);
      const nonWcTagged = withDelta.filter((x) => !wcChildIds.has(x.row.id)).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, TOP_N);
      highlightsByYear[y] = {
        wcRows: wcTagged.map((x) => ({ label: x.row.label, delta: x.delta })),
        nonWcRows: nonWcTagged.map((x) => ({ label: x.row.label, delta: x.delta })),
      };
    }
    if (varianceYears.length === 0) return null;
    return { varianceYears, highlightsByYear };
  }, [wcReconciliation, historicYears, revenueByYear]);

  if (wcItems.length === 0) return null;

  const applyRecommendation = (item: { id: string; label: string }) => {
    const rec = getRecommendedWcMethod(item.id, item.label);
    if (!rec) return;
    setWcDriverType(item.id, rec.driver);
    if (rec.driver === "days" && rec.daysBase) setWcDaysBaseForItem(item.id, rec.daysBase);
    if (rec.driver === "pct_revenue") setWcPctBaseForItem(item.id, "revenue");
    if (rec.driver === "pct_cogs") setWcPctBaseForItem(item.id, "cogs");
  };

  const sendGuidanceMessage = async () => {
    const text = guidanceInput.trim();
    if (!text || guidanceLoading) return;
    setGuidanceInput("");
    setGuidanceMessages((prev) => [...prev, { role: "user", content: text }]);
    setGuidanceLoading(true);
    try {
      const reply = await getGuidanceReply(guidanceContext, text);
      setGuidanceMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setGuidanceMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong. You can try again or ask a different question." },
      ]);
    } finally {
      setGuidanceLoading(false);
    }
  };

  const assets = wcItems.filter((i) => i.side === "asset");
  const liabilities = wcItems.filter((i) => i.side === "liability");

  const formatVal = (v: number) => {
    if (v === 0) return "—";
    const d = storedToDisplay(v, unit);
    const label = getUnitLabel(unit);
    return `${d.toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}${label ? ` ${label}` : ""}`;
  };

  const renderItem = (item: { id: string; label: string; side: "asset" | "liability" }) => {
    const bsRow = balanceSheet?.find((r) => r.id === item.id);
    const driver = wcDriverTypeByItemId[item.id] ?? "manual";
    const effectiveDriver = driver === "manual" ? "days" : driver;
    const inferredDaysBase = getDaysBaseForItemId(item.id, item.label);
    // Base for % is implicit: pct_revenue → Revenue, pct_cogs → COGS (no separate selector)
    const daysBase = wcDaysBaseByItemId[item.id] ?? inferredDaysBase;
    const isProj = (y: string) => y.endsWith("E");

    return (
      <div key={item.id} className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-200">{item.label}</span>
          <select
            value={effectiveDriver}
            onChange={(e) => {
              const newDriver = e.target.value as "days" | "pct_revenue" | "pct_cogs";
              setWcDriverType(item.id, newDriver);
              if (newDriver === "pct_revenue") {
                setWcPctBaseForItem(item.id, "revenue");
              } else if (newDriver === "pct_cogs") {
                setWcPctBaseForItem(item.id, "cogs");
              } else if (newDriver === "days" && !wcDaysBaseByItemId[item.id]) {
                setWcDaysBaseForItem(item.id, inferredDaysBase);
              }
            }}
            className="rounded border border-slate-600 bg-slate-800 text-slate-200 text-xs px-2 py-1"
          >
            <option value="days">Days</option>
            <option value="pct_revenue">% of Total Revenue</option>
            <option value="pct_cogs">% of Total COGS</option>
          </select>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs">
          {years.map((y) => {
            const val = bsRow?.values?.[y] ?? 0;
            const rev = revenueByYear[y] ?? 0;
            const cogs = cogsByYear[y] ?? 0;
            const histDays = effectiveDriver === "days" ? computeHistoricDays(val, rev, cogs, daysBase) : null;
            const histPct =
              effectiveDriver === "pct_revenue" || effectiveDriver === "pct_cogs"
                ? computeHistoricPct(val, rev, cogs, effectiveDriver === "pct_cogs" ? "cogs" : "revenue")
                : null;
            return (
              <div key={y} className="flex flex-col">
                <span className="text-slate-500">{y}</span>
                {isProj(y) && driver !== "manual" ? (
                  effectiveDriver === "days" ? (
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={wcDaysByItemIdByYear[item.id]?.[y] ?? wcDaysByItemId[item.id] ?? ""}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        if (!Number.isNaN(n)) setWcDaysForItemYear(item.id, y, n);
                      }}
                      placeholder={wcDaysByItemId[item.id] != null ? String(wcDaysByItemId[item.id]) : "Days"}
                      className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-1 py-0.5 w-16 text-blue-400"
                    />
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={wcPctByItemIdByYear[item.id]?.[y] ?? wcPctByItemId[item.id] ?? ""}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        if (!Number.isNaN(n)) setWcPctForItemYear(item.id, y, n);
                      }}
                      placeholder={wcPctByItemId[item.id] != null ? `${wcPctByItemId[item.id]}%` : "%"}
                      className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-1 py-0.5 w-16 text-blue-400"
                    />
                  )
                ) : (
                  <span className="text-slate-200">{formatVal(val)}</span>
                )}
                {!isProj(y) && histDays != null && effectiveDriver === "days" && (
                  <span className="text-slate-500 text-[10px]">{histDays.toFixed(1)} d</span>
                )}
                {!isProj(y) && histPct != null && (effectiveDriver === "pct_revenue" || effectiveDriver === "pct_cogs") && (
                  <span className="text-slate-500 text-[10px]">{histPct.toFixed(1)}%</span>
                )}
              </div>
            );
          })}
        </div>
        {effectiveDriver === "days" && (
          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <span className="uppercase tracking-wide text-[9px]">Select base for days:</span>
            <div className="inline-flex items-center rounded-full border border-slate-600 bg-slate-900/70 p-0.5">
              <button
                type="button"
                onClick={() => setWcDaysBaseForItem(item.id, "revenue")}
                className={
                  daysBase === "revenue"
                    ? "px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-300 font-semibold"
                    : "px-2 py-0.5 rounded-full hover:bg-slate-700 hover:text-slate-100"
                }
              >
                Revenue
              </button>
              <button
                type="button"
                onClick={() => setWcDaysBaseForItem(item.id, "cogs")}
                className={
                  daysBase === "cogs"
                    ? "px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-300 font-semibold"
                    : "px-2 py-0.5 rounded-full hover:bg-slate-700 hover:text-slate-100"
                }
              >
                COGS
              </button>
            </div>
          </div>
        )}
        {effectiveDriver === "days" && projectionYears.length > 0 && (
          <div className="text-[10px] text-slate-500">
            Constant days (all projection years):{" "}
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
              className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-1 py-0.5 w-14 text-blue-400 inline"
            />
          </div>
        )}
        {(driver === "pct_revenue" || driver === "pct_cogs") && (
          <div className="text-[10px] text-slate-500">
            Constant % (all projection years):{" "}
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={wcPctByItemId[item.id] ?? ""}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (!Number.isNaN(n)) setWcPctForItem(item.id, n);
              }}
              placeholder="—"
              className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-1 py-0.5 w-14 text-blue-400 inline"
            />
            %
          </div>
        )}
      </div>
    );
  };

  return (
    <CollapsibleSection
      sectionId="wc_schedule"
      title="Working Capital Schedule"
      description="Forecast operating WC items used in Cash Flow from Operations. Only items linked to CFO are listed."
      colorClass="blue"
      defaultExpanded={true}
    >
      <p className="text-xs text-slate-500 mb-3">
        Items below are taken from the Cash Flow Statement (Working Capital section). Set driver type and inputs; projected balances will appear in the Real-time Excel Preview.
      </p>

      {/* IB-grade recommendations — guidance only, no impact on model */}
      <div className="rounded-lg border border-amber-500/50 bg-amber-950/30 p-3 mb-4 space-y-2 shadow-sm">
        <button
          type="button"
          onClick={() => setRecommendationsOpen((v) => !v)}
          className="flex w-full items-start gap-2 text-left"
        >
          <span className="text-amber-200">{recommendationsOpen ? "▾" : "▸"}</span>
          <div className="flex-1 min-w-0">
            <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-amber-400/60 bg-amber-950/60 px-2 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
              <span className="text-[10px] font-medium uppercase tracking-wide text-amber-200">
                Guidance only — no impact on model
              </span>
            </div>
            <h4 className="text-sm font-semibold text-slate-100">IB-grade forecast methods</h4>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Standard methods for WC items. You can choose any method above; this is only a guide.
            </p>
          </div>
        </button>
        {recommendationsOpen && (
          <div className="space-y-3 pl-5">
            <div className="overflow-x-auto rounded-md border border-slate-700 bg-slate-950/60">
              <table className="min-w-full border-collapse text-[11px] text-slate-200">
                <thead className="bg-slate-800/80">
                  <tr>
                    <th className="border-b border-slate-600 px-2 py-1.5 text-left font-medium text-slate-200">Line item</th>
                    <th className="border-b border-slate-600 px-2 py-1.5 text-left font-medium text-slate-200">Default forecast method</th>
                  </tr>
                </thead>
                <tbody>
                  {IB_GRADE_WC_RECOMMENDATIONS.map((row, i) => (
                    <tr key={i} className="border-b border-slate-700/50 last:border-0">
                      <td className="px-2 py-1.5">{row.lineItem}</td>
                      <td className="px-2 py-1.5 text-amber-200/90">{row.method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-slate-400">
              <span className="font-medium text-slate-300">Apply to your items:</span> Click below to set each line to the recommended method (you can change it anytime).
            </div>
            <div className="flex flex-wrap gap-1.5">
              {wcItems.map((item) => {
                const rec = getRecommendedWcMethod(item.id, item.label);
                if (!rec) return null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => applyRecommendation(item)}
                    className="rounded border border-amber-500/40 bg-amber-900/30 px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-800/40"
                  >
                    {item.label} → {rec.methodLabel}
                  </button>
                );
              })}
            </div>

            {/* Guidance chat: FAQ now; can be wired to /api/guidance-chat (e.g. OpenAI) later */}
            <div className="border-t border-amber-500/30 pt-3 mt-3">
              <div className="text-[10px] font-medium text-slate-300 mb-1.5">Ask a question (WC / IB methods)</div>
              <div className="max-h-32 overflow-y-auto rounded border border-slate-700 bg-slate-950/80 p-2 space-y-2 mb-2">
                {guidanceMessages.length === 0 && (
                  <p className="text-[10px] text-slate-500 italic">e.g. How do I project receivables? What is DSO?</p>
                )}
                {guidanceMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`text-[11px] ${m.role === "user" ? "text-right" : "text-left"}`}
                  >
                    <span className={m.role === "user" ? "text-amber-200" : "text-slate-200"}>
                      {m.role === "user" ? "You: " : "Guidance: "}
                    </span>
                    <span className="text-slate-300">{m.content}</span>
                  </div>
                ))}
                {guidanceLoading && (
                  <p className="text-[10px] text-slate-500 italic">Thinking…</p>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={guidanceInput}
                  onChange={(e) => setGuidanceInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendGuidanceMessage()}
                  placeholder="e.g. How do I project AR?"
                  className="flex-1 min-w-0 rounded border border-slate-600 bg-slate-900 text-slate-200 text-[11px] px-2 py-1.5 placeholder:text-slate-500"
                  disabled={guidanceLoading}
                />
                <button
                  type="button"
                  onClick={sendGuidanceMessage}
                  disabled={!guidanceInput.trim() || guidanceLoading}
                  className="rounded border border-amber-500/50 bg-amber-900/40 px-2 py-1.5 text-[11px] text-amber-100 hover:bg-amber-800/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {assets.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-green-300 mb-2">Operating current assets</h4>
          <div className="space-y-2">{assets.map(renderItem)}</div>
        </div>
      )}
      {liabilities.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-orange-300 mb-2">Operating current liabilities</h4>
          <div className="space-y-2">{liabilities.map(renderItem)}</div>
        </div>
      )}

      {/* Historical WC reconciliation (informational): ΔWC from BS vs ΔWC from CFO */}
      {wcReconciliation && wcReconciliation.rows.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-600 bg-slate-900/40 p-3">
          {reconciliationVariance && reconciliationVariance.varianceYears.length > 0 && (
            <div className="mb-3 rounded-md border border-amber-600/50 bg-amber-950/30 p-2">
              <p className="text-xs font-semibold text-amber-200">
                ⚠️ Reconciliation variance exceeds 1% of revenue in: {reconciliationVariance.varianceYears.map((v) => v.year).join(", ")}.
              </p>
              <p className="text-[11px] text-amber-200/90 mt-1">
                Review largest-changing WC-tagged rows and non-WC CA/CL rows below for possible reclassifications.
              </p>
              {reconciliationVariance.varianceYears.slice(0, 3).map(({ year }) => {
                const h = reconciliationVariance.highlightsByYear[year];
                if (!h) return null;
                return (
                  <div key={year} className="mt-2 text-[11px] text-slate-300">
                    <span className="font-medium text-slate-200">{year}:</span>{" "}
                    WC: {h.wcRows.map((x) => x.label).join(", ") || "—"}
                    {" · "}
                    Non-WC CA/CL: {h.nonWcRows.map((x) => x.label).join(", ") || "—"}
                  </div>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => setWcReconOpen((v) => !v)}
            className="flex w-full items-center gap-2 text-left text-xs font-medium text-slate-300"
          >
            <span>{wcReconOpen ? "▾" : "▸"}</span>
            Historical WC reconciliation (ΔWC BS vs CFO)
          </button>
          {wcReconOpen && (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-[11px] text-slate-200">
                <thead>
                  <tr className="border-b border-slate-600">
                    <th className="px-2 py-1.5 text-left font-medium text-slate-400">Year</th>
                    <th className="px-2 py-1.5 text-right font-medium text-slate-400">ΔWC (BS)</th>
                    <th className="px-2 py-1.5 text-right font-medium text-slate-400">ΔWC (CFO)</th>
                    <th className="px-2 py-1.5 text-right font-medium text-slate-400">Other WC / Reclass</th>
                  </tr>
                </thead>
                <tbody>
                  {wcReconciliation.rows.map((row) => (
                    <tr key={row.year} className="border-b border-slate-700/50 last:border-0">
                      <td className="px-2 py-1.5">{row.year}</td>
                      <td className="px-2 py-1.5 text-right">{formatVal(row.deltaWcBs)}</td>
                      <td className="px-2 py-1.5 text-right">
                        {row.deltaWcCfoMissing ? (
                          <span className="text-amber-400/90">Missing</span>
                        ) : (
                          formatVal(row.deltaWcCfo)
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-400">
                        {row.deltaWcCfoMissing ? "—" : formatVal(row.reclass)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-slate-500 mt-2">
                Historical CFO WC is used for reconciliation only. Forecast WC is driven by projected BS balances. Other WC / Reclass = ΔWC (CFO) − ΔWC (BS).
              </p>
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}
