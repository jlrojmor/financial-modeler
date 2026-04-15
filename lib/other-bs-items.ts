/**
 * Other BS Items — utility for detecting and forecasting Balance Sheet rows
 * that are not managed by the WC Drivers, Debt Schedule, Capex/D&A Schedule,
 * or Cash / Retained Earnings derivation.
 *
 * Covers: Goodwill, Deferred Tax (A/L), ROU assets, Investments, Other LT assets,
 * Lease obligations, Pension, Other LT liabilities, and Equity line items
 * (excluding Retained Earnings which is derived from NI – Dividends in Phase 3).
 */

import type { Row } from "@/types/finance";
import type { OtherBsItemForecast, OtherBsItemMethod } from "@/store/useModelStore";
import { getBsTaxonomy, type BSTaxonomy } from "@/lib/row-taxonomy";
import { getWcScheduleItems } from "@/lib/working-capital-schedule";

// ─── Exclusions ────────────────────────────────────────────────────────────────

/** Taxonomy types managed by other specific schedules — always excluded. */
const SCHEDULE_MANAGED_TYPES = new Set([
  "asset_cash",              // CFS closure
  "asset_ppe",               // Capex/D&A schedule
  "asset_intangibles",       // Capex/D&A schedule
  "liab_short_term_debt",    // Debt schedule
  "liab_long_term_debt",     // Debt schedule
  "equity_retained_earnings", // Derived from NI − Dividends (Phase 3)
  // Equity Roll-Forward managed (Phase 3 — computed via equity-rollforward-engine):
  "equity_common_stock",
  "equity_apic",
  "equity_treasury_stock",
]);

/** Taxonomy types that are always WC items (already covered by WC Drivers tab). */
const ALWAYS_WC_TYPES = new Set([
  "asset_receivables", "asset_inventory", "asset_prepaid",
  "liab_payables", "liab_accruals", "liab_deferred_revenue", "liab_current_lease",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type OtherBsGroup =
  | "fixed_assets"        // Goodwill, investments, ROU, deferred tax A, other LT assets
  | "other_current"       // Non-WC current assets (short-term investments, other CA)
  | "non_current_liab"    // Deferred tax L, pension, lease obligations, other LT liab
  | "equity";             // Common stock, APIC, treasury, AOCI, NCI, other equity

export const OTHER_BS_GROUP_LABELS: Record<OtherBsGroup, string> = {
  fixed_assets: "Non-Current Assets",
  other_current: "Other current (non-WC)",
  non_current_liab: "Non-Current Liabilities",
  equity: "Equity",
};

export type OtherBsItem = {
  id: string;
  label: string;
  taxonomyType: string | undefined;
  group: OtherBsGroup;
  ibDefaultMethod: OtherBsItemMethod;
  ibNote: string;
  lastHistValue: number | null;
};

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Returns all BS rows that belong in the "Other BS Items" tab.
 * Excludes: WC items, schedule-managed rows (cash, PP&E, debt, RE), totals, calc rows.
 * Walks the full BS tree (including nested children) so no items are missed.
 */
export function getOtherBsItems(
  balanceSheet: Row[],
  cashFlow: Row[],
  historicYears: string[]
): OtherBsItem[] {
  const wcIds = new Set(getWcScheduleItems(cashFlow, balanceSheet).map((i) => i.id));
  const lastHistYear = historicYears[historicYears.length - 1] ?? null;

  // Flatten BS tree for iteration (preserving original order)
  const flatBs: Row[] = [];
  const flatten = (rows: Row[]) => { for (const r of rows) { flatBs.push(r); if (r.children?.length) flatten(r.children); } };
  flatten(balanceSheet);

  // Positional boundaries for fallback group inference (on flattened list)
  const totalCAIdx = flatBs.findIndex((r) => r.id === "total_current_assets");
  const totalAIdx = flatBs.findIndex((r) => r.id === "total_assets");
  const totalCLIdx = flatBs.findIndex((r) => r.id === "total_current_liabilities");
  const totalLIdx = flatBs.findIndex((r) => r.id === "total_liabilities");
  const totalEIdx = flatBs.findIndex((r) => r.id === "total_equity");

  const out: OtherBsItem[] = [];
  const seenIds = new Set<string>();

  for (let idx = 0; idx < flatBs.length; idx++) {
    const row = flatBs[idx];
    if (seenIds.has(row.id)) continue;
    // Skip totals, sections with children, and calculated rows
    if (row.id.startsWith("total_") || row.kind === "calc" || row.kind === "total" || row.kind === "subtotal") continue;
    if ((row.children?.length ?? 0) > 0) continue;

    // Resolved taxonomy (label + stored type) — do not use row.taxonomyType alone: stale
    // liab_current_lease / liab_payables on non-current lines wrongly hit ALWAYS_WC_TYPES and were excluded.
    const tax = getBsTaxonomy(row);

    if (SCHEDULE_MANAGED_TYPES.has(tax.type)) continue;
    if (row.scheduleOwner === "capex" || row.scheduleOwner === "debt") continue;

    // IB-grade single ownership: WC schedule items are forecast only in WC Drivers — never duplicate here.
    if (wcIds.has(row.id)) continue;

    let group = resolveGroup(tax);

    // Positional fallback: infer group from flattened BS position
    if (!group) {
      if (totalCAIdx >= 0 && idx < totalCAIdx) {
        group = "other_current";
      } else if (totalCAIdx >= 0 && totalAIdx >= 0 && idx > totalCAIdx && idx < totalAIdx) {
        group = "fixed_assets";
      } else if (totalAIdx >= 0 && totalCLIdx >= 0 && idx > totalAIdx && idx < totalCLIdx) {
        group = "non_current_liab";
      } else if (totalCLIdx >= 0 && totalLIdx >= 0 && idx > totalCLIdx && idx < totalLIdx) {
        group = "non_current_liab";
      } else if (totalLIdx >= 0 && totalEIdx >= 0 && idx > totalLIdx && idx < totalEIdx) {
        group = "equity";
      }
    }

    // Core WC line types are forecast in WC Drivers only — but never exclude true non-current liabilities
    // (e.g. mis-stored liab_current_lease on non-current lease debt).
    if (ALWAYS_WC_TYPES.has(tax.type) && tax.category !== "non_current_liability") continue;

    if (!group) continue;

    const lastHistValue = lastHistYear != null ? (row.values?.[lastHistYear] ?? null) : null;
    if (lastHistValue === null && !historicYears.some((y) => (row.values?.[y] ?? 0) !== 0)) continue;

    const { method: ibDefaultMethod, note: ibNote } = resolveIbDefault(tax);
    seenIds.add(row.id);

    out.push({
      id: row.id,
      label: row.label,
      taxonomyType: tax.type,
      group,
      ibDefaultMethod,
      ibNote,
      lastHistValue,
    });
  }

  return out;
}

function resolveGroup(tax: BSTaxonomy): OtherBsGroup | null {
  const tt = tax.type;

  if (["asset_goodwill", "asset_rou_assets", "asset_investments", "asset_deferred_tax", "asset_other_fixed"].includes(tt)) {
    return "fixed_assets";
  }
  if (["asset_short_term_investments", "asset_other_current"].includes(tt)) {
    return "other_current";
  }
  if (["liab_deferred_tax", "liab_pension", "liab_lease_obligations", "liab_other_non_current"].includes(tt)) {
    return "non_current_liab";
  }
  if (tt === "liab_other_current") {
    return "other_current";
  }
  if (["equity_common_stock", "equity_preferred_stock", "equity_apic", "equity_treasury_stock",
       "equity_aoci", "equity_minority_interest", "equity_other"].includes(tt)) {
    return "equity";
  }

  const cat = tax.category;
  if (cat === "fixed_asset") return "fixed_assets";
  if (cat === "current_asset") return "other_current";
  if (cat === "non_current_liability") return "non_current_liab";
  if (cat === "equity") return "equity";

  return null;
}

const IB_DEFAULTS: Partial<Record<string, { method: OtherBsItemMethod; note: string }>> = {
  asset_goodwill:          { method: "flat",       note: "Goodwill doesn't amortize under US GAAP/IFRS — held flat unless impaired." },
  asset_rou_assets:        { method: "flat",       note: "Right-of-use assets stay flat unless new leases are signed." },
  asset_investments:       { method: "flat",       note: "Investment portfolio held flat absent known deployment plans." },
  asset_deferred_tax:      { method: "pct_revenue", note: "Deferred tax assets scale with taxable temporary differences — % of revenue is a common proxy." },
  asset_other_fixed:       { method: "flat",       note: "Other fixed assets are typically held flat without specific growth plans." },
  asset_short_term_investments: { method: "flat",  note: "Short-term investments held flat; update if cash deployment is expected." },
  asset_other_current:     { method: "pct_revenue", note: "Other current assets often scale with revenue activity." },
  liab_deferred_tax:       { method: "pct_revenue", note: "Deferred tax liabilities scale with taxable temporary differences — % of revenue is a common proxy." },
  liab_pension:            { method: "flat",       note: "Pension liabilities are actuarially complex — flat is the standard conservative assumption." },
  liab_lease_obligations:  { method: "flat",       note: "Long-term lease obligations stay flat unless new leases are added." },
  liab_other_non_current:  { method: "flat",       note: "Other long-term liabilities held flat unless specific changes are expected." },
  liab_other_current:      { method: "pct_revenue", note: "Other current liabilities often scale with business activity — % of revenue is a common proxy." },
  equity_common_stock:     { method: "flat",       note: "Common stock par value rarely changes — flat is standard." },
  equity_preferred_stock:  { method: "flat",       note: "Preferred stock held flat unless new issuances are planned." },
  equity_apic:             { method: "flat",       note: "APIC stays flat unless new equity issuances or stock compensation. Model buybacks/issuances in Phase 3." },
  equity_treasury_stock:   { method: "flat",       note: "Treasury stock stays flat unless buyback activity. Model in Phase 3." },
  equity_aoci:             { method: "flat",       note: "AOCI (Accumulated Other Comprehensive Income) is typically flat absent actuarial/FX moves." },
  equity_minority_interest: { method: "growth_pct", note: "Non-controlling interest often grows with the underlying business." },
  equity_other:            { method: "flat",       note: "Other equity components held flat by default." },
};

function resolveIbDefault(tax: BSTaxonomy): { method: OtherBsItemMethod; note: string } {
  if (IB_DEFAULTS[tax.type]) return IB_DEFAULTS[tax.type]!;
  return { method: "flat", note: "Flat is the standard IB default for items without a clear driver." };
}

// ─── Projection engine ────────────────────────────────────────────────────────

/**
 * Compute projected balance for one Other BS item in one year.
 * Flat = last historical value; Growth = compounded; % Rev = pct × revenue; Manual = entered value.
 */
export function computeOtherBsProjectedBalance(
  itemId: string,
  year: string,
  projectionYears: string[],
  forecast: OtherBsItemForecast | undefined,
  lastHistValue: number,
  revByYear: Record<string, number>
): number {
  const method = forecast?.method ?? "flat";

  if (method === "flat") return lastHistValue;

  if (method === "pct_revenue") {
    const rev = revByYear[year] ?? 0;
    const pct = forecast?.pctRevenue ?? 0;
    return rev * (pct / 100);
  }

  if (method === "manual") {
    return forecast?.manualByYear?.[year] ?? lastHistValue;
  }

  if (method === "growth_pct") {
    const yearIdx = projectionYears.indexOf(year);
    if (yearIdx < 0) return lastHistValue;
    let val = lastHistValue;
    for (let i = 0; i <= yearIdx; i++) {
      const y = projectionYears[i];
      const pct = forecast?.growthPctByYear?.[y] ?? forecast?.growthPct ?? 0;
      val = val * (1 + pct / 100);
    }
    return val;
  }

  return lastHistValue;
}

/**
 * Batch compute projected balances for all other BS items.
 */
export function computeOtherBsProjectedBalances(
  items: OtherBsItem[],
  projectionYears: string[],
  forecastByItemId: Record<string, OtherBsItemForecast>,
  revByYear: Record<string, number>,
  balanceSheet: Row[],
  historicYears: string[]
): Record<string, Record<string, number>> {
  const lastHistYear = historicYears[historicYears.length - 1] ?? null;
  const out: Record<string, Record<string, number>> = {};

  // Flatten BS tree for deep lookup
  const flatBs: Row[] = [];
  const flattenBs = (rows: Row[]) => { for (const r of rows) { flatBs.push(r); if (r.children?.length) flattenBs(r.children); } };
  flattenBs(balanceSheet);

  for (const item of items) {
    out[item.id] = {};
    const row = flatBs.find((r) => r.id === item.id);
    const lastHistValue = lastHistYear != null ? (row?.values?.[lastHistYear] ?? 0) : 0;

    for (const y of projectionYears) {
      out[item.id][y] = computeOtherBsProjectedBalance(
        item.id,
        y,
        projectionYears,
        forecastByItemId[item.id],
        lastHistValue,
        revByYear
      );
    }
  }

  return out;
}

// ─── IB guidance ─────────────────────────────────────────────────────────────

export const IB_METHOD_LABELS: Record<OtherBsItemMethod, string> = {
  flat:        "Flat",
  growth_pct:  "% Growth",
  pct_revenue: "% of Revenue",
  manual:      "Manual",
};

export const IB_METHOD_DESCRIPTIONS: Record<OtherBsItemMethod, string> = {
  flat:        "Stays at the last historical balance every year",
  growth_pct:  "Grows by a fixed % annually (compounded from last historical)",
  pct_revenue: "Scales as a % of forecasted revenue each year",
  manual:      "You enter the exact balance for each forecast year",
};
