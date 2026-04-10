/**
 * Deterministic debt schedule math (v1). User-driven draws/repayments only.
 *
 * Deferred (explicitly NOT in v1):
 * - Cash-driven revolver draws, min-cash rules, automatic cash sweep
 * - Circularity (interest ⟷ cash ⟷ revolver); iterative solve
 * - Statement writeback to balance sheet rows (preview outputs only unless added later)
 */

import type { DebtScheduleConfigBodyV1, DebtTrancheConfigV1 } from "@/types/debt-schedule-v1";
import { tryBuildModelTotalDebtByYear } from "@/lib/model-total-debt-for-interest";
import type { Row } from "@/types/finance";

export type DebtTrancheYearFlowV1 = {
  beginningDebt: number | null;
  newBorrowingDraws: number;
  mandatoryRepayment: number;
  optionalRepayment: number;
  endingDebt: number | null;
  /** Positive expense magnitude; null if rate or principal path incomplete for this tranche-year. */
  interestExpense: number | null;
};

export type DebtScheduleYearTotalsV1 = {
  totalOpeningDebt: number | null;
  totalNewBorrowingDraws: number;
  totalMandatoryRepayment: number;
  totalOptionalRepayment: number;
  totalEndingDebt: number | null;
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

function finiteOrZero(v: unknown): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return v as number;
}

function openingBalanceForTranche(
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
  const { byYear, ok } = tryBuildModelTotalDebtByYear(balanceSheet, [lastHistoricYear]);
  if (!ok) return null;
  const total = byYear[lastHistoricYear];
  if (total == null || !Number.isFinite(total)) return null;
  const pct = tranche.openingHistoricalAllocationPct;
  if (!Number.isFinite(pct) || pct < 0) return null;
  return total * (pct / 100);
}

function nominalRateForYear(tranche: DebtTrancheConfigV1, year: string): number | null {
  if (tranche.interestRateMethod === "fixed_rate") {
    const p = tranche.fixedInterestRatePct;
    if (p == null || !Number.isFinite(p)) return null;
    return p / 100;
  }
  const py = tranche.interestRateByYear[year];
  if (py == null || !Number.isFinite(py)) return null;
  return py / 100;
}

function principalForInterest(balance: number): number {
  if (!Number.isFinite(balance)) return 0;
  return Math.max(0, balance);
}

function interestForYear(
  tranche: DebtTrancheConfigV1,
  beginning: number | null,
  ending: number | null,
  year: string
): number | null {
  if (beginning == null || ending == null) return null;
  const rate = nominalRateForYear(tranche, year);
  if (rate == null) return null;
  if (tranche.interestComputationBasis === "ending_balance") {
    return rate * principalForInterest(ending);
  }
  const avg = (principalForInterest(beginning) + principalForInterest(ending)) / 2;
  return rate * avg;
}

function computeTrancheFlows(
  tranche: DebtTrancheConfigV1,
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
        interestExpense: null,
      };
    }
    return out;
  }

  let priorEnding: number | null = openingBalanceForTranche(tranche, lastHistoricYear, balanceSheet);

  for (const y of projectionYears) {
    const beginningDebt = priorEnding;
    const draws = finiteOrZero(tranche.drawsByYear[y]);
    const mandatoryRepayment = finiteOrZero(tranche.mandatoryRepaymentByYear[y]);
    const optionalRepayment = finiteOrZero(tranche.optionalRepaymentByYear[y]);

    let endingDebt: number | null = null;
    if (beginningDebt != null && Number.isFinite(beginningDebt)) {
      endingDebt = beginningDebt + draws - mandatoryRepayment - optionalRepayment;
    }

    const interestExpense =
      beginningDebt != null && endingDebt != null
        ? interestForYear(tranche, beginningDebt, endingDebt, y)
        : null;

    out[y] = {
      beginningDebt,
      newBorrowingDraws: draws,
      mandatoryRepayment,
      optionalRepayment,
      endingDebt,
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
    };
    interestExpenseTotalByYear[y] = 0;
  }

  const enabledTranches = config.tranches.filter((t) => t.isEnabled);

  for (const tranche of config.tranches) {
    perTrancheByYear[tranche.trancheId] = computeTrancheFlows(
      tranche,
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
    }

    totalsByYear[y]!.totalOpeningDebt = openOk ? openSum : null;
    totalsByYear[y]!.totalEndingDebt = endOk ? endSum : null;
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
