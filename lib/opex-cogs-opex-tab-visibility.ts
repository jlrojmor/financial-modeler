/**
 * UI-only: lines hidden on the COGS & Operating Expenses drivers tab (financing handled later).
 * Does not change ingest, merge, or store — filter at render / preview lists only.
 */
export function isOpexLineLabelHiddenOnCogsOpexTab(label: string): boolean {
  const n = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (n === "interest expense" || n === "interest income" || n === "interest") return true;
  if (/\binterest expense\b/.test(n)) return true;
  if (/\binterest income\b/.test(n)) return true;
  return false;
}
