import { describe, it, expect } from "vitest";
import { isCfsComputedRollupRowId } from "@/lib/cfs-structural-row-ids";

describe("isCfsComputedRollupRowId", () => {
  it("is true for engine rollup ids", () => {
    expect(isCfsComputedRollupRowId("operating_cf")).toBe(true);
    expect(isCfsComputedRollupRowId("net_change_cash")).toBe(true);
    expect(isCfsComputedRollupRowId("total_operating_cf")).toBe(true);
  });

  it("is false for disclosure or bridge lines", () => {
    expect(isCfsComputedRollupRowId("net_income")).toBe(false);
    expect(isCfsComputedRollupRowId("issuer_disclosure_misc")).toBe(false);
  });
});
