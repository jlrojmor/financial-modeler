"use client";

import { useState } from "react";
import IncomeStatementBuilder from "@/components/income-statement-builder";
import BalanceSheetBuilder from "@/components/balance-sheet-builder-unified";
import CashFlowBuilder from "@/components/cash-flow-builder";

type SubTab = "income" | "balance" | "cash_flow";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "income", label: "Income Statement" },
  { id: "balance", label: "Balance Sheet" },
  { id: "cash_flow", label: "Cash Flow" },
];

/**
 * Statement Structure step: define forecastable rows, confirm structure, assign metadata.
 * Internal sub-nav: Income Statement | Balance Sheet | Cash Flow.
 * Reuses existing builders; no forecast values here.
 */
export default function StatementStructureShell() {
  const [subTab, setSubTab] = useState<SubTab>("income");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-2">
        {SUB_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              subTab === id
                ? "bg-slate-600 text-slate-100"
                : "bg-slate-800/60 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {subTab === "income" && <IncomeStatementBuilder />}
      {subTab === "balance" && <BalanceSheetBuilder stepId="statement_structure" />}
      {subTab === "cash_flow" && <CashFlowBuilder />}
    </div>
  );
}
