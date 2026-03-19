/**
 * Removes forecast-layer revenue rows from the historical Income Statement view / persisted IS.
 * Forecast Drivers used to mutate rev.children; this strips that contamination safely.
 */

import type { Row } from "@/types/finance";
import type { ForecastRevenueNodeV1 } from "@/types/revenue-forecast-v1";

export function collectForecastOnlyIdsFromTree(nodes: ForecastRevenueNodeV1[]): Set<string> {
  const s = new Set<string>();
  const walk = (list: ForecastRevenueNodeV1[]) => {
    for (const n of list) {
      if (n.isForecastOnly) s.add(n.id);
      walk(n.children);
    }
  };
  walk(nodes);
  return s;
}

export function collectAllForecastTreeIds(nodes: ForecastRevenueNodeV1[]): Set<string> {
  const s = new Set<string>();
  const walk = (list: ForecastRevenueNodeV1[]) => {
    for (const n of list) {
      s.add(n.id);
      walk(n.children);
    }
  };
  walk(nodes);
  return s;
}

function subtreeHasNonZeroHistoricalValue(row: Row, historicalYears: string[]): boolean {
  for (const y of historicalYears) {
    const v = row.values?.[y];
    if (v != null && typeof v === "number" && !Number.isNaN(v) && v !== 0) return true;
  }
  for (const c of row.children ?? []) {
    if (subtreeHasNonZeroHistoricalValue(c, historicalYears)) return true;
  }
  return false;
}

/** Store uuid pattern from legacy addRevenueStream / addRevenueStreamChild. */
function isLegacyForecastDriverGeneratedId(id: string): boolean {
  return /^id_[a-f0-9]+_\d+$/i.test(id) || (id.startsWith("id_") && id.split("_").length >= 3);
}

/**
 * True if this row under rev should be removed from historical IS.
 * - Marked forecast-only in the forecast tree (must not live on historical IS).
 * - Legacy id_* row not present in tree at all, with no non-zero historical values (orphan pollution).
 */
export function shouldStripRevenueRowFromHistoricalIs(
  row: Row,
  forecastOnlyIds: Set<string>,
  allTreeIds: Set<string>,
  historicalYears: string[]
): boolean {
  if (forecastOnlyIds.has(row.id)) return true;
  if (allTreeIds.has(row.id)) return false;
  if (isLegacyForecastDriverGeneratedId(row.id) && !subtreeHasNonZeroHistoricalValue(row, historicalYears)) {
    return true;
  }
  return false;
}

function filterRevChildren(
  children: Row[],
  forecastOnlyIds: Set<string>,
  allTreeIds: Set<string>,
  historicalYears: string[]
): Row[] {
  const out: Row[] = [];
  for (const c of children) {
    if (shouldStripRevenueRowFromHistoricalIs(c, forecastOnlyIds, allTreeIds, historicalYears)) continue;
    out.push({
      ...c,
      children:
        c.children?.length && c.children.length > 0
          ? filterRevChildren(c.children, forecastOnlyIds, allTreeIds, historicalYears)
          : undefined,
    });
  }
  return out;
}

/**
 * Returns a new income statement with polluted revenue subtrees removed under rev.
 * Idempotent. Does not mutate input.
 */
export function sanitizeHistoricalRevenueInIncomeStatement(
  incomeStatement: Row[],
  forecastTree: ForecastRevenueNodeV1[],
  historicalYears: string[]
): Row[] {
  const forecastOnlyIds = collectForecastOnlyIdsFromTree(forecastTree);
  const allTreeIds = collectAllForecastTreeIds(forecastTree);
  const years = historicalYears ?? [];
  return incomeStatement.map((r) => {
    if (r.id !== "rev") return r;
    const ch = r.children ?? [];
    const nextChildren = filterRevChildren(ch, forecastOnlyIds, allTreeIds, years);
    const nextKind =
      nextChildren.length === 0 && r.kind === "calc" ? "input" : r.kind === "calc" && nextChildren.length > 0 ? "calc" : r.kind;
    return { ...r, children: nextChildren, kind: nextKind };
  });
}

function findRowDeep(rows: Row[], id: string): Row | null {
  for (const r of rows) {
    if (r.id === id) return r;
    if (r.children?.length) {
      const f = findRowDeep(r.children, id);
      if (f) return f;
    }
  }
  return null;
}

/**
 * Build Row[] for rev.children from forecast tree (preview / projected view).
 * Values come from historical IS when a row with same id exists.
 */
export function forecastTreeToRevenueRows(
  nodes: ForecastRevenueNodeV1[],
  valueSourceIncomeStatement: Row[]
): Row[] {
  return nodes.map((n) => {
    const src = findRowDeep(valueSourceIncomeStatement, n.id);
    return {
      id: n.id,
      label: n.label,
      kind: (src?.kind as Row["kind"]) ?? "input",
      valueType: (src?.valueType as Row["valueType"]) ?? "currency",
      values: src?.values ? { ...src.values } : {},
      children:
        n.children.length > 0 ? forecastTreeToRevenueRows(n.children, valueSourceIncomeStatement) : undefined,
    } as Row;
  });
}

/**
 * Replace rev subtree with forecast tree rows for preview; rest of IS unchanged.
 * @param historicalRevValuesByYear — Total Revenue actuals per historical year from real IS (so rev line is correct when children are forecast-only stubs).
 */
export function mergeForecastRevenueTreeIntoIncomeStatementForPreview(
  incomeStatement: Row[],
  forecastTree: ForecastRevenueNodeV1[],
  valueSourceIncomeStatement: Row[],
  historicalRevValuesByYear: Record<string, number> = {}
): Row[] {
  if (!forecastTree.length) return incomeStatement;
  const revChildren = forecastTreeToRevenueRows(forecastTree, valueSourceIncomeStatement);
  return incomeStatement.map((r) => {
    if (r.id !== "rev") return r;
    const kind = revChildren.length > 0 ? "calc" : r.kind === "calc" ? "input" : r.kind;
    const values = { ...r.values };
    for (const [y, v] of Object.entries(historicalRevValuesByYear)) {
      values[y] = v;
    }
    return { ...r, children: revChildren, kind, values };
  });
}

function rowIdExistsUnderRev(incomeStatement: Row[], id: string): boolean {
  const rev = incomeStatement.find((r) => r.id === "rev");
  const walk = (ch: Row[]): boolean => {
    for (const c of ch) {
      if (c.id === id) return true;
      if (c.children?.length && walk(c.children)) return true;
    }
    return false;
  };
  return walk(rev?.children ?? []);
}

/**
 * After historical IS is sanitized, drop tree nodes that mirrored IS rows which no longer exist under rev.
 * Keeps every isForecastOnly node and every node whose id still appears under rev on the IS.
 */
export function pruneForecastTreeToMatchSanitizedIs(
  tree: ForecastRevenueNodeV1[],
  sanitizedIncomeStatement: Row[]
): ForecastRevenueNodeV1[] {
  const prune = (nodes: ForecastRevenueNodeV1[]): ForecastRevenueNodeV1[] =>
    nodes
      .filter((n) => n.isForecastOnly || rowIdExistsUnderRev(sanitizedIncomeStatement, n.id))
      .map((n) => ({ ...n, children: prune(n.children) }));
  return prune(tree);
}

/** Remove any row under rev whose id is in removeIds (non-recursive filter at each level; children pruned). */
export function removeRevenueRowIdsUnderRev(incomeStatement: Row[], removeIds: Set<string>): Row[] {
  const prune = (children: Row[]): Row[] =>
    children
      .filter((c) => !removeIds.has(c.id))
      .map((c) => ({
        ...c,
        children: c.children?.length ? prune(c.children) : undefined,
      }));

  return incomeStatement.map((r) => {
    if (r.id !== "rev") return r;
    const nextChildren = prune(r.children ?? []);
    const kind =
      nextChildren.length === 0 && r.kind === "calc" ? "input" : r.kind === "calc" && nextChildren.length > 0 ? "calc" : r.kind;
    return { ...r, children: nextChildren, kind };
  });
}
