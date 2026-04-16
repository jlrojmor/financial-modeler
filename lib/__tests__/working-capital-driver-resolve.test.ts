/**
 * WC driver key resolution (bare BS id vs cfo_* store keys).
 */

import { describe, it, expect } from "vitest";
import {
  computeWcProjectedBalance,
  resolveWcDriverStoreKey,
  type WcDriverState,
} from "@/lib/working-capital-schedule";

function baseState(patch: Partial<WcDriverState>): WcDriverState {
  return {
    wcDriverTypeByItemId: {},
    wcDaysByItemId: {},
    wcDaysByItemIdByYear: {},
    wcDaysBaseByItemId: {},
    wcPctBaseByItemId: {},
    wcPctByItemId: {},
    wcPctByItemIdByYear: {},
    ...patch,
  };
}

describe("resolveWcDriverStoreKey", () => {
  it("returns cfo_ar when drivers are stored under CFS-style id", () => {
    const s = baseState({
      wcDriverTypeByItemId: { cfo_ar: "days" },
      wcDaysByItemId: { cfo_ar: 4.2 },
      wcDaysBaseByItemId: { cfo_ar: "revenue" },
    });
    expect(resolveWcDriverStoreKey(s, "ar")).toBe("cfo_ar");
  });

  it("returns bare id when present", () => {
    const s = baseState({
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 5 },
    });
    expect(resolveWcDriverStoreKey(s, "ar")).toBe("ar");
  });
});

describe("computeWcProjectedBalance with aliased driver keys", () => {
  it("uses days driver on cfo_ar when itemId is bare ar", () => {
    const s = baseState({
      wcDriverTypeByItemId: { cfo_ar: "days" },
      wcDaysByItemId: { cfo_ar: 365 },
      wcDaysBaseByItemId: { cfo_ar: "revenue" },
    });
    const rev = 1_000_000;
    const v = computeWcProjectedBalance("ar", "2026E", s, { "2026E": rev }, { "2026E": 500_000 });
    expect(v).toBeCloseTo(rev, 4);
  });

  it("resolves rev year via pickNumeric when year suffix differs", () => {
    const s = baseState({
      wcDriverTypeByItemId: { cfo_inventory: "days" },
      wcDaysByItemId: { cfo_inventory: 180 },
      wcDaysBaseByItemId: { cfo_inventory: "cogs" },
    });
    const cogs = 600_000;
    const v = computeWcProjectedBalance("inventory", "2026E", s, { "2026": 1 }, { "2026": cogs, "2026E": cogs });
    expect(v).toBeGreaterThan(0);
  });
});
