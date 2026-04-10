import type { InterestExpenseScheduleConfigBody } from "@/types/interest-expense-schedule-v1";

export function ensureInterestExpenseBodyProjectionYears(
  body: InterestExpenseScheduleConfigBody,
  projectionYears: string[]
): InterestExpenseScheduleConfigBody {
  const manualDebtByYear = { ...body.manualDebtByYear };
  const manualInterestByYear = { ...body.manualInterestByYear };
  for (const y of projectionYears) {
    if (!Object.prototype.hasOwnProperty.call(manualDebtByYear, y)) manualDebtByYear[y] = 0;
    if (!Object.prototype.hasOwnProperty.call(manualInterestByYear, y)) manualInterestByYear[y] = 0;
  }
  return { ...body, manualDebtByYear, manualInterestByYear };
}

export function defaultInterestExpenseScheduleBody(projectionYears: string[]): InterestExpenseScheduleConfigBody {
  const manualDebtByYear: Record<string, number> = {};
  const manualInterestByYear: Record<string, number> = {};
  for (const y of projectionYears) {
    manualDebtByYear[y] = 0;
    manualInterestByYear[y] = 0;
  }
  return {
    scheduleType: "interest_expense",
    method: "pct_avg_debt",
    interestRatePct: 0,
    debtSource: "manual",
    manualDebtByYear,
    manualInterestByYear,
  };
}

export function cloneInterestExpenseScheduleBody(b: InterestExpenseScheduleConfigBody): InterestExpenseScheduleConfigBody {
  return {
    ...b,
    manualDebtByYear: { ...b.manualDebtByYear },
    manualInterestByYear: { ...b.manualInterestByYear },
  };
}

export function interestExpenseScheduleBodiesEqual(
  a: InterestExpenseScheduleConfigBody,
  b: InterestExpenseScheduleConfigBody
): boolean {
  if (
    a.scheduleType !== b.scheduleType ||
    a.method !== b.method ||
    a.interestRatePct !== b.interestRatePct ||
    a.debtSource !== b.debtSource
  ) {
    return false;
  }
  const debtKeys = new Set([...Object.keys(a.manualDebtByYear), ...Object.keys(b.manualDebtByYear)]);
  for (const k of debtKeys) {
    if ((a.manualDebtByYear[k] ?? 0) !== (b.manualDebtByYear[k] ?? 0)) return false;
  }
  const intKeys = new Set([...Object.keys(a.manualInterestByYear), ...Object.keys(b.manualInterestByYear)]);
  for (const k of intKeys) {
    if ((a.manualInterestByYear[k] ?? 0) !== (b.manualInterestByYear[k] ?? 0)) return false;
  }
  return true;
}
