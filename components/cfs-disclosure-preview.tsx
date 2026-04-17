"use client";

import { useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import { findRowInTree } from "@/lib/row-utils";
import { classifyCfsLineForProjection } from "@/lib/cfs-line-classification";
import { isCfsComputedRollupRowId } from "@/lib/cfs-structural-row-ids";
import { applyCfsDisclosureProjectionForYear } from "@/lib/cfs-disclosure-projection";
import { computeRowValue } from "@/lib/calculations";
import type { Row } from "@/types/finance";

function flattenCf(rows: Row[], out: Row[] = []): Row[] {
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) flattenCf(r.children, out);
  }
  return out;
}

export default function CfsDisclosurePreview() {
  const cashFlow = useModelStore((s) => s.cashFlow);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const cfsDisclosureProjectionByRowId = useModelStore((s) => s.cfsDisclosureProjectionByRowId ?? {});
  const meta = useModelStore((s) => s.meta);

  const historicYears = meta?.years?.historical ?? [];
  const projectionYears = meta?.years?.projection ?? [];
  const lastHistYear = historicYears[historicYears.length - 1] ?? null;
  const showYears = useMemo(() => [...historicYears, ...projectionYears], [historicYears, projectionYears]);

  const allStatements = useMemo(
    () => ({
      incomeStatement: incomeStatement ?? [],
      balanceSheet: balanceSheet ?? [],
      cashFlow: cashFlow ?? [],
    }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  const revByYear = useMemo(() => {
    const revRow = incomeStatement?.find((r) => r.id === "rev");
    const m: Record<string, number> = {};
    if (!revRow) return m;
    for (const y of showYears) {
      try {
        m[y] = computeRowValue(revRow, y, incomeStatement ?? [], incomeStatement ?? [], allStatements);
      } catch {
        m[y] = 0;
      }
    }
    return m;
  }, [incomeStatement, showYears, allStatements]);

  const lines = useMemo(() => {
    const flat = flattenCf(cashFlow ?? []);
    return flat.filter(
      (r) =>
        !isCfsComputedRollupRowId(r.id) &&
        classifyCfsLineForProjection(r, balanceSheet ?? []) === "cf_disclosure_only"
    );
  }, [cashFlow, balanceSheet]);

  return (
    <section className="h-full w-full rounded-xl border border-slate-800 bg-slate-950/50 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 p-4 pb-2 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-100">Cash flow disclosure preview</h2>
        <p className="text-xs text-slate-500 mt-1">
          Only issuer disclosure lines (not section totals or net change in cash) appear here. Projection-year values
          follow policies set in the Cash flow disclosure tab and match Projected Statements CFS.
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {lines.length === 0 ? (
          <p className="text-xs text-slate-500">No CF-disclosure-only lines in the current cash flow statement.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[11px]">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-700">
                  <th className="py-2 pr-3">Line</th>
                  <th className="py-2 pr-3">Policy</th>
                  {showYears.map((y) => (
                    <th key={y} className="py-2 px-1 text-right whitespace-nowrap">
                      {y}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {lines.map((row) => {
                  const policy = cfsDisclosureProjectionByRowId[row.id];
                  const policyLabel =
                    policy == null
                      ? "Not set"
                      : policy.mode === "flat_last_historical"
                        ? "Flat last"
                        : policy.mode === "pct_of_revenue"
                          ? `${policy.pct.toFixed(2)}% rev`
                          : policy.mode === "manual_by_year"
                            ? "Manual"
                            : policy.mode === "zero"
                              ? "Zero"
                              : policy.mode === "excluded"
                                ? "Excluded"
                                : "—";
                  const src = findRowInTree(cashFlow ?? [], row.id);
                  const lastActual = lastHistYear ? src?.values?.[lastHistYear] : undefined;
                  return (
                    <tr key={row.id} className="border-b border-slate-800/80">
                      <td className="py-1.5 pr-3 text-slate-200">{row.label}</td>
                      <td className="py-1.5 pr-3 text-slate-400">{policyLabel}</td>
                      {showYears.map((y) => {
                        const isProj = projectionYears.includes(y);
                        let v: number | undefined;
                        if (isProj) {
                          if (!policy) v = undefined;
                          else if (policy.mode === "excluded") v = 0;
                          else {
                            v = applyCfsDisclosureProjectionForYear(
                              policy,
                              y,
                              lastHistYear,
                              revByYear[y],
                              lastActual
                            );
                          }
                        } else {
                          v = src?.values?.[y];
                        }
                        const display = v != null && Number.isFinite(v) ? v : undefined;
                        return (
                          <td key={y} className="py-1.5 px-1 text-right font-mono text-slate-300">
                            {display !== undefined ? display.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
