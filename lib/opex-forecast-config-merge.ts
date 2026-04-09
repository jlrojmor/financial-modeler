import type { IngestedOpExLineV1 } from "@/lib/opex-line-ingest";
import { routeOpExLineDeterministic } from "@/lib/opex-routing-deterministic";
import type { OpExForecastConfigV1, OpExForecastLineConfigV1 } from "@/types/opex-forecast-v1";

function applyDeterministicShadow(
  line: Partial<OpExForecastLineConfigV1>,
  det: ReturnType<typeof routeOpExLineDeterministic>
): Partial<OpExForecastLineConfigV1> {
  return {
    ...line,
    deterministicRuleId: det.ruleId,
    deterministicConfidencePct: det.confidencePct,
    deterministicExplanation: det.explanation,
    deterministicNormalizedCategory: det.normalizedCategory,
    linkedFutureScheduleType: det.linkedFutureScheduleType ?? line.linkedFutureScheduleType ?? null,
  };
}

/**
 * Merge historical IS ingest with persisted config.
 * - New lines: full deterministic routing + metadata.
 * - User override: never changes routeStatus / routeResolvedBy / forecast fields; refreshes deterministic “shadow” for transparency.
 * - AI-applied: keeps route + routeResolvedBy; refreshes shadow from current label.
 * - Deterministic: recomputes route from label (label drift / relabel).
 */
export function mergeOpExIngestedWithConfig(
  ingested: IngestedOpExLineV1[],
  existing: Record<string, OpExForecastLineConfigV1>
): Record<string, OpExForecastLineConfigV1> {
  const next: Record<string, OpExForecastLineConfigV1> = {};

  for (const row of ingested) {
    const prev = existing[row.lineId];
    const det = routeOpExLineDeterministic(row.label);

    if (prev) {
      const resolved = prev.routeResolvedBy ?? "deterministic";

      if (resolved === "user") {
        next[row.lineId] = applyDeterministicShadow(
          {
            ...prev,
            originalLineLabel: row.label,
            parentLineLabel: row.parentLabel,
            sectionOwnerSnapshot: row.sectionOwner ?? prev.sectionOwnerSnapshot,
          },
          det
        ) as OpExForecastLineConfigV1;
        continue;
      }

      if (resolved === "ai") {
        next[row.lineId] = applyDeterministicShadow(
          {
            ...prev,
            originalLineLabel: row.label,
            parentLineLabel: row.parentLabel,
            sectionOwnerSnapshot: row.sectionOwner ?? prev.sectionOwnerSnapshot,
          },
          det
        ) as OpExForecastLineConfigV1;
        continue;
      }

      next[row.lineId] = {
        ...prev,
        originalLineLabel: row.label,
        parentLineLabel: row.parentLabel,
        sectionOwnerSnapshot: row.sectionOwner ?? prev.sectionOwnerSnapshot,
        routeStatus: det.route,
        routeResolvedBy: "deterministic",
        deterministicRuleId: det.ruleId,
        linkedFutureScheduleType: det.linkedFutureScheduleType ?? null,
        deterministicConfidencePct: det.confidencePct,
        deterministicExplanation: det.explanation,
        deterministicNormalizedCategory: det.normalizedCategory,
      };
      continue;
    }

    next[row.lineId] = {
      lineId: row.lineId,
      originalLineLabel: row.label,
      parentLineLabel: row.parentLabel,
      sectionOwnerSnapshot: row.sectionOwner ?? undefined,
      routeStatus: det.route,
      routeResolvedBy: "deterministic",
      deterministicRuleId: det.ruleId,
      linkedFutureScheduleType: det.linkedFutureScheduleType ?? null,
      deterministicConfidencePct: det.confidencePct,
      deterministicExplanation: det.explanation,
      deterministicNormalizedCategory: det.normalizedCategory,
    };
  }

  return next;
}

export function buildOpExForecastConfigMerged(
  ingested: IngestedOpExLineV1[],
  prevConfig: OpExForecastConfigV1 | undefined
): OpExForecastConfigV1 {
  const lines = mergeOpExIngestedWithConfig(ingested, prevConfig?.lines ?? {});
  return { version: 1, lines };
}
