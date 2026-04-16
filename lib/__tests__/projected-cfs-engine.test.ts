/**
 * Unit tests for projected CFS engine (pre-sweep indirect method).
 */

import { describe, it, expect } from "vitest";
import {
  applyEndingCashToBalanceSheet,
  applyProjectedCfsToCashFlowRows,
  computeProjectedCashFlow,
} from "@/lib/projected-cfs-engine";
import type { DebtScheduleEngineResultV1 } from "@/lib/debt-schedule-engine";
import type { EquityRollforwardResult } from "@/lib/equity-rollforward-engine";
import type { Row } from "@/types/finance";

const PROJ = ["2026E", "2027E"];
const LAST_HIST = "2025A";

function emptyEquityStub(years: string[]): EquityRollforwardResult {
  const z = Object.fromEntries(years.map((y) => [y, 0]));
  return {
    commonStockByYear: { ...z },
    apicByYear: { ...z },
    treasuryStockByYear: { ...z },
    retainedEarningsByYear: { ...z },
    dividendsByYear: { ...z },
    buybacksByYear: { ...z },
    reissuedByYear: { ...z },
    issuancesByYear: { ...z },
    sbcImpactByYear: { ...z },
    optionProceedsByYear: { ...z },
    esppByYear: { ...z },
    cffDividendsByYear: { ...z },
    cffBuybacksByYear: { ...z },
    cffIssuancesByYear: { ...z },
  };
}

function debtTotals(
  years: string[],
  spec: Record<
    string,
    { draws: number; mand: number; opt: number; int: number }
  >
): DebtScheduleEngineResultV1 {
  const totalsByYear: DebtScheduleEngineResultV1["totalsByYear"] = {};
  const interestExpenseTotalByYear: Record<string, number | null> = {};
  for (const y of years) {
    const s = spec[y];
    if (!s) continue;
    totalsByYear[y] = {
      totalOpeningDebt: 0,
      totalNewBorrowingDraws: s.draws,
      totalMandatoryRepayment: s.mand,
      totalOptionalRepayment: s.opt,
      totalEndingDebt: 0,
      totalInterestExpense: s.int,
      totalDebtService: s.mand + s.opt + s.int,
    };
    interestExpenseTotalByYear[y] = s.int;
  }
  return {
    isComplete: true,
    perTrancheByYear: {},
    totalsByYear,
    interestExpenseTotalByYear,
  };
}

describe("computeProjectedCashFlow", () => {
  it("satisfies beginning + CFO + CFI + CFF + FX = ending cash each year", () => {
    const incomeStatement: Row[] = [
      {
        id: "net_income",
        label: "Net Income",
        kind: "calc",
        valueType: "currency",
        values: { [LAST_HIST]: 90, "2026E": 100, "2027E": 110 },
        children: [],
      },
      {
        id: "da",
        label: "D&A",
        kind: "input",
        valueType: "currency",
        values: { "2026E": 20, "2027E": 22 },
        children: [],
        taxonomyType: "opex_danda",
      },
      {
        id: "sbc_is",
        label: "SBC",
        kind: "input",
        valueType: "currency",
        values: { "2026E": 5, "2027E": 6 },
        children: [],
        taxonomyType: "opex_sbc",
      },
    ];

    const balanceSheet: Row[] = [
      {
        id: "cash",
        label: "Cash",
        kind: "input",
        valueType: "currency",
        values: { [LAST_HIST]: 1000 },
        children: [],
        taxonomyType: "asset_cash",
      },
    ];

    const equity: EquityRollforwardResult = {
      ...emptyEquityStub(PROJ),
      cffDividendsByYear: { "2026E": -20, "2027E": -22 },
      cffBuybacksByYear: { "2026E": -10, "2027E": -11 },
      cffIssuancesByYear: { "2026E": 5, "2027E": 5 },
    };

    const debt = debtTotals(PROJ, {
      "2026E": { draws: 50, mand: 10, opt: 5, int: 3 },
      "2027E": { draws: 0, mand: 8, opt: 2, int: 3 },
    });

    const r = computeProjectedCashFlow({
      projectionYears: PROJ,
      lastHistoricalYear: LAST_HIST,
      balanceSheet,
      incomeStatement,
      totalCapexByYear: { "2026E": 10, "2027E": 12 },
      debtScheduleResult: debt,
      equityRollforwardResult: equity,
      fxEffectByYear: { "2026E": 0, "2027E": 0 },
    });

    for (const y of PROJ) {
      const b = r.byYear[y]!;
      expect(b.beginningCash + b.cfo + b.cfi + b.cff + b.fxEffect).toBeCloseTo(b.endingCash, 5);
      expect(b.capex).toBeLessThan(0);
      expect(b.cashInterestPaid).toBeLessThanOrEqual(0);
    }

    expect(r.byYear["2026E"]!.cfo).toBeCloseTo(100 + 20 + 5, 5);
    expect(r.endingCashByYear["2026E"]).toBeCloseTo(r.byYear["2026E"]!.endingCash, 5);
  });

  it("applyProjectedCfsToCashFlowRows merges projection years only", () => {
    const cfs: Row[] = [
      {
        id: "capex",
        label: "CapEx",
        kind: "input",
        valueType: "currency",
        values: { [LAST_HIST]: -5 },
        children: [],
      },
    ];
    const merged = applyProjectedCfsToCashFlowRows(cfs, {
      capex: { "2026E": -99 },
    });
    expect(merged[0]!.values![LAST_HIST]).toBe(-5);
    expect(merged[0]!.values!["2026E"]).toBe(-99);
  });

  it("applyEndingCashToBalanceSheet writes cash for projection years", () => {
    const bs: Row[] = [
      {
        id: "cash",
        label: "Cash",
        kind: "input",
        valueType: "currency",
        values: { [LAST_HIST]: 50 },
        children: [],
        taxonomyType: "asset_cash",
      },
    ];
    const out = applyEndingCashToBalanceSheet(bs, { "2026E": 123 }, ["2026E"]);
    expect(out[0]!.values![LAST_HIST]).toBe(50);
    expect(out[0]!.values!["2026E"]).toBe(123);
  });
});
