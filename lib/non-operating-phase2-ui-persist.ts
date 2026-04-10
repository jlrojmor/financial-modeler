/**
 * Serializable Phase 2 (Non-operating & Schedules) UI state for store / project snapshot.
 * Guidance only — not used in forecast math pipelines.
 */

import type { OpExDirectForecastMethodV1 } from "@/types/opex-forecast-v1";

export type NonOperatingPhase2DirectPersistBody = {
  method: OpExDirectForecastMethodV1;
  pct: number;
  growth: number;
  flat: number;
  manualByYear: Record<string, number>;
};

export type NonOperatingPhase2DirectLinePersist = {
  draft: NonOperatingPhase2DirectPersistBody;
  applied: NonOperatingPhase2DirectPersistBody | null;
};

export function cloneDirectBody(b: NonOperatingPhase2DirectPersistBody): NonOperatingPhase2DirectPersistBody {
  return {
    ...b,
    manualByYear: { ...b.manualByYear },
  };
}

export function defaultNonOperatingDirectBody(projectionYears: string[]): NonOperatingPhase2DirectPersistBody {
  const manualByYear: Record<string, number> = {};
  for (const y of projectionYears) manualByYear[y] = 0;
  return {
    method: "pct_of_revenue",
    pct: 0,
    growth: 0,
    flat: 0,
    manualByYear,
  };
}

export function directBodiesEqual(
  a: NonOperatingPhase2DirectPersistBody,
  b: NonOperatingPhase2DirectPersistBody
): boolean {
  if (a.method !== b.method || a.pct !== b.pct || a.growth !== b.growth || a.flat !== b.flat) return false;
  const keys = new Set([...Object.keys(a.manualByYear), ...Object.keys(b.manualByYear)]);
  for (const k of keys) {
    if ((a.manualByYear[k] ?? 0) !== (b.manualByYear[k] ?? 0)) return false;
  }
  return true;
}
