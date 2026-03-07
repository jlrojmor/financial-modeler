"use client";

import { useState, useEffect, useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import AmortizationBreakdownSection from "@/components/amortization-breakdown-section";
import { getEligibleRowsForSbc } from "@/lib/is-disclosure-eligible";

/**
 * Optional Amortization of Acquired Intangibles section — disclosure only (does not modify reported IS values).
 * Same eligible IS rows as SBC; uses embedded disclosure type "amortization_intangibles".
 */
export default function AmortizationOptionalSection() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const eligibleRows = useMemo(
    () => getEligibleRowsForSbc(incomeStatement ?? []),
    [incomeStatement]
  );
  const hasEligibleRows = eligibleRows.length > 0;

  const [userWantsAmortization, setUserWantsAmortization] = useState<boolean | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("amortization_intangibles_user_choice");
      if (saved === "true") return true;
      if (saved === "false") return false;
    }
    return null;
  });

  useEffect(() => {
    if (userWantsAmortization !== null && typeof window !== "undefined") {
      localStorage.setItem("amortization_intangibles_user_choice", String(userWantsAmortization));
    }
  }, [userWantsAmortization]);

  if (!hasEligibleRows) {
    return (
      <div className="mt-6 rounded-lg border border-teal-700/40 bg-teal-950/20 p-4">
        <div className="text-sm font-semibold text-teal-200 mb-2">
          Amortization of Acquired Intangibles
        </div>
        <p className="text-xs text-teal-300/80 mb-3">
          Amortization disclosure is available for COGS and Operating Expenses rows. Add COGS or Operating Expenses in the Income Statement to see eligible rows here.
        </p>
      </div>
    );
  }

  const [isExpanded, setIsExpanded] = useState(userWantsAmortization === true);

  return (
    <div className="mt-6 rounded-lg border border-teal-700/40 bg-teal-950/20 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-1">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-teal-400 hover:text-teal-300"
          >
            {isExpanded ? "▼" : "▶"}
          </button>
          <div className="flex-1">
            <div className="text-sm font-semibold text-teal-200 mb-1">
              Amortization of Acquired Intangibles
            </div>
            <p className="text-xs text-teal-300/80">
              Do you want to input amortization of acquired intangibles by expense category?
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <button
            type="button"
            onClick={() => {
              setUserWantsAmortization(true);
              setIsExpanded(true);
            }}
            className={`rounded-md px-4 py-2 text-xs font-semibold transition whitespace-nowrap ${
              userWantsAmortization === true
                ? "bg-teal-700 text-white hover:bg-teal-600"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600"
            }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => {
              setUserWantsAmortization(false);
              setIsExpanded(false);
            }}
            className={`rounded-md px-4 py-2 text-xs font-semibold transition whitespace-nowrap ${
              userWantsAmortization === false
                ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600"
            }`}
          >
            No
          </button>
        </div>
      </div>

      {userWantsAmortization === true && isExpanded && (
        <>
          <div className="mb-4 border-t border-teal-700/30 pt-4">
            <p className="text-xs text-teal-300/80 mb-3">
              Amortization of acquired intangible assets is often embedded in operating expenses or cost of revenue. If disclosed in the 10-K notes, you can break it down across the expense categories below.
            </p>
          </div>
          <AmortizationBreakdownSection />
        </>
      )}
    </div>
  );
}
