/**
 * Unit tests: WC schedule → Projected Statements CFS preview bridge.
 */

import { describe, it, expect } from "vitest";
import {
  computeWcCfsPreviewCashEffects,
  normalizeWcStripForScheduleLookup,
  resolveWcCanonicalForChild,
} from "@/lib/projected-wc-cfs-bridge";
import { computeWcCfsCashEffectByProjectionYears } from "@/lib/wc-cfs-from-schedule";
import { createBalanceSheetTemplate } from "@/lib/statement-templates";
import type { Row } from "@/types/finance";
import type { WcDriverState } from "@/lib/working-capital-schedule";
import { getWcCfsBridgeLineFromMap, getWcScheduleItems, pickWcCfsBridgeLineByRowId } from "@/lib/working-capital-schedule";
import { sortYearsChronologically } from "@/lib/year-timeline";

const HIST = ["2024", "2025"];
const PROJ = ["2026"];
const ALL = [...HIST, ...PROJ];

function bsWithArValues(arHist: Record<string, number>): Row[] {
  return createBalanceSheetTemplate().map((r) =>
    r.id === "ar" ? { ...r, values: { ...arHist } } : r
  );
}

describe("computeWcCfsPreviewCashEffects", () => {
  it("matches computeWcCfsCashEffectByProjectionYears for the same projected balances (cfo_ar)", () => {
    const balanceSheet = bsWithArValues({ "2024": 400, "2025": 500 });
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "Accounts receivable",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];

    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };

    const rev2026 = 1_000_000;
    const revByYear: Record<string, number> = {
      "2024": 800_000,
      "2025": 900_000,
      "2026": rev2026,
    };
    const cogsByYear: Record<string, number> = {
      "2024": 400_000,
      "2025": 450_000,
      "2026": 500_000,
    };

    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: PROJ,
      allChronologicalYears: ALL,
      historicalYears: HIST,
      wcDriverState,
      revByYear,
      cogsByYear,
    });

    expect(out.cfo_ar).toBeDefined();
    expect(out.cfo_ar?.["2026"]).toBeDefined();

    const expected = computeWcCfsCashEffectByProjectionYears(
      [{ id: "ar", label: "Accounts Receivable", side: "asset" }],
      {
        ar: {
          "2024": 400,
          "2025": 500,
          "2026": rev2026,
        },
      },
      ALL,
      PROJ
    );

    expect(out.cfo_ar?.["2026"]).toBe(expected.ar?.["2026"]);
  });

  it("includes last historical year YoY cash effect on cfo_ar (asset = −Δbalance)", () => {
    const balanceSheet = bsWithArValues({ "2024": 124_769, "2025": 120_173 });
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "Accounts receivable",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 4.2 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: PROJ,
      allChronologicalYears: ALL,
      historicalYears: HIST,
      wcDriverState,
      revByYear: { "2024": 1, "2025": 1, "2026": 1_000_000 },
      cogsByYear: { "2024": 1, "2025": 1, "2026": 500_000 },
    });
    const raw = 120_173 - 124_769;
    expect(out.cfo_ar?.["2025"]).toBe(-raw);
  });

  it("resolves rev/cogs when projection key uses E suffix but rev map uses plain year", () => {
    const balanceSheet = bsWithArValues({ "2024": 100, "2025": 110 });
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "Accounts receivable",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const H = ["2024", "2025"];
    const P = ["2026E"];
    const A = [...H, ...P];
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: P,
      allChronologicalYears: A,
      historicalYears: H,
      wcDriverState,
      revByYear: { "2024": 800_000, "2025": 900_000, "2026": 2_000_000 },
      cogsByYear: { "2024": 1, "2025": 1, "2026": 1 },
    });
    expect(out.cfo_ar?.["2026E"]).toBeDefined();
    expect(out.cfo_ar?.["2026E"]).not.toBe(0);
  });

  it("fills projection when meta projection key is plain year but timeline uses E suffix", () => {
    const balanceSheet = bsWithArValues({ "2024A": 100, "2025A": 110 });
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "Accounts receivable",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const H = ["2024A", "2025A"];
    const P = ["2026"];
    const allChrono = [...H, "2026E"];
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: P,
      allChronologicalYears: allChrono,
      historicalYears: H,
      wcDriverState,
      revByYear: { "2024A": 800_000, "2025A": 900_000, "2026": 2_000_000, "2026E": 2_000_000 },
      cogsByYear: { "2024A": 1, "2025A": 1, "2026": 1, "2026E": 1 },
    });
    expect(out.cfo_ar?.["2026"]).toBeDefined();
    expect(out.cfo_ar?.["2026"]).not.toBe(0);
  });

  it("pickWcCfsBridgeLineByRowId finds cfo_* map when CFS row id is bare BS id", () => {
    const map: Record<string, Record<string, number>> = {
      cfo_ar: { "2026E": -99 },
    };
    expect(pickWcCfsBridgeLineByRowId(map, "ar")?.["2026E"]).toBe(-99);
    expect(pickWcCfsBridgeLineByRowId(map, "cfo_ar")?.["2026E"]).toBe(-99);
  });

  it("getWcCfsBridgeLineFromMap treats explicit empty line as a bridge hit (preview patch gate)", () => {
    const map: Record<string, Record<string, number>> = { cfo_ar: {} };
    const hit = getWcCfsBridgeLineFromMap(map, "ar");
    expect(hit.hasExplicitBridgeKey).toBe(true);
    expect(hit.line).toEqual({});
    expect(pickWcCfsBridgeLineByRowId(map, "ar")).toBeUndefined();
  });

  it("sorts scrambled timeline so projection WC deltas match chronological prev year", () => {
    const balanceSheet = bsWithArValues({ "2024": 400, "2025": 500 });
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "Accounts receivable",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const scrambled = ["2026", "2024", "2025"];
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: PROJ,
      allChronologicalYears: scrambled,
      historicalYears: HIST,
      wcDriverState,
      revByYear: { "2024": 800_000, "2025": 900_000, "2026": 1_000_000 },
      cogsByYear: { "2024": 400_000, "2025": 450_000, "2026": 500_000 },
    });
    const sorted = sortYearsChronologically(scrambled);
    const expected = computeWcCfsCashEffectByProjectionYears(
      [{ id: "ar", label: "AR", side: "asset" }],
      {
        ar: { "2024": 400, "2025": 500, "2026": 1_000_000 },
      },
      sorted,
      PROJ
    );
    expect(out.cfo_ar?.["2026"]).toBe(expected.ar?.["2026"]);
  });

  it("projection WC cash effect with only one historical year (no last-hist override)", () => {
    const balanceSheet = bsWithArValues({ "2025A": 500 });
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "Accounts receivable",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const H = ["2025A"];
    const P = ["2026E"];
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: P,
      allChronologicalYears: [...H, ...P],
      historicalYears: H,
      wcDriverState,
      revByYear: { "2025A": 900_000, "2026E": 1_000_000 },
      cogsByYear: { "2025A": 1, "2026E": 1 },
    });
    expect(out.cfo_ar?.["2025A"]).toBeUndefined();
    expect(out.cfo_ar?.["2026E"]).toBeDefined();
    expect(out.cfo_ar?.["2026E"]).not.toBe(0);
  });

  it("exposes schedule BS id and cfo_ keys when routing exists but wc_change has no CFS children", () => {
    const balanceSheet = bsWithArValues({ "2024": 100, "2025": 110 }).map((r) =>
      r.id === "ar" ? { ...r, cashFlowBehavior: "working_capital" as const } : r
    );
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: PROJ,
      allChronologicalYears: ALL,
      historicalYears: HIST,
      wcDriverState,
      revByYear: { "2024": 800_000, "2025": 900_000, "2026": 1_000_000 },
      cogsByYear: { "2024": 1, "2025": 1, "2026": 1 },
    });
    expect(out.ar?.["2026"]).toBeDefined();
    expect(out.cfo_ar?.["2026"]).toBeDefined();
    expect(out.ar?.["2026"]).toBe(out.cfo_ar?.["2026"]);
  });

  it("unions BS value years into chron when meta allYears omits an early historical year", () => {
    const balanceSheet = bsWithArValues({ "2024": 400, "2025": 500 });
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "Accounts receivable",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const H = ["2024A", "2025A"];
    const P = ["2026E"];
    const incompleteMetaTimeline = ["2025A", "2026E"];
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: P,
      allChronologicalYears: incompleteMetaTimeline,
      historicalYears: H,
      wcDriverState,
      revByYear: { "2024": 800_000, "2024A": 800_000, "2025": 900_000, "2025A": 900_000, "2026E": 2_000_000 },
      cogsByYear: { "2024": 1, "2025": 1, "2026E": 1 },
    });
    expect(out.cfo_ar?.["2026E"]).toBeDefined();
    expect(out.cfo_ar?.["2026E"]).not.toBe(0);
  });

  it("uses BS actual when meta historical uses A suffix but BS row keys are plain years", () => {
    const balanceSheet = bsWithArValues({ "2025": 500 });
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "Accounts receivable",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const H = ["2025A"];
    const P = ["2026E"];
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: P,
      allChronologicalYears: [...H, ...P],
      historicalYears: H,
      wcDriverState,
      revByYear: { "2025": 900_000, "2025A": 900_000, "2026E": 1_000_000 },
      cogsByYear: { "2025": 1, "2026E": 1 },
    });
    expect(out.cfo_ar?.["2026E"]).toBeDefined();
    expect(out.cfo_ar?.["2026E"]).not.toBe(0);
  });

  it("returns {} when no WC schedule and wc_change has no children", () => {
    const balanceSheet = bsWithArValues({ "2025": 100 }).map((r) =>
      r.cashFlowBehavior === "working_capital" ? { ...r, cashFlowBehavior: "non_cash" as const } : r
    );
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [],
      },
    ];

    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };

    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: PROJ,
      allChronologicalYears: ALL,
      historicalYears: HIST,
      wcDriverState,
      revByYear: { "2024": 1, "2025": 1, "2026": 1000 },
      cogsByYear: { "2024": 1, "2025": 1, "2026": 500 },
    });

    expect(out).toEqual({});
  });

  it("resolveWcCanonicalForChild maps cfo_ar to routed custom AR when template ar is off WC schedule", () => {
    const idCustom = "id_custom_ar";
    const rows = createBalanceSheetTemplate().map((r) => {
      if (r.cashFlowBehavior === "working_capital" && r.id !== idCustom) {
        return { ...r, cashFlowBehavior: "non_cash" as const };
      }
      return r;
    });
    const arIdx = rows.findIndex((r) => r.id === "ar");
    expect(arIdx).toBeGreaterThanOrEqual(0);
    rows.splice(arIdx + 1, 0, {
      id: idCustom,
      label: "Accounts Receivable",
      kind: "input",
      valueType: "currency",
      values: { "2024": 100, "2025": 200 },
      children: [],
      cashFlowBehavior: "working_capital" as const,
    });
    const scheduleItems = getWcScheduleItems(
      [
        {
          id: "wc_change",
          label: "WC",
          kind: "input",
          valueType: "currency",
          values: {},
          children: [
            {
              id: "cfo_ar",
              label: "Accounts receivable",
              kind: "calc",
              valueType: "currency",
              values: {},
              children: [],
            },
          ],
        },
      ],
      rows
    );
    expect(scheduleItems.map((s) => s.id)).toEqual([idCustom]);
    const cfsChild: Row = {
      id: "cfo_ar",
      label: "Accounts receivable",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    };
    expect(resolveWcCanonicalForChild(cfsChild, scheduleItems, rows)).toBe(idCustom);
  });

  it("non-zero cfo_ar when CFS uses cfo_ar but only a custom routed BS row holds balances", () => {
    const idCustom = "id_custom_ar";
    const rows = createBalanceSheetTemplate().map((r) => {
      if (r.cashFlowBehavior === "working_capital" && r.id !== idCustom) {
        return { ...r, cashFlowBehavior: "non_cash" as const };
      }
      return r;
    });
    const arIdx = rows.findIndex((r) => r.id === "ar");
    rows.splice(arIdx + 1, 0, {
      id: idCustom,
      label: "Accounts Receivable",
      kind: "input",
      valueType: "currency",
      values: { "2024": 100, "2025": 200 },
      children: [],
      cashFlowBehavior: "working_capital" as const,
    });
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "Accounts receivable",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { [idCustom]: "days" },
      wcDaysByItemId: { [idCustom]: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { [idCustom]: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet: rows,
      projectionYears: PROJ,
      allChronologicalYears: ALL,
      historicalYears: HIST,
      wcDriverState,
      revByYear: { "2024": 800_000, "2025": 900_000, "2026": 1_000_000 },
      cogsByYear: { "2024": 1, "2025": 1, "2026": 1 },
    });
    expect(out.cfo_ar?.["2026"]).toBeDefined();
    expect(out.cfo_ar?.["2026"]).not.toBe(0);
  });

  it("fills last meta-historical WC on cfo_ar when one historical year but chron has a prior BS year", () => {
    const balanceSheet = bsWithArValues({ "2024": 500, "2025A": 400 });
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "Accounts receivable",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: ["2026E"],
      allChronologicalYears: ["2025A", "2026E"],
      historicalYears: ["2025A"],
      wcDriverState,
      revByYear: { "2024": 1, "2025A": 1, "2026E": 1_000_000 },
      cogsByYear: { "2024": 1, "2025A": 1, "2026E": 1 },
    });
    expect(out.cfo_ar?.["2025A"]).toBe(-(400 - 500));
  });

  it("normalizeWcStripForScheduleLookup maps inventories to inventory", () => {
    expect(normalizeWcStripForScheduleLookup("inventories")).toBe("inventory");
    expect(normalizeWcStripForScheduleLookup("inventory")).toBe("inventory");
  });

  it("resolveWcCanonicalForChild maps cfo_inventories to BS id inventory", () => {
    const balanceSheet = createBalanceSheetTemplate();
    const cashFlowStub: Row[] = [
      {
        id: "wc_change",
        label: "WC",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [{ id: "cfo_inventories", label: "Inventories", kind: "calc", valueType: "currency", values: {}, children: [] }],
      },
    ];
    const scheduleItems = getWcScheduleItems(cashFlowStub, balanceSheet);
    const child: Row = {
      id: "cfo_inventories",
      label: "Inventories",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    };
    expect(resolveWcCanonicalForChild(child, scheduleItems, balanceSheet)).toBe("inventory");
  });

  it("propagates non-zero WC cash for cfo_inventories to inventory and cfo_inventory keys", () => {
    const balanceSheet = createBalanceSheetTemplate().map((r) =>
      r.id === "inventory"
        ? { ...r, values: { "2024": 1_000_000, "2025": 1_100_000 } }
        : r
    );
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "Change in Working Capital",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_inventories",
            label: "Inventories",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { inventory: "days" },
      wcDaysByItemId: { inventory: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { inventory: "cogs" },
      wcPctBaseByItemId: {},
      wcPctByItemId: {},
      wcPctByItemIdByYear: {},
    };
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: PROJ,
      allChronologicalYears: ALL,
      historicalYears: HIST,
      wcDriverState,
      revByYear: { "2024": 1, "2025": 1, "2026": 1 },
      cogsByYear: { "2024": 2_000_000, "2025": 2_200_000, "2026": 3_000_000 },
    });
    expect(out.inventory?.["2026"]).toBeDefined();
    expect(out.cfo_inventory?.["2026"]).toBeDefined();
    expect(out.inventory?.["2026"]).toBe(out.cfo_inventory?.["2026"]);
    expect(out.cfo_inventories?.["2026"]).toBe(out.inventory?.["2026"]);
  });

  it("includes schedule-only WC line in bridge map when no CFS child matches that id", () => {
    const balanceSheet = createBalanceSheetTemplate().map((r) =>
      r.id === "other_cl" ? { ...r, cashFlowBehavior: "working_capital" as const, values: { "2024": 50, "2025": 60 } } : r
    );
    const cashFlow: Row[] = [
      {
        id: "wc_change",
        label: "WC",
        kind: "input",
        valueType: "currency",
        values: {},
        children: [
          {
            id: "cfo_ar",
            label: "AR",
            kind: "calc",
            valueType: "currency",
            values: {},
            children: [],
          },
        ],
      },
    ];
    const wcDriverState: WcDriverState = {
      wcDriverTypeByItemId: { ar: "days", other_cl: "pct_revenue" },
      wcDaysByItemId: { ar: 365 },
      wcDaysByItemIdByYear: {},
      wcDaysBaseByItemId: { ar: "revenue" },
      wcPctBaseByItemId: {},
      wcPctByItemId: { other_cl: 5 },
      wcPctByItemIdByYear: {},
    };
    const out = computeWcCfsPreviewCashEffects({
      cashFlow,
      balanceSheet,
      projectionYears: PROJ,
      allChronologicalYears: ALL,
      historicalYears: HIST,
      wcDriverState,
      revByYear: { "2024": 800_000, "2025": 900_000, "2026": 1_000_000 },
      cogsByYear: { "2024": 1, "2025": 1, "2026": 1 },
    });
    expect(out.other_cl).toBeDefined();
    expect(out.cfo_other_cl).toBeDefined();
    expect(Object.keys(out.other_cl ?? {}).length).toBeGreaterThan(0);
  });
});
