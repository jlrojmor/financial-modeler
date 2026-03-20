"use client";

import { useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { ForecastDriversSubTab } from "@/store/useModelStore";
import RevenueForecastV1Tab from "@/components/revenue-forecast-v1-tab";
import ForecastHelperCard from "@/components/forecast-helper-card";
import ForecastGuideModal from "@/components/forecast-guide-modal";

const SUB_TABS: { id: ForecastDriversSubTab; label: string }[] = [
  { id: "revenue", label: "Revenue" },
  { id: "operating_costs", label: "Operating Costs" },
  { id: "wc_drivers", label: "Working Capital Drivers" },
  { id: "financing_taxes", label: "Financing / Taxes" },
];

/**
 * Forecast Drivers step: set forecast methods and assumptions.
 * Revenue subsection reuses existing revenue projection UI; other subsections placeholder for Phase 2.
 */
export default function ForecastDriversShell() {
  const subTab = useModelStore((s) => s.forecastDriversSubTab ?? "revenue");
  const setForecastDriversSubTab = useModelStore((s) => s.setForecastDriversSubTab);
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div className="space-y-4">
      <ForecastHelperCard />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="rounded-md border border-slate-600 bg-slate-800/40 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800"
        >
          Forecast Guide
        </button>
      </div>
      <ForecastGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        activeSubTab={subTab}
      />
      <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-2">
        {SUB_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setForecastDriversSubTab(id)}
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
      {subTab === "revenue" && <RevenueForecastV1Tab />}
      {(subTab === "operating_costs" || subTab === "wc_drivers" || subTab === "financing_taxes") && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-6 text-center">
          <p className="text-sm text-slate-400">
            {subTab === "operating_costs" && "Operating Costs (COGS, SG&A, R&D) — coming in Phase 2."}
            {subTab === "wc_drivers" && "Working Capital Drivers — coming in Phase 2."}
            {subTab === "financing_taxes" && "Financing & Taxes — coming in Phase 2."}
          </p>
        </div>
      )}
    </div>
  );
}
