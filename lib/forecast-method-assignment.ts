/**
 * Phase 2A: Forecast Setup / Method Assignment Layer
 *
 * Sits on top of forecast-routing.ts. For any row, determines forecast setup state:
 * owner, method family, default method, allowed methods, and whether user setup is required.
 * Metadata-driven; no execution formulas. Setup architecture only.
 */

import type { Row } from "@/types/finance";
import {
  getForecastRoutingState,
  type ForecastRoutingState,
  type StatementKey,
  type ForecastOwner,
  type MethodFamily,
  type PlacementContext,
} from "@/lib/forecast-routing";
import { getIsTaxonomy, getBsTaxonomy, getCfsTaxonomy } from "@/lib/row-taxonomy";

/** Forecast method identifier for setup (vocabulary only). */
export type ForecastMethod =
  | "growth_rate"
  | "percent_of_revenue"
  | "percent_of_parent"
  | "percent_of_cogs"
  | "days_based"
  | "price_volume"
  | "customers_arpu"
  | "pct_of_total"
  | "manual_input"
  | "schedule_driven"
  | "tax_rate_based"
  | "from_income_statement"
  | "from_danda_schedule"
  | "from_working_capital_schedule"
  | "from_capex_schedule"
  | "from_debt_schedule"
  | "debt_schedule"
  | "disclosure_driven"
  | "financing_assumption"
  | "manual_mna"
  | "derived";

/** Forecast setup state for a single row (setup layer only; no execution). */
export interface ForecastSetupState {
  owner: ForecastOwner;
  methodFamily: MethodFamily;
  defaultMethod: ForecastMethod | null;
  allowedMethods: ForecastMethod[];
  isDirectForecast: boolean;
  isDerived: boolean;
  isScheduleDriven: boolean;
  requiresUserSetup: boolean;
  canAutoAssign: boolean;
  trustState: "trusted" | "needs_confirmation" | "setup_required";
  reason: string;
}

// ─── Allowed methods by IS row family (section / taxonomy) ───────────────────

const IS_REVENUE_METHODS: ForecastMethod[] = ["growth_rate", "price_volume", "customers_arpu", "pct_of_total", "manual_input"];
const IS_COGS_METHODS: ForecastMethod[] = ["percent_of_revenue", "growth_rate", "manual_input"];
const IS_SGA_METHODS: ForecastMethod[] = ["percent_of_revenue", "growth_rate", "manual_input"];
const IS_RD_METHODS: ForecastMethod[] = ["percent_of_revenue", "growth_rate", "manual_input"];
const IS_OTHER_OPEX_METHODS: ForecastMethod[] = ["growth_rate", "percent_of_revenue", "manual_input"];
const IS_NON_OP_METHODS: ForecastMethod[] = ["manual_input", "growth_rate"];
const IS_TAX_METHODS: ForecastMethod[] = ["tax_rate_based", "manual_input"];
const IS_DANDA_METHODS: ForecastMethod[] = ["schedule_driven"];
const IS_DERIVED_METHODS: ForecastMethod[] = []; // none; derived only

// ─── Allowed methods by BS row family ───────────────────────────────────────

const BS_WC_METHODS: ForecastMethod[] = ["days_based", "percent_of_revenue", "percent_of_cogs", "manual_input"];
const BS_PPE_METHODS: ForecastMethod[] = ["schedule_driven"];
const BS_INTANGIBLES_METHODS: ForecastMethod[] = ["schedule_driven"];
const BS_DEBT_METHODS: ForecastMethod[] = ["debt_schedule", "manual_input"];
const BS_CASH_RE_METHODS: ForecastMethod[] = []; // derived only
const BS_OTHER_METHODS: ForecastMethod[] = ["manual_input", "growth_rate"];
const BS_TOTAL_METHODS: ForecastMethod[] = []; // derived only

// ─── Allowed methods by CFS row family ──────────────────────────────────────

const CFS_NET_INCOME_METHODS: ForecastMethod[] = ["from_income_statement"];
const CFS_DANDA_METHODS: ForecastMethod[] = ["from_danda_schedule", "manual_input"];
const CFS_SBC_METHODS: ForecastMethod[] = ["manual_input", "disclosure_driven"];
const CFS_WC_CHANGE_METHODS: ForecastMethod[] = ["from_working_capital_schedule"];
const CFS_CAPEX_METHODS: ForecastMethod[] = ["from_capex_schedule"];
const CFS_DEBT_ITEMS_METHODS: ForecastMethod[] = ["from_debt_schedule", "manual_input"];
const CFS_INV_FIN_MANUAL_METHODS: ForecastMethod[] = ["manual_input", "financing_assumption", "manual_mna"];
const CFS_BRIDGE_METHODS: ForecastMethod[] = ["manual_input"];
const CFS_DERIVED_METHODS: ForecastMethod[] = []; // totals / net change

/** Get allowed methods and default for IS row from routing + taxonomy. */
function getIsMethodSetup(
  row: Row,
  routing: ForecastRoutingState
): { allowed: ForecastMethod[]; default: ForecastMethod | null } {
  if (routing.isDerived) return { allowed: IS_DERIVED_METHODS, default: null };

  const section = row.sectionOwner ?? null;
  const taxonomy = getIsTaxonomy(row);

  if (routing.owner === "danda_schedule" || row.id === "danda")
    return { allowed: IS_DANDA_METHODS, default: "schedule_driven" };

  if (section === "revenue" || row.id === "rev" || taxonomy.category === "revenue")
    return { allowed: IS_REVENUE_METHODS, default: "growth_rate" };
  if (section === "cogs" || row.id === "cogs" || taxonomy.category === "cost_of_revenue")
    return { allowed: IS_COGS_METHODS, default: "percent_of_revenue" };
  if (section === "sga" || row.id === "sga" || taxonomy.type === "opex_sga")
    return { allowed: IS_SGA_METHODS, default: "percent_of_revenue" };
  if (section === "rd" || row.id === "rd" || taxonomy.type === "opex_rd")
    return { allowed: IS_RD_METHODS, default: "percent_of_revenue" };
  if (section === "other_operating" || taxonomy.category === "operating_expense")
    return { allowed: IS_OTHER_OPEX_METHODS, default: "percent_of_revenue" };
  if (section === "non_operating" || taxonomy.category === "non_operating")
    return { allowed: IS_NON_OP_METHODS, default: "manual_input" };
  if (section === "tax" || row.id === "tax" || taxonomy.category === "tax")
    return { allowed: IS_TAX_METHODS, default: "tax_rate_based" };

  return { allowed: IS_OTHER_OPEX_METHODS, default: "manual_input" };
}

/** Get allowed methods and default for BS row from routing. */
function getBsMethodSetup(row: Row, routing: ForecastRoutingState): { allowed: ForecastMethod[]; default: ForecastMethod | null } {
  if (routing.isDerived) return { allowed: BS_CASH_RE_METHODS, default: null };
  if (routing.owner === "working_capital_schedule")
    return { allowed: BS_WC_METHODS, default: "days_based" };
  if (routing.owner === "capex_schedule" || row.id === "ppe")
    return { allowed: BS_PPE_METHODS, default: "schedule_driven" };
  if (routing.owner === "intangibles_schedule" || row.id === "intangible_assets")
    return { allowed: BS_INTANGIBLES_METHODS, default: "schedule_driven" };
  if (routing.owner === "debt_schedule" || row.id === "st_debt" || row.id === "lt_debt")
    return { allowed: BS_DEBT_METHODS, default: "debt_schedule" };
  return { allowed: BS_OTHER_METHODS, default: "manual_input" };
}

/** Get allowed methods and default for CFS row from routing. */
function getCfsMethodSetup(row: Row, routing: ForecastRoutingState): { allowed: ForecastMethod[]; default: ForecastMethod | null } {
  if (routing.isDerived) return { allowed: CFS_DERIVED_METHODS, default: null };
  if (routing.owner === "income_statement" || row.id === "net_income")
    return { allowed: CFS_NET_INCOME_METHODS, default: "from_income_statement" };
  if (routing.owner === "danda_schedule" || row.id === "danda")
    return { allowed: CFS_DANDA_METHODS, default: "from_danda_schedule" };
  if (row.id === "sbc")
    return { allowed: CFS_SBC_METHODS, default: "disclosure_driven" };
  if (routing.owner === "working_capital_schedule" || row.id === "wc_change")
    return { allowed: CFS_WC_CHANGE_METHODS, default: "from_working_capital_schedule" };
  if (routing.owner === "capex_schedule" || row.id === "capex")
    return { allowed: CFS_CAPEX_METHODS, default: "from_capex_schedule" };
  if (routing.owner === "debt_schedule" || row.id === "debt_issued" || row.id === "debt_repaid")
    return { allowed: CFS_DEBT_ITEMS_METHODS, default: "from_debt_schedule" };
  if (row.cfsLink?.section === "cash_bridge" || row.id === "fx_effect_on_cash")
    return { allowed: CFS_BRIDGE_METHODS, default: "manual_input" };
  if (routing.owner === "financing_assumption" || routing.owner === "manual")
    return { allowed: CFS_INV_FIN_MANUAL_METHODS, default: "manual_input" };
  return { allowed: CFS_INV_FIN_MANUAL_METHODS, default: "manual_input" };
}

/**
 * Get forecast setup state for a row. Uses routing first, then assigns allowed methods and default.
 * requiresUserSetup = trustState === "setup_required".
 * canAutoAssign = trusted and (derived or has a single/default method).
 */
export function getForecastSetupState(
  row: Row,
  statementKey: StatementKey,
  context?: PlacementContext
): ForecastSetupState {
  const routing = getForecastRoutingState(row, statementKey, context);
  const trustState = routing.trustState;

  let allowed: ForecastMethod[] = [];
  let defaultMethod: ForecastMethod | null = null;

  if (statementKey === "incomeStatement") {
    const setup = getIsMethodSetup(row, routing);
    allowed = setup.allowed;
    defaultMethod = setup.default;
  } else if (statementKey === "balanceSheet") {
    const setup = getBsMethodSetup(row, routing);
    allowed = setup.allowed;
    defaultMethod = setup.default;
  } else {
    const setup = getCfsMethodSetup(row, routing);
    allowed = setup.allowed;
    defaultMethod = setup.default;
  }

  const requiresUserSetup = trustState === "setup_required";
  const canAutoAssign =
    trustState === "trusted" && (routing.isDerived || (allowed.length > 0 && defaultMethod != null));

  return {
    owner: routing.owner,
    methodFamily: routing.methodFamily,
    defaultMethod,
    allowedMethods: allowed,
    isDirectForecast: routing.isDirectForecast,
    isDerived: routing.isDerived,
    isScheduleDriven: routing.isScheduleDriven,
    requiresUserSetup,
    canAutoAssign,
    trustState,
    reason: routing.reason,
  };
}

// ─── Readiness diagnostic ────────────────────────────────────────────────────

export interface ForecastSetupReadinessItem {
  statement: StatementKey;
  rowId: string;
  label: string;
  owner: ForecastOwner;
  methodFamily: MethodFamily;
  allowedMethods: ForecastMethod[];
  defaultMethod: ForecastMethod | null;
  trustState: "trusted" | "needs_confirmation" | "setup_required";
  requiresUserSetup: boolean;
  canAutoAssign: boolean;
  reason: string;
}

function flattenWithContext(
  rows: Row[],
  statementKey: StatementKey,
  parentId?: string
): Array<{ row: Row; parentId?: string }> {
  const out: Array<{ row: Row; parentId?: string }> = [];
  for (const row of rows) {
    out.push({ row, parentId });
    if (row.children?.length) {
      for (const child of row.children) {
        out.push(...flattenWithContext([child], statementKey, row.id));
      }
    }
  }
  return out;
}

/**
 * Forecast setup readiness diagnostic: returns setup state for all rows in all statements.
 * Use for debugging and validating the setup architecture.
 */
export function getForecastSetupReadiness(allStatements: {
  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];
}): ForecastSetupReadinessItem[] {
  const items: ForecastSetupReadinessItem[] = [];
  const keys: StatementKey[] = ["incomeStatement", "balanceSheet", "cashFlow"];

  for (const statementKey of keys) {
    const rows = allStatements[statementKey] ?? [];
    const entries = flattenWithContext(rows, statementKey);
    for (const { row, parentId } of entries) {
      const context: PlacementContext | undefined = parentId ? { parentId } : undefined;
      const setup = getForecastSetupState(row, statementKey, context);
      items.push({
        statement: statementKey,
        rowId: row.id,
        label: row.label,
        owner: setup.owner,
        methodFamily: setup.methodFamily,
        allowedMethods: setup.allowedMethods,
        defaultMethod: setup.defaultMethod,
        trustState: setup.trustState,
        requiresUserSetup: setup.requiresUserSetup,
        canAutoAssign: setup.canAutoAssign,
        reason: setup.reason,
      });
    }
  }
  return items;
}

/**
 * Log readiness summary to console (developer helper).
 * Counts ready / needs setup / ambiguous per statement.
 */
export function logForecastSetupReadiness(allStatements: {
  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];
}): void {
  const items = getForecastSetupReadiness(allStatements);
  const byStatement = { incomeStatement: 0, balanceSheet: 0, cashFlow: 0 };
  let ready = 0;
  let needsSetup = 0;
  let needsConfirmation = 0;
  for (const i of items) {
    byStatement[i.statement]++;
    if (i.requiresUserSetup) needsSetup++;
    else if (i.trustState === "needs_confirmation") needsConfirmation++;
    else ready++;
  }
  console.log("[ForecastSetupReadiness]", {
    total: items.length,
    ready,
    needsConfirmation,
    needsSetup,
    byStatement,
  });
  console.table(
    items.slice(0, 50).map((i) => ({
      statement: i.statement,
      rowId: i.rowId,
      label: i.label.slice(0, 30),
      owner: i.owner,
      defaultMethod: i.defaultMethod,
      trusted: i.trustState === "trusted",
      needsSetup: i.requiresUserSetup,
      canAuto: i.canAutoAssign,
    }))
  );
  if (items.length > 50) console.log(`... and ${items.length - 50} more rows. Use getForecastSetupReadiness(store) for full list.`);
}

// Expose on window for console debugging
if (typeof window !== "undefined") {
  (window as unknown as { __getForecastSetupState?: typeof getForecastSetupState }).__getForecastSetupState = getForecastSetupState;
  (window as unknown as { __getForecastSetupReadiness?: typeof getForecastSetupReadiness }).__getForecastSetupReadiness = getForecastSetupReadiness;
  (window as unknown as { __logForecastSetupReadiness?: typeof logForecastSetupReadiness }).__logForecastSetupReadiness = logForecastSetupReadiness;
}
