/**
 * IS Build Excel export: one tab with Revenue output on top and Assumptions (blue) below.
 * Option A: assumptions below the preview table. User can edit blue cells and see projections update.
 */

import type { Row } from "@/types/finance";
import type { CurrencyUnit } from "@/lib/currency-utils";
import { getColumnLetter } from "./excel-formulas";
import { storedToDisplay } from "./currency-utils";
import { computeRowValue } from "@/lib/calculations";
import { computeRevenueProjections } from "@/lib/revenue-projection-engine";
import type {
  RevenueProjectionConfig,
  RevenueProjectionItemConfig,
  GrowthRateInputs,
  ProductLineInputs,
} from "@/types/revenue-projection";

const IB_DARK_BLUE = "FF1E3A5F";
const IB_INPUT_BLUE = "FFD6E4F0";
const ASSUM_LABEL_COL = 1;
const ASSUM_VALUE_COL = 2;

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
  }
): number {
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

  if (years.length === 0 || projectionYears.length === 0) {
    ws.getCell(1, 1).value = "IS Build (no years configured)";
    return 2;
  }

  const rev = incomeStatement?.find((r) => r.id === "rev");
  const revenueRows: RevenueRow[] = rev ? [{ id: "rev", label: rev.label, depth: 0 }, ...buildRevenueRows(incomeStatement, config)] : [];
  if (revenueRows.length === 0) {
    ws.getCell(1, 1).value = "IS Build — Revenue";
    ws.getCell(2, 1).value = "No revenue streams. Add Revenue in Historicals and configure in IS Build.";
    return 3;
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

  let row = 1;
  ws.getCell(row, 1).value = "Income Statement — Revenue";
  ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  ws.getRow(row).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_DARK_BLUE } };
  for (let idx = 0; idx < years.length; idx++) {
    ws.getCell(row, 2 + idx).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_DARK_BLUE } };
  }
  row += 1;

  ws.getCell(row, 1).value = "Line Item";
  for (let idx = 0; idx < years.length; idx++) {
    ws.getCell(row, 2 + idx).value = years[idx];
  }
  ws.getRow(row).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(row).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_DARK_BLUE } };
  const headerRow = row;
  row += 1;

  const rowIdToExcelRow = mapRowIdsToExcelRows(revenueRows, headerRow);

  for (let idx = 0; idx < revenueRows.length; idx++) {
    const r = revenueRows[idx];
    const excelRow = headerRow + 1 + idx;
    const indent = "  ".repeat(r.depth);
    ws.getCell(excelRow, 1).value = indent + r.label;
    ws.getCell(excelRow, 1).alignment = { indent: r.depth };
    if (r.id === "rev") ws.getCell(excelRow, 1).font = { bold: true };

    for (let yearIdx = 0; yearIdx < years.length; yearIdx++) {
      const year = years[yearIdx];
      const col = 2 + yearIdx;
      const isHistoric = year.endsWith("A");
      const colLetter = getColumnLetter(col);

      if (isHistoric) {
        let val = 0;
        if (r.id === "rev") {
          val = computeRowValue(rev!, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
        } else if (!r.id.includes("::") && rev?.children?.some((s) => s.id === r.id)) {
          const streamRow = rev.children!.find((s) => s.id === r.id)!;
          val = computeRowValue(streamRow, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns) ?? 0;
        }
        ws.getCell(excelRow, col).value = storedToDisplay(val, currencyUnit);
        ws.getCell(excelRow, col).numFmt = "#,##0";
      } else {
        const val = projectedValues[r.id]?.[year];
        if (val != null) {
          ws.getCell(excelRow, col).value = storedToDisplay(val, currencyUnit);
          ws.getCell(excelRow, col).numFmt = "#,##0";
        }
      }
    }
  }

  const assumStartRow = headerRow + revenueRows.length + 3;
  let assumRow = assumStartRow;

  ws.getCell(assumRow, 1).value = "Assumptions (edit blue cells to change projections)";
  ws.getCell(assumRow, 1).font = { bold: true, size: 11 };
  assumRow += 2;

  const assumMap = new Map<string, number>();
  const items = config.items ?? {};
  const revChildren = rev?.children ?? [];

  for (let si = 0; si < revChildren.length; si++) {
    const stream = revChildren[si];
    const breakdowns = config.breakdowns?.[stream.id] ?? [];
    if (breakdowns.length === 0) {
      const cfg = items[stream.id];
      if (cfg?.method === "growth_rate") {
        const inp = cfg.inputs as GrowthRateInputs;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Base (${currencyUnit === "millions" ? "M" : "K"})`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.baseAmount ?? 0;
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`growth_base_${stream.id}`, assumRow);
        assumRow += 1;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Growth %`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.ratePercent ?? 0) / 100;
        ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
        ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
        ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
        assumMap.set(`growth_pct_${stream.id}`, assumRow);
        assumRow += 1;
      } else if (cfg?.method === "product_line" || cfg?.method === "channel") {
        const inp = cfg.inputs as ProductLineInputs;
        ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — Base (${currencyUnit === "millions" ? "M" : "K"})`;
        ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.baseAmount ?? 0;
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
      for (let bi = 0; bi < breakdowns.length; bi++) {
        const b = breakdowns[bi];
        const cfg = items[b.id] as RevenueProjectionItemConfig | undefined;
        if (!cfg) continue;
        if (cfg.method === "growth_rate") {
          const inp = cfg.inputs as GrowthRateInputs;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Base (${currencyUnit === "millions" ? "M" : "K"})`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.baseAmount ?? 0;
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`growth_base_${b.id}`, assumRow);
          assumRow += 1;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Growth %`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = (inp?.ratePercent ?? 0) / 100;
          ws.getCell(assumRow, ASSUM_VALUE_COL).numFmt = "0%";
          ws.getCell(assumRow, ASSUM_VALUE_COL).fill = { type: "pattern", pattern: "solid", fgColor: { argb: IB_INPUT_BLUE } };
          ws.getCell(assumRow, ASSUM_VALUE_COL).font = { color: { argb: "FF1E3A5F" } };
          assumMap.set(`growth_pct_${b.id}`, assumRow);
          assumRow += 1;
        } else if (cfg.method === "product_line" || cfg.method === "channel") {
          const inp = cfg.inputs as ProductLineInputs;
          ws.getCell(assumRow, ASSUM_LABEL_COL).value = `${stream.label} — ${b.label} — Base (${currencyUnit === "millions" ? "M" : "K"})`;
          ws.getCell(assumRow, ASSUM_VALUE_COL).value = inp?.baseAmount ?? 0;
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

  const yearIndexFormula = `COLUMN()-${firstProjCol1Based}`;
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
          const pctRow = assumMap.get(`growth_pct_${r.id}`);
          if (baseRow != null && pctRow != null) {
            ws.getCell(excelRow, col).value = { formula: `=${assumRef(baseRow)}*(1+${assumRef(pctRow)})^(${yearIndexFormula})` };
            ws.getCell(excelRow, col).numFmt = "#,##0";
          }
        } else if ((method === "product_line" || method === "channel") && isSubRow && parentId && lineKey != null) {
          const baseRow = assumMap.get(`channel_base_${parentId}`);
          const shareRow = assumMap.get(`channel_share_${parentId}_${lineKey}`);
          const growthRow = assumMap.get(`channel_growth_${parentId}_${lineKey}`);
          if (baseRow != null && shareRow != null && growthRow != null) {
            ws.getCell(excelRow, col).value = { formula: `=${assumRef(baseRow)}*${assumRef(shareRow)}*(1+${assumRef(growthRow)})^(${yearIndexFormula})` };
            ws.getCell(excelRow, col).numFmt = "#,##0";
          }
        }
      }
    }
  }

  return assumRow + 2;
}
