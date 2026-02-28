/**
 * IS Build Excel export: one tab with Revenue output on top and Assumptions (blue) below.
 * Option A: assumptions below the preview table. User can edit blue cells and see projections update.
 */

import type { Row } from "@/types/finance";
import type { CurrencyUnit } from "@/lib/currency-utils";
import { getColumnLetter, getCellName, sanitizeIdForExcel } from "./excel-formulas";
import { storedToDisplay } from "./currency-utils";
import { computeRowValue } from "@/lib/calculations";
import { computeRevenueProjections } from "@/lib/revenue-projection-engine";
import type {
  RevenueProjectionConfig,
  RevenueProjectionItemConfig,
  GrowthRateInputs,
  PriceVolumeInputs,
  CustomersArpuInputs,
  PctOfTotalInputs,
  ProductLineInputs,
} from "@/types/revenue-projection";

const IB_DARK_BLUE = "FF1E3A5F";
const IB_INPUT_BLUE = "FFD6E4F0";
const IB_HISTORIC_GRAY = "FFE7E6E6";
const IB_BORDER_GRAY = "FFADADAD";
const ASSUM_LABEL_COL = 1;
const ASSUM_VALUE_COL = 2;

/** Effective base for Excel (display units): last historic year or user baseAmount, so formulas match the web preview. */
function getEffectiveBaseDisplay(
  baseAmount: number | undefined | null,
  historicStored: number,
  currencyUnit: CurrencyUnit
): number {
  if (baseAmount != null && baseAmount !== 0) return baseAmount;
  return storedToDisplay(historicStored, currencyUnit);
}

type RevenueRow = { id: string; label: string; depth: number; parentId?: string };

function buildRevenueRows(
  incomeStatement: Row[],
  config: RevenueProjectionConfig
): RevenueRow[] {
  const rev = incomeStatement?.find((r) => r.id === "rev");
  if (!rev) return [];
  const items = config?.items ?? {};
  const list: RevenueRow[] = [];
  const streams = rev.children ?? [];
  for (let s = 0; s < streams.length; s++) {
    const stream = streams[s];
    list.push({ id: stream.id, label: stream.label, depth: 1, parentId: "rev" });
    const breakdowns = config?.breakdowns?.[stream.id] ?? [];
    for (let bi = 0; bi < breakdowns.length; bi++) {
      const b = breakdowns[bi];
      list.push({ id: b.id, label: b.label, depth: 2, parentId: stream.id });
      const cfg = items[b.id];
      const pl = cfg?.inputs as { items?: Array<{ id?: string; label?: string }> } | undefined;
      if ((cfg?.method === "product_line" || cfg?.method === "channel") && pl?.items?.length) {
        const lineItems = pl.items;
        for (let lineIdx = 0; lineIdx < lineItems.length; lineIdx++) {
          const line = lineItems[lineIdx];
          const raw = line.id ?? line.label;
          const lineKey = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${lineIdx}`;
          list.push({ id: `${b.id}::${lineKey}`, label: line.label, depth: 3, parentId: b.id });
        }
      }
    }
    if (breakdowns.length === 0) {
      const cfg = items[stream.id];
      const pl = cfg?.inputs as { items?: Array<{ id?: string; label?: string }> } | undefined;
      if ((cfg?.method === "product_line" || cfg?.method === "channel") && pl?.items?.length) {
        const lineItems = pl.items;
        for (let lineIdx = 0; lineIdx < lineItems.length; lineIdx++) {
          const line = lineItems[lineIdx];
          const raw = line.id ?? line.label;
          const lineKey = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${lineIdx}`;
          list.push({ id: `${stream.id}::${lineKey}`, label: line.label, depth: 3, parentId: stream.id });
        }
      }
    }
  }
  return list;
}

function mapRowIdsToExcelRows(rows: RevenueRow[], headerRow: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    map.set(rows[i].id, headerRow + 1 + i);
  }
  return map;
}

function assumRef(row: number): string {
  return `$B$${row}`;
}

/** Escape sheet name for Excel formula (single quotes) */
function escapeSheetName(name: string): string {
  return `'${String(name).replace(/'/g, "''")}'`;
}

export type ISBuildExportOptions = {
  historicalSheetName: string;
  historicalRowMap: Record<string, number>;
  years: string[];
};

/** Map of IS Build sheet cells so the Financial Model can reference Revenue/COGS by name */
export type ISBuildRefMap = {
  sheetName: string;
  revenueRowByRowId: Record<string, number>;
  cogsSection: {
    revenueTotalRow: number;
    totalCogsRow: number;
    grossProfitRow: number;
    grossMarginRow: number;
  };
  /** For each stream id, the IS Build row numbers of "X — COGS" lines that belong to that stream */
  streamIdToCogsRows: Record<string, number[]>;
  /** For each stream id, the line ids for COGS (for building name-based SUM formulas) */
  streamIdToCogsLineIds: Record<string, string[]>;
};

const ISBUILD_PREFIX = "ISBuild";

function defineISBuildCellName(
  wb: any,
  sheetName: string,
  rowId: string,
  col: number,
  excelRow: number
): void {
  if (!wb?.definedNames?.add) return;
  const colLetter = getColumnLetter(col);
  const name = getCellName(ISBUILD_PREFIX, rowId, colLetter);
  const ref = `'${String(sheetName).replace(/'/g, "''")}'!$${colLetter}$${excelRow}`;
  try {
    wb.definedNames.add(ref, name);
  } catch {
    // ignore duplicate
  }
}

export function exportISBuildToExcel(
  ws: any,
  modelState: {
    incomeStatement: Row[] | null;
    revenueProjectionConfig: RevenueProjectionConfig | null;
    meta: { years?: { historical?: string[]; projection?: string[] }; currencyUnit?: string; companyName?: string };
    balanceSheet?: Row[] | null;
    cashFlow?: Row[] | null;
    sbcBreakdowns?: Record<string, Record<string, number>> | null;
    danaBreakdowns?: Record<string, number> | null;
    cogsPctByRevenueLine?: Record<string, number>;
    cogsPctModeByRevenueLine?: Record<string, "constant" | "custom">;
    cogsPctByRevenueLineByYear?: Record<string, Record<string, number>>;
  },
  options?: ISBuildExportOptions,
  wb?: any
): { lastRow: number; refMap: ISBuildRefMap } {
  const sheetName = "IS Build";
  const incomeStatement = modelState.incomeStatement ?? [];
  const config = modelState.revenueProjectionConfig ?? { items: {}, breakdowns: {}, projectionAllocations: {} };
  const historicalYears = modelState.meta?.years?.historical ?? [];
  const projectionYears = modelState.meta?.years?.projection ?? [];
  const years = [...historicalYears, ...projectionYears];
  const lastHistoricYear = historicalYears[historicalYears.length - 1] ?? "";
  const currencyUnit = (modelState.meta?.currencyUnit ?? "millions") as CurrencyUnit;
  const allStatements = {
    incomeStatement: modelState.incomeStatement ?? [],
    balanceSheet: modelState.balanceSheet ?? [],
    cashFlow: modelState.cashFlow ?? [],
  };
  const sbcBreakdowns = modelState.sbcBreakdowns ?? {};
  const danaBreakdowns = modelState.danaBreakdowns ?? {};
  const cogsPctByRevenueLine = modelState.cogsPctByRevenueLine ?? {};
  const cogsPctModeByRevenueLine = modelState.cogsPctModeByRevenueLine ?? {};
  const cogsPctByRevenueLineByYear = modelState.cogsPctByRevenueLineByYear ?? {};

  if (years.length === 0 || projectionYears.length === 0) {
    ws.getCell(1, 1).value = "IS Build (no years configured)";
    const emptyRefMap: ISBuildRefMap = {
      sheetName: "IS Build",
      revenueRowByRowId: {},
      cogsSection: { revenueTotalRow: 0, totalCogsRow: 0, grossProfitRow: 0, grossMarginRow: 0 },
      streamIdToCogsRows: {},
      streamIdToCogsLineIds: {},
    };
    return { lastRow: 2, refMap: emptyRefMap };
  }

  const rev = incomeStatement?.find((r) => r.id === "rev");
  const revenueRows: RevenueRow[] = rev ? [{ id: "rev", label: rev.label, depth: 0 }, ...buildRevenueRows(incomeStatement, config)] : [];
  if (revenueRows.length === 0) {
    ws.getCell(1, 1).value = "IS Build — Revenue";
    ws.getCell(2, 1).value = "No revenue streams. Add Revenue in Historicals and configure in IS Build.";
    const emptyRefMap: ISBuildRefMap = {
      sheetName: "IS Build",
      revenueRowByRowId: {},
      cogsSection: { revenueTotalRow: 0, totalCogsRow: 0, grossProfitRow: 0, grossMarginRow: 0 },
      streamIdToCogsRows: {},
      streamIdToCogsLineIds: {},
    };
    return { lastRow: 3, refMap: emptyRefMap };
  }

  const projectedValues = computeRevenueProjections(
    incomeStatement,
    config,
    projectionYears,
    lastHistoricYear,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
    currencyUnit
  );

  const numHistoric = historicalYears.length;
  const firstProjCol1Based = 2 + numHistoric;

  const thinBorder = { style: "thin" as const, color: { argb: IB_BORDER_GRAY } };
  const borderAll = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };

  let row = 1;
  ws.getCell(row, 1).value = "Income Statement — Revenue";
  ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" }, name: "Calibri" };
  ws.getRow(row).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_DARK_BLUE } };
  ws.getCell(row, 1).border = borderAll;
  for (let idx = 0; idx < years.length; idx++) {
    const c = ws.getCell(row, 2 + idx);
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_DARK_BLUE } };
    c.border = borderAll;
  }
  row += 1;

  ws.getCell(row, 1).value = "Line Item";
  ws.getCell(row, 1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
  ws.getCell(row, 1).border = borderAll;
  for (let idx = 0; idx < years.length; idx++) {
    const c = ws.getCell(row, 2 + idx);
    c.value = years[idx];
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_DARK_BLUE } };
    c.border = borderAll;
  }
  const headerRow = row;
  row += 1;

  const rowIdToExcelRow = mapRowIdsToExcelRows(revenueRows, headerRow);
  const histMap = options?.historicalRowMap;
  const histSheetRef = options?.historicalSheetName ? escapeSheetName(options.historicalSheetName) : null;
  const unitDivisor = currencyUnit === "millions" ? 1_000_000 : currencyUnit === "thousands" ? 1_000 : 1;
  const isFixedRevenueRow = (id: string) =>
    id === "rev" || (!id.includes("::") && rev?.children?.some((s) => s.id === id));
  const histRefFormula = (rowId: string, col: number, isPercent: boolean) => {
    if (!histSheetRef || !histMap || histMap[rowId] == null) return null;
    const base = `${histSheetRef}!${getColumnLetter(col)}$${histMap[rowId]}`;
    return isPercent ? base : unitDivisor === 1 ? base : `${base}/${unitDivisor}`;
  };

  for (let idx = 0; idx < revenueRows.length; idx++) {
    const r = revenueRows[idx];
    const excelRow = headerRow + 1 + idx;
    const indent = "  ".repeat(r.depth);
    const labelCell = ws.getCell(excelRow, 1);
    labelCell.value = indent + r.label;
    labelCell.alignment = { indent: r.depth, vertical: "top" as const };
    labelCell.font = { size: 10, name: "Calibri", color: { argb: "FF000000" } };
    labelCell.border = borderAll;
    if (r.id === "rev") labelCell.font = { size: 10, name: "Calibri", color: { argb: "FF000000" }, bold: true };

    for (let yearIdx = 0; yearIdx < years.length; yearIdx++) {
      const year = years[yearIdx];
      const col = 2 + yearIdx;
      const isHistoric = year.endsWith("A");
      const colLetter = getColumnLetter(col);
      const cell = ws.getCell(excelRow, col);
      cell.font = { size: 10, name: "Calibri", color: { argb: "FF000000" } };
      cell.border = borderAll;
      if (isHistoric) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_HISTORIC_GRAY } };

      if (isHistoric) {
        const refFormula = isFixedRevenueRow(r.id) ? histRefFormula(r.id, col, false) : null;
        if (refFormula) {
          cell.value = { formula: refFormula };
          cell.numFmt = "#,##0";
        } else {
          let val = 0;
          if (r.id === "rev") {
            val = computeRowValue(rev!, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
          } else if (!r.id.includes("::") && rev?.children?.some((s) => s.id === r.id)) {
            const streamRow = rev.children!.find((s) => s.id === r.id)!;
            val = computeRowValue(streamRow, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
          }
          cell.value = storedToDisplay(val, currencyUnit);
          cell.numFmt = "#,##0";
        }
      } else {
        const val = projectedValues[r.id]?.[year];
        if (val != null) {
          cell.value = storedToDisplay(val, currencyUnit);
          cell.numFmt = "#,##0";
        }
      }
      if (wb) defineISBuildCellName(wb, sheetName, r.id, col, excelRow);
    }
  }

  const revExcelRow = rowIdToExcelRow.get("rev") ?? headerRow + 1;
  const cogsRow = incomeStatement?.find((r) => r.id === "cogs");
  const grossProfitRow = incomeStatement?.find((r) => r.id === "gross_profit");
  const grossMarginRow = incomeStatement?.find((r) => r.id === "gross_margin");

  const leafRevenueLinesForCogs = revenueRows.filter((r) => r.id !== "rev");
  const cogsSectionStart = headerRow + revenueRows.length + 1;
  const revenueTotalExcelRow = cogsSectionStart + 1;
  const cogsLineExcelRowByLineId = new Map<string, number>();
  for (let i = 0; i < leafRevenueLinesForCogs.length; i++) {
    cogsLineExcelRowByLineId.set(leafRevenueLinesForCogs[i].id, revenueTotalExcelRow + 1 + i);
  }
  const totalCogsExcelRow = revenueTotalExcelRow + 1 + leafRevenueLinesForCogs.length;
  const grossProfitExcelRow = totalCogsExcelRow + 1;
  const grossMarginExcelRow = grossProfitExcelRow + 1;

  // Build ref map so Financial Model can reference IS Build for projection-year Revenue/COGS
  const revenueRowByRowId: Record<string, number> = {};
  for (const [id, excelRow] of rowIdToExcelRow) {
    if (id === "rev" || (!id.includes("::") && rev?.children?.some((s) => s.id === id))) {
      revenueRowByRowId[id] = excelRow;
    }
  }
  const streamIdToCogsRows: Record<string, number[]> = {};
  const streamIdToCogsLineIds: Record<string, string[]> = {};
  for (const r of leafRevenueLinesForCogs) {
    const streamId = r.parentId === "rev" ? r.id : (r.parentId ?? "");
    if (!streamId) continue;
    const cogsRowNum = cogsLineExcelRowByLineId.get(r.id);
    if (cogsRowNum == null) continue;
    if (!streamIdToCogsRows[streamId]) {
      streamIdToCogsRows[streamId] = [];
      streamIdToCogsLineIds[streamId] = [];
    }
    streamIdToCogsRows[streamId].push(cogsRowNum);
    streamIdToCogsLineIds[streamId].push(r.id);
  }
  const refMap: ISBuildRefMap = {
    sheetName: "IS Build",
    revenueRowByRowId,
    cogsSection: {
      revenueTotalRow: revenueTotalExcelRow,
      totalCogsRow: totalCogsExcelRow,
      grossProfitRow: grossProfitExcelRow,
      grossMarginRow: grossMarginExcelRow,
    },
    streamIdToCogsRows,
    streamIdToCogsLineIds,
  };

  row = cogsSectionStart;
  ws.getCell(row, 1).value = "Revenue & COGS";
  ws.getCell(row, 1).font = { bold: true, size: 11, color: { argb: "FF000000" }, name: "Calibri" };
  ws.getCell(row, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
  ws.getCell(row, 1).border = borderAll;
  for (let idx = 0; idx < years.length; idx++) {
    const c = ws.getCell(row, 2 + idx);
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
    c.border = borderAll;
  }
  row += 1;

  const writeCogsSectionRow = (excelRow: number, label: string, isBold: boolean) => {
    const labelCell = ws.getCell(excelRow, 1);
    labelCell.value = label;
    labelCell.font = { size: 10, name: "Calibri", color: { argb: "FF000000" }, bold: !!isBold };
    labelCell.border = borderAll;
    for (let yearIdx = 0; yearIdx < years.length; yearIdx++) {
      const col = 2 + yearIdx;
      const cell = ws.getCell(excelRow, col);
      cell.font = { size: 10, name: "Calibri", color: { argb: "FF000000" } };
      cell.border = borderAll;
      if (years[yearIdx].endsWith("A")) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_HISTORIC_GRAY } };
      }
    }
  };

  writeCogsSectionRow(revenueTotalExcelRow, "Revenue", true);
  for (let i = 0; i < leafRevenueLinesForCogs.length; i++) {
    const line = leafRevenueLinesForCogs[i];
    writeCogsSectionRow(revenueTotalExcelRow + 1 + i, `${line.label} — COGS`, false);
  }
  writeCogsSectionRow(totalCogsExcelRow, "Cost of Goods Sold (COGS)", true);
  writeCogsSectionRow(grossProfitExcelRow, "Gross Profit", true);
  writeCogsSectionRow(grossMarginExcelRow, "Gross Margin %", true);

  for (let yearIdx = 0; yearIdx < years.length; yearIdx++) {
    const year = years[yearIdx];
    const col = 2 + yearIdx;
    const colLetter = getColumnLetter(col);
    const isHistoric = year.endsWith("A");
    if (isHistoric) {
      if (histSheetRef && histMap) {
        if (histMap.rev != null) {
          const revFormula = unitDivisor === 1 ? `${histSheetRef}!${colLetter}$${histMap.rev}` : `${histSheetRef}!${colLetter}$${histMap.rev}/${unitDivisor}`;
          ws.getCell(revenueTotalExcelRow, col).value = { formula: revFormula };
          ws.getCell(revenueTotalExcelRow, col).numFmt = "#,##0";
        } else {
          const revVal = computeRowValue(rev!, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
          ws.getCell(revenueTotalExcelRow, col).value = storedToDisplay(revVal, currencyUnit);
          ws.getCell(revenueTotalExcelRow, col).numFmt = "#,##0";
        }
      } else {
        const revVal = computeRowValue(rev!, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
        ws.getCell(revenueTotalExcelRow, col).value = storedToDisplay(revVal, currencyUnit);
        ws.getCell(revenueTotalExcelRow, col).numFmt = "#,##0";
      }
      for (let i = 0; i < leafRevenueLinesForCogs.length; i++) {
        ws.getCell(revenueTotalExcelRow + 1 + i, col).value = 0;
        ws.getCell(revenueTotalExcelRow + 1 + i, col).numFmt = "#,##0";
      }
      if (histSheetRef && histMap) {
        if (histMap.cogs != null) {
          const cogsFormula = unitDivisor === 1 ? `${histSheetRef}!${colLetter}$${histMap.cogs}` : `${histSheetRef}!${colLetter}$${histMap.cogs}/${unitDivisor}`;
          ws.getCell(totalCogsExcelRow, col).value = { formula: cogsFormula };
          ws.getCell(totalCogsExcelRow, col).numFmt = "#,##0";
        } else {
          const cogsVal = cogsRow?.values?.[year] ?? 0;
          ws.getCell(totalCogsExcelRow, col).value = storedToDisplay(cogsVal, currencyUnit);
          ws.getCell(totalCogsExcelRow, col).numFmt = "#,##0";
        }
        if (histMap.gross_profit != null) {
          const gpFormula = unitDivisor === 1 ? `${histSheetRef}!${colLetter}$${histMap.gross_profit}` : `${histSheetRef}!${colLetter}$${histMap.gross_profit}/${unitDivisor}`;
          ws.getCell(grossProfitExcelRow, col).value = { formula: gpFormula };
          ws.getCell(grossProfitExcelRow, col).numFmt = "#,##0";
        } else {
          const gpVal = grossProfitRow?.values?.[year] ?? 0;
          ws.getCell(grossProfitExcelRow, col).value = storedToDisplay(gpVal, currencyUnit);
          ws.getCell(grossProfitExcelRow, col).numFmt = "#,##0";
        }
        if (histMap.gross_margin != null) {
          ws.getCell(grossMarginExcelRow, col).value = { formula: `${histSheetRef}!${colLetter}$${histMap.gross_margin}` };
          ws.getCell(grossMarginExcelRow, col).numFmt = "0.00%";
        } else {
          const gmVal = grossMarginRow?.values?.[year] ?? 0;
          ws.getCell(grossMarginExcelRow, col).value = typeof gmVal === "number" ? gmVal / 100 : 0;
          ws.getCell(grossMarginExcelRow, col).numFmt = "0.00%";
        }
      } else {
        const cogsVal = cogsRow?.values?.[year] ?? 0;
        ws.getCell(totalCogsExcelRow, col).value = storedToDisplay(cogsVal, currencyUnit);
        ws.getCell(totalCogsExcelRow, col).numFmt = "#,##0";
        const gpVal = grossProfitRow?.values?.[year] ?? 0;
        ws.getCell(grossProfitExcelRow, col).value = storedToDisplay(gpVal, currencyUnit);
        ws.getCell(grossProfitExcelRow, col).numFmt = "#,##0";
        const gmVal = grossMarginRow?.values?.[year] ?? 0;
        ws.getCell(grossMarginExcelRow, col).value = typeof gmVal === "number" ? gmVal / 100 : 0;
        ws.getCell(grossMarginExcelRow, col).numFmt = "0.00%";
      }
    }
  }
  if (wb) {
    for (let yearIdx = 0; yearIdx < years.length; yearIdx++) {
      const col = 2 + yearIdx;
      defineISBuildCellName(wb, sheetName, "Revenue", col, revenueTotalExcelRow);
      for (let i = 0; i < leafRevenueLinesForCogs.length; i++) {
        defineISBuildCellName(wb, sheetName, "COGS_" + sanitizeIdForExcel(leafRevenueLinesForCogs[i].id), col, revenueTotalExcelRow + 1 + i);
      }
      defineISBuildCellName(wb, sheetName, "TotalCOGS", col, totalCogsExcelRow);
      defineISBuildCellName(wb, sheetName, "GrossProfit", col, grossProfitExcelRow);
      defineISBuildCellName(wb, sheetName, "GrossMargin", col, grossMarginExcelRow);
    }
  }

  const assumStartRow = grossMarginExcelRow + 3;
  let assumRow = assumStartRow;

  ws.getCell(assumRow, 1).value = "Assumptions (edit blue cells to change projections)";
  ws.getCell(assumRow, 1).font = { bold: true, size: 11, name: "Calibri", color: { argb: "FF000000" } };
  assumRow += 2;

  const assumMap = new Map<string, number>();
  const items = config.items ?? {};
  const revChildren = rev?.children ?? [];

  for (let si = 0; si < revChildren.length; si++) {
    const stream = revChildren[si];
    const breakdowns = config.breakdowns?.[stream.id] ?? [];
    if (breakdowns.length === 0) {
      const cfg = items[stream.id];
      const streamHistoric = computeRowValue(stream, lastHistoricYear, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
      if (cfg?.method === "growth_rate") {
        const inp = cfg.inputs as GrowthRateInputs;
        const baseDisplay = getEffectiveBaseDisplay(inp?.baseAmount, streamHistoric, currencyUnit);
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Base (${currencyUnit === "millions" ? "M" : "K"})`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = baseDisplay;
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`growth_base_${stream.id}`, assumRow);
        assumRow += 1;
        const isCustomPerYear = (inp?.growthType ?? "constant") === "custom_per_year";
        const ratesByYear = inp?.ratesByYear ?? {};
        if (isCustomPerYear && projectionYears.length > 0) {
          for (let yi = 0; yi < projectionYears.length; yi++) {
            const y = projectionYears[yi];
            ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${y} Growth %`;
            ws.getCell(assumRow, ASSUM_VALUE_COL).value = (ratesByYear[y] ?? inp?.ratePercent ?? 0) / 100;
            ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
            ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
            ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
            assumMap.set(`growth_pct_${stream.id}_${y}`, assumRow);
            assumRow += 1;
          }
        } else {
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Growth %`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.ratePercent ?? 0) / 100;
          ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`growth_pct_${stream.id}`, assumRow);
          assumRow += 1;
        }
      } else if (cfg?.method === "price_volume") {
        const inp = cfg.inputs as PriceVolumeInputs;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Price`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.price ?? 0;
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`pv_price_${stream.id}`, assumRow);
        assumRow += 1;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Volume`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.volume ?? 0;
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`pv_volume_${stream.id}`, assumRow);
        assumRow += 1;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Price Growth %`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.priceGrowthPercent ?? 0) / 100;
        ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`pv_price_growth_${stream.id}`, assumRow);
        assumRow += 1;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Volume Growth %`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.volumeGrowthPercent ?? 0) / 100;
        ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`pv_volume_growth_${stream.id}`, assumRow);
        assumRow += 1;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Annualize (1 or 12)`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.annualizeFromMonthly ? 12 : 1;
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`pv_mult_${stream.id}`, assumRow);
        assumRow += 1;
      } else if (cfg?.method === "customers_arpu") {
        const inp = cfg.inputs as CustomersArpuInputs;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Customers`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.customers ?? 0;
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`ca_customers_${stream.id}`, assumRow);
        assumRow += 1;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ARPU`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.arpu ?? 0;
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`ca_arpu_${stream.id}`, assumRow);
        assumRow += 1;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Customer Growth %`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.customerGrowthPercent ?? 0) / 100;
        ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`ca_customer_growth_${stream.id}`, assumRow);
        assumRow += 1;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ARPU Growth %`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.arpuGrowthPercent ?? 0) / 100;
        ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`ca_arpu_growth_${stream.id}`, assumRow);
        assumRow += 1;
      } else if (cfg?.method === "pct_of_total") {
        const inp = cfg.inputs as PctOfTotalInputs;
        const refLabel = inp?.referenceId === "rev" ? "Total Revenue" : (revChildren.find((s) => s.id === inp?.referenceId)?.label ?? inp?.referenceId);
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — % of ${refLabel}`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.pctOfTotal ?? 0) / 100;
        ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`pct_${stream.id}`, assumRow);
        assumRow += 1;
      } else if (cfg?.method === "product_line" || cfg?.method === "channel") {
        const inp = cfg.inputs as ProductLineInputs;
        const baseDisplay = getEffectiveBaseDisplay(inp?.baseAmount, streamHistoric, currencyUnit);
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Base (${currencyUnit === "millions" ? "M" : "K"})`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = baseDisplay;
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`channel_base_${stream.id}`, assumRow);
        assumRow += 1;
        const lineItems = inp?.items ?? [];
        for (let lineIdx = 0; lineIdx < lineItems.length; lineIdx++) {
          const line = lineItems[lineIdx];
          const raw = line.id ?? line.label;
          const lineKey = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${lineIdx}`;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${line.label} — Share %`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = (line.sharePercent ?? 0) / 100;
          ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0.00%";
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`channel_share_${stream.id}_${lineKey}`, assumRow);
          assumRow += 1;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${line.label} — Growth %`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = (line.growthPercent ?? 0) / 100;
          ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`channel_growth_${stream.id}_${lineKey}`, assumRow);
          assumRow += 1;
        }
      }
      assumRow += 1;
    } else {
      const streamHistoricForBreakdowns = computeRowValue(stream, lastHistoricYear, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
      const projAlloc = config.projectionAllocations?.[stream.id];
      for (let bi = 0; bi < breakdowns.length; bi++) {
        const b = breakdowns[bi];
        const cfg = items[b.id] as RevenueProjectionItemConfig | undefined;
        if (!cfg) continue;
        const pct = projAlloc?.percentages?.[b.id] ?? 0;
        const breakdownHistoricStored = (streamHistoricForBreakdowns * pct) / 100;
        if (cfg.method === "growth_rate") {
          const inp = cfg.inputs as GrowthRateInputs;
          const baseDisplay = getEffectiveBaseDisplay(inp?.baseAmount, breakdownHistoricStored, currencyUnit);
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Base (${currencyUnit === "millions" ? "M" : "K"})`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = baseDisplay;
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`growth_base_${b.id}`, assumRow);
          assumRow += 1;
          const isCustomPerYear = (inp?.growthType ?? "constant") === "custom_per_year";
          const ratesByYear = inp?.ratesByYear ?? {};
          if (isCustomPerYear && projectionYears.length > 0) {
            for (let yi = 0; yi < projectionYears.length; yi++) {
              const y = projectionYears[yi];
              ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — ${y} Growth %`;
              ws.getCell(assumRow, ASSUM_VALUE_COL).value = (ratesByYear[y] ?? inp?.ratePercent ?? 0) / 100;
              ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
              ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
              ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
              assumMap.set(`growth_pct_${b.id}_${y}`, assumRow);
              assumRow += 1;
            }
          } else {
            ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Growth %`;
            ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.ratePercent ?? 0) / 100;
            ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
            ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
            ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
            assumMap.set(`growth_pct_${b.id}`, assumRow);
            assumRow += 1;
          }
        } else if (cfg.method === "price_volume") {
          const inp = cfg.inputs as PriceVolumeInputs;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Price`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.price ?? 0;
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`pv_price_${b.id}`, assumRow);
          assumRow += 1;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Volume`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.volume ?? 0;
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`pv_volume_${b.id}`, assumRow);
          assumRow += 1;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Price Growth %`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.priceGrowthPercent ?? 0) / 100;
          ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`pv_price_growth_${b.id}`, assumRow);
          assumRow += 1;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Volume Growth %`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.volumeGrowthPercent ?? 0) / 100;
          ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`pv_volume_growth_${b.id}`, assumRow);
          assumRow += 1;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Annualize (1 or 12)`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.annualizeFromMonthly ? 12 : 1;
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`pv_mult_${b.id}`, assumRow);
          assumRow += 1;
        } else if (cfg.method === "customers_arpu") {
          const inp = cfg.inputs as CustomersArpuInputs;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Customers`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.customers ?? 0;
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`ca_customers_${b.id}`, assumRow);
          assumRow += 1;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — ARPU`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.arpu ?? 0;
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`ca_arpu_${b.id}`, assumRow);
          assumRow += 1;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Customer Growth %`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.customerGrowthPercent ?? 0) / 100;
          ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`ca_customer_growth_${b.id}`, assumRow);
          assumRow += 1;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — ARPU Growth %`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.arpuGrowthPercent ?? 0) / 100;
          ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`ca_arpu_growth_${b.id}`, assumRow);
          assumRow += 1;
        } else if (cfg.method === "pct_of_total") {
          const inp = cfg.inputs as PctOfTotalInputs;
          const refLabel = inp?.referenceId === "rev" ? "Total Revenue" : (revChildren.find((s) => s.id === inp?.referenceId)?.label ?? inp?.referenceId);
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — % of ${refLabel}`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.pctOfTotal ?? 0) / 100;
          ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`pct_${b.id}`, assumRow);
          assumRow += 1;
        } else if (cfg.method === "product_line" || cfg.method === "channel") {
          const inp = cfg.inputs as ProductLineInputs;
          const baseDisplay = getEffectiveBaseDisplay(inp?.baseAmount, breakdownHistoricStored, currencyUnit);
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Base (${currencyUnit === "millions" ? "M" : "K"})`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = baseDisplay;
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`channel_base_${b.id}`, assumRow);
          assumRow += 1;
          const lineItems = inp?.items ?? [];
          for (let lineIdx = 0; lineIdx < lineItems.length; lineIdx++) {
            const line = lineItems[lineIdx];
            const raw = line.id ?? line.label;
            const lineKey = (raw != null && String(raw).trim() !== "") ? String(raw) : `line-${lineIdx}`;
            ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — ${line.label} — Share %`;
            ws.getCell(assumRow, ASSUM_VALUE_COL).value = (line.sharePercent ?? 0) / 100;
            ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0.00%";
            ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
            ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
            assumMap.set(`channel_share_${b.id}_${lineKey}`, assumRow);
            assumRow += 1;
            ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — ${line.label} — Growth %`;
            ws.getCell(assumRow, ASSUM_VALUE_COL).value = (line.growthPercent ?? 0) / 100;
            ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0.00%";
            ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
            ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
            assumMap.set(`channel_growth_${b.id}_${lineKey}`, assumRow);
            assumRow += 1;
          }
        }
        assumRow += 1;
      }
    }
  }

  if (leafRevenueLinesForCogs.length > 0) {
    assumRow += 2;
    ws.getCell(assumRow, 1).value = "Assumptions (COGS) — edit blue cells to change COGS % of revenue";
    ws.getCell(assumRow, 1).font = { bold: true, size: 11, name: "Calibri", color: { argb: "FF000000" } };
    assumRow += 2;
    for (let i = 0; i < leafRevenueLinesForCogs.length; i++) {
      const line = leafRevenueLinesForCogs[i];
      const mode = cogsPctModeByRevenueLine[line.id] ?? "constant";
      const constantPct = (cogsPctByRevenueLine[line.id] ?? 0) / 100;
      const byYear = cogsPctByRevenueLineByYear[line.id] ?? {};
      if (mode === "custom") {
        for (let yi = 0; yi < projectionYears.length; yi++) {
          const y = projectionYears[yi];
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${line.label} — ${y} COGS %`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = (byYear[y] ?? 0) / 100;
          ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`cogs_pct_${line.id}_${y}`, assumRow);
          assumRow += 1;
        }
      } else {
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${line.label} — COGS %`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = constantPct;
        ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`cogs_pct_${line.id}`, assumRow);
        assumRow += 1;
      }
    }
  }

  // Match web preview: first projection year = one year of growth from last historic (exponent 1), not base (exponent 0)
  const yearIndexFormulaGrowth = `COLUMN()-${firstProjCol1Based}+1`;
  // Product-line/channel sub-rows: engine uses exponent 0 for first proj year (base*share*(1+g)^0)
  const yearIndexFormulaProductLine = `COLUMN()-${firstProjCol1Based}`;

  for (let idx = 0; idx < revenueRows.length; idx++) {
    const r = revenueRows[idx];
    const excelRow = headerRow + 1 + idx;
    const cfg = items[r.id];
    const isSubRow = r.id.includes("::");
    const parentId = isSubRow ? r.id.split("::")[0] : null;
    const lineKey = isSubRow ? r.id.split("::")[1] : null;
    const method = cfg?.method;

    for (let yearIdx = 0; yearIdx < years.length; yearIdx++) {
      const year = years[yearIdx];
      if (year.endsWith("A")) continue;
      const col = 2 + yearIdx;
      const colLetter = getColumnLetter(col);

      if (r.id === "rev") {
        // Total Revenue = sum of direct children only (streams), not a row range (would double-count breakdowns/sub-rows)
        const streamRows = revenueRows.filter((x) => x.parentId === "rev");
        const childRefs: string[] = [];
        for (let i = 0; i < streamRows.length; i++) {
          const excelR = rowIdToExcelRow.get(streamRows[i].id);
          if (excelR != null) childRefs.push(`${colLetter}${excelR}`);
        }
        if (childRefs.length > 0) {
          ws.getCell(excelRow, col).value = { formula: `SUM(${childRefs.join(",")})` };
          ws.getCell(excelRow, col).numFmt = "#,##0";
        }
      } else {
        const children = revenueRows.filter((x) => x.parentId === r.id);
        if (children.length > 0) {
          // Parent = sum of direct children only (not a range, to avoid double-counting sub-rows)
          const childRefs: string[] = [];
          for (let i = 0; i < children.length; i++) {
            const excelR = rowIdToExcelRow.get(children[i].id);
            if (excelR != null) childRefs.push(`${colLetter}${excelR}`);
          }
          if (childRefs.length > 0) {
            ws.getCell(excelRow, col).value = { formula: `SUM(${childRefs.join(",")})` };
            ws.getCell(excelRow, col).numFmt = "#,##0";
          }
        } else if (method === "growth_rate" && !isSubRow) {
          const baseRow = assumMap.get(`growth_base_${r.id}`);
          const pctRowConstant = assumMap.get(`growth_pct_${r.id}`);
          const pctRowForYear = assumMap.get(`growth_pct_${r.id}_${year}`);
          if (baseRow != null) {
            if (pctRowForYear != null) {
              // Custom % per year: chain from prior year (or base for first proj year)
              const isFirstProjYear = yearIdx === numHistoric;
              if (isFirstProjYear) {
                ws.getCell(excelRow, col).value = { formula: `=${assumRef(baseRow)}*(1+${assumRef(pctRowForYear)})` };
              } else {
                const prevColLetter = getColumnLetter(col - 1);
                ws.getCell(excelRow, col).value = { formula: `=${prevColLetter}${excelRow}*(1+${assumRef(pctRowForYear)})` };
              }
              ws.getCell(excelRow, col).numFmt = "#,##0";
            } else if (pctRowConstant != null) {
              ws.getCell(excelRow, col).value = { formula: `=${assumRef(baseRow)}*(1+${assumRef(pctRowConstant)})^(${yearIndexFormulaGrowth})` };
              ws.getCell(excelRow, col).numFmt = "#,##0";
            }
          }
        } else if (method === "price_volume" && !isSubRow) {
          const priceR = assumMap.get(`pv_price_${r.id}`);
          const volR = assumMap.get(`pv_volume_${r.id}`);
          const priceGrR = assumMap.get(`pv_price_growth_${r.id}`);
          const volGrR = assumMap.get(`pv_volume_growth_${r.id}`);
          const multR = assumMap.get(`pv_mult_${r.id}`);
          if (priceR != null && volR != null && priceGrR != null && volGrR != null && multR != null) {
            const yIdx = yearIndexFormulaGrowth;
            ws.getCell(excelRow, col).value = {
              formula: `=${assumRef(priceR)}*(1+${assumRef(priceGrR)})^(${yIdx})*${assumRef(volR)}*(1+${assumRef(volGrR)})^(${yIdx})*${assumRef(multR)}`,
            };
            ws.getCell(excelRow, col).numFmt = "#,##0";
          }
        } else if (method === "customers_arpu" && !isSubRow) {
          const custR = assumMap.get(`ca_customers_${r.id}`);
          const arpuR = assumMap.get(`ca_arpu_${r.id}`);
          const custGrR = assumMap.get(`ca_customer_growth_${r.id}`);
          const arpuGrR = assumMap.get(`ca_arpu_growth_${r.id}`);
          if (custR != null && arpuR != null && custGrR != null && arpuGrR != null) {
            const yIdx = yearIndexFormulaGrowth;
            ws.getCell(excelRow, col).value = {
              formula: `=${assumRef(custR)}*(1+${assumRef(custGrR)})^(${yIdx})*${assumRef(arpuR)}*(1+${assumRef(arpuGrR)})^(${yIdx})`,
            };
            ws.getCell(excelRow, col).numFmt = "#,##0";
          }
        } else if (method === "pct_of_total" && !isSubRow) {
          const pctR = assumMap.get(`pct_${r.id}`);
          const refId = (cfg?.inputs as PctOfTotalInputs)?.referenceId ?? "rev";
          const refExcelRow = rowIdToExcelRow.get(refId);
          if (pctR != null && refExcelRow != null) {
            ws.getCell(excelRow, col).value = { formula: `=${colLetter}${refExcelRow}*${assumRef(pctR)}` };
            ws.getCell(excelRow, col).numFmt = "#,##0";
          }
        } else if ((method === "product_line" || method === "channel") && isSubRow && parentId && lineKey != null) {
          const baseRow = assumMap.get(`channel_base_${parentId}`);
          const shareRow = assumMap.get(`channel_share_${parentId}_${lineKey}`);
          const growthRow = assumMap.get(`channel_growth_${parentId}_${lineKey}`);
          if (baseRow != null && shareRow != null && growthRow != null) {
            ws.getCell(excelRow, col).value = { formula: `=${assumRef(baseRow)}*${assumRef(shareRow)}*(1+${assumRef(growthRow)})^(${yearIndexFormulaProductLine})` };
            ws.getCell(excelRow, col).numFmt = "#,##0";
          }
        }
      }
    }
  }

  for (let yearIdx = 0; yearIdx < years.length; yearIdx++) {
    const year = years[yearIdx];
    if (year.endsWith("A")) continue;
    const col = 2 + yearIdx;
    const colLetter = getColumnLetter(col);

    ws.getCell(revenueTotalExcelRow, col).value = { formula: `=${colLetter}$${revExcelRow}` };
    ws.getCell(revenueTotalExcelRow, col).numFmt = "#,##0";

    const cogsLineRefs: string[] = [];
    for (let i = 0; i < leafRevenueLinesForCogs.length; i++) {
      const line = leafRevenueLinesForCogs[i];
      const lineExcelRow = cogsLineExcelRowByLineId.get(line.id)!;
      const revRowForLine = rowIdToExcelRow.get(line.id);
      const pctRowConstant = assumMap.get(`cogs_pct_${line.id}`);
      const pctRowForYear = assumMap.get(`cogs_pct_${line.id}_${year}`);
      const pctRef = pctRowForYear != null ? assumRef(pctRowForYear) : pctRowConstant != null ? assumRef(pctRowConstant) : null;
      if (revRowForLine != null && pctRef != null) {
        ws.getCell(lineExcelRow, col).value = { formula: `=${colLetter}$${revRowForLine}*${pctRef}` };
        ws.getCell(lineExcelRow, col).numFmt = "#,##0";
        cogsLineRefs.push(`${colLetter}$${lineExcelRow}`);
      }
    }

    if (cogsLineRefs.length > 0) {
      ws.getCell(totalCogsExcelRow, col).value = { formula: `SUM(${cogsLineRefs.join(",")})` };
    } else {
      ws.getCell(totalCogsExcelRow, col).value = 0;
    }
    ws.getCell(totalCogsExcelRow, col).numFmt = "#,##0";
    ws.getCell(grossProfitExcelRow, col).value = {
      formula: `=${colLetter}$${revenueTotalExcelRow}-${colLetter}$${totalCogsExcelRow}`,
    };
    ws.getCell(grossProfitExcelRow, col).numFmt = "#,##0";
    ws.getCell(grossMarginExcelRow, col).value = {
      formula: `=IF(${colLetter}$${revenueTotalExcelRow}=0,0,(${colLetter}$${revenueTotalExcelRow}-${colLetter}$${totalCogsExcelRow})/${colLetter}$${revenueTotalExcelRow})`,
    };
    ws.getCell(grossMarginExcelRow, col).numFmt = "0.00%";
  }

  return { lastRow: assumRow + 2, refMap };
}
