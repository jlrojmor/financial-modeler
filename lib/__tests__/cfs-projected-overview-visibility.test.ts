/**
 * Projected CFS overview: FD-backed line visibility (builder + preview).
 */

import { describe, it, expect } from "vitest";
import { buildCfsProjectedStatementPlanLines } from "@/lib/cfs-projected-statements-plan";
import { filterCfsPlanLinesForProjectedOverview } from "@/lib/cfs-projected-overview-visibility";
import { getCfsProjectedStatementLineRouting } from "@/lib/cfs-projected-statements-shell-routing";
import type { Row } from "@/types/finance";
import type { CfsRoutingContext } from "@/lib/cfs-projected-statements-shell-routing";
import { findRowInTree } from "@/lib/row-utils";

function baseCtx(over: Partial<CfsRoutingContext> = {}): CfsRoutingContext {
  return {
    wcDriversConfirmed: false,
    dandaScheduleConfirmed: false,
    capexModelIntangibles: false,
    debtApplied: false,
    equityRollforwardConfirmed: false,
    otherBsConfirmed: false,
    wcScheduleRowIds: new Set(),
    balanceSheet: [],
    disclosureProjectionByRowId: {},
    ...over,
  };
}

const row = (r: Partial<Row> & Pick<Row, "id" | "label" | "kind" | "valueType">): Row =>
  ({
    children: [],
    values: {},
    ...r,
  }) as Row;

describe("getCfsProjectedStatementLineRouting — anchor ids", () => {
  it("marks acquisitions as not_configured", () => {
    const r = row({
      id: "acquisitions",
      label: "Acquisitions",
      kind: "input",
      valueType: "currency",
    });
    const out = getCfsProjectedStatementLineRouting(r, "acquisitions", baseCtx());
    expect(out.status).toBe("not_configured");
  });

  it("marks debt_issued derived when debt applied", () => {
    const r = row({
      id: "debt_issued",
      label: "Debt issued",
      kind: "input",
      valueType: "currency",
      taxonomyType: "cff_debt_issued",
    });
    const on = getCfsProjectedStatementLineRouting(r, "debt_issued", baseCtx({ debtApplied: true }));
    expect(on.status).toBe("derived");
    const off = getCfsProjectedStatementLineRouting(r, "debt_issued", baseCtx({ debtApplied: false }));
    expect(off.status).toBe("not_configured");
  });
});

describe("filterCfsPlanLinesForProjectedOverview", () => {
  const investingBlock: Row[] = [
    {
      id: "inv_block",
      label: "Investing",
      kind: "input",
      valueType: "currency",
      children: [
        {
          id: "capex",
          label: "CapEx",
          kind: "input",
          valueType: "currency",
          taxonomyType: "cfi_capex",
          values: {},
          children: [],
        },
        {
          id: "acquisitions",
          label: "Acquisitions",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [],
        },
        {
          id: "investing_cf",
          label: "Investing CF",
          kind: "calc",
          valueType: "currency",
          values: {},
          children: [],
        },
      ],
    },
  ];

  it("drops acquisitions when optional anchor is not configured", () => {
    const plan = buildCfsProjectedStatementPlanLines(investingBlock, []);
    expect(plan.some((l) => l.id === "acquisitions")).toBe(true);
    const filtered = filterCfsPlanLinesForProjectedOverview(plan, investingBlock, baseCtx());
    expect(filtered.some((l) => l.id === "acquisitions")).toBe(false);
    expect(filtered.some((l) => l.id === "capex")).toBe(true);
    expect(filtered.some((l) => l.id === "investing_cf")).toBe(true);
  });

  it("keeps debt_issued when debt schedule is applied", () => {
    const fin: Row[] = [
      {
        id: "fin_block",
        label: "Financing",
        kind: "input",
        valueType: "currency",
        children: [
          {
            id: "debt_issued",
            label: "Debt issued",
            kind: "input",
            valueType: "currency",
            values: {},
            children: [],
          },
          {
            id: "financing_cf",
            label: "Financing CF",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const plan = buildCfsProjectedStatementPlanLines(fin, []);
    const off = filterCfsPlanLinesForProjectedOverview(plan, fin, baseCtx({ debtApplied: false }));
    expect(off.some((l) => l.id === "debt_issued")).toBe(false);
    const on = filterCfsPlanLinesForProjectedOverview(plan, fin, baseCtx({ debtApplied: true }));
    expect(on.some((l) => l.id === "debt_issued")).toBe(true);
    expect(findRowInTree(fin, "debt_issued")).not.toBeNull();
  });
});
