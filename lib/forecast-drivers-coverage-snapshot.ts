/**
 * Canonical view of what Forecast Drivers "owns" for projection — for CFS vs FD diagnosis and AI prompts.
 */

import type { Row } from "@/types/finance";
import { findRowInTree } from "@/lib/row-utils";
import {
  classifyCfsLineForProjection,
  inventoryCfsLinesForDiagnostics,
  type CfsLineProjectionClass,
} from "@/lib/cfs-line-classification";
import { getWcScheduleItemIdsFromRouting } from "@/lib/working-capital-schedule";
import { getOtherBsItems } from "@/lib/other-bs-items";
import type { ModelState } from "@/store/useModelStore";

function flattenIds(rows: Row[], out: string[] = []): string[] {
  for (const r of rows) {
    out.push(r.id);
    if (r.children?.length) flattenIds(r.children, out);
  }
  return out;
}

export type ForecastDriversCoverageSnapshot = {
  /** All IS row ids (flattened). */
  incomeStatementRowIds: string[];
  /** All BS row ids (flattened). */
  balanceSheetRowIds: string[];
  /** Revenue forecast tree / config line ids. */
  revenueForecastLineIds: string[];
  /** WC schedule item ids (BS-linked). */
  wcScheduleItemIds: string[];
  /** Other BS forecast panel item ids. */
  otherBsItemIds: string[];
  /** High-level FD flags (what user confirmed). */
  flags: {
    wcDriversConfirmed: boolean;
    dandaScheduleConfirmed: boolean;
    debtApplied: boolean;
    equityRollforwardConfirmed: boolean;
    otherBsConfirmed: boolean;
    taxScheduleConfirmed: boolean;
  };
};

export type CfsLineCoverageCompare = {
  cfsRowId: string;
  label: string;
  deterministicClass: CfsLineProjectionClass;
  /** Heuristic: cfs row id or cfo_* maps to this BS id. */
  resolvedBsId: string | null;
  /** Whether snapshot lists this BS id as forecastable (Other BS / WC). */
  bsIdInCoverageSet: boolean;
  /** Whether cfs line id or linked IS id appears in forecast surface. */
  likelyCoveredByForecastDrivers: boolean;
  gaps: string[];
};

/**
 * Build coverage snapshot from live model state (client or server with compatible shape).
 */
export function buildForecastDriversCoverageSnapshotFromModel(state: Pick<
  ModelState,
  | "incomeStatement"
  | "balanceSheet"
  | "cashFlow"
  | "revenueForecastTreeV1"
  | "wcDriversConfirmed"
  | "dandaScheduleConfirmed"
  | "equityRollforwardConfirmed"
  | "otherBsConfirmed"
  | "taxScheduleConfirmed"
  | "debtSchedulePhase2Persist"
  | "meta"
>): ForecastDriversCoverageSnapshot {
  const is = state.incomeStatement ?? [];
  const bs = state.balanceSheet ?? [];
  const cf = state.cashFlow ?? [];

  const revenueForecastLineIds: string[] = [];
  const walkTree = (nodes: { id: string; children?: unknown[] }[]) => {
    for (const n of nodes) {
      revenueForecastLineIds.push(n.id);
      if (n.children?.length) walkTree(n.children as { id: string; children?: unknown[] }[]);
    }
  };
  walkTree((state.revenueForecastTreeV1 ?? []) as { id: string; children?: unknown[] }[]);

  const wcIds = new Set(getWcScheduleItemIdsFromRouting(bs));
  const hist = state.meta?.years?.historical ?? [];
  const otherBs = getOtherBsItems(bs, cf, hist).map((x) => x.id);

  const debtApplied = state.debtSchedulePhase2Persist?.applied != null;

  return {
    incomeStatementRowIds: flattenIds(is),
    balanceSheetRowIds: flattenIds(bs),
    revenueForecastLineIds,
    wcScheduleItemIds: [...wcIds],
    otherBsItemIds: otherBs,
    flags: {
      wcDriversConfirmed: state.wcDriversConfirmed ?? false,
      dandaScheduleConfirmed: state.dandaScheduleConfirmed ?? false,
      debtApplied,
      equityRollforwardConfirmed: state.equityRollforwardConfirmed ?? false,
      otherBsConfirmed: state.otherBsConfirmed ?? false,
      taxScheduleConfirmed: state.taxScheduleConfirmed ?? false,
    },
  };
}

function cfoToBsId(cfsRowId: string): string | null {
  if (!cfsRowId.startsWith("cfo_")) return null;
  return cfsRowId.slice("cfo_".length);
}

/**
 * Compare one CFS row to FD coverage + deterministic classification.
 */
export function compareCfsLineToCoverage(
  row: Row,
  snapshot: ForecastDriversCoverageSnapshot,
  balanceSheet: Row[],
  incomeStatement: Row[]
): CfsLineCoverageCompare {
  const inv = inventoryCfsLinesForDiagnostics([row], balanceSheet).find((e) => e.id === row.id);
  const deterministicClass = inv?.classification ?? classifyCfsLineForProjection(row, balanceSheet);

  const gaps: string[] = [];
  let resolvedBsId: string | null = null;
  if (row.cfsLink?.cfsItemId && findRowInTree(balanceSheet, row.cfsLink.cfsItemId)) {
    resolvedBsId = row.cfsLink.cfsItemId;
  } else if (findRowInTree(balanceSheet, row.id)) {
    resolvedBsId = row.id;
  } else if (row.id.startsWith("cfo_")) {
    const bsId = cfoToBsId(row.id);
    if (bsId && findRowInTree(balanceSheet, bsId)) resolvedBsId = bsId;
  }

  const bsSet = new Set(snapshot.balanceSheetRowIds);
  const wcSet = new Set(snapshot.wcScheduleItemIds);
  const otherBsSet = new Set(snapshot.otherBsItemIds);
  const isSet = new Set(snapshot.incomeStatementRowIds);
  const revSet = new Set(snapshot.revenueForecastLineIds);

  const bsIdInCoverageSet =
    resolvedBsId != null &&
    (bsSet.has(resolvedBsId) || wcSet.has(resolvedBsId) || otherBsSet.has(resolvedBsId));

  let likelyCoveredByForecastDrivers = false;
  if (deterministicClass === "schedule") likelyCoveredByForecastDrivers = true;
  if (deterministicClass === "maps_to_bs" && bsIdInCoverageSet) likelyCoveredByForecastDrivers = true;
  if (deterministicClass === "maps_to_is") {
    const isLink = row.isLink?.isItemId;
    if (isLink && (isSet.has(isLink) || revSet.has(isLink))) likelyCoveredByForecastDrivers = true;
    if (row.taxonomyType?.startsWith("opex_") && snapshot.flags.dandaScheduleConfirmed) likelyCoveredByForecastDrivers = true;
  }
  if (deterministicClass === "cf_disclosure_only") likelyCoveredByForecastDrivers = false;

  if (deterministicClass === "cf_disclosure_only") {
    gaps.push("No automatic BS/IS bridge; needs disclosure policy or mapping.");
  }
  if (deterministicClass === "maps_to_bs" && resolvedBsId && !bsIdInCoverageSet) {
    gaps.push(`BS account ${resolvedBsId} not in WC/Other BS coverage sets.`);
  }

  return {
    cfsRowId: row.id,
    label: row.label,
    deterministicClass,
    resolvedBsId,
    bsIdInCoverageSet,
    likelyCoveredByForecastDrivers,
    gaps,
  };
}

/**
 * Full compare table for all CFS rows (flattened tree).
 */
export function compareAllCfsLinesToCoverage(
  cashFlow: Row[],
  balanceSheet: Row[],
  incomeStatement: Row[],
  snapshot: ForecastDriversCoverageSnapshot
): CfsLineCoverageCompare[] {
  const flat: Row[] = [];
  const walk = (rows: Row[]) => {
    for (const r of rows) {
      flat.push(r);
      if (r.children?.length) walk(r.children);
    }
  };
  walk(cashFlow ?? []);
  return flat.map((row) => compareCfsLineToCoverage(row, snapshot, balanceSheet, incomeStatement));
}
