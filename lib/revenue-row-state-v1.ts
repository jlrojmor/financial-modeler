/**
 * Canonical structural modes for Revenue Forecast v1 rows (forecast tree only).
 * Maps roles + tree shape to user-facing state labels.
 */

import type { ForecastRevenueNodeV1, RevenueForecastRowConfigV1 } from "@/types/revenue-forecast-v1";

export type RevenueRowStructuralModeV1 =
  | "direct_standalone"
  | "direct_with_allocation_children"
  | "derived_parent"
  | "allocation_child";

export function getRevenueRowStructuralMode(
  node: ForecastRevenueNodeV1,
  cfg: RevenueForecastRowConfigV1 | undefined
): RevenueRowStructuralModeV1 {
  const role = cfg?.forecastRole ?? "independent_driver";
  if (role === "allocation_of_parent") return "allocation_child";
  if (role === "derived_sum") return "derived_parent";
  if (node.children.length > 0) return "direct_with_allocation_children";
  return "direct_standalone";
}

/** Short label for row status header */
export function structuralModeLabel(mode: RevenueRowStructuralModeV1): string {
  switch (mode) {
    case "direct_standalone":
      return "Direct";
    case "direct_with_allocation_children":
      return "Direct + allocation children";
    case "derived_parent":
      return "Built from child lines";
    case "allocation_child":
      return "Allocation";
  }
}

export type RevenueRowDataBasisV1 = "historical_actual" | "forecast_only" | "allocation_based" | "sum_of_children";

export function getRevenueRowDataBasis(
  mode: RevenueRowStructuralModeV1,
  node: ForecastRevenueNodeV1,
  lastHistoricByRowId: Record<string, number> | undefined
): RevenueRowDataBasisV1 {
  if (mode === "allocation_child") return "allocation_based";
  if (mode === "derived_parent") return "sum_of_children";
  if (node.isForecastOnly) return "forecast_only";
  const v = lastHistoricByRowId?.[node.id];
  if (typeof v === "number" && !Number.isNaN(v)) return "historical_actual";
  return "forecast_only";
}

export function dataBasisLabel(basis: RevenueRowDataBasisV1): string {
  switch (basis) {
    case "historical_actual":
      return "Historical actual available";
    case "forecast_only":
      return "Forecast-only";
    case "allocation_based":
      return "Allocation-based";
    case "sum_of_children":
      return "Sum of children";
  }
}

/** Ids from root to parent of target (exclusive of target). Used to expand path. */
export function findAncestorChainToNode(
  nodes: ForecastRevenueNodeV1[],
  targetId: string,
  prefix: string[] = []
): string[] | null {
  for (const n of nodes) {
    if (n.id === targetId) return prefix;
    const inner = findAncestorChainToNode(n.children, targetId, [...prefix, n.id]);
    if (inner !== null) return inner;
  }
  return null;
}

/** All ids on path from root to node (inclusive), for expand + scroll. */
export function expandIdsForNodePath(
  nodes: ForecastRevenueNodeV1[],
  targetId: string,
  prefix: string[] = []
): string[] | null {
  for (const n of nodes) {
    if (n.id === targetId) return [...prefix, n.id];
    const inner = expandIdsForNodePath(n.children, targetId, [...prefix, n.id]);
    if (inner) return inner;
  }
  return null;
}
