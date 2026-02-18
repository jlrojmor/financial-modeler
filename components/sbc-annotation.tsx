"use client";

import { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
} from "@/lib/currency-utils";
import CollapsibleSection from "@/components/collapsible-section";

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

  // Find SG&A, COGS, and R&D rows to get their breakdowns
  const sgaRow = incomeStatement.find((r) => r.id === "sga");
  const cogsRow = incomeStatement.find((r) => r.id === "cogs");
  const rdRow = incomeStatement.find((r) => r.id === "rd");

  const sgaBreakdowns = sgaRow?.children ?? [];
  const cogsBreakdowns = cogsRow?.children ?? [];
  const rdBreakdowns = rdRow?.children ?? [];

  const hasSgaBreakdowns = sgaBreakdowns.length > 0;
  const hasCogsBreakdowns = cogsBreakdowns.length > 0;
  const hasRdBreakdowns = rdBreakdowns.length > 0;

  // Get SBC value for a category and year
  const getSbcValue = (categoryId: string, year: string): number => {
    return sbcBreakdowns[categoryId]?.[year] ?? 0;
  };

  // Calculate SG&A total SBC (from breakdowns if broken down, or direct value if not)
  const sgaTotalSbcByYear = useMemo(() => {
    const totals: Record<string, number> = {};
    years.forEach((y) => {
      if (hasSgaBreakdowns) {
        // Calculate from breakdowns
        let sum = 0;
        sgaBreakdowns.forEach((breakdown) => {
          sum += sbcBreakdowns[breakdown.id]?.[y] ?? 0;
        });
        totals[y] = sum;
      } else {
        // Use direct value for "sga" row
        totals[y] = sbcBreakdowns["sga"]?.[y] ?? 0;
      }
    });
    return totals;
  }, [sbcBreakdowns, sgaBreakdowns, hasSgaBreakdowns, years]);

  // Calculate COGS total SBC (from breakdowns if broken down, or direct value if not)
  const cogsTotalSbcByYear = useMemo(() => {
    const totals: Record<string, number> = {};
    years.forEach((y) => {
      if (hasCogsBreakdowns) {
        // Calculate from breakdowns
        let sum = 0;
        cogsBreakdowns.forEach((breakdown) => {
          sum += sbcBreakdowns[breakdown.id]?.[y] ?? 0;
        });
        totals[y] = sum;
      } else {
        // Use direct value for "cogs" row
        totals[y] = sbcBreakdowns["cogs"]?.[y] ?? 0;
      }
    });
    return totals;
  }, [sbcBreakdowns, cogsBreakdowns, hasCogsBreakdowns, years]);

  // Calculate R&D total SBC (from breakdowns if broken down, or direct value if not)
  const rdTotalSbcByYear = useMemo(() => {
    const totals: Record<string, number> = {};
    years.forEach((y) => {
      if (hasRdBreakdowns) {
        let sum = 0;
        rdBreakdowns.forEach((breakdown) => {
          sum += sbcBreakdowns[breakdown.id]?.[y] ?? 0;
        });
        totals[y] = sum;
      } else {
        totals[y] = sbcBreakdowns["rd"]?.[y] ?? 0;
      }
    });
    return totals;
  }, [sbcBreakdowns, rdBreakdowns, hasRdBreakdowns, years]);

  // Calculate total SBC for each year (SG&A + COGS + R&D)
  const totalSbcByYear = useMemo(() => {
    const totals: Record<string, number> = {};
    years.forEach((y) => {
      totals[y] = (sgaTotalSbcByYear[y] ?? 0) + (cogsTotalSbcByYear[y] ?? 0) + (rdTotalSbcByYear[y] ?? 0);
    });
    return totals;
  }, [sgaTotalSbcByYear, cogsTotalSbcByYear, rdTotalSbcByYear, years]);

  const isSbcLocked = useModelStore((s) => s.sectionLocks["sbc"] ?? false);

  return (
    <div className="mt-8">
      <CollapsibleSection
        sectionId="sbc"
        title="Stock-Based Compensation (SBC) Annotation"
        description="Document how much Stock-Based Compensation is embedded within your SG&A, COGS, and R&D components. This is for transparency purposes only and does not affect Income Statement calculations."
        colorClass="amber"
        defaultExpanded={true}
      >
        <div className="space-y-4">
        {/* SG&A SBC Section */}
        <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 p-3">
          <h4 className="text-xs font-semibold text-amber-200 mb-3">
            SBC within SG&A
          </h4>
          
          {hasSgaBreakdowns ? (
            // Show breakdown inputs and calculated total
            <div className="space-y-3">
              <div className="mb-3 rounded-md border border-amber-700/30 bg-amber-950/20 p-2">
                <div className="mb-2 text-xs font-medium text-amber-300/80">
                  Total SG&A SBC (calculated from breakdowns)
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                  {years.map((y) => {
                    const total = sgaTotalSbcByYear[y] ?? 0;
                    const displayValue = storedToDisplay(total, meta.currencyUnit);
                    const unitLabel = getUnitLabel(meta.currencyUnit);
                    return (
                      <div key={y} className="block">
                        <div className="mb-1 text-[10px] text-amber-400/70">
                          {y} {unitLabel && `(${unitLabel})`}
                        </div>
                        <div className="rounded-md border border-amber-700/50 bg-amber-950/40 px-2 py-1 text-xs font-medium text-amber-100">
                          {displayValue === 0 ? "—" : displayValue.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                          })}{unitLabel ? ` ${unitLabel}` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="text-xs font-medium text-amber-300/70 mb-2">
                SG&A Components:
              </div>
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
                            className="w-full rounded-md border border-amber-800/50 bg-amber-950/30 px-2 py-1 text-xs text-amber-100 focus:border-amber-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                            value={displayValue === 0 ? "" : String(displayValue)}
                            disabled={isSbcLocked}
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
          ) : (
            // Show direct input for total SG&A SBC
            <div className="space-y-2">
              <div className="text-xs font-medium text-amber-300/90 mb-2">
                Total SG&A SBC
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                {years.map((y) => {
                  const storedValue = getSbcValue("sga", y);
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
                        className="w-full rounded-md border border-amber-800/50 bg-amber-950/30 px-2 py-1 text-xs text-amber-100 focus:border-amber-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                        value={displayValue === 0 ? "" : String(displayValue)}
                        disabled={isSbcLocked}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "" || val === "-") {
                            updateSbcValue("sga", y, 0);
                            return;
                          }
                          const displayNum = Number(val);
                          if (!isNaN(displayNum) && displayNum >= 0) {
                            const storedNum = displayToStored(displayNum, meta.currencyUnit);
                            updateSbcValue("sga", y, storedNum);
                          }
                        }}
                        onBlur={(e) => {
                          if (e.target.value === "") {
                            updateSbcValue("sga", y, 0);
                          }
                        }}
                        placeholder="0"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* COGS SBC Section */}
        <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 p-3">
          <h4 className="text-xs font-semibold text-amber-200 mb-3">
            SBC within COGS
          </h4>
          
          {hasCogsBreakdowns ? (
            // Show breakdown inputs and calculated total
            <div className="space-y-3">
              <div className="mb-3 rounded-md border border-amber-700/30 bg-amber-950/20 p-2">
                <div className="mb-2 text-xs font-medium text-amber-300/80">
                  Total COGS SBC (calculated from breakdowns)
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                  {years.map((y) => {
                    const total = cogsTotalSbcByYear[y] ?? 0;
                    const displayValue = storedToDisplay(total, meta.currencyUnit);
                    const unitLabel = getUnitLabel(meta.currencyUnit);
                    return (
                      <div key={y} className="block">
                        <div className="mb-1 text-[10px] text-amber-400/70">
                          {y} {unitLabel && `(${unitLabel})`}
                        </div>
                        <div className="rounded-md border border-amber-700/50 bg-amber-950/40 px-2 py-1 text-xs font-medium text-amber-100">
                          {displayValue === 0 ? "—" : displayValue.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                          })}{unitLabel ? ` ${unitLabel}` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="text-xs font-medium text-amber-300/70 mb-2">
                COGS Components:
              </div>
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
                            className="w-full rounded-md border border-amber-800/50 bg-amber-950/30 px-2 py-1 text-xs text-amber-100 focus:border-amber-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                            value={displayValue === 0 ? "" : String(displayValue)}
                            disabled={isSbcLocked}
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
          ) : (
            // Show direct input for total COGS SBC
            <div className="space-y-2">
              <div className="text-xs font-medium text-amber-300/90 mb-2">
                Total COGS SBC
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                {years.map((y) => {
                  const storedValue = getSbcValue("cogs", y);
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
                        className="w-full rounded-md border border-amber-800/50 bg-amber-950/30 px-2 py-1 text-xs text-amber-100 focus:border-amber-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                        value={displayValue === 0 ? "" : String(displayValue)}
                        disabled={isSbcLocked}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "" || val === "-") {
                            updateSbcValue("cogs", y, 0);
                            return;
                          }
                          const displayNum = Number(val);
                          if (!isNaN(displayNum) && displayNum >= 0) {
                            const storedNum = displayToStored(displayNum, meta.currencyUnit);
                            updateSbcValue("cogs", y, storedNum);
                          }
                        }}
                        onBlur={(e) => {
                          if (e.target.value === "") {
                            updateSbcValue("cogs", y, 0);
                          }
                        }}
                        placeholder="0"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* R&D SBC Section */}
        <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 p-3">
          <h4 className="text-xs font-semibold text-amber-200 mb-3">
            SBC within R&D
          </h4>
          
          {hasRdBreakdowns ? (
            <div className="space-y-3">
              <div className="mb-3 rounded-md border border-amber-700/30 bg-amber-950/20 p-2">
                <div className="mb-2 text-xs font-medium text-amber-300/80">
                  Total R&D SBC (calculated from breakdowns)
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                  {years.map((y) => {
                    const total = rdTotalSbcByYear[y] ?? 0;
                    const displayValue = storedToDisplay(total, meta.currencyUnit);
                    const unitLabel = getUnitLabel(meta.currencyUnit);
                    return (
                      <div key={y} className="block">
                        <div className="mb-1 text-[10px] text-amber-400/70">
                          {y} {unitLabel && `(${unitLabel})`}
                        </div>
                        <div className="rounded-md border border-amber-700/50 bg-amber-950/40 px-2 py-1 text-xs font-medium text-amber-100">
                          {displayValue === 0 ? "—" : displayValue.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                          })}{unitLabel ? ` ${unitLabel}` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="text-xs font-medium text-amber-300/70 mb-2">
                R&D Components:
              </div>
              {rdBreakdowns.map((breakdown) => (
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
                            className="w-full rounded-md border border-amber-800/50 bg-amber-950/30 px-2 py-1 text-xs text-amber-100 focus:border-amber-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                            value={displayValue === 0 ? "" : String(displayValue)}
                            disabled={isSbcLocked}
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
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-medium text-amber-300/90 mb-2">
                Total R&D SBC
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                {years.map((y) => {
                  const storedValue = getSbcValue("rd", y);
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
                        className="w-full rounded-md border border-amber-800/50 bg-amber-950/30 px-2 py-1 text-xs text-amber-100 focus:border-amber-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                        value={displayValue === 0 ? "" : String(displayValue)}
                        disabled={isSbcLocked}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "" || val === "-") {
                            updateSbcValue("rd", y, 0);
                            return;
                          }
                          const displayNum = Number(val);
                          if (!isNaN(displayNum) && displayNum >= 0) {
                            const storedNum = displayToStored(displayNum, meta.currencyUnit);
                            updateSbcValue("rd", y, storedNum);
                          }
                        }}
                        onBlur={(e) => {
                          if (e.target.value === "") {
                            updateSbcValue("rd", y, 0);
                          }
                        }}
                        placeholder="0"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

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
                    {displayValue === 0 ? "—" : displayValue.toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}{unitLabel ? ` ${unitLabel}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Professional Disclosure Note */}
        <div className="mt-4 rounded-lg border border-amber-700/30 bg-amber-950/10 p-3">
          <div className="text-[10px] text-amber-300/70 leading-relaxed">
            <p className="mb-2 font-semibold text-amber-200/80">Note on Stock-Based Compensation:</p>
            <p className="mb-1">
              Stock-based compensation expense is included within the respective line items of the Income Statement 
              (primarily within Selling, General & Administrative expenses, Research and development, and, if applicable, Cost of Goods Sold). 
              The amounts disclosed above represent the allocation of total stock-based compensation across these categories 
              for transparency purposes only and do not affect the Income Statement calculations.
            </p>
            <p className="mb-1">
              Total stock-based compensation includes expenses related to stock options, restricted stock units (RSUs), 
              performance stock units (PSUs), and other equity-based awards granted to employees, directors, and consultants. 
              These amounts are recognized in accordance with applicable accounting standards and are based on the fair value 
              of the equity instruments at the grant date, amortized over the requisite service period.
            </p>
            <p>
              This disclosure is provided for informational purposes to enable users of the financial model to understand 
              the impact of stock-based compensation on operating expenses, consistent with disclosures typically found in 
              SEC filings and investor presentations.
            </p>
          </div>
        </div>
      </div>
      </CollapsibleSection>
    </div>
  );
}
