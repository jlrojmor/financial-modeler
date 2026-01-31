"use client";

import { useModelStore } from "@/store/useModelStore";
import StatementBuilder from "@/components/statement-builder";
import RevenueCogsBuilder from "@/components/revenue-cogs-builder";
import SgaBuilder from "@/components/sga-builder";
import DanaBuilder from "@/components/dana-builder";
import InterestOtherBuilder from "@/components/interest-other-builder";
import TaxBuilder from "@/components/tax-builder";
import SbcAnnotation from "@/components/sbc-annotation";
import BalanceSheetBuilder from "@/components/balance-sheet-builder";
import CollapsibleSection from "@/components/collapsible-section";

export default function BuilderPanel() {
  const currentStepId = useModelStore((s) => s.currentStepId);
  const completedStepIds = useModelStore((s) => s.completedStepIds);
  const isModelComplete = useModelStore((s) => s.isModelComplete);
  const saveCurrentStep = useModelStore((s) => s.saveCurrentStep);
  const continueToNextStep = useModelStore((s) => s.continueToNextStep);
  const meta = useModelStore((s) => s.meta);
  
  const isCurrentStepComplete = completedStepIds.includes(currentStepId);

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
              className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
              onClick={saveCurrentStep}
            >
              Save
            </button>

            <button
              className={[
                "rounded-md px-4 py-2 text-xs font-semibold",
                isCurrentStepComplete
                  ? "bg-slate-100 text-slate-950 hover:bg-white"
                  : "bg-slate-800 text-slate-400 cursor-not-allowed",
              ].join(" ")}
              onClick={continueToNextStep}
              disabled={!isCurrentStepComplete}
            >
              Continue →
            </button>
          </div>
        </div>
      </div>

      {/* Step-specific content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4">
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
            
            {/* Income Statement Section - Collapsed by default */}
            <CollapsibleSection
              sectionId="historicals_is"
              title="Income Statement (Historicals)"
              description="Enter historical Income Statement data. All IS inputs are here."
              colorClass="blue"
              defaultExpanded={false}
            >
              <div className="space-y-6">
                {/* Guided Revenue & COGS Builder */}
                <RevenueCogsBuilder />

                {/* Guided SG&A Builder */}
                <SgaBuilder />

                {/* Guided D&A Builder */}
                <DanaBuilder />

                {/* Guided Interest & Other Income Builder */}
                <InterestOtherBuilder />

                {/* Guided Tax Builder */}
                <TaxBuilder />

                {/* Rest of Income Statement (R&D, etc.) */}
                <StatementBuilder
                  statement="incomeStatement"
                  statementLabel="Other Income Statement Items"
                  description="Enter other income statement line items."
                />

                {/* Stock-Based Compensation Annotation */}
                <SbcAnnotation />
              </div>
            </CollapsibleSection>

            {/* Balance Sheet Section */}
            <div className="mt-6">
              <div className="mb-4 rounded-lg border border-green-800/40 bg-green-950/20 p-4">
                <h3 className="text-sm font-semibold text-green-200 mb-2">
                  Balance Sheet (Historicals)
                </h3>
                <p className="text-xs text-green-300/80">
                  Enter historical Balance Sheet data. The system automatically determines Cash Flow impacts based on accounting rules.
                </p>
              </div>
              <BalanceSheetBuilder />
            </div>

            {/* Cash Flow Statement Section */}
            <div className="mt-6">
              <div className="mb-4 rounded-lg border border-purple-800/40 bg-purple-950/20 p-4">
                <h3 className="text-sm font-semibold text-purple-200 mb-2">
                  Cash Flow Statement (Historicals)
                </h3>
                <p className="text-xs text-purple-300/80">
                  Enter historical Cash Flow Statement data. Many items link to other statements automatically.
                </p>
              </div>
              <StatementBuilder
                statement="cashFlow"
                statementLabel="Cash Flow Statement"
                description="Enter historical cash flow data. Operating, Investing, and Financing activities."
              />
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
          <StatementBuilder
            statement="cashFlow"
            statementLabel="Cash Flow Statement"
            description="Build your Cash Flow Statement structure. Many items will link to other statements."
          />
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