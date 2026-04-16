/**
 * CFS cfo_* lines must show balance changes, not ending balances, when BS row[0] is sparse.
 */

import { describe, it, expect } from "vitest";
import { computeRowValue } from "@/lib/calculations";
import type { Row } from "@/types/finance";

describe("computeRowValue cfo_* WC bridge", () => {
  it("uses prior year from union of BS keys (not balanceSheet[0] only)", () => {
    const balanceSheet: Row[] = [
      { id: "cash", label: "Cash", kind: "input", valueType: "currency", values: { "2026": 1 }, children: [] },
      {
        id: "ar",
        label: "Accounts Receivable",
        kind: "input",
        valueType: "currency",
        values: { "2025": 120_173, "2026": 290_767 },
        children: [],
      },
    ];

    const cfoAr: Row = {
      id: "cfo_ar",
      label: "Accounts receivable",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
      cfsLink: { section: "operating", impact: "negative", description: "AR" },
    };

    const cashFlow: Row[] = [
      { id: "net_income", label: "NI", kind: "calc", valueType: "currency", values: {}, children: [] },
      {
        id: "wc_change",
        label: "WC",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [cfoAr],
      },
      { id: "operating_cf", label: "CFO", kind: "calc", valueType: "currency", values: {}, children: [] },
      { id: "investing_cf", label: "CFI", kind: "calc", valueType: "currency", values: {}, children: [] },
      { id: "financing_cf", label: "CFF", kind: "calc", valueType: "currency", values: {}, children: [] },
      { id: "net_change_cash", label: "Net", kind: "calc", valueType: "currency", values: {}, children: [] },
    ];

    const allStatements = {
      incomeStatement: [] as Row[],
      balanceSheet,
      cashFlow,
    };

    const rawDelta = 290_767 - 120_173;
    const expectedCashEffect = -rawDelta;

    const v = computeRowValue(cfoAr, "2026", cashFlow, cashFlow, allStatements);
    expect(v).toBe(expectedCashEffect);
    expect(v).not.toBe(-290_767);
  });
});
