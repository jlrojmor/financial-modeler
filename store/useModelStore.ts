"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Row, WizardStepId } from "@/types/finance";
import { WIZARD_STEPS } from "@/types/finance";
import { recomputeCalculations, computeRowValue } from "@/lib/calculations";
import {
  createIncomeStatementTemplate,
  createBalanceSheetTemplate,
  createCashFlowTemplate,
} from "@/lib/statement-templates";
import { getRowsForCategory } from "@/lib/bs-category-mapper";

/**
 * Helpers
 */
function addChildRow(rows: Row[], parentId: string, child: Row): Row[] {
  return rows.map((r) => {
    if (r.id === parentId) {
      const kids = r.children ? [...r.children, child] : [child];
      return { ...r, children: kids };
    }
    if (r.children?.length) {
      return { ...r, children: addChildRow(r.children, parentId, child) };
    }
    return r;
  });
}

function updateRowValueDeep(
  rows: Row[],
  rowId: string,
  year: string,
  value: number
): Row[] {
  return rows.map((r) => {
    if (r.id === rowId) {
      return {
        ...r,
        values: { ...(r.values ?? {}), [year]: value },
      };
    }
    if (r.children?.length) {
      return { ...r, children: updateRowValueDeep(r.children, rowId, year, value) };
    }
    return r;
  });
}

function removeRowDeep(rows: Row[], rowId: string): Row[] {
  return rows
    .filter((r) => r.id !== rowId)
    .map((r) => {
      if (r.children?.length) {
        return { ...r, children: removeRowDeep(r.children, rowId) };
      }
      return r;
    });
}

/** Find a row anywhere in the tree by id */
function findRowDeep(rows: Row[], rowId: string): Row | null {
  for (const r of rows) {
    if (r.id === rowId) return r;
    if (r.children?.length) {
      const found = findRowDeep(r.children, rowId);
      if (found) return found;
    }
  }
  return null;
}

/** Add an existing row as child of parentId (for moving into WC, etc.) */
function addExistingChildToParent(
  rows: Row[],
  parentId: string,
  childRow: Row,
  atIndex?: number
): Row[] {
  return rows.map((r) => {
    if (r.id !== parentId) {
      if (r.children?.length) {
        return { ...r, children: addExistingChildToParent(r.children, parentId, childRow, atIndex) };
      }
      return r;
    }
    const children = [...(r.children ?? [])];
    const idx = atIndex ?? children.length;
    children.splice(idx, 0, childRow);
    return { ...r, children };
  });
}

function updateRowKindDeep(
  rows: Row[],
  rowId: string,
  kind: "input" | "calc" | "subtotal" | "total"
): Row[] {
  return rows.map((r) => {
    if (r.id === rowId) {
      return { ...r, kind };
    }
    if (r.children?.length) {
      return { ...r, children: updateRowKindDeep(r.children, rowId, kind) };
    }
    return r;
  });
}

function uuid() {
  // Simple, reliable unique id without crypto
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

/**
 * Ensure wc_change has one child per BS current asset (except cash) and current liability (except short-term debt).
 * Only adds missing children; preserves existing children and their values.
 */
function ensureWcChildrenInCashFlow(cashFlow: Row[], balanceSheet: Row[]): Row[] {
  if (balanceSheet.length === 0) return cashFlow;

  const currentAssets = getRowsForCategory(balanceSheet, "current_assets");
  const currentLiabilities = getRowsForCategory(balanceSheet, "current_liabilities");
  const excludeIds = new Set([
    "cash",
    "st_debt",
    "total_current_assets",
    "total_current_liabilities",
  ]);
  const desired = [
    ...currentAssets.filter(
      (r) => !excludeIds.has(r.id) && !r.id.startsWith("total")
    ),
    ...currentLiabilities.filter(
      (r) => !excludeIds.has(r.id) && !r.id.startsWith("total")
    ),
  ];
  const desiredById = new Map(desired.map((r) => [r.id, r]));
  const desiredList = Array.from(desiredById.values());

  return cashFlow.map((r) => {
    if (r.id !== "wc_change") {
      return r.children?.length
        ? { ...r, children: ensureWcChildrenInCashFlow(r.children, balanceSheet) }
        : r;
    }
    const existingChildren = r.children ?? [];
    const existingById = new Map(existingChildren.map((c) => [c.id, c]));
    // Build exactly one child per desired id (dedupe); use existing if present (keep values), else add new
    const newChildren: Row[] = [];
    const seen = new Set<string>();
    for (const bs of desiredList) {
      if (seen.has(bs.id)) continue;
      seen.add(bs.id);
      const existing = existingById.get(bs.id);
      if (existing) {
        newChildren.push(existing);
      } else {
        newChildren.push({
          id: bs.id,
          label: bs.label,
          kind: "input" as const,
          valueType: "currency" as const,
          values: {} as Record<string, number>,
        });
      }
    }
    return { ...r, children: newChildren };
  });
}

/**
 * Types for store state/actions
 */
export type ModelType = "dcf" | "lbo" | "startup";
export type CompanyType = "public" | "private";

export type CurrencyUnit = "units" | "thousands" | "millions";

export type ModelMeta = {
  companyName: string;
  companyType: CompanyType;
  currency: string;
  currencyUnit: CurrencyUnit;
  modelType: ModelType;
  years: {
    historical: string[];
    projection: string[];
  };
};

export type ModelState = {
  meta: ModelMeta;
  isInitialized: boolean;
  _hasHydrated: boolean;

  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];

  schedules: {
    workingCapital: Row[];
    debt: Row[];
    capex: Row[];
  };

  // Stock-Based Compensation annotation (for transparency, doesn't affect calculations)
  sbcBreakdowns: Record<string, Record<string, number>>; // { [categoryId]: { [year]: value } }
  
  // D&A location tracking (where D&A is embedded: "cogs", "sga", or "both")
  danaLocation: "cogs" | "sga" | "both" | null;
  // D&A values by year (only if we have exact allocation)
  danaBreakdowns: Record<string, number>; // { [year]: value }

  currentStepId: WizardStepId;
  completedStepIds: WizardStepId[];
  isModelComplete: boolean;

  // Section lock and expand state for Builder Panel
  sectionLocks: Record<string, boolean>; // { [sectionId]: isLocked }
  sectionExpanded: Record<string, boolean>; // { [sectionId]: isExpanded }
};

export type ModelActions = {
  initializeModel: (meta: ModelMeta) => void;
  recalculateAll: () => void;
  goToStep: (stepId: WizardStepId) => void;
  completeCurrentStep: () => void;
  saveCurrentStep: () => void;
  continueToNextStep: () => void;

  // Row management - generic for any statement
  addChildRow: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", parentId: string, label: string) => void;
  insertRow: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", index: number, row: Row) => void;
  moveRow: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string, direction: "up" | "down") => void;
  removeRow: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string) => void;
  updateRowValue: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string, year: string, value: number) => void;
  updateRowKind: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string, kind: "input" | "calc" | "subtotal" | "total") => void;

  /** Sync Working Capital change children from Balance Sheet (CA except cash, CL except short-term debt). */
  ensureWcChildrenFromBS: () => void;

  /** Cash Flow builder: reorder top-level row (visual order only). */
  reorderCashFlowTopLevel: (fromIndex: number, toIndex: number) => void;
  /** Cash Flow builder: reorder children of wc_change. */
  reorderWcChildren: (fromIndex: number, toIndex: number) => void;
  /** Cash Flow builder: move a row into Working Capital (becomes child of wc_change, included in WC subtotal). */
  moveCashFlowRowIntoWc: (rowId: string, insertAtIndex?: number) => void;
  /** Cash Flow builder: move a row out of Working Capital (becomes top-level operating item, no longer in WC subtotal). */
  moveCashFlowRowOutOfWc: (rowId: string, insertAtTopLevelIndex?: number) => void;

  // SBC annotation
  updateSbcValue: (categoryId: string, year: string, value: number) => void;
  
  // Section lock and expand management
  lockSection: (sectionId: string) => void;
  unlockSection: (sectionId: string) => void;
  toggleSectionExpanded: (sectionId: string) => void;
  setSectionExpanded: (sectionId: string, expanded: boolean) => void;
  
  // Years management
  updateYears: (years: { historical: string[]; projection: string[] }) => void;
  
  // Legacy/backward compatibility
  addRevenueStream: (label: string) => void;
  updateIncomeStatementValue: (rowId: string, year: string, value: number) => void;
};

/**
 * Default state
 * CRITICAL: meta.years.historical + meta.years.projection must ALWAYS exist
 */
const defaultState: ModelState = {
  meta: {
    companyName: "NewCo",
    companyType: "private",
    currency: "USD",
    currencyUnit: "millions",
    modelType: "dcf",
    years: {
      historical: ["2023A", "2024A"],
      projection: ["2025E", "2026E", "2027E", "2028E", "2029E"],
    },
  },
  isInitialized: false,
  _hasHydrated: false,

  incomeStatement: [
    {
      id: "rev",
      label: "Revenue",
      kind: "input", // Start as input, becomes calc when breakdowns are added
      valueType: "currency",
      values: {},
      children: [], // revenue streams go here
    },
    {
      id: "cogs",
      label: "COGS",
      kind: "input", // Start as input, becomes calc when breakdowns are added
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "gross_profit",
      label: "Gross Profit",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "gross_margin",
      label: "Gross Margin %",
      kind: "calc",
      valueType: "percent",
      values: {},
      children: [],
    },
  ],

  balanceSheet: [
    {
      id: "cash",
      label: "Cash",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
  ],

  cashFlow: [
    {
      id: "net_income",
      label: "Net Income",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
  ],

  schedules: {
    workingCapital: [],
    debt: [],
    capex: [],
  },

  sbcBreakdowns: {},
  
  danaLocation: null,
  danaBreakdowns: {},

  currentStepId: "historicals",
  completedStepIds: [],
  isModelComplete: false,

  // Section lock and expand state - default all sections unlocked and expanded
  sectionLocks: {},
  sectionExpanded: {},
};

/**
 * Store with persistence
 */
export const useModelStore = create<ModelState & ModelActions>()(
  persist(
    (set, get) => ({
  ...defaultState,

  initializeModel: (meta) => {
    const state = get();
    // Only initialize if not already initialized (preserve existing data)
    if (!state.isInitialized) {
      let incomeStatement = state.incomeStatement.length > 0 
        ? state.incomeStatement 
        : createIncomeStatementTemplate();
      let balanceSheet = state.balanceSheet.length > 0 
        ? state.balanceSheet 
        : createBalanceSheetTemplate();
      let cashFlow = state.cashFlow.length > 0 
        ? state.cashFlow 
        : createCashFlowTemplate();

      // Migration: Ensure core Income Statement skeleton items always exist
      // These are the fundamental structure of an IS and cannot be removed
      const coreISItems = [
        { id: "rev", label: "Revenue", kind: "input", valueType: "currency", after: null },
        { id: "cogs", label: "Cost of Goods Sold (COGS)", kind: "input", valueType: "currency", after: "rev" },
        { id: "gross_profit", label: "Gross Profit", kind: "calc", valueType: "currency", after: "cogs" },
        { id: "gross_margin", label: "Gross Margin %", kind: "calc", valueType: "percent", after: "gross_profit" },
        { id: "sga", label: "Selling, General & Administrative (SG&A)", kind: "input", valueType: "currency", after: "gross_margin" },
        { id: "ebit", label: "EBIT (Operating Income)", kind: "calc", valueType: "currency", after: "sga" },
        { id: "ebit_margin", label: "EBIT Margin %", kind: "calc", valueType: "percent", after: "ebit" },
        { id: "danda", label: "Depreciation & Amortization (D&A)", kind: "input", valueType: "currency", after: "ebit_margin" },
        { id: "interest_expense", label: "Interest Expense", kind: "input", valueType: "currency", after: "danda" },
        { id: "interest_income", label: "Interest Income", kind: "input", valueType: "currency", after: "interest_expense" },
        { id: "other_income", label: "Other Income / (Expense), net", kind: "input", valueType: "currency", after: "interest_income" },
        { id: "ebt", label: "EBT (Earnings Before Tax)", kind: "calc", valueType: "currency", after: "other_income" },
        { id: "tax", label: "Income Tax Expense", kind: "input", valueType: "currency", after: "ebt" },
        { id: "net_income", label: "Net Income", kind: "calc", valueType: "currency", after: "tax" },
        { id: "net_income_margin", label: "Net Income Margin %", kind: "calc", valueType: "percent", after: "net_income" },
      ];
      
      // Ensure each core item exists, and if not, add it in the correct position
      coreISItems.forEach((coreItem) => {
        const exists = incomeStatement.some((r) => r.id === coreItem.id);
        if (!exists) {
          // Find the correct position based on the "after" reference
          let insertIndex = incomeStatement.length;
          if (coreItem.after) {
            const afterIndex = incomeStatement.findIndex((r) => r.id === coreItem.after);
            if (afterIndex >= 0) {
              insertIndex = afterIndex + 1;
            }
          } else {
            // First item (rev) - insert at beginning
            insertIndex = 0;
          }
          incomeStatement.splice(insertIndex, 0, {
            id: coreItem.id,
            label: coreItem.label,
            kind: coreItem.kind as any,
            valueType: coreItem.valueType as any,
            values: {},
            children: [],
          });
        }
      });

      // Migration: Ensure gross_margin exists (added in later version)
      const hasGrossMargin = incomeStatement.some((r) => r.id === "gross_margin");
      if (!hasGrossMargin) {
        const grossProfitIndex = incomeStatement.findIndex((r) => r.id === "gross_profit");
        if (grossProfitIndex >= 0) {
          // Insert gross_margin right after gross_profit
          incomeStatement.splice(grossProfitIndex + 1, 0, {
            id: "gross_margin",
            label: "Gross Margin %",
            kind: "calc",
            valueType: "percent",
            values: {},
            children: [],
          });
        }
      }

      // Migration: Ensure SG&A exists (should always be in template, but check anyway)
      const hasSga = incomeStatement.some((r) => r.id === "sga");
      if (!hasSga) {
        const grossMarginIndex = incomeStatement.findIndex((r) => r.id === "gross_margin");
        const insertIndex = grossMarginIndex >= 0 ? grossMarginIndex + 1 : incomeStatement.length;
        // Insert SG&A after gross_margin (or at end if gross_margin not found)
        incomeStatement.splice(insertIndex, 0, {
          id: "sga",
          label: "Selling, General & Administrative (SG&A)",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure EBITDA exists (should be in template, but check anyway)
      const hasEbitda = incomeStatement.some((r) => r.id === "ebitda");
      if (!hasEbitda) {
        // Find where to insert EBITDA - after Other Operating Expenses
        const otherOpexIndex = incomeStatement.findIndex((r) => r.id === "other_opex");
        const rdIndex = incomeStatement.findIndex((r) => r.id === "rd");
        const insertIndex = otherOpexIndex >= 0 ? otherOpexIndex + 1 : 
                           rdIndex >= 0 ? rdIndex + 1 : 
                           incomeStatement.length;
        // Insert EBITDA
        incomeStatement.splice(insertIndex, 0, {
          id: "ebitda",
          label: "EBITDA",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure EBITDA margin exists (added in later version)
      const hasEbitdaMargin = incomeStatement.some((r) => r.id === "ebitda_margin");
      if (!hasEbitdaMargin) {
        const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
        if (ebitdaIndex >= 0) {
          // Insert EBITDA margin right after EBITDA
          incomeStatement.splice(ebitdaIndex + 1, 0, {
            id: "ebitda_margin",
            label: "EBITDA Margin %",
            kind: "calc",
            valueType: "percent",
            values: {},
            children: [],
          });
        }
      }

      // Migration: Remove EBITDA and EBITDA Margin from IS (D&A is shown directly, then EBIT)
      const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
      if (ebitdaIndex >= 0) {
        incomeStatement.splice(ebitdaIndex, 1);
      }
      const ebitdaMarginIndex = incomeStatement.findIndex((r) => r.id === "ebitda_margin");
      if (ebitdaMarginIndex >= 0) {
        incomeStatement.splice(ebitdaMarginIndex, 1);
      }

      // Migration: Ensure EBIT exists and is in the correct position (after SG&A)
      const hasEbit = incomeStatement.some((r) => r.id === "ebit");
      const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
      const sgaIndex = incomeStatement.findIndex((r) => r.id === "sga");
      
      // #region agent log
      if (typeof window !== 'undefined') {
        fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:365',message:'EBIT Position Check',data:{hasEbit,ebitIndex,sgaIndex,incomeStatementLength:incomeStatement.length,incomeStatementIds:incomeStatement.map(r=>r.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      }
      // #endregion
      
      if (!hasEbit) {
        // Insert EBIT after SG&A
        const insertIndex = sgaIndex >= 0 ? sgaIndex + 1 : incomeStatement.length;
        // #region agent log
        if (typeof window !== 'undefined') {
          fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:373',message:'Inserting EBIT (not exists)',data:{insertIndex,sgaIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        }
        // #endregion
        incomeStatement.splice(insertIndex, 0, {
          id: "ebit",
          label: "EBIT (Operating Income)",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        });
      } else if (ebitIndex >= 0 && sgaIndex >= 0) {
        // EBIT exists - check if it needs to be moved
        if (ebitIndex < sgaIndex) {
          // #region agent log
          if (typeof window !== 'undefined') {
            fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:387',message:'Moving EBIT (before SG&A)',data:{ebitIndex,sgaIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          }
          // #endregion
          // EBIT exists but is before SG&A - move it after SG&A
          const ebitRow = incomeStatement[ebitIndex];
          incomeStatement.splice(ebitIndex, 1);
          const newIndex = sgaIndex; // sgaIndex is now correct since we removed EBIT
          incomeStatement.splice(newIndex + 1, 0, ebitRow);
        } else if (ebitIndex > sgaIndex + 3) {
          // #region agent log
          if (typeof window !== 'undefined') {
            fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:395',message:'Moving EBIT (too far after SG&A)',data:{ebitIndex,sgaIndex,distance:ebitIndex-sgaIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          }
          // #endregion
          // EBIT exists but is too far after SG&A (likely at the end) - move it right after SG&A
          const ebitRow = incomeStatement[ebitIndex];
          incomeStatement.splice(ebitIndex, 1);
          const newIndex = sgaIndex;
          incomeStatement.splice(newIndex + 1, 0, ebitRow);
        } else {
          // #region agent log
          if (typeof window !== 'undefined') {
            fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:403',message:'EBIT position OK',data:{ebitIndex,sgaIndex,distance:ebitIndex-sgaIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          }
          // #endregion
        }
      }
      
      // Also ensure EBIT margin is right after EBIT
      const hasEbitMargin = incomeStatement.some((r) => r.id === "ebit_margin");
      const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
      const currentEbitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
      
      if (!hasEbitMargin && currentEbitIndex >= 0) {
        incomeStatement.splice(currentEbitIndex + 1, 0, {
          id: "ebit_margin",
          label: "EBIT Margin %",
          kind: "calc",
          valueType: "percent",
          values: {},
          children: [],
        });
      } else if (ebitMarginIndex >= 0 && currentEbitIndex >= 0 && ebitMarginIndex !== currentEbitIndex + 1) {
        // EBIT margin exists but is not right after EBIT - move it
        const ebitMarginRow = incomeStatement[ebitMarginIndex];
        incomeStatement.splice(ebitMarginIndex, 1);
        const newIndex = currentEbitIndex;
        incomeStatement.splice(newIndex + 1, 0, ebitMarginRow);
      }

      // Migration: Update "Other Income / (Expense)" label to "Other Income / (Expense), net"
      const otherIncomeRow = incomeStatement.find((r) => r.id === "other_income");
      if (otherIncomeRow && otherIncomeRow.label === "Other Income / (Expense)") {
        otherIncomeRow.label = "Other Income / (Expense), net";
      }

      // Migration: Ensure Balance Sheet subtotals exist and are in correct order
      // This ensures subtotals appear in the preview in the right positions
      const totalCurrentAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_current_assets");
      const totalAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_assets");
      const totalCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_current_liabilities");
      const totalLiabIndex = balanceSheet.findIndex((r) => r.id === "total_liabilities");
      const totalEquityIndex = balanceSheet.findIndex((r) => r.id === "total_equity");
      const totalLiabAndEquityIndex = balanceSheet.findIndex((r) => r.id === "total_liab_and_equity");
      
      // Ensure Total Current Assets exists (after current assets items, before fixed assets)
      if (totalCurrentAssetsIndex === -1) {
        // Find last current asset item
        const caIds = ["cash", "ar", "inventory", "other_ca"];
        let insertIndex = 0;
        for (let i = balanceSheet.length - 1; i >= 0; i--) {
          if (caIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("ca_")) {
            insertIndex = i + 1;
            break;
          }
        }
        balanceSheet.splice(insertIndex, 0, {
          id: "total_current_assets",
          label: "Total Current Assets",
          kind: "subtotal",
          valueType: "currency",
          values: {},
          children: [],
        });
      }
      
      // Ensure Total Fixed Assets exists (after fixed assets items, before total_assets)
      const totalFixedAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_fixed_assets");
      if (totalFixedAssetsIndex === -1) {
        const newTotalCAIndex = balanceSheet.findIndex((r) => r.id === "total_current_assets");
        const faIds = ["ppe", "intangible_assets", "other_assets"];
        let insertIndex = newTotalCAIndex + 1;
        for (let i = balanceSheet.length - 1; i > newTotalCAIndex; i--) {
          if (faIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("fa_")) {
            insertIndex = i + 1;
            break;
          }
        }
        balanceSheet.splice(insertIndex, 0, {
          id: "total_fixed_assets",
          label: "Total Fixed Assets",
          kind: "subtotal",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Ensure Total Assets exists (after total_fixed_assets, before liabilities)
      if (totalAssetsIndex === -1) {
        const newTotalFixedAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_fixed_assets");
        const insertIndex = newTotalFixedAssetsIndex >= 0 ? newTotalFixedAssetsIndex + 1 : balanceSheet.length;
        balanceSheet.splice(insertIndex, 0, {
          id: "total_assets",
          label: "Total Assets",
          kind: "total",
          valueType: "currency",
          values: {},
          children: [],
        });
      }
      
      // Ensure Total Current Liabilities exists
      if (totalCurrentLiabIndex === -1) {
        const newTotalAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_assets");
        const clIds = ["ap", "st_debt", "other_cl"];
        let insertIndex = newTotalAssetsIndex + 1;
        for (let i = balanceSheet.length - 1; i > newTotalAssetsIndex; i--) {
          if (clIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("cl_")) {
            insertIndex = i + 1;
            break;
          }
        }
        balanceSheet.splice(insertIndex, 0, {
          id: "total_current_liabilities",
          label: "Total Current Liabilities",
          kind: "subtotal",
          valueType: "currency",
          values: {},
          children: [],
        });
      }
      
      // Ensure Total Non-Current Liabilities exists (after non-current liabilities items, before total_liabilities)
      const totalNonCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_non_current_liabilities");
      if (totalNonCurrentLiabIndex === -1) {
        const newTotalCLIndex = balanceSheet.findIndex((r) => r.id === "total_current_liabilities");
        const nclIds = ["lt_debt", "other_liab"];
        let insertIndex = newTotalCLIndex + 1;
        for (let i = balanceSheet.length - 1; i > newTotalCLIndex; i--) {
          if (nclIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("ncl_")) {
            insertIndex = i + 1;
            break;
          }
        }
        balanceSheet.splice(insertIndex, 0, {
          id: "total_non_current_liabilities",
          label: "Total Non-Current Liabilities",
          kind: "subtotal",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Ensure Total Liabilities exists (after total_non_current_liabilities, before equity)
      if (totalLiabIndex === -1) {
        const newTotalNonCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_non_current_liabilities");
        const insertIndex = newTotalNonCurrentLiabIndex >= 0 ? newTotalNonCurrentLiabIndex + 1 : balanceSheet.length;
        balanceSheet.splice(insertIndex, 0, {
          id: "total_liabilities",
          label: "Total Liabilities",
          kind: "total",
          valueType: "currency",
          values: {},
          children: [],
        });
      }
      
      // Ensure Total Equity exists
      if (totalEquityIndex === -1) {
        const newTotalLiabIndex = balanceSheet.findIndex((r) => r.id === "total_liabilities");
        const equityIds = ["common_stock", "retained_earnings", "other_equity"];
        let insertIndex = newTotalLiabIndex + 1;
        for (let i = balanceSheet.length - 1; i > newTotalLiabIndex; i--) {
          if (equityIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("equity_")) {
            insertIndex = i + 1;
            break;
          }
        }
        balanceSheet.splice(insertIndex, 0, {
          id: "total_equity",
          label: "Total Equity",
          kind: "total",
          valueType: "currency",
          values: {},
          children: [],
        });
      }
      
      // Ensure Total Liabilities & Equity exists (at the very end)
      if (totalLiabAndEquityIndex === -1) {
        balanceSheet.push({
          id: "total_liab_and_equity",
          label: "Total Liabilities & Equity",
          kind: "total",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure CFS items exist (D&A, SBC, WC Change, Operating CF, Investing items)
      // Migration: Ensure D&A exists in CFS
      const hasDandaInCFS = cashFlow.some((r) => r.id === "danda");
      if (!hasDandaInCFS) {
        const netIncomeIndex = cashFlow.findIndex((r) => r.id === "net_income");
        const insertIndex = netIncomeIndex >= 0 ? netIncomeIndex + 1 : cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "danda",
          label: "Depreciation & Amortization",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure SBC exists in CFS
      const hasSbcInCFS = cashFlow.some((r) => r.id === "sbc");
      if (!hasSbcInCFS) {
        const dandaIndex = cashFlow.findIndex((r) => r.id === "danda");
        const wcChangeIndex = cashFlow.findIndex((r) => r.id === "wc_change");
        const insertIndex = dandaIndex >= 0 ? dandaIndex + 1 : 
                           wcChangeIndex >= 0 ? wcChangeIndex : 
                           cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "sbc",
          label: "Stock-Based Compensation",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure WC Change exists in CFS
      const hasWcChangeInCFS = cashFlow.some((r) => r.id === "wc_change");
      if (!hasWcChangeInCFS) {
        const sbcIndex = cashFlow.findIndex((r) => r.id === "sbc");
        const otherOperatingIndex = cashFlow.findIndex((r) => r.id === "other_operating");
        const operatingCfIndex = cashFlow.findIndex((r) => r.id === "operating_cf");
        const insertIndex = sbcIndex >= 0 ? sbcIndex + 1 : 
                           otherOperatingIndex >= 0 ? otherOperatingIndex : 
                           operatingCfIndex >= 0 ? operatingCfIndex : 
                           cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "wc_change",
          label: "Change in Working Capital",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure Operating CF total exists
      const hasOperatingCf = cashFlow.some((r) => r.id === "operating_cf");
      if (!hasOperatingCf) {
        const otherOperatingIndex = cashFlow.findIndex((r) => r.id === "other_operating");
        const insertIndex = otherOperatingIndex >= 0 ? otherOperatingIndex + 1 : cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "operating_cf",
          label: "Cash from Operating Activities",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Migration: Ensure Investing section items exist (capex, other_investing, investing_cf)
      const hasCapex = cashFlow.some((r) => r.id === "capex");
      if (!hasCapex) {
        const operatingCfIndex = cashFlow.findIndex((r) => r.id === "operating_cf");
        const insertIndex = operatingCfIndex >= 0 ? operatingCfIndex + 1 : cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "capex",
          label: "Capital Expenditures (CapEx)",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      const hasOtherInvesting = cashFlow.some((r) => r.id === "other_investing");
      if (!hasOtherInvesting) {
        const capexIndex = cashFlow.findIndex((r) => r.id === "capex");
        const insertIndex = capexIndex >= 0 ? capexIndex + 1 : cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "other_investing",
          label: "Other Investing Activities",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      const hasInvestingCf = cashFlow.some((r) => r.id === "investing_cf");
      if (!hasInvestingCf) {
        const otherInvestingIndex = cashFlow.findIndex((r) => r.id === "other_investing");
        const insertIndex = otherInvestingIndex >= 0 ? otherInvestingIndex + 1 : cashFlow.length;
        cashFlow.splice(insertIndex, 0, {
          id: "investing_cf",
          label: "Cash from Investing Activities",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        });
      }

      // Recalculate all years for all statements
      const allYears = [...(meta.years.historical || []), ...(meta.years.projection || [])];
      allYears.forEach((year) => {
        const allStatements = { incomeStatement, balanceSheet, cashFlow };
        const sbcBreakdowns = get().sbcBreakdowns;
        const danaBreakdowns = get().danaBreakdowns;
        incomeStatement = recomputeCalculations(incomeStatement, year, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns);
        balanceSheet = recomputeCalculations(balanceSheet, year, balanceSheet, allStatements, sbcBreakdowns, danaBreakdowns);
        cashFlow = recomputeCalculations(cashFlow, year, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns);
      });

      set({
        meta,
        isInitialized: true,
        currentStepId: "historicals",
        incomeStatement,
        balanceSheet,
        cashFlow,
      });
    } else {
      // If already initialized, just update meta if needed
      set({ meta });
    }
  },

  recalculateAll: () => {
    const state = get();
    if (!state.isInitialized) return;

    const allYears = [
      ...(state.meta.years.historical || []),
      ...(state.meta.years.projection || []),
    ];

    let incomeStatement = state.incomeStatement;
    let balanceSheet = state.balanceSheet;
    let cashFlow = state.cashFlow;
    
    // #region agent log
    if (typeof window !== 'undefined') {
      fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:692',message:'recalculateAll - Before migrations',data:{cashFlowIds:cashFlow.map(r=>r.id),cashFlowCount:cashFlow.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'O'})}).catch(()=>{});
    }
    // #endregion

    // Migration: Ensure core Income Statement skeleton items always exist
    // These are the fundamental structure of an IS and cannot be removed
    const coreISItems = [
      { id: "rev", label: "Revenue", kind: "input", valueType: "currency", after: null },
      { id: "cogs", label: "Cost of Goods Sold (COGS)", kind: "input", valueType: "currency", after: "rev" },
      { id: "gross_profit", label: "Gross Profit", kind: "calc", valueType: "currency", after: "cogs" },
      { id: "gross_margin", label: "Gross Margin %", kind: "calc", valueType: "percent", after: "gross_profit" },
      { id: "sga", label: "Selling, General & Administrative (SG&A)", kind: "input", valueType: "currency", after: "gross_margin" },
      { id: "ebit", label: "EBIT (Operating Income)", kind: "calc", valueType: "currency", after: "sga" },
      { id: "ebit_margin", label: "EBIT Margin %", kind: "calc", valueType: "percent", after: "ebit" },
      { id: "danda", label: "Depreciation & Amortization (D&A)", kind: "input", valueType: "currency", after: "ebit_margin" },
      { id: "interest_expense", label: "Interest Expense", kind: "input", valueType: "currency", after: "danda" },
      { id: "interest_income", label: "Interest Income", kind: "input", valueType: "currency", after: "interest_expense" },
      { id: "other_income", label: "Other Income / (Expense), net", kind: "input", valueType: "currency", after: "interest_income" },
      { id: "ebt", label: "EBT (Earnings Before Tax)", kind: "calc", valueType: "currency", after: "other_income" },
      { id: "tax", label: "Income Tax Expense", kind: "input", valueType: "currency", after: "ebt" },
      { id: "net_income", label: "Net Income", kind: "calc", valueType: "currency", after: "tax" },
      { id: "net_income_margin", label: "Net Income Margin %", kind: "calc", valueType: "percent", after: "net_income" },
    ];
    
    // Ensure each core item exists, and if not, add it in the correct position
    coreISItems.forEach((coreItem) => {
      const exists = incomeStatement.some((r) => r.id === coreItem.id);
      if (!exists) {
        // Find the correct position based on the "after" reference
        let insertIndex = incomeStatement.length;
        if (coreItem.after) {
          const afterIndex = incomeStatement.findIndex((r) => r.id === coreItem.after);
          if (afterIndex >= 0) {
            insertIndex = afterIndex + 1;
          }
        } else {
          // First item (rev) - insert at beginning
          insertIndex = 0;
        }
        incomeStatement.splice(insertIndex, 0, {
          id: coreItem.id,
          label: coreItem.label,
          kind: coreItem.kind as any,
          valueType: coreItem.valueType as any,
          values: {},
          children: [],
        });
      }
    });

    // Migration: Ensure D&A exists in CFS (should be in template, but check anyway)
    const hasDandaInCFS = cashFlow.some((r) => r.id === "danda");
    if (!hasDandaInCFS) {
      // Find where to insert D&A - after net_income
      const netIncomeIndex = cashFlow.findIndex((r) => r.id === "net_income");
      const insertIndex = netIncomeIndex >= 0 ? netIncomeIndex + 1 : cashFlow.length;
      cashFlow.splice(insertIndex, 0, {
        id: "danda",
        label: "Depreciation & Amortization",
        kind: "input", // Manual input in CFO
        valueType: "currency",
        values: {},
        children: [],
      });
    } else {
      // Migration: Update D&A from "calc" to "input" (D&A is now manual input, not auto-populated)
      const dandaRow = cashFlow.find((r) => r.id === "danda");
      if (dandaRow && dandaRow.kind === "calc") {
        dandaRow.kind = "input";
      }
    }

    // Migration: Ensure SBC exists in CFS (added in later version)
    const hasSbcInCFS = cashFlow.some((r) => r.id === "sbc");
    if (!hasSbcInCFS) {
      // Find where to insert SBC - after danda, before wc_change
      const dandaIndex = cashFlow.findIndex((r) => r.id === "danda");
      const wcChangeIndex = cashFlow.findIndex((r) => r.id === "wc_change");
      const insertIndex = dandaIndex >= 0 ? dandaIndex + 1 : 
                         wcChangeIndex >= 0 ? wcChangeIndex : 
                         cashFlow.length;
      cashFlow.splice(insertIndex, 0, {
        id: "sbc",
        label: "Stock-Based Compensation",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure WC Change exists in CFS (should be in template, but check anyway)
    const hasWcChangeInCFS = cashFlow.some((r) => r.id === "wc_change");
    if (!hasWcChangeInCFS) {
      // Find where to insert WC Change - after sbc, before other_operating
      const sbcIndex = cashFlow.findIndex((r) => r.id === "sbc");
      const otherOperatingIndex = cashFlow.findIndex((r) => r.id === "other_operating");
      const operatingCfIndex = cashFlow.findIndex((r) => r.id === "operating_cf");
      const insertIndex = sbcIndex >= 0 ? sbcIndex + 1 : 
                         otherOperatingIndex >= 0 ? otherOperatingIndex : 
                         operatingCfIndex >= 0 ? operatingCfIndex : 
                         cashFlow.length;
      cashFlow.splice(insertIndex, 0, {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Operating CF total exists
    const hasOperatingCf = cashFlow.some((r) => r.id === "operating_cf");
    // #region agent log
    if (typeof window !== 'undefined') {
      fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:644',message:'Checking Operating CF',data:{hasOperatingCf,cashFlowIds:cashFlow.map(r=>r.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'F'})}).catch(()=>{});
    }
    // #endregion
    if (!hasOperatingCf) {
      // Insert after other_operating or at the end of operating section
      const otherOperatingIndex = cashFlow.findIndex((r) => r.id === "other_operating");
      const insertIndex = otherOperatingIndex >= 0 ? otherOperatingIndex + 1 : cashFlow.length;
      // #region agent log
      if (typeof window !== 'undefined') {
        fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:650',message:'Adding Operating CF',data:{insertIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'G'})}).catch(()=>{});
      }
      // #endregion
      cashFlow.splice(insertIndex, 0, {
        id: "operating_cf",
        label: "Cash from Operating Activities",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Investing section items exist (capex, other_investing, investing_cf)
    const hasCapex = cashFlow.some((r) => r.id === "capex");
    // #region agent log
    if (typeof window !== 'undefined') {
      fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:664',message:'Checking Capex',data:{hasCapex,cashFlowIds:cashFlow.map(r=>r.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H'})}).catch(()=>{});
    }
    // #endregion
    if (!hasCapex) {
      // Find where to insert - after operating_cf
      const operatingCfIndex = cashFlow.findIndex((r) => r.id === "operating_cf");
      const insertIndex = operatingCfIndex >= 0 ? operatingCfIndex + 1 : cashFlow.length;
      // #region agent log
      if (typeof window !== 'undefined') {
        fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:670',message:'Adding Capex',data:{insertIndex,operatingCfIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'I'})}).catch(()=>{});
      }
      // #endregion
      cashFlow.splice(insertIndex, 0, {
        id: "capex",
        label: "Capital Expenditures (CapEx)",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    const hasOtherInvesting = cashFlow.some((r) => r.id === "other_investing");
    // #region agent log
    if (typeof window !== 'undefined') {
      fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:682',message:'Checking Other Investing',data:{hasOtherInvesting},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'J'})}).catch(()=>{});
    }
    // #endregion
    if (!hasOtherInvesting) {
      // Insert after capex
      const capexIndex = cashFlow.findIndex((r) => r.id === "capex");
      const insertIndex = capexIndex >= 0 ? capexIndex + 1 : cashFlow.length;
      // #region agent log
      if (typeof window !== 'undefined') {
        fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:687',message:'Adding Other Investing',data:{insertIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'K'})}).catch(()=>{});
      }
      // #endregion
      cashFlow.splice(insertIndex, 0, {
        id: "other_investing",
        label: "Other Investing Activities",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    const hasInvestingCf = cashFlow.some((r) => r.id === "investing_cf");
    // #region agent log
    if (typeof window !== 'undefined') {
      fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:699',message:'Checking Investing CF',data:{hasInvestingCf},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'L'})}).catch(()=>{});
    }
    // #endregion
    if (!hasInvestingCf) {
      // Insert after other_investing
      const otherInvestingIndex = cashFlow.findIndex((r) => r.id === "other_investing");
      const insertIndex = otherInvestingIndex >= 0 ? otherInvestingIndex + 1 : cashFlow.length;
      // #region agent log
      if (typeof window !== 'undefined') {
        fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:704',message:'Adding Investing CF',data:{insertIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'M'})}).catch(()=>{});
      }
      // #endregion
      cashFlow.splice(insertIndex, 0, {
        id: "investing_cf",
        label: "Cash from Investing Activities",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    
    // #region agent log
    if (typeof window !== 'undefined') {
      fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:714',message:'After Investing Migration',data:{cashFlowIds:cashFlow.map(r=>r.id),hasCapex:cashFlow.some(r=>r.id==='capex'),hasInvestingCf:cashFlow.some(r=>r.id==='investing_cf')},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'N'})}).catch(()=>{});
    }
    // #endregion

    // Migration: Ensure Financing Activities standard items exist
    const hasDebtIssuance = cashFlow.some((r) => r.id === "debt_issuance");
    const hasDebtRepayment = cashFlow.some((r) => r.id === "debt_repayment");
    const hasEquityIssuance = cashFlow.some((r) => r.id === "equity_issuance");
    const hasDividends = cashFlow.some((r) => r.id === "dividends");
    const hasFinancingCf = cashFlow.some((r) => r.id === "financing_cf");

    if (!hasDebtIssuance) {
      const investingCfIndex = cashFlow.findIndex((r) => r.id === "investing_cf");
      const insertIndex = investingCfIndex >= 0 ? investingCfIndex + 1 : cashFlow.length;
      cashFlow.splice(insertIndex, 0, {
        id: "debt_issuance",
        label: "Debt Issuance",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    if (!hasDebtRepayment) {
      const debtIssuanceIndex = cashFlow.findIndex((r) => r.id === "debt_issuance");
      const insertIndex = debtIssuanceIndex >= 0 ? debtIssuanceIndex + 1 : cashFlow.length;
      cashFlow.splice(insertIndex, 0, {
        id: "debt_repayment",
        label: "Debt Repayment",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    if (!hasEquityIssuance) {
      const debtRepaymentIndex = cashFlow.findIndex((r) => r.id === "debt_repayment");
      const insertIndex = debtRepaymentIndex >= 0 ? debtRepaymentIndex + 1 : cashFlow.length;
      cashFlow.splice(insertIndex, 0, {
        id: "equity_issuance",
        label: "Equity Issuance",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    if (!hasDividends) {
      const equityIssuanceIndex = cashFlow.findIndex((r) => r.id === "equity_issuance");
      const insertIndex = equityIssuanceIndex >= 0 ? equityIssuanceIndex + 1 : cashFlow.length;
      cashFlow.splice(insertIndex, 0, {
        id: "dividends",
        label: "Dividends Paid",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    if (!hasFinancingCf) {
      const dividendsIndex = cashFlow.findIndex((r) => r.id === "dividends");
      const insertIndex = dividendsIndex >= 0 ? dividendsIndex + 1 : cashFlow.length;
      cashFlow.splice(insertIndex, 0, {
        id: "financing_cf",
        label: "Cash from Financing Activities",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure net_change_cash exists
    const hasNetChangeCash = cashFlow.some((r) => r.id === "net_change_cash");
    if (!hasNetChangeCash) {
      const financingCfIndex = cashFlow.findIndex((r) => r.id === "financing_cf");
      const insertIndex = financingCfIndex >= 0 ? financingCfIndex + 1 : cashFlow.length;
      cashFlow.splice(insertIndex, 0, {
        id: "net_change_cash",
        label: "Net Change in Cash",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure gross_margin exists (added in later version)
    const hasGrossMargin = incomeStatement.some((r) => r.id === "gross_margin");
    if (!hasGrossMargin) {
      const grossProfitIndex = incomeStatement.findIndex((r) => r.id === "gross_profit");
      if (grossProfitIndex >= 0) {
        // Insert gross_margin right after gross_profit
        incomeStatement.splice(grossProfitIndex + 1, 0, {
          id: "gross_margin",
          label: "Gross Margin %",
          kind: "calc",
          valueType: "percent",
          values: {},
          children: [],
        });
      }
    }

    // Migration: Ensure SG&A exists (should always be in template, but check anyway)
    const hasSga = incomeStatement.some((r) => r.id === "sga");
    if (!hasSga) {
      const grossMarginIndex = incomeStatement.findIndex((r) => r.id === "gross_margin");
      const insertIndex = grossMarginIndex >= 0 ? grossMarginIndex + 1 : incomeStatement.length;
      // Insert SG&A after gross_margin (or at end if gross_margin not found)
      incomeStatement.splice(insertIndex, 0, {
        id: "sga",
        label: "Selling, General & Administrative (SG&A)",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure EBITDA exists (should be in template, but check anyway)
    const hasEbitda = incomeStatement.some((r) => r.id === "ebitda");
    if (!hasEbitda) {
      // Find where to insert EBITDA - after Other Operating Expenses
      const otherOpexIndex = incomeStatement.findIndex((r) => r.id === "other_opex");
      const rdIndex = incomeStatement.findIndex((r) => r.id === "rd");
      const insertIndex = otherOpexIndex >= 0 ? otherOpexIndex + 1 : 
                         rdIndex >= 0 ? rdIndex + 1 : 
                         incomeStatement.length;
      // Insert EBITDA
      incomeStatement.splice(insertIndex, 0, {
        id: "ebitda",
        label: "EBITDA",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure EBITDA margin exists (added in later version)
    const hasEbitdaMargin = incomeStatement.some((r) => r.id === "ebitda_margin");
    if (!hasEbitdaMargin) {
      const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
      if (ebitdaIndex >= 0) {
        // Insert EBITDA margin right after EBITDA
        incomeStatement.splice(ebitdaIndex + 1, 0, {
          id: "ebitda_margin",
          label: "EBITDA Margin %",
          kind: "calc",
          valueType: "percent",
          values: {},
          children: [],
        });
      }
    }

    // Migration: Remove D&A from IS (it's now embedded in COGS or SG&A)
    const danaIndex = incomeStatement.findIndex((r) => r.id === "danda");
    if (danaIndex >= 0) {
      // Save D&A values to danaBreakdowns before removing
      const danaRow = incomeStatement[danaIndex];
      if (danaRow.values && Object.keys(danaRow.values).length > 0) {
        const danaBreakdowns: Record<string, number> = {};
        Object.keys(danaRow.values).forEach(year => {
          if (danaRow.values && danaRow.values[year] !== undefined) {
            danaBreakdowns[year] = danaRow.values[year];
          }
        });
        if (Object.keys(danaBreakdowns).length > 0) {
          set({ danaBreakdowns });
        }
      }
      // Remove D&A from IS
      incomeStatement.splice(danaIndex, 1);
    }

    // Migration: Ensure EBIT exists (should be in template, but check anyway)
    const hasEbit = incomeStatement.some((r) => r.id === "ebit");
    if (!hasEbit) {
      // Find where to insert EBIT - after EBITDA margin
      const ebitdaMarginIndex = incomeStatement.findIndex((r) => r.id === "ebitda_margin");
      const insertIndex = ebitdaMarginIndex >= 0 ? ebitdaMarginIndex + 1 : incomeStatement.length;
      // Insert EBIT
      incomeStatement.splice(insertIndex, 0, {
        id: "ebit",
        label: "EBIT (Operating Income)",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure EBIT Margin exists (should be in template, but check anyway)
    const hasEbitMargin = incomeStatement.some((r) => r.id === "ebit_margin");
    if (!hasEbitMargin) {
      // Find where to insert EBIT Margin - after EBIT
      const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
      const insertIndex = ebitIndex >= 0 ? ebitIndex + 1 : incomeStatement.length;
      // Insert EBIT Margin
      incomeStatement.splice(insertIndex, 0, {
        id: "ebit_margin",
        label: "EBIT Margin %",
        kind: "calc",
        valueType: "percent",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Interest Expense exists (should be in template, but check anyway)
    const hasInterestExpense = incomeStatement.some((r) => r.id === "interest_expense");
    if (!hasInterestExpense) {
      const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
      const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
      const insertIndex = ebitMarginIndex >= 0 ? ebitMarginIndex + 1 : 
                         ebitIndex >= 0 ? ebitIndex + 1 : 
                         incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "interest_expense",
        label: "Interest Expense",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Interest Income exists (should be in template, but check anyway)
    const hasInterestIncome = incomeStatement.some((r) => r.id === "interest_income");
    if (!hasInterestIncome) {
      const interestExpenseIndex = incomeStatement.findIndex((r) => r.id === "interest_expense");
      const insertIndex = interestExpenseIndex >= 0 ? interestExpenseIndex + 1 : incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "interest_income",
        label: "Interest Income",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Other Income exists (added in later version)
    const hasOtherIncome = incomeStatement.some((r) => r.id === "other_income");
    if (!hasOtherIncome) {
      const interestIncomeIndex = incomeStatement.findIndex((r) => r.id === "interest_income");
      const insertIndex = interestIncomeIndex >= 0 ? interestIncomeIndex + 1 : incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "other_income",
        label: "Other Income / (Expense)",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure EBT exists (should be in template, but check anyway)
    const hasEbt = incomeStatement.some((r) => r.id === "ebt");
    if (!hasEbt) {
      const otherIncomeIndex = incomeStatement.findIndex((r) => r.id === "other_income");
      const insertIndex = otherIncomeIndex >= 0 ? otherIncomeIndex + 1 : incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "ebt",
        label: "EBT (Earnings Before Tax)",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Tax exists (should be in template, but check anyway)
    const hasTax = incomeStatement.some((r) => r.id === "tax");
    if (!hasTax) {
      const ebtIndex = incomeStatement.findIndex((r) => r.id === "ebt");
      const insertIndex = ebtIndex >= 0 ? ebtIndex + 1 : incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "tax",
        label: "Income Tax Expense",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Net Income exists (should be in template, but check anyway)
    const hasNetIncome = incomeStatement.some((r) => r.id === "net_income");
    if (!hasNetIncome) {
      const taxIndex = incomeStatement.findIndex((r) => r.id === "tax");
      const insertIndex = taxIndex >= 0 ? taxIndex + 1 : incomeStatement.length;
      incomeStatement.splice(insertIndex, 0, {
        id: "net_income",
        label: "Net Income",
        kind: "calc",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Migration: Ensure Net Income Margin exists (added in later version)
    const hasNetIncomeMargin = incomeStatement.some((r) => r.id === "net_income_margin");
    if (!hasNetIncomeMargin) {
      const netIncomeIndex = incomeStatement.findIndex((r) => r.id === "net_income");
      if (netIncomeIndex >= 0) {
        // Insert Net Income Margin right after Net Income
        incomeStatement.splice(netIncomeIndex + 1, 0, {
          id: "net_income_margin",
          label: "Net Income Margin %",
          kind: "calc",
          valueType: "percent",
          values: {},
          children: [],
        });
      }
    }

    // Migration: Update "Other Income / (Expense)" label to "Other Income / (Expense), net"
    const otherIncomeRow = incomeStatement.find((r) => r.id === "other_income");
    if (otherIncomeRow && otherIncomeRow.label === "Other Income / (Expense)") {
      otherIncomeRow.label = "Other Income / (Expense), net";
    }

    // Migration: Ensure Balance Sheet subtotals exist (same logic as initializeModel)
    const totalCurrentAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_current_assets");
    const totalAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_assets");
    const totalCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_current_liabilities");
    const totalLiabIndex = balanceSheet.findIndex((r) => r.id === "total_liabilities");
    const totalEquityIndex = balanceSheet.findIndex((r) => r.id === "total_equity");
    const totalLiabAndEquityIndex = balanceSheet.findIndex((r) => r.id === "total_liab_and_equity");
    
    if (totalCurrentAssetsIndex === -1) {
      const caIds = ["cash", "ar", "inventory", "other_ca"];
      let insertIndex = 0;
      for (let i = balanceSheet.length - 1; i >= 0; i--) {
        if (caIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("ca_")) {
          insertIndex = i + 1;
          break;
        }
      }
      balanceSheet.splice(insertIndex, 0, {
        id: "total_current_assets",
        label: "Total Current Assets",
        kind: "subtotal",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    
    // Ensure Total Fixed Assets exists (after fixed assets items, before total_assets)
    const totalFixedAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_fixed_assets");
    if (totalFixedAssetsIndex === -1) {
      const newTotalCAIndex = balanceSheet.findIndex((r) => r.id === "total_current_assets");
      const faIds = ["ppe", "intangible_assets", "other_assets"];
      let insertIndex = newTotalCAIndex >= 0 ? newTotalCAIndex + 1 : balanceSheet.length;
      for (let i = balanceSheet.length - 1; i > (newTotalCAIndex >= 0 ? newTotalCAIndex : -1); i--) {
        if (faIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("fa_")) {
          insertIndex = i + 1;
          break;
        }
      }
      balanceSheet.splice(insertIndex, 0, {
        id: "total_fixed_assets",
        label: "Total Fixed Assets",
        kind: "subtotal",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    if (totalAssetsIndex === -1) {
      const newTotalFixedAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_fixed_assets");
      const insertIndex = newTotalFixedAssetsIndex >= 0 ? newTotalFixedAssetsIndex + 1 : balanceSheet.length;
      balanceSheet.splice(insertIndex, 0, {
        id: "total_assets",
        label: "Total Assets",
        kind: "total",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    
    if (totalCurrentLiabIndex === -1) {
      const newTotalAssetsIndex = balanceSheet.findIndex((r) => r.id === "total_assets");
      const clIds = ["ap", "st_debt", "other_cl"];
      let insertIndex = newTotalAssetsIndex >= 0 ? newTotalAssetsIndex + 1 : balanceSheet.length;
      for (let i = balanceSheet.length - 1; i > (newTotalAssetsIndex >= 0 ? newTotalAssetsIndex : -1); i--) {
        if (clIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("cl_")) {
          insertIndex = i + 1;
          break;
        }
      }
      balanceSheet.splice(insertIndex, 0, {
        id: "total_current_liabilities",
        label: "Total Current Liabilities",
        kind: "subtotal",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    
    // Ensure Total Non-Current Liabilities exists (after non-current liabilities items, before total_liabilities)
    const totalNonCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_non_current_liabilities");
    if (totalNonCurrentLiabIndex === -1) {
      const newTotalCLIndex = balanceSheet.findIndex((r) => r.id === "total_current_liabilities");
      const nclIds = ["lt_debt", "other_liab"];
      let insertIndex = newTotalCLIndex >= 0 ? newTotalCLIndex + 1 : balanceSheet.length;
      for (let i = balanceSheet.length - 1; i > (newTotalCLIndex >= 0 ? newTotalCLIndex : -1); i--) {
        if (nclIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("ncl_")) {
          insertIndex = i + 1;
          break;
        }
      }
      balanceSheet.splice(insertIndex, 0, {
        id: "total_non_current_liabilities",
        label: "Total Non-Current Liabilities",
        kind: "subtotal",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    if (totalLiabIndex === -1) {
      const newTotalNonCurrentLiabIndex = balanceSheet.findIndex((r) => r.id === "total_non_current_liabilities");
      const insertIndex = newTotalNonCurrentLiabIndex >= 0 ? newTotalNonCurrentLiabIndex + 1 : balanceSheet.length;
      balanceSheet.splice(insertIndex, 0, {
        id: "total_liabilities",
        label: "Total Liabilities",
        kind: "total",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    
    if (totalEquityIndex === -1) {
      const newTotalLiabIndex = balanceSheet.findIndex((r) => r.id === "total_liabilities");
      const equityIds = ["common_stock", "retained_earnings", "other_equity"];
      let insertIndex = newTotalLiabIndex >= 0 ? newTotalLiabIndex + 1 : balanceSheet.length;
      for (let i = balanceSheet.length - 1; i > (newTotalLiabIndex >= 0 ? newTotalLiabIndex : -1); i--) {
        if (equityIds.includes(balanceSheet[i].id) || balanceSheet[i].id.startsWith("equity_")) {
          insertIndex = i + 1;
          break;
        }
      }
      balanceSheet.splice(insertIndex, 0, {
        id: "total_equity",
        label: "Total Equity",
        kind: "total",
        valueType: "currency",
        values: {},
        children: [],
      });
    }
    
    if (totalLiabAndEquityIndex === -1) {
      balanceSheet.push({
        id: "total_liab_and_equity",
        label: "Total Liabilities & Equity",
        kind: "total",
        valueType: "currency",
        values: {},
        children: [],
      });
    }

    // Recalculate all years for all statements
    // Pass all statements so CFS can access IS/BS values, and sbcBreakdowns for SBC calculation
    allYears.forEach((year) => {
      const allStatements = { incomeStatement, balanceSheet, cashFlow };
      const sbcBreakdowns = get().sbcBreakdowns;
      const danaBreakdowns = get().danaBreakdowns;
      incomeStatement = recomputeCalculations(incomeStatement, year, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns);
      balanceSheet = recomputeCalculations(balanceSheet, year, balanceSheet, allStatements, sbcBreakdowns, danaBreakdowns);
      cashFlow = recomputeCalculations(cashFlow, year, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns);
    });

    set({
      incomeStatement,
      balanceSheet,
      cashFlow,
    });
  },

  goToStep: (stepId) => set({ currentStepId: stepId }),

  completeCurrentStep: () => {
    const state = get();

    const completed = state.completedStepIds.includes(state.currentStepId)
      ? state.completedStepIds
      : [...state.completedStepIds, state.currentStepId];

    const allStepIds = WIZARD_STEPS.map((s) => s.id);
    const allStepsCompleted = allStepIds.every((id) => completed.includes(id));

    const currentIndex = allStepIds.indexOf(state.currentStepId);
    const next =
      currentIndex === -1
        ? allStepIds[0]
        : allStepIds[Math.min(currentIndex + 1, allStepIds.length - 1)];

    set({
      completedStepIds: completed,
      currentStepId: next,
      isModelComplete: allStepsCompleted,
    });
  },

  saveCurrentStep: () => {
    const state = get();
    
    // Recalculate all values before saving to ensure data is up to date
    // This ensures all formulas, subtotals, and totals are current
    if (state.isInitialized) {
      // Call recalculateAll from the store actions
      // Since we're inside the store definition, we can access it via get()
      const store = get();
      if (store.recalculateAll) {
        store.recalculateAll();
      }
    }
    
    // Mark the current step as complete (save progress)
    const completed = state.completedStepIds.includes(state.currentStepId)
      ? state.completedStepIds
      : [...state.completedStepIds, state.currentStepId];

    const allStepIds = WIZARD_STEPS.map((s) => s.id);
    const allStepsCompleted = allStepIds.every((id) => completed.includes(id));

    set({
      completedStepIds: completed,
      isModelComplete: allStepsCompleted,
    });
  },

  continueToNextStep: () => {
    const state = get();
    // Only continue if current step is complete
    if (!state.completedStepIds.includes(state.currentStepId)) {
      return; // Can't continue if step isn't saved/completed
    }

    const allStepIds = WIZARD_STEPS.map((s) => s.id);
    const currentIndex = allStepIds.indexOf(state.currentStepId);
    const next =
      currentIndex === -1
        ? allStepIds[0]
        : allStepIds[Math.min(currentIndex + 1, allStepIds.length - 1)];

    set({
      currentStepId: next,
    });
  },

  // Generic row management actions
  addChildRow: (statement, parentId, label) => {
    const trimmed = (label ?? "").trim();
    if (!trimmed) {
      console.log("addChildRow: trimmed label is empty");
      return;
    }

    const child: Row = {
      id: uuid(),
      label: trimmed,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };

    console.log("addChildRow: Adding child", child.label, "to parent", parentId, "in", statement);

    set((state) => {
      const currentRows = state[statement];
      console.log("addChildRow: Current rows count:", currentRows.length, "parentId:", parentId);
      console.log("addChildRow: Available row IDs:", currentRows.map(r => r.id));
      
      // Check if parent exists before trying to add
      const parentExists = currentRows.some((r) => r.id === parentId) || 
                          currentRows.some((r) => r.children?.some((c) => c.id === parentId));
      
      if (!parentExists) {
        console.error("addChildRow: Parent row not found!", parentId, "in statement:", statement);
        console.error("addChildRow: Available rows:", currentRows.map(r => ({ id: r.id, label: r.label })));
        return state; // Don't update if parent not found
      }
      
      // Deep clone to avoid mutation issues
      const updated = addChildRow(JSON.parse(JSON.stringify(currentRows)), parentId, child);
      
      // Verify the child was added
      const parentRowAfterAdd = updated.find((r) => r.id === parentId);
      console.log("addChildRow: Parent row after add:", parentRowAfterAdd?.id, "children count:", parentRowAfterAdd?.children?.length);
      
      if (!parentRowAfterAdd) {
        console.error("addChildRow: Parent row not found after add!", parentId);
        return state; // Don't update if parent not found
      }
      
      // If adding first child to Revenue, COGS, or SG&A, convert them to calc
      let finalRows = updated;
      
      if (parentId === "rev" || parentId === "cogs" || parentId === "sga") {
        if (parentRowAfterAdd.children && parentRowAfterAdd.children.length > 0 && parentRowAfterAdd.kind === "input") {
          // First child added, convert to calc - but preserve children!
          finalRows = updated.map((r) => {
            if (r.id === parentId) {
              return { ...r, kind: "calc" }; // Preserve children by spreading
            }
            return r;
          });
          const convertedParent = finalRows.find((r) => r.id === parentId);
          console.log("addChildRow: Converted parent to calc, children count:", convertedParent?.children?.length);
        }
      }
      
      // Recalculate all years after adding child
      const allYears = [
        ...(state.meta.years.historical || []),
        ...(state.meta.years.projection || []),
      ];
      
      let recalculatedRows = finalRows;
      allYears.forEach((year) => {
        const allStatements = {
          incomeStatement: state.incomeStatement,
          balanceSheet: state.balanceSheet,
          cashFlow: state.cashFlow,
        };
        const sbcBreakdowns = state.sbcBreakdowns;
        const danaBreakdowns = state.danaBreakdowns;
        recalculatedRows = recomputeCalculations(recalculatedRows, year, recalculatedRows, allStatements, sbcBreakdowns, danaBreakdowns);
      });
      
      // Final verification
      const finalParentRow = recalculatedRows.find((r) => r.id === parentId);
      console.log("addChildRow: Final parent row children count:", finalParentRow?.children?.length);
      console.log("addChildRow: Final parent row children:", finalParentRow?.children?.map(c => c.label));
      
      const newState = { ...state, [statement]: recalculatedRows };
      console.log("addChildRow: Returning new state, statement rows count:", newState[statement].length);
      return newState;
    });
  },

  insertRow: (statement, index, row) => {
    set((state) => {
      const currentRows = [...(state[statement] ?? [])];
      currentRows.splice(index, 0, row);
      
      // Recalculate all years after inserting
      const allYears = [
        ...(state.meta.years.historical || []),
        ...(state.meta.years.projection || []),
      ];
      
      let recalculatedRows = currentRows;
      allYears.forEach((year) => {
        const allStatements = {
          incomeStatement: state.incomeStatement,
          balanceSheet: state.balanceSheet,
          cashFlow: state.cashFlow,
        };
        const sbcBreakdowns = state.sbcBreakdowns;
        const danaBreakdowns = state.danaBreakdowns;
        recalculatedRows = recomputeCalculations(recalculatedRows, year, recalculatedRows, allStatements, sbcBreakdowns, danaBreakdowns);
      });
      
      return { [statement]: recalculatedRows };
    });
  },

  moveRow: (statement, rowId, direction) => {
    set((state) => {
      const currentRows = [...(state[statement] ?? [])];
      const currentIndex = currentRows.findIndex(r => r.id === rowId);
      
      if (currentIndex === -1) return state; // Row not found
      
      // Don't allow moving total/subtotal rows
      const row = currentRows[currentIndex];
      if (row.id.startsWith("total_") || row.kind === "total" || row.kind === "subtotal") {
        return state;
      }
      
      const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      
      // Bounds check
      if (newIndex < 0 || newIndex >= currentRows.length) return state;
      
      // Don't allow moving past total/subtotal rows
      const targetRow = currentRows[newIndex];
      if (targetRow.id.startsWith("total_") || targetRow.kind === "total" || targetRow.kind === "subtotal") {
        return state;
      }
      
      // Swap rows
      const newRows = [...currentRows];
      [newRows[currentIndex], newRows[newIndex]] = [newRows[newIndex], newRows[currentIndex]];
      
      // Recalculate all years after moving
      const allYears = [
        ...(state.meta.years.historical || []),
        ...(state.meta.years.projection || []),
      ];
      
      let recalculatedRows = newRows;
      allYears.forEach((year) => {
        const allStatements = {
          incomeStatement: state.incomeStatement,
          balanceSheet: state.balanceSheet,
          cashFlow: state.cashFlow,
        };
        const sbcBreakdowns = state.sbcBreakdowns;
        const danaBreakdowns = state.danaBreakdowns;
        recalculatedRows = recomputeCalculations(recalculatedRows, year, recalculatedRows, allStatements, sbcBreakdowns, danaBreakdowns);
      });
      
      return { [statement]: recalculatedRows };
    });
  },

  removeRow: (statement, rowId) => {
    // Core Income Statement items that form the skeleton - cannot be removed
    const coreISItems = [
      "rev", "cogs", "gross_profit", "gross_margin", 
      "sga", "danda", "ebit", "ebit_margin",
      "interest_expense", "interest_income", "other_income",
      "ebt", "tax", "net_income", "net_income_margin"
    ];
    
    // Core Balance Sheet items that form the skeleton - cannot be removed
    const coreBSItems = [
      "cash", "ar", "inventory", "other_ca", "total_current_assets",
      "ppe", "intangible_assets", "goodwill", "other_assets", "total_assets",
      "ap", "st_debt", "other_cl", "total_current_liabilities",
      "lt_debt", "other_liab", "total_liabilities",
      "common_stock", "retained_earnings", "other_equity", "total_equity",
      "total_liab_and_equity"
    ];
    
    // Core Cash Flow items that form the skeleton - cannot be removed
    const coreCFSItems = [
      "net_income", "danda", "sbc", "wc_change", "other_operating", "operating_cf",
      "capex", "other_investing", "investing_cf",
      "debt_issuance", "debt_repayment", "equity_issuance", "dividends", "financing_cf",
      "net_change_cash"
    ];
    
    // Prevent removal of core skeleton items
    if (statement === "incomeStatement" && coreISItems.includes(rowId)) {
      console.warn(`Cannot remove core Income Statement item: ${rowId}. This item is required for the financial model structure.`);
      return; // Don't remove core items
    }
    if (statement === "balanceSheet" && coreBSItems.includes(rowId)) {
      console.warn(`Cannot remove core Balance Sheet item: ${rowId}. This item is required for the financial model structure.`);
      return; // Don't remove core items
    }
    if (statement === "cashFlow" && coreCFSItems.includes(rowId)) {
      console.warn(`Cannot remove core Cash Flow item: ${rowId}. This item is required for the financial model structure.`);
      return; // Don't remove core items
    }
    
    set((state) => {
      const currentRows = state[statement];
      const updated = removeRowDeep(currentRows, rowId);
      
      // Check if we removed the last child from Revenue, COGS, or SG&A
      // If so, convert them back to input
      const revenueRow = updated.find((r) => r.id === "rev");
      const cogsRow = updated.find((r) => r.id === "cogs");
      const sgaRow = updated.find((r) => r.id === "sga");
      
      let finalUpdated = updated;
      
      if (revenueRow && revenueRow.kind === "calc" && (!revenueRow.children || revenueRow.children.length === 0)) {
        finalUpdated = updateRowKindDeep(finalUpdated, "rev", "input");
      }
      
      if (cogsRow && cogsRow.kind === "calc" && (!cogsRow.children || cogsRow.children.length === 0)) {
        finalUpdated = updateRowKindDeep(finalUpdated, "cogs", "input");
      }
      
      if (sgaRow && sgaRow.kind === "calc" && (!sgaRow.children || sgaRow.children.length === 0)) {
        finalUpdated = updateRowKindDeep(finalUpdated, "sga", "input");
      }
      
      return { [statement]: finalUpdated };
    });
  },

  updateRowValue: (statement, rowId, year, value) => {
    set((state) => {
      const currentRows = state[statement];
      // Update the input value
      const updated = updateRowValueDeep(currentRows, rowId, year, value);
      
      // Recompute all calculated rows for this year
      // This will recalculate parent rows (like Revenue from children, COGS from children, Gross Profit from Revenue - COGS)
      const allStatements = {
        incomeStatement: state.incomeStatement,
        balanceSheet: state.balanceSheet,
        cashFlow: state.cashFlow,
      };
      const sbcBreakdowns = state.sbcBreakdowns;
      const danaBreakdowns = state.danaBreakdowns;
      const recomputed = recomputeCalculations(updated, year, updated, allStatements, sbcBreakdowns, danaBreakdowns);
      
      // If Balance Sheet was updated, also recalculate Cash Flow (WC Change depends on BS)
      let updatedCashFlow = state.cashFlow;
      if (statement === "balanceSheet") {
        const updatedAllStatements = {
          incomeStatement: state.incomeStatement,
          balanceSheet: recomputed,
          cashFlow: state.cashFlow,
        };
        updatedCashFlow = recomputeCalculations(state.cashFlow, year, state.cashFlow, updatedAllStatements, sbcBreakdowns, danaBreakdowns);
      }
      
      return { 
        [statement]: recomputed,
        ...(statement === "balanceSheet" ? { cashFlow: updatedCashFlow } : {})
      };
    });
  },

  updateRowKind: (statement, rowId, kind) => {
    set((state) => {
      const currentRows = state[statement];
      const updated = updateRowKindDeep(currentRows, rowId, kind);
      return { [statement]: updated };
    });
  },

  ensureWcChildrenFromBS: () => {
    set((state) => {
      const cashFlow = ensureWcChildrenInCashFlow(
        state.cashFlow,
        state.balanceSheet
      );
      if (cashFlow === state.cashFlow) return state;
      return { cashFlow };
    });
  },

  reorderCashFlowTopLevel: (fromIndex, toIndex) => {
    set((state) => {
      const rows = [...state.cashFlow];
      if (fromIndex < 0 || fromIndex >= rows.length || toIndex < 0 || toIndex >= rows.length) return state;
      const [removed] = rows.splice(fromIndex, 1);
      rows.splice(toIndex, 0, removed);
      const allYears = [
        ...(state.meta.years.historical || []),
        ...(state.meta.years.projection || []),
      ];
      let recalculated = rows;
      const allStatements = { incomeStatement: state.incomeStatement, balanceSheet: state.balanceSheet, cashFlow: rows };
      allYears.forEach((year) => {
        recalculated = recomputeCalculations(recalculated, year, recalculated, allStatements, state.sbcBreakdowns, state.danaBreakdowns);
      });
      return { cashFlow: recalculated };
    });
  },

  reorderWcChildren: (fromIndex, toIndex) => {
    set((state) => {
      const wcRow = state.cashFlow.find((r) => r.id === "wc_change");
      if (!wcRow?.children?.length) return state;
      const children = [...wcRow.children];
      if (fromIndex < 0 || fromIndex >= children.length || toIndex < 0 || toIndex >= children.length) return state;
      const [removed] = children.splice(fromIndex, 1);
      children.splice(toIndex, 0, removed);
      const cashFlow = state.cashFlow.map((r) => (r.id === "wc_change" ? { ...r, children } : r));
      const allYears = [...(state.meta.years.historical || []), ...(state.meta.years.projection || [])];
      let recalculated = cashFlow;
      const allStatements = { incomeStatement: state.incomeStatement, balanceSheet: state.balanceSheet, cashFlow };
      allYears.forEach((year) => {
        recalculated = recomputeCalculations(recalculated, year, recalculated, allStatements, state.sbcBreakdowns, state.danaBreakdowns);
      });
      return { cashFlow: recalculated };
    });
  },

  moveCashFlowRowIntoWc: (rowId, insertAtIndex) => {
    set((state) => {
      const row = findRowDeep(state.cashFlow, rowId);
      if (!row) return state;
      if (row.id === "wc_change" || row.id === "operating_cf" || row.id === "net_income" || row.id === "danda" || row.id === "sbc") return state;
      let cashFlow = removeRowDeep(state.cashFlow, rowId);
      const wcRow = cashFlow.find((r) => r.id === "wc_change");
      if (!wcRow) return state;
      const child = { ...row, children: undefined };
      const atIndex = insertAtIndex ?? (wcRow.children?.length ?? 0);
      cashFlow = addExistingChildToParent(cashFlow, "wc_change", child, atIndex);
      const allYears = [...(state.meta.years.historical || []), ...(state.meta.years.projection || [])];
      let recalculated = cashFlow;
      const allStatements = { incomeStatement: state.incomeStatement, balanceSheet: state.balanceSheet, cashFlow };
      allYears.forEach((year) => {
        recalculated = recomputeCalculations(recalculated, year, recalculated, allStatements, state.sbcBreakdowns, state.danaBreakdowns);
      });
      return { cashFlow: recalculated };
    });
  },

  moveCashFlowRowOutOfWc: (rowId, insertAtTopLevelIndex) => {
    set((state) => {
      const wcRow = state.cashFlow.find((r) => r.id === "wc_change");
      const childIndex = wcRow?.children?.findIndex((c) => c.id === rowId) ?? -1;
      if (childIndex === -1) return state;
      const row = wcRow!.children![childIndex];
      const newWcChildren = wcRow!.children!.filter((c) => c.id !== rowId);
      let cashFlow = state.cashFlow.map((r) =>
        r.id === "wc_change" ? { ...r, children: newWcChildren } : r
      );
      const wcChangeIndex = cashFlow.findIndex((r) => r.id === "wc_change");
      const insertAt = insertAtTopLevelIndex ?? Math.min(wcChangeIndex + 1, cashFlow.length);
      const topLevelRow = { ...row, children: undefined };
      cashFlow = [...cashFlow.slice(0, insertAt), topLevelRow, ...cashFlow.slice(insertAt)];
      const allYears = [...(state.meta.years.historical || []), ...(state.meta.years.projection || [])];
      let recalculated = cashFlow;
      const allStatements = { incomeStatement: state.incomeStatement, balanceSheet: state.balanceSheet, cashFlow };
      allYears.forEach((year) => {
        recalculated = recomputeCalculations(recalculated, year, recalculated, allStatements, state.sbcBreakdowns, state.danaBreakdowns);
      });
      return { cashFlow: recalculated };
    });
  },

  updateSbcValue: (categoryId, year, value) => {
    set((state) => {
      const currentBreakdowns = state.sbcBreakdowns || {};
      return {
        sbcBreakdowns: {
          ...currentBreakdowns,
          [categoryId]: {
            ...(currentBreakdowns[categoryId] || {}),
            [year]: value,
          },
        },
      };
    });
  },

  // Section lock and expand management
  lockSection: (sectionId) => {
    set((state) => ({
      sectionLocks: {
        ...state.sectionLocks,
        [sectionId]: true,
      },
      sectionExpanded: {
        ...state.sectionExpanded,
        [sectionId]: false, // Collapse when locked
      },
    }));
  },

  unlockSection: (sectionId) => {
    set((state) => ({
      sectionLocks: {
        ...state.sectionLocks,
        [sectionId]: false,
      },
    }));
  },

  toggleSectionExpanded: (sectionId) => {
    set((state) => ({
      sectionExpanded: {
        ...state.sectionExpanded,
        [sectionId]: !(state.sectionExpanded[sectionId] ?? true), // Default to expanded
      },
    }));
  },

  setSectionExpanded: (sectionId, expanded) => {
    set((state) => ({
      sectionExpanded: {
        ...state.sectionExpanded,
        [sectionId]: expanded,
      },
    }));
  },

  // Legacy/backward compatibility actions
  addRevenueStream: (label) => {
    const trimmed = (label ?? "").trim();
    if (!trimmed) return;

    const child: Row = {
      id: uuid(),
      label: trimmed,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };

    set((state) => ({
      incomeStatement: addChildRow(state.incomeStatement, "rev", child),
    }));
  },

  updateIncomeStatementValue: (rowId, year, value) => {
    set((state) => {
      // Update the input value
      const updated = updateRowValueDeep(state.incomeStatement, rowId, year, value);
      
      // Recompute all calculated rows for this year
      const recomputed = recomputeCalculations(updated, year, updated);
      
      return {
        incomeStatement: recomputed,
      };
    });
  },
  
  updateYears: (newYears) => {
    set((state) => {
      const oldYears = {
        historical: state.meta.years.historical || [],
        projection: state.meta.years.projection || [],
      };
      const allOldYears = [...oldYears.historical, ...oldYears.projection];
      const allNewYears = [...newYears.historical, ...newYears.projection];
      
      // Find years to add and remove
      const yearsToAdd = allNewYears.filter(y => !allOldYears.includes(y));
      const yearsToRemove = allOldYears.filter(y => !allNewYears.includes(y));
      
      // Helper function to update years in a row (recursively)
      const updateYearsInRow = (row: Row): Row => {
        const newValues = { ...(row.values || {}) };
        
        // Remove values for deleted years
        yearsToRemove.forEach(year => {
          delete newValues[year];
        });
        
        // Add empty values for new years
        yearsToAdd.forEach(year => {
          newValues[year] = 0;
        });
        
        // Recursively update children
        const newChildren = row.children?.map(updateYearsInRow);
        
        return {
          ...row,
          values: newValues,
          children: newChildren,
        };
      };
      
      // Update all statements
      let incomeStatement = state.incomeStatement.map(updateYearsInRow);
      let balanceSheet = state.balanceSheet.map(updateYearsInRow);
      let cashFlow = state.cashFlow.map(updateYearsInRow);
      
      // Update SBC breakdowns
      const newSbcBreakdowns: Record<string, Record<string, number>> = {};
      Object.keys(state.sbcBreakdowns || {}).forEach(categoryId => {
        const categoryBreakdowns = state.sbcBreakdowns[categoryId] || {};
        const newCategoryBreakdowns: Record<string, number> = { ...categoryBreakdowns };
        
        // Remove deleted years
        yearsToRemove.forEach(year => {
          delete newCategoryBreakdowns[year];
        });
        
        // Add empty values for new years
        yearsToAdd.forEach(year => {
          newCategoryBreakdowns[year] = 0;
        });
        
        newSbcBreakdowns[categoryId] = newCategoryBreakdowns;
      });
      
      // Recalculate all formulas for all new years
      allNewYears.forEach((year) => {
        const allStatements = { incomeStatement, balanceSheet, cashFlow };
        const sbcBreakdowns = state.sbcBreakdowns;
        incomeStatement = recomputeCalculations(incomeStatement, year, incomeStatement, allStatements, sbcBreakdowns);
        balanceSheet = recomputeCalculations(balanceSheet, year, balanceSheet, allStatements, sbcBreakdowns);
        cashFlow = recomputeCalculations(cashFlow, year, cashFlow, allStatements, sbcBreakdowns);
      });
      
      return {
        meta: {
          ...state.meta,
          years: newYears,
        },
        incomeStatement,
        balanceSheet,
        cashFlow,
        sbcBreakdowns: newSbcBreakdowns,
      };
    });
  },
    }),
    {
      name: "financial-model-storage",
      // Persist all state, including isInitialized
      partialize: (state) => {
        // Don't persist the hydration flag
        const { _hasHydrated, ...stateToPersist } = state;
        return stateToPersist;
      },
      onRehydrateStorage: () => (state) => {
        // When data is loaded from localStorage, recalculate all values
        if (state && state.isInitialized) {
          const allYears = [
            ...(state.meta.years.historical || []),
            ...(state.meta.years.projection || []),
          ];

          let incomeStatement = state.incomeStatement;
          let balanceSheet = state.balanceSheet;
          let cashFlow = state.cashFlow;

          // Migration: Ensure gross_margin exists (added in later version)
          const hasGrossMargin = incomeStatement.some((r) => r.id === "gross_margin");
          if (!hasGrossMargin) {
            const grossProfitIndex = incomeStatement.findIndex((r) => r.id === "gross_profit");
            if (grossProfitIndex >= 0) {
              // Insert gross_margin right after gross_profit
              incomeStatement.splice(grossProfitIndex + 1, 0, {
                id: "gross_margin",
                label: "Gross Margin %",
                kind: "calc",
                valueType: "percent",
                values: {},
                children: [],
              });
            }
          }

          // Migration: Ensure SG&A exists (should always be in template, but check anyway)
          const hasSga = incomeStatement.some((r) => r.id === "sga");
          if (!hasSga) {
            const grossMarginIndex = incomeStatement.findIndex((r) => r.id === "gross_margin");
            const insertIndex = grossMarginIndex >= 0 ? grossMarginIndex + 1 : incomeStatement.length;
            // Insert SG&A after gross_margin (or at end if gross_margin not found)
            incomeStatement.splice(insertIndex, 0, {
              id: "sga",
              label: "Selling, General & Administrative (SG&A)",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure EBITDA exists (should be in template, but check anyway)
          const hasEbitda = incomeStatement.some((r) => r.id === "ebitda");
          if (!hasEbitda) {
            // Find where to insert EBITDA - after Other Operating Expenses
            const otherOpexIndex = incomeStatement.findIndex((r) => r.id === "other_opex");
            const rdIndex = incomeStatement.findIndex((r) => r.id === "rd");
            const insertIndex = otherOpexIndex >= 0 ? otherOpexIndex + 1 : 
                               rdIndex >= 0 ? rdIndex + 1 : 
                               incomeStatement.length;
            // Insert EBITDA
            incomeStatement.splice(insertIndex, 0, {
              id: "ebitda",
              label: "EBITDA",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure EBITDA margin exists (added in later version)
          const hasEbitdaMargin = incomeStatement.some((r) => r.id === "ebitda_margin");
          if (!hasEbitdaMargin) {
            const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
            if (ebitdaIndex >= 0) {
              // Insert EBITDA margin right after EBITDA
              incomeStatement.splice(ebitdaIndex + 1, 0, {
                id: "ebitda_margin",
                label: "EBITDA Margin %",
                kind: "calc",
                valueType: "percent",
                values: {},
                children: [],
              });
            }
          }

          // Migration: Remove EBITDA and EBITDA Margin from IS (D&A is shown directly, then EBIT)
          const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
          if (ebitdaIndex >= 0) {
            incomeStatement.splice(ebitdaIndex, 1);
          }
          const ebitdaMarginIndex = incomeStatement.findIndex((r) => r.id === "ebitda_margin");
          if (ebitdaMarginIndex >= 0) {
            incomeStatement.splice(ebitdaMarginIndex, 1);
          }

          // Migration: Ensure D&A exists (should be in template, but check anyway)
          const hasDana = incomeStatement.some((r) => r.id === "danda");
          if (!hasDana) {
            // Find where to insert D&A - after Other Opex (or after SG&A if no Other Opex)
            const otherOpexIndex = incomeStatement.findIndex((r) => r.id === "other_opex");
            const rdIndex = incomeStatement.findIndex((r) => r.id === "rd");
            const insertIndex = otherOpexIndex >= 0 ? otherOpexIndex + 1 : 
                               rdIndex >= 0 ? rdIndex + 1 : 
                               incomeStatement.length;
            // Insert D&A
            incomeStatement.splice(insertIndex, 0, {
              id: "danda",
              label: "Depreciation & Amortization (D&A)",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure EBIT exists and is in the correct position (after SG&A)
          const hasEbit = incomeStatement.some((r) => r.id === "ebit");
          const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
          const sgaIndex = incomeStatement.findIndex((r) => r.id === "sga");
          
          // #region agent log
          if (typeof window !== 'undefined') {
            fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:1999',message:'EBIT Position Check (recalculateAll)',data:{hasEbit,ebitIndex,sgaIndex,incomeStatementLength:incomeStatement.length,incomeStatementIds:incomeStatement.map(r=>r.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
          }
          // #endregion
          
          if (!hasEbit) {
            // Insert EBIT after SG&A
            const insertIndex = sgaIndex >= 0 ? sgaIndex + 1 : incomeStatement.length;
            // #region agent log
            if (typeof window !== 'undefined') {
              fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:2007',message:'Inserting EBIT (not exists, recalculateAll)',data:{insertIndex,sgaIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
            }
            // #endregion
            incomeStatement.splice(insertIndex, 0, {
              id: "ebit",
              label: "EBIT (Operating Income)",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          } else if (ebitIndex >= 0 && sgaIndex >= 0) {
            // EBIT exists - check if it needs to be moved
            if (ebitIndex < sgaIndex) {
              // #region agent log
              if (typeof window !== 'undefined') {
                fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:2021',message:'Moving EBIT (before SG&A, recalculateAll)',data:{ebitIndex,sgaIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
              }
              // #endregion
              // EBIT exists but is before SG&A - move it after SG&A
              const ebitRow = incomeStatement[ebitIndex];
              incomeStatement.splice(ebitIndex, 1);
              const newIndex = sgaIndex; // sgaIndex is now correct since we removed EBIT
              incomeStatement.splice(newIndex + 1, 0, ebitRow);
            } else if (ebitIndex > sgaIndex + 3) {
              // #region agent log
              if (typeof window !== 'undefined') {
                fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:2029',message:'Moving EBIT (too far after SG&A, recalculateAll)',data:{ebitIndex,sgaIndex,distance:ebitIndex-sgaIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
              }
              // #endregion
              // EBIT exists but is too far after SG&A (likely at the end) - move it right after SG&A
              const ebitRow = incomeStatement[ebitIndex];
              incomeStatement.splice(ebitIndex, 1);
              const newIndex = sgaIndex;
              incomeStatement.splice(newIndex + 1, 0, ebitRow);
            } else {
              // #region agent log
              if (typeof window !== 'undefined') {
                fetch('http://127.0.0.1:7243/ingest/e9ae427e-a3fc-454d-ad70-e095b68390a2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useModelStore.ts:2037',message:'EBIT position OK (recalculateAll)',data:{ebitIndex,sgaIndex,distance:ebitIndex-sgaIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
              }
              // #endregion
            }
          }
          
          // Also ensure EBIT margin is right after EBIT
          const hasEbitMargin = incomeStatement.some((r) => r.id === "ebit_margin");
          const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
          const currentEbitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
          
          if (!hasEbitMargin && currentEbitIndex >= 0) {
            incomeStatement.splice(currentEbitIndex + 1, 0, {
              id: "ebit_margin",
              label: "EBIT Margin %",
              kind: "calc",
              valueType: "percent",
              values: {},
              children: [],
            });
          } else if (ebitMarginIndex >= 0 && currentEbitIndex >= 0 && ebitMarginIndex !== currentEbitIndex + 1) {
            // EBIT margin exists but is not right after EBIT - move it
            const ebitMarginRow = incomeStatement[ebitMarginIndex];
            incomeStatement.splice(ebitMarginIndex, 1);
            const newIndex = currentEbitIndex;
            incomeStatement.splice(newIndex + 1, 0, ebitMarginRow);
          }

          // Migration: Ensure Interest Expense exists (should be in template, but check anyway)
          const hasInterestExpense = incomeStatement.some((r) => r.id === "interest_expense");
          if (!hasInterestExpense) {
            const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
            const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
            const insertIndex = ebitMarginIndex >= 0 ? ebitMarginIndex + 1 : 
                               ebitIndex >= 0 ? ebitIndex + 1 : 
                               incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "interest_expense",
              label: "Interest Expense",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Interest Income exists (should be in template, but check anyway)
          const hasInterestIncome = incomeStatement.some((r) => r.id === "interest_income");
          if (!hasInterestIncome) {
            const interestExpenseIndex = incomeStatement.findIndex((r) => r.id === "interest_expense");
            const insertIndex = interestExpenseIndex >= 0 ? interestExpenseIndex + 1 : incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "interest_income",
              label: "Interest Income",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Other Income exists (added in later version)
          const hasOtherIncome = incomeStatement.some((r) => r.id === "other_income");
          if (!hasOtherIncome) {
            const interestIncomeIndex = incomeStatement.findIndex((r) => r.id === "interest_income");
            const insertIndex = interestIncomeIndex >= 0 ? interestIncomeIndex + 1 : incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "other_income",
              label: "Other Income / (Expense)",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure EBT exists (should be in template, but check anyway)
          const hasEbt = incomeStatement.some((r) => r.id === "ebt");
          if (!hasEbt) {
            const otherIncomeIndex = incomeStatement.findIndex((r) => r.id === "other_income");
            const insertIndex = otherIncomeIndex >= 0 ? otherIncomeIndex + 1 : incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "ebt",
              label: "EBT (Earnings Before Tax)",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Tax exists (should be in template, but check anyway)
          const hasTax = incomeStatement.some((r) => r.id === "tax");
          if (!hasTax) {
            const ebtIndex = incomeStatement.findIndex((r) => r.id === "ebt");
            const insertIndex = ebtIndex >= 0 ? ebtIndex + 1 : incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "tax",
              label: "Income Tax Expense",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Net Income exists (should be in template, but check anyway)
          const hasNetIncome = incomeStatement.some((r) => r.id === "net_income");
          if (!hasNetIncome) {
            const taxIndex = incomeStatement.findIndex((r) => r.id === "tax");
            const insertIndex = taxIndex >= 0 ? taxIndex + 1 : incomeStatement.length;
            incomeStatement.splice(insertIndex, 0, {
              id: "net_income",
              label: "Net Income",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Net Income Margin exists (added in later version)
          const hasNetIncomeMargin = incomeStatement.some((r) => r.id === "net_income_margin");
          if (!hasNetIncomeMargin) {
            const netIncomeIndex = incomeStatement.findIndex((r) => r.id === "net_income");
            if (netIncomeIndex >= 0) {
              // Insert Net Income Margin right after Net Income
              incomeStatement.splice(netIncomeIndex + 1, 0, {
                id: "net_income_margin",
                label: "Net Income Margin %",
                kind: "calc",
                valueType: "percent",
                values: {},
                children: [],
              });
            }
          }

          // Migration: Update "Other Income / (Expense)" label to "Other Income / (Expense), net"
          const otherIncomeRow = incomeStatement.find((r) => r.id === "other_income");
          if (otherIncomeRow && otherIncomeRow.label === "Other Income / (Expense)") {
            otherIncomeRow.label = "Other Income / (Expense), net";
          }

          // Migration: Ensure D&A exists in CFS (should be in template, but check anyway)
          const hasDandaInCFS = cashFlow.some((r) => r.id === "danda");
          if (!hasDandaInCFS) {
            // Find where to insert D&A - after net_income
            const netIncomeIndex = cashFlow.findIndex((r) => r.id === "net_income");
            const insertIndex = netIncomeIndex >= 0 ? netIncomeIndex + 1 : cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "danda",
              label: "Depreciation & Amortization",
              kind: "input", // Manual input in CFO
              valueType: "currency",
              values: {},
              children: [],
            });
          } else {
            // Migration: Update D&A from "calc" to "input" (D&A is now manual input, not auto-populated)
            const dandaRow = cashFlow.find((r) => r.id === "danda");
            if (dandaRow && dandaRow.kind === "calc") {
              dandaRow.kind = "input";
            }
          }

          // Migration: Ensure SBC exists in CFS (added in later version)
          const hasSbcInCFS = cashFlow.some((r) => r.id === "sbc");
          if (!hasSbcInCFS) {
            // Find where to insert SBC - after danda, before wc_change
            const dandaIndex = cashFlow.findIndex((r) => r.id === "danda");
            const wcChangeIndex = cashFlow.findIndex((r) => r.id === "wc_change");
            const insertIndex = dandaIndex >= 0 ? dandaIndex + 1 : 
                               wcChangeIndex >= 0 ? wcChangeIndex : 
                               cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "sbc",
              label: "Stock-Based Compensation",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure WC Change exists in CFS (should be in template, but check anyway)
          const hasWcChangeInCFS = cashFlow.some((r) => r.id === "wc_change");
          if (!hasWcChangeInCFS) {
            // Find where to insert WC Change - after sbc, before other_operating
            const sbcIndex = cashFlow.findIndex((r) => r.id === "sbc");
            const otherOperatingIndex = cashFlow.findIndex((r) => r.id === "other_operating");
            const operatingCfIndex = cashFlow.findIndex((r) => r.id === "operating_cf");
            const insertIndex = sbcIndex >= 0 ? sbcIndex + 1 : 
                               otherOperatingIndex >= 0 ? otherOperatingIndex : 
                               operatingCfIndex >= 0 ? operatingCfIndex : 
                               cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "wc_change",
              label: "Change in Working Capital",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Operating CF total exists
          const hasOperatingCf = cashFlow.some((r) => r.id === "operating_cf");
          if (!hasOperatingCf) {
            const otherOperatingIndex = cashFlow.findIndex((r) => r.id === "other_operating");
            const insertIndex = otherOperatingIndex >= 0 ? otherOperatingIndex + 1 : cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "operating_cf",
              label: "Cash from Operating Activities",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Investing section items exist (capex, other_investing, investing_cf)
          const hasCapex = cashFlow.some((r) => r.id === "capex");
          if (!hasCapex) {
            const operatingCfIndex = cashFlow.findIndex((r) => r.id === "operating_cf");
            const insertIndex = operatingCfIndex >= 0 ? operatingCfIndex + 1 : cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "capex",
              label: "Capital Expenditures (CapEx)",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          const hasOtherInvesting = cashFlow.some((r) => r.id === "other_investing");
          if (!hasOtherInvesting) {
            const capexIndex = cashFlow.findIndex((r) => r.id === "capex");
            const insertIndex = capexIndex >= 0 ? capexIndex + 1 : cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "other_investing",
              label: "Other Investing Activities",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          const hasInvestingCf = cashFlow.some((r) => r.id === "investing_cf");
          if (!hasInvestingCf) {
            const otherInvestingIndex = cashFlow.findIndex((r) => r.id === "other_investing");
            const insertIndex = otherInvestingIndex >= 0 ? otherInvestingIndex + 1 : cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "investing_cf",
              label: "Cash from Investing Activities",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure Financing Activities standard items exist
          const hasDebtIssuance = cashFlow.some((r) => r.id === "debt_issuance");
          const hasDebtRepayment = cashFlow.some((r) => r.id === "debt_repayment");
          const hasEquityIssuance = cashFlow.some((r) => r.id === "equity_issuance");
          const hasDividends = cashFlow.some((r) => r.id === "dividends");
          const hasFinancingCf = cashFlow.some((r) => r.id === "financing_cf");

          if (!hasDebtIssuance) {
            const investingCfIndex = cashFlow.findIndex((r) => r.id === "investing_cf");
            const insertIndex = investingCfIndex >= 0 ? investingCfIndex + 1 : cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "debt_issuance",
              label: "Debt Issuance",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }
          if (!hasDebtRepayment) {
            const debtIssuanceIndex = cashFlow.findIndex((r) => r.id === "debt_issuance");
            const insertIndex = debtIssuanceIndex >= 0 ? debtIssuanceIndex + 1 : cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "debt_repayment",
              label: "Debt Repayment",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }
          if (!hasEquityIssuance) {
            const debtRepaymentIndex = cashFlow.findIndex((r) => r.id === "debt_repayment");
            const insertIndex = debtRepaymentIndex >= 0 ? debtRepaymentIndex + 1 : cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "equity_issuance",
              label: "Equity Issuance",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }
          if (!hasDividends) {
            const equityIssuanceIndex = cashFlow.findIndex((r) => r.id === "equity_issuance");
            const insertIndex = equityIssuanceIndex >= 0 ? equityIssuanceIndex + 1 : cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "dividends",
              label: "Dividends Paid",
              kind: "input",
              valueType: "currency",
              values: {},
              children: [],
            });
          }
          if (!hasFinancingCf) {
            const dividendsIndex = cashFlow.findIndex((r) => r.id === "dividends");
            const insertIndex = dividendsIndex >= 0 ? dividendsIndex + 1 : cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "financing_cf",
              label: "Cash from Financing Activities",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Migration: Ensure net_change_cash exists
          const hasNetChangeCash = cashFlow.some((r) => r.id === "net_change_cash");
          if (!hasNetChangeCash) {
            const financingCfIndex = cashFlow.findIndex((r) => r.id === "financing_cf");
            const insertIndex = financingCfIndex >= 0 ? financingCfIndex + 1 : cashFlow.length;
            cashFlow.splice(insertIndex, 0, {
              id: "net_change_cash",
              label: "Net Change in Cash",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            });
          }

          // Recalculate all years for all statements
          allYears.forEach((year) => {
            const allStatements = { incomeStatement, balanceSheet, cashFlow };
            const sbcBreakdowns = state.sbcBreakdowns;
            const danaBreakdowns = state.danaBreakdowns || {};
            incomeStatement = recomputeCalculations(incomeStatement, year, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns);
            balanceSheet = recomputeCalculations(balanceSheet, year, balanceSheet, allStatements, sbcBreakdowns, danaBreakdowns);
            cashFlow = recomputeCalculations(cashFlow, year, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns);
          });

          // Return updated state
          return {
            ...state,
            incomeStatement,
            balanceSheet,
            cashFlow,
          };
        }
        return state;
      },
    }
  )
);