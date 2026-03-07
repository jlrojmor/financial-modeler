"use client";

import { useState, useEffect, useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import RestructuringBreakdownSection from "@/components/restructuring-breakdown-section";
import { getEligibleRowsForSbc } from "@/lib/is-disclosure-eligible";

/**
 * Optional Restructuring Charges section — disclosure only (does not modify reported IS values).
 * Same eligible IS rows as other disclosure modules; uses embedded disclosure type "restructuring_charges".
 */
export default function RestructuringOptionalSection() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const eligibleRows = useMemo(
    () => getEligibleRowsForSbc(incomeStatement ?? []),
    [incomeStatement]
  );
  const hasEligibleRows = eligibleRows.length > 0;

  const [userWantsRestructuring, setUserWantsRestructuring] = useState<boolean | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("restructuring_charges_user_choice");
      if (saved === "true") return true;
      if (saved === "false") return false;
    }
    return null;
  });

  useEffect(() => {
    if (userWantsRestructuring !== null && typeof window !== "undefined") {
      localStorage.setItem("restructuring_charges_user_choice", String(userWantsRestructuring));
    }
  }, [userWantsRestructuring]);

  if (!hasEligibleRows) {
    return (
      <div className="mt-6 rounded-lg border border-rose-700/40 bg-rose-950/20 p-4">
        <div className="text-sm font-semibold text-rose-200 mb-2">
          Restructuring Charges
        </div>
        <p className="text-xs text-rose-300/80 mb-3">
          Restructuring disclosure is available for COGS and Operating Expenses rows. Add COGS or Operating Expenses in the Income Statement to see eligible rows here.
        </p>
      </div>
    );
  }

  const [isExpanded, setIsExpanded] = useState(userWantsRestructuring === true);

  return (
    <div className="mt-6 rounded-lg border border-rose-700/40 bg-rose-950/20 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-1">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-rose-400 hover:text-rose-300"
          >
            {isExpanded ? "▼" : "▶"}
          </button>
          <div className="flex-1">
            <div className="text-sm font-semibold text-rose-200 mb-1">
              Restructuring Charges
            </div>
            <p className="text-xs text-rose-300/80">
              Do you want to input restructuring charges by expense category?
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <button
            type="button"
            onClick={() => {
              setUserWantsRestructuring(true);
              setIsExpanded(true);
            }}
            className={`rounded-md px-4 py-2 text-xs font-semibold transition whitespace-nowrap ${
              userWantsRestructuring === true
                ? "bg-rose-700 text-white hover:bg-rose-600"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600"
            }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => {
              setUserWantsRestructuring(false);
              setIsExpanded(false);
            }}
            className={`rounded-md px-4 py-2 text-xs font-semibold transition whitespace-nowrap ${
              userWantsRestructuring === false
                ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                : "bg-slate-700 text-slate-200 hover:bg-slate-600"
            }`}
          >
            No
          </button>
        </div>
      </div>

      {userWantsRestructuring === true && isExpanded && (
        <>
          <div className="mb-4 border-t border-rose-700/30 pt-4">
            <p className="text-xs text-rose-300/80 mb-3">
              Restructuring charges are sometimes disclosed separately in the notes and may be included in operating expense lines. If disclosed, you can break them down across the expense categories below.
            </p>
          </div>
          <RestructuringBreakdownSection />
        </>
      )}
    </div>
  );
}
