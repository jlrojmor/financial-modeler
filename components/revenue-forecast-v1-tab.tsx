"use client";

import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import type { ForecastRevenueNodeV1 } from "@/types/revenue-forecast-v1";
import { validateRevenueForecastV1 } from "@/lib/revenue-forecast-v1-validation";
import { RevenueForecastV1HierarchyEditor } from "@/components/revenue-forecast-v1-hierarchy-editor";
import { RevenueForecastV1DirectForecastBlock } from "@/components/revenue-forecast-v1-direct-forecast-block";
import { RevenueForecastLineNameAdd } from "@/components/revenue-forecast-v1-deferred-input";
import {
  DIRECT_FORECAST_EXPLAINER,
  DERIVED_PARENT_EXPLAINER,
  getDirectForecastCompactSummary,
  getDirectForecastRowUiStatus,
} from "@/lib/revenue-forecast-v1-methodology";
import { computeRevenueProjectionsV1 } from "@/lib/revenue-projection-engine-v1";
import { storedToDisplay, displayToStored, getUnitLabel } from "@/lib/currency-utils";
import { computeRowValue } from "@/lib/calculations";
import CollapsibleSection from "@/components/collapsible-section";
import { expandIdsForNodePath } from "@/lib/revenue-row-state-v1";

function findIsRow(rows: Row[], id: string): Row | null {
  for (const r of rows) {
    if (r.id === id) return r;
    if (r.children?.length) {
      const f = findIsRow(r.children, id);
      if (f) return f;
    }
  }
  return null;
}

export default function RevenueForecastV1Tab() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const meta = useModelStore((s) => s.meta);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const revenueForecastConfigV1 = useModelStore((s) => s.revenueForecastConfigV1);
  const setRevenueForecastRowV1 = useModelStore((s) => s.setRevenueForecastRowV1);
  const addRevenueStream = useModelStore((s) => s.addRevenueStream);
  const addRevenueStreamChild = useModelStore((s) => s.addRevenueStreamChild);
  const removeForecastRevenueRowV1 = useModelStore((s) => s.removeForecastRevenueRowV1);
  const syncRevenueForecastTreeFromHistoricalIfEmpty = useModelStore((s) => s.syncRevenueForecastTreeFromHistoricalIfEmpty);
  const revenueForecastTreeV1 = useModelStore((s) => s.revenueForecastTreeV1 ?? []);

  useEffect(() => {
    syncRevenueForecastTreeFromHistoricalIfEmpty();
  }, [syncRevenueForecastTreeFromHistoricalIfEmpty, incomeStatement]);

  const [expandedStreams, setExpandedStreams] = useState<Set<string>>(new Set());
  const [revAllocControlsVisible, setRevAllocControlsVisible] = useState(false);
  const [flashRowId, setFlashRowId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashRow = useCallback((id: string) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashRowId(id);
    flashTimerRef.current = setTimeout(() => {
      setFlashRowId(null);
      flashTimerRef.current = null;
    }, 2400);
  }, []);

  const ensureExpandedIds = useCallback((ids: string[]) => {
    setExpandedStreams((prev) => {
      const next = new Set(prev);
      ids.forEach((x) => next.add(x));
      return next;
    });
  }, []);

  const [pendingDirectFocusRowId, setPendingDirectFocusRowId] = useState<string | null>(null);
  const [pendingAllocationFocusRowId, setPendingAllocationFocusRowId] = useState<string | null>(null);
  const [revDirectCardOpen, setRevDirectCardOpen] = useState(true);
  const [revFocusNonce, setRevFocusNonce] = useState(0);

  const historicalYears = useMemo(() => meta?.years?.historical ?? [], [meta?.years?.historical]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta?.years?.projection]);
  const lastHistoricYear = useMemo(() => historicalYears[historicalYears.length - 1] ?? "", [historicalYears]);
  const unit = (meta?.currencyUnit ?? "millions") as "units" | "thousands" | "millions";
  const unitLabel = getUnitLabel(unit);

  const revRow = useMemo(() => incomeStatement?.find((r) => r.id === "rev"), [incomeStatement]);
  const streams = revenueForecastTreeV1;

  const flatRowsForTable = useMemo(() => {
    if (!revRow) return [] as { id: string; label: string; depth: number; isForecastOnly: boolean; isRev: boolean }[];
    const out: { id: string; label: string; depth: number; isForecastOnly: boolean; isRev: boolean }[] = [
      {
        id: revRow.id,
        label: revRow.label ?? "Total Revenue",
        depth: 0,
        isForecastOnly: false,
        isRev: true,
      },
    ];
    const walk = (nodes: ForecastRevenueNodeV1[], depth: number) => {
      for (const n of nodes) {
        out.push({
          id: n.id,
          label: n.label,
          depth,
          isForecastOnly: n.isForecastOnly,
          isRev: false,
        });
        walk(n.children, depth + 1);
      }
    };
    walk(revenueForecastTreeV1, 1);
    return out;
  }, [revRow, revenueForecastTreeV1]);

  const allStatements = useMemo(
    () => ({
      incomeStatement: incomeStatement ?? [],
      balanceSheet: balanceSheet ?? [],
      cashFlow: cashFlow ?? [],
    }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  const lastHistoricByRowId = useMemo(() => {
    if (!incomeStatement?.length || !lastHistoricYear || !revRow) return undefined;
    const out: Record<string, number> = {};
    const addForId = (rowId: string, row: Row | null) => {
      if (!row) {
        out[rowId] = NaN;
        return;
      }
      const v = computeRowValue(row, lastHistoricYear, incomeStatement, incomeStatement, allStatements);
      out[rowId] = typeof v === "number" && !Number.isNaN(v) ? v : NaN;
    };
    addForId("rev", revRow);
    const walk = (nodes: ForecastRevenueNodeV1[]) => {
      for (const n of nodes) {
        addForId(n.id, findIsRow(incomeStatement, n.id));
        walk(n.children);
      }
    };
    walk(revenueForecastTreeV1);
    return out;
  }, [incomeStatement, lastHistoricYear, revRow, revenueForecastTreeV1, allStatements]);

  const validation = useMemo(
    () =>
      validateRevenueForecastV1(incomeStatement ?? [], revenueForecastConfigV1 ?? { rows: {} }, {
        forecastTree: revenueForecastTreeV1,
        lastHistoricYear,
        lastHistoricByRowId,
        projectionYears,
      }),
    [incomeStatement, revenueForecastConfigV1, revenueForecastTreeV1, lastHistoricYear, lastHistoricByRowId, projectionYears]
  );

  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns);
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns);
  const { result: projectedV1, valid: projectionValid } = useMemo(() => {
    if (!validation.valid || !incomeStatement?.length || projectionYears.length === 0) {
      return { result: {} as Record<string, Record<string, number>>, valid: false };
    }
    return computeRevenueProjectionsV1(
      incomeStatement,
      revenueForecastTreeV1,
      revenueForecastConfigV1 ?? { rows: {} },
      projectionYears,
      lastHistoricYear,
      allStatements,
      sbcBreakdowns ?? {},
      danaBreakdowns ?? {}
    );
  }, [
    validation.valid,
    incomeStatement,
    revenueForecastTreeV1,
    revenueForecastConfigV1,
    projectionYears,
    lastHistoricYear,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
  ]);

  useEffect(() => {
    if (!revRow || !revenueForecastConfigV1) return;
    if (revenueForecastConfigV1.rows?.["rev"]) return;
    const hasTree = (revenueForecastTreeV1?.length ?? 0) > 0;
    if (hasTree) {
      setRevenueForecastRowV1("rev", { forecastRole: "derived_sum", forecastMethod: undefined, forecastParameters: {} });
    } else {
      const v = lastHistoricByRowId?.["rev"];
      const hasRevHist = typeof v === "number" && !Number.isNaN(v);
      setRevenueForecastRowV1("rev", {
        forecastRole: "independent_driver",
        forecastMethod: "growth_rate",
        forecastParameters: hasRevHist
          ? { startingBasis: "last_historical" }
          : { startingBasis: "starting_amount" },
      });
    }
  }, [revRow, revenueForecastConfigV1, revenueForecastTreeV1, lastHistoricByRowId, setRevenueForecastRowV1]);

  const toggleStreamExpanded = (streamId: string) => {
    setExpandedStreams((prev) => {
      const next = new Set(prev);
      if (next.has(streamId)) next.delete(streamId);
      else next.add(streamId);
      return next;
    });
  };

  const revCfg = revenueForecastConfigV1?.rows?.["rev"];
  const revIsDerived = revCfg?.forecastRole === "derived_sum";

  const revAllowGrowthFromHistorical = useMemo(() => {
    const v = lastHistoricByRowId?.["rev"];
    return typeof v === "number" && !Number.isNaN(v);
  }, [lastHistoricByRowId]);

  const handleAddStreamNamed = (trimmed: string) => {
    if (!trimmed) return;
    const newId = addRevenueStream(trimmed);
    if (!newId) return;
    if (revCfg?.forecastRole === "independent_driver") {
      setRevAllocControlsVisible(true);
      setRevenueForecastRowV1(newId, {
        forecastRole: "allocation_of_parent",
        forecastMethod: undefined,
        forecastParameters: {},
      });
    } else {
      setRevenueForecastRowV1(newId, {
        forecastRole: "independent_driver",
        forecastMethod: "growth_rate",
        forecastParameters: { startingBasis: "starting_amount" },
      });
    }
    queueMicrotask(() => {
      const tree = useModelStore.getState().revenueForecastTreeV1 ?? [];
      const path = expandIdsForNodePath(tree, newId);
      if (path?.length) ensureExpandedIds(path);
      flashRow(newId);
      if (revCfg?.forecastRole === "derived_sum") {
        setTimeout(() => setPendingDirectFocusRowId(newId), 0);
      } else if (revCfg?.forecastRole === "independent_driver") {
        setTimeout(() => setPendingAllocationFocusRowId(newId), 0);
      }
    });
  };

  const switchRevToDirectForecast = () => {
    for (const s of streams) {
      if ((s.children?.length ?? 0) > 0) {
        window.alert(
          "To forecast Total Revenue directly, each line under it must be a simple % split (no sub-groups). Remove nested lines under top-level rows first, then switch."
        );
        return;
      }
    }
    setRevenueForecastRowV1("rev", {
      forecastRole: "independent_driver",
      forecastMethod: "growth_rate",
      forecastParameters: revAllowGrowthFromHistorical
        ? { startingBasis: "last_historical" }
        : { startingBasis: "starting_amount" },
    });
    streams.forEach((s) => {
      setRevenueForecastRowV1(s.id, {
        forecastRole: "allocation_of_parent",
        forecastMethod: undefined,
        forecastParameters: { allocationPercent: streams.length > 0 ? 100 / streams.length : 0 },
      });
    });
    setRevAllocControlsVisible(streams.length > 0);
    setRevDirectCardOpen(true);
    queueMicrotask(() => setRevFocusNonce((n) => n + 1));
  };

  const switchRevToBuildFromLines = () => {
    setRevenueForecastRowV1("rev", { forecastRole: "derived_sum", forecastMethod: undefined, forecastParameters: {} });
    streams.forEach((s) => {
      setRevenueForecastRowV1(s.id, {
        forecastRole: "independent_driver",
        forecastMethod: "growth_rate",
        forecastParameters: { startingBasis: "starting_amount" },
      });
    });
    setRevAllocControlsVisible(false);
  };

  const handleRemoveRow = (rowId: string) => {
    if (rowId === "rev") return;
    removeForecastRevenueRowV1(rowId);
    if (revCfg?.forecastRole === "independent_driver") {
      queueMicrotask(() => {
        const top = useModelStore.getState().revenueForecastTreeV1 ?? [];
        if (top.length === 0) setRevAllocControlsVisible(false);
      });
    }
  };

  if (!revRow) {
    return (
      <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-4">
        <p className="text-sm text-amber-200">
          No Revenue line found. Complete the Income Statement in Statement Structure, then return here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!validation.valid && (
        <div className="rounded-lg border border-amber-600/50 bg-amber-950/30 p-4">
          <h3 className="text-sm font-semibold text-amber-200 mb-2">Revenue forecast setup</h3>
          <p className="text-xs text-amber-200/90 mb-2">Fix the following so projections can run:</p>
          <ul className="list-disc list-inside text-xs text-amber-200/90 space-y-1">
            {validation.errors.map((e, i) => (
              <li key={i}>{e.rowId ? `"${e.rowId}": ` : ""}{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      <CollapsibleSection
        sectionId="revenue_v1_historic"
        title="Historic & projected revenue"
        description="Historical columns come only from Historicals (read-only here). Projection columns come only from Revenue Forecast v1. Forecast Drivers never overwrite historical data."
        colorClass="blue"
        defaultExpanded={true}
      >
        <p className="text-[11px] text-slate-500 mb-2">
          Historical values are display-only in Forecast Drivers and come from Historicals.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="pb-2 pr-4 text-xs font-semibold text-slate-300">Line</th>
                {historicalYears.map((y) => (
                  <th key={y} className="pb-2 px-2 text-xs font-semibold text-slate-300 text-right">
                    {y}
                    {unitLabel && <span className="block text-[10px] font-normal text-slate-500">({unitLabel})</span>}
                  </th>
                ))}
                {projectionYears.map((y) => (
                  <th key={y} className="pb-2 px-2 text-xs font-semibold text-amber-300/90 text-right">
                    {y}
                    {unitLabel && <span className="block text-[10px] font-normal text-amber-400/70">({unitLabel})</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flatRowsForTable.map(({ id, label, depth, isForecastOnly: foBadge, isRev }) => {
                const projVal = projectionValid ? projectedV1[id] : null;
                const isRow = isRev ? revRow! : findIsRow(incomeStatement ?? [], id);
                return (
                  <tr key={id} className={`border-b border-slate-800/60 ${depth === 0 ? "bg-slate-900/40" : ""}`}>
                    <td className="py-2 pr-4 text-xs text-slate-200" style={{ paddingLeft: depth * 20 }}>
                      <span className="inline-flex items-center gap-1.5">
                        {label}
                        {foBadge && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-600/60 text-slate-400" title="Forecast-only line: not on Historicals IS; historical columns may be blank.">
                            Forecast-only
                          </span>
                        )}
                      </span>
                    </td>
                    {historicalYears.map((y) => {
                      if (!isRow) {
                        return (
                          <td key={y} className="py-2 px-2 text-xs text-slate-500 text-right tabular-nums">
                            —
                          </td>
                        );
                      }
                      const stored = computeRowValue(isRow, y, incomeStatement!, incomeStatement!, allStatements);
                      const display = storedToDisplay(stored, unit);
                      const str = display === 0 ? "—" : display.toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
                      return (
                        <td key={y} className="py-2 px-2 text-xs text-slate-200 text-right tabular-nums">
                          {str}
                          {unitLabel && str !== "—" ? ` ${unitLabel}` : ""}
                        </td>
                      );
                    })}
                    {projectionYears.map((y) => {
                      const stored = projVal?.[y] ?? 0;
                      const display = storedToDisplay(stored, unit);
                      const str = display === 0 ? "—" : display.toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
                      return (
                        <td key={y} className="py-2 px-2 text-xs text-amber-200/90 text-right tabular-nums">
                          {str}
                          {unitLabel && str !== "—" ? ` ${unitLabel}` : ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        sectionId="revenue_v1_drivers"
        title="Revenue hierarchy & forecast roles"
        description="Add streams and breakdowns. Choose how each stream is built: forecast the stream directly or build it from its breakdowns."
        colorClass="green"
        defaultExpanded={true}
      >
        <div className="space-y-4">
          <div
            className={`rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-3 transition-shadow ${
              flashRowId === "rev" ? "ring-2 ring-amber-500/40" : ""
            }`}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-700/60 pb-2">
              <span className="text-sm font-semibold text-slate-100">Total Revenue</span>
              <span className="rounded bg-slate-700/80 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200/90">
                {revIsDerived ? "Built from child lines" : streams.length > 0 ? "Direct + allocation children" : "Direct"}
              </span>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                {revAllowGrowthFromHistorical ? "Historical actual available" : "Forecast-only (rev)"}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 leading-relaxed space-y-2">
              <p className="font-medium text-slate-300">How do you want to forecast Total Revenue?</p>
              <ul className="list-none space-y-1.5 pl-0">
                <li>
                  <span className="text-slate-200">• Forecast it as one line</span>
                  <span className="text-slate-500"> → Use a growth rate or manual inputs</span>
                </li>
                <li>
                  <span className="text-slate-200">• Break it into components</span>
                  <span className="text-slate-500"> → Example: Product A, Product B, Subscription</span>
                </li>
              </ul>
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="revModeV1"
                  checked={!revIsDerived}
                  onChange={() => {
                    if (revIsDerived) switchRevToDirectForecast();
                  }}
                  className="accent-emerald-600"
                />
                Forecast this row directly
              </label>
              <p className="text-[10px] text-slate-500 w-full basis-full pl-6 max-w-xl leading-snug">
                {!revIsDerived ? DIRECT_FORECAST_EXPLAINER : DERIVED_PARENT_EXPLAINER}
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="revModeV1"
                  checked={revIsDerived}
                  onChange={() => {
                    if (!revIsDerived) switchRevToBuildFromLines();
                  }}
                  className="accent-emerald-600"
                />
                Build this row from child lines
              </label>
            </div>
            {!revIsDerived && (
              <div className="border-t border-slate-700/60 pt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => setRevDirectCardOpen((o) => !o)}
                  className="flex w-full items-center gap-2 text-left text-[11px] text-slate-400 hover:text-slate-200"
                >
                  <span>{revDirectCardOpen ? "▼" : "▶"}</span>
                  <span className="text-slate-300 font-medium">Direct forecast setup</span>
                  {!revDirectCardOpen ? (
                    <span className="text-[10px] text-slate-500 truncate">
                      {getDirectForecastCompactSummary(
                            revCfg,
                            "rev",
                            revAllowGrowthFromHistorical,
                            lastHistoricByRowId,
                            projectionYears
                          )}
                      {(() => {
                        const st = getDirectForecastRowUiStatus(
                          revCfg,
                          "rev",
                          lastHistoricByRowId,
                          revAllowGrowthFromHistorical,
                          projectionYears
                        );
                        if (st === "ready") return <span className="text-emerald-500/80"> · Ready</span>;
                        if (st === "invalid") return <span className="text-red-400/80"> · Invalid</span>;
                        return <span className="text-amber-400/80"> · Incomplete</span>;
                      })()}
                    </span>
                  ) : null}
                </button>
                {revDirectCardOpen ? (
                  <RevenueForecastV1DirectForecastBlock
                    rowId="rev"
                    cfg={revCfg}
                    setRevenueForecastRowV1={setRevenueForecastRowV1}
                    lastHistoricByRowId={lastHistoricByRowId}
                    projectionYears={projectionYears}
                    currencyCode={meta?.currency ?? "USD"}
                    allowGrowthFromHistorical={revAllowGrowthFromHistorical}
                    focusNonce={revFocusNonce}
                  />
                ) : null}
              </div>
            )}
          </div>

          {!revIsDerived && streams.length === 0 && !revAllocControlsVisible ? (
            <button
              type="button"
              onClick={() => setRevAllocControlsVisible(true)}
              className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-300 px-3 py-2 hover:bg-slate-700"
            >
              Add allocation line (optional — split Total Revenue by %)
            </button>
          ) : null}
          {(!revIsDerived && (revAllocControlsVisible || streams.length > 0)) || revIsDerived ? (
            <RevenueForecastLineNameAdd
              placeholder={revIsDerived ? "Top-level line (e.g. Subscription, Clothing)" : "Allocation line name"}
              buttonLabel={revIsDerived ? "Add top-level line" : "Add allocation line"}
              onAdd={handleAddStreamNamed}
            />
          ) : null}

          <RevenueForecastV1HierarchyEditor
            revIsDerived={revIsDerived}
            forest={streams}
            rows={revenueForecastConfigV1?.rows ?? {}}
            setRevenueForecastRowV1={setRevenueForecastRowV1}
            addRevenueStreamChild={addRevenueStreamChild}
            removeRow={handleRemoveRow}
            expandedStreams={expandedStreams}
            toggleExpanded={toggleStreamExpanded}
            ensureExpandedIds={ensureExpandedIds}
            flashRowId={flashRowId}
            onFlashRow={flashRow}
            pendingDirectFocusRowId={pendingDirectFocusRowId}
            onConsumedDirectFocus={() => setPendingDirectFocusRowId(null)}
            pendingAllocationFocusRowId={pendingAllocationFocusRowId}
            onConsumedAllocationFocus={() => setPendingAllocationFocusRowId(null)}
            lastHistoricByRowId={lastHistoricByRowId}
            projectionYears={projectionYears}
            unit={unit}
            currencyCode={meta?.currency ?? "USD"}
          />
        </div>
      </CollapsibleSection>
    </div>
  );
}
