"use client";

import { useState } from "react";
import BalanceSheetBuilder from "@/components/balance-sheet-builder-unified";

type SubTab = "wc" | "capex" | "intangibles" | "debt";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "wc", label: "Working Capital" },
  { id: "capex", label: "Capex & Depreciation" },
  { id: "intangibles", label: "Intangibles & Amortization" },
  { id: "debt", label: "Debt Schedule" },
];

/**
 * Schedules step: rollforwards that feed projected statements.
 * For now, WC + Capex + Intangibles are still in BalanceSheetBuilder (bs_build);
 * we show BS Build content when WC or Capex or Intangibles is selected so schedules remain usable.
 * Debt is placeholder.
 */
export default function SchedulesShell() {
  const [subTab, setSubTab] = useState<SubTab>("wc");

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
      {subTab === "debt" ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-6 text-center">
          <p className="text-sm text-slate-400">Debt Schedule — coming in Phase 2.</p>
        </div>
      ) : (
        <BalanceSheetBuilder stepId="bs_build" />
      )}
    </div>
  );
}
