"use client";

import { useState, useEffect, useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import SbcBreakdownSection from "@/components/sbc-breakdown-section";
import { getEligibleRowsForSbc } from "@/lib/is-disclosure-eligible";

/**
 * Optional SBC Section - Disclosure layer (does not modify reported IS values).
 * Yes/No is stored in the model (sbcDisclosureEnabled). When OFF: SBC disclosure is not used as CFS fallback and block is hidden in preview.
 */
export default function SbcOptionalSection() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const sbcDisclosureEnabled = useModelStore((s) => s.sbcDisclosureEnabled ?? true);
  const setSbcDisclosureEnabled = useModelStore((s) => s.setSbcDisclosureEnabled);
  const eligibleRows = useMemo(
    () => getEligibleRowsForSbc(incomeStatement ?? []),
    [incomeStatement]
  );
  const hasEligibleRows = eligibleRows.length > 0;
  // Local UI state: null = show question; true/false sync from store (with localStorage fallback for first load)
  const [userWantsSbc, setUserWantsSbc] = useState<boolean | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sbc_user_choice");
      if (saved === "true") return true;
      if (saved === "false") return false;
    }
    return null;
  });

  // Sync store -> local so store is source of truth after load; sync local -> store and localStorage on user click
  useEffect(() => {
    if (userWantsSbc === null) return;
    setSbcDisclosureEnabled(userWantsSbc);
    if (typeof window !== "undefined") localStorage.setItem("sbc_user_choice", String(userWantsSbc));
  }, [userWantsSbc, setSbcDisclosureEnabled]);
  useEffect(() => {
    if (userWantsSbc === null && hasEligibleRows) setUserWantsSbc(sbcDisclosureEnabled);
  }, [sbcDisclosureEnabled, hasEligibleRows, userWantsSbc]);
  
  if (!hasEligibleRows) {
    return (
      <div className="mt-6 rounded-lg border border-amber-700/40 bg-amber-950/20 p-4">
        <div className="text-sm font-semibold text-amber-200 mb-2">
          📝 Stock-Based Compensation (SBC)
        </div>
        <p className="text-xs text-amber-300/80 mb-3">
          SBC disclosure is available for COGS and Operating Expenses rows. Add COGS or Operating Expenses (e.g. SG&A, R&D) in the Income Statement to see eligible rows here.
        </p>
      </div>
    );
  }
  
  const [isExpanded, setIsExpanded] = useState(sbcDisclosureEnabled);

  // Always show the question section, and conditionally show breakdown below
  return (
    <div className="mt-6 rounded-lg border border-amber-700/40 bg-amber-950/20 p-4">
      {/* Question Section - Always Visible with Expand/Collapse */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-1">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-amber-400 hover:text-amber-300"
          >
            {isExpanded ? "▼" : "▶"}
          </button>
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-200 mb-1">
              📝 Stock-Based Compensation (SBC)
            </div>
            <p className="text-xs text-amber-300/80">
              Do you want to input Stock-Based Compensation (SBC) breakdowns?
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <button
            type="button"
            onClick={() => {
              setUserWantsSbc(true);
              setSbcDisclosureEnabled(true);
              setIsExpanded(true);
            }}
            className={`rounded-md px-4 py-2 text-xs font-semibold transition whitespace-nowrap ${
              userWantsSbc === true
                ? "bg-amber-700 text-white hover:bg-amber-600"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600"
            }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => {
              setUserWantsSbc(false);
              setSbcDisclosureEnabled(false);
              setIsExpanded(false);
            }}
            className={`rounded-md px-4 py-2 text-xs font-semibold transition whitespace-nowrap ${
              userWantsSbc === false
                ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600"
            }`}
          >
            No
          </button>
        </div>
      </div>

      {/* Breakdown Section - Only show if user clicked "Yes" and section is expanded */}
      {userWantsSbc === true && isExpanded && (
        <>
          <div className="mb-4 border-t border-amber-700/30 pt-4">
            <p className="text-xs text-amber-300/80 mb-3">
              Stock-Based Compensation (SBC) typically appears as a note in the Income Statement. 
              If your company reports SBC, you can break it down into the expense and cost categories 
              you've already set up in COGS and Operating Expenses.
            </p>
          </div>
          {/* Embed all SBC category cards here */}
          <SbcBreakdownSection />
        </>
      )}
    </div>
  );
}
