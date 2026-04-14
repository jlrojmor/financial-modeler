/**
 * Unit tests for applyStraightLineMandatoriesOnTranche.
 *
 * This function is called at Apply-time to fill in mandatoryRepaymentByYear
 * from the chosen amortization method. It is pure (no React, no Zustand).
 *
 * UX RISK NOTE (not a code bug):
 *   When applyCurrentPortionSingleTranche() creates a tranche, maturityYear defaults to the
 *   last projection year (e.g. 2030E). If the user immediately clicks Apply WITHOUT
 *   toggling "Ends beyond forecast period," the within-forecast path is used and the
 *   annual payment = opening / 5 (forecast years) instead of opening / 10 (actual term).
 *   The UI shows "Estimated annual principal repayment" before Apply, so the user can
 *   verify — but they must set "beyond forecast" + termYears explicitly for a 10-year loan.
 */

import { describe, it, expect } from "vitest";
import { applyStraightLineMandatoriesOnTranche } from "@/lib/debt-schedule-apply";
import type { DebtTrancheConfigV1 } from "@/types/debt-schedule-v1";
import type { Row } from "@/types/finance";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROJ_YEARS = ["2026E", "2027E", "2028E", "2029E", "2030E"];
const EMPTY_BS: Row[] = [];

function emptyYearMap(years: string[], value = 0): Record<string, number> {
  return Object.fromEntries(years.map((y) => [y, value]));
}

function makeTranche(
  overrides: Partial<DebtTrancheConfigV1>
): DebtTrancheConfigV1 {
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
    fixedInterestRatePct: 6,
    interestComputationBasis: "average_balance",
    drawsByYear: emptyYearMap(PROJ_YEARS),
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS),
    optionalRepaymentByYear: emptyYearMap(PROJ_YEARS),
    interestRateByYear: emptyYearMap(PROJ_YEARS),
    ...overrides,
  };
}

// ─── Case 1: Beyond-forecast straight-line ────────────────────────────────────

describe("Case 1: straight_line + beyondForecastTermYears=10", () => {
  // UX scenario: user picks "beyond forecast period", 10 years, repayment starts 2026E.
  // Annual = 102,000 / 10 = 10,200 for every projection year (all 5 are within the 10-year window).
  const tranche = makeTranche({
    openingBalanceManual: 102_000,
    amortizationMethod: "straight_line",
    repaymentStartYear: "2026E",
    maturityYear: "2035E",
  });

  const result = applyStraightLineMandatoriesOnTranche(tranche, PROJ_YEARS, null, EMPTY_BS, {
    beyondForecastTermYears: 10,
  });

  it("annual repayment = 10,200 (102,000 ÷ 10 years)", () => {
    for (const y of PROJ_YEARS) {
      expect(result.mandatoryRepaymentByYear[y]).toBeCloseTo(10_200, 1);
    }
  });

  it("returns a new tranche object (immutable)", () => {
    expect(result).not.toBe(tranche);
    expect(result.mandatoryRepaymentByYear).not.toBe(tranche.mandatoryRepaymentByYear);
  });

  it("opening repayment start year works correctly (all forecast years k>=0)", () => {
    // 2026E: k = 2026 - 2026 = 0 → in range [0, 10) → 10200
    // 2030E: k = 2030 - 2026 = 4 → in range → 10200
    expect(result.mandatoryRepaymentByYear["2026E"]).toBeCloseTo(10_200, 1);
    expect(result.mandatoryRepaymentByYear["2030E"]).toBeCloseTo(10_200, 1);
  });

  it("years before repaymentStartYear get 0 (test with start=2028E)", () => {
    const late = makeTranche({
      openingBalanceManual: 60_000,
      amortizationMethod: "straight_line",
      repaymentStartYear: "2028E",
    });
    const r = applyStraightLineMandatoriesOnTranche(late, PROJ_YEARS, null, EMPTY_BS, {
      beyondForecastTermYears: 6,
    });
    // 2026E: k = 2026 - 2028 = -2 → out of range → 0
    // 2027E: k = 2027 - 2028 = -1 → out of range → 0
    // 2028E: k = 0 → in range → 10,000 (60,000/6)
    expect(r.mandatoryRepaymentByYear["2026E"]).toBe(0);
    expect(r.mandatoryRepaymentByYear["2027E"]).toBe(0);
    expect(r.mandatoryRepaymentByYear["2028E"]).toBeCloseTo(10_000, 1);
    expect(r.mandatoryRepaymentByYear["2029E"]).toBeCloseTo(10_000, 1);
    expect(r.mandatoryRepaymentByYear["2030E"]).toBeCloseTo(10_000, 1);
  });
});

// ─── Case 2: Within-forecast straight-line ────────────────────────────────────

describe("Case 2: straight_line within-forecast, maturityYear=2028E (3 repayment years)", () => {
  // UX scenario: user picks "within forecast", maturity = 2028E.
  // Annual = 102,000 / 3 = 34,000 for 2026E–2028E. Years 2029E, 2030E = 0.
  const tranche = makeTranche({
    openingBalanceManual: 102_000,
    amortizationMethod: "straight_line",
    repaymentStartYear: "2026E",
    maturityYear: "2028E",
  });

  const result = applyStraightLineMandatoriesOnTranche(tranche, PROJ_YEARS, null, EMPTY_BS);

  it("annual repayment = 34,000 for years in range", () => {
    expect(result.mandatoryRepaymentByYear["2026E"]).toBeCloseTo(34_000, 1);
    expect(result.mandatoryRepaymentByYear["2027E"]).toBeCloseTo(34_000, 1);
    expect(result.mandatoryRepaymentByYear["2028E"]).toBeCloseTo(34_000, 1);
  });

  it("years beyond maturityYear get 0", () => {
    expect(result.mandatoryRepaymentByYear["2029E"]).toBe(0);
    expect(result.mandatoryRepaymentByYear["2030E"]).toBe(0);
  });

  it("total repayment across range = opening balance", () => {
    const total =
      result.mandatoryRepaymentByYear["2026E"]! +
      result.mandatoryRepaymentByYear["2027E"]! +
      result.mandatoryRepaymentByYear["2028E"]!;
    expect(total).toBeCloseTo(102_000, 1);
  });
});

// ─── Case 3: amortizationMethod = "none" ─────────────────────────────────────

describe('Case 3: amortizationMethod="none" — zeros every year (LOC behavior)', () => {
  const tranche = makeTranche({
    openingBalanceManual: 12_000,
    amortizationMethod: "none",
    repaymentStartYear: "2026E",
    maturityYear: "2030E",
    mandatoryRepaymentByYear: emptyYearMap(PROJ_YEARS, 999), // any prior non-zero value
  });

  const result = applyStraightLineMandatoriesOnTranche(tranche, PROJ_YEARS, null, EMPTY_BS);

  it("all projection years get 0 mandatory repayment", () => {
    for (const y of PROJ_YEARS) {
      expect(result.mandatoryRepaymentByYear[y]).toBe(0);
    }
  });

  it("returns a new tranche object", () => {
    expect(result).not.toBe(tranche);
  });
});

// ─── Case 4: amortizationMethod = "manual_by_year" ───────────────────────────

describe('Case 4: amortizationMethod="manual_by_year" — tranche returned unchanged', () => {
  const existingRepayments: Record<string, number> = {
    "2026E": 5_000,
    "2027E": 8_000,
    "2028E": 12_000,
    "2029E": 15_000,
    "2030E": 62_000,
  };
  const tranche = makeTranche({
    openingBalanceManual: 102_000,
    amortizationMethod: "manual_by_year",
    mandatoryRepaymentByYear: existingRepayments,
    repaymentStartYear: "2026E",
    maturityYear: "2030E",
  });

  const result = applyStraightLineMandatoriesOnTranche(tranche, PROJ_YEARS, null, EMPTY_BS);

  it("returns the original tranche object (no mutation, no clone for manual mode)", () => {
    expect(result).toBe(tranche);
  });

  it("existing repayments are preserved", () => {
    expect(result.mandatoryRepaymentByYear["2026E"]).toBe(5_000);
    expect(result.mandatoryRepaymentByYear["2028E"]).toBe(12_000);
    expect(result.mandatoryRepaymentByYear["2030E"]).toBe(62_000);
  });
});

// ─── Edge: missing repaymentStartYear ────────────────────────────────────────

describe("Edge: straight_line without repaymentStartYear — returns tranche unchanged", () => {
  const tranche = makeTranche({
    openingBalanceManual: 50_000,
    amortizationMethod: "straight_line",
    repaymentStartYear: undefined,
    maturityYear: "2030E",
  });

  const result = applyStraightLineMandatoriesOnTranche(tranche, PROJ_YEARS, null, EMPTY_BS);

  it("returns original tranche when repaymentStartYear is missing", () => {
    expect(result).toBe(tranche);
  });
});

// ─── Edge: zero opening balance ──────────────────────────────────────────────

describe("Edge: straight_line with zero opening balance — returns tranche unchanged", () => {
  const tranche = makeTranche({
    openingBalanceManual: 0,
    amortizationMethod: "straight_line",
    repaymentStartYear: "2026E",
    maturityYear: "2030E",
  });

  const result = applyStraightLineMandatoriesOnTranche(tranche, PROJ_YEARS, null, EMPTY_BS);

  it("returns original tranche when opening is 0", () => {
    expect(result).toBe(tranche);
  });
});
