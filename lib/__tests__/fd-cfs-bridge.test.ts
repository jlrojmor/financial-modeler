import { describe, it, expect } from "vitest";
import { computeProjectedCashFlow } from "@/lib/projected-cfs-engine";
import { createCashFlowTemplate } from "@/lib/statement-templates";
import {
  computeOtherBsBridgeCashValue,
  computeOtherBsBridgeLineForYear,
  syncOtherBsBridgeRowsInCashFlow,
  syntheticOtherBsCfsId,
} from "@/lib/other-bs-cfs-bridge";
import { computeRowValue } from "@/lib/calculations";
import type { Row } from "@/types/finance";

describe("FD → CFS bridge", () => {
  it("writes additions_to_intangibles from intangible additions (negative outflow)", () => {
    const cashFlowTree = createCashFlowTemplate();
    const res = computeProjectedCashFlow({
      projectionYears: ["2026E"],
      lastHistoricalYear: null,
      balanceSheet: [],
      incomeStatement: [],
      totalCapexByYear: { "2026E": 100 },
      cashFlowTree,
      intangibleAdditionsByYear: { "2026E": 50 },
      otherBsBridgeBsIds: new Set(),
    });
    expect(res.cfsValuesByRowId.additions_to_intangibles?.["2026E"]).toBe(-50);
    expect(res.cfsValuesByRowId.capex?.["2026E"]).toBe(-100);
  });

  it("investing_cf sums capex and additions_to_intangibles when both patched", () => {
    const rows = createCashFlowTemplate().map((r) => {
      if (r.id === "capex") return { ...r, values: { "2026E": -100 } };
      if (r.id === "additions_to_intangibles") return { ...r, values: { "2026E": -40 } };
      return { ...r, values: { ...(r.values ?? {}) } };
    });
    const investingCf = rows.find((r) => r.id === "investing_cf");
    expect(investingCf).toBeDefined();
    const total = computeRowValue(investingCf!, "2026E", rows, rows, undefined, {}, {}, [], true);
    expect(total).toBe(-140);
  });

  it("computeOtherBsBridgeCashValue uses CFI asset sign", () => {
    expect(computeOtherBsBridgeCashValue("cfi", "asset_goodwill", 10)).toBe(-10);
    expect(computeOtherBsBridgeCashValue("cfo", "liab_lease_obligations", 20)).toBe(20);
    expect(computeOtherBsBridgeCashValue("cfo", "asset_other_fixed", -5)).toBe(5);
  });

  it("computeOtherBsBridgeLineForYear returns synthetic id and value", () => {
    const bs: Row[] = [
      {
        id: "gw",
        label: "Goodwill",
        kind: "input",
        valueType: "currency",
        values: { "2025A": 100, "2026E": 130 },
        taxonomyType: "asset_goodwill",
      },
    ];
    const out = computeOtherBsBridgeLineForYear(bs, "gw", "2026E", "2025A");
    expect(out?.id).toBe(syntheticOtherBsCfsId("cfi", "gw"));
    expect(out?.value).toBe(-30);
  });

  it("syncOtherBsBridgeRowsInCashFlow inserts mbc_cfi before investing_cf", () => {
    const cf = createCashFlowTemplate();
    const bs: Row[] = [
      {
        id: "gw",
        label: "Goodwill",
        kind: "input",
        valueType: "currency",
        values: {},
        taxonomyType: "asset_goodwill",
      },
    ];
    syncOtherBsBridgeRowsInCashFlow(cf, bs, true, ["gw"]);
    const invIdx = cf.findIndex((r) => r.id === "investing_cf");
    const mbcIdx = cf.findIndex((r) => r.id === "mbc_cfi_gw");
    expect(mbcIdx).toBeGreaterThanOrEqual(0);
    expect(mbcIdx).toBeLessThan(invIdx);
  });

  it("skips other BS rows in residual when bridge ids provided; explicit mbc line holds CFI cash", () => {
    const cashFlowTree = createCashFlowTemplate();
    const balanceSheet: Row[] = [
      {
        id: "gw",
        label: "Goodwill",
        kind: "input",
        valueType: "currency",
        values: { "2025A": 100, "2026E": 130 },
        taxonomyType: "asset_goodwill",
      },
    ];
    const withBridge = computeProjectedCashFlow({
      projectionYears: ["2026E"],
      lastHistoricalYear: "2025A",
      balanceSheet,
      incomeStatement: [],
      totalCapexByYear: { "2026E": 0 },
      cashFlowTree,
      otherBsBridgeBsIds: new Set(["gw"]),
    });
    const noBridge = computeProjectedCashFlow({
      projectionYears: ["2026E"],
      lastHistoricalYear: "2025A",
      balanceSheet,
      incomeStatement: [],
      totalCapexByYear: { "2026E": 0 },
      cashFlowTree: createCashFlowTemplate(),
      otherBsBridgeBsIds: new Set(),
    });
    expect(withBridge.cfsValuesByRowId.mbc_cfi_gw?.["2026E"]).toBe(-30);
    // Without bridge, goodwill Δ hits residual CFO; with bridge it moves to CFI (explicit line + engine totals).
    expect(withBridge.byYear["2026E"]!.cfo).toBe(noBridge.byYear["2026E"]!.cfo + 30);
    expect(withBridge.byYear["2026E"]!.cfi).toBe(noBridge.byYear["2026E"]!.cfi - 30);
    expect(withBridge.byYear["2026E"]!.netChangeInCash).toBe(noBridge.byYear["2026E"]!.netChangeInCash);
  });
});
