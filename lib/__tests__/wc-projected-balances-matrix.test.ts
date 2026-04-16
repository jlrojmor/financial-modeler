/**
 * Shared WC balance matrix (Forecast Drivers + Projected Statements CFS bridge).
 */

import { describe, it, expect } from "vitest";
import { computeRowValue } from "@/lib/calculations";
import { computeWcCfsPreviewCashEffects } from "@/lib/projected-wc-cfs-bridge";
import { findRowInTree } from "@/lib/row-utils";
import { buildWcProjectedBalancesMatrix } from "@/lib/working-capital-schedule";
import type { WcDriverState } from "@/lib/working-capital-schedule";
import { createBalanceSheetTemplate } from "@/lib/statement-templates";
import type { Row } from "@/types/finance";

const HIST = ["2024", "2025"];
const PROJ = ["2026E"];
const ALL = [...HIST, ...PROJ];

function bsWithArValues(arHist: Record<string, number>): Row[] {
  return createBalanceSheetTemplate().map((r) =>
    r.id === "ar" ? { ...r, values: { ...arHist } } : r
  );
}

describe("buildWcProjectedBalancesMatrix", () => {
  it("projects AR from days × revenue when rev map is populated for projection year", () => {
    const balanceSheet = bsWithArValues({ "2024": 100, "2025": 120 });
    const wcItems = [{ id: "ar", label: "AR", side: "asset" as const }];
    const driverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const revByYear = { "2024": 1e6, "2025": 1.1e6, "2026E": 2_000_000 };
    const { projectedBalances } = buildWcProjectedBalancesMatrix({
      wcItems,
      balanceSheet,
      years: ALL,
      historicalYears: HIST,
      projectionYears: PROJ,
      driverState,
      revByYear,
      cogsByYear: {},
      unionBsValueKeys: true,
    });
    expect(projectedBalances.ar?.["2026E"]).toBe(2_000_000);
  });
});

describe("nested rev + bridge CFS", () => {
  it("non-zero cfo_ar for projection when rev is only under nested IS (findRowInTree path)", () => {
    const incomeStatement: Row[] = [
      {
        id: "wrapper",
        label: "Wrapper",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "rev",
            label: "Revenue",
            kind: "calc",
            valueType: "currency",
            values: { "2024": 1_000_000, "2025": 1_100_000, "2026E": 5_000_000 },
            children: [],
          },
        ],
      },
    ];
    expect(incomeStatement.find((r) => r.id === "rev")).toBeUndefined();
    const revRow = findRowInTree(incomeStatement, "rev");
    expect(revRow).toBeDefined();
    const allStatements = { incomeStatement, balanceSheet: [] as Row[], cashFlow: [] as Row[] };
    const histRevByYear: Record<string, number> = {};
    for (const y of HIST) {
      histRevByYear[y] = computeRowValue(revRow!, y, incomeStatement, incomeStatement, allStatements);
    }
    const revByYear = { ...histRevByYear, "2026E": 5_000_000 };

    const balanceSheet = bsWithArValues({ "2024": 124_769, "2025": 120_173 });
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "Accounts receivable",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: PROJ,
      allChronologicalYears: ALL,
      historicalYears: HIST,
      wcDriverState,
      revByYear,
      cogsByYear: { "2024": 1, "2025": 1, "2026E": 1 },
    });
    expect(out.cfo_ar?.["2026E"]).toBeDefined();
    expect(out.cfo_ar?.["2026E"]).not.toBe(0);
    const prev = 120_173;
    const curr = 5_000_000;
    expect(out.cfo_ar?.["2026E"]).toBe(-(curr - prev));
  });
});
