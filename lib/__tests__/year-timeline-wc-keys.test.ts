import { describe, it, expect } from "vitest";
import { formatStatementYearHeader, pickNumericByYearKey } from "@/lib/year-timeline";

describe("formatStatementYearHeader", () => {
  it("does not double-append A when label already ends with A", () => {
    expect(formatStatementYearHeader("2025A", false)).toBe("2025A");
  });
  it("does not double-append E for projection", () => {
    expect(formatStatementYearHeader("2026E", true)).toBe("2026E");
  });
  it("appends A for plain calendar year actuals", () => {
    expect(formatStatementYearHeader("2025", false)).toBe("2025A");
  });
  it("appends E for plain calendar year forecast", () => {
    expect(formatStatementYearHeader("2026", true)).toBe("2026E");
  });
});

describe("pickNumericByYearKey", () => {
  it("finds value when map uses plain year and query uses suffixed year", () => {
    const m = { "2026": 1_234 };
    expect(pickNumericByYearKey(m, "2026E")).toBe(1_234);
  });
  it("finds value when map uses suffixed year and query uses plain year", () => {
    const m = { "2026E": 9_999 };
    expect(pickNumericByYearKey(m, "2026")).toBe(9_999);
  });
});
