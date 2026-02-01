/**
 * CFI Intelligence Engine
 * 
 * Provides suggestions and validation for Cash Flow from Investing Activities (CFI) items.
 * Common CFI items include CapEx, acquisitions, disposals, investments, etc.
 */

export interface CFIItem {
  label: string;
  description: string;
  impact: "positive" | "negative"; // Positive = cash inflow, Negative = cash outflow
  commonNames: string[]; // Alternative names for this item
  category: "capex" | "acquisitions" | "disposals" | "investments" | "other";
}

/**
 * Common CFI items with their standard treatments
 */
export const COMMON_CFI_ITEMS: CFIItem[] = [
  {
    label: "Capital Expenditures (CapEx)",
    description: "Cash used for purchases of property, plant, and equipment (PP&E). Typically negative (cash outflow).",
    impact: "negative",
    commonNames: ["capex", "capital expenditures", "capital spending", "capex spending", "pp&e purchases", "property plant equipment"],
    category: "capex",
  },
  {
    label: "Acquisitions",
    description: "Cash used for business acquisitions. Typically negative (cash outflow).",
    impact: "negative",
    commonNames: ["acquisitions", "business acquisitions", "m&a", "mergers and acquisitions", "acquisition of businesses"],
    category: "acquisitions",
  },
  {
    label: "Disposals / Divestitures",
    description: "Cash received from sale or disposal of assets or businesses. Typically positive (cash inflow).",
    impact: "positive",
    commonNames: ["disposals", "divestitures", "sale of assets", "asset sales", "business divestitures", "proceeds from disposals"],
    category: "disposals",
  },
  {
    label: "Purchase of Marketable Securities",
    description: "Cash used to purchase marketable securities or investments. Typically negative (cash outflow).",
    impact: "negative",
    commonNames: ["purchase of marketable securities", "purchase of investments", "investment purchases", "securities purchases"],
    category: "investments",
  },
  {
    label: "Sale of Marketable Securities",
    description: "Cash received from sale of marketable securities or investments. Typically positive (cash inflow).",
    impact: "positive",
    commonNames: ["sale of marketable securities", "sale of investments", "investment sales", "securities sales", "proceeds from sale of investments"],
    category: "investments",
  },
  {
    label: "Maturities of Marketable Securities",
    description: "Cash received from maturities of marketable securities (when bonds or other securities reach their maturity date). Typically positive (cash inflow).",
    impact: "positive",
    commonNames: [
      "maturities of marketable securities",
      "maturity of marketable securities",
      "securities maturities",
      "maturities of investments",
      "maturity of investments",
      "proceeds from maturities",
      "proceeds from securities maturities",
    ],
    category: "investments",
  },
  {
    label: "Purchase of Intangible Assets",
    description: "Cash used for purchases of intangible assets (excluding goodwill from acquisitions). Typically negative (cash outflow).",
    impact: "negative",
    commonNames: ["purchase of intangible assets", "intangible asset purchases", "intellectual property purchases"],
    category: "capex",
  },
  {
    label: "Proceeds from Sale of PP&E",
    description: "Cash received from sale of property, plant, and equipment. Typically positive (cash inflow).",
    impact: "positive",
    commonNames: ["proceeds from sale of ppe", "proceeds from sale of property plant equipment", "sale of ppe", "pp&e sales"],
    category: "disposals",
  },
  {
    label: "Investments in Affiliates",
    description: "Cash used for investments in equity-accounted affiliates or joint ventures. Typically negative (cash outflow).",
    impact: "negative",
    commonNames: ["investments in affiliates", "investments in joint ventures", "equity investments", "affiliate investments"],
    category: "investments",
  },
  {
    label: "Proceeds from Investments in Affiliates",
    description: "Cash received from sale or return of investments in affiliates. Typically positive (cash inflow).",
    impact: "positive",
    commonNames: ["proceeds from investments in affiliates", "proceeds from joint ventures", "proceeds from equity investments"],
    category: "investments",
  },
  {
    label: "Purchases of Strategic Investments",
    description: "Cash used for purchases of strategic investments (non-marketable securities, equity stakes, etc.). Typically negative (cash outflow).",
    impact: "negative",
    commonNames: [
      "purchases of strategic investments",
      "purchase of strategic investments",
      "strategic investment purchases",
      "purchases of investments",
      "purchase of other investments",
      "other investment purchases",
      "strategic investments purchased",
    ],
    category: "investments",
  },
  {
    label: "Sales of Strategic Investments",
    description: "Cash received from sales of strategic investments. Typically positive (cash inflow).",
    impact: "positive",
    commonNames: [
      "sales of strategic investments",
      "sale of strategic investments",
      "strategic investment sales",
      "sales of investments",
      "sale of other investments",
      "other investment sales",
      "strategic investments sold",
      "proceeds from sale of strategic investments",
      "proceeds from sale of investments",
    ],
    category: "investments",
  },
  {
    label: "Cash Acquired in Acquisitions, Net",
    description: "Net cash acquired in business acquisitions (cash acquired minus cash paid). Can be positive or negative. Typically negative (cash outflow).",
    impact: "negative",
    commonNames: [
      "cash acquired in acquisitions",
      "cash acquired net",
      "net cash acquired",
      "cash acquired in business combinations",
      "cash acquired in mergers",
    ],
    category: "acquisitions",
  },
  {
    label: "Proceeds from Sale of Businesses",
    description: "Cash received from sale or divestiture of business segments or subsidiaries. Typically positive (cash inflow).",
    impact: "positive",
    commonNames: [
      "proceeds from sale of businesses",
      "proceeds from divestitures",
      "proceeds from sale of subsidiaries",
      "sale of businesses",
      "business divestitures",
      "proceeds from business disposals",
    ],
    category: "disposals",
  },
  {
    label: "Purchase of Other Investments",
    description: "Cash used for purchases of other investments not classified elsewhere. Typically negative (cash outflow).",
    impact: "negative",
    commonNames: [
      "purchase of other investments",
      "other investment purchases",
      "purchases of other investments",
      "other investments purchased",
    ],
    category: "investments",
  },
  {
    label: "Proceeds from Sale of Other Investments",
    description: "Cash received from sale of other investments. Typically positive (cash inflow).",
    impact: "positive",
    commonNames: [
      "proceeds from sale of other investments",
      "sale of other investments",
      "other investment sales",
      "sales of other investments",
    ],
    category: "investments",
  },
  {
    label: "Capitalized Software Development Costs",
    description: "Cash used for capitalized software development costs (internal use software, website development, etc.). Typically negative (cash outflow).",
    impact: "negative",
    commonNames: [
      "capitalized software development",
      "capitalized software costs",
      "software development capitalized",
      "capitalized development costs",
      "internal use software",
      "website development capitalized",
    ],
    category: "capex",
  },
  {
    label: "Purchase of Business Assets",
    description: "Cash used for purchases of business assets (excluding PP&E and acquisitions). Typically negative (cash outflow).",
    impact: "negative",
    commonNames: [
      "purchase of business assets",
      "business asset purchases",
      "purchases of business assets",
    ],
    category: "capex",
  },
  {
    label: "Proceeds from Sale of Business Assets",
    description: "Cash received from sale of business assets. Typically positive (cash inflow).",
    impact: "positive",
    commonNames: [
      "proceeds from sale of business assets",
      "sale of business assets",
      "business asset sales",
    ],
    category: "disposals",
  },
  {
    label: "Other Investing Activities",
    description: "Other cash flows from investing activities not classified elsewhere. Can be positive or negative.",
    impact: "negative", // Default, but can vary
    commonNames: ["other investing", "other investing activities", "other investing cash flows"],
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
 * Find a matching CFI item for a given label
 * Uses fuzzy matching to recognize common variations
 */
export function findCFIItem(label: string): CFIItem | null {
  const normalized = normalizeLabel(label);
  
  for (const item of COMMON_CFI_ITEMS) {
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
 * Validate if a custom label makes sense for CFI
 * Returns validation result with suggestions
 */
export function validateCFIItem(label: string): {
  isValid: boolean;
  matchedItem: CFIItem | null;
  suggestion: string | null;
  reason: string | null;
} {
  const matchedItem = findCFIItem(label);
  
  if (matchedItem) {
    return {
      isValid: true,
      matchedItem,
      suggestion: null,
      reason: `Recognized as "${matchedItem.label}". This is a standard CFI item.`,
    };
  }
  
  // Check if it sounds like it belongs in CFI
  const normalized = normalizeLabel(label);
  const cfiKeywords = [
    "capex", "capital", "expenditure", "acquisition", "disposal", "divestiture",
    "investment", "security", "ppe", "property", "plant", "equipment",
    "intangible", "asset", "sale", "purchase", "proceeds", "affiliate",
  ];
  
  const hasCFIKeywords = cfiKeywords.some(keyword => normalized.includes(keyword));
  
  if (hasCFIKeywords) {
    return {
      isValid: true,
      matchedItem: null,
      suggestion: null,
      reason: "Contains investing-related keywords. This may be a valid CFI item, but please verify it's not better suited for CFO or CFF.",
    };
  }
  
  // Check if it sounds like it belongs elsewhere
  const cfoKeywords = ["operating", "working capital", "depreciation", "amortization", "sbc", "compensation"];
  const cffKeywords = ["debt", "loan", "equity", "dividend", "financing", "repayment", "issuance"];
  
  const hasCFOKeywords = cfoKeywords.some(keyword => normalized.includes(keyword));
  const hasCFFKeywords = cffKeywords.some(keyword => normalized.includes(keyword));
  
  if (hasCFOKeywords) {
    return {
      isValid: false,
      matchedItem: null,
      suggestion: "Consider adding this to Cash Flow from Operations (CFO) instead.",
      reason: "This item contains operating-related keywords and may be better suited for CFO.",
    };
  }
  
  if (hasCFFKeywords) {
    return {
      isValid: false,
      matchedItem: null,
      suggestion: "Consider adding this to Cash Flow from Financing (CFF) instead.",
      reason: "This item contains financing-related keywords and may be better suited for CFF.",
    };
  }
  
  // Unknown item - warn but allow
  return {
    isValid: false,
    matchedItem: null,
    suggestion: "This term is not recognized as a standard CFI item. Please verify it belongs in Investing Activities.",
    reason: "Unrecognized term. Please review to ensure it's appropriate for CFI.",
  };
}

/**
 * Get suggested CFI items that are commonly used but not yet added
 */
export function getSuggestedCFIItems(existingItemIds: string[]): CFIItem[] {
  const existingLabels = existingItemIds.map(id => id.toLowerCase());
  
  return COMMON_CFI_ITEMS.filter(item => {
    const itemId = item.label.toLowerCase().replace(/[^a-z0-9]/g, "_");
    return !existingLabels.includes(itemId) && !existingLabels.some(existing => 
      item.commonNames.some(name => normalizeLabel(name) === normalizeLabel(existing))
    );
  });
}
