import { describe, it, expect } from "vitest";
import { mapAiTreatmentToDisclosureSpec } from "@/lib/cfs-ai-treatment-to-policy";
import type { Row } from "@/types/finance";

const row: Row = {
  id: "cfo_misc",
  label: "Misc",
  kind: "input",
  valueType: "currency",
  values: { "2023": -50 },
};

describe("mapAiTreatmentToDisclosureSpec", () => {
  it("maps flat_last", () => {
    const s = mapAiTreatmentToDisclosureSpec("flat_last", row, "2023", 1000);
    expect(s).toEqual({ mode: "flat_last_historical" });
  });

  it("estimates pct_of_revenue from last historical", () => {
    const s = mapAiTreatmentToDisclosureSpec("pct_revenue", row, "2023", 1000);
    expect(s?.mode).toBe("pct_of_revenue");
    if (s?.mode === "pct_of_revenue") {
      expect(s.pct).toBeCloseTo(5);
    }
  });

  it("returns null for map_to_bs", () => {
    expect(mapAiTreatmentToDisclosureSpec("map_to_bs", row, "2023", 1000)).toBeNull();
  });
});
