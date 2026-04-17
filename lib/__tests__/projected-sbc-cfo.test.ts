import { describe, it, expect } from "vitest";
import { computeProjectedSbcCfoByYear } from "@/lib/projected-sbc-cfo";
import type { Row } from "@/types/finance";

describe("computeProjectedSbcCfoByYear", () => {
  it("returns empty when equity roll-forward is not confirmed", () => {
    const out = computeProjectedSbcCfoByYear({
      equityRollforwardConfirmed: false,
      projectionYears: ["2026E"],
      equitySbcMethod: "pct_revenue",
      equitySbcPctRevenue: 0.9,
      equityManualSbcByYear: {},
      revByYear: { "2026E": 1_000_000 },
      sbcBreakdowns: {},
      incomeStatement: [],
      cashFlow: [],
    });
    expect(out).toEqual({});
  });

  it("pct_revenue: matches rev × pct / 100 for each projection year", () => {
    const out = computeProjectedSbcCfoByYear({
      equityRollforwardConfirmed: true,
      projectionYears: ["2026E", "2027E"],
      equitySbcMethod: "pct_revenue",
      equitySbcPctRevenue: 0.9,
      equityManualSbcByYear: {},
      revByYear: { "2026E": 10_000_000, "2027E": 20_000_000 },
      sbcBreakdowns: {},
      incomeStatement: [],
      cashFlow: [],
    });
    expect(out["2026E"]).toBeCloseTo(90_000, 5);
    expect(out["2027E"]).toBeCloseTo(180_000, 5);
  });

  it("manual_by_year: uses non-negative manual map", () => {
    const out = computeProjectedSbcCfoByYear({
      equityRollforwardConfirmed: true,
      projectionYears: ["2026E"],
      equitySbcMethod: "manual_by_year",
      equitySbcPctRevenue: 0,
      equityManualSbcByYear: { "2026E": 123_456 },
      revByYear: {},
      sbcBreakdowns: {},
      incomeStatement: [],
      cashFlow: [],
    });
    expect(out["2026E"]).toBe(123_456);
  });

  it("flat_hist: repeats last historical SBC from IS opex_sbc", () => {
    const incomeStatement: Row[] = [
      {
        id: "sbc_is",
        label: "SBC",
        kind: "input",
        valueType: "currency",
        values: { "2024A": -50_000, "2025A": -90_011 },
        taxonomyType: "opex_sbc",
        children: [],
      },
    ];
    const out = computeProjectedSbcCfoByYear({
      equityRollforwardConfirmed: true,
      projectionYears: ["2026E"],
      equitySbcMethod: "flat_hist",
      equitySbcPctRevenue: 0,
      equityManualSbcByYear: {},
      revByYear: {},
      sbcBreakdowns: {},
      incomeStatement,
      cashFlow: [],
    });
    expect(out["2026E"]).toBe(90_011);
  });

  it("auto: sums sbcBreakdown buckets per year", () => {
    const out = computeProjectedSbcCfoByYear({
      equityRollforwardConfirmed: true,
      projectionYears: ["2026E"],
      equitySbcMethod: "auto",
      equitySbcPctRevenue: 0,
      equityManualSbcByYear: {},
      revByYear: {},
      sbcBreakdowns: {
        a: { "2026E": 10_000 },
        b: { "2026E": -5_000 },
      },
      incomeStatement: [],
      cashFlow: [],
    });
    expect(out["2026E"]).toBe(15_000);
  });
});
