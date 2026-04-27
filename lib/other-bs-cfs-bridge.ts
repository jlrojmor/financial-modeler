/**
 * Other BS Items → projected CFS: synthetic top-level rows (cfo/cfi/cff_other_bs_${bsRowId})
 * so YoY balance changes appear as named lines when Other BS is confirmed. Deferred tax
 * DTA/DTL stays in other_operating only (engine aggregate) — not duplicated here.
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";
import { getBsTaxonomy } from "@/lib/row-taxonomy";
import { resolveGroup, type OtherBsGroup } from "@/lib/other-bs-items";

const DEFERRED_TAX_TYPES = new Set(["asset_deferred_tax", "liab_deferred_tax"]);

/** Model bridge CFS — avoids `cfo_*` WC prefix collision. */
const MBC_PREFIX = /^mbc_(cfo|cfi|cff)_/;

export function isOtherBsSyntheticCfsRowId(id: string): boolean {
  return MBC_PREFIX.test(id);
}

export function parseOtherBsBridgeRow(
  cfsRowId: string
): { section: "cfo" | "cfi" | "cff"; bsRowId: string } | null {
  const m = cfsRowId.match(/^mbc_(cfo|cfi|cff)_(.+)$/);
  if (!m) return null;
  return { section: m[1] as "cfo" | "cfi" | "cff", bsRowId: m[2]! };
}

/** Map Other BS group + taxonomy to CFS section; null = no synthetic line (deferred tax). */
export function getOtherBsBridgeSection(
  group: OtherBsGroup,
  taxonomyType: string | undefined
): "cfo" | "cfi" | "cff" | null {
  if (taxonomyType && DEFERRED_TAX_TYPES.has(taxonomyType)) return null;
  if (group === "fixed_assets") return "cfi";
  if (group === "other_current") return "cfo";
  if (group === "non_current_liab") return "cfo";
  if (group === "equity") return "cff";
  return null;
}

export function syntheticOtherBsCfsId(section: "cfo" | "cfi" | "cff", bsRowId: string): string {
  return `mbc_${section}_${bsRowId}`;
}

/**
 * Cash effect for indirect-style CFS row value (already signed for presentation).
 * - CFI asset build-up: outflow negative when asset increases.
 * - CFO: assets −Δ, liabilities +Δ.
 * - CFF equity: +Δ equity (simplified; non-cash equity items may be immaterial when flat).
 */
export function computeOtherBsBridgeLineForYear(
  balanceSheet: Row[],
  bsId: string,
  year: string,
  prevYear: string | null
): { id: string; value: number } | null {
  if (!prevYear) return null;
  const flatBs = flattenBs(balanceSheet);
  const bsRow = findRowInTree(balanceSheet, bsId) ?? flatBs.find((r) => r.id === bsId);
  if (!bsRow) return null;
  const tax = getBsTaxonomy(bsRow);
  const group = resolveGroup(tax);
  if (!group) return null;
  const section = getOtherBsBridgeSection(group, tax.type);
  if (!section) return null;
  const rawY = bsRow.values?.[year];
  const rawP = bsRow.values?.[prevYear];
  const vY = typeof rawY === "number" && Number.isFinite(rawY) ? rawY : 0;
  const vP = typeof rawP === "number" && Number.isFinite(rawP) ? rawP : 0;
  const delta = vY - vP;
  const value = computeOtherBsBridgeCashValue(section, tax.type, delta);
  return { id: syntheticOtherBsCfsId(section, bsId), value };
}

export function computeOtherBsBridgeCashValue(
  section: "cfo" | "cfi" | "cff",
  taxonomyType: string | undefined,
  delta: number
): number {
  const tt = taxonomyType ?? "";
  if (section === "cfi") {
    return -delta;
  }
  if (section === "cff") {
    return delta;
  }
  // cfo
  if (tt.startsWith("asset_")) return -delta;
  if (tt.startsWith("liab_")) return delta;
  return -delta;
}

function flattenBs(rows: Row[], out: Row[] = []): Row[] {
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) flattenBs(r.children, out);
  }
  return out;
}

function removeBridgeRowsTopLevel(rows: Row[]): Row[] {
  return rows.filter((r) => !isOtherBsSyntheticCfsRowId(r.id));
}

function insertBeforeId(rows: Row[], beforeId: string, toInsert: Row[]): Row[] {
  const idx = rows.findIndex((r) => r.id === beforeId);
  if (idx < 0) return [...rows, ...toInsert];
  const next = [...rows];
  next.splice(idx, 0, ...toInsert);
  return next;
}

/**
 * Sync top-level synthetic CFS rows for Other BS items. Idempotent.
 * When `!confirmed` or `bsRowIds` empty, strips all bridge rows.
 */
export function syncOtherBsBridgeRowsInCashFlow(
  cashFlow: Row[],
  balanceSheet: Row[],
  confirmed: boolean,
  bsRowIds: string[]
): void {
  let top = removeBridgeRowsTopLevel(cashFlow);
  if (!confirmed || bsRowIds.length === 0) {
    cashFlow.length = 0;
    cashFlow.push(...top);
    return;
  }

  const flatBs = flattenBs(balanceSheet);
  const cfoRows: Row[] = [];
  const cfiRows: Row[] = [];
  const cffRows: Row[] = [];

  const sortedIds = [...new Set(bsRowIds)].sort();
  for (const bsId of sortedIds) {
    const bsRow = findRowInTree(balanceSheet, bsId) ?? flatBs.find((r) => r.id === bsId);
    if (!bsRow) continue;
    const tax = getBsTaxonomy(bsRow);
    const group = resolveGroup(tax);
    if (!group) continue;
    const section = getOtherBsBridgeSection(group, tax.type);
    if (!section) continue;

    const cfsId = syntheticOtherBsCfsId(section, bsId);
    const row: Row = {
      id: cfsId,
      label: bsRow.label ?? bsId,
      kind: "input",
      valueType: "currency",
      values: {},
      cfsForecastDriver: "manual_other",
      cfsLink: {
        section: section === "cfo" ? "operating" : section === "cfi" ? "investing" : "financing",
        cfsItemId: bsId,
        impact: "neutral",
        description: `Change in ${bsRow.label ?? bsId} (Other BS)`,
      },
    };
    if (section === "cfo") cfoRows.push(row);
    else if (section === "cfi") cfiRows.push(row);
    else cffRows.push(row);
  }

  top = insertBeforeId(top, "operating_cf", cfoRows);
  top = insertBeforeId(top, "investing_cf", cfiRows);
  top = insertBeforeId(top, "financing_cf", cffRows);

  cashFlow.length = 0;
  cashFlow.push(...top);
}
