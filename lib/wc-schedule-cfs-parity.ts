/**
 * Compare WC schedule (Forecast Drivers / BS routing) to Cash Flow `wc_change.children`.
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";
import { getWcScheduleItems, getWcCfsBridgeLineFromMap } from "@/lib/working-capital-schedule";
import { resolveWcCanonicalForChild } from "@/lib/projected-wc-cfs-bridge";

export type WcScheduleCfsParity = {
  scheduleItemIds: string[];
  /** Canonical BS ids mapped from each CFS child. */
  cfsChildCanonicalIds: string[];
  /** Schedule row ids with no CFS line resolving to them. */
  missingInCfs: string[];
  /** Labels for missing rows (same order as missingInCfs). */
  missingInCfsLabels: string[];
  /** CFS child ids whose resolved canonical is not on the WC schedule. */
  extraInCfs: string[];
};

export function getWcScheduleVsCfsParity(
  cashFlow: Row[],
  balanceSheet: Row[],
  wcCfsCashByItemId?: Record<string, Record<string, number>>
): WcScheduleCfsParity {
  const scheduleItems = getWcScheduleItems(cashFlow, balanceSheet);
  const scheduleIds = new Set(scheduleItems.map((s) => s.id));
  const wc = findRowInTree(cashFlow, "wc_change");
  const children = wc?.children ?? [];

  const mapped = new Set<string>();
  for (const c of children) {
    mapped.add(resolveWcCanonicalForChild(c, scheduleItems, balanceSheet));
  }

  const missingInCfs: string[] = [];
  const missingInCfsLabels: string[] = [];
  for (const s of scheduleItems) {
    const hasChild = mapped.has(s.id);
    const hasBridge =
      wcCfsCashByItemId != null &&
      getWcCfsBridgeLineFromMap(wcCfsCashByItemId, `cfo_${s.id}`).hasExplicitBridgeKey;
    if (!hasChild && !hasBridge) {
      missingInCfs.push(s.id);
      missingInCfsLabels.push(s.label);
    }
  }

  const extraInCfs: string[] = [];
  for (const c of children) {
    const canon = resolveWcCanonicalForChild(c, scheduleItems, balanceSheet);
    if (!scheduleIds.has(canon)) {
      extraInCfs.push(c.id);
    }
  }

  return {
    scheduleItemIds: scheduleItems.map((s) => s.id),
    cfsChildCanonicalIds: children.map((c) => resolveWcCanonicalForChild(c, scheduleItems, balanceSheet)),
    missingInCfs,
    missingInCfsLabels,
    extraInCfs,
  };
}
