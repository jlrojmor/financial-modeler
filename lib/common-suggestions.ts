/**
 * Common Suggestions System
 * 
 * Filters glossary to show only the most common/mandatory items
 * for each statement type and section. When CompanyModelingProfile is provided,
 * items are ranked by company-aware relevance (SaaS vs wholesale vs retail, etc.).
 */

import { FINANCIAL_GLOSSARY, type GlossaryItem, type PrimaryStatement, type CFSSection } from "./financial-glossary";
import type { CompanyModelingProfile } from "@/types/company-context";
import { rankISSuggestionsByProfile, rankBSSuggestionsByProfile, rankCFSSuggestionsByProfile } from "./company-aware-suggestions";

/**
 * Get common Income Statement items (optionally ranked by company profile).
 */
export function getCommonISItems(profile?: CompanyModelingProfile | null): GlossaryItem[] {
  const items = FINANCIAL_GLOSSARY.filter(item =>
    item.primaryStatement === "IS" &&
    (item.isCommon || item.isMandatory)
  ).sort((a, b) => {
    if (a.isMandatory && !b.isMandatory) return -1;
    if (!a.isMandatory && b.isMandatory) return 1;
    return a.concept.localeCompare(b.concept);
  });
  return rankISSuggestionsByProfile(items, profile ?? null);
}

/**
 * Get common Balance Sheet items by category (optionally ranked by company profile).
 */
export function getCommonBSItems(category?: "Assets" | "Liabilities" | "Equity", profile?: CompanyModelingProfile | null): GlossaryItem[] {
  const filtered = FINANCIAL_GLOSSARY.filter(item => {
    if (item.primaryStatement !== "BS") return false;
    if (!item.isCommon && !item.isMandatory) return false;
    if (category && item.category !== category) return false;
    return true;
  }).sort((a, b) => {
    if (a.isMandatory && !b.isMandatory) return -1;
    if (!a.isMandatory && b.isMandatory) return 1;
    return a.concept.localeCompare(b.concept);
  });
  const cat = category ?? "Assets";
  return rankBSSuggestionsByProfile(filtered, cat, profile ?? null);
}

/**
 * Get common Cash Flow Statement items by section (optionally ranked by company profile).
 */
export function getCommonCFSItems(section: CFSSection, profile?: CompanyModelingProfile | null): GlossaryItem[] {
  const filtered = FINANCIAL_GLOSSARY.filter(item => {
    if (item.primaryStatement !== "CFS") return false;
    if (item.cfsSection !== section) return false;
    if (!item.isCommon && !item.isMandatory) return false;
    return true;
  }).sort((a, b) => {
    if (a.isMandatory && !b.isMandatory) return -1;
    if (!a.isMandatory && b.isMandatory) return 1;
    return a.concept.localeCompare(b.concept);
  });
  return rankCFSSuggestionsByProfile(filtered, profile ?? null);
}

/**
 * Get all mandatory items for a statement type
 */
export function getMandatoryItems(statementType: PrimaryStatement): GlossaryItem[] {
  return FINANCIAL_GLOSSARY.filter(item => 
    item.primaryStatement === statementType && 
    item.isMandatory
  );
}

/**
 * Check if an item is already added (by comparing labels)
 */
export function isItemAlreadyAdded(
  concept: string, 
  existingItems: Array<{ label: string; id?: string }>
): boolean {
  const normalized = concept.toLowerCase().trim();
  const item = FINANCIAL_GLOSSARY.find(i => 
    i.concept.toLowerCase() === normalized ||
    i.alternativeNames?.some(name => name.toLowerCase() === normalized)
  );
  
  if (!item) return false;
  
  // Check against existing items
  return existingItems.some(existing => {
    const existingNormalized = existing.label.toLowerCase().trim();
    return existingNormalized === normalized ||
           item.alternativeNames?.some(name => name.toLowerCase() === existingNormalized) ||
           item.typicalPresentation.some(p => p.toLowerCase() === existingNormalized);
  });
}

/**
 * Filter suggestions to exclude already-added items
 */
export function filterAlreadyAdded(
  suggestions: GlossaryItem[],
  existingItems: Array<{ label: string; id?: string }>
): GlossaryItem[] {
  return suggestions.filter(item => 
    !isItemAlreadyAdded(item.concept, existingItems)
  );
}
