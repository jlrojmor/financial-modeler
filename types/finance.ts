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
  /** Who set classification; "user" = do not overwrite with AI; "fallback" = label-based rules when AI unavailable. */
  classificationSource?: "user" | "ai" | "fallback";
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