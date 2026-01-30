export type ValueType = "currency" | "percent" | "number" | "text";

export type RowKind =
  | "input"
  | "calc"
  | "subtotal"
  | "total"
  | "header";

export type StatementType = "IS" | "BS" | "CFS" | "SCHEDULE";

export interface Row {
  id: string;
  statement: StatementType;
  label: string;
  kind: RowKind;
  valueType: ValueType;
  values?: Record<string, number | string | null>;
  excelFormula?: string;
  children?: Row[];
  isCollapsed?: boolean;
}

export interface ModelMeta {
  modelId: string;
  companyName: string;
  companyType: "public" | "private";
  currency: "USD" | "MXN" | "EUR" | "GBP";
  historicalYears: string[];
  projectionYears: string[];
  midYearConvention: boolean;
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
}

export type WizardStepId =
  | "historicals"
  | "is_build"
  | "bs_build"
  | "cfs_build"
  | "schedules"
  | "projections"
  | "dcf_valuation";

export const WIZARD_STEPS: { id: WizardStepId; label: string }[] = [
  { id: "historicals", label: "Historicals" },
  { id: "is_build", label: "IS Build" },
  { id: "bs_build", label: "BS Build" },
  { id: "cfs_build", label: "CFS Build" },
  { id: "schedules", label: "Schedules" },
  { id: "projections", label: "Projections" },
  { id: "dcf_valuation", label: "DCF Valuation" },
];