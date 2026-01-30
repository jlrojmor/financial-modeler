"use client";

import { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
} from "@/lib/currency-utils";

/**
 * Stock-Based Compensation (SBC) Annotation Component
 * 
 * This component allows users to document how much SBC is embedded
 * within SG&A components and COGS. This is for transparency/annotation
 * purposes only - it doesn't affect Income Statement calculations.
 * 
 * SBC is typically embedded in:
 * - SG&A components (Sales & Marketing, G&A, etc.)
 * - COGS components (if applicable)
 */
export default function SbcAnnotation() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const meta = useModelStore((s) => s.meta);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns || {});
  const updateSbcValue = useModelStore((s) => s.updateSbcValue);

  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    return hist;
  }, [meta]);

  // Find SG&A and COGS rows to get their breakdowns
  const sgaRow = incomeStatement.find((r) => r.id === "sga");
  const cogsRow = incomeStatement.find((r) => r.id === "cogs");

  const sgaBreakdowns = sgaRow?.children ?? [];
  const cogsBreakdowns = cogsRow?.children ?? [];

  // Get SBC value for a category and year
  const getSbcValue = (categoryId: string, year: string): number => {
    return sbcBreakdowns[categoryId]?.[year] ?? 0;
  };

  // Calculate total SBC for each year
  const totalSbcByYear = useMemo(() => {
    const totals: Record<string, number> = {};
    years.forEach((y) => {
      let sum = 0;
      // Sum all SG&A breakdowns
      sgaBreakdowns.forEach((breakdown) => {
        sum += sbcBreakdowns[breakdown.id]?.[y] ?? 0;
      });
      // Sum all COGS breakdowns
      cogsBreakdowns.forEach((breakdown) => {
        sum += sbcBreakdowns[breakdown.id]?.[y] ?? 0;
      });
      totals[y] = sum;
    });
    return totals;
  }, [sbcBreakdowns, sgaBreakdowns, cogsBreakdowns, years]);

  const hasBreakdowns = sgaBreakdowns.length > 0 || cogsBreakdowns.length > 0;

  return (
    <div className="mt-8 rounded-lg border border-amber-800/40 bg-amber-950/20 p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-amber-200 mb-2">
          Stock-Based Compensation (SBC) Annotation
        </h3>
        <p className="text-xs text-amber-300/80 mb-2">
          Document how much Stock-Based Compensation is embedded within your SG&A and COGS components.
          This is for transparency purposes only and does not affect Income Statement calculations.
        </p>
        {!hasBreakdowns && (
          <p className="text-xs text-amber-400/60 italic">
            Note: Break down your SG&A or COGS to see SBC allocation options.
          </p>
        )}
      </div>

      {hasBreakdowns && (
        <div className="space-y-4">
          {/* SG&A SBC Breakdown */}
          {sgaBreakdowns.length > 0 && (
            <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 p-3">
              <h4 className="text-xs font-semibold text-amber-200 mb-3">
                SBC within SG&A Components
              </h4>
              <div className="space-y-3">
                {sgaBreakdowns.map((breakdown) => (
                  <div key={breakdown.id} className="space-y-2">
                    <div className="text-xs font-medium text-amber-300/90">
                      {breakdown.label}
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                      {years.map((y) => {
                        const storedValue = getSbcValue(breakdown.id, y);
                        const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
                        const unitLabel = getUnitLabel(meta.currencyUnit);
                        return (
                          <label key={y} className="block">
                            <div className="mb-1 text-[10px] text-amber-400/70">
                              {y} {unitLabel && `(${unitLabel})`}
                            </div>
                            <input
                              type="number"
                              step="any"
                              className="w-full rounded-md border border-amber-800/50 bg-amber-950/30 px-2 py-1 text-xs text-amber-100 focus:border-amber-500 focus:outline-none"
                              value={displayValue === 0 ? "" : String(displayValue)}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "" || val === "-") {
                                  updateSbcValue(breakdown.id, y, 0);
                                  return;
                                }
                                const displayNum = Number(val);
                                if (!isNaN(displayNum) && displayNum >= 0) {
                                  const storedNum = displayToStored(displayNum, meta.currencyUnit);
                                  updateSbcValue(breakdown.id, y, storedNum);
                                }
                              }}
                              onBlur={(e) => {
                                if (e.target.value === "") {
                                  updateSbcValue(breakdown.id, y, 0);
                                }
                              }}
                              placeholder="0"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* COGS SBC Breakdown */}
          {cogsBreakdowns.length > 0 && (
            <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 p-3">
              <h4 className="text-xs font-semibold text-amber-200 mb-3">
                SBC within COGS Components
              </h4>
              <div className="space-y-3">
                {cogsBreakdowns.map((breakdown) => (
                  <div key={breakdown.id} className="space-y-2">
                    <div className="text-xs font-medium text-amber-300/90">
                      {breakdown.label}
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                      {years.map((y) => {
                        const storedValue = getSbcValue(breakdown.id, y);
                        const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
                        const unitLabel = getUnitLabel(meta.currencyUnit);
                        return (
                          <label key={y} className="block">
                            <div className="mb-1 text-[10px] text-amber-400/70">
                              {y} {unitLabel && `(${unitLabel})`}
                            </div>
                            <input
                              type="number"
                              step="any"
                              className="w-full rounded-md border border-amber-800/50 bg-amber-950/30 px-2 py-1 text-xs text-amber-100 focus:border-amber-500 focus:outline-none"
                              value={displayValue === 0 ? "" : String(displayValue)}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "" || val === "-") {
                                  updateSbcValue(breakdown.id, y, 0);
                                  return;
                                }
                                const displayNum = Number(val);
                                if (!isNaN(displayNum) && displayNum >= 0) {
                                  const storedNum = displayToStored(displayNum, meta.currencyUnit);
                                  updateSbcValue(breakdown.id, y, storedNum);
                                }
                              }}
                              onBlur={(e) => {
                                if (e.target.value === "") {
                                  updateSbcValue(breakdown.id, y, 0);
                                }
                              }}
                              placeholder="0"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Total SBC Summary */}
          <div className="rounded-lg border border-amber-700/50 bg-amber-900/20 p-3">
            <h4 className="text-xs font-semibold text-amber-200 mb-3">
              Total SBC (Sum of All Components)
            </h4>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {years.map((y) => {
                const total = totalSbcByYear[y] ?? 0;
                const displayValue = storedToDisplay(total, meta.currencyUnit);
                const unitLabel = getUnitLabel(meta.currencyUnit);
                return (
                  <div key={y} className="block">
                    <div className="mb-1 text-[10px] text-amber-400/70">
                      {y} {unitLabel && `(${unitLabel})`}
                    </div>
                    <div className="rounded-md border border-amber-700/50 bg-amber-950/40 px-2 py-1 text-xs font-medium text-amber-100">
                      {displayValue === 0 ? "0" : displayValue.toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}{unitLabel ? ` ${unitLabel}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
