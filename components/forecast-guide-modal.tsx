"use client";

import { useEffect, useState } from "react";
import type { ForecastDriversSubTab } from "@/store/useModelStore";
import {
  FORECAST_GUIDE_CONTENT,
  getDefaultSectionIdForTab,
  type GuideBlock,
} from "@/lib/forecast-guide";

const SUB_TAB_LABELS: Record<ForecastDriversSubTab, string> = {
  revenue: "Revenue",
  operating_costs: "COGS & Operating Expenses",
  non_operating_schedules: "Non-operating & Schedules",
  wc_drivers: "Working Capital Drivers",
  other_bs_items: "Other BS Items",
  financing_taxes: "Financing / Taxes",
};

function GuideBlockView({ block }: { block: GuideBlock }) {
  switch (block.type) {
    case "heading":
      return (
        <h3 className="mt-6 text-base font-semibold text-slate-100 first:mt-0">
          {block.text}
        </h3>
      );
    case "subheading":
      return (
        <h4 className="mb-2 mt-5 text-sm font-semibold text-slate-200">
          {block.text}
        </h4>
      );
    case "paragraph":
      return (
        <p className="mb-3 text-sm leading-relaxed text-slate-300">{block.text}</p>
      );
    case "list":
      return (
        <ul className="mb-4 list-disc space-y-2 pl-5 text-sm text-slate-300">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "callout": {
      const box =
        block.tone === "warning"
          ? "border-amber-800/50 bg-amber-950/25"
          : block.tone === "tip"
            ? "border-sky-800/40 bg-sky-950/20"
            : "border-slate-700 bg-slate-900/60";
      return (
        <div className={`mb-4 rounded-lg border px-3 py-2.5 ${box}`}>
          {block.title ? (
            <p className="mb-1 text-xs font-semibold text-slate-200">{block.title}</p>
          ) : null}
          <p className="text-sm leading-relaxed text-slate-300">{block.text}</p>
        </div>
      );
    }
    default:
      return null;
  }
}

export default function ForecastGuideModal({
  open,
  onClose,
  activeSubTab,
}: {
  open: boolean;
  onClose: () => void;
  activeSubTab: ForecastDriversSubTab;
}) {
  const bundle = FORECAST_GUIDE_CONTENT[activeSubTab];
  const [sectionId, setSectionId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSectionId(getDefaultSectionIdForTab(activeSubTab));
  }, [open, activeSubTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="forecast-guide-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Close guide"
      />
      <div
        className="relative flex max-h-[min(90vh,880px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <h2 id="forecast-guide-title" className="text-lg font-semibold text-slate-100">
              Forecast Guide
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {SUB_TAB_LABELS[activeSubTab]} — how this subsection works
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2.5 py-1 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {bundle.kind === "sections" ? (
            <>
              <nav
                className="flex max-h-[40vh] w-full shrink-0 flex-col overflow-y-auto border-b border-slate-800 sm:max-h-none sm:w-[228px] sm:border-b-0 sm:border-r"
                aria-label="Guide sections"
              >
                <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  In this guide
                </p>
                {bundle.sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSectionId(s.id)}
                    className={`border-l-2 px-3 py-2 text-left text-xs transition-colors ${
                      sectionId === s.id
                        ? "border-sky-500/70 bg-slate-800 font-medium text-slate-100"
                        : "border-transparent text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                    }`}
                  >
                    {s.navLabel}
                  </button>
                ))}
              </nav>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {(() => {
                  const resolvedId =
                    sectionId ??
                    bundle.sections[0]?.id ??
                    null;
                  const sec =
                    bundle.sections.find((s) => s.id === resolvedId) ??
                    bundle.sections[0];
                  if (!sec) return null;
                  return (
                    <>
                      <h3 className="mb-4 text-xl font-semibold text-slate-100">
                        {sec.title}
                      </h3>
                      {sec.blocks.map((b, i) => (
                        <GuideBlockView key={i} block={b} />
                      ))}
                    </>
                  );
                })()}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Coming soon
              </p>
              <h3 className="mt-3 text-lg font-semibold text-slate-200">
                {bundle.headline}
              </h3>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
                {bundle.body}
              </p>
              <p className="mt-6 text-xs text-slate-500">
                Full documentation for this tab will appear here in a future update.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
