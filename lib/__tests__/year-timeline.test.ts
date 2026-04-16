import { describe, it, expect } from "vitest";
import type { Row } from "@/types/finance";
import {
  collectYearKeysFromRowTree,
  resolvePriorYear,
  compareYearLabels,
  buildModelYearTimeline,
  pickNumericRecordForYear,
  resolveTimelineYearKey,
  yearIsHistoricalForWc,
} from "@/lib/year-timeline";

describe("year-timeline", () => {
  it("resolvePriorYear finds predecessor when first BS row has sparse keys", () => {
    const balanceSheet: Row[] = [
      { id: "cash", label: "Cash", kind: "input", valueType: "currency", values: { "2026": 50 }, children: [] },
      {
        id: "ar",
        label: "AR",
        kind: "input",
        valueType: "currency",
        values: { "2025": 120_173, "2026": 290_767 },
        children: [],
      },
    ];
    const keys = collectYearKeysFromRowTree(balanceSheet);
    expect(keys.sort(compareYearLabels)).toContain("2025");
    expect(keys.sort(compareYearLabels)).toContain("2026");
    expect(resolvePriorYear("2026", keys)).toBe("2025");
  });

  it("pickNumericRecordForYear matches base year when map omits A/E suffix", () => {
    const map = { "2026": 42, "2025A": -10 };
    expect(pickNumericRecordForYear(map, "2026E")).toBe(42);
    expect(pickNumericRecordForYear(map, "2025A")).toBe(-10);
  });

  it("resolveTimelineYearKey maps projection label to timeline when suffix differs", () => {
    const tl = ["2024A", "2025A", "2026E"];
    expect(resolveTimelineYearKey("2026", tl)).toBe("2026E");
    expect(resolveTimelineYearKey("2026E", tl)).toBe("2026E");
    expect(resolveTimelineYearKey("2031", tl)).toBeNull();
  });

  it("yearIsHistoricalForWc matches meta historical by base year", () => {
    const H = ["2024A", "2025A"];
    const P = ["2026E"];
    expect(yearIsHistoricalForWc("2024", H, P)).toBe(true);
    expect(yearIsHistoricalForWc("2025A", H, P)).toBe(true);
    expect(yearIsHistoricalForWc("2026E", H, P)).toBe(false);
  });

  it("yearIsHistoricalForWc treats years before first projection as historical", () => {
    const H = ["2025A"];
    const P = ["2026E"];
    expect(yearIsHistoricalForWc("2023A", H, P)).toBe(true);
    expect(yearIsHistoricalForWc("2026E", H, P)).toBe(false);
  });

  it("buildModelYearTimeline falls back to income statement when BS has no keys", () => {
    const allStatements = {
      balanceSheet: [] as Row[],
      incomeStatement: [
        {
          id: "rev",
          label: "Rev",
          kind: "input",
          valueType: "currency",
          values: { "2024": 1, "2025": 2 },
          children: [],
        },
      ] as Row[],
      cashFlow: [] as Row[],
    };
    const t = buildModelYearTimeline(allStatements);
    expect(t).toEqual(["2024", "2025"]);
  });
});
