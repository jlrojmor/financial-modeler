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
        "Starting volume (> 0) as a plain count, and starting price per unit (> 0) as the actual price in your model currency (not scaled by K/M revenue display), so volume × price matches revenue in the model’s stored terms.",
        "A complete growth pattern for volume and a complete pattern for price (constant, by year, or phases).",
        "Optional: a short volume unit label (e.g. subscribers, kg, cases)—purely for clarity in the builder and summaries; it does not change calculations.",
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

  section("method_customers_arpu", "Customers × ARPU", "Customers × ARPU", [
    {
      type: "paragraph",
      text: "This method forecasts revenue as the product of the number of customers and the average revenue generated per customer (ARPU). It is commonly used for subscription, SaaS, marketplace, and user-based business models.",
    },
    {
      type: "subheading",
      text: "What is ARPU?",
    },
    {
      type: "paragraph",
      text: "ARPU (Average Revenue Per User) represents the average amount of revenue generated per customer over a given period. It reflects pricing, monetization strategy, and customer value.",
    },
    {
      type: "list",
      items: [
        "Subscription: monthly fee per user",
        "Marketplace: average spend per active customer",
        "Telecom / SaaS: revenue per subscriber",
      ],
    },
    {
      type: "subheading",
      text: "When to use this method",
    },
    {
      type: "list",
      items: [
        "When revenue is driven by user growth and monetization",
        "When you want to separate customer acquisition from pricing power",
        "When ARPU can change independently from customer count",
      ],
    },
    {
      type: "subheading",
      text: "When NOT to use",
    },
    {
      type: "list",
      items: [
        "When revenue is not tied to identifiable customers",
        "When pricing varies heavily per transaction (use Price × Volume instead)",
        "When only total revenue growth assumptions are available",
      ],
    },
    {
      type: "subheading",
      text: "Required inputs",
    },
    {
      type: "list",
      items: [
        "Starting number of customers (plain count, not scaled)",
        "Starting ARPU (absolute currency per customer, at the basis you choose below)",
        "ARPU basis: Monthly or Annual (default Annual — existing saved models without this field behave as Annual)",
        "Customer growth assumptions (constant, by year, or phases)",
        "ARPU growth assumptions (constant, by year, or phases)",
        "Optional customer unit label (e.g., users, subscribers, accounts)",
      ],
    },
    {
      type: "subheading",
      text: "ARPU basis (monthly vs annual)",
    },
    {
      type: "paragraph",
      text: "The model outputs annual revenue. ARPU is a monetization driver: you must say whether your ARPU input is per month or per year.",
    },
    {
      type: "list",
      items: [
        "Annual: Revenue(t) = Customers(t) × ARPU(t) — no extra conversion.",
        "Monthly: Revenue(t) = Customers(t) × ARPU(t) × 12 — monthly ARPU is annualized to match annual revenue.",
      ],
    },
    {
      type: "subheading",
      text: "How the model calculates revenue",
    },
    {
      type: "paragraph",
      text: "For each forecast year, the model projects customers and ARPU independently based on their respective growth assumptions. Revenue is calculated as:",
    },
    {
      type: "paragraph",
      text: "Revenue(t) = Customers(t) × ARPU(t) when ARPU basis is Annual; or Customers(t) × ARPU(t) × 12 when ARPU basis is Monthly.",
    },
    {
      type: "paragraph",
      text: "Both customers and ARPU are compounded year-over-year based on the selected growth pattern. The ×12 annualization applies to the monetization side only (not to customer counts).",
    },
    {
      type: "subheading",
      text: "How it behaves in the model",
    },
    {
      type: "list",
      items: [
        "Available only for direct forecast rows",
        "Can be combined with allocation or child-line structures",
        "Opening values are used as the base for first forecast year growth",
        "Growth is applied separately to customers and ARPU before multiplying",
      ],
    },
    {
      type: "subheading",
      text: "How it appears in the preview",
    },
    {
      type: "list",
      items: [
        "Revenue appears in the main table",
        "A separate \"Customers × ARPU Drivers\" section shows: Starting customers, Starting ARPU, first forecast-year customers and ARPU, and the selected ARPU basis (Monthly / Annual)",
        "ARPU is shown as absolute currency (not scaled to K/M)",
        "Customer counts are shown as real units",
      ],
    },
    {
      type: "subheading",
      text: "Common mistakes",
    },
    {
      type: "list",
      items: [
        "Entering monthly ARPU but leaving the basis on Annual — the model will understate revenue by roughly 12×",
        "Entering ARPU scaled to K/M instead of actual price per customer",
        "Mixing customer count with transaction volume (should use Price × Volume instead)",
        "Applying identical growth rates to customers and ARPU without justification",
        "Forgetting that ARPU reflects monetization, not pricing alone",
      ],
    },
  ]),

  section(
    "method_locations_revenue_per_location",
    "Locations × Revenue per Location",
    "Locations × Revenue per Location",
    [
      {
        type: "paragraph",
        text: "This method forecasts revenue as the number of locations multiplied by average revenue generated per location. It is useful for footprint-driven businesses such as retail, restaurants, clinics, branches, and gym networks.",
      },
      {
        type: "subheading",
        text: "When to use it",
      },
      {
        type: "list",
        items: [
          "Revenue is driven by location count and location productivity.",
          "You want to separate footprint expansion from per-location monetization.",
          "Location growth and revenue per location can move independently.",
        ],
      },
      {
        type: "subheading",
        text: "When not to use it",
      },
      {
        type: "list",
        items: [
          "Online-only or user-based models with no meaningful location driver.",
          "Unit-based transactional lines where Price × Volume is the correct structure.",
          "Cases where only top-line growth is available and no location-level assumptions exist.",
        ],
      },
      {
        type: "subheading",
        text: "Required inputs",
      },
      {
        type: "list",
        items: [
          "Starting locations (plain count, not scaled).",
          "Starting revenue per location (absolute currency per location, at the basis you choose below).",
          "Revenue per location basis: Monthly or Annual (default Annual — older saves without this field behave as Annual).",
          "Location growth assumptions (constant, by year, or phases).",
          "Revenue-per-location growth assumptions (constant, by year, or phases).",
          "Optional location unit label (e.g., stores, branches, clinics, restaurants).",
        ],
      },
      {
        type: "subheading",
        text: "Revenue per location basis (monthly vs annual)",
      },
      {
        type: "paragraph",
        text: "Footprint counts stay plain counts; only the monetization driver (revenue per location) carries a period basis. The model outputs annual revenue.",
      },
      {
        type: "list",
        items: [
          "Annual: Revenue(t) = Locations(t) × Revenue per Location(t).",
          "Monthly: Revenue(t) = Locations(t) × Revenue per Location(t) × 12 — monthly productivity is annualized.",
        ],
      },
      {
        type: "subheading",
        text: "Formula",
      },
      {
        type: "paragraph",
        text: "Revenue(t) = Locations(t) × Revenue per Location(t) when basis is Annual; or Locations(t) × Revenue per Location(t) × 12 when basis is Monthly.",
      },
      {
        type: "paragraph",
        text: "Both location count and revenue per location compound year-over-year based on their selected growth patterns.",
      },
      {
        type: "subheading",
        text: "How it behaves in the model",
      },
      {
        type: "list",
        items: [
          "Available only for direct forecast rows.",
          "Can coexist with allocation and child-line structures through the existing row-role framework.",
          "Opening inputs are used as the base for first forecast-year growth when needed.",
          "Growth is applied independently to locations and revenue per location before multiplying.",
        ],
      },
      {
        type: "subheading",
        text: "How it appears in the preview",
      },
      {
        type: "list",
        items: [
          "Revenue appears in the main table like other direct methods.",
          "A separate \"Locations × Revenue per Location Drivers\" section shows starting and first-year drivers and the selected revenue/location basis (Monthly / Annual).",
          "Revenue per location is shown as absolute currency (not K/M scaled).",
          "Location counts are shown as real units.",
        ],
      },
      {
        type: "subheading",
        text: "Common mistakes",
      },
      {
        type: "list",
        items: [
          "Entering monthly revenue per location but leaving the basis on Annual — output will read like weak annual productivity.",
          "Using this for online-only or user-based revenue where locations are not the driver.",
          "Confusing locations with units sold (use Price × Volume for units sold × price).",
          "Entering revenue per location in K/M-scaled form instead of absolute currency.",
          "Treating this method as explicit same-store-sales or openings/closures modeling in v1.",
        ],
      },
    ]
  ),

  section(
    "method_capacity_utilization_yield",
    "Capacity × Utilization × Yield",
    "Capacity × Utilization × Yield",
    [
      {
        type: "paragraph",
        text: "This method forecasts annual revenue as capacity × utilization (as a share of capacity) × yield per utilized unit. It fits businesses where revenue is constrained by how much capacity exists, how much of it is used, and what you earn on each utilized unit — manufacturing, airlines, hotels, energy, logistics, and seat/room/slot models.",
      },
      {
        type: "subheading",
        text: "When to use it",
      },
      {
        type: "list",
        items: [
          "Revenue is naturally bounded by operational capacity and utilization, not only by demand.",
          "You can articulate capacity, a utilization path (levels over time), and monetization per utilized unit.",
          "You want separation between adding capacity, operating usage, and pricing/yield power.",
        ],
      },
      {
        type: "subheading",
        text: "When NOT to use it",
      },
      {
        type: "list",
        items: [
          "Simple unit × price transactional revenue with no meaningful capacity concept — use Price × Volume.",
          "User or account count × ARPU — use Customers × ARPU.",
          "Footprint × revenue per site without a utilization construct — use Locations × Revenue per Location.",
          "You only have top-line growth and cannot define capacity, utilization, and yield credibly.",
        ],
      },
      {
        type: "subheading",
        text: "Required inputs",
      },
      {
        type: "list",
        items: [
          "Starting capacity (plain count: seats, rooms, MW, etc. — not K/M scaled).",
          "Starting utilization % (0–100), as a level.",
          "Starting yield: absolute currency per utilized unit, with a yield basis (Monthly or Annual; default Annual).",
          "Capacity growth (constant, by year, or phases).",
          "Utilization path: constant, by-year targets, or phased targets — always as % levels, not compounding “utilization growth %”.",
          "Yield growth (constant, by year, or phases).",
          "Optional capacity unit label.",
        ],
      },
      {
        type: "subheading",
        text: "Formula",
      },
      {
        type: "paragraph",
        text: "Revenue(t) = Capacity(t) × (Utilization(t) ÷ 100) × Yield(t). If yield basis is Monthly, multiply by 12 to annualize yield. Capacity and utilization are not given a monthly/annual ambiguity in v1 — only yield carries the period basis.",
      },
      {
        type: "subheading",
        text: "How the model behaves",
      },
      {
        type: "list",
        items: [
          "Capacity and yield compound using their growth patterns year over year.",
          "Utilization is resolved as an explicit % level each year (constant, by year, or from phases) — it does not chain-multiply like a growth rate.",
          "Direct forecast rows only; not available on derived or allocation rows.",
          "Historicals are unchanged; opening basis for preview uses starting capacity × starting utilization × starting yield (with yield basis multiplier).",
        ],
      },
      {
        type: "subheading",
        text: "How it appears in the preview",
      },
      {
        type: "list",
        items: [
          "Main revenue table shows projected revenue; forecast-only lines may show a Base in the last actual column from the opening basis.",
          "Revenue Growth can use that opening base when no true last actual exists, with the same alternate treatment as other opening-base methods.",
          "A \"Capacity × Utilization × Yield Drivers\" block lists starting capacity, utilization, yield, and first forecast-year capacity, utilization, and yield (no duplicate revenue column).",
        ],
      },
      {
        type: "subheading",
        text: "Common mistakes",
      },
      {
        type: "list",
        items: [
          "Treating utilization as a compounding growth rate — it must be a level/target % each year.",
          "Entering yield in K/M display form instead of real currency per utilized unit.",
          "Setting utilization above 100% or confusing 100% capacity with unconstrained demand.",
          "Using this where Price × Volume (units × price) is the clearer operational story.",
          "Confusing capacity with demand — capacity is what could be served; utilization is how much of that you actually use.",
        ],
      },
    ]
  ),

  section("method_contracts_acv", "Contracts × ACV", "Contracts × ACV", [
    {
      type: "paragraph",
      text: "This method forecasts revenue as the number of contracts (or accounts) multiplied by ACV — Annual Contract Value — per contract. It is designed for B2B / enterprise models where revenue scales with contracted accounts and the average annual value per contract.",
    },
    {
      type: "subheading",
      text: "What is ACV?",
    },
    {
      type: "paragraph",
      text: "ACV (Annual Contract Value) is the annualized revenue attributed to a single contract in this line’s definition. It is entered as annual dollars per contract, not as a monthly rate that needs a basis toggle—this is intentional to avoid the monthly/annual ambiguity that can affect other monetization drivers.",
    },
    {
      type: "subheading",
      text: "When to use it",
    },
    {
      type: "list",
      items: [
        "Enterprise or account-based recurring revenue where contract count and ACV are the clearest drivers.",
        "B2B SaaS, managed services, or subscription businesses framed around contracts and annual value.",
        "You want the same two-driver growth mechanics as Price × Volume, but with contract/account semantics.",
      ],
    },
    {
      type: "subheading",
      text: "When NOT to use it",
    },
    {
      type: "list",
      items: [
        "Purely transactional revenue with units × price and no contract/account framing — use Price × Volume.",
        "User monetization where ARPU is the natural label — use Customers × ARPU.",
        "You need a monthly monetization driver with a basis selector — choose ARPU (or another method), not this one.",
        "You only have top-line growth and cannot define contracts and ACV credibly.",
      ],
    },
    {
      type: "subheading",
      text: "Required inputs",
    },
    {
      type: "list",
      items: [
        "Starting number of contracts (plain count).",
        "Starting ACV: annual absolute currency per contract (not K/M scaled).",
        "Contract growth and ACV growth, each as constant, by year, or phases.",
        "Optional contract unit label (e.g., contracts, enterprise accounts, agreements).",
      ],
    },
    {
      type: "subheading",
      text: "Formula",
    },
    {
      type: "paragraph",
      text: "Revenue(t) = Contracts(t) × ACV(t). First forecast year: each side applies growth for that year to the starting level; later years compound each side from the prior year’s projected level using that year’s growth rates, then multiply.",
    },
    {
      type: "subheading",
      text: "How it behaves in the model",
    },
    {
      type: "list",
      items: [
        "Direct forecast rows only. No change to historical actuals.",
        "Same growth-resolution architecture as Price × Volume (two independent growth series).",
        "Opening basis for preview uses starting contracts × starting ACV when no last actual exists for a forecast-only line.",
      ],
    },
    {
      type: "subheading",
      text: "How it appears in the preview",
    },
    {
      type: "list",
      items: [
        "Main revenue table shows projected revenue; Base may appear in the last actual column from the opening basis when applicable.",
        "A \"Contracts × ACV Drivers\" block shows starting contracts, starting ACV, and first-year contracts and ACV after growth (no duplicate revenue column).",
        "Counts and ACV are shown as real units and absolute currency, not statement K/M.",
      ],
    },
    {
      type: "subheading",
      text: "Common mistakes",
    },
    {
      type: "list",
      items: [
        "Treating ACV as a monthly rate — ACV is annual by definition in this method.",
        "Entering ACV in K/M display form instead of real annual dollars per contract.",
        "Using this for transaction-heavy volume × price businesses where Price × Volume is clearer.",
        "Using this when ARPU is the more natural metric for your user base.",
        "Confusing contract count with generic unit volume (units sold vs. contracted accounts).",
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
];

export const COGS_OPEX_GUIDE_SECTIONS: GuideSection[] = [
  section("overview", "Overview", "COGS & Operating Expenses overview", [
    {
      type: "paragraph",
      text: "This subsection is where cost-side forecasting is staged. In Phase 1, the app focuses on COGS detection and routing from historical structure. Historical values are read-only context and are not overwritten here.",
    },
    {
      type: "list",
      items: [
        "Revenue remains read-only context in preview.",
        "Detected COGS lines are surfaced for review and upcoming method setup.",
        "Operating Expenses methods are intentionally deferred to a later phase.",
      ],
    },
  ]),
  section("what_is_cogs", "What is COGS?", "What is COGS?", [
    {
      type: "paragraph",
      text: "COGS represents direct costs required to deliver revenue (for example materials, direct labor, delivery/fulfillment, hosting, infrastructure, or revenue-share type costs depending on the business model).",
    },
    {
      type: "callout",
      tone: "note",
      title: "Modeling boundary",
      text: "COGS should capture direct delivery economics. Indirect overhead, corporate costs, and most SG&A items should remain outside COGS unless your reporting structure clearly places them there.",
    },
  ]),
  section("cogs_vs_opex", "COGS vs OpEx", "How COGS differs from Operating Expenses", [
    {
      type: "list",
      items: [
        "COGS: directly tied to producing/delivering revenue.",
        "Operating Expenses: selling, corporate, R&D, and broader operating overhead.",
        "Some labels can be ambiguous by company; use review flags before forcing a classification.",
      ],
    },
  ]),
  section("detection", "Historical detection", "How COGS lines are detected from historicals", [
    {
      type: "paragraph",
      text: "Detection uses a conservative hybrid approach: strong COGS label matches first, then statement position context (below Revenue and before Gross Profit where available), with ambiguous lines routed to Review instead of forced classification.",
    },
    {
      type: "list",
      items: [
        "Deterministic label patterns (e.g., cost of sales, fulfillment, hosting, direct labor).",
        "Position-aware signals from the historical income statement layout.",
        "Ambiguous, non-recurring, or likely schedule-derived items routed to Review.",
      ],
    },
  ]),
  section("what_to_forecast_here", "What to forecast here", "What should be forecasted here vs derived elsewhere", [
    {
      type: "list",
      items: [
        "Forecast here: recurring, direct cost lines that management treats as COGS drivers.",
        "Likely derived elsewhere: depreciation/amortization, interest, and unusual one-off restructuring/impairment items.",
        "When uncertain, keep the line in Review and confirm treatment before assigning a method.",
      ],
    },
  ]),
  section("methods", "COGS methods", "COGS forecasting methods", [
    {
      type: "paragraph",
      text: "Each forecastable COGS line links to a revenue stream. Choose a method that matches how cost scales with that revenue: % of Revenue for margin-style economics, Cost per Unit for Price × Volume, Cost per Customer for Customers × ARPU, Cost per Contract for Contracts × ACV, Cost per Location for Locations × Revenue per Location, or Cost per Utilized Unit for Capacity × Utilization × Yield.",
    },
  ]),
  section("cogs_pct_revenue", "% of Revenue", "COGS · % of Revenue", [
    {
      type: "paragraph",
      text: "Forecasts COGS as a percentage of the linked revenue line each year. Use when a stable margin assumption is more practical than unit economics, or when the revenue method is not unit-based.",
    },
  ]),
  section("cogs_cost_per_unit", "Cost per Unit", "COGS · Cost per Unit", [
    {
      type: "paragraph",
      text: "Forecasts COGS as linked revenue volume × a projected cost per unit each year: COGS(t) = Volume(t) × Cost per Unit(t). Volume is taken automatically from the linked revenue row’s Price × Volume driver (starting volume and volume growth). You only enter starting cost per unit and how that cost per unit grows (constant %, by year, or phases).",
    },
    {
      type: "list",
      items: [
        "Use when the linked revenue line is Price × Volume and direct cost scales with units sold, produced, or delivered.",
        "Do not use when the linked line is Customers × ARPU, Contracts × ACV, Locations × Revenue per Location, Capacity × Utilization × Yield, or other non–unit×price methods — use the matching driver-linked COGS method instead.",
        "Required inputs: starting cost per unit (absolute currency per unit, not K/M statement scaling) and a growth pattern for cost per unit.",
      ],
    },
    {
      type: "paragraph",
      text: "First forecast year: cost per unit after growth = Starting cost per unit × (1 + growth% for that year). Later years compound on the prior year’s projected cost per unit. Revenue and volume math are unchanged; COGS only reads the volume path from the revenue config.",
    },
    {
      type: "paragraph",
      text: "In the COGS & Operating Expenses preview, configured lines appear in the COGS table. The Cost per Unit Drivers block (when relevant) shows starting volume, starting cost per unit, and first–forecast-year volume and cost per unit for audit. Opening revenue bridge logic for gross profit consistency uses starting revenue volume × starting cost per unit as the COGS-side opening basis concept for those lines in preview (read-only; nothing is written back to revenue or historicals).",
    },
    {
      type: "subheading",
      text: "Common mistakes",
    },
    {
      type: "list",
      items: [
        "Re-entering or overriding volume in the COGS card — volume must stay in the revenue Price × Volume driver.",
        "Entering cost per unit in K/M-scaled statement units instead of true currency per unit.",
        "Choosing Cost per Unit when the linked revenue row is not Price × Volume (the method is gated in the selector; saved configs if the revenue method later changes may need a different COGS method).",
        "Treating cost per unit as a gross margin percent — use % of Revenue if margin on revenue is the right story.",
      ],
    },
  ]),
  section("cogs_cost_per_customer", "Cost per Customer", "COGS · Cost per Customer", [
    {
      type: "paragraph",
      text: "Forecasts COGS as linked revenue customer count × a projected annual cost per customer each year: COGS(t) = Customers(t) × Cost per Customer(t). Customer counts and growth follow the linked revenue row’s Customers × ARPU driver. You set Cost basis (monthly or annual) for your starting cost input — it defaults to match the linked row’s ARPU basis and you can override. Growth % applies to the annual cost series after that basis is normalized. Do not re-enter customers, ARPU, or ARPU growth in COGS.",
    },
    {
      type: "list",
      items: [
        "Use when the linked revenue line is Customers × ARPU and direct cost scales with the customer or subscriber base.",
        "Do not use when the linked line is Price × Volume, Contracts × ACV, Locations × Revenue per Location, Capacity × Utilization × Yield, or plain growth/manual-only revenue — those methods have their own matching COGS approaches.",
        "Required inputs: cost basis (monthly vs annual), starting cost per customer in that basis (absolute currency, not K/M statement scaling), and a growth pattern for cost per customer.",
      ],
    },
    {
      type: "paragraph",
      text: "Implied gross margin at start compares annual revenue per customer (ARPU, annualized when ARPU is monthly) to annual cost per customer (your entered cost ×12 when cost basis is monthly). The Revenue Driver Context shows ARPU with “/ month” or “/ year” and implied starting revenue as annualized.",
    },
    {
      type: "paragraph",
      text: "Internally, starting cost is converted to an annual $/customer before YoY growth is applied. First forecast year: annual cost after growth = annual starting cost × (1 + growth % for that year), compounding each year. Revenue and customer math are unchanged; COGS only reads the customer path from the revenue config.",
    },
    {
      type: "paragraph",
      text: "In the COGS & Operating Expenses preview, configured lines appear in the COGS table. The Cost per Customer Drivers audit block shows starting cost with “/ month” or “/ year” per your cost basis, and first–forecast-year cost per customer as annual $/customer (matching the internal COGS math).",
    },
    {
      type: "subheading",
      text: "Common mistakes",
    },
    {
      type: "list",
      items: [
        "Re-entering customer counts or ARPU in the COGS card — those stay in Revenue.",
        "Entering cost per customer using K/M-scaled statement units instead of true currency per customer.",
        "Confusing cost per customer with % of revenue — use % of Revenue when margin on revenue is the right story.",
        "Wrong Cost basis vs. what you typed (e.g. entering an annual figure while Monthly is selected) — check the label on the starting cost field and the implied margin callout.",
        "Using Cost per Customer when the linked revenue row is not Customers × ARPU (the method is gated in the selector; if the revenue method later changes, saved Cost per Customer configs remain editable but preview context may not resolve until drivers match).",
      ],
    },
  ]),
  section("cogs_cost_per_contract", "Cost per Contract", "COGS · Cost per Contract", [
    {
      type: "paragraph",
      text: "Forecasts COGS as linked revenue contract count × a projected cost per contract each year: COGS(t) = Contracts(t) × Cost per Contract(t). Contract counts and contract growth follow the linked revenue row’s Contracts × ACV driver. ACV and ACV growth are read-only context from Revenue. You enter starting cost per contract and how that cost per contract grows (constant %, by year, or phases). Do not re-enter contracts, ACV, or growth legs in COGS.",
    },
    {
      type: "list",
      items: [
        "Use when the linked revenue line is Contracts × ACV and direct cost scales with active contracts or accounts.",
        "Do not use when the linked line is Price × Volume, Customers × ARPU, Locations × Revenue per Location, Capacity × Utilization × Yield, or plain growth/manual-only revenue.",
        "Required inputs: starting cost per contract (absolute currency per contract, not K/M statement scaling) and a growth pattern for cost per contract.",
      ],
    },
    {
      type: "paragraph",
      text: "ACV in Revenue is annual contract value by definition; the builder shows it only to align implied starting revenue (contracts × ACV) and the implied gross margin sanity check: (Starting ACV − cost per contract) / Starting ACV.",
    },
    {
      type: "paragraph",
      text: "First forecast year: cost per contract after growth = Starting cost per contract × (1 + growth % for that year). Later years compound on the prior year’s projected cost per contract. Revenue and contract/ACV math are unchanged; COGS only reads the contract count path from the revenue config.",
    },
    {
      type: "paragraph",
      text: "In the COGS & Operating Expenses preview, configured lines appear in the COGS table. The Cost per Contract Drivers audit block (when relevant) shows starting contracts, starting cost per contract, and first–forecast-year contracts and cost per contract. For gross bridge consistency in preview, the COGS-side opening basis concept for this method is starting contracts × starting cost per contract (read-only; nothing is written to revenue or historicals).",
    },
    {
      type: "subheading",
      text: "Common mistakes",
    },
    {
      type: "list",
      items: [
        "Re-entering contract counts or ACV in the COGS card — those stay in Revenue.",
        "Using K/M-scaled statement units for cost per contract instead of true currency per contract.",
        "Confusing cost per contract with % of revenue — use % of Revenue when margin on revenue is the right story.",
        "Forgetting that ACV is annual by definition while mis-scaling cost per contract relative to that frame.",
        "Using Cost per Contract when the linked revenue row is not Contracts × ACV (the method is gated in the selector; if the revenue method later changes, saved configs remain editable but preview context may not resolve until drivers match).",
      ],
    },
  ]),
  section("cogs_cost_per_location", "Cost per Location", "COGS · Cost per Location", [
    {
      type: "paragraph",
      text: "Forecasts COGS as linked revenue location count × a projected cost per location each year: COGS(t) = Locations(t) × Cost per Location(t). Location counts and location growth follow the linked revenue row’s Locations × Revenue per Location driver. Revenue per location and its basis (monthly vs annual) are read-only context from Revenue. You enter starting cost per location and how that cost per location grows (constant %, by year, or phases). Do not re-enter locations, revenue per location, or growth legs in COGS.",
    },
    {
      type: "list",
      items: [
        "Use when the linked revenue line is Locations × Revenue per Location and direct cost scales with stores, sites, branches, or other active locations.",
        "Do not use when the linked line is Price × Volume, Customers × ARPU, Contracts × ACV, Capacity × Utilization × Yield, or plain growth/manual-only revenue.",
        "Required inputs: starting cost per location (absolute currency per location, not K/M statement scaling) and a growth pattern for cost per location.",
      ],
    },
    {
      type: "paragraph",
      text: "Revenue per location basis in Revenue (monthly vs annual) affects implied starting revenue and the “Implied Gross Margin at Start” context: effective revenue per location is the stored starting revenue per location when annual, or ×12 when monthly. Enter cost per location in the annualized economic frame you intend to model so it aligns with how you read the implied margin.",
    },
    {
      type: "paragraph",
      text: "First forecast year: cost per location after growth = Starting cost per location × (1 + growth % for that year). Later years compound on the prior year’s projected cost per location. Revenue and location/revenue-per-location math are unchanged; COGS only reads the location count path from the revenue config.",
    },
    {
      type: "paragraph",
      text: "In the COGS & Operating Expenses preview, configured lines appear in the COGS table. The Cost per Location Drivers audit block (when relevant) shows starting locations, starting cost per location, and first–forecast-year locations and cost per location. For gross bridge consistency in preview, the COGS-side opening basis concept for this method is starting locations × starting cost per location (read-only; nothing is written to revenue or historicals).",
    },
    {
      type: "subheading",
      text: "Common mistakes",
    },
    {
      type: "list",
      items: [
        "Re-entering location counts or revenue per location in the COGS card — those stay in Revenue.",
        "Entering cost per location using K/M-scaled statement units instead of true currency per location.",
        "Confusing cost per location with % of revenue — use % of Revenue when margin on revenue is the right story.",
        "Mismatching economic period: Revenue may annualize monthly revenue per location while you enter cost per location on a different implicit period — keep the frame consistent with how you read the implied margin context.",
        "Using Cost per Location when the linked revenue row is not Locations × Revenue per Location (the method is gated in the selector; if the revenue method later changes, saved configs remain editable but preview context may not resolve until drivers match).",
      ],
    },
  ]),
  section("cogs_cost_per_utilized_unit", "Cost per Utilized Unit", "COGS · Cost per Utilized Unit", [
    {
      type: "paragraph",
      text: "Forecasts COGS as utilized units × a projected cost per utilized unit each year: COGS(t) = Utilized Units(t) × Cost per Utilized Unit(t). Utilized units follow the same capacity and utilization level path as the linked revenue row’s Capacity × Utilization × Yield driver (capacity growth and utilization as a level, not compounded in COGS). Yield and yield basis are read-only context from Revenue for implied starting revenue and implied gross margin at start. You enter starting cost per utilized unit and how that cost grows (constant %, by year, or phases). Do not re-enter capacity, utilization, yield, or yield growth in COGS.",
    },
    {
      type: "list",
      items: [
        "Use when the linked revenue line is Capacity × Utilization × Yield and direct cost scales with utilized capacity (actual usage), not only installed capacity.",
        "Do not use when the linked line is Price × Volume, Customers × ARPU, Contracts × ACV, Locations × Revenue per Location, or plain growth/manual-only revenue — use the matching driver-linked COGS method or % of Revenue instead.",
        "Required inputs: starting cost per utilized unit (absolute currency per utilized unit, not K/M statement scaling) and a growth pattern for cost per utilized unit.",
      ],
    },
    {
      type: "paragraph",
      text: "Yield basis (monthly vs annual) affects implied starting revenue and the “Implied Gross Margin at Start” context: effective yield is the stored starting yield when annual, or ×12 when monthly, matching how Revenue annualizes for the model frame.",
    },
    {
      type: "paragraph",
      text: "First forecast year: cost per utilized unit after growth = Starting cost per utilized unit × (1 + growth % for that year). Later years compound on the prior year’s projected cost per utilized unit. Revenue, capacity, utilization, and yield math are unchanged; COGS reads the utilized-units path from the revenue driver projection only.",
    },
    {
      type: "paragraph",
      text: "In the COGS & Operating Expenses preview, configured lines appear in the COGS table. The Cost per Utilized Unit Drivers audit block (when relevant) shows the linked revenue line, starting utilized units, starting cost per utilized unit, and first–forecast-year utilized units and cost per utilized unit. For gross bridge consistency in preview, the COGS-side opening basis concept for this method is starting utilized units × starting cost per utilized unit (read-only; nothing is written to revenue or historicals).",
    },
    {
      type: "subheading",
      text: "Common mistakes",
    },
    {
      type: "list",
      items: [
        "Re-entering capacity, utilization %, or yield in the COGS card — those stay in Revenue.",
        "Entering cost per utilized unit using K/M-scaled statement units instead of true currency per utilized unit.",
        "Confusing cost per utilized unit with % of revenue — use % of Revenue when margin on revenue is the right story.",
        "Treating utilization as a growth rate in COGS — utilization is a level series resolved from Revenue; COGS does not compound utilization.",
        "Using Cost per Utilized Unit when the linked revenue row is not Capacity × Utilization × Yield (the method is gated in the selector; if the revenue method later changes, saved configs remain editable but utilized-unit preview context may no longer resolve correctly).",
      ],
    },
  ]),
  section("review_items", "Review items", "Review / non-recurring items", [
    {
      type: "paragraph",
      text: "Review Items flag lines that are ambiguous, potentially non-recurring, or likely schedule-driven. Treat these as routing decisions first, then forecast-method decisions second.",
    },
  ]),
];

export const FORECAST_GUIDE_CONTENT: Record<
  ForecastDriversSubTab,
  ForecastGuideTabBundle
> = {
  revenue: { kind: "sections", sections: REVENUE_GUIDE_SECTIONS },
  operating_costs: { kind: "sections", sections: COGS_OPEX_GUIDE_SECTIONS },
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
