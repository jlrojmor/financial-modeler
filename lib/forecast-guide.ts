/**
 * In-product Forecast Guide: structured content by Forecast Drivers sub-tab.
 * Add new tabs/methods here; UI reads this data only (no logic coupling).
 */

import type { ForecastDriversSubTab } from "@/store/useModelStore";

export type GuideBlock =
  | { type: "heading"; text: string }
  | { type: "subheading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "callout"; tone: "tip" | "warning" | "note"; title?: string; text: string };

export interface GuideSection {
  id: string;
  navLabel: string;
  title: string;
  blocks: GuideBlock[];
}

export type ForecastGuideTabBundle =
  | { kind: "sections"; sections: GuideSection[] }
  | { kind: "placeholder"; headline: string; body: string };

function section(
  id: string,
  navLabel: string,
  title: string,
  blocks: GuideBlock[]
): GuideSection {
  return { id, navLabel, title, blocks };
}

/** Revenue: overview + row types + forecast methods (v1-aligned). */
export const REVENUE_GUIDE_SECTIONS: GuideSection[] = [
  section("overview", "Overview", "Revenue overview", [
    {
      type: "paragraph",
      text: "This area is where you define how each revenue line is forecast in the model. Your choices here drive the Revenue Forecast Preview on the right and downstream projections. Nothing you do here rewrites or replaces Historicals—actuals stay in the Historicals step.",
    },
    {
      type: "subheading",
      text: "What you are building",
    },
    {
      type: "list",
      items: [
        "A clear hierarchy (total revenue, streams, and sub-lines) that matches how you think about the business.",
        "For each line: whether it is forecast directly, built from children, or split as a percentage of a parent.",
        "For lines you forecast with numbers: a method (growth, flat, manual by year, Price × Volume, etc.) and the inputs that method needs.",
      ],
    },
    {
      type: "subheading",
      text: "How to read the preview",
    },
    {
      type: "paragraph",
      text: "The preview shows historical actual years and forecast years side by side. For lines without a true last-year actual, you may see an opening base in the last actual column and growth explained in the Revenue Growth section—so you can see the bridge from setup into the first forecast year.",
    },
    {
      type: "callout",
      tone: "note",
      title: "Historical data",
      text: "Historicals are never overwritten from Forecast Drivers. If a line only exists in the forecast tree, it will not pick up fake history; the model uses your opening assumptions where appropriate.",
    },
  ]),

  section(
    "forecast_directly",
    "Forecast this row directly",
    "Forecast this row directly",
    [
      {
        type: "paragraph",
        text: "Use this when the line should stand on its own: you enter a forecast method and inputs for that line itself. The model projects that line from its base (last actual or a manual starting amount you specify) and your growth or fixed-value rules.",
      },
      {
        type: "subheading",
        text: "When to use it",
      },
      {
        type: "list",
        items: [
          "The line is a real economic driver (e.g. a segment, product family, or geography) you want to model explicitly.",
          "You do not need sub-lines to explain the forecast yet.",
        ],
      },
      {
        type: "subheading",
        text: "With child lines",
      },
      {
        type: "paragraph",
        text: "A direct row can still have children if those children are allocation splits (see Split by %). The parent still owns the total forecast method unless you switch the parent to “build from children.”",
      },
    ]
  ),

  section(
    "build_from_children",
    "Build from child lines",
    "Build this row from child lines",
    [
      {
        type: "paragraph",
        text: "The parent line equals the sum of its children each period. You do not apply a separate growth method on the parent; instead, each child (or subtree) carries its own forecast, and the parent rolls up automatically.",
      },
      {
        type: "subheading",
        text: "When to use it",
      },
      {
        type: "list",
        items: [
          "Revenue is naturally additive (e.g. regions or products that should always tie to a total).",
          "You want the total to stay mechanically consistent with the breakdown.",
        ],
      },
      {
        type: "subheading",
        text: "What you must do",
      },
      {
        type: "list",
        items: [
          "Ensure every child that should count is under the parent and forecasted (or derived) correctly.",
          "Avoid double-counting the same revenue in both the parent and a duplicate line elsewhere.",
        ],
      },
      {
        type: "callout",
        tone: "warning",
        title: "Common mistake",
        text: "Mixing “direct” forecasting on the parent with a full child-built structure without updating roles—pick one coherent structure per subtotal.",
      },
    ]
  ),

  section("split_by_pct", "Split by %", "Split by % (allocation of parent)", [
    {
      type: "paragraph",
      text: "Child lines can be set as a percentage of their parent. The parent’s forecast (or historical base, depending on setup) drives the dollar amounts; each child receives its share. Percentages should reflect your view of the mix (and sum to 100% where that is the intent).",
    },
    {
      type: "subheading",
      text: "When to use it",
    },
    {
      type: "list",
      items: [
        "You care about mix (e.g. US vs international) but the parent total is the main forecast object.",
        "Splits are stable or slowly moving relative to the parent.",
      ],
    },
    {
      type: "subheading",
      text: "When not to use it",
      },
    {
      type: "list",
      items: [
        "Children have independent economics (different growth, seasonality, or drivers)—consider direct or child-built forecasting instead.",
      ],
    },
    {
      type: "subheading",
      text: "How it behaves in the preview",
    },
    {
      type: "paragraph",
      text: "Opening bases for allocation children can be derived from the parent’s opening base times each child’s percentage, so the first forecast year and growth read consistently with the parent.",
    },
  ]),

  section(
    "method_growth_historical",
    "Growth from historical actual",
    "Growth from historical actual",
    [
      {
        type: "paragraph",
        text: "The first forecast year starts from the line’s last historical actual (in reported terms). Each subsequent forecast year applies your growth rate (constant, phased, or by year) on top of the prior year’s projected value.",
      },
      {
        type: "subheading",
        text: "When to use it",
      },
      {
        type: "list",
        items: [
          "The business has a clean trailing actual and you want continuity from that base.",
          "You are comfortable that last year’s level is a reasonable jump-off point.",
        ],
      },
      {
        type: "subheading",
        text: "When not to use it",
      },
      {
        type: "list",
        items: [
          "Last year was distorted (one-offs, COVID, divestitures)—use a manual starting amount or another method after normalizing outside the tool.",
          "The line has no true historical actual—use manual starting amount or flat / manual by year as appropriate.",
        ],
      },
      {
        type: "subheading",
        text: "Required inputs",
      },
      {
        type: "list",
        items: [
          "A valid last historical actual on the row (where the model expects it).",
          "Growth definition: constant %, phases, or explicit rates by forecast year.",
        ],
      },
      {
        type: "subheading",
        text: "How the model calculates it",
      },
      {
        type: "paragraph",
        text: "Base = last actual. Year 1 forecast = base × (1 + growth for that year). Later years chain on the prior forecast year’s result.",
      },
      {
        type: "subheading",
        text: "Row types",
      },
      {
        type: "list",
        items: [
          "Direct row: growth applies to that line’s own history.",
          "Build-from-children parent: the parent is summed from children; growth-from-historical applies to independent children, not as a second layer on the parent unless the parent is independently forecast.",
          "Split-by-% child: the child’s path still ties to the parent’s base and mix; growth on the child may not apply in the same way—follow your structure (often the parent carries the dollar path and children follow %).",
        ],
      },
      {
        type: "callout",
        tone: "tip",
        title: "Common mistake",
        text: "Assuming a child with only a % split also has its own historical series for growth—clarify whether the child is allocation-only or a full forecast line.",
      },
    ]
  ),

  section(
    "method_growth_manual_start",
    "Growth from manual starting amount",
    "Growth from manual starting amount",
    [
      {
        type: "paragraph",
        text: "You set an explicit dollar (or model-unit) starting point for the first forecast year instead of using the last historical actual. Growth rates then apply from that base forward, year over year.",
      },
      {
        type: "subheading",
        text: "When to use it",
      },
      {
        type: "list",
        items: [
          "History is missing, not comparable, or you want to normalize (run-rate, pro forma).",
          "You are launching a new stream with no meaningful trailing actual.",
        ],
      },
      {
        type: "subheading",
        text: "When not to use it",
      },
      {
        type: "list",
        items: [
          "You have a solid last actual and want continuity—prefer growth from historical actual.",
        ],
      },
      {
        type: "subheading",
        text: "Required inputs",
      },
      {
        type: "list",
        items: [
          "Manual starting amount (in the same units as the rest of the model).",
          "Growth definition for forecast years.",
        ],
      },
      {
        type: "subheading",
        text: "How the model calculates it",
      },
      {
        type: "paragraph",
        text: "Base = your entered starting amount. Forecast years compound using the specified growth pattern from that base and each subsequent projected year.",
      },
      {
        type: "subheading",
        text: "Row types",
      },
      {
        type: "list",
        items: [
          "Direct row: ideal for new or adjusted bases.",
          "Child-built parent: typically children carry bases; avoid double-setting the parent unless your structure intentionally uses a manual total.",
          "Allocation children: opening amounts may be implied from parent × %; do not also invent conflicting manual bases for the same economic slice.",
        ],
      },
    ]
  ),

  section("method_growth_phases", "Growth phases", "Growth phases", [
    {
      type: "paragraph",
      text: "Instead of one constant rate forever, you define periods (e.g. high growth then taper) with a growth % for each phase. The model maps those phases onto your forecast years.",
    },
    {
      type: "subheading",
      text: "When to use it",
      },
    {
      type: "list",
      items: [
        "The business has a credible story that changes over the forecast window (ramp-up, maturity, normalization).",
        "A single long-term rate would misstate early vs late years.",
      ],
    },
    {
      type: "subheading",
      text: "Required inputs",
      },
    {
      type: "list",
      items: [
        "Phase boundaries (start/end years) that align with your forecast horizon.",
        "A rate for each phase (and a starting basis: historical or manual, as selected).",
      ],
    },
    {
      type: "subheading",
      text: "How the model calculates it",
      },
    {
      type: "paragraph",
      text: "For each forecast year, the applicable phase rate is applied to the prior year’s projected value (after the first year, which uses your chosen base).",
    },
    {
      type: "subheading",
      text: "Common mistakes",
      },
    {
      type: "list",
      items: [
        "Overlapping or gap phases—keep phases contiguous and covering the years you care about.",
        "Phases that do not match the narrative you present externally—sanity-check the implied CAGR.",
      ],
    },
  ]),

  section("method_flat", "Flat value", "Flat value", [
    {
      type: "paragraph",
      text: "The line holds the same level each forecast year (unless you override with a different method). Simple and transparent for stable fees, retainers, or placeholder lines.",
    },
    {
      type: "subheading",
      text: "When to use it",
      },
    {
      type: "list",
      items: [
        "Truly stable revenue where growth is immaterial or captured elsewhere.",
        "Temporary modeling when you will refine the method later.",
      ],
    },
    {
      type: "subheading",
      text: "Required inputs",
      },
    {
      type: "list",
      items: ["The flat amount per year (or the single value that repeats)."],
    },
    {
      type: "subheading",
      text: "How the model calculates it",
      },
    {
      type: "paragraph",
      text: "Each forecast year receives the same value you specify.",
    },
    {
      type: "callout",
      tone: "warning",
      title: "When not to use it",
      text: "Growing businesses where flat revenue would misstate the thesis—use growth or manual by year instead.",
    },
  ]),

  section("method_manual_by_year", "Manual by year", "Manual by year", [
    {
      type: "paragraph",
      text: "You type the revenue for each forecast year explicitly. The model does not apply a formulaic growth rate between years; it displays and uses exactly what you enter.",
    },
    {
      type: "subheading",
      text: "When to use it",
      },
    {
      type: "list",
      items: [
        "You have a specific path (budget, contract schedule, management case) year by year.",
        "Complexity that does not fit a simple % growth pattern.",
      ],
    },
    {
      type: "subheading",
      text: "Required inputs",
      },
    {
      type: "list",
      items: ["A value for each forecast year you want populated (leave gaps only if intentional)."],
    },
    {
      type: "subheading",
      text: "How the model calculates it",
      },
    {
      type: "paragraph",
      text: "No chaining formula—each year is independent unless you change inputs. Opening bridge checks may still compare your first-year entry to totals where applicable.",
    },
    {
      type: "subheading",
      text: "Common mistakes",
      },
    {
      type: "list",
      items: [
        "Inconsistent year-to-year jumps without documentation—add notes in your workbook or memo outside the app if needed.",
        "Mixing manual-by-year on a parent that should be the sum of children—structure the roll-up first.",
      ],
    },
  ]),

  section("method_price_volume", "Price × Volume", "Price × Volume", [
    {
      type: "paragraph",
      text: "Revenue is built from two drivers you forecast separately: volume (e.g. units sold) and average realized price per unit. Each series can grow at constant %, by year, or in phases—same patterns as other direct growth methods. Projected revenue each year is volume × price for that year.",
    },
    {
      type: "subheading",
      text: "When to use it",
    },
    {
      type: "list",
      items: [
        "Revenue is naturally thought of as units × price (subscriptions, widgets, seats, tons, etc.).",
        "You want to stress-test volume and pricing assumptions independently.",
      ],
    },
    {
      type: "subheading",
      text: "When not to use it",
    },
    {
      type: "list",
      items: [
        "The line is a pure dollar subtotal or allocation split with no meaningful unit economics.",
        "You need seasonality, utilization, or extra drivers—the app does not add those in this method yet.",
      ],
    },
    {
      type: "subheading",
      text: "Required inputs",
    },
    {
      type: "list",
      items: [
        "Starting volume (> 0) and starting price per unit (> 0), in consistent units so their product matches revenue scale.",
        "A complete growth pattern for volume and a complete pattern for price (constant, by year, or phases).",
      ],
    },
    {
      type: "subheading",
      text: "How the model calculates it",
    },
    {
      type: "paragraph",
      text: "First forecast year: volume = starting volume × (1 + volume growth for that year); price = starting price × (1 + price growth for that year); revenue = volume × price. Later years: each of volume and price grows from the prior year’s projected level using that year’s growth rates, then revenue is the product again.",
    },
    {
      type: "subheading",
      text: "Direct rows only",
    },
    {
      type: "paragraph",
      text: "Price × Volume is available only when you forecast the line directly. It is not used on derived (build-from-children) or allocation rows.",
    },
    {
      type: "subheading",
      text: "Preview and opening base",
    },
    {
      type: "paragraph",
      text: "For forecast-only lines, the preview may show an opening base in the last actual column equal to starting volume × starting price per unit, so the Revenue Growth section and opening bridge can reconcile the jump into the first forecast year.",
    },
    {
      type: "subheading",
      text: "Common mistakes to avoid",
    },
    {
      type: "list",
      items: [
        "Mixing display units (e.g. thousands) between volume and price—keep definitions aligned so revenue is not off by scale.",
        "Using zero or missing starts; both starting volume and price must be positive for a valid row.",
        "Completing only one growth side—both volume and price patterns must be fully specified.",
      ],
    },
  ]),
];

export const FORECAST_GUIDE_CONTENT: Record<
  ForecastDriversSubTab,
  ForecastGuideTabBundle
> = {
  revenue: { kind: "sections", sections: REVENUE_GUIDE_SECTIONS },
  operating_costs: {
    kind: "placeholder",
    headline: "Operating Costs",
    body: "A full guide for COGS, SG&A, and related drivers will be added here. For now, use Revenue to complete your topline forecast.",
  },
  wc_drivers: {
    kind: "placeholder",
    headline: "Working Capital Drivers",
    body: "Working capital forecasting guidance will be added here in a future update.",
  },
  financing_taxes: {
    kind: "placeholder",
    headline: "Financing / Taxes",
    body: "Financing and tax assumption guidance will be added here in a future update.",
  },
};

export function getDefaultSectionIdForTab(
  tab: ForecastDriversSubTab
): string | null {
  const bundle = FORECAST_GUIDE_CONTENT[tab];
  if (bundle.kind === "sections" && bundle.sections.length > 0) {
    return bundle.sections[0]!.id;
  }
  return null;
}
