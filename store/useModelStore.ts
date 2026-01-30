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

  currentStepId: WizardStepId;
  completedStepIds: WizardStepId[];
  isModelComplete: boolean;
};

export type ModelActions = {
  initializeModel: (meta: ModelMeta) => void;
  recalculateAll: () => void;
  goToStep: (stepId: WizardStepId) => void;
  completeCurrentStep: () => void;

  // Row management - generic for any statement
  addChildRow: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", parentId: string, label: string) => void;
  removeRow: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string) => void;
  updateRowValue: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string, year: string, value: number) => void;
  updateRowKind: (statement: "incomeStatement" | "balanceSheet" | "cashFlow", rowId: string, kind: "input" | "calc" | "subtotal" | "total") => void;
  
  // SBC annotation
  updateSbcValue: (categoryId: string, year: string, value: number) => void;
  
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

  currentStepId: "historicals",
  completedStepIds: [],
  isModelComplete: false,
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

      // Migration: Ensure D&A exists (should be in template, but check anyway)
      const hasDana = incomeStatement.some((r) => r.id === "danda");
      if (!hasDana) {
        // Find where to insert D&A - after EBITDA margin (or after EBITDA if margin doesn't exist)
        const ebitdaMarginIndex = incomeStatement.findIndex((r) => r.id === "ebitda_margin");
        const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
        const insertIndex = ebitdaMarginIndex >= 0 ? ebitdaMarginIndex + 1 : 
                           ebitdaIndex >= 0 ? ebitdaIndex + 1 : 
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

      // Migration: Ensure EBIT exists (should be in template, but check anyway)
      const hasEbit = incomeStatement.some((r) => r.id === "ebit");
      if (!hasEbit) {
        // Find where to insert EBIT - after D&A
        const danaIndex = incomeStatement.findIndex((r) => r.id === "danda");
        const insertIndex = danaIndex >= 0 ? danaIndex + 1 : incomeStatement.length;
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

      // Recalculate all years for all statements
      const allYears = [...(meta.years.historical || []), ...(meta.years.projection || [])];
      allYears.forEach((year) => {
        incomeStatement = recomputeCalculations(incomeStatement, year, incomeStatement);
        balanceSheet = recomputeCalculations(balanceSheet, year, balanceSheet);
        cashFlow = recomputeCalculations(cashFlow, year, cashFlow);
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

    // Migration: Ensure D&A exists (should be in template, but check anyway)
    const hasDana = incomeStatement.some((r) => r.id === "danda");
    if (!hasDana) {
      // Find where to insert D&A - after EBITDA margin (or after EBITDA if margin doesn't exist)
      const ebitdaMarginIndex = incomeStatement.findIndex((r) => r.id === "ebitda_margin");
      const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
      const insertIndex = ebitdaMarginIndex >= 0 ? ebitdaMarginIndex + 1 : 
                         ebitdaIndex >= 0 ? ebitdaIndex + 1 : 
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

    // Migration: Ensure EBIT exists (should be in template, but check anyway)
    const hasEbit = incomeStatement.some((r) => r.id === "ebit");
    if (!hasEbit) {
      // Find where to insert EBIT - after D&A
      const danaIndex = incomeStatement.findIndex((r) => r.id === "danda");
      const insertIndex = danaIndex >= 0 ? danaIndex + 1 : incomeStatement.length;
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

    // Migration: Ensure Interest Expense exists (should be in template, but check anyway)
    const hasInterestExpense = incomeStatement.some((r) => r.id === "interest_expense");
    if (!hasInterestExpense) {
      const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
      const insertIndex = ebitIndex >= 0 ? ebitIndex + 1 : incomeStatement.length;
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

    // Recalculate all years for all statements
    allYears.forEach((year) => {
      incomeStatement = recomputeCalculations(incomeStatement, year, incomeStatement);
      balanceSheet = recomputeCalculations(balanceSheet, year, balanceSheet);
      cashFlow = recomputeCalculations(cashFlow, year, cashFlow);
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
        recalculatedRows = recomputeCalculations(recalculatedRows, year, recalculatedRows);
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

  removeRow: (statement, rowId) => {
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
      const recomputed = recomputeCalculations(updated, year, updated);
      
      return { [statement]: recomputed };
    });
  },

  updateRowKind: (statement, rowId, kind) => {
    set((state) => {
      const currentRows = state[statement];
      const updated = updateRowKindDeep(currentRows, rowId, kind);
      return { [statement]: updated };
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

          // Migration: Ensure D&A exists (should be in template, but check anyway)
          const hasDana = incomeStatement.some((r) => r.id === "danda");
          if (!hasDana) {
            // Find where to insert D&A - after EBITDA margin (or after EBITDA if margin doesn't exist)
            const ebitdaMarginIndex = incomeStatement.findIndex((r) => r.id === "ebitda_margin");
            const ebitdaIndex = incomeStatement.findIndex((r) => r.id === "ebitda");
            const insertIndex = ebitdaMarginIndex >= 0 ? ebitdaMarginIndex + 1 : 
                               ebitdaIndex >= 0 ? ebitdaIndex + 1 : 
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

          // Migration: Ensure EBIT exists (should be in template, but check anyway)
          const hasEbit = incomeStatement.some((r) => r.id === "ebit");
          if (!hasEbit) {
            // Find where to insert EBIT - after D&A
            const danaIndex = incomeStatement.findIndex((r) => r.id === "danda");
            const insertIndex = danaIndex >= 0 ? danaIndex + 1 : incomeStatement.length;
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

          // Migration: Ensure Interest Expense exists (should be in template, but check anyway)
          const hasInterestExpense = incomeStatement.some((r) => r.id === "interest_expense");
          if (!hasInterestExpense) {
            const ebitIndex = incomeStatement.findIndex((r) => r.id === "ebit");
            const insertIndex = ebitIndex >= 0 ? ebitIndex + 1 : incomeStatement.length;
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

          // Recalculate all years for all statements
          allYears.forEach((year) => {
            incomeStatement = recomputeCalculations(incomeStatement, year, incomeStatement);
            balanceSheet = recomputeCalculations(balanceSheet, year, balanceSheet);
            cashFlow = recomputeCalculations(cashFlow, year, cashFlow);
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