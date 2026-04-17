import { describe, it, expect } from "vitest";
import type { Row } from "@/types/finance";
import { formatCfsRowLinksResolved } from "@/lib/cfs-disclosure-ui-helpers";
import { validateAiCfsSuggestion } from "@/lib/cfs-forecast-diagnose-validate";

const baseRow = (overrides: Partial<Row> = {}): Row => ({
  id: "cfs_line_1",
  label: "Disclosure line",
  kind: "input",
  valueType: "currency",
  ...overrides,
});

describe("formatCfsRowLinksResolved", () => {
  it("resolves a nested BS id to its label", () => {
    const bsTree: Row[] = [
      {
        id: "assets",
        label: "Assets",
        kind: "subtotal",
        valueType: "currency",
        children: [
          {
            id: "id_1773_bs",
            label: "Other receivables",
            kind: "input",
            valueType: "currency",
          },
        ],
      },
    ];
    const row = baseRow({
      cfsLink: {
        section: "operating",
        cfsItemId: "id_1773_bs",
        impact: "neutral",
        description: "",
      },
    });
    const { compact } = formatCfsRowLinksResolved(row, bsTree, []);
    expect(compact).toContain("Other receivables");
    expect(compact).not.toMatch(/^Balance sheet id:/);
  });

  it("falls back to id when BS row is missing", () => {
    const row = baseRow({
      cfsLink: {
        section: "operating",
        cfsItemId: "missing_id",
        impact: "neutral",
        description: "",
      },
    });
    const { compact } = formatCfsRowLinksResolved(row, [], []);
    expect(compact).toContain("missing_id");
  });
});

describe("validateAiCfsSuggestion optional IB-style fields", () => {
  const emptyTrees: Row[] = [];

  it("omits optional fields when not present in raw input", () => {
    const out = validateAiCfsSuggestion(
      {
        cfsRowId: "r1",
        suggestedMapping: "unmapped",
        recommendedTreatment: "flat_last",
      },
      emptyTrees,
      emptyTrees
    );
    expect(out.executiveSummary).toBeUndefined();
    expect(out.bridgeRecommendation).toBeUndefined();
    expect(out.doubleCountRisk).toBeUndefined();
    expect(out.rejectedAlternatives).toBeUndefined();
    expect(out.materialityNote).toBeUndefined();
  });

  it("passes through sanitized optional fields", () => {
    const out = validateAiCfsSuggestion(
      {
        cfsRowId: "r1",
        suggestedMapping: "unmapped",
        recommendedTreatment: "zero",
        executiveSummary: "Summary text.",
        bridgeRecommendation: "Prefer BS bridge.",
        doubleCountRisk: "Risk if duplicated.",
        rejectedAlternatives: ["alt1", "alt2"],
        materialityNote: "material",
      },
      emptyTrees,
      emptyTrees
    );
    expect(out.executiveSummary).toBe("Summary text.");
    expect(out.bridgeRecommendation).toBe("Prefer BS bridge.");
    expect(out.doubleCountRisk).toBe("Risk if duplicated.");
    expect(out.rejectedAlternatives).toEqual(["alt1", "alt2"]);
    expect(out.materialityNote).toBe("material");
  });

  it("drops invalid materiality values", () => {
    const out = validateAiCfsSuggestion(
      {
        cfsRowId: "r1",
        suggestedMapping: "unmapped",
        recommendedTreatment: "flat_last",
        materialityNote: "nope",
      },
      emptyTrees,
      emptyTrees
    );
    expect(out.materialityNote).toBeUndefined();
  });
});
