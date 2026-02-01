"use client";

import { useState, useMemo, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import SbcBreakdownSection from "@/components/sbc-breakdown-section";

/**
 * Optional SBC Section - Shows as a simple question asking if user wants to input SBC
 * All SBC category cards are embedded within this section
 */
export default function SbcOptionalSection() {
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns || {});
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  
  // Check if there are breakdown categories available
  const sgaRow = incomeStatement.find((r) => r.id === "sga");
  const cogsRow = incomeStatement.find((r) => r.id === "cogs");
  const hasCategories = (sgaRow?.children?.length ?? 0) > 0 || (cogsRow?.children?.length ?? 0) > 0;
  
  // Always start with null to show the question first
  // The question should ALWAYS be visible - Yes/No controls whether breakdown is shown
  const [userWantsSbc, setUserWantsSbc] = useState<boolean | null>(() => {
    // Check if user has previously chosen "Yes" - if so, show breakdown but keep question visible
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sbc_user_choice');
      if (saved === 'true') return true; // User said Yes before, show breakdown
      if (saved === 'false') return false; // User said No before, don't show breakdown
    }
    return null; // First time - show question
  });

  // Save choice to localStorage when user makes a decision
  useEffect(() => {
    if (userWantsSbc !== null && typeof window !== 'undefined') {
      localStorage.setItem('sbc_user_choice', String(userWantsSbc));
    }
  }, [userWantsSbc]);
  
  // If no categories exist, show message to add categories first
  if (!hasCategories) {
    return (
      <div className="mt-6 rounded-lg border border-amber-700/40 bg-amber-950/20 p-4">
        <div className="text-sm font-semibold text-amber-200 mb-2">
          📝 Stock-Based Compensation (SBC)
        </div>
        <p className="text-xs text-amber-300/80 mb-3">
          Stock-Based Compensation (SBC) typically appears as a note in the Income Statement. 
          If your company reports SBC, you can break it down into the expense and cost categories 
          you've already set up in COGS and Operating Expenses.
        </p>
        <p className="text-xs text-amber-400/70 italic">
          💡 To add SBC breakdowns, first add breakdown categories to COGS or Operating Expenses (SG&A).
        </p>
      </div>
    );
  }
  
  // State for expand/collapse of the entire SBC section
  const [isExpanded, setIsExpanded] = useState(userWantsSbc === true);

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
