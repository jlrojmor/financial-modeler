"use client";

import { useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
} from "@/lib/currency-utils";

/**
 * Guided Interest & Other Income Builder
 * 
 * Provides a friendly interface for entering:
 * - Interest Expense
 * - Interest Income
 * - Other Income / (Expense)
 * 
 * These items are used to calculate EBT (Earnings Before Tax).
 */
export default function InterestOtherBuilder() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const meta = useModelStore((s) => s.meta);
  const updateRowValue = useModelStore((s) => s.updateRowValue);

  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    return hist;
  }, [meta]);

  // Find rows
  const interestExpenseRow = incomeStatement.find((r) => r.id === "interest_expense");
  const interestIncomeRow = incomeStatement.find((r) => r.id === "interest_income");
  const otherIncomeRow = incomeStatement.find((r) => r.id === "other_income");

  if (!interestExpenseRow || !interestIncomeRow || !otherIncomeRow) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <p className="text-xs text-slate-400">
          Interest/Other Income rows not found. Please refresh the page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Interest Expense */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">
          Interest Expense
        </h3>
        <p className="mb-4 text-xs text-slate-400">
          Enter the total interest expense paid on debt for each historical year.
        </p>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          {years.map((y) => {
            const storedValue = interestExpenseRow?.values?.[y] ?? 0;
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
                      updateRowValue("incomeStatement", "interest_expense", y, 0);
                      return;
                    }
                    const displayNum = Number(val);
                    if (!isNaN(displayNum)) {
                      const storedNum = displayToStored(displayNum, meta.currencyUnit);
                      updateRowValue("incomeStatement", "interest_expense", y, storedNum);
                    }
                  }}
                  onBlur={(e) => {
                    if (e.target.value === "") {
                      updateRowValue("incomeStatement", "interest_expense", y, 0);
                    }
                  }}
                  placeholder="0"
                />
              </label>
            );
          })}
        </div>
      </div>

      {/* Interest Income */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">
          Interest Income
        </h3>
        <p className="mb-4 text-xs text-slate-400">
          Enter the total interest income earned on cash and investments for each historical year.
        </p>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          {years.map((y) => {
            const storedValue = interestIncomeRow?.values?.[y] ?? 0;
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
                      updateRowValue("incomeStatement", "interest_income", y, 0);
                      return;
                    }
                    const displayNum = Number(val);
                    if (!isNaN(displayNum)) {
                      const storedNum = displayToStored(displayNum, meta.currencyUnit);
                      updateRowValue("incomeStatement", "interest_income", y, storedNum);
                    }
                  }}
                  onBlur={(e) => {
                    if (e.target.value === "") {
                      updateRowValue("incomeStatement", "interest_income", y, 0);
                    }
                  }}
                  placeholder="0"
                />
              </label>
            );
          })}
        </div>
      </div>

      {/* Other Income / (Expense) */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">
          Other Income / (Expense)
        </h3>
        <p className="mb-4 text-xs text-slate-400">
          Enter other non-operating income (positive) or expenses (negative) for each historical year.
          Examples: foreign exchange gains/losses, asset sales, restructuring charges, etc.
        </p>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          {years.map((y) => {
            const storedValue = otherIncomeRow?.values?.[y] ?? 0;
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
                      updateRowValue("incomeStatement", "other_income", y, 0);
                      return;
                    }
                    const displayNum = Number(val);
                    if (!isNaN(displayNum)) {
                      // Allow negative values (expenses)
                      const storedNum = displayToStored(displayNum, meta.currencyUnit);
                      updateRowValue("incomeStatement", "other_income", y, storedNum);
                    }
                  }}
                  onBlur={(e) => {
                    if (e.target.value === "") {
                      updateRowValue("incomeStatement", "other_income", y, 0);
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
            <strong>Note:</strong> EBT (Earnings Before Tax) = EBIT - Interest Expense + Interest Income + Other Income/(Expense)
          </p>
        </div>
      </div>
    </div>
  );
}
