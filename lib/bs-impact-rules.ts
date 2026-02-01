/**
 * Balance Sheet Impact Rules
 * 
 * Automatically determines impacts of BS items based on accounting rules.
 * System enforces logic - user doesn't choose impacts.
 */

import type { Row } from "@/types/finance";
import { EQUITY_ITEMS, type EquityItemId, getCfsTreatmentForEquityItem } from "./equity-mappings";

export type BalanceSheetCategory = 
  | "current_assets"
  | "fixed_assets"
  | "current_liabilities"
  | "non_current_liabilities"
  | "equity";

export interface BSItemImpact {
  // Balance Sheet impacts (automatic)
  affectsTotalCurrentAssets?: boolean;
  affectsTotalAssets?: boolean;
  affectsTotalCurrentLiabilities?: boolean;
  affectsTotalLiabilities?: boolean;
  affectsTotalEquity?: boolean;
  affectsTotalLiabAndEquity?: boolean;
  
  // Cash Flow Statement impacts (automatic based on category)
  cfsLink?: {
    section: "operating" | "investing" | "financing";
    cfsItemId: string;
    impact: "positive" | "negative" | "neutral" | "calculated";
    description: string;
  };
  
  // Income Statement links (if applicable)
  isLink?: {
    isItemId: string; // ID of IS item this links to
    description: string;
  };
}

/**
 * Determine automatic impacts for a Balance Sheet item based on its category
 */
export function getBSItemImpacts(
  category: BalanceSheetCategory,
  itemId?: string,
  label?: string
): BSItemImpact {
  const impact: BSItemImpact = {};
  
  switch (category) {
    case "current_assets":
      impact.affectsTotalCurrentAssets = true;
      impact.affectsTotalAssets = true;
      impact.cfsLink = {
        section: "operating",
        cfsItemId: "wc_change",
        impact: "calculated",
        description: "Changes in Current Assets affect Working Capital, which flows to Operating Cash Flow. Increases in CA = negative impact on CF (cash tied up)."
      };
      break;
      
    case "fixed_assets":
      impact.affectsTotalAssets = true;
      // Check if it's PP&E-related
      if (label?.toLowerCase().includes("ppe") || 
          label?.toLowerCase().includes("property") || 
          label?.toLowerCase().includes("plant") || 
          label?.toLowerCase().includes("equipment") ||
          itemId === "ppe") {
        impact.cfsLink = {
          section: "investing",
          cfsItemId: "capex",
          impact: "negative",
          description: "PP&E additions represent Capital Expenditures, which flow to Investing Cash Flow as negative (cash outflow)."
        };
        // Also link D&A from IS
        impact.isLink = {
          isItemId: "danda",
          description: "Depreciation & Amortization from this PP&E flows to Income Statement and is added back in Operating CF."
        };
      } else if (label?.toLowerCase().includes("intangible") || itemId === "intangible_assets") {
        impact.cfsLink = {
          section: "investing",
          cfsItemId: "capex",
          impact: "negative",
          description: "Intangible asset additions represent Capital Expenditures, which flow to Investing Cash Flow."
        };
        impact.isLink = {
          isItemId: "danda",
          description: "Amortization of intangible assets flows to Income Statement and is added back in Operating CF."
        };
      } else {
        // Other fixed assets (investments, etc.) - usually no direct CFS impact
        impact.cfsLink = {
          section: "investing",
          cfsItemId: "other_investing",
          impact: "calculated",
          description: "Changes in other fixed assets may affect Investing Cash Flow depending on the transaction type."
        };
      }
      break;
      
    case "current_liabilities":
      impact.affectsTotalCurrentLiabilities = true;
      impact.affectsTotalLiabilities = true;
      impact.cfsLink = {
        section: "operating",
        cfsItemId: "wc_change",
        impact: "calculated",
        description: "Changes in Current Liabilities affect Working Capital, which flows to Operating Cash Flow. Increases in CL = positive impact on CF (cash freed up)."
      };
      break;
      
    case "non_current_liabilities":
      impact.affectsTotalLiabilities = true;
      // Check if it's Long-term Debt
      if (label?.toLowerCase().includes("debt") || 
          label?.toLowerCase().includes("loan") ||
          itemId === "lt_debt") {
        impact.cfsLink = {
          section: "financing",
          cfsItemId: "debt_issuance", // Or debt_repayment depending on direction
          impact: "calculated",
          description: "Changes in Long-term Debt flow to Financing Cash Flow. Increases = Debt Issuance (positive CF). Decreases = Debt Repayment (negative CF)."
        };
        // Also link Interest Expense from IS
        impact.isLink = {
          isItemId: "interest_expense",
          description: "Interest expense on this debt flows to Income Statement and affects Operating CF (added back as non-cash, but interest paid is financing)."
        };
      } else if (label?.toLowerCase().includes("deferred tax")) {
        impact.cfsLink = {
          section: "operating",
          cfsItemId: "other_operating",
          impact: "calculated",
          description: "Deferred tax liabilities are non-cash and flow through Operating CF adjustments."
        };
      } else {
        // Other non-current liabilities
        impact.cfsLink = {
          section: "financing",
          cfsItemId: "other_financing",
          impact: "calculated",
          description: "Changes in other non-current liabilities may affect Financing Cash Flow depending on the transaction type."
        };
      }
      break;
      
    case "equity":
      impact.affectsTotalEquity = true;
      impact.affectsTotalLiabAndEquity = true;
      
      // Check if it's a known equity item
      if (itemId && itemId in EQUITY_ITEMS) {
        const equityItem = EQUITY_ITEMS[itemId as EquityItemId];
        const cfsTreatment = getCfsTreatmentForEquityItem(itemId as EquityItemId);
        
        if (cfsTreatment && cfsTreatment.cfsItemId) {
          impact.cfsLink = {
            section: cfsTreatment.section as "operating" | "investing" | "financing",
            cfsItemId: cfsTreatment.cfsItemId,
            impact: cfsTreatment.impact as "positive" | "negative" | "neutral" | "calculated",
            description: cfsTreatment.notes,
          };
        }
        
        // Special handling for Retained Earnings
        if (itemId === "retained_earnings") {
          impact.isLink = {
            isItemId: "net_income",
            description: "Retained Earnings = Beginning RE + Net Income (from IS) - Dividends Paid (from CFS)."
          };
        }
      } else {
        // Generic equity item - default to equity issuance
        impact.cfsLink = {
          section: "financing",
          cfsItemId: "equity_issuance",
          impact: "positive",
          description: "Increases in equity typically represent equity issuances, which flow to Financing Cash Flow as positive (cash inflow)."
        };
      }
      break;
  }
  
  return impact;
}

/**
 * Get standard suggestions for a Balance Sheet category
 * @param category - The Balance Sheet category
 * @param companyType - Optional company type to customize suggestions (public vs private)
 */
export function getBSCategorySuggestions(
  category: BalanceSheetCategory,
  companyType?: "public" | "private"
): Array<{ id: string; label: string; description?: string }> {
  switch (category) {
    case "current_assets":
      return [
        { id: "cash", label: "Cash & Cash Equivalents" },
        { id: "short_term_investments", label: "Short-Term Investments" },
        { id: "ar", label: "Accounts Receivable" },
        { id: "inventory", label: "Inventory" },
        { id: "prepaid_expenses", label: "Prepaid Expenses" },
        { id: "other_ca", label: "Other Current Assets" },
      ];
      
    case "fixed_assets":
      return [
        { id: "ppe", label: "Property, Plant & Equipment (PP&E)" },
        { id: "intangible_assets", label: "Intangible Assets" },
        { id: "goodwill", label: "Goodwill" },
        { id: "long_term_investments", label: "Long-Term Investments" },
        { id: "other_assets", label: "Other Assets" },
      ];
      
    case "current_liabilities":
      return [
        { id: "ap", label: "Accounts Payable" },
        { id: "st_debt", label: "Short-Term Debt" },
        { id: "accrued_expenses", label: "Accrued Expenses" },
        { id: "deferred_revenue", label: "Deferred Revenue" },
        { id: "other_cl", label: "Other Current Liabilities" },
      ];
      
    case "non_current_liabilities":
      return [
        { id: "lt_debt", label: "Long-Term Debt" },
        { id: "deferred_tax_liabilities", label: "Deferred Tax Liabilities" },
        { id: "pension_liabilities", label: "Pension Liabilities" },
        { id: "other_liab", label: "Other Long-Term Liabilities" },
      ];
      
    case "equity":
      // For public companies, show full 10-K equity structure
      // For private companies, show simplified options + standard items
      if (companyType === "public") {
        return getStandardEquityItems().map(item => ({
          id: item.id,
          label: item.label,
          description: item.description,
        }));
      } else {
        // Private company: simplified equity options
        return [
          { id: "members_equity", label: "Members' Equity", description: "For LLCs - total equity of members" },
          { id: "partners_capital", label: "Partners' Capital", description: "For partnerships - total capital contributions" },
          { id: "owners_equity", label: "Owner's Equity", description: "Simple equity structure for private corporations" },
          { id: "retained_earnings", label: "Retained Earnings", description: "Cumulative net income - dividends paid" },
          // Also include standard items in case they apply
          ...getStandardEquityItems()
            .filter(item => ["retained_earnings", "aoci"].includes(item.id))
            .map(item => ({
              id: item.id,
              label: item.label,
              description: item.description,
            })),
        ];
      }
      
    default:
      return [];
  }
}

/**
 * Get standard equity items (helper function)
 */
function getStandardEquityItems() {
  return Object.values(EQUITY_ITEMS).filter(item => item.isStandard);
}
