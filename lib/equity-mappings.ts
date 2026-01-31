/**
 * Shareholders' Equity Line Items & Cash Flow Statement Mappings
 * 
 * Based on standard 10-K filings and accounting rules, this maps each equity item
 * to its automatic CFS treatment. The system enforces accounting logic, not user choice.
 */

export type EquityItemId = 
  | "common_stock"
  | "apic"
  | "retained_earnings"
  | "treasury_stock"
  | "aoci"
  | "non_controlling_interest"
  | "preferred_stock"
  | "stock_based_comp_equity"
  | "dividends_declared"
  | "dividends_paid"
  | "share_repurchases"
  | "stock_splits"
  | "other_comprehensive_income"
  | "accumulated_deficit"
  | "restricted_stock"
  | "stock_options"
  | "warrants"
  | "convertible_preferred"
  | "mezzanine_equity";

export interface EquityItemDefinition {
  id: EquityItemId;
  label: string;
  description: string;
  cfsTreatment: {
    section: "operating" | "investing" | "financing" | "none";
    cfsItemId?: string; // ID of the CFS line item this links to
    impact: "positive" | "negative" | "neutral" | "calculated";
    formula?: string; // For calculated items (e.g., Retained Earnings = Net Income - Dividends)
    notes: string; // Explanation of the treatment
  };
  isStandard: boolean; // True for items that appear in most 10-Ks
}

/**
 * Standard Shareholders' Equity items from 10-K filings
 * with their automatic Cash Flow Statement treatments
 */
export const EQUITY_ITEMS: Record<EquityItemId, EquityItemDefinition> = {
  // === CONTRIBUTED CAPITAL ===
  common_stock: {
    id: "common_stock",
    label: "Common Stock (Par Value)",
    description: "Par value of common stock outstanding",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "equity_issuance",
      impact: "positive",
      notes: "Increases in Common Stock (from new issuances) flow to Financing CF as positive cash inflow. Decreases (rare) would be negative."
    },
    isStandard: true,
  },
  
  apic: {
    id: "apic",
    label: "Additional Paid-in Capital (APIC)",
    description: "Amount paid in excess of par value for common stock",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "equity_issuance",
      impact: "positive",
      notes: "Increases in APIC (from stock issuances above par) flow to Financing CF as positive cash inflow."
    },
    isStandard: true,
  },
  
  preferred_stock: {
    id: "preferred_stock",
    label: "Preferred Stock",
    description: "Par value of preferred stock outstanding",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "equity_issuance",
      impact: "positive",
      notes: "Increases in Preferred Stock flow to Financing CF as positive cash inflow."
    },
    isStandard: true,
  },
  
  convertible_preferred: {
    id: "convertible_preferred",
    label: "Convertible Preferred Stock",
    description: "Preferred stock that can be converted to common stock",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "equity_issuance",
      impact: "positive",
      notes: "Increases flow to Financing CF. Conversion to common (non-cash) doesn't affect CF."
    },
    isStandard: false,
  },
  
  mezzanine_equity: {
    id: "mezzanine_equity",
    label: "Mezzanine Equity",
    description: "Hybrid debt/equity instruments (e.g., convertible debt, warrants)",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "equity_issuance",
      impact: "positive",
      notes: "Increases flow to Financing CF. Conversion to equity (non-cash) doesn't affect CF."
    },
    isStandard: false,
  },
  
  // === RETAINED EARNINGS & ACCUMULATED DEFICIT ===
  retained_earnings: {
    id: "retained_earnings",
    label: "Retained Earnings",
    description: "Cumulative net income retained in the business (not paid as dividends)",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "net_income",
      impact: "calculated",
      formula: "Retained Earnings = Beginning RE + Net Income - Dividends Paid",
      notes: "Retained Earnings changes = Net Income (Operating CF) - Dividends Paid (Financing CF). System will link to Net Income from IS and track dividends separately."
    },
    isStandard: true,
  },
  
  accumulated_deficit: {
    id: "accumulated_deficit",
    label: "Accumulated Deficit",
    description: "Negative retained earnings (for companies with cumulative losses)",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "net_income",
      impact: "calculated",
      formula: "Accumulated Deficit = Beginning Deficit + Net Loss - Dividends Paid",
      notes: "Same treatment as Retained Earnings, but negative. Net Loss flows through Operating CF."
    },
    isStandard: false,
  },
  
  // === TREASURY STOCK ===
  treasury_stock: {
    id: "treasury_stock",
    label: "Treasury Stock",
    description: "Company's own stock that has been repurchased (negative equity)",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "share_repurchases",
      impact: "negative",
      notes: "Increases in Treasury Stock (share repurchases) flow to Financing CF as negative cash outflow."
    },
    isStandard: true,
  },
  
  share_repurchases: {
    id: "share_repurchases",
    label: "Share Repurchases",
    description: "Cash spent to repurchase company shares (direct CFS line item)",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "share_repurchases",
      impact: "negative",
      notes: "Direct Financing CF outflow. This is the CFS line item itself, not a BS item."
    },
    isStandard: true,
  },
  
  // === DIVIDENDS ===
  dividends_declared: {
    id: "dividends_declared",
    label: "Dividends Declared",
    description: "Dividends declared but not yet paid (liability until paid)",
    cfsTreatment: {
      section: "none",
      impact: "neutral",
      notes: "Dividends Declared is a liability (not equity) until paid. No CFS impact until paid."
    },
    isStandard: false,
  },
  
  dividends_paid: {
    id: "dividends_paid",
    label: "Dividends Paid",
    description: "Cash dividends paid to shareholders (direct CFS line item)",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "dividends",
      impact: "negative",
      notes: "Direct Financing CF outflow. Reduces Retained Earnings. This is the CFS line item itself."
    },
    isStandard: true,
  },
  
  // === OTHER COMPREHENSIVE INCOME ===
  aoci: {
    id: "aoci",
    label: "Accumulated Other Comprehensive Income (AOCI)",
    description: "Cumulative unrealized gains/losses not in net income (foreign currency, pensions, investments)",
    cfsTreatment: {
      section: "none",
      impact: "neutral",
      notes: "AOCI changes are non-cash. They don't flow through Cash Flow Statement (they're already excluded from Net Income)."
    },
    isStandard: true,
  },
  
  other_comprehensive_income: {
    id: "other_comprehensive_income",
    label: "Other Comprehensive Income (OCI)",
    description: "Current period OCI (unrealized gains/losses, foreign currency translation, pension adjustments)",
    cfsTreatment: {
      section: "none",
      impact: "neutral",
      notes: "OCI is non-cash and excluded from Net Income, so no CFS impact. Flows to AOCI on BS."
    },
    isStandard: false,
  },
  
  // === STOCK-BASED COMPENSATION ===
  stock_based_comp_equity: {
    id: "stock_based_comp_equity",
    label: "Stock-Based Compensation (Equity Component)",
    description: "Equity issued for employee compensation (non-cash)",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "net_income",
      impact: "neutral",
      notes: "SBC is a non-cash expense added back in Operating CF. Equity issuance doesn't create cash flow (it's a non-cash transaction)."
    },
    isStandard: false,
  },
  
  restricted_stock: {
    id: "restricted_stock",
    label: "Restricted Stock",
    description: "Restricted stock units (RSUs) granted to employees",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "net_income",
      impact: "neutral",
      notes: "Non-cash compensation. Expense flows through Net Income (added back in Operating CF). Equity issuance is non-cash."
    },
    isStandard: false,
  },
  
  stock_options: {
    id: "stock_options",
    label: "Stock Options",
    description: "Stock options granted to employees (equity component)",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "net_income",
      impact: "neutral",
      notes: "Non-cash compensation. Expense flows through Net Income. Exercise of options (cash) flows to Financing CF."
    },
    isStandard: false,
  },
  
  warrants: {
    id: "warrants",
    label: "Warrants",
    description: "Stock warrants outstanding (right to purchase stock)",
    cfsTreatment: {
      section: "financing",
      cfsItemId: "equity_issuance",
      impact: "positive",
      notes: "Exercise of warrants (cash received) flows to Financing CF. Outstanding warrants (non-cash) have no CFS impact."
    },
    isStandard: false,
  },
  
  // === NON-CONTROLLING INTEREST ===
  non_controlling_interest: {
    id: "non_controlling_interest",
    label: "Non-Controlling Interest (NCI)",
    description: "Equity interest in subsidiaries not owned by parent company",
    cfsTreatment: {
      section: "operating",
      cfsItemId: "net_income",
      impact: "calculated",
      formula: "NCI changes = NCI portion of Net Income - NCI Dividends",
      notes: "NCI portion of Net Income flows through Operating CF. NCI dividends (if paid) flow to Financing CF."
    },
    isStandard: true,
  },
  
  // === OTHER ===
  stock_splits: {
    id: "stock_splits",
    label: "Stock Splits",
    description: "Stock splits (non-cash transaction, changes share count and par value)",
    cfsTreatment: {
      section: "none",
      impact: "neutral",
      notes: "Stock splits are non-cash transactions. They don't affect Cash Flow Statement."
    },
    isStandard: false,
  },
};

/**
 * Get standard equity items (those that appear in most 10-Ks)
 */
export function getStandardEquityItems(): EquityItemDefinition[] {
  return Object.values(EQUITY_ITEMS).filter(item => item.isStandard);
}

/**
 * Get all equity items for a specific category
 */
export function getEquityItemsByCategory(category: "contributed" | "retained" | "treasury" | "comprehensive" | "other"): EquityItemDefinition[] {
  const categoryMap = {
    contributed: ["common_stock", "apic", "preferred_stock", "convertible_preferred", "mezzanine_equity"],
    retained: ["retained_earnings", "accumulated_deficit"],
    treasury: ["treasury_stock", "share_repurchases"],
    comprehensive: ["aoci", "other_comprehensive_income"],
    other: ["non_controlling_interest", "stock_based_comp_equity", "restricted_stock", "stock_options", "warrants", "dividends_paid", "stock_splits"],
  };
  
  const ids = categoryMap[category];
  return ids.map(id => EQUITY_ITEMS[id]).filter(Boolean);
}

/**
 * Get CFS treatment for an equity item
 */
export function getCfsTreatmentForEquityItem(itemId: EquityItemId): EquityItemDefinition["cfsTreatment"] | null {
  return EQUITY_ITEMS[itemId]?.cfsTreatment ?? null;
}

/**
 * Determine if an equity item should auto-create a CFS link
 */
export function shouldCreateCfsLink(itemId: EquityItemId): boolean {
  const treatment = getCfsTreatmentForEquityItem(itemId);
  if (!treatment) return false;
  
  // Only create links for items that have a direct CFS impact
  return treatment.section !== "none" && treatment.cfsItemId !== undefined;
}
