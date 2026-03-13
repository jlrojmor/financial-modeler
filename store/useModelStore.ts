"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Row, WizardStepId, EmbeddedDisclosureItem, EmbeddedDisclosureType } from "@/types/finance";
import { WIZARD_STEPS } from "@/types/finance";
import type {
  RevenueProjectionConfig,
  RevenueProjectionMethod,
  RevenueProjectionInputs,
  RevenueBreakdownItem,
} from "@/types/revenue-projection";
import { DEFAULT_REVENUE_PROJECTION_CONFIG } from "@/types/revenue-projection";
import { recomputeCalculations, computeRowValue } from "@/lib/calculations";
import {
  createIncomeStatementTemplate,
  createBalanceSheetTemplate,
  createCashFlowTemplate,
} from "@/lib/statement-templates";
import { getRowsForCategory } from "@/lib/bs-category-mapper";
import { getFallbackIsClassification } from "@/lib/is-fallback-classify";
import { isCoreBsRow, getCoreLockedBehavior } from "@/lib/bs-core-rows";
import { CAPEX_IB_DEFAULT_USEFUL_LIVES, isLegacyWrongUsefulLives, CAPEX_DEFAULT_BUCKET_IDS } from "@/lib/capex-defaults";
import { getWcScheduleItems, computeWcProjectedBalances, type WcDriverState } from "@/lib/working-capital-schedule";
import {
  computeCapexDaSchedule,
  computeCapexDaScheduleByBucket,
  computeProjectedCapexByYear,
} from "@/lib/capex-da-engine";
import { computeIntangiblesAmortSchedule } from "@/lib/intangibles-amort-engine";
import { displayToStored } from "@/lib/currency-utils";
import { applyAnchorForecastDriver, applyAnchorHistoricalNature } from "@/lib/cfs-forecast-drivers";
import { backfillClassificationCompleteness } from "@/lib/classification-completeness";
import { backfillTaxonomy, applyTaxonomyToRow } from "@/lib/row-taxonomy";
import { backfillCfsMetadataNature } from "@/lib/cfs-metadata-backfill";
import { getFinalOperatingSubgroup } from "@/lib/cfs-operating-subgroups";

/**
 * Helpers
 */
function addChildRow(rows: Row[], parentId: string, child: Row): Row[] {
  return rows.map((r) => {
    if (r.id === parentId) {
      const kids = r.children ? [...r.children, child] : [child];
      return { ...r, children: kids };
    }
    if (r.children?.length) {
      return { ...r, children: addChildRow(r.children, parentId, child) };
    }
    return r;
  });
}

/** Clear values from every row in a tree (recursive); keeps structure and row ids/labels. */
function clearRowValues(rows: Row[]): Row[] {
  return rows.map((r) => ({
    ...r,
    values: {},
    children: r.children?.length ? clearRowValues(r.children) : [],
  }));
}

function isOpexRow(row: Row): boolean {
  if (["sga", "rd", "other_opex", "danda"].includes(row.id)) return true;
  const so = row.sectionOwner;
  return so === "sga" || so === "rd" || so === "other_operating";
}

/**
 * Guarantees operating_expenses exists as a top-level row after gross_margin and before ebit.
 * Children are user-controlled: legacy top-level opex rows are moved under it in their current order;
 * if none exist, operating_expenses is created with empty children (no forced SG&A).
 */
function normalizeIncomeStatementOperatingExpenses(incomeStatement: Row[]): Row[] {
  const rows = incomeStatement ?? [];
  const opExIndex = rows.findIndex((r) => r.id === "operating_expenses");
  const grossMarginIndex = rows.findIndex((r) => r.id === "gross_margin");

  if (opExIndex >= 0) {
    // operating_expenses exists: move any top-level opex rows into it, preserving their current order
    const opExRow = rows[opExIndex];
    const topLevelOpex = rows.filter((r, i) => i !== opExIndex && isOpexRow(r));
    if (topLevelOpex.length === 0) return rows;
    const existingChildIds = new Set((opExRow.children ?? []).map((c) => c.id));
    const toAdd = topLevelOpex.filter((r) => !existingChildIds.has(r.id));
    if (toAdd.length === 0) {
      const withoutTopLevelOpex = rows.filter((_, i) => i === opExIndex || !isOpexRow(rows[i]));
      return withoutTopLevelOpex;
    }
    // Append in the order they appear at top level (user/stored order)
    const newChildren = [...(opExRow.children ?? []), ...toAdd];
    const updatedOpEx = { ...opExRow, children: newChildren };
    const withoutTopLevelOpex = rows.filter((_, i) => i !== opExIndex && !isOpexRow(rows[i]));
    const insertIdx = withoutTopLevelOpex.findIndex((r) => r.id === "gross_margin") + 1;
    const insertAt = insertIdx > 0 ? insertIdx : withoutTopLevelOpex.length;
    withoutTopLevelOpex.splice(insertAt, 0, updatedOpEx);
    return withoutTopLevelOpex;
  }

  // operating_expenses does not exist: collect top-level opex rows in current order, or empty
  const topLevelOpex = rows.filter(isOpexRow);
  const children: Row[] = topLevelOpex.length > 0 ? [...topLevelOpex] : [];

  const opExRow: Row = {
    id: "operating_expenses",
    label: "Operating Expenses",
    kind: "calc",
    valueType: "currency",
    values: {},
    children,
    sectionOwner: "operating_expenses",
    isTemplateRow: true,
  };

  const withoutOpex = rows.filter((r) => !isOpexRow(r));
  const insertAt = grossMarginIndex >= 0 ? grossMarginIndex + 1 : withoutOpex.length;
  withoutOpex.splice(insertAt, 0, opExRow);
  return withoutOpex;
}

function updateRowValueDeep(
  rows: Row[],
  rowId: string,
  year: string,
  value: number
): Row[] {
  return rows.map((r) => {
    if (r.id === rowId) {
      return {
        ...r,
        values: { ...(r.values ?? {}), [year]: value },
      };
    }
    if (r.children?.length) {
      return { ...r, children: updateRowValueDeep(r.children, rowId, year, value) };
    }
    return r;
  });
}

/** When user sets a CFS cell, mark that year as user-set so source resolution treats it as meaningful override. */
function addCfsUserSetYearDeep(rows: Row[], rowId: string, year: string): Row[] {
  return rows.map((r) => {
    if (r.id === rowId) {
      const existing = r.cfsUserSetYears ?? [];
      if (existing.includes(year)) return r;
      return { ...r, cfsUserSetYears: [...existing, year].sort() };
    }
    if (r.children?.length) {
      return { ...r, children: addCfsUserSetYearDeep(r.children, rowId, year) };
    }
    return r;
  });
}

function removeRowDeep(rows: Row[], rowId: string): Row[] {
  return rows
    .filter((r) => r.id !== rowId)
    .map((r) => {
      if (r.children?.length) {
        return { ...r, children: removeRowDeep(r.children, rowId) };
      }
      return r;
    });
}

function renameRowDeep(rows: Row[], rowId: string, label: string): Row[] {
  return rows.map((r) => {
    if (r.id === rowId) {
      return { ...r, label };
    }
    if (r.children?.length) {
      return { ...r, children: renameRowDeep(r.children, rowId, label) };
    }
    return r;
  });
}

/** Find a row anywhere in the tree by id */
function findRowDeep(rows: Row[], rowId: string): Row | null {
  for (const r of rows) {
    if (r.id === rowId) return r;
    if (r.children?.length) {
      const found = findRowDeep(r.children, rowId);
      if (found) return found;
    }
  }
  return null;
}

/** Collect ids of rows that have children (so we don't overwrite their values with sum-of-children in recompute). */
function collectParentIdsWithChildren(rows: Row[]): Set<string> {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.children?.length) {
      set.add(r.id);
      collectParentIdsWithChildren(r.children).forEach((id) => set.add(id));
    }
  }
  return set;
}

/** Add an existing row as child of parentId (for moving into WC, etc.) */
function addExistingChildToParent(
  rows: Row[],
  parentId: string,
  childRow: Row,
  atIndex?: number
): Row[] {
  return rows.map((r) => {
    if (r.id !== parentId) {
      if (r.children?.length) {
        return { ...r, children: addExistingChildToParent(r.children, parentId, childRow, atIndex) };
      }
      return r;
    }
    const children = [...(r.children ?? [])];
    const idx = atIndex ?? children.length;
    children.splice(idx, 0, childRow);
    return { ...r, children };
  });
}

function updateRowKindDeep(
  rows: Row[],
  rowId: string,
  kind: "input" | "calc" | "subtotal" | "total"
): Row[] {
  return rows.map((r) => {
    if (r.id === rowId) {
      return { ...r, kind };
    }
    if (r.children?.length) {
      return { ...r, children: updateRowKindDeep(r.children, rowId, kind) };
    }
    return r;
  });
}

function updateIsRowMetadataDeep(
  rows: Row[],
  rowId: string,
  patch: {
    sectionOwner?: Row["sectionOwner"];
    isOperating?: boolean;
    classificationSource?: "user" | "ai" | "fallback";
    classificationReason?: string;
    classificationConfidence?: number;
  }
): Row[] {
  return rows.map((r) => {
    if (r.id === rowId) {
      const next = { ...r, ...patch };
      // When user sets classification in builder, mark as trusted and user so row fully resolves
      if (patch.sectionOwner !== undefined || patch.isOperating !== undefined) {
        next.forecastMetadataStatus = "trusted" as const;
        next.taxonomyStatus = "trusted" as const;
        next.classificationSource = "user" as const;
      }
      return next;
    }
    if (r.children?.length) {
      return { ...r, children: updateIsRowMetadataDeep(r.children, rowId, patch) };
    }
    return r;
  });
}

/** Set forecastMetadataStatus, taxonomyStatus, and classificationSource to "trusted"/"user" for a row by id (any statement).
 *  Ensures the row fully exits all review conditions (canonical state becomes trusted). */
function updateRowReviewTrustedDeep(rows: Row[], rowId: string): Row[] {
  return rows.map((r) => {
    if (r.id === rowId) {
      return {
        ...r,
        forecastMetadataStatus: "trusted" as const,
        taxonomyStatus: "trusted" as const,
        classificationSource: "user" as const,
      };
    }
    if (r.children?.length) {
      return { ...r, children: updateRowReviewTrustedDeep(r.children, rowId) };
    }
    return r;
  });
}

function updateCashFlowRowMetadataDeep(
  rows: Row[],
  rowId: string,
  patch: {
    cfsForecastDriver?: Row["cfsForecastDriver"];
    historicalCfsNature?: Row["historicalCfsNature"];
    classificationSource?: "user" | "ai" | "fallback";
    classificationReason?: string;
    classificationConfidence?: number;
    forecastMetadataStatus?: "trusted" | "needs_review";
    cfsLink?: Partial<NonNullable<Row["cfsLink"]>>;
  }
): Row[] {
  return rows.map((r) => {
    if (r.id === rowId) {
      const next: Row = { ...r };
      if (patch.cfsForecastDriver !== undefined) next.cfsForecastDriver = patch.cfsForecastDriver;
      if (patch.historicalCfsNature !== undefined) next.historicalCfsNature = patch.historicalCfsNature;
      if (patch.classificationSource !== undefined) next.classificationSource = patch.classificationSource;
      if (patch.classificationReason !== undefined) next.classificationReason = patch.classificationReason;
      if (patch.classificationConfidence !== undefined) next.classificationConfidence = patch.classificationConfidence;
      if (patch.forecastMetadataStatus !== undefined) next.forecastMetadataStatus = patch.forecastMetadataStatus;
      if (patch.cfsLink !== undefined) {
        next.cfsLink = next.cfsLink ? { ...next.cfsLink, ...patch.cfsLink } : patch.cfsLink as Row["cfsLink"];
      }
      // When user sets classification (source, section, or nature), mark fully trusted so row resolves
      if (
        patch.classificationSource === "user" ||
        patch.historicalCfsNature !== undefined ||
        patch.cfsLink !== undefined
      ) {
        next.classificationSource = "user";
        next.forecastMetadataStatus = "trusted";
        next.taxonomyStatus = "trusted";
      }
      return next;
    }
    if (r.children?.length) {
      return { ...r, children: updateCashFlowRowMetadataDeep(r.children, rowId, patch) };
    }
    return r;
  });
}

function uuid() {
  // Simple, reliable unique id without crypto
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

/**
 * Normalize CFS so that any row whose final operating subgroup is working_capital
 * is stored inside wc_change.children. Uses getFinalOperatingSubgroup (single source of truth).
 * Top-level rows that resolve to working_capital (except wc_change itself) are moved into wc_change.children.
 * Idempotent.
 */
function normalizeWcStructure(cashFlow: Row[]): Row[] {
  const topLevelWc = cashFlow.filter(
    (r) => r.id !== "wc_change" && getFinalOperatingSubgroup(r, undefined) === "working_capital"
  );
  if (topLevelWc.length === 0) return cashFlow;

  const rest = cashFlow.filter(
    (r) => r.id === "wc_change" || getFinalOperatingSubgroup(r, undefined) !== "working_capital"
  );
  const wcChange = rest.find((r) => r.id === "wc_change");
  if (!wcChange) return cashFlow;

  const existingChildren = wcChange.children ?? [];
  const moved = topLevelWc.map((r) => ({ ...r, children: undefined as Row[] | undefined }));
  const newChildren = [...existingChildren, ...moved];

  return rest.map((r) =>
    r.id === "wc_change" ? { ...r, children: newChildren } : r
  );
}

/**
 * Working capital children in CFS are strictly component-driven: only rows the user has
 * explicitly added or accepted as historical WC components. We do NOT auto-populate
 * wc_change.children from Balance Sheet rows (BS-derived rows remain suggestions only).
 * This preserves existing active WC children and recurses for other rows; it does not
 * add BS-derived or placeholder rows.
 */
function ensureWcChildrenInCashFlow(cashFlow: Row[], balanceSheet: Row[], wcExcludedIds: Set<string> = new Set()): Row[] {
  return cashFlow.map((r) => {
    if (r.id !== "wc_change") {
      return r.children?.length
        ? { ...r, children: ensureWcChildrenInCashFlow(r.children, balanceSheet, wcExcludedIds) }
        : r;
    }
    // Preserve only existing active historical WC components; do not add BS-derived rows
    const existingChildren = r.children ?? [];
    return { ...r, children: existingChildren };
  });
}

/** CFS anchor row ids in display order; each is inserted after the previous if missing. */
const CFS_ANCHOR_ORDER: { id: string; afterId: string }[] = [
  { id: "capex", afterId: "operating_cf" },
  { id: "acquisitions", afterId: "capex" },
  { id: "asset_sales", afterId: "acquisitions" },
  { id: "investments", afterId: "asset_sales" },
  { id: "other_investing", afterId: "investments" },
  { id: "investing_cf", afterId: "other_investing" },
  { id: "debt_issued", afterId: "investing_cf" },
  { id: "debt_repaid", afterId: "debt_issued" },
  { id: "equity_issued", afterId: "debt_repaid" },
  { id: "share_repurchases", afterId: "equity_issued" },
  { id: "dividends", afterId: "share_repurchases" },
  { id: "other_financing", afterId: "dividends" },
  { id: "financing_cf", afterId: "other_financing" },
  { id: "fx_effect_on_cash", afterId: "financing_cf" },
];

/**
 * Mutates cashFlow to ensure all CFI/CFF anchor rows exist in order. Used by initializeModel and ensureCFSAnchorRows.
 */
function ensureCFSAnchorRowsInPlace(cashFlow: Row[]): void {
  const template = createCashFlowTemplate();
  const getDefault = (id: string): Row | null => {
    const row = template.find((r) => r.id === id);
    return row ? { ...row, values: {} } : null;
  };
  for (const { id, afterId } of CFS_ANCHOR_ORDER) {
    if (cashFlow.some((r) => r.id === id)) continue;
    const afterIdx = cashFlow.findIndex((r) => r.id === afterId);
    const insertIdx = afterIdx >= 0 ? afterIdx + 1 : cashFlow.length;
    const row = getDefault(id);
    if (row) cashFlow.splice(insertIdx, 0, row);
  }
}

/**
 * Types for store state/actions
 */
export type ModelType = "dcf" | "lbo" | "startup";
export type CompanyType = "public" | "private";

export type CurrencyUnit = "units" | "thousands" | "millions";

export type ModelMeta = {
  companyName: string;
  companyType: CompanyType;
  currency: string;
  currencyUnit: CurrencyUnit;
  modelType: ModelType;
  years: {
    historical: string[];
    projection: string[];
  };
};

/** Per-project snapshot (all model data for one project) */
export type ProjectSnapshot = {
  meta: ModelMeta;
  isInitialized: boolean;
  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];
  schedules: { workingCapital: Row[]; debt: Row[]; capex: Row[] };
  sbcBreakdowns: Record<string, Record<string, number>>;
  embeddedDisclosures: EmbeddedDisclosureItem[];
  /** When true, SBC disclosure block is used as fallback for CFS SBC and shown in preview. When false, CFS SBC uses only reported/manual value. */
  sbcDisclosureEnabled: boolean;
  danaLocation: "cogs" | "sga" | "both" | null;
  danaBreakdowns: Record<string, number>;
  currentStepId: WizardStepId;
  completedStepIds: WizardStepId[];
  isModelComplete: boolean;
  sectionLocks: Record<string, boolean>;
  sectionExpanded: Record<string, boolean>;
  confirmedRowIds: Record<string, boolean>;
  /** BS row IDs that user has removed from CFO Working Capital; persist so they stay excluded after save */
  wcExcludedIds: string[];
  /** IS Build: how each revenue stream/sub-item is forecasted (method + inputs) */
  revenueProjectionConfig: RevenueProjectionConfig;
  /** IS Build: COGS as % of revenue per projected revenue line id (0–100). Constant mode. */
  cogsPctByRevenueLine: Record<string, number>;
  /** IS Build: 'constant' = one % for all years, 'custom' = per-year %. */
  cogsPctModeByRevenueLine: Record<string, "constant" | "custom">;
  /** IS Build: when mode is 'custom', lineId -> year -> pct (0–100). */
  cogsPctByRevenueLineByYear: Record<string, Record<string, number>>;
  /** IS Build: SG&A as % of revenue per SG&A item id (0–100). Constant mode. */
  sgaPctByItemId: Record<string, number>;
  /** IS Build: 'constant' | 'custom' per SG&A item. */
  sgaPctModeByItemId: Record<string, "constant" | "custom">;
  /** IS Build: custom SG&A % by item and year. */
  sgaPctByItemIdByYear: Record<string, Record<string, number>>;
  /** IS Build: sub-item (child) % of parent SG&A item (0–100). Used when item has parent in SG&A tree. */
  sgaPctOfParentByItemId: Record<string, number>;
  /** IS Build: 'constant' | 'custom' per sub-item for % of parent. */
  sgaPctOfParentModeByItemId: Record<string, "constant" | "custom">;
  /** IS Build: custom sub-item % of parent by item and year. */
  sgaPctOfParentByItemIdByYear: Record<string, Record<string, number>>;
  /** IS Build: historic amounts per sub-item per year (for breakdown helper Option A). Stored in same unit as IS. */
  sgaHistoricAmountByItemIdByYear: Record<string, Record<string, number>>;
  /** BS Build / Working Capital Schedule: driver type per WC item (days, % of revenue, % of COGS, or manual balance). */
  wcDriverTypeByItemId: Record<string, "days" | "pct_revenue" | "pct_cogs" | "manual">;
  /** WC: constant Days driver per item (applied to all projection years when mode is constant). */
  wcDaysByItemId: Record<string, number>;
  /** WC: custom Days driver per item and year. */
  wcDaysByItemIdByYear: Record<string, Record<string, number>>;
  /** WC: base for Days driver per item (revenue vs COGS). AR → revenue, Inventory/AP → COGS; user can override. */
  wcDaysBaseByItemId: Record<string, "revenue" | "cogs">;
  /** WC: base for % driver per item (revenue vs COGS). */
  wcPctBaseByItemId: Record<string, "revenue" | "cogs">;
  /** WC: constant % driver per item (0–100). */
  wcPctByItemId: Record<string, number>;
  /** WC: custom % driver per item and year (0–100). */
  wcPctByItemIdByYear: Record<string, Record<string, number>>;
  /** Capex & D&A Schedule (BS Build). */
  capexForecastMethod: "pct_revenue" | "manual" | "growth";
  capexPctRevenue: number;
  capexManualByYear: Record<string, number>;
  capexGrowthPct: number;
  capexSplitByBucket: boolean;
  capexForecastBucketsIndependently: boolean;
  capexTimingConvention: "mid" | "start" | "end";
  capexBucketAllocationPct: Record<string, number>;
  capexBucketLabels: Record<string, string>;
  /** User-added Capex bucket IDs (custom categories beyond the default 7). */
  capexCustomBucketIds: string[];
  capexBucketMethod: Record<string, "pct_revenue" | "manual" | "growth">;
  capexBucketPctRevenue: Record<string, number>;
  capexBucketManualByYear: Record<string, Record<string, number>>;
  capexBucketGrowthPct: Record<string, number>;
  ppeUsefulLifeByBucket: Record<string, number>;
  ppeUsefulLifeSingle: number;
  /** Optional: historic Capex by bucket by year (informative; for implied allocation %). bucketId -> year -> amount */
  capexHistoricByBucketByYear: Record<string, Record<string, number>>;
  /** Capex Allocation Helper: PP&E by bucket by year (for maintenance-capex-weighted allocation). bucketId -> year -> PP&E */
  capexHelperPpeByBucketByYear: Record<string, Record<string, number>>;
  /** Capex Allocation Helper: include bucket in allocation (default OFF for Land, CIP). */
  capexIncludeInAllocationByBucket: Record<string, boolean>;
  capexModelIntangibles: boolean;
  intangiblesForecastMethod: "pct_revenue" | "manual" | "pct_capex";
  intangiblesAmortizationLifeYears: number;
  intangiblesPctRevenue: number;
  intangiblesManualByYear: Record<string, number>;
  intangiblesPctOfCapex: number;
  intangiblesHasHistoricalAmortization: boolean;
  intangiblesHistoricalAmortizationByYear: Record<string, number>;
};

export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type ModelState = {
  /** Multi-project: current project id when in builder; null on landing */
  currentProjectId: string | null;
  /** List of saved projects (id, name, timestamps) */
  projects: ProjectMeta[];
  /** Full state per project; key = project id */
  projectStates: Record<string, ProjectSnapshot>;

  meta: ModelMeta;
  isInitialized: boolean;
  _hasHydrated: boolean;

  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];

  schedules: {
    workingCapital: Row[];
    debt: Row[];
    capex: Row[];
  };

  // Stock-Based Compensation annotation (for transparency, doesn't affect calculations)
  sbcBreakdowns: Record<string, Record<string, number>>; // { [categoryId]: { [year]: value } }
  /** Generic embedded disclosures (SBC, future: amortization). Does not modify reported IS values. */
  embeddedDisclosures: EmbeddedDisclosureItem[];
  /** SBC disclosure section enabled: when true, disclosure is fallback for CFS SBC and shown in preview; when false, CFS SBC is reported/manual only. */
  sbcDisclosureEnabled: boolean;

  // D&A location tracking (where D&A is embedded: "cogs", "sga", or "both")
  danaLocation: "cogs" | "sga" | "both" | null;
  // D&A values by year (only if we have exact allocation)
  danaBreakdowns: Record<string, number>; // { [year]: value }

  currentStepId: WizardStepId;
  completedStepIds: WizardStepId[];
  isModelComplete: boolean;

  // Section lock and expand state for Builder Panel
  sectionLocks: Record<string, boolean>; // { [sectionId]: isLocked }
  sectionExpanded: Record<string, boolean>; // { [sectionId]: isExpanded }
  
  // Confirmed row IDs for Cash Flow Builder (collapsed cards)
  confirmedRowIds: Record<string, boolean>; // { [rowId]: isConfirmed }
  /** BS CA/CL row IDs user removed from CFO WC section; kept so they stay excluded after save */
  wcExcludedIds: string[];
  /** IS Build: revenue projection method + inputs per stream/sub-item */
  revenueProjectionConfig: RevenueProjectionConfig;
  /** IS Build: COGS % of revenue per projected revenue line id (0–100). Constant mode. */
  cogsPctByRevenueLine: Record<string, number>;
  /** IS Build: 'constant' | 'custom' per COGS line. */
  cogsPctModeByRevenueLine: Record<string, "constant" | "custom">;
  /** IS Build: custom COGS % by COGS line and year. */
  cogsPctByRevenueLineByYear: Record<string, Record<string, number>>;
  /** IS Build: SG&A % of revenue per SG&A item id (0–100). Constant mode. */
  sgaPctByItemId: Record<string, number>;
  /** IS Build: 'constant' | 'custom' per SG&A item. */
  sgaPctModeByItemId: Record<string, "constant" | "custom">;
  /** IS Build: custom SG&A % by item and year. */
  sgaPctByItemIdByYear: Record<string, Record<string, number>>;
  /** IS Build: sub-item % of parent (0–100). */
  sgaPctOfParentByItemId: Record<string, number>;
  sgaPctOfParentModeByItemId: Record<string, "constant" | "custom">;
  sgaPctOfParentByItemIdByYear: Record<string, Record<string, number>>;
  sgaHistoricAmountByItemIdByYear: Record<string, Record<string, number>>;
  /** BS Build / Working Capital Schedule: driver type per WC item (days, % of revenue, % of COGS, or manual balance). */
  wcDriverTypeByItemId: Record<string, "days" | "pct_revenue" | "pct_cogs" | "manual">;
  /** WC: constant Days driver per item (applied to all projection years when mode is constant). */
  wcDaysByItemId: Record<string, number>;
  /** WC: custom Days driver per item and year. */
  wcDaysByItemIdByYear: Record<string, Record<string, number>>;
  /** WC: base for Days driver per item (revenue vs COGS). AR → revenue, Inventory/AP → COGS; user can override. */
  wcDaysBaseByItemId: Record<string, "revenue" | "cogs">;
  /** WC: base for % driver per item (revenue vs COGS). */
  wcPctBaseByItemId: Record<string, "revenue" | "cogs">;
  /** WC: constant % driver per item (0–100). */
  wcPctByItemId: Record<string, number>;
  /** WC: custom % driver per item and year (0–100). */
  wcPctByItemIdByYear: Record<string, Record<string, number>>;
  /** Capex & D&A Schedule (BS Build). */
  capexForecastMethod: "pct_revenue" | "manual" | "growth";
  capexPctRevenue: number;
  capexManualByYear: Record<string, number>;
  capexGrowthPct: number;
  capexSplitByBucket: boolean;
  capexForecastBucketsIndependently: boolean;
  capexTimingConvention: "mid" | "start" | "end";
  capexBucketAllocationPct: Record<string, number>;
  capexBucketLabels: Record<string, string>;
  /** User-added Capex bucket IDs (custom categories beyond the default 7). */
  capexCustomBucketIds: string[];
  capexBucketMethod: Record<string, "pct_revenue" | "manual" | "growth">;
  capexBucketPctRevenue: Record<string, number>;
  capexBucketManualByYear: Record<string, Record<string, number>>;
  capexBucketGrowthPct: Record<string, number>;
  ppeUsefulLifeByBucket: Record<string, number>;
  ppeUsefulLifeSingle: number;
  /** Optional: historic Capex by bucket by year (informative; for implied allocation %). bucketId -> year -> amount */
  capexHistoricByBucketByYear: Record<string, Record<string, number>>;
  /** Capex Allocation Helper: PP&E by bucket by year (for maintenance-capex-weighted allocation). bucketId -> year -> PP&E */
  capexHelperPpeByBucketByYear: Record<string, Record<string, number>>;
  /** Capex Allocation Helper: include bucket in allocation (default OFF for Land, CIP). */
  capexIncludeInAllocationByBucket: Record<string, boolean>;
  capexModelIntangibles: boolean;
  intangiblesForecastMethod: "pct_revenue" | "manual" | "pct_capex";
  intangiblesAmortizationLifeYears: number;
  intangiblesPctRevenue: number;
  intangiblesManualByYear: Record<string, number>;
  intangiblesPctOfCapex: number;
  intangiblesHasHistoricalAmortization: boolean;
  intangiblesHistoricalAmortizationByYear: Record<string, number>;
  /** BS Build preview only: rowId -> year -> value. WC schedule, PP&E, Intangibles schedule outputs. Not persisted. */
  bsBuildPreviewOverrides: Record<string, Record<string, number>>;
};

export type ModelActions = {
  initializeModel: (meta: ModelMeta, options?: { force?: boolean }) => void;
  recalculateAll: () => void;
  goToStep: (stepId: WizardStepId) => void;
  completeCurrentStep: () => void;
  saveCurrentStep: () => void;
  continueToNextStep: () => void;

  // Row management - generic for any statement
  addChildRow: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", parentId: string, label: string) => void;
  insertRow: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", index: number, row: Row) => void;
  moveRow: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string, direction: "up" | "down") => void;
  removeRow: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string) => void;
  renameRow: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string, label: string) => void;
  updateRowValue: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string, year: string, value: number) => void;
  updateRowKind: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string, kind: "input" | "calc" | "subtotal" | "total") => void;
  /** Income Statement: set sectionOwner / isOperating / classificationSource / classificationReason / classificationConfidence on a row. */
  updateIncomeStatementRowMetadata: (rowId: string, patch: {
    sectionOwner?: Row["sectionOwner"];
    isOperating?: boolean;
    classificationSource?: "user" | "ai" | "fallback";
    classificationReason?: string;
    classificationConfidence?: number;
  }) => void;
  /** Cash Flow: set forecast driver and classification metadata on a row (AI suggestion or user override). Passing classificationSource: "user" also sets forecastMetadataStatus to "trusted". */
  updateCashFlowRowMetadata: (rowId: string, patch: {
    cfsForecastDriver?: Row["cfsForecastDriver"];
    historicalCfsNature?: Row["historicalCfsNature"];
    classificationSource?: "user" | "ai" | "fallback";
    classificationReason?: string;
    classificationConfidence?: number;
    forecastMetadataStatus?: "trusted" | "needs_review";
    cfsLink?: Partial<NonNullable<Row["cfsLink"]>>;
  }) => void;

  /** Mark a row as reviewed/trusted so it no longer appears in "Rows Requiring Review". Sets forecastMetadataStatus and taxonomyStatus to "trusted". */
  confirmRowReview: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string) => void;

  /** Sync Working Capital change children from Balance Sheet (CA except cash, CL except short-term debt). */
  ensureWcChildrenFromBS: () => void;
  /** Ensure CFI/CFF fixed anchor rows exist in cashFlow (for builder display). Call when CFS builder is shown. */
  ensureCFSAnchorRows: () => void;

  /** BS Build: persist WC, PP&E, and Intangibles schedule projections into global balanceSheet (projection years only); then recompute CFS. */
  applyBsBuildProjectionsToModel: () => void;

  /** Cash Flow builder: reorder top-level row (visual order only). */
  reorderCashFlowTopLevel: (fromIndex: number, toIndex: number) => void;
  /** Cash Flow builder: reorder children of wc_change. */
  reorderWcChildren: (fromIndex: number, toIndex: number) => void;
  /** Cash Flow builder: move a row into Working Capital (becomes child of wc_change, included in WC subtotal). */
  moveCashFlowRowIntoWc: (rowId: string, insertAtIndex?: number) => void;
  /** Cash Flow builder: add a new row as a child of wc_change (for WC-classified rows). */
  addWcChild: (row: Row, insertAtIndex?: number) => void;
  /** Cash Flow builder: move a row out of Working Capital (becomes top-level operating item, no longer in WC subtotal). */
  moveCashFlowRowOutOfWc: (rowId: string, insertAtTopLevelIndex?: number, targetSubgroup?: "non_cash" | "other_operating") => void;
  /** Balance Sheet builder: reorder items within a category (e.g., current_assets, fixed_assets). */
  reorderBalanceSheetCategory: (category: "current_assets" | "fixed_assets" | "current_liabilities" | "non_current_liabilities" | "equity", fromIndex: number, toIndex: number) => void;
  /** Balance Sheet builder: set cash flow behavior for a row (WC/CFI/CFF/non-cash). */
  setBalanceSheetRowCashFlowBehavior: (rowId: string, behavior: "working_capital" | "investing" | "financing" | "non_cash") => void;
  /** Income Statement builder: reorder children of a parent row (e.g., SG&A breakdowns). */
  reorderIncomeStatementChildren: (parentId: string, fromIndex: number, toIndex: number) => void;
  /** Income Statement builder: reorder top-level rows (e.g., Interest & Other items). */
  reorderIncomeStatementRows: (fromIndex: number, toIndex: number) => void;

  // SBC annotation
  updateSbcValue: (categoryId: string, year: string, value: number) => void;
  /** Set one year value for an embedded disclosure (e.g. SBC). One entry per (type, rowId). Optional label stored for preview when row is not in statement tree. */
  setEmbeddedDisclosureValue: (type: EmbeddedDisclosureItem["type"], rowId: string, year: string, value: number, label?: string) => void;
  /** Turn SBC disclosure section on/off. When off, CFS SBC does not use disclosure fallback and disclosure block is hidden in preview. */
  setSbcDisclosureEnabled: (enabled: boolean) => void;

  // Section lock and expand management
  lockSection: (sectionId: string) => void;
  unlockSection: (sectionId: string) => void;
  toggleSectionExpanded: (sectionId: string) => void;
  setSectionExpanded: (sectionId: string, expanded: boolean) => void;
  
  // Confirmed row management for Cash Flow Builder
  toggleConfirmedRow: (rowId: string) => void;
  
  // Years management
  updateYears: (years: { historical: string[]; projection: string[] }) => void;

  // Multi-project: create new project (from ModelSetup), load project, save current into cache
  createProject: (projectName: string, meta: ModelMeta, options?: { fromCurrentState?: boolean }) => string;
  loadProject: (projectId: string) => void;
  saveCurrentProject: () => void;
  renameProject: (projectId: string, name: string) => void;
  deleteProject: (projectId: string) => void;
  /** Clear all entered financial data (historical values, disclosures, schedule inputs); keeps statement structure and config. */
  resetFinancialInputs: () => void;
  /** Scoped resets: clear only the selected statement(s) and related inputs. */
  resetAllFinancialInputs: () => void;
  resetIncomeStatementInputs: () => void;
  resetBalanceSheetInputs: () => void;
  resetCashFlowInputs: () => void;

  // Legacy/backward compatibility
  addRevenueStream: (label: string) => void;
  updateIncomeStatementValue: (rowId: string, year: string, value: number) => void;

  // IS Build: revenue projection config (method + inputs per stream/sub-item)
  setRevenueProjectionMethod: (itemId: string, method: RevenueProjectionMethod) => void;
  setRevenueProjectionInputs: (itemId: string, inputs: RevenueProjectionInputs) => void;
  /** IS Build: set COGS as % of revenue (0–100) for a projected revenue line. */
  setCogsPctForRevenueLine: (revenueLineId: string, pct: number) => void;
  setCogsPctModeForRevenueLine: (revenueLineId: string, mode: "constant" | "custom") => void;
  setCogsPctForRevenueLineYear: (revenueLineId: string, year: string, pct: number) => void;
  /** IS Build: set SG&A as % of revenue (0–100) for an SG&A item. */
  setSgaPctForItem: (itemId: string, pct: number) => void;
  setSgaPctModeForItem: (itemId: string, mode: "constant" | "custom") => void;
  setSgaPctForItemYear: (itemId: string, year: string, pct: number) => void;
  /** IS Build: set sub-item % of parent (0–100). */
  setSgaPctOfParentForItem: (itemId: string, pct: number) => void;
  setSgaPctOfParentModeForItem: (itemId: string, mode: "constant" | "custom") => void;
  setSgaPctOfParentForItemYear: (itemId: string, year: string, pct: number) => void;
  /** IS Build: set historic amount for a sub-item in a year (breakdown helper Option A). */
  setSgaHistoricAmountForItemYear: (itemId: string, year: string, value: number) => void;
  /** BS Build / Working Capital Schedule: set driver type for a WC item. */
  setWcDriverType: (itemId: string, driver: "days" | "pct_revenue" | "pct_cogs" | "manual") => void;
  /** WC: set constant days driver (used for all projection years when no per-year override). */
  setWcDaysForItem: (itemId: string, days: number) => void;
  /** WC: set days driver for a specific year. */
  setWcDaysForItemYear: (itemId: string, year: string, days: number) => void;
  /** WC: set base for Days driver (revenue vs COGS). AR → Revenue, Inventory/AP → COGS. */
  setWcDaysBaseForItem: (itemId: string, base: "revenue" | "cogs") => void;
  /** WC: set % base for pct driver (revenue or cogs). */
  setWcPctBaseForItem: (itemId: string, base: "revenue" | "cogs") => void;
  /** WC: set constant % driver (0–100). */
  setWcPctForItem: (itemId: string, pct: number) => void;
  /** WC: set % driver for a specific year (0–100). */
  setWcPctForItemYear: (itemId: string, year: string, pct: number) => void;
  setCapexForecastMethod: (method: "pct_revenue" | "manual" | "growth") => void;
  setCapexPctRevenue: (pct: number) => void;
  setCapexManualByYear: (year: string, value: number) => void;
  setCapexGrowthPct: (pct: number) => void;
  setCapexSplitByBucket: (on: boolean) => void;
  setCapexForecastBucketsIndependently: (on: boolean) => void;
  setCapexTimingConvention: (timing: "mid" | "start" | "end") => void;
  setCapexBucketAllocationPct: (bucketId: string, pct: number) => void;
  setCapexBucketLabel: (bucketId: string, label: string) => void;
  addCapexBucket: (label?: string) => string;
  removeCapexBucket: (bucketId: string) => void;
  setCapexBucketMethod: (bucketId: string, method: "pct_revenue" | "manual" | "growth") => void;
  setCapexBucketPctRevenue: (bucketId: string, pct: number) => void;
  setCapexBucketManualByYear: (bucketId: string, year: string, value: number) => void;
  setCapexBucketGrowthPct: (bucketId: string, pct: number) => void;
  setPpeUsefulLifeByBucket: (bucketId: string, years: number) => void;
  setPpeUsefulLifeSingle: (years: number) => void;
  setCapexHistoricBucketYear: (bucketId: string, year: string, value: number) => void;
  setCapexHelperPpeBucketYear: (bucketId: string, year: string, value: number) => void;
  setCapexIncludeInAllocation: (bucketId: string, include: boolean) => void;
  resetCapexHelperUsefulLivesToDefaults: () => void;
  applyCapexHelperWeightsToForecast: (weightsPct: Record<string, number>) => void;
  setCapexModelIntangibles: (on: boolean) => void;
  setIntangiblesForecastMethod: (method: "pct_revenue" | "manual" | "pct_capex") => void;
  setIntangiblesAmortizationLifeYears: (years: number) => void;
  setIntangiblesPctRevenue: (pct: number) => void;
  setIntangiblesManualByYear: (year: string, value: number) => void;
  setIntangiblesPctOfCapex: (pct: number) => void;
  setIntangiblesHasHistoricalAmortization: (on: boolean) => void;
  setIntangiblesHistoricalAmortizationForYear: (year: string, value: number) => void;
  /** Set BS Build preview overrides (WC + PP&E + Intangibles schedule outputs). Preview-only, not persisted. */
  setBsBuildPreviewOverrides: (overrides: Record<string, Record<string, number>>) => void;
  addRevenueBreakdown: (parentId: string, label: string) => string;
  removeRevenueBreakdown: (parentId: string, itemId: string) => void;
  renameRevenueBreakdown: (parentId: string, itemId: string, label: string) => void;
  setBreakdownAllocation: (parentId: string, mode: "percentages" | "amounts", allocations: Record<string, number>, year: string) => void;
  /** Allocation for projection years only: % per breakdown (sum 100%). Applies from first projection year onwards. */
  setProjectionAllocation: (parentId: string, percentages: Record<string, number>) => void;
};

/**
 * Default state
 * CRITICAL: meta.years.historical + meta.years.projection must ALWAYS exist
 */
const defaultState: ModelState = {
  currentProjectId: null,
  projects: [],
  projectStates: {},

  meta: {
    companyName: "NewCo",
    companyType: "private",
    currency: "USD",
    currencyUnit: "millions",
    modelType: "dcf",
    years: {
      historical: ["2023A", "2024A"],
      projection: ["2025E", "2026E", "2027E", "2028E", "2029E"],
    },
  },
  isInitialized: false,
  _hasHydrated: false,

  incomeStatement: [
    {
      id: "rev",
      label: "Revenue",
      kind: "input", // Start as input, becomes calc when breakdowns are added
      valueType: "currency",
      values: {},
      children: [], // revenue streams go here
    },
    {
      id: "cogs",
      label: "COGS",
      kind: "input", // Start as input, becomes calc when breakdowns are added
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "gross_profit",
      label: "Gross Profit",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "gross_margin",
      label: "Gross Margin %",
      kind: "calc",
      valueType: "percent",
      values: {},
      children: [],
    },
  ],

  balanceSheet: [
    {
      id: "cash",
      label: "Cash",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
  ],

  cashFlow: [
    {
      id: "net_income",
      label: "Net Income",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
  ],

  schedules: {
    workingCapital: [],
    debt: [],
    capex: [],
  },

  sbcBreakdowns: {},
  embeddedDisclosures: [],
  sbcDisclosureEnabled: true,

  danaLocation: null,
  danaBreakdowns: {},

  currentStepId: "historicals",
  completedStepIds: [],
  isModelComplete: false,

  // Section lock and expand state - default all sections unlocked and expanded
  sectionLocks: {},
  sectionExpanded: {},
  
  // Confirmed row IDs - default empty (no rows confirmed/collapsed)
  confirmedRowIds: {},
  wcExcludedIds: [],
  revenueProjectionConfig: DEFAULT_REVENUE_PROJECTION_CONFIG,
  cogsPctByRevenueLine: {},
  cogsPctModeByRevenueLine: {},
  cogsPctByRevenueLineByYear: {},
  sgaPctByItemId: {},
  sgaPctModeByItemId: {},
  sgaPctByItemIdByYear: {},
  sgaPctOfParentByItemId: {},
  sgaPctOfParentModeByItemId: {},
  sgaPctOfParentByItemIdByYear: {},
  sgaHistoricAmountByItemIdByYear: {},
  wcDriverTypeByItemId: {},
  wcDaysByItemId: {},
  wcDaysByItemIdByYear: {},
  wcDaysBaseByItemId: {},
  wcPctBaseByItemId: {},
  wcPctByItemId: {},
  wcPctByItemIdByYear: {},
  capexForecastMethod: "pct_revenue",
  capexPctRevenue: 0,
  capexManualByYear: {},
  capexGrowthPct: 0,
  capexSplitByBucket: true,
  capexForecastBucketsIndependently: false,
  capexTimingConvention: "mid",
  capexBucketAllocationPct: {},
  capexBucketLabels: {},
  capexCustomBucketIds: [],
  capexBucketMethod: {},
  capexBucketPctRevenue: {},
  capexBucketManualByYear: {},
  capexBucketGrowthPct: {},
  ppeUsefulLifeByBucket: { ...CAPEX_IB_DEFAULT_USEFUL_LIVES },
  ppeUsefulLifeSingle: 10,
  capexHistoricByBucketByYear: {},
  capexHelperPpeByBucketByYear: {},
  capexIncludeInAllocationByBucket: {},
  capexModelIntangibles: true,
  intangiblesForecastMethod: "pct_revenue",
  intangiblesAmortizationLifeYears: 7,
  intangiblesPctRevenue: 0,
  intangiblesManualByYear: {},
  intangiblesPctOfCapex: 0,
  intangiblesHasHistoricalAmortization: false,
  intangiblesHistoricalAmortizationByYear: {},
  bsBuildPreviewOverrides: {},
};

/** Build a snapshot of current model state for storing per-project */
function getProjectSnapshot(state: ModelState): ProjectSnapshot {
  return {
    meta: state.meta,
    isInitialized: state.isInitialized,
    incomeStatement: state.incomeStatement,
    balanceSheet: state.balanceSheet,
    cashFlow: state.cashFlow,
    schedules: state.schedules,
    sbcBreakdowns: state.sbcBreakdowns,
    embeddedDisclosures: state.embeddedDisclosures ?? [],
    sbcDisclosureEnabled: state.sbcDisclosureEnabled ?? true,
    danaLocation: state.danaLocation,
    danaBreakdowns: state.danaBreakdowns,
    currentStepId: state.currentStepId,
    completedStepIds: state.completedStepIds,
    isModelComplete: state.isModelComplete,
    sectionLocks: state.sectionLocks,
    sectionExpanded: state.sectionExpanded,
    confirmedRowIds: state.confirmedRowIds,
    wcExcludedIds: state.wcExcludedIds,
    revenueProjectionConfig: state.revenueProjectionConfig ?? DEFAULT_REVENUE_PROJECTION_CONFIG,
    cogsPctByRevenueLine: state.cogsPctByRevenueLine ?? {},
    cogsPctModeByRevenueLine: state.cogsPctModeByRevenueLine ?? {},
    cogsPctByRevenueLineByYear: state.cogsPctByRevenueLineByYear ?? {},
    sgaPctByItemId: state.sgaPctByItemId ?? {},
    sgaPctModeByItemId: state.sgaPctModeByItemId ?? {},
    sgaPctByItemIdByYear: state.sgaPctByItemIdByYear ?? {},
    sgaPctOfParentByItemId: state.sgaPctOfParentByItemId ?? {},
    sgaPctOfParentModeByItemId: state.sgaPctOfParentModeByItemId ?? {},
    sgaPctOfParentByItemIdByYear: state.sgaPctOfParentByItemIdByYear ?? {},
    sgaHistoricAmountByItemIdByYear: state.sgaHistoricAmountByItemIdByYear ?? {},
    wcDriverTypeByItemId: state.wcDriverTypeByItemId ?? {},
    wcDaysByItemId: state.wcDaysByItemId ?? {},
    wcDaysByItemIdByYear: state.wcDaysByItemIdByYear ?? {},
    wcDaysBaseByItemId: state.wcDaysBaseByItemId ?? {},
    wcPctBaseByItemId: state.wcPctBaseByItemId ?? {},
    wcPctByItemId: state.wcPctByItemId ?? {},
    wcPctByItemIdByYear: state.wcPctByItemIdByYear ?? {},
    capexForecastMethod: state.capexForecastMethod ?? "pct_revenue",
    capexPctRevenue: state.capexPctRevenue ?? 0,
    capexManualByYear: state.capexManualByYear ?? {},
    capexGrowthPct: state.capexGrowthPct ?? 0,
    capexSplitByBucket: state.capexSplitByBucket ?? true,
    capexForecastBucketsIndependently: state.capexForecastBucketsIndependently ?? false,
    capexTimingConvention: state.capexTimingConvention ?? "mid",
    capexBucketAllocationPct: state.capexBucketAllocationPct ?? {},
    capexBucketLabels: state.capexBucketLabels ?? {},
    capexCustomBucketIds: state.capexCustomBucketIds ?? [],
    capexBucketMethod: state.capexBucketMethod ?? {},
    capexBucketPctRevenue: state.capexBucketPctRevenue ?? {},
    capexBucketManualByYear: state.capexBucketManualByYear ?? {},
    capexBucketGrowthPct: state.capexBucketGrowthPct ?? {},
    ppeUsefulLifeByBucket: state.ppeUsefulLifeByBucket ?? {},
    ppeUsefulLifeSingle: state.ppeUsefulLifeSingle ?? 10,
    capexHistoricByBucketByYear: state.capexHistoricByBucketByYear ?? {},
    capexHelperPpeByBucketByYear: state.capexHelperPpeByBucketByYear ?? {},
    capexIncludeInAllocationByBucket: state.capexIncludeInAllocationByBucket ?? {},
    capexModelIntangibles: true,
    intangiblesForecastMethod: (String(state.intangiblesForecastMethod) === "growth" ? "pct_revenue" : state.intangiblesForecastMethod) ?? "pct_revenue",
    intangiblesAmortizationLifeYears: state.intangiblesAmortizationLifeYears ?? 7,
    intangiblesPctRevenue: state.intangiblesPctRevenue ?? 0,
    intangiblesManualByYear: state.intangiblesManualByYear ?? {},
    intangiblesPctOfCapex: state.intangiblesPctOfCapex ?? 0,
    intangiblesHasHistoricalAmortization: state.intangiblesHasHistoricalAmortization ?? false,
    intangiblesHistoricalAmortizationByYear: state.intangiblesHistoricalAmortizationByYear ?? {},
  };
}

/** Apply a project snapshot into the store (model state only) */
function applyProjectSnapshot(
  set: (fn: (s: ModelState & ModelActions) => Partial<ModelState>) => void,
  snapshot: ProjectSnapshot
) {
  const normalizedIS = normalizeIncomeStatementOperatingExpenses(snapshot.incomeStatement ?? []);
  const safeMeta = snapshot.meta && typeof snapshot.meta === "object" && snapshot.meta.years
    ? snapshot.meta
    : { companyName: "", companyType: "public" as const, currency: "USD", currencyUnit: "millions" as const, modelType: "dcf" as const, years: { historical: [] as string[], projection: [] as string[] } };
  set(() => ({
    meta: safeMeta,
    isInitialized: true, // Always true when loading a snapshot (if snapshot exists, project is initialized)
    incomeStatement: normalizedIS,
    balanceSheet: Array.isArray(snapshot.balanceSheet) ? snapshot.balanceSheet : [],
    cashFlow: Array.isArray(snapshot.cashFlow) ? normalizeWcStructure(snapshot.cashFlow) : [],
    schedules: snapshot.schedules && typeof snapshot.schedules === "object"
      ? {
          workingCapital: Array.isArray(snapshot.schedules.workingCapital) ? snapshot.schedules.workingCapital : [],
          debt: Array.isArray(snapshot.schedules.debt) ? snapshot.schedules.debt : [],
          capex: Array.isArray(snapshot.schedules.capex) ? snapshot.schedules.capex : [],
        }
      : { workingCapital: [], debt: [], capex: [] },
    sbcBreakdowns: snapshot.sbcBreakdowns,
    embeddedDisclosures: snapshot.embeddedDisclosures ?? [],
    sbcDisclosureEnabled: snapshot.sbcDisclosureEnabled ?? true,
    danaLocation: snapshot.danaLocation,
    danaBreakdowns: snapshot.danaBreakdowns,
    currentStepId: snapshot.currentStepId,
    completedStepIds: snapshot.completedStepIds,
    isModelComplete: snapshot.isModelComplete,
    sectionLocks: snapshot.sectionLocks ?? {},
    sectionExpanded: snapshot.sectionExpanded ?? {},
    confirmedRowIds: snapshot.confirmedRowIds ?? {},
    wcExcludedIds: snapshot.wcExcludedIds ?? [],
    revenueProjectionConfig: snapshot.revenueProjectionConfig ?? DEFAULT_REVENUE_PROJECTION_CONFIG,
    cogsPctByRevenueLine: snapshot.cogsPctByRevenueLine ?? {},
    cogsPctModeByRevenueLine: snapshot.cogsPctModeByRevenueLine ?? {},
    cogsPctByRevenueLineByYear: snapshot.cogsPctByRevenueLineByYear ?? {},
    sgaPctByItemId: snapshot.sgaPctByItemId ?? {},
    sgaPctModeByItemId: snapshot.sgaPctModeByItemId ?? {},
    sgaPctByItemIdByYear: snapshot.sgaPctByItemIdByYear ?? {},
    sgaPctOfParentByItemId: snapshot.sgaPctOfParentByItemId ?? {},
    sgaPctOfParentModeByItemId: snapshot.sgaPctOfParentModeByItemId ?? {},
    sgaPctOfParentByItemIdByYear: snapshot.sgaPctOfParentByItemIdByYear ?? {},
    sgaHistoricAmountByItemIdByYear: snapshot.sgaHistoricAmountByItemIdByYear ?? {},
    wcDriverTypeByItemId: snapshot.wcDriverTypeByItemId ?? {},
    wcDaysByItemId: snapshot.wcDaysByItemId ?? {},
    wcDaysByItemIdByYear: snapshot.wcDaysByItemIdByYear ?? {},
    wcDaysBaseByItemId: snapshot.wcDaysBaseByItemId ?? {},
    wcPctBaseByItemId: snapshot.wcPctBaseByItemId ?? {},
    wcPctByItemId: snapshot.wcPctByItemId ?? {},
    wcPctByItemIdByYear: snapshot.wcPctByItemIdByYear ?? {},
    capexForecastMethod: snapshot.capexForecastMethod ?? "pct_revenue",
    capexPctRevenue: snapshot.capexPctRevenue ?? 0,
    capexManualByYear: snapshot.capexManualByYear ?? {},
    capexGrowthPct: snapshot.capexGrowthPct ?? 0,
    capexSplitByBucket: snapshot.capexSplitByBucket ?? true,
    capexForecastBucketsIndependently: snapshot.capexForecastBucketsIndependently ?? false,
    capexTimingConvention: snapshot.capexTimingConvention ?? "mid",
    capexBucketAllocationPct: snapshot.capexBucketAllocationPct ?? {},
    capexBucketLabels: snapshot.capexBucketLabels ?? {},
    capexCustomBucketIds: snapshot.capexCustomBucketIds ?? [],
    capexBucketMethod: snapshot.capexBucketMethod ?? {},
    capexBucketPctRevenue: snapshot.capexBucketPctRevenue ?? {},
    capexBucketManualByYear: snapshot.capexBucketManualByYear ?? {},
    capexBucketGrowthPct: snapshot.capexBucketGrowthPct ?? {},
    ppeUsefulLifeByBucket:
      snapshot.ppeUsefulLifeByBucket &&
      Object.keys(snapshot.ppeUsefulLifeByBucket).length > 0 &&
      !isLegacyWrongUsefulLives(snapshot.ppeUsefulLifeByBucket)
        ? snapshot.ppeUsefulLifeByBucket
        : { ...CAPEX_IB_DEFAULT_USEFUL_LIVES },
    ppeUsefulLifeSingle: snapshot.ppeUsefulLifeSingle ?? 10,
    capexHistoricByBucketByYear: snapshot.capexHistoricByBucketByYear ?? {},
    capexHelperPpeByBucketByYear: snapshot.capexHelperPpeByBucketByYear ?? {},
    capexIncludeInAllocationByBucket: snapshot.capexIncludeInAllocationByBucket ?? {},
    capexModelIntangibles: true,
    intangiblesForecastMethod: (String(snapshot.intangiblesForecastMethod) === "growth" ? "pct_revenue" : snapshot.intangiblesForecastMethod) ?? "pct_revenue",
    intangiblesAmortizationLifeYears: snapshot.intangiblesAmortizationLifeYears ?? 7,
    intangiblesPctRevenue: snapshot.intangiblesPctRevenue ?? 0,
    intangiblesManualByYear: snapshot.intangiblesManualByYear ?? {},
    intangiblesPctOfCapex: snapshot.intangiblesPctOfCapex ?? 0,
    intangiblesHasHistoricalAmortization: snapshot.intangiblesHasHistoricalAmortization ?? false,
    intangiblesHistoricalAmortizationByYear: snapshot.intangiblesHistoricalAmortizationByYear ?? {},
  }));
}

/** Safe storage for persist: no-op on server (localStorage undefined), use localStorage on client */
const persistStorage = typeof window === "undefined"
  ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  : undefined;

/**
 * Store with persistence
 */
export const useModelStore = create<ModelState & ModelActions>()(
  persist(
    (set, get) => ({
  ...defaultState,

  initializeModel: (meta, options?: { force?: boolean }) => {
    const state = get();
    const force = options?.force === true;
    // Only initialize if not already initialized (preserve existing data), unless force
    if (!state.isInitialized || force) {
      // When force (e.g. "New project"), always start fresh from templates. Otherwise keep existing if present.
      const useTemplates = force || state.incomeStatement.length === 0;
      let incomeStatement = useTemplates
        ? createIncomeStatementTemplate()
        : [...state.incomeStatement];
      let balanceSheet = useTemplates
        ? createBalanceSheetTemplate()
        : [...state.balanceSheet];
      let cashFlow = useTemplates
        ? createCashFlowTemplate()
        : [...state.cashFlow];

      // Migration: Ensure core Income Statement skeleton items (no sga/danda - operating_expenses children are user-built)
      const coreISItems = [
        { id: "rev", label: "Revenue", kind: "input", valueType: "currency", after: null },
        { id: "cogs", label: "Cost of Goods Sold (COGS)", kind: "input", valueType: "currency", after: "rev" },
        { id: "gross_profit", label: "Gross Profit", kind: "calc", valueType: "currency", after: "cogs" },
        { id: "gross_margin", label: "Gross Margin %", kind: "calc", valueType: "percent", after: "gross_profit" },
        { id: "ebit", label: "EBIT (Operating Income)", kind: "calc", valueType: "currency", after: "operating_expenses" },
        { id: "ebit_margin", label: "EBIT Margin %", kind: "calc", valueType: "percent", after: "ebit" },
        { id: "interest_expense", label: "Interest Expense", kind: "input", valueType: "currency", after: "ebit_margin" },
        { id: "interest_income", label: "Interest Income", kind: "input", valueType: "currency", after: "interest_expense" },
        { id: "other_income", label: "Other Income / (Expense), net", kind: "input", valueType: "currency", after: "interest_income" },
        { id: "ebt", label: "EBT (Earnings Before Tax)", kind: "calc", valueType: "currency", after: "other_income" },
        { id: "tax", label: "Income Tax Expense", kind: "input", valueType: "currency", after: "ebt" },
        { id: "net_income", label: "Net Income", kind: "calc", valueType: "currency", after: "tax" },
        { id: "net_income_margin", label: "Net Income Margin %", kind: "calc", valueType: "percent", after: "net_income" },
      ];
      coreISItems.forEach((coreItem) => {
        const exists = incomeStatement.some((r) => r.id === coreItem.id);
        if (!exists) {
          let insertIndex = incomeStatement.length;
          if (coreItem.after) {
            const afterIndex = incomeStatement.findIndex((r) => r.id === coreItem.after);
            if (afterIndex >= 0) insertIndex = afterIndex + 1;
          } else {
            insertIndex = 0;
          }
          incomeStatement.splice(insertIndex, 0, {
            id: coreItem.id,
            label: coreItem.label,
            kind: coreItem.kind as any,
            valueType: coreItem.valueType as any,
            values: {},
            children: [],
          });
        }
      });

      // Migration: Ensure gross_margin exists (added in later version)
      const hasGrossMargin = incomeStatement.some((r) => r.id === "gross_margin");
      if (!hasGrossMargin) {
        const grossProfitIndex = incomeStatement.findIndex((r) => r.id === "gross_profit");
        if (grossProfitIndex >= 0) {
          incomeStatement.splice(grossProfitIndex + 1, 0, {
            id: "gross_margin",
            label: "Gross Margin %",
            kind: "calc",
            valueType: "percent",
            values: {},
            children: [],
          });
        }
      }

      // Migration: Ensure EBITDA exists (should be in template, but check anyway)
      const hasEbitda = incomeStatement.some((r) => r.id === "ebitda");
      if (!hasEbitda) {
        // Find where to insert EBITDA - after Other Operating Expenses
        const otherOpexIndex = incomeStatement.findIndex((r) => r.id === "other_opex");
        const rdIndex = incomeStatement.findIndex((r) => r.id === "rd");
        const insertIndex = otherOpexIndex >= 0 ? otherOpexIndex + 1 : 
                           rdIndex >= 0 ? rdIndex + 1 : 
                           incomeStatement.length;
        // Insert EBITDA
        incomeStatement.splice(insertIndex, 0, {
          id: "ebitda",
          label: "EBITDA",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure EBITDA margin exists (added in later version)
      const hasEbitdaMargin = incomeStatement.some((r) => r.id === "ebitda_margin");
      if (!hasEbitdaMargin) {
        const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
        if (ebitdaIndex >= 0) {
          // Insert EBITDA margin right after EBITDA
          incomeStatement.splice(ebitdaIndex + 1, 0, {
            id: "ebitda_margin",
            label: "EBITDA Margin %",
            kind: "calc",
            valueType: "percent",
            values: {},
            children: [],
          });
        }
      }

      // Migration: Remove EBITDA and EBITDA Margin from IS (D&A is shown directly, then EBIT)
      const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
      if (ebitdaIndex >= 0) {
        incomeStatement.splice(ebitdaIndex, 1);
      }
      const ebitdaMarginIndex = incomeStatement.findIndex((r) => r.id === "ebitda_margin");
      if (ebitdaMarginIndex >= 0) {
        incomeStatement.splice(ebitdaMarginIndex, 1);
      }

      // Normalize: guarantee operating_expenses exists at top level (after gross_margin) with sga/rd/other_opex/danda as children
      incomeStatement = normalizeIncomeStatementOperatingExpenses(incomeStatement);

      // Migration: Ensure EBIT exists and is in the correct position (after operating_expenses)
      const hasEbit = incomeStatement.some((r) => r.id === "ebit");
      const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
      const opExIndexAfterNorm = incomeStatement.findIndex((r) => r.id === "operating_expenses");
      const insertAfterIndex = opExIndexAfterNorm >= 0 ? opExIndexAfterNorm : incomeStatement.findIndex((r) => r.id === "gross_margin") + 1;
      if (!hasEbit) {
        // Insert EBIT after Operating Expenses (or after SG&A in legacy)
        const insertIndex = insertAfterIndex >= 0 ? insertAfterIndex + 1 : incomeStatement.length;
        incomeStatement.splice(insertIndex, 0, {
          id: "ebit",
          label: "EBIT (Operating Income)",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        });
      } else if (ebitIndex >= 0 && insertAfterIndex >= 0) {
        // EBIT exists - check if it needs to be moved
        if (ebitIndex < insertAfterIndex) {
          // EBIT exists but is before Operating Expenses / SG&A - move it after
          const ebitRow = incomeStatement[ebitIndex];
          incomeStatement.splice(ebitIndex, 1);
          const newIndex = insertAfterIndex; // correct since we removed EBIT
          incomeStatement.splice(newIndex + 1, 0, ebitRow);
        } else if (ebitIndex > insertAfterIndex + 3) {
          // EBIT exists but is too far after operating_expenses (likely at the end) - move it right after
          const ebitRow = incomeStatement[ebitIndex];
          incomeStatement.splice(ebitIndex, 1);
          incomeStatement.splice(insertAfterIndex + 1, 0, ebitRow);
        }
      }
      
      // Also ensure EBIT margin is right after EBIT
      const hasEbitMargin = incomeStatement.some((r) => r.id === "ebit_margin");
      const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
      const currentEbitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
      
      if (!hasEbitMargin && currentEbitIndex >= 0) {
        incomeStatement.splice(currentEbitIndex + 1, 0, {
          id: "ebit_margin",
          label: "EBIT Margin %",
          kind: "calc",
          valueType: "percent",
          values: {},
          children: [],
        });
      } else if (ebitMarginIndex >= 0 && currentEbitIndex >= 0 && ebitMarginIndex !== currentEbitIndex + 1) {
        // EBIT margin exists but is not right after EBIT - move it
        const ebitMarginRow = incomeStatement[ebitMarginIndex];
        incomeStatement.splice(ebitMarginIndex, 1);
        const newIndex = currentEbitIndex;
        incomeStatement.splice(newIndex + 1, 0, ebitMarginRow);
      }

      // Migration: Update "Other Income / (Expense)" label to "Other Income / (Expense), net"
      const otherIncomeRow = incomeStatement.find((r) => r.id === "other_income");
      if (otherIncomeRow && otherIncomeRow.label === "Other Income / (Expense)") {
        otherIncomeRow.label = "Other Income / (Expense), net";
      }

      // Migration: Ensure Balance Sheet subtotals exist and are in correct order
      // This ensures subtotals appear in the preview in the right positions
      const totalCurrentAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_current_assets");
      const totalAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_assets");
      const totalCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_current_liabilities");
      const totalLiabIndex = balanceSheet.findIndex((r) => r.id === "total_liabilities");
      const totalEquityIndex = balanceSheet.findIndex((r) => r.id === "total_equity");
      const totalLiabAndEquityIndex = balanceSheet.findIndex((r) => r.id === "total_liab_and_equity");
      
      // Ensure Total Current Assets exists (after current assets items, before fixed assets)
      if (totalCurrentAssetsIndex === -1) {
        // Find last current asset item
        const caIds = ["cash", "ar", "inventory", "other_ca"];
        let insertIndex = 0;
        for (let i = balanceSheet.length - 1; i >= 0; i--) {
          if (caIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("ca_")) {
            insertIndex = i + 1;
            break;
          }
        }
        balanceSheet.splice(insertIndex, 0, {
          id: "total_current_assets",
          label: "Total Current Assets",
          kind: "subtotal",
          valueType: "currency",
          values: {},
          children: [],
        });
      }
      
      // Ensure Total Fixed Assets exists (after fixed assets items, before total_assets)
      const totalFixedAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_fixed_assets");
      if (totalFixedAssetsIndex === -1) {
        const newTotalCAIndex = balanceSheet.findIndex((r) => r.id === "total_current_assets");
        const faIds = ["ppe", "intangible_assets", "other_assets"];
        let insertIndex = newTotalCAIndex + 1;
        for (let i = balanceSheet.length - 1; i > newTotalCAIndex; i--) {
          if (faIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("fa_")) {
            insertIndex = i + 1;
            break;
          }
        }
        balanceSheet.splice(insertIndex, 0, {
          id: "total_fixed_assets",
          label: "Total Fixed Assets",
          kind: "subtotal",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Ensure Total Assets exists (after total_fixed_assets, before liabilities)
      if (totalAssetsIndex === -1) {
        const newTotalFixedAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_fixed_assets");
        const insertIndex = newTotalFixedAssetsIndex >= 0 ? newTotalFixedAssetsIndex + 1 : balanceSheet.length;
        balanceSheet.splice(insertIndex, 0, {
          id: "total_assets",
          label: "Total Assets",
          kind: "total",
          valueType: "currency",
          values: {},
          children: [],
        });
      }
      
      // Ensure Total Current Liabilities exists
      if (totalCurrentLiabIndex === -1) {
        const newTotalAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_assets");
        const clIds = ["ap", "st_debt", "other_cl"];
        let insertIndex = newTotalAssetsIndex + 1;
        for (let i = balanceSheet.length - 1; i > newTotalAssetsIndex; i--) {
          if (clIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("cl_")) {
            insertIndex = i + 1;
            break;
          }
        }
        balanceSheet.splice(insertIndex, 0, {
          id: "total_current_liabilities",
          label: "Total Current Liabilities",
          kind: "subtotal",
          valueType: "currency",
          values: {},
          children: [],
        });
      }
      
      // Ensure Total Non-Current Liabilities exists (after non-current liabilities items, before total_liabilities)
      const totalNonCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_non_current_liabilities");
      if (totalNonCurrentLiabIndex === -1) {
        const newTotalCLIndex = balanceSheet.findIndex((r) => r.id === "total_current_liabilities");
        const nclIds = ["lt_debt", "other_liab"];
        let insertIndex = newTotalCLIndex + 1;
        for (let i = balanceSheet.length - 1; i > newTotalCLIndex; i--) {
          if (nclIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("ncl_")) {
            insertIndex = i + 1;
            break;
          }
        }
        balanceSheet.splice(insertIndex, 0, {
          id: "total_non_current_liabilities",
          label: "Total Non-Current Liabilities",
          kind: "subtotal",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Ensure Total Liabilities exists (after total_non_current_liabilities, before equity)
      if (totalLiabIndex === -1) {
        const newTotalNonCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_non_current_liabilities");
        const insertIndex = newTotalNonCurrentLiabIndex >= 0 ? newTotalNonCurrentLiabIndex + 1 : balanceSheet.length;
        balanceSheet.splice(insertIndex, 0, {
          id: "total_liabilities",
          label: "Total Liabilities",
          kind: "total",
          valueType: "currency",
          values: {},
          children: [],
        });
      }
      
      // Ensure Total Equity exists
      if (totalEquityIndex === -1) {
        const newTotalLiabIndex = balanceSheet.findIndex((r) => r.id === "total_liabilities");
        const equityIds = ["common_stock", "retained_earnings", "other_equity"];
        let insertIndex = newTotalLiabIndex + 1;
        for (let i = balanceSheet.length - 1; i > newTotalLiabIndex; i--) {
          if (equityIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("equity_")) {
            insertIndex = i + 1;
            break;
          }
        }
        balanceSheet.splice(insertIndex, 0, {
          id: "total_equity",
          label: "Total Equity",
          kind: "total",
          valueType: "currency",
          values: {},
          children: [],
        });
      }
      
      // Ensure Total Liabilities & Equity exists (at the very end)
      if (totalLiabAndEquityIndex === -1) {
        balanceSheet.push({
          id: "total_liab_and_equity",
          label: "Total Liabilities & Equity",
          kind: "total",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure CFS items exist (D&A, SBC, WC Change, Operating CF, Investing items)
      // Migration: Ensure D&A exists in CFS
      const hasDandaInCFS = cashFlow.some((r) => r.id === "danda");
      if (!hasDandaInCFS) {
        const netIncomeIndex = cashFlow.findIndex((r) => r.id === "net_income");
        const insertIndex = netIncomeIndex >= 0 ? netIncomeIndex + 1 : cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "danda",
          label: "Depreciation & Amortization",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure SBC exists in CFS
      const hasSbcInCFS = cashFlow.some((r) => r.id === "sbc");
      if (!hasSbcInCFS) {
        const dandaIndex = cashFlow.findIndex((r) => r.id === "danda");
        const wcChangeIndex = cashFlow.findIndex((r) => r.id === "wc_change");
        const insertIndex = dandaIndex >= 0 ? dandaIndex + 1 : 
                           wcChangeIndex >= 0 ? wcChangeIndex : 
                           cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "sbc",
          label: "Stock-Based Compensation",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure WC Change exists in CFS
      const hasWcChangeInCFS = cashFlow.some((r) => r.id === "wc_change");
      if (!hasWcChangeInCFS) {
        const sbcIndex = cashFlow.findIndex((r) => r.id === "sbc");
        const otherOperatingIndex = cashFlow.findIndex((r) => r.id === "other_operating");
        const operatingCfIndex = cashFlow.findIndex((r) => r.id === "operating_cf");
        const insertIndex = sbcIndex >= 0 ? sbcIndex + 1 : 
                           otherOperatingIndex >= 0 ? otherOperatingIndex : 
                           operatingCfIndex >= 0 ? operatingCfIndex : 
                           cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "wc_change",
          label: "Change in Working Capital",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure Operating CF total exists
      const hasOperatingCf = cashFlow.some((r) => r.id === "operating_cf");
      if (!hasOperatingCf) {
        const otherOperatingIndex = cashFlow.findIndex((r) => r.id === "other_operating");
        const insertIndex = otherOperatingIndex >= 0 ? otherOperatingIndex + 1 : cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "operating_cf",
          label: "Cash from Operating Activities",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure Investing section items exist (capex, acquisitions, asset_sales, investments, other_investing, investing_cf)
      const cfsTemplate = createCashFlowTemplate();
      const getDefaultCfsRow = (id: string): Row | null => {
        const row = cfsTemplate.find((r) => r.id === id);
        if (!row) return null;
        return { ...row, values: {} };
      };

      const hasCapex = cashFlow.some((r) => r.id === "capex");
      if (!hasCapex) {
        const operatingCfIndex = cashFlow.findIndex((r) => r.id === "operating_cf");
        const insertIndex = operatingCfIndex >= 0 ? operatingCfIndex + 1 : cashFlow.length;
        const defaultRow = getDefaultCfsRow("capex") ?? {
          id: "capex",
          label: "Capital Expenditures",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [],
        };
        cashFlow.splice(insertIndex, 0, defaultRow);
      }

      // CFI anchors in display order (after capex, before other_investing / investing_cf)
      const cfiAnchorIds = ["acquisitions", "asset_sales", "investments"];
      for (const id of cfiAnchorIds) {
        if (cashFlow.some((r) => r.id === id)) continue;
        const prevId = cfiAnchorIds[cfiAnchorIds.indexOf(id) - 1] ?? "capex";
        const afterIndex = cashFlow.findIndex((r) => r.id === prevId);
        const insertIndex = afterIndex >= 0 ? afterIndex + 1 : cashFlow.findIndex((r) => r.id === "investing_cf");
        const defaultRow = getDefaultCfsRow(id);
        if (defaultRow) cashFlow.splice(insertIndex >= 0 ? insertIndex : cashFlow.length, 0, defaultRow);
      }

      const hasOtherInvesting = cashFlow.some((r) => r.id === "other_investing");
      if (!hasOtherInvesting) {
        const investmentsIndex = cashFlow.findIndex((r) => r.id === "investments");
        const capexIndex = cashFlow.findIndex((r) => r.id === "capex");
        const insertAfter = investmentsIndex >= 0 ? investmentsIndex : capexIndex;
        const insertIndex = insertAfter >= 0 ? insertAfter + 1 : cashFlow.length;
        const defaultRow = getDefaultCfsRow("other_investing") ?? {
          id: "other_investing",
          label: "Other Investing Activities",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [],
        };
        cashFlow.splice(insertIndex, 0, defaultRow);
      }

      const hasInvestingCf = cashFlow.some((r) => r.id === "investing_cf");
      if (!hasInvestingCf) {
        const otherInvestingIndex = cashFlow.findIndex((r) => r.id === "other_investing");
        const insertIndex = otherInvestingIndex >= 0 ? otherInvestingIndex + 1 : cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "investing_cf",
          label: "Cash from Investing Activities",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure financing_cf total exists, then ensure Financing section anchor rows exist before it
      const hasFinancingCf = cashFlow.some((r) => r.id === "financing_cf");
      if (!hasFinancingCf) {
        const netChangeIdx = cashFlow.findIndex((r) => r.id === "net_change_cash");
        const insertIdx = netChangeIdx >= 0 ? netChangeIdx : cashFlow.length;
        cashFlow.splice(insertIdx, 0, {
          id: "financing_cf",
          label: "Cash from Financing Activities",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      const cffAnchorIds = ["debt_issued", "debt_repaid", "equity_issued", "share_repurchases", "dividends", "other_financing"];
      for (const id of cffAnchorIds) {
        if (cashFlow.some((r) => r.id === id)) continue;
        const financingCfIdx = cashFlow.findIndex((r) => r.id === "financing_cf");
        const insertIndex = financingCfIdx >= 0 ? financingCfIdx : cashFlow.length;
        const defaultRow = getDefaultCfsRow(id);
        if (defaultRow) cashFlow.splice(insertIndex, 0, defaultRow);
      }

      // Recalculate all years for all statements. Preserve values for rows with IS Build breakdowns (e.g. R&D with sub-items).
      const allYears = [...(meta.years.historical || []), ...(meta.years.projection || [])];
      const sgaChildrenForInit = findRowDeep(incomeStatement, "sga")?.children ?? [];
      const sgaParentIdsInit = collectParentIdsWithChildren(sgaChildrenForInit);
      const revBreakdownIdsInit = new Set(Object.keys(get().revenueProjectionConfig?.breakdowns ?? {}));
      const parentIdsWithProjectionBreakdownsInit = new Set([...revBreakdownIdsInit, ...sgaParentIdsInit]);
      allYears.forEach((year) => {
        const sbcBreakdowns = get().sbcBreakdowns;
        const danaBreakdowns = get().danaBreakdowns;
        let allStatements = { incomeStatement, balanceSheet, cashFlow };
        incomeStatement = recomputeCalculations(incomeStatement, year, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns, parentIdsWithProjectionBreakdownsInit, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      allStatements = { incomeStatement, balanceSheet, cashFlow };
        balanceSheet = recomputeCalculations(balanceSheet, year, balanceSheet, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      allStatements = { incomeStatement, balanceSheet, cashFlow };
        cashFlow = recomputeCalculations(cashFlow, year, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      });

      // Temporary: verify top-level IS order and operating_expenses structure after normalization
      const topLevelIds = incomeStatement.map((r) => r.id);
      console.log("TOP-LEVEL IS IDS AFTER NORMALIZATION:\n" + topLevelIds.join("\n"));
      const opExRowForLog = incomeStatement.find((r) => r.id === "operating_expenses");
      console.log("operating_expenses children:\n" + (opExRowForLog?.children ?? []).map((c) => c.id).join("\n"));

      // When force (e.g. new project), also clear all financial input state so no data leaks from a previous project
      const cleanInputState = force
        ? {
            embeddedDisclosures: [] as EmbeddedDisclosureItem[],
            sbcBreakdowns: {} as Record<string, Record<string, number>>,
            danaLocation: null as "cogs" | "sga" | "both" | null,
            danaBreakdowns: {} as Record<string, number>,
            sectionLocks: {} as Record<string, boolean>,
            sectionExpanded: {} as Record<string, boolean>,
            confirmedRowIds: {} as Record<string, boolean>,
            wcExcludedIds: [] as string[],
            revenueProjectionConfig: DEFAULT_REVENUE_PROJECTION_CONFIG,
            cogsPctByRevenueLine: {},
            cogsPctModeByRevenueLine: {},
            cogsPctByRevenueLineByYear: {},
            sgaPctByItemId: {},
            sgaPctModeByItemId: {},
            sgaPctByItemIdByYear: {},
            sgaPctOfParentByItemId: {},
            sgaPctOfParentModeByItemId: {},
            sgaPctOfParentByItemIdByYear: {},
            sgaHistoricAmountByItemIdByYear: {},
            wcDriverTypeByItemId: {},
            wcDaysByItemId: {},
            wcDaysByItemIdByYear: {},
            wcDaysBaseByItemId: {},
            wcPctBaseByItemId: {},
            wcPctByItemId: {},
            wcPctByItemIdByYear: {},
            capexForecastMethod: "pct_revenue" as const,
            capexPctRevenue: 0,
            capexManualByYear: {},
            capexGrowthPct: 0,
            capexSplitByBucket: true,
            capexForecastBucketsIndependently: false,
            capexTimingConvention: "mid" as const,
            capexBucketAllocationPct: {},
            capexBucketLabels: {},
            capexCustomBucketIds: [] as string[],
            capexBucketMethod: {},
            capexBucketPctRevenue: {},
            capexBucketManualByYear: {},
            capexBucketGrowthPct: {},
            ppeUsefulLifeByBucket: { ...CAPEX_IB_DEFAULT_USEFUL_LIVES },
            ppeUsefulLifeSingle: 10,
            capexHistoricByBucketByYear: {},
            capexHelperPpeByBucketByYear: {},
            capexIncludeInAllocationByBucket: {},
            capexModelIntangibles: true,
            intangiblesForecastMethod: "pct_revenue" as const,
            intangiblesAmortizationLifeYears: 7,
            intangiblesPctRevenue: 0,
            intangiblesManualByYear: {},
            intangiblesPctOfCapex: 0,
            intangiblesHasHistoricalAmortization: false,
            intangiblesHistoricalAmortizationByYear: {},
            schedules: { workingCapital: [], debt: [], capex: [] } as { workingCapital: Row[]; debt: Row[]; capex: Row[] },
            bsBuildPreviewOverrides: {},
          }
        : {};

      // Classification completeness: ensure every row has deterministic/AI/user or explicit unresolved state
      const classificationBackfilled = backfillClassificationCompleteness({
        incomeStatement,
        balanceSheet,
        cashFlow,
      });

      // Taxonomy backfill: ensure every row has semantic type metadata
      const backfilled = backfillTaxonomy(classificationBackfilled);

      // CFS metadata backfill: set historicalCfsNature where section is set but nature is missing (one-time normalize)
      const cashFlowWithNature = backfillCfsMetadataNature(backfilled.cashFlow);

      set({
        meta,
        isInitialized: true,
        currentStepId: "historicals",
        incomeStatement: backfilled.incomeStatement,
        balanceSheet: backfilled.balanceSheet,
        cashFlow: cashFlowWithNature,
        ...cleanInputState,
      });
    } else {
      // If already initialized, just update meta if needed
      set({ meta });
    }
  },

  recalculateAll: () => {
    const state = get();
    if (!state.isInitialized) return;

    const allYears = [
      ...(state.meta.years.historical || []),
      ...(state.meta.years.projection || []),
    ];

    let incomeStatement = [...state.incomeStatement];
    let balanceSheet = [...state.balanceSheet];
    let cashFlow = [...state.cashFlow];
    
    // Helper function to find section boundaries in cashFlow for order-preserving migrations
    const findSectionBoundaries = () => {
      const operatingCfIndex = cashFlow.findIndex((r) => r.id === "operating_cf");
      const investingCfIndex = cashFlow.findIndex((r) => r.id === "investing_cf");
      const financingCfIndex = cashFlow.findIndex((r) => r.id === "financing_cf");
      return {
        operatingEnd: operatingCfIndex >= 0 ? operatingCfIndex : cashFlow.length,
        investingStart: operatingCfIndex >= 0 ? operatingCfIndex + 1 : cashFlow.length,
        investingEnd: investingCfIndex >= 0 ? investingCfIndex : cashFlow.length,
        financingStart: investingCfIndex >= 0 ? investingCfIndex + 1 : cashFlow.length,
        financingEnd: financingCfIndex >= 0 ? financingCfIndex : cashFlow.length,
      };
    };
    
    const boundaries = findSectionBoundaries();

    // Migration: Ensure core Income Statement skeleton (no sga/danda; operating_expenses children are user-built)
    const coreISItemsRecalc = [
      { id: "rev", label: "Revenue", kind: "input", valueType: "currency", after: null },
      { id: "cogs", label: "Cost of Goods Sold (COGS)", kind: "input", valueType: "currency", after: "rev" },
      { id: "gross_profit", label: "Gross Profit", kind: "calc", valueType: "currency", after: "cogs" },
      { id: "gross_margin", label: "Gross Margin %", kind: "calc", valueType: "percent", after: "gross_profit" },
      { id: "ebit", label: "EBIT (Operating Income)", kind: "calc", valueType: "currency", after: "operating_expenses" },
      { id: "ebit_margin", label: "EBIT Margin %", kind: "calc", valueType: "percent", after: "ebit" },
      { id: "interest_expense", label: "Interest Expense", kind: "input", valueType: "currency", after: "ebit_margin" },
      { id: "interest_income", label: "Interest Income", kind: "input", valueType: "currency", after: "interest_expense" },
      { id: "other_income", label: "Other Income / (Expense), net", kind: "input", valueType: "currency", after: "interest_income" },
      { id: "ebt", label: "EBT (Earnings Before Tax)", kind: "calc", valueType: "currency", after: "other_income" },
      { id: "tax", label: "Income Tax Expense", kind: "input", valueType: "currency", after: "ebt" },
      { id: "net_income", label: "Net Income", kind: "calc", valueType: "currency", after: "tax" },
      { id: "net_income_margin", label: "Net Income Margin %", kind: "calc", valueType: "percent", after: "net_income" },
    ];
    coreISItemsRecalc.forEach((coreItem) => {
      const exists = incomeStatement.some((r) => r.id === coreItem.id);
      if (!exists) {
        let insertIndex = incomeStatement.length;
        if (coreItem.after) {
          const afterIndex = incomeStatement.findIndex((r) => r.id === coreItem.after);
          if (afterIndex >= 0) insertIndex = afterIndex + 1;
        } else {
          insertIndex = 0;
        }
        incomeStatement.splice(insertIndex, 0, {
          id: coreItem.id,
          label: coreItem.label,
          kind: coreItem.kind as any,
          valueType: coreItem.valueType as any,
          values: {},
          children: [],
        });
      }
    });

    // Migration: Ensure D&A exists in CFS (should be in template, but check anyway)
    const hasDandaInCFS = cashFlow.some((r) => r.id === "danda");
    if (!hasDandaInCFS) {
      // Insert at end of operating section (before operating_cf total) to preserve user order
      cashFlow.splice(boundaries.operatingEnd, 0, {
        id: "danda",
        label: "Depreciation & Amortization",
        kind: "input", // Manual input in CFO
        valueType: "currency",
        values: {},
        children: [],
      });
      // Update boundaries after insertion
      boundaries.operatingEnd++;
      boundaries.investingStart++;
      boundaries.investingEnd++;
      boundaries.financingStart++;
      boundaries.financingEnd++;
    } else {
      // Migration: Update D&A from "calc" to "input" (D&A is now manual input, not auto-populated)
      const dandaRow = cashFlow.find((r) => r.id === "danda");
      if (dandaRow && dandaRow.kind === "calc") {
        dandaRow.kind = "input";
      }
    }

    // Migration: Ensure SBC exists in CFS (added in later version)
    const hasSbcInCFS = cashFlow.some((r) => r.id === "sbc");
    if (!hasSbcInCFS) {
      // Insert at end of operating section (before operating_cf total) to preserve user order
      cashFlow.splice(boundaries.operatingEnd, 0, {
        id: "sbc",
        label: "Stock-Based Compensation",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
      // Update boundaries after insertion
      boundaries.operatingEnd++;
      boundaries.investingStart++;
      boundaries.investingEnd++;
      boundaries.financingStart++;
      boundaries.financingEnd++;
    }

    // Migration: Ensure WC Change exists in CFS (should be in template, but check anyway)
    const hasWcChangeInCFS = cashFlow.some((r) => r.id === "wc_change");
    if (!hasWcChangeInCFS) {
      // Insert at end of operating section (before operating_cf total) to preserve user order
      cashFlow.splice(boundaries.operatingEnd, 0, {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
      // Update boundaries after insertion
      boundaries.operatingEnd++;
      boundaries.investingStart++;
      boundaries.investingEnd++;
      boundaries.financingStart++;
      boundaries.financingEnd++;
    }

    // Migration: Ensure Operating CF total exists
    const hasOperatingCf = cashFlow.some((r) => r.id === "operating_cf");
    if (!hasOperatingCf) {
      // Insert at end of operating section
      cashFlow.splice(boundaries.operatingEnd, 0, {
        id: "operating_cf",
        label: "Cash from Operating Activities",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
      // Update boundaries after insertion
      boundaries.operatingEnd++;
      boundaries.investingStart++;
      boundaries.investingEnd++;
      boundaries.financingStart++;
      boundaries.financingEnd++;
    }

    // Migration: Remove other_investing if it exists (no longer a default item)
    const otherInvestingIndex = cashFlow.findIndex((r) => r.id === "other_investing");
    if (otherInvestingIndex >= 0) {
      cashFlow.splice(otherInvestingIndex, 1);
      // Update boundaries after removal
      if (otherInvestingIndex < boundaries.investingEnd) {
        boundaries.investingEnd--;
        boundaries.financingStart--;
        boundaries.financingEnd--;
      }
    }

    // Migration: Ensure Investing section items exist (capex, investing_cf)
    const hasCapex = cashFlow.some((r) => r.id === "capex");
    if (!hasCapex) {
      // Insert at end of investing section (before investing_cf total) to preserve user order
      cashFlow.splice(boundaries.investingEnd, 0, {
        id: "capex",
        label: "Capital Expenditures (CapEx)",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
      // Update boundaries after insertion
      boundaries.investingEnd++;
      boundaries.financingStart++;
      boundaries.financingEnd++;
    }

    const hasInvestingCf = cashFlow.some((r) => r.id === "investing_cf");
    if (!hasInvestingCf) {
      // Insert at end of investing section
      cashFlow.splice(boundaries.investingEnd, 0, {
        id: "investing_cf",
        label: "Cash from Investing Activities",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
      // Update boundaries after insertion
      boundaries.investingEnd++;
      boundaries.financingStart++;
      boundaries.financingEnd++;
    }
    
    // Migration: Ensure Financing CF total exists (no default items - user chooses from suggestions)
    const hasFinancingCf = cashFlow.some((r) => r.id === "financing_cf");
    if (!hasFinancingCf) {
      // Insert at end of financing section
      cashFlow.splice(boundaries.financingEnd, 0, {
        id: "financing_cf",
        label: "Cash from Financing Activities",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
      boundaries.financingEnd++;
    }

    // Migration: Ensure net_change_cash exists (after fx_effect_on_cash if present, else after financing_cf)
    const hasNetChangeCash = cashFlow.some((r) => r.id === "net_change_cash");
    if (!hasNetChangeCash) {
      const fxIdx = cashFlow.findIndex((r) => r.id === "fx_effect_on_cash");
      const finCfIdx = cashFlow.findIndex((r) => r.id === "financing_cf");
      const insertIdx = fxIdx >= 0 ? fxIdx + 1 : finCfIdx >= 0 ? finCfIdx + 1 : cashFlow.length;
      cashFlow.splice(insertIdx, 0, {
        id: "net_change_cash",
        label: "Net Change in Cash",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure gross_margin exists (added in later version)
    const hasGrossMargin = incomeStatement.some((r) => r.id === "gross_margin");
    if (!hasGrossMargin) {
      const grossProfitIndex = incomeStatement.findIndex((r) => r.id === "gross_profit");
      if (grossProfitIndex >= 0) {
        // Insert gross_margin right after gross_profit
        incomeStatement.splice(grossProfitIndex + 1, 0, {
          id: "gross_margin",
          label: "Gross Margin %",
          kind: "calc",
          valueType: "percent",
          values: {},
          children: [],
        });
      }
    }

    // Migration: Ensure EBITDA exists (should be in template, but check anyway)
    const hasEbitda = incomeStatement.some((r) => r.id === "ebitda");
    if (!hasEbitda) {
      const opExIndexForEbitda = incomeStatement.findIndex((r) => r.id === "operating_expenses");
      const insertIndex = opExIndexForEbitda >= 0 ? opExIndexForEbitda + 1 : incomeStatement.length;
      // Insert EBITDA
      incomeStatement.splice(insertIndex, 0, {
        id: "ebitda",
        label: "EBITDA",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure EBITDA margin exists (added in later version)
    const hasEbitdaMargin = incomeStatement.some((r) => r.id === "ebitda_margin");
    if (!hasEbitdaMargin) {
      const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
      if (ebitdaIndex >= 0) {
        // Insert EBITDA margin right after EBITDA
        incomeStatement.splice(ebitdaIndex + 1, 0, {
          id: "ebitda_margin",
          label: "EBITDA Margin %",
          kind: "calc",
          valueType: "percent",
          values: {},
          children: [],
        });
      }
    }

    // Migration: Remove D&A from IS (it's now embedded in COGS or SG&A)
    const danaIndex = incomeStatement.findIndex((r) => r.id === "danda");
    if (danaIndex >= 0) {
      // Save D&A values to danaBreakdowns before removing
      const danaRow = incomeStatement[danaIndex];
      if (danaRow.values && Object.keys(danaRow.values).length > 0) {
        const danaBreakdowns: Record<string, number> = {};
        Object.keys(danaRow.values).forEach(year => {
          if (danaRow.values && danaRow.values[year] !== undefined) {
            danaBreakdowns[year] = danaRow.values[year];
          }
        });
        if (Object.keys(danaBreakdowns).length > 0) {
          set({ danaBreakdowns });
        }
      }
      // Remove D&A from IS
      incomeStatement.splice(danaIndex, 1);
    }

    // Migration: Ensure EBIT exists (should be in template, but check anyway)
    const hasEbit = incomeStatement.some((r) => r.id === "ebit");
    if (!hasEbit) {
      // Find where to insert EBIT - after EBITDA margin
      const ebitdaMarginIndex = incomeStatement.findIndex((r) => r.id === "ebitda_margin");
      const insertIndex = ebitdaMarginIndex >= 0 ? ebitdaMarginIndex + 1 : incomeStatement.length;
      // Insert EBIT
      incomeStatement.splice(insertIndex, 0, {
        id: "ebit",
        label: "EBIT (Operating Income)",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure EBIT Margin exists (should be in template, but check anyway)
    const hasEbitMargin = incomeStatement.some((r) => r.id === "ebit_margin");
    if (!hasEbitMargin) {
      // Find where to insert EBIT Margin - after EBIT
      const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
      const insertIndex = ebitIndex >= 0 ? ebitIndex + 1 : incomeStatement.length;
      // Insert EBIT Margin
      incomeStatement.splice(insertIndex, 0, {
        id: "ebit_margin",
        label: "EBIT Margin %",
        kind: "calc",
        valueType: "percent",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Interest Expense exists (should be in template, but check anyway)
    const hasInterestExpense = incomeStatement.some((r) => r.id === "interest_expense");
    if (!hasInterestExpense) {
      const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
      const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
      const insertIndex = ebitMarginIndex >= 0 ? ebitMarginIndex + 1 : 
                         ebitIndex >= 0 ? ebitIndex + 1 : 
                         incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "interest_expense",
        label: "Interest Expense",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Interest Income exists (should be in template, but check anyway)
    const hasInterestIncome = incomeStatement.some((r) => r.id === "interest_income");
    if (!hasInterestIncome) {
      const interestExpenseIndex = incomeStatement.findIndex((r) => r.id === "interest_expense");
      const insertIndex = interestExpenseIndex >= 0 ? interestExpenseIndex + 1 : incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "interest_income",
        label: "Interest Income",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Other Income exists (added in later version)
    const hasOtherIncome = incomeStatement.some((r) => r.id === "other_income");
    if (!hasOtherIncome) {
      const interestIncomeIndex = incomeStatement.findIndex((r) => r.id === "interest_income");
      const insertIndex = interestIncomeIndex >= 0 ? interestIncomeIndex + 1 : incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "other_income",
        label: "Other Income / (Expense)",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure EBT exists (should be in template, but check anyway)
    const hasEbt = incomeStatement.some((r) => r.id === "ebt");
    if (!hasEbt) {
      const otherIncomeIndex = incomeStatement.findIndex((r) => r.id === "other_income");
      const insertIndex = otherIncomeIndex >= 0 ? otherIncomeIndex + 1 : incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "ebt",
        label: "EBT (Earnings Before Tax)",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Tax exists (should be in template, but check anyway)
    const hasTax = incomeStatement.some((r) => r.id === "tax");
    if (!hasTax) {
      const ebtIndex = incomeStatement.findIndex((r) => r.id === "ebt");
      const insertIndex = ebtIndex >= 0 ? ebtIndex + 1 : incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "tax",
        label: "Income Tax Expense",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Net Income exists (should be in template, but check anyway)
    const hasNetIncome = incomeStatement.some((r) => r.id === "net_income");
    if (!hasNetIncome) {
      const taxIndex = incomeStatement.findIndex((r) => r.id === "tax");
      const insertIndex = taxIndex >= 0 ? taxIndex + 1 : incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "net_income",
        label: "Net Income",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Net Income Margin exists (added in later version)
    const hasNetIncomeMargin = incomeStatement.some((r) => r.id === "net_income_margin");
    if (!hasNetIncomeMargin) {
      const netIncomeIndex = incomeStatement.findIndex((r) => r.id === "net_income");
      if (netIncomeIndex >= 0) {
        // Insert Net Income Margin right after Net Income
        incomeStatement.splice(netIncomeIndex + 1, 0, {
          id: "net_income_margin",
          label: "Net Income Margin %",
          kind: "calc",
          valueType: "percent",
          values: {},
          children: [],
        });
      }
    }

    // Migration: Update "Other Income / (Expense)" label to "Other Income / (Expense), net"
    const otherIncomeRow = incomeStatement.find((r) => r.id === "other_income");
    if (otherIncomeRow && otherIncomeRow.label === "Other Income / (Expense)") {
      otherIncomeRow.label = "Other Income / (Expense), net";
    }

    // Migration: Ensure Balance Sheet subtotals exist (same logic as initializeModel)
    const totalCurrentAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_current_assets");
    const totalAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_assets");
    const totalCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_current_liabilities");
    const totalLiabIndex = balanceSheet.findIndex((r) => r.id === "total_liabilities");
    const totalEquityIndex = balanceSheet.findIndex((r) => r.id === "total_equity");
    const totalLiabAndEquityIndex = balanceSheet.findIndex((r) => r.id === "total_liab_and_equity");
    
    if (totalCurrentAssetsIndex === -1) {
      const caIds = ["cash", "ar", "inventory", "other_ca"];
      let insertIndex = 0;
      for (let i = balanceSheet.length - 1; i >= 0; i--) {
        if (caIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("ca_")) {
          insertIndex = i + 1;
          break;
        }
      }
      balanceSheet.splice(insertIndex, 0, {
        id: "total_current_assets",
        label: "Total Current Assets",
        kind: "subtotal",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    
    // Ensure Total Fixed Assets exists (after fixed assets items, before total_assets)
    const totalFixedAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_fixed_assets");
    if (totalFixedAssetsIndex === -1) {
      const newTotalCAIndex = balanceSheet.findIndex((r) => r.id === "total_current_assets");
      const faIds = ["ppe", "intangible_assets", "other_assets"];
      let insertIndex = newTotalCAIndex >= 0 ? newTotalCAIndex + 1 : balanceSheet.length;
      for (let i = balanceSheet.length - 1; i > (newTotalCAIndex >= 0 ? newTotalCAIndex : -1); i--) {
        if (faIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("fa_")) {
          insertIndex = i + 1;
          break;
        }
      }
      balanceSheet.splice(insertIndex, 0, {
        id: "total_fixed_assets",
        label: "Total Fixed Assets",
        kind: "subtotal",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    if (totalAssetsIndex === -1) {
      const newTotalFixedAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_fixed_assets");
      const insertIndex = newTotalFixedAssetsIndex >= 0 ? newTotalFixedAssetsIndex + 1 : balanceSheet.length;
      balanceSheet.splice(insertIndex, 0, {
        id: "total_assets",
        label: "Total Assets",
        kind: "total",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    
    if (totalCurrentLiabIndex === -1) {
      const newTotalAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_assets");
      const clIds = ["ap", "st_debt", "other_cl"];
      let insertIndex = newTotalAssetsIndex >= 0 ? newTotalAssetsIndex + 1 : balanceSheet.length;
      for (let i = balanceSheet.length - 1; i > (newTotalAssetsIndex >= 0 ? newTotalAssetsIndex : -1); i--) {
        if (clIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("cl_")) {
          insertIndex = i + 1;
          break;
        }
      }
      balanceSheet.splice(insertIndex, 0, {
        id: "total_current_liabilities",
        label: "Total Current Liabilities",
        kind: "subtotal",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    
    // Ensure Total Non-Current Liabilities exists (after non-current liabilities items, before total_liabilities)
    const totalNonCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_non_current_liabilities");
    if (totalNonCurrentLiabIndex === -1) {
      const newTotalCLIndex = balanceSheet.findIndex((r) => r.id === "total_current_liabilities");
      const nclIds = ["lt_debt", "other_liab"];
      let insertIndex = newTotalCLIndex >= 0 ? newTotalCLIndex + 1 : balanceSheet.length;
      for (let i = balanceSheet.length - 1; i > (newTotalCLIndex >= 0 ? newTotalCLIndex : -1); i--) {
        if (nclIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("ncl_")) {
          insertIndex = i + 1;
          break;
        }
      }
      balanceSheet.splice(insertIndex, 0, {
        id: "total_non_current_liabilities",
        label: "Total Non-Current Liabilities",
        kind: "subtotal",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    if (totalLiabIndex === -1) {
      const newTotalNonCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_non_current_liabilities");
      const insertIndex = newTotalNonCurrentLiabIndex >= 0 ? newTotalNonCurrentLiabIndex + 1 : balanceSheet.length;
      balanceSheet.splice(insertIndex, 0, {
        id: "total_liabilities",
        label: "Total Liabilities",
        kind: "total",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    
    if (totalEquityIndex === -1) {
      const newTotalLiabIndex = balanceSheet.findIndex((r) => r.id === "total_liabilities");
      const equityIds = ["common_stock", "retained_earnings", "other_equity"];
      let insertIndex = newTotalLiabIndex >= 0 ? newTotalLiabIndex + 1 : balanceSheet.length;
      for (let i = balanceSheet.length - 1; i > (newTotalLiabIndex >= 0 ? newTotalLiabIndex : -1); i--) {
        if (equityIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("equity_")) {
          insertIndex = i + 1;
          break;
        }
      }
      balanceSheet.splice(insertIndex, 0, {
        id: "total_equity",
        label: "Total Equity",
        kind: "total",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    
    if (totalLiabAndEquityIndex === -1) {
      balanceSheet.push({
        id: "total_liab_and_equity",
        label: "Total Liabilities & Equity",
        kind: "total",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Recalculate all years for all statements. Preserve values for rows with IS Build breakdowns (e.g. R&D with sub-items).
    const sgaChildrenRecalc = findRowDeep(incomeStatement, "sga")?.children ?? [];
    const sgaParentIdsRecalc = collectParentIdsWithChildren(sgaChildrenRecalc);
    const revBreakdownIdsRecalc = new Set(Object.keys(get().revenueProjectionConfig?.breakdowns ?? {}));
    const parentIdsWithProjectionBreakdownsRecalc = new Set([...revBreakdownIdsRecalc, ...sgaParentIdsRecalc]);
    allYears.forEach((year) => {
      const sbcBreakdowns = get().sbcBreakdowns;
      const danaBreakdowns = get().danaBreakdowns;
      let allStatements = { incomeStatement, balanceSheet, cashFlow };
      incomeStatement = recomputeCalculations(incomeStatement, year, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns, parentIdsWithProjectionBreakdownsRecalc, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      allStatements = { incomeStatement, balanceSheet, cashFlow };
      balanceSheet = recomputeCalculations(balanceSheet, year, balanceSheet, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      allStatements = { incomeStatement, balanceSheet, cashFlow };
      cashFlow = recomputeCalculations(cashFlow, year, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
    });

    set({
      incomeStatement,
      balanceSheet,
      cashFlow,
    });
  },

  goToStep: (stepId) => set({ currentStepId: stepId }),

  completeCurrentStep: () => {
    const state = get();

    const completed = state.completedStepIds.includes(state.currentStepId)
      ? state.completedStepIds
      : [...state.completedStepIds, state.currentStepId];

    const allStepIds = WIZARD_STEPS.map((s) => s.id);
    const allStepsCompleted = allStepIds.every((id) => completed.includes(id));

    const currentIndex = allStepIds.indexOf(state.currentStepId);
    const next =
      currentIndex === -1
        ? allStepIds[0]
        : allStepIds[Math.min(currentIndex + 1, allStepIds.length - 1)];

    set({
      completedStepIds: completed,
      currentStepId: next,
      isModelComplete: allStepsCompleted,
    });
  },

  saveCurrentStep: () => {
    const state = get();
    
    // Recalculate all values before saving to ensure data is up to date
    // This ensures all formulas, subtotals, and totals are current
    if (state.isInitialized) {
      // Call recalculateAll from the store actions
      // Since we're inside the store definition, we can access it via get()
      const store = get();
      if (store.recalculateAll) {
        store.recalculateAll();
      }
    }
    
    // Mark the current step as complete (save progress)
    const completed = state.completedStepIds.includes(state.currentStepId)
      ? state.completedStepIds
      : [...state.completedStepIds, state.currentStepId];

    const allStepIds = WIZARD_STEPS.map((s) => s.id);
    const allStepsCompleted = allStepIds.every((id) => completed.includes(id));

    set({
      completedStepIds: completed,
      isModelComplete: allStepsCompleted,
    });
  },

  continueToNextStep: () => {
    const state = get();
    // Only continue if current step is complete
    if (!state.completedStepIds.includes(state.currentStepId)) {
      return; // Can't continue if step isn't saved/completed
    }

    const allStepIds = WIZARD_STEPS.map((s) => s.id);
    const currentIndex = allStepIds.indexOf(state.currentStepId);
    const next =
      currentIndex === -1
        ? allStepIds[0]
        : allStepIds[Math.min(currentIndex + 1, allStepIds.length - 1)];

    set({
      currentStepId: next,
    });
  },

  // Generic row management actions
  addChildRow: (statement, parentId, label) => {
    const trimmed = (label ?? "").trim();
    if (!trimmed) {
      console.log("addChildRow: trimmed label is empty");
      return;
    }

    const isSectionMap: Record<string, { sectionOwner: Row["sectionOwner"]; isOperating: boolean }> = {
      rev: { sectionOwner: "revenue", isOperating: true },
      cogs: { sectionOwner: "cogs", isOperating: true },
      sga: { sectionOwner: "sga", isOperating: true },
      rd: { sectionOwner: "rd", isOperating: true },
    };
    let sectionMeta: { sectionOwner: Row["sectionOwner"]; isOperating: boolean } | undefined =
      statement === "incomeStatement" ? isSectionMap[parentId] : undefined;
    if (statement === "incomeStatement" && parentId === "operating_expenses") {
      sectionMeta = getFallbackIsClassification(trimmed);
    }
    // Classification completeness: every new IS row gets sectionOwner/isOperating (fallback or explicit) and trust state
    if (statement === "incomeStatement" && sectionMeta == null) {
      sectionMeta = getFallbackIsClassification(trimmed);
    }
    const child: Row = {
      id: uuid(),
      label: trimmed,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
      ...(sectionMeta && statement === "incomeStatement" && {
        sectionOwner: sectionMeta.sectionOwner,
        isOperating: sectionMeta.isOperating,
        classificationSource: "fallback" as const,
        forecastMetadataStatus: "needs_review" as const,
      }),
      ...(statement === "balanceSheet" && {
        cashFlowBehavior: "unclassified" as const,
        classificationSource: "unresolved" as const,
        forecastMetadataStatus: "needs_review" as const,
      }),
      ...(statement === "cashFlow" && {
        classificationSource: "unresolved" as const,
        forecastMetadataStatus: "needs_review" as const,
      }),
    };
    // Phase 2: apply taxonomy in-session so new row is routable without reload
    const childWithTaxonomy = applyTaxonomyToRow(child, statement);

    console.log("addChildRow: Adding child", childWithTaxonomy.label, "to parent", parentId, "in", statement);

    set((state) => {
      const currentRows = state[statement];
      console.log("addChildRow: Current rows count:", currentRows.length, "parentId:", parentId);
      console.log("addChildRow: Available row IDs:", currentRows.map(r => r.id));
      
      // Check if parent exists anywhere in the tree (nested parents e.g. SG&A sub-items)
      let rowsToUse = currentRows;
      let parentExists = findRowDeep(rowsToUse, parentId) !== null;

      // If adding under operating_expenses and parent missing, normalize IS first then add
      if (!parentExists && statement === "incomeStatement" && parentId === "operating_expenses") {
        rowsToUse = normalizeIncomeStatementOperatingExpenses(JSON.parse(JSON.stringify(rowsToUse)));
        parentExists = findRowDeep(rowsToUse, parentId) !== null;
      }

      if (!parentExists) {
        console.error("addChildRow: Parent row not found!", parentId, "in statement:", statement);
        console.error("addChildRow: Available rows:", currentRows.map(r => ({ id: r.id, label: r.label })));
        return state; // Don't update if parent not found
      }

      // Deep clone to avoid mutation issues
      const updated = addChildRow(JSON.parse(JSON.stringify(rowsToUse)), parentId, childWithTaxonomy);
      
      // Verify the child was added (parent may be nested, so find in tree)
      const parentRowAfterAdd = findRowDeep(updated, parentId);
      console.log("addChildRow: Parent row after add:", parentRowAfterAdd?.id, "children count:", parentRowAfterAdd?.children?.length);
      
      if (!parentRowAfterAdd) {
        console.error("addChildRow: Parent row not found after add!", parentId);
        return state; // Don't update if parent not found
      }
      
      // If adding first child to Revenue, COGS, or SG&A (top-level only), convert them to calc
      let finalRows = updated;
      
      if (parentId === "rev" || parentId === "cogs" || parentId === "sga" || parentId === "operating_expenses") {
        if (parentRowAfterAdd.children && parentRowAfterAdd.children.length > 0 && parentRowAfterAdd.kind === "input") {
          // First child added, convert to calc - but preserve children!
          finalRows = updated.map((r) => {
            if (r.id === parentId) {
              return { ...r, kind: "calc" }; // Preserve children by spreading
            }
            return r;
          });
          const convertedParent = finalRows.find((r) => r.id === parentId);
          console.log("addChildRow: Converted parent to calc, children count:", convertedParent?.children?.length);
        }
      }
      if (statement === "cashFlow") finalRows = normalizeWcStructure(finalRows);
      
      // Recalculate all years after adding child
      const allYears = [
        ...(state.meta.years.historical || []),
        ...(state.meta.years.projection || []),
      ];
      
      let recalculatedRows = finalRows;
      const sgaParentIdsWithBreakdowns =
        statement === "incomeStatement"
          ? collectParentIdsWithChildren(
              findRowDeep(recalculatedRows, "sga")?.children ?? []
            )
          : new Set<string>();
      const revBreakdownIds = new Set(Object.keys(state.revenueProjectionConfig?.breakdowns ?? {}));
      const parentIdsWithProjectionBreakdowns =
        statement === "incomeStatement"
          ? new Set([...revBreakdownIds, ...sgaParentIdsWithBreakdowns])
          : undefined;
      allYears.forEach((year) => {
        const allStatements = {
          incomeStatement: state.incomeStatement,
          balanceSheet: state.balanceSheet,
          cashFlow: state.cashFlow,
        };
        const sbcBreakdowns = state.sbcBreakdowns;
        const danaBreakdowns = state.danaBreakdowns;
        recalculatedRows = recomputeCalculations(
          recalculatedRows,
          year,
          recalculatedRows,
          allStatements,
          sbcBreakdowns,
          danaBreakdowns,
          parentIdsWithProjectionBreakdowns,
          state.embeddedDisclosures ?? [],
          state.sbcDisclosureEnabled ?? true
        );
      });
      
      // Final verification (parent may be nested)
      const finalParentRow = findRowDeep(recalculatedRows, parentId);
      console.log("addChildRow: Final parent row children count:", finalParentRow?.children?.length);
      console.log("addChildRow: Final parent row children:", finalParentRow?.children?.map(c => c.label));
      
      const newState = { ...state, [statement]: recalculatedRows };
      console.log("addChildRow: Returning new state, statement rows count:", newState[statement].length);
      return newState;
    });
  },

  renameRow: (statement, rowId, label) => {
    const trimmed = (label ?? "").trim();
    if (!trimmed) return;
    set((state) => {
      const currentRows = state[statement];
      const updated = renameRowDeep(currentRows, rowId, trimmed);
      return { ...state, [statement]: updated };
    });
  },

  insertRow: (statement, index, row) => {
    set((state) => {
      // Phase 2: apply taxonomy in-session so new row is routable without reload
      const rowWithTaxonomy = applyTaxonomyToRow(row, statement);
      const currentRows = [...(state[statement] ?? [])];
      currentRows.splice(index, 0, rowWithTaxonomy);
      // Enforce canonical WC structure: any operating row that resolves to working_capital must live in wc_change.children
      let rowsToUse: Row[] = statement === "cashFlow" ? normalizeWcStructure(currentRows) : currentRows;

      const allYears = [
        ...(state.meta.years.historical || []),
        ...(state.meta.years.projection || []),
      ];

      let recalculatedRows = rowsToUse;
      allYears.forEach((year) => {
        const allStatements = {
          incomeStatement: state.incomeStatement,
          balanceSheet: state.balanceSheet,
          cashFlow: statement === "cashFlow" ? recalculatedRows : state.cashFlow,
        };
        const sbcBreakdowns = state.sbcBreakdowns;
        const danaBreakdowns = state.danaBreakdowns;
        recalculatedRows = recomputeCalculations(recalculatedRows, year, recalculatedRows, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      });

      return { [statement]: recalculatedRows };
    });
  },

  moveRow: (statement, rowId, direction) => {
    set((state) => {
      const currentRows = [...(state[statement] ?? [])];
      const currentIndex = currentRows.findIndex(r => r.id === rowId);
      
      if (currentIndex === -1) return state; // Row not found
      
      // Don't allow moving total/subtotal rows
      const row = currentRows[currentIndex];
      if (row.id.startsWith("total_") || row.kind === "total" || row.kind === "subtotal") {
        return state;
      }
      
      const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      
      // Bounds check
      if (newIndex < 0 || newIndex >= currentRows.length) return state;
      
      // Don't allow moving past total/subtotal rows
      const targetRow = currentRows[newIndex];
      if (targetRow.id.startsWith("total_") || targetRow.kind === "total" || targetRow.kind === "subtotal") {
        return state;
      }
      
      // Swap rows
      const newRows = [...currentRows];
      [newRows[currentIndex], newRows[newIndex]] = [newRows[newIndex], newRows[currentIndex]];
      
      // Recalculate all years after moving
      const allYears = [
        ...(state.meta.years.historical || []),
        ...(state.meta.years.projection || []),
      ];
      
      let recalculatedRows = newRows;
      if (statement === "cashFlow") recalculatedRows = normalizeWcStructure(recalculatedRows);
      allYears.forEach((year) => {
        const allStatements = {
          incomeStatement: state.incomeStatement,
          balanceSheet: state.balanceSheet,
          cashFlow: statement === "cashFlow" ? recalculatedRows : state.cashFlow,
        };
        const sbcBreakdowns = state.sbcBreakdowns;
        const danaBreakdowns = state.danaBreakdowns;
        recalculatedRows = recomputeCalculations(recalculatedRows, year, recalculatedRows, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      });
      
      return { [statement]: recalculatedRows };
    });
  },

  removeRow: (statement, rowId) => {
    // Core Income Statement: only structural anchors. Children of operating_expenses (sga, rd, other_opex, danda, custom) are removable.
    const coreISItems = [
      "rev", "cogs", "gross_profit", "gross_margin",
      "operating_expenses",
      "ebit", "ebit_margin",
      "interest_expense", "interest_income", "other_income",
      "ebt", "tax", "net_income", "net_income_margin"
    ];
    
    // Only total/subtotal rows are protected; default line items (cash, ar, ppe, etc.) can be removed
    const coreBSItems = [
      "total_current_assets", "total_fixed_assets", "total_assets", "total_current_liabilities",
      "total_non_current_liabilities", "total_liabilities", "total_equity", "total_liab_and_equity"
    ];
    
    // Core Cash Flow items that form the skeleton - cannot be removed
    const coreCFSItems = [
      "net_income", "danda", "sbc", "wc_change", "other_operating", "operating_cf",
      "capex", "investing_cf",
      "fx_effect_on_cash",
      "financing_cf",
      "net_change_cash"
    ];
    
    // Prevent removal of core skeleton items
    if (statement === "incomeStatement" && coreISItems.includes(rowId)) {
      console.warn(`Cannot remove core Income Statement item: ${rowId}. This item is required for the financial model structure.`);
      return; // Don't remove core items
    }
    if (statement === "balanceSheet" && coreBSItems.includes(rowId)) {
      console.warn(`Cannot remove core Balance Sheet item: ${rowId}. This item is required for the financial model structure.`);
      return; // Don't remove core items
    }
    if (statement === "cashFlow" && coreCFSItems.includes(rowId)) {
      console.warn(`Cannot remove core Cash Flow item: ${rowId}. This item is required for the financial model structure.`);
      return; // Don't remove core items
    }
    
    set((state) => {
      const currentRows = state[statement];
      let wcExcludedIds = state.wcExcludedIds ?? [];
      if (statement === "cashFlow") {
        const wcRow = state.cashFlow.find((r) => r.id === "wc_change");
        const isWcChild = wcRow?.children?.some((c) => c.id === rowId);
        if (isWcChild) {
          const ca = getRowsForCategory(state.balanceSheet, "current_assets");
          const cl = getRowsForCategory(state.balanceSheet, "current_liabilities");
          const bsCaClIds = new Set([...ca, ...cl].map((r) => r.id).filter((id) => !id.startsWith("total")));
          if (bsCaClIds.has(rowId) && !wcExcludedIds.includes(rowId)) {
            wcExcludedIds = [...wcExcludedIds, rowId];
          }
        }
      }
      let updated = removeRowDeep(currentRows, rowId);
      if (statement === "cashFlow") updated = normalizeWcStructure(updated);
      
      // Check if we removed the last child from Revenue, COGS, or SG&A
      // If so, convert them back to input
      const revenueRow = findRowDeep(updated, "rev");
      const cogsRow = findRowDeep(updated, "cogs");
      const sgaRow = findRowDeep(updated, "sga");
      
      let finalUpdated = updated;
      
      if (revenueRow && revenueRow.kind === "calc" && (!revenueRow.children || revenueRow.children.length === 0)) {
        finalUpdated = updateRowKindDeep(finalUpdated, "rev", "input");
      }
      
      if (cogsRow && cogsRow.kind === "calc" && (!cogsRow.children || cogsRow.children.length === 0)) {
        finalUpdated = updateRowKindDeep(finalUpdated, "cogs", "input");
      }
      
      if (sgaRow && sgaRow.kind === "calc" && (!sgaRow.children || sgaRow.children.length === 0)) {
        finalUpdated = updateRowKindDeep(finalUpdated, "sga", "input");
      }
      
      // After removing a row, recalculate all totals to ensure they're correct
      if (statement === "balanceSheet" || statement === "incomeStatement" || statement === "cashFlow") {
        const state = get();
        const allYears = [
          ...(state.meta.years.historical || []),
          ...(state.meta.years.projection || []),
        ];
        
        // Recompute calculations for the updated statement
        let recalculated = finalUpdated;
        const updatedAllStatements = {
          incomeStatement: statement === "incomeStatement" ? finalUpdated : state.incomeStatement,
          balanceSheet: statement === "balanceSheet" ? finalUpdated : state.balanceSheet,
          cashFlow: statement === "cashFlow" ? finalUpdated : state.cashFlow,
        };
        
        allYears.forEach((year) => {
          const sbcBreakdowns = state.sbcBreakdowns;
          const danaBreakdowns = state.danaBreakdowns;
          recalculated = recomputeCalculations(
            recalculated,
            year,
            recalculated,
            updatedAllStatements,
            sbcBreakdowns,
            danaBreakdowns,
            undefined,
            state.embeddedDisclosures ?? [],
            state.sbcDisclosureEnabled ?? true
          );
        });
        
        const out: Partial<ModelState> = { [statement]: recalculated };
        if (statement === "cashFlow" && wcExcludedIds !== (state.wcExcludedIds ?? [])) {
          out.wcExcludedIds = wcExcludedIds;
        }
        return out;
      }
      
      const out: Partial<ModelState> = { [statement]: finalUpdated };
      if (statement === "cashFlow" && wcExcludedIds !== (state.wcExcludedIds ?? [])) {
        out.wcExcludedIds = wcExcludedIds;
      }
      return out;
    });
  },

  updateRowValue: (statement, rowId, year, value) => {
    set((state) => {
      const currentRows = state[statement];
      let updated = updateRowValueDeep(currentRows, rowId, year, value);
      if (statement === "cashFlow") {
        updated = addCfsUserSetYearDeep(updated, rowId, year);
      }
      
      const allStatements = {
        incomeStatement: state.incomeStatement,
        balanceSheet: state.balanceSheet,
        cashFlow: statement === "cashFlow" ? updated : state.cashFlow,
      };
      const sbcBreakdowns = state.sbcBreakdowns;
      const danaBreakdowns = state.danaBreakdowns;
      const parentIdsWithProjectionBreakdowns =
        statement === "incomeStatement"
          ? new Set([
              ...Object.keys(state.revenueProjectionConfig?.breakdowns ?? {}),
              ...collectParentIdsWithChildren(
                findRowDeep(state.incomeStatement, "sga")?.children ?? []
              ),
            ])
          : undefined;
      const recomputed = recomputeCalculations(updated, year, updated, allStatements, sbcBreakdowns, danaBreakdowns, parentIdsWithProjectionBreakdowns, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      
      // If Balance Sheet was updated, also recalculate Cash Flow (WC Change depends on BS)
      let updatedCashFlow = state.cashFlow;
      if (statement === "balanceSheet") {
        const updatedAllStatements = {
          incomeStatement: state.incomeStatement,
          balanceSheet: recomputed,
          cashFlow: state.cashFlow,
        };
        updatedCashFlow = recomputeCalculations(state.cashFlow, year, state.cashFlow, updatedAllStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      }
      
      return { 
        [statement]: recomputed,
        ...(statement === "balanceSheet" ? { cashFlow: updatedCashFlow } : {})
      };
    });
  },

  updateRowKind: (statement, rowId, kind) => {
    set((state) => {
      const currentRows = state[statement];
      const updated = updateRowKindDeep(currentRows, rowId, kind);
      return { [statement]: updated };
    });
  },

  updateIncomeStatementRowMetadata: (rowId, patch) => {
    set((state) => {
      const updated = updateIsRowMetadataDeep(state.incomeStatement, rowId, patch);
      if (updated === state.incomeStatement) return state;
      return { ...state, incomeStatement: updated };
    });
  },

  updateCashFlowRowMetadata: (rowId, patch) => {
    set((state) => {
      let updated = updateCashFlowRowMetadataDeep(state.cashFlow, rowId, patch);
      if (updated === state.cashFlow) return state;
      // Keep canonical WC structure: any row that now resolves to working_capital must live in wc_change.children
      updated = normalizeWcStructure(updated);
      return { ...state, cashFlow: updated };
    });
  },

  confirmRowReview: (statement, rowId) => {
    set((state) => {
      const rows = state[statement];
      if (!rows?.length) return state;
      const updated = updateRowReviewTrustedDeep(rows, rowId);
      if (updated === rows) return state;
      return { ...state, [statement]: updated };
    });
  },

  ensureWcChildrenFromBS: () => {
    set((state) => {
      const excluded = new Set(state.wcExcludedIds ?? []);
      // Preserve existing active WC children only; do not auto-add BS-derived rows
      const cashFlow = ensureWcChildrenInCashFlow(
        state.cashFlow,
        state.balanceSheet,
        excluded
      );
      if (cashFlow === state.cashFlow) return state;
      // Tag BS rows that are already active WC children with scheduleOwner=wc (for projection/suggestions)
      // Do not overwrite when row explicitly has scheduleOwner "none" (custom items)
      const wcRow = cashFlow.find((r) => r.id === "wc_change");
      const wcChildIds = new Set((wcRow?.children ?? []).map((c) => c.id));
      const balanceSheet = state.balanceSheet.map((r) => {
        if (!wcChildIds.has(r.id)) return r;
        if (r.scheduleOwner === "none") return r;
        return {
          ...r,
          scheduleOwner: r.scheduleOwner ?? "wc",
          cashFlowBehavior: r.cashFlowBehavior ?? "working_capital",
        };
      });
      return { cashFlow, balanceSheet };
    });
  },

  ensureCFSAnchorRows: () => {
    set((state) => {
      const next = [...state.cashFlow];
      ensureCFSAnchorRowsInPlace(next);
      const idsChanged =
        next.length !== state.cashFlow.length ||
        next.some((r, i) => r.id !== state.cashFlow[i]?.id);
      if (!idsChanged) return state;
      return { ...state, cashFlow: next };
    });
  },

  applyBsBuildProjectionsToModel: () => {
    const state = get();
    const projectionYears = state.meta?.years?.projection ?? [];
    if (projectionYears.length === 0) return;

    const { incomeStatement, balanceSheet, cashFlow, meta, sbcBreakdowns, danaBreakdowns } = state;
    const allYears = [...(meta?.years?.historical ?? []), ...projectionYears];
    const allStatements = { incomeStatement, balanceSheet, cashFlow };

    // Revenue and COGS by year (for WC and Capex/Intangibles engines)
    const revenueByYear: Record<string, number> = {};
    const cogsByYear: Record<string, number> = {};
    const revRow = incomeStatement.find((r) => r.id === "rev");
    const cogsRow = incomeStatement.find((r) => r.id === "cogs");
    for (const year of allYears) {
      revenueByYear[year] = revRow
        ? computeRowValue(revRow, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns)
        : 0;
      cogsByYear[year] = cogsRow
        ? computeRowValue(cogsRow, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns)
        : 0;
    }

    // WC projected balances
    const wcScheduleItems = getWcScheduleItems(cashFlow, balanceSheet);
    const balanceByItemByYear: Record<string, Record<string, number>> = {};
    for (const item of wcScheduleItems) {
      const row = balanceSheet.find((r) => r.id === item.id);
      balanceByItemByYear[item.id] = {};
      for (const y of allYears) {
        balanceByItemByYear[item.id][y] = row?.values?.[y] ?? 0;
      }
    }
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: state.wcDriverTypeByItemId ?? {},
      wcDaysByItemId: state.wcDaysByItemId ?? {},
      wcDaysByItemIdByYear: state.wcDaysByItemIdByYear ?? {},
      wcDaysBaseByItemId: state.wcDaysBaseByItemId ?? {},
      wcPctBaseByItemId: state.wcPctBaseByItemId ?? {},
      wcPctByItemId: state.wcPctByItemId ?? {},
      wcPctByItemIdByYear: state.wcPctByItemIdByYear ?? {},
    };
    const wcProjected =
      wcScheduleItems.length > 0
        ? computeWcProjectedBalances(
            wcScheduleItems.map((i) => i.id),
            projectionYears,
            wcDriverState,
            revenueByYear,
            cogsByYear,
            balanceByItemByYear
          )
        : {};

    // Capex: last historical PP&E and Capex
    const histYears = meta?.years?.historical ?? [];
    const lastHistYear = histYears.length > 0 ? histYears[histYears.length - 1] : null;
    const lastHistPPE = lastHistYear ? (balanceSheet.find((r) => r.id === "ppe")?.values?.[lastHistYear] ?? 0) : 0;
    const lastHistCapex = lastHistYear ? (cashFlow.find((r) => r.id === "capex")?.values?.[lastHistYear] ?? 0) : 0;
    const revenueByYearProj: Record<string, number> = {};
    for (const y of projectionYears) revenueByYearProj[y] = revenueByYear[y] ?? 0;
    const effectiveUsefulLife =
      state.capexSplitByBucket && state.ppeUsefulLifeByBucket
        ? (() => {
            const allBucketIds = [...CAPEX_DEFAULT_BUCKET_IDS, ...(state.capexCustomBucketIds ?? [])];
            const lives = allBucketIds
              .map((id) => state.ppeUsefulLifeByBucket?.[id])
              .filter((n): n is number => n != null && n > 0);
            return lives.length > 0 ? lives.reduce((a, b) => a + b, 0) / lives.length : state.ppeUsefulLifeSingle;
          })()
        : state.ppeUsefulLifeSingle;
    const capexEngineInput = {
      projectionYears,
      revenueByYear: revenueByYearProj,
      lastHistPPE,
      lastHistCapex,
      method: state.capexForecastMethod,
      pctRevenue: state.capexPctRevenue,
      manualByYear: state.capexManualByYear ?? {},
      growthPct: state.capexGrowthPct,
      timingConvention: state.capexTimingConvention,
      usefulLifeYears: effectiveUsefulLife,
    };
    const totalCapexByYear = computeProjectedCapexByYear(capexEngineInput);
    const capexScheduleOutput = state.capexSplitByBucket
      ? (() => {
          const allBucketIds = [...CAPEX_DEFAULT_BUCKET_IDS, ...(state.capexCustomBucketIds ?? [])];
          const landDisplay = lastHistYear && state.capexHelperPpeByBucketByYear?.["cap_b1"]?.[lastHistYear];
          const initialLand =
            landDisplay != null && typeof landDisplay === "number" && !Number.isNaN(landDisplay)
              ? displayToStored(landDisplay, state.meta?.currencyUnit ?? "millions")
              : 0;
          return computeCapexDaScheduleByBucket({
            projectionYears,
            totalCapexByYear,
            lastHistPPE,
            timingConvention: state.capexTimingConvention,
            bucketIds: allBucketIds,
            allocationPct: state.capexBucketAllocationPct ?? {},
            usefulLifeByBucket: state.ppeUsefulLifeByBucket ?? {},
            initialLandBalance: initialLand,
          });
        })()
      : computeCapexDaSchedule(capexEngineInput);
    const ppeByYear: Record<string, number> =
      state.capexSplitByBucket && capexScheduleOutput && "totalPpeByYear" in capexScheduleOutput
        ? (capexScheduleOutput as { totalPpeByYear: Record<string, number> }).totalPpeByYear
        : (capexScheduleOutput as { ppeByYear: Record<string, number> })?.ppeByYear ?? {};

    // Intangibles
    const lastHistIntangibles =
      lastHistYear && balanceSheet.find((r) => r.id === "intangible_assets")
        ? (balanceSheet.find((r) => r.id === "intangible_assets")!.values?.[lastHistYear] ?? 0)
        : 0;
    const intangiblesOutput =
      state.capexModelIntangibles && state.intangiblesAmortizationLifeYears > 0
        ? computeIntangiblesAmortSchedule({
            projectionYears,
            lastHistIntangibles,
            additionsMethod: state.intangiblesForecastMethod,
            pctRevenue: state.intangiblesPctRevenue,
            manualByYear: state.intangiblesManualByYear ?? {},
            pctOfCapex: state.intangiblesPctOfCapex,
            capexByYear: totalCapexByYear,
            revenueByYear: revenueByYearProj,
            lifeYears: state.intangiblesAmortizationLifeYears,
            timingConvention: state.capexTimingConvention,
          })
        : null;
    const intangiblesEndByYear = intangiblesOutput?.endByYear ?? {};

    // Build updated balanceSheet: only projection years, never touch cash or historical
    const wcItemIds = new Set(wcScheduleItems.map((i) => i.id));
    const idsToWrite = new Set([...wcItemIds, "ppe", "intangible_assets"]);
    let newBS = balanceSheet.map((row) => {
      if (!idsToWrite.has(row.id)) return row;
      const newValues = { ...(row.values ?? {}) };
      for (const y of projectionYears) {
        if (row.id === "cash") continue;
        if (wcItemIds.has(row.id)) {
          const v = wcProjected[row.id]?.[y];
          if (v !== undefined) newValues[y] = v;
        } else if (row.id === "ppe") {
          const v = ppeByYear[y];
          if (v !== undefined) newValues[y] = v;
        } else if (row.id === "intangible_assets") {
          const v = intangiblesEndByYear[y];
          if (v !== undefined) newValues[y] = v;
        }
      }
      // Step 3C: tag schedule-owned rows when applying
      if (row.id === "ppe") {
        return {
          ...row,
          values: newValues,
          scheduleOwner: row.scheduleOwner ?? "capex",
          cashFlowBehavior: row.cashFlowBehavior ?? "investing",
        };
      }
      if (row.id === "intangible_assets") {
        return {
          ...row,
          values: newValues,
          scheduleOwner: row.scheduleOwner ?? "intangibles",
          cashFlowBehavior: row.cashFlowBehavior ?? "investing",
        };
      }
      return { ...row, values: newValues };
    });

    // Recompute balanceSheet totals for each projection year
    for (const year of projectionYears) {
      const st = { ...allStatements, balanceSheet: newBS };
      newBS = recomputeCalculations(newBS, year, newBS, st, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
    }
    // Recompute cashFlow for each projection year (wc_change and operating_cf use new BS)
    let newCF = cashFlow;
    for (const year of projectionYears) {
      const st = { incomeStatement, balanceSheet: newBS, cashFlow: newCF };
      newCF = recomputeCalculations(newCF, year, newCF, st, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
    }

    set({ balanceSheet: newBS, cashFlow: newCF });
  },

  reorderCashFlowTopLevel: (fromIndex, toIndex) => {
    set((state) => {
      const rows = [...state.cashFlow];
      if (fromIndex < 0 || fromIndex >= rows.length || toIndex < 0 || toIndex >= rows.length) return state;
      const [removed] = rows.splice(fromIndex, 1);
      // After removal, array length is rows.length - 1.
      // When dragging down (fromIndex < toIndex): insert at toIndex (after drop target in original array).
      // When dragging up (fromIndex > toIndex): insert at toIndex (before drop target).
      // Clamp toIndex to valid range after removal
      const insertIndex = Math.min(toIndex, rows.length);
      rows.splice(insertIndex, 0, removed);
      const allYears = [
        ...(state.meta.years.historical || []),
        ...(state.meta.years.projection || []),
      ];
      let recalculated = rows;
      const allStatements = { incomeStatement: state.incomeStatement, balanceSheet: state.balanceSheet, cashFlow: rows };
      allYears.forEach((year) => {
        recalculated = recomputeCalculations(recalculated, year, recalculated, allStatements, state.sbcBreakdowns, state.danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      });
      return { cashFlow: recalculated };
    });
  },

  reorderWcChildren: (fromIndex, toIndex) => {
    set((state) => {
      const wcRow = state.cashFlow.find((r) => r.id === "wc_change");
      if (!wcRow?.children?.length) return state;
      const children = [...wcRow.children];
      if (fromIndex < 0 || fromIndex >= children.length || toIndex < 0 || toIndex >= children.length) return state;
      const [removed] = children.splice(fromIndex, 1);
      children.splice(toIndex, 0, removed);
      const cashFlow = state.cashFlow.map((r) => (r.id === "wc_change" ? { ...r, children } : r));
      const allYears = [...(state.meta.years.historical || []), ...(state.meta.years.projection || [])];
      let recalculated = cashFlow;
      const allStatements = { incomeStatement: state.incomeStatement, balanceSheet: state.balanceSheet, cashFlow };
      allYears.forEach((year) => {
        recalculated = recomputeCalculations(recalculated, year, recalculated, allStatements, state.sbcBreakdowns, state.danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      });
      return { cashFlow: recalculated };
    });
  },

  moveCashFlowRowIntoWc: (rowId, insertAtIndex) => {
    set((state) => {
      const row = findRowDeep(state.cashFlow, rowId);
      if (!row) return state;
      if (row.id === "wc_change" || row.id === "operating_cf" || row.id === "net_income" || row.id === "danda" || row.id === "sbc") return state;
      let cashFlow = removeRowDeep(state.cashFlow, rowId);
      const wcRow = cashFlow.find((r) => r.id === "wc_change");
      if (!wcRow) return state;
      const child: Row = {
        ...row,
        children: undefined,
        historicalCfsNature: "reported_working_capital_movement",
        cfsLink: { ...(row.cfsLink ?? {}), section: "operating" as const, impact: row.cfsLink?.impact ?? "neutral", description: row.cfsLink?.description ?? row.label },
        cfsForecastDriver: "working_capital_schedule" as const,
        classificationSource: "user" as const,
        forecastMetadataStatus: "trusted" as const,
        taxonomyStatus: "trusted" as const,
      };
      const atIndex = insertAtIndex ?? (wcRow.children?.length ?? 0);
      cashFlow = addExistingChildToParent(cashFlow, "wc_change", child, atIndex);
      const allYears = [...(state.meta.years.historical || []), ...(state.meta.years.projection || [])];
      let recalculated = cashFlow;
      const allStatements = { incomeStatement: state.incomeStatement, balanceSheet: state.balanceSheet, cashFlow };
      allYears.forEach((year) => {
        recalculated = recomputeCalculations(recalculated, year, recalculated, allStatements, state.sbcBreakdowns, state.danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      });
      return { cashFlow: recalculated };
    });
  },

  addWcChild: (row, insertAtIndex) => {
    set((state) => {
      const wcRow = state.cashFlow.find((r) => r.id === "wc_change");
      if (!wcRow) return state;
      // Phase 2: WC children must be routable; set driver and section so routing treats them as working_capital_schedule
      const childWithMeta: Row = {
        ...row,
        children: undefined as Row[] | undefined,
        cfsForecastDriver: "working_capital_schedule" as const,
        cfsLink: {
          ...(row.cfsLink ?? {}),
          section: "operating" as const,
          impact: row.cfsLink?.impact ?? "neutral",
          description: row.cfsLink?.description ?? row.label,
        },
      };
      const child = applyTaxonomyToRow(childWithMeta, "cashFlow");
      const atIndex = insertAtIndex ?? (wcRow.children?.length ?? 0);
      const cashFlow = addExistingChildToParent(state.cashFlow, "wc_change", child, atIndex);
      const allYears = [...(state.meta.years.historical || []), ...(state.meta.years.projection || [])];
      let recalculated = cashFlow;
      const allStatements = { incomeStatement: state.incomeStatement, balanceSheet: state.balanceSheet, cashFlow };
      allYears.forEach((year) => {
        recalculated = recomputeCalculations(recalculated, year, recalculated, allStatements, state.sbcBreakdowns, state.danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      });
      return { cashFlow: recalculated };
    });
  },

  moveCashFlowRowOutOfWc: (rowId, insertAtTopLevelIndex, targetSubgroupFromUi) => {
    set((state) => {
      const wcRow = state.cashFlow.find((r) => r.id === "wc_change");
      const childIndex = wcRow?.children?.findIndex((c) => c.id === rowId) ?? -1;
      if (childIndex === -1) return state;
      const row = wcRow!.children![childIndex];
      const newWcChildren = wcRow!.children!.filter((c) => c.id !== rowId);
      let cashFlow = state.cashFlow.map((r) =>
        r.id === "wc_change" ? { ...r, children: newWcChildren } : r
      );
      const wcChangeIndex = cashFlow.findIndex((r) => r.id === "wc_change");
      const insertAt = insertAtTopLevelIndex ?? Math.min(wcChangeIndex + 1, cashFlow.length);
      // Use UI-provided target subgroup when moving out of WC; else infer from insert position.
      const rowAfter = cashFlow[insertAt];
      const targetSubgroup: "non_cash" | "other_operating" =
        targetSubgroupFromUi === "other_operating" || targetSubgroupFromUi === "non_cash"
          ? targetSubgroupFromUi
          : rowAfter && (rowAfter.id === "other_operating" || rowAfter.id === "operating_cf")
            ? "other_operating"
            : "non_cash";
      const historicalCfsNature = targetSubgroup === "other_operating" ? "reported_operating_other" : "reported_non_cash_adjustment";
      const topLevelRow: Row = {
        ...row,
        children: undefined,
        historicalCfsNature,
        cfsLink: { ...(row.cfsLink ?? {}), section: "operating" as const, impact: row.cfsLink?.impact ?? "neutral", description: row.cfsLink?.description ?? row.label },
        cfsForecastDriver: "manual_other" as const,
        classificationSource: "user" as const,
        forecastMetadataStatus: "trusted" as const,
        taxonomyStatus: "trusted" as const,
      };
      cashFlow = [...cashFlow.slice(0, insertAt), topLevelRow, ...cashFlow.slice(insertAt)];
      const allYears = [...(state.meta.years.historical || []), ...(state.meta.years.projection || [])];
      let recalculated = cashFlow;
      const allStatements = { incomeStatement: state.incomeStatement, balanceSheet: state.balanceSheet, cashFlow };
      allYears.forEach((year) => {
        recalculated = recomputeCalculations(recalculated, year, recalculated, allStatements, state.sbcBreakdowns, state.danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      });
      return { cashFlow: recalculated };
    });
  },

  reorderBalanceSheetCategory: (category, fromIndex, toIndex) => {
    set((state) => {
      const categoryRows = getRowsForCategory(state.balanceSheet, category);
      
      // Filter out total rows from reordering
      const reorderableRows = categoryRows.filter((r) => !r.id.startsWith("total_"));
      
      if (fromIndex < 0 || fromIndex >= reorderableRows.length || toIndex < 0 || toIndex >= reorderableRows.length) {
        return state;
      }
      
      // Reorder within the category
      const reordered = [...reorderableRows];
      const [removed] = reordered.splice(fromIndex, 1);
      const insertIndex = Math.min(toIndex, reordered.length);
      reordered.splice(insertIndex, 0, removed);
      
      // Find the boundaries of this category in the full balanceSheet array
      const totalCurrentAssetsIndex = state.balanceSheet.findIndex((r) => r.id === "total_current_assets");
      const totalAssetsIndex = state.balanceSheet.findIndex((r) => r.id === "total_assets");
      const totalCurrentLiabIndex = state.balanceSheet.findIndex((r) => r.id === "total_current_liabilities");
      const totalLiabIndex = state.balanceSheet.findIndex((r) => r.id === "total_liabilities");
      const totalEquityIndex = state.balanceSheet.findIndex((r) => r.id === "total_equity");
      
      let categoryStartIndex = 0;
      let categoryEndIndex = state.balanceSheet.length;
      
      switch (category) {
        case "current_assets":
          categoryStartIndex = 0;
          categoryEndIndex = totalCurrentAssetsIndex >= 0 ? totalCurrentAssetsIndex : totalAssetsIndex >= 0 ? totalAssetsIndex : state.balanceSheet.length;
          break;
        case "fixed_assets":
          categoryStartIndex = totalCurrentAssetsIndex >= 0 ? totalCurrentAssetsIndex + 1 : 0;
          categoryEndIndex = totalAssetsIndex >= 0 ? totalAssetsIndex : state.balanceSheet.length;
          break;
        case "current_liabilities":
          categoryStartIndex = totalAssetsIndex >= 0 ? totalAssetsIndex + 1 : 0;
          categoryEndIndex = totalCurrentLiabIndex >= 0 ? totalCurrentLiabIndex : totalLiabIndex >= 0 ? totalLiabIndex : state.balanceSheet.length;
          break;
        case "non_current_liabilities":
          categoryStartIndex = totalCurrentLiabIndex >= 0 ? totalCurrentLiabIndex + 1 : 0;
          categoryEndIndex = totalLiabIndex >= 0 ? totalLiabIndex : state.balanceSheet.length;
          break;
        case "equity":
          categoryStartIndex = totalLiabIndex >= 0 ? totalLiabIndex + 1 : 0;
          categoryEndIndex = totalEquityIndex >= 0 ? totalEquityIndex : state.balanceSheet.length;
          break;
      }
      
      // Get all rows outside this category
      const beforeCategory = state.balanceSheet.slice(0, categoryStartIndex);
      const categoryTotalRows = state.balanceSheet.slice(categoryStartIndex, categoryEndIndex + 1).filter((r) => r.id.startsWith("total_"));
      const afterCategory = state.balanceSheet.slice(categoryEndIndex + 1);
      
      // Rebuild balanceSheet with reordered category items
      const newBalanceSheet = [
        ...beforeCategory,
        ...reordered,
        ...categoryTotalRows,
        ...afterCategory,
      ];
      
      return { balanceSheet: newBalanceSheet };
    });
  },

  setBalanceSheetRowCashFlowBehavior: (rowId, behavior) => {
    const state = get();
    if (isCoreBsRow(rowId)) {
      const locked = getCoreLockedBehavior(rowId);
      if (locked) {
        set((s) => ({
          balanceSheet: s.balanceSheet.map((r) =>
            r.id === rowId
              ? { ...r, cashFlowBehavior: locked.cashFlowBehavior, ...(locked.scheduleOwner != null && { scheduleOwner: locked.scheduleOwner }) }
              : r
          ),
        }));
      }
      get().ensureWcChildrenFromBS();
      const next = get();
      const allYears = [
        ...(next.meta?.years?.historical ?? []),
        ...(next.meta?.years?.projection ?? []),
      ];
      const { incomeStatement, balanceSheet, cashFlow, sbcBreakdowns, danaBreakdowns } = next;
      let newCF = cashFlow;
      allYears.forEach((year) => {
        const allStatements = { incomeStatement, balanceSheet, cashFlow: newCF };
        newCF = recomputeCalculations(newCF, year, newCF, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      });
      if (newCF !== cashFlow) set({ cashFlow: newCF });
      return;
    }
    set((s) => ({
      balanceSheet: s.balanceSheet.map((r) =>
        r.id === rowId
          ? {
              ...r,
              cashFlowBehavior: behavior,
              forecastMetadataStatus: "trusted" as const,
              taxonomyStatus: "trusted" as const,
              classificationSource: "user" as const,
            }
          : r
      ),
    }));
    get().ensureWcChildrenFromBS();
    const next = get();
    const allYears = [
      ...(next.meta?.years?.historical ?? []),
      ...(next.meta?.years?.projection ?? []),
    ];
    const { incomeStatement, balanceSheet, cashFlow, sbcBreakdowns, danaBreakdowns } = next;
    let newCF = cashFlow;
    allYears.forEach((year) => {
      const allStatements = { incomeStatement, balanceSheet, cashFlow: newCF };
      newCF = recomputeCalculations(newCF, year, newCF, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
    });
    if (newCF !== cashFlow) set({ cashFlow: newCF });
  },

  reorderIncomeStatementChildren: (parentId, fromIndex, toIndex) => {
    set((state) => {
      const parentRow = state.incomeStatement.find((r) => r.id === parentId);
      if (!parentRow || !parentRow.children || parentRow.children.length === 0) {
        return state;
      }
      
      const children = [...parentRow.children];
      if (fromIndex < 0 || fromIndex >= children.length || toIndex < 0 || toIndex >= children.length) {
        return state;
      }
      
      const [removed] = children.splice(fromIndex, 1);
      children.splice(toIndex, 0, removed);
      
      const updatedIncomeStatement = state.incomeStatement.map((r) =>
        r.id === parentId ? { ...r, children } : r
      );
      
      // Recalculate all years after reordering
      const allYears = [
        ...(state.meta.years.historical || []),
        ...(state.meta.years.projection || []),
      ];
      
      let recalculated = updatedIncomeStatement;
      const allStatements = {
        incomeStatement: updatedIncomeStatement,
        balanceSheet: state.balanceSheet,
        cashFlow: state.cashFlow,
      };
      
      allYears.forEach((year) => {
        recalculated = recomputeCalculations(
          recalculated,
          year,
          recalculated,
          allStatements,
          state.sbcBreakdowns,
          state.danaBreakdowns,
          undefined,
          state.embeddedDisclosures ?? [],
          state.sbcDisclosureEnabled ?? true
        );
      });
      
      return { incomeStatement: recalculated };
    });
  },

  reorderIncomeStatementRows: (fromIndex, toIndex) => {
    set((state) => {
      const rows = [...state.incomeStatement];
      if (fromIndex < 0 || fromIndex >= rows.length || toIndex < 0 || toIndex >= rows.length) {
        return state;
      }
      const [removed] = rows.splice(fromIndex, 1);
      const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
      rows.splice(insertIndex, 0, removed);
      const allYears = [
        ...(state.meta.years.historical || []),
        ...(state.meta.years.projection || []),
      ];
      let recalculated = rows;
      const allStatements = {
        incomeStatement: rows,
        balanceSheet: state.balanceSheet,
        cashFlow: state.cashFlow,
      };
      allYears.forEach((year) => {
        recalculated = recomputeCalculations(
          recalculated,
          year,
          recalculated,
          allStatements,
          state.sbcBreakdowns,
          state.danaBreakdowns,
          undefined,
          state.embeddedDisclosures ?? [],
          state.sbcDisclosureEnabled ?? true
        );
      });
      return { incomeStatement: recalculated };
    });
  },

  updateSbcValue: (categoryId, year, value) => {
    set((state) => {
      const currentBreakdowns = state.sbcBreakdowns || {};
      return {
        sbcBreakdowns: {
          ...currentBreakdowns,
          [categoryId]: {
            ...(currentBreakdowns[categoryId] || {}),
            [year]: value,
          },
        },
      };
    });
  },

  setEmbeddedDisclosureValue: (type, rowId, year, value, label) => {
    set((state) => {
      const list = state.embeddedDisclosures ?? [];
      const idx = list.findIndex((d) => d.type === type && d.rowId === rowId);
      const existing = idx >= 0 ? list[idx] : null;
      const newValues =
        existing
          ? { ...existing.values, [year]: value }
          : { [year]: value };
      const item: EmbeddedDisclosureItem = {
        type,
        rowId,
        values: newValues,
        label: label ?? existing?.label,
      };
      const next =
        idx >= 0
          ? list.map((d, i) => (i === idx ? item : d))
          : [...list, item];
      return { embeddedDisclosures: next };
    });
  },

  setSbcDisclosureEnabled: (enabled) => {
    set((state) => {
      const next = { ...state, sbcDisclosureEnabled: enabled };
      // Recompute cashFlow for all years so stored SBC (and operating_cf) values reflect the toggle; otherwise stale disclosure values stay in row.values.
      const allYears = [...(state.meta?.years?.historical ?? []), ...(state.meta?.years?.projection ?? [])];
      let cashFlow = state.cashFlow ?? [];
      const allStatements = { incomeStatement: state.incomeStatement ?? [], balanceSheet: state.balanceSheet ?? [], cashFlow };
      allYears.forEach((year) => {
        cashFlow = recomputeCalculations(cashFlow, year, cashFlow, allStatements, state.sbcBreakdowns ?? {}, state.danaBreakdowns ?? {}, undefined, state.embeddedDisclosures ?? [], enabled);
        allStatements.cashFlow = cashFlow;
      });
      return { ...next, cashFlow };
    });
  },

  resetFinancialInputs: () => get().resetAllFinancialInputs(),

  resetAllFinancialInputs: () => {
    const state = get();
    const clearedIS = clearRowValues(state.incomeStatement);
    const clearedBS = clearRowValues(state.balanceSheet);
    const clearedCF = clearRowValues(state.cashFlow);
    const clearedSchedules = {
      workingCapital: clearRowValues(state.schedules.workingCapital),
      debt: clearRowValues(state.schedules.debt),
      capex: clearRowValues(state.schedules.capex),
    };
    set({
      embeddedDisclosures: [],
      sbcBreakdowns: {},
      danaLocation: null,
      danaBreakdowns: {},
      incomeStatement: clearedIS,
      balanceSheet: clearedBS,
      cashFlow: clearedCF,
      schedules: clearedSchedules,
      revenueProjectionConfig: DEFAULT_REVENUE_PROJECTION_CONFIG,
      cogsPctByRevenueLine: {},
      cogsPctModeByRevenueLine: {},
      cogsPctByRevenueLineByYear: {},
      sgaPctByItemId: {},
      sgaPctModeByItemId: {},
      sgaPctByItemIdByYear: {},
      sgaPctOfParentByItemId: {},
      sgaPctOfParentModeByItemId: {},
      sgaPctOfParentByItemIdByYear: {},
      sgaHistoricAmountByItemIdByYear: {},
      wcDriverTypeByItemId: {},
      wcDaysByItemId: {},
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: {},
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
      capexForecastMethod: "pct_revenue",
      capexPctRevenue: 0,
      capexManualByYear: {},
      capexGrowthPct: 0,
      capexSplitByBucket: true,
      capexForecastBucketsIndependently: false,
      capexTimingConvention: "mid",
      capexBucketAllocationPct: {},
      capexBucketLabels: {},
      capexCustomBucketIds: [],
      capexBucketMethod: {},
      capexBucketPctRevenue: {},
      capexBucketManualByYear: {},
      capexBucketGrowthPct: {},
      ppeUsefulLifeByBucket: { ...CAPEX_IB_DEFAULT_USEFUL_LIVES },
      ppeUsefulLifeSingle: 10,
      capexHistoricByBucketByYear: {},
      capexHelperPpeByBucketByYear: {},
      capexIncludeInAllocationByBucket: {},
      capexModelIntangibles: true,
      intangiblesForecastMethod: "pct_revenue",
      intangiblesAmortizationLifeYears: 7,
      intangiblesPctRevenue: 0,
      intangiblesManualByYear: {},
      intangiblesPctOfCapex: 0,
      intangiblesHasHistoricalAmortization: false,
      intangiblesHistoricalAmortizationByYear: {},
      bsBuildPreviewOverrides: {},
    });
    get().recalculateAll();
  },

  resetIncomeStatementInputs: () => {
    set((state) => ({
      incomeStatement: createIncomeStatementTemplate(),
      revenueProjectionConfig: DEFAULT_REVENUE_PROJECTION_CONFIG,
      cogsPctByRevenueLine: {},
      cogsPctModeByRevenueLine: {},
      cogsPctByRevenueLineByYear: {},
      sgaPctByItemId: {},
      sgaPctModeByItemId: {},
      sgaPctByItemIdByYear: {},
      sgaPctOfParentByItemId: {},
      sgaPctOfParentModeByItemId: {},
      sgaPctOfParentByItemIdByYear: {},
      sgaHistoricAmountByItemIdByYear: {},
    }));
    get().recalculateAll();
  },

  resetBalanceSheetInputs: () => {
    set((state) => ({
      balanceSheet: createBalanceSheetTemplate(),
      wcDriverTypeByItemId: {},
      wcDaysByItemId: {},
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: {},
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
      capexForecastMethod: "pct_revenue",
      capexPctRevenue: 0,
      capexManualByYear: {},
      capexGrowthPct: 0,
      capexSplitByBucket: true,
      capexForecastBucketsIndependently: false,
      capexTimingConvention: "mid",
      capexBucketAllocationPct: {},
      capexBucketLabels: {},
      capexCustomBucketIds: [],
      capexBucketMethod: {},
      capexBucketPctRevenue: {},
      capexBucketManualByYear: {},
      capexBucketGrowthPct: {},
      ppeUsefulLifeByBucket: { ...CAPEX_IB_DEFAULT_USEFUL_LIVES },
      ppeUsefulLifeSingle: 10,
      capexHistoricByBucketByYear: {},
      capexHelperPpeByBucketByYear: {},
      capexIncludeInAllocationByBucket: {},
      capexModelIntangibles: true,
      intangiblesForecastMethod: "pct_revenue",
      intangiblesAmortizationLifeYears: 7,
      intangiblesPctRevenue: 0,
      intangiblesManualByYear: {},
      intangiblesPctOfCapex: 0,
      intangiblesHasHistoricalAmortization: false,
      intangiblesHistoricalAmortizationByYear: {},
      schedules: {
        ...state.schedules,
        workingCapital: clearRowValues(state.schedules?.workingCapital ?? []),
        debt: clearRowValues(state.schedules?.debt ?? []),
        capex: clearRowValues(state.schedules?.capex ?? []),
      },
      bsBuildPreviewOverrides: {},
    }));
    get().recalculateAll();
  },

  resetCashFlowInputs: () => {
    set((state) => ({
      // Template has wc_change with children: [] — no BS-derived or placeholder rows; user adds WC components explicitly
      cashFlow: createCashFlowTemplate(),
      confirmedRowIds: {},
    }));
    get().recalculateAll();
  },

  // Section lock and expand management
  lockSection: (sectionId) => {
    set((state) => ({
      sectionLocks: {
        ...state.sectionLocks,
        [sectionId]: true,
      },
      sectionExpanded: {
        ...state.sectionExpanded,
        [sectionId]: false, // Collapse when locked
      },
    }));
  },

  unlockSection: (sectionId) => {
    set((state) => ({
      sectionLocks: {
        ...state.sectionLocks,
        [sectionId]: false,
      },
    }));
  },

  toggleSectionExpanded: (sectionId) => {
    set((state) => ({
      sectionExpanded: {
        ...state.sectionExpanded,
        [sectionId]: !(state.sectionExpanded[sectionId] ?? true), // Default to expanded
      },
    }));
  },

  setSectionExpanded: (sectionId, expanded) => {
    set((state) => ({
      sectionExpanded: {
        ...state.sectionExpanded,
        [sectionId]: expanded,
      },
    }));
  },

  toggleConfirmedRow: (rowId) => {
    set((state) => ({
      confirmedRowIds: {
        ...state.confirmedRowIds,
        [rowId]: !state.confirmedRowIds[rowId],
      },
    }));
  },

  // Legacy/backward compatibility actions
  addRevenueStream: (label) => {
    const trimmed = (label ?? "").trim();
    if (!trimmed) return;

    const child: Row = {
      id: uuid(),
      label: trimmed,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };

    set((state) => ({
      incomeStatement: addChildRow(state.incomeStatement, "rev", child),
    }));
  },

  updateIncomeStatementValue: (rowId, year, value) => {
    set((state) => {
      const updated = updateRowValueDeep(state.incomeStatement, rowId, year, value);
      const sgaChildren = findRowDeep(state.incomeStatement, "sga")?.children ?? [];
      const parentIdsWithProjectionBreakdowns = new Set([
        ...Object.keys(state.revenueProjectionConfig?.breakdowns ?? {}),
        ...collectParentIdsWithChildren(sgaChildren),
      ]);
      const allStatements = {
        incomeStatement: updated,
        balanceSheet: state.balanceSheet,
        cashFlow: state.cashFlow,
      };
      const recomputed = recomputeCalculations(
        updated,
        year,
        updated,
        allStatements,
        state.sbcBreakdowns,
        state.danaBreakdowns,
        parentIdsWithProjectionBreakdowns,
        state.embeddedDisclosures ?? [],
        state.sbcDisclosureEnabled ?? true
      );
      return { incomeStatement: recomputed };
    });
  },
  
  updateYears: (newYears) => {
    set((state) => {
      const oldYears = {
        historical: state.meta.years.historical || [],
        projection: state.meta.years.projection || [],
      };
      const allOldYears = [...oldYears.historical, ...oldYears.projection];
      const allNewYears = [...newYears.historical, ...newYears.projection];
      
      // Find years to add and remove
      const yearsToAdd = allNewYears.filter(y => !allOldYears.includes(y));
      const yearsToRemove = allOldYears.filter(y => !allNewYears.includes(y));
      
      // Helper function to update years in a row (recursively)
      const updateYearsInRow = (row: Row): Row => {
        const newValues = { ...(row.values || {}) };
        
        // Remove values for deleted years
        yearsToRemove.forEach(year => {
          delete newValues[year];
        });
        
        // Add empty values for new years
        yearsToAdd.forEach(year => {
          newValues[year] = 0;
        });
        
        // Recursively update children
        const newChildren = row.children?.map(updateYearsInRow);
        
        return {
          ...row,
          values: newValues,
          children: newChildren,
        };
      };
      
      // Update all statements
      let incomeStatement = state.incomeStatement.map(updateYearsInRow);
      let balanceSheet = state.balanceSheet.map(updateYearsInRow);
      let cashFlow = state.cashFlow.map(updateYearsInRow);
      
      // Update SBC breakdowns
      const newSbcBreakdowns: Record<string, Record<string, number>> = {};
      Object.keys(state.sbcBreakdowns || {}).forEach(categoryId => {
        const categoryBreakdowns = state.sbcBreakdowns[categoryId] || {};
        const newCategoryBreakdowns: Record<string, number> = { ...categoryBreakdowns };
        
        // Remove deleted years
        yearsToRemove.forEach(year => {
          delete newCategoryBreakdowns[year];
        });
        
        // Add empty values for new years
        yearsToAdd.forEach(year => {
          newCategoryBreakdowns[year] = 0;
        });
        
        newSbcBreakdowns[categoryId] = newCategoryBreakdowns;
      });
      
      // Recalculate all formulas for all new years. Preserve historical values for rows with IS Build breakdowns (e.g. R&D with sub-items).
      const sbcBreakdowns = state.sbcBreakdowns;
      const danaBreakdowns = state.danaBreakdowns;
      const sgaChildren = findRowDeep(incomeStatement, "sga")?.children ?? [];
      const sgaParentIdsWithBreakdowns = collectParentIdsWithChildren(sgaChildren);
      const revBreakdownIds = new Set(Object.keys(state.revenueProjectionConfig?.breakdowns ?? {}));
      const parentIdsWithProjectionBreakdowns = new Set([...revBreakdownIds, ...sgaParentIdsWithBreakdowns]);
      allNewYears.forEach((year) => {
        const allStatements = { incomeStatement, balanceSheet, cashFlow };
        incomeStatement = recomputeCalculations(incomeStatement, year, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns, parentIdsWithProjectionBreakdowns, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
        balanceSheet = recomputeCalculations(balanceSheet, year, balanceSheet, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
        cashFlow = recomputeCalculations(cashFlow, year, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
      });

      return {
        meta: {
          ...state.meta,
          years: newYears,
        },
        incomeStatement,
        balanceSheet,
        cashFlow,
        sbcBreakdowns: newSbcBreakdowns,
      };
    });
  },

  createProject: (projectName, meta, options?: { fromCurrentState?: boolean }) => {
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const state = get();
    
    if (options?.fromCurrentState && state.isInitialized) {
      // Recovery: Create project from existing state without resetting
      const snapshot = getProjectSnapshot(state);
      set({
        currentProjectId: id,
        projects: [
          ...state.projects,
          { id, name: projectName, createdAt: Date.now(), updatedAt: Date.now() },
        ],
        projectStates: {
          ...state.projectStates,
          [id]: snapshot,
        },
      });
    } else {
      // Normal: Initialize new model
      get().initializeModel(meta, { force: true });
      const newState = get();
      set({
        currentProjectId: id,
        projects: [
          ...newState.projects,
          { id, name: projectName, createdAt: Date.now(), updatedAt: Date.now() },
        ],
        projectStates: {
          ...newState.projectStates,
          [id]: getProjectSnapshot(newState),
        },
      });
    }
    return id;
  },

  loadProject: (projectId) => {
    const state = get();
    const snapshot = state.projectStates[projectId];
    if (!snapshot) return;
    applyProjectSnapshot(set, snapshot);
    // Backfill classification completeness for older projects or legacy paths (preserves user overrides)
    // Then backfill taxonomy; then CFS metadata (historicalCfsNature where missing)
    set((s) => {
      const classificationBackfilled = backfillClassificationCompleteness({
        incomeStatement: s.incomeStatement ?? [],
        balanceSheet: s.balanceSheet ?? [],
        cashFlow: s.cashFlow ?? [],
      });
      const backfilled = backfillTaxonomy(classificationBackfilled);
      const cashFlowWithNature = backfillCfsMetadataNature(backfilled.cashFlow);
      return {
        incomeStatement: backfilled.incomeStatement,
        balanceSheet: backfilled.balanceSheet,
        cashFlow: cashFlowWithNature,
        currentProjectId: projectId,
      };
    });
  },

  saveCurrentProject: () => {
    const state = get();
    if (!state.currentProjectId) return;
    const snapshot = getProjectSnapshot(state);
    const now = Date.now();
    set({
      projectStates: {
        ...state.projectStates,
        [state.currentProjectId]: snapshot,
      },
      projects: state.projects.map((p) =>
        p.id === state.currentProjectId
          ? { ...p, updatedAt: now }
          : p
      ),
    });
  },

  renameProject: (projectId, name) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, name, updatedAt: Date.now() } : p
      ),
    }));
  },

  deleteProject: (projectId) => {
    set((state) => {
      const nextProjects = state.projects.filter((p) => p.id !== projectId);
      const nextStates = { ...state.projectStates };
      delete nextStates[projectId];
      const nextCurrent =
        state.currentProjectId === projectId
          ? (nextProjects[0]?.id ?? null)
          : state.currentProjectId;
      return {
        projects: nextProjects,
        projectStates: nextStates,
        currentProjectId: nextCurrent,
      };
    });
  },

  setRevenueProjectionMethod: (itemId, method) => {
    set((state) => {
      const config = state.revenueProjectionConfig ?? DEFAULT_REVENUE_PROJECTION_CONFIG;
      const existing = config.items[itemId];
      const lastHistoric = state.meta?.years?.historical?.slice(-1)?.[0] ?? "";
      const defaultInputs: RevenueProjectionInputs =
        method === "growth_rate"
          ? { growthType: "constant", ratePercent: 0, baseYear: lastHistoric }
          : method === "price_volume"
          ? { baseYear: lastHistoric, price: 0, volume: 0, annualizeFromMonthly: false }
          : method === "customers_arpu"
          ? { baseYear: lastHistoric, customers: 0, arpu: 0 }
          : method === "pct_of_total"
          ? { referenceId: "rev", pctOfTotal: 0 }
          : method === "product_line" || method === "channel"
          ? { items: [] }
          : { growthType: "constant", ratePercent: 0 };
      return {
        revenueProjectionConfig: {
          ...config,
          items: { ...config.items, [itemId]: { method, inputs: (existing?.inputs ?? defaultInputs) as RevenueProjectionInputs } },
        },
      };
    });
  },

  setRevenueProjectionInputs: (itemId, inputs) => {
    set((state) => {
      const config = state.revenueProjectionConfig ?? DEFAULT_REVENUE_PROJECTION_CONFIG;
      const existing = config.items[itemId];
      if (!existing) return state;
      return {
        revenueProjectionConfig: {
          ...config,
          items: { ...config.items, [itemId]: { ...existing, inputs } },
        },
      };
    });
  },

  setCogsPctForRevenueLine: (revenueLineId, pct) => {
    set((state) => ({
      cogsPctByRevenueLine: {
        ...(state.cogsPctByRevenueLine ?? {}),
        [revenueLineId]: Math.max(0, Math.min(100, pct)),
      },
    }));
  },

  setCogsPctModeForRevenueLine: (revenueLineId, mode) => {
    set((state) => ({
      cogsPctModeByRevenueLine: {
        ...(state.cogsPctModeByRevenueLine ?? {}),
        [revenueLineId]: mode,
      },
    }));
  },

  setCogsPctForRevenueLineYear: (revenueLineId, year, pct) => {
    set((state) => {
      const byLine = state.cogsPctByRevenueLineByYear ?? {};
      const byYear = { ...(byLine[revenueLineId] ?? {}), [year]: Math.max(0, Math.min(100, pct)) };
      return {
        cogsPctByRevenueLineByYear: { ...byLine, [revenueLineId]: byYear },
      };
    });
  },

  setSgaPctForItem: (itemId, pct) => {
    set((state) => ({
      sgaPctByItemId: {
        ...(state.sgaPctByItemId ?? {}),
        [itemId]: Math.max(0, Math.min(100, pct)),
      },
    }));
  },

  setSgaPctModeForItem: (itemId, mode) => {
    set((state) => ({
      sgaPctModeByItemId: {
        ...(state.sgaPctModeByItemId ?? {}),
        [itemId]: mode,
      },
    }));
  },

  setSgaPctForItemYear: (itemId, year, pct) => {
    set((state) => {
      const byItem = state.sgaPctByItemIdByYear ?? {};
      const byYear = {
        ...(byItem[itemId] ?? {}),
        [year]: Math.max(0, Math.min(100, pct)),
      };
      return {
        sgaPctByItemIdByYear: { ...byItem, [itemId]: byYear },
      };
    });
  },

  setSgaPctOfParentForItem: (itemId, pct) => {
    set((state) => ({
      sgaPctOfParentByItemId: {
        ...(state.sgaPctOfParentByItemId ?? {}),
        [itemId]: Math.max(0, Math.min(100, pct)),
      },
    }));
  },

  setSgaPctOfParentModeForItem: (itemId, mode) => {
    set((state) => ({
      sgaPctOfParentModeByItemId: {
        ...(state.sgaPctOfParentModeByItemId ?? {}),
        [itemId]: mode,
      },
    }));
  },

  setSgaPctOfParentForItemYear: (itemId, year, pct) => {
    set((state) => {
      const byItem = state.sgaPctOfParentByItemIdByYear ?? {};
      const byYear = {
        ...(byItem[itemId] ?? {}),
        [year]: Math.max(0, Math.min(100, pct)),
      };
      return {
        sgaPctOfParentByItemIdByYear: { ...byItem, [itemId]: byYear },
      };
    });
  },

  setSgaHistoricAmountForItemYear: (itemId, year, value) => {
    set((state) => {
      const byItem = state.sgaHistoricAmountByItemIdByYear ?? {};
      const byYear = {
        ...(byItem[itemId] ?? {}),
        [year]: value,
      };
      return {
        sgaHistoricAmountByItemIdByYear: { ...byItem, [itemId]: byYear },
      };
    });
  },

  setWcDriverType: (itemId, driver) => {
    set((state) => ({
      wcDriverTypeByItemId: {
        ...(state.wcDriverTypeByItemId ?? {}),
        [itemId]: driver,
      },
    }));
  },

  setWcDaysForItem: (itemId, days) => {
    set((state) => ({
      wcDaysByItemId: {
        ...(state.wcDaysByItemId ?? {}),
        [itemId]: Math.max(0, days),
      },
    }));
  },

  setWcDaysForItemYear: (itemId, year, days) => {
    set((state) => {
      const byItem = state.wcDaysByItemIdByYear ?? {};
      const byYear = {
        ...(byItem[itemId] ?? {}),
        [year]: Math.max(0, days),
      };
      return {
        wcDaysByItemIdByYear: { ...byItem, [itemId]: byYear },
      };
    });
  },

  setWcDaysBaseForItem: (itemId, base) => {
    set((state) => ({
      wcDaysBaseByItemId: {
        ...(state.wcDaysBaseByItemId ?? {}),
        [itemId]: base,
      },
    }));
  },

  setWcPctBaseForItem: (itemId, base) => {
    set((state) => ({
      wcPctBaseByItemId: {
        ...(state.wcPctBaseByItemId ?? {}),
        [itemId]: base,
      },
    }));
  },

  setWcPctForItem: (itemId, pct) => {
    set((state) => ({
      wcPctByItemId: {
        ...(state.wcPctByItemId ?? {}),
        [itemId]: Math.max(0, Math.min(100, pct)),
      },
    }));
  },

  setWcPctForItemYear: (itemId, year, pct) => {
    set((state) => {
      const byItem = state.wcPctByItemIdByYear ?? {};
      const byYear = {
        ...(byItem[itemId] ?? {}),
        [year]: Math.max(0, Math.min(100, pct)),
      };
      return {
        wcPctByItemIdByYear: { ...byItem, [itemId]: byYear },
      };
    });
  },

  setCapexForecastMethod: (method) => set((s) => ({ capexForecastMethod: method })),
  setCapexPctRevenue: (pct) => set((s) => ({ capexPctRevenue: Math.max(0, pct) })),
  setCapexManualByYear: (year, value) =>
    set((s) => ({
      capexManualByYear: { ...(s.capexManualByYear ?? {}), [year]: value },
    })),
  setCapexGrowthPct: (pct) => set((s) => ({ capexGrowthPct: pct })),
  setCapexSplitByBucket: (on) => set(() => ({ capexSplitByBucket: on })),
  setCapexForecastBucketsIndependently: (on) => set(() => ({ capexForecastBucketsIndependently: on })),
  setCapexTimingConvention: (timing) => set(() => ({ capexTimingConvention: timing })),
  setCapexBucketAllocationPct: (bucketId, pct) =>
    set((s) => ({
      capexBucketAllocationPct: { ...(s.capexBucketAllocationPct ?? {}), [bucketId]: Math.max(0, Math.min(100, pct)) },
    })),
  setCapexBucketLabel: (bucketId, label) =>
    set((s) => ({
      capexBucketLabels: { ...(s.capexBucketLabels ?? {}), [bucketId]: label ?? "" },
    })),
  addCapexBucket: (label) => {
    const id = `cap_custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const displayLabel = (label ?? "").trim() || "New category";
    set((s) => ({
      capexCustomBucketIds: [...(s.capexCustomBucketIds ?? []), id],
      capexBucketLabels: { ...(s.capexBucketLabels ?? {}), [id]: displayLabel },
    }));
    return id;
  },
  removeCapexBucket: (bucketId) =>
    set((s) => {
      const custom = s.capexCustomBucketIds ?? [];
      if (!custom.includes(bucketId)) return {};
      const labels = { ...(s.capexBucketLabels ?? {}) };
      const allocation = { ...(s.capexBucketAllocationPct ?? {}) };
      const method = { ...(s.capexBucketMethod ?? {}) };
      const pctRev = { ...(s.capexBucketPctRevenue ?? {}) };
      const manual = { ...(s.capexBucketManualByYear ?? {}) };
      const growth = { ...(s.capexBucketGrowthPct ?? {}) };
      const usefulLife = { ...(s.ppeUsefulLifeByBucket ?? {}) };
      delete labels[bucketId];
      delete allocation[bucketId];
      delete method[bucketId];
      delete pctRev[bucketId];
      delete manual[bucketId];
      delete growth[bucketId];
      delete usefulLife[bucketId];
      return {
        capexCustomBucketIds: custom.filter((x) => x !== bucketId),
        capexBucketLabels: labels,
        capexBucketAllocationPct: allocation,
        capexBucketMethod: method,
        capexBucketPctRevenue: pctRev,
        capexBucketManualByYear: manual,
        capexBucketGrowthPct: growth,
        ppeUsefulLifeByBucket: usefulLife,
      };
    }),
  setCapexBucketMethod: (bucketId, method) =>
    set((s) => ({
      capexBucketMethod: { ...(s.capexBucketMethod ?? {}), [bucketId]: method },
    })),
  setCapexBucketPctRevenue: (bucketId, pct) =>
    set((s) => ({
      capexBucketPctRevenue: { ...(s.capexBucketPctRevenue ?? {}), [bucketId]: Math.max(0, pct) },
    })),
  setCapexBucketManualByYear: (bucketId, year, value) =>
    set((s) => {
      const byBucket = s.capexBucketManualByYear ?? {};
      const byYear = { ...(byBucket[bucketId] ?? {}), [year]: value };
      return { capexBucketManualByYear: { ...byBucket, [bucketId]: byYear } };
    }),
  setCapexBucketGrowthPct: (bucketId, pct) =>
    set((s) => ({
      capexBucketGrowthPct: { ...(s.capexBucketGrowthPct ?? {}), [bucketId]: pct },
    })),
  setPpeUsefulLifeByBucket: (bucketId, years) =>
    set((s) => ({
      ppeUsefulLifeByBucket: { ...(s.ppeUsefulLifeByBucket ?? {}), [bucketId]: Math.max(0.5, years) },
    })),
  setPpeUsefulLifeSingle: (years) => set(() => ({ ppeUsefulLifeSingle: Math.max(0.5, years) })),
  setCapexHistoricBucketYear: (bucketId, year, value) =>
    set((s) => {
      const byBucket = s.capexHistoricByBucketByYear ?? {};
      const byYear = { ...(byBucket[bucketId] ?? {}), [year]: value };
      return { capexHistoricByBucketByYear: { ...byBucket, [bucketId]: byYear } };
    }),
  setCapexHelperPpeBucketYear: (bucketId, year, value) =>
    set((s) => {
      const byBucket = s.capexHelperPpeByBucketByYear ?? {};
      const byYear = { ...(byBucket[bucketId] ?? {}), [year]: value };
      return { capexHelperPpeByBucketByYear: { ...byBucket, [bucketId]: byYear } };
    }),
  setCapexIncludeInAllocation: (bucketId, include) =>
    set((s) => ({
      capexIncludeInAllocationByBucket: { ...(s.capexIncludeInAllocationByBucket ?? {}), [bucketId]: include },
    })),
  resetCapexHelperUsefulLivesToDefaults: () =>
    set((s) => ({
      ppeUsefulLifeByBucket: { ...(s.ppeUsefulLifeByBucket ?? {}), ...CAPEX_IB_DEFAULT_USEFUL_LIVES },
    })),
  applyCapexHelperWeightsToForecast: (weightsPct) =>
    set(() => ({ capexBucketAllocationPct: { ...weightsPct } })),
  setCapexModelIntangibles: (on) => set(() => ({ capexModelIntangibles: on })),
  setIntangiblesForecastMethod: (method) => set(() => ({ intangiblesForecastMethod: method })),
  setIntangiblesAmortizationLifeYears: (years) => set(() => ({ intangiblesAmortizationLifeYears: Math.max(0.5, years) })),
  setIntangiblesPctRevenue: (pct) => set(() => ({ intangiblesPctRevenue: Math.max(0, pct) })),
  setIntangiblesManualByYear: (year, value) =>
    set((s) => ({
      intangiblesManualByYear: { ...(s.intangiblesManualByYear ?? {}), [year]: value },
    })),
  setIntangiblesPctOfCapex: (pct) => set(() => ({ intangiblesPctOfCapex: Math.max(0, pct) })),
  setIntangiblesHasHistoricalAmortization: (on) => set(() => ({ intangiblesHasHistoricalAmortization: on })),
  setIntangiblesHistoricalAmortizationForYear: (year, value) =>
    set((s) => ({
      intangiblesHistoricalAmortizationByYear: { ...(s.intangiblesHistoricalAmortizationByYear ?? {}), [year]: value },
    })),
  setBsBuildPreviewOverrides: (overrides) => set(() => ({ bsBuildPreviewOverrides: overrides })),

  // IS Build breakdowns live ONLY in config; they are NOT added to the incomeStatement tree.
  // Historicals structure (e.g. Revenue → Subscription, Services) is unchanged. For projection
  // years, each stream's value = sum of its IS Build breakdown projections (see projection engine).
  addRevenueBreakdown: (parentId, label) => {
    const trimmed = (label ?? "").trim();
    if (!trimmed) return "";
    const id = `rev_break_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    set((state) => {
      const config = state.revenueProjectionConfig ?? DEFAULT_REVENUE_PROJECTION_CONFIG;
      const breakdowns = config.breakdowns ?? {};
      return {
        revenueProjectionConfig: {
          ...config,
          breakdowns: {
            ...breakdowns,
            [parentId]: [...(breakdowns[parentId] || []), { id, label: trimmed }],
          },
        },
      };
    });
    return id;
  },

  removeRevenueBreakdown: (parentId, itemId) => {
    set((state) => {
      const config = state.revenueProjectionConfig ?? DEFAULT_REVENUE_PROJECTION_CONFIG;
      const breakdowns = { ...(config.breakdowns ?? {}) };
      const list = (breakdowns[parentId] || []).filter((b) => b.id !== itemId);
      if (list.length === 0) delete breakdowns[parentId];
      else breakdowns[parentId] = list;
      const items = { ...(config.items ?? {}) };
      delete items[itemId];
      const allocations = { ...(config.allocations ?? {}) };
      if (allocations[parentId]) {
        const alloc = { ...allocations[parentId] };
        const newAllocValues = { ...alloc.allocations };
        delete newAllocValues[itemId];
        if (Object.keys(newAllocValues).length === 0) {
          delete allocations[parentId];
        } else {
          allocations[parentId] = { ...alloc, allocations: newAllocValues };
        }
      }
      const projectionAllocations = { ...(config.projectionAllocations ?? {}) };
      if (projectionAllocations[parentId]) {
        const next = { ...projectionAllocations[parentId].percentages };
        delete next[itemId];
        if (Object.keys(next).length === 0) delete projectionAllocations[parentId];
        else projectionAllocations[parentId] = { percentages: next };
      }
      return {
        revenueProjectionConfig: { ...config, breakdowns, items, allocations, projectionAllocations },
      };
    });
  },

  renameRevenueBreakdown: (parentId, itemId, label) => {
    const trimmed = (label ?? "").trim();
    if (!trimmed) return;
    set((state) => {
      const config = state.revenueProjectionConfig ?? DEFAULT_REVENUE_PROJECTION_CONFIG;
      const breakdowns = { ...(config.breakdowns ?? {}) };
      const list = (breakdowns[parentId] || []).map((b) => (b.id === itemId ? { ...b, label: trimmed } : b));
      breakdowns[parentId] = list;
      const incomeStatement = state.incomeStatement.map((r) => {
        if (r.id === itemId) return { ...r, label: trimmed };
        if (r.children?.length) {
          return { ...r, children: r.children.map((c) => (c.id === itemId ? { ...c, label: trimmed } : c)) };
        }
        return r;
      });
      return {
        incomeStatement,
        revenueProjectionConfig: { ...config, breakdowns },
      };
    });
  },

  setBreakdownAllocation: (parentId, mode, allocations, year) => {
    set((state) => {
      const config = state.revenueProjectionConfig ?? DEFAULT_REVENUE_PROJECTION_CONFIG;
      return {
        revenueProjectionConfig: {
          ...config,
          allocations: {
            ...(config.allocations ?? {}),
            [parentId]: { mode, allocations, year },
          },
        },
      };
    });
  },

  setProjectionAllocation: (parentId, percentages) => {
    set((state) => {
      const config = state.revenueProjectionConfig ?? DEFAULT_REVENUE_PROJECTION_CONFIG;
      return {
        revenueProjectionConfig: {
          ...config,
          projectionAllocations: {
            ...(config.projectionAllocations ?? {}),
            [parentId]: { percentages },
          },
        },
      };
    });
  },
    }),
    {
      name: "financial-model-storage",
      ...(persistStorage ? { storage: persistStorage } : {}),
      // Persist all state; always write current project into projectStates so no progress is lost
      partialize: (state) => {
        const { _hasHydrated, ...stateToPersist } = state;
        let projectStates = stateToPersist.projectStates;
        if (state.currentProjectId && state.isInitialized) {
          projectStates = {
            ...stateToPersist.projectStates,
            [state.currentProjectId]: getProjectSnapshot(state),
          };
        }
        return { ...stateToPersist, projectStates };
      },
      onRehydrateStorage: () => (state) => {
        // Migration: existing users with no projects — create one project from current state
        if (
          state &&
          state.isInitialized &&
          (state.currentProjectId == null || !state.projects || state.projects.length === 0)
        ) {
          const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const snapshot = getProjectSnapshot(state);
          // Update state immediately so migration can use it
          state.currentProjectId = id;
          state.projects = [
            {
              id,
              name: state.meta?.companyName?.trim() || "Untitled",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ];
          state.projectStates = { [id]: snapshot };
          // Also update the store so it persists
          useModelStore.setState({
            currentProjectId: id,
            projects: state.projects,
            projectStates: state.projectStates,
          });
        }

        // When data is loaded from localStorage, recalculate all values
        if (state && state.isInitialized) {
          const allYears = [
            ...(state.meta.years.historical || []),
            ...(state.meta.years.projection || []),
          ];

          let incomeStatement = [...state.incomeStatement];
          let balanceSheet = [...state.balanceSheet];
          let cashFlow = [...state.cashFlow];
          
          // Helper function to find section boundaries in cashFlow for order-preserving migrations
          const findSectionBoundaries = () => {
            const operatingCfIndex = cashFlow.findIndex((r) => r.id === "operating_cf");
            const investingCfIndex = cashFlow.findIndex((r) => r.id === "investing_cf");
            const financingCfIndex = cashFlow.findIndex((r) => r.id === "financing_cf");
            return {
              operatingEnd: operatingCfIndex >= 0 ? operatingCfIndex : cashFlow.length,
              investingStart: operatingCfIndex >= 0 ? operatingCfIndex + 1 : cashFlow.length,
              investingEnd: investingCfIndex >= 0 ? investingCfIndex : cashFlow.length,
              financingStart: investingCfIndex >= 0 ? investingCfIndex + 1 : cashFlow.length,
              financingEnd: financingCfIndex >= 0 ? financingCfIndex : cashFlow.length,
            };
          };

          // Migration: Ensure gross_margin exists (added in later version)
          const hasGrossMargin = incomeStatement.some((r) => r.id === "gross_margin");
          if (!hasGrossMargin) {
            const grossProfitIndex = incomeStatement.findIndex((r) => r.id === "gross_profit");
            if (grossProfitIndex >= 0) {
              // Insert gross_margin right after gross_profit
              incomeStatement.splice(grossProfitIndex + 1, 0, {
                id: "gross_margin",
                label: "Gross Margin %",
                kind: "calc",
                valueType: "percent",
                values: {},
                children: [],
              });
            }
          }

          // Migration: Ensure EBITDA exists (should be in template, but check anyway)
          const hasEbitda = incomeStatement.some((r) => r.id === "ebitda");
          if (!hasEbitda) {
            // Find where to insert EBITDA - after Other Operating Expenses
            const otherOpexIndex = incomeStatement.findIndex((r) => r.id === "other_opex");
            const rdIndex = incomeStatement.findIndex((r) => r.id === "rd");
            const insertIndex = otherOpexIndex >= 0 ? otherOpexIndex + 1 : 
                               rdIndex >= 0 ? rdIndex + 1 : 
                               incomeStatement.length;
            // Insert EBITDA
            incomeStatement.splice(insertIndex, 0, {
              id: "ebitda",
              label: "EBITDA",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure EBITDA margin exists (added in later version)
          const hasEbitdaMargin = incomeStatement.some((r) => r.id === "ebitda_margin");
          if (!hasEbitdaMargin) {
            const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
            if (ebitdaIndex >= 0) {
              // Insert EBITDA margin right after EBITDA
              incomeStatement.splice(ebitdaIndex + 1, 0, {
                id: "ebitda_margin",
                label: "EBITDA Margin %",
                kind: "calc",
                valueType: "percent",
                values: {},
                children: [],
              });
            }
          }

          // Migration: Remove EBITDA and EBITDA Margin from IS (D&A is shown directly, then EBIT)
          const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
          if (ebitdaIndex >= 0) {
            incomeStatement.splice(ebitdaIndex, 1);
          }
          const ebitdaMarginIndex = incomeStatement.findIndex((r) => r.id === "ebitda_margin");
          if (ebitdaMarginIndex >= 0) {
            incomeStatement.splice(ebitdaMarginIndex, 1);
          }

          // Normalize: guarantee operating_expenses exists at top level with sga/rd/other_opex/danda as children
          incomeStatement = normalizeIncomeStatementOperatingExpenses(incomeStatement);

          // Migration: Ensure D&A exists (should be in template, but check anyway)
          const hasDana = incomeStatement.some((r) => r.id === "danda");
          if (!hasDana) {
            // Find where to insert D&A - after Other Opex (or after SG&A if no Other Opex)
            const otherOpexIndex = incomeStatement.findIndex((r) => r.id === "other_opex");
            const rdIndex = incomeStatement.findIndex((r) => r.id === "rd");
            const insertIndex = otherOpexIndex >= 0 ? otherOpexIndex + 1 : 
                               rdIndex >= 0 ? rdIndex + 1 : 
                               incomeStatement.length;
            // Insert D&A
            incomeStatement.splice(insertIndex, 0, {
              id: "danda",
              label: "Depreciation & Amortization (D&A)",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure EBIT exists and is in the correct position (after Operating Expenses or SG&A)
          const hasEbit = incomeStatement.some((r) => r.id === "ebit");
          const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
          const opExIndexMig = incomeStatement.findIndex((r) => r.id === "operating_expenses");
          const sgaIndexMig = incomeStatement.findIndex((r) => r.id === "sga");
          const insertAfterIndexMig = opExIndexMig >= 0 ? opExIndexMig : sgaIndexMig;
          if (!hasEbit) {
            // Insert EBIT after Operating Expenses (or SG&A in legacy)
            const insertIndex = insertAfterIndexMig >= 0 ? insertAfterIndexMig + 1 : incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "ebit",
              label: "EBIT (Operating Income)",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          } else if (ebitIndex >= 0 && insertAfterIndexMig >= 0) {
            // EBIT exists - check if it needs to be moved
            if (ebitIndex < insertAfterIndexMig) {
              // EBIT exists but is before Operating Expenses / SG&A - move it after
              const ebitRow = incomeStatement[ebitIndex];
              incomeStatement.splice(ebitIndex, 1);
              const newIndex = insertAfterIndexMig; // correct since we removed EBIT
              incomeStatement.splice(newIndex, 0, ebitRow);
            } else if (ebitIndex > insertAfterIndexMig + 3) {
              // EBIT exists but is too far after Operating Expenses / SG&A - move it right after
              const ebitRow = incomeStatement[ebitIndex];
              incomeStatement.splice(ebitIndex, 1);
              const newIndex = insertAfterIndexMig;
              incomeStatement.splice(newIndex + 1, 0, ebitRow);
            }
          }
          
          // Also ensure EBIT margin is right after EBIT
          const hasEbitMargin = incomeStatement.some((r) => r.id === "ebit_margin");
          const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
          const currentEbitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
          
          if (!hasEbitMargin && currentEbitIndex >= 0) {
            incomeStatement.splice(currentEbitIndex + 1, 0, {
              id: "ebit_margin",
              label: "EBIT Margin %",
              kind: "calc",
              valueType: "percent",
              values: {},
              children: [],
            });
          } else if (ebitMarginIndex >= 0 && currentEbitIndex >= 0 && ebitMarginIndex !== currentEbitIndex + 1) {
            // EBIT margin exists but is not right after EBIT - move it
            const ebitMarginRow = incomeStatement[ebitMarginIndex];
            incomeStatement.splice(ebitMarginIndex, 1);
            const newIndex = currentEbitIndex;
            incomeStatement.splice(newIndex + 1, 0, ebitMarginRow);
          }

          // Migration: Ensure Interest Expense exists (should be in template, but check anyway)
          const hasInterestExpense = incomeStatement.some((r) => r.id === "interest_expense");
          if (!hasInterestExpense) {
            const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
            const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
            const insertIndex = ebitMarginIndex >= 0 ? ebitMarginIndex + 1 : 
                               ebitIndex >= 0 ? ebitIndex + 1 : 
                               incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "interest_expense",
              label: "Interest Expense",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Interest Income exists (should be in template, but check anyway)
          const hasInterestIncome = incomeStatement.some((r) => r.id === "interest_income");
          if (!hasInterestIncome) {
            const interestExpenseIndex = incomeStatement.findIndex((r) => r.id === "interest_expense");
            const insertIndex = interestExpenseIndex >= 0 ? interestExpenseIndex + 1 : incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "interest_income",
              label: "Interest Income",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Other Income exists (added in later version)
          const hasOtherIncome = incomeStatement.some((r) => r.id === "other_income");
          if (!hasOtherIncome) {
            const interestIncomeIndex = incomeStatement.findIndex((r) => r.id === "interest_income");
            const insertIndex = interestIncomeIndex >= 0 ? interestIncomeIndex + 1 : incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "other_income",
              label: "Other Income / (Expense)",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure EBT exists (should be in template, but check anyway)
          const hasEbt = incomeStatement.some((r) => r.id === "ebt");
          if (!hasEbt) {
            const otherIncomeIndex = incomeStatement.findIndex((r) => r.id === "other_income");
            const insertIndex = otherIncomeIndex >= 0 ? otherIncomeIndex + 1 : incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "ebt",
              label: "EBT (Earnings Before Tax)",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Tax exists (should be in template, but check anyway)
          const hasTax = incomeStatement.some((r) => r.id === "tax");
          if (!hasTax) {
            const ebtIndex = incomeStatement.findIndex((r) => r.id === "ebt");
            const insertIndex = ebtIndex >= 0 ? ebtIndex + 1 : incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "tax",
              label: "Income Tax Expense",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Net Income exists (should be in template, but check anyway)
          const hasNetIncome = incomeStatement.some((r) => r.id === "net_income");
          if (!hasNetIncome) {
            const taxIndex = incomeStatement.findIndex((r) => r.id === "tax");
            const insertIndex = taxIndex >= 0 ? taxIndex + 1 : incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "net_income",
              label: "Net Income",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Net Income Margin exists (added in later version)
          const hasNetIncomeMargin = incomeStatement.some((r) => r.id === "net_income_margin");
          if (!hasNetIncomeMargin) {
            const netIncomeIndex = incomeStatement.findIndex((r) => r.id === "net_income");
            if (netIncomeIndex >= 0) {
              // Insert Net Income Margin right after Net Income
              incomeStatement.splice(netIncomeIndex + 1, 0, {
                id: "net_income_margin",
                label: "Net Income Margin %",
                kind: "calc",
                valueType: "percent",
                values: {},
                children: [],
              });
            }
          }

          // Migration: Update "Other Income / (Expense)" label to "Other Income / (Expense), net"
          const otherIncomeRow = incomeStatement.find((r) => r.id === "other_income");
          if (otherIncomeRow && otherIncomeRow.label === "Other Income / (Expense)") {
            otherIncomeRow.label = "Other Income / (Expense), net";
          }

          // Helper function to find section boundaries in cashFlow for order-preserving migrations
          const findSectionBoundariesRehydrate = () => {
            const operatingCfIndex = cashFlow.findIndex((r) => r.id === "operating_cf");
            const investingCfIndex = cashFlow.findIndex((r) => r.id === "investing_cf");
            const financingCfIndex = cashFlow.findIndex((r) => r.id === "financing_cf");
            return {
              operatingEnd: operatingCfIndex >= 0 ? operatingCfIndex : cashFlow.length,
              investingStart: operatingCfIndex >= 0 ? operatingCfIndex + 1 : cashFlow.length,
              investingEnd: investingCfIndex >= 0 ? investingCfIndex : cashFlow.length,
              financingStart: investingCfIndex >= 0 ? investingCfIndex + 1 : cashFlow.length,
              financingEnd: financingCfIndex >= 0 ? financingCfIndex : cashFlow.length,
            };
          };
          
          const boundaries = findSectionBoundariesRehydrate();
          
          // Migration: Ensure D&A exists in CFS (should be in template, but check anyway)
          const hasDandaInCFS = cashFlow.some((r) => r.id === "danda");
          if (!hasDandaInCFS) {
            // Insert at end of operating section (before operating_cf total) to preserve user order
            cashFlow.splice(boundaries.operatingEnd, 0, {
              id: "danda",
              label: "Depreciation & Amortization",
              kind: "input", // Manual input in CFO
              valueType: "currency",
              values: {},
              children: [],
            });
            // Update boundaries after insertion
            boundaries.operatingEnd++;
            boundaries.investingStart++;
            boundaries.investingEnd++;
            boundaries.financingStart++;
            boundaries.financingEnd++;
          } else {
            // Migration: Update D&A from "calc" to "input" (D&A is now manual input, not auto-populated)
            const dandaRow = cashFlow.find((r) => r.id === "danda");
            if (dandaRow && dandaRow.kind === "calc") {
              dandaRow.kind = "input";
            }
          }

          // Migration: Ensure SBC exists in CFS (added in later version)
          const hasSbcInCFS = cashFlow.some((r) => r.id === "sbc");
          if (!hasSbcInCFS) {
            // Insert at end of operating section (before operating_cf total) to preserve user order
            cashFlow.splice(boundaries.operatingEnd, 0, {
              id: "sbc",
              label: "Stock-Based Compensation",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
            // Update boundaries after insertion
            boundaries.operatingEnd++;
            boundaries.investingStart++;
            boundaries.investingEnd++;
            boundaries.financingStart++;
            boundaries.financingEnd++;
          }

          // Migration: Ensure WC Change exists in CFS (should be in template, but check anyway)
          const hasWcChangeInCFS = cashFlow.some((r) => r.id === "wc_change");
          if (!hasWcChangeInCFS) {
            // Insert at end of operating section (before operating_cf total) to preserve user order
            cashFlow.splice(boundaries.operatingEnd, 0, {
              id: "wc_change",
              label: "Change in Working Capital",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
            // Update boundaries after insertion
            boundaries.operatingEnd++;
            boundaries.investingStart++;
            boundaries.investingEnd++;
            boundaries.financingStart++;
            boundaries.financingEnd++;
          }

          // Migration: Ensure Operating CF total exists
          const hasOperatingCf = cashFlow.some((r) => r.id === "operating_cf");
          if (!hasOperatingCf) {
            // Insert at end of operating section
            cashFlow.splice(boundaries.operatingEnd, 0, {
              id: "operating_cf",
              label: "Cash from Operating Activities",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
            // Update boundaries after insertion
            boundaries.operatingEnd++;
            boundaries.investingStart++;
            boundaries.investingEnd++;
            boundaries.financingStart++;
            boundaries.financingEnd++;
          }

          // Migration: Ensure Investing section items exist (capex, investing_cf)
          const hasCapex = cashFlow.some((r) => r.id === "capex");
          if (!hasCapex) {
            // Insert at end of investing section (before investing_cf total) to preserve user order
            cashFlow.splice(boundaries.investingEnd, 0, {
              id: "capex",
              label: "Capital Expenditures (CapEx)",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
            // Update boundaries after insertion
            boundaries.investingEnd++;
            boundaries.financingStart++;
            boundaries.financingEnd++;
          }

          const hasInvestingCf = cashFlow.some((r) => r.id === "investing_cf");
          if (!hasInvestingCf) {
            // Insert at end of investing section
            cashFlow.splice(boundaries.investingEnd, 0, {
              id: "investing_cf",
              label: "Cash from Investing Activities",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
            // Update boundaries after insertion
            boundaries.investingEnd++;
            boundaries.financingStart++;
            boundaries.financingEnd++;
          }

          // Migration: Ensure Financing CF total exists (no default items - user chooses from suggestions)
          const hasFinancingCf = cashFlow.some((r) => r.id === "financing_cf");
          if (!hasFinancingCf) {
            // Insert at end of financing section
            cashFlow.splice(boundaries.financingEnd, 0, {
              id: "financing_cf",
              label: "Cash from Financing Activities",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
            boundaries.financingEnd++;
          }

          // Migration: Ensure net_change_cash exists
          const hasNetChangeCash = cashFlow.some((r) => r.id === "net_change_cash");
          if (!hasNetChangeCash) {
            // Insert at the very end (after financing_cf)
            cashFlow.push({
              id: "net_change_cash",
              label: "Net Change in Cash",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Normalize CFI/CFF: ensure all fixed anchor rows exist in order (idempotent; preserves existing rows and values)
          ensureCFSAnchorRowsInPlace(cashFlow);
          // Backfill forecast-driver and historical nature for fixed anchors (missing on old persisted models)
          for (let i = 0; i < cashFlow.length; i++) {
            let row = applyAnchorForecastDriver(cashFlow[i]) as Row;
            row = applyAnchorHistoricalNature(row) as Row;
            cashFlow[i] = row;
          }

          // Normalize: move top-level WC-classified rows into wc_change.children (single architecture for historical WC)
          cashFlow = normalizeWcStructure(cashFlow);

          // Recalculate all years for all statements. Preserve historical values for rows with IS Build breakdowns (rev/cogs/sga parents and SG&A children like R&D that have sub-items).
          const sgaChildren = findRowDeep(state.incomeStatement, "sga")?.children ?? [];
          const sgaParentIdsWithBreakdowns = collectParentIdsWithChildren(sgaChildren);
          const revBreakdownIds = new Set(Object.keys(state.revenueProjectionConfig?.breakdowns ?? {}));
          const parentIdsWithProjectionBreakdowns = new Set([...revBreakdownIds, ...sgaParentIdsWithBreakdowns]);

          allYears.forEach((year) => {
            const allStatements = { incomeStatement, balanceSheet, cashFlow };
            const sbcBreakdowns = state.sbcBreakdowns;
            const danaBreakdowns = state.danaBreakdowns || {};
            incomeStatement = recomputeCalculations(incomeStatement, year, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns, parentIdsWithProjectionBreakdowns, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
            balanceSheet = recomputeCalculations(balanceSheet, year, balanceSheet, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
            cashFlow = recomputeCalculations(cashFlow, year, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, undefined, state.embeddedDisclosures ?? [], state.sbcDisclosureEnabled ?? true);
          });

          // Temporary: verify top-level IS after rehydration normalization
          console.log("TOP-LEVEL IS IDS AFTER NORMALIZATION (rehydrate):\n" + incomeStatement.map((r) => r.id).join("\n"));
          const opExRehydrate = incomeStatement.find((r) => r.id === "operating_expenses");
          if (opExRehydrate?.children?.length) {
            console.log("operating_expenses children:\n" + opExRehydrate.children.map((c) => c.id).join("\n"));
          }

          // Apply migrated state to store so normalized IS is used
          useModelStore.setState({
            incomeStatement,
            balanceSheet,
            cashFlow,
          });
        }
        return state;
      },
    }
  )
);