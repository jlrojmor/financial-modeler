/**
 * CFS projected statements plan: builder and preview share the same ordered line ids.
 */

import { describe, it, expect } from "vitest";
import {
  buildCfsProjectedStatementPlanLines,
  filterCfsPlanLinesForBuilderCoverage,
} from "@/lib/cfs-projected-statements-plan";
import type { Row } from "@/types/finance";
import type { WcScheduleItem } from "@/lib/working-capital-schedule";

function minimalCashFlowWithWc(): Row[] {
  return [
    {
      id: "operating_section",
      label: "Operating",
      kind: "input",
      valueType: "currency",
      children: [
        {
          id: "net_income",
          label: "Net Income",
          kind: "calc",
          valueType: "currency",
          values: {},
        },
        {
          id: "wc_change",
          label: "Change in Working Capital",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [
            {
              id: "cfo_ar",
              label: "AR",
              kind: "input",
              valueType: "currency",
              values: {},
            },
          ],
        },
        {
          id: "operating_cf",
          label: "Operating CF",
          kind: "calc",
          valueType: "currency",
          values: {},
        },
      ],
    },
  ];
}

describe("buildCfsProjectedStatementPlanLines", () => {
  it("expands wc_change with schedule items and keeps wc_change total last in the WC block", () => {
    const wcItems: WcScheduleItem[] = [
      { id: "ar", label: "Accounts receivable", side: "asset" },
      { id: "ap", label: "Accounts payable", side: "liability" },
    ];
    const plan = buildCfsProjectedStatementPlanLines(minimalCashFlowWithWc(), wcItems);
    const hdrIdx = plan.findIndex((l) => l.id === "hdr_wc_change");
    expect(hdrIdx).toBeGreaterThanOrEqual(0);
    const afterHdr = plan.slice(hdrIdx);
    const ids = afterHdr.map((l) => l.id);
    expect(ids[0]).toBe("hdr_wc_change");
    expect(ids).toContain("cfo_ar");
    expect(ids).toContain("cfo_ap");
    const wcTotalIdx = ids.indexOf("wc_change");
    expect(wcTotalIdx).toBeGreaterThan(ids.indexOf("cfo_ar"));
    expect(wcTotalIdx).toBeGreaterThan(ids.indexOf("cfo_ap"));
  });

  it("filterCfsPlanLinesForBuilderCoverage drops headers and spacers only", () => {
    const plan = buildCfsProjectedStatementPlanLines(minimalCashFlowWithWc(), []);
    const cov = filterCfsPlanLinesForBuilderCoverage(plan);
    expect(cov.some((l) => l.role === "section_header")).toBe(false);
    expect(cov.some((l) => l.role === "spacer")).toBe(false);
    expect(cov.map((l) => l.id)).toContain("net_income");
    expect(cov.map((l) => l.id)).toContain("operating_cf");
  });

  it("preview plan data line ids match builder coverage ids for the same inputs", () => {
    const wcItems: WcScheduleItem[] = [{ id: "inv", label: "Inventory", side: "asset" }];
    const full = buildCfsProjectedStatementPlanLines(minimalCashFlowWithWc(), wcItems);
    const previewDataIds = full.filter((l) => l.role === "data").map((l) => l.id);
    const builderIds = filterCfsPlanLinesForBuilderCoverage(full).map((l) => l.id);
    expect(builderIds).toEqual(previewDataIds);
  });
});
