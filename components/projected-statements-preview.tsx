"use client";

import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { storedToDisplay, getUnitLabel, type CurrencyUnit } from "@/lib/currency-utils";
import { computeProjectedRevCogs, computeProjectedEbitByYear } from "@/lib/projected-ebit";
import { getProjectedRevenueTotalByYear } from "@/lib/non-operating-phase2-direct-preview";
import { computeScheduleTotalDandaByYear } from "@/lib/schedule-total-danda";
import { computeRowValue } from "@/lib/calculations";
import { getWcScheduleVsCfsParity } from "@/lib/wc-schedule-cfs-parity";
import { getWcScheduleItems, getWcCfsBridgeLineFromMap, type WcDriverState } from "@/lib/working-capital-schedule";
import { computeWcCfsPreviewCashEffects } from "@/lib/projected-wc-cfs-bridge";
import { computeProjectedSbcCfoByYear } from "@/lib/projected-sbc-cfo";
import { buildCfsProjectedStatementPlanLines } from "@/lib/cfs-projected-statements-plan";
import { classifyCfsLineForProjection } from "@/lib/cfs-line-classification";
import { applyCfsDisclosureProjectionForYear } from "@/lib/cfs-disclosure-projection";
import { findRowInTree } from "@/lib/row-utils";
import {
  collectYearKeysFromRowTree,
  formatStatementYearHeader,
  pickNumericRecordForYear,
  resolvePriorYear,
  sortYearsChronologically,
} from "@/lib/year-timeline";
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
  /** When set, currency formatter shows explicit 0 instead of "—" (WC bridge rows). */
  wcShowZero?: boolean;
}

function fmt(value: number | undefined | null, unit: CurrencyUnit, showDecimals: boolean, showZero = false): string {
  if (value == null) return "—";
  if (value === 0 && !showZero) return "—";
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

/** Optional AI: plain-English WC sign logic from server (numbers are client-computed only). */
function WcCfsExplainBanner() {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const onClick = async () => {
    setLoading(true);
    setExplanation(null);
    try {
      const res = await fetch("/api/ai/wc-cfs-explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { explanation?: string | null; error?: string };
      setExplanation(data.explanation ?? data.error ?? "No explanation returned.");
    } catch {
      setExplanation("Could not reach explanation service.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="px-3 py-1.5 border-b border-violet-500/15 bg-violet-950/20 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="text-[9px] px-2 py-0.5 rounded border border-violet-500/40 text-violet-200 hover:bg-violet-500/10 disabled:opacity-50"
      >
        {loading ? "Loading…" : "AI: Explain WC cash-flow signs"}
      </button>
      {explanation ? (
        <span className="text-[9px] text-slate-400 max-w-[min(520px,90vw)]">{explanation}</span>
      ) : null}
    </div>
  );
}

function findRowByTaxonomy(flat: Row[], tt: string): Row | undefined {
  return flat.find((r) => r.taxonomyType === tt);
}

function findRowById(flat: Row[], id: string): Row | undefined {
  return flat.find((r) => r.id === id);
}

/** CFS section totals / patched anchors: keep store values; leaves use computeRowValue in preview. */
const CFS_PREVIEW_SKIP_RESOLVER_IDS = new Set([
  "net_income",
  "sbc",
  "danda",
  "wc_change",
  "operating_cf",
  "investing_cf",
  "financing_cf",
  "net_change_cash",
  "net_cash_change",
  "total_operating_cf",
  "total_investing_cf",
  "total_financing_cf",
]);

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
  const embeddedDisclosures = useModelStore((s) => s.embeddedDisclosures ?? []);
  const sbcDisclosureEnabled = useModelStore((s) => s.sbcDisclosureEnabled ?? true);
  const revenueForecastConfigV1 = useModelStore((s) => s.revenueForecastConfigV1);
  const revenueForecastTreeV1 = useModelStore((s) => s.revenueForecastTreeV1 ?? []);
  const revenueProjectionConfig = useModelStore((s) => s.revenueProjectionConfig);
  const cogsForecastConfigV1 = useModelStore((s) => s.cogsForecastConfigV1);
  const opexForecastConfigV1 = useModelStore((s) => s.opexForecastConfigV1);
  const applyProjections = useModelStore((s) => s.applyBsBuildProjectionsToModel);
  const cfsDisclosureProjectionByRowId = useModelStore((s) => s.cfsDisclosureProjectionByRowId ?? {});
  const cfsRollupDisclosureExcludedInPreview = useModelStore((s) => s.cfsRollupDisclosureExcludedInPreview ?? false);

  const capexForecastMethod = useModelStore((s) => s.capexForecastMethod);
  const capexPctRevenue = useModelStore((s) => s.capexPctRevenue);
  const capexManualByYear = useModelStore((s) => s.capexManualByYear);
  const capexGrowthPct = useModelStore((s) => s.capexGrowthPct);
  const capexTimingConvention = useModelStore((s) => s.capexTimingConvention);
  const ppeUsefulLifeSingle = useModelStore((s) => s.ppeUsefulLifeSingle);
  const capexSplitByBucket = useModelStore((s) => s.capexSplitByBucket);
  const capexCustomBucketIds = useModelStore((s) => s.capexCustomBucketIds);
  const capexBucketAllocationPct = useModelStore((s) => s.capexBucketAllocationPct);
  const ppeUsefulLifeByBucket = useModelStore((s) => s.ppeUsefulLifeByBucket);
  const capexHelperPpeByBucketByYear = useModelStore((s) => s.capexHelperPpeByBucketByYear);
  const capexModelIntangibles = useModelStore((s) => s.capexModelIntangibles);
  const intangiblesAmortizationLifeYears = useModelStore((s) => s.intangiblesAmortizationLifeYears);
  const intangiblesForecastMethod = useModelStore((s) => s.intangiblesForecastMethod);
  const intangiblesPctRevenue = useModelStore((s) => s.intangiblesPctRevenue);
  const intangiblesManualByYear = useModelStore((s) => s.intangiblesManualByYear);
  const intangiblesPctOfCapex = useModelStore((s) => s.intangiblesPctOfCapex);

  const wcDriverTypeByItemId = useModelStore((s) => s.wcDriverTypeByItemId ?? {});
  const wcDaysByItemId = useModelStore((s) => s.wcDaysByItemId ?? {});
  const wcDaysByItemIdByYear = useModelStore((s) => s.wcDaysByItemIdByYear ?? {});
  const wcDaysBaseByItemId = useModelStore((s) => s.wcDaysBaseByItemId ?? {});
  const wcPctBaseByItemId = useModelStore((s) => s.wcPctBaseByItemId ?? {});
  const wcPctByItemId = useModelStore((s) => s.wcPctByItemId ?? {});
  const wcPctByItemIdByYear = useModelStore((s) => s.wcPctByItemIdByYear ?? {});

  const equityRollforwardConfirmed = useModelStore((s) => s.equityRollforwardConfirmed);
  const equitySbcMethod = useModelStore((s) => s.equitySbcMethod);
  const equitySbcPctRevenue = useModelStore((s) => s.equitySbcPctRevenue);
  const equityManualSbcByYear = useModelStore((s) => s.equityManualSbcByYear ?? {});

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

  /** SBC CFO add-back for projection years — aligned with Equity / Other BS drivers when roll-forward is on. */
  const sbcCfoByProjectionYear = useMemo(
    () =>
      computeProjectedSbcCfoByYear({
        equityRollforwardConfirmed,
        projectionYears,
        equitySbcMethod,
        equitySbcPctRevenue,
        equityManualSbcByYear,
        revByYear,
        sbcBreakdowns,
        incomeStatement: incomeStatement ?? [],
        cashFlow: cashFlow ?? [],
      }),
    [
      equityRollforwardConfirmed,
      projectionYears,
      equitySbcMethod,
      equitySbcPctRevenue,
      equityManualSbcByYear,
      revByYear,
      sbcBreakdowns,
      incomeStatement,
      cashFlow,
    ]
  );

  /** Same revenue totals as Forecast Drivers → Non-operating & Schedules (Capex / D&A). */
  const revenueByYearForSchedule = useMemo(() => {
    if (!lastHistYear || projectionYears.length === 0) return {} as Record<string, number>;
    return getProjectedRevenueTotalByYear({
      incomeStatement: incomeStatement ?? [],
      revenueForecastConfigV1,
      revenueForecastTreeV1,
      revenueProjectionConfig,
      projectionYears,
      lastHistoricYear: lastHistYear,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
      currencyUnit: unit,
    });
  }, [
    incomeStatement,
    projectionYears,
    lastHistYear,
    revenueForecastConfigV1,
    revenueForecastTreeV1,
    revenueProjectionConfig,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
    unit,
  ]);

  const scheduleTotalDandaByYear = useMemo(
    () =>
      computeScheduleTotalDandaByYear({
        projectionYears,
        lastHistoricYear: lastHistYear,
        revenueByYear: revenueByYearForSchedule,
        balanceSheet: balanceSheet ?? [],
        cashFlow: cashFlow ?? [],
        currencyUnit: unit,
        capexForecastMethod,
        capexPctRevenue,
        capexManualByYear,
        capexGrowthPct,
        capexTimingConvention,
        ppeUsefulLifeSingle,
        capexSplitByBucket,
        capexCustomBucketIds,
        capexBucketAllocationPct,
        ppeUsefulLifeByBucket,
        capexHelperPpeByBucketByYear,
        capexModelIntangibles,
        intangiblesAmortizationLifeYears,
        intangiblesForecastMethod,
        intangiblesPctRevenue,
        intangiblesManualByYear,
        intangiblesPctOfCapex,
      }),
    [
      projectionYears,
      lastHistYear,
      revenueByYearForSchedule,
      balanceSheet,
      cashFlow,
      unit,
      capexForecastMethod,
      capexPctRevenue,
      capexManualByYear,
      capexGrowthPct,
      capexTimingConvention,
      ppeUsefulLifeSingle,
      capexSplitByBucket,
      capexCustomBucketIds,
      capexBucketAllocationPct,
      ppeUsefulLifeByBucket,
      capexHelperPpeByBucketByYear,
      capexModelIntangibles,
      intangiblesAmortizationLifeYears,
      intangiblesForecastMethod,
      intangiblesPctRevenue,
      intangiblesManualByYear,
      intangiblesPctOfCapex,
    ]
  );

  // Revenue + COGS full timeline — same basis as Forecast Drivers → WC schedule preview
  const { revByYearForWc, cogsByYearForWc } = useMemo(() => {
    const histRev: Record<string, number> = {};
    const histCogs: Record<string, number> = {};
    const revRow = findRowInTree(incomeStatement ?? [], "rev");
    const cogsRow = findRowInTree(incomeStatement ?? [], "cogs");
    for (const y of historicalYears) {
      try {
        if (revRow) histRev[y] = computeRowValue(revRow, y, incomeStatement ?? [], incomeStatement ?? [], allStatements);
        if (cogsRow) histCogs[y] = Math.abs(computeRowValue(cogsRow, y, incomeStatement ?? [], incomeStatement ?? [], allStatements));
      } catch {
        /* noop */
      }
    }
    if (projectionYears.length === 0 || !lastHistYear) {
      return { revByYearForWc: histRev, cogsByYearForWc: histCogs };
    }
    const { revByYear: projRev, cogsByYear: projCogs } = computeProjectedRevCogs({
      incomeStatement: incomeStatement ?? [],
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
    return {
      revByYearForWc: { ...histRev, ...projRev },
      cogsByYearForWc: { ...histCogs, ...projCogs },
    };
  }, [
    incomeStatement,
    historicalYears,
    projectionYears,
    lastHistYear,
    revenueForecastConfigV1,
    revenueForecastTreeV1,
    revenueProjectionConfig,
    cogsForecastConfigV1,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
    unit,
  ]);

  const wcDriverState: WcDriverState = useMemo(
    () => ({
      wcDriverTypeByItemId,
      wcDaysByItemId,
      wcDaysByItemIdByYear,
      wcDaysBaseByItemId,
      wcPctBaseByItemId,
      wcPctByItemId,
      wcPctByItemIdByYear,
    }),
    [
      wcDriverTypeByItemId,
      wcDaysByItemId,
      wcDaysByItemIdByYear,
      wcDaysBaseByItemId,
      wcPctBaseByItemId,
      wcPctByItemId,
      wcPctByItemIdByYear,
    ]
  );

  /** CFS-preview only: WC cash effects keyed by CFS row id (`cfo_*` or BS id). */
  const wcCfsCashByItemId = useMemo(
    () =>
      computeWcCfsPreviewCashEffects({
        cashFlow: cashFlow ?? [],
        balanceSheet: balanceSheet ?? [],
        projectionYears,
        allChronologicalYears: allYears,
        historicalYears,
        wcDriverState,
        revByYear: revByYearForWc,
        cogsByYear: cogsByYearForWc,
      }),
    [
      cashFlow,
      balanceSheet,
      projectionYears,
      allYears,
      historicalYears,
      wcDriverState,
      revByYearForWc,
      cogsByYearForWc,
    ]
  );

  /** Chron aligned with WC bridge (meta years + BS value keys per schedule row) for prior-year checks. */
  const chronForWcPatch = useMemo(() => {
    const items = getWcScheduleItems(cashFlow ?? [], balanceSheet ?? []);
    const ys = new Set<string>(allYears);
    for (const it of items) {
      const bsRow = findRowInTree(balanceSheet ?? [], it.id);
      for (const k of collectYearKeysFromRowTree(bsRow ? [bsRow] : [])) ys.add(k);
    }
    return sortYearsChronologically([...ys]);
  }, [cashFlow, balanceSheet, allYears]);

  /** Years to overwrite in CFS preview: last actual YoY effect + all projections. */
  const wcPatchYearKeys = useMemo(() => {
    const ys = [...projectionYears];
    if (lastHistYear && !ys.includes(lastHistYear)) {
      if (historicalYears.length >= 2) {
        ys.unshift(lastHistYear);
      } else if (resolvePriorYear(lastHistYear, chronForWcPatch) != null) {
        ys.unshift(lastHistYear);
      }
    }
    return ys;
  }, [projectionYears, historicalYears, lastHistYear, chronForWcPatch]);

  const wcScheduleItems = useMemo(
    () => getWcScheduleItems(cashFlow ?? [], balanceSheet ?? []),
    [cashFlow, balanceSheet]
  );

  const cfsPlanLines = useMemo(
    () => buildCfsProjectedStatementPlanLines(cashFlow ?? [], wcScheduleItems),
    [cashFlow, wcScheduleItems]
  );

  const wcScheduleCfsParity = useMemo(
    () => getWcScheduleVsCfsParity(cashFlow ?? [], balanceSheet ?? [], wcCfsCashByItemId),
    [cashFlow, balanceSheet, wcCfsCashByItemId]
  );

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

  const bsMismatchHint = useMemo(() => {
    if (bsCheck.every((c) => Math.abs(c.diff) < 1)) return null;
    const first = bsCheck.find((c) => Math.abs(c.diff) >= 1);
    if (!first) return null;
    const cashRow = findRowById(flatBs, "cash");
    const ta = findRowById(flatBs, "total_assets");
    const tle = findRowById(flatBs, "total_liab_and_equity") ?? findRowById(flatBs, "total_liabilities_equity");
    const y = first.year;
    return `First mismatch ${y}: cash ${getVal(cashRow, y)} · TA ${getVal(ta, y)} · L+E ${getVal(tle, y)} · rounded diff ${first.diff}`;
  }, [bsCheck, flatBs]);

  const cfsFlat = useMemo(() => flattenRows(cashFlow ?? []), [cashFlow]);

  // ── Build CFS preview rows (same line plan as Projected Statements builder) ─
  const cfsRows = useMemo((): PreviewRow[] => {
    const rows: PreviewRow[] = [];

    const makeV = (row: Row): Record<string, number> => {
      const v: Record<string, number> = {};
      for (const y of showYears) v[y] = getVal(row, y);
      return v;
    };

    const emptyYearValues = (): Record<string, number> => {
      const v: Record<string, number> = {};
      for (const y of showYears) v[y] = 0;
      return v;
    };

    const hasWcBridge = Object.keys(wcCfsCashByItemId).length > 0;

    for (const line of cfsPlanLines) {
      if (line.role === "section_header") {
        rows.push({
          id: line.id,
          label: line.label,
          style: "header",
          indent: line.depth,
          values: {},
        });
        continue;
      }
      if (line.role === "spacer") {
        rows.push({ id: line.id, label: "", style: "spacer", indent: 0, values: {} });
        continue;
      }

      const style = line.previewStyle as RowStyle;
      const sourceRow = line.sourceRowId ? findRowInTree(cashFlow ?? [], line.sourceRowId) : undefined;

      if (line.id === "wc_change" && wcScheduleItems.length > 0) {
        const wcChangeTotal: Record<string, number> = {};
        for (const y of showYears) wcChangeTotal[y] = 0;
        for (const item of wcScheduleItems) {
          const { line: bridgeLine } = getWcCfsBridgeLineFromMap(wcCfsCashByItemId, `cfo_${item.id}`);
          for (const y of showYears) {
            const t = pickNumericRecordForYear(bridgeLine, y);
            if (t != null && Number.isFinite(t)) wcChangeTotal[y] += t;
          }
        }
        rows.push({
          id: "wc_change",
          label: line.label ?? "Change in Working Capital",
          style: "subtotal",
          indent: line.depth,
          values: wcChangeTotal,
          isProjected: wcPatchYearKeys.some((y) => (wcChangeTotal[y] ?? 0) !== 0),
        });
        continue;
      }

      if (!sourceRow) {
        rows.push({
          id: line.id,
          label: line.label,
          style,
          indent: line.depth,
          values: emptyYearValues(),
          isProjected: false,
        });
        continue;
      }

      const v: Record<string, number> = {};
      for (const y of showYears) {
        if (projectionYears.includes(y)) {
          const skipResolver =
            CFS_PREVIEW_SKIP_RESOLVER_IDS.has(line.id) ||
            (line.id.startsWith("cfo_") && hasWcBridge);
          v[y] = skipResolver
            ? getVal(sourceRow, y)
            : computeRowValue(
                sourceRow,
                y,
                cfsFlat,
                cashFlow ?? [],
                allStatements,
                sbcBreakdowns,
                danaBreakdowns,
                embeddedDisclosures,
                sbcDisclosureEnabled
              );
        } else {
          v[y] = getVal(sourceRow, y);
        }
      }

      rows.push({
        id: line.id,
        label: line.label,
        style,
        indent: line.depth,
        values: v,
        isProjected: projectionYears.some((y) => (v[y] ?? 0) !== 0),
      });
    }

    const hasScheduleDanda = Object.keys(scheduleTotalDandaByYear).length > 0;
    const hasWcScheduleLines = Object.keys(wcCfsCashByItemId).length > 0;
    const niFromIs = isRows.find((x) => x.id === "net_income");
    /** Holistic CFS preview: NI, D&A, WC, SBC patched from forecast engines; other lines use row.values / future patches. */
    const hasSbcPreview = Object.keys(sbcCfoByProjectionYear).length > 0;

    return rows.map((r) => {
      if (r.style === "header" || r.style === "spacer") return r;

      const v = { ...r.values };
      let patchedNi = false;
      if (r.id === "net_income" && niFromIs) {
        for (const y of projectionYears) {
          const t = niFromIs.values[y];
          if (t !== undefined) {
            v[y] = t;
            patchedNi = true;
          }
        }
      }

      let patchedSbc = false;
      if (r.id === "sbc" && hasSbcPreview) {
        for (const y of projectionYears) {
          const t = sbcCfoByProjectionYear[y];
          if (t !== undefined) {
            v[y] = t;
            patchedSbc = true;
          }
        }
      }

      const { line: wcLineRaw, hasExplicitBridgeKey } = getWcCfsBridgeLineFromMap(wcCfsCashByItemId, r.id);

      const patchDanda = hasScheduleDanda && r.id === "danda";
      /** WC children are often `kind: "calc"` (CFO bridge) → rendered as subtotal, not line */
      const patchWc =
        hasWcScheduleLines && hasExplicitBridgeKey && (r.style === "line" || r.style === "subtotal");

      const srcRowForDisclosure = findRowInTree(cashFlow ?? [], r.id);
      let patchedDisclosure = false;
      if (
        srcRowForDisclosure &&
        classifyCfsLineForProjection(srcRowForDisclosure, balanceSheet ?? []) === "cf_disclosure_only"
      ) {
        const policy = cfsDisclosureProjectionByRowId[r.id];
        if (policy) {
          patchedDisclosure = true;
          for (const y of projectionYears) {
            if (policy.mode === "excluded") {
              v[y] = 0;
            } else {
              v[y] = applyCfsDisclosureProjectionForYear(
                policy,
                y,
                lastHistYear,
                revByYear[y],
                srcRowForDisclosure.values?.[lastHistYear]
              );
            }
          }
        }
      }

      if (!patchedNi && !patchedSbc && !patchDanda && !patchWc && !patchedDisclosure) return r;

      if (patchDanda) {
        for (const y of projectionYears) {
          const t = scheduleTotalDandaByYear[y];
          if (t != null && Number.isFinite(t)) v[y] = t;
        }
      }
      let wroteFromBridge = false;
      if (patchWc) {
        for (const y of wcPatchYearKeys) {
          const t = pickNumericRecordForYear(wcLineRaw, y);
          if (t != null && Number.isFinite(t)) {
            v[y] = t;
            wroteFromBridge = true;
          }
        }
      }
      return {
        ...r,
        values: v,
        isProjected:
          wcPatchYearKeys.some((y) => (v[y] ?? 0) !== 0) ||
          (patchedNi && projectionYears.some((y) => (v[y] ?? 0) !== 0)) ||
          (patchedSbc && projectionYears.some((y) => (v[y] ?? 0) !== 0)) ||
          (patchedDisclosure && projectionYears.some((y) => (v[y] ?? 0) !== 0)),
        wcShowZero: patchWc && wroteFromBridge ? true : r.wcShowZero,
      };
    })
      .filter((r) => {
        if (r.style === "header" || r.style === "spacer") return true;
        if (!cfsRollupDisclosureExcludedInPreview) return true;
        const sr = findRowInTree(cashFlow ?? [], r.id);
        if (!sr) return true;
        if (classifyCfsLineForProjection(sr, balanceSheet ?? []) !== "cf_disclosure_only") return true;
        const pol = cfsDisclosureProjectionByRowId[r.id];
        return pol?.mode !== "excluded";
      });
  }, [
    cfsPlanLines,
    cfsFlat,
    cashFlow,
    allStatements,
    showYears,
    projectionYears,
    scheduleTotalDandaByYear,
    wcCfsCashByItemId,
    wcPatchYearKeys,
    wcScheduleItems,
    isRows,
    sbcCfoByProjectionYear,
    sbcBreakdowns,
    danaBreakdowns,
    embeddedDisclosures,
    sbcDisclosureEnabled,
    balanceSheet,
    cfsDisclosureProjectionByRowId,
    cfsRollupDisclosureExcludedInPreview,
    lastHistYear,
    revByYear,
  ]);

  const toggle = (sectionId: string) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  // ── Section renderer ───────────────────────────────────────────────────────
  const renderSection = (
    title: string,
    sectionId: string,
    sectionRows: PreviewRow[],
    accent: string,
    banner?: ReactNode
  ) => {
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
          <>
            {banner}
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
                      {formatStatementYearHeader(y, projectionYears.includes(y))}
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
                            {isMargin ? fmtPct(v) : fmt(v, unit, showDecimals, row.wcShowZero)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
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
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className={`text-[10px] font-medium ${allBalanced ? "text-emerald-300" : "text-red-300"}`}>
            {allBalanced
              ? "BS Check: A = L + E across all years ✓"
              : `BS Check: A ≠ L + E — imbalance in ${bsCheck.filter((c) => Math.abs(c.diff) >= 1).map((c) => c.year).join(", ")}`}
          </span>
          {!allBalanced && bsMismatchHint ? (
            <span className="text-[9px] text-slate-500 font-mono truncate" title={bsMismatchHint}>
              {bsMismatchHint}
            </span>
          ) : null}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {renderSection("Income Statement", "is", isRows, "text-emerald-400")}
        {renderSection("Balance Sheet", "bs", bsRows, "text-blue-400")}
        {renderSection(
          "Cash Flow Statement",
          "cfs",
          cfsRows,
          "text-violet-400",
          <>
            {wcScheduleCfsParity.missingInCfs.length > 0 ? (
              <div className="px-3 py-2 text-[10px] text-amber-100 bg-amber-950/30 border-b border-amber-500/30 flex items-start gap-2">
                <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <span className="font-medium">
                  Cash Flow is missing WC lines for: {wcScheduleCfsParity.missingInCfsLabels.join(", ")}. Add matching
                  lines under Change in Working Capital in the Statement Structure / Cash Flow builder so detail stays
                  in sync with Forecast Drivers.
                </span>
              </div>
            ) : null}
            <WcCfsExplainBanner />
          </>
        )}
      </div>
    </div>
  );
}
