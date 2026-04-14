/**
 * Unit tests for computeDebtScheduleEngine and resolveTrancheOpeningBalance.
 * All values are in "stored" units (same currency scale as the engine — no display conversion).
 *
 * Covering 10 engine scenarios and 3 resolveTrancheOpeningBalance cases.
 */

import { describe, it, expect } from "vitest";
import {
  computeDebtScheduleEngine,
  resolveTrancheOpeningBalance,
} from "@/lib/debt-schedule-engine";
import type {
  DebtScheduleConfigBodyV1,
  DebtTrancheConfigV1,
} from "@/types/debt-schedule-v1";
import type { Row } from "@/types/finance";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROJ_YEARS_5 = ["2026E", "2027E", "2028E", "2029E", "2030E"];
const PROJ_YEARS_3 = ["2026E", "2027E", "2028E"];
const PROJ_YEARS_2 = ["2026E", "2027E"];
const LAST_HIST = "2025A";

function emptyYearMap(years: string[], value = 0): Record<string, number> {
  return Object.fromEntries(years.map((y) => [y, value]));
}

function makeTranche(
  overrides: Partial<DebtTrancheConfigV1> & {
    projectionYears?: string[];
  }
): DebtTrancheConfigV1 {
  const years = overrides.projectionYears ?? PROJ_YEARS_5;
  const {
    projectionYears: _dropped,
    mandatoryRepaymentByYear,
    drawsByYear,
    optionalRepaymentByYear,
    interestRateByYear,
    ...rest
  } = overrides;
  return {
    trancheId: "t1",
    trancheName: "Test Tranche",
    trancheType: "term_loan",
    isEnabled: true,
    openingBalanceSource: "manual",
    openingBalanceManual: 0,
    openingHistoricalAllocationPct: 100,
    detectedFromBucket: "manual",
    amortizationMethod: "straight_line",
    interestRateMethod: "fixed_rate",
    fixedInterestRatePct: 0,
    interestComputationBasis: "average_balance",
    drawsByYear: drawsByYear ?? emptyYearMap(years),
    mandatoryRepaymentByYear: mandatoryRepaymentByYear ?? emptyYearMap(years),
    optionalRepaymentByYear: optionalRepaymentByYear ?? emptyYearMap(years),
    interestRateByYear: interestRateByYear ?? emptyYearMap(years),
    ...rest,
  };
}

function makeConfig(
  tranches: DebtTrancheConfigV1[],
  conventionType?: "mid_year" | "full_year"
): DebtScheduleConfigBodyV1 {
  return { scheduleType: "debt_schedule", tranches, conventionType };
}

const EMPTY_BS: Row[] = [];

function close(a: number | null, b: number, precision = 1): void {
  expect(a).not.toBeNull();
  expect(a as number).toBeCloseTo(b, precision);
}

// ─── Scenario 1: Current portion, beyond-forecast, mid-year ──────────────────

describe("Scenario 1: current portion beyond-forecast (screenshot repro)", () => {
  const tranche = makeTranche({
    trancheId: "t1",
    openingBalanceManual: 102_000,
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS_5, 10_200),
    fixedInterestRatePct: 6,
  });
  const config = makeConfig([tranche], "mid_year");
  const result = computeDebtScheduleEngine({
    config,
    projectionYears: PROJ_YEARS_5,
    lastHistoricYear: LAST_HIST,
    balanceSheet: EMPTY_BS,
  });

  it("isComplete is true", () => expect(result.isComplete).toBe(true));

  const expected = [
    { y: "2026E", begin: 102_000, end: 91_800, avg: 96_900, interest: 5_814, debtSvc: 16_014 },
    { y: "2027E", begin: 91_800,  end: 81_600, avg: 86_700, interest: 5_202, debtSvc: 15_402 },
    { y: "2028E", begin: 81_600,  end: 71_400, avg: 76_500, interest: 4_590, debtSvc: 14_790 },
    { y: "2029E", begin: 71_400,  end: 61_200, avg: 66_300, interest: 3_978, debtSvc: 14_178 },
    { y: "2030E", begin: 61_200,  end: 51_000, avg: 56_100, interest: 3_366, debtSvc: 13_566 },
  ];

  for (const row of expected) {
    const flow = result.perTrancheByYear.t1![row.y]!;
    const tot = result.totalsByYear[row.y]!;

    it(`${row.y} beginningDebt`, () => expect(flow.beginningDebt).toBeCloseTo(row.begin, 1));
    it(`${row.y} endingDebt`, () => expect(flow.endingDebt).toBeCloseTo(row.end, 1));
    it(`${row.y} averageBalance`, () => expect(flow.averageBalance).toBeCloseTo(row.avg, 1));
    it(`${row.y} interestExpense`, () => close(flow.interestExpense, row.interest));
    it(`${row.y} totalDebtService`, () => close(tot.totalDebtService, row.debtSvc));
    it(`${row.y} totalEndingDebt`, () => expect(tot.totalEndingDebt).toBeCloseTo(row.end, 1));
  }
});

// ─── Scenario 2: Current portion, within-forecast (3-year term) ──────────────

describe("Scenario 2: current portion within-forecast, matures in year 3", () => {
  // Loan repaid over first 3 years; years 4-5 have 0 repayment.
  const mand: Record<string, number> = {
    "2026E": 34_000,
    "2027E": 34_000,
    "2028E": 34_000,
    "2029E": 0,
    "2030E": 0,
  };
  const tranche = makeTranche({
    trancheId: "t2",
    openingBalanceManual: 102_000,
    mandatoryRepaymentByYear: mand,
    fixedInterestRatePct: 6,
  });
  const config = makeConfig([tranche], "mid_year");
  const result = computeDebtScheduleEngine({
    config,
    projectionYears: PROJ_YEARS_5,
    lastHistoricYear: LAST_HIST,
    balanceSheet: EMPTY_BS,
  });

  it("isComplete is true", () => expect(result.isComplete).toBe(true));

  const flow26 = result.perTrancheByYear.t2!["2026E"]!;
  const flow27 = result.perTrancheByYear.t2!["2027E"]!;
  const flow28 = result.perTrancheByYear.t2!["2028E"]!;
  const flow29 = result.perTrancheByYear.t2!["2029E"]!;
  const flow30 = result.perTrancheByYear.t2!["2030E"]!;

  it("2026E ending = 68,000", () => expect(flow26.endingDebt).toBeCloseTo(68_000, 1));
  it("2026E interest ≈ 5,100 (avg 85,000 × 6%)", () => close(flow26.interestExpense, 5_100));
  it("2027E ending = 34,000", () => expect(flow27.endingDebt).toBeCloseTo(34_000, 1));
  it("2027E interest ≈ 3,060 (avg 51,000 × 6%)", () => close(flow27.interestExpense, 3_060));
  it("2028E ending = 0", () => expect(flow28.endingDebt).toBeCloseTo(0, 1));
  it("2028E interest ≈ 1,020 (avg 17,000 × 6%)", () => close(flow28.interestExpense, 1_020));
  it("2029E beginning = 0 (chained from prior ending)", () => expect(flow29.beginningDebt).toBeCloseTo(0, 1));
  it("2029E ending = 0 (zero repayment on zero balance)", () => expect(flow29.endingDebt).toBeCloseTo(0, 1));
  it("2029E interest = 0", () => close(flow29.interestExpense, 0));
  it("2030E ending = 0", () => expect(flow30.endingDebt).toBeCloseTo(0, 1));
});

// ─── Scenario 3: Revolver path (LOC flat + term declining) ───────────────────

describe("Scenario 3: revolver path — two tranches (LOC + term loan)", () => {
  const locTranche = makeTranche({
    trancheId: "loc",
    trancheType: "bank_line",
    openingBalanceManual: 12_000,
    amortizationMethod: "none",
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS_5, 0),
    fixedInterestRatePct: 8,
  });
  const termTranche = makeTranche({
    trancheId: "term",
    trancheType: "term_loan",
    openingBalanceManual: 90_000,
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS_5, 9_000),
    fixedInterestRatePct: 6,
  });
  const config = makeConfig([locTranche, termTranche], "mid_year");
  const result = computeDebtScheduleEngine({
    config,
    projectionYears: PROJ_YEARS_5,
    lastHistoricYear: LAST_HIST,
    balanceSheet: EMPTY_BS,
  });

  it("isComplete is true", () => expect(result.isComplete).toBe(true));

  // LOC stays flat
  for (const y of PROJ_YEARS_5) {
    it(`LOC ${y} ending = 12,000`, () =>
      expect(result.perTrancheByYear.loc![y]!.endingDebt).toBeCloseTo(12_000, 1));
    it(`LOC ${y} interest = 960 (12,000 × 8%)`, () =>
      close(result.perTrancheByYear.loc![y]!.interestExpense, 960));
  }

  // Term loan declines
  const termExpected = [
    { y: "2026E", end: 81_000, interest: 5_130 },
    { y: "2027E", end: 72_000, interest: 4_590 },
    { y: "2028E", end: 63_000, interest: 4_050 },
    { y: "2029E", end: 54_000, interest: 3_510 },
    { y: "2030E", end: 45_000, interest: 2_970 },
  ];
  for (const row of termExpected) {
    const flow = result.perTrancheByYear.term![row.y]!;
    it(`Term ${row.y} ending = ${row.end}`, () => expect(flow.endingDebt).toBeCloseTo(row.end, 1));
    it(`Term ${row.y} interest ≈ ${row.interest}`, () => close(flow.interestExpense, row.interest));
  }

  // Totals
  const tot26 = result.totalsByYear["2026E"]!;
  it("2026E totalEndingDebt = 93,000 (12K LOC + 81K term)", () =>
    expect(tot26.totalEndingDebt).toBeCloseTo(93_000, 1));
  it("2026E totalInterestExpense = 6,090 (960 LOC + 5,130 term)", () =>
    close(tot26.totalInterestExpense, 6_090));
  it("2026E totalMandatoryRepayment = 9,000 (LOC=0 + term=9000)", () =>
    expect(tot26.totalMandatoryRepayment).toBeCloseTo(9_000, 1));
});

// ─── Scenario 4: Full-year (ending balance) convention ───────────────────────

describe("Scenario 4: full-year convention — interest on ending balance", () => {
  const tranche = makeTranche({
    trancheId: "t4",
    openingBalanceManual: 102_000,
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS_5, 10_200),
    fixedInterestRatePct: 6,
  });
  const config = makeConfig([tranche], "full_year");
  const result = computeDebtScheduleEngine({
    config,
    projectionYears: PROJ_YEARS_5,
    lastHistoricYear: LAST_HIST,
    balanceSheet: EMPTY_BS,
  });

  it("isComplete is true", () => expect(result.isComplete).toBe(true));

  const fullYearExpected = [
    { y: "2026E", end: 91_800, interest: 5_508 },
    { y: "2027E", end: 81_600, interest: 4_896 },
    { y: "2028E", end: 71_400, interest: 4_284 },
    { y: "2029E", end: 61_200, interest: 3_672 },
    { y: "2030E", end: 51_000, interest: 3_060 },
  ];

  for (const row of fullYearExpected) {
    const flow = result.perTrancheByYear.t4![row.y]!;
    it(`${row.y} interest = ending × 6% = ${row.interest}`, () =>
      close(flow.interestExpense, row.interest));
    it(`${row.y} ending = ${row.end}`, () =>
      expect(flow.endingDebt).toBeCloseTo(row.end, 1));
  }
});

// ─── Scenario 5: Manual non-uniform repayments ───────────────────────────────

describe("Scenario 5: manual (non-uniform) repayments — each year is different", () => {
  const mand: Record<string, number> = {
    "2026E": 5_000,
    "2027E": 10_000,
    "2028E": 15_000,
    "2029E": 20_000,
    "2030E": 50_000,
  };
  const tranche = makeTranche({
    trancheId: "t5",
    openingBalanceManual: 102_000,
    mandatoryRepaymentByYear: mand,
    fixedInterestRatePct: 6,
  });
  const config = makeConfig([tranche], "mid_year");
  const result = computeDebtScheduleEngine({
    config,
    projectionYears: PROJ_YEARS_5,
    lastHistoricYear: LAST_HIST,
    balanceSheet: EMPTY_BS,
  });

  it("isComplete is true", () => expect(result.isComplete).toBe(true));

  // Chain of endings: 97000 → 87000 → 72000 → 52000 → 2000
  const rows = [
    { y: "2026E", end: 97_000, interest: 5_970 },  // avg=(102+97)/2*1000=99500, 99500*0.06=5970
    { y: "2027E", end: 87_000, interest: 5_520 },  // avg=92000, *0.06=5520
    { y: "2028E", end: 72_000, interest: 4_770 },  // avg=79500, *0.06=4770
    { y: "2029E", end: 52_000, interest: 3_720 },  // avg=62000, *0.06=3720
    { y: "2030E", end: 2_000,  interest: 1_620 },  // avg=27000, *0.06=1620
  ];

  for (const row of rows) {
    const flow = result.perTrancheByYear.t5![row.y]!;
    it(`${row.y} endingDebt = ${row.end}`, () =>
      expect(flow.endingDebt).toBeCloseTo(row.end, 1));
    it(`${row.y} interest ≈ ${row.interest}`, () =>
      close(flow.interestExpense, row.interest));
  }
});

// ─── Scenario 6: Zero interest rate ──────────────────────────────────────────

describe("Scenario 6: zero interest rate — expense is 0, not null → isComplete true", () => {
  const tranche = makeTranche({
    trancheId: "t6",
    openingBalanceManual: 50_000,
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS_5, 5_000),
    fixedInterestRatePct: 0,
  });
  const config = makeConfig([tranche], "mid_year");
  const result = computeDebtScheduleEngine({
    config,
    projectionYears: PROJ_YEARS_5,
    lastHistoricYear: LAST_HIST,
    balanceSheet: EMPTY_BS,
  });

  it("isComplete is true (0 rate → 0 expense, which is finite)", () =>
    expect(result.isComplete).toBe(true));

  for (const y of PROJ_YEARS_5) {
    it(`${y} interestExpense = 0`, () =>
      expect(result.perTrancheByYear.t6![y]!.interestExpense).toBe(0));
  }

  it("totalInterestExpense 2026E = 0", () =>
    expect(result.totalsByYear["2026E"]!.totalInterestExpense).toBe(0));
});

// ─── Scenario 7: Missing rate → null expense → isComplete false ───────────────

describe("Scenario 7: manual_by_year rate method with empty map → interestExpense null", () => {
  const tranche = makeTranche({
    trancheId: "t7",
    openingBalanceManual: 50_000,
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS_5, 5_000),
    interestRateMethod: "manual_by_year",
    interestRateByYear: {}, // empty — no rate for any year
  });
  const config = makeConfig([tranche]);
  const result = computeDebtScheduleEngine({
    config,
    projectionYears: PROJ_YEARS_5,
    lastHistoricYear: LAST_HIST,
    balanceSheet: EMPTY_BS,
  });

  it("isComplete is false when rate is missing", () =>
    expect(result.isComplete).toBe(false));

  for (const y of PROJ_YEARS_5) {
    it(`${y} interestExpense is null`, () =>
      expect(result.perTrancheByYear.t7![y]!.interestExpense).toBeNull());
  }

  it("totalInterestExpense is null", () =>
    expect(result.totalsByYear["2026E"]!.totalInterestExpense).toBeNull());
  it("totalDebtService is null", () =>
    expect(result.totalsByYear["2026E"]!.totalDebtService).toBeNull());
});

// ─── Scenario 8: Disabled tranche ────────────────────────────────────────────

describe("Scenario 8: disabled tranche — treated as zero-debt, isComplete true", () => {
  const tranche = makeTranche({
    trancheId: "t8",
    isEnabled: false,
    openingBalanceManual: 100_000,
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS_5, 10_000),
    fixedInterestRatePct: 6,
  });
  const config = makeConfig([tranche]);
  const result = computeDebtScheduleEngine({
    config,
    projectionYears: PROJ_YEARS_5,
    lastHistoricYear: LAST_HIST,
    balanceSheet: EMPTY_BS,
  });

  it("isComplete is true (no enabled tranches = special zero path)", () =>
    expect(result.isComplete).toBe(true));

  for (const y of PROJ_YEARS_5) {
    const flow = result.perTrancheByYear.t8![y]!;
    it(`${y} beginningDebt is null`, () => expect(flow.beginningDebt).toBeNull());
    it(`${y} endingDebt is null`, () => expect(flow.endingDebt).toBeNull());
    it(`${y} interestExpense is null`, () => expect(flow.interestExpense).toBeNull());
  }

  it("totalEndingDebt 2026E = 0", () =>
    expect(result.totalsByYear["2026E"]!.totalEndingDebt).toBe(0));
  it("totalInterestExpense 2026E = 0", () =>
    expect(result.totalsByYear["2026E"]!.totalInterestExpense).toBe(0));
});

// ─── Scenario 9: Negative ending balance (over-repayment) ────────────────────

describe("Scenario 9: over-repayment causes negative ending balance", () => {
  // UX NOTE: mandatory=6000/yr on a 10000 opening means the loan goes negative in year 2.
  // Engine does NOT floor at 0 — this surfaces as a warning in the UI (text-red-400 cells).
  // Interest flooring: principalForInterest() = max(0, balance), so interest on negative balance = 0.
  const tranche = makeTranche({
    trancheId: "t9",
    projectionYears: PROJ_YEARS_3,
    openingBalanceManual: 10_000,
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS_3, 6_000),
    fixedInterestRatePct: 6,
  });
  const config = makeConfig([tranche], "mid_year");
  const result = computeDebtScheduleEngine({
    config,
    projectionYears: PROJ_YEARS_3,
    lastHistoricYear: LAST_HIST,
    balanceSheet: EMPTY_BS,
  });

  const flow26 = result.perTrancheByYear.t9!["2026E"]!;
  const flow27 = result.perTrancheByYear.t9!["2027E"]!;
  const flow28 = result.perTrancheByYear.t9!["2028E"]!;

  it("2026E endingDebt = 4,000", () => expect(flow26.endingDebt).toBeCloseTo(4_000, 1));
  it("2026E averageBalance = 7,000 (raw, unfloored)", () =>
    expect(flow26.averageBalance).toBeCloseTo(7_000, 1));
  it("2026E interestExpense = 420 ((10K+4K)/2 × 6%)", () => close(flow26.interestExpense, 420));

  it("2027E endingDebt = -2,000 (engine does not floor)", () =>
    expect(flow27.endingDebt).toBeCloseTo(-2_000, 1));
  it("2027E averageBalance = 1,000 raw", () =>
    expect(flow27.averageBalance).toBeCloseTo(1_000, 1));
  // interestBasis: (max(0,4000) + max(0,-2000)) / 2 = (4000+0)/2 = 2000 → 2000*0.06 = 120
  it("2027E interestExpense = 120 (floors negative balance to 0 for interest only)", () =>
    close(flow27.interestExpense, 120));

  it("2028E endingDebt = -8,000", () => expect(flow28.endingDebt).toBeCloseTo(-8_000, 1));
  // interestBasis: (max(0,-2000) + max(0,-8000)) / 2 = 0 → interest = 0
  it("2028E interestExpense = 0 (both balances negative, no interest principal)", () =>
    expect(flow28.interestExpense).toBeCloseTo(0, 1));

  // isComplete: all values are finite (even if negative) → true
  it("isComplete is true (negative values are still finite)", () =>
    expect(result.isComplete).toBe(true));
});

// ─── Scenario 10: Two tranches — totalsByYear aggregation ────────────────────

describe("Scenario 10: two enabled tranches — totals correctly aggregated", () => {
  const trancheA = makeTranche({
    trancheId: "tA",
    projectionYears: PROJ_YEARS_2,
    openingBalanceManual: 50_000,
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS_2, 5_000),
    fixedInterestRatePct: 5,
  });
  const trancheB = makeTranche({
    trancheId: "tB",
    projectionYears: PROJ_YEARS_2,
    openingBalanceManual: 60_000,
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS_2, 6_000),
    fixedInterestRatePct: 7,
  });
  const config = makeConfig([trancheA, trancheB], "mid_year");
  const result = computeDebtScheduleEngine({
    config,
    projectionYears: PROJ_YEARS_2,
    lastHistoricYear: LAST_HIST,
    balanceSheet: EMPTY_BS,
  });

  it("isComplete is true", () => expect(result.isComplete).toBe(true));

  // A 2026E: begin=50000, end=45000, avg=47500, interest=2375
  // B 2026E: begin=60000, end=54000, avg=57000, interest=3990
  const tot26 = result.totalsByYear["2026E"]!;
  it("2026E totalOpeningDebt = 110,000", () =>
    expect(tot26.totalOpeningDebt).toBeCloseTo(110_000, 1));
  it("2026E totalEndingDebt = 99,000", () =>
    expect(tot26.totalEndingDebt).toBeCloseTo(99_000, 1));
  it("2026E totalInterestExpense = 6,365 (2375+3990)", () =>
    close(tot26.totalInterestExpense, 6_365));
  it("2026E totalMandatoryRepayment = 11,000 (5000+6000)", () =>
    expect(tot26.totalMandatoryRepayment).toBeCloseTo(11_000, 1));
  it("2026E totalDebtService = 17,365 (11000+6365)", () =>
    close(tot26.totalDebtService, 17_365));

  // A 2027E: begin=45000, end=40000, avg=42500, interest=2125
  // B 2027E: begin=54000, end=48000, avg=51000, interest=3570
  const tot27 = result.totalsByYear["2027E"]!;
  it("2027E totalEndingDebt = 88,000", () =>
    expect(tot27.totalEndingDebt).toBeCloseTo(88_000, 1));
  it("2027E totalInterestExpense = 5,695 (2125+3570)", () =>
    close(tot27.totalInterestExpense, 5_695));

  // Incomplete when one tranche missing rate
  const trancheC = makeTranche({
    trancheId: "tC",
    projectionYears: PROJ_YEARS_2,
    openingBalanceManual: 20_000,
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS_2, 2_000),
    interestRateMethod: "manual_by_year",
    interestRateByYear: {},
  });
  const configIncomplete = makeConfig([trancheA, trancheB, trancheC], "mid_year");
  const incomplete = computeDebtScheduleEngine({
    config: configIncomplete,
    projectionYears: PROJ_YEARS_2,
    lastHistoricYear: LAST_HIST,
    balanceSheet: EMPTY_BS,
  });
  it("isComplete false when any tranche has null interest", () =>
    expect(incomplete.isComplete).toBe(false));
  it("totalInterestExpense null when any tranche missing rate", () =>
    expect(incomplete.totalsByYear["2026E"]!.totalInterestExpense).toBeNull());
});

// ─── resolveTrancheOpeningBalance ─────────────────────────────────────────────

describe("resolveTrancheOpeningBalance", () => {
  it("returns openingBalanceManual for source=manual", () => {
    const tranche = makeTranche({
      openingBalanceSource: "manual",
      openingBalanceManual: 75_000,
    });
    expect(resolveTrancheOpeningBalance(tranche, LAST_HIST, EMPTY_BS)).toBe(75_000);
  });

  it("returns null for source=manual when openingBalanceManual is 0 (is finite, returns 0)", () => {
    const tranche = makeTranche({
      openingBalanceSource: "manual",
      openingBalanceManual: 0,
    });
    // 0 IS finite → returns 0, not null
    expect(resolveTrancheOpeningBalance(tranche, LAST_HIST, EMPTY_BS)).toBe(0);
  });

  it("returns null for disabled tranche regardless of source", () => {
    const tranche = makeTranche({
      isEnabled: false,
      openingBalanceSource: "manual",
      openingBalanceManual: 100_000,
    });
    expect(resolveTrancheOpeningBalance(tranche, LAST_HIST, EMPTY_BS)).toBeNull();
  });

  it("reads current funded debt from BS rows (detected_historical_bs, current_funded)", () => {
    const bs: Row[] = [
      {
        id: "st_debt",
        label: "Short-Term Debt",
        kind: "input",
        valueType: "currency",
        values: { [LAST_HIST]: 12_000 },
      },
      {
        id: "lt_debt",
        label: "Long-Term Debt",
        kind: "input",
        valueType: "currency",
        values: { [LAST_HIST]: 90_000 },
      },
    ];
    const tranche = makeTranche({
      openingBalanceSource: "detected_historical_bs",
      openingDebtBucket: "current_funded",
    });
    expect(resolveTrancheOpeningBalance(tranche, LAST_HIST, bs)).toBeCloseTo(12_000, 1);
  });

  it("reads long-term funded debt from BS rows (detected_historical_bs, long_term_funded)", () => {
    const bs: Row[] = [
      {
        id: "st_debt",
        label: "Short-Term Debt",
        kind: "input",
        valueType: "currency",
        values: { [LAST_HIST]: 12_000 },
      },
      {
        id: "lt_debt",
        label: "Long-Term Debt",
        kind: "input",
        valueType: "currency",
        values: { [LAST_HIST]: 90_000 },
      },
    ];
    const tranche = makeTranche({
      openingBalanceSource: "detected_historical_bs",
      openingDebtBucket: "long_term_funded",
    });
    expect(resolveTrancheOpeningBalance(tranche, LAST_HIST, bs)).toBeCloseTo(90_000, 1);
  });

  it("returns null when lastHistoricYear is null and source is detected", () => {
    const tranche = makeTranche({
      openingBalanceSource: "detected_historical_bs",
      openingDebtBucket: "current_funded",
    });
    expect(resolveTrancheOpeningBalance(tranche, null, EMPTY_BS)).toBeNull();
  });
});
