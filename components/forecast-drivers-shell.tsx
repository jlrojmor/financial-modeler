"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { ForecastDriversSubTab } from "@/store/useModelStore";
import RevenueForecastV1Tab from "@/components/revenue-forecast-v1-tab";
import CogsOpexForecastV1Tab from "@/components/cogs-opex-forecast-v1-tab";
import NonOperatingSchedulesPhase2Panel from "@/components/non-operating-schedules-phase2-panel";
import WcDriversPanel from "@/components/wc-drivers-panel";
import OtherBsItemsPanel from "@/components/other-bs-items-panel";
import CfsDisclosureFdPanel from "@/components/cfs-disclosure-fd-panel";
import ForecastHelperCard from "@/components/forecast-helper-card";
import ForecastGuideModal from "@/components/forecast-guide-modal";

const SUB_TABS: { id: ForecastDriversSubTab; label: string }[] = [
  { id: "revenue", label: "Revenue" },
  { id: "operating_costs", label: "COGS & Operating Expenses" },
  { id: "non_operating_schedules", label: "Non-operating & Schedules" },
  { id: "wc_drivers", label: "Working Capital Drivers" },
  { id: "other_bs_items", label: "Other BS Items" },
  { id: "cfs_disclosure", label: "Cash flow disclosure" },
  { id: "financing_taxes", label: "Financing / Taxes" },
];

/**
 * Forecast Drivers step: set forecast methods and assumptions.
 * Revenue subsection reuses existing revenue projection UI; other subsections placeholder for Phase 2.
 */
export default function ForecastDriversShell({
  rightControls,
}: {
  rightControls?: ReactNode;
}) {
  const subTab = useModelStore((s) => s.forecastDriversSubTab ?? "revenue");
  const setForecastDriversSubTab = useModelStore((s) => s.setForecastDriversSubTab);
  const [guideOpen, setGuideOpen] = useState(false);
  const [helperOpen, setHelperOpen] = useState(false);
  const helperSectionRef = useRef<HTMLDivElement | null>(null);
  const stickyBarRef = useRef<HTMLDivElement | null>(null);

  const getScrollParent = useCallback((el: HTMLElement | null): HTMLElement | null => {
    let node = el?.parentElement ?? null;
    while (node) {
      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return node;
      node = node.parentElement;
    }
    return null;
  }, []);

  const scrollToHelper = useCallback(() => {
    const target = helperSectionRef.current;
    if (!target) return;
    const scrollParent = getScrollParent(target);
    const stickyHeight = stickyBarRef.current?.getBoundingClientRect().height ?? 0;
    const offset = Math.max(12, Math.ceil(stickyHeight) + 10);

    if (scrollParent) {
      const parentRect = scrollParent.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const top = scrollParent.scrollTop + (targetRect.top - parentRect.top) - offset;
      scrollParent.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      return;
    }

    const top = window.scrollY + target.getBoundingClientRect().top - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [getScrollParent]);

  const handleHelperNav = useCallback(() => {
    if (!helperOpen) {
      setHelperOpen(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToHelper());
      });
      return;
    }
    scrollToHelper();
  }, [helperOpen, scrollToHelper]);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 pt-1">
        <div
          ref={stickyBarRef}
          className="rounded-md border border-slate-600/60 border-b-slate-600/70 bg-slate-900/97 shadow-[0_6px_18px_rgba(0,0,0,0.25)] backdrop-blur-sm px-4 py-2 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="rounded-md border border-sky-600/40 bg-sky-600/20 px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-600/30"
            >
              Forecast Guide
            </button>
            <button
              type="button"
              onClick={handleHelperNav}
              className="rounded-md border border-sky-600/30 bg-sky-600/15 px-3 py-1.5 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-600/25"
            >
              Forecast Helper
            </button>
          </div>
          <div className="flex items-center gap-2">{rightControls}</div>
        </div>
      </div>
      {helperOpen ? (
        <div ref={helperSectionRef} className="space-y-2 scroll-mt-24">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setHelperOpen(false)}
              className="rounded border border-slate-600 bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
            >
              Collapse helper
            </button>
          </div>
          <ForecastHelperCard />
        </div>
      ) : null}
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
      {subTab === "operating_costs" && <CogsOpexForecastV1Tab />}
      {subTab === "non_operating_schedules" && <NonOperatingSchedulesPhase2Panel />}
      {subTab === "wc_drivers" && <WcDriversPanel />}
      {subTab === "other_bs_items" && <OtherBsItemsPanel />}
      {subTab === "cfs_disclosure" && <CfsDisclosureFdPanel />}
      {subTab === "financing_taxes" && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-6 text-center">
          <p className="text-sm text-slate-400">Financing / Taxes — coming soon.</p>
        </div>
      )}
    </div>
  );
}
