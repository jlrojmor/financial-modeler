import { hasPersistedOpExDirectForecast } from "@/lib/opex-forecast-projection-v1";
import { opexEffectiveConfidencePct } from "@/lib/opex-routing-ui";
import type { OpExDirectForecastMethodV1, OpExForecastLineConfigV1 } from "@/types/opex-forecast-v1";

/** Line-level nudges on direct forecast cards (max 2 shown). */
export type OpexLineNudgeType = "low_confidence" | "high_impact" | "method_mismatch" | "missing_input";

export type OpexNudgeSeverity = "info" | "warning";

export interface OpexLineNudgeSignal {
  type: OpexLineNudgeType;
  severity: OpexNudgeSeverity;
  label: string;
  tooltip: string;
}

const PRIORITY: OpexLineNudgeType[] = ["missing_input", "high_impact", "low_confidence", "method_mismatch"];

const HIGH_IMPACT_SHARE = 0.15;
const LOW_CONFIDENCE_MAX = 70;
const LARGE_EXCLUDED_SHARE = 0.25;
const CONCENTRATION_SHARE = 0.4;

export function sumAbsHistoricalForLineIds(
  lineIds: string[],
  lastHistByLineId: Record<string, number | null>
): number {
  let s = 0;
  for (const id of lineIds) {
    const v = lastHistByLineId[id];
    if (v != null && Number.isFinite(v)) s += Math.abs(v);
  }
  return s;
}

/** AI suggested % of revenue but user chose a different approach (draft or applied). */
export function isOpexPctSuggestionMismatch(
  suggested: OpExDirectForecastMethodV1 | undefined,
  selectedMethod: string | undefined
): boolean {
  if (suggested !== "pct_of_revenue" || !selectedMethod) return false;
  return (
    selectedMethod === "flat_value" ||
    selectedMethod === "growth_percent" ||
    selectedMethod === "manual_by_year"
  );
}

/**
 * Build up to `maxSignals` line nudges, priority: missing_input → high_impact → low_confidence → method_mismatch.
 */
export function getOpexDirectLineNudges(input: {
  cfg: OpExForecastLineConfigV1 | undefined;
  /** Current method selected in the card UI (may differ until Apply). */
  localMethod: string;
  projectionYears: string[];
  lineLastHist: number | null;
  /** Sum of |last hist| across all lines in the direct forecast section. */
  totalDirectSectionHistAbs: number;
  /** High-impact share is only meaningful when multiple direct lines exist. */
  directLineCount: number;
  maxSignals?: number;
}): OpexLineNudgeSignal[] {
  const {
    cfg,
    localMethod,
    projectionYears,
    lineLastHist,
    totalDirectSectionHistAbs,
    directLineCount,
    maxSignals = 2,
  } = input;

  if (!cfg || cfg.routeStatus !== "forecast_direct") return [];

  const candidates: OpexLineNudgeSignal[] = [];

  if (!hasPersistedOpExDirectForecast(cfg, projectionYears)) {
    candidates.push({
      type: "missing_input",
      severity: "warning",
      label: "Not forecasted",
      tooltip: "This line is included but has no forecast inputs yet.",
    });
  }

  if (
    directLineCount >= 2 &&
    totalDirectSectionHistAbs > 0 &&
    lineLastHist != null &&
    Number.isFinite(lineLastHist)
  ) {
    const share = Math.abs(lineLastHist) / totalDirectSectionHistAbs;
    if (share > HIGH_IMPACT_SHARE) {
      candidates.push({
        type: "high_impact",
        severity: "info",
        label: "High impact",
        tooltip: "This line represents a large portion of operating expenses.",
      });
    }
  }

  if (cfg.routeResolvedBy === "ai") {
    const pct = opexEffectiveConfidencePct(cfg);
    if (pct != null && pct < LOW_CONFIDENCE_MAX) {
      candidates.push({
        type: "low_confidence",
        severity: "warning",
        label: "Low confidence",
        tooltip: "This classification may be unreliable. Consider reviewing this line.",
      });
    }
  }

  const appliedMethod = cfg.forecastMethod as string | undefined;
  if (
    isOpexPctSuggestionMismatch(cfg.aiSuggestedMethod, localMethod) ||
    isOpexPctSuggestionMismatch(cfg.aiSuggestedMethod, appliedMethod)
  ) {
    candidates.push({
      type: "method_mismatch",
      severity: "warning",
      label: "Different from suggestion",
      tooltip: "This differs from the suggested approach. Confirm this is intentional.",
    });
  }

  const out: OpexLineNudgeSignal[] = [];
  for (const t of PRIORITY) {
    const found = candidates.find((c) => c.type === t);
    if (found) out.push(found);
    if (out.length >= maxSignals) break;
  }
  return out;
}

export interface ForecastOpExSectionSummary {
  needAttentionCount: number;
  highImpactCount: number;
  notForecastedCount: number;
  parts: string[];
}

export function getForecastOpExSectionSummary(input: {
  directLines: Array<{ lineId: string }>;
  lineConfig: (lineId: string) => OpExForecastLineConfigV1 | undefined;
  lastHistByLineId: Record<string, number | null>;
  projectionYears: string[];
}): ForecastOpExSectionSummary {
  const { directLines, lineConfig, lastHistByLineId, projectionYears } = input;
  const ids = directLines.map((l) => l.lineId);
  const totalAbs = sumAbsHistoricalForLineIds(ids, lastHistByLineId);
  const directCount = directLines.length;

  let notForecastedCount = 0;
  let highImpactCount = 0;
  let needAttentionCount = 0;

  for (const { lineId } of directLines) {
    const cfg = lineConfig(lineId);
    const lh = lastHistByLineId[lineId];

    if (!hasPersistedOpExDirectForecast(cfg, projectionYears)) {
      notForecastedCount++;
    }

    if (
      directCount >= 2 &&
      totalAbs > 0 &&
      lh != null &&
      Number.isFinite(lh) &&
      Math.abs(lh) / totalAbs > HIGH_IMPACT_SHARE
    ) {
      highImpactCount++;
    }

    let attention = false;
    if (cfg?.routeResolvedBy === "ai") {
      const pct = opexEffectiveConfidencePct(cfg);
      if (pct != null && pct < LOW_CONFIDENCE_MAX) attention = true;
    }
    if (isOpexPctSuggestionMismatch(cfg?.aiSuggestedMethod, cfg?.forecastMethod as string | undefined)) {
      attention = true;
    }
    if (attention) needAttentionCount++;
  }

  const parts: string[] = [];
  if (needAttentionCount > 0) {
    const phrase =
      notForecastedCount > 0
        ? `${needAttentionCount} line${needAttentionCount === 1 ? "" : "s"} need attention`
        : `${needAttentionCount} line${needAttentionCount === 1 ? "" : "s"} worth reviewing`;
    parts.push(phrase);
  }
  if (highImpactCount > 0) {
    parts.push(`${highImpactCount} high impact line${highImpactCount === 1 ? "" : "s"}`);
  }
  if (notForecastedCount > 0) {
    parts.push(`${notForecastedCount} not forecasted`);
  }

  return { needAttentionCount, highImpactCount, notForecastedCount, parts };
}

export type OpexPreviewNudgeType = "preview_high_concentration" | "preview_large_excluded";

export interface OpexPreviewNudge {
  type: OpexPreviewNudgeType;
  severity: "info" | "warning";
  message: string;
}

export function getOpexPreviewNudges(input: {
  visibleLines: Array<{ lineId: string }>;
  lineConfig: (lineId: string) => OpExForecastLineConfigV1 | undefined;
  lastHistByLineId: Record<string, number | null>;
}): OpexPreviewNudge[] {
  const { visibleLines, lineConfig, lastHistByLineId } = input;
  const out: OpexPreviewNudge[] = [];

  const directIds = visibleLines
    .filter((l) => lineConfig(l.lineId)?.routeStatus === "forecast_direct")
    .map((l) => l.lineId);
  const directTotal = sumAbsHistoricalForLineIds(directIds, lastHistByLineId);
  if (directTotal > 0 && directIds.length >= 2) {
    let maxShare = 0;
    for (const id of directIds) {
      const v = lastHistByLineId[id];
      if (v == null || !Number.isFinite(v)) continue;
      maxShare = Math.max(maxShare, Math.abs(v) / directTotal);
    }
    if (maxShare > CONCENTRATION_SHARE) {
      out.push({
        type: "preview_high_concentration",
        severity: "warning",
        message: "Operating expenses are highly concentrated in a single line.",
      });
    }
  }

  const allIds = visibleLines.map((l) => l.lineId);
  const totalVisibleAbs = sumAbsHistoricalForLineIds(allIds, lastHistByLineId);
  const excludedIds = visibleLines
    .filter((l) => lineConfig(l.lineId)?.routeStatus === "excluded_nonrecurring")
    .map((l) => l.lineId);
  const excludedAbs = sumAbsHistoricalForLineIds(excludedIds, lastHistByLineId);
  if (totalVisibleAbs > 0 && excludedAbs / totalVisibleAbs >= LARGE_EXCLUDED_SHARE) {
    out.push({
      type: "preview_large_excluded",
      severity: "info",
      message: "Some large items are excluded from the recurring forecast.",
    });
  }

  return out;
}
