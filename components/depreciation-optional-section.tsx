"use client";

import { useState, useEffect, useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import DepreciationBreakdownSection from "@/components/depreciation-breakdown-section";
import { getEligibleRowsForSbc } from "@/lib/is-disclosure-eligible";

/**
 * Optional Depreciation Embedded in Expenses section — disclosure only (does not modify reported IS values).
 * Same eligible IS rows as SBC/amortization; uses embedded disclosure type "depreciation_embedded".
 */
export default function DepreciationOptionalSection() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const eligibleRows = useMemo(
    () => getEligibleRowsForSbc(incomeStatement ?? []),
    [incomeStatement]
  );
  const hasEligibleRows = eligibleRows.length > 0;

  const [userWantsDepreciation, setUserWantsDepreciation] = useState<boolean | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("depreciation_embedded_user_choice");
      if (saved === "true") return true;
      if (saved === "false") return false;
    }
    return null;
  });

  useEffect(() => {
    if (userWantsDepreciation !== null && typeof window !== "undefined") {
      localStorage.setItem("depreciation_embedded_user_choice", String(userWantsDepreciation));
    }
  }, [userWantsDepreciation]);

  if (!hasEligibleRows) {
    return (
      <div className="mt-6 rounded-lg border border-violet-700/40 bg-violet-950/20 p-4">
        <div className="text-sm font-semibold text-violet-200 mb-2">
          Depreciation Embedded in Expenses
        </div>
        <p className="text-xs text-violet-300/80 mb-3">
          Depreciation disclosure is available for COGS and Operating Expenses rows. Add COGS or Operating Expenses in the Income Statement to see eligible rows here.
        </p>
      </div>
    );
  }

  const [isExpanded, setIsExpanded] = useState(userWantsDepreciation === true);

  return (
    <div className="mt-6 rounded-lg border border-violet-700/40 bg-violet-950/20 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-1">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-violet-400 hover:text-violet-300"
          >
            {isExpanded ? "▼" : "▶"}
          </button>
          <div className="flex-1">
            <div className="text-sm font-semibold text-violet-200 mb-1">
              Depreciation Embedded in Expenses
            </div>
            <p className="text-xs text-violet-300/80">
              Do you want to input depreciation embedded in expenses by category?
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <button
            type="button"
            onClick={() => {
              setUserWantsDepreciation(true);
              setIsExpanded(true);
            }}
            className={`rounded-md px-4 py-2 text-xs font-semibold transition whitespace-nowrap ${
              userWantsDepreciation === true
                ? "bg-violet-700 text-white hover:bg-violet-600"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600"
            }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => {
              setUserWantsDepreciation(false);
              setIsExpanded(false);
            }}
            className={`rounded-md px-4 py-2 text-xs font-semibold transition whitespace-nowrap ${
              userWantsDepreciation === false
                ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600"
            }`}
          >
            No
          </button>
        </div>
      </div>

      {userWantsDepreciation === true && isExpanded && (
        <>
          <div className="mb-4 border-t border-violet-700/30 pt-4">
            <p className="text-xs text-violet-300/80 mb-3">
              Depreciation is sometimes included in cost of revenue or operating expenses and disclosed in the notes. If disclosed, you can break it down across the expense categories below.
            </p>
          </div>
          <DepreciationBreakdownSection />
        </>
      )}
    </div>
  );
}
