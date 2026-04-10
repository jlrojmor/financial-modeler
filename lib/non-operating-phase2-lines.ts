/**
 * Phase 2 Pass 1 — Non-operating & Schedules: line ingest and display-only heuristics.
 * Does not persist; does not compute forecast math. Operating (Phase 1) lines are excluded.
 */

import type { Row } from "@/types/finance";
import { isNonOperatingRow } from "@/lib/is-classification";

export type Phase2LineBucket = "scheduled" | "direct" | "review" | "excluded";

/** UI-only schedule readiness for scheduled-item cards (Pass 1). */
export type Phase2ScheduleShellStatus = "not_set_up" | "draft" | "applied" | "complete";

/** Supported schedule categories for human-readable labels (display shell only). */
export type Phase2ScheduleDisplayCategory =
  | "interest"
  | "amortization"
  | "depreciation"
  | "lease"
  | "stock_compensation"
  | "other_schedule";

export type NonOperatingLeafLine = {
  lineId: string;
  label: string;
  /** Nearest parent row label for context line; falls back to a friendly default. */
  parentLabel: string;
};

export const PHASE2_SCHEDULE_LABELS: Record<Phase2ScheduleDisplayCategory, string> = {
  interest: "Interest",
  amortization: "Amortization",
  depreciation: "Depreciation",
  lease: "Lease / lease-related",
  stock_compensation: "Stock-based compensation",
  other_schedule: "Schedule",
};

/** Distinguish interest expense vs interest income for labels and sign copy. */
export type NonOperatingInterestKind = "expense" | "income";

export function getNonOperatingInterestKind(row: Pick<Row, "id" | "label">): NonOperatingInterestKind | null {
  if (row.id === "interest_expense") return "expense";
  if (row.id === "interest_income") return "income";
  const l = (row.label ?? "").toLowerCase();
  if (/\binterest\s+expense\b/.test(l)) return "expense";
  if (/\binterest\s+income\b/.test(l)) return "income";
  if (/\binterest\b/.test(l)) {
    if (/\bexpense\b/.test(l) && !/\bincome\b/.test(l)) return "expense";
    if (/\bincome\b/.test(l) && !/\bexpense\b/.test(l)) return "income";
    return null;
  }
  return null;
}

export function phase2ScheduleCategoryPillLabel(
  row: Pick<Row, "id" | "label"> | null,
  cat: Phase2ScheduleDisplayCategory | null
): string {
  if (!cat) return "Schedule";
  if (cat === "interest") {
    const k = row ? getNonOperatingInterestKind(row) : null;
    if (k === "expense") return "Interest (expense)";
    if (k === "income") return "Interest (income)";
    return "Interest";
  }
  return PHASE2_SCHEDULE_LABELS[cat];
}

function flattenWithParent(rows: Row[], parentLabel: string): Array<{ row: Row; parentLabel: string }> {
  const out: Array<{ row: Row; parentLabel: string }> = [];
  for (const r of rows) {
    out.push({ row: r, parentLabel });
    const nextParent = r.label?.trim() ? r.label : parentLabel;
    if (r.children?.length) {
      out.push(...flattenWithParent(r.children, nextParent));
    }
  }
  return out;
}

/**
 * Leaf input rows in the post-EBIT "interest" IS block (non-operating only).
 * Excludes tax, net income, and all operating / Phase 1 OpEx territory.
 */
export function collectNonOperatingIncomeLeaves(incomeStatement: Row[]): NonOperatingLeafLine[] {
  const roots = incomeStatement ?? [];
  const flat = flattenWithParent(roots, "Income statement");
  const seen = new Set<string>();
  const out: NonOperatingLeafLine[] = [];
  for (const { row, parentLabel } of flat) {
    if (!isNonOperatingRow(row)) continue;
    if (row.kind !== "input") continue;
    if ((row.children?.length ?? 0) > 0) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const pl =
      parentLabel && parentLabel !== "Income statement" ? parentLabel : "Other income & expense";
    out.push({
      lineId: row.id,
      label: row.label?.trim() ? row.label : row.id,
      parentLabel: pl,
    });
  }
  return out;
}

/**
 * Map line to a schedule display category when shown under Scheduled items.
 * Returns null when uncertain — caller should route to Needs review instead of forcing a schedule type.
 */
export function inferScheduleDisplayCategory(row: Pick<Row, "id" | "label">): Phase2ScheduleDisplayCategory | null {
  const id = row.id;
  if (id === "interest_expense" || id === "interest_income") return "interest";
  const l = (row.label ?? "").toLowerCase();
  if (/\binterest\b/.test(l)) return "interest";
  if (l.includes("amort")) return "amortization";
  if (l.includes("depreciation") || /\bd\s*&\s*a\b/.test(l) || l.includes("d&a")) return "depreciation";
  if (l.includes("lease") || l.includes(" rou") || l.startsWith("rou")) return "lease";
  if ((l.includes("stock") && l.includes("comp")) || l.includes("stock-based") || l.includes("stock based")) {
    return "stock_compensation";
  }
  if (l.includes("sbc") || l.includes("share-based")) return "stock_compensation";
  return null;
}

/**
 * Default bucket from template ids + label heuristics. Uncertain custom lines → review (not scheduled).
 */
export function defaultPhase2Bucket(row: Pick<Row, "id" | "label">): Phase2LineBucket {
  if (row.id === "interest_expense" || row.id === "interest_income") return "scheduled";
  if (row.id === "other_income") return "direct";
  const cat = inferScheduleDisplayCategory(row);
  if (cat != null) return "scheduled";
  return "review";
}

export function findIsRowById(incomeStatement: Row[], lineId: string): Row | null {
  const walk = (rows: Row[]): Row | null => {
    for (const r of rows) {
      if (r.id === lineId) return r;
      if (r.children?.length) {
        const f = walk(r.children);
        if (f) return f;
      }
    }
    return null;
  };
  return walk(incomeStatement ?? []);
}
