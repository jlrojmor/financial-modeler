/**
 * Chronological year labels for cross-statement bridges (CFS ↔ BS).
 * Unions value keys from row trees so prior-year resolution does not depend on balanceSheet[0].
 */

import type { Row } from "@/types/finance";

function walkRows(rows: Row[], visit: (r: Row) => void): void {
  for (const r of rows) {
    visit(r);
    if (r.children?.length) walkRows(r.children, visit);
  }
}

/** All value year keys appearing anywhere in a statement tree. */
export function collectYearKeysFromRowTree(rows: Row[]): string[] {
  const set = new Set<string>();
  walkRows(rows, (r) => {
    for (const k of Object.keys(r.values ?? {})) set.add(k);
  });
  return [...set];
}

/**
 * Sort key: calendar year (4 digits), then suffix so historicals precede projections when both exist.
 * Plain "2025" sorts between "2024…" and "2026…"; "2025A"/"2025E" use letter band.
 */
function yearLabelSortKey(label: string): [number, number, string] {
  const m = label.match(/^(\d{4})(.*)$/);
  if (!m) return [9_999_999, 99, label];
  const yy = parseInt(m[1], 10);
  const rest = (m[2] ?? "").trim();
  const u = rest.toUpperCase();
  let band = 1;
  if (rest === "") band = 0;
  else if (u === "A" || u.endsWith("A")) band = 0;
  else if (u === "E" || u.endsWith("E")) band = 2;
  return [yy, band, label];
}

export function compareYearLabels(a: string, b: string): number {
  const ka = yearLabelSortKey(a);
  const kb = yearLabelSortKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  return a.localeCompare(b);
}

export function sortYearsChronologically(years: string[]): string[] {
  return [...new Set(years)].sort(compareYearLabels);
}

export function getChronologicalYearsFromBalanceSheet(balanceSheet: Row[]): string[] {
  return sortYearsChronologically(collectYearKeysFromRowTree(balanceSheet));
}

/**
 * Full model timeline: prefer BS keys, then IS, then CFS (same fallbacks as legacy wc_change logic).
 */
export function buildModelYearTimeline(allStatements: {
  balanceSheet: Row[];
  incomeStatement: Row[];
  cashFlow: Row[];
}): string[] {
  let keys = collectYearKeysFromRowTree(allStatements.balanceSheet);
  if (keys.length === 0) keys = collectYearKeysFromRowTree(allStatements.incomeStatement);
  if (keys.length === 0) keys = collectYearKeysFromRowTree(allStatements.cashFlow);
  return sortYearsChronologically(keys);
}

/**
 * Previous label on the timeline before `year`. Uses strict ordering from compareYearLabels.
 */
export function resolvePriorYear(year: string, timelineUnsorted: string[]): string | null {
  const sorted = sortYearsChronologically(timelineUnsorted);
  const idx = sorted.indexOf(year);
  if (idx > 0) return sorted[idx - 1]!;

  if (idx === 0) return null;

  let pred: string | null = null;
  for (const y of sorted) {
    if (compareYearLabels(y, year) < 0) pred = y;
  }
  return pred;
}

/**
 * Read a numeric map (rev/cogs/BS row.values) when meta keys differ slightly from driver keys
 * (e.g. "2026" vs "2026E"). Tries exact key, then stripped suffix, then common alternates.
 */
export function pickNumericByYearKey(map: Record<string, number>, year: string): number {
  const read = (k: string | undefined): number | undefined => {
    if (k == null || k === "") return undefined;
    const v = map[k];
    if (v != null && Number.isFinite(v)) return v;
    return undefined;
  };
  let v = read(year);
  if (v !== undefined) return v;
  const base = year.replace(/[AaEe]+$/u, "");
  if (base !== year) {
    v = read(base);
    if (v !== undefined) return v;
  }
  v = read(`${base}E`);
  if (v !== undefined) return v;
  v = read(`${base}A`);
  if (v !== undefined) return v;
  v = read(`${year}E`);
  if (v !== undefined) return v;
  v = read(`${year}A`);
  if (v !== undefined) return v;
  return 0;
}

export function pickRowValueByYear(values: Record<string, number> | undefined, year: string): number {
  return pickNumericByYearKey(values ?? {}, year);
}

/** Avoid "2025AA" when meta key is already "2025A". */
export function formatStatementYearHeader(yearLabel: string, isProjection: boolean): string {
  if (/[AaEe]$/u.test(yearLabel.trim())) return yearLabel;
  return `${yearLabel}${isProjection ? "E" : "A"}`;
}

/**
 * Read `map[year]` when bridge/store keys may differ only by A/E suffix from column `year`
 * (e.g. map has "2026" but UI column is "2026E").
 */
export function pickNumericRecordForYear(map: Record<string, number>, year: string): number | undefined {
  const v0 = map[year];
  if (v0 != null && Number.isFinite(v0)) return v0;
  const yBase = year.replace(/[AaEe]+$/u, "");
  for (const [k, v] of Object.entries(map)) {
    if (v == null || !Number.isFinite(v)) continue;
    const kBase = k.replace(/[AaEe]+$/u, "");
    if (k === year || kBase === yBase) return v;
  }
  return undefined;
}

/** Map a meta/projection label to the matching element on `timeline` (exact or same calendar year + band). */
export function resolveTimelineYearKey(year: string, timeline: string[]): string | null {
  if (timeline.includes(year)) return year;
  const yBase = year.replace(/[AaEe]+$/u, "");
  for (const t of timeline) {
    const tBase = t.replace(/[AaEe]+$/u, "");
    if (tBase === yBase) return t;
  }
  return null;
}

/**
 * Whether timeline year `y` should use BS actuals (not WC driver forecast) in WC preview bridges.
 */
export function yearIsHistoricalForWc(y: string, historicalYears: string[], projectionYears: string[]): boolean {
  if (historicalYears.length === 0) return false;
  if (historicalYears.includes(y)) return true;
  if (resolveTimelineYearKey(y, historicalYears) != null) return true;
  if (projectionYears.length > 0) {
    const firstProj = sortYearsChronologically(projectionYears)[0]!;
    if (compareYearLabels(y, firstProj) < 0) return true;
  }
  return false;
}
