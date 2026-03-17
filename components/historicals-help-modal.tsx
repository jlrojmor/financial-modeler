"use client";

import { useState } from "react";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "classification", label: "Classification" },
  { id: "income_statement", label: "Income Statement" },
  { id: "balance_sheet", label: "Balance Sheet" },
  { id: "cash_flow", label: "Cash Flow" },
  { id: "row_actions", label: "Row actions" },
  { id: "review_panel", label: "Review panel" },
  { id: "renaming", label: "Renaming rows" },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface HistoricalsHelpModalProps {
  open: boolean;
  onClose: () => void;
}

export default function HistoricalsHelpModal({ open, onClose }: HistoricalsHelpModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="historicals-help-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="rounded-xl border border-slate-700 bg-slate-900 shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <h2 id="historicals-help-title" className="text-base font-semibold text-slate-100">
            How Historicals works
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="flex-shrink-0 w-40 border-r border-slate-700 bg-slate-900/60 p-2 overflow-y-auto">
            <ul className="space-y-0.5">
              {TABS.map(({ id, label }) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                      activeTab === id
                        ? "bg-blue-600/80 text-white"
                        : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                    }`}
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex-1 overflow-y-auto p-5 text-sm text-slate-300">
            {activeTab === "overview" && (
              <div className="space-y-4">
                <p>
                  The <strong className="text-slate-200">Historicals</strong> step is where you enter and organize your company’s historical financial data for the Income Statement, Balance Sheet, and Cash Flow Statement.
                </p>
                <p>
                  The app helps you keep everything consistent: it classifies rows (with AI and fallbacks), lets you confirm or adjust suggestions, and keeps the three statements aligned. You can edit values, rename or reclassify rows, and use the Review panel to fix anything that needs attention.
                </p>
                <p className="text-slate-400 text-xs">
                  Recommended order: set your years, then fill Income Statement → (optional) Expense Disclosures → Balance Sheet → Cash Flow. The preview on the right updates as you type.
                </p>
              </div>
            )}

            {activeTab === "classification" && (
              <div className="space-y-4">
                <p>
                  Every row is <strong className="text-slate-200">classified</strong> so the model knows what it is and where it belongs. Classification uses three sources:
                </p>
                <ul className="list-disc list-inside space-y-1.5 pl-2">
                  <li><strong className="text-slate-200">Template rows</strong> — Built-in lines (e.g. Revenue, COGS, Cash) are pre-classified and trusted.</li>
                  <li><strong className="text-slate-200">AI + fallback</strong> — Custom rows get a suggested section/type from AI when available; otherwise the app uses label-based fallback rules.</li>
                  <li><strong className="text-slate-200">User confirmation</strong> — When a row has a suggestion, you can click <strong>Confirm</strong> to accept it, or edit the row (e.g. change label or classification) and confirm again.</li>
                </ul>
                <p>
                  Rows that are not yet confirmed or that lack required metadata appear in the <strong className="text-slate-200">Rows Requiring Review</strong> panel so you can fix or confirm them before continuing.
                </p>
              </div>
            )}

            {activeTab === "income_statement" && (
              <div className="space-y-4">
                <p>
                  The <strong className="text-slate-200">Income Statement</strong> is organized into sections: Revenue, COGS, Operating Expenses (with optional breakdowns like R&D, SG&A), and non-operating items (Interest, Tax, etc.).
                </p>
                <p>
                  For custom operating expense or interest items, the app assigns a <strong className="text-slate-200">section</strong> (e.g. Operating Expenses) and whether the item is <strong className="text-slate-200">operating</strong> or non-operating. You can change these in the row’s metadata or confirm the suggestion. Totals and margins are calculated automatically.
                </p>
              </div>
            )}

            {activeTab === "balance_sheet" && (
              <div className="space-y-4">
                <p>
                  The <strong className="text-slate-200">Balance Sheet</strong> is split into categories: Current Assets, Fixed Assets, Current Liabilities, Non-Current Liabilities, and Equity.
                </p>
                <p>
                  Each row has a <strong className="text-slate-200">cash flow treatment</strong>: Working Capital (CFO), Investing (CFI), Financing (CFF), or Non-cash. This drives how the row feeds into the Cash Flow Statement and projections. Template rows are pre-assigned; custom rows get a suggestion (from AI or label heuristics) that you can confirm or change in the dropdown.
                </p>
              </div>
            )}

            {activeTab === "cash_flow" && (
              <div className="space-y-4">
                <p>
                  The <strong className="text-slate-200">Cash Flow Statement</strong> has three main sections: Operating, Investing, and Financing. Operating is further grouped into:
                </p>
                <ul className="list-disc list-inside space-y-1 pl-2">
                  <li><strong className="text-slate-200">Earnings base</strong> — e.g. Net income</li>
                  <li><strong className="text-slate-200">Non-cash adjustments</strong> — D&A, SBC, and other non-cash items</li>
                  <li><strong className="text-slate-200">Working capital adjustments</strong> — Change in Working Capital and its components (AR, AP, etc.)</li>
                  <li><strong className="text-slate-200">Other operating activities</strong> — Any other operating items</li>
                </ul>
                <p>
                  Rows you add are assigned to one of these subgroups. You can drag rows between subgroups (e.g. from Working Capital to Non-cash); the row’s classification updates to match.
                </p>
              </div>
            )}

            {activeTab === "row_actions" && (
              <div className="space-y-4">
                <p>
                  Each row supports consistent actions across Income Statement, Balance Sheet, and Cash Flow:
                </p>
                <ul className="space-y-2">
                  <li><strong className="text-slate-200">Edit values</strong> — Expand the row to enter or change historical numeric values. Collapse when done. This does not change the row’s name or classification.</li>
                  <li><strong className="text-slate-200">Edit row</strong> — Change the row’s label (name). For custom rows this is available next to Edit values. After saving, the app may suggest a new classification based on the new name.</li>
                  <li><strong className="text-slate-200">Confirm</strong> — Shown when the row has a pending suggested classification. Click to accept the suggestion so the row is marked trusted and drops out of the review list.</li>
                  <li><strong className="text-slate-200">Remove</strong> — Delete the row. Not available for template or total rows (e.g. Revenue, Cash, section totals).</li>
                </ul>
                <p className="text-slate-400 text-xs">
                  Template and calculated rows do not show Remove. Totals and margins have no edit/remove actions.
                </p>
              </div>
            )}

            {activeTab === "review_panel" && (
              <div className="space-y-4">
                <p>
                  The <strong className="text-slate-200">Rows Requiring Review</strong> panel lists rows that need your attention:
                </p>
                <ul className="list-disc list-inside space-y-1 pl-2">
                  <li><strong className="text-slate-200">Needs setup</strong> — Required metadata is missing (e.g. section, cash flow treatment, or CFS nature). Add the missing info in the builder.</li>
                  <li><strong className="text-slate-200">Needs confirmation</strong> — The app has suggested a classification. Click <strong>Confirm</strong> in the panel (or on the row) to accept it.</li>
                </ul>
                <p>
                  Once you fix or confirm a row, it disappears from the list. The warning at the top of the builder updates as you resolve items. You can continue to the next step when the balance sheet balances (if you have data) and there are no remaining blocking issues.
                </p>
              </div>
            )}

            {activeTab === "renaming" && (
              <div className="space-y-4">
                <p>
                  When you <strong className="text-slate-200">rename a row</strong> (Edit row → change label → Save), the app:
                </p>
                <ol className="list-decimal list-inside space-y-1.5 pl-2">
                  <li>Updates the row’s label everywhere.</li>
                  <li>Re-runs classification for that row (AI or label-based fallback) so the suggestion matches the new name.</li>
                  <li>For custom rows, marks the row as <strong className="text-slate-200">needs review</strong> so you can confirm the new suggestion or adjust it.</li>
                </ol>
                <p>
                  Template and anchor rows (e.g. Revenue, Cash, Net income) can also be renamed for display; their role in the model does not change. For custom rows, confirming after a rename accepts the new classification.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
