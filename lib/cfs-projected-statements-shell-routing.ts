/**
 * Taxonomy- and id-driven Forecast Drivers routing for Projected Statements CFS builder lines.
 */

import type { Row } from "@/types/finance";
import type { ForecastDriversSubTab } from "@/store/useModelStore";
import type { CfsDisclosureProjectionSpec } from "@/lib/cfs-disclosure-projection";
import { cfsWcChildIdToBalanceSheetId } from "@/lib/working-capital-schedule";
import { classifyCfsLineForProjection } from "@/lib/cfs-line-classification";
import { isCfsComputedRollupRowId } from "@/lib/cfs-structural-row-ids";
import { isOtherBsSyntheticCfsRowId } from "@/lib/other-bs-cfs-bridge";

export type CfsShellForecastStatus = "forecasted" | "schedule" | "derived" | "not_configured" | "cash_plug" | "excluded";

export interface CfsRoutingContext {
  wcDriversConfirmed: boolean;
  dandaScheduleConfirmed: boolean;
  capexModelIntangibles: boolean;
  debtApplied: boolean;
  equityRollforwardConfirmed: boolean;
  otherBsConfirmed: boolean;
  wcScheduleRowIds: Set<string>;
  balanceSheet: Row[];
  disclosureProjectionByRowId: Record<string, CfsDisclosureProjectionSpec>;
}

export interface CfsLineRoutingResult {
  status: CfsShellForecastStatus;
  source: string;
  jumpTo: { step: "forecast_drivers"; subTab: ForecastDriversSubTab } | null;
}

const NON_OP: ForecastDriversSubTab = "non_operating_schedules";
const WC_TAB: ForecastDriversSubTab = "wc_drivers";
const OTHER_BS: ForecastDriversSubTab = "other_bs_items";
const CFS_DISCLOSURE_TAB: ForecastDriversSubTab = "cfs_disclosure";

/**
 * CFS rows that must appear in the Projected Statements builder even when `kind` is `calc` or `total`
 * (template hides most calc/total lines from coverage; these are the IB anchors).
 */
export const CFS_BUILDER_ANCHOR_ROW_IDS = new Set([
  "net_income",
  "sbc",
  "operating_cf",
  "investing_cf",
  "financing_cf",
  "net_change_cash",
  "net_cash_change",
  "total_operating_cf",
  "total_investing_cf",
  "total_financing_cf",
]);

/**
 * Resolve coverage status / source / jump for one CFS line.
 * `row` may be null for synthetic WC lines (`cfo_${bsId}` only on schedule).
 */
export function getCfsProjectedStatementLineRouting(
  row: Row | null,
  lineId: string,
  ctx: CfsRoutingContext
): CfsLineRoutingResult {
  const tt = (row?.taxonomyType as string | undefined) ?? undefined;

  let status: CfsShellForecastStatus = "derived";
  let source = "Auto-derived from IS/BS";
  let jumpTo: CfsLineRoutingResult["jumpTo"] = null;

  if (isOtherBsSyntheticCfsRowId(lineId)) {
    if (ctx.otherBsConfirmed) {
      source = "Other BS items (Forecast Drivers)";
      jumpTo = { step: "forecast_drivers", subTab: OTHER_BS };
      status = "schedule";
    } else {
      status = "not_configured";
      source = "Confirm Other BS Items in Forecast Drivers to show BS cash bridges.";
      jumpTo = { step: "forecast_drivers", subTab: OTHER_BS };
    }
    return { status, source, jumpTo };
  }

  if (row && classifyCfsLineForProjection(row, ctx.balanceSheet ?? []) === "cf_disclosure_only") {
    const policy = ctx.disclosureProjectionByRowId[row.id];
    if (!policy) {
      status = "not_configured";
      source =
        "Issuer CF disclosure — choose a projection policy in Forecast Drivers (Cash flow disclosure) or map to BS/IS in Historicals.";
      jumpTo = { step: "forecast_drivers", subTab: CFS_DISCLOSURE_TAB };
    } else if (policy.mode === "excluded") {
      status = "excluded";
      source = "Excluded from forecast (rollup / immaterial)";
      jumpTo = null;
    } else {
      status = "forecasted";
      source =
        policy.mode === "flat_last_historical"
          ? "CF disclosure: flat to last historical actual"
          : policy.mode === "pct_of_revenue"
            ? `CF disclosure: ${policy.pct.toFixed(2)}% of revenue`
            : policy.mode === "manual_by_year"
              ? "CF disclosure: manual by year"
              : policy.mode === "zero"
                ? "CF disclosure: forced to zero"
                : "CF disclosure policy";
      jumpTo = { step: "forecast_drivers", subTab: CFS_DISCLOSURE_TAB };
    }
    return { status, source, jumpTo };
  }

  if (tt === "cfo_net_income" || lineId === "net_income") {
    source = "From Income Statement";
  } else if (lineId === "danda" || tt === "cfo_danda") {
    source = ctx.dandaScheduleConfirmed
      ? "PP&E, Capex & D&A Schedule"
      : "Non-operating & Schedules";
    jumpTo = { step: "forecast_drivers", subTab: NON_OP };
    status = ctx.dandaScheduleConfirmed ? "schedule" : "derived";
  } else if (tt === "cfo_da" || tt === "cfo_sbc" || lineId === "sbc" || lineId === "da") {
    if (ctx.equityRollforwardConfirmed && (lineId === "sbc" || tt === "cfo_sbc")) {
      source = "Equity roll-forward (Other BS) / IS";
      jumpTo = { step: "forecast_drivers", subTab: OTHER_BS };
      status = "schedule";
    } else {
      source = ctx.dandaScheduleConfirmed ? "From schedules" : "From IS/BS changes";
      jumpTo = { step: "forecast_drivers", subTab: NON_OP };
      status = ctx.dandaScheduleConfirmed ? "schedule" : "derived";
    }
  } else if (
    ctx.wcScheduleRowIds.has(lineId) ||
    (lineId.startsWith("cfo_") && ctx.wcScheduleRowIds.has(cfsWcChildIdToBalanceSheetId(lineId)))
  ) {
    source = ctx.wcDriversConfirmed ? "WC Schedule (Forecast Drivers)" : "WC drivers";
    jumpTo = { step: "forecast_drivers", subTab: WC_TAB };
    status = ctx.wcDriversConfirmed ? "schedule" : "derived";
  } else if (tt?.startsWith("cfo_wc_") || lineId === "wc_change") {
    source = ctx.wcDriversConfirmed ? "From WC Drivers" : "From BS changes";
    jumpTo = { step: "forecast_drivers", subTab: WC_TAB };
    status = ctx.wcDriversConfirmed ? "schedule" : "derived";
  } else if (tt === "cfi_capex" || lineId === "capex") {
    source = ctx.dandaScheduleConfirmed ? "From Capex Schedule" : "From BS changes";
    jumpTo = { step: "forecast_drivers", subTab: NON_OP };
    status = ctx.dandaScheduleConfirmed ? "schedule" : "derived";
  } else if (lineId === "additions_to_intangibles") {
    const intangOn = ctx.dandaScheduleConfirmed && ctx.capexModelIntangibles;
    source = intangOn
      ? "From Capex & Intangibles (D&A schedule)"
      : "Enable intangibles in Capex & D&A schedule to project this line.";
    jumpTo = { step: "forecast_drivers", subTab: NON_OP };
    status = intangOn ? "schedule" : "not_configured";
  } else if (lineId === "acquisitions") {
    source = "M&A / acquisitions (manual in Forecast Drivers)";
    jumpTo = { step: "forecast_drivers", subTab: NON_OP };
    status = "not_configured";
  } else if (lineId === "asset_sales" || lineId === "investments" || lineId === "other_investing") {
    source =
      lineId === "asset_sales"
        ? "Asset sales (manual)"
        : lineId === "investments"
          ? "Investments (manual)"
          : "Other investing (manual)";
    jumpTo = { step: "forecast_drivers", subTab: NON_OP };
    status = "not_configured";
  } else if (lineId === "debt_issued") {
    source = ctx.debtApplied ? "From Debt Schedule" : "Not linked yet";
    status = ctx.debtApplied ? "derived" : "not_configured";
    jumpTo = { step: "forecast_drivers", subTab: NON_OP };
  } else if (lineId === "debt_repaid" || lineId === "cash_interest_paid") {
    source = ctx.debtApplied ? "From Debt Schedule" : "Not linked yet";
    status = ctx.debtApplied ? "derived" : "not_configured";
    jumpTo = { step: "forecast_drivers", subTab: NON_OP };
  } else if (lineId === "equity_issued") {
    source = ctx.equityRollforwardConfirmed ? "From Equity Roll-Forward" : "Not linked yet";
    status = ctx.equityRollforwardConfirmed ? "derived" : "not_configured";
    jumpTo = { step: "forecast_drivers", subTab: OTHER_BS };
  } else if (lineId === "share_repurchases" || lineId === "dividends") {
    source = ctx.equityRollforwardConfirmed ? "From Equity Roll-Forward" : "Not linked yet";
    status = ctx.equityRollforwardConfirmed ? "derived" : "not_configured";
    jumpTo = { step: "forecast_drivers", subTab: OTHER_BS };
  } else if (lineId === "other_financing") {
    source = "Other financing (manual)";
    jumpTo = { step: "forecast_drivers", subTab: NON_OP };
    status = "not_configured";
  } else if (lineId === "fx_effect_on_cash") {
    source = "FX / other cash bridge (manual)";
    jumpTo = { step: "forecast_drivers", subTab: NON_OP };
    status = "not_configured";
  } else if (tt?.startsWith("cff_")) {
    if (tt === "cff_dividends" || tt === "cff_share_repurchases") {
      source = ctx.equityRollforwardConfirmed ? "From Equity Roll-Forward" : "Not linked yet";
      status = ctx.equityRollforwardConfirmed ? "derived" : "not_configured";
      jumpTo = { step: "forecast_drivers", subTab: OTHER_BS };
    } else if (tt === "cff_debt_issued" || tt === "cff_debt_repaid") {
      source = ctx.debtApplied ? "From Debt Schedule" : "Not linked yet";
      status = ctx.debtApplied ? "derived" : "not_configured";
      jumpTo = { step: "forecast_drivers", subTab: NON_OP };
    } else {
      source = "Financing flow";
      jumpTo = { step: "forecast_drivers", subTab: NON_OP };
    }
  } else if (isCfsComputedRollupRowId(lineId)) {
    source = "Computed (CFS totals)";
    status = "derived";
    jumpTo = null;
  } else if (lineId === "other_operating") {
    source = "Deferred tax / engine merge + child lines";
    status = "derived";
    jumpTo = { step: "forecast_drivers", subTab: NON_OP };
  } else if (tt === "cfo_other") {
    source =
      row?.cfsForecastDriver === "disclosure_or_assumption"
        ? "Embedded disclosure / assumption"
        : "Other operating (manual or BS-linked bridge in Historicals)";
    status = row?.cfsForecastDriver === "disclosure_or_assumption" ? "schedule" : "not_configured";
    jumpTo = { step: "forecast_drivers", subTab: OTHER_BS };
  } else if (
    row?.cfsLink?.section === "operating" &&
    lineId !== "net_income" &&
    lineId !== "danda" &&
    lineId !== "sbc" &&
    lineId !== "wc_change" &&
    !lineId.startsWith("cfo_")
  ) {
    source = "Balance sheet bridge or manual CFS line (confirm in Historicals)";
    status = row?.cfsLink.impact === "calculated" ? "derived" : "not_configured";
    jumpTo = { step: "forecast_drivers", subTab: OTHER_BS };
  }

  return { status, source, jumpTo };
}
