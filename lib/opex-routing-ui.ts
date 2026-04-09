import type {
  OpExForecastLineConfigV1,
  OpExRouteResolvedByV1,
  OpExRouteStatusV1,
} from "@/types/opex-forecast-v1";

/** Pill color bucket for collapsed direct OpEx cards (maps from `OpExRouteResolvedByV1` in the panel). */
export type OpexCollapsedDirectRoutePillSource = "user" | "ai" | "rule";

export function legacyAiConfidenceToPct(c: "high" | "medium" | "low" | undefined): number | null {
  if (c === "high") return 88;
  if (c === "medium") return 68;
  if (c === "low") return 45;
  return null;
}

/** Banker-grade badge: high = subtle green, medium = amber, low = muted warning. */
export function opexConfidenceBadgeClass(pct: number): string {
  if (pct >= 80) return "text-emerald-400/90 border-emerald-800/50 bg-emerald-950/35";
  if (pct >= 55) return "text-amber-300/90 border-amber-800/45 bg-amber-950/25";
  return "text-rose-300/75 border-rose-900/50 bg-rose-950/30";
}

export function formatOpexConfidencePct(pct: number): string {
  return `${Math.round(Math.max(0, Math.min(100, pct)))}% confidence`;
}

/** When the user overrode the suggestion, the % reflects the automatic pattern match, not their choice. */
export function formatOpexClassifierReferencePct(pct: number): string {
  const n = Math.round(Math.max(0, Math.min(100, pct)));
  return `Pattern match: ${n}%`;
}

/** Map persisted route to a short pill label (display-only). */
export function formatOpexCollapsedDirectRoutePillLabel(route: OpExRouteStatusV1 | string): string {
  if (route === "forecast_direct") return "Forecast here";
  if (route === "classify_and_allocate") return "Allocate by driver";
  if (route === "exclude" || route === "excluded_nonrecurring") return "Excluded";
  return "Route pending";
}

export function getOpexCollapsedDirectRoutePillClassName(
  source: OpexCollapsedDirectRoutePillSource | undefined
): string {
  if (source === "user") return "border-blue-200 bg-blue-50 text-blue-700";
  if (source === "ai") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (source === "rule") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function opexRouteSourceLabel(resolvedBy: OpExRouteResolvedByV1 | undefined): string {
  if (resolvedBy === "user") return "Your choice";
  if (resolvedBy === "ai") return "AI suggestion";
  return "Automatic";
}

export function opexEffectiveConfidencePct(cfg: OpExForecastLineConfigV1 | undefined): number | null {
  if (!cfg) return null;
  const rb = cfg.routeResolvedBy ?? "deterministic";
  if (rb === "user") {
    return typeof cfg.deterministicConfidencePct === "number" ? cfg.deterministicConfidencePct : null;
  }
  if (rb === "ai") {
    if (typeof cfg.aiConfidencePct === "number") return cfg.aiConfidencePct;
    const leg = legacyAiConfidenceToPct(cfg.aiConfidence);
    if (leg != null) return leg;
    return typeof cfg.deterministicConfidencePct === "number" ? cfg.deterministicConfidencePct : null;
  }
  return typeof cfg.deterministicConfidencePct === "number" ? cfg.deterministicConfidencePct : null;
}

/** Short reason for the active routing decision (deterministic shadow when user overrode). */
export function opexPrimaryRouteReason(cfg: OpExForecastLineConfigV1 | undefined): string {
  if (!cfg) return "";
  const rb = cfg.routeResolvedBy ?? "deterministic";
  if (rb === "user") {
    if (cfg.deterministicExplanation) return cfg.deterministicExplanation;
    return cfg.aiUserFacingSummary ?? cfg.aiExplanation ?? "";
  }
  if (rb === "ai") return cfg.aiUserFacingSummary ?? cfg.aiExplanation ?? cfg.deterministicExplanation ?? "";
  return cfg.deterministicExplanation ?? cfg.aiUserFacingSummary ?? cfg.aiExplanation ?? "";
}

/** Optional second line when user overrode but AI text is still useful. */
export function opexAiReferenceReason(cfg: OpExForecastLineConfigV1 | undefined): string {
  if (!cfg || cfg.routeResolvedBy !== "user") return "";
  const ai = cfg.aiUserFacingSummary ?? cfg.aiExplanation ?? "";
  if (!ai || ai === cfg.deterministicExplanation) return "";
  return ai;
}

/**
 * One-line routing summary for collapsed direct OpEx cards: route · source · confidence.
 * Uses the same source labels and numeric confidence / classifier-reference wording as the rest of OpEx routing UI.
 */
export function formatOpexCollapsedDirectRoutingSummary(
  cfg: OpExForecastLineConfigV1 | undefined,
  directRouteShortLabel: string
): string {
  if (!cfg) return directRouteShortLabel;
  const src = opexRouteSourceLabel(cfg.routeResolvedBy);
  const pct = opexEffectiveConfidencePct(cfg);
  const rb = cfg.routeResolvedBy ?? "deterministic";
  let confSeg = "";
  if (pct != null) {
    confSeg =
      rb === "user"
        ? formatOpexClassifierReferencePct(pct)
        : formatOpexConfidencePct(pct);
  } else if (rb === "ai" && (cfg.aiConfidence === "high" || cfg.aiConfidence === "medium" || cfg.aiConfidence === "low")) {
    const cap = cfg.aiConfidence.charAt(0).toUpperCase() + cfg.aiConfidence.slice(1);
    confSeg = `${cap} confidence`;
  }
  return confSeg ? `${directRouteShortLabel} · ${src} · ${confSeg}` : `${directRouteShortLabel} · ${src}`;
}

/**
 * Provenance + confidence only (no route phrase). For collapsed direct OpEx cards under the route pill.
 * Uses the same `cfg` fields as `formatOpexCollapsedDirectRoutingSummary` / `opexEffectiveConfidencePct`.
 */
export function formatOpexCollapsedDirectRoutingProvenanceSummary(
  cfg: OpExForecastLineConfigV1 | undefined
): string {
  if (!cfg) return "";
  const src = opexRouteSourceLabel(cfg.routeResolvedBy);
  const pct = opexEffectiveConfidencePct(cfg);
  const rb = cfg.routeResolvedBy ?? "deterministic";
  if (pct != null) {
    if (rb === "user") {
      return `${src} · ${formatOpexClassifierReferencePct(pct)}`;
    }
    return `${src} · ${formatOpexConfidencePct(pct)}`;
  }
  if (rb === "ai" && (cfg.aiConfidence === "high" || cfg.aiConfidence === "medium" || cfg.aiConfidence === "low")) {
    const cap = cfg.aiConfidence.charAt(0).toUpperCase() + cfg.aiConfidence.slice(1);
    return `${src} · ${cap} confidence`;
  }
  return src;
}

/** One-line summary for preview lists. */
export function formatOpexRoutedLineSummary(cfg: OpExForecastLineConfigV1 | undefined): string {
  if (!cfg) return "";
  const src = opexRouteSourceLabel(cfg.routeResolvedBy);
  const pct = opexEffectiveConfidencePct(cfg);
  const reason = opexPrimaryRouteReason(cfg);
  const pctPart =
    pct != null
      ? cfg.routeResolvedBy === "user"
        ? ` · ${formatOpexClassifierReferencePct(pct)}`
        : ` · ${formatOpexConfidencePct(pct)}`
      : "";
  const reasonPart = reason ? ` — ${reason}` : "";
  return `${src}${pctPart}${reasonPart}`;
}
