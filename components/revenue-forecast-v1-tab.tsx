"use client";

import { useMemo, useEffect, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import type {
  RevenueForecastRoleV1,
  RevenueForecastMethodV1,
} from "@/types/revenue-forecast-v1";
import {
  validateRevenueForecastV1,
  getAllowedRolesForChild,
} from "@/lib/revenue-forecast-v1-validation";
import { computeRevenueProjectionsV1 } from "@/lib/revenue-projection-engine-v1";
import { buildModelingContext } from "@/lib/modeling-context";
import { getRevenueForecastSuggestionsFromProfile } from "@/lib/modeling-context";
import { storedToDisplay, displayToStored, getUnitLabel } from "@/lib/currency-utils";
import { computeRowValue } from "@/lib/calculations";
import CollapsibleSection from "@/components/collapsible-section";

export default function RevenueForecastV1Tab() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const meta = useModelStore((s) => s.meta);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const revenueForecastConfigV1 = useModelStore((s) => s.revenueForecastConfigV1);
  const setRevenueForecastRowV1 = useModelStore((s) => s.setRevenueForecastRowV1);
  const addRevenueStream = useModelStore((s) => s.addRevenueStream);
  const addRevenueStreamChild = useModelStore((s) => s.addRevenueStreamChild);
  const removeRow = useModelStore((s) => s.removeRow);
  const companyContext = useModelStore((s) => s.companyContext);

  const [newStreamLabel, setNewStreamLabel] = useState("");
  const [newBreakdownByStream, setNewBreakdownByStream] = useState<Record<string, string>>({});
  const [expandedStreams, setExpandedStreams] = useState<Set<string>>(new Set());

  const historicalYears = useMemo(() => meta?.years?.historical ?? [], [meta?.years?.historical]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta?.years?.projection]);
  const lastHistoricYear = useMemo(() => historicalYears[historicalYears.length - 1] ?? "", [historicalYears]);
  const unit = (meta?.currencyUnit ?? "millions") as "units" | "thousands" | "millions";
  const unitLabel = getUnitLabel(unit);

  const revRow = useMemo(() => incomeStatement?.find((r) => r.id === "rev"), [incomeStatement]);
  const streams = useMemo(() => revRow?.children ?? [], [revRow]);

  const flatRowsForTable: { row: Row; depth: number }[] = useMemo(() => {
    if (!revRow) return [];
    const out: { row: Row; depth: number }[] = [{ row: revRow, depth: 0 }];
    streams.forEach((stream) => {
      out.push({ row: stream, depth: 1 });
      (stream.children ?? []).forEach((child) => {
        out.push({ row: child, depth: 2 });
      });
    });
    return out;
  }, [revRow, streams]);

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
    const add = (row: Row) => {
      const v = computeRowValue(row, lastHistoricYear, incomeStatement, incomeStatement, allStatements);
      out[row.id] = typeof v === "number" && !Number.isNaN(v) ? v : NaN;
    };
    add(revRow);
    streams.forEach((s) => {
      add(s);
      (s.children ?? []).forEach(add);
    });
    return out;
  }, [incomeStatement, lastHistoricYear, revRow, streams, allStatements]);

  const validation = useMemo(
    () =>
      validateRevenueForecastV1(incomeStatement ?? [], revenueForecastConfigV1 ?? { rows: {} }, {
        lastHistoricYear,
        lastHistoricByRowId,
      }),
    [incomeStatement, revenueForecastConfigV1, lastHistoricYear, lastHistoricByRowId]
  );

  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns);
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns);
  const { result: projectedV1, valid: projectionValid } = useMemo(() => {
    if (!validation.valid || !incomeStatement?.length || projectionYears.length === 0) {
      return { result: {} as Record<string, Record<string, number>>, valid: false };
    }
    return computeRevenueProjectionsV1(
      incomeStatement,
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
    revenueForecastConfigV1,
    projectionYears,
    lastHistoricYear,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
  ]);

  const profile = useMemo(() => buildModelingContext(companyContext ?? null), [companyContext]);

  useEffect(() => {
    if (!revRow || !revenueForecastConfigV1) return;
    const revCfg = revenueForecastConfigV1.rows?.["rev"];
    if (!revCfg || revCfg.forecastRole !== "derived_sum") {
      setRevenueForecastRowV1("rev", { forecastRole: "derived_sum" });
    }
  }, [revRow, revenueForecastConfigV1, setRevenueForecastRowV1]);

  const toggleStreamExpanded = (streamId: string) => {
    setExpandedStreams((prev) => {
      const next = new Set(prev);
      if (next.has(streamId)) next.delete(streamId);
      else next.add(streamId);
      return next;
    });
  };

  const handleAddStream = () => {
    const trimmed = newStreamLabel.trim();
    if (!trimmed) return;
    const newId = addRevenueStream(trimmed);
    if (newId) {
      setRevenueForecastRowV1(newId, { forecastRole: "independent_driver", forecastMethod: "growth_rate", forecastParameters: { ratePercent: 0 } });
    }
    setNewStreamLabel("");
  };

  const handleAddBreakdown = (parentStreamId: string) => {
    const label = (newBreakdownByStream[parentStreamId] ?? "").trim();
    if (!label) return;
    addRevenueStreamChild(parentStreamId, label);
    setNewBreakdownByStream((prev) => ({ ...prev, [parentStreamId]: "" }));
  };

  const handleRemoveRow = (rowId: string) => {
    if (rowId === "rev") return;
    removeRow("incomeStatement", rowId);
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
        description="From Historicals. Projection years use v1 forecast when valid."
        colorClass="blue"
        defaultExpanded={true}
      >
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
              {flatRowsForTable.map(({ row, depth }) => {
                const projVal = projectionValid ? projectedV1[row.id] : null;
                return (
                  <tr key={row.id} className={`border-b border-slate-800/60 ${depth === 0 ? "bg-slate-900/40" : ""}`}>
                    <td className="py-2 pr-4 text-xs text-slate-200" style={{ paddingLeft: depth * 20 }}>
                      {row.label}
                    </td>
                    {historicalYears.map((y) => {
                      const stored = computeRowValue(row, y, incomeStatement!, incomeStatement!, allStatements);
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
          {/* Total Revenue: derived_sum only */}
          <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
            <div className="text-xs font-medium text-slate-200">Total Revenue</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Role: derived_sum (sum of streams). No method.</div>
          </div>

          {/* Add stream */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newStreamLabel}
              onChange={(e) => setNewStreamLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddStream()}
              placeholder="e.g. Product sales, Service revenue"
              className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-3 py-1.5 w-56 placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={handleAddStream}
              className="rounded border border-slate-600 bg-slate-700 text-xs text-slate-200 px-3 py-1.5 hover:bg-slate-600"
            >
              Add stream
            </button>
          </div>

          {/* Streams with expand/collapse and children */}
          {streams.map((stream) => {
            const streamCfg = revenueForecastConfigV1?.rows?.[stream.id];
            const parentRole = streamCfg?.forecastRole;
            const hasChildren = (stream.children?.length ?? 0) > 0;
            const isExpanded = expandedStreams.has(stream.id);
            const suggestion = getRevenueForecastSuggestionsFromProfile(profile, stream.id, false, true, hasChildren);
            const role = streamCfg?.forecastRole ?? suggestion?.role ?? "independent_driver";
            const method = streamCfg?.forecastMethod ?? suggestion?.method ?? "growth_rate";
            const params = streamCfg?.forecastParameters ?? {};
            const allowedChildRoles = getAllowedRolesForChild(parentRole);
            const childRole = allowedChildRoles[0];

            return (
              <div key={stream.id} className="rounded-lg border border-slate-700 bg-slate-900/40 overflow-hidden">
                {/* Stream row */}
                <div className="p-3 flex flex-wrap items-start gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {hasChildren && (
                      <button
                        type="button"
                        onClick={() => toggleStreamExpanded(stream.id)}
                        className="text-slate-400 hover:text-slate-200 p-0.5"
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                      >
                        {isExpanded ? "▼" : "▶"}
                      </button>
                    )}
                    <span className="text-xs font-medium text-slate-200">{stream.label}</span>
                    {stream.id !== "rev" && (
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(stream.id)}
                        className="text-[11px] text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-0.5">Role</label>
                      <select
                        value={role}
                        onChange={(e) => {
                          const newRole = e.target.value as RevenueForecastRoleV1;
                          setRevenueForecastRowV1(stream.id, {
                            forecastRole: newRole,
                            forecastMethod: newRole === "independent_driver" ? (streamCfg?.forecastMethod ?? "growth_rate") : undefined,
                            forecastParameters: newRole === "independent_driver" ? { ratePercent: params.ratePercent ?? 0 } : undefined,
                            forecastReason: suggestion?.reason,
                          });
                          (stream.children ?? []).forEach((c) => {
                            const childAllowed = getAllowedRolesForChild(newRole)[0];
                            setRevenueForecastRowV1(c.id, {
                              forecastRole: childAllowed,
                              forecastMethod: childAllowed === "independent_driver" ? "growth_rate" : undefined,
                              forecastParameters: childAllowed === "allocation_of_parent" ? { allocationPercent: 0 } : { ratePercent: 0 },
                            });
                          });
                        }}
                        className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                      >
                        <option value="independent_driver">Forecast this stream directly</option>
                        <option value="derived_sum">Build this stream from breakdowns</option>
                      </select>
                      <p className="text-[10px] text-slate-500 mt-1 max-w-xs">
                        {role === "independent_driver"
                          ? "The stream is projected directly; any child breakdowns are only % allocations of the stream."
                          : "Each child breakdown is forecast individually; the parent is the sum of the breakdowns."}
                      </p>
                    </div>
                    {role === "independent_driver" && (
                      <>
                        <div>
                          <label className="text-[11px] text-slate-500 block mb-0.5">Method</label>
                          <select
                            value={method}
                            onChange={(e) => {
                              const newMethod = e.target.value as RevenueForecastMethodV1;
                              setRevenueForecastRowV1(stream.id, {
                                forecastMethod: newMethod,
                                forecastParameters: newMethod === "growth_rate" ? { ratePercent: params.ratePercent ?? 0 } : { value: params.value ?? 0 },
                                forecastReason: suggestion?.reason,
                              });
                            }}
                            className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                          >
                            <option value="growth_rate">Growth rate %</option>
                            <option value="fixed_value">Fixed value</option>
                          </select>
                        </div>
                        {method === "growth_rate" && (
                          <>
                            <div>
                              <label className="text-[11px] text-slate-500 block mb-0.5">Growth %</label>
                              <input
                                type="number"
                                step={0.1}
                                value={params.ratePercent ?? ""}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value);
                                  setRevenueForecastRowV1(stream.id, { forecastParameters: { ...params, ratePercent: isNaN(v) ? 0 : v } });
                                }}
                                className="w-20 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                                placeholder="0"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] text-slate-500 block mb-0.5">Starting amount (optional)</label>
                              <input
                                type="number"
                                step={0.01}
                                value={params.startingAmount != null ? storedToDisplay(Number(params.startingAmount), unit) : ""}
                                onChange={(e) => {
                                  const raw = parseFloat(e.target.value);
                                  const stored = raw !== "" && !Number.isNaN(raw) ? displayToStored(raw, unit) : undefined;
                                  setRevenueForecastRowV1(stream.id, {
                                    forecastParameters: { ...params, startingAmount: stored as number | undefined },
                                  });
                                }}
                                className="w-24 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                                placeholder={lastHistoricYear ? "Use last year" : "Required if no history"}
                              />
                              {unitLabel && <span className="text-[10px] text-slate-500 ml-0.5">{unitLabel}</span>}
                            </div>
                          </>
                        )}
                        {method === "fixed_value" && (
                          <>
                            <div className="flex items-center gap-2">
                              <label className="text-[11px] text-slate-500">Mode:</label>
                              <select
                                value={params.valuesByYear && typeof params.valuesByYear === "object" && Object.keys(params.valuesByYear).length > 0 ? "manual_by_year" : "flat"}
                                onChange={(e) => {
                                  const mode = e.target.value as "flat" | "manual_by_year";
                                  const vByY = (params.valuesByYear ?? {}) as Record<string, number>;
                                  const flatVal = params.value ?? (Object.values(vByY)[0] as number | undefined) ?? 0;
                                  if (mode === "flat") {
                                    setRevenueForecastRowV1(stream.id, {
                                      forecastParameters: { value: flatVal },
                                    });
                                  } else {
                                    setRevenueForecastRowV1(stream.id, {
                                      forecastParameters: {
                                        valuesByYear: projectionYears.reduce<Record<string, number>>((acc, y) => {
                                          acc[y] = vByY[y] ?? flatVal;
                                          return acc;
                                        }, {}),
                                      },
                                    });
                                  }
                                }}
                                className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                              >
                                <option value="flat">Flat value</option>
                                <option value="manual_by_year">Manual by year</option>
                              </select>
                            </div>
                            {(!params.valuesByYear || Object.keys(params.valuesByYear).length === 0) ? (
                              <div>
                                <label className="text-[11px] text-slate-500 block mb-0.5">Value (same each year)</label>
                                <input
                                  type="number"
                                  step={0.01}
                                  value={params.value != null ? storedToDisplay(Number(params.value), unit) : ""}
                                  onChange={(e) => {
                                    const raw = parseFloat(e.target.value);
                                    const stored = raw !== "" && !Number.isNaN(raw) ? displayToStored(raw, unit) : 0;
                                    setRevenueForecastRowV1(stream.id, { forecastParameters: { ...params, value: stored } });
                                  }}
                                  className="w-24 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                                  placeholder="0"
                                />
                                {unitLabel && <span className="text-[10px] text-slate-500 ml-0.5">{unitLabel}</span>}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {projectionYears.map((y) => (
                                  <div key={y}>
                                    <label className="text-[10px] text-slate-500 block">{y}</label>
                                    <input
                                      type="number"
                                      step={0.01}
                                      value={params.valuesByYear?.[y] != null ? storedToDisplay(Number(params.valuesByYear[y]), unit) : ""}
                                      onChange={(e) => {
                                        const raw = parseFloat(e.target.value);
                                        const stored = raw !== "" && !Number.isNaN(raw) ? displayToStored(raw, unit) : 0;
                                        setRevenueForecastRowV1(stream.id, {
                                          forecastParameters: {
                                            ...params,
                                            valuesByYear: { ...(params.valuesByYear ?? {}), [y]: stored },
                                          },
                                        });
                                      }}
                                      className="w-20 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                  <div className="w-full flex flex-wrap items-center gap-2 mt-1 border-t border-slate-700/60 pt-2">
                    <input
                      type="text"
                      value={newBreakdownByStream[stream.id] ?? ""}
                      onChange={(e) => setNewBreakdownByStream((p) => ({ ...p, [stream.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && handleAddBreakdown(stream.id)}
                      placeholder="e.g. US, Enterprise, Product A"
                      className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1 w-40 placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddBreakdown(stream.id)}
                      className="rounded border border-slate-600 bg-slate-700 text-xs text-slate-200 px-2 py-1 hover:bg-slate-600"
                    >
                      Add breakdown
                    </button>
                  </div>
                </div>

                {/* Children (indented) */}
                {hasChildren && isExpanded && (
                  <div className="border-t border-slate-700/60 bg-slate-950/50 pl-6 pr-3 pb-3 space-y-2">
                    {(stream.children ?? []).map((child) => {
                      const childCfg = revenueForecastConfigV1?.rows?.[child.id];
                      const cRole = childCfg?.forecastRole ?? childRole;
                      const cMethod = childCfg?.forecastMethod ?? "growth_rate";
                      const cParams = childCfg?.forecastParameters ?? {};
                      return (
                        <div key={child.id} className="rounded border border-slate-700/60 bg-slate-900/40 p-2 flex flex-wrap items-center gap-3">
                          <span className="text-xs text-slate-300">{child.label}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(child.id)}
                            className="text-[11px] text-red-400 hover:text-red-300"
                          >
                            Remove
                          </button>
                          <div className="flex flex-wrap items-center gap-2">
                            <div>
                              <label className="text-[11px] text-slate-500 block mb-0.5">Role</label>
                              <select
                                value={cRole}
                                onChange={(e) => {
                                  const newRole = e.target.value as RevenueForecastRoleV1;
                                  setRevenueForecastRowV1(child.id, {
                                    forecastRole: newRole,
                                    forecastMethod: newRole === "independent_driver" ? "growth_rate" : undefined,
                                    forecastParameters: newRole === "allocation_of_parent" ? { allocationPercent: cParams.allocationPercent ?? 0 } : { ratePercent: 0 },
                                  });
                                }}
                                className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                              >
                                {allowedChildRoles.map((r) => (
                                  <option key={r} value={r}>
                                    {r === "allocation_of_parent" ? "Allocate from parent" : "Forecast this breakdown directly"}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {cRole === "independent_driver" && (
                              <>
                                <div>
                                  <label className="text-[11px] text-slate-500 block mb-0.5">Method</label>
                                  <select
                                    value={cMethod}
                                    onChange={(e) => {
                                      const newMethod = e.target.value as RevenueForecastMethodV1;
                                      setRevenueForecastRowV1(child.id, {
                                        forecastMethod: newMethod,
                                        forecastParameters: newMethod === "growth_rate" ? { ratePercent: cParams.ratePercent ?? 0 } : { value: cParams.value ?? 0 },
                                      });
                                    }}
                                    className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                                  >
                                    <option value="growth_rate">Growth rate %</option>
                                    <option value="fixed_value">Fixed value</option>
                                  </select>
                                </div>
                                {cMethod === "growth_rate" && (
                                  <>
                                    <div>
                                      <label className="text-[11px] text-slate-500 block mb-0.5">Growth %</label>
                                      <input
                                        type="number"
                                        step={0.1}
                                        value={cParams.ratePercent ?? ""}
                                        onChange={(e) => {
                                          const v = parseFloat(e.target.value);
                                          setRevenueForecastRowV1(child.id, { forecastParameters: { ...cParams, ratePercent: isNaN(v) ? 0 : v } });
                                        }}
                                        className="w-16 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                                        placeholder="0"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[11px] text-slate-500 block mb-0.5">Starting amount (optional)</label>
                                      <input
                                        type="number"
                                        step={0.01}
                                        value={cParams.startingAmount != null ? storedToDisplay(Number(cParams.startingAmount), unit) : ""}
                                        onChange={(e) => {
                                          const raw = parseFloat(e.target.value);
                                          const stored = raw !== "" && !Number.isNaN(raw) ? displayToStored(raw, unit) : undefined;
                                          setRevenueForecastRowV1(child.id, {
                                            forecastParameters: { ...cParams, startingAmount: stored as number | undefined },
                                          });
                                        }}
                                        className="w-20 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                                        placeholder={lastHistoricYear ? "Use last year" : "Required if no history"}
                                      />
                                    </div>
                                  </>
                                )}
                                {cMethod === "fixed_value" && (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <label className="text-[11px] text-slate-500">Mode:</label>
                                      <select
                                        value={cParams.valuesByYear && typeof cParams.valuesByYear === "object" && Object.keys(cParams.valuesByYear).length > 0 ? "manual_by_year" : "flat"}
                                        onChange={(e) => {
                                          const mode = e.target.value as "flat" | "manual_by_year";
                                          const vByY = (cParams.valuesByYear ?? {}) as Record<string, number>;
                                          const flatVal = cParams.value ?? (Object.values(vByY)[0] as number | undefined) ?? 0;
                                          if (mode === "flat") {
                                            setRevenueForecastRowV1(child.id, {
                                              forecastParameters: { value: flatVal },
                                            });
                                          } else {
                                            setRevenueForecastRowV1(child.id, {
                                              forecastParameters: {
                                                valuesByYear: projectionYears.reduce<Record<string, number>>((acc, y) => {
                                                  acc[y] = vByY[y] ?? flatVal;
                                                  return acc;
                                                }, {}),
                                              },
                                            });
                                          }
                                        }}
                                        className="rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                                      >
                                        <option value="flat">Flat value</option>
                                        <option value="manual_by_year">Manual by year</option>
                                      </select>
                                    </div>
                                    {(!cParams.valuesByYear || typeof cParams.valuesByYear !== "object" || Object.keys(cParams.valuesByYear).length === 0) ? (
                                      <div>
                                        <label className="text-[11px] text-slate-500 block mb-0.5">Value (same each year)</label>
                                        <input
                                          type="number"
                                          step={0.01}
                                          value={cParams.value != null ? storedToDisplay(Number(cParams.value), unit) : ""}
                                          onChange={(e) => {
                                            const raw = parseFloat(e.target.value);
                                            const stored = raw !== "" && !Number.isNaN(raw) ? displayToStored(raw, unit) : 0;
                                            setRevenueForecastRowV1(child.id, { forecastParameters: { ...cParams, value: stored } });
                                          }}
                                          className="w-20 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                                          placeholder="0"
                                        />
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap gap-2">
                                        {projectionYears.map((y) => (
                                          <div key={y}>
                                            <label className="text-[10px] text-slate-500 block">{y}</label>
                                            <input
                                              type="number"
                                              step={0.01}
                                              value={(cParams.valuesByYear as Record<string, number>)?.[y] != null ? storedToDisplay(Number((cParams.valuesByYear as Record<string, number>)[y]), unit) : ""}
                                              onChange={(e) => {
                                                const raw = parseFloat(e.target.value);
                                                const stored = raw !== "" && !Number.isNaN(raw) ? displayToStored(raw, unit) : 0;
                                                setRevenueForecastRowV1(child.id, {
                                                  forecastParameters: {
                                                    ...cParams,
                                                    valuesByYear: { ...((cParams.valuesByYear as Record<string, number>) ?? {}), [y]: stored },
                                                  },
                                                });
                                              }}
                                              className="w-16 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                            {cRole === "allocation_of_parent" && (
                              <div>
                                <label className="text-[11px] text-slate-500 block mb-0.5">Allocation %</label>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.5}
                                  value={cParams.allocationPercent ?? ""}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    setRevenueForecastRowV1(child.id, {
                                      forecastParameters: { ...cParams, allocationPercent: isNaN(v) ? 0 : Math.max(0, Math.min(100, v)) },
                                    });
                                  }}
                                  className="w-16 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 px-2 py-1"
                                  placeholder="0"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleSection>
    </div>
  );
}
