/**
 * CFS projection classification: forecasted vs disclosure-only.
 */

import { describe, it, expect } from "vitest";
import { classifyCfsLineForProjection } from "@/lib/cfs-line-classification";
import type { Row } from "@/types/finance";

const emptyBs: Row[] = [];

function row(partial: Partial<Row> & Pick<Row, "id" | "label">): Row {
  return {
    kind: "input",
    valueType: "currency",
    values: {},
    children: [],
    ...partial,
  };
}

describe("classifyCfsLineForProjection — orphan / disclosure", () => {
  it("classifies unlinked CFS row with no cfsLink as cf_disclosure_only (policy target)", () => {
    const cfs = row({
      id: "issuer_cf_disclosure_misc",
      label: "Other operating — disclosure",
      values: { "2024A": -125 },
    });
    expect(classifyCfsLineForProjection(cfs, [])).toBe("cf_disclosure_only");
  });
});

describe("classifyCfsLineForProjection — investing / financing", () => {
  it("classifies bare investing cfsLink with no driver and no BS as disclosure-only", () => {
    const cfs = row({
      id: "settlement_derivatives",
      label: "Settlement of derivatives",
      cfsLink: { section: "investing", impact: "neutral", description: "x" },
    });
    expect(classifyCfsLineForProjection(cfs, emptyBs)).toBe("cf_disclosure_only");
  });

  it("classifies investing line with debt_schedule driver as schedule", () => {
    const cfs = row({
      id: "custom_inv",
      label: "Custom",
      cfsForecastDriver: "debt_schedule",
      cfsLink: { section: "investing", impact: "neutral", description: "x" },
    });
    expect(classifyCfsLineForProjection(cfs, emptyBs)).toBe("schedule");
  });

  it("classifies investing line with resolvable cfsItemId on BS as maps_to_bs", () => {
    const bs: Row[] = [
      {
        id: "right_of_use_assets",
        label: "ROU",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      },
    ];
    const cfs = row({
      id: "rou_investing_bridge",
      label: "ROU CF",
      cfsLink: {
        section: "investing",
        cfsItemId: "right_of_use_assets",
        impact: "negative",
        description: "",
      },
    });
    expect(classifyCfsLineForProjection(cfs, bs)).toBe("maps_to_bs");
  });

  it("classifies legacy debt_issuance id as schedule without BS", () => {
    const cfs = row({
      id: "debt_issuance",
      label: "Debt issuance",
      cfsLink: { section: "financing", impact: "positive", description: "" },
    });
    expect(classifyCfsLineForProjection(cfs, emptyBs)).toBe("schedule");
  });

  it("keeps fixed anchors as schedule", () => {
    expect(classifyCfsLineForProjection(row({ id: "debt_issued", label: "Issued" }), emptyBs)).toBe(
      "schedule"
    );
    expect(classifyCfsLineForProjection(row({ id: "capex", label: "Capex" }), emptyBs)).toBe("schedule");
  });
});
