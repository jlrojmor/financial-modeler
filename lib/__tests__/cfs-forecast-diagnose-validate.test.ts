import { describe, it, expect } from "vitest";
import { validateAiCfsSuggestion } from "@/lib/cfs-forecast-diagnose-validate";
import type { Row } from "@/types/finance";

const bs: Row[] = [{ id: "ar", label: "AR", kind: "input", valueType: "currency", values: {} }];
const isRows: Row[] = [{ id: "rev", label: "Rev", kind: "input", valueType: "currency", values: {} }];

describe("validateAiCfsSuggestion", () => {
  it("downgrades balance_sheet mapping when linked id is missing on BS", () => {
    const out = validateAiCfsSuggestion(
      {
        cfsRowId: "x",
        suggestedMapping: "balance_sheet",
        linkedRowId: "ghost",
        recommendedTreatment: "flat_last",
        rationale: "test",
      },
      bs,
      isRows
    );
    expect(out.suggestedMapping).toBe("unmapped");
    expect(out.linkedRowId).toBeUndefined();
  });

  it("keeps balance_sheet when linked id exists on BS", () => {
    const out = validateAiCfsSuggestion(
      {
        cfsRowId: "x",
        suggestedMapping: "balance_sheet",
        linkedRowId: "ar",
        recommendedTreatment: "flat_last",
        rationale: "",
      },
      bs,
      isRows
    );
    expect(out.suggestedMapping).toBe("balance_sheet");
    expect(out.linkedRowId).toBe("ar");
  });
});
