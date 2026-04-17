import { describe, it, expect } from "vitest";
import { computeRowValue } from "@/lib/calculations";
import { findRowInTree } from "@/lib/row-utils";
import type { Row } from "@/types/finance";

function flattenRows(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) out.push(...flattenRows(r.children));
  }
  return out;
}

describe("computeRowValue — CFS other operating BS-linked input (projection)", () => {
  it("uses balance sheet year-over-year delta with cfsLink impact for a non-cfo_ operating line", () => {
    const giftCardCfs: Row = {
      id: "gift_cards",
      label: "Gift cards",
      kind: "input",
      valueType: "currency",
      cfsLink: {
        section: "operating",
        cfsItemId: "gift_cards_liability",
        impact: "positive",
        description: "Liability bridge",
      },
      values: {},
    };

    const cashFlow: Row[] = [
      {
        id: "operating_block",
        label: "CFO",
        kind: "input",
        valueType: "currency",
        children: [
          { id: "net_income", label: "NI", kind: "calc", valueType: "currency", values: { "2025A": 1, "2026E": 1 } },
          giftCardCfs,
          { id: "operating_cf", label: "OCF", kind: "calc", valueType: "currency", values: {} },
        ],
      },
      { id: "investing_cf", label: "ICF", kind: "calc", valueType: "currency", values: {} },
      { id: "financing_cf", label: "FCF", kind: "calc", valueType: "currency", values: {} },
      { id: "net_change_cash", label: "Net", kind: "calc", valueType: "currency", values: {} },
    ];

    const balanceSheet: Row[] = [
      {
        id: "gift_cards_liability",
        label: "Gift card liability",
        kind: "input",
        valueType: "currency",
        values: { "2025A": 100, "2026E": 130 },
      },
    ];

    const allStatements = { incomeStatement: [] as Row[], balanceSheet, cashFlow };
    const flat = flattenRows(cashFlow);
    const giftRow = findRowInTree(cashFlow, "gift_cards")!;

    const v = computeRowValue(
      giftRow,
      "2026E",
      flat,
      cashFlow,
      allStatements,
      {},
      {},
      [],
      true
    );
    expect(v).toBe(30);
  });
});
