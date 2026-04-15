"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { storedToDisplay, getUnitLabel, type CurrencyUnit } from "@/lib/currency-utils";
import { computeProjectedRevCogs, computeProjectedEbitByYear } from "@/lib/projected-ebit";
import { ChevronDown, ChevronRight, CheckCircle2, AlertCircle } from "lucide-react";

function flattenRows(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) out.push(...flattenRows(r.children));
  }
  return out;
}

type RowStyle = "header" | "line" | "subtotal" | "total" | "margin" | "spacer";

interface PreviewRow {
  id: string;
  label: string;
  style: RowStyle;
  indent: number;
  values: Record<string, number>;
  isProjected?: boolean;
}

function fmt(value: number | undefined | null, unit: CurrencyUnit, showDecimals: boolean): string {
  if (value == null || value === 0) return "—";
  const dv = storedToDisplay(value, unit);
  const ul = getUnitLabel(unit);
  const dec = showDecimals ? 1 : 0;
  const abs = Math.abs(dv).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const s = `${abs}${ul ? ` ${ul}` : ""}`;
  return dv < 0 ? `(${s})` : s;
}

function fmtPct(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function findRowByTaxonomy(flat: Row[], tt: string): Row | undefined {
  return flat.find((r) => r.taxonomyType === tt);
}

function findRowById(flat: Row[], id: string): Row | undefined {
  return flat.find((r) => r.id === id);
}

function getVal(row: Row | undefined, year: string): number {
  return row?.values?.[year] ?? 0;
}

export default function ProjectedStatementsPreview() {
  const meta = useModelStore((s) => s.meta);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns ?? {});
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns ?? {});
  const revenueForecastConfigV1 = useModelStore((s) => s.revenueForecastConfigV1);
  const revenueForecastTreeV1 = useModelStore((s) => s.revenueForecastTreeV1 ?? []);
  const revenueProjectionConfig = useModelStore((s) => s.revenueProjectionConfig);
  const cogsForecastConfigV1 = useModelStore((s) => s.cogsForecastConfigV1);
  const opexForecastConfigV1 = useModelStore((s) => s.opexForecastConfigV1);
  const applyProjections = useModelStore((s) => s.applyBsBuildProjectionsToModel);

  const [showDecimals, setShowDecimals] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  // Ensure all projection values are written to IS/BS/CFS rows when this tab renders
  const hasApplied = useRef(false);
  useEffect(() => {
    if (!hasApplied.current && (meta?.years?.projection?.length ?? 0) > 0) {
      hasApplied.current = true;
      applyProjections();
    }
  }, [applyProjections, meta?.years?.projection?.length]);

  const unit = (meta?.currencyUnit ?? "millions") as CurrencyUnit;
  const historicalYears = meta?.years?.historical ?? [];
  const projectionYears = meta?.years?.projection ?? [];
  const lastHistYear = historicalYears[historicalYears.length - 1] ?? "";
  const allYears = [...historicalYears, ...projectionYears];
  const showYears = lastHistYear ? [lastHistYear, ...projectionYears] : projectionYears;

  const allStatements = useMemo(
    () => ({ incomeStatement, balanceSheet, cashFlow }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  // Revenue + COGS projected values
  const { revByYear, cogsByYear } = useMemo(() => {
    if (!lastHistYear || projectionYears.length === 0) return { revByYear: {} as Record<string, number>, cogsByYear: {} as Record<string, number> };
    return computeProjectedRevCogs({
      incomeStatement,
      projectionYears,
      lastHistoricYear: lastHistYear,
      revenueForecastConfigV1,
      revenueForecastTreeV1,
      revenueProjectionConfig,
      cogsForecastConfigV1,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
      currencyUnit: unit,
    });
  }, [incomeStatement, projectionYears, lastHistYear, revenueForecastConfigV1, revenueForecastTreeV1, revenueProjectionConfig, cogsForecastConfigV1, allStatements, sbcBreakdowns, danaBreakdowns, unit]);

  // EBIT projected
  const ebitByYear = useMemo(() => {
    if (!lastHistYear || projectionYears.length === 0) return {} as Record<string, number | null>;
    return computeProjectedEbitByYear({
      incomeStatement,
      projectionYears,
      lastHistoricYear: lastHistYear,
      revenueForecastConfigV1,
      revenueForecastTreeV1,
      revenueProjectionConfig,
      cogsForecastConfigV1,
      opexForecastConfigV1,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
      currencyUnit: unit,
    });
  }, [incomeStatement, projectionYears, lastHistYear, revenueForecastConfigV1, revenueForecastTreeV1, revenueProjectionConfig, cogsForecastConfigV1, opexForecastConfigV1, allStatements, sbcBreakdowns, danaBreakdowns, unit]);

  const flatIs = useMemo(() => flattenRows(incomeStatement ?? []), [incomeStatement]);
  const flatBs = useMemo(() => flattenRows(balanceSheet ?? []), [balanceSheet]);

  // ── Build IS preview rows ──────────────────────────────────────────────────
  const isRows = useMemo((): PreviewRow[] => {
    const rows: PreviewRow[] = [];

    const revRow = findRowById(flatIs, "rev");
    const cogsRow = findRowById(flatIs, "cogs");
    const gpRow = flatIs.find((r) => r.taxonomyType === "calc_gross_profit" || r.id === "gross_profit");
    const sgaRow = findRowById(flatIs, "sga") ?? flatIs.find((r) => r.taxonomyType === "opex_sga");
    const opexParent = findRowById(flatIs, "operating_expenses");
    const ebitRow = flatIs.find((r) => r.taxonomyType === "calc_ebit" || r.id === "ebit");
    const intExpRow = findRowByTaxonomy(flatIs, "non_op_interest_expense") ?? findRowById(flatIs, "interest_expense");
    const intIncRow = findRowByTaxonomy(flatIs, "non_op_interest_income") ?? findRowById(flatIs, "interest_income");
    const ebtRow = flatIs.find((r) => r.taxonomyType === "calc_ebt" || r.id === "ebt");
    const taxRow = findRowByTaxonomy(flatIs, "tax_expense") ?? findRowById(flatIs, "tax");
    const niRow = flatIs.find((r) => r.taxonomyType === "calc_net_income" || r.id === "net_income");

    const makeValues = (row: Row | undefined, override?: Record<string, number>): Record<string, number> => {
      const v: Record<string, number> = {};
      for (const y of showYears) {
        if (override && override[y] !== undefined) v[y] = override[y];
        else v[y] = getVal(row, y);
      }
      return v;
    };

    // Revenue
    const revValues: Record<string, number> = {};
    for (const y of showYears) {
      revValues[y] = projectionYears.includes(y) && revByYear[y] != null ? revByYear[y] : getVal(revRow, y);
    }
    rows.push({ id: "rev", label: "Revenue", style: "line", indent: 0, values: revValues, isProjected: true });

    // COGS
    const cogsValues: Record<string, number> = {};
    for (const y of showYears) {
      cogsValues[y] = projectionYears.includes(y) && cogsByYear[y] != null ? cogsByYear[y] : getVal(cogsRow, y);
    }
    rows.push({ id: "cogs", label: "Cost of Goods Sold (COGS)", style: "line", indent: 0, values: cogsValues, isProjected: true });

    // Gross Profit = Revenue - COGS (both stored as positive amounts)
    const gpValues: Record<string, number> = {};
    for (const y of showYears) gpValues[y] = (revValues[y] ?? 0) - Math.abs(cogsValues[y] ?? 0);
    rows.push({ id: "gross_profit", label: "Gross Profit", style: "subtotal", indent: 0, values: gpValues });

    // Gross Margin %
    const gmValues: Record<string, number> = {};
    for (const y of showYears) gmValues[y] = revValues[y] ? gpValues[y] / revValues[y] : 0;
    rows.push({ id: "gross_margin", label: "Gross Margin %", style: "margin", indent: 0, values: gmValues });

    rows.push({ id: "spacer_1", label: "", style: "spacer", indent: 0, values: {} });

    // Operating Expenses — collect children
    const opexChildren = opexParent?.children ?? [];
    if (opexChildren.length > 0) {
      for (const child of opexChildren) {
        if (child.kind === "total" || child.kind === "subtotal" || child.kind === "calc") continue;
        if (child.id.startsWith("total_")) continue;
        const childFlat = flattenRows([child]);
        for (const leaf of childFlat) {
          if (leaf.kind === "total" || leaf.kind === "subtotal" || leaf.kind === "calc") continue;
          if (leaf.id.startsWith("total_")) continue;
          rows.push({
            id: leaf.id,
            label: leaf.label ?? leaf.id,
            style: "line",
            indent: 1,
            values: makeValues(leaf),
            isProjected: projectionYears.some((y) => getVal(leaf, y) !== 0),
          });
        }
      }
    } else if (sgaRow) {
      rows.push({
        id: sgaRow.id,
        label: sgaRow.label ?? "SG&A",
        style: "line",
        indent: 1,
        values: makeValues(sgaRow),
        isProjected: projectionYears.some((y) => getVal(sgaRow, y) !== 0),
      });
    }

    // EBIT
    const ebitValues: Record<string, number> = {};
    for (const y of showYears) {
      ebitValues[y] = projectionYears.includes(y) && ebitByYear[y] != null ? (ebitByYear[y] ?? 0) : getVal(ebitRow, y);
    }
    rows.push({ id: "ebit", label: "EBIT (Operating Income)", style: "total", indent: 0, values: ebitValues });

    // EBIT Margin %
    const emValues: Record<string, number> = {};
    for (const y of showYears) emValues[y] = revValues[y] ? ebitValues[y] / revValues[y] : 0;
    rows.push({ id: "ebit_margin", label: "EBIT Margin %", style: "margin", indent: 0, values: emValues });

    rows.push({ id: "spacer_2", label: "", style: "spacer", indent: 0, values: {} });

    // Non-operating items
    if (intExpRow) rows.push({ id: intExpRow.id, label: "Interest Expense", style: "line", indent: 1, values: makeValues(intExpRow), isProjected: projectionYears.some((y) => getVal(intExpRow, y) !== 0) });
    if (intIncRow) rows.push({ id: intIncRow.id, label: "Interest Income", style: "line", indent: 1, values: makeValues(intIncRow), isProjected: projectionYears.some((y) => getVal(intIncRow, y) !== 0) });

    // Other non-operating lines
    const nonOpLines = flatIs.filter((r) => {
      const tt = r.taxonomyType as string | undefined;
      if (!tt?.startsWith("non_op_")) return false;
      if (tt === "non_op_interest_expense" || tt === "non_op_interest_income") return false;
      if (r.kind === "total" || r.kind === "subtotal" || r.kind === "calc") return false;
      return true;
    });
    for (const r of nonOpLines) {
      rows.push({ id: r.id, label: r.label ?? r.id, style: "line", indent: 1, values: makeValues(r), isProjected: projectionYears.some((y) => getVal(r, y) !== 0) });
    }

    // EBT — declare outside block so NI can reference it
    const ebtValues: Record<string, number> = {};
    if (ebtRow) {
      for (const y of showYears) {
        if (projectionYears.includes(y)) {
          let ebt = ebitValues[y] ?? 0;
          if (intExpRow) ebt -= Math.abs(getVal(intExpRow, y));
          if (intIncRow) ebt += getVal(intIncRow, y);
          for (const r of nonOpLines) ebt += getVal(r, y);
          ebtValues[y] = ebt;
        } else {
          ebtValues[y] = getVal(ebtRow, y);
        }
      }
      rows.push({ id: "ebt", label: "EBT (Earnings Before Tax)", style: "subtotal", indent: 0, values: ebtValues });
    }

    // Tax
    if (taxRow) rows.push({ id: taxRow.id, label: "Income Tax Expense", style: "line", indent: 1, values: makeValues(taxRow), isProjected: projectionYears.some((y) => getVal(taxRow, y) !== 0) });

    // Net Income = EBT − |Tax|
    if (niRow && ebtRow) {
      const niValues: Record<string, number> = {};
      for (const y of showYears) {
        if (projectionYears.includes(y)) {
          const ebt = ebtValues[y] ?? 0;
          const tax = taxRow ? Math.abs(getVal(taxRow, y)) : 0;
          niValues[y] = ebt - tax;
        } else {
          niValues[y] = getVal(niRow, y);
        }
      }
      rows.push({ id: "net_income", label: "Net Income", style: "total", indent: 0, values: niValues });

      // NI Margin
      const nimValues: Record<string, number> = {};
      for (const y of showYears) nimValues[y] = revValues[y] ? niValues[y] / revValues[y] : 0;
      rows.push({ id: "ni_margin", label: "Net Income Margin %", style: "margin", indent: 0, values: nimValues });
    }

    return rows;
  }, [flatIs, showYears, projectionYears, revByYear, cogsByYear, ebitByYear]);

  // ── Build BS preview rows ──────────────────────────────────────────────────
  const bsRows = useMemo((): PreviewRow[] => {
    const rows: PreviewRow[] = [];

    const makeV = (row: Row): Record<string, number> => {
      const v: Record<string, number> = {};
      for (const y of showYears) v[y] = getVal(row, y);
      return v;
    };

    // Walk the actual BS tree structure to preserve all rows in their natural order
    const walkBs = (bsRows: Row[], depth: number) => {
      for (const row of bsRows) {
        const isTotal = row.kind === "total" || row.id.startsWith("total_");
        const isSubtotal = row.kind === "subtotal";
        const isCalc = row.kind === "calc";
        const isSection = (row.children?.length ?? 0) > 0 && !isTotal && !isSubtotal;

        if (isSection) {
          // Section header (e.g., "Current assets", "Fixed assets")
          rows.push({ id: `hdr_${row.id}`, label: row.label ?? row.id, style: "header", indent: depth, values: {} });
          walkBs(row.children!, depth + 1);
        } else if (isTotal || isSubtotal) {
          const style: RowStyle = row.id === "total_assets" || row.id === "total_liab_and_equity" || row.id === "total_liabilities_equity"
            ? "total" : "subtotal";
          rows.push({ id: row.id, label: row.label ?? row.id, style, indent: depth, values: makeV(row) });
          if (row.id === "total_current_assets" || row.id === "total_assets" ||
              row.id === "total_current_liabilities" || row.id === "total_liabilities" ||
              row.id === "total_equity") {
            rows.push({ id: `spacer_${row.id}`, label: "", style: "spacer", indent: 0, values: {} });
          }
        } else if (isCalc) {
          // Skip pure calculation rows in the BS
        } else {
          rows.push({
            id: row.id,
            label: row.label ?? row.id,
            style: "line",
            indent: depth,
            values: makeV(row),
            isProjected: projectionYears.some((y) => getVal(row, y) !== 0),
          });
        }
      }
    };

    walkBs(balanceSheet ?? [], 0);
    return rows;
  }, [balanceSheet, showYears, projectionYears]);

  // ── BS balance check ───────────────────────────────────────────────────────
  const bsCheck = useMemo(() => {
    const ta = findRowById(flatBs, "total_assets");
    // Try both common IDs for the L+E total
    const tle = findRowById(flatBs, "total_liab_and_equity") ?? findRowById(flatBs, "total_liabilities_equity");
    const results: { year: string; diff: number }[] = [];
    for (const y of showYears) {
      const a = getVal(ta, y);
      const le = getVal(tle, y);
      results.push({ year: y, diff: Math.round(a - le) });
    }
    return results;
  }, [flatBs, showYears]);

  // ── Build CFS preview rows ────────────────────────────────────────────────
  const cfsRows = useMemo((): PreviewRow[] => {
    const rows: PreviewRow[] = [];

    const makeV = (row: Row): Record<string, number> => {
      const v: Record<string, number> = {};
      for (const y of showYears) v[y] = getVal(row, y);
      return v;
    };

    const walkCfs = (cfsRows: Row[], depth: number) => {
      for (const row of cfsRows) {
        const isTotal = row.kind === "total" || row.id.startsWith("total_");
        const isSubtotal = row.kind === "subtotal";
        const isCalc = row.kind === "calc";
        const isSection = (row.children?.length ?? 0) > 0 && !isTotal && !isSubtotal;

        if (isSection) {
          rows.push({ id: `hdr_${row.id}`, label: row.label ?? row.id, style: "header", indent: depth, values: {} });
          walkCfs(row.children!, depth + 1);
        } else if (isTotal || isSubtotal) {
          const isMainTotal = row.id === "total_operating_cf" || row.id === "total_investing_cf" ||
                              row.id === "total_financing_cf" || row.id === "net_cash_change" ||
                              row.id === "total_cash_change";
          rows.push({ id: row.id, label: row.label ?? row.id, style: isMainTotal ? "total" : "subtotal", indent: depth, values: makeV(row) });
          if (isMainTotal) {
            rows.push({ id: `spacer_${row.id}`, label: "", style: "spacer", indent: 0, values: {} });
          }
        } else if (isCalc) {
          rows.push({ id: row.id, label: row.label ?? row.id, style: "subtotal", indent: depth, values: makeV(row) });
        } else {
          rows.push({
            id: row.id,
            label: row.label ?? row.id,
            style: "line",
            indent: depth,
            values: makeV(row),
            isProjected: projectionYears.some((y) => getVal(row, y) !== 0),
          });
        }
      }
    };

    walkCfs(cashFlow ?? [], 0);
    return rows;
  }, [cashFlow, showYears, projectionYears]);

  const toggle = (sectionId: string) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  // ── Section renderer ───────────────────────────────────────────────────────
  const renderSection = (title: string, sectionId: string, sectionRows: PreviewRow[], accent: string) => {
    const collapsed = collapsedSections[sectionId] ?? false;
    return (
      <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 overflow-hidden">
        <button
          type="button"
          onClick={() => toggle(sectionId)}
          className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/50 border-b border-slate-700/40 hover:bg-slate-800/70 transition-colors"
        >
          <div className="flex items-center gap-2">
            {collapsed ? <ChevronRight size={14} className={accent} /> : <ChevronDown size={14} className={accent} />}
            <span className={`text-[11px] font-bold ${accent}`}>{title}</span>
          </div>
          <span className="text-[9px] text-slate-500">{sectionRows.filter((r) => r.style !== "spacer").length} items</span>
        </button>
        {!collapsed && (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left py-1.5 px-3 text-slate-500 font-medium sticky left-0 bg-slate-900/95 min-w-[160px]">Line Item</th>
                  {showYears.map((y) => (
                    <th
                      key={y}
                      className={`text-right py-1.5 px-2 font-medium whitespace-nowrap min-w-[90px] ${
                        projectionYears.includes(y) ? "text-blue-400" : "text-slate-400"
                      }`}
                    >
                      {y}{projectionYears.includes(y) ? "E" : "A"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectionRows.map((row) => {
                  if (row.style === "spacer") return <tr key={row.id}><td colSpan={showYears.length + 1} className="h-2" /></tr>;

                  const isHeader = row.style === "header";
                  const isTotal = row.style === "total";
                  const isSubtotal = row.style === "subtotal";
                  const isMargin = row.style === "margin";
                  const isBold = isTotal || isSubtotal;

                  if (isHeader) {
                    return (
                      <tr key={row.id} className="border-b border-slate-700/30">
                        <td
                          colSpan={showYears.length + 1}
                          className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-wider text-slate-500"
                          style={{ paddingLeft: `${12 + row.indent * 16}px` }}
                        >
                          {row.label}
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-800/40 ${
                        isTotal ? "bg-slate-800/30" : isSubtotal ? "bg-slate-800/15" : ""
                      }`}
                    >
                      <td
                        className={`py-1 px-3 sticky left-0 bg-inherit ${
                          isBold ? "font-semibold text-slate-100" : isMargin ? "italic text-slate-500" : "text-slate-300"
                        }`}
                        style={{ paddingLeft: `${12 + row.indent * 16}px` }}
                      >
                        {row.label}
                      </td>
                      {showYears.map((y) => {
                        const v = row.values[y];
                        const isProj = projectionYears.includes(y);
                        return (
                          <td
                            key={y}
                            className={`py-1 px-2 text-right tabular-nums whitespace-nowrap ${
                              isBold ? "font-semibold text-slate-100" : isMargin ? "italic text-slate-500" :
                              isProj ? "text-blue-300" : "text-slate-300"
                            } ${isTotal ? "border-t border-slate-600/50" : ""}`}
                          >
                            {isMargin ? fmtPct(v) : fmt(v, unit, showDecimals)}
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
    );
  };

  if (showYears.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <AlertCircle size={24} className="mx-auto text-amber-400 mb-2" />
          <p className="text-sm text-slate-300">No projection years configured.</p>
        </div>
      </div>
    );
  }

  const allBalanced = bsCheck.every((c) => Math.abs(c.diff) < 1);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-950/50 rounded-lg border border-slate-700/50">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-700/50 bg-slate-900/60">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-100">Projected Financial Statements</h2>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {meta?.companyName ?? "Company"} · {meta?.companyType ?? "Public"} · {meta?.currency ?? "USD"} · ({getUnitLabel(unit)})
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showDecimals}
                onChange={(e) => setShowDecimals(e.target.checked)}
                className="w-3 h-3 rounded border-slate-600 bg-slate-800 text-blue-500"
              />
              Decimals
            </label>
          </div>
        </div>
      </div>

      {/* Balance Check Banner */}
      <div className={`shrink-0 px-4 py-2 flex items-center gap-2 border-b ${
        allBalanced ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"
      }`}>
        {allBalanced ? (
          <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
        ) : (
          <AlertCircle size={14} className="text-red-400 shrink-0" />
        )}
        <span className={`text-[10px] font-medium ${allBalanced ? "text-emerald-300" : "text-red-300"}`}>
          {allBalanced
            ? "BS Check: A = L + E across all years ✓"
            : `BS Check: A ≠ L + E — imbalance in ${bsCheck.filter((c) => Math.abs(c.diff) >= 1).map((c) => c.year).join(", ")}`}
        </span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {renderSection("Income Statement", "is", isRows, "text-emerald-400")}
        {renderSection("Balance Sheet", "bs", bsRows, "text-blue-400")}
        {renderSection("Cash Flow Statement", "cfs", cfsRows, "text-violet-400")}
      </div>
    </div>
  );
}
