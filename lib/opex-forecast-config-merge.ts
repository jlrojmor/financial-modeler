import type { IngestedOpExLineV1 } from "@/lib/opex-line-ingest";
import { routeOpExLineDeterministic } from "@/lib/opex-routing-deterministic";
import type { OpExForecastConfigV1, OpExForecastLineConfigV1 } from "@/types/opex-forecast-v1";

/**
 * Merge historical IS ingest with persisted config: new lines get deterministic routing;
 * existing lines keep routing/forecast; labels refresh from IS.
 */
export function mergeOpExIngestedWithConfig(
  ingested: IngestedOpExLineV1[],
  existing: Record<string, OpExForecastLineConfigV1>
): Record<string, OpExForecastLineConfigV1> {
  const next: Record<string, OpExForecastLineConfigV1> = {};
  const allowed = new Set(ingested.map((x) => x.lineId));

  for (const row of ingested) {
    const prev = existing[row.lineId];
    if (prev) {
      const det = routeOpExLineDeterministic(row.label);
      next[row.lineId] = {
        ...prev,
        originalLineLabel: row.label,
        parentLineLabel: row.parentLabel,
        sectionOwnerSnapshot: row.sectionOwner ?? prev.sectionOwnerSnapshot,
        routeStatus: prev.routeStatus ?? det.route,
        routeResolvedBy: prev.routeResolvedBy ?? "deterministic",
      };
      continue;
    }
    const det = routeOpExLineDeterministic(row.label);
    next[row.lineId] = {
      lineId: row.lineId,
      originalLineLabel: row.label,
      parentLineLabel: row.parentLabel,
      sectionOwnerSnapshot: row.sectionOwner ?? undefined,
      routeStatus: det.route,
      routeResolvedBy: "deterministic",
      deterministicRuleId: det.ruleId,
      linkedFutureScheduleType: det.linkedFutureScheduleType ?? null,
    };
  }

  for (const id of Object.keys(existing)) {
    if (!allowed.has(id) && next[id] === undefined) {
      // dropped from IS — do not carry forward
    }
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
