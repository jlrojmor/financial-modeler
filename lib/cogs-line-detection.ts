import type { Row } from "@/types/finance";

export type DetectedCogsBucket = "cogs" | "review";
export type DetectedCogsConfidence = "high" | "medium" | "low";

export interface DetectedCogsLine {
  sourceHistoricalLineId: string;
  lineLabel: string;
  detectedBucket: DetectedCogsBucket;
  confidence: DetectedCogsConfidence;
  detectionReason: string;
  originalOrderIndex: number;
}

type FlatRow = {
  row: Row;
  parentId: string | null;
  depth: number;
  orderIndex: number;
};

const STRONG_COGS_LABEL_RE =
  /\b(cost of goods sold|cogs|cost of sales|cost of revenue|cost of products sold|cost of services|service delivery|fulfillment|shipping|logistics|merchant fees?|hosting|infrastructure|revenue share|direct labor|manufacturing costs?|materials?|production costs?)\b/i;
const EXCLUDE_OPEX_LABEL_RE =
  /\b(sg&a|selling|sales and marketing|marketing|general and administrative|g&a|research|r&d|operating expenses?)\b/i;
const REVIEW_DERIVED_HINT_RE =
  /\b(depreciation|amortization|interest|impairment|restructuring|one[- ]?time|non[- ]?recurring|extraordinary)\b/i;
const WEAK_COST_RE = /\b(cost|expenses?)\b/i;

function flattenRows(rows: Row[]): FlatRow[] {
  const out: FlatRow[] = [];
  let idx = 0;
  const walk = (nodes: Row[], parentId: string | null, depth: number) => {
    for (const r of nodes) {
      out.push({ row: r, parentId, depth, orderIndex: idx++ });
      if (r.children?.length) walk(r.children, r.id, depth + 1);
    }
  };
  walk(rows, null, 0);
  return out;
}

function isCoreSummaryId(id: string): boolean {
  return (
    id === "rev" ||
    id === "cogs" ||
    id === "gross_profit" ||
    id === "gross_margin" ||
    id === "operating_expenses" ||
    id === "sga" ||
    id === "rd" ||
    id === "ebit" ||
    id === "ebitda" ||
    id === "net_income"
  );
}

export function detectCogsLinesFromIncomeStatement(
  incomeStatement: Row[] | null | undefined
): DetectedCogsLine[] {
  if (!incomeStatement?.length) return [];
  const flat = flattenRows(incomeStatement);
  const out: DetectedCogsLine[] = [];

  const revTop = incomeStatement.findIndex((r) => r.id === "rev");
  const grossTop = incomeStatement.findIndex((r) => r.id === "gross_profit" || r.id === "gross_margin");

  for (const f of flat) {
    const r = f.row;
    const label = String(r.label ?? "").trim();
    if (!label || isCoreSummaryId(r.id)) continue;

    const lower = label.toLowerCase();
    const topIdx = incomeStatement.findIndex((x) => x.id === r.id);
    const inLikelyCogsBand =
      topIdx >= 0 &&
      revTop >= 0 &&
      topIdx > revTop &&
      (grossTop < 0 || topIdx < grossTop);
    const sectionOwnerCogs = r.sectionOwner === "cogs";
    const strongLabel = STRONG_COGS_LABEL_RE.test(lower);
    const opexLike = EXCLUDE_OPEX_LABEL_RE.test(lower);
    const derivedHint = REVIEW_DERIVED_HINT_RE.test(lower);
    const weakCost = WEAK_COST_RE.test(lower);
    const isDirectChildOfCogs = f.parentId === "cogs";

    if (sectionOwnerCogs || isDirectChildOfCogs) {
      out.push({
        sourceHistoricalLineId: r.id,
        lineLabel: label,
        detectedBucket: derivedHint ? "review" : "cogs",
        confidence: derivedHint ? "medium" : "high",
        detectionReason: derivedHint
          ? "Located in historical COGS area, but label suggests possible derived/non-recurring routing."
          : "Mapped from historical COGS structure.",
        originalOrderIndex: f.orderIndex,
      });
      continue;
    }

    if (strongLabel && !opexLike) {
      out.push({
        sourceHistoricalLineId: r.id,
        lineLabel: label,
        detectedBucket: derivedHint ? "review" : "cogs",
        confidence: inLikelyCogsBand ? "high" : "medium",
        detectionReason: inLikelyCogsBand
          ? "Strong COGS label and position below Revenue before Gross Profit."
          : "Strong COGS label match.",
        originalOrderIndex: f.orderIndex,
      });
      continue;
    }

    if ((weakCost && inLikelyCogsBand && !opexLike) || derivedHint) {
      out.push({
        sourceHistoricalLineId: r.id,
        lineLabel: label,
        detectedBucket: "review",
        confidence: derivedHint ? "medium" : "low",
        detectionReason: derivedHint
          ? "Potential schedule-derived or non-recurring cost line; review before forecasting here."
          : "Position suggests possible COGS, but label is ambiguous.",
        originalOrderIndex: f.orderIndex,
      });
    }
  }

  return out.sort((a, b) => a.originalOrderIndex - b.originalOrderIndex);
}
