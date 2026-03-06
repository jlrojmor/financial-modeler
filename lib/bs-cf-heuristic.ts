/**
 * Keyword heuristic to suggest cash flow behavior for custom BS rows when glossary has no match.
 * Used after glossary lookup; if both return null, caller should set "unclassified".
 */

export type SuggestedCashFlowBehavior = "working_capital" | "investing" | "financing" | "non_cash";

const LOWER_LABEL = (s: string) => s.toLowerCase();

/** Investing: restricted cash, marketable securities, investments, strategic investments, etc. */
const INVESTING_PATTERNS = [
  "restricted",
  "marketable",
  "investment",
  "strategic invest",
  "ppe",
  "property plant",
  "equipment",
  "intangible",
  "goodwill",
  "right-of-use",
  "rou asset",
  "lease asset",
];

/** Financing: debt, borrowings, lease liability (financing), stock, equity (issuance/repurchase). */
const FINANCING_PATTERNS = [
  "debt",
  "borrowing",
  "loan",
  "bond",
  "lease liability",
  "finance lease",
  "short-term debt",
  "long-term debt",
  "common stock",
  "apic",
  "treasury",
  "preferred stock",
  "dividend payable",
];

/** Working capital: receivables, payables, inventory, prepaid, accrued, deferred revenue, other current. */
const WORKING_CAPITAL_PATTERNS = [
  "receivable",
  "payable",
  "inventory",
  "prepaid",
  "accrued",
  "deferred revenue",
  "unearned",
  "other current",
  "current asset",
  "current liab",
];

/**
 * Suggest cash flow behavior from row label (e.g. "Restricted cash", "Marketable securities").
 * Returns null if no keyword match so caller can set "unclassified".
 */
export function suggestCashFlowBehaviorFromLabel(label: string): SuggestedCashFlowBehavior | null {
  const lower = LOWER_LABEL(label);
  for (const p of WORKING_CAPITAL_PATTERNS) {
    if (lower.includes(p)) return "working_capital";
  }
  for (const p of INVESTING_PATTERNS) {
    if (lower.includes(p)) return "investing";
  }
  for (const p of FINANCING_PATTERNS) {
    if (lower.includes(p)) return "financing";
  }
  return null;
}
