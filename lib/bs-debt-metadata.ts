/**
 * Balance sheet debt metadata: deterministic label + placement inference for Historicals
 * and the debt schedule opening-detection layer. Lease liabilities are classified distinctly
 * and excluded from funded debt totals by default.
 */

import type { Row } from "@/types/finance";
import { isCoreBsRow } from "@/lib/bs-core-rows";
import type { BalanceSheetCategory } from "@/lib/bs-impact-rules";
import { findBalanceSheetRowContext, getBSCategoryForRow } from "@/lib/bs-category-mapper";
import { getBsTaxonomy } from "@/lib/row-taxonomy";

export type NormalizedDebtCategory =
  | "debt_short_term"
  | "debt_long_term"
  | "debt_current_portion_ltd"
  | "revolver"
  | "notes_payable"
  | "lease_liability_current"
  | "lease_liability_noncurrent"
  | "debt_other"
  | "not_debt";

export type BsDebtBucket = "current_funded" | "long_term_funded";

export type InferredBsDebtMetadata = {
  normalizedDebtCategory: NormalizedDebtCategory;
  /** Interest-bearing / principal debt used in funded debt schedule (excludes operating lease liabilities). */
  fundedModelDebt: boolean;
  isAmbiguous: boolean;
  confidence: number;
  /** Where to aggregate for debt schedule opening detection. */
  fundedBucket: BsDebtBucket | null;
};

/** High-confidence deterministic matches: financing + trusted, and precedence over AI suggestions. */
const DETERMINISTIC_TRUST_THRESHOLD = 0.88;

const L = (s: string) => s.toLowerCase();

/** Operating / finance lease liability labels (not treated as funded debt for opening detection). */
function isLeaseLiabilityLabel(lower: string): boolean {
  if (/(^|[^a-z])rou\b/.test(lower) && /liab/.test(lower)) return true;
  return (
    /lease\s*liabilit/.test(lower) ||
    /operating\s*lease\s*liabilit/.test(lower) ||
    /finance\s*lease\s*liabilit/.test(lower) ||
    /capital\s*lease\s*obligat/.test(lower) ||
    (/right.of.use/.test(lower) && /liab/.test(lower)) ||
    /non.current\s*lease\s*liabilit/.test(lower) ||
    /current\s*lease\s*liabilit/.test(lower)
  );
}

function fundedBucketFromPlacement(placement: BalanceSheetCategory | null): BsDebtBucket {
  return placement === "non_current_liabilities" ? "long_term_funded" : "current_funded";
}

/** Strong funded-debt patterns (checked before generic “payable”). Order matters. */
function matchFundedDebt(lower: string, placement: BalanceSheetCategory | null): InferredBsDebtMetadata | null {
  // 1) Clear revolver / revolving credit (not bare “credit facility”)
  if (
    /revolv(er|ing)/.test(lower) ||
    /\brevolver\b/.test(lower) ||
    /revolving\s+(credit\s+)?(facility|line)/.test(lower)
  ) {
    return {
      normalizedDebtCategory: "revolver",
      fundedModelDebt: true,
      isAmbiguous: false,
      confidence: 0.93,
      fundedBucket: fundedBucketFromPlacement(placement),
    };
  }

  // 2) Current portion / ST / maturities of LTD (avoid bare “current maturities” → leases)
  const isCpltd =
    /current\s*portion\s*of\s*(long[\s-]term\s*debt|ltd)\b/.test(lower) ||
    /current\s*portion\s*of\s*long[\s-]term/.test(lower) ||
    /\bcpltd\b/.test(lower) ||
    /current\s*maturit(y|ies)\s+of\s*long[\s-]term/.test(lower) ||
    /current\s*maturit(y|ies)\s+of\s+ltd\b/.test(lower) ||
    /current\s*maturit(y|ies)\s+(of\s+)?(long[\s-]term\s*borrow|long[\s-]term\s*debt)/.test(lower);

  const isShortTermClear =
    /short[\s-]term\s*debt/.test(lower) ||
    /\bst\s*debt\b/.test(lower) ||
    /short[\s-]term\s*borrow/.test(lower) ||
    /(?<![a-z-])current\s+debt\b/.test(lower) ||
    /debt\s*due\s*within\s*one\s*year/.test(lower) ||
    /debt\s*obligations?\s*due\s*within/.test(lower) ||
    /current\s*borrow/.test(lower) ||
    /bank\s*line\s*of\s*credit/.test(lower) ||
    /line\s*of\s*credit/.test(lower) ||
    /\bcredit\s+line\b/.test(lower) ||
    /bank\s*overdraft/.test(lower) ||
    ((/(^|[^a-z])cp\b/.test(lower) || /commercial\s*paper/.test(lower)) && /debt|borrow|paper/.test(lower));

  if (isCpltd || isShortTermClear) {
    return {
      normalizedDebtCategory: isCpltd ? "debt_current_portion_ltd" : "debt_short_term",
      fundedModelDebt: true,
      isAmbiguous: false,
      confidence: 0.93,
      fundedBucket: "current_funded",
    };
  }

  // 3) Clear long-term funded (label-first; placement refines “debt obligations”)
  const hasCurrentPortionInLabel = /current\s*portion|due\s*within|short[\s-]term/.test(lower);
  const isLongTermClear =
    /long[\s-]term\s*debt/.test(lower) ||
    /\blt\s*debt\b/.test(lower) ||
    /long[\s-]term\s*borrow/.test(lower) ||
    /\bnon[\s-]?current\s+debt\b/.test(lower) ||
    /bonds?\s*payable/.test(lower) ||
    /senior\s*notes?/.test(lower) ||
    /debentures?/.test(lower) ||
    /\bfunded\s+debt\b/.test(lower) ||
    /\bbank\s+debt\b/.test(lower) ||
    /\bsenior\s+debt\b/.test(lower) ||
    /non[\s-]current\s*borrow/.test(lower) ||
    (/term\s*loan/.test(lower) && !hasCurrentPortionInLabel) ||
    (/\bdebt\s*obligations?\b/.test(lower) &&
      placement === "non_current_liabilities" &&
      !/due\s*within|current\s*portion/.test(lower));

  if (isLongTermClear) {
    return {
      normalizedDebtCategory: "debt_long_term",
      fundedModelDebt: true,
      isAmbiguous: false,
      confidence: 0.92,
      fundedBucket: "long_term_funded",
    };
  }

  // 4) Ambiguous: standalone “credit facility” (revolving handled above)
  if (/\bcredit\s+facility\b/.test(lower)) {
    const bucket = fundedBucketFromPlacement(placement);
    return {
      normalizedDebtCategory: "debt_other",
      fundedModelDebt: true,
      isAmbiguous: true,
      confidence: placement == null ? 0.65 : 0.72,
      fundedBucket: bucket,
    };
  }

  // 5) Notes payable — enrich as debt but keep ambiguous (do not force trusted)
  if (/notes?\s*payable|promissory\s*note/.test(lower)) {
    const bucket = fundedBucketFromPlacement(placement);
    return {
      normalizedDebtCategory: "notes_payable",
      fundedModelDebt: true,
      isAmbiguous: true,
      confidence: placement == null ? 0.72 : 0.8,
      fundedBucket: bucket,
    };
  }

  // 6) Generic borrowings / loans — ambiguous unless already matched as ST/LT
  if (
    /\bborrowings?\b/.test(lower) ||
    /\bborrow\b/.test(lower) ||
    /(^|[^a-z])(loan|loans)\s+payable\b/.test(lower) ||
    (/\bloan\b/.test(lower) && !/allowance/.test(lower))
  ) {
    const bucket = fundedBucketFromPlacement(placement);
    return {
      normalizedDebtCategory: "debt_other",
      fundedModelDebt: true,
      isAmbiguous: true,
      confidence: placement == null ? 0.65 : 0.78,
      fundedBucket: bucket,
    };
  }

  if (/\bfinanc.*debt\b/.test(lower) || /\bcredit\s*agreement\b/.test(lower)) {
    const bucket = fundedBucketFromPlacement(placement);
    return {
      normalizedDebtCategory: "debt_other",
      fundedModelDebt: true,
      isAmbiguous: true,
      confidence: placement == null ? 0.62 : 0.75,
      fundedBucket: bucket,
    };
  }

  return null;
}

function matchLeaseMetadata(lower: string, placement: BalanceSheetCategory | null): InferredBsDebtMetadata | null {
  if (!isLeaseLiabilityLabel(lower)) return null;
  const isCurrent =
    /current\s*lease|lease\s*liabilit.*current|portion.*current/.test(lower) || placement === "current_liabilities";
  return {
    normalizedDebtCategory: isCurrent ? "lease_liability_current" : "lease_liability_noncurrent",
    fundedModelDebt: false,
    isAmbiguous: false,
    confidence: 0.88,
    fundedBucket: null,
  };
}

function resolveBalanceSheetTopLevelIndex(row: Row, balanceSheet: Row[], rowIndex: number): number {
  if (rowIndex >= 0 && balanceSheet[rowIndex]?.id === row.id) return rowIndex;
  const ctx = findBalanceSheetRowContext(balanceSheet, row.id);
  return ctx?.topLevelIndex ?? rowIndex;
}

/**
 * Infer debt metadata from label and BS section placement (current vs non-current liabilities).
 */
export function inferBalanceSheetDebtMetadata(
  label: string,
  placement: BalanceSheetCategory | null
): InferredBsDebtMetadata {
  const lower = L(label);

  const lease = matchLeaseMetadata(lower, placement);
  if (lease) return lease;

  const funded = matchFundedDebt(lower, placement);
  if (funded) return funded;

  // “Debt” word in liability section — ambiguous
  if ((placement === "current_liabilities" || placement === "non_current_liabilities") && /\bdebt\b/.test(lower)) {
    const bucket: BsDebtBucket = placement === "non_current_liabilities" ? "long_term_funded" : "current_funded";
    return {
      normalizedDebtCategory: "debt_other",
      fundedModelDebt: true,
      isAmbiguous: true,
      confidence: 0.55,
      fundedBucket: bucket,
    };
  }

  return {
    normalizedDebtCategory: "not_debt",
    fundedModelDebt: false,
    isAmbiguous: false,
    confidence: 0,
    fundedBucket: null,
  };
}

/** Template / core BS row IDs map to buckets for detection without label parsing. */
export function coreBsRowFundedDebtBucket(rowId: string): BsDebtBucket | null {
  if (rowId === "st_debt") return "current_funded";
  if (rowId === "lt_debt") return "long_term_funded";
  return null;
}

export function coreBsRowNormalizedCategory(rowId: string): NormalizedDebtCategory | null {
  if (rowId === "st_debt") return "debt_short_term";
  if (rowId === "lt_debt") return "debt_long_term";
  return null;
}

/**
 * Re-run debt enrichment for every input row (top-level and nested). Safe to call after BS tree edits.
 */
export function enrichEntireBalanceSheet(balanceSheet: Row[]): Row[] {
  return balanceSheet.map((r, i) => enrichBsSubtree(r, balanceSheet, i));
}

function enrichBsSubtree(row: Row, balanceSheet: Row[], topLevelIndex: number): Row {
  const withNested =
    row.children?.length != null
      ? {
          ...row,
          children: row.children!.map((c) => enrichBsSubtree(c, balanceSheet, topLevelIndex)),
        }
      : row;
  return withNested.kind === "input"
    ? enrichBalanceSheetRowWithDebtMetadata(withNested, balanceSheet, topLevelIndex)
    : withNested;
}

/**
 * Apply inferred debt metadata + (when not user-locked) financing classification for custom BS input rows.
 * Core rows get stable debt tags for persistence/detection.
 */
export function enrichBalanceSheetRowWithDebtMetadata(row: Row, balanceSheet: Row[], rowIndex: number): Row {
  if (row.kind !== "input") return row;

  const resolvedIndex = resolveBalanceSheetTopLevelIndex(row, balanceSheet, rowIndex);
  const placement = getBSCategoryForRow(row.id, balanceSheet, resolvedIndex);

  if (isCoreBsRow(row.id)) {
    const cat = coreBsRowNormalizedCategory(row.id);
    const bucket = coreBsRowFundedDebtBucket(row.id);
    if (cat && bucket) {
      return {
        ...row,
        normalizedDebtCategory: cat,
        bsFundedDebtLine: true,
        bsDebtClassificationAmbiguous: false,
      };
    }
    return row;
  }

  if (placement !== "current_liabilities" && placement !== "non_current_liabilities") {
    return row;
  }

  if (row.classificationSource === "user") {
    const inferred = inferBalanceSheetDebtMetadata(row.label, placement);
    if (inferred.normalizedDebtCategory !== "not_debt") {
      return {
        ...row,
        normalizedDebtCategory: inferred.normalizedDebtCategory,
        bsFundedDebtLine: inferred.fundedModelDebt,
        bsDebtClassificationAmbiguous: inferred.isAmbiguous,
      };
    }
    return row;
  }

  const inferred = inferBalanceSheetDebtMetadata(row.label, placement);
  if (inferred.normalizedDebtCategory === "not_debt") {
    return row;
  }
  const tax = getBsTaxonomy(row);
  const isLeaseTax =
    tax.type === "liab_current_lease" ||
    tax.type === "liab_lease_obligations" ||
    inferred.normalizedDebtCategory === "lease_liability_current" ||
    inferred.normalizedDebtCategory === "lease_liability_noncurrent";

  const next: Row = {
    ...row,
    normalizedDebtCategory: inferred.normalizedDebtCategory,
    bsFundedDebtLine: isLeaseTax ? false : inferred.fundedModelDebt,
    bsDebtClassificationAmbiguous: inferred.isAmbiguous,
    taxonomyType: tax.type,
    taxonomyCategory: tax.category as Row["taxonomyCategory"],
    taxonomySource: row.taxonomySource === "user" ? "user" : ("fallback" as const),
  };

  if (isLeaseTax) {
    next.cashFlowBehavior = next.cashFlowBehavior ?? "financing";
    next.classificationSource = next.classificationSource === "user" ? "user" : "fallback";
    next.taxonomyStatus = "trusted";
    next.forecastMetadataStatus = "trusted";
    return next;
  }

  if (
    inferred.fundedModelDebt &&
    !inferred.isAmbiguous &&
    inferred.confidence >= DETERMINISTIC_TRUST_THRESHOLD
  ) {
    next.cashFlowBehavior = "financing";
    next.scheduleOwner = "debt";
    next.classificationSource = "fallback";
    next.forecastMetadataStatus = "trusted";
    next.taxonomyStatus = "trusted";
    return next;
  }

  if (
    inferred.fundedModelDebt &&
    (tax.type === "liab_short_term_debt" || tax.type === "liab_long_term_debt") &&
    !inferred.isAmbiguous
  ) {
    next.cashFlowBehavior = next.cashFlowBehavior ?? "financing";
    next.scheduleOwner = next.scheduleOwner === "none" ? "debt" : next.scheduleOwner;
    next.classificationSource = "fallback";
    next.forecastMetadataStatus = "trusted";
    next.taxonomyStatus = "trusted";
    return next;
  }

  next.taxonomyStatus = inferred.isAmbiguous ? "needs_review" : "trusted";
  if (!inferred.isAmbiguous) next.forecastMetadataStatus = "trusted";
  return next;
}
