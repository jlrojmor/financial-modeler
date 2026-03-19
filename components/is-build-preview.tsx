"use client";

import { useMemo, useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import {
  storedToDisplay,
  getUnitLabel,
  type CurrencyUnit,
} from "@/lib/currency-utils";
import { computeRowValue } from "@/lib/calculations";
import { findRowInTree } from "@/lib/row-utils";
import { computeRevenueProjections } from "@/lib/revenue-projection-engine";
import { computeRevenueProjectionsV1 } from "@/lib/revenue-projection-engine-v1";
import type { ForecastRevenueNodeV1 } from "@/types/revenue-forecast-v1";
import { getSbcDisclosures, getTotalSbcByYearFromEmbedded } from "@/lib/embedded-disclosure-sbc";
import { getAmortizationDisclosures, getTotalAmortizationByYearFromEmbedded } from "@/lib/embedded-disclosure-amortization";
import { getDepreciationDisclosures, getTotalDepreciationByYearFromEmbedded } from "@/lib/embedded-disclosure-depreciation";
import { getRestructuringDisclosures, getTotalRestructuringByYearFromEmbedded } from "@/lib/embedded-disclosure-restructuring";

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
  const embeddedDisclosures = useModelStore((s) => s.embeddedDisclosures ?? []);
  const sbcDisclosureEnabled = useModelStore((s) => s.sbcDisclosureEnabled ?? true);

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
  const revenueForecastConfigV1 = useModelStore((s) => s.revenueForecastConfigV1);
  const revenueForecastTreeV1 = useModelStore((s) => s.revenueForecastTreeV1 ?? []);
  const cogsPctByRevenueLine = useModelStore((s) => s.cogsPctByRevenueLine ?? {});
  const cogsPctModeByRevenueLine = useModelStore((s) => s.cogsPctModeByRevenueLine ?? {});
  const cogsPctByRevenueLineByYear = useModelStore((s) => s.cogsPctByRevenueLineByYear ?? {});
  const sgaPctByItemId = useModelStore((s) => s.sgaPctByItemId ?? {});
  const sgaPctModeByItemId = useModelStore((s) => s.sgaPctModeByItemId ?? {});
  const sgaPctByItemIdByYear = useModelStore((s) => s.sgaPctByItemIdByYear ?? {});
  const sgaPctOfParentByItemId = useModelStore((s) => s.sgaPctOfParentByItemId ?? {});
  const sgaPctOfParentModeByItemId = useModelStore((s) => s.sgaPctOfParentModeByItemId ?? {});
  const sgaPctOfParentByItemIdByYear = useModelStore((s) => s.sgaPctOfParentByItemIdByYear ?? {});

  const revenueRows = useMemo(() => {
    const rev = incomeStatement?.find((r) => r.id === "rev");
    if (!rev) return [];
    const list: Array<{ row: Row; depth: number }> = [{ row: rev, depth: 0 }];
    if (revenueForecastTreeV1.length > 0) {
      const findSrc = (rows: Row[], id: string): Row | null => {
        for (const r of rows) {
          if (r.id === id) return r;
          if (r.children?.length) {
            const f = findSrc(r.children, id);
            if (f) return f;
          }
        }
        return null;
      };
      /** Preview depth = DFS position in revenueForecastTreeV1 only: rev = 0, forest roots = 1, then +1 per tree level. */
      const walkTree = (nodes: ForecastRevenueNodeV1[], treeDepth: number) => {
        for (const n of nodes) {
          const src = findSrc(incomeStatement ?? [], n.id);
          list.push({
            row: {
              id: n.id,
              label: n.label,
              kind: (src?.kind as Row["kind"]) ?? "input",
              valueType: "currency",
              values: src?.values ? { ...src.values } : {},
              children: [],
            },
            depth: treeDepth,
          });
          walkTree(n.children, treeDepth + 1);
        }
      };
      walkTree(revenueForecastTreeV1, 1);
      return list;
    }
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
  }, [incomeStatement, revenueProjectionConfig, revenueForecastTreeV1]);

  // UI state: section and row expansion (visual only, does not affect calculations or Excel export)
  const [revenueSectionOpen, setRevenueSectionOpen] = useState(true);
  const [revenueCogsSectionOpen, setRevenueCogsSectionOpen] = useState(true);
  const [revenueMethodSectionOpen, setRevenueMethodSectionOpen] = useState(true);
  const [cogsMethodSectionOpen, setCogsMethodSectionOpen] = useState(true);
  const [sgaSectionOpen, setSgaSectionOpen] = useState(true);
  const [sgaMethodSectionOpen, setSgaMethodSectionOpen] = useState(true);
  const [collapsedRowIds, setCollapsedRowIds] = useState<Set<string>>(new Set());

  const historicalYears = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const lastHistoricYear = useMemo(
    () => historicalYears[historicalYears.length - 1] ?? "",
    [historicalYears]
  );
  /** Forecast years in the same order as preview columns (must match `years` E-columns for methodology YoY). */
  const methodologyProjectionYears = useMemo(() => years.filter((y) => y.endsWith("E")), [years]);

  const projectedValues = useMemo(() => {
    if (!incomeStatement?.length || projectionYears.length === 0) return {};
    const v1Config = revenueForecastConfigV1 ?? { rows: {} };
    const v1HasRows = Object.keys(v1Config.rows ?? {}).length > 0;
    if (v1HasRows) {
      const { result, valid } = computeRevenueProjectionsV1(
        incomeStatement,
        revenueForecastTreeV1,
        v1Config,
        projectionYears,
        lastHistoricYear,
        allStatements,
        sbcBreakdowns ?? {},
        danaBreakdowns ?? {}
      );
      if (valid && Object.keys(result).length > 0) return result;
    }
    if (!revenueProjectionConfig?.items || Object.keys(revenueProjectionConfig.items).length === 0) return {};
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
    revenueForecastConfigV1,
    revenueForecastTreeV1,
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

  /** COGS % for a line in a given year: constant or custom per year */
  const getCogsPctForLineYear = useMemo(() => {
    return (lineId: string, year: string): number => {
      const mode = cogsPctModeByRevenueLine[lineId] ?? "constant";
      if (mode === "custom") {
        const pct = cogsPctByRevenueLineByYear[lineId]?.[year];
        if (pct != null) return pct;
      }
      return cogsPctByRevenueLine[lineId] ?? 0;
    };
  }, [cogsPctModeByRevenueLine, cogsPctByRevenueLineByYear, cogsPctByRevenueLine]);

  /** Leaf revenue lines for COGS breakdown (same order as revenue table, excluding rev) */
  const leafRevenueLinesForCogs = useMemo(
    () => revenueRows.filter((r) => r.row.id !== "rev").map((r) => ({ id: r.row.id, label: r.row.label, depth: r.depth })),
    [revenueRows]
  );

  /** COGS by line by year: lineId -> year -> stored value (revenue × COGS %) */
  const cogsByLineByYear = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    if (!projectedValues) return out;
    for (const { id: lineId } of leafRevenueLinesForCogs) {
      out[lineId] = {};
      for (const y of years) {
        const rev = y.endsWith("A") ? 0 : (projectedValues[lineId]?.[y] ?? 0);
        const pct = getCogsPctForLineYear(lineId, y);
        out[lineId][y] = rev * (pct / 100);
      }
    }
    return out;
  }, [leafRevenueLinesForCogs, years, projectedValues, getCogsPctForLineYear]);

  /** Total COGS per year: projection years from sum of line COGS; historical from IS cogs row */
  const projectedCogsByYear = useMemo(() => {
    const cogsRow = incomeStatement ? findRowInTree(incomeStatement, "cogs") : null;
    const out: Record<string, number> = {};
    for (const y of years) {
      if (y.endsWith("E") && Object.keys(cogsByLineByYear).length > 0) {
        let total = 0;
        for (const lineId of Object.keys(cogsByLineByYear)) {
          total += cogsByLineByYear[lineId]?.[y] ?? 0;
        }
        out[y] = total;
      } else {
        out[y] = cogsRow?.values?.[y] ?? 0;
      }
    }
    return out;
  }, [years, cogsByLineByYear, incomeStatement]);

  /** Revenue total per year (for COGS section) */
  const revenueTotalByYear = useMemo(() => {
    const rev = incomeStatement?.find((r) => r.id === "rev");
    const out: Record<string, number> = {};
    for (const y of years) {
      if (y.endsWith("A") && rev) {
        out[y] = computeRowValue(rev, y, incomeStatement ?? [], incomeStatement ?? [], allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
      } else {
        out[y] = projectedValues["rev"]?.[y] ?? 0;
      }
    }
    return out;
  }, [years, incomeStatement, projectedValues, allStatements, sbcBreakdowns, danaBreakdowns]);

  /**
   * Revenue preview: historic = always from Income Statement via computeRowValue (canonical row in tree when present).
   * Forecast = projectedValues only. No special-casing by row type for actuals.
   */
  const getRowValueForYear = useMemo(() => {
    const rev = incomeStatement?.find((r) => r.id === "rev");
    const is = incomeStatement ?? [];
    return (rowId: string, year: string, row: Row) => {
      const isHistoric = year.endsWith("A");
      if (isHistoric) {
        if (rowId === "rev") {
          return computeRowValue(rev!, year, is, is, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
        }
        const canonical = findRowInTree(is, rowId) ?? row;
        return computeRowValue(canonical, year, is, is, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
      }
      return projectedValues[rowId]?.[year] ?? 0;
    };
  }, [incomeStatement, projectedValues, allStatements, sbcBreakdowns, danaBreakdowns]);

  /**
   * Methodology YoY%: unified for every revenue row (preview only).
   * - Iteration order = `methodologyProjectionYears` from full `years` list so the first E column (e.g. 2026E) always
   *   bridges to `lastHistoricYear`, regardless of order inside `meta.years.projection`.
   * - curr: projected value for that column (coerced with Number(); not gated on typeof === "number").
   * - first E column: prev = last historical actual via getRowValueForYear (never projectedValues).
   * - later E columns: prev = projected value for the immediately prior E column in this same order.
   */
  const methodologyYoY = useMemo(() => {
    const rows = revenueRows.map(({ row, depth }) => ({ row, depth }));
    if (rows.length === 0 || methodologyProjectionYears.length === 0) return [];

    const readProjected = (rowId: string, yKey: string): number | null => {
      const raw = projectedValues[rowId]?.[yKey];
      if (raw === undefined || raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

    return rows.map(({ row, depth }) => {
      const yoyByYear: Record<string, number | null> = {};
      for (let i = 0; i < methodologyProjectionYears.length; i++) {
        const y = methodologyProjectionYears[i]!;
        const currVal = readProjected(row.id, y);
        let prevVal: number | null;
        if (i === 0) {
          const ly = lastHistoricYear;
          if (!ly) prevVal = null;
          else {
            const p = getRowValueForYear(row.id, ly, row);
            prevVal = Number.isFinite(p) ? p : null;
          }
        } else {
          const py = methodologyProjectionYears[i - 1]!;
          prevVal = readProjected(row.id, py);
        }
        if (
          prevVal != null &&
          prevVal !== 0 &&
          currVal != null &&
          Number.isFinite(currVal)
        ) {
          yoyByYear[y] = Math.round(10 * ((currVal / prevVal - 1) * 100)) / 10;
        } else {
          yoyByYear[y] = null;
        }
      }
      return { rowId: row.id, label: row.label, depth, yoyByYear };
    });
  }, [revenueRows, methodologyProjectionYears, lastHistoricYear, getRowValueForYear, projectedValues]);

  /** SG&A: flattened rows under sga (with depth); leaves have no children */
  const sgaRowsFlat = useMemo(() => {
    const sgaRow = incomeStatement ? findRowInTree(incomeStatement, "sga") : null;
    if (!sgaRow?.children?.length) return [];
    const out: Array<{ row: Row; depth: number }> = [];
    function walk(rows: Row[], depth: number) {
      for (const r of rows) {
        out.push({ row: r, depth });
        if (r.children?.length) walk(r.children, depth + 1);
      }
    }
    walk(sgaRow.children, 0);
    return out;
  }, [incomeStatement]);

  /** SG&A % of revenue for a top-level item in a given year */
  const getSgaPctForItemYear = useMemo(() => {
    return (itemId: string, year: string): number => {
      const mode = sgaPctModeByItemId[itemId] ?? "constant";
      if (mode === "custom") {
        const pct = sgaPctByItemIdByYear[itemId]?.[year];
        if (pct != null) return pct;
      }
      return sgaPctByItemId[itemId] ?? 0;
    };
  }, [sgaPctModeByItemId, sgaPctByItemIdByYear, sgaPctByItemId]);

  /** SG&A % of parent for a sub-item in a given year */
  const getSgaPctOfParentForItemYear = useMemo(() => {
    return (itemId: string, year: string): number => {
      const mode = sgaPctOfParentModeByItemId[itemId] ?? "constant";
      if (mode === "custom") {
        const pct = sgaPctOfParentByItemIdByYear[itemId]?.[year];
        if (pct != null) return pct;
      }
      return sgaPctOfParentByItemId[itemId] ?? 0;
    };
  }, [sgaPctOfParentModeByItemId, sgaPctOfParentByItemIdByYear, sgaPctOfParentByItemId]);

  /** SG&A leaf rows (no children) */
  const sgaLeaves = useMemo(
    () => sgaRowsFlat.filter(({ row }) => !row.children?.length).map(({ row, depth }) => ({ id: row.id, label: row.label, depth })),
    [sgaRowsFlat]
  );

  /** SG&A value by row id by year. Top-level: revenue × % of revenue (or sum of children for display). Sub-items: parent × % of parent. */
  const projectedSgaByRowIdByYear = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    const sgaRow = incomeStatement ? findRowInTree(incomeStatement, "sga") : null;
    if (!sgaRow?.children?.length) return out;

    function setHistoricForRow(row: Row): void {
      out[row.id] = out[row.id] ?? {};
      for (const y of years) {
        if (!y.endsWith("A")) continue;
        out[row.id][y] = computeRowValue(row, y, incomeStatement ?? [], incomeStatement ?? [], allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
      }
      row.children?.forEach((c) => setHistoricForRow(c));
    }
    function setProjectionForRow(row: Row, depth: number, parentValueByYear: Record<string, number> | null): void {
      out[row.id] = out[row.id] ?? {};
      for (const y of years) {
        if (y.endsWith("A")) continue;
        const rev = revenueTotalByYear[y] ?? 0;
        if (depth === 0) {
          const pct = getSgaPctForItemYear(row.id, y);
          out[row.id][y] = rev * (pct / 100);
        } else {
          const parentVal = parentValueByYear?.[y] ?? 0;
          const pct = getSgaPctOfParentForItemYear(row.id, y);
          out[row.id][y] = parentVal * (pct / 100);
        }
      }
      if (row.children?.length) {
        const parentByYear: Record<string, number> = {};
        for (const y of years) {
          if (!y.endsWith("A")) parentByYear[y] = out[row.id][y];
        }
        row.children.forEach((c) => setProjectionForRow(c, depth + 1, parentByYear));
      }
    }

    const hasHistoric = years.some((y) => y.endsWith("A"));
    if (hasHistoric) sgaRow.children.forEach((c) => setHistoricForRow(c));
    sgaRow.children.forEach((c) => setProjectionForRow(c, 0, null));
    return out;
  }, [incomeStatement, years, revenueTotalByYear, getSgaPctForItemYear, getSgaPctOfParentForItemYear, allStatements, sbcBreakdowns, danaBreakdowns]);

  /** SG&A value by leaf by year (for totalSgaByYear and methodology: same as projectedSgaByRowIdByYear for leaves) */
  const sgaByLeafByYear = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const { id } of sgaLeaves) {
      out[id] = projectedSgaByRowIdByYear[id] ?? {};
    }
    return out;
  }, [sgaLeaves, projectedSgaByRowIdByYear]);

  /** Total SG&A per year (historic from IS sga row, projection = sum of leaves) */
  const totalSgaByYear = useMemo(() => {
    const sgaRow = incomeStatement ? findRowInTree(incomeStatement, "sga") : null;
    const out: Record<string, number> = {};
    for (const y of years) {
      if (y.endsWith("A") && sgaRow) {
        out[y] = computeRowValue(sgaRow, y, incomeStatement ?? [], incomeStatement ?? [], allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
      } else {
        let sum = 0;
        for (const { id } of sgaLeaves) sum += sgaByLeafByYear[id]?.[y] ?? 0;
        out[y] = sum;
      }
    }
    return out;
  }, [years, incomeStatement, sgaLeaves, sgaByLeafByYear, allStatements, sbcBreakdowns, danaBreakdowns]);

  /** SG&A forecast methodology: % of revenue (top-level) or % of parent (sub-items) and total SG&A as % of revenue */
  const methodologySgaPct = useMemo(() => {
    const lines: Array<{ id: string; label: string; depth: number; pctByYear: Record<string, number | null> }> = [];
    // Follow the SG&A tree order so breakdown rows appear directly under their parent (e.g., R&D -> 1, 2).
    for (const { row, depth } of sgaRowsFlat) {
      if (depth === 0) {
        // Fixed SG&A item: % of total revenue
        const pctByYear: Record<string, number | null> = {};
        for (const y of years) {
          if (y.endsWith("A")) {
            pctByYear[y] = null;
          } else {
            pctByYear[y] = getSgaPctForItemYear(row.id, y);
          }
        }
        lines.push({ id: `sga-${row.id}`, label: row.label, depth: 0, pctByYear });
      } else if (!row.children?.length) {
        // Breakdown leaf: % of parent
        const pctByYear: Record<string, number | null> = {};
        for (const y of years) {
          if (y.endsWith("A")) {
            pctByYear[y] = null;
          } else {
            pctByYear[y] = getSgaPctOfParentForItemYear(row.id, y);
          }
        }
        const displayLabel = `${row.label} (% of parent)`;
        lines.push({ id: `sga-${row.id}`, label: displayLabel, depth, pctByYear });
      }
    }

    const totalPctByYear: Record<string, number | null> = {};
    for (const y of years) {
      if (y.endsWith("A")) totalPctByYear[y] = null;
      else {
        const rev = revenueTotalByYear[y] ?? 0;
        const sga = totalSgaByYear[y] ?? 0;
        totalPctByYear[y] = rev > 0 ? Math.round(100 * (sga / rev) * 10) / 10 : null;
      }
    }
    lines.push({ id: "sga-total", label: "Total SG&A as % of Revenue", depth: 0, pctByYear: totalPctByYear });
    return lines;
  }, [sgaLeaves, years, getSgaPctForItemYear, getSgaPctOfParentForItemYear, revenueTotalByYear, totalSgaByYear]);

  /** COGS forecast methodology: COGS % of revenue by line (the configured %), and total COGS as % of revenue */
  const methodologyCogsPct = useMemo(() => {
    const lines: Array<{ id: string; label: string; depth: number; pctByYear: Record<string, number | null> }> = [];
    for (const { id, label, depth } of leafRevenueLinesForCogs) {
      const pctByYear: Record<string, number | null> = {};
      for (const y of years) {
        if (y.endsWith("A")) {
          pctByYear[y] = null;
        } else {
          const pct = getCogsPctForLineYear(id, y);
          pctByYear[y] = pct;
        }
      }
      lines.push({ id: `cogs-${id}`, label: `${label} — COGS`, depth, pctByYear });
    }
    const totalPctByYear: Record<string, number | null> = {};
    for (const y of years) {
      if (y.endsWith("A")) {
        totalPctByYear[y] = null;
      } else {
        const rev = revenueTotalByYear[y] ?? 0;
        const cogs = projectedCogsByYear[y] ?? 0;
        totalPctByYear[y] = rev > 0 ? Math.round(100 * (cogs / rev) * 10) / 10 : null;
      }
    }
    lines.push({ id: "cogs-total", label: "Total COGS as % of Revenue", depth: 0, pctByYear: totalPctByYear });
    return lines;
  }, [leafRevenueLinesForCogs, years, getCogsPctForLineYear, revenueTotalByYear, projectedCogsByYear]);

  // SBC disclosure block: single source of truth — same as builder (embeddedDisclosures only, no sbcBreakdowns).
  // Derive directly from store so we never render from stale memos; map over full array and use computed totals only.
  const sbcDisclosures = useMemo(
    () => getSbcDisclosures(embeddedDisclosures),
    [embeddedDisclosures]
  );
  const totalSbcByYear = useMemo(
    () => getTotalSbcByYearFromEmbedded(embeddedDisclosures, years),
    [embeddedDisclosures, years]
  );
  const hasSbcDisclosureData = useMemo(
    () =>
      sbcDisclosures.length > 0 &&
      (sbcDisclosures.some((d) =>
        years.some((y) => (d.values[y] ?? 0) !== 0)
      ) ||
        years.some((y) => (totalSbcByYear[y] ?? 0) !== 0)),
    [sbcDisclosures, years, totalSbcByYear]
  );

  // Amortization of acquired intangibles disclosure block (same pattern as SBC).
  const amortizationDisclosures = useMemo(
    () => getAmortizationDisclosures(embeddedDisclosures),
    [embeddedDisclosures]
  );
  const totalAmortizationByYear = useMemo(
    () => getTotalAmortizationByYearFromEmbedded(embeddedDisclosures, years),
    [embeddedDisclosures, years]
  );
  const hasAmortizationDisclosureData = useMemo(
    () =>
      amortizationDisclosures.length > 0 &&
      (amortizationDisclosures.some((d) =>
        years.some((y) => (d.values[y] ?? 0) !== 0)
      ) ||
        years.some((y) => (totalAmortizationByYear[y] ?? 0) !== 0)),
    [amortizationDisclosures, years, totalAmortizationByYear]
  );

  const depreciationDisclosures = useMemo(
    () => getDepreciationDisclosures(embeddedDisclosures),
    [embeddedDisclosures]
  );
  const totalDepreciationByYear = useMemo(
    () => getTotalDepreciationByYearFromEmbedded(embeddedDisclosures, years),
    [embeddedDisclosures, years]
  );
  const hasDepreciationDisclosureData = useMemo(
    () =>
      depreciationDisclosures.length > 0 &&
      (depreciationDisclosures.some((d) =>
        years.some((y) => (d.values[y] ?? 0) !== 0)
      ) ||
        years.some((y) => (totalDepreciationByYear[y] ?? 0) !== 0)),
    [depreciationDisclosures, years, totalDepreciationByYear]
  );

  const restructuringDisclosures = useMemo(
    () => getRestructuringDisclosures(embeddedDisclosures),
    [embeddedDisclosures]
  );
  const totalRestructuringByYear = useMemo(
    () => getTotalRestructuringByYearFromEmbedded(embeddedDisclosures, years),
    [embeddedDisclosures, years]
  );
  const hasRestructuringDisclosureData = useMemo(
    () =>
      restructuringDisclosures.length > 0 &&
      (restructuringDisclosures.some((d) =>
        years.some((y) => (d.values[y] ?? 0) !== 0)
      ) ||
        years.some((y) => (totalRestructuringByYear[y] ?? 0) !== 0)),
    [restructuringDisclosures, years, totalRestructuringByYear]
  );

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
            Revenue & COGS · Years:{" "}
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
                <button
                  type="button"
                  onClick={() => setRevenueSectionOpen((open) => !open)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs">
                      {revenueSectionOpen ? "▾" : "▸"}
                    </span>
                    <h3 className="text-sm font-bold text-slate-100">
                      Income Statement — Revenue
                    </h3>
                  </div>
                </button>
              </td>
            </tr>
            {revenueSectionOpen &&
              (revenueRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={1 + years.length}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    No Revenue line found. Add Revenue in Historicals or IS
                    structure.
                  </td>
                </tr>
              ) : (
                revenueRows.map(({ row, depth }, index) => {
                  // Determine if this row has descendants (for collapse toggle)
                  let hasDescendants = false;
                  for (let j = index + 1; j < revenueRows.length; j++) {
                    if (revenueRows[j].depth <= depth) break;
                    hasDescendants = true;
                    break;
                  }
                  // Determine if any ancestor is collapsed
                  let hidden = false;
                  let currentDepth = depth;
                  for (let j = index - 1; j >= 0; j--) {
                    const prev = revenueRows[j];
                    if (prev.depth < currentDepth) {
                      if (collapsedRowIds.has(prev.row.id)) {
                        hidden = true;
                        break;
                      }
                      currentDepth = prev.depth;
                    }
                  }
                  if (hidden) return null;

                  const isParentTotal =
                    row.id === "rev" ||
                    hasDescendants;
                  const labelClass = isParentTotal
                    ? "text-slate-200 font-bold"
                    : "text-slate-200";
                  const isCollapsed = collapsedRowIds.has(row.id);

                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-900 hover:bg-slate-900/40 ${
                        isParentTotal ? "border-t-2 border-slate-300" : ""
                      }`}
                    >
                      <td
                        className={`px-3 py-2 ${labelClass}`}
                        style={{ paddingLeft: 12 + depth * 18 }}
                      >
                        <button
                          type="button"
                          className="flex items-center gap-2 text-left w-full min-h-[1.5rem]"
                          onClick={() => {
                            if (!hasDescendants) return;
                            setCollapsedRowIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.id)) next.delete(row.id);
                              else next.add(row.id);
                              return next;
                            });
                          }}
                        >
                          <span className="inline-flex w-4 shrink-0 justify-center text-slate-500 text-[10px]">
                            {hasDescendants ? (isCollapsed ? "▸" : "▾") : ""}
                          </span>
                          <span>{row.label}</span>
                        </button>
                      </td>
                      {years.map((y) => {
                      const isHistoric = y.endsWith("A");
                      const stored = getRowValueForYear(row.id, y, row);
                      
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
              ))}
            {/* Revenue & COGS — automatic calculations from COGS % inputs (visible when editing COGS card) */}
            <tr className="border-t-4 border-slate-700">
              <td
                colSpan={1 + years.length}
                className="px-3 py-3 bg-orange-950/30"
              >
                <button
                  type="button"
                  onClick={() =>
                    setRevenueCogsSectionOpen((open) => !open)
                  }
                  className="flex w-full items-start justify-between text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-orange-300 text-xs">
                      {revenueCogsSectionOpen ? "▾" : "▸"}
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-orange-200">
                        Revenue & COGS
                      </h3>
                      <p className="text-xs text-orange-400/90 mt-1">
                        Total Revenue, COGS (from % of revenue by line), Gross
                        Profit, Gross Margin %
                      </p>
                    </div>
                  </div>
                </button>
              </td>
            </tr>
            {revenueCogsSectionOpen && (
              <>
                <tr className="border-b border-slate-800 bg-orange-950/20">
                  <td className="px-3 py-2 text-slate-400 text-xs font-medium">
                    Line
                  </td>
                  {years.map((y) => (
                    <td
                      key={y}
                      className="px-3 py-2 text-right text-slate-400 text-xs font-medium"
                    >
                      {y}
                    </td>
                  ))}
                </tr>
                {/* Revenue total */}
                <tr className="border-b border-slate-900 hover:bg-slate-900/40">
                  <td className="px-3 py-2 text-slate-200 font-bold">
                    Revenue
                  </td>
                  {years.map((y) => {
                    const value = revenueTotalByYear[y] ?? 0;
                    return (
                      <td
                        key={y}
                        className="px-3 py-2 text-right text-slate-100 tabular-nums"
                      >
                        {value !== 0
                          ? formatAccounting(value, unit, showDecimals)
                          : "—"}
                      </td>
                    );
                  })}
                </tr>
                {/* COGS breakdown by revenue line (supports collapsing by parent/child depth) */}
                {leafRevenueLinesForCogs.map(({ id, label, depth }, index) => {
                  // Determine if this COGS row has descendants (based on depth ordering)
                  let hasDescendants = false;
                  for (let j = index + 1; j < leafRevenueLinesForCogs.length; j++) {
                    const next = leafRevenueLinesForCogs[j];
                    if (next.depth <= depth) break;
                    hasDescendants = true;
                    break;
                  }

                  // Hide row if any ancestor in Revenue hierarchy is collapsed
                  let hidden = false;
                  let currentDepth = depth;
                  for (let j = index - 1; j >= 0; j--) {
                    const prev = leafRevenueLinesForCogs[j];
                    if (prev.depth < currentDepth) {
                      if (collapsedRowIds.has(prev.id)) {
                        hidden = true;
                        break;
                      }
                      currentDepth = prev.depth;
                    }
                  }
                  if (hidden) return null;

                  const isCollapsed = collapsedRowIds.has(id);

                  return (
                    <tr
                      key={`cogs-${id}`}
                      className="border-b border-slate-900 hover:bg-slate-900/40"
                    >
                      <td
                        className="px-3 py-2 text-slate-300"
                        style={{ paddingLeft: 12 + depth * 18 }}
                      >
                        <button
                          type="button"
                          className="flex items-center gap-2 text-left w-full min-h-[1.5rem]"
                          onClick={() => {
                            if (!hasDescendants) return;
                            setCollapsedRowIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            });
                          }}
                        >
                          <span className="inline-flex w-4 shrink-0 justify-center text-slate-500 text-[10px]">
                            {hasDescendants ? (isCollapsed ? "▸" : "▾") : ""}
                          </span>
                          <span>{label} — COGS</span>
                        </button>
                      </td>
                      {years.map((y) => {
                        const value = cogsByLineByYear[id]?.[y] ?? 0;
                        return (
                          <td
                            key={y}
                            className="px-3 py-2 text-right text-slate-100 tabular-nums"
                          >
                            {value !== 0
                              ? formatAccounting(value, unit, showDecimals)
                              : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {/* Total COGS */}
                <tr className="border-b border-slate-900 hover:bg-slate-900/40 bg-orange-950/20">
                  <td className="px-3 py-2 text-orange-200 font-semibold">
                    Cost of Goods Sold (COGS)
                  </td>
                  {years.map((y) => {
                    const value = projectedCogsByYear[y] ?? 0;
                    return (
                      <td
                        key={y}
                        className="px-3 py-2 text-right text-orange-100 tabular-nums font-medium"
                      >
                        {value !== 0
                          ? formatAccounting(value, unit, showDecimals)
                          : "—"}
                      </td>
                    );
                  })}
                </tr>
                {/* Gross Profit */}
                <tr className="border-b border-slate-900 hover:bg-slate-900/40">
                  <td className="px-3 py-2 text-slate-200 font-semibold">
                    Gross Profit
                  </td>
                  {years.map((y) => {
                    const rev = revenueTotalByYear[y] ?? 0;
                    const cogs = projectedCogsByYear[y] ?? 0;
                    const value = rev - cogs;
                    return (
                      <td
                        key={y}
                        className="px-3 py-2 text-right text-slate-100 tabular-nums"
                      >
                        {value !== 0
                          ? formatAccounting(value, unit, showDecimals)
                          : "—"}
                      </td>
                    );
                  })}
                </tr>
                {/* Gross Margin % */}
                <tr className="border-b border-slate-900 hover:bg-slate-900/40">
                  <td className="px-3 py-2 text-slate-200 font-semibold">
                    Gross Margin %
                  </td>
                  {years.map((y) => {
                    const rev = revenueTotalByYear[y] ?? 0;
                    const cogs = projectedCogsByYear[y] ?? 0;
                    const value = rev > 0 ? ((rev - cogs) / rev) * 100 : 0;
                    return (
                      <td
                        key={y}
                        className="px-3 py-2 text-right text-slate-100 tabular-nums"
                      >
                        {value !== 0 ? `${value.toFixed(2)}%` : "—"}
                      </td>
                    );
                  })}
                </tr>
              </>
            )}
            {/* Revenue forecast methodology — YoY % per year per line */}
            {revenueRows.length > 0 && methodologyYoY.length > 0 && (
              <>
                <tr className="border-t-4 border-slate-700">
                  <td
                    colSpan={1 + years.length}
                    className="px-3 py-3 bg-slate-900/50"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setRevenueMethodSectionOpen((open) => !open)
                      }
                      className="flex w-full items-start justify-between text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 text-xs">
                          {revenueMethodSectionOpen ? "▾" : "▸"}
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-slate-100">
                            Revenue forecast methodology
                          </h3>
                          <p className="text-xs text-slate-500 mt-1">
                            YoY % vs prior period (last actual → first forecast, then vs prior forecast)
                          </p>
                        </div>
                      </div>
                    </button>
                  </td>
                </tr>
                {revenueMethodSectionOpen && (
                  <>
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
                      className="border-b border-slate-800/90 hover:bg-slate-900/30"
                    >
                        <td
                          className="px-3 py-2.5 text-slate-400 text-xs"
                          style={{ paddingLeft: 12 + depth * 18 }}
                        >
                          <span className="text-slate-300">{label}</span>
                        </td>
                        {years.map((y) => {
                          const isProj = !y.endsWith("A");
                          const val = isProj ? yoyByYear[y] : null;
                          const display = val != null ? `${val}%` : "—";
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
              </>
            )}
            {/* COGS forecast methodology — COGS % of revenue by line (configured %) */}
            {methodologyCogsPct.length > 0 && (
              <>
                <tr className="border-t-4 border-slate-700">
                  <td
                    colSpan={1 + years.length}
                    className="px-3 py-3 bg-orange-950/30"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setCogsMethodSectionOpen((open) => !open)
                      }
                      className="flex w-full items-start justify-between text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-orange-300 text-xs">
                          {cogsMethodSectionOpen ? "▾" : "▸"}
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-orange-200">
                            COGS forecast methodology
                          </h3>
                          <p className="text-xs text-orange-400/90 mt-1">
                            COGS % of revenue by line (projection years)
                          </p>
                        </div>
                      </div>
                    </button>
                  </td>
                </tr>
                {cogsMethodSectionOpen && (
                  <>
                    <tr className="border-b border-slate-800 bg-orange-950/20">
                      <td className="px-3 py-2 text-orange-300/90 text-xs font-medium">
                        Line
                      </td>
                      {years.map((y) => (
                        <td
                          key={y}
                          className="px-3 py-2 text-right text-orange-300/90 text-xs font-medium"
                        >
                          {y}
                        </td>
                      ))}
                    </tr>
                    {methodologyCogsPct.map(
                      ({ id, label, depth, pctByYear }) => (
                        <tr key={id} className="border-b border-slate-900">
                          <td
                            className="px-3 py-2 text-orange-200/90 text-xs"
                            style={{ paddingLeft: 12 + depth * 14 }}
                          >
                            {label}
                          </td>
                          {years.map((y) => {
                            const val = pctByYear[y];
                            const display = val != null ? `${val}%` : "—";
                            return (
                              <td
                                key={y}
                                className="px-3 py-2 text-right text-orange-200/90 text-xs tabular-nums"
                              >
                                {display}
                              </td>
                            );
                          })}
                        </tr>
                      )
                    )}
                  </>
                )}
              </>
            )}
            {/* SG&A — projected amounts by item and total */}
            {sgaRowsFlat.length > 0 && (
              <>
                <tr className="border-t-4 border-slate-700">
                  <td
                    colSpan={1 + years.length}
                    className="px-3 py-3 bg-purple-950/30"
                  >
                    <button
                      type="button"
                      onClick={() => setSgaSectionOpen((open) => !open)}
                      className="flex w-full items-start justify-between text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-purple-300 text-xs">
                          {sgaSectionOpen ? "▾" : "▸"}
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-purple-200">
                            SG&A
                          </h3>
                          <p className="text-xs text-purple-400/90 mt-1">
                            Revenue, SG&A items (from % of revenue), Total SG&A
                          </p>
                        </div>
                      </div>
                    </button>
                  </td>
                </tr>
                {sgaSectionOpen && (
                  <>
                    <tr className="border-b border-slate-800 bg-purple-950/20">
                      <td className="px-3 py-2 text-slate-400 text-xs font-medium">
                        Line
                      </td>
                      {years.map((y) => (
                        <td
                          key={y}
                          className="px-3 py-2 text-right text-slate-400 text-xs font-medium"
                        >
                          {y}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-900 hover:bg-slate-900/40">
                      <td className="px-3 py-2 text-slate-200 font-bold">
                        Revenue
                      </td>
                      {years.map((y) => {
                        const value = revenueTotalByYear[y] ?? 0;
                        return (
                          <td
                            key={y}
                            className="px-3 py-2 text-right text-slate-100 tabular-nums"
                          >
                            {value !== 0 ? formatAccounting(value, unit, showDecimals) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                    {sgaRowsFlat.map(({ row, depth }) => {
                      const valueByYear = projectedSgaByRowIdByYear[row.id];
                      if (!valueByYear) return null;
                      return (
                        <tr
                          key={`sga-${row.id}`}
                          className="border-b border-slate-900 hover:bg-slate-900/40"
                        >
                          <td
                            className="px-3 py-2 text-purple-200/90 text-xs"
                            style={{ paddingLeft: 12 + depth * 14 }}
                          >
                            {row.label}
                          </td>
                          {years.map((y) => {
                            const value = valueByYear[y] ?? 0;
                            return (
                              <td
                                key={y}
                                className="px-3 py-2 text-right text-slate-100 tabular-nums"
                              >
                                {value !== 0 ? formatAccounting(value, unit, showDecimals) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr className="border-b border-slate-900 hover:bg-slate-900/40 bg-purple-950/20">
                      <td className="px-3 py-2 text-purple-200 font-semibold">
                        Total SG&A
                      </td>
                      {years.map((y) => {
                        const value = totalSgaByYear[y] ?? 0;
                        return (
                          <td
                            key={y}
                            className="px-3 py-2 text-right text-purple-100 tabular-nums font-medium"
                          >
                            {value !== 0 ? formatAccounting(value, unit, showDecimals) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                )}
              </>
            )}
            {/* SG&A forecast methodology — configured % of revenue by item */}
            {methodologySgaPct.length > 0 && (
              <>
                <tr className="border-t-4 border-slate-700">
                  <td
                    colSpan={1 + years.length}
                    className="px-3 py-3 bg-purple-950/30"
                  >
                    <button
                      type="button"
                      onClick={() => setSgaMethodSectionOpen((open) => !open)}
                      className="flex w-full items-start justify-between text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-purple-300 text-xs">
                          {sgaMethodSectionOpen ? "▾" : "▸"}
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-purple-200">
                            SG&A forecast methodology
                          </h3>
                          <p className="text-xs text-purple-400/90 mt-1">
                            SG&A % of revenue by item (projection years)
                          </p>
                        </div>
                      </div>
                    </button>
                  </td>
                </tr>
                {sgaMethodSectionOpen && (
                  <>
                    <tr className="border-b border-slate-800 bg-purple-950/20">
                      <td className="px-3 py-2 text-purple-300/90 text-xs font-medium">
                        Line
                      </td>
                      {years.map((y) => (
                        <td
                          key={y}
                          className="px-3 py-2 text-right text-purple-300/90 text-xs font-medium"
                        >
                          {y}
                        </td>
                      ))}
                    </tr>
                    {methodologySgaPct.map(
                      ({ id, label, depth: d, pctByYear }) => (
                        <tr key={id} className="border-b border-slate-900">
                          <td
                            className="px-3 py-2 text-purple-200/90 text-xs"
                            style={{ paddingLeft: 12 + d * 14 }}
                          >
                            {label}
                          </td>
                          {years.map((y) => {
                            const val = pctByYear[y];
                            const display = val != null ? `${Number(val).toFixed(1)}%` : "—";
                            return (
                              <td
                                key={y}
                                className="px-3 py-2 text-right text-purple-200/90 text-xs tabular-nums"
                              >
                                {display}
                              </td>
                            );
                          })}
                        </tr>
                      )
                    )}
                  </>
                )}
              </>
            )}
          </tbody>
        </table>

        {hasSbcDisclosureData && sbcDisclosureEnabled && (() => {
          const allSbcRows = getSbcDisclosures(embeddedDisclosures);
          const computedTotals = getTotalSbcByYearFromEmbedded(embeddedDisclosures, years);
          const histYears = historicalYears.length > 0 ? historicalYears : years;
          const rowsToShow = allSbcRows.filter((d) =>
            histYears.some((y) => (d.values[y] ?? 0) !== 0)
          );
          return (
            <div className="mt-8 rounded-lg border border-amber-800/50 bg-amber-950/30 p-4">
              <h3 className="mb-3 text-sm font-semibold text-amber-200">
                Stock-Based Compensation (disclosure)
              </h3>
              <p className="mb-3 text-xs text-amber-300/80">
                SBC by line and by year. These amounts are disclosed only; they do not change reported Income Statement line values.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-amber-700/50">
                      <th className="px-3 py-2 text-left font-medium text-amber-300/90">
                        Line
                      </th>
                      {years.map((y) => (
                        <th
                          key={y}
                          className="px-3 py-2 text-right font-medium text-amber-300/90"
                        >
                          {y}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsToShow.map((d) => {
                      const row = findRowInTree(incomeStatement ?? [], d.rowId);
                      const label = row?.label ?? d.rowId;
                      return (
                        <tr
                          key={d.rowId}
                          className="border-b border-amber-800/30"
                        >
                          <td className="px-3 py-2 text-amber-200/90">{label}</td>
                          {years.map((y) => {
                            const val = d.values[y] ?? 0;
                            const display =
                              val === 0
                                ? "—"
                                : formatAccounting(val, meta?.currencyUnit as CurrencyUnit, false);
                            return (
                              <td
                                key={y}
                                className="px-3 py-2 text-right text-amber-100/90 tabular-nums"
                              >
                                {display}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-amber-700/50 font-medium">
                      <td className="px-3 py-2 text-amber-200">Total stock-based compensation expense</td>
                      {years.map((y) => {
                        const val = computedTotals[y] ?? 0;
                        const display =
                          val === 0
                            ? "—"
                            : formatAccounting(val, meta?.currencyUnit as CurrencyUnit, false);
                        return (
                          <td
                            key={y}
                            className="px-3 py-2 text-right text-amber-100 tabular-nums"
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* Amortization of Acquired Intangibles disclosure block — same source as builder. */}
        {hasAmortizationDisclosureData && (() => {
          const allAmortRows = getAmortizationDisclosures(embeddedDisclosures);
          const computedAmortTotals = getTotalAmortizationByYearFromEmbedded(embeddedDisclosures, years);
          const histYears = historicalYears.length > 0 ? historicalYears : years;
          const rowsToShow = allAmortRows.filter((d) =>
            histYears.some((y) => (d.values[y] ?? 0) !== 0)
          );
          return (
            <div className="mt-8 rounded-lg border border-teal-800/50 bg-teal-950/30 p-4">
              <h3 className="mb-3 text-sm font-semibold text-teal-200">
                Amortization of Acquired Intangibles
              </h3>
              <p className="mb-3 text-xs text-teal-300/80">
                Amounts include amortization of intangible assets acquired through business combinations, as follows:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-teal-700/50">
                      <th className="px-3 py-2 text-left font-medium text-teal-300/90">
                        Line
                      </th>
                      {years.map((y) => (
                        <th
                          key={y}
                          className="px-3 py-2 text-right font-medium text-teal-300/90"
                        >
                          {y}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsToShow.map((d) => {
                      const row = findRowInTree(incomeStatement ?? [], d.rowId);
                      const label = row?.label ?? d.rowId;
                      return (
                        <tr
                          key={d.rowId}
                          className="border-b border-teal-800/30"
                        >
                          <td className="px-3 py-2 text-teal-200/90">{label}</td>
                          {years.map((y) => {
                            const val = d.values[y] ?? 0;
                            const display =
                              val === 0
                                ? "—"
                                : formatAccounting(val, meta?.currencyUnit as CurrencyUnit, false);
                            return (
                              <td
                                key={y}
                                className="px-3 py-2 text-right text-teal-100/90 tabular-nums"
                              >
                                {display}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-teal-700/50 font-medium">
                      <td className="px-3 py-2 text-teal-200">Total amortization of acquired intangibles</td>
                      {years.map((y) => {
                        const val = computedAmortTotals[y] ?? 0;
                        const display =
                          val === 0
                            ? "—"
                            : formatAccounting(val, meta?.currencyUnit as CurrencyUnit, false);
                        return (
                          <td
                            key={y}
                            className="px-3 py-2 text-right text-teal-100 tabular-nums"
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* Depreciation Embedded in Expenses disclosure block — same source as builder. */}
        {hasDepreciationDisclosureData && (() => {
          const allDeprRows = getDepreciationDisclosures(embeddedDisclosures);
          const computedDeprTotals = getTotalDepreciationByYearFromEmbedded(embeddedDisclosures, years);
          const histYears = historicalYears.length > 0 ? historicalYears : years;
          const rowsToShow = allDeprRows.filter((d) =>
            histYears.some((y) => (d.values[y] ?? 0) !== 0)
          );
          return (
            <div className="mt-8 rounded-lg border border-violet-800/50 bg-violet-950/30 p-4">
              <h3 className="mb-3 text-sm font-semibold text-violet-200">
                Depreciation Embedded in Expenses
              </h3>
              <p className="mb-3 text-xs text-violet-300/80">
                Amounts include depreciation embedded in cost of revenue or operating expenses, as follows:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-violet-700/50">
                      <th className="px-3 py-2 text-left font-medium text-violet-300/90">
                        Line
                      </th>
                      {years.map((y) => (
                        <th
                          key={y}
                          className="px-3 py-2 text-right font-medium text-violet-300/90"
                        >
                          {y}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsToShow.map((d) => {
                      const row = findRowInTree(incomeStatement ?? [], d.rowId);
                      const label = row?.label ?? d.rowId;
                      return (
                        <tr
                          key={d.rowId}
                          className="border-b border-violet-800/30"
                        >
                          <td className="px-3 py-2 text-violet-200/90">{label}</td>
                          {years.map((y) => {
                            const val = d.values[y] ?? 0;
                            const display =
                              val === 0
                                ? "—"
                                : formatAccounting(val, meta?.currencyUnit as CurrencyUnit, false);
                            return (
                              <td
                                key={y}
                                className="px-3 py-2 text-right text-violet-100/90 tabular-nums"
                              >
                                {display}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-violet-700/50 font-medium">
                      <td className="px-3 py-2 text-violet-200">Total depreciation embedded in expenses</td>
                      {years.map((y) => {
                        const val = computedDeprTotals[y] ?? 0;
                        const display =
                          val === 0
                            ? "—"
                            : formatAccounting(val, meta?.currencyUnit as CurrencyUnit, false);
                        return (
                          <td
                            key={y}
                            className="px-3 py-2 text-right text-violet-100 tabular-nums"
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* Restructuring Charges disclosure block — same source as builder. */}
        {hasRestructuringDisclosureData && (() => {
          const allRestructRows = getRestructuringDisclosures(embeddedDisclosures);
          const computedRestructTotals = getTotalRestructuringByYearFromEmbedded(embeddedDisclosures, years);
          const histYears = historicalYears.length > 0 ? historicalYears : years;
          const rowsToShow = allRestructRows.filter((d) =>
            histYears.some((y) => (d.values[y] ?? 0) !== 0)
          );
          return (
            <div className="mt-8 rounded-lg border border-rose-800/50 bg-rose-950/30 p-4">
              <h3 className="mb-3 text-sm font-semibold text-rose-200">
                Restructuring Charges
              </h3>
              <p className="mb-3 text-xs text-rose-300/80">
                Amounts include restructuring charges embedded in cost of revenue or operating expenses, as follows:
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-rose-700/50">
                      <th className="px-3 py-2 text-left font-medium text-rose-300/90">
                        Line
                      </th>
                      {years.map((y) => (
                        <th
                          key={y}
                          className="px-3 py-2 text-right font-medium text-rose-300/90"
                        >
                          {y}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsToShow.map((d) => {
                      const row = findRowInTree(incomeStatement ?? [], d.rowId);
                      const label = row?.label ?? d.rowId;
                      return (
                        <tr
                          key={d.rowId}
                          className="border-b border-rose-800/30"
                        >
                          <td className="px-3 py-2 text-rose-200/90">{label}</td>
                          {years.map((y) => {
                            const val = d.values[y] ?? 0;
                            const display =
                              val === 0
                                ? "—"
                                : formatAccounting(val, meta?.currencyUnit as CurrencyUnit, false);
                            return (
                              <td
                                key={y}
                                className="px-3 py-2 text-right text-rose-100/90 tabular-nums"
                              >
                                {display}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-rose-700/50 font-medium">
                      <td className="px-3 py-2 text-rose-200">Total restructuring charges</td>
                      {years.map((y) => {
                        const val = computedRestructTotals[y] ?? 0;
                        const display =
                          val === 0
                            ? "—"
                            : formatAccounting(val, meta?.currencyUnit as CurrencyUnit, false);
                        return (
                          <td
                            key={y}
                            className="px-3 py-2 text-right text-rose-100 tabular-nums"
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </section>
  );
}
