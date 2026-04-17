/**
 * Single ordered plan for Cash Flow Statement lines in Projected Statements:
 * builder (shell) and preview must consume the same sequence for IB-grade alignment.
 */

import type { Row } from "@/types/finance";
import type { WcScheduleItem } from "@/lib/working-capital-schedule";

export type CfsPlanLineRole = "section_header" | "data" | "spacer";

/** One row in the CFS table (preview) or one coverage line (builder, data lines only). */
export interface CfsProjectedStatementPlanLine {
  role: CfsPlanLineRole;
  /** Stable id for preview row / builder line (matches PreviewRow.id). */
  id: string;
  label: string;
  depth: number;
  /** Preview styling. */
  previewStyle: "header" | "line" | "subtotal" | "total" | "spacer";
  /**
   * When set, values resolve from this id in the cashFlow tree (`findRowInTree`).
   * Omitted for synthetic WC schedule lines (`cfo_${bsId}`) until bridge fills them.
   */
  sourceRowId?: string;
}

const MAIN_TOTAL_IDS = new Set([
  "total_operating_cf",
  "total_investing_cf",
  "total_financing_cf",
  "net_cash_change",
  "total_cash_change",
]);

function walkPlan(
  cfsInput: Row[],
  depth: number,
  wcScheduleItems: WcScheduleItem[],
  out: CfsProjectedStatementPlanLine[]
): void {
  for (const row of cfsInput) {
    if (row.id === "wc_change" && wcScheduleItems.length > 0) {
      out.push({
        role: "section_header",
        id: `hdr_${row.id}`,
        label: row.label ?? row.id,
        depth,
        previewStyle: "header",
      });
      const d = depth + 1;
      for (const item of wcScheduleItems) {
        out.push({
          role: "data",
          id: `cfo_${item.id}`,
          label: item.label,
          depth: d,
          previewStyle: "line",
        });
      }
      out.push({
        role: "data",
        id: "wc_change",
        label: row.label ?? "Change in Working Capital",
        depth,
        previewStyle: "subtotal",
        sourceRowId: "wc_change",
      });
      continue;
    }

    const isTotal = row.kind === "total" || row.id.startsWith("total_");
    const isSubtotal = row.kind === "subtotal";
    const isCalc = row.kind === "calc";
    const isSection = (row.children?.length ?? 0) > 0 && !isTotal && !isSubtotal;

    if (isSection) {
      out.push({
        role: "section_header",
        id: `hdr_${row.id}`,
        label: row.label ?? row.id,
        depth,
        previewStyle: "header",
      });
      walkPlan(row.children!, depth + 1, wcScheduleItems, out);
    } else if (isTotal || isSubtotal) {
      const isMainTotal = MAIN_TOTAL_IDS.has(row.id);
      out.push({
        role: "data",
        id: row.id,
        label: row.label ?? row.id,
        depth,
        previewStyle: isMainTotal ? "total" : "subtotal",
        sourceRowId: row.id,
      });
      if (isMainTotal) {
        out.push({
          role: "spacer",
          id: `spacer_${row.id}`,
          label: "",
          depth: 0,
          previewStyle: "spacer",
        });
      }
    } else if (isCalc) {
      const style = row.id === "sbc" ? "line" : "subtotal";
      out.push({
        role: "data",
        id: row.id,
        label: row.label ?? row.id,
        depth,
        previewStyle: style,
        sourceRowId: row.id,
      });
    } else {
      out.push({
        role: "data",
        id: row.id,
        label: row.label ?? row.id,
        depth,
        previewStyle: "line",
        sourceRowId: row.id,
      });
    }
  }
}

/** Full CFS line plan for preview (headers, spacers, all data rows). */
export function buildCfsProjectedStatementPlanLines(
  cashFlow: Row[],
  wcScheduleItems: WcScheduleItem[]
): CfsProjectedStatementPlanLine[] {
  const out: CfsProjectedStatementPlanLine[] = [];
  walkPlan(cashFlow ?? [], 0, wcScheduleItems, out);
  return out;
}

/** Builder coverage: same data lines as preview except section headers and spacers (per plan acceptance). */
export function filterCfsPlanLinesForBuilderCoverage(lines: CfsProjectedStatementPlanLine[]): CfsProjectedStatementPlanLine[] {
  return lines.filter((l) => l.role === "data");
}
