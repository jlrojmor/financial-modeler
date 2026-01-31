/**
 * Financial Terms Knowledge Base
 * 
 * Maps common financial terms/concepts to their standard accounting treatments.
 * When users add custom items, the system checks this knowledge base to automatically
 * determine the correct category and Cash Flow Statement treatment.
 */

import type { BalanceSheetCategory } from "./bs-impact-rules";
import type { EquityItemId } from "./equity-mappings";

export interface TermKnowledge {
  // Primary category
  category: BalanceSheetCategory | "income_statement" | "cash_flow";
  
  // CFS treatment (if applicable)
  cfsTreatment?: {
    section: "operating" | "investing" | "financing";
    cfsItemId: string;
    impact: "positive" | "negative" | "neutral" | "calculated";
    description: string;
  };
  
  // IS link (if applicable)
  isLink?: {
    isItemId: string;
    description: string;
  };
  
  // Additional notes
  notes?: string;
}

/**
 * Comprehensive mapping of financial terms to their accounting treatments
 */
export const FINANCIAL_TERMS_KNOWLEDGE: Record<string, TermKnowledge> = {
  // ========== CURRENT ASSETS ==========
  "cash": {
    category: "current_assets",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Cash is the ending balance from Cash Flow Statement. Changes in cash are calculated from Operating + Investing + Financing CF.",
    },
    notes: "Cash & Cash Equivalents includes currency, checking accounts, and highly liquid investments with maturities of 3 months or less.",
  },
  "cash and cash equivalents": {
    category: "current_assets",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Cash is the ending balance from Cash Flow Statement.",
    },
  },
  "marketable securities": {
    category: "current_assets",
    cfsTreatment: {
      section: "investing",
      cfsItemId: "other_investing",
      impact: "calculated",
      description: "Changes in Marketable Securities (short-term investments) flow to Investing Cash Flow. Purchases = negative CF, sales = positive CF.",
    },
    notes: "Marketable securities are short-term investments that can be quickly converted to cash. Includes treasury bills, commercial paper, and other liquid securities.",
  },
  "short-term investments": {
    category: "current_assets",
    cfsTreatment: {
      section: "investing",
      cfsItemId: "other_investing",
      impact: "calculated",
      description: "Changes in Short-Term Investments flow to Investing Cash Flow.",
    },
  },
  "accounts receivable": {
    category: "current_assets",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in Accounts Receivable affect Working Capital. Increases = negative impact on Operating CF (cash tied up in receivables).",
    },
    notes: "Accounts Receivable represents amounts owed by customers for goods/services sold on credit.",
  },
  "ar": {
    category: "current_assets",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in AR affect Working Capital in Operating CF.",
    },
  },
  "inventory": {
    category: "current_assets",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in Inventory affect Working Capital. Increases = negative impact on Operating CF (cash tied up in inventory).",
    },
    notes: "Inventory includes raw materials, work-in-progress, and finished goods ready for sale.",
  },
  "prepaid expenses": {
    category: "current_assets",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in Prepaid Expenses affect Working Capital. Increases = negative impact on Operating CF (cash paid in advance).",
    },
    notes: "Prepaid Expenses are payments made for goods/services to be received in the future (e.g., insurance, rent).",
  },
  "prepaid assets": {
    category: "current_assets",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in Prepaid Assets affect Working Capital in Operating CF.",
    },
  },
  "other current assets": {
    category: "current_assets",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in Other Current Assets affect Working Capital in Operating CF.",
    },
  },
  
  // ========== FIXED / NON-CURRENT ASSETS ==========
  "ppe": {
    category: "fixed_assets",
    cfsTreatment: {
      section: "investing",
      cfsItemId: "capex",
      impact: "negative",
      description: "PP&E additions represent Capital Expenditures, which flow to Investing Cash Flow as negative (cash outflow).",
    },
    isLink: {
      isItemId: "danda",
      description: "Depreciation of PP&E flows to Income Statement and is added back in Operating CF.",
    },
    notes: "Property, Plant & Equipment includes land, buildings, machinery, vehicles, and other long-term physical assets.",
  },
  "property, plant and equipment": {
    category: "fixed_assets",
    cfsTreatment: {
      section: "investing",
      cfsItemId: "capex",
      impact: "negative",
      description: "PP&E additions = CapEx, which flows to Investing CF as negative.",
    },
    isLink: {
      isItemId: "danda",
      description: "Depreciation flows to IS and is added back in Operating CF.",
    },
  },
  "intangible assets": {
    category: "fixed_assets",
    cfsTreatment: {
      section: "investing",
      cfsItemId: "capex",
      impact: "negative",
      description: "Intangible asset additions represent Capital Expenditures, which flow to Investing Cash Flow.",
    },
    isLink: {
      isItemId: "danda",
      description: "Amortization of intangible assets flows to Income Statement and is added back in Operating CF.",
    },
    notes: "Intangible Assets include patents, trademarks, copyrights, software, and goodwill.",
  },
  "goodwill": {
    category: "fixed_assets",
    cfsTreatment: {
      section: "investing",
      cfsItemId: "other_investing",
      impact: "calculated",
      description: "Goodwill changes typically occur from acquisitions and flow to Investing Cash Flow.",
    },
    notes: "Goodwill represents the excess of purchase price over fair value of net assets in an acquisition. It's not amortized but tested for impairment.",
  },
  "long-term investments": {
    category: "fixed_assets",
    cfsTreatment: {
      section: "investing",
      cfsItemId: "other_investing",
      impact: "calculated",
      description: "Changes in Long-Term Investments flow to Investing Cash Flow. Purchases = negative, sales = positive.",
    },
  },
  "other assets": {
    category: "fixed_assets",
    cfsTreatment: {
      section: "investing",
      cfsItemId: "other_investing",
      impact: "calculated",
      description: "Changes in Other Assets may affect Investing Cash Flow depending on the transaction type.",
    },
  },
  
  // ========== CURRENT LIABILITIES ==========
  "accounts payable": {
    category: "current_liabilities",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in Accounts Payable affect Working Capital. Increases = positive impact on Operating CF (cash freed up by delaying payments).",
    },
    notes: "Accounts Payable represents amounts owed to suppliers/vendors for goods/services purchased on credit.",
  },
  "ap": {
    category: "current_liabilities",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in AP affect Working Capital in Operating CF.",
    },
  },
  "short-term debt": {
    category: "current_liabilities",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "debt_issuance",
      impact: "calculated",
      description: "Changes in Short-Term Debt flow to Financing Cash Flow. Increases = Debt Issuance (positive CF), decreases = Repayment (negative CF).",
    },
    notes: "Short-Term Debt includes bank loans, commercial paper, and other obligations due within one year.",
  },
  "accrued expenses": {
    category: "current_liabilities",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in Accrued Expenses affect Working Capital. Increases = positive impact on Operating CF (expenses recognized but not yet paid).",
    },
    notes: "Accrued Expenses include wages payable, interest payable, taxes payable, and other expenses incurred but not yet paid.",
  },
  "accrued liabilities": {
    category: "current_liabilities",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in Accrued Liabilities affect Working Capital in Operating CF.",
    },
  },
  "deferred revenue": {
    category: "current_liabilities",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in Deferred Revenue affect Working Capital. Increases = positive impact on Operating CF (cash received before revenue recognition).",
    },
    notes: "Deferred Revenue (Unearned Revenue) represents cash received for goods/services not yet delivered. Common in subscription businesses.",
  },
  "unearned revenue": {
    category: "current_liabilities",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in Unearned Revenue affect Working Capital in Operating CF.",
    },
  },
  "other current liabilities": {
    category: "current_liabilities",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "wc_change",
      impact: "calculated",
      description: "Changes in Other Current Liabilities affect Working Capital in Operating CF.",
    },
  },
  
  // ========== NON-CURRENT LIABILITIES ==========
  "long-term debt": {
    category: "non_current_liabilities",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "debt_issuance",
      impact: "calculated",
      description: "Changes in Long-Term Debt flow to Financing Cash Flow. Increases = Debt Issuance (positive CF), decreases = Repayment (negative CF).",
    },
    isLink: {
      isItemId: "interest_expense",
      description: "Interest expense on this debt flows to Income Statement and affects Operating CF.",
    },
    notes: "Long-Term Debt includes bonds, term loans, and other obligations due beyond one year.",
  },
  "lt debt": {
    category: "non_current_liabilities",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "debt_issuance",
      impact: "calculated",
      description: "Changes in LT Debt flow to Financing CF.",
    },
    isLink: {
      isItemId: "interest_expense",
      description: "Interest expense flows to IS.",
    },
  },
  "deferred tax liabilities": {
    category: "non_current_liabilities",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "other_operating",
      impact: "calculated",
      description: "Deferred tax liabilities are non-cash and flow through Operating CF adjustments.",
    },
    notes: "Deferred Tax Liabilities arise when tax expense on IS exceeds taxes actually paid (timing differences).",
  },
  "pension liabilities": {
    category: "non_current_liabilities",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "other_operating",
      impact: "calculated",
      description: "Pension liabilities are non-cash and flow through Operating CF adjustments.",
    },
  },
  "other liabilities": {
    category: "non_current_liabilities",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "other_financing",
      impact: "calculated",
      description: "Changes in Other Liabilities may affect Financing Cash Flow depending on the transaction type.",
    },
  },
  "operating leases": {
    category: "non_current_liabilities",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "other_operating",
      impact: "calculated",
      description: "Operating lease liabilities are non-cash items. Lease payments flow to Operating Cash Flow. Under ASC 842/IFRS 16, operating leases are recorded on the balance sheet as lease liabilities.",
    },
    isLink: {
      isItemId: "other_opex",
      description: "Operating lease expense (rent expense) flows to Income Statement as operating expense.",
    },
    notes: "Operating Leases represent lease obligations for assets (e.g., real estate, equipment). Under ASC 842/IFRS 16, both operating and finance leases are recorded on the balance sheet. Operating lease payments are operating expenses.",
  },
  "lease liabilities": {
    category: "non_current_liabilities",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "other_operating",
      impact: "calculated",
      description: "Lease liabilities (operating leases) are non-cash items. Lease payments flow to Operating Cash Flow.",
    },
    isLink: {
      isItemId: "other_opex",
      description: "Lease expense flows to Income Statement as operating expense.",
    },
  },
  "finance leases": {
    category: "non_current_liabilities",
    cfsTreatment: {
      section: "investing",
      cfsItemId: "capex",
      impact: "negative",
      description: "Finance leases are treated like asset purchases. The leased asset is recorded as PP&E, and lease payments are split between principal (financing) and interest (operating).",
    },
    isLink: {
      isItemId: "danda",
      description: "Finance lease assets are depreciated, and depreciation flows to Income Statement.",
    },
    notes: "Finance Leases (Capital Leases) are treated as asset purchases. The asset is recorded on the balance sheet, and lease payments include both interest (operating CF) and principal repayment (financing CF).",
  },
  "capital leases": {
    category: "non_current_liabilities",
    cfsTreatment: {
      section: "investing",
      cfsItemId: "capex",
      impact: "negative",
      description: "Capital leases are treated like asset purchases, flowing to Investing Cash Flow as CapEx.",
    },
    isLink: {
      isItemId: "danda",
      description: "Capital lease assets are depreciated, and depreciation flows to Income Statement.",
    },
  },
  
  // ========== EQUITY ==========
  "common stock": {
    category: "equity",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "equity_issuance",
      impact: "positive",
      description: "Increases in Common Stock (from new issuances) flow to Financing CF as positive cash inflow.",
    },
    notes: "Common Stock represents the par value of shares outstanding. Increases occur when new shares are issued.",
  },
  "apic": {
    category: "equity",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "equity_issuance",
      impact: "positive",
      description: "Increases in APIC flow to Financing CF as positive cash inflow.",
    },
  },
  "additional paid-in capital": {
    category: "equity",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "equity_issuance",
      impact: "positive",
      description: "Increases in APIC flow to Financing CF as positive cash inflow.",
    },
  },
  "retained earnings": {
    category: "equity",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "net_income",
      impact: "calculated",
      description: "Retained Earnings = Beginning RE + Net Income (Operating CF) - Dividends Paid (Financing CF).",
    },
    isLink: {
      isItemId: "net_income",
      description: "Retained Earnings changes = Net Income - Dividends Paid.",
    },
    notes: "Retained Earnings represents cumulative net income retained in the business (not paid as dividends).",
  },
  "treasury stock": {
    category: "equity",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "share_repurchases",
      impact: "negative",
      description: "Increases in Treasury Stock (share repurchases) flow to Financing CF as negative cash outflow.",
    },
    notes: "Treasury Stock represents company's own stock that has been repurchased. It's a contra-equity account (negative).",
  },
  "aoci": {
    category: "equity",
    cfsTreatment: {
      section: "none",
      impact: "neutral",
      description: "AOCI changes are non-cash and don't flow through Cash Flow Statement.",
    },
    notes: "Accumulated Other Comprehensive Income includes unrealized gains/losses on investments, foreign currency translation, and pension adjustments.",
  },
  "accumulated other comprehensive income": {
    category: "equity",
    cfsTreatment: {
      section: "none",
      impact: "neutral",
      description: "AOCI changes are non-cash and don't affect Cash Flow Statement.",
    },
  },
};

/**
 * Normalize a label for lookup (lowercase, remove special chars, trim)
 */
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, " ") // Replace special chars with spaces
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .trim();
}

/**
 * Find knowledge for a financial term by matching against known terms
 */
export function findTermKnowledge(label: string): TermKnowledge | null {
  const normalized = normalizeLabel(label);
  
  // Direct match
  if (normalized in FINANCIAL_TERMS_KNOWLEDGE) {
    return FINANCIAL_TERMS_KNOWLEDGE[normalized];
  }
  
  // Partial match - check if any known term is contained in the label
  for (const [term, knowledge] of Object.entries(FINANCIAL_TERMS_KNOWLEDGE)) {
    if (normalized.includes(term) || term.includes(normalized)) {
      return knowledge;
    }
  }
  
  // Fuzzy match - check for key words
  const keywords: Record<string, TermKnowledge> = {
    "marketable": {
      category: "current_assets",
      cfsTreatment: {
        section: "investing",
        cfsItemId: "other_investing",
        impact: "calculated",
        description: "Marketable securities changes flow to Investing Cash Flow.",
      },
    },
    "securities": {
      category: "current_assets",
      cfsTreatment: {
        section: "investing",
        cfsItemId: "other_investing",
        impact: "calculated",
        description: "Securities changes flow to Investing Cash Flow.",
      },
    },
    "prepaid": {
      category: "current_assets",
      cfsTreatment: {
        section: "operating",
        cfsItemId: "wc_change",
        impact: "calculated",
        description: "Prepaid items affect Working Capital in Operating CF.",
      },
    },
    "accrued": {
      category: "current_liabilities",
      cfsTreatment: {
        section: "operating",
        cfsItemId: "wc_change",
        impact: "calculated",
        description: "Accrued items affect Working Capital in Operating CF.",
      },
    },
    "deferred": {
      category: "current_liabilities",
      cfsTreatment: {
        section: "operating",
        cfsItemId: "wc_change",
        impact: "calculated",
        description: "Deferred items affect Working Capital in Operating CF.",
      },
    },
    "lease": {
      category: "non_current_liabilities",
      cfsTreatment: {
        section: "operating",
        cfsItemId: "other_operating",
        impact: "calculated",
        description: "Operating lease liabilities are non-cash items. Lease payments flow to Operating Cash Flow. Under ASC 842/IFRS 16, operating leases are recorded on the balance sheet as lease liabilities.",
      },
      isLink: {
        isItemId: "other_opex",
        description: "Operating lease expense (rent expense) flows to Income Statement as operating expense.",
      },
      notes: "Operating Leases represent lease obligations for assets (e.g., real estate, equipment). Under ASC 842/IFRS 16, both operating and finance leases are recorded on the balance sheet.",
    },
    "leases": {
      category: "non_current_liabilities",
      cfsTreatment: {
        section: "operating",
        cfsItemId: "other_operating",
        impact: "calculated",
        description: "Lease liabilities flow to Operating Cash Flow.",
      },
    },
  };
  
  for (const [keyword, knowledge] of Object.entries(keywords)) {
    if (normalized.includes(keyword)) {
      return knowledge;
    }
  }
  
  return null;
}

/**
 * Get suggested category and treatment for a custom label
 */
export function getSuggestedTreatment(label: string): {
  category?: BalanceSheetCategory;
  cfsLink?: TermKnowledge["cfsTreatment"];
  isLink?: TermKnowledge["isLink"];
  notes?: string;
} {
  const knowledge = findTermKnowledge(label);
  
  if (!knowledge) {
    return {};
  }
  
  return {
    category: knowledge.category as BalanceSheetCategory | undefined,
    cfsLink: knowledge.cfsTreatment,
    isLink: knowledge.isLink,
    notes: knowledge.notes,
  };
}
