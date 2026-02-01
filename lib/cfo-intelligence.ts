/**
 * CFO Intelligence Engine
 * 
 * Automatically analyzes Balance Sheet items to determine which ones should
 * flow into Cash Flow from Operations (CFO), excluding debt-related and capex-related items.
 */

import type { Row } from "@/types/finance";
import { findTermKnowledge } from "./financial-terms-knowledge";
import type { BalanceSheetCategory } from "./bs-impact-rules";
import { getBSCategoryForRow } from "./bs-category-mapper";

export interface CFOItem {
  rowId: string;
  label: string;
  treatment: "auto_add" | "suggest_review";
  description: string;
  impact: "positive" | "negative" | "neutral";
  calculationMethod: "change" | "direct" | "calculated";
}

/**
 * Analyze Balance Sheet items to determine CFO treatment
 * Focuses on Fixed Assets and Non-Current Liabilities that are NOT debt or capex related
 */
export function analyzeBSItemsForCFO(
  balanceSheet: Row[],
  years: string[]
): CFOItem[] {
  const cfoItems: CFOItem[] = [];
  
  // Items that should be EXCLUDED from CFO analysis (they go elsewhere)
  const excludePatterns = [
    /debt/i,
    /loan/i,
    /note/i,
    /bond/i,
    /credit facility/i,
    /revolver/i,
    /capex/i,
    /capital expenditure/i,
    /ppe/i,
    /property.*plant/i,
    /equipment/i,
    /intangible/i,
    /goodwill/i,
  ];
  
  // Items that should be INCLUDED in CFO (operating-related)
  const cfoIncludePatterns = [
    /operating.*lease/i,
    /lease.*liability/i,
    /deferred.*revenue/i,
    /deferred.*tax/i,
    /accrued.*expense/i,
    /accrued.*liability/i,
    /warranty/i,
    /pension/i,
    /other.*long.*term/i,
    /other.*liability/i,
  ];
  
  for (const row of balanceSheet) {
    // Skip totals, subtotals, and standard items already handled
    if (row.kind === "total" || row.kind === "subtotal") continue;
    if (["cash", "ar", "inventory", "ap", "st_debt"].includes(row.id)) continue;
    
    const category = getBSCategoryForRow(row.id, balanceSheet);
    const label = row.label.toLowerCase();
    
    // Only analyze Fixed Assets and Non-Current Liabilities
    if (category !== "fixed_assets" && category !== "non_current_liabilities") {
      continue;
    }
    
    // Skip if it matches exclude patterns (debt, capex, etc.)
    const shouldExclude = excludePatterns.some(pattern => pattern.test(label) || pattern.test(row.id));
    if (shouldExclude) continue;
    
    // Check if it matches CFO include patterns
    const shouldInclude = cfoIncludePatterns.some(pattern => pattern.test(label) || pattern.test(row.id));
    
    // Check financial terms knowledge base
    const termKnowledge = findTermKnowledge(row.label);
    
    let treatment: "auto_add" | "suggest_review" = "suggest_review";
    let description = "";
    let impact: "positive" | "negative" | "neutral" = "neutral";
    let calculationMethod: "change" | "direct" | "calculated" = "change";
    
    // Operating Leases - definitely CFO
    if (/operating.*lease/i.test(label) || /lease.*liability/i.test(label)) {
      treatment = "auto_add";
      description = "Operating lease liabilities are non-cash operating items. Changes flow to Operating CF. Increases = negative impact (cash obligation), decreases = positive impact.";
      impact = "negative"; // Increases in lease liability = negative CF
      calculationMethod = "change";
    }
    // Deferred Revenue - definitely CFO
    else if (/deferred.*revenue/i.test(label)) {
      treatment = "auto_add";
      description = "Deferred revenue is an operating liability. Increases = positive CF (cash received), decreases = negative CF (revenue recognized).";
      impact = "positive"; // Increases in deferred revenue = positive CF
      calculationMethod = "change";
    }
    // Deferred Tax - definitely CFO
    else if (/deferred.*tax/i.test(label)) {
      treatment = "auto_add";
      description = "Deferred tax liabilities/assets are non-cash operating items. Changes flow to Operating CF as adjustments.";
      impact = "neutral";
      calculationMethod = "change";
    }
    // Other Long-Term Liabilities - review needed
    else if (/other.*long.*term/i.test(label) || /other.*liability/i.test(label)) {
      treatment = "suggest_review";
      description = "Other long-term liabilities may include operating items (e.g., warranties, pensions) that should flow to Operating CF, or financing items. Review to determine correct treatment.";
      impact = "neutral";
      calculationMethod = "change";
    }
    // Check term knowledge
    else if (termKnowledge?.cfsTreatment?.section === "operating") {
      treatment = "auto_add";
      description = termKnowledge.cfsTreatment.description;
      impact = termKnowledge.cfsTreatment.impact === "positive" ? "positive" : 
               termKnowledge.cfsTreatment.impact === "negative" ? "negative" : "neutral";
      calculationMethod = termKnowledge.cfsTreatment.impact === "calculated" ? "calculated" : "change";
    }
    // If it should be included based on patterns
    else if (shouldInclude) {
      treatment = "suggest_review";
      description = `This item appears to be operating-related and may belong in Operating CF. Review to confirm correct treatment.`;
      impact = "neutral";
      calculationMethod = "change";
    }
    
    // Only add if we have a treatment determined
    if (treatment === "auto_add" || (treatment === "suggest_review" && shouldInclude)) {
      cfoItems.push({
        rowId: row.id,
        label: row.label,
        treatment,
        description,
        impact,
        calculationMethod,
      });
    }
  }
  
  return cfoItems;
}

/**
 * Calculate the CFO impact for a specific BS item in a given year
 */
export function calculateCFOImpactForBSItem(
  row: Row,
  year: string,
  previousYear: string | null,
  impact: "positive" | "negative" | "neutral",
  method: "change" | "direct" | "calculated"
): number {
  const currentValue = row.values?.[year] ?? 0;
  
  if (method === "change" && previousYear) {
    const previousValue = row.values?.[previousYear] ?? 0;
    const change = currentValue - previousValue;
    
    // For positive impact items (like deferred revenue), increases = positive CF
    // For negative impact items (like operating leases), increases = negative CF
    if (impact === "positive") {
      return change; // Increase in liability = positive CF
    } else if (impact === "negative") {
      return -change; // Increase in liability = negative CF
    } else {
      return change; // Neutral - just show the change
    }
  } else if (method === "direct") {
    return impact === "negative" ? -currentValue : currentValue;
  } else {
    // Calculated - would need custom logic per item
    return 0;
  }
}
