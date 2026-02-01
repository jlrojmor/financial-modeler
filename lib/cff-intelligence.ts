/**
 * CFF Intelligence Engine
 * 
 * Provides suggestions and validation for Cash Flow from Financing Activities (CFF) items.
 * Common CFF items include debt issuance/repayment, equity issuance, dividends, share repurchases, etc.
 */

export interface CFFItem {
  label: string;
  description: string;
  impact: "positive" | "negative"; // Positive = cash inflow, Negative = cash outflow
  commonNames: string[]; // Alternative names for this item
  category: "debt" | "equity" | "dividends" | "share_repurchases" | "other";
}

/**
 * Common CFF items with their standard treatments
 */
export const COMMON_CFF_ITEMS: CFFItem[] = [
  {
    label: "Debt Issuance",
    description: "Cash received from issuing new debt (bonds, loans, notes). Typically positive (cash inflow).",
    impact: "positive",
    commonNames: [
      "debt issuance",
      "debt issued",
      "proceeds from debt",
      "proceeds from debt issuance",
      "borrowings",
      "new debt",
      "debt proceeds",
    ],
    category: "debt",
  },
  {
    label: "Debt Repayment",
    description: "Cash used to repay debt principal. Typically negative (cash outflow).",
    impact: "negative",
    commonNames: [
      "debt repayment",
      "debt repaid",
      "repayment of debt",
      "debt principal repayment",
      "principal repayment",
      "debt paydown",
    ],
    category: "debt",
  },
  {
    label: "Equity Issuance",
    description: "Cash received from issuing new equity (common stock, preferred stock). Typically positive (cash inflow).",
    impact: "positive",
    commonNames: [
      "equity issuance",
      "equity issued",
      "proceeds from equity",
      "proceeds from equity issuance",
      "stock issuance",
      "common stock issuance",
      "preferred stock issuance",
      "capital contributions",
    ],
    category: "equity",
  },
  {
    label: "Dividends Paid",
    description: "Cash paid to shareholders as dividends. Typically negative (cash outflow).",
    impact: "negative",
    commonNames: [
      "dividends paid",
      "dividends",
      "cash dividends",
      "dividend payments",
      "common dividends",
      "preferred dividends",
    ],
    category: "dividends",
  },
  {
    label: "Share Repurchases",
    description: "Cash used to repurchase company shares (treasury stock). Typically negative (cash outflow).",
    impact: "negative",
    commonNames: [
      "share repurchases",
      "stock repurchases",
      "share buybacks",
      "stock buybacks",
      "treasury stock purchases",
      "repurchase of common stock",
      "repurchase of shares",
    ],
    category: "share_repurchases",
  },
  {
    label: "Proceeds from Exercise of Stock Options",
    description: "Cash received from employees exercising stock options. Typically positive (cash inflow).",
    impact: "positive",
    commonNames: [
      "proceeds from exercise of stock options",
      "stock option exercises",
      "option exercises",
      "proceeds from options",
      "exercise of options",
    ],
    category: "equity",
  },
  {
    label: "Repayment of Finance Lease Obligations",
    description: "Cash used to repay finance lease obligations (principal portion). Typically negative (cash outflow).",
    impact: "negative",
    commonNames: [
      "repayment of finance lease obligations",
      "finance lease repayments",
      "lease obligation repayments",
      "capital lease repayments",
    ],
    category: "debt",
  },
  {
    label: "Proceeds from Borrowings",
    description: "Cash received from new borrowings (revolvers, credit lines, etc.). Typically positive (cash inflow).",
    impact: "positive",
    commonNames: [
      "proceeds from borrowings",
      "borrowings",
      "new borrowings",
      "credit line borrowings",
      "revolver borrowings",
      "drawdowns",
    ],
    category: "debt",
  },
  {
    label: "Repayment of Borrowings",
    description: "Cash used to repay borrowings (revolvers, credit lines, etc.). Typically negative (cash outflow).",
    impact: "negative",
    commonNames: [
      "repayment of borrowings",
      "borrowing repayments",
      "credit line repayments",
      "revolver repayments",
      "paydowns",
    ],
    category: "debt",
  },
  {
    label: "Distributions to Non-Controlling Interests",
    description: "Cash paid to non-controlling interest holders. Typically negative (cash outflow).",
    impact: "negative",
    commonNames: [
      "distributions to non-controlling interests",
      "non-controlling interest distributions",
      "minority interest distributions",
      "nci distributions",
    ],
    category: "other",
  },
  {
    label: "Contributions from Non-Controlling Interests",
    description: "Cash received from non-controlling interest holders. Typically positive (cash inflow).",
    impact: "positive",
    commonNames: [
      "contributions from non-controlling interests",
      "non-controlling interest contributions",
      "minority interest contributions",
      "nci contributions",
    ],
    category: "other",
  },
  {
    label: "Other Financing Activities",
    description: "Other cash flows from financing activities not classified elsewhere. Can be positive or negative.",
    impact: "negative", // Default, but can vary
    commonNames: [
      "other financing",
      "other financing activities",
      "other financing cash flows",
    ],
    category: "other",
  },
];

/**
 * Normalize a label for matching (lowercase, remove special chars, etc.)
 */
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find a matching CFF item for a given label
 * Uses fuzzy matching to recognize common variations
 */
export function findCFFItem(label: string): CFFItem | null {
  const normalized = normalizeLabel(label);
  
  for (const item of COMMON_CFF_ITEMS) {
    // Check exact match on label
    if (normalizeLabel(item.label) === normalized) {
      return item;
    }
    
    // Check common names
    for (const commonName of item.commonNames) {
      if (normalizeLabel(commonName) === normalized) {
        return item;
      }
    }
    
    // Check if label contains any common name
    for (const commonName of item.commonNames) {
      const normalizedCommon = normalizeLabel(commonName);
      if (normalized.includes(normalizedCommon) || normalizedCommon.includes(normalized)) {
        return item;
      }
    }
  }
  
  return null;
}

/**
 * Validate if a custom label makes sense for CFF
 * Returns validation result with suggestions
 */
export function validateCFFItem(label: string): {
  isValid: boolean;
  matchedItem: CFFItem | null;
  suggestion: string | null;
  reason: string | null;
} {
  const matchedItem = findCFFItem(label);
  
  if (matchedItem) {
    return {
      isValid: true,
      matchedItem,
      suggestion: null,
      reason: `Recognized as "${matchedItem.label}". This is a standard CFF item.`,
    };
  }
  
  // Check if it sounds like it belongs in CFF
  const normalized = normalizeLabel(label);
  const cffKeywords = [
    "debt", "loan", "borrowing", "repayment", "equity", "dividend", "share", "stock",
    "repurchase", "buyback", "issuance", "proceeds", "financing", "lease", "option",
    "contribution", "distribution", "non-controlling", "minority",
  ];
  
  const hasCFFKeywords = cffKeywords.some(keyword => normalized.includes(keyword));
  
  if (hasCFFKeywords) {
    return {
      isValid: true,
      matchedItem: null,
      suggestion: null,
      reason: "Contains financing-related keywords. This may be a valid CFF item, but please verify it's not better suited for CFO or CFI.",
    };
  }
  
  // Check if it sounds like it belongs elsewhere
  const cfoKeywords = ["operating", "working capital", "depreciation", "amortization", "sbc", "compensation"];
  const cfiKeywords = ["capex", "capital", "expenditure", "acquisition", "disposal", "investment", "security", "ppe"];
  
  const hasCFOKeywords = cfoKeywords.some(keyword => normalized.includes(keyword));
  const hasCFIKeywords = cfiKeywords.some(keyword => normalized.includes(keyword));
  
  if (hasCFOKeywords) {
    return {
      isValid: false,
      matchedItem: null,
      suggestion: "Consider adding this to Cash Flow from Operations (CFO) instead.",
      reason: "This item contains operating-related keywords and may be better suited for CFO.",
    };
  }
  
  if (hasCFIKeywords) {
    return {
      isValid: false,
      matchedItem: null,
      suggestion: "Consider adding this to Cash Flow from Investing (CFI) instead.",
      reason: "This item contains investing-related keywords and may be better suited for CFI.",
    };
  }
  
  // Unknown item - warn but allow
  return {
    isValid: false,
    matchedItem: null,
    suggestion: "This term is not recognized as a standard CFF item. Please verify it belongs in Financing Activities.",
    reason: "Unrecognized term. Please review to ensure it's appropriate for CFF.",
  };
}

/**
 * Get suggested CFF items that are commonly used but not yet added
 */
export function getSuggestedCFFItems(existingItemIds: string[]): CFFItem[] {
  const existingLabels = existingItemIds.map(id => id.toLowerCase());
  
  return COMMON_CFF_ITEMS.filter(item => {
    const itemId = item.label.toLowerCase().replace(/[^a-z0-9]/g, "_");
    return !existingLabels.includes(itemId) && !existingLabels.some(existing => 
      item.commonNames.some(name => normalizeLabel(name) === normalizeLabel(existing))
    );
  });
}
