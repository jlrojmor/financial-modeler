/**
 * Company-aware suggestion ranking and deterministic behavior.
 * Uses CompanyModelingProfile to rank suggested rows, emphasize WC items, and surface
 * short explanations so the app visibly behaves differently by company type.
 * Context-weighted, not context-forced.
 */

import type { CompanyModelingProfile } from "@/types/company-context";
import type { GlossaryItem } from "@/lib/financial-glossary";
import type { Row } from "@/types/finance";
import { suggestCashFlowBehaviorFromLabel, type SuggestedCashFlowBehavior } from "@/lib/bs-cf-heuristic";

/** Normalize concept/label for matching (lowercase, collapse spaces). */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Check if concept or any alternative matches any of the keywords (substring). */
function conceptMatches(concept: string, alternatives: string[] | undefined, keywords: string[]): boolean {
  const c = norm(concept);
  const alt = (alternatives ?? []).map((a) => norm(a));
  for (const kw of keywords) {
    const k = norm(kw);
    if (c.includes(k)) return true;
    if (alt.some((a) => a.includes(k))) return true;
  }
  return false;
}

/** Score for ranking: higher = more relevant for this profile. Base 0; +2 for strong match, +1 for weak. */
function scoreISSuggestion(item: GlossaryItem, profile: CompanyModelingProfile | null): number {
  if (!profile?.hasGeneratedContext) return 0;
  const business = profile.businessModelType ?? "";
  const revenueModel = profile.revenueModel ?? "";
  const concept = item.concept;
  const alt = item.alternativeNames ?? [];

  // SaaS / subscription
  if (
    revenueModel === "subscription" ||
    business.includes("software") ||
    business.includes("saas")
  ) {
    if (conceptMatches(concept, alt, ["deferred revenue", "unearned", "SBC", "stock-based", "subscription", "R&D", "research and development", "capitalized software", "capitalized development"]))
      return 2;
    if (conceptMatches(concept, alt, ["SG&A", "D&A", "depreciation", "amortization"])) return 1;
  }

  // Wholesale / distribution
  if (
    business.includes("wholesale") ||
    business.includes("distribution") ||
    business.includes("consumer_staples")
  ) {
    if (conceptMatches(concept, alt, ["COGS", "cost of revenue", "cost of sales", "inventory", "receivable", "payable", "SG&A", "D&A"])) return 2;
    if (conceptMatches(concept, alt, ["Revenue", "Gross profit"])) return 1;
  }

  // Branded retail
  if (business.includes("retail") || business.includes("branded")) {
    if (conceptMatches(concept, alt, ["inventory", "COGS", "cost of sales", "SG&A", "D&A", "Revenue"])) return 2;
    if (conceptMatches(concept, alt, ["Gross profit", "depreciation"])) return 1;
  }

  // Healthcare / lab
  if (business.includes("healthcare") || business.includes("lab") || business.includes("pharma")) {
    if (conceptMatches(concept, alt, ["R&D", "research", "SG&A", "D&A", "PP&E", "equipment", "Revenue", "COGS"])) return 2;
    if (conceptMatches(concept, alt, ["depreciation", "amortization"])) return 1;
  }

  // Industrial / manufacturing
  if (business.includes("industrial") || business.includes("manufacturing")) {
    if (conceptMatches(concept, alt, ["COGS", "D&A", "depreciation", "PP&E", "inventory", "SG&A"])) return 2;
    if (conceptMatches(concept, alt, ["Revenue", "Gross profit"])) return 1;
  }

  return 0;
}

/** Score for BS items (by category). WC emphasis for high WC profile; SaaS emphasizes deferred, etc. */
function scoreBSSuggestion(item: GlossaryItem, category: "Assets" | "Liabilities" | "Equity", profile: CompanyModelingProfile | null): number {
  if (!profile?.hasGeneratedContext) return 0;
  const business = profile.businessModelType ?? "";
  const wc = profile.workingCapitalProfile ?? "medium";
  const concept = item.concept;
  const alt = item.alternativeNames ?? [];

  // Working capital emphasis (AR, inventory, AP, other current)
  if (wc === "high" && category === "Assets") {
    if (conceptMatches(concept, alt, ["receivable", "AR", "inventory", "prepaid", "other current"])) return 2;
  }
  if (wc === "high" && category === "Liabilities") {
    if (conceptMatches(concept, alt, ["payable", "AP", "accrued", "other current", "deferred revenue"])) return 2;
  }

  // SaaS: deferred revenue, minimal inventory
  if (business.includes("software") || business.includes("saas")) {
    if (conceptMatches(concept, alt, ["deferred revenue", "unearned", "receivable"])) return 2;
    if (conceptMatches(concept, alt, ["intangible", "PP&E"])) return 1;
  }

  // Wholesale / distribution: AR, inventory, AP
  if (business.includes("wholesale") || business.includes("distribution")) {
    if (conceptMatches(concept, alt, ["receivable", "inventory", "payable", "AR", "AP"])) return 2;
  }

  // Retail: inventory, PP&E (stores), lease
  if (business.includes("retail")) {
    if (conceptMatches(concept, alt, ["inventory", "PP&E", "property", "equipment", "lease", "right-of-use"])) return 2;
  }

  // Healthcare: PP&E, equipment
  if (business.includes("healthcare") || business.includes("lab")) {
    if (conceptMatches(concept, alt, ["PP&E", "equipment", "receivable", "payable"])) return 2;
  }

  return 0;
}

/** Score for CFS items by section. */
function scoreCFSSuggestion(item: GlossaryItem, profile: CompanyModelingProfile | null): number {
  if (!profile?.hasGeneratedContext) return 0;
  const business = profile.businessModelType ?? "";
  const wc = profile.workingCapitalProfile ?? "medium";
  const concept = item.concept;
  const alt = item.alternativeNames ?? [];

  if (conceptMatches(concept, alt, ["working capital", "change in operating"])) {
    return wc === "high" ? 2 : wc === "medium" ? 1 : 0;
  }
  if (conceptMatches(concept, alt, ["capital expenditure", "capex"])) {
    return business.includes("retail") || business.includes("industrial") ? 2 : 1;
  }
  if (conceptMatches(concept, alt, ["debt", "dividend", "repurchase", "issuance"])) return 1;
  return 0;
}

/**
 * Rank IS glossary items by company profile. Keeps mandatory first, then sorts by relevance score then alpha.
 */
export function rankISSuggestionsByProfile(items: GlossaryItem[], profile: CompanyModelingProfile | null): GlossaryItem[] {
  if (!profile) return items;
  return [...items].sort((a, b) => {
    if (a.isMandatory && !b.isMandatory) return -1;
    if (!a.isMandatory && b.isMandatory) return 1;
    const sa = scoreISSuggestion(a, profile);
    const sb = scoreISSuggestion(b, profile);
    if (sb !== sa) return sb - sa;
    return (a.concept || "").localeCompare(b.concept || "");
  });
}

/**
 * Rank BS glossary items by category and profile.
 */
export function rankBSSuggestionsByProfile(
  items: GlossaryItem[],
  category: "Assets" | "Liabilities" | "Equity",
  profile: CompanyModelingProfile | null
): GlossaryItem[] {
  if (!profile) return items;
  return [...items].sort((a, b) => {
    if (a.isMandatory && !b.isMandatory) return -1;
    if (!a.isMandatory && b.isMandatory) return 1;
    const sa = scoreBSSuggestion(a, category, profile);
    const sb = scoreBSSuggestion(b, category, profile);
    if (sb !== sa) return sb - sa;
    return (a.concept || "").localeCompare(b.concept || "");
  });
}

/**
 * Rank CFS glossary items by profile.
 */
export function rankCFSSuggestionsByProfile(items: GlossaryItem[], profile: CompanyModelingProfile | null): GlossaryItem[] {
  if (!profile) return items;
  return [...items].sort((a, b) => {
    if (a.isMandatory && !b.isMandatory) return -1;
    if (!a.isMandatory && b.isMandatory) return 1;
    const sa = scoreCFSSuggestion(a, profile);
    const sb = scoreCFSSuggestion(b, profile);
    if (sb !== sa) return sb - sa;
    return (a.concept || "").localeCompare(b.concept || "");
  });
}

/**
 * Short UI explanation when a suggestion is influenced by company context.
 * Shown under or next to suggested rows (e.g. "Suggested for wholesale/distribution profile").
 */
export function getCompanyAwareSuggestionExplanation(
  concept: string,
  statementKind: "IS" | "BS" | "CFS",
  profile: CompanyModelingProfile | null
): string | undefined {
  if (!profile?.hasGeneratedContext) return undefined;
  const business = (profile.businessModelType ?? "").replace(/_/g, " ");
  const benchmark = (profile.benchmarkFamily ?? "").replace(/_/g, " ");
  const c = norm(concept);

  if (statementKind === "IS") {
    if (profile.revenueModel === "subscription" || business.includes("saas") || business.includes("software")) {
      if (c.includes("deferred") || c.includes("sbc") || c.includes("stock-based") || c.includes("r&d") || c.includes("subscription"))
        return "Common for SaaS / subscription models";
    }
    if (business.includes("wholesale") || business.includes("distribution")) {
      if (c.includes("cogs") || c.includes("inventory") || c.includes("receivable") || c.includes("payable"))
        return "Suggested for wholesale/distribution profile";
    }
    if (business.includes("retail")) {
      if (c.includes("inventory") || c.includes("cogs") || c.includes("sga")) return "Common for retail";
    }
    if (benchmark) return `Suggested from benchmark family (${benchmark})`;
    if (profile.acceptedComps.length > 0) return "Suggested from accepted comp set and benchmark family";
  }

  if (statementKind === "BS") {
    if (profile.workingCapitalProfile === "high" && (c.includes("receivable") || c.includes("inventory") || c.includes("payable")))
      return "Suggested for inventory-heavy working capital profile";
    if (business.includes("saas") && (c.includes("deferred") || c.includes("unearned")))
      return "Common for SaaS / subscription models";
    if (benchmark) return `Suggested for ${benchmark} profile`;
    if (profile.acceptedComps.length > 0) return "Suggested from accepted comp set";
  }

  if (statementKind === "CFS") {
    if (profile.workingCapitalProfile === "high" && c.includes("working capital"))
      return "Emphasized for high working capital profile";
    if (benchmark) return `Suggested from benchmark family (${benchmark})`;
  }

  return undefined;
}

/**
 * Section owner order for IS classification dropdown: put most relevant first for this profile.
 * Does not remove options; reorders so default/first option is context-aware.
 */
export function getSectionOwnerOrderForProfile(profile: CompanyModelingProfile | null): Row["sectionOwner"][] {
  const defaultOrder: Row["sectionOwner"][] = ["revenue", "cogs", "sga", "rd", "other_operating", "non_operating", "tax"];
  if (!profile?.hasGeneratedContext) return defaultOrder;
  const business = profile.businessModelType ?? "";
  // SaaS: rd, sga (SBC, opex) often more relevant
  if (business.includes("software") || business.includes("saas")) {
    return ["rd", "sga", "other_operating", "revenue", "cogs", "non_operating", "tax"];
  }
  // Wholesale: cogs, sga
  if (business.includes("wholesale") || business.includes("distribution")) {
    return ["cogs", "sga", "other_operating", "revenue", "rd", "non_operating", "tax"];
  }
  return defaultOrder;
}

/**
 * Working capital emphasis: which concepts to emphasize as WC and whether to prefer working_capital for ambiguous rows.
 */
export function getWCEmphasisFromProfile(profile: CompanyModelingProfile | null): {
  emphasizeWorkingCapital: boolean;
  preferredWCConcepts: string[];
} {
  if (!profile?.hasGeneratedContext) {
    return { emphasizeWorkingCapital: false, preferredWCConcepts: [] };
  }
  const wc = profile.workingCapitalProfile ?? "medium";
  const business = profile.businessModelType ?? "";
  const preferredWCConcepts: string[] = [];
  if (wc === "high" || business.includes("wholesale") || business.includes("distribution") || business.includes("retail")) {
    preferredWCConcepts.push("receivable", "inventory", "payable", "prepaid", "accrued", "deferred revenue", "other current");
  }
  if (business.includes("saas") || business.includes("software")) {
    preferredWCConcepts.push("deferred revenue", "unearned", "receivable");
  }
  return {
    emphasizeWorkingCapital: wc === "high",
    preferredWCConcepts,
  };
}

/**
 * Suggest cash flow behavior for a BS row using label and company context.
 * When profile suggests strong WC emphasis, prefer working_capital for ambiguous labels.
 * Returns explanation for UI (e.g. "Suggested for wholesale/distribution profile").
 */
export function suggestCashFlowBehaviorWithContext(
  label: string,
  profile: CompanyModelingProfile | null
): { behavior: SuggestedCashFlowBehavior | null; explanation?: string } {
  const fromHeuristic = suggestCashFlowBehaviorFromLabel(label);
  if (!profile?.hasGeneratedContext) {
    return { behavior: fromHeuristic };
  }
  const { emphasizeWorkingCapital, preferredWCConcepts } = getWCEmphasisFromProfile(profile);
  const business = (profile.businessModelType ?? "").replace(/_/g, " ");
  const c = norm(label);

  // If heuristic says non_cash or unclassified but profile strongly suggests WC (e.g. "Other current assets" in distribution)
  if (emphasizeWorkingCapital && preferredWCConcepts.some((kw) => c.includes(kw))) {
    if (fromHeuristic === "working_capital") {
      return { behavior: "working_capital", explanation: "Suggested for inventory-heavy working capital profile" };
    }
    if (!fromHeuristic || fromHeuristic === "non_cash") {
      return { behavior: "working_capital", explanation: "Suggested from company WC drivers and comp set" };
    }
  }

  if (fromHeuristic === "working_capital" && emphasizeWorkingCapital) {
    return { behavior: "working_capital", explanation: "Suggested for wholesale/distribution profile" };
  }

  if (fromHeuristic && profile.acceptedComps.length > 0) {
    return { behavior: fromHeuristic, explanation: "Suggested from accepted comp set and benchmark family" };
  }

  if (fromHeuristic) {
    return { behavior: fromHeuristic };
  }
  return { behavior: null };
}
