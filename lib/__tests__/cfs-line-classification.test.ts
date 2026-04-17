import { describe, it, expect } from "vitest";
import { classifyCfsLineForProjection, inventoryCfsLinesForDiagnostics } from "@/lib/cfs-line-classification";
import type { Row } from "@/types/finance";

describe("classifyCfsLineForProjection", () => {
  it("classifies template net_income as schedule (anchor)", () => {
    const row: Row = {
      id: "net_income",
      label: "NI",
      kind: "calc",
      valueType: "currency",
      values: {},
    };
    expect(classifyCfsLineForProjection(row, [])).toBe("schedule");
  });

  it("classifies cfo_* as maps_to_bs", () => {
    const row: Row = {
      id: "cfo_ar",
      label: "AR",
      kind: "input",
      valueType: "currency",
      values: {},
      cfsLink: { section: "operating", impact: "negative", description: "x" },
    };
    expect(classifyCfsLineForProjection(row, [])).toBe("maps_to_bs");
  });

  it("classifies custom issuer line under other_operating as cf_disclosure_only when no BS bridge", () => {
    const row: Row = {
      id: "gift_card_derecognition",
      label: "Derecognition of gift cards",
      kind: "input",
      valueType: "currency",
      values: {},
      historicalCfsNature: "reported_operating_other",
    };
    expect(classifyCfsLineForProjection(row, [])).toBe("cf_disclosure_only");
  });

  it("classifies CFS section totals and net change in cash as schedule, not cf_disclosure_only", () => {
    const bs: Row[] = [];
    for (const id of ["operating_cf", "investing_cf", "financing_cf", "net_change_cash", "net_cash_change"] as const) {
      const row: Row = {
        id,
        label: id,
        kind: "total",
        valueType: "currency",
        values: {},
      };
      expect(classifyCfsLineForProjection(row, bs)).toBe("schedule");
    }
  });
});

describe("inventoryCfsLinesForDiagnostics", () => {
  it("returns entries with classification and missingMetadata", () => {
    const cf: Row[] = [
      {
        id: "net_income",
        label: "NI",
        kind: "calc",
        valueType: "currency",
        values: {},
      },
      {
        id: "custom_cf",
        label: "Custom",
        kind: "input",
        valueType: "currency",
        values: {},
      },
    ];
    const inv = inventoryCfsLinesForDiagnostics(cf, []);
    expect(inv.find((x) => x.id === "net_income")?.classification).toBe("schedule");
    expect(inv.find((x) => x.id === "custom_cf")?.classification).toBe("cf_disclosure_only");
    expect(inv.find((x) => x.id === "custom_cf")?.missingMetadata.length).toBeGreaterThan(0);
  });
});
