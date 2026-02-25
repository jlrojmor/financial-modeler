"use client";

import { useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import {
  storedToDisplay,
  getUnitLabel,
  type CurrencyUnit,
} from "@/lib/currency-utils";
import { computeRowValue } from "@/lib/calculations";
import { computeRevenueProjections } from "@/lib/revenue-projection-engine";

function formatAccounting(
  value: number,
  unit: CurrencyUnit,
  showDecimals: boolean = false
): string {
  if (value === 0) return "—";
  const displayValue = storedToDisplay(value, unit);
  const unitLabel = getUnitLabel(unit);
  const decimals = showDecimals ? 2 : 0;
  const formatted = Math.abs(displayValue).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const withUnit = `${formatted}${unitLabel ? ` ${unitLabel}` : ""}`;
  return displayValue < 0 ? `(${withUnit})` : withUnit;
}

/**
 * IS Build tab's own Real-time Excel Preview.
 * Shows only Revenue (and subcategories) with historic years + forecast years.
 * Same look and feel as the main Excel preview. Historic data comes from Historicals.
 */
export default function ISBuildPreview() {
  const meta = useModelStore((s) => s.meta);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns || {});
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns || {});

  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    const proj = meta?.years?.projection ?? [];
    return [...hist, ...proj];
  }, [meta]);

  const allStatements = useMemo(
    () => ({
      incomeStatement: incomeStatement ?? [],
      balanceSheet: balanceSheet ?? [],
      cashFlow: cashFlow ?? [],
    }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  const revenueProjectionConfig = useModelStore((s) => s.revenueProjectionConfig);
  const revenueRows = useMemo(() => {
    const rev = incomeStatement?.find((r) => r.id === "rev");
    if (!rev) return [];
    const list: Array<{ row: Row; depth: number }> = [{ row: rev, depth: 0 }];
    const items = revenueProjectionConfig?.items ?? {};
    (rev.children ?? []).forEach((stream) => {
      list.push({ row: stream, depth: 1 });
      const streamBreakdowns = revenueProjectionConfig?.breakdowns?.[stream.id] ?? [];
      streamBreakdowns.forEach((b) => {
        list.push({
          row: { id: b.id, label: b.label, kind: "input", valueType: "currency", values: {}, children: [] },
          depth: 2,
        });
        const cfg = items[b.id];
        const method = cfg?.method;
        const pl = cfg?.inputs as { items?: Array<{ id?: string; label: string }> } | undefined;
        if ((method === "product_line" || method === "channel") && pl?.items?.length) {
          pl.items.forEach((line, lineIdx) => {
            const raw = line.id ?? line.label;
            const lineKey = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${lineIdx}`;
            list.push({
              row: {
                id: `${b.id}::${lineKey}`,
                label: line.label,
                kind: "input",
                valueType: "currency",
                values: {},
                children: [],
              },
              depth: 3,
            });
          });
        }
      });
      if (streamBreakdowns.length === 0) {
        const cfg = items[stream.id];
        const method = cfg?.method;
        const pl = cfg?.inputs as { items?: Array<{ id?: string; label: string }> } | undefined;
        if ((method === "product_line" || method === "channel") && pl?.items?.length) {
          pl.items.forEach((line, lineIdx) => {
            const raw = line.id ?? line.label;
            const lineKey = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${lineIdx}`;
            list.push({
              row: {
                id: `${stream.id}::${lineKey}`,
                label: line.label,
                kind: "input",
                valueType: "currency",
                values: {},
                children: [],
              },
              depth: 3,
            });
          });
        }
      }
    });
    return list;
  }, [incomeStatement, revenueProjectionConfig]);

  const historicalYears = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const lastHistoricYear = useMemo(
    () => historicalYears[historicalYears.length - 1] ?? "",
    [historicalYears]
  );

  const projectedValues = useMemo(() => {
    if (!incomeStatement?.length || !revenueProjectionConfig?.items || projectionYears.length === 0) {
      return {};
    }
    return computeRevenueProjections(
      incomeStatement,
      revenueProjectionConfig,
      projectionYears,
      lastHistoricYear,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
      (meta?.currencyUnit ?? "millions") as CurrencyUnit
    );
  }, [
    incomeStatement,
    revenueProjectionConfig,
    projectionYears,
    lastHistoricYear,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
    meta?.currencyUnit,
  ]);

  const unit = (meta?.currencyUnit ?? "millions") as CurrencyUnit;
  const showDecimals = false;

  /** Get value for a row in a given year (historic from statements, projection from engine). */
  const getRowValueForYear = useMemo(() => {
    const rev = incomeStatement?.find((r) => r.id === "rev");
    return (rowId: string, year: string, row: Row) => {
      const isHistoric = year.endsWith("A");
      if (isHistoric) {
        if (rowId === "rev") return computeRowValue(rev!, year, incomeStatement ?? [], incomeStatement ?? [], allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
        const isBreakdown = rev?.children?.some((s) => (revenueProjectionConfig?.breakdowns?.[s.id] ?? []).some((b: { id: string }) => b.id === rowId));
        const isSubRow = String(rowId).includes("::");
        if (isBreakdown || isSubRow) return 0;
        return computeRowValue(row, year, incomeStatement ?? [], incomeStatement ?? [], allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
      }
      return projectedValues[rowId]?.[year] ?? 0;
    };
  }, [incomeStatement, revenueProjectionConfig?.breakdowns, projectedValues, allStatements, sbcBreakdowns, danaBreakdowns]);

  /**
   * Methodology: YoY% per year for each line.
   * - Product_line/channel sub-rows (X, Y): show configured growth % every year.
   * - Breakdowns with product_line/channel (e.g. Fixed Price): YoY from sum of children so it matches displayed category growth.
   * - All other rows: YoY from row values.
   */
  const methodologyYoY = useMemo(() => {
    const rows = revenueRows.map(({ row, depth }) => ({ row, depth }));
    const items = revenueProjectionConfig?.items ?? {};
    if (rows.length === 0 || projectionYears.length === 0) return [];
    const orderedYears = [lastHistoricYear, ...projectionYears].filter(Boolean);
    return rows
      .filter(({ row }) => row.id !== "rev")
      .map(({ row, depth }) => {
        const yoyByYear: Record<string, number | null> = {};
        const isSubRow = String(row.id).includes("::");
        let configuredGrowth: number | null = null;
        if (isSubRow) {
          const [parentId, lineKey] = row.id.split("::");
          const cfg = items[parentId];
          const pl = cfg?.inputs as { items?: Array<{ id?: string; label?: string; growthPercent?: number }> } | undefined;
          if (pl?.items?.length && lineKey != null) {
            for (let i = 0; i < pl.items.length; i++) {
              const it = pl.items[i];
              const raw = it.id ?? it.label;
              const key = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${i}`;
              if (key === lineKey && it.growthPercent != null) {
                configuredGrowth = Number(it.growthPercent);
                break;
              }
            }
          }
        }
        if (configuredGrowth != null) {
          projectionYears.forEach((y) => {
            yoyByYear[y] = Math.round(10 * configuredGrowth!) / 10;
          });
        } else {
          // For breakdowns with product_line/channel, use sum of children so Fixed Price YoY = real growth of (X+Y)
          const cfg = items[row.id];
          const method = cfg?.method;
          const pl = cfg?.inputs as { items?: Array<{ id?: string; label?: string }> } | undefined;
          const useSumOfChildren =
            (method === "product_line" || method === "channel") &&
            pl?.items?.length &&
            projectedValues;
          const getVal = (year: string): number => {
            if (useSumOfChildren) {
              let sum = 0;
              pl!.items!.forEach((line, lineIdx) => {
                const raw = line.id ?? line.label;
                const lineKey = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${lineIdx}`;
                sum += projectedValues[`${row.id}::${lineKey}`]?.[year] ?? 0;
              });
              return sum;
            }
            return getRowValueForYear(row.id, year, row);
          };
          for (let i = 0; i < projectionYears.length; i++) {
            const y = projectionYears[i];
            const prevYear = orderedYears[i];
            const currVal = getVal(y);
            const prevVal = prevYear ? getVal(prevYear) : 0;
            if (prevVal > 0) {
              yoyByYear[y] = Math.round(10 * ((currVal - prevVal) / prevVal) * 100) / 10;
            } else {
              yoyByYear[y] = null;
            }
          }
        }
        return { rowId: row.id, label: row.label, depth, yoyByYear };
      });
  }, [revenueRows, projectionYears, lastHistoricYear, getRowValueForYear, revenueProjectionConfig?.items, projectedValues]);

  return (
    <section className="h-full w-full rounded-xl border border-slate-800 bg-slate-950/50 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 p-4 pb-2 border-b border-slate-800">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Real-time Excel Preview
            </h2>
            <p className="text-xs text-slate-500">
              <span className="text-slate-300">IS Build</span>
              {" · "}
              <span className="text-slate-300">{meta?.companyName ?? "—"}</span>
              {" · "}
              <span className="text-slate-300 uppercase">{meta?.modelType ?? "—"}</span>
              {" · "}
              <span className="text-slate-300">{meta?.currency ?? "—"}</span>
              {meta?.currencyUnit && (
                <>
                  {" · "}
                  <span className="text-slate-300">
                    ({getUnitLabel(meta.currencyUnit as CurrencyUnit) ||
                      meta.currencyUnit})
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="text-xs text-slate-500">
            Revenue only · Years:{" "}
            <span className="text-slate-300">{years.length}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-auto p-4">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-950 z-10">
            <tr className="border-b border-slate-800">
              <th className="w-[280px] px-3 py-2 text-left font-semibold text-slate-300">
                Line Item
              </th>
              {years.map((y) => (
                <th
                  key={y}
                  className="px-3 py-2 text-right font-semibold text-slate-400"
                >
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t-4 border-slate-700">
              <td
                colSpan={1 + years.length}
                className="px-3 py-3 bg-slate-900/50"
              >
                <h3 className="text-sm font-bold text-slate-100">
                  Income Statement — Revenue
                </h3>
              </td>
            </tr>
            {revenueRows.length === 0 ? (
              <tr>
                <td
                  colSpan={1 + years.length}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  No Revenue line found. Add Revenue in Historicals or IS structure.
                </td>
              </tr>
            ) : (
              revenueRows.map(({ row, depth }) => {
                const hasChildren =
                  Array.isArray(row.children) && row.children.length > 0;
                const isParentTotal = row.id === "rev" && hasChildren;
                const labelClass = isParentTotal
                  ? "text-slate-200 font-bold"
                  : "text-slate-200";
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-900 hover:bg-slate-900/40 ${
                      isParentTotal ? "border-t-2 border-slate-300" : ""
                    }`}
                  >
                    <td
                      className={`px-3 py-2 ${labelClass}`}
                      style={{ paddingLeft: 12 + depth * 14 }}
                    >
                      {row.label}
                    </td>
                    {years.map((y) => {
                      const isHistoric = y.endsWith("A");
                      let stored = 0;
                      
                      if (isHistoric) {
                        // Breakdown rows and product_line/channel sub-rows exist only in config; no historic split
                        const rev = incomeStatement?.find((r) => r.id === "rev");
                        const isBreakdown = rev?.children?.some((stream) =>
                          (revenueProjectionConfig?.breakdowns?.[stream.id] ?? []).some((b) => b.id === row.id)
                        );
                        const isSubRow = String(row.id).includes("::");
                        if (isBreakdown || isSubRow) {
                          stored = 0; // show — for breakdowns and sub-rows in historic years
                        } else {
                          stored = computeRowValue(
                            row,
                            y,
                            incomeStatement ?? [],
                            incomeStatement ?? [],
                            allStatements,
                            sbcBreakdowns,
                            danaBreakdowns
                          );
                        }
                      } else {
                        stored = projectedValues[row.id]?.[y] ?? 0;
                      }
                      
                      const display =
                        stored === 0 && !isHistoric
                          ? "—"
                          : formatAccounting(stored, unit, showDecimals);
                      return (
                        <td
                          key={y}
                          className="px-3 py-2 text-right text-slate-100 tabular-nums"
                        >
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
            {/* Revenue forecast methodology — YoY % per year per line */}
            {revenueRows.length > 0 && methodologyYoY.length > 0 && (
              <>
                <tr className="border-t-4 border-slate-700">
                  <td
                    colSpan={1 + years.length}
                    className="px-3 py-3 bg-slate-900/50"
                  >
                    <h3 className="text-sm font-bold text-slate-100">
                      Revenue forecast methodology
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      YoY % by line (projection years)
                    </p>
                  </td>
                </tr>
                <tr className="border-b border-slate-800 bg-slate-900/30">
                  <td className="px-3 py-2 text-slate-400 text-xs font-medium">
                    Line
                  </td>
                  {years.map((y) => (
                    <td
                      key={y}
                      className="px-3 py-2 text-right text-slate-400 text-xs font-medium"
                    >
                      {y.endsWith("A") ? "—" : `${y} YoY%`}
                    </td>
                  ))}
                </tr>
                {methodologyYoY.map(({ rowId, label, depth, yoyByYear }) => (
                  <tr
                    key={`method-${rowId}`}
                    className="border-b border-slate-900"
                  >
                    <td
                      className="px-3 py-2 text-slate-400 text-xs"
                      style={{ paddingLeft: 12 + depth * 14 }}
                    >
                      <span className="text-slate-300">{label}</span>
                    </td>
                    {years.map((y) => {
                      const isProj = !y.endsWith("A");
                      const val = isProj ? yoyByYear[y] : null;
                      const display =
                        val != null
                          ? `${val}%`
                          : "—";
                      return (
                        <td
                          key={y}
                          className="px-3 py-2 text-right text-slate-400 text-xs tabular-nums"
                        >
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
