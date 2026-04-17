/**
 * Validate and merge AI CFS diagnosis suggestions with deterministic checks.
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";
import type {
  CfsAiMaterialityNote,
  CfsAiRecommendedTreatment,
  CfsAiSuggestedMapping,
  CfsLineAiDiagnosisPayload,
} from "@/types/cfs-forecast-diagnosis-v1";

export type RawAiCfsLineSuggestion = {
  cfsRowId: string;
  suggestedMapping: string;
  linkedRowId?: string;
  rationale?: string;
  recommendedTreatment: string;
  confidence?: number;
  flags?: string[];
  executiveSummary?: string;
  bridgeRecommendation?: string;
  doubleCountRisk?: string;
  rejectedAlternatives?: string[];
  materialityNote?: string;
};

const MAPPINGS: CfsAiSuggestedMapping[] = [
  "none",
  "balance_sheet",
  "income_statement",
  "schedule",
  "unmapped",
];

const TREATMENTS: CfsAiRecommendedTreatment[] = [
  "map_to_bs",
  "use_is_bridge",
  "flat_last",
  "pct_revenue",
  "zero",
  "exclude",
  "manual_grid",
];

function normMapping(s: string): CfsAiSuggestedMapping {
  const x = String(s).toLowerCase().replace(/\s+/g, "_") as CfsAiSuggestedMapping;
  return MAPPINGS.includes(x) ? x : "unmapped";
}

function normTreatment(s: string): CfsAiRecommendedTreatment {
  const x = String(s).toLowerCase().replace(/\s+/g, "_") as CfsAiRecommendedTreatment;
  return TREATMENTS.includes(x) ? x : "flat_last";
}

const MATERIALITY: CfsAiMaterialityNote[] = ["immaterial", "standard", "material"];

function normMateriality(s: unknown): CfsAiMaterialityNote | undefined {
  const x = String(s ?? "").toLowerCase() as CfsAiMaterialityNote;
  return MATERIALITY.includes(x) ? x : undefined;
}

/**
 * Ensure linkedRowId exists on BS or IS when mapping claims a link; otherwise downgrade to unmapped.
 */
export function validateAiCfsSuggestion(
  raw: RawAiCfsLineSuggestion,
  balanceSheet: Row[],
  incomeStatement: Row[]
): CfsLineAiDiagnosisPayload {
  let suggestedMapping = normMapping(raw.suggestedMapping);
  let linkedRowId =
    typeof raw.linkedRowId === "string" && raw.linkedRowId.trim() ? raw.linkedRowId.trim() : undefined;
  let rationale = typeof raw.rationale === "string" ? raw.rationale.slice(0, 500) : "";
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.5;
  const flags = Array.isArray(raw.flags) ? raw.flags.map(String).slice(0, 8) : undefined;

  if (linkedRowId) {
    const onBs = findRowInTree(balanceSheet, linkedRowId) != null;
    const onIs = findRowInTree(incomeStatement, linkedRowId) != null;
    if (suggestedMapping === "balance_sheet" && !onBs) {
      suggestedMapping = "unmapped";
      linkedRowId = undefined;
      rationale = `[Adjusted] Linked id not on balance sheet. ${rationale}`;
    } else if (suggestedMapping === "income_statement" && !onIs) {
      suggestedMapping = "unmapped";
      linkedRowId = undefined;
      rationale = `[Adjusted] Linked id not on income statement. ${rationale}`;
    } else if (suggestedMapping === "balance_sheet" && onBs) {
      /* ok */
    } else if (suggestedMapping === "income_statement" && onIs) {
      /* ok */
    } else if (!onBs && !onIs) {
      linkedRowId = undefined;
    }
  }

  const executiveSummary =
    typeof raw.executiveSummary === "string" ? raw.executiveSummary.slice(0, 1200) : undefined;
  const bridgeRecommendation =
    typeof raw.bridgeRecommendation === "string" ? raw.bridgeRecommendation.slice(0, 800) : undefined;
  const doubleCountRisk =
    typeof raw.doubleCountRisk === "string" ? raw.doubleCountRisk.slice(0, 500) : undefined;
  const rejectedAlternatives = Array.isArray(raw.rejectedAlternatives)
    ? raw.rejectedAlternatives
        .map((x) => String(x).slice(0, 280))
        .filter(Boolean)
        .slice(0, 3)
    : undefined;
  const materialityNote = normMateriality(raw.materialityNote);

  return {
    suggestedMapping,
    ...(linkedRowId ? { linkedRowId } : {}),
    rationale,
    recommendedTreatment: normTreatment(raw.recommendedTreatment || "flat_last"),
    confidence,
    ...(flags?.length ? { flags } : {}),
    ...(executiveSummary ? { executiveSummary } : {}),
    ...(bridgeRecommendation ? { bridgeRecommendation } : {}),
    ...(doubleCountRisk ? { doubleCountRisk } : {}),
    ...(rejectedAlternatives?.length ? { rejectedAlternatives } : {}),
    ...(materialityNote ? { materialityNote } : {}),
  };
}
