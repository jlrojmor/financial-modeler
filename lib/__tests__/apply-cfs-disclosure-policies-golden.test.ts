import { describe, it, expect } from "vitest";
import { applyCfsDisclosurePoliciesToCashFlowTree } from "@/lib/apply-cfs-disclosure-policies-to-cash-flow";
import type { Row } from "@/types/finance";

/**
 * Golden path: CF-disclosure-only row + store policy → projection-year values on cashFlow tree (export parity).
 */
describe("applyCfsDisclosurePoliciesToCashFlowTree golden path", () => {
  it("writes flat_last policy into projection years for an unmapped (cf_disclosure_only) line", () => {
    const orphan: Row = {
      id: "issuer_cf_disclosure_misc",
      label: "Other operating — disclosure",
      kind: "input",
      valueType: "currency",
      values: { "2024A": -125 },
    };
    const cashFlow: Row[] = [orphan];
    const balanceSheet: Row[] = [];

    const out = applyCfsDisclosurePoliciesToCashFlowTree(
      cashFlow,
      balanceSheet,
      ["2025E", "2026E"],
      "2024A",
      { "2025E": 1_000_000, "2026E": 1_100_000 },
      { issuer_cf_disclosure_misc: { mode: "flat_last_historical" } }
    );

    const patched = out.find((r) => r.id === "issuer_cf_disclosure_misc");
    expect(patched?.values?.["2025E"]).toBe(-125);
    expect(patched?.values?.["2026E"]).toBe(-125);
    expect(patched?.values?.["2024A"]).toBe(-125);
  });
});
