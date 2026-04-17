import { describe, it, expect } from "vitest";
import { getWcScheduleVsCfsParity } from "@/lib/wc-schedule-cfs-parity";
import { createBalanceSheetTemplate } from "@/lib/statement-templates";
import type { Row } from "@/types/finance";

describe("getWcScheduleVsCfsParity", () => {
  it("reports missing schedule rows when CFS omits a WC line", () => {
    const balanceSheet = createBalanceSheetTemplate().map((r) =>
      r.id === "inventory" ? { ...r, cashFlowBehavior: "working_capital" as const } : r
    );
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "WC",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          { id: "cfo_ar", label: "AR", kind: "calc", valueType: "currency", values: {}, children: [] },
        ],
      },
    ];
    const p = getWcScheduleVsCfsParity(cashFlow, balanceSheet);
    expect(p.missingInCfs).toContain("inventory");
    expect(p.missingInCfsLabels.some((l) => /inventory/i.test(l))).toBe(true);
  });

  it("reports extra CFS children when canonical is not on the WC schedule", () => {
    const balanceSheet = createBalanceSheetTemplate().map((r) =>
      r.cashFlowBehavior === "working_capital" ? { ...r, cashFlowBehavior: "non_cash" as const } : r
    );
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "WC",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          { id: "cfo_orphan_line", label: "Orphan", kind: "calc", valueType: "currency", values: {}, children: [] },
        ],
      },
    ];
    const p = getWcScheduleVsCfsParity(cashFlow, balanceSheet);
    expect(p.scheduleItemIds.length).toBe(0);
    expect(p.extraInCfs).toContain("cfo_orphan_line");
  });

  it("does not report missing when preview bridge has cfo_<scheduleId> even if no CFS child maps", () => {
    const balanceSheet = createBalanceSheetTemplate().map((r) =>
      r.id === "inventory" ? { ...r, cashFlowBehavior: "working_capital" as const } : r
    );
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "WC",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          { id: "cfo_ar", label: "AR", kind: "calc", valueType: "currency", values: {}, children: [] },
        ],
      },
    ];
    const bridge = { cfo_inventory: {} as Record<string, number> };
    const p = getWcScheduleVsCfsParity(cashFlow, balanceSheet, bridge);
    expect(p.missingInCfs).not.toContain("inventory");
  });
});
