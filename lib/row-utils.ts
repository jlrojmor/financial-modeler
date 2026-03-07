/**
 * Utilities for row trees (e.g. incomeStatement with nested children).
 * Use when rows may be top-level or nested (e.g. sga, rd, danda under operating_expenses).
 */

import type { Row } from "@/types/finance";

/** Find a row by id in the tree (top-level + children). Returns null if not found. */
export function findRowInTree(rows: Row[], rowId: string): Row | null {
  for (const r of rows) {
    if (r.id === rowId) return r;
    if (r.children?.length) {
      const found = findRowInTree(r.children, rowId);
      if (found) return found;
    }
  }
  return null;
}

