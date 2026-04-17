/**
 * Write projection-year values on CFS rows from disclosure policies (store) for export / BS build parity.
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";
import type { CfsDisclosureProjectionSpec } from "@/lib/cfs-disclosure-projection";
import { applyCfsDisclosureProjectionForYear } from "@/lib/cfs-disclosure-projection";
import { classifyCfsLineForProjection } from "@/lib/cfs-line-classification";

function patchRowTree(rows: Row[], rowId: string, mutator: (r: Row) => Row): Row[] {
  return rows.map((r) => {
    if (r.id === rowId) return mutator(r);
    if (r.children?.length) {
      const next = patchRowTree(r.children, rowId, mutator);
      if (next !== r.children) return { ...r, children: next };
    }
    return r;
  });
}

export function applyCfsDisclosurePoliciesToCashFlowTree(
  cashFlow: Row[],
  balanceSheet: Row[],
  projectionYears: string[],
  lastHistYear: string | null,
  revenueByYear: Record<string, number>,
  policies: Record<string, CfsDisclosureProjectionSpec>
): Row[] {
  let out = cashFlow;
  for (const rowId of Object.keys(policies)) {
    const spec = policies[rowId];
    if (!spec) continue;
    const row = findRowInTree(out, rowId);
    if (!row) continue;
    if (classifyCfsLineForProjection(row, balanceSheet) !== "cf_disclosure_only") continue;

    const lastActual = lastHistYear ? row.values?.[lastHistYear] : undefined;
    out = patchRowTree(out, rowId, (r) => {
      const vals = { ...(r.values ?? {}) };
      for (const y of projectionYears) {
        if (spec.mode === "excluded") {
          vals[y] = 0;
        } else {
          vals[y] = applyCfsDisclosureProjectionForYear(spec, y, lastHistYear, revenueByYear[y], lastActual);
        }
      }
      return { ...r, values: vals };
    });
  }
  return out;
}
