/**
 * Row Taxonomy Layer
 * Defines semantic row type families for IS, BS, and CFS.
 * Provides deterministic taxonomy for template rows and label-based fallback for custom rows.
 * Does NOT touch calculations or completeness logic.
 */

import type { Row } from "@/types/finance";

// ═══════════════════════════════════════════════════════════════════════════════
// INCOME STATEMENT TAXONOMY
// ═══════════════════════════════════════════════════════════════════════════════

/** High-level IS taxonomy category. */
export type ISTaxonomyCategory =
  | "revenue"
  | "cost_of_revenue"
  | "operating_expense"
  | "non_operating"
  | "tax"
  | "calculated";

/** Granular IS taxonomy type within each category. */
export type ISTaxonomyType =
  // Revenue
  | "revenue_product"
  | "revenue_service"
  | "revenue_subscription"
  | "revenue_licensing"
  | "revenue_other"
  // Cost of Revenue
  | "cogs_direct"
  | "cogs_materials"
  | "cogs_labor"
  | "cogs_other"
  // Operating Expenses
  | "opex_sga"
  | "opex_sales_marketing"
  | "opex_general_admin"
  | "opex_rd"
  | "opex_danda"
  | "opex_depreciation"
  | "opex_amortization"
  | "opex_restructuring"
  | "opex_impairment"
  | "opex_sbc"
  | "opex_other"
  // Non-Operating
  | "non_op_interest_expense"
  | "non_op_interest_income"
  | "non_op_investment_gain"
  | "non_op_investment_loss"
  | "non_op_fx_gain"
  | "non_op_fx_loss"
  | "non_op_other_income"
  | "non_op_other_expense"
  // Tax
  | "tax_current"
  | "tax_deferred"
  | "tax_benefit"
  | "tax_expense"
  // Calculated / Subtotals
  | "calc_gross_profit"
  | "calc_ebitda"
  | "calc_ebit"
  | "calc_ebt"
  | "calc_net_income"
  | "calc_margin";

export interface ISTaxonomy {
  category: ISTaxonomyCategory;
  type: ISTaxonomyType;
  label: string;
}

/** Deterministic IS taxonomy by row ID. */
const IS_TAXONOMY_BY_ID: Record<string, ISTaxonomy> = {
  rev: { category: "revenue", type: "revenue_other", label: "Revenue" },
  cogs: { category: "cost_of_revenue", type: "cogs_direct", label: "Cost of Goods Sold" },
  gross_profit: { category: "calculated", type: "calc_gross_profit", label: "Gross Profit" },
  gross_margin: { category: "calculated", type: "calc_margin", label: "Gross Margin" },
  operating_expenses: { category: "operating_expense", type: "opex_other", label: "Operating Expenses" },
  sga: { category: "operating_expense", type: "opex_sga", label: "SG&A" },
  rd: { category: "operating_expense", type: "opex_rd", label: "R&D" },
  other_opex: { category: "operating_expense", type: "opex_other", label: "Other Operating Expenses" },
  danda: { category: "operating_expense", type: "opex_danda", label: "Depreciation & Amortization" },
  ebitda: { category: "calculated", type: "calc_ebitda", label: "EBITDA" },
  ebitda_margin: { category: "calculated", type: "calc_margin", label: "EBITDA Margin" },
  ebit: { category: "calculated", type: "calc_ebit", label: "EBIT" },
  ebit_margin: { category: "calculated", type: "calc_margin", label: "EBIT Margin" },
  interest_expense: { category: "non_operating", type: "non_op_interest_expense", label: "Interest Expense" },
  interest_income: { category: "non_operating", type: "non_op_interest_income", label: "Interest Income" },
  other_income: { category: "non_operating", type: "non_op_other_income", label: "Other Income/Expense" },
  ebt: { category: "calculated", type: "calc_ebt", label: "EBT" },
  ebt_margin: { category: "calculated", type: "calc_margin", label: "EBT Margin" },
  tax: { category: "tax", type: "tax_expense", label: "Income Tax" },
  net_income: { category: "calculated", type: "calc_net_income", label: "Net Income" },
  net_income_margin: { category: "calculated", type: "calc_margin", label: "Net Income Margin" },
};

/** IS taxonomy vocabulary for AI classification. */
export const IS_TAXONOMY_VOCABULARY: ISTaxonomyType[] = [
  "revenue_product", "revenue_service", "revenue_subscription", "revenue_licensing", "revenue_other",
  "cogs_direct", "cogs_materials", "cogs_labor", "cogs_other",
  "opex_sga", "opex_sales_marketing", "opex_general_admin", "opex_rd", "opex_danda",
  "opex_depreciation", "opex_amortization", "opex_restructuring", "opex_impairment", "opex_sbc", "opex_other",
  "non_op_interest_expense", "non_op_interest_income", "non_op_investment_gain", "non_op_investment_loss",
  "non_op_fx_gain", "non_op_fx_loss", "non_op_other_income", "non_op_other_expense",
  "tax_current", "tax_deferred", "tax_benefit", "tax_expense",
];

/** IS category vocabulary. */
export const IS_CATEGORY_VOCABULARY: ISTaxonomyCategory[] = [
  "revenue", "cost_of_revenue", "operating_expense", "non_operating", "tax", "calculated",
];

/** Category labels for UI. */
export const IS_CATEGORY_LABELS: Record<ISTaxonomyCategory, string> = {
  revenue: "Revenue",
  cost_of_revenue: "Cost of Revenue",
  operating_expense: "Operating Expense",
  non_operating: "Non-Operating",
  tax: "Tax",
  calculated: "Calculated",
};

/** Type labels for UI. */
export const IS_TYPE_LABELS: Record<ISTaxonomyType, string> = {
  revenue_product: "Product Revenue",
  revenue_service: "Service Revenue",
  revenue_subscription: "Subscription Revenue",
  revenue_licensing: "Licensing Revenue",
  revenue_other: "Other Revenue",
  cogs_direct: "Direct Costs",
  cogs_materials: "Materials",
  cogs_labor: "Labor",
  cogs_other: "Other COGS",
  opex_sga: "SG&A",
  opex_sales_marketing: "Sales & Marketing",
  opex_general_admin: "General & Administrative",
  opex_rd: "Research & Development",
  opex_danda: "Depreciation & Amortization",
  opex_depreciation: "Depreciation",
  opex_amortization: "Amortization",
  opex_restructuring: "Restructuring",
  opex_impairment: "Impairment",
  opex_sbc: "Stock-Based Compensation",
  opex_other: "Other Operating",
  non_op_interest_expense: "Interest Expense",
  non_op_interest_income: "Interest Income",
  non_op_investment_gain: "Investment Gain",
  non_op_investment_loss: "Investment Loss",
  non_op_fx_gain: "FX Gain",
  non_op_fx_loss: "FX Loss",
  non_op_other_income: "Other Income",
  non_op_other_expense: "Other Expense",
  tax_current: "Current Tax",
  tax_deferred: "Deferred Tax",
  tax_benefit: "Tax Benefit",
  tax_expense: "Tax Expense",
  calc_gross_profit: "Gross Profit",
  calc_ebitda: "EBITDA",
  calc_ebit: "EBIT",
  calc_ebt: "EBT",
  calc_net_income: "Net Income",
  calc_margin: "Margin %",
};

/** Label-based fallback IS taxonomy for custom rows. */
function getFallbackIsTaxonomy(label: string, row: Row): ISTaxonomy {
  const lower = label.toLowerCase();

  // Revenue patterns
  if (/subscription|saas|recurring/.test(lower)) {
    return { category: "revenue", type: "revenue_subscription", label };
  }
  if (/product|hardware|device/.test(lower)) {
    return { category: "revenue", type: "revenue_product", label };
  }
  if (/service|consulting|professional/.test(lower)) {
    return { category: "revenue", type: "revenue_service", label };
  }
  if (/licen[cs]|royalt/.test(lower)) {
    return { category: "revenue", type: "revenue_licensing", label };
  }

  // COGS patterns
  if (/material|raw|component/.test(lower)) {
    return { category: "cost_of_revenue", type: "cogs_materials", label };
  }
  if (/labor|wage|salary/.test(lower) && /cost|cogs|direct/.test(lower)) {
    return { category: "cost_of_revenue", type: "cogs_labor", label };
  }

  // Operating expense patterns
  if (/stock.based|sbc|equity.comp/.test(lower)) {
    return { category: "operating_expense", type: "opex_sbc", label };
  }
  if (/depreciation/.test(lower)) {
    return { category: "operating_expense", type: "opex_depreciation", label };
  }
  if (/amortization/.test(lower)) {
    return { category: "operating_expense", type: "opex_amortization", label };
  }
  if (/d&a|deprec.*amort/.test(lower)) {
    return { category: "operating_expense", type: "opex_danda", label };
  }
  if (/restructur/.test(lower)) {
    return { category: "operating_expense", type: "opex_restructuring", label };
  }
  if (/impair/.test(lower)) {
    return { category: "operating_expense", type: "opex_impairment", label };
  }
  if (/r&d|research|development|product development/.test(lower)) {
    return { category: "operating_expense", type: "opex_rd", label };
  }
  if (/sales|marketing/.test(lower)) {
    return { category: "operating_expense", type: "opex_sales_marketing", label };
  }
  if (/g&a|general|admin/.test(lower)) {
    return { category: "operating_expense", type: "opex_general_admin", label };
  }
  if (/sg&a|selling/.test(lower)) {
    return { category: "operating_expense", type: "opex_sga", label };
  }

  // Non-operating patterns
  if (/interest\s*expense/.test(lower)) {
    return { category: "non_operating", type: "non_op_interest_expense", label };
  }
  if (/interest\s*income/.test(lower)) {
    return { category: "non_operating", type: "non_op_interest_income", label };
  }
  if (/investment\s*gain|gain\s*on\s*investment/.test(lower)) {
    return { category: "non_operating", type: "non_op_investment_gain", label };
  }
  if (/investment\s*loss|loss\s*on\s*investment/.test(lower)) {
    return { category: "non_operating", type: "non_op_investment_loss", label };
  }
  if (/fx\s*gain|foreign\s*exchange\s*gain|currency\s*gain/.test(lower)) {
    return { category: "non_operating", type: "non_op_fx_gain", label };
  }
  if (/fx\s*loss|foreign\s*exchange\s*loss|currency\s*loss/.test(lower)) {
    return { category: "non_operating", type: "non_op_fx_loss", label };
  }
  if (/other\s*income/.test(lower)) {
    return { category: "non_operating", type: "non_op_other_income", label };
  }
  if (/other\s*expense/.test(lower)) {
    return { category: "non_operating", type: "non_op_other_expense", label };
  }

  // Tax patterns
  if (/deferred\s*tax/.test(lower)) {
    return { category: "tax", type: "tax_deferred", label };
  }
  if (/tax\s*benefit/.test(lower)) {
    return { category: "tax", type: "tax_benefit", label };
  }
  if (/tax/.test(lower)) {
    return { category: "tax", type: "tax_expense", label };
  }

  // Use sectionOwner if available
  if (row.sectionOwner === "revenue") {
    return { category: "revenue", type: "revenue_other", label };
  }
  if (row.sectionOwner === "cogs") {
    return { category: "cost_of_revenue", type: "cogs_other", label };
  }
  if (row.sectionOwner === "sga") {
    return { category: "operating_expense", type: "opex_sga", label };
  }
  if (row.sectionOwner === "rd") {
    return { category: "operating_expense", type: "opex_rd", label };
  }
  if (row.sectionOwner === "other_operating" || row.sectionOwner === "operating_expenses") {
    return { category: "operating_expense", type: "opex_other", label };
  }
  if (row.sectionOwner === "non_operating") {
    return { category: "non_operating", type: "non_op_other_expense", label };
  }
  if (row.sectionOwner === "tax") {
    return { category: "tax", type: "tax_expense", label };
  }

  // Default based on isOperating
  if (row.isOperating === true) {
    return { category: "operating_expense", type: "opex_other", label };
  }
  if (row.isOperating === false) {
    return { category: "non_operating", type: "non_op_other_expense", label };
  }

  return { category: "operating_expense", type: "opex_other", label };
}

/** Get IS taxonomy for a row (deterministic for template, fallback for custom). */
export function getIsTaxonomy(row: Row): ISTaxonomy {
  const byId = IS_TAXONOMY_BY_ID[row.id];
  if (byId) return byId;
  return getFallbackIsTaxonomy(row.label, row);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BALANCE SHEET TAXONOMY
// ═══════════════════════════════════════════════════════════════════════════════

/** High-level BS taxonomy category. */
export type BSTaxonomyCategory =
  | "current_asset"
  | "fixed_asset"
  | "current_liability"
  | "non_current_liability"
  | "equity"
  | "calculated";

/** Granular BS taxonomy type within each category. */
export type BSTaxonomyType =
  // Current Assets
  | "asset_cash"
  | "asset_short_term_investments"
  | "asset_receivables"
  | "asset_inventory"
  | "asset_prepaid"
  | "asset_other_current"
  // Fixed Assets
  | "asset_ppe"
  | "asset_intangibles"
  | "asset_goodwill"
  | "asset_rou_assets"
  | "asset_investments"
  | "asset_deferred_tax"
  | "asset_other_fixed"
  // Current Liabilities
  | "liab_payables"
  | "liab_accruals"
  | "liab_deferred_revenue"
  | "liab_short_term_debt"
  | "liab_current_lease"
  | "liab_other_current"
  // Non-Current Liabilities
  | "liab_long_term_debt"
  | "liab_deferred_tax"
  | "liab_pension"
  | "liab_lease_obligations"
  | "liab_other_non_current"
  // Equity
  | "equity_common_stock"
  | "equity_preferred_stock"
  | "equity_apic"
  | "equity_treasury_stock"
  | "equity_retained_earnings"
  | "equity_aoci"
  | "equity_minority_interest"
  | "equity_other"
  // Calculated / Subtotals
  | "calc_total";

export interface BSTaxonomy {
  category: BSTaxonomyCategory;
  type: BSTaxonomyType;
  label: string;
}

/** Deterministic BS taxonomy by row ID. */
const BS_TAXONOMY_BY_ID: Record<string, BSTaxonomy> = {
  // Current Assets
  cash: { category: "current_asset", type: "asset_cash", label: "Cash" },
  ar: { category: "current_asset", type: "asset_receivables", label: "Accounts Receivable" },
  inventory: { category: "current_asset", type: "asset_inventory", label: "Inventory" },
  other_ca: { category: "current_asset", type: "asset_other_current", label: "Other Current Assets" },
  total_current_assets: { category: "calculated", type: "calc_total", label: "Total Current Assets" },
  // Fixed Assets
  ppe: { category: "fixed_asset", type: "asset_ppe", label: "PP&E" },
  intangible_assets: { category: "fixed_asset", type: "asset_intangibles", label: "Intangible Assets" },
  goodwill: { category: "fixed_asset", type: "asset_goodwill", label: "Goodwill" },
  other_assets: { category: "fixed_asset", type: "asset_other_fixed", label: "Other Assets" },
  total_fixed_assets: { category: "calculated", type: "calc_total", label: "Total Fixed Assets" },
  total_assets: { category: "calculated", type: "calc_total", label: "Total Assets" },
  // Current Liabilities
  ap: { category: "current_liability", type: "liab_payables", label: "Accounts Payable" },
  accrued_liabilities: { category: "current_liability", type: "liab_accruals", label: "Accrued Liabilities" },
  deferred_revenue: { category: "current_liability", type: "liab_deferred_revenue", label: "Deferred Revenue" },
  st_debt: { category: "current_liability", type: "liab_short_term_debt", label: "Short-Term Debt" },
  other_cl: { category: "current_liability", type: "liab_other_current", label: "Other Current Liabilities" },
  total_current_liabilities: { category: "calculated", type: "calc_total", label: "Total Current Liabilities" },
  // Non-Current Liabilities
  lt_debt: { category: "non_current_liability", type: "liab_long_term_debt", label: "Long-Term Debt" },
  other_liab: { category: "non_current_liability", type: "liab_other_non_current", label: "Other Liabilities" },
  total_non_current_liabilities: { category: "calculated", type: "calc_total", label: "Total Non-Current Liabilities" },
  total_liabilities: { category: "calculated", type: "calc_total", label: "Total Liabilities" },
  // Equity
  common_stock: { category: "equity", type: "equity_common_stock", label: "Common Stock" },
  apic: { category: "equity", type: "equity_apic", label: "Additional Paid-In Capital" },
  treasury_stock: { category: "equity", type: "equity_treasury_stock", label: "Treasury Stock" },
  retained_earnings: { category: "equity", type: "equity_retained_earnings", label: "Retained Earnings" },
  other_equity: { category: "equity", type: "equity_other", label: "Other Equity" },
  total_equity: { category: "calculated", type: "calc_total", label: "Total Equity" },
  total_liab_and_equity: { category: "calculated", type: "calc_total", label: "Total Liabilities & Equity" },
};

/** BS taxonomy vocabulary for AI classification. */
export const BS_TAXONOMY_VOCABULARY: BSTaxonomyType[] = [
  "asset_cash", "asset_short_term_investments", "asset_receivables", "asset_inventory", "asset_prepaid", "asset_other_current",
  "asset_ppe", "asset_intangibles", "asset_goodwill", "asset_rou_assets", "asset_investments", "asset_deferred_tax", "asset_other_fixed",
  "liab_payables", "liab_accruals", "liab_deferred_revenue", "liab_short_term_debt", "liab_current_lease", "liab_other_current",
  "liab_long_term_debt", "liab_deferred_tax", "liab_pension", "liab_lease_obligations", "liab_other_non_current",
  "equity_common_stock", "equity_preferred_stock", "equity_apic", "equity_treasury_stock", "equity_retained_earnings",
  "equity_aoci", "equity_minority_interest", "equity_other",
];

/** BS category vocabulary. */
export const BS_CATEGORY_VOCABULARY: BSTaxonomyCategory[] = [
  "current_asset", "fixed_asset", "current_liability", "non_current_liability", "equity", "calculated",
];

/** Category labels for UI. */
export const BS_CATEGORY_LABELS: Record<BSTaxonomyCategory, string> = {
  current_asset: "Current Assets",
  fixed_asset: "Fixed Assets",
  current_liability: "Current Liabilities",
  non_current_liability: "Non-Current Liabilities",
  equity: "Equity",
  calculated: "Calculated",
};

/** Type labels for UI. */
export const BS_TYPE_LABELS: Record<BSTaxonomyType, string> = {
  asset_cash: "Cash & Equivalents",
  asset_short_term_investments: "Short-Term Investments",
  asset_receivables: "Receivables",
  asset_inventory: "Inventory",
  asset_prepaid: "Prepaid Expenses",
  asset_other_current: "Other Current Assets",
  asset_ppe: "Property, Plant & Equipment",
  asset_intangibles: "Intangible Assets",
  asset_goodwill: "Goodwill",
  asset_rou_assets: "Right-of-Use Assets",
  asset_investments: "Investments",
  asset_deferred_tax: "Deferred Tax Assets",
  asset_other_fixed: "Other Fixed Assets",
  liab_payables: "Accounts Payable",
  liab_accruals: "Accrued Liabilities",
  liab_deferred_revenue: "Deferred Revenue",
  liab_short_term_debt: "Short-Term Debt",
  liab_current_lease: "Current Lease Liabilities",
  liab_other_current: "Other Current Liabilities",
  liab_long_term_debt: "Long-Term Debt",
  liab_deferred_tax: "Deferred Tax Liabilities",
  liab_pension: "Pension Liabilities",
  liab_lease_obligations: "Lease Obligations",
  liab_other_non_current: "Other Non-Current Liabilities",
  equity_common_stock: "Common Stock",
  equity_preferred_stock: "Preferred Stock",
  equity_apic: "Additional Paid-In Capital",
  equity_treasury_stock: "Treasury Stock",
  equity_retained_earnings: "Retained Earnings",
  equity_aoci: "AOCI",
  equity_minority_interest: "Minority Interest",
  equity_other: "Other Equity",
  calc_total: "Total",
};

/** Label-based fallback BS taxonomy for custom rows. */
function getFallbackBsTaxonomy(label: string, row: Row): BSTaxonomy {
  const lower = label.toLowerCase();

  // Current Assets
  if (/cash|equivalent/.test(lower)) {
    return { category: "current_asset", type: "asset_cash", label };
  }
  if (/short.term\s*invest|marketable\s*securities/.test(lower)) {
    return { category: "current_asset", type: "asset_short_term_investments", label };
  }
  if (/receiv|ar\b/.test(lower)) {
    return { category: "current_asset", type: "asset_receivables", label };
  }
  if (/inventor/.test(lower)) {
    return { category: "current_asset", type: "asset_inventory", label };
  }
  if (/prepaid|prepay/.test(lower)) {
    return { category: "current_asset", type: "asset_prepaid", label };
  }

  // Fixed Assets
  if (/pp&e|ppe|property|plant|equipment/.test(lower)) {
    return { category: "fixed_asset", type: "asset_ppe", label };
  }
  if (/intangible/.test(lower)) {
    return { category: "fixed_asset", type: "asset_intangibles", label };
  }
  if (/goodwill/.test(lower)) {
    return { category: "fixed_asset", type: "asset_goodwill", label };
  }
  if (/right.of.use|rou/.test(lower)) {
    return { category: "fixed_asset", type: "asset_rou_assets", label };
  }
  if (/deferred\s*tax\s*asset/.test(lower)) {
    return { category: "fixed_asset", type: "asset_deferred_tax", label };
  }
  if (/investment/.test(lower) && !/short.term/.test(lower)) {
    return { category: "fixed_asset", type: "asset_investments", label };
  }

  // Current Liabilities — debt before generic payables so "notes payable" is not AP
  if (
    /short[\s-]term\s*debt|\bst\s*debt\b/.test(lower) ||
    /short[\s-]term\s*borrow/.test(lower) ||
    /current\s*portion\s*of\s*(long[\s-]term\s*debt|ltd)\b/.test(lower) ||
    /current\s*portion\s*of\s*long[\s-]term/.test(lower) ||
    /\bcpltd\b/.test(lower) ||
    /current\s*maturit(y|ies)\s+of\s*long[\s-]term/.test(lower) ||
    /current\s*maturit(y|ies)\s+of\s+ltd\b/.test(lower) ||
    /current\s*maturit(y|ies)\s+(of\s+)?(long[\s-]term\s*borrow|long[\s-]term\s*debt)/.test(lower) ||
    /(?<![a-z-])current\s+debt\b/.test(lower) ||
    /debt\s*due\s*within|debt\s*obligations?\s*due/.test(lower) ||
    /revolv(er|ing)|\brevolver\b|revolving\s+(credit\s+)?(facility|line)/.test(lower) ||
    /bank\s*line\s*of\s*credit|line\s*of\s*credit|\bcredit\s+line\b|bank\s*overdraft/.test(lower) ||
    /commercial\s*paper/.test(lower) ||
    /current\s*borrow/.test(lower)
  ) {
    return { category: "current_liability", type: "liab_short_term_debt", label };
  }
  if (/notes?\s*payable|promissory\s*note/.test(lower)) {
    if (/long[\s-]term|non[\s-]current|senior\s*notes?/.test(lower)) {
      return { category: "non_current_liability", type: "liab_long_term_debt", label };
    }
    return { category: "current_liability", type: "liab_short_term_debt", label };
  }
  if (/payable|ap\b/.test(lower)) {
    return { category: "current_liability", type: "liab_payables", label };
  }
  if (/accrued|accru/.test(lower)) {
    return { category: "current_liability", type: "liab_accruals", label };
  }
  if (/deferred\s*rev/.test(lower)) {
    return { category: "current_liability", type: "liab_deferred_revenue", label };
  }
  if (/current\s*lease|lease.*current/.test(lower)) {
    return { category: "current_liability", type: "liab_current_lease", label };
  }

  // Non-Current Liabilities (funded debt)
  if (
    /long[\s-]term\s*debt|\blt\s*debt\b/.test(lower) ||
    /long[\s-]term\s*borrow/.test(lower) ||
    /\bnon[\s-]?current\s+debt\b/.test(lower) ||
    /bonds?\s*payable|debentures?|senior\s*notes?/.test(lower) ||
    /\bfunded\s+debt\b|\bbank\s+debt\b|\bsenior\s+debt\b/.test(lower) ||
    /non[\s-]current\s*borrow/.test(lower) ||
    (/\bdebt\s*obligations?\b/.test(lower) && !/due\s*within|current\s*portion/.test(lower)) ||
    (/term\s*loan/.test(lower) && !/current\s*portion/.test(lower))
  ) {
    return { category: "non_current_liability", type: "liab_long_term_debt", label };
  }
  if (/deferred\s*tax\s*liab/.test(lower)) {
    return { category: "non_current_liability", type: "liab_deferred_tax", label };
  }
  if (/pension|retire/.test(lower)) {
    return { category: "non_current_liability", type: "liab_pension", label };
  }
  if (/lease\s*obligation|operating\s*lease/.test(lower)) {
    return { category: "non_current_liability", type: "liab_lease_obligations", label };
  }

  // Ambiguous funded-debt labels: route to debt taxonomy (metadata marks ambiguous)
  if (
    /\bborrowings?\b/.test(lower) ||
    /\bborrow\b/.test(lower) ||
    /(^|[^a-z])(loan|loans)\s+payable\b/.test(lower) ||
    (/\bcredit\s+facility\b/.test(lower) && !/revolv/.test(lower)) ||
    /\bcredit\s*agreement\b/.test(lower)
  ) {
    if (/long[\s-]term|non[\s-]current|senior|bond|debenture|funded|bank\s+debt/.test(lower)) {
      return { category: "non_current_liability", type: "liab_long_term_debt", label };
    }
    return { category: "current_liability", type: "liab_short_term_debt", label };
  }

  // Equity
  if (/common\s*stock/.test(lower)) {
    return { category: "equity", type: "equity_common_stock", label };
  }
  if (/preferred\s*stock/.test(lower)) {
    return { category: "equity", type: "equity_preferred_stock", label };
  }
  if (/apic|additional\s*paid/.test(lower)) {
    return { category: "equity", type: "equity_apic", label };
  }
  if (/treasury/.test(lower)) {
    return { category: "equity", type: "equity_treasury_stock", label };
  }
  if (/retained/.test(lower)) {
    return { category: "equity", type: "equity_retained_earnings", label };
  }
  if (/aoci|accumulated\s*other\s*comprehensive/.test(lower)) {
    return { category: "equity", type: "equity_aoci", label };
  }
  if (/minority|non.controlling/.test(lower)) {
    return { category: "equity", type: "equity_minority_interest", label };
  }

  // Use cashFlowBehavior if available
  if (row.cashFlowBehavior === "working_capital") {
    if (/asset|receiv|inventor|prepaid/.test(lower)) {
      return { category: "current_asset", type: "asset_other_current", label };
    }
    return { category: "current_liability", type: "liab_other_current", label };
  }
  if (row.cashFlowBehavior === "investing") {
    return { category: "fixed_asset", type: "asset_other_fixed", label };
  }
  if (row.cashFlowBehavior === "financing") {
    if (/debt|loan|borrow|note/.test(lower)) {
      return { category: "non_current_liability", type: "liab_long_term_debt", label };
    }
    return { category: "equity", type: "equity_other", label };
  }

  // Default
  return { category: "current_asset", type: "asset_other_current", label };
}

/** Get BS taxonomy for a row (deterministic for template, fallback for custom). */
export function getBsTaxonomy(row: Row): BSTaxonomy {
  const byId = BS_TAXONOMY_BY_ID[row.id];
  if (byId) return byId;
  return getFallbackBsTaxonomy(row.label, row);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CASH FLOW STATEMENT TAXONOMY
// ═══════════════════════════════════════════════════════════════════════════════

/** High-level CFS taxonomy category. */
export type CFSTaxonomyCategory =
  | "operating"
  | "investing"
  | "financing"
  | "cash_bridge"
  | "calculated";

/** Granular CFS taxonomy type within each category. */
export type CFSTaxonomyType =
  // Operating
  | "cfo_net_income"
  | "cfo_depreciation"
  | "cfo_amortization"
  | "cfo_danda"
  | "cfo_sbc"
  | "cfo_deferred_tax"
  | "cfo_impairment"
  | "cfo_gain_loss"
  | "cfo_non_cash_other"
  | "cfo_wc_receivables"
  | "cfo_wc_inventory"
  | "cfo_wc_payables"
  | "cfo_wc_accruals"
  | "cfo_wc_deferred_revenue"
  | "cfo_wc_other"
  | "cfo_wc_total"
  | "cfo_other"
  // Investing
  | "cfi_capex"
  | "cfi_acquisitions"
  | "cfi_asset_sales"
  | "cfi_investments_purchase"
  | "cfi_investments_sale"
  | "cfi_intangibles"
  | "cfi_other"
  // Financing
  | "cff_debt_issued"
  | "cff_debt_repaid"
  | "cff_equity_issued"
  | "cff_share_repurchases"
  | "cff_dividends"
  | "cff_lease_payments"
  | "cff_other"
  // Cash Bridge
  | "bridge_fx"
  | "bridge_other"
  // Calculated / Totals
  | "calc_operating_cf"
  | "calc_investing_cf"
  | "calc_financing_cf"
  | "calc_net_change";

export interface CFSTaxonomy {
  category: CFSTaxonomyCategory;
  type: CFSTaxonomyType;
  label: string;
}

/** Deterministic CFS taxonomy by row ID. */
const CFS_TAXONOMY_BY_ID: Record<string, CFSTaxonomy> = {
  // Operating
  net_income: { category: "operating", type: "cfo_net_income", label: "Net Income" },
  danda: { category: "operating", type: "cfo_danda", label: "D&A" },
  sbc: { category: "operating", type: "cfo_sbc", label: "Stock-Based Compensation" },
  wc_change: { category: "operating", type: "cfo_wc_total", label: "Change in Working Capital" },
  other_operating: { category: "operating", type: "cfo_other", label: "Other Operating" },
  operating_cf: { category: "calculated", type: "calc_operating_cf", label: "Operating Cash Flow" },
  // Investing
  capex: { category: "investing", type: "cfi_capex", label: "Capital Expenditures" },
  acquisitions: { category: "investing", type: "cfi_acquisitions", label: "Acquisitions" },
  asset_sales: { category: "investing", type: "cfi_asset_sales", label: "Asset Sales" },
  investments: { category: "investing", type: "cfi_investments_purchase", label: "Investments" },
  other_investing: { category: "investing", type: "cfi_other", label: "Other Investing" },
  investing_cf: { category: "calculated", type: "calc_investing_cf", label: "Investing Cash Flow" },
  // Financing
  debt_issued: { category: "financing", type: "cff_debt_issued", label: "Debt Issued" },
  debt_repaid: { category: "financing", type: "cff_debt_repaid", label: "Debt Repaid" },
  equity_issued: { category: "financing", type: "cff_equity_issued", label: "Equity Issued" },
  share_repurchases: { category: "financing", type: "cff_share_repurchases", label: "Share Repurchases" },
  dividends: { category: "financing", type: "cff_dividends", label: "Dividends" },
  other_financing: { category: "financing", type: "cff_other", label: "Other Financing" },
  financing_cf: { category: "calculated", type: "calc_financing_cf", label: "Financing Cash Flow" },
  // Cash Bridge
  fx_effect_on_cash: { category: "cash_bridge", type: "bridge_fx", label: "FX Effect on Cash" },
  net_change_cash: { category: "calculated", type: "calc_net_change", label: "Net Change in Cash" },
};

/** CFS taxonomy vocabulary for AI classification. */
export const CFS_TAXONOMY_VOCABULARY: CFSTaxonomyType[] = [
  "cfo_net_income", "cfo_depreciation", "cfo_amortization", "cfo_danda", "cfo_sbc", "cfo_deferred_tax",
  "cfo_impairment", "cfo_gain_loss", "cfo_non_cash_other",
  "cfo_wc_receivables", "cfo_wc_inventory", "cfo_wc_payables", "cfo_wc_accruals", "cfo_wc_deferred_revenue", "cfo_wc_other", "cfo_wc_total",
  "cfo_other",
  "cfi_capex", "cfi_acquisitions", "cfi_asset_sales", "cfi_investments_purchase", "cfi_investments_sale", "cfi_intangibles", "cfi_other",
  "cff_debt_issued", "cff_debt_repaid", "cff_equity_issued", "cff_share_repurchases", "cff_dividends", "cff_lease_payments", "cff_other",
  "bridge_fx", "bridge_other",
];

/** CFS category vocabulary. */
export const CFS_CATEGORY_VOCABULARY: CFSTaxonomyCategory[] = [
  "operating", "investing", "financing", "cash_bridge", "calculated",
];

/** Category labels for UI. */
export const CFS_CATEGORY_LABELS: Record<CFSTaxonomyCategory, string> = {
  operating: "Operating Activities",
  investing: "Investing Activities",
  financing: "Financing Activities",
  cash_bridge: "Cash Bridge",
  calculated: "Calculated",
};

/** Type labels for UI. */
export const CFS_TYPE_LABELS: Record<CFSTaxonomyType, string> = {
  cfo_net_income: "Net Income",
  cfo_depreciation: "Depreciation",
  cfo_amortization: "Amortization",
  cfo_danda: "Depreciation & Amortization",
  cfo_sbc: "Stock-Based Compensation",
  cfo_deferred_tax: "Deferred Taxes",
  cfo_impairment: "Impairment",
  cfo_gain_loss: "Gain/Loss on Sale",
  cfo_non_cash_other: "Other Non-Cash",
  cfo_wc_receivables: "Change in Receivables",
  cfo_wc_inventory: "Change in Inventory",
  cfo_wc_payables: "Change in Payables",
  cfo_wc_accruals: "Change in Accruals",
  cfo_wc_deferred_revenue: "Change in Deferred Revenue",
  cfo_wc_other: "Other Working Capital",
  cfo_wc_total: "Total Working Capital Change",
  cfo_other: "Other Operating",
  cfi_capex: "Capital Expenditures",
  cfi_acquisitions: "Acquisitions",
  cfi_asset_sales: "Asset Sales/Disposals",
  cfi_investments_purchase: "Investment Purchases",
  cfi_investments_sale: "Investment Sales",
  cfi_intangibles: "Intangible Purchases",
  cfi_other: "Other Investing",
  cff_debt_issued: "Debt Issued",
  cff_debt_repaid: "Debt Repaid",
  cff_equity_issued: "Equity Issued",
  cff_share_repurchases: "Share Repurchases",
  cff_dividends: "Dividends Paid",
  cff_lease_payments: "Lease Payments",
  cff_other: "Other Financing",
  bridge_fx: "FX Effect",
  bridge_other: "Other Bridge",
  calc_operating_cf: "Cash from Operations",
  calc_investing_cf: "Cash from Investing",
  calc_financing_cf: "Cash from Financing",
  calc_net_change: "Net Change in Cash",
};

/** Label-based fallback CFS taxonomy for custom rows. */
function getFallbackCfsTaxonomy(label: string, row: Row): CFSTaxonomy {
  const lower = label.toLowerCase();

  // Operating - Non-Cash
  if (/depreciation/.test(lower) && !/amort/.test(lower)) {
    return { category: "operating", type: "cfo_depreciation", label };
  }
  if (/amortization/.test(lower) && !/deprec/.test(lower)) {
    return { category: "operating", type: "cfo_amortization", label };
  }
  if (/d&a|deprec.*amort|amort.*deprec/.test(lower)) {
    return { category: "operating", type: "cfo_danda", label };
  }
  if (/stock.based|sbc|equity.comp/.test(lower)) {
    return { category: "operating", type: "cfo_sbc", label };
  }
  if (/deferred\s*tax/.test(lower)) {
    return { category: "operating", type: "cfo_deferred_tax", label };
  }
  if (/impair/.test(lower)) {
    return { category: "operating", type: "cfo_impairment", label };
  }
  if (/gain|loss/.test(lower) && /sale|dispos|invest/.test(lower)) {
    return { category: "operating", type: "cfo_gain_loss", label };
  }

  // Operating - Working Capital
  if (/receiv/.test(lower) && /change|incr|decr/.test(lower)) {
    return { category: "operating", type: "cfo_wc_receivables", label };
  }
  if (/inventor/.test(lower) && /change|incr|decr/.test(lower)) {
    return { category: "operating", type: "cfo_wc_inventory", label };
  }
  if (/payable/.test(lower) && /change|incr|decr/.test(lower)) {
    return { category: "operating", type: "cfo_wc_payables", label };
  }
  if (/accrued|accru/.test(lower) && /change|incr|decr/.test(lower)) {
    return { category: "operating", type: "cfo_wc_accruals", label };
  }
  if (/deferred\s*rev/.test(lower) && /change|incr|decr/.test(lower)) {
    return { category: "operating", type: "cfo_wc_deferred_revenue", label };
  }
  if (/working\s*capital/.test(lower)) {
    return { category: "operating", type: "cfo_wc_total", label };
  }

  // Investing
  if (/cap.?ex|capital\s*expend/.test(lower)) {
    return { category: "investing", type: "cfi_capex", label };
  }
  if (/acqui/.test(lower)) {
    return { category: "investing", type: "cfi_acquisitions", label };
  }
  if (/asset\s*sale|dispos|divestiture/.test(lower)) {
    return { category: "investing", type: "cfi_asset_sales", label };
  }
  if (/purchase.*invest|invest.*purchase/.test(lower)) {
    return { category: "investing", type: "cfi_investments_purchase", label };
  }
  if (/sale.*invest|invest.*sale|proceeds.*invest/.test(lower)) {
    return { category: "investing", type: "cfi_investments_sale", label };
  }
  if (/intangible.*purchase|purchase.*intangible/.test(lower)) {
    return { category: "investing", type: "cfi_intangibles", label };
  }

  // Financing
  if (/debt\s*issued|borrow|proceeds.*debt|loan.*proceeds/.test(lower)) {
    return { category: "financing", type: "cff_debt_issued", label };
  }
  if (/debt\s*repaid|repay|debt.*payment/.test(lower)) {
    return { category: "financing", type: "cff_debt_repaid", label };
  }
  if (/equity\s*issued|stock\s*issued|proceeds.*equity/.test(lower)) {
    return { category: "financing", type: "cff_equity_issued", label };
  }
  if (/repurchase|buyback/.test(lower)) {
    return { category: "financing", type: "cff_share_repurchases", label };
  }
  if (/dividend/.test(lower)) {
    return { category: "financing", type: "cff_dividends", label };
  }
  if (/lease\s*payment|finance\s*lease/.test(lower)) {
    return { category: "financing", type: "cff_lease_payments", label };
  }

  // Cash Bridge
  if (/fx|foreign\s*exchange|currency/.test(lower)) {
    return { category: "cash_bridge", type: "bridge_fx", label };
  }

  // Use historicalCfsNature if available
  if (row.historicalCfsNature === "reported_non_cash_adjustment") {
    return { category: "operating", type: "cfo_non_cash_other", label };
  }
  if (row.historicalCfsNature === "reported_working_capital_movement") {
    return { category: "operating", type: "cfo_wc_other", label };
  }
  if (row.historicalCfsNature === "reported_operating_other") {
    return { category: "operating", type: "cfo_other", label };
  }
  if (row.historicalCfsNature === "reported_investing") {
    return { category: "investing", type: "cfi_other", label };
  }
  if (row.historicalCfsNature === "reported_financing") {
    return { category: "financing", type: "cff_other", label };
  }

  // Use cfsLink.section if available
  if (row.cfsLink?.section === "operating") {
    return { category: "operating", type: "cfo_other", label };
  }
  if (row.cfsLink?.section === "investing") {
    return { category: "investing", type: "cfi_other", label };
  }
  if (row.cfsLink?.section === "financing") {
    return { category: "financing", type: "cff_other", label };
  }
  if (row.cfsLink?.section === "cash_bridge") {
    return { category: "cash_bridge", type: "bridge_other", label };
  }

  // Default
  return { category: "operating", type: "cfo_other", label };
}

/** Get CFS taxonomy for a row (deterministic for template, fallback for custom). */
export function getCfsTaxonomy(row: Row): CFSTaxonomy {
  const byId = CFS_TAXONOMY_BY_ID[row.id];
  if (byId) return byId;
  return getFallbackCfsTaxonomy(row.label, row);
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED TAXONOMY INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

export type StatementType = "income" | "balance" | "cashFlow";

export interface RowTaxonomy {
  statement: StatementType;
  category: ISTaxonomyCategory | BSTaxonomyCategory | CFSTaxonomyCategory;
  type: ISTaxonomyType | BSTaxonomyType | CFSTaxonomyType;
  categoryLabel: string;
  typeLabel: string;
}

/** Get taxonomy for any row given its statement type. */
export function getRowTaxonomy(row: Row, statement: StatementType): RowTaxonomy {
  if (statement === "income") {
    const tax = getIsTaxonomy(row);
    return {
      statement,
      category: tax.category,
      type: tax.type,
      categoryLabel: IS_CATEGORY_LABELS[tax.category],
      typeLabel: IS_TYPE_LABELS[tax.type],
    };
  }
  if (statement === "balance") {
    const tax = getBsTaxonomy(row);
    return {
      statement,
      category: tax.category,
      type: tax.type,
      categoryLabel: BS_CATEGORY_LABELS[tax.category],
      typeLabel: BS_TYPE_LABELS[tax.type],
    };
  }
  // cashFlow
  const tax = getCfsTaxonomy(row);
  return {
    statement,
    category: tax.category,
    type: tax.type,
    categoryLabel: CFS_CATEGORY_LABELS[tax.category],
    typeLabel: CFS_TYPE_LABELS[tax.type],
  };
}

/** Check if a row ID is a template/anchor row (deterministic taxonomy). */
export function isTemplateRow(rowId: string, statement: StatementType): boolean {
  if (statement === "income") {
    return IS_TAXONOMY_BY_ID[rowId] != null;
  }
  if (statement === "balance") {
    return BS_TAXONOMY_BY_ID[rowId] != null;
  }
  return CFS_TAXONOMY_BY_ID[rowId] != null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAXONOMY BACKFILL (apply taxonomy metadata to rows)
// Does NOT touch classification completeness logic.
// ═══════════════════════════════════════════════════════════════════════════════

function mapRowRecursive<T extends Row>(row: T, fn: (r: T) => T): T {
  const next = fn(row);
  if (next.children?.length) {
    return {
      ...next,
      children: next.children.map((c) => mapRowRecursive(c as T, fn)) as Row[],
    } as T;
  }
  return next;
}

/**
 * Backfill IS taxonomy: template rows get deterministic taxonomy; custom rows get fallback taxonomy.
 * User-set taxonomy (taxonomySource === "user") is never overwritten.
 * Sets taxonomyStatus: trusted (system/user), needs_review (fallback/low-confidence AI), unresolved (missing).
 */
export function backfillIsTaxonomy(incomeStatement: Row[]): Row[] {
  return (incomeStatement ?? []).map((row) =>
    mapRowRecursive(row, (r) => {
      // User override: always trusted, never overwrite
      if (r.taxonomySource === "user") {
        return r.taxonomyStatus === "trusted" ? r : { ...r, taxonomyStatus: "trusted" as const };
      }
      // AI classification: trusted if high confidence, needs_review if low
      if (r.taxonomySource === "ai") {
        const confidence = r.classificationConfidence ?? 0;
        const status: "trusted" | "needs_review" = confidence >= 0.7 ? "trusted" : "needs_review";
        return r.taxonomyStatus === status ? r : { ...r, taxonomyStatus: status };
      }
      const tax = getIsTaxonomy(r);
      const isTemplate = IS_TAXONOMY_BY_ID[r.id] != null;
      if (isTemplate) {
        // Deterministic template: system source, always trusted
        return {
          ...r,
          taxonomyType: tax.type,
          taxonomyCategory: tax.category,
          taxonomySource: "system" as const,
          taxonomyStatus: "trusted" as const,
        };
      }
      // Fallback: needs_review (never silently trusted)
      return {
        ...r,
        taxonomyType: tax.type,
        taxonomyCategory: tax.category,
        taxonomySource: "fallback" as const,
        taxonomyStatus: "needs_review" as const,
      };
    })
  );
}

/**
 * Backfill BS taxonomy: template rows get deterministic taxonomy; custom rows get fallback taxonomy.
 * User-set taxonomy (taxonomySource === "user") is never overwritten.
 * Sets taxonomyStatus: trusted (system/user), needs_review (fallback/low-confidence AI), unresolved (missing).
 */
export function backfillBsTaxonomy(balanceSheet: Row[]): Row[] {
  return (balanceSheet ?? []).map((row) =>
    mapRowRecursive(row, (r) => {
      // User override: always trusted, never overwrite
      if (r.taxonomySource === "user") {
        return r.taxonomyStatus === "trusted" ? r : { ...r, taxonomyStatus: "trusted" as const };
      }
      // AI classification: trusted if high confidence, needs_review if low
      if (r.taxonomySource === "ai") {
        const confidence = r.classificationConfidence ?? 0;
        const status: "trusted" | "needs_review" = confidence >= 0.7 ? "trusted" : "needs_review";
        return r.taxonomyStatus === status ? r : { ...r, taxonomyStatus: status };
      }
      const tax = getBsTaxonomy(r);
      const isTemplate = BS_TAXONOMY_BY_ID[r.id] != null;
      if (isTemplate) {
        // Deterministic template: system source, always trusted
        return {
          ...r,
          taxonomyType: tax.type,
          taxonomyCategory: tax.category,
          taxonomySource: "system" as const,
          taxonomyStatus: "trusted" as const,
        };
      }
      // Fallback: needs_review (never silently trusted)
      return {
        ...r,
        taxonomyType: tax.type,
        taxonomyCategory: tax.category,
        taxonomySource: "fallback" as const,
        taxonomyStatus: "needs_review" as const,
      };
    })
  );
}

/**
 * Backfill CFS taxonomy: template rows get deterministic taxonomy; custom rows get fallback taxonomy.
 * User-set taxonomy (taxonomySource === "user") is never overwritten.
 * Sets taxonomyStatus: trusted (system/user), needs_review (fallback/low-confidence AI), unresolved (missing).
 */
export function backfillCfsTaxonomy(cashFlow: Row[]): Row[] {
  return (cashFlow ?? []).map((row) =>
    mapRowRecursive(row, (r) => {
      // User override: always trusted, never overwrite
      if (r.taxonomySource === "user") {
        return r.taxonomyStatus === "trusted" ? r : { ...r, taxonomyStatus: "trusted" as const };
      }
      // AI classification: trusted if high confidence, needs_review if low
      if (r.taxonomySource === "ai") {
        const confidence = r.classificationConfidence ?? 0;
        const status: "trusted" | "needs_review" = confidence >= 0.7 ? "trusted" : "needs_review";
        return r.taxonomyStatus === status ? r : { ...r, taxonomyStatus: status };
      }
      const tax = getCfsTaxonomy(r);
      const isTemplate = CFS_TAXONOMY_BY_ID[r.id] != null;
      if (isTemplate) {
        // Deterministic template: system source, always trusted
        return {
          ...r,
          taxonomyType: tax.type,
          taxonomyCategory: tax.category,
          taxonomySource: "system" as const,
          taxonomyStatus: "trusted" as const,
        };
      }
      // Fallback: needs_review (never silently trusted)
      return {
        ...r,
        taxonomyType: tax.type,
        taxonomyCategory: tax.category,
        taxonomySource: "fallback" as const,
        taxonomyStatus: "needs_review" as const,
      };
    })
  );
}

/**
 * Run all taxonomy backfills. Call after loadProject or when adding rows.
 * Preserves user taxonomy; fills missing taxonomy for all rows.
 */
export function backfillTaxonomy(allStatements: {
  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];
}): {
  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];
} {
  return {
    incomeStatement: backfillIsTaxonomy(allStatements.incomeStatement ?? []),
    balanceSheet: backfillBsTaxonomy(allStatements.balanceSheet ?? []),
    cashFlow: backfillCfsTaxonomy(allStatements.cashFlow ?? []),
  };
}

/** Statement key for single-row taxonomy application. */
export type StatementKeyForTaxonomy = "incomeStatement" | "balanceSheet" | "cashFlow";

/**
 * Apply taxonomy to a single row (for newly added rows in-session).
 * Uses same logic as backfill: user never overwritten; template = system/trusted; else fallback/needs_review.
 * Call after addChildRow/insertRow so new rows are routable without reload.
 */
export function applyTaxonomyToRow(
  row: Row,
  statementKey: StatementKeyForTaxonomy
): Row {
  if (row.taxonomySource === "user") {
    return row.taxonomyStatus === "trusted" ? row : { ...row, taxonomyStatus: "trusted" as const };
  }
  if (row.taxonomySource === "ai") {
    const confidence = row.classificationConfidence ?? 0;
    const status: "trusted" | "needs_review" = confidence >= 0.7 ? "trusted" : "needs_review";
    return row.taxonomyStatus === status ? row : { ...row, taxonomyStatus: status };
  }
  if (statementKey === "incomeStatement") {
    const tax = getIsTaxonomy(row);
    const isTemplate = IS_TAXONOMY_BY_ID[row.id] != null;
    return {
      ...row,
      taxonomyType: tax.type,
      taxonomyCategory: tax.category as Row["taxonomyCategory"],
      taxonomySource: isTemplate ? ("system" as const) : ("fallback" as const),
      taxonomyStatus: isTemplate ? ("trusted" as const) : ("needs_review" as const),
    };
  }
  if (statementKey === "balanceSheet") {
    const tax = getBsTaxonomy(row);
    const isTemplate = BS_TAXONOMY_BY_ID[row.id] != null;
    return {
      ...row,
      taxonomyType: tax.type,
      taxonomyCategory: tax.category as Row["taxonomyCategory"],
      taxonomySource: isTemplate ? ("system" as const) : ("fallback" as const),
      taxonomyStatus: isTemplate ? ("trusted" as const) : ("needs_review" as const),
    };
  }
  // cashFlow
  const tax = getCfsTaxonomy(row);
  const isTemplate = CFS_TAXONOMY_BY_ID[row.id] != null;
  return {
    ...row,
    taxonomyType: tax.type,
    taxonomyCategory: tax.category as Row["taxonomyCategory"],
    taxonomySource: isTemplate ? ("system" as const) : ("fallback" as const),
    taxonomyStatus: isTemplate ? ("trusted" as const) : ("needs_review" as const),
  };
}
