"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import {
  storedToDisplay,
  getUnitLabel,
  getCurrencySymbol,
  type CurrencyUnit,
} from "@/lib/currency-utils";
import { computeRowValue } from "@/lib/calculations";
import { findRowInTree } from "@/lib/row-utils";
import { computeRevenueProjections } from "@/lib/revenue-projection-engine";
import {
  computeRevenueProjectionsV1,
  getArpuAnnualizationMultiplier,
  getCapacityUtilizationYieldFirstForecastYearDrivers,
  getContractsAcvFirstForecastYearDrivers,
  getCustomersArpuFirstForecastYearDrivers,
  getLocationsRevenuePerLocationFirstForecastYearDrivers,
  getPriceVolumeFirstForecastYearDrivers,
  getRevenuePerLocationAnnualizationMultiplier,
  getYieldAnnualizationMultiplier,
  projectCustomersArpuCustomersByYear,
  projectPriceVolumeUnitsByYear,
} from "@/lib/revenue-projection-engine-v1";
import type { ForecastRevenueNodeV1 } from "@/types/revenue-forecast-v1";
import { getRevenueForecastConfigV1RowsFingerprint } from "@/lib/revenue-forecast-v1-fingerprint";
import { detectCogsLinesFromIncomeStatement } from "@/lib/cogs-line-detection";
import {
  buildForecastableCogsLinesFromRevenue,
  computeCogsCostPerCustomerForecastByYear,
  computeCogsCostPerUnitForecastByYear,
  getCogsForecastConfigLinesFingerprint,
  hasPersistedCogsCpcConfig,
  hasPersistedCogsCpuConfig,
  hasPersistedCogsLineForecast,
  projectCostPerCustomerByYear,
  projectCostPerUnitByYear,
  resolveCustomersArpuParamsForCogsLinkedRow,
  resolveCogsCostPerCustomerGrowthPctByYear,
  resolveCogsCostPerUnitGrowthPctByYear,
  resolveCogsPctOfRevenueByYear,
} from "@/lib/cogs-forecast-v1";

/** Driver preview: unit counts only — no statement K/M scaling. */
function formatVolumeDriverCount(n: number): string {
  return new Intl.NumberFormat(undefined, {
    useGrouping: true,
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  }).format(n);
}

/** Driver preview: absolute currency per unit (not statement display unit). */
function formatAbsolutePricePerUnit(n: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${getCurrencySymbol(currencyCode)}${formatVolumeDriverCount(n)}`;
  }
}

/** Driver preview: absolute currency per customer/account/member. */
function formatAbsoluteArpu(n: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${getCurrencySymbol(currencyCode)}${formatVolumeDriverCount(n)}`;
  }
}

/** Driver preview: absolute currency per location (not statement display unit). */
function formatAbsoluteRevenuePerLocation(n: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${getCurrencySymbol(currencyCode)}${formatVolumeDriverCount(n)}`;
  }
}

/** Driver preview: utilization as a level (0–100%), not K/M scaled. */
function formatUtilizationLevelPct(n: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n)}%`;
}

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

/** Preview-only: indentation follows DFS tree depth only (not method/role). */
const PREVIEW_DEPTH_INDENT_PX = 22;
const PREVIEW_CHEVRON_SLOT_PX = 20;

type RevenuePreviewRowEntry = { row: Row; depth: number };

/** Same collapse visibility as main Revenue table (visual only). */
function isRevenuePreviewRowHiddenByAncestorCollapse(
  index: number,
  revenueRows: RevenuePreviewRowEntry[],
  collapsedRowIds: Set<string>
): boolean {
  const depth = revenueRows[index]?.depth ?? 0;
  let hidden = false;
  let currentDepth = depth;
  for (let j = index - 1; j >= 0; j--) {
    const prev = revenueRows[j]!;
    if (prev.depth < currentDepth) {
      if (collapsedRowIds.has(prev.row.id)) {
        hidden = true;
        break;
      }
      currentDepth = prev.depth;
    }
  }
  return hidden;
}

/** Fixed chevron column + tree-depth indent for label only; driver sublabel stays inside this row. */
function RevenuePreviewLineLabelCell(props: {
  depth: number;
  hasDescendants: boolean;
  isCollapsed: boolean;
  onToggleExpand: () => void;
  label: ReactNode;
  sublabel?: ReactNode;
}) {
  const { depth, hasDescendants, isCollapsed, onToggleExpand, label, sublabel } = props;
  return (
    <div className="flex items-start min-w-0">
      <div
        className="shrink-0 flex justify-center pt-0.5 text-slate-500 text-[10px] leading-none select-none"
        style={{ width: PREVIEW_CHEVRON_SLOT_PX, minWidth: PREVIEW_CHEVRON_SLOT_PX }}
        aria-hidden={!hasDescendants}
      >
        {hasDescendants ? (
          <button
            type="button"
            className="w-full min-h-[1.25rem] flex items-center justify-center rounded hover:bg-slate-800/60 text-slate-400 hover:text-slate-200"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? "▸" : "▾"}
          </button>
        ) : null}
      </div>
      <div
        className="min-w-0 flex-1"
        style={{ paddingLeft: depth * PREVIEW_DEPTH_INDENT_PX }}
      >
        <div className="leading-tight">
          {label}
          {sublabel ? <div className="mt-0.5">{sublabel}</div> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Forecast Drivers → Revenue: right-hand preview only.
 * Revenue hierarchy + historical actuals + projected revenue, and Revenue Growth.
 * Historical actuals are read via the same IS / computeRowValue path as the grid; not mutated.
 */
export default function ISBuildPreview() {
  const meta = useModelStore((s) => s.meta);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns || {});
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns || {});
  const forecastDriversSubTab = useModelStore((s) => s.forecastDriversSubTab ?? "revenue");

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
  const cogsForecastConfigV1 = useModelStore((s) => s.cogsForecastConfigV1);
  const cogsForecastLinesFingerprint = useMemo(
    () => getCogsForecastConfigLinesFingerprint(cogsForecastConfigV1),
    [cogsForecastConfigV1]
  );
  /** Nested row params (e.g. arpuBasis) must invalidate memos even if parent object identity were stable. */
  const revenueForecastV1RowsFingerprint = useModelStore((s) =>
    getRevenueForecastConfigV1RowsFingerprint(s.revenueForecastConfigV1)
  );
  const revenueForecastTreeV1 = useModelStore((s) => s.revenueForecastTreeV1 ?? []);

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
  const [revenueMethodSectionOpen, setRevenueMethodSectionOpen] = useState(true);
  const [collapsedRowIds, setCollapsedRowIds] = useState<Set<string>>(new Set());

  const historicalYears = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const lastHistoricYear = useMemo(
    () => historicalYears[historicalYears.length - 1] ?? "",
    [historicalYears]
  );
  /** Forecast years in the same order as preview columns (must match `years` E-columns for growth %). */
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
    revenueForecastV1RowsFingerprint,
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
   * Row-level historical actual for YoY bridge checks.
   * Uses only the row's own historical cell (no child aggregation, no fallback-to-zero hacks).
   */
  const getRowHistoricalActual = useMemo(() => {
    const is = incomeStatement ?? [];
    return (rowId: string, row: Row, year: string): number | null => {
      if (!year || !year.endsWith("A")) return null;
      const canonical = findRowInTree(is, rowId) ?? row;
      const raw = canonical?.values?.[year];
      if (raw === undefined || raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };
  }, [incomeStatement]);

  const hasHistoricalActualByRowId = useMemo(() => {
    const out: Record<string, boolean> = {};
    if (!lastHistoricYear) return out;
    for (const { row } of revenueRows) {
      const v = getRowHistoricalActual(row.id, row, lastHistoricYear);
      out[row.id] = v != null;
    }
    return out;
  }, [revenueRows, lastHistoricYear, getRowHistoricalActual]);

  const firstForecastYear = methodologyProjectionYears[0] ?? "";
  const currencyCode = meta?.currency ?? "USD";

  /** Price × Volume driver audit rows (same growth resolution as projection engine v1). */
  const priceVolumeDriverRows = useMemo(() => {
    const v1Config = revenueForecastConfigV1 ?? { rows: {} };
    const rowsCfg = v1Config.rows ?? {};
    if (projectionYears.length === 0) return [];
    const out: Array<{
      rowId: string;
      label: string;
      volumeUnitLabel?: string;
      metrics: NonNullable<ReturnType<typeof getPriceVolumeFirstForecastYearDrivers>>;
    }> = [];
    const seen = new Set<string>();
    const pushIfPv = (rowId: string, label: string) => {
      if (seen.has(rowId)) return;
      const cfg = rowsCfg[rowId];
      if (cfg?.forecastRole !== "independent_driver" || cfg.forecastMethod !== "price_volume") return;
      const params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      const m = getPriceVolumeFirstForecastYearDrivers(params, projectionYears);
      if (!m) return;
      seen.add(rowId);
      const vul = params.volumeUnitLabel;
      out.push({
        rowId,
        label,
        volumeUnitLabel: typeof vul === "string" && vul.trim() ? vul.trim() : undefined,
        metrics: m,
      });
    };
    pushIfPv("rev", incomeStatement?.find((r) => r.id === "rev")?.label ?? "Revenue");
    const walk = (nodes: ForecastRevenueNodeV1[]) => {
      for (const n of nodes) {
        pushIfPv(n.id, n.label);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(revenueForecastTreeV1);
    return out;
  }, [revenueForecastConfigV1, revenueForecastV1RowsFingerprint, revenueForecastTreeV1, projectionYears, incomeStatement]);

  const customersArpuDriverRows = useMemo(() => {
    const v1Config = revenueForecastConfigV1 ?? { rows: {} };
    const rowsCfg = v1Config.rows ?? {};
    if (projectionYears.length === 0) return [];
    const out: Array<{
      rowId: string;
      label: string;
      customerUnitLabel?: string;
      metrics: NonNullable<ReturnType<typeof getCustomersArpuFirstForecastYearDrivers>>;
    }> = [];
    const seen = new Set<string>();
    const pushIfCa = (rowId: string, label: string) => {
      if (seen.has(rowId)) return;
      const cfg = rowsCfg[rowId];
      if (cfg?.forecastRole !== "independent_driver" || cfg.forecastMethod !== "customers_arpu") return;
      const params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      const m = getCustomersArpuFirstForecastYearDrivers(params, projectionYears);
      if (!m) return;
      seen.add(rowId);
      const cul = params.customerUnitLabel;
      out.push({
        rowId,
        label,
        customerUnitLabel: typeof cul === "string" && cul.trim() ? cul.trim() : undefined,
        metrics: m,
      });
    };
    pushIfCa("rev", incomeStatement?.find((r) => r.id === "rev")?.label ?? "Revenue");
    const walk = (nodes: ForecastRevenueNodeV1[]) => {
      for (const n of nodes) {
        pushIfCa(n.id, n.label);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(revenueForecastTreeV1);
    return out;
  }, [revenueForecastConfigV1, revenueForecastV1RowsFingerprint, revenueForecastTreeV1, projectionYears, incomeStatement]);

  const locationsRevenuePerLocationDriverRows = useMemo(() => {
    const v1Config = revenueForecastConfigV1 ?? { rows: {} };
    const rowsCfg = v1Config.rows ?? {};
    if (projectionYears.length === 0) return [];
    const out: Array<{
      rowId: string;
      label: string;
      locationUnitLabel?: string;
      metrics: NonNullable<ReturnType<typeof getLocationsRevenuePerLocationFirstForecastYearDrivers>>;
    }> = [];
    const seen = new Set<string>();
    const pushIfLrpl = (rowId: string, label: string) => {
      if (seen.has(rowId)) return;
      const cfg = rowsCfg[rowId];
      if (
        cfg?.forecastRole !== "independent_driver" ||
        cfg.forecastMethod !== "locations_revenue_per_location"
      ) {
        return;
      }
      const params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      const m = getLocationsRevenuePerLocationFirstForecastYearDrivers(params, projectionYears);
      if (!m) return;
      seen.add(rowId);
      const lul = params.locationUnitLabel;
      out.push({
        rowId,
        label,
        locationUnitLabel: typeof lul === "string" && lul.trim() ? lul.trim() : undefined,
        metrics: m,
      });
    };
    pushIfLrpl("rev", incomeStatement?.find((r) => r.id === "rev")?.label ?? "Revenue");
    const walk = (nodes: ForecastRevenueNodeV1[]) => {
      for (const n of nodes) {
        pushIfLrpl(n.id, n.label);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(revenueForecastTreeV1);
    return out;
  }, [revenueForecastConfigV1, revenueForecastV1RowsFingerprint, revenueForecastTreeV1, projectionYears, incomeStatement]);

  const capacityUtilizationYieldDriverRows = useMemo(() => {
    const v1Config = revenueForecastConfigV1 ?? { rows: {} };
    const rowsCfg = v1Config.rows ?? {};
    if (projectionYears.length === 0) return [];
    const out: Array<{
      rowId: string;
      label: string;
      capacityUnitLabel?: string;
      metrics: NonNullable<ReturnType<typeof getCapacityUtilizationYieldFirstForecastYearDrivers>>;
    }> = [];
    const seen = new Set<string>();
    const pushIfCuy = (rowId: string, label: string) => {
      if (seen.has(rowId)) return;
      const cfg = rowsCfg[rowId];
      if (
        cfg?.forecastRole !== "independent_driver" ||
        cfg.forecastMethod !== "capacity_utilization_yield"
      ) {
        return;
      }
      const params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      const m = getCapacityUtilizationYieldFirstForecastYearDrivers(params, projectionYears);
      if (!m) return;
      seen.add(rowId);
      const cul = params.capacityUnitLabel;
      out.push({
        rowId,
        label,
        capacityUnitLabel: typeof cul === "string" && cul.trim() ? cul.trim() : undefined,
        metrics: m,
      });
    };
    pushIfCuy("rev", incomeStatement?.find((r) => r.id === "rev")?.label ?? "Revenue");
    const walk = (nodes: ForecastRevenueNodeV1[]) => {
      for (const n of nodes) {
        pushIfCuy(n.id, n.label);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(revenueForecastTreeV1);
    return out;
  }, [revenueForecastConfigV1, revenueForecastV1RowsFingerprint, revenueForecastTreeV1, projectionYears, incomeStatement]);

  const contractsAcvDriverRows = useMemo(() => {
    const v1Config = revenueForecastConfigV1 ?? { rows: {} };
    const rowsCfg = v1Config.rows ?? {};
    if (projectionYears.length === 0) return [];
    const out: Array<{
      rowId: string;
      label: string;
      contractUnitLabel?: string;
      metrics: NonNullable<ReturnType<typeof getContractsAcvFirstForecastYearDrivers>>;
    }> = [];
    const seen = new Set<string>();
    const pushIfCacv = (rowId: string, label: string) => {
      if (seen.has(rowId)) return;
      const cfg = rowsCfg[rowId];
      if (cfg?.forecastRole !== "independent_driver" || cfg.forecastMethod !== "contracts_acv") {
        return;
      }
      const params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
      const m = getContractsAcvFirstForecastYearDrivers(params, projectionYears);
      if (!m) return;
      seen.add(rowId);
      const cul = params.contractUnitLabel;
      out.push({
        rowId,
        label,
        contractUnitLabel: typeof cul === "string" && cul.trim() ? cul.trim() : undefined,
        metrics: m,
      });
    };
    pushIfCacv("rev", incomeStatement?.find((r) => r.id === "rev")?.label ?? "Revenue");
    const walk = (nodes: ForecastRevenueNodeV1[]) => {
      for (const n of nodes) {
        pushIfCacv(n.id, n.label);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(revenueForecastTreeV1);
    return out;
  }, [revenueForecastConfigV1, revenueForecastV1RowsFingerprint, revenueForecastTreeV1, projectionYears, incomeStatement]);

  /** Row-level method label + styling cue for driver-based methods in main revenue table. */
  const driverMethodByRowId = useMemo(() => {
    const rowsCfg = revenueForecastConfigV1?.rows ?? {};
    const out: Record<
      string,
      | "price_volume"
      | "customers_arpu"
      | "locations_revenue_per_location"
      | "capacity_utilization_yield"
      | "contracts_acv"
    > = {};
    const pushIfDriver = (rowId: string) => {
      const cfg = rowsCfg[rowId];
      if (cfg?.forecastRole !== "independent_driver") return;
      if (
        cfg.forecastMethod === "price_volume" ||
        cfg.forecastMethod === "customers_arpu" ||
        cfg.forecastMethod === "locations_revenue_per_location" ||
        cfg.forecastMethod === "capacity_utilization_yield" ||
        cfg.forecastMethod === "contracts_acv"
      ) {
        out[rowId] = cfg.forecastMethod;
      }
    };
    pushIfDriver("rev");
    const walk = (nodes: ForecastRevenueNodeV1[]) => {
      for (const n of nodes) {
        pushIfDriver(n.id);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(revenueForecastTreeV1);
    return out;
  }, [revenueForecastConfigV1, revenueForecastV1RowsFingerprint, revenueForecastTreeV1]);

  const openingBasisByRowId = useMemo(() => {
    const rowsCfg = revenueForecastConfigV1?.rows ?? {};
    const resolvedOpeningById: Record<string, number | null> = {};
    if (!lastHistoricYear || !firstForecastYear) return resolvedOpeningById;
    const topLevelNodes: ForecastRevenueNodeV1[] =
      revenueForecastTreeV1.length > 0
        ? revenueForecastTreeV1
        : (incomeStatement?.find((r) => r.id === "rev")?.children ?? []).map((c) => ({
            id: c.id,
            label: c.label,
            children: [],
            isForecastOnly: false,
          }));

    const resolveOpeningBasis = (
      node: ForecastRevenueNodeV1,
      parentOpeningBasis: number | null
    ): number | null => {
      if (resolvedOpeningById[node.id] !== undefined) return resolvedOpeningById[node.id];
      const cfg = rowsCfg[node.id];
      const params = (cfg?.forecastParameters ?? {}) as Record<string, unknown>;

      let value: number | null = null;
      if (cfg?.forecastRole === "allocation_of_parent") {
        const pct = Number(params.allocationPercent ?? 0);
        if (
          parentOpeningBasis != null &&
          Number.isFinite(parentOpeningBasis) &&
          Number.isFinite(pct)
        ) {
          value = parentOpeningBasis * (pct / 100);
        }
      } else if (cfg?.forecastRole === "derived_sum") {
        let sum = 0;
        let hasAny = false;
        for (const child of node.children ?? []) {
          const childBasis = resolveOpeningBasis(child, null);
          if (childBasis != null && Number.isFinite(childBasis)) {
            sum += childBasis;
            hasAny = true;
          }
        }
        value = hasAny ? sum : null;
      } else {
        if (cfg?.forecastMethod === "growth_rate") {
          const basis = String(params.startingBasis ?? "");
          const startingAmount = Number(params.startingAmount);
          if (basis === "starting_amount" && Number.isFinite(startingAmount)) {
            value = startingAmount;
          } else if (basis === "last_historical") {
            const hist = getRowHistoricalActual(node.id, { id: node.id, label: node.label, kind: "input", valueType: "currency", values: {}, children: [] }, lastHistoricYear);
            value = hist != null && Number.isFinite(hist) ? hist : null;
          }
        } else if (cfg?.forecastMethod === "fixed_value") {
          const valuesByYear = (params.valuesByYear ?? {}) as Record<string, number>;
          const byYearVal = Number(valuesByYear[firstForecastYear]);
          const flatVal = Number(params.value);
          if (Number.isFinite(byYearVal)) value = byYearVal;
          else if (Number.isFinite(flatVal)) value = flatVal;
        } else if (cfg?.forecastMethod === "price_volume") {
          const sv = Number(params.startingVolume);
          const sp = Number(params.startingPricePerUnit);
          if (Number.isFinite(sv) && Number.isFinite(sp) && sv > 0 && sp > 0) {
            value = sv * sp;
          }
        } else if (cfg?.forecastMethod === "customers_arpu") {
          const sc = Number(params.startingCustomers);
          const sa = Number(params.startingArpu);
          if (Number.isFinite(sc) && Number.isFinite(sa) && sc > 0 && sa > 0) {
            value = sc * sa * getArpuAnnualizationMultiplier(params);
          }
        } else if (cfg?.forecastMethod === "locations_revenue_per_location") {
          const sl = Number(params.startingLocations);
          const sr = Number(params.startingRevenuePerLocation);
          if (Number.isFinite(sl) && Number.isFinite(sr) && sl > 0 && sr > 0) {
            value = sl * sr * getRevenuePerLocationAnnualizationMultiplier(params);
          }
        } else if (cfg?.forecastMethod === "capacity_utilization_yield") {
          const sc = Number(params.startingCapacity);
          const su = Number(params.startingUtilizationPct);
          const sy = Number(params.startingYield);
          if (
            Number.isFinite(sc) &&
            Number.isFinite(su) &&
            Number.isFinite(sy) &&
            sc > 0 &&
            sy > 0 &&
            su >= 0 &&
            su <= 100
          ) {
            value = sc * (su / 100) * sy * getYieldAnnualizationMultiplier(params);
          }
        } else if (cfg?.forecastMethod === "contracts_acv") {
          const nC = Number(params.startingContracts);
          const nA = Number(params.startingAcv);
          if (Number.isFinite(nC) && Number.isFinite(nA) && nC > 0 && nA > 0) {
            value = nC * nA;
          }
        }
      }

      // If allocation basis needs the now-resolved parent basis, resolve from that path.
      if (cfg?.forecastRole === "allocation_of_parent" && value == null) {
        const pct = Number(params.allocationPercent ?? 0);
        if (
          parentOpeningBasis != null &&
          Number.isFinite(parentOpeningBasis) &&
          Number.isFinite(pct)
        ) {
          value = parentOpeningBasis * (pct / 100);
        }
      }

      // Always propagate resolved parent basis to allocation children.
      // This ensures allocation rows get opening basis even when parent has explicit manual/historical/flat base.
      if (
        node.children?.length &&
        node.children.some((c) => rowsCfg[c.id]?.forecastRole === "allocation_of_parent")
      ) {
        const parentForAllocation = value ?? parentOpeningBasis;
        let sum = 0;
        let hasAny = false;
        for (const child of node.children) {
          const cCfg = rowsCfg[child.id];
          if (cCfg?.forecastRole !== "allocation_of_parent") continue;
          const childBasis = resolveOpeningBasis(child, parentForAllocation);
          if (childBasis != null && Number.isFinite(childBasis)) {
            sum += childBasis;
            hasAny = true;
          }
        }
        // When parent has no own opening basis but allocation children resolved, inherit sum.
        if (value == null && hasAny) value = sum;
      }

      resolvedOpeningById[node.id] = value;
      return value;
    };

    const totalHistorical = getRowValueForYear("rev", lastHistoricYear, {
      id: "rev",
      label: "Revenue",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    });
    for (const topNode of topLevelNodes) {
      const topCfg = rowsCfg[topNode.id];
      let topBasis: number | null = null;
      if (topCfg?.forecastRole === "allocation_of_parent") {
        const revOpening =
          rowsCfg.rev?.forecastRole === "independent_driver"
            ? (() => {
                const revParams = (rowsCfg.rev?.forecastParameters ?? {}) as Record<string, unknown>;
                if (rowsCfg.rev?.forecastMethod === "growth_rate") {
                  if (String(revParams.startingBasis ?? "") === "starting_amount") {
                    const v = Number(revParams.startingAmount);
                    return Number.isFinite(v) ? v : null;
                  }
                  if (String(revParams.startingBasis ?? "") === "last_historical") {
                    const h = getRowHistoricalActual(
                      "rev",
                      { id: "rev", label: "Revenue", kind: "input", valueType: "currency", values: {}, children: [] },
                      lastHistoricYear
                    );
                    return h != null && Number.isFinite(h) ? h : null;
                  }
                } else if (rowsCfg.rev?.forecastMethod === "fixed_value") {
                  const byYear = (revParams.valuesByYear ?? {}) as Record<string, number>;
                  const byYearVal = Number(byYear[firstForecastYear]);
                  const flatVal = Number(revParams.value);
                  if (Number.isFinite(byYearVal)) return byYearVal;
                  if (Number.isFinite(flatVal)) return flatVal;
                } else if (rowsCfg.rev?.forecastMethod === "price_volume") {
                  const sv = Number(revParams.startingVolume);
                  const sp = Number(revParams.startingPricePerUnit);
                  if (Number.isFinite(sv) && Number.isFinite(sp) && sv > 0 && sp > 0) return sv * sp;
                } else if (rowsCfg.rev?.forecastMethod === "customers_arpu") {
                  const sc = Number(revParams.startingCustomers);
                  const sa = Number(revParams.startingArpu);
                  if (Number.isFinite(sc) && Number.isFinite(sa) && sc > 0 && sa > 0) {
                    return sc * sa * getArpuAnnualizationMultiplier(revParams);
                  }
                } else if (rowsCfg.rev?.forecastMethod === "locations_revenue_per_location") {
                  const sl = Number(revParams.startingLocations);
                  const sr = Number(revParams.startingRevenuePerLocation);
                  if (Number.isFinite(sl) && Number.isFinite(sr) && sl > 0 && sr > 0) {
                    return sl * sr * getRevenuePerLocationAnnualizationMultiplier(revParams);
                  }
                } else if (rowsCfg.rev?.forecastMethod === "capacity_utilization_yield") {
                  const sc = Number(revParams.startingCapacity);
                  const su = Number(revParams.startingUtilizationPct);
                  const sy = Number(revParams.startingYield);
                  if (
                    Number.isFinite(sc) &&
                    Number.isFinite(su) &&
                    Number.isFinite(sy) &&
                    sc > 0 &&
                    sy > 0 &&
                    su >= 0 &&
                    su <= 100
                  ) {
                    return sc * (su / 100) * sy * getYieldAnnualizationMultiplier(revParams);
                  }
                } else if (rowsCfg.rev?.forecastMethod === "contracts_acv") {
                  const nC = Number(revParams.startingContracts);
                  const nA = Number(revParams.startingAcv);
                  if (Number.isFinite(nC) && Number.isFinite(nA) && nC > 0 && nA > 0) {
                    return nC * nA;
                  }
                }
                return null;
              })()
            : totalHistorical;
        topBasis = resolveOpeningBasis(topNode, revOpening);
      } else {
        topBasis = resolveOpeningBasis(topNode, null);
      }
      resolvedOpeningById[topNode.id] =
        topBasis != null && Number.isFinite(topBasis) ? topBasis : null;
    }

    const topIds = topLevelNodes.map((n) => n.id);
    if (resolvedOpeningById["rev"] === undefined) {
      const revCfg = rowsCfg.rev;
      if (revCfg?.forecastRole === "independent_driver") {
        const revParams = (revCfg.forecastParameters ?? {}) as Record<string, unknown>;
        let revOpening: number | null = null;
        if (revCfg.forecastMethod === "growth_rate") {
          if (String(revParams.startingBasis ?? "") === "starting_amount") {
            const v = Number(revParams.startingAmount);
            revOpening = Number.isFinite(v) ? v : null;
          } else if (String(revParams.startingBasis ?? "") === "last_historical") {
            const h = getRowHistoricalActual(
              "rev",
              { id: "rev", label: "Revenue", kind: "input", valueType: "currency", values: {}, children: [] },
              lastHistoricYear
            );
            revOpening = h != null && Number.isFinite(h) ? h : null;
          }
        } else if (revCfg.forecastMethod === "fixed_value") {
          const byYear = (revParams.valuesByYear ?? {}) as Record<string, number>;
          const byYearVal = Number(byYear[firstForecastYear]);
          const flatVal = Number(revParams.value);
          if (Number.isFinite(byYearVal)) revOpening = byYearVal;
          else if (Number.isFinite(flatVal)) revOpening = flatVal;
        } else if (revCfg.forecastMethod === "price_volume") {
          const sv = Number(revParams.startingVolume);
          const sp = Number(revParams.startingPricePerUnit);
          if (Number.isFinite(sv) && Number.isFinite(sp) && sv > 0 && sp > 0) revOpening = sv * sp;
        } else if (revCfg.forecastMethod === "customers_arpu") {
          const sc = Number(revParams.startingCustomers);
          const sa = Number(revParams.startingArpu);
          if (Number.isFinite(sc) && Number.isFinite(sa) && sc > 0 && sa > 0) {
            revOpening = sc * sa * getArpuAnnualizationMultiplier(revParams);
          }
        } else if (revCfg.forecastMethod === "locations_revenue_per_location") {
          const sl = Number(revParams.startingLocations);
          const sr = Number(revParams.startingRevenuePerLocation);
          if (Number.isFinite(sl) && Number.isFinite(sr) && sl > 0 && sr > 0) {
            revOpening = sl * sr * getRevenuePerLocationAnnualizationMultiplier(revParams);
          }
        } else if (revCfg.forecastMethod === "capacity_utilization_yield") {
          const sc = Number(revParams.startingCapacity);
          const su = Number(revParams.startingUtilizationPct);
          const sy = Number(revParams.startingYield);
          if (
            Number.isFinite(sc) &&
            Number.isFinite(su) &&
            Number.isFinite(sy) &&
            sc > 0 &&
            sy > 0 &&
            su >= 0 &&
            su <= 100
          ) {
            revOpening = sc * (su / 100) * sy * getYieldAnnualizationMultiplier(revParams);
          }
        } else if (revCfg.forecastMethod === "contracts_acv") {
          const nC = Number(revParams.startingContracts);
          const nA = Number(revParams.startingAcv);
          if (Number.isFinite(nC) && Number.isFinite(nA) && nC > 0 && nA > 0) {
            revOpening = nC * nA;
          }
        }
        resolvedOpeningById["rev"] = revOpening;
      } else if (revCfg?.forecastRole === "derived_sum") {
        let sum = 0;
        let hasAny = false;
        for (const id of topIds) {
          const b = resolvedOpeningById[id];
          if (b != null && Number.isFinite(b)) {
            sum += b;
            hasAny = true;
          }
        }
        resolvedOpeningById["rev"] = hasAny ? sum : null;
      }
    }

    return resolvedOpeningById;
  }, [
    firstForecastYear,
    incomeStatement,
    lastHistoricYear,
    revenueForecastConfigV1,
    revenueForecastV1RowsFingerprint,
    revenueForecastTreeV1,
    getRowHistoricalActual,
    getRowValueForYear,
  ]);

  const openingBasisCheck = useMemo(() => {
    if (!lastHistoricYear || !firstForecastYear) {
      return null;
    }
    const totalHistorical = getRowValueForYear("rev", lastHistoricYear, {
      id: "rev",
      label: "Revenue",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    });
    const topLevelContributorIds =
      revenueForecastTreeV1.length > 0
        ? revenueForecastTreeV1.map((n) => n.id)
        : (incomeStatement?.find((r) => r.id === "rev")?.children ?? []).map((c) => c.id);
    let startingBaseSum = 0;
    for (const rowId of topLevelContributorIds) {
      const basis = openingBasisByRowId[rowId];
      if (basis != null && Number.isFinite(basis)) startingBaseSum += basis;
    }

    const difference = startingBaseSum - totalHistorical;
    const tolerance = 1;
    const reconciled = Number.isFinite(difference) && Math.abs(difference) < tolerance;

    return {
      totalHistorical,
      startingBaseSum,
      difference,
      reconciled,
      tolerance,
    };
  }, [
    lastHistoricYear,
    firstForecastYear,
    revenueForecastTreeV1,
    incomeStatement,
    revenueForecastV1RowsFingerprint,
    openingBasisByRowId,
    getRowValueForYear,
  ]);

  /**
   * Revenue Growth % (preview only).
   * - First forecast year: vs last actual when present on the row; else vs opening base when present.
   * - Later forecast years: vs prior forecast year (projected values).
   */
  const revenueGrowthTable = useMemo(() => {
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
      let firstYearGrowthBasis: "historical" | "opening_base" | null = null;

      for (let i = 0; i < methodologyProjectionYears.length; i++) {
        const y = methodologyProjectionYears[i]!;
        const currVal = readProjected(row.id, y);
        let prevVal: number | null = null;
        let basisForFirstYear: "historical" | "opening_base" | null = null;

        if (i === 0) {
          const ly = lastHistoricYear;
          if (ly && hasHistoricalActualByRowId[row.id]) {
            const h = getRowHistoricalActual(row.id, row, ly);
            if (h != null && Number.isFinite(h)) {
              prevVal = h;
              basisForFirstYear = "historical";
            }
          }
          if (prevVal == null) {
            const ob = openingBasisByRowId[row.id];
            if (ob != null && Number.isFinite(ob)) {
              prevVal = ob;
              basisForFirstYear = "opening_base";
            }
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
          if (i === 0 && basisForFirstYear) {
            firstYearGrowthBasis = basisForFirstYear;
          }
        } else {
          yoyByYear[y] = null;
        }
      }
      return {
        rowId: row.id,
        label: row.label,
        depth,
        yoyByYear,
        firstYearGrowthBasis,
      };
    });
  }, [
    revenueRows,
    methodologyProjectionYears,
    lastHistoricYear,
    projectedValues,
    hasHistoricalActualByRowId,
    getRowHistoricalActual,
    openingBasisByRowId,
  ]);

  /** O(1) lookup so Revenue Growth rows mirror main table order + visibility without duplicating math. */
  const revenueGrowthByRowId = useMemo(() => {
    const m = new Map<string, (typeof revenueGrowthTable)[number]>();
    for (const g of revenueGrowthTable) {
      m.set(g.rowId, g);
    }
    return m;
  }, [revenueGrowthTable]);

  /** Subtle column tint for first forecast year (visual only). */
  const forecastStartColClass = (y: string) =>
    firstForecastYear && y === firstForecastYear ? "bg-slate-800/40" : "";

  const detectedCogsLines = useMemo(
    () => detectCogsLinesFromIncomeStatement(incomeStatement ?? []),
    [incomeStatement]
  );
  const detectedCogsOnly = useMemo(
    () => detectedCogsLines.filter((x) => x.detectedBucket === "cogs"),
    [detectedCogsLines]
  );
  const detectedCogsReview = useMemo(
    () => detectedCogsLines.filter((x) => x.detectedBucket === "review"),
    [detectedCogsLines]
  );

  const forecastableCogsLines = useMemo(
    () => buildForecastableCogsLinesFromRevenue(revenueForecastTreeV1 ?? [], revenueForecastConfigV1?.rows ?? {}),
    [revenueForecastTreeV1, revenueForecastConfigV1, revenueForecastV1RowsFingerprint]
  );
  const cogsValueByLineByYear = useMemo(() => {
    const rowsCfg = revenueForecastConfigV1?.rows ?? {};
    const out: Record<string, Record<string, number>> = {};
    for (const line of forecastableCogsLines) {
      const cfg = cogsForecastConfigV1?.lines?.[line.lineId];
      if (!cfg?.forecastMethod) continue;
      if (cfg.forecastMethod === "pct_of_revenue") {
        const params = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
        const pctByYear = resolveCogsPctOfRevenueByYear(params, projectionYears);
        const vals: Record<string, number> = {};
        for (const y of projectionYears) {
          const rev = Number(projectedValues[line.linkedRevenueRowId]?.[y]);
          const pct = Number(pctByYear[y]);
          if (Number.isFinite(rev) && Number.isFinite(pct)) {
            vals[y] = rev * (pct / 100);
          }
        }
        out[line.lineId] = vals;
        continue;
      }
      if (cfg.forecastMethod === "cost_per_unit") {
        const revCfg = rowsCfg[line.linkedRevenueRowId];
        const revParams = (revCfg?.forecastParameters ?? {}) as Record<string, unknown>;
        const volByY =
          revCfg?.forecastRole === "independent_driver" && revCfg.forecastMethod === "price_volume"
            ? projectPriceVolumeUnitsByYear(revParams, projectionYears)
            : null;
        const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
        out[line.lineId] = computeCogsCostPerUnitForecastByYear(cogsParams, volByY, projectionYears);
        continue;
      }
      if (cfg.forecastMethod === "cost_per_customer") {
        const revParams = resolveCustomersArpuParamsForCogsLinkedRow(
          line.linkedRevenueRowId,
          rowsCfg,
          revenueForecastTreeV1 ?? []
        );
        const custByY = revParams ? projectCustomersArpuCustomersByYear(revParams, projectionYears) : null;
        const cogsParams = (cfg.forecastParameters ?? {}) as Record<string, unknown>;
        out[line.lineId] = computeCogsCostPerCustomerForecastByYear(cogsParams, custByY, projectionYears);
      }
    }
    return out;
  }, [
    forecastableCogsLines,
    cogsForecastLinesFingerprint,
    projectionYears,
    projectedValues,
    revenueForecastConfigV1,
    revenueForecastV1RowsFingerprint,
    revenueForecastTreeV1,
  ]);
  const cogsConfiguredLineCount = useMemo(
    () =>
      forecastableCogsLines.filter((l) =>
        hasPersistedCogsLineForecast(cogsForecastConfigV1?.lines?.[l.lineId], projectionYears)
      ).length,
    [forecastableCogsLines, cogsForecastLinesFingerprint, projectionYears]
  );

  const costPerUnitDriverAuditRows = useMemo(() => {
    if (projectionYears.length === 0) return [];
    const fy = projectionYears[0]!;
    const rowsCfg = revenueForecastConfigV1?.rows ?? {};
    const out: Array<{
      lineId: string;
      lineLabel: string;
      linkedRevenueLabel: string;
      startingVolume: number;
      startingCostPerUnit: number;
      firstYearVolume: number | null;
      firstYearCostPerUnit: number | null;
    }> = [];
    for (const line of forecastableCogsLines) {
      const lc = cogsForecastConfigV1?.lines?.[line.lineId];
      if (!lc || lc.forecastMethod !== "cost_per_unit" || !hasPersistedCogsCpuConfig(lc, projectionYears)) continue;
      const revCfg = rowsCfg[line.linkedRevenueRowId];
      if (revCfg?.forecastRole !== "independent_driver" || revCfg.forecastMethod !== "price_volume") continue;
      const revP = (revCfg.forecastParameters ?? {}) as Record<string, unknown>;
      const sv = Number(revP.startingVolume);
      const sp = Number(revP.startingPricePerUnit);
      if (!Number.isFinite(sv) || !Number.isFinite(sp) || sv <= 0 || sp <= 0) continue;
      const volByY = projectPriceVolumeUnitsByYear(revP, projectionYears);
      const cogsP = (lc.forecastParameters ?? {}) as Record<string, unknown>;
      const cpuStart = Number(cogsP.startingCostPerUnit);
      if (!Number.isFinite(cpuStart) || cpuStart <= 0) continue;
      const growth = resolveCogsCostPerUnitGrowthPctByYear(cogsP, projectionYears);
      if (Object.keys(growth).length === 0) continue;
      const cpuByY = projectCostPerUnitByYear(cpuStart, growth, projectionYears);
      out.push({
        lineId: line.lineId,
        lineLabel: line.lineLabel,
        linkedRevenueLabel: line.lineLabel,
        startingVolume: sv,
        startingCostPerUnit: cpuStart,
        firstYearVolume: volByY?.[fy] ?? null,
        firstYearCostPerUnit: cpuByY[fy] ?? null,
      });
    }
    return out;
  }, [
    forecastableCogsLines,
    cogsForecastLinesFingerprint,
    projectionYears,
    revenueForecastConfigV1,
    revenueForecastV1RowsFingerprint,
  ]);

  const costPerCustomerDriverAuditRows = useMemo(() => {
    if (projectionYears.length === 0) return [];
    const fy = projectionYears[0]!;
    const rowsCfg = revenueForecastConfigV1?.rows ?? {};
    const tree = revenueForecastTreeV1 ?? [];
    const out: Array<{
      lineId: string;
      lineLabel: string;
      linkedRevenueLabel: string;
      arpuBasisLabel: string;
      startingCustomers: number;
      startingCostPerCustomer: number;
      firstYearCustomers: number | null;
      firstYearCostPerCustomer: number | null;
    }> = [];
    for (const line of forecastableCogsLines) {
      const lc = cogsForecastConfigV1?.lines?.[line.lineId];
      if (!lc || lc.forecastMethod !== "cost_per_customer" || !hasPersistedCogsCpcConfig(lc, projectionYears))
        continue;
      const revP = resolveCustomersArpuParamsForCogsLinkedRow(line.linkedRevenueRowId, rowsCfg, tree);
      if (!revP) continue;
      const sc = Number(revP.startingCustomers);
      const sa = Number(revP.startingArpu);
      if (!Number.isFinite(sc) || !Number.isFinite(sa) || sc <= 0 || sa <= 0) continue;
      const custByY = projectCustomersArpuCustomersByYear(revP, projectionYears);
      const cogsP = (lc.forecastParameters ?? {}) as Record<string, unknown>;
      const cpcStart = Number(cogsP.startingCostPerCustomer);
      if (!Number.isFinite(cpcStart) || cpcStart <= 0) continue;
      const growth = resolveCogsCostPerCustomerGrowthPctByYear(cogsP, projectionYears);
      if (Object.keys(growth).length === 0) continue;
      const cpcByY = projectCostPerCustomerByYear(cpcStart, growth, projectionYears);
      const first = getCustomersArpuFirstForecastYearDrivers(revP, projectionYears);
      const arpuBasisLabel = first?.arpuBasis === "monthly" ? "Monthly" : "Annual";
      out.push({
        lineId: line.lineId,
        lineLabel: line.lineLabel,
        linkedRevenueLabel: line.lineLabel,
        arpuBasisLabel,
        startingCustomers: sc,
        startingCostPerCustomer: cpcStart,
        firstYearCustomers: custByY?.[fy] ?? null,
        firstYearCostPerCustomer: cpcByY[fy] ?? null,
      });
    }
    return out;
  }, [
    forecastableCogsLines,
    cogsForecastLinesFingerprint,
    projectionYears,
    revenueForecastConfigV1,
    revenueForecastV1RowsFingerprint,
    revenueForecastTreeV1,
  ]);

  const totalCogsByYear = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const y of projectionYears) {
      let sum = 0;
      let has = false;
      for (const line of forecastableCogsLines) {
        const v = cogsValueByLineByYear[line.lineId]?.[y];
        if (v != null && Number.isFinite(v)) {
          sum += v;
          has = true;
        }
      }
      out[y] = has ? sum : null;
    }
    return out;
  }, [projectionYears, forecastableCogsLines, cogsValueByLineByYear]);

  if (forecastDriversSubTab === "operating_costs") {
    return (
      <section className="h-full w-full rounded-xl border border-slate-800 bg-slate-950/50 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 p-4 pb-2 border-b border-slate-800">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">COGS & Operating Expenses Preview</h2>
              <p className="text-xs text-slate-500">
                <span className="text-slate-300">Forecast Drivers · COGS & Operating Expenses</span>
                {" · "}
                <span className="text-slate-300">{meta?.companyName ?? "—"}</span>
                {" · "}
                <span className="text-slate-300 uppercase">{meta?.modelType ?? "—"}</span>
              </p>
            </div>
            <div className="text-xs text-slate-500">
              COGS phase preview · Years: <span className="text-slate-300">{years.length}</span>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-auto p-4 space-y-4">
          <div className="rounded-md border border-slate-700 bg-slate-900/40">
            <div className="px-3 py-2 border-b border-slate-800 text-sm font-semibold text-slate-100">
              Revenue (read-only context)
            </div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="w-[280px] px-3.5 py-2.5 text-left font-semibold text-slate-300">Line Item</th>
                  {years.map((y) => (
                    <th key={y} className="px-3.5 py-2.5 text-right font-semibold text-slate-400">
                      {y}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(revenueRows.length === 0 ? [{ row: { id: "rev", label: "Revenue", kind: "input", valueType: "currency", values: {}, children: [] } as Row, depth: 0 }] : revenueRows).map(
                  ({ row, depth }, index) => {
                    if (isRevenuePreviewRowHiddenByAncestorCollapse(index, revenueRows, collapsedRowIds)) return null;
                    return (
                      <tr key={`cogs-tab-rev-${row.id}`} className="border-b border-slate-900">
                        <td className={`px-3.5 py-2.5 ${depth === 0 ? "text-slate-100 font-semibold" : "text-slate-300"}`}>
                          <RevenuePreviewLineLabelCell
                            depth={depth}
                            hasDescendants={false}
                            isCollapsed={false}
                            onToggleExpand={() => {}}
                            label={row.label}
                          />
                        </td>
                        {years.map((y) => {
                          const val = y.endsWith("A")
                            ? getRowValueForYear(row.id, y, row)
                            : projectedValues[row.id]?.[y] ?? null;
                          return (
                            <td key={`${row.id}-${y}`} className="px-3.5 py-2.5 text-right tabular-nums text-slate-300">
                              {val != null && Number.isFinite(Number(val))
                                ? formatAccounting(Number(val), unit, showDecimals)
                                : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>

          {costPerUnitDriverAuditRows.length > 0 ? (
            <div className="rounded-md border border-slate-700 bg-slate-900/40">
              <div className="px-3 py-2 border-b border-slate-800 text-sm font-semibold text-slate-100">
                Cost per Unit Drivers
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs min-w-[720px]">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-300">Line</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-300">Linked revenue line</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-300">Starting volume</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-300">Starting cost / unit</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-300">
                        First forecast-year volume
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-300">
                        First forecast-year cost / unit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {costPerUnitDriverAuditRows.map((r) => (
                      <tr key={r.lineId} className="border-b border-slate-900">
                        <td className="px-3 py-2 text-slate-200">{r.lineLabel}</td>
                        <td className="px-3 py-2 text-slate-400">{r.linkedRevenueLabel}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                          {formatVolumeDriverCount(r.startingVolume)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                          {formatAbsolutePricePerUnit(r.startingCostPerUnit, currencyCode)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                          {r.firstYearVolume != null && Number.isFinite(r.firstYearVolume)
                            ? formatVolumeDriverCount(r.firstYearVolume)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                          {r.firstYearCostPerUnit != null && Number.isFinite(r.firstYearCostPerUnit)
                            ? formatAbsolutePricePerUnit(r.firstYearCostPerUnit, currencyCode)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {costPerCustomerDriverAuditRows.length > 0 ? (
            <div className="rounded-md border border-slate-700 bg-slate-900/40">
              <div className="px-3 py-2 border-b border-slate-800 text-sm font-semibold text-slate-100">
                Cost per Customer Drivers
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs min-w-[840px]">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-300">Line</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-300">Linked revenue line</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-300">Starting customers</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-300">Starting cost / customer</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-300">
                        First forecast-year customers
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-300">
                        First forecast-year cost / customer
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {costPerCustomerDriverAuditRows.map((r) => (
                      <tr key={r.lineId} className="border-b border-slate-900">
                        <td className="px-3 py-2 text-slate-200 align-top">
                          <div>{r.lineLabel}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Customers · {r.arpuBasisLabel} ARPU
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-400 align-top">{r.linkedRevenueLabel}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200 align-top">
                          {formatVolumeDriverCount(r.startingCustomers)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200 align-top">
                          {formatAbsolutePricePerUnit(r.startingCostPerCustomer, currencyCode)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200 align-top">
                          {r.firstYearCustomers != null && Number.isFinite(r.firstYearCustomers)
                            ? formatVolumeDriverCount(r.firstYearCustomers)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200 align-top">
                          {r.firstYearCostPerCustomer != null && Number.isFinite(r.firstYearCostPerCustomer)
                            ? formatAbsolutePricePerUnit(r.firstYearCostPerCustomer, currencyCode)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {openingBasisCheck ? (
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-2">
              <h3 className="text-sm font-bold text-slate-100">Opening Revenue Bridge Check</h3>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  <tr className="border-b border-slate-800">
                    <td className="py-2 text-slate-300">
                      Last Historical Revenue ({lastHistoricYear ?? "—"})
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-100">
                      {formatAccounting(openingBasisCheck.totalHistorical, unit, showDecimals)}
                    </td>
                  </tr>
                  <tr className="border-b border-slate-800">
                    <td className="py-2 text-slate-300">Sum of Opening Base Inputs (pre-growth)</td>
                    <td className="py-2 text-right tabular-nums text-slate-100">
                      {formatAccounting(openingBasisCheck.startingBaseSum, unit, showDecimals)}
                    </td>
                  </tr>
                  <tr className="border-b border-slate-800">
                    <td className="py-2 text-slate-300">Difference</td>
                    <td className="py-2 text-right tabular-nums text-slate-100">
                      {formatAccounting(openingBasisCheck.difference, unit, showDecimals)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 text-slate-400">
                      Status (tolerance: {openingBasisCheck.tolerance})
                    </td>
                    <td
                      className={`py-2 text-right font-semibold ${
                        openingBasisCheck.reconciled ? "text-emerald-300" : "text-amber-300"
                      }`}
                    >
                      {openingBasisCheck.reconciled ? "Reconciled" : "Not Reconciled"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="rounded-md border border-slate-700 bg-slate-900/40">
            <div className="px-3 py-2 border-b border-slate-800 text-sm font-semibold text-slate-100">COGS</div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="w-[280px] px-3.5 py-2.5 text-left font-semibold text-slate-300">Line Item</th>
                  {years.map((y) => (
                    <th key={`cogs-h-${y}`} className="px-3.5 py-2.5 text-right font-semibold text-slate-400">
                      {y}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {forecastableCogsLines.length === 0 ? (
                  <tr>
                    <td colSpan={1 + years.length} className="px-3 py-5 text-center text-slate-500">
                      No forecastable COGS lines yet.
                    </td>
                  </tr>
                ) : (
                  forecastableCogsLines.map((line) => (
                    <tr key={line.lineId} className="border-b border-slate-900">
                      <td className="px-3.5 py-2.5 text-slate-300">
                        <div>{line.lineLabel}</div>
                        <div className="text-[10px] text-slate-500">Linked to revenue: {line.lineLabel}</div>
                      </td>
                      {years.map((y) => {
                        if (y.endsWith("A")) {
                          return (
                            <td key={`${line.lineId}-${y}`} className="px-3.5 py-2.5 text-right tabular-nums text-slate-500">
                              —
                            </td>
                          );
                        }
                        const val = cogsValueByLineByYear[line.lineId]?.[y];
                        return (
                          <td key={`${line.lineId}-${y}`} className="px-3.5 py-2.5 text-right tabular-nums text-slate-300">
                            {val != null && Number.isFinite(Number(val))
                              ? formatAccounting(Number(val), unit, showDecimals)
                              : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
                <tr className="border-t border-slate-700">
                  <td className="px-3.5 py-2.5 font-semibold text-slate-200">Total COGS</td>
                  {years.map((y) => {
                    const total = y.endsWith("A") ? null : totalCogsByYear[y];
                    return (
                      <td key={`total-cogs-${y}`} className="px-3.5 py-2.5 text-right font-semibold text-slate-300">
                        {total != null ? formatAccounting(total, unit, showDecimals) : "—"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
            {forecastableCogsLines.length > 0 && cogsConfiguredLineCount < forecastableCogsLines.length ? (
              <div className="px-3 pb-2 text-[10px] text-amber-300/90">
                {forecastableCogsLines.length - cogsConfiguredLineCount} of {forecastableCogsLines.length} forecastable COGS lines are still unconfigured.
              </div>
            ) : null}
          </div>

          {detectedCogsOnly.length > 0 ? (
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <h3 className="text-sm font-semibold text-slate-100 mb-2">Historical COGS Context</h3>
              <div className="space-y-1.5 text-xs">
                {detectedCogsOnly.map((line) => (
                  <p key={`ctx-${line.sourceHistoricalLineId}`} className="text-slate-400">
                    <span className="text-slate-300">{line.lineLabel}</span> — {line.detectionReason}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {detectedCogsReview.length > 0 ? (
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <h3 className="text-sm font-semibold text-slate-100 mb-2">Review Items</h3>
              <div className="space-y-1.5 text-xs">
                {detectedCogsReview.map((line) => (
                  <p key={`review-${line.sourceHistoricalLineId}`} className="text-slate-400">
                    <span className="text-slate-300">{line.lineLabel}</span> — {line.detectionReason}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-md border border-slate-700 bg-slate-900/40">
            <div className="px-3 py-2 border-b border-slate-800 text-sm font-semibold text-slate-100">
              Gross Profit
            </div>
            <table className="w-full border-collapse text-xs">
              <tbody>
                <tr>
                  <td className="w-[280px] px-3.5 py-2.5 text-slate-300">Revenue less configured COGS</td>
                  {years.map((y) => {
                    const revenue = y.endsWith("A") ? null : Number(projectedValues.rev?.[y]);
                    const totalCogs = y.endsWith("A") ? null : totalCogsByYear[y];
                    const gp =
                      revenue != null && Number.isFinite(revenue) && totalCogs != null
                        ? revenue - totalCogs
                        : null;
                    return (
                      <td key={`gp-${y}`} className="px-3.5 py-2.5 text-right tabular-nums text-slate-300">
                        {gp != null ? formatAccounting(gp, unit, showDecimals) : "—"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-slate-700 bg-slate-900/40">
            <div className="px-3 py-2 border-b border-slate-800 text-sm font-semibold text-slate-100">
              Gross Margin %
            </div>
            <table className="w-full border-collapse text-xs">
              <tbody>
                <tr>
                  <td className="w-[280px] px-3.5 py-2.5 text-slate-300">Gross Profit / Revenue</td>
                  {years.map((y) => {
                    const revenue = y.endsWith("A") ? null : Number(projectedValues.rev?.[y]);
                    const totalCogs = y.endsWith("A") ? null : totalCogsByYear[y];
                    const gp =
                      revenue != null && Number.isFinite(revenue) && totalCogs != null
                        ? revenue - totalCogs
                        : null;
                    const gm =
                      gp != null && revenue != null && Number.isFinite(revenue) && revenue !== 0
                        ? (gp / revenue) * 100
                        : null;
                    return (
                      <td key={`gm-${y}`} className="px-3.5 py-2.5 text-right tabular-nums text-slate-300">
                        {gm != null
                          ? `${new Intl.NumberFormat(undefined, {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            }).format(gm)}%`
                          : "—"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  if (forecastDriversSubTab !== "revenue") {
    return (
      <section className="h-full w-full rounded-xl border border-slate-800 bg-slate-950/50 flex flex-col overflow-hidden p-6">
        <h2 className="text-sm font-semibold text-slate-100 mb-1">Forecast Drivers</h2>
        <p className="text-xs text-slate-400 max-w-md">
          Open the <span className="text-slate-200 font-medium">Revenue</span> tab to see the{" "}
          <span className="text-slate-200 font-medium">Revenue Forecast Preview</span>.
        </p>
      </section>
    );
  }

  return (
    <section className="h-full w-full rounded-xl border border-slate-800 bg-slate-950/50 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 p-4 pb-2 border-b border-slate-800">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Revenue Forecast Preview
            </h2>
            <p className="text-xs text-slate-500">
              <span className="text-slate-300">Forecast Drivers · Revenue</span>
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
            Actuals + forecast · Years:{" "}
            <span className="text-slate-300">{years.length}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-auto p-4">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-950 z-10">
            <tr className="border-b border-slate-800">
              <th className="w-[280px] px-3.5 py-2.5 text-left font-semibold text-slate-300">
                Line Item
              </th>
              {years.map((y) => (
                <th
                  key={y}
                  className={`px-3.5 py-2.5 text-right ${
                    firstForecastYear && y === firstForecastYear
                      ? `${forecastStartColClass(y)} font-medium text-slate-300`
                      : "font-semibold text-slate-400"
                  }`}
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
                      Revenue
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
                  const isForecastOnlyBase = !!lastHistoricYear && !hasHistoricalActualByRowId[row.id];
                  // Determine if this row has descendants (for collapse toggle)
                  let hasDescendants = false;
                  for (let j = index + 1; j < revenueRows.length; j++) {
                    if (revenueRows[j].depth <= depth) break;
                    hasDescendants = true;
                    break;
                  }
                  if (isRevenuePreviewRowHiddenByAncestorCollapse(index, revenueRows, collapsedRowIds)) {
                    return null;
                  }

                  const depthLabelClass =
                    depth === 0
                      ? "text-slate-100 font-semibold"
                      : depth === 1
                        ? "text-slate-200 font-medium"
                        : "text-slate-400 font-normal";
                  const depthValueClass =
                    depth === 0
                      ? "text-slate-100 font-semibold"
                      : depth === 1
                        ? "text-slate-200 font-medium"
                        : "text-slate-400 font-normal";
                  const isCollapsed = collapsedRowIds.has(row.id);

                  const driverMethod = driverMethodByRowId[row.id];
                  const toggleRowExpand = () => {
                    if (!hasDescendants) return;
                    setCollapsedRowIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    });
                  };
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-900 hover:bg-slate-900/40 ${
                        row.id === "rev" ? "border-t border-slate-700/40" : ""
                      } ${driverMethod ? "bg-sky-950/10" : ""}`}
                    >
                      <td
                        className={`pl-3 pr-3.5 py-2.5 align-top ${depthLabelClass} ${
                          depth > 0 ? "bg-slate-900/25" : ""
                        } ${driverMethod ? "border-l-2 border-sky-500/40" : ""}`}
                      >
                        <RevenuePreviewLineLabelCell
                          depth={depth}
                          hasDescendants={hasDescendants}
                          isCollapsed={isCollapsed}
                          onToggleExpand={toggleRowExpand}
                          label={row.label}
                          sublabel={
                            driverMethod ? (
                              <span className="text-[10px] text-slate-500">
                                {driverMethod === "price_volume"
                                  ? "Price × Volume"
                                  : driverMethod === "customers_arpu"
                                    ? "Customers × ARPU"
                                    : driverMethod === "locations_revenue_per_location"
                                      ? "Locations × Revenue/Location"
                                      : driverMethod === "capacity_utilization_yield"
                                        ? "Capacity × Utilization × Yield"
                                        : "Contracts × ACV"}
                              </span>
                            ) : undefined
                          }
                        />
                      </td>
                      {years.map((y) => {
                      const isHistoric = y.endsWith("A");
                      const stored = getRowValueForYear(row.id, y, row);
                      const openingBasis = openingBasisByRowId[row.id];
                      const isLastActualYear =
                        !!lastHistoricYear && isHistoric && y === lastHistoricYear;
                      const showOpeningBaseInLastA =
                        isLastActualYear &&
                        !hasHistoricalActualByRowId[row.id] &&
                        openingBasis != null &&
                        Number.isFinite(openingBasis);

                      const display =
                        (isForecastOnlyBase && isHistoric) || (stored === 0 && !isHistoric)
                          ? "—"
                          : formatAccounting(stored, unit, showDecimals);
                      return (
                        <td
                          key={y}
                          className={`px-3.5 py-2.5 text-right tabular-nums align-top ${depthValueClass} ${forecastStartColClass(y)}`}
                        >
                          {showOpeningBaseInLastA ? (
                            <span className="text-[10px] font-normal leading-tight text-sky-400/70">
                              Base: {formatAccounting(openingBasis, unit, showDecimals)}
                            </span>
                          ) : (
                            <span>{display}</span>
                          )}
                        </td>
                        );
                      })}
                    </tr>
                  );
                })
              ))}
            {priceVolumeDriverRows.length > 0 && (
              <tr className="border-t-4 border-slate-700">
                <td colSpan={1 + years.length} className="px-3 py-3 bg-slate-900/40 align-top">
                  <h3 className="text-sm font-bold text-slate-100 mb-2">Price × Volume Drivers</h3>
                  <p className="text-[11px] text-slate-500 mb-1 max-w-3xl">
                    Revenue = Volume × Price per unit
                  </p>
                  <p className="text-[10px] text-slate-500 mb-2 max-w-3xl">
                    Driver audit only (volume × price after first-year growth). Not scaled to statement K/M;
                    price/unit is absolute currency.
                  </p>
                  <div className="overflow-x-auto rounded border border-slate-700/80 bg-slate-950/50">
                    <table className="w-full min-w-[640px] border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-700 bg-slate-900/60">
                          <th className="px-3 py-2 text-left font-semibold text-slate-300">Line</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            Starting volume
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            Starting price / unit
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            {priceVolumeDriverRows[0]?.metrics.firstYearKey ?? firstForecastYear} volume
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            {priceVolumeDriverRows[0]?.metrics.firstYearKey ?? firstForecastYear} price / unit
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {priceVolumeDriverRows.map((r) => (
                          <tr
                            key={r.rowId}
                            className="border-b border-slate-800/90 last:border-b-0"
                          >
                            <td className="px-3 py-2 text-slate-200">
                              <div className="font-medium">{r.label}</div>
                              {r.volumeUnitLabel ? (
                                <div className="text-[10px] text-slate-500 mt-0.5">{r.volumeUnitLabel}</div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatVolumeDriverCount(r.metrics.startingVolume)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatAbsolutePricePerUnit(r.metrics.startingPricePerUnit, currencyCode)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatVolumeDriverCount(r.metrics.volumeAfterGrowth)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatAbsolutePricePerUnit(r.metrics.priceAfterGrowth, currencyCode)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            )}
            {customersArpuDriverRows.length > 0 && (
              <tr className="border-t-4 border-slate-700">
                <td colSpan={1 + years.length} className="px-3 py-3 bg-slate-900/40 align-top">
                  <h3 className="text-sm font-bold text-slate-100 mb-2">Customers × ARPU Drivers</h3>
                  <p className="text-[11px] text-slate-500 mb-1 max-w-3xl">
                    Revenue = Customers × ARPU (Average Revenue Per User), annualized when ARPU basis is monthly (×12).
                  </p>
                  <p className="text-[10px] text-slate-500 mb-2 max-w-3xl">
                    Driver audit only (customers × ARPU after first-year growth). Not scaled to statement K/M;
                    ARPU is absolute currency per customer at the basis you selected.
                  </p>
                  <div className="overflow-x-auto rounded border border-slate-700/80 bg-slate-950/50">
                    <table className="w-full min-w-[640px] border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-700 bg-slate-900/60">
                          <th className="px-3 py-2 text-left font-semibold text-slate-300">Line</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            Starting customers
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            <span>Starting ARPU</span>
                            <span
                              className="block text-[10px] font-normal text-slate-500 mt-0.5"
                              title="Average revenue generated per customer in the period"
                            >
                              Average revenue per customer
                            </span>
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            {customersArpuDriverRows[0]?.metrics.firstYearKey ?? firstForecastYear}{" "}
                            customers
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            {customersArpuDriverRows[0]?.metrics.firstYearKey ?? firstForecastYear} ARPU
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {customersArpuDriverRows.map((r) => (
                          <tr
                            key={r.rowId}
                            className="border-b border-slate-800/90 last:border-b-0"
                          >
                            <td className="px-3 py-2 text-slate-200">
                              <div className="font-medium">{r.label}</div>
                              {r.customerUnitLabel ? (
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  Customer unit: {r.customerUnitLabel}
                                </div>
                              ) : null}
                              <div className="text-[10px] text-slate-500/90 mt-0.5">
                                ARPU basis:{" "}
                                {r.metrics.arpuBasis === "monthly" ? "Monthly" : "Annual"}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatVolumeDriverCount(r.metrics.startingCustomers)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatAbsoluteArpu(r.metrics.startingArpu, currencyCode)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatVolumeDriverCount(r.metrics.customersAfterGrowth)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatAbsoluteArpu(r.metrics.arpuAfterGrowth, currencyCode)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            )}
            {locationsRevenuePerLocationDriverRows.length > 0 && (
              <tr className="border-t-4 border-slate-700">
                <td colSpan={1 + years.length} className="px-3 py-3 bg-slate-900/40 align-top">
                  <h3 className="text-sm font-bold text-slate-100 mb-2">
                    Locations × Revenue per Location Drivers
                  </h3>
                  <p className="text-[10px] text-slate-500 mb-2 max-w-3xl">
                    Driver audit only (locations × revenue/location after first-year growth). Annualized when basis is
                    monthly (×12). Not scaled to statement K/M; revenue/location is absolute currency at the basis you
                    selected.
                  </p>
                  <div className="overflow-x-auto rounded border border-slate-700/80 bg-slate-950/50">
                    <table className="w-full min-w-[640px] border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-700 bg-slate-900/60">
                          <th className="px-3 py-2 text-left font-semibold text-slate-300">Line</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            Starting locations
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            Starting revenue / location
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            {locationsRevenuePerLocationDriverRows[0]?.metrics.firstYearKey ?? firstForecastYear}{" "}
                            locations
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            {locationsRevenuePerLocationDriverRows[0]?.metrics.firstYearKey ?? firstForecastYear}{" "}
                            revenue / location
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {locationsRevenuePerLocationDriverRows.map((r) => (
                          <tr
                            key={r.rowId}
                            className="border-b border-slate-800/90 last:border-b-0"
                          >
                            <td className="px-3 py-2 text-slate-200">
                              <div className="font-medium">{r.label}</div>
                              {r.locationUnitLabel ? (
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  Location unit: {r.locationUnitLabel}
                                </div>
                              ) : null}
                              <div className="text-[10px] text-slate-500/90 mt-0.5">
                                Revenue/location basis:{" "}
                                {r.metrics.revenuePerLocationBasis === "monthly" ? "Monthly" : "Annual"}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatVolumeDriverCount(r.metrics.startingLocations)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatAbsoluteRevenuePerLocation(
                                r.metrics.startingRevenuePerLocation,
                                currencyCode
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatVolumeDriverCount(r.metrics.locationsAfterGrowth)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatAbsoluteRevenuePerLocation(
                                r.metrics.revenuePerLocationAfterGrowth,
                                currencyCode
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            )}
            {capacityUtilizationYieldDriverRows.length > 0 && (
              <tr className="border-t-4 border-slate-700">
                <td colSpan={1 + years.length} className="px-3 py-3 bg-slate-900/40 align-top">
                  <h3 className="text-sm font-bold text-slate-100 mb-2">
                    Capacity × Utilization × Yield Drivers
                  </h3>
                  <p className="text-[11px] text-slate-500 mb-1 max-w-3xl">
                    Revenue = Capacity × (Utilization ÷ 100) × Yield; monthly yield is annualized (×12).
                  </p>
                  <p className="text-[10px] text-slate-500 mb-2 max-w-3xl">
                    Driver audit only (starting inputs and first forecast-year drivers after growth / level paths). Not
                    scaled to statement K/M; yield is absolute currency per utilized unit.
                  </p>
                  <div className="overflow-x-auto rounded border border-slate-700/80 bg-slate-950/50">
                    <table className="w-full min-w-[720px] border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-700 bg-slate-900/60">
                          <th className="px-3 py-2 text-left font-semibold text-slate-300">Line</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            Starting capacity
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            Starting utilization
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">Starting yield</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            {capacityUtilizationYieldDriverRows[0]?.metrics.firstYearKey ?? firstForecastYear}{" "}
                            capacity
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            {capacityUtilizationYieldDriverRows[0]?.metrics.firstYearKey ?? firstForecastYear}{" "}
                            utilization
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            {capacityUtilizationYieldDriverRows[0]?.metrics.firstYearKey ?? firstForecastYear} yield
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {capacityUtilizationYieldDriverRows.map((r) => (
                          <tr
                            key={r.rowId}
                            className="border-b border-slate-800/90 last:border-b-0"
                          >
                            <td className="px-3 py-2 text-slate-200">
                              <div className="font-medium">{r.label}</div>
                              {r.capacityUnitLabel ? (
                                <div className="text-[10px] text-slate-500 mt-0.5">{r.capacityUnitLabel}</div>
                              ) : null}
                              <div className="text-[10px] text-slate-500/90 mt-0.5">
                                Yield basis:{" "}
                                {r.metrics.yieldBasis === "monthly" ? "Monthly" : "Annual"}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatVolumeDriverCount(r.metrics.startingCapacity)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatUtilizationLevelPct(r.metrics.startingUtilizationPct)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatAbsoluteRevenuePerLocation(r.metrics.startingYield, currencyCode)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatVolumeDriverCount(r.metrics.capacityAfterGrowth)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatUtilizationLevelPct(r.metrics.utilizationPctFirstYear)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatAbsoluteRevenuePerLocation(r.metrics.yieldAfterGrowth, currencyCode)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            )}
            {contractsAcvDriverRows.length > 0 && (
              <tr className="border-t-4 border-slate-700">
                <td colSpan={1 + years.length} className="px-3 py-3 bg-slate-900/40 align-top">
                  <h3 className="text-sm font-bold text-slate-100 mb-2">Contracts × ACV Drivers</h3>
                  <p className="text-[11px] text-slate-500 mb-1 max-w-3xl">
                    Revenue = Contracts × ACV (annual contract value per contract).
                  </p>
                  <p className="text-[10px] text-slate-500 mb-2 max-w-3xl">
                    Driver audit only (starting inputs and first forecast-year drivers after growth). ACV is annual by
                    definition — not scaled to statement K/M in this table.
                  </p>
                  <div className="overflow-x-auto rounded border border-slate-700/80 bg-slate-950/50">
                    <table className="w-full min-w-[640px] border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-700 bg-slate-900/60">
                          <th className="px-3 py-2 text-left font-semibold text-slate-300">Line</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            Starting contracts
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">Starting ACV</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            {contractsAcvDriverRows[0]?.metrics.firstYearKey ?? firstForecastYear} contracts
                          </th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-300">
                            {contractsAcvDriverRows[0]?.metrics.firstYearKey ?? firstForecastYear} ACV
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {contractsAcvDriverRows.map((r) => (
                          <tr
                            key={r.rowId}
                            className="border-b border-slate-800/90 last:border-b-0"
                          >
                            <td className="px-3 py-2 text-slate-200">
                              <div className="font-medium">{r.label}</div>
                              {r.contractUnitLabel ? (
                                <div className="text-[10px] text-slate-500 mt-0.5">{r.contractUnitLabel}</div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatVolumeDriverCount(r.metrics.startingContracts)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatAbsoluteArpu(r.metrics.startingAcv, currencyCode)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatVolumeDriverCount(r.metrics.contractsAfterGrowth)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                              {formatAbsoluteArpu(r.metrics.acvAfterGrowth, currencyCode)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            )}
            {openingBasisCheck && (
              <>
                <tr className="border-t-4 border-slate-700">
                  <td
                    colSpan={1 + years.length}
                    className="px-3 py-3 bg-slate-900/40"
                  >
                    <h3 className="text-sm font-bold text-slate-100">
                      Opening Revenue Bridge Check
                    </h3>
                  </td>
                </tr>
                <tr className="border-b border-slate-900">
                  <td className="px-3 py-2 text-slate-300">
                    Last Historical Revenue ({lastHistoricYear})
                  </td>
                  <td className="px-3 py-2 text-right text-slate-100 tabular-nums">
                    {formatAccounting(openingBasisCheck.totalHistorical, unit, showDecimals)}
                  </td>
                  <td colSpan={Math.max(0, years.length - 1)} />
                </tr>
                <tr className="border-b border-slate-900">
                  <td className="px-3 py-2 text-slate-300">
                    Sum of Opening Base Inputs (pre-growth)
                  </td>
                  <td className="px-3 py-2 text-right text-slate-100 tabular-nums">
                    {formatAccounting(openingBasisCheck.startingBaseSum, unit, showDecimals)}
                  </td>
                  <td colSpan={Math.max(0, years.length - 1)} />
                </tr>
                <tr className="border-b border-slate-900">
                  <td className="px-3 py-2 text-slate-300">Difference</td>
                  <td className="px-3 py-2 text-right text-slate-100 tabular-nums">
                    {formatAccounting(openingBasisCheck.difference, unit, showDecimals)}
                  </td>
                  <td colSpan={Math.max(0, years.length - 1)} />
                </tr>
                <tr className="border-b border-slate-800">
                  <td className="px-3 py-2 text-slate-400">
                    Status (tolerance: {openingBasisCheck.tolerance})
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      openingBasisCheck.reconciled ? "text-emerald-300" : "text-amber-300"
                    }`}
                  >
                    {openingBasisCheck.reconciled ? "Reconciled" : "Not Reconciled"}
                  </td>
                  <td colSpan={Math.max(0, years.length - 1)} />
                </tr>
              </>
            )}
            {/* Revenue Growth — same row order and tree depth as Revenue above */}
            {revenueRows.length > 0 && revenueGrowthTable.length > 0 && (
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
                            Revenue Growth
                          </h3>
                          <p className="text-xs text-slate-500 mt-1">
                            {firstForecastYear} compares to last actual when available; otherwise to opening base.
                            Later years compare to prior forecast year.
                          </p>
                        </div>
                      </div>
                    </button>
                  </td>
                </tr>
                {revenueMethodSectionOpen && (
                  <>
                    <tr className="border-b border-slate-800 bg-slate-900/30">
                      <td className="px-3.5 py-2.5 text-slate-400 text-xs font-medium">
                        Line
                      </td>
                      {years.map((y) => (
                        <td
                          key={y}
                          className={`px-3.5 py-2.5 text-right text-slate-400 text-xs font-medium ${forecastStartColClass(y)}`}
                        >
                          {y.endsWith("A") ? "—" : `${y} growth`}
                        </td>
                      ))}
                    </tr>
                    {revenueRows.map(({ row, depth }, index) => {
                      const g = revenueGrowthByRowId.get(row.id);
                      if (!g) return null;
                      if (isRevenuePreviewRowHiddenByAncestorCollapse(index, revenueRows, collapsedRowIds)) {
                        return null;
                      }
                      let hasDescendants = false;
                      for (let j = index + 1; j < revenueRows.length; j++) {
                        if (revenueRows[j].depth <= depth) break;
                        hasDescendants = true;
                        break;
                      }
                      const depthLabelClassGrowth =
                        depth === 0
                          ? "text-slate-100 font-semibold"
                          : depth === 1
                            ? "text-slate-200 font-medium"
                            : "text-slate-400 font-normal";
                      const isCollapsed = collapsedRowIds.has(row.id);
                      const toggleRowExpand = () => {
                        if (!hasDescendants) return;
                        setCollapsedRowIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        });
                      };
                      const { yoyByYear, firstYearGrowthBasis } = g;
                      return (
                        <tr
                          key={`method-${row.id}`}
                          className={`border-b border-slate-800/90 hover:bg-slate-900/30 ${
                            depth > 0 ? "bg-slate-900/25" : ""
                          }`}
                        >
                          <td className="pl-3 pr-3.5 py-2.5 text-xs align-top">
                            <RevenuePreviewLineLabelCell
                              depth={depth}
                              hasDescendants={hasDescendants}
                              isCollapsed={isCollapsed}
                              onToggleExpand={toggleRowExpand}
                              label={<span className={`text-slate-300 ${depthLabelClassGrowth}`}>{row.label}</span>}
                            />
                          </td>
                          {years.map((y) => {
                            const isProj = !y.endsWith("A");
                            const val = isProj ? yoyByYear[y] : null;
                            const display = val != null ? `${val}%` : "—";
                            const vsOpeningBase =
                              isProj &&
                              firstForecastYear &&
                              y === firstForecastYear &&
                              firstYearGrowthBasis === "opening_base" &&
                              val != null;
                            return (
                              <td
                                key={y}
                                title={
                                  vsOpeningBase
                                    ? "Growth vs opening base (pre-growth), not vs historical actual"
                                    : undefined
                                }
                                className={`px-3.5 py-2.5 text-right text-xs tabular-nums align-top ${forecastStartColClass(y)} ${
                                  vsOpeningBase ? "text-sky-400/80" : "text-slate-400"
                                }`}
                              >
                                {display}
                                {vsOpeningBase ? (
                                  <span
                                    className="ml-0.5 align-super text-[9px] font-normal text-sky-500/50"
                                    aria-hidden
                                  >
                                    ·
                                  </span>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </tbody>
        </table>

      </div>
    </section>
  );
}
