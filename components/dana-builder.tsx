"use client";

import { useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
} from "@/lib/currency-utils";

/**
 * Guided D&A (Depreciation & Amortization) Builder
 * 
 * Provides a friendly interface for entering D&A expense.
 * D&A is typically a single input, but can potentially be broken down
 * into Depreciation and Amortization separately if needed.
 */
export default function DanaBuilder() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const meta = useModelStore((s) => s.meta);
  const updateRowValue = useModelStore((s) => s.updateRowValue);

  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    return hist;
  }, [meta]);

  // Find D&A row
  const danaRow = incomeStatement.find((r) => r.id === "danda");

  if (!danaRow) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <p className="text-xs text-slate-400">
          D&A row not found. Please refresh the page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">
          Depreciation & Amortization (D&A)
        </h3>
        <p className="mb-4 text-xs text-slate-400">
          Enter the total Depreciation & Amortization expense for each historical year.
          This represents the non-cash expense for the depreciation of fixed assets and
          amortization of intangible assets.
        </p>

        {/* Input fields for D&A */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          {years.map((y) => {
            const storedValue = danaRow?.values?.[y] ?? 0;
            const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
            const unitLabel = getUnitLabel(meta.currencyUnit);
            return (
              <label key={y} className="block">
                <div className="mb-1 text-[10px] text-slate-400">
                  {y} {unitLabel && `(${unitLabel})`}
                </div>
                <input
                  type="number"
                  step="any"
                  className="w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                  value={displayValue === 0 ? "" : String(displayValue)}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || val === "-") {
                      updateRowValue("incomeStatement", "danda", y, 0);
                      return;
                    }
                    const displayNum = Number(val);
                    if (!isNaN(displayNum)) {
                      // Allow negative values (though typically D&A is positive)
                      const storedNum = displayToStored(displayNum, meta.currencyUnit);
                      updateRowValue("incomeStatement", "danda", y, storedNum);
                    }
                  }}
                  onBlur={(e) => {
                    if (e.target.value === "") {
                      updateRowValue("incomeStatement", "danda", y, 0);
                    }
                  }}
                  placeholder="0"
                />
              </label>
            );
          })}
        </div>

        <div className="mt-4 text-xs text-slate-500">
          <p>
            <strong>Note:</strong> D&A is subtracted from EBITDA to calculate EBIT (Operating Income).
          </p>
        </div>
      </div>
    </div>
  );
}
