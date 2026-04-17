/**
 * Regression: projected BS totals satisfy A ≈ L + E when line items are consistent.
 */

import { describe, it, expect } from "vitest";
import { checkBalanceSheetBalance } from "@/lib/calculations";
import type { Row } from "@/types/finance";

function minimalBalancedBs(): Row[] {
  return [
    {
      id: "current_assets",
      label: "Current assets",
      kind: "input",
      valueType: "currency",
      children: [
        {
          id: "cash",
          label: "Cash",
          kind: "input",
          valueType: "currency",
          values: { "2026E": 50 },
        },
        {
          id: "total_current_assets",
          label: "TCA",
          kind: "total",
          valueType: "currency",
          values: { "2026E": 50 },
        },
      ],
    },
    {
      id: "total_assets",
      label: "TA",
      kind: "total",
      valueType: "currency",
      values: { "2026E": 50 },
    },
    {
      id: "current_liabilities",
      label: "CL",
      kind: "input",
      valueType: "currency",
      children: [
        {
          id: "ap",
          label: "AP",
          kind: "input",
          valueType: "currency",
          values: { "2026E": 20 },
        },
        {
          id: "total_current_liabilities",
          label: "TCL",
          kind: "total",
          valueType: "currency",
          values: { "2026E": 20 },
        },
      ],
    },
    {
      id: "total_liabilities",
      label: "TL",
      kind: "total",
      valueType: "currency",
      values: { "2026E": 20 },
    },
    {
      id: "equity",
      label: "Equity",
      kind: "input",
      valueType: "currency",
      children: [
        {
          id: "re",
          label: "RE",
          kind: "input",
          valueType: "currency",
          values: { "2026E": 30 },
        },
        {
          id: "total_equity",
          label: "TE",
          kind: "total",
          valueType: "currency",
          values: { "2026E": 30 },
        },
      ],
    },
    {
      id: "total_liab_and_equity",
      label: "TLE",
      kind: "total",
      valueType: "currency",
      values: { "2026E": 50 },
    },
  ];
}

describe("checkBalanceSheetBalance (projected statements gate)", () => {
  it("reports balanced when total_assets equals total_liab_and_equity for projection year", () => {
    const rows = minimalBalancedBs();
    const out = checkBalanceSheetBalance(rows, ["2026E"]);
    expect(out).toHaveLength(1);
    expect(out[0].balances).toBe(true);
    expect(out[0].difference).toBe(0);
  });
});
