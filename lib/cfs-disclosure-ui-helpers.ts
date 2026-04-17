/**
 * Human-readable link strings for Cash flow disclosure UI.
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";

/**
 * Resolve BS/IS link ids to row labels where possible; join for compact display.
 * Use `title` for full id strings when helpful for support/debug.
 */
export function formatCfsRowLinksResolved(
  row: Row | null | undefined,
  balanceSheet: Row[],
  incomeStatement: Row[]
): { compact: string; title?: string } {
  if (!row) return { compact: "—" };
  const detail: string[] = [];
  const compactParts: string[] = [];

  if (row.taxonomyType) {
    compactParts.push(`Taxonomy: ${row.taxonomyType}`);
  }

  if (row.cfsLink?.cfsItemId) {
    const id = row.cfsLink.cfsItemId;
    const bsRow = findRowInTree(balanceSheet, id);
    const label = bsRow?.label;
    compactParts.push(label ? `Balance sheet: ${label}` : `Balance sheet id: ${id}`);
    detail.push(`BS row id: ${id}`);
  }

  if (row.isLink?.isItemId) {
    const id = row.isLink.isItemId;
    const isRow = findRowInTree(incomeStatement, id);
    const label = isRow?.label;
    compactParts.push(label ? `Income statement: ${label}` : `Income statement id: ${id}`);
    detail.push(`IS row id: ${id}`);
  }

  if (compactParts.length === 0) {
    return {
      compact: "Unlinked",
      title: "Set cfsLink / isLink / taxonomy in Historicals to bridge this line.",
    };
  }

  return {
    compact: compactParts.join(" · "),
    ...(detail.length ? { title: detail.join(" | ") } : {}),
  };
}
