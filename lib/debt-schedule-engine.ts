/**
 * Deterministic debt schedule math (v1). User-driven draws/repayments only.
 *
 * Deferred (explicitly NOT in v1):
 * - Cash-driven revolver draws, min-cash rules, automatic cash sweep
 * - Circularity (interest ⟷ cash ⟷ revolver); iterative solve
 * - Statement writeback to balance sheet rows (preview outputs only unless added later)
 */

import type {
  DebtScheduleConfigBodyV1,
  DebtTrancheConfigV1,
  InterestComputationBasisV1,
} from "@/types/debt-schedule-v1";
import { tryBuildModelTotalDebtByYear } from "@/lib/model-total-debt-for-interest";
import { detectFundedDebtTotalsByYear, detectHistoricalBalanceSheetFundedDebt } from "@/lib/historical-bs-debt-detection";
import type { Row } from "@/types/finance";

export type DebtTrancheYearFlowV1 = {
  beginningDebt: number | null;
  newBorrowingDraws: number;
  mandatoryRepayment: number;
  optionalRepayment: number;
  endingDebt: number | null;
  /** (beginning + ending) / 2 when both finite; else null. */
  averageBalance: number | null;
  /** Nominal rate applied this year (e.g. 0.055 for 5.5%); null if missing. */
  nominalRate: number | null;
  /** Positive expense magnitude; null if rate or principal path incomplete for this tranche-year. */
  interestExpense: number | null;
};

export type DebtScheduleYearTotalsV1 = {
  totalOpeningDebt: number | null;
  totalNewBorrowingDraws: number;
  totalMandatoryRepayment: number;
  totalOptionalRepayment: number;
  totalEndingDebt: number | null;
  /** Sum of interest across tranches; null if any enabled tranche missing interest that year. */
  totalInterestExpense: number | null;
  /** Mandatory + optional principal + interest (cash debt service proxy); null if any piece null. */
  totalDebtService: number | null;
};

export type DebtScheduleEngineResultV1 = {
  /** True when every enabled tranche has a full projection path and interest for every projection year. */
  isComplete: boolean;
  /** trancheId -> year -> flow */
  perTrancheByYear: Record<string, Record<string, DebtTrancheYearFlowV1>>;
  totalsByYear: Record<string, DebtScheduleYearTotalsV1>;
  /** Sum of positive interest magnitudes across enabled tranches; null if any contribution missing that year. */
  interestExpenseTotalByYear: Record<string, number | null>;
};

export type BsDebtOpeningBalancesV1 = {
  found: boolean;
  historicalYearUsed: string | null;
  shortTerm: number | null;
  longTerm: number | null;
  total: number | null;
  status: "detected" | "none" | "needs_review" | "incomplete";
};

/** Read-only opening balances from historical BS funded-debt detection (banner / UI). */
export function detectBsDebtOpeningBalances(
  balanceSheet: Row[],
  lastHistoricYear: string | null
): BsDebtOpeningBalancesV1 {
  const d = detectHistoricalBalanceSheetFundedDebt(balanceSheet, lastHistoricYear);
  const found = d.status === "detected" || d.status === "needs_review";
  return {
    found,
    historicalYearUsed: d.historicalYearUsed,
    shortTerm: d.currentFundedDebt,
    longTerm: d.longTermFundedDebt,
    total: d.totalFundedDebt,
    status: d.status,
  };
}

function finiteOrZero(v: unknown): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return v as number;
}

function principalForInterest(balance: number): number {
  if (!Number.isFinite(balance)) return 0;
  return Math.max(0, balance);
}

/** Exported for Apply-time straight-line mandatories in the builder (same rules as engine opening). */
export function resolveTrancheOpeningBalance(
  tranche: DebtTrancheConfigV1,
  lastHistoricYear: string | null,
  balanceSheet: Row[]
): number | null {
  if (!tranche.isEnabled) return null;
  if (tranche.openingBalanceSource === "manual") {
    const m = tranche.openingBalanceManual;
    if (m == null || !Number.isFinite(m)) return null;
    return m;
  }
  if (!lastHistoricYear) return null;

  if (tranche.openingBalanceSource === "detected_historical_bs") {
    const { byYearTotal, byYearCurrent, byYearLongTerm, ok } = detectFundedDebtTotalsByYear(balanceSheet, [
      lastHistoricYear,
    ]);
    if (!ok) return null;
    const bucket = tranche.openingDebtBucket ?? "all_funded";
    if (bucket === "current_funded") {
      const v = byYearCurrent[lastHistoricYear];
      return v != null && Number.isFinite(v) ? v : null;
    }
    if (bucket === "long_term_funded") {
      const v = byYearLongTerm[lastHistoricYear];
      return v != null && Number.isFinite(v) ? v : null;
    }
    const t = byYearTotal[lastHistoricYear];
    return t != null && Number.isFinite(t) ? t : null;
  }

  const { byYear, ok } = tryBuildModelTotalDebtByYear(balanceSheet, [lastHistoricYear]);
  if (!ok) return null;
  const total = byYear[lastHistoricYear];
  if (total == null || !Number.isFinite(total)) return null;
  const pct = tranche.openingHistoricalAllocationPct;
  if (!Number.isFinite(pct) || pct < 0) return null;
  return total * (pct / 100);
}

function effectiveInterestBasis(
  config: DebtScheduleConfigBodyV1,
  tranche: DebtTrancheConfigV1
): InterestComputationBasisV1 {
  if (config.conventionType === "mid_year") return "average_balance";
  if (config.conventionType === "full_year") return "ending_balance";
  return tranche.interestComputationBasis ?? "average_balance";
}

/** Coerce persisted / form values that may be strings after JSON round-trip. */
function toFiniteNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Nominal annual rate as decimal (e.g. 0.04 for 4%).
 * Only `manual_by_year` uses per-year rates; all other cases (including missing/legacy `interestRateMethod`)
 * use `fixedInterestRatePct` so we never fall through to the default all-zero `interestRateByYear` map.
 */
function nominalRateForYear(tranche: DebtTrancheConfigV1, year: string): number | null {
  if (tranche.interestRateMethod === "manual_by_year") {
    const py = toFiniteNumber(tranche.interestRateByYear[year]);
    if (py == null) return null;
    return py / 100;
  }
  const p = toFiniteNumber(tranche.fixedInterestRatePct);
  if (p == null) return null;
  return p / 100;
}

function interestForYear(
  tranche: DebtTrancheConfigV1,
  config: DebtScheduleConfigBodyV1,
  beginning: number | null,
  ending: number | null,
  year: string
): { expense: number | null; nominalRate: number | null } {
  if (beginning == null || ending == null) return { expense: null, nominalRate: null };
  const rate = nominalRateForYear(tranche, year);
  if (rate == null) return { expense: null, nominalRate: null };
  const basis = effectiveInterestBasis(config, tranche);
  if (basis === "ending_balance") {
    return { expense: rate * principalForInterest(ending), nominalRate: rate };
  }
  const avg = (principalForInterest(beginning) + principalForInterest(ending)) / 2;
  return { expense: rate * avg, nominalRate: rate };
}

function computeTrancheFlows(
  tranche: DebtTrancheConfigV1,
  config: DebtScheduleConfigBodyV1,
  projectionYears: string[],
  lastHistoricYear: string | null,
  balanceSheet: Row[]
): Record<string, DebtTrancheYearFlowV1> {
  const out: Record<string, DebtTrancheYearFlowV1> = {};
  if (!tranche.isEnabled) {
    for (const y of projectionYears) {
      out[y] = {
        beginningDebt: null,
        newBorrowingDraws: 0,
        mandatoryRepayment: 0,
        optionalRepayment: 0,
        endingDebt: null,
        averageBalance: null,
        nominalRate: null,
        interestExpense: null,
      };
    }
    return out;
  }

  let priorEnding: number | null = resolveTrancheOpeningBalance(tranche, lastHistoricYear, balanceSheet);

  for (const y of projectionYears) {
    const beginningDebt = priorEnding;
    const draws = finiteOrZero(tranche.drawsByYear[y]);
    const mandatoryRepayment = finiteOrZero(tranche.mandatoryRepaymentByYear[y]);
    const optionalRepayment = finiteOrZero(tranche.optionalRepaymentByYear[y]);

    let endingDebt: number | null = null;
    let averageBalance: number | null = null;
    if (beginningDebt != null && Number.isFinite(beginningDebt)) {
      endingDebt = beginningDebt + draws - mandatoryRepayment - optionalRepayment;
      averageBalance = (beginningDebt + endingDebt) / 2;
    }

    const { expense: interestExpense, nominalRate } =
      beginningDebt != null && endingDebt != null
        ? interestForYear(tranche, config, beginningDebt, endingDebt, y)
        : { expense: null, nominalRate: null };

    out[y] = {
      beginningDebt,
      newBorrowingDraws: draws,
      mandatoryRepayment,
      optionalRepayment,
      endingDebt,
      averageBalance,
      nominalRate,
      interestExpense,
    };
    priorEnding = endingDebt;
  }
  return out;
}

export function computeDebtScheduleEngine(input: {
  config: DebtScheduleConfigBodyV1;
  projectionYears: string[];
  lastHistoricYear: string | null;
  balanceSheet: Row[];
}): DebtScheduleEngineResultV1 {
  const { config, projectionYears, lastHistoricYear, balanceSheet } = input;
  const perTrancheByYear: Record<string, Record<string, DebtTrancheYearFlowV1>> = {};
  const totalsByYear: Record<string, DebtScheduleYearTotalsV1> = {};
  const interestExpenseTotalByYear: Record<string, number | null> = {};

  for (const y of projectionYears) {
    totalsByYear[y] = {
      totalOpeningDebt: 0,
      totalNewBorrowingDraws: 0,
      totalMandatoryRepayment: 0,
      totalOptionalRepayment: 0,
      totalEndingDebt: 0,
      totalInterestExpense: 0,
      totalDebtService: 0,
    };
    interestExpenseTotalByYear[y] = 0;
  }

  const enabledTranches = config.tranches.filter((t) => t.isEnabled);

  for (const tranche of config.tranches) {
    perTrancheByYear[tranche.trancheId] = computeTrancheFlows(
      tranche,
      config,
      projectionYears,
      lastHistoricYear,
      balanceSheet
    );
  }

  let isComplete = true;

  if (enabledTranches.length === 0) {
    for (const y of projectionYears) {
      totalsByYear[y] = {
        totalOpeningDebt: 0,
        totalNewBorrowingDraws: 0,
        totalMandatoryRepayment: 0,
        totalOptionalRepayment: 0,
        totalEndingDebt: 0,
        totalInterestExpense: 0,
        totalDebtService: 0,
      };
      interestExpenseTotalByYear[y] = 0;
    }
    return {
      isComplete: true,
      perTrancheByYear,
      totalsByYear,
      interestExpenseTotalByYear,
    };
  }

  for (const y of projectionYears) {
    let openSum = 0;
    let endSum = 0;
    let openOk = true;
    let endOk = true;
    let intSum = 0;
    let intOk = true;
    let debtSvcSum = 0;
    let debtSvcOk = true;

    for (const tranche of enabledTranches) {
      const flow = perTrancheByYear[tranche.trancheId]![y]!;
      if (flow.beginningDebt == null || !Number.isFinite(flow.beginningDebt)) openOk = false;
      else openSum += flow.beginningDebt;
      if (flow.endingDebt == null || !Number.isFinite(flow.endingDebt)) endOk = false;
      else endSum += flow.endingDebt;
      if (flow.interestExpense == null || !Number.isFinite(flow.interestExpense)) intOk = false;
      else intSum += flow.interestExpense;

      const t = totalsByYear[y]!;
      t.totalNewBorrowingDraws += flow.newBorrowingDraws;
      t.totalMandatoryRepayment += flow.mandatoryRepayment;
      t.totalOptionalRepayment += flow.optionalRepayment;

      const partialSvc = flow.mandatoryRepayment + flow.optionalRepayment;
      if (flow.interestExpense == null || !Number.isFinite(flow.interestExpense)) debtSvcOk = false;
      else debtSvcSum += partialSvc + flow.interestExpense;
    }

    totalsByYear[y]!.totalOpeningDebt = openOk ? openSum : null;
    totalsByYear[y]!.totalEndingDebt = endOk ? endSum : null;
    totalsByYear[y]!.totalInterestExpense = intOk ? intSum : null;
    totalsByYear[y]!.totalDebtService = debtSvcOk ? debtSvcSum : null;
    interestExpenseTotalByYear[y] = intOk ? intSum : null;
    if (!openOk || !endOk || !intOk) isComplete = false;
  }

  return {
    isComplete,
    perTrancheByYear,
    totalsByYear,
    interestExpenseTotalByYear,
  };
}
