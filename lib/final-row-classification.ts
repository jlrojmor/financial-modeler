/**
 * Single canonical final row classification resolver.
 * Determines for every row: final section, category, type, source, confidence, and review state.
 * Used by: inline row badges, central review panel, confirm buttons, warning banner.
 * Priority: (1) User override, (2) Template/anchor, (3) Placement, (4) AI, (5) Fallback.
 */

import type { Row } from "@/types/finance";
import { TEMPLATE_IS_ROW_IDS } from "./is-classification";
import { isCoreBsRow } from "./bs-core-rows";
import { getFinalOperatingSubgroup, OPERATING_SUBGROUP_LABELS } from "./cfs-operating-subgroups";
import { CFS_ANCHOR_HISTORICAL_NATURE } from "./cfs-forecast-drivers";
import { getIsTaxonomy, getBsTaxonomy, getCfsTaxonomy } from "./row-taxonomy";
import { IS_CATEGORY_LABELS } from "./row-taxonomy";
import { BS_CATEGORY_LABELS } from "./row-taxonomy";

export type StatementKey = "income" | "balance" | "cashFlow";

export type ClassificationSource = "user" | "template" | "placement" | "ai" | "standard_match" | "fallback";

export type FinalReviewState = "trusted" | "needs_confirmation" | "setup_required";

export interface PlacementContext {
  /** CFS: "operating" | "investing" | "financing" | "cash_bridge" */
  sectionId?: string;
  /** CFS operating subgroup when sectionId === "operating" */
  subgroupId?: string;
  /** Parent row id (e.g. "wc_change" for WC children) */
  parentId?: string;
}

export interface FinalRowClassificationState {
  section: string;
  category: string;
  type: string;
  source: ClassificationSource;
  confidence: number;
  reviewState: FinalReviewState;
  /** Human-readable "Section → Type" for Confirm UX */
  suggestedLabel?: string;
  reason?: string;
}

const CFS_SECTION_LABELS: Record<string, string> = {
  operating: "Operating Activities",
  investing: "Investing Activities",
  financing: "Financing Activities",
  cash_bridge: "Cash Bridge",
};

// ─── Standard / strong label match: common real-world line items that can be auto-trusted when context is known
const STANDARD_IS_PATTERNS: string[] = [
  "sales and marketing", "sales & marketing", "general and administrative", "general & administrative", "g&a", "sga",
  "restructuring", "subscription and support", "professional services", "cost of revenue", "cost of goods",
  "losses on strategic investments", "loss on strategic", "interest income", "interest expense", "interest, net",
  "income tax", "tax benefit", "tax provision", "tax expense", "other income", "other expense",
  "research and development", "r&d", "depreciation", "amortization", "stock-based compensation", "sbc",
  "operating income", "gross profit", "revenue", "net income",
];
const STANDARD_BS_PATTERNS: string[] = [
  "marketable securities", "short-term investments", "prepaid expenses", "prepaid",
  "accounts receivable", "receivables", "inventory", "strategic investments", "other current assets",
  "deferred tax assets", "deferred tax liabilities", "property, plant", "ppe", "goodwill",
  "intangible assets", "right-of-use", "rou assets", "lease assets",
  "preferred stock", "treasury stock", "accumulated other comprehensive", "aoci", "other comprehensive income",
  "long-term debt", "short-term debt", "current portion of long-term debt", "current maturities",
  "notes payable", "borrowings", "credit facility", "revolving", "revolver", "term loan", "bonds payable",
  "lease liabilities", "accounts payable", "accrued",
  "deferred revenue", "retained earnings", "common stock", "additional paid-in", "apic",
];
const STANDARD_CFS_PATTERNS: string[] = [
  "marketable securities", "purchase of marketable", "sale of marketable", "maturity of marketable", "maturities of marketable",
  "repayment of borrowings", "repayment of debt", "repayment of finance lease", "repayment of lease",
  "proceeds from issuance", "proceeds from debt", "proceeds from exercise", "stock options", "warrants",
  "repurchase of stock", "share repurchase", "repurchases of common stock",
  "dividends paid", "dividend", "capital expenditure", "capex", "acquisition", "cash acquired", "asset sale", "sales of strategic", "purchases of strategic",
  "purchase of property", "purchase of intangible", "debt issued", "debt repaid", "equity issued",
  "working capital", "depreciation", "amortization", "stock-based compensation",
];

/** Labels that are genuinely ambiguous and should stay in needs_confirmation. */
function isAmbiguousLabel(label: string): boolean {
  const l = label.toLowerCase();
  return (
    /\bother\s+assets\b/.test(l) || /\bother\s+liabilities\b/.test(l) || /\bother\s+operating\b/.test(l) ||
    /\bother\s+investing\b/.test(l) || /\bother\s+financing\b/.test(l) ||
    /\bmiscellaneous\b/.test(l) || /\bspecial\s+items\b/.test(l) || /\bcontract\s+adjustment\b/.test(l) ||
    /\bother\s*,\s*net\b/.test(l) || /\bother\s+income\s+.*\s+expense\b/.test(l) ||
    /^other\s+/.test(l) && l.length < 40
  );
}

/** Strong match to a standard accounting line item; safe to auto-trust when placement/metadata are complete. */
function isStandardLabel(label: string, statementKey: StatementKey, section?: string): boolean {
  const l = label.toLowerCase().trim();
  if (statementKey === "income") {
    return STANDARD_IS_PATTERNS.some((p) => l.includes(p));
  }
  if (statementKey === "balance") {
    return STANDARD_BS_PATTERNS.some((p) => l.includes(p));
  }
  return STANDARD_CFS_PATTERNS.some((p) => l.includes(p));
}

// ─── Non-actionable rows: never show in review (return trusted immediately)
function isNonActionable(row: Row, statementKey: StatementKey): boolean {
  if (row.kind === "subtotal" || row.kind === "total") return true;
  if (row.id.endsWith("_margin") || (row.label && /margin\s*%?$/i.test(row.label))) return true;
  if (statementKey === "income" && (row.isTemplateRow === true || TEMPLATE_IS_ROW_IDS.has(row.id))) return true;
  if (statementKey === "balance" && isCoreBsRow(row.id)) return true;
  if (statementKey === "cashFlow" && Object.prototype.hasOwnProperty.call(CFS_ANCHOR_HISTORICAL_NATURE, row.id)) return true;
  if (row.id === "operating_expenses" || row.id === "other_operating") return true;
  return false;
}

// ─── Required metadata present? (CFS: section is enough — nature can be inferred from section for resolution)
function hasRequiredMetadata(row: Row, statementKey: StatementKey): boolean {
  if (statementKey === "income") {
    return row.sectionOwner != null && (row.isOperating === true || row.isOperating === false);
  }
  if (statementKey === "balance") {
    return row.cashFlowBehavior != null && row.cashFlowBehavior !== "unclassified";
  }
  return row.cfsLink?.section != null;
}

// ─── Build suggestedLabel for Confirm UX
function buildSuggestedLabel(
  statementKey: StatementKey,
  section: string,
  category: string,
  type: string,
  rowLabel: string
): string {
  if (statementKey === "cashFlow") {
    const sectionLabel = CFS_SECTION_LABELS[section] ?? section;
    if (section === "operating" && category && category !== "earnings_base") {
      const subgroupLabel = OPERATING_SUBGROUP_LABELS[category as keyof typeof OPERATING_SUBGROUP_LABELS] ?? category;
      return `${sectionLabel} (${subgroupLabel}) → ${type || rowLabel}`;
    }
    return `${sectionLabel} → ${type || rowLabel}`;
  }
  if (statementKey === "income") {
    const IS_SECTION_LABELS: Record<string, string> = {
      revenue: "Revenue",
      cogs: "Cost of Revenue",
      sga: "SG&A",
      rd: "R&D",
      other_operating: "Other Operating",
      non_operating: "Non-Operating",
      tax: "Tax",
      operating_expenses: "Operating Expenses",
    };
    const sectionLabel = IS_SECTION_LABELS[section] ?? IS_CATEGORY_LABELS[section as keyof typeof IS_CATEGORY_LABELS] ?? section;
    return `${sectionLabel} → ${type || rowLabel}`;
  }
  if (statementKey === "balance") {
    const categoryLabel = BS_CATEGORY_LABELS[category as keyof typeof BS_CATEGORY_LABELS] ?? category;
    return `${categoryLabel} → ${type || rowLabel}`;
  }
  return `${section} → ${rowLabel}`;
}

// ─── CFS: section + category (subgroup) + type label from taxonomy or nature
function getCfsSectionCategoryType(row: Row, context?: PlacementContext): { section: string; category: string; typeLabel: string } {
  const section = row.cfsLink?.section ?? context?.sectionId ?? "operating";
  const parentId = context?.parentId;
  const subgroup = getFinalOperatingSubgroup(row, parentId);
  const taxonomy = getCfsTaxonomy(row);
  const typeLabel = taxonomy?.label ?? row.label;
  let category = subgroup ?? "";
  if (section === "operating" && !category) category = "other_operating";
  if (section !== "operating") category = section;
  return { section, category, typeLabel };
}

// ─── IS: section + type from sectionOwner / taxonomy
function getIsSectionCategoryType(row: Row): { section: string; category: string; typeLabel: string } {
  const taxonomy = getIsTaxonomy(row);
  const section = row.sectionOwner ?? taxonomy?.category ?? "other_operating";
  const typeLabel = taxonomy?.label ?? row.label;
  return { section, category: section, typeLabel };
}

// ─── BS: category + type from cashFlowBehavior / taxonomy
function getBsSectionCategoryType(row: Row): { section: string; category: string; typeLabel: string } {
  const taxonomy = getBsTaxonomy(row);
  const category = row.cashFlowBehavior ?? taxonomy?.category ?? "unclassified";
  const typeLabel = taxonomy?.label ?? row.label;
  return { section: category, category, typeLabel };
}

/**
 * Single source of truth for final row classification and review state.
 * Priority: (1) User override, (2) Deterministic template/anchor, (3) Placement-based inference,
 * (4) AI classification, (5) Fallback heuristics (never auto-trusted).
 */
export function getFinalRowClassificationState(
  row: Row,
  statementKey: StatementKey,
  context?: PlacementContext
): FinalRowClassificationState {
  // Non-actionable rows never appear in review
  if (isNonActionable(row, statementKey)) {
    const taxonomy =
      statementKey === "income" ? getIsTaxonomy(row) : statementKey === "balance" ? getBsTaxonomy(row) : getCfsTaxonomy(row);
    const section = statementKey === "income" ? (row.sectionOwner ?? taxonomy?.category ?? "") : statementKey === "balance" ? (row.cashFlowBehavior ?? taxonomy?.category ?? "") : (row.cfsLink?.section ?? "operating");
    const category = section;
    const typeLabel = taxonomy?.label ?? row.label;
    return {
      section,
      category,
      type: typeLabel,
      source: "template",
      confidence: 1,
      reviewState: "trusted",
      suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label),
    };
  }

  // 1) User override
  if (row.classificationSource === "user" && hasRequiredMetadata(row, statementKey)) {
    if (statementKey === "income") {
      const { section, category, typeLabel } = getIsSectionCategoryType(row);
      return {
        section,
        category,
        type: typeLabel,
        source: "user",
        confidence: 1,
        reviewState: "trusted",
        suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label),
      };
    }
    if (statementKey === "balance") {
      const { section, category, typeLabel } = getBsSectionCategoryType(row);
      return {
        section,
        category,
        type: typeLabel,
        source: "user",
        confidence: 1,
        reviewState: "trusted",
        suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label),
      };
    }
    const { section, category, typeLabel } = getCfsSectionCategoryType(row, context);
    return {
      section,
      category,
      type: typeLabel,
      source: "user",
      confidence: 1,
      reviewState: "trusted",
      suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label),
    };
  }

  // 2) Deterministic template / anchor
  if (statementKey === "income" && TEMPLATE_IS_ROW_IDS.has(row.id)) {
    const { section, category, typeLabel } = getIsSectionCategoryType(row);
    return { section, category, type: typeLabel, source: "template", confidence: 1, reviewState: "trusted", suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label) };
  }
  if (statementKey === "balance" && isCoreBsRow(row.id)) {
    const { section, category, typeLabel } = getBsSectionCategoryType(row);
    return { section, category, type: typeLabel, source: "template", confidence: 1, reviewState: "trusted", suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label) };
  }
  if (statementKey === "cashFlow" && Object.prototype.hasOwnProperty.call(CFS_ANCHOR_HISTORICAL_NATURE, row.id)) {
    const { section, category, typeLabel } = getCfsSectionCategoryType(row, context);
    return { section, category, type: typeLabel, source: "template", confidence: 1, reviewState: "trusted", suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label) };
  }

  // 3) Placement-based inference: row has section/placement set (e.g. added in that section)
  const hasPlacement =
    statementKey === "income"
      ? row.sectionOwner != null
      : statementKey === "balance"
        ? row.cashFlowBehavior != null && row.cashFlowBehavior !== "unclassified"
        : (row.cfsLink?.section != null || context?.sectionId != null || context?.parentId === "wc_change");

  if (hasPlacement && hasRequiredMetadata(row, statementKey)) {
    const trustFlags = row.forecastMetadataStatus === "trusted" && (row.taxonomyStatus === "trusted" || row.taxonomyStatus === undefined);
    const standardMatch = isStandardLabel(row.label, statementKey, row.cfsLink?.section ?? context?.sectionId);
    const ambiguous = isAmbiguousLabel(row.label);
    const autoTrust = trustFlags || (standardMatch && !ambiguous);
    const fromPlacement = true;
    if (statementKey === "income") {
      const { section, category, typeLabel } = getIsSectionCategoryType(row);
      return {
        section,
        category,
        type: typeLabel,
        source: autoTrust ? (standardMatch && !trustFlags ? "standard_match" : "placement") : "placement",
        confidence: autoTrust ? 1 : 0.8,
        reviewState: autoTrust ? "trusted" : "needs_confirmation",
        suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label),
        reason: row.classificationReason,
      };
    }
    if (statementKey === "balance") {
      const { section, category, typeLabel } = getBsSectionCategoryType(row);
      return {
        section,
        category,
        type: typeLabel,
        source: autoTrust ? (standardMatch && !trustFlags ? "standard_match" : "placement") : "placement",
        confidence: autoTrust ? 1 : 0.8,
        reviewState: autoTrust ? "trusted" : "needs_confirmation",
        suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label),
        reason: row.classificationReason,
      };
    }
    const { section, category, typeLabel } = getCfsSectionCategoryType(row, context);
    return {
      section,
      category,
      type: typeLabel,
      source: autoTrust ? (standardMatch && !trustFlags ? "standard_match" : "placement") : "placement",
      confidence: autoTrust ? 1 : 0.8,
      reviewState: autoTrust ? "trusted" : "needs_confirmation",
      suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label),
      reason: row.classificationReason,
    };
  }

  // 4) AI classification
  if (row.classificationSource === "ai" && hasRequiredMetadata(row, statementKey)) {
    const confidence = row.classificationConfidence ?? 0.5;
    const trusted = confidence >= 0.7 && row.forecastMetadataStatus === "trusted";
    if (statementKey === "income") {
      const { section, category, typeLabel } = getIsSectionCategoryType(row);
      return {
        section,
        category,
        type: typeLabel,
        source: "ai",
        confidence,
        reviewState: trusted ? "trusted" : "needs_confirmation",
        suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label),
        reason: row.classificationReason,
      };
    }
    if (statementKey === "balance") {
      const { section, category, typeLabel } = getBsSectionCategoryType(row);
      return {
        section,
        category,
        type: typeLabel,
        source: "ai",
        confidence,
        reviewState: trusted ? "trusted" : "needs_confirmation",
        suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label),
        reason: row.classificationReason,
      };
    }
    const { section, category, typeLabel } = getCfsSectionCategoryType(row, context);
    return {
      section,
      category,
      type: typeLabel,
      source: "ai",
      confidence,
      reviewState: trusted ? "trusted" : "needs_confirmation",
      suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label),
      reason: row.classificationReason,
    };
  }

  // 5) Fallback: placement when section is known from context but row not fully filled
  if (statementKey === "cashFlow" && (context?.sectionId || context?.parentId === "wc_change" || row.cfsLink?.section)) {
    const { section, category, typeLabel } = getCfsSectionCategoryType(row, context);
    const hasSectionAndNature = row.cfsLink?.section != null && row.historicalCfsNature != null;
    if (hasSectionAndNature) {
      const standardMatch = isStandardLabel(row.label, statementKey, section);
      const ambiguous = isAmbiguousLabel(row.label);
      const autoTrust = row.forecastMetadataStatus === "trusted" || (standardMatch && !ambiguous);
      return {
        section,
        category,
        type: typeLabel,
        source: autoTrust ? (standardMatch ? "standard_match" : "placement") : "placement",
        confidence: autoTrust ? 1 : 0.7,
        reviewState: autoTrust ? "trusted" : "needs_confirmation",
        suggestedLabel: buildSuggestedLabel(statementKey, section, category, typeLabel, row.label),
        reason: "From placement in this section",
      };
    }
  }

  // 6) Fallback heuristics: setup_required when incomplete; standard_match when complete + strong label; else needs_confirmation
  const hasMeta = hasRequiredMetadata(row, statementKey);
  const standardMatch = hasMeta && isStandardLabel(row.label, statementKey, row.cfsLink?.section ?? context?.sectionId);
  const ambiguous = isAmbiguousLabel(row.label);
  const fallbackTrusted = hasMeta && standardMatch && !ambiguous;

  if (statementKey === "income") {
    const { section, category, typeLabel } = getIsSectionCategoryType(row);
    return {
      section,
      category,
      type: typeLabel,
      source: fallbackTrusted ? "standard_match" : "fallback",
      confidence: fallbackTrusted ? 1 : 0.5,
      reviewState: !hasMeta ? "setup_required" : fallbackTrusted ? "trusted" : "needs_confirmation",
      suggestedLabel: hasMeta ? buildSuggestedLabel(statementKey, section, category, typeLabel, row.label) : undefined,
      reason: !hasMeta ? "Missing section and operating/non-operating classification" : fallbackTrusted ? "Standard line item" : "Suggested from label",
    };
  }
  if (statementKey === "balance") {
    const { section, category, typeLabel } = getBsSectionCategoryType(row);
    return {
      section,
      category,
      type: typeLabel,
      source: fallbackTrusted ? "standard_match" : "fallback",
      confidence: fallbackTrusted ? 1 : 0.5,
      reviewState: !hasMeta ? "setup_required" : fallbackTrusted ? "trusted" : "needs_confirmation",
      suggestedLabel: hasMeta ? buildSuggestedLabel(statementKey, section, category, typeLabel, row.label) : undefined,
      reason: !hasMeta ? "Missing cash flow behavior" : fallbackTrusted ? "Standard line item" : "Suggested from label",
    };
  }
  const { section, category, typeLabel } = getCfsSectionCategoryType(row, context);
  return {
    section,
    category,
    type: typeLabel,
    source: fallbackTrusted ? "standard_match" : "fallback",
    confidence: fallbackTrusted ? 1 : 0.5,
    reviewState: !hasMeta ? "setup_required" : fallbackTrusted ? "trusted" : "needs_confirmation",
    suggestedLabel: hasMeta ? buildSuggestedLabel(statementKey, section, category, typeLabel, row.label) : undefined,
    reason: !hasMeta ? "Missing section and row type for cash flow" : fallbackTrusted ? "Standard line item" : "Suggested from label",
  };
}
