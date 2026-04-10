import type {
  DebtScheduleConfigBodyV1,
  DebtSchedulePhase2Persist,
  DebtTrancheConfigV1,
} from "@/types/debt-schedule-v1";

function newTrancheId(): string {
  return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyYearMap(projectionYears: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const y of projectionYears) o[y] = 0;
  return o;
}

export function createDefaultDebtTranche(
  projectionYears: string[],
  index: number
): DebtTrancheConfigV1 {
  return {
    trancheId: newTrancheId(),
    trancheName: index === 0 ? "Term loan" : `Debt tranche ${index + 1}`,
    trancheType: "term_debt",
    isEnabled: true,
    openingBalanceSource: "manual",
    openingBalanceManual: 0,
    openingHistoricalAllocationPct: 100,
    drawsByYear: emptyYearMap(projectionYears),
    mandatoryRepaymentByYear: emptyYearMap(projectionYears),
    optionalRepaymentByYear: emptyYearMap(projectionYears),
    interestRateMethod: "fixed_rate",
    fixedInterestRatePct: 0,
    interestRateByYear: emptyYearMap(projectionYears),
    interestComputationBasis: "average_balance",
  };
}

export function defaultDebtScheduleBody(projectionYears: string[]): DebtScheduleConfigBodyV1 {
  return {
    scheduleType: "debt_schedule",
    tranches: [createDefaultDebtTranche(projectionYears, 0)],
  };
}

export function defaultDebtSchedulePhase2Persist(): DebtSchedulePhase2Persist {
  return { draft: defaultDebtScheduleBody([]), applied: null };
}

export function ensureTrancheProjectionYears(
  t: DebtTrancheConfigV1,
  projectionYears: string[]
): DebtTrancheConfigV1 {
  const merge = (m: Record<string, number>) => {
    const next = { ...m };
    for (const y of projectionYears) {
      if (!Object.prototype.hasOwnProperty.call(next, y)) next[y] = 0;
    }
    return next;
  };
  return {
    ...t,
    drawsByYear: merge(t.drawsByYear),
    mandatoryRepaymentByYear: merge(t.mandatoryRepaymentByYear),
    optionalRepaymentByYear: merge(t.optionalRepaymentByYear),
    interestRateByYear: merge(t.interestRateByYear),
  };
}

export function ensureDebtScheduleBodyProjectionYears(
  body: DebtScheduleConfigBodyV1,
  projectionYears: string[]
): DebtScheduleConfigBodyV1 {
  return {
    ...body,
    tranches: body.tranches.map((t) => ensureTrancheProjectionYears(t, projectionYears)),
  };
}

export function cloneDebtScheduleBody(body: DebtScheduleConfigBodyV1): DebtScheduleConfigBodyV1 {
  return {
    scheduleType: body.scheduleType,
    tranches: body.tranches.map((t) => ({
      ...t,
      drawsByYear: { ...t.drawsByYear },
      mandatoryRepaymentByYear: { ...t.mandatoryRepaymentByYear },
      optionalRepaymentByYear: { ...t.optionalRepaymentByYear },
      interestRateByYear: { ...t.interestRateByYear },
    })),
  };
}

export function debtScheduleBodiesEqual(a: DebtScheduleConfigBodyV1, b: DebtScheduleConfigBodyV1): boolean {
  if (a.scheduleType !== b.scheduleType || a.tranches.length !== b.tranches.length) return false;
  for (let i = 0; i < a.tranches.length; i++) {
    const x = a.tranches[i]!;
    const y = b.tranches[i]!;
    if (
      x.trancheId !== y.trancheId ||
      x.trancheName !== y.trancheName ||
      x.trancheType !== y.trancheType ||
      x.isEnabled !== y.isEnabled ||
      x.openingBalanceSource !== y.openingBalanceSource ||
      x.openingBalanceManual !== y.openingBalanceManual ||
      x.openingHistoricalAllocationPct !== y.openingHistoricalAllocationPct ||
      x.interestRateMethod !== y.interestRateMethod ||
      x.fixedInterestRatePct !== y.fixedInterestRatePct ||
      x.interestComputationBasis !== y.interestComputationBasis
    ) {
      return false;
    }
    const maps = [
      x.drawsByYear,
      y.drawsByYear,
      x.mandatoryRepaymentByYear,
      y.mandatoryRepaymentByYear,
      x.optionalRepaymentByYear,
      y.optionalRepaymentByYear,
      x.interestRateByYear,
      y.interestRateByYear,
    ] as const;
    for (let j = 0; j < maps.length; j += 2) {
      const ma = maps[j]!;
      const mb = maps[j + 1]!;
      const keys = new Set([...Object.keys(ma), ...Object.keys(mb)]);
      for (const k of keys) {
        if ((ma[k] ?? 0) !== (mb[k] ?? 0)) return false;
      }
    }
  }
  return true;
}
