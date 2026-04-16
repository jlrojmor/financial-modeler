/**
 * Phase 3 — Projected Cash Flow Statement (indirect method, pre-sweep)
 *
 * Pure functions: builds CFO / CFI / CFF and ending cash from projected IS/BS
 * and schedule outputs. Signs follow IB-style cash flow presentation:
 * - Outflows are negative (capex, debt repaid, cash interest, dividends, buybacks).
 * - Inflows are positive (debt issued, equity issued).
 *
 * Cash interest paid (v1) equals sum of tranche interest expense from the debt
 * engine (no accrual vs cash timing difference in this phase).
 */

import type { Row } from "@/types/finance";
import type { DebtScheduleEngineResultV1 } from "@/lib/debt-schedule-engine";
import type { EquityRollforwardResult } from "@/lib/equity-rollforward-engine";
import { getDeltaWcBs } from "@/lib/calculations";
import { getDandaFromIncomeStatement, getSbcFromIncomeStatement } from "@/lib/cfo-source-resolution";
import { findRowInTree } from "@/lib/row-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProjectedCfsEngineInput = {
  projectionYears: string[];
  lastHistoricalYear: string | null;
  balanceSheet: Row[];
  incomeStatement: Row[];
  /** Capex cash spend by year (positive magnitudes from capex engine). */
  totalCapexByYear: Record<string, number>;
  debtScheduleResult?: DebtScheduleEngineResultV1 | null;
  equityRollforwardResult?: EquityRollforwardResult | null;
  /** Optional FX / cash bridge; defaults to 0 per year. */
  fxEffectByYear?: Record<string, number>;
};

export type ProjectedCfsYearBreakdown = {
  beginningCash: number;
  netIncome: number;
  danda: number;
  sbc: number;
  wcChange: number;
  otherOperating: number;
  cfo: number;
  capex: number;
  acquisitions: number;
  assetSales: number;
  investments: number;
  otherInvesting: number;
  cfi: number;
  debtIssued: number;
  debtRepaid: number;
  cashInterestPaid: number;
  equityIssued: number;
  shareRepurchases: number;
  dividends: number;
  otherFinancing: number;
  cff: number;
  fxEffect: number;
  netChangeInCash: number;
  endingCash: number;
};

export type ProjectedCfsEngineResult = {
  byYear: Record<string, ProjectedCfsYearBreakdown>;
  /** Merge into CFS row.values for projection years (row id → year → value). */
  cfsValuesByRowId: Record<string, Record<string, number>>;
  endingCashByYear: Record<string, number>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flattenStatement(rows: Row[], out: Row[] = []): Row[] {
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) flattenStatement(r.children, out);
  }
  return out;
}

function val(row: Row | null | undefined, year: string): number {
  if (!row) return 0;
  return row.values?.[year] ?? 0;
}

/**
 * Deferred tax non-cash adjustment in CFO: -ΔDTA + ΔDTL (standard bridge).
 */
function otherOperatingDeferredTax(flatBs: Row[], year: string, prevYear: string | null): number {
  if (!prevYear) return 0;
  const sumTax = (tax: string, y: string) =>
    flatBs.filter((r) => r.taxonomyType === tax).reduce((s, r) => s + (r.values?.[y] ?? 0), 0);
  const dtaY = sumTax("asset_deferred_tax", year);
  const dtaP = sumTax("asset_deferred_tax", prevYear);
  const dtlY = sumTax("liab_deferred_tax", year);
  const dtlP = sumTax("liab_deferred_tax", prevYear);
  return -(dtaY - dtaP) + (dtlY - dtlP);
}

function extractDandaAddBack(incomeStatement: Row[], year: string): number {
  return getDandaFromIncomeStatement(incomeStatement, year) ?? 0;
}

function extractSbcAddBack(incomeStatement: Row[], year: string): number {
  return getSbcFromIncomeStatement(incomeStatement, year) ?? 0;
}

function extractNetIncome(is: Row[], flatIs: Row[], year: string): number {
  const row =
    findRowInTree(is, "net_income") ?? flatIs.find((r) => r.taxonomyType === "calc_net_income");
  return val(row, year);
}

function getBeginningCashFromBs(balanceSheet: Row[], lastHistYear: string | null): number {
  if (!lastHistYear) return 0;
  const flat = flattenStatement(balanceSheet);
  const cash = flat.find((r) => r.id === "cash" || r.taxonomyType === "asset_cash");
  return cash?.values?.[lastHistYear] ?? 0;
}

// ─── Core ────────────────────────────────────────────────────────────────────

export function computeProjectedCashFlow(input: ProjectedCfsEngineInput): ProjectedCfsEngineResult {
  const {
    projectionYears,
    lastHistoricalYear,
    balanceSheet,
    incomeStatement,
    totalCapexByYear,
    debtScheduleResult,
    equityRollforwardResult,
    fxEffectByYear = {},
  } = input;

  const flatBs = flattenStatement(balanceSheet);

  const byYear: Record<string, ProjectedCfsYearBreakdown> = {};
  const cfsValuesByRowId: Record<string, Record<string, number>> = {};
  const endingCashByYear: Record<string, number> = {};

  const setCfs = (rowId: string, year: string, value: number) => {
    if (!cfsValuesByRowId[rowId]) cfsValuesByRowId[rowId] = {};
    cfsValuesByRowId[rowId][year] = value;
  };

  let prevEndingCash = getBeginningCashFromBs(balanceSheet, lastHistoricalYear);

  for (let i = 0; i < projectionYears.length; i++) {
    const year = projectionYears[i]!;
    const prevYear =
      i === 0 ? lastHistoricalYear : projectionYears[i - 1]!;

    const beginningCash = prevEndingCash;

    const flatIs = flattenStatement(incomeStatement);
    const netIncome = extractNetIncome(incomeStatement, flatIs, year);
    const danda = extractDandaAddBack(incomeStatement, year);
    const sbc = extractSbcAddBack(incomeStatement, year);
    const wcChange = prevYear ? -getDeltaWcBs(balanceSheet, year, prevYear) : 0;
    const otherOperating = otherOperatingDeferredTax(flatBs, year, prevYear);

    const cfo = netIncome + danda + sbc + wcChange + otherOperating;

    const capexRaw = totalCapexByYear[year] ?? 0;
    const capex = -Math.abs(capexRaw);

    const acquisitions = 0;
    const assetSales = 0;
    const investments = 0;
    const otherInvesting = 0;

    const cfi = capex + acquisitions + assetSales + investments + otherInvesting;

    let debtIssued = 0;
    let debtRepaid = 0;
    let cashInterestPaid = 0;
    if (debtScheduleResult) {
      const t = debtScheduleResult.totalsByYear[year];
      if (t) {
        debtIssued = t.totalNewBorrowingDraws ?? 0;
        const prin = (t.totalMandatoryRepayment ?? 0) + (t.totalOptionalRepayment ?? 0);
        debtRepaid = -Math.abs(prin);
        const intExp = t.totalInterestExpense;
        cashInterestPaid = intExp != null && Number.isFinite(intExp) ? -Math.abs(intExp) : 0;
      }
    }

    let equityIssued = 0;
    let shareRepurchases = 0;
    let dividends = 0;
    if (equityRollforwardResult) {
      equityIssued = equityRollforwardResult.cffIssuancesByYear[year] ?? 0;
      shareRepurchases = equityRollforwardResult.cffBuybacksByYear[year] ?? 0;
      dividends = equityRollforwardResult.cffDividendsByYear[year] ?? 0;
    }

    const otherFinancing = 0;
    const cff =
      debtIssued + debtRepaid + cashInterestPaid + equityIssued + shareRepurchases + dividends + otherFinancing;

    const fxEffect = fxEffectByYear[year] ?? 0;
    const netChangeInCash = cfo + cfi + cff + fxEffect;
    const endingCash = beginningCash + netChangeInCash;

    byYear[year] = {
      beginningCash,
      netIncome,
      danda,
      sbc,
      wcChange,
      otherOperating,
      cfo,
      capex,
      acquisitions,
      assetSales,
      investments,
      otherInvesting,
      cfi,
      debtIssued,
      debtRepaid,
      cashInterestPaid,
      equityIssued,
      shareRepurchases,
      dividends,
      otherFinancing,
      cff,
      fxEffect,
      netChangeInCash,
      endingCash,
    };

    endingCashByYear[year] = endingCash;
    prevEndingCash = endingCash;

    // CFS row merges (projection years only). Calc rows (e.g. net_income, sbc) are
    // overwritten by recomputeCalculations but kept aligned for debugging / export.
    setCfs("net_income", year, netIncome);
    setCfs("danda", year, danda);
    setCfs("sbc", year, sbc);
    setCfs("wc_change", year, wcChange);
    setCfs("other_operating", year, otherOperating);
    setCfs("capex", year, capex);
    setCfs("acquisitions", year, acquisitions);
    setCfs("asset_sales", year, assetSales);
    setCfs("investments", year, investments);
    setCfs("other_investing", year, otherInvesting);
    setCfs("debt_issued", year, debtIssued);
    setCfs("debt_repaid", year, debtRepaid);
    setCfs("cash_interest_paid", year, cashInterestPaid);
    setCfs("equity_issued", year, equityIssued);
    setCfs("share_repurchases", year, shareRepurchases);
    setCfs("dividends", year, dividends);
    setCfs("other_financing", year, otherFinancing);
    setCfs("fx_effect_on_cash", year, fxEffect);
  }

  return { byYear, cfsValuesByRowId, endingCashByYear };
}

/** Deep-merge projected CFS values into existing rows (historical years untouched). */
export function applyProjectedCfsToCashFlowRows(
  cashFlow: Row[],
  cfsValuesByRowId: Record<string, Record<string, number>>
): Row[] {
  const patch = (rows: Row[]): Row[] =>
    rows.map((r) => {
      const years = cfsValuesByRowId[r.id];
      const nextChildren = r.children ? patch(r.children) : undefined;
      if (!years && !nextChildren) return r;
      const newValues = { ...(r.values ?? {}) };
      if (years) {
        for (const [y, v] of Object.entries(years)) {
          newValues[y] = v;
        }
      }
      return { ...r, values: newValues, ...(nextChildren ? { children: nextChildren } : {}) };
    });
  return patch(cashFlow);
}

/** Write engine ending cash to the BS cash row for projection years. */
export function applyEndingCashToBalanceSheet(
  balanceSheet: Row[],
  endingCashByYear: Record<string, number>,
  projectionYears: string[]
): Row[] {
  const patch = (rows: Row[]): Row[] =>
    rows.map((r) => {
      const nextChildren = r.children ? patch(r.children) : undefined;
      const isCash = r.id === "cash" || r.taxonomyType === "asset_cash";
      if (!isCash) {
        return nextChildren ? { ...r, children: nextChildren } : r;
      }
      const newValues = { ...(r.values ?? {}) };
      for (const y of projectionYears) {
        if (endingCashByYear[y] !== undefined) newValues[y] = endingCashByYear[y]!;
      }
      return { ...r, values: newValues, ...(nextChildren ? { children: nextChildren } : {}) };
    });
  return patch(balanceSheet);
}
