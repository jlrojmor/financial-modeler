// types/finance.ts

export type ValueType = "currency" | "percent" | "number" | "text";
export type RowKind = "input" | "calc" | "subtotal" | "total";

export interface Row {
  id: string;
  label: string;
  kind: RowKind;
  valueType: ValueType;
  values?: Record<string, number>;
  excelFormula?: string;
  children?: Row[];
  /** Controlled vocabulary for how this CFS row is forecast (used in projections). */
  cfsForecastDriver?:
    | "income_statement"
    | "danda_schedule"
    | "disclosure_or_assumption"
    | "working_capital_schedule"
    | "capex_schedule"
    | "debt_schedule"
    | "financing_assumption"
    | "manual_mna"
    | "manual_other";
  // Cash Flow Statement link metadata (auto-determined by system)
  // This stores the correct treatment per international accounting standards
  cfsLink?: {
    section: "operating" | "investing" | "financing" | "cash_bridge";
    cfsItemId?: string; // ID of the CFS line item this links to (optional)
    impact: "positive" | "negative" | "neutral" | "calculated";
    description: string; // Description of the CFS treatment (stored for memory)
    /** How this row is forecast (for custom rows set by AI/user). */
    forecastDriver?: Row["cfsForecastDriver"];
  };
  // Income Statement link metadata (auto-determined by system)
  isLink?: {
    isItemId: string; // ID of the IS line item this links to
    description: string; // Description of the IS link (stored for memory)
  };
  /** Optional: how this BS row flows to Cash Flow (CFO/CFI/CFF/non-cash). "unclassified" = needs user to set. */
  cashFlowBehavior?: "working_capital" | "investing" | "financing" | "non_cash" | "unclassified";
  /** Optional: which schedule owns this row's projections (wc/capex/intangibles/debt). */
  scheduleOwner?: "wc" | "capex" | "intangibles" | "debt" | "none";
  /** Income Statement: section this row belongs to (for custom rows; template rows have implicit section). operating_expenses = structural parent row for the Operating Expenses block. */
  sectionOwner?: "revenue" | "cogs" | "sga" | "rd" | "other_operating" | "non_operating" | "tax" | "operating_expenses";
  /** Income Statement: true = above EBIT (operating), false = Interest & Other (non-operating). */
  isOperating?: boolean;
  /** Who set classification; "user" = do not overwrite with AI; "ai" | "fallback" = stored; "unresolved" = missing, needs review. */
  classificationSource?: "user" | "ai" | "fallback" | "unresolved";
  /** AI suggestion reason (when classificationSource === "ai"). */
  classificationReason?: string;
  /** AI confidence 0–1 when classificationSource === "ai". */
  classificationConfidence?: number;
  /** Custom CFS rows: whether forecast metadata is trusted or needs user review. Enables projection logic to ignore/warn on unreviewed rows. */
  forecastMetadataStatus?: "trusted" | "needs_review";
  /** True for rows from statement template; they never require classification. */
  isTemplateRow?: boolean;
  /** Historical CFO source (optional): set when resolving net_income, sbc, danda, wc_change for display/audit. */
  cfoSource?: {
    sourceType: "reported" | "income_statement" | "embedded_disclosure" | "derived" | "manual";
    sourceDetail: string;
  };
  /** CFS only: years for which the user has explicitly entered a value (so reported override is meaningful; default/blank does not block fallback). */
  cfsUserSetYears?: string[];
  /** CFS: historical nature of the row for robust classification (reported non-cash, WC movement, etc.). */
  historicalCfsNature?:
    | "reported_non_cash_adjustment"
    | "reported_working_capital_movement"
    | "reported_operating_other"
    | "reported_investing"
    | "reported_financing"
    | "reported_meta";

  // ══════════════════════════════════════════════════════════════════════════════
  // TAXONOMY METADATA (semantic row type families)
  // ══════════════════════════════════════════════════════════════════════════════

  /** IS taxonomy: granular row type. */
  taxonomyType?:
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
    // Calculated
    | "calc_gross_profit"
    | "calc_ebitda"
    | "calc_ebit"
    | "calc_ebt"
    | "calc_net_income"
    | "calc_margin"
    // BS taxonomy types (assets)
    | "asset_cash"
    | "asset_short_term_investments"
    | "asset_receivables"
    | "asset_inventory"
    | "asset_prepaid"
    | "asset_other_current"
    | "asset_ppe"
    | "asset_intangibles"
    | "asset_goodwill"
    | "asset_rou_assets"
    | "asset_investments"
    | "asset_deferred_tax"
    | "asset_other_fixed"
    // BS taxonomy types (liabilities)
    | "liab_payables"
    | "liab_accruals"
    | "liab_deferred_revenue"
    | "liab_short_term_debt"
    | "liab_current_lease"
    | "liab_other_current"
    | "liab_long_term_debt"
    | "liab_deferred_tax"
    | "liab_pension"
    | "liab_lease_obligations"
    | "liab_other_non_current"
    // BS taxonomy types (equity)
    | "equity_common_stock"
    | "equity_preferred_stock"
    | "equity_apic"
    | "equity_treasury_stock"
    | "equity_retained_earnings"
    | "equity_aoci"
    | "equity_minority_interest"
    | "equity_other"
    // BS calculated
    | "calc_total"
    // CFS taxonomy types (operating)
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
    // CFS taxonomy types (investing)
    | "cfi_capex"
    | "cfi_acquisitions"
    | "cfi_asset_sales"
    | "cfi_investments_purchase"
    | "cfi_investments_sale"
    | "cfi_intangibles"
    | "cfi_other"
    // CFS taxonomy types (financing)
    | "cff_debt_issued"
    | "cff_debt_repaid"
    | "cff_equity_issued"
    | "cff_share_repurchases"
    | "cff_dividends"
    | "cff_lease_payments"
    | "cff_other"
    // CFS taxonomy types (bridge/calc)
    | "bridge_fx"
    | "bridge_other"
    | "calc_operating_cf"
    | "calc_investing_cf"
    | "calc_financing_cf"
    | "calc_net_change";

  /** Taxonomy category (high-level grouping). */
  taxonomyCategory?:
    // IS categories
    | "revenue"
    | "cost_of_revenue"
    | "operating_expense"
    | "non_operating"
    | "tax"
    // BS categories
    | "current_asset"
    | "fixed_asset"
    | "current_liability"
    | "non_current_liability"
    | "equity"
    // CFS categories
    | "operating"
    | "investing"
    | "financing"
    | "cash_bridge"
    // Shared
    | "calculated";

  /** Who set the taxonomy; "system" = deterministic template; "user" = do not overwrite; "ai" | "fallback" = auto-derived. */
  taxonomySource?: "system" | "user" | "ai" | "fallback";

  /** Taxonomy trust status. "trusted" = system/user/high-confidence AI; "needs_review" = fallback/low-confidence AI; "unresolved" = no taxonomy. */
  taxonomyStatus?: "trusted" | "needs_review" | "unresolved";
}

/**
 * Generic embedded disclosure (e.g. SBC, amortization of intangibles).
 * Stored per row, by year; does not modify reported IS line values.
 */
export type EmbeddedDisclosureType = "sbc" | "amortization_intangibles" | "depreciation_embedded" | "restructuring_charges";

export interface EmbeddedDisclosureItem {
  type: EmbeddedDisclosureType;
  rowId: string;
  values: Record<string, number>;
  /** Human-readable label for preview when row is not in statement tree (e.g. after switching project). */
  label?: string;
}

export type WizardStepId =
  | "historicals"
  | "is_build"
  | "bs_build"
  | "cfs_build"
  | "schedules"
  | "projections"
  | "dcf";

export interface WizardStep {
  id: WizardStepId;
  label: string;
  description: string;
}

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: "historicals",
    label: "Historicals",
    description: "Enter and normalize historical financials",
  },
  {
    id: "is_build",
    label: "IS Build",
    description: "Build the Income Statement structure",
  },
  {
    id: "bs_build",
    label: "BS Build",
    description: "Build the Balance Sheet structure",
  },
  {
    id: "cfs_build",
    label: "CFS Build",
    description: "Build the Cash Flow Statement structure",
  },
  {
    id: "schedules",
    label: "Schedules",
    description: "Working Capital, Debt, Capex schedules",
  },
  {
    id: "projections",
    label: "Projections",
    description: "Forecast 5–10 years using drivers",
  },
  {
    id: "dcf",
    label: "DCF Valuation",
    description: "UFCF + WACC + terminal value",
  },
];

export type CompanyType = "public" | "private";

export interface ModelMeta {
  companyName: string;
  companyType: CompanyType;
  years: {
    historical: string[];
    projection: string[];
  };
  steps: WizardStep[];
}

export interface ModelState {
  meta: ModelMeta;

  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];

  schedules: {
    workingCapital: Row[];
    debt: Row[];
    capex: Row[];
  };

  currentStepId: WizardStepId;
  completedStepIds: WizardStepId[];
  isModelComplete: boolean;
}

export interface ModelActions {
  goToStep: (stepId: WizardStepId) => void;
  completeCurrentStep: () => void;

  addRevenueStream: (label: string) => void;
  updateIncomeStatementValue: (rowId: string, year: string, value: number) => void;
}