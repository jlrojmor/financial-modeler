/**
 * Projected Statements CFS preview only: WC cash effects keyed by **CFS row id** (e.g. `cfo_ap`).
 * Uses the same WC item list as Forecast Drivers (`getWcScheduleItems`); maps to `wc_change.children` for detail.
 */

import type { Row } from "@/types/finance";
import { findBalanceSheetRowContext, getBSCategoryForRow } from "./bs-category-mapper";
import type { BalanceSheetCategory } from "./bs-impact-rules";
import { findRowInTree } from "./row-utils";
import { resolvePriorYear, sortYearsChronologically } from "./year-timeline";
import {
  cfsWcChildIdToBalanceSheetId,
  buildWcProjectedBalancesMatrix,
  getWcScheduleItems,
  type WcDriverState,
  type WcScheduleItem,
} from "./working-capital-schedule";
import { computeWcCfsCashEffectByProjectionYears, wcCashEffectSingleYear } from "./wc-cfs-from-schedule";

function balanceSheetCategoryToWcSide(cat: BalanceSheetCategory | null): "asset" | "liability" {
  if (cat === "current_liabilities" || cat === "non_current_liabilities") return "liability";
  return "asset";
}

function inferWcSideFromKeywords(id: string, label?: string): "asset" | "liability" {
  const s = `${id} ${label ?? ""}`.toLowerCase();
  if (
    s.includes("payable") ||
    s.includes("accrued") ||
    s.includes("liabilit") ||
    s.includes("deferred") ||
    s.includes("gift") ||
    s.includes("unredeemed") ||
    s.includes("taxes payable") ||
    (s.includes("compensation") && s.includes("accrued"))
  ) {
    return "liability";
  }
  return "asset";
}

/**
 * Build a `WcScheduleItem` for a CFS WC child when it is not already in the schedule list
 * (edge case: CFS line present before routing / schedule alignment).
 */
function normWcLabel(l: string | undefined): string {
  return (l ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Map template / IFRS CFS strip ids to BS schedule ids (e.g. `cfo_inventories` → `inventories` → `inventory`).
 */
export function normalizeWcStripForScheduleLookup(stripId: string): string {
  if (stripId === "inventories") return "inventory";
  return stripId;
}

/**
 * Map a `wc_change` CFS child to the WC schedule row id used in `getWcScheduleItems` / balance matrix.
 * Prefers schedule ids so template lines like `cfo_ar` attach to routed custom BS rows, not an empty template `ar`.
 */
export function resolveWcCanonicalForChild(
  c: Row,
  scheduleItems: WcScheduleItem[],
  balanceSheet: Row[]
): string {
  const stripRaw = cfsWcChildIdToBalanceSheetId(c.id);
  const stripId = normalizeWcStripForScheduleLookup(stripRaw);
  const scheduleIds = new Set(scheduleItems.map((s) => s.id));

  if (scheduleIds.has(stripRaw)) return stripRaw;
  if (scheduleIds.has(stripId)) return stripId;

  for (const si of scheduleItems) {
    if (c.id === `cfo_${si.id}`) return si.id;
  }

  let ctx = findBalanceSheetRowContext(balanceSheet, stripRaw);
  if (ctx == null && stripRaw !== stripId) {
    ctx = findBalanceSheetRowContext(balanceSheet, stripId);
  }
  if (ctx != null && scheduleIds.has(ctx.row.id)) return ctx.row.id;

  const childNorm = normWcLabel(c.label);
  if (childNorm.length > 0) {
    const labelHits = scheduleItems.filter((si) => normWcLabel(si.label) === childNorm);
    if (labelHits.length === 1) return labelHits[0]!.id;
  }

  const keywordByStrip: Record<string, RegExp> = {
    ar: /receivable/i,
    inventory: /inventory/i,
    inv: /inventory/i,
    ap: /payable/i,
  };
  const re = keywordByStrip[stripId] ?? keywordByStrip[stripRaw];
  if (re) {
    const hits = scheduleItems.filter((si) => re.test(si.label) || re.test(si.id));
    if (hits.length === 1) return hits[0]!.id;
  }

  return ctx?.row.id ?? stripRaw;
}

function wcItemForCanonical(
  canonicalId: string,
  labelFromChild: string | undefined,
  ctx: ReturnType<typeof findBalanceSheetRowContext>,
  balanceSheet: Row[]
): WcScheduleItem {
  const cat = ctx ? getBSCategoryForRow(canonicalId, balanceSheet, ctx.topLevelIndex) : null;
  let side = balanceSheetCategoryToWcSide(cat);
  if (cat == null) {
    side = inferWcSideFromKeywords(canonicalId, labelFromChild ?? ctx?.row.label);
  }
  const label = (labelFromChild ?? ctx?.row.label ?? canonicalId) as string;
  return { id: canonicalId, label, side };
}

/**
 * Per CFS WC child row id → per year cash effect (stored units, CFO sign convention).
 * Includes **last historical year** vs prior historical when `historicalYears.length >= 2`, plus all projection years.
 *
 * Schedule math follows `getWcScheduleItems` (routing-first, same as Forecast Drivers → WC).
 * Output keys exist only for rows under `wc_change` in the CFS tree — add WC lines there for detail.
 */
export function computeWcCfsPreviewCashEffects(params: {
  cashFlow: Row[];
  balanceSheet: Row[];
  projectionYears: string[];
  allChronologicalYears: string[];
  historicalYears: string[];
  wcDriverState: WcDriverState;
  revByYear: Record<string, number>;
  cogsByYear: Record<string, number>;
}): Record<string, Record<string, number>> {
  const {
    cashFlow,
    balanceSheet,
    projectionYears,
    allChronologicalYears,
    historicalYears,
    wcDriverState,
    revByYear,
    cogsByYear,
  } = params;

  if (allChronologicalYears.length === 0) {
    return {};
  }

  const scheduleItems = getWcScheduleItems(cashFlow, balanceSheet);
  const wcChange = findRowInTree(cashFlow, "wc_change");
  const children = wcChange?.children ?? [];

  /** Merge schedule items with any CFS-only children so balances and deltas cover all rendered lines. */
  const wcItemById = new Map<string, WcScheduleItem>();
  for (const item of scheduleItems) {
    wcItemById.set(item.id, item);
  }

  const cfsIdToCanonical: Record<string, string> = {};
  for (const c of children) {
    const canonicalId = resolveWcCanonicalForChild(c, scheduleItems, balanceSheet);
    cfsIdToCanonical[c.id] = canonicalId;
    if (!wcItemById.has(canonicalId)) {
      const ctx = findBalanceSheetRowContext(balanceSheet, canonicalId);
      wcItemById.set(canonicalId, wcItemForCanonical(canonicalId, c.label, ctx, balanceSheet));
    }
  }

  const wcItems = [...wcItemById.values()];
  if (wcItems.length === 0) {
    return {};
  }

  const { projectedBalances, chron } = buildWcProjectedBalancesMatrix({
    wcItems,
    balanceSheet,
    years: allChronologicalYears,
    historicalYears,
    projectionYears,
    driverState: wcDriverState,
    revByYear,
    cogsByYear,
    unionBsValueKeys: true,
  });

  const byCanonicalId = computeWcCfsCashEffectByProjectionYears(
    wcItems,
    projectedBalances,
    chron,
    projectionYears
  );

  if (scheduleItems.length === 0) {
    return {};
  }

  const out: Record<string, Record<string, number>> = {};

  for (const c of children) {
    const canon = cfsIdToCanonical[c.id];
    if (canon == null) continue;
    out[c.id] = { ...(byCanonicalId[canon] ?? {}) };
  }

  for (const item of scheduleItems) {
    const line = { ...(byCanonicalId[item.id] ?? {}) };
    out[item.id] = line;
    out[`cfo_${item.id}`] = { ...line };
  }

  const applyLastHistoricalWc = (lastY: string, prevY: string) => {
    for (const item of scheduleItems) {
      const witem = wcItems.find((w) => w.id === item.id);
      if (!witem) continue;
      const val = wcCashEffectSingleYear(witem, lastY, prevY, projectedBalances);
      const keys = new Set<string>([item.id, `cfo_${item.id}`]);
      for (const c of children) {
        if (cfsIdToCanonical[c.id] === item.id) keys.add(c.id);
      }
      for (const k of keys) {
        if (out[k] == null) out[k] = {};
        out[k]![lastY] = val;
      }
    }
  };

  if (historicalYears.length >= 2) {
    const histSorted = sortYearsChronologically(historicalYears);
    const lastY = histSorted[histSorted.length - 1]!;
    const prevY = histSorted[histSorted.length - 2]!;
    applyLastHistoricalWc(lastY, prevY);
  } else if (historicalYears.length === 1) {
    const lastY = historicalYears[0]!;
    const prevY = resolvePriorYear(lastY, chron);
    if (prevY != null) {
      applyLastHistoricalWc(lastY, prevY);
    }
  }

  return out;
}
