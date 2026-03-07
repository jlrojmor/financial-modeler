"use client";

import { useMemo, useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import IncomeStatementBuilder from "@/components/income-statement-builder";
import BalanceSheetBuilder from "@/components/balance-sheet-builder-unified";
import CashFlowBuilder from "@/components/cash-flow-builder";
import ISBuildView from "@/components/is-build-view";
import RevenueProjectionStep from "@/components/revenue-projection-step";
import CollapsibleSection from "@/components/collapsible-section";
import YearsEditor from "@/components/years-editor";
import { checkBalanceSheetBalance } from "@/lib/calculations";
import { getUnclassifiedNonCoreBsRows } from "@/lib/bs-core-rows";
import { getIsRowsMissingClassification } from "@/lib/is-classification";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";

export default function BuilderPanel() {
  const currentStepId = useModelStore((s) => s.currentStepId);
  const completedStepIds = useModelStore((s) => s.completedStepIds);
  const isModelComplete = useModelStore((s) => s.isModelComplete);
  const saveCurrentStep = useModelStore((s) => s.saveCurrentStep);
  const saveCurrentProject = useModelStore((s) => s.saveCurrentProject);
  const continueToNextStep = useModelStore((s) => s.continueToNextStep);
  const resetFinancialInputs = useModelStore((s) => s.resetFinancialInputs);
  const meta = useModelStore((s) => s.meta);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const currencyUnit = meta?.currencyUnit ?? "millions";

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

  const unclassifiedCfRows = useMemo(() => {
    if (currentStepId !== "bs_build" || !balanceSheet?.length) return [];
    return getUnclassifiedNonCoreBsRows(balanceSheet);
  }, [currentStepId, balanceSheet]);

  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const rowsMissingIsClassification = useMemo(() => {
    if (currentStepId !== "historicals" || !incomeStatement?.length) return [];
    return getIsRowsMissingClassification(incomeStatement);
  }, [currentStepId, incomeStatement]);

  // Disable Continue if balance doesn't check in historicals step, BS Build has unclassified CF rows, or IS has rows missing classification
  const canContinue = isCurrentStepComplete &&
    (currentStepId !== "historicals" || (balanceCheck.isBalanced || !balanceCheck.hasData) && rowsMissingIsClassification.length === 0) &&
    (currentStepId !== "bs_build" || unclassifiedCfRows.length === 0);

  // Save button feedback state
  const [saveFeedback, setSaveFeedback] = useState<"idle" | "saving" | "saved">("idle");
  const [showResetModal, setShowResetModal] = useState(false);

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
              type="button"
              className="rounded-md px-4 py-2 text-xs font-semibold border border-slate-600 text-slate-200 bg-slate-800/80 hover:bg-slate-700/80 transition-colors"
              onClick={() => setShowResetModal(true)}
            >
              Reset Inputs
            </button>

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
                  : currentStepId === "historicals" && rowsMissingIsClassification.length > 0
                  ? "Classify all custom Income Statement rows (section & operating vs non-operating) before continuing"
                  : currentStepId === "historicals" && !balanceCheck.isBalanced && balanceCheck.hasData
                  ? "Balance sheet must balance for all historical years before continuing"
                  : currentStepId === "bs_build" && unclassifiedCfRows.length > 0
                  ? "Classify cash flow treatment for all custom BS rows before continuing"
                  : undefined
              }
            >
              Continue →
            </button>
          </div>
        </div>

        {/* Reset Inputs confirmation modal */}
        {showResetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby="reset-modal-title">
            <div className="rounded-lg border border-slate-700 bg-slate-900 shadow-xl max-w-md w-full p-5">
              <h2 id="reset-modal-title" className="text-sm font-semibold text-slate-100 mb-3">
                Reset all entered financial data?
              </h2>
              <p className="text-xs text-slate-300 mb-5">
                This will remove historical financial values, disclosure inputs, custom rows, and schedule values. Your financial statement structure and configuration will remain unchanged.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md px-4 py-2 text-xs font-semibold border border-slate-600 text-slate-200 hover:bg-slate-700 transition-colors"
                  onClick={() => setShowResetModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md px-4 py-2 text-xs font-semibold bg-slate-100 text-slate-900 hover:bg-white transition-colors"
                  onClick={() => {
                    setShowResetModal(false);
                    resetFinancialInputs();
                  }}
                >
                  Confirm Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* IS classification warning (Historicals): custom rows need sectionOwner + isOperating */}
        {currentStepId === "historicals" && rowsMissingIsClassification.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-600/50 bg-amber-950/30 p-3">
            <div className="flex items-start gap-2">
              <span className="text-amber-400 text-sm">⚠️</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-amber-200">
                  Classify custom Income Statement rows
                </p>
                <p className="text-xs text-amber-200/90 mt-1">
                  {rowsMissingIsClassification.length} custom row(s) need section and operating/non-operating classification. Set them in the Income Statement Builder (Interest &amp; Other section or per-row classification).
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Balance Check Warning for Historicals Step */}
        {currentStepId === "bs_build" && unclassifiedCfRows.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-600/50 bg-amber-950/30 p-3">
            <div className="flex items-start gap-2">
              <span className="text-amber-400 text-sm">⚠️</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-amber-200">
                  Classify cash flow treatment for custom rows
                </p>
                <p className="text-xs text-amber-200/90 mt-1">
                  {unclassifiedCfRows.length} custom Balance Sheet row(s) need a cash flow treatment (Working Capital, Investing, Financing, or Non-cash). Use the &quot;Cash flow&quot; dropdown on each row or the CF Treatment Check section below.
                </p>
              </div>
            </div>
          </div>
        )}

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
                      .filter(b => !b.balances && !b.incomplete)
                      .map(b => {
                        const diffDisplay = storedToDisplay(Math.abs(b.difference), currencyUnit);
                        const unitLabel = getUnitLabel(currencyUnit);
                        const label = unitLabel ? ` ${unitLabel}` : "";
                        return `• ${b.year}: Difference of ${diffDisplay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${label}`;
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
            {/* Workflow Guide - static guidance only */}
            <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-4">
              <h3 className="text-sm font-semibold text-slate-200 mb-2">
                Workflow Guide
              </h3>
              <p className="text-xs text-slate-300/90 mb-2">
                Build your historical model in this order:
              </p>
              <ol className="text-xs text-slate-300/90 list-decimal list-inside space-y-1 mb-2">
                <li>Income Statement</li>
                <li>Expense Disclosures (optional, only if reported in notes)</li>
                <li>Balance Sheet</li>
                <li>Cash Flow Statement</li>
              </ol>
              <p className="text-[11px] text-slate-400 border-t border-slate-700/50 pt-2 mt-2">
                Disclosures do not change reported historical values. They are note breakdowns used later for analysis and cash flow construction.
              </p>
            </div>

            {/* Income Statement Section - Using Unified Builder */}
            <IncomeStatementBuilder />

            {/* Balance Sheet Section — historical data only; no WC/Capex schedules here */}
            <div className="mt-6">
              <BalanceSheetBuilder stepId="historicals" />
            </div>

            {/* Cash Flow Statement Section */}
            <div className="mt-6">
              <CashFlowBuilder />
            </div>
          </div>
        )}

        {currentStepId === "is_build" && <ISBuildView />}

        {currentStepId === "bs_build" && (
          <BalanceSheetBuilder stepId="bs_build" />
        )}

        {currentStepId === "cfs_build" && (
          <CashFlowBuilder />
        )}

        {currentStepId === "projections" && <RevenueProjectionStep />}

        {!["historicals", "is_build", "bs_build", "cfs_build", "projections"].includes(currentStepId) && (
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