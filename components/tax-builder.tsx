"use client";

import { useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
} from "@/lib/currency-utils";
import CollapsibleSection from "@/components/collapsible-section";

/**
 * Guided Tax Builder
 * 
 * Provides a friendly interface for entering Income Tax Expense.
 * After taxes, Net Income and Net Income Margin are calculated automatically.
 */
export default function TaxBuilder() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const meta = useModelStore((s) => s.meta);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const isTaxLocked = useModelStore((s) => s.sectionLocks["tax"] ?? false);

  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    return hist;
  }, [meta]);

  // Find Tax row
  const taxRow = incomeStatement.find((r) => r.id === "tax");

  if (!taxRow) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <p className="text-xs text-slate-400">
          Tax row not found. Please refresh the page.
        </p>
      </div>
    );
  }

  return (
    <CollapsibleSection
      sectionId="tax"
      title="Income Tax Expense"
      description="Enter the total income tax expense for each historical year. This is subtracted from EBT to calculate Net Income."
      borderColor="border-slate-800"
      bgColor="bg-slate-900/50"
      textColor="text-slate-200"
      confirmButtonLabel="Done"
    >

        {/* Input fields for Tax */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          {years.map((y) => {
            const storedValue = taxRow?.values?.[y] ?? 0;
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
                  className="w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  value={displayValue === 0 ? "" : String(displayValue)}
                  disabled={isTaxLocked}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || val === "-") {
                      updateRowValue("incomeStatement", "tax", y, 0);
                      return;
                    }
                    const displayNum = Number(val);
                    if (!isNaN(displayNum)) {
                      // Allow negative values (though typically taxes are positive)
                      const storedNum = displayToStored(displayNum, meta.currencyUnit);
                      updateRowValue("incomeStatement", "tax", y, storedNum);
                    }
                  }}
                  onBlur={(e) => {
                    if (e.target.value === "") {
                      updateRowValue("incomeStatement", "tax", y, 0);
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
            <strong>Note:</strong> Net Income = EBT - Income Tax Expense. Net Income Margin = (Net Income / Revenue) × 100
          </p>
        </div>
      </CollapsibleSection>
  );
}
