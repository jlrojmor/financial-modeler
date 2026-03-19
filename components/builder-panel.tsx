"use client";

import { useMemo, useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import IncomeStatementBuilder from "@/components/income-statement-builder";
import BalanceSheetBuilder from "@/components/balance-sheet-builder-unified";
import CashFlowBuilder from "@/components/cash-flow-builder";
import CollapsibleSection from "@/components/collapsible-section";
import YearsEditor from "@/components/years-editor";
import { checkBalanceSheetBalance } from "@/lib/calculations";
import { getUnclassifiedNonCoreBsRows } from "@/lib/bs-core-rows";
import { getIsRowsMissingClassification } from "@/lib/is-classification";
import { getFullClassificationReport, getReviewItemsForHistoricals } from "@/lib/classification-completeness";
import {
  sanitizeHistoricalRevenueInIncomeStatement,
  collectForecastOnlyIdsFromTree,
} from "@/lib/historical-revenue-cleanup";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import HistoricalsHelpModal from "@/components/historicals-help-modal";
import CompanyContextTab from "@/components/company-context-tab";
import StatementStructureShell from "@/components/statement-structure-shell";
import ForecastDriversShell from "@/components/forecast-drivers-shell";
import SchedulesShell from "@/components/schedules-shell";
import ProjectedStatementsShell from "@/components/projected-statements-shell";
import DcfShell from "@/components/dcf-shell";

export default function BuilderPanel() {
  const currentStepId = useModelStore((s) => s.currentStepId);
  const completedStepIds = useModelStore((s) => s.completedStepIds);
  const isModelComplete = useModelStore((s) => s.isModelComplete);
  const saveCurrentStep = useModelStore((s) => s.saveCurrentStep);
  const saveCurrentProject = useModelStore((s) => s.saveCurrentProject);
  const continueToNextStep = useModelStore((s) => s.continueToNextStep);
  const resetAllFinancialInputs = useModelStore((s) => s.resetAllFinancialInputs);
  const resetIncomeStatementInputs = useModelStore((s) => s.resetIncomeStatementInputs);
  const resetBalanceSheetInputs = useModelStore((s) => s.resetBalanceSheetInputs);
  const resetCashFlowInputs = useModelStore((s) => s.resetCashFlowInputs);
  const confirmRowReview = useModelStore((s) => s.confirmRowReview);
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
    if (currentStepId !== "statement_structure" || !balanceSheet?.length) return [];
    return getUnclassifiedNonCoreBsRows(balanceSheet);
  }, [currentStepId, balanceSheet]);

  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const revenueForecastTreeV1 = useModelStore((s) => s.revenueForecastTreeV1 ?? []);
  /** Historicals / review: real IS only — no forecast-polluted revenue subtree. */
  const incomeStatementForHistoricals = useMemo(
    () =>
      sanitizeHistoricalRevenueInIncomeStatement(
        incomeStatement ?? [],
        revenueForecastTreeV1,
        meta?.years?.historical ?? []
      ),
    [incomeStatement, revenueForecastTreeV1, meta?.years?.historical]
  );
  const forecastOnlyRevenueIds = useMemo(
    () => collectForecastOnlyIdsFromTree(revenueForecastTreeV1),
    [revenueForecastTreeV1]
  );
  const rowsMissingIsClassification = useMemo(() => {
    if (currentStepId !== "historicals" || !incomeStatementForHistoricals?.length) return [];
    return getIsRowsMissingClassification(incomeStatementForHistoricals, {
      excludeRowIds: forecastOnlyRevenueIds,
    });
  }, [currentStepId, incomeStatementForHistoricals, forecastOnlyRevenueIds]);

  const cashFlow = useModelStore((s) => s.cashFlow);

  // Compute report and review items from current store state every render when on historicals
  // so the panel updates immediately when row metadata is fixed (no stale memoization).
  const classificationReport =
    currentStepId === "historicals"
      ? getFullClassificationReport({
          incomeStatement: incomeStatementForHistoricals ?? [],
          balanceSheet: balanceSheet ?? [],
          cashFlow: cashFlow ?? [],
        })
      : null;

  const reviewItems =
    currentStepId === "historicals" && classificationReport
      ? getReviewItemsForHistoricals(classificationReport, {
          incomeStatement: incomeStatementForHistoricals ?? [],
          balanceSheet: balanceSheet ?? [],
          cashFlow: cashFlow ?? [],
        })
      : [];

  const reviewByStatement = useMemo(() => {
    const byStatement: { income: typeof reviewItems; balance: typeof reviewItems; cashFlow: typeof reviewItems } = {
      income: [],
      balance: [],
      cashFlow: [],
    };
    for (const item of reviewItems) {
      byStatement[item.statementKey].push(item);
    }
    return byStatement;
  }, [reviewItems]);

  // Disable Continue if balance doesn't check in historicals step, Statement Structure has unclassified CF rows, or IS has rows missing classification
  const canContinue = isCurrentStepComplete &&
    (currentStepId !== "historicals" || (balanceCheck.isBalanced || !balanceCheck.hasData) && rowsMissingIsClassification.length === 0) &&
    (currentStepId !== "statement_structure" || unclassifiedCfRows.length === 0);

  // Save button feedback state
  const [saveFeedback, setSaveFeedback] = useState<"idle" | "saving" | "saved">("idle");
  const [showResetModal, setShowResetModal] = useState(false);
  const [showHistoricalsHelp, setShowHistoricalsHelp] = useState(false);
  type ResetScope = "all" | "income_statement" | "balance_sheet" | "cash_flow" | null;
  const [resetScope, setResetScope] = useState<ResetScope>(null);
  const [resetConfirmStep, setResetConfirmStep] = useState(false);

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
      <HistoricalsHelpModal open={showHistoricalsHelp} onClose={() => setShowHistoricalsHelp(false)} />
      {/* Header - Fixed */}
      <div className="flex-shrink-0 p-4 pb-2 border-b border-slate-800">
        <div className="mb-4 flex items-start justify-between gap-4">
          {/* Title block: clean alignment, help as contextual link */}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-100 tracking-tight">
              Builder Panel
            </h2>
            <div className="mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400">
                Current step: <span className="text-slate-200">{currentStepId}</span>
              </span>
              {currentStepId === "historicals" && (
                <>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={() => setShowHistoricalsHelp(true)}
                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline rounded-md px-1.5 py-0.5 -ml-0.5 hover:bg-slate-800/50 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5 text-blue-400/90 hover:text-blue-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    How this works
                  </button>
                </>
              )}
            </div>
            {reviewItems.length > 0 && (
              <div className="mt-1.5 text-xs text-amber-400/90">
                {reviewItems.some((i) => i.reviewState === "setup_required")
                  ? "Some rows need setup so the model knows where they belong."
                  : "Some rows have suggested classification; confirm to accept."}
              </div>
            )}
          </div>

          {/* Actions: tertiary → secondary → primary, consistent height */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="rounded-md h-9 px-3 text-xs font-medium text-slate-300 hover:text-slate-200 border border-slate-600 bg-slate-800 hover:bg-slate-700 hover:border-slate-500 transition-colors cursor-pointer"
              onClick={() => setShowResetModal(true)}
            >
              Reset Inputs
            </button>
            <button
              className={`rounded-md h-9 px-3 text-xs font-medium transition-colors ${
                canDownload
                  ? "text-slate-300 border border-slate-600 bg-slate-800 hover:bg-slate-700 hover:border-slate-500"
                  : "text-slate-500 border border-slate-700 bg-slate-800/60 cursor-not-allowed"
              }`}
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
              Download Excel
            </button>
            <button
              className={`rounded-md h-9 px-3 text-xs font-medium transition-colors ${
                saveFeedback === "saved"
                  ? "text-emerald-300 border border-emerald-600/60 bg-emerald-950/40"
                  : saveFeedback === "saving"
                  ? "text-blue-200 border border-blue-600/60 bg-blue-950/40 cursor-wait"
                  : "text-blue-100 border border-blue-700 bg-blue-900 hover:bg-blue-800 hover:border-blue-600"
              }`}
              onClick={handleSave}
              disabled={saveFeedback === "saving"}
            >
              {saveFeedback === "saved" ? "✓ Saved" : saveFeedback === "saving" ? "Saving..." : "Save"}
            </button>
            <div className="w-px h-6 bg-slate-700" aria-hidden />
            <button
              className={`rounded-md h-9 px-4 text-xs font-semibold transition-colors ${
                canContinue
                  ? "bg-slate-100 text-slate-950 hover:bg-white"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed"
              }`}
              onClick={continueToNextStep}
              disabled={!canContinue}
              title={
                !isCurrentStepComplete
                  ? "Please save the current step first"
                  : currentStepId === "historicals" && rowsMissingIsClassification.length > 0
                  ? "Classify all custom Income Statement rows (section & operating vs non-operating) before continuing"
                  : currentStepId === "historicals" && !balanceCheck.isBalanced && balanceCheck.hasData
                  ? "Balance sheet must balance for all historical years before continuing"
                  : currentStepId === "statement_structure" && unclassifiedCfRows.length > 0
                  ? "Classify cash flow treatment for all custom BS rows before continuing"
                  : undefined
              }
            >
              Continue →
            </button>
          </div>
        </div>

        {/* Reset Inputs: scope choice then confirmation */}
        {showResetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby="reset-modal-title">
            <div className="rounded-lg border border-slate-700 bg-slate-900 shadow-xl max-w-md w-full p-5">
              <h2 id="reset-modal-title" className="text-sm font-semibold text-slate-100 mb-3">
                {!resetConfirmStep ? "What do you want to reset?" : "Confirm reset"}
              </h2>
              {!resetConfirmStep ? (
                <>
                  <p className="text-xs text-slate-300 mb-4">
                    Choose which inputs to clear. Structure, years, and other statements will be preserved.
                  </p>
                  <div className="space-y-2 mb-5">
                    <button
                      type="button"
                      className="w-full rounded-md px-4 py-2.5 text-left text-xs font-medium border border-slate-600 text-slate-200 hover:bg-slate-800 transition-colors"
                      onClick={() => { setResetScope("all"); setResetConfirmStep(true); }}
                    >
                      Reset all inputs
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-md px-4 py-2.5 text-left text-xs font-medium border border-slate-600 text-slate-200 hover:bg-slate-800 transition-colors"
                      onClick={() => { setResetScope("income_statement"); setResetConfirmStep(true); }}
                    >
                      Reset Income Statement only
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-md px-4 py-2.5 text-left text-xs font-medium border border-slate-600 text-slate-200 hover:bg-slate-800 transition-colors"
                      onClick={() => { setResetScope("balance_sheet"); setResetConfirmStep(true); }}
                    >
                      Reset Balance Sheet only
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-md px-4 py-2.5 text-left text-xs font-medium border border-slate-600 text-slate-200 hover:bg-slate-800 transition-colors"
                      onClick={() => { setResetScope("cash_flow"); setResetConfirmStep(true); }}
                    >
                      Reset Cash Flow Statement only
                    </button>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="rounded-md px-4 py-2 text-xs font-semibold border border-slate-600 text-slate-200 hover:bg-slate-700 transition-colors"
                      onClick={() => { setShowResetModal(false); setResetScope(null); setResetConfirmStep(false); }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-300 mb-5">
                    {resetScope === "all" &&
                      "This will clear historical values, disclosure inputs, custom rows, and schedule values. Statement structure and years will remain unchanged."}
                    {resetScope === "income_statement" &&
                      "This will clear Income Statement historical values and custom rows. Balance Sheet and Cash Flow will not be changed."}
                    {resetScope === "balance_sheet" &&
                      "This will clear Balance Sheet historical values, custom rows, and related schedule inputs. Income Statement and Cash Flow will not be changed."}
                    {resetScope === "cash_flow" &&
                      "This will clear all Cash Flow inputs and custom CFS rows. Fixed CFS structure (anchors and sections) will remain. You can re-enter CFS data from a clean state."}
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-md px-4 py-2 text-xs font-semibold border border-slate-600 text-slate-200 hover:bg-slate-700 transition-colors"
                      onClick={() => { setResetScope(null); setResetConfirmStep(false); }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-4 py-2 text-xs font-semibold bg-slate-100 text-slate-900 hover:bg-white transition-colors"
                      onClick={() => {
                        if (resetScope === "all") resetAllFinancialInputs();
                        else if (resetScope === "income_statement") resetIncomeStatementInputs();
                        else if (resetScope === "balance_sheet") resetBalanceSheetInputs();
                        else if (resetScope === "cash_flow") resetCashFlowInputs();
                        setShowResetModal(false);
                        setResetScope(null);
                        setResetConfirmStep(false);
                      }}
                    >
                      Confirm Reset
                    </button>
                  </div>
                </>
              )}
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

        {/* Statement Structure: classify CF treatment for custom BS rows */}
        {currentStepId === "statement_structure" && unclassifiedCfRows.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-600/50 bg-amber-950/30 p-3">
            <div className="flex items-start gap-2">
              <span className="text-amber-400 text-sm">⚠️</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-amber-200">
                  Classify cash flow treatment for custom rows
                </p>
                <p className="text-xs text-amber-200/90 mt-1">
                  {unclassifiedCfRows.length} custom Balance Sheet row(s) need a cash flow treatment (Working Capital, Investing, Financing, or Non-cash). Use the Balance Sheet tab and the &quot;Cash flow&quot; dropdown on each row or the CF Treatment Check section.
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
        {/* Years Editor - Available in all steps except Company Context */}
        {currentStepId !== "company_context" && (
          <div className="mb-6">
            <YearsEditor />
          </div>
        )}

        {currentStepId === "company_context" && (
          <CompanyContextTab />
        )}
        
        {currentStepId === "historicals" && (
          <div className="space-y-6">
            {/* Rows Requiring Review - actionable rows only; split into Needs setup vs Needs confirmation */}
            {reviewItems.length > 0 && (
              <div className="rounded-lg border border-amber-600/40 bg-amber-950/20 p-4">
                <h3 className="text-sm font-semibold text-amber-200 mb-3">
                  Rows Requiring Review
                </h3>
                <p className="text-xs text-slate-300/90 mb-3">
                  Fix or confirm the rows below in each statement builder. Rows with a suggested type can be confirmed; others need setup in the builder.
                </p>
                <div className="space-y-4">
                  {(["income", "balance", "cashFlow"] as const).map((key) => {
                    const items = reviewByStatement[key];
                    if (!items.length) return null;
                    const statementName = items[0].statementName;
                    const storeStatementKey =
                      key === "income" ? "incomeStatement" : key === "balance" ? "balanceSheet" : "cashFlow";
                    const needsSetup = items.filter((i) => i.isUnresolved);
                    const needsConfirmation = items.filter((i) => i.canConfirm);
                    return (
                      <div key={key}>
                        <div className="text-xs font-medium text-slate-200 mb-2">
                          {statementName}
                        </div>
                        {needsSetup.length > 0 && (
                          <div className="mb-2">
                            <div className="text-[11px] font-medium text-amber-300/90 mb-1">Needs setup</div>
                            <ul className="space-y-1.5">
                              {needsSetup.map((item) => (
                                <li
                                  key={`${item.statementKey}:${item.rowId}`}
                                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                                >
                                  <span className="font-medium text-slate-100">{item.label}</span>
                                  <span className="text-amber-300">{item.issueText}</span>
                                  <span className="text-slate-400">{item.reason}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {needsConfirmation.length > 0 && (
                          <div>
                            <div className="text-[11px] font-medium text-amber-200/90 mb-1">Needs confirmation</div>
                            <ul className="space-y-1.5">
                              {needsConfirmation.map((item) => (
                                <li
                                  key={`${item.statementKey}:${item.rowId}`}
                                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                                >
                                  <span className="font-medium text-slate-100">{item.label}</span>
                                  <span className="text-amber-200/90" title={item.reason}>
                                    {item.suggestedLabel ? `Suggested: ${item.suggestedLabel}` : `Confirm: accept suggested classification for “${item.label}”`}
                                  </span>
                                  <span className="text-slate-400">{item.reason}</span>
                                  <button
                                    type="button"
                                    className="ml-1 rounded px-2 py-0.5 text-[11px] font-medium bg-amber-600/80 text-white hover:bg-amber-500/90 transition-colors"
                                    onClick={() => confirmRowReview(storeStatementKey, item.rowId)}
                                  >
                                    Confirm
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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

        {currentStepId === "statement_structure" && <StatementStructureShell />}

        {currentStepId === "forecast_drivers" && <ForecastDriversShell />}

        {currentStepId === "schedules" && <SchedulesShell />}

        {currentStepId === "projected_statements" && <ProjectedStatementsShell />}

        {currentStepId === "dcf" && <DcfShell />}

        {!["company_context", "historicals", "statement_structure", "forecast_drivers", "schedules", "projected_statements", "dcf"].includes(currentStepId) && (
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