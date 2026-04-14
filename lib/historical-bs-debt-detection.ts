/**
 * Aggregate funded debt balances from the historical Balance Sheet for the debt schedule opening layer.
 * Uses row metadata (normalizedDebtCategory, bsFundedDebtLine), core st_debt/lt_debt ids, and taxonomy fallback.
 */

import type { Row } from "@/types/finance";
import { isCoreBsRow } from "@/lib/bs-core-rows";
import { getBSCategoryForRow } from "@/lib/bs-category-mapper";
import {
  coreBsRowFundedDebtBucket,
  inferBalanceSheetDebtMetadata,
  type BsDebtBucket,
} from "@/lib/bs-debt-metadata";
import { getBsTaxonomy } from "@/lib/row-taxonomy";

function explicitCell(row: Row | null, year: string): number | null {
  if (!row?.values || !Object.prototype.hasOwnProperty.call(row.values, year)) return null;
  const v = row.values[year];
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

/** Top-level index is used for placement (same as flat custom rows under that section). */
function forEachBsInputRow(balanceSheet: Row[], visit: (row: Row, topLevelIndex: number) => void): void {
  for (let i = 0; i < balanceSheet.length; i++) {
    const walk = (r: Row) => {
      if (r.kind === "input") visit(r, i);
      r.children?.forEach(walk);
    };
    walk(balanceSheet[i]!);
  }
}

export type HistoricalDebtLineBreakdown = {
  rowId: string;
  label: string;
  bucket: BsDebtBucket;
  amount: number | null;
};

export type HistoricalBalanceSheetDebtDetection = {
  status: "detected" | "none" | "needs_review" | "incomplete";
  historicalYearUsed: string | null;
  currentFundedDebt: number | null;
  longTermFundedDebt: number | null;
  totalFundedDebt: number | null;
  lineBreakdown: HistoricalDebtLineBreakdown[];
  messages: string[];
};

function rowFundedBucket(row: Row, balanceSheet: Row[], index: number): BsDebtBucket | null {
  const core = coreBsRowFundedDebtBucket(row.id);
  if (core) return core;

  if (row.bsFundedDebtLine === true && row.bsDebtClassificationAmbiguous === true) return null;

  const placement = getBSCategoryForRow(row.id, balanceSheet, index);

  if (row.bsFundedDebtLine === true && row.normalizedDebtCategory && row.normalizedDebtCategory !== "not_debt") {
    if (
      row.normalizedDebtCategory === "lease_liability_current" ||
      row.normalizedDebtCategory === "lease_liability_noncurrent"
    ) {
      return null;
    }
    if (row.normalizedDebtCategory === "debt_long_term") return "long_term_funded";
    if (
      row.normalizedDebtCategory === "debt_short_term" ||
      row.normalizedDebtCategory === "debt_current_portion_ltd"
    ) {
      return "current_funded";
    }
    if (
      row.normalizedDebtCategory === "revolver" ||
      row.normalizedDebtCategory === "notes_payable" ||
      row.normalizedDebtCategory === "debt_other"
    ) {
      return placement === "non_current_liabilities" ? "long_term_funded" : "current_funded";
    }
  }

  const taxTrusted = getBsTaxonomy(row);
  if (
    row.taxonomyStatus === "trusted" &&
    row.bsFundedDebtLine === true &&
    row.bsDebtClassificationAmbiguous !== true &&
    (taxTrusted.type === "liab_short_term_debt" || taxTrusted.type === "liab_long_term_debt")
  ) {
    const inf = inferBalanceSheetDebtMetadata(row.label, placement);
    if (inf.fundedModelDebt && !inf.isAmbiguous) {
      return taxTrusted.type === "liab_short_term_debt" ? "current_funded" : "long_term_funded";
    }
  }

  const inferred = inferBalanceSheetDebtMetadata(row.label, placement);
  if (!inferred.fundedModelDebt || inferred.fundedBucket == null) return null;
  if (inferred.isAmbiguous) return null;

  const taxInf = getBsTaxonomy(row);
  if (taxInf.type === "liab_short_term_debt") return "current_funded";
  if (taxInf.type === "liab_long_term_debt") return "long_term_funded";

  return inferred.fundedBucket;
}

/**
 * Build funded debt totals for the last historical year from BS rows.
 */
export function detectHistoricalBalanceSheetFundedDebt(
  balanceSheet: Row[],
  lastHistoricYear: string | null
): HistoricalBalanceSheetDebtDetection {
  const messages: string[] = [];
  if (!lastHistoricYear) {
    return {
      status: "none",
      historicalYearUsed: null,
      currentFundedDebt: null,
      longTermFundedDebt: null,
      totalFundedDebt: null,
      lineBreakdown: [],
      messages: ["Add historical years to detect opening debt."],
    };
  }

  const lineBreakdown: HistoricalDebtLineBreakdown[] = [];
  const currentLineIds: string[] = [];
  const longLineIds: string[] = [];
  let needsReview = false;

  forEachBsInputRow(balanceSheet, (row, i) => {
    if (!isCoreBsRow(row.id) && row.bsDebtClassificationAmbiguous) {
      const placement = getBSCategoryForRow(row.id, balanceSheet, i);
      if (placement === "current_liabilities" || placement === "non_current_liabilities") {
        const inf = inferBalanceSheetDebtMetadata(row.label, placement);
        if (inf.fundedModelDebt && inf.isAmbiguous) needsReview = true;
      }
    }
  });

  forEachBsInputRow(balanceSheet, (row, i) => {
    const bucket = rowFundedBucket(row, balanceSheet, i);
    if (bucket == null) return;
    const v = explicitCell(row, lastHistoricYear);
    lineBreakdown.push({ rowId: row.id, label: row.label, bucket, amount: v });
    if (bucket === "current_funded") currentLineIds.push(row.id);
    else longLineIds.push(row.id);
  });

  if (lineBreakdown.length === 0) {
    return {
      status: needsReview ? "needs_review" : "none",
      historicalYearUsed: lastHistoricYear,
      currentFundedDebt: null,
      longTermFundedDebt: null,
      totalFundedDebt: null,
      lineBreakdown: [],
      messages: needsReview
        ? ["Potential debt lines need review in Historicals before using as opening debt."]
        : ["No funded debt lines detected on the Balance Sheet."],
    };
  }

  let currentSum = 0;
  let longSum = 0;
  let currentOk = currentLineIds.length > 0;
  let longOk = longLineIds.length > 0;

  for (const line of lineBreakdown) {
    if (line.amount == null) {
      if (line.bucket === "current_funded") currentOk = false;
      else longOk = false;
      continue;
    }
    if (line.bucket === "current_funded") currentSum += line.amount;
    else longSum += line.amount;
  }

  if (currentLineIds.length === 0) {
    currentOk = true;
    currentSum = 0;
  }
  if (longLineIds.length === 0) {
    longOk = true;
    longSum = 0;
  }

  if (!currentOk || !longOk) {
    messages.push("One or more detected debt lines are missing an explicit balance for the last historical year.");
    return {
      status: "incomplete",
      historicalYearUsed: lastHistoricYear,
      currentFundedDebt: null,
      longTermFundedDebt: null,
      totalFundedDebt: null,
      lineBreakdown,
      messages,
    };
  }

  if (needsReview) {
    messages.push("Some lines are marked ambiguous — verify funded debt classifications in Historicals.");
  }

  const total = currentSum + longSum;
  return {
    status: needsReview ? "needs_review" : "detected",
    historicalYearUsed: lastHistoricYear,
    currentFundedDebt: currentSum,
    longTermFundedDebt: longSum,
    totalFundedDebt: total,
    lineBreakdown,
    messages,
  };
}

export type FundedDebtMember = { row: Row; bucket: BsDebtBucket };

/**
 * Collect funded-debt rows once, then sum per year (for debt schedule + interest).
 */
export function collectFundedDebtMembers(balanceSheet: Row[]): FundedDebtMember[] {
  const members: FundedDebtMember[] = [];
  forEachBsInputRow(balanceSheet, (row, i) => {
    const b = rowFundedBucket(row, balanceSheet, i);
    if (b) members.push({ row, bucket: b });
  });
  return members;
}

/**
 * Per-year totals of current funded, long-term funded, and combined. ok=false if any required line lacks a value for a year.
 */
export function detectFundedDebtTotalsByYear(
  balanceSheet: Row[],
  years: string[]
): {
  byYearTotal: Record<string, number>;
  byYearCurrent: Record<string, number>;
  byYearLongTerm: Record<string, number>;
  ok: boolean;
  members: FundedDebtMember[];
} {
  const members = collectFundedDebtMembers(balanceSheet);
  const byYearTotal: Record<string, number> = {};
  const byYearCurrent: Record<string, number> = {};
  const byYearLongTerm: Record<string, number> = {};
  const hasCurrent = members.some((m) => m.bucket === "current_funded");
  const hasLong = members.some((m) => m.bucket === "long_term_funded");
  let ok = true;

  for (const y of years) {
    let c = 0;
    let l = 0;
    let cOk = hasCurrent;
    let lOk = hasLong;
    for (const m of members) {
      const v = explicitCell(m.row, y);
      if (v == null) {
        if (m.bucket === "current_funded") cOk = false;
        else lOk = false;
      } else if (m.bucket === "current_funded") {
        c += v;
      } else {
        l += v;
      }
    }
    if (!hasCurrent) {
      cOk = true;
      c = 0;
    }
    if (!hasLong) {
      lOk = true;
      l = 0;
    }
    if (!cOk || !lOk) {
      ok = false;
      break;
    }
    byYearCurrent[y] = c;
    byYearLongTerm[y] = l;
    byYearTotal[y] = c + l;
  }

  return { byYearTotal, byYearCurrent, byYearLongTerm, ok, members };
}
