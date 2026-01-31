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
  // Cash Flow Statement link metadata (auto-determined by system)
  // This stores the correct treatment per international accounting standards
  cfsLink?: {
    section: "operating" | "investing" | "financing";
    cfsItemId?: string; // ID of the CFS line item this links to (optional)
    impact: "positive" | "negative" | "neutral" | "calculated";
    description: string; // Description of the CFS treatment (stored for memory)
  };
  // Income Statement link metadata (auto-determined by system)
  isLink?: {
    isItemId: string; // ID of the IS line item this links to
    description: string; // Description of the IS link (stored for memory)
  };
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