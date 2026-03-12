/**
 * Phase 2 Forecast Routing Layer
 *
 * Single source of truth for "where should this row's forecasted value come from?"
 * Metadata-driven; row ID used only as fallback for deterministic anchors.
 * No formulas — routing only.
 */

import type { Row } from "@/types/finance";
import { TEMPLATE_IS_ROW_IDS } from "@/lib/is-classification";
import { isCoreBsRow } from "@/lib/bs-core-rows";
import {
  getForecastDriverForAnchor,
  type CfsForecastDriver,
} from "@/lib/cfs-forecast-drivers";
import { getIsTaxonomy, getBsTaxonomy, getCfsTaxonomy } from "@/lib/row-taxonomy";

export type StatementKey = "incomeStatement" | "balanceSheet" | "cashFlow";

/** Who owns the forecasted value for this row. */
export type ForecastOwner =
  | "income_statement"
  | "working_capital_schedule"
  | "capex_schedule"
  | "danda_schedule"
  | "intangibles_schedule"
  | "debt_schedule"
  | "financing_assumption"
  | "derived"
  | "manual";

/** Forecast method family (no formulas; assignment only). */
export type MethodFamily =
  | "growth_rate"
  | "percent_of_revenue"
  | "percent_of_parent"
  | "days_based"
  | "percent_of_cogs"
  | "manual_input"
  | "schedule_driven"
  | "derived_total"
  | "rollforward"
  | "from_income_statement"
  | "from_working_capital_schedule"
  | "from_capex_schedule"
  | "from_danda_schedule"
  | "from_debt_schedule"
  | "disclosure_or_assumption"
  | "financing_assumption"
  | "tax_rate_based"
  | "derived";

/** Trust / eligibility for auto-routing. */
export type RoutingTrustState = "trusted" | "needs_confirmation" | "setup_required";

export interface ForecastRoutingState {
  owner: ForecastOwner;
  methodFamily: MethodFamily;
  driverSource: CfsForecastDriver | null;
  isDirectForecast: boolean;
  isDerived: boolean;
  isScheduleDriven: boolean;
  isManual: boolean;
  trustState: RoutingTrustState;
  reason: string;
}

export interface PlacementContext {
  parentId?: string;
  sectionId?: string;
}

const CFS_DERIVED_ROW_IDS = new Set([
  "operating_cf",
  "investing_cf",
  "financing_cf",
  "net_change_cash",
]);

const IS_DERIVED_ROW_IDS = new Set([
  "gross_profit",
  "gross_margin",
  "operating_expenses",
  "ebit",
  "ebit_margin",
  "ebt",
  "ebt_margin",
  "tax",
  "net_income",
  "net_income_margin",
  "ebitda",
  "ebitda_margin",
]);

const BS_DERIVED_ROW_IDS = new Set([
  "cash",
  "retained_earnings",
  "total_current_assets",
  "total_fixed_assets",
  "total_assets",
  "total_current_liabilities",
  "total_non_current_liabilities",
  "total_liabilities",
  "total_equity",
  "total_liab_and_equity",
]);

/** Deterministic template/anchor rows are trusted by definition; no need for explicit trust flags. */
function isDeterministicRow(row: Row, statementKey: StatementKey): boolean {
  if (statementKey === "incomeStatement") {
    return row.isTemplateRow === true || TEMPLATE_IS_ROW_IDS.has(row.id);
  }
  if (statementKey === "balanceSheet") {
    return isCoreBsRow(row.id);
  }
  if (statementKey === "cashFlow") {
    return getForecastDriverForAnchor(row.id) != null;
  }
  return false;
}

/** Resolve trust state: deterministic = trusted; else use taxonomyStatus / forecastMetadataStatus / classificationSource. */
function getRoutingTrustState(row: Row, statementKey: StatementKey): RoutingTrustState {
  if (isDeterministicRow(row, statementKey)) {
    return "trusted";
  }
  if (row.classificationSource === "unresolved" || row.taxonomyStatus === "unresolved") {
    return "setup_required";
  }
  if (
    row.forecastMetadataStatus === "needs_review" ||
    row.taxonomyStatus === "needs_review"
  ) {
    return "needs_confirmation";
  }
  if (row.classificationSource === "user" || row.forecastMetadataStatus === "trusted" || row.taxonomyStatus === "trusted") {
    return "trusted";
  }
  return "needs_confirmation";
}

/** Income Statement routing: sectionOwner → isOperating → taxonomy (when trusted) → row ID fallback. */
function routeIncomeStatement(row: Row, trustState: RoutingTrustState): ForecastRoutingState {
  const kind = row.kind;
  const isCalcOrTotal = kind === "calc" || kind === "subtotal" || kind === "total";
  const taxonomy = getIsTaxonomy(row);
  const isCalculatedType = taxonomy.category === "calculated" || (taxonomy.type?.startsWith("calc_") ?? false);

  if (isCalcOrTotal || isCalculatedType || IS_DERIVED_ROW_IDS.has(row.id)) {
    return {
      owner: "derived",
      methodFamily: "derived_total",
      driverSource: null,
      isDirectForecast: false,
      isDerived: true,
      isScheduleDriven: false,
      isManual: false,
      trustState,
      reason: "IS calculated or total row",
    };
  }

  const section = row.sectionOwner ?? (trustState === "trusted" ? taxonomy.category : null);
  const effectiveSection = section ?? (row.id === "rev" ? "revenue" : row.id === "cogs" ? "cogs" : row.id === "danda" ? "other_operating" : null);

  if (row.id === "danda" || (effectiveSection === "other_operating" && taxonomy.type === "opex_danda")) {
    return {
      owner: "danda_schedule",
      methodFamily: "schedule_driven",
      driverSource: "danda_schedule",
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: true,
      isManual: false,
      trustState,
      reason: "D&A row driven by D&A schedule",
    };
  }

  if (
    effectiveSection === "revenue" ||
    row.id === "rev" ||
    (trustState === "trusted" && taxonomy.category === "revenue")
  ) {
    return {
      owner: "income_statement",
      methodFamily: "growth_rate",
      driverSource: null,
      isDirectForecast: true,
      isDerived: false,
      isScheduleDriven: false,
      isManual: false,
      trustState,
      reason: "Revenue row — direct IS forecast",
    };
  }

  if (
    effectiveSection === "cogs" ||
    row.id === "cogs" ||
    (trustState === "trusted" && taxonomy.category === "cost_of_revenue")
  ) {
    return {
      owner: "income_statement",
      methodFamily: "percent_of_revenue",
      driverSource: null,
      isDirectForecast: true,
      isDerived: false,
      isScheduleDriven: false,
      isManual: false,
      trustState,
      reason: "COGS row — direct IS forecast",
    };
  }

  if (
    effectiveSection === "sga" ||
    effectiveSection === "rd" ||
    effectiveSection === "other_operating" ||
    (trustState === "trusted" && taxonomy.category === "operating_expense" && taxonomy.type !== "opex_danda")
  ) {
    return {
      owner: "income_statement",
      methodFamily: "percent_of_revenue",
      driverSource: null,
      isDirectForecast: true,
      isDerived: false,
      isScheduleDriven: false,
      isManual: false,
      trustState,
      reason: "Operating expense row — direct IS forecast",
    };
  }

  if (
    effectiveSection === "non_operating" ||
    effectiveSection === "tax" ||
    (trustState === "trusted" && (taxonomy.category === "non_operating" || taxonomy.category === "tax"))
  ) {
    return {
      owner: "income_statement",
      methodFamily: row.id === "tax" || taxonomy.category === "tax" ? "tax_rate_based" : "manual_input",
      driverSource: null,
      isDirectForecast: true,
      isDerived: false,
      isScheduleDriven: false,
      isManual: true,
      trustState,
      reason: "Non-operating or tax row — direct/manual",
    };
  }

  return {
    owner: "income_statement",
    methodFamily: "manual_input",
    driverSource: null,
    isDirectForecast: true,
    isDerived: false,
    isScheduleDriven: false,
    isManual: true,
    trustState,
    reason: "IS row — fallback manual",
  };
}

/** Balance Sheet routing: cashFlowBehavior → scheduleOwner → taxonomy → row ID fallback. */
function routeBalanceSheet(row: Row, trustState: RoutingTrustState): ForecastRoutingState {
  if (row.id === "cash") {
    return {
      owner: "derived",
      methodFamily: "derived",
      driverSource: null,
      isDirectForecast: false,
      isDerived: true,
      isScheduleDriven: false,
      isManual: false,
      trustState,
      reason: "Cash derived from CFS",
    };
  }
  if (row.id === "retained_earnings") {
    return {
      owner: "derived",
      methodFamily: "derived",
      driverSource: null,
      isDirectForecast: false,
      isDerived: true,
      isScheduleDriven: false,
      isManual: false,
      trustState,
      reason: "Retained earnings derived",
    };
  }

  const kind = row.kind;
  const taxonomy = getBsTaxonomy(row);
  const isTotal = kind === "total" || kind === "subtotal" || taxonomy.type === "calc_total" || BS_DERIVED_ROW_IDS.has(row.id);
  if (isTotal || row.id.startsWith("total_")) {
    return {
      owner: "derived",
      methodFamily: "derived_total",
      driverSource: null,
      isDirectForecast: false,
      isDerived: true,
      isScheduleDriven: false,
      isManual: false,
      trustState,
      reason: "BS total/subtotal row",
    };
  }

  const behavior = row.cashFlowBehavior;
  const scheduleOwner = row.scheduleOwner;

  if (behavior === "working_capital") {
    return {
      owner: "working_capital_schedule",
      methodFamily: "schedule_driven",
      driverSource: null,
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: true,
      isManual: false,
      trustState,
      reason: "WC row — working capital schedule",
    };
  }

  if (scheduleOwner === "capex" || row.id === "ppe") {
    return {
      owner: "capex_schedule",
      methodFamily: "schedule_driven",
      driverSource: null,
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: true,
      isManual: false,
      trustState,
      reason: "PP&E — capex schedule",
    };
  }

  if (scheduleOwner === "intangibles" || row.id === "intangible_assets") {
    return {
      owner: "intangibles_schedule",
      methodFamily: "schedule_driven",
      driverSource: null,
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: true,
      isManual: false,
      trustState,
      reason: "Intangibles schedule",
    };
  }

  if (behavior === "financing" && (row.id === "st_debt" || row.id === "lt_debt")) {
    return {
      owner: "debt_schedule",
      methodFamily: "schedule_driven",
      driverSource: null,
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: true,
      isManual: false,
      trustState,
      reason: "Debt row — debt schedule (future)",
    };
  }

  return {
    owner: "manual",
    methodFamily: "manual_input",
    driverSource: null,
    isDirectForecast: false,
    isDerived: false,
    isScheduleDriven: false,
    isManual: true,
    trustState,
    reason: "BS row — manual",
  };
}

/** Cash Flow Statement routing: cfsForecastDriver → cfsLink.section → historicalCfsNature → parentId (wc_change) → row ID fallback. */
function routeCashFlow(row: Row, trustState: RoutingTrustState, context?: PlacementContext): ForecastRoutingState {
  if (CFS_DERIVED_ROW_IDS.has(row.id)) {
    return {
      owner: "derived",
      methodFamily: "derived_total",
      driverSource: null,
      isDirectForecast: false,
      isDerived: true,
      isScheduleDriven: false,
      isManual: false,
      trustState,
      reason: "CFS section or net change total",
    };
  }

  const driver = row.cfsForecastDriver ?? getForecastDriverForAnchor(row.id);
  const section = row.cfsLink?.section;
  const parentId = context?.parentId;

  if (driver === "income_statement" || row.id === "net_income") {
    return {
      owner: "income_statement",
      methodFamily: "from_income_statement",
      driverSource: "income_statement",
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: false,
      isManual: false,
      trustState,
      reason: "Net income from IS",
    };
  }

  if (driver === "danda_schedule" || row.id === "danda") {
    return {
      owner: "danda_schedule",
      methodFamily: "from_danda_schedule",
      driverSource: "danda_schedule",
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: true,
      isManual: false,
      trustState,
      reason: "D&A from schedule",
    };
  }

  if (driver === "working_capital_schedule" || row.id === "wc_change" || parentId === "wc_change") {
    return {
      owner: "working_capital_schedule",
      methodFamily: "from_working_capital_schedule",
      driverSource: "working_capital_schedule",
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: true,
      isManual: false,
      trustState,
      reason: "WC change from schedule / BS ΔWC",
    };
  }

  if (driver === "capex_schedule" || row.id === "capex") {
    return {
      owner: "capex_schedule",
      methodFamily: "from_capex_schedule",
      driverSource: "capex_schedule",
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: true,
      isManual: false,
      trustState,
      reason: "Capex from schedule",
    };
  }

  if (driver === "debt_schedule" || row.id === "debt_issued" || row.id === "debt_repaid") {
    return {
      owner: "debt_schedule",
      methodFamily: "from_debt_schedule",
      driverSource: "debt_schedule",
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: true,
      isManual: false,
      trustState,
      reason: "Debt from schedule (future)",
    };
  }

  if (driver === "disclosure_or_assumption" || row.id === "sbc") {
    return {
      owner: "manual",
      methodFamily: "disclosure_or_assumption",
      driverSource: "disclosure_or_assumption",
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: false,
      isManual: true,
      trustState,
      reason: "SBC / disclosure or assumption",
    };
  }

  if (driver === "financing_assumption" || driver === "manual_mna" || driver === "manual_other") {
    return {
      owner: driver === "financing_assumption" ? "financing_assumption" : "manual",
      methodFamily: driver === "financing_assumption" ? "financing_assumption" : "manual_input",
      driverSource: driver,
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: false,
      isManual: true,
      trustState,
      reason: "Manual or financing assumption",
    };
  }

  if (section === "operating" && row.historicalCfsNature === "reported_working_capital_movement") {
    return {
      owner: "working_capital_schedule",
      methodFamily: "from_working_capital_schedule",
      driverSource: "working_capital_schedule",
      isDirectForecast: false,
      isDerived: false,
      isScheduleDriven: true,
      isManual: false,
      trustState,
      reason: "Inferred WC from section/nature",
    };
  }

  return {
    owner: "manual",
    methodFamily: "manual_input",
    driverSource: driver ?? null,
    isDirectForecast: false,
    isDerived: false,
    isScheduleDriven: false,
    isManual: true,
    trustState,
    reason: "CFS row — fallback manual",
  };
}

/**
 * Canonical forecast routing: for this row, where should its forecasted value come from?
 * Uses metadata first; row ID only as fallback for deterministic anchors.
 * Deterministic rows are treated as trusted without requiring explicit trust flags.
 */
export function getForecastRoutingState(
  row: Row,
  statementKey: StatementKey,
  context?: PlacementContext
): ForecastRoutingState {
  const trustState = getRoutingTrustState(row, statementKey);

  if (statementKey === "incomeStatement") {
    return routeIncomeStatement(row, trustState);
  }
  if (statementKey === "balanceSheet") {
    return routeBalanceSheet(row, trustState);
  }
  return routeCashFlow(row, trustState, context);
}

/** Convenience: owner only. */
export function getForecastOwner(
  row: Row,
  statementKey: StatementKey,
  context?: PlacementContext
): ForecastOwner {
  return getForecastRoutingState(row, statementKey, context).owner;
}

/** Convenience: is this row a direct forecast (IS-style)? */
export function isRowDirectForecast(row: Row, statementKey: StatementKey): boolean {
  return getForecastRoutingState(row, statementKey).isDirectForecast;
}

/** Convenience: is this row derived (total/calc)? */
export function isRowDerived(row: Row, statementKey: StatementKey, context?: PlacementContext): boolean {
  return getForecastRoutingState(row, statementKey, context).isDerived;
}

/** Convenience: is this row schedule-driven? */
export function isRowScheduleDriven(row: Row, statementKey: StatementKey, context?: PlacementContext): boolean {
  return getForecastRoutingState(row, statementKey, context).isScheduleDriven;
}

/**
 * Developer diagnostic: returns routing state and logs a compact line when called.
 * Use from console: window.__debugForecastRouting(row, "incomeStatement")
 * or: window.__debugForecastRouting(row, "cashFlow", { parentId: "wc_change" })
 */
export function debugForecastRouting(
  row: Row,
  statementKey: StatementKey,
  context?: PlacementContext
): ForecastRoutingState {
  const state = getForecastRoutingState(row, statementKey, context);
  if (typeof console !== "undefined" && typeof console.log === "function") {
    console.log(
      "[ForecastRouting]",
      statementKey,
      row.id,
      row.label,
      "→",
      state.owner,
      state.methodFamily,
      state.trustState,
      "|",
      state.reason
    );
  }
  return state;
}

/** Expose on window for console access (e.g. __debugForecastRouting(row, "balanceSheet")). */
function attachDebugGlobal() {
  if (typeof window === "undefined") return;
  (window as unknown as { __debugForecastRouting?: typeof debugForecastRouting }).__debugForecastRouting = debugForecastRouting;
  (window as unknown as { __getForecastRoutingState?: typeof getForecastRoutingState }).__getForecastRoutingState = getForecastRoutingState;
}
if (typeof window !== "undefined") {
  attachDebugGlobal();
}
