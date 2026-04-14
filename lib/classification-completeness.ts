/**
 * Classification completeness layer for Historicals.
 * Ensures every row in IS, BS, and CFS has a known classification state:
 * deterministic (template), ai_classified, user_classified, or unresolved (needs review).
 * No forecasting logic — metadata only.
 */

import type { Row } from "@/types/finance";
import { TEMPLATE_IS_ROW_IDS } from "./is-classification";
import { isCoreBsRow, getCoreLockedBehavior } from "./bs-core-rows";
import { getFallbackIsClassification } from "./is-fallback-classify";
import {
  CFS_ANCHOR_HISTORICAL_NATURE,
  getHistoricalNatureForAnchor,
  getForecastDriverForAnchor,
} from "./cfs-forecast-drivers";
import { getFinalRowClassificationState, type PlacementContext } from "./final-row-classification";

export type ClassificationState =
  | "deterministic"
  | "ai_classified"
  | "user_classified"
  | "unresolved";

export type ClassificationIssueKind =
  | "missing_classification"
  | "low_confidence"
  | "needs_review"
  | "unresolved";

export interface RowClassificationEntry {
  row: Row;
  rowId: string;
  label: string;
  state: ClassificationState;
  issue?: ClassificationIssueKind;
  /** Only when state === "ai_classified": confidence 0–1. */
  confidence?: number;
}

export interface StatementCompletenessReport {
  statement: "income" | "balance" | "cash_flow";
  entries: RowClassificationEntry[];
  unresolved: RowClassificationEntry[];
  needsReview: RowClassificationEntry[];
  issues: { rowId: string; label: string; issue: ClassificationIssueKind }[];
  allClassified: boolean;
}

export interface FullClassificationReport {
  income: StatementCompletenessReport;
  balance: StatementCompletenessReport;
  cashFlow: StatementCompletenessReport;
  hasUnresolved: boolean;
  hasNeedsReview: boolean;
  /** Taxonomy trust status aggregates. */
  taxonomy: {
    hasTaxonomyUnresolved: boolean;
    hasTaxonomyNeedsReview: boolean;
    unresolvedCount: number;
    needsReviewCount: number;
  };
}

// ——— Helpers: is row deterministically classified? ———

function flattenRows(rows: Row[], out: Row[] = []): Row[] {
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) flattenRows(r.children, out);
  }
  return out;
}

function isDeterministicIsRow(row: Row): boolean {
  if (row.isTemplateRow === true) return true;
  return TEMPLATE_IS_ROW_IDS.has(row.id);
}

function isDeterministicBsRow(row: Row): boolean {
  return isCoreBsRow(row.id);
}

const CFS_ANCHOR_ROW_IDS = new Set(Object.keys(CFS_ANCHOR_HISTORICAL_NATURE));

function isDeterministicCfsRow(row: Row): boolean {
  return CFS_ANCHOR_ROW_IDS.has(row.id);
}

// ——— State per row ———

function getIsRowClassificationState(row: Row): ClassificationState {
  if (row.classificationSource === "user") return "user_classified";
  if (row.classificationSource === "ai") return "ai_classified";
  if (row.classificationSource === "fallback") return "ai_classified"; // treat fallback as classified (with needs_review)
  if (row.classificationSource === "unresolved") return "unresolved";
  if (isDeterministicIsRow(row)) return "deterministic";
  const hasSection = row.sectionOwner != null && row.sectionOwner !== undefined;
  const hasOperating = row.isOperating === true || row.isOperating === false;
  if (hasSection && hasOperating) return "ai_classified"; // has metadata, assume classified (could be fallback)
  return "unresolved";
}

function getBsRowClassificationState(row: Row): ClassificationState {
  if (row.classificationSource === "user") return "user_classified";
  if (row.classificationSource === "ai") return "ai_classified";
  if (row.classificationSource === "fallback") return "ai_classified";
  if (row.classificationSource === "unresolved") return "unresolved";
  if (isDeterministicBsRow(row)) return "deterministic";
  const behavior = row.cashFlowBehavior;
  if (behavior != null && behavior !== "unclassified") return "ai_classified";
  return "unresolved";
}

function getCfsRowClassificationState(row: Row): ClassificationState {
  if (row.classificationSource === "user") return "user_classified";
  if (row.classificationSource === "ai") return "ai_classified";
  if (row.classificationSource === "fallback") return "ai_classified";
  if (row.classificationSource === "unresolved") return "unresolved";
  if (isDeterministicCfsRow(row)) return "deterministic";
  const hasSection = row.cfsLink?.section != null;
  const hasNature = row.historicalCfsNature != null;
  if (hasSection && hasNature) return "ai_classified";
  return "unresolved";
}

// ——— Income Statement ———

export function getIsClassificationCompleteness(incomeStatement: Row[]): StatementCompletenessReport {
  const flat = flattenRows(incomeStatement ?? []);
  const entries: RowClassificationEntry[] = [];
  const unresolved: RowClassificationEntry[] = [];
  const needsReview: RowClassificationEntry[] = [];
  const issues: { rowId: string; label: string; issue: ClassificationIssueKind }[] = [];

  for (const row of flat) {
    const state = getIsRowClassificationState(row);
    const confidence = row.classificationConfidence;
    const needsReviewStatus =
      row.forecastMetadataStatus === "needs_review" ||
      state === "unresolved" ||
      (state === "ai_classified" && confidence != null && confidence < 0.7);

    const entry: RowClassificationEntry = {
      row,
      rowId: row.id,
      label: row.label,
      state,
      ...(confidence != null && { confidence }),
      ...(state === "unresolved" && { issue: "unresolved" as const }),
      ...(needsReviewStatus && state !== "unresolved" && { issue: "needs_review" as const }),
      ...(state === "ai_classified" && confidence != null && confidence < 0.7 && { issue: "low_confidence" as const }),
    };
    entries.push(entry);
    if (state === "unresolved") {
      unresolved.push(entry);
      issues.push({ rowId: row.id, label: row.label, issue: "missing_classification" });
    }
    if (needsReviewStatus) needsReview.push(entry);
  }

  return {
    statement: "income",
    entries,
    unresolved,
    needsReview,
    issues,
    allClassified: unresolved.length === 0,
  };
}

// ——— Balance Sheet ———

export function getBsClassificationCompleteness(balanceSheet: Row[]): StatementCompletenessReport {
  const flat = flattenRows(balanceSheet ?? []);
  const entries: RowClassificationEntry[] = [];
  const unresolved: RowClassificationEntry[] = [];
  const needsReview: RowClassificationEntry[] = [];
  const issues: { rowId: string; label: string; issue: ClassificationIssueKind }[] = [];

  for (const row of flat) {
    const state = getBsRowClassificationState(row);
    const needsReviewStatus =
      row.forecastMetadataStatus === "needs_review" || state === "unresolved";

    const entry: RowClassificationEntry = {
      row,
      rowId: row.id,
      label: row.label,
      state,
      ...(state === "unresolved" && { issue: "unresolved" as const }),
      ...(needsReviewStatus && state !== "unresolved" && { issue: "needs_review" as const }),
    };
    entries.push(entry);
    if (state === "unresolved") {
      unresolved.push(entry);
      issues.push({ rowId: row.id, label: row.label, issue: "missing_classification" });
    }
    if (needsReviewStatus) needsReview.push(entry);
  }

  return {
    statement: "balance",
    entries,
    unresolved,
    needsReview,
    issues,
    allClassified: unresolved.length === 0,
  };
}

// ——— Cash Flow Statement ———

export function getCfsClassificationCompleteness(cashFlow: Row[]): StatementCompletenessReport {
  const flat = flattenRows(cashFlow ?? []);
  const entries: RowClassificationEntry[] = [];
  const unresolved: RowClassificationEntry[] = [];
  const needsReview: RowClassificationEntry[] = [];
  const issues: { rowId: string; label: string; issue: ClassificationIssueKind }[] = [];

  for (const row of flat) {
    const state = getCfsRowClassificationState(row);
    const confidence = row.classificationConfidence;
    const needsReviewStatus =
      row.forecastMetadataStatus === "needs_review" ||
      state === "unresolved" ||
      (state === "ai_classified" && confidence != null && confidence < 0.7);

    const entry: RowClassificationEntry = {
      row,
      rowId: row.id,
      label: row.label,
      state,
      ...(confidence != null && { confidence }),
      ...(state === "unresolved" && { issue: "unresolved" as const }),
      ...(needsReviewStatus && state !== "unresolved" && { issue: "needs_review" as const }),
      ...(state === "ai_classified" && confidence != null && confidence < 0.7 && { issue: "low_confidence" as const }),
    };
    entries.push(entry);
    if (state === "unresolved") {
      unresolved.push(entry);
      issues.push({ rowId: row.id, label: row.label, issue: "missing_classification" });
    }
    if (needsReviewStatus) needsReview.push(entry);
  }

  return {
    statement: "cash_flow",
    entries,
    unresolved,
    needsReview,
    issues,
    allClassified: unresolved.length === 0,
  };
}

// ——— Full report ———

function getTaxonomyStatusCounts(rows: Row[]): { unresolved: number; needsReview: number } {
  const flat = flattenRows(rows);
  let unresolved = 0;
  let needsReview = 0;
  for (const r of flat) {
    if (r.taxonomyStatus === "unresolved" || r.taxonomyType == null) {
      unresolved++;
    } else if (r.taxonomyStatus === "needs_review") {
      needsReview++;
    }
  }
  return { unresolved, needsReview };
}

export function getFullClassificationReport(allStatements: {
  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];
}): FullClassificationReport {
  const income = getIsClassificationCompleteness(allStatements.incomeStatement ?? []);
  const balance = getBsClassificationCompleteness(allStatements.balanceSheet ?? []);
  const cashFlow = getCfsClassificationCompleteness(allStatements.cashFlow ?? []);

  const hasUnresolved =
    income.unresolved.length > 0 ||
    balance.unresolved.length > 0 ||
    cashFlow.unresolved.length > 0;
  const hasNeedsReview =
    income.needsReview.length > 0 ||
    balance.needsReview.length > 0 ||
    cashFlow.needsReview.length > 0;

  // Taxonomy trust status
  const isTax = getTaxonomyStatusCounts(allStatements.incomeStatement ?? []);
  const bsTax = getTaxonomyStatusCounts(allStatements.balanceSheet ?? []);
  const cfsTax = getTaxonomyStatusCounts(allStatements.cashFlow ?? []);
  const taxonomyUnresolvedCount = isTax.unresolved + bsTax.unresolved + cfsTax.unresolved;
  const taxonomyNeedsReviewCount = isTax.needsReview + bsTax.needsReview + cfsTax.needsReview;

  return {
    income,
    balance,
    cashFlow,
    hasUnresolved,
    hasNeedsReview,
    taxonomy: {
      hasTaxonomyUnresolved: taxonomyUnresolvedCount > 0,
      hasTaxonomyNeedsReview: taxonomyNeedsReviewCount > 0,
      unresolvedCount: taxonomyUnresolvedCount,
      needsReviewCount: taxonomyNeedsReviewCount,
    },
  };
}

// ——— Canonical row review state (delegate to final classification resolver) ———

export type RowReviewState = "setup_required" | "needs_confirmation" | "trusted";

/**
 * Returns exactly one review state per row. Uses getFinalRowClassificationState as single source of truth.
 */
export function getRowReviewState(
  row: Row,
  statementKey: "income" | "balance" | "cashFlow",
  context?: PlacementContext
): RowReviewState {
  return getFinalRowClassificationState(row, statementKey, context).reviewState;
}

// ——— Review items for Historicals UX (user-facing list of rows requiring review) ———

export type ReviewItem = {
  statementName: string;
  statementKey: "income" | "balance" | "cashFlow";
  rowId: string;
  label: string;
  reviewState: RowReviewState;
  isUnresolved: boolean;
  canConfirm: boolean;
  issueText: string;
  reason: string;
  /** What is being confirmed (e.g. "Investing → Purchase of Marketable Securities"). Shown next to Confirm. */
  suggestedLabel?: string;
};

/**
 * Only rows that are actionable should appear in the review panel.
 * Excludes: deterministic template rows, subtotals, totals, margin rows, placeholder/structural rows.
 */
function isActionableReviewRow(row: Row, statementKey: "income" | "balance" | "cashFlow"): boolean {
  // Exclude subtotal/total rows (structural, not user-edited line items)
  if (row.kind === "subtotal" || row.kind === "total") return false;
  // Exclude margin/percentage rows (calculated display only)
  if (row.id.endsWith("_margin") || (row.label && /margin\s*%?$/i.test(row.label))) return false;
  // Exclude deterministic template/anchor rows the model already understands
  if (statementKey === "income" && isDeterministicIsRow(row)) return false;
  if (statementKey === "balance" && isDeterministicBsRow(row)) return false;
  if (statementKey === "cashFlow" && isDeterministicCfsRow(row)) return false;
  // Exclude explicit template marker
  if (row.isTemplateRow === true) return false;
  // Exclude placeholder/container rows (e.g. other_operating as container, operating_expenses as parent)
  if (row.id === "operating_expenses" || row.id === "other_operating") return false;
  return true;
}

const STATEMENT_DISPLAY_NAMES: Record<"income" | "balance" | "cashFlow", string> = {
  income: "Income Statement",
  balance: "Balance Sheet",
  cashFlow: "Cash Flow Statement",
};

function reasonForSetupRequired(statementKey: "income" | "balance" | "cashFlow", row: Row): string {
  const reasons: string[] = [];
  if (statementKey === "income" && (row.sectionOwner == null || (row.isOperating !== true && row.isOperating !== false)))
    reasons.push("Missing section and operating/non-operating classification");
  if (statementKey === "balance" && (row.cashFlowBehavior == null || row.cashFlowBehavior === "unclassified"))
    reasons.push("Missing cash flow behavior");
  if (statementKey === "cashFlow" && (row.cfsLink?.section == null || row.historicalCfsNature == null))
    reasons.push("Missing section and row type for cash flow");
  if (row.taxonomyType == null || row.taxonomyStatus === "unresolved")
    reasons.push("Missing row type");
  return reasons.length ? reasons.join(". ") : "Missing required metadata";
}

/**
 * Builds review items from the canonical final classification resolver only.
 * Each row appears at most once, in exactly one bucket (Needs setup or Needs confirmation).
 */
export function getReviewItemsForHistoricals(
  _report: FullClassificationReport,
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] }
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const keys: { key: "income" | "balance" | "cashFlow"; rows: Row[]; getContext?: (row: Row, parentId?: string) => PlacementContext }[] = [
    { key: "income", rows: allStatements.incomeStatement ?? [] },
    { key: "balance", rows: allStatements.balanceSheet ?? [] },
    {
      key: "cashFlow",
      rows: allStatements.cashFlow ?? [],
      getContext: (row, parentId) => (parentId ? { parentId, sectionId: parentId === "wc_change" ? "operating" : undefined, subgroupId: parentId === "wc_change" ? "working_capital" : undefined } : { sectionId: row.cfsLink?.section ?? undefined }),
    },
  ];
  for (const { key, rows, getContext } of keys) {
    function withParent(r: Row[], parentId?: string): { row: Row; parentId?: string }[] {
      const out: { row: Row; parentId?: string }[] = [];
      for (const row of r) {
        out.push({ row, parentId });
        if (row.children?.length) out.push(...withParent(row.children, row.id));
      }
      return out;
    }
    const entries = withParent(rows);
    for (const { row, parentId } of entries) {
      const context = getContext?.(row, parentId);
      const final = getFinalRowClassificationState(row, key, context);
      if (final.reviewState === "trusted") continue;
      const isUnresolved = final.reviewState === "setup_required";
      items.push({
        statementName: STATEMENT_DISPLAY_NAMES[key],
        statementKey: key,
        rowId: row.id,
        label: row.label,
        reviewState: final.reviewState,
        isUnresolved,
        canConfirm: final.reviewState === "needs_confirmation",
        issueText: isUnresolved ? "Setup required" : "Suggested classification",
        reason: final.reason ?? (isUnresolved ? reasonForSetupRequired(key, row) : "Suggested classification needs confirmation."),
        suggestedLabel: final.suggestedLabel,
      });
    }
  }
  return items;
}

// ——— Backfill: ensure every row has classification state (used on load / legacy paths) ———
// User overrides (classificationSource === "user") are never overwritten.

function mapRowRecursive<T extends Row>(row: T, fn: (r: T) => T): T {
  const next = fn(row);
  if (next.children?.length) {
    return {
      ...next,
      children: next.children.map((c) => mapRowRecursive(c as T, fn)) as Row[],
    } as T;
  }
  return next;
}

/**
 * Backfill IS: template rows get deterministic metadata; custom rows missing sectionOwner/isOperating
 * get fallback classification + needs_review, or unresolved + needs_review if fallback not applied.
 */
export function backfillIncomeStatementClassification(incomeStatement: Row[]): Row[] {
  return (incomeStatement ?? []).map((row) =>
    mapRowRecursive(row, (r) => {
      if (r.classificationSource === "user") return r;
      if (isDeterministicIsRow(r)) {
        if (r.isTemplateRow === true) return r;
        return { ...r, isTemplateRow: true } as Row;
      }
      const hasSection = r.sectionOwner != null && r.sectionOwner !== undefined;
      const hasOperating = r.isOperating === true || r.isOperating === false;
      if (hasSection && hasOperating) return r;
      const fallback = getFallbackIsClassification(r.label);
      return {
        ...r,
        sectionOwner: fallback.sectionOwner,
        isOperating: fallback.isOperating,
        classificationSource: "fallback" as const,
        forecastMetadataStatus: "needs_review" as const,
      };
    })
  );
}

/**
 * Backfill BS: core rows get locked cashFlowBehavior; non-core missing behavior get unclassified + unresolved.
 */
export function backfillBalanceSheetClassification(balanceSheet: Row[]): Row[] {
  return (balanceSheet ?? []).map((row) =>
    mapRowRecursive(row, (r) => {
      if (r.classificationSource === "user") return r;
      const locked = getCoreLockedBehavior(r.id);
      if (locked) {
        const debtMeta =
          r.id === "st_debt"
            ? { normalizedDebtCategory: "debt_short_term" as const, bsFundedDebtLine: true, bsDebtClassificationAmbiguous: false }
            : r.id === "lt_debt"
              ? { normalizedDebtCategory: "debt_long_term" as const, bsFundedDebtLine: true, bsDebtClassificationAmbiguous: false }
              : {};
        return {
          ...r,
          cashFlowBehavior: locked.cashFlowBehavior,
          ...(locked.scheduleOwner != null && { scheduleOwner: locked.scheduleOwner }),
          ...debtMeta,
        };
      }
      if (r.cashFlowBehavior != null && r.cashFlowBehavior !== "unclassified") return r;
      return {
        ...r,
        cashFlowBehavior: "unclassified" as const,
        classificationSource: (r.classificationSource ?? "unresolved") as "unresolved",
        forecastMetadataStatus: "needs_review" as const,
      };
    })
  );
}

/**
 * Backfill CFS: anchor rows get deterministic historicalCfsNature + cfsForecastDriver + cfsLink.section;
 * custom rows missing section/nature get unresolved + needs_review.
 */
export function backfillCashFlowClassification(cashFlow: Row[]): Row[] {
  const sectionByAnchor: Record<string, "operating" | "investing" | "financing" | "cash_bridge"> = {
    net_income: "operating",
    danda: "operating",
    sbc: "operating",
    wc_change: "operating",
    other_operating: "operating",
    operating_cf: "operating",
    capex: "investing",
    acquisitions: "investing",
    asset_sales: "investing",
    investments: "investing",
    other_investing: "investing",
    investing_cf: "investing",
    debt_issued: "financing",
    debt_repaid: "financing",
    equity_issued: "financing",
    share_repurchases: "financing",
    dividends: "financing",
    other_financing: "financing",
    financing_cf: "financing",
    fx_effect_on_cash: "cash_bridge",
    net_change_cash: "cash_bridge",
  };

  return (cashFlow ?? []).map((row) =>
    mapRowRecursive(row, (r) => {
      if (r.classificationSource === "user") return r;
      const nature = getHistoricalNatureForAnchor(r.id);
      const driver = getForecastDriverForAnchor(r.id);
      const section = sectionByAnchor[r.id];
      if (nature != null || driver != null || section) {
        const updates: Partial<Row> = {};
        if (nature != null && r.historicalCfsNature == null) updates.historicalCfsNature = nature;
        if (driver != null && r.cfsForecastDriver == null) updates.cfsForecastDriver = driver;
        if (section != null && r.cfsLink?.section !== section) {
          updates.cfsLink = {
            ...r.cfsLink,
            section,
            impact: r.cfsLink?.impact ?? "neutral",
            description: r.cfsLink?.description ?? r.label,
            ...(r.cfsLink?.cfsItemId != null && { cfsItemId: r.cfsLink.cfsItemId }),
          } as Row["cfsLink"];
        }
        if (Object.keys(updates).length === 0) return r;
        return { ...r, ...updates };
      }
      const hasSection = r.cfsLink?.section != null;
      const hasNature = r.historicalCfsNature != null;
      if (hasSection && hasNature) return r;
      return {
        ...r,
        classificationSource: (r.classificationSource ?? "unresolved") as "unresolved",
        forecastMetadataStatus: "needs_review" as const,
      };
    })
  );
}

/**
 * Run all backfills. Call after loadProject or when adding rows via legacy paths.
 * Preserves user overrides; fills missing metadata for template/anchor rows and marks custom rows unresolved or fallback.
 */
export function backfillClassificationCompleteness(allStatements: {
  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];
}): {
  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];
} {
  return {
    incomeStatement: backfillIncomeStatementClassification(allStatements.incomeStatement ?? []),
    balanceSheet: backfillBalanceSheetClassification(allStatements.balanceSheet ?? []),
    cashFlow: backfillCashFlowClassification(allStatements.cashFlow ?? []),
  };
}
