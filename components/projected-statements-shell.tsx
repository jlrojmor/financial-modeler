"use client";

/**
 * Projected Statements step: integrated review of projected IS, BS, and CFS.
 * The right panel shows ExcelPreview with all statements; this shell is minimal.
 */
export default function ProjectedStatementsShell() {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-6">
      <p className="text-sm text-slate-300">
        Review the projected Income Statement, Balance Sheet, and Cash Flow in the preview to the right.
        Direct, derived, and schedule-fed rows will be distinguished in Phase 2.
      </p>
    </div>
  );
}
