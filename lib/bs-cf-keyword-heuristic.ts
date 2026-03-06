/**
 * Simple keyword heuristic to suggest cash-flow behavior for custom BS line labels
 * when glossary has no match. Used on row creation; if no match, set "unclassified".
 */

export type SuggestedBehavior = "working_capital" | "investing" | "financing" | "non_cash";

const WC_KEYWORDS = [
  "receivable", "payable", "prepaid", "accrued", "inventory", "deferred revenue",
  "unearned", "accrual", "payables", "receivables",
];
const INVESTING_KEYWORDS = [
  "restricted cash", "restricted", "escrow", "marketable", "securities",
  "short-term invest", "investment ", "investments", "ppe", "capex", "capital expend",
  "intangible", "goodwill", "equipment", "plant", "property",
];
const FINANCING_KEYWORDS = [
  "debt", "loan", "borrow", "credit facility", "notes payable", "bonds",
  "common stock", "preferred stock", "treasury stock", "apic", "dividend",
  "line of credit", "revolver",
];
const NON_CASH_KEYWORDS = [
  "goodwill", "deferred tax", "other comprehensive", "accumulated other",
  "minority", "noncontrolling", "equity",
];

export function suggestCashFlowBehaviorFromLabel(label: string): SuggestedBehavior | null {
  if (!label || typeof label !== "string") return null;
  const lower = label.toLowerCase().trim();

  for (const k of FINANCING_KEYWORDS) {
    if (lower.includes(k)) return "financing";
  }
  for (const k of INVESTING_KEYWORDS) {
    if (lower.includes(k)) return "investing";
  }
  for (const k of WC_KEYWORDS) {
    if (lower.includes(k)) return "working_capital";
  }
  for (const k of NON_CASH_KEYWORDS) {
    if (lower.includes(k)) return "non_cash";
  }

  return null;
}
