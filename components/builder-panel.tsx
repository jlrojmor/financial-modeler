"use client";

import { useMemo, useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import StatementBuilder from "@/components/statement-builder";
import IncomeStatementBuilder from "@/components/income-statement-builder";
import BalanceSheetBuilder from "@/components/balance-sheet-builder-unified";
import CashFlowBuilder from "@/components/cash-flow-builder";
import CollapsibleSection from "@/components/collapsible-section";
import YearsEditor from "@/components/years-editor";
import { checkBalanceSheetBalance } from "@/lib/calculations";

export default function BuilderPanel() {
  const currentStepId = useModelStore((s) => s.currentStepId);
  const completedStepIds = useModelStore((s) => s.completedStepIds);
  const isModelComplete = useModelStore((s) => s.isModelComplete);
  const saveCurrentStep = useModelStore((s) => s.saveCurrentStep);
  const saveCurrentProject = useModelStore((s) => s.saveCurrentProject);
  const continueToNextStep = useModelStore((s) => s.continueToNextStep);
  const meta = useModelStore((s) => s.meta);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  
  const isCurrentStepComplete = completedStepIds.includes(currentStepId);

  // Check if balance sheet balances for historical years (only in historicals step)
  const balanceCheck = useMemo(() => {
    if (currentStepId !== "historicals" || !balanceSheet || balanceSheet.length === 0) {
      return { isBalanced: true, hasData: false };
    }
    
    const historicalYears = meta?.years?.historical ?? [];
    if (historicalYears.length === 0) {
      return { isBalanced: true, hasData: false };
    }
    
    const checkResults = checkBalanceSheetBalance(balanceSheet, historicalYears);
    const hasData = checkResults.some(b => b.totalAssets !== 0 || b.totalLiabAndEquity !== 0);
    const allBalanced = checkResults.every(b => b.balances);
    
    return { isBalanced: allBalanced, hasData, checkResults };
  }, [currentStepId, balanceSheet, meta?.years?.historical]);

  // Disable Continue if balance doesn't check in historicals step
  const canContinue = isCurrentStepComplete && (currentStepId !== "historicals" || balanceCheck.isBalanced || !balanceCheck.hasData);

  // Save button feedback state
  const [saveFeedback, setSaveFeedback] = useState<"idle" | "saving" | "saved">("idle");

  // Handle save with feedback (step completion + project state so no progress is lost)
  const handleSave = () => {
    setSaveFeedback("saving");
    saveCurrentStep();
    saveCurrentProject();
    setSaveFeedback("saved");
    // Reset feedback after 2 seconds
    setTimeout(() => {
      setSaveFeedback("idle");
    }, 2000);
  };

  // Allow download even if model not complete (for testing)
  const canDownload = true; // isModelComplete;

  return (
    <section className="h-full w-full rounded-lg border border-slate-800 bg-slate-950 flex flex-col overflow-hidden">
      {/* Header - Fixed */}
      <div className="flex-shrink-0 p-4 pb-2 border-b border-slate-800">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-100">
              Builder Panel
            </div>
            <div className="text-xs text-slate-400">
              Current step: <span className="text-slate-200">{currentStepId}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className={[
                "rounded-md px-4 py-2 text-xs font-semibold",
                canDownload
                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                  : "bg-slate-800 text-slate-400 cursor-not-allowed",
              ].join(" ")}
              disabled={!canDownload}
              onClick={async () => {
                const state = useModelStore.getState();
                const response = await fetch("/api/generate-excel", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(state),
                });
                
                if (response.ok) {
                  const blob = await response.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${state.meta.companyName || "model"}_${new Date().toISOString().split("T")[0]}.xlsx`;
                  document.body.appendChild(a);
                  a.click();
                  window.URL.revokeObjectURL(url);
                  document.body.removeChild(a);
                } else {
                  const errorData = await response.json().catch(() => ({}));
                  const errorMsg = errorData.details || errorData.error || "Failed to generate Excel file";
                  console.error("Excel generation error:", errorData);
                  alert(`Failed to generate Excel file: ${errorMsg}`);
                }
              }}
            >
              Download Excel (.xlsx)
            </button>

            <button
              className={[
                "rounded-md px-4 py-2 text-xs font-semibold transition-colors",
                saveFeedback === "saved"
                  ? "bg-emerald-600 text-white"
                  : saveFeedback === "saving"
                  ? "bg-blue-500 text-white cursor-wait"
                  : "bg-blue-600 text-white hover:bg-blue-500"
              ].join(" ")}
              onClick={handleSave}
              disabled={saveFeedback === "saving"}
            >
              {saveFeedback === "saved" ? "✓ Saved" : saveFeedback === "saving" ? "Saving..." : "Save"}
            </button>

            <button
              className={[
                "rounded-md px-4 py-2 text-xs font-semibold",
                canContinue
                  ? "bg-slate-100 text-slate-950 hover:bg-white"
                  : "bg-slate-800 text-slate-400 cursor-not-allowed",
              ].join(" ")}
              onClick={continueToNextStep}
              disabled={!canContinue}
              title={
                !isCurrentStepComplete
                  ? "Please save the current step first"
                  : currentStepId === "historicals" && !balanceCheck.isBalanced && balanceCheck.hasData
                  ? "Balance sheet must balance for all historical years before continuing"
                  : undefined
              }
            >
              Continue →
            </button>
          </div>
        </div>

        {/* Balance Check Warning for Historicals Step */}
        {currentStepId === "historicals" && balanceCheck.hasData && !balanceCheck.isBalanced && (
          <div className="mt-3 rounded-md border border-red-600/50 bg-red-950/30 p-3">
            <div className="flex items-start gap-2">
              <span className="text-red-400 text-sm">⚠️</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-red-200">
                  Balance Sheet Out of Balance
                </p>
                <p className="text-xs text-red-300/80 mt-1">
                  The balance sheet must balance (Total Assets = Total Liabilities + Equity) for all historical years before you can continue. Please review your inputs in the Balance Sheet section.
                </p>
                {balanceCheck.checkResults && (
                  <div className="mt-2 text-xs text-red-300/70">
                    {balanceCheck.checkResults
                      .filter(b => !b.balances)
                      .map(b => {
                        const diff = Math.abs(b.difference);
                        return `• ${b.year}: Difference of ${diff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                      })
                      .join(" | ")}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Step-specific content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Years Editor - Available in all steps */}
        <div className="mb-6">
          <YearsEditor />
        </div>
        
        {currentStepId === "historicals" && (
          <div className="space-y-6">
            <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 p-4">
              <h3 className="text-sm font-semibold text-blue-200 mb-2">
                Enter Historical Financial Data
              </h3>
              <p className="text-xs text-blue-300/80">
                Enter historical values for Income Statement, Balance Sheet, and Cash Flow Statement.
                Start with IS, then move to BS, then CFS. All sections can be collapsed/expanded.
              </p>
            </div>
            
            {/* Income Statement Section - Using Unified Builder */}
            <IncomeStatementBuilder />

            {/* Balance Sheet Section */}
            <div className="mt-6">
              <BalanceSheetBuilder />
            </div>

            {/* Cash Flow Statement Section */}
            <div className="mt-6">
              <CashFlowBuilder />
            </div>
          </div>
        )}

        {currentStepId === "is_build" && (
          <StatementBuilder
            statement="incomeStatement"
            statementLabel="Income Statement Structure"
            description="Review and customize your Income Statement structure. Add or remove line items as needed."
          />
        )}

        {currentStepId === "bs_build" && (
          <BalanceSheetBuilder />
        )}

        {currentStepId === "cfs_build" && (
          <CashFlowBuilder />
        )}

        {!["historicals", "is_build", "bs_build", "cfs_build"].includes(currentStepId) && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
            <p className="text-sm text-slate-400">
              Step-specific builder coming soon for: <span className="text-slate-200">{currentStepId}</span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}