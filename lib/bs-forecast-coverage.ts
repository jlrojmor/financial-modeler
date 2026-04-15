/**
 * Single mapping from BS row → Forecast Coverage (Projected Statements) surface.
 * Uses forecast-routing (taxonomy-aware) so labels stay aligned with WC vs Other BS vs schedules.
 */

import type { Row } from "@/types/finance";
import type { ForecastDriversSubTab } from "@/store/useModelStore";
import { getForecastRoutingState } from "@/lib/forecast-routing";

export type BsCoverageStatus =
  | "forecasted"
  | "schedule"
  | "derived"
  | "not_configured"
  | "cash_plug";

export type BsLineCoverage = {
  status: BsCoverageStatus;
  source: string;
  jumpTo: { step: "forecast_drivers"; subTab: ForecastDriversSubTab } | null;
};

export function getBsLineCoverage(
  row: Row,
  opts: {
    wcDriversConfirmed: boolean;
    dandaScheduleConfirmed: boolean;
    debtApplied: boolean;
    equityRollforwardConfirmed: boolean;
    otherBsConfirmed: boolean;
  }
): BsLineCoverage {
  const tt = row.taxonomyType as string | undefined;

  if (tt === "asset_cash" || row.id === "cash") {
    return { status: "cash_plug", source: "CFS closure (auto-derived)", jumpTo: null };
  }

  if (tt === "equity_retained_earnings" || row.id === "retained_earnings") {
    return {
      status: opts.equityRollforwardConfirmed ? "derived" : "not_configured",
      source: opts.equityRollforwardConfirmed ? "NI − Dividends (auto)" : "Equity Roll-Forward (not set)",
      jumpTo: { step: "forecast_drivers", subTab: "other_bs_items" },
    };
  }

  if (tt === "equity_common_stock" || tt === "equity_apic" || tt === "equity_treasury_stock") {
    return {
      status: opts.equityRollforwardConfirmed ? "schedule" : "not_configured",
      source: opts.equityRollforwardConfirmed ? "Equity Roll-Forward" : "Equity Roll-Forward (not set)",
      jumpTo: { step: "forecast_drivers", subTab: "other_bs_items" },
    };
  }

  const r = getForecastRoutingState(row, "balanceSheet");

  switch (r.owner) {
    case "working_capital_schedule":
      return {
        status: opts.wcDriversConfirmed ? "forecasted" : "not_configured",
        source: opts.wcDriversConfirmed ? "Working Capital Drivers" : "WC Drivers (not set)",
        jumpTo: { step: "forecast_drivers", subTab: "wc_drivers" },
      };
    case "capex_schedule":
      return {
        status: opts.dandaScheduleConfirmed ? "schedule" : "not_configured",
        source: opts.dandaScheduleConfirmed ? "PP&E / Capex Schedule" : "Capex Schedule (not set)",
        jumpTo: { step: "forecast_drivers", subTab: "non_operating_schedules" },
      };
    case "intangibles_schedule":
      return {
        status: opts.dandaScheduleConfirmed ? "schedule" : "not_configured",
        source: opts.dandaScheduleConfirmed ? "Intangibles / Amort Schedule" : "Amort Schedule (not set)",
        jumpTo: { step: "forecast_drivers", subTab: "non_operating_schedules" },
      };
    case "debt_schedule":
      return {
        status: opts.debtApplied ? "schedule" : "not_configured",
        source: opts.debtApplied ? "Debt Schedule" : "Debt Schedule (not set)",
        jumpTo: { step: "forecast_drivers", subTab: "non_operating_schedules" },
      };
    case "derived":
      return {
        status: "derived",
        source: "Derived (balance sheet)",
        jumpTo: null,
      };
    default:
      return {
        status: opts.otherBsConfirmed ? "forecasted" : "not_configured",
        source: opts.otherBsConfirmed ? "Other BS Items" : "Other BS Items (not set)",
        jumpTo: { step: "forecast_drivers", subTab: "other_bs_items" },
      };
  }
}
