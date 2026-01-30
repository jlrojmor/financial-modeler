"use client";

import { useModelStore } from "@/store/useModelStore";
import StatementBuilder from "@/components/statement-builder";
import RevenueCogsBuilder from "@/components/revenue-cogs-builder";
import SgaBuilder from "@/components/sga-builder";
import DanaBuilder from "@/components/dana-builder";
import InterestOtherBuilder from "@/components/interest-other-builder";
import SbcAnnotation from "@/components/sbc-annotation";

export default function BuilderPanel() {
  const currentStepId = useModelStore((s) => s.currentStepId);
  const isModelComplete = useModelStore((s) => s.isModelComplete);
  const completeCurrentStep = useModelStore((s) => s.completeCurrentStep);
  const meta = useModelStore((s) => s.meta);

  const canDownload = isModelComplete;

  return (
    <section className="h-full w-full rounded-lg border border-slate-800 bg-slate-950 p-4">
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
                alert("Failed to generate Excel file");
              }
            }}
          >
            Download Excel (.xlsx)
          </button>

          <button
            className="rounded-md bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-white"
            onClick={completeCurrentStep}
          >
            Save & Continue →
          </button>
        </div>
      </div>

      {/* Step-specific content */}
      <div className="mt-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
        {currentStepId === "historicals" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 p-4">
              <h3 className="text-sm font-semibold text-blue-200 mb-2">
                Enter Historical Financial Data
              </h3>
              <p className="text-xs text-blue-300/80">
                Start with Revenue and COGS. Add revenue streams, and each will automatically get its own COGS line.
                Totals are calculated automatically.
              </p>
            </div>
            
            {/* Guided Revenue & COGS Builder */}
            <RevenueCogsBuilder />

            {/* Guided SG&A Builder */}
            <div className="mt-6">
              <SgaBuilder />
            </div>

            {/* Guided D&A Builder */}
            <div className="mt-6">
              <DanaBuilder />
            </div>

            {/* Guided Interest & Other Income Builder */}
            <div className="mt-6">
              <InterestOtherBuilder />
            </div>

            {/* Rest of Income Statement (R&D, etc.) */}
            <div className="mt-6">
              <StatementBuilder
                statement="incomeStatement"
                statementLabel="Other Income Statement Items"
                description="Enter other income statement line items. Revenue, COGS, SG&A, D&A, and Interest/Other Income are managed above."
              />
            </div>

            {/* Stock-Based Compensation Annotation */}
            <SbcAnnotation />
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
          <StatementBuilder
            statement="balanceSheet"
            statementLabel="Balance Sheet"
            description="Build your Balance Sheet structure. Enter historical balance sheet data for each line item."
          />
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