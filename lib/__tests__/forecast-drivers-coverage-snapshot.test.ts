import { describe, it, expect } from "vitest";
import {
  buildForecastDriversCoverageSnapshotFromModel,
  compareCfsLineToCoverage,
} from "@/lib/forecast-drivers-coverage-snapshot";
import type { Row } from "@/types/finance";
import type { ModelMeta } from "@/store/useModelStore";
import { defaultDebtSchedulePhase2Persist } from "@/lib/debt-schedule-persist";

const meta: ModelMeta = {
  companyName: "T",
  companyType: "public",
  currency: "USD",
  currencyUnit: "millions",
  modelType: "dcf",
  years: { historical: ["2023"], projection: ["2024"] },
};

describe("buildForecastDriversCoverageSnapshotFromModel", () => {
  it("returns stable shape for empty statements", () => {
    const snap = buildForecastDriversCoverageSnapshotFromModel({
      incomeStatement: [],
      balanceSheet: [],
      cashFlow: [],
      revenueForecastTreeV1: [],
      wcDriversConfirmed: true,
      dandaScheduleConfirmed: false,
      equityRollforwardConfirmed: false,
      otherBsConfirmed: false,
      taxScheduleConfirmed: false,
      debtSchedulePhase2Persist: defaultDebtSchedulePhase2Persist(),
      meta,
    });
    expect(snap.incomeStatementRowIds).toEqual([]);
    expect(snap.flags.wcDriversConfirmed).toBe(true);
  });
});

describe("compareCfsLineToCoverage", () => {
  it("flags cf_disclosure_only with a gap", () => {
    const row: Row = {
      id: "cf_extra",
      label: "Extra disclosure",
      kind: "input",
      valueType: "currency",
      values: {},
    };
    const snap = buildForecastDriversCoverageSnapshotFromModel({
      incomeStatement: [],
      balanceSheet: [],
      cashFlow: [row],
      revenueForecastTreeV1: [],
      wcDriversConfirmed: false,
      dandaScheduleConfirmed: false,
      equityRollforwardConfirmed: false,
      otherBsConfirmed: false,
      taxScheduleConfirmed: false,
      debtSchedulePhase2Persist: defaultDebtSchedulePhase2Persist(),
      meta,
    });
    const cmp = compareCfsLineToCoverage(row, snap, [], []);
    expect(cmp.cfsRowId).toBe("cf_extra");
    expect(cmp.gaps.length).toBeGreaterThan(0);
  });
});
