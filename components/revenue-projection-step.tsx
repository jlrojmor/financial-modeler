"use client";

import { useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import { computeRowValue } from "@/lib/calculations";
import CollapsibleSection from "@/components/collapsible-section";

/**
 * Revenue Projection Step (first item in Projections)
 * Step 1: Show historic revenue (and subcategories) from Historicals.
 * Step 2 (later): Panel to build projections with drivers; real-time preview is already in ExcelPreview.
 */
export default function RevenueProjectionStep() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const meta = useModelStore((s) => s.meta);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);

  const historicalYears = useMemo(
    () => meta?.years?.historical ?? [],
    [meta?.years?.historical]
  );
  const projectionYears = useMemo(
    () => meta?.years?.projection ?? [],
    [meta?.years?.projection]
  );
  const unit = meta?.currencyUnit ?? "millions";
  const unitLabel = getUnitLabel(unit);

  // Revenue row(s): top-level "rev" and its children (revenue streams)
  const revRow = useMemo(
    () => incomeStatement.find((r) => r.id === "rev"),
    [incomeStatement]
  );
  const revenueRows = useMemo(() => {
    if (!revRow) return [];
    const rows: Array<{ row: Row; depth: number }> = [];
    rows.push({ row: revRow, depth: 0 });
    (revRow.children ?? []).forEach((child) => {
      rows.push({ row: child, depth: 1 });
    });
    return rows;
  }, [revRow]);

  const allStatements = useMemo(
    () => ({
      incomeStatement: incomeStatement ?? [],
      balanceSheet: balanceSheet ?? [],
      cashFlow: cashFlow ?? [],
    }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  if (!revRow) {
    return (
      <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-4">
        <p className="text-sm text-amber-200">
          No Revenue line found. Complete the Income Statement structure in IS Build, then return here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 p-4">
        <h3 className="text-sm font-semibold text-blue-200 mb-2">
          Revenue projections (item 1 of 3)
        </h3>
        <p className="text-xs text-blue-300/80">
          First, review historic revenue below. Then set drivers and assumptions to project Revenue (and subcategories) into forecast years. The Excel preview on the right updates in real time.
        </p>
      </div>

      <CollapsibleSection
        sectionId="projections_revenue_historic"
        title="Historic Revenue (from Historicals)"
        description="Revenue and subcategories as entered in the Historicals step."
        colorClass="blue"
        defaultExpanded={true}
      >
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="pb-2 pr-4 text-xs font-semibold text-slate-300">
                    Line item
                  </th>
                  {historicalYears.map((y) => (
                    <th
                      key={y}
                      className="pb-2 px-2 text-xs font-semibold text-slate-300 text-right"
                    >
                      {y}
                      {unitLabel && (
                        <span className="block text-[10px] font-normal text-slate-500">
                          ({unitLabel})
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {revenueRows.map(({ row, depth }) => {
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-800/60 ${
                        depth === 0 ? "bg-slate-900/40" : ""
                      }`}
                    >
                      <td
                        className="py-2 pr-4 text-xs text-slate-200"
                        style={{ paddingLeft: depth === 0 ? 0 : 20 }}
                      >
                        {depth === 0 ? row.label : `  ${row.label}`}
                      </td>
                      {historicalYears.map((y) => {
                        const stored = computeRowValue(
                          row,
                          y,
                          incomeStatement,
                          incomeStatement,
                          allStatements
                        );
                        const display = storedToDisplay(stored, unit);
                        const formatted =
                          display === 0
                            ? "—"
                            : display.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                                minimumFractionDigits: 0,
                              });
                        return (
                          <td
                            key={y}
                            className="py-2 px-2 text-xs text-slate-200 text-right tabular-nums"
                          >
                            {formatted}
                            {unitLabel && formatted !== "—" ? ` ${unitLabel}` : ""}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        sectionId="projections_revenue_build"
        title="Build Revenue projections"
        description="Set growth drivers or explicit assumptions for projection years."
        colorClass="green"
        defaultExpanded={true}
      >
        <div className="rounded border border-slate-700 bg-slate-900/40 p-4">
          <p className="text-xs text-slate-400">
            Driver-based projection UI will go here (e.g. Revenue growth %, or explicit values by year). For now, projection years are:{" "}
            {projectionYears.length ? projectionYears.join(", ") : "—"}.
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Real-time preview: use the Excel panel on the right to see the full model as you build.
          </p>
        </div>
      </CollapsibleSection>
    </div>
  );
}
