/**
 * Projected CFS overview (builder card + preview): which plan lines appear in the IB "model view".
 *
 * Indirect CFO is NI + non-cash addbacks + WC; CFI is capex and other modeled investing flows;
 * CFF is debt, equity, dividends, etc. Lines without a Forecast Drivers path stay in Historicals
 * but are omitted here so users only see what the model actually projects.
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";
import { classifyCfsLineForProjection } from "@/lib/cfs-line-classification";
import type { CfsProjectedStatementPlanLine } from "@/lib/cfs-projected-statements-plan";
import { CFS_PROJECTED_MAIN_TOTAL_IDS } from "@/lib/cfs-projected-statements-plan";
import {
  getCfsProjectedStatementLineRouting,
  type CfsRoutingContext,
} from "@/lib/cfs-projected-statements-shell-routing";
import { isCfsComputedRollupRowId } from "@/lib/cfs-structural-row-ids";

function isStructuralRollupOrMainTotal(effectiveLineId: string): boolean {
  return isCfsComputedRollupRowId(effectiveLineId) || CFS_PROJECTED_MAIN_TOTAL_IDS.has(effectiveLineId);
}

function shouldIncludeDataLine(
  line: CfsProjectedStatementPlanLine,
  row: Row | null,
  routing: ReturnType<typeof getCfsProjectedStatementLineRouting>,
  ctx: CfsRoutingContext
): boolean {
  const effId = line.sourceRowId ?? line.id;
  if (isStructuralRollupOrMainTotal(effId)) return true;

  if (routing.status === "excluded") return false;
  if (routing.status === "not_configured") return false;

  if (row && classifyCfsLineForProjection(row, ctx.balanceSheet) === "cf_disclosure_only") {
    const pol = ctx.disclosureProjectionByRowId[row.id];
    if (!pol) return false;
    if (pol.mode === "excluded" || pol.mode === "zero") return false;
  }

  return true;
}

/**
 * Same ordered plan as `buildCfsProjectedStatementPlanLines`, minus lines the model does not project
 * and minus empty section headers. Spacers are kept when present in the input slice.
 */
export function filterCfsPlanLinesForProjectedOverview(
  lines: CfsProjectedStatementPlanLine[],
  cashFlow: Row[],
  ctx: CfsRoutingContext
): CfsProjectedStatementPlanLine[] {
  const keptDataIds = new Set<string>();

  for (const line of lines) {
    if (line.role !== "data") continue;
    const effId = line.sourceRowId ?? line.id;
    const row = line.sourceRowId ? findRowInTree(cashFlow, line.sourceRowId) : null;
    const routing = getCfsProjectedStatementLineRouting(row, effId, ctx);
    if (shouldIncludeDataLine(line, row, routing, ctx)) {
      keptDataIds.add(line.id);
    }
  }

  const out: CfsProjectedStatementPlanLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.role === "section_header") {
      const hasVisibleData = lines
        .slice(i + 1)
        .some((l) => l.role === "data" && keptDataIds.has(l.id));
      if (hasVisibleData) out.push(line);
      continue;
    }
    if (line.role === "spacer") {
      out.push(line);
      continue;
    }
    if (line.role === "data" && keptDataIds.has(line.id)) {
      out.push(line);
    }
  }

  return out;
}
