"use client";

import { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { formatCurrencyDisplay, storedToDisplay, getUnitLabel } from "@/lib/currency-utils";

function flattenRows(rows: Row[], depth = 0): Array<{ row: Row; depth: number }> {
  const out: Array<{ row: Row; depth: number }> = [];
  for (const r of rows) {
    out.push({ row: r, depth });
    if (r.children?.length) out.push(...flattenRows(r.children, depth + 1));
  }
  return out;
}

export default function ExcelPreview() {
  const meta = useModelStore((s) => s.meta);
  const currentStepId = useModelStore((s) => s.currentStepId);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const [showDecimals, setShowDecimals] = useState(false);

  // Determine which statement to show based on current step
  const getCurrentStatement = () => {
    if (currentStepId === "bs_build") return { rows: balanceSheet, label: "Balance Sheet" };
    if (currentStepId === "cfs_build") return { rows: cashFlow, label: "Cash Flow Statement" };
    // Default to Income Statement for historicals, is_build, and others
    return { rows: incomeStatement, label: "Income Statement" };
  };

  const { rows, label } = getCurrentStatement();

  // ✅ HARD SAFETY: never assume meta.years exists
  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    const proj = meta?.years?.projection ?? [];
    return [...hist, ...proj];
  }, [meta]);

  const flat = useMemo(() => flattenRows(rows ?? []), [rows]);

  return (
    <section className="h-full w-full rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Real-time Excel Preview</h2>
          <p className="text-xs text-slate-500">
            <span className="text-slate-300">{meta?.companyName ?? "—"}</span> ·{" "}
            <span className="text-slate-300 capitalize">{meta?.companyType ?? "—"}</span> ·{" "}
            <span className="text-slate-300 uppercase">{meta?.modelType ?? "—"}</span> ·{" "}
            <span className="text-slate-300">{meta?.currency ?? "—"}</span>
            {meta?.currencyUnit && (
              <> · <span className="text-slate-300">({getUnitLabel(meta.currencyUnit) || meta.currencyUnit})</span></>
            )}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showDecimals}
              onChange={(e) => setShowDecimals(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900"
            />
            <span>Show decimals</span>
          </label>
          <div className="text-xs text-slate-500">
            Rows: <span className="text-slate-300">{flat.length}</span> · Years:{" "}
            <span className="text-slate-300">{years.length}</span>
          </div>
        </div>
      </div>

      <div className="h-[calc(100%-56px)] overflow-auto rounded-lg border border-slate-800">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-950">
            <tr className="border-b border-slate-800">
              <th className="w-[280px] px-3 py-2 text-left font-semibold text-slate-300">
                {label}
              </th>
              {years.map((y) => (
                <th key={y} className="px-3 py-2 text-right font-semibold text-slate-400">
                  {y}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {flat.map(({ row, depth }) => {
              const isInput = row.kind === "input";
              const isGrossMargin = row.id === "gross_margin";
              const isEbitdaMargin = row.id === "ebitda_margin";
              const isMargin = isGrossMargin || isEbitdaMargin;
              const isLink = row.excelFormula?.includes("!") || false; // Links reference other sheets
              
              // Row label styling
              const labelClass = isMargin
                ? "text-slate-400 italic text-[11px]" // 1pt smaller, italic, light grey
                : "text-slate-200";
              
              return (
                <tr key={row.id} className="border-b border-slate-900 hover:bg-slate-900/40">
                  <td className={`px-3 py-2 ${labelClass}`}>
                    <span style={{ paddingLeft: depth * 14 }} className="inline-block">
                      {row.label}
                    </span>
                  </td>

                  {years.map((y) => {
                    const storedValue = row.values?.[y] ?? 0;
                    const isCurrency = row.valueType === "currency";
                    const isPercent = row.valueType === "percent";
                    
                    // Format based on value type - only apply currency unit scaling to currency values
                    let display = "";
                    if (typeof storedValue === "number" && storedValue !== 0) {
                      if (isCurrency && meta?.currencyUnit) {
                        const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
                        const unitLabel = getUnitLabel(meta.currencyUnit);
                        const decimals = showDecimals ? 2 : 0;
                        display = `${displayValue.toLocaleString(undefined, {
                          minimumFractionDigits: decimals,
                          maximumFractionDigits: decimals,
                        })}${unitLabel ? ` ${unitLabel}` : ""}`;
                      } else if (isPercent) {
                        // Always show decimals for percentages (value is already a percentage, e.g., 75.5 for 75.5%)
                        display = `${storedValue.toFixed(2)}%`;
                      } else {
                        const decimals = showDecimals ? 2 : 0;
                        display = storedValue.toLocaleString(undefined, {
                          minimumFractionDigits: decimals,
                          maximumFractionDigits: decimals,
                        });
                      }
                    }
                    
                    // IB styling rules:
                    // - Inputs: blue
                    // - Links (from other sheets): green
                    // - Currency outputs: white
                    // - Percent outputs: grey
                    // - Other outputs: white
                    let cellClass = "text-right";
                    if (isInput) {
                      cellClass += " text-blue-400 font-medium";
                    } else if (isLink) {
                      cellClass += " text-green-400";
                    } else if (isPercent) {
                      cellClass += " text-slate-400"; // Grey for percentages
                    } else {
                      cellClass += " text-slate-100"; // White for currency and other outputs
                    }
                    
                    // Margins (Gross Margin, EBITDA Margin): italic and smaller font
                    if (isMargin) {
                      cellClass += " italic text-[11px]";
                    }
                    
                    return (
                      <td key={`${row.id}-${y}`} className={`px-3 py-2 ${cellClass}`}>
                        {display || (isInput ? "" : "—")}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* If no years or rows, show a friendly empty state */}
            {flat.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, 1 + years.length)} className="px-3 py-8 text-center text-slate-500">
                  No rows yet. Start building your {label.toLowerCase()} in the Builder Panel.
                </td>
              </tr>
            )}

            {years.length === 0 && (
              <tr>
                <td colSpan={1} className="px-3 py-8 text-center text-slate-500">
                  No years found. (We’ll fix meta years next.)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[10px] text-slate-600">
        Next: Excel export maps this state into ExcelJS with formulas + IB formatting (blue inputs, black formulas).
      </div>
    </section>
  );
}