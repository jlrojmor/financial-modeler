import { describe, it, expect } from "vitest";
import { applyCfsDisclosureProjectionForYear } from "@/lib/cfs-disclosure-projection";

describe("applyCfsDisclosureProjectionForYear", () => {
  it("applies flat_last_historical using last actual", () => {
    const v = applyCfsDisclosureProjectionForYear(
      { mode: "flat_last_historical" },
      "2026E",
      "2025A",
      1e9,
      -28_547
    );
    expect(v).toBe(-28_547);
  });

  it("applies pct_of_revenue", () => {
    const v = applyCfsDisclosureProjectionForYear({ mode: "pct_of_revenue", pct: 0.5 }, "2026E", "2025A", 1000, 0);
    expect(v).toBe(5);
  });

  it("applies manual_by_year", () => {
    const v = applyCfsDisclosureProjectionForYear(
      { mode: "manual_by_year", byYear: { "2026E": 123 } },
      "2026E",
      "2025A",
      0,
      0
    );
    expect(v).toBe(123);
  });

  it("zero and excluded return 0", () => {
    expect(applyCfsDisclosureProjectionForYear({ mode: "zero" }, "2026E", "2025A", 100, 5)).toBe(0);
    expect(applyCfsDisclosureProjectionForYear({ mode: "excluded" }, "2026E", "2025A", 100, 5)).toBe(0);
  });
});
