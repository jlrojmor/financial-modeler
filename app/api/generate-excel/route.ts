import { NextResponse } from "next/server";
import type { ModelState } from "@/store/useModelStore";
import { exportStatementToExcel, exportSbcDisclosureToExcel, exportBalanceCheckToExcel, type ExportStatementContext } from "@/lib/excel-export";

// Force Node runtime (ExcelJS needs Node APIs)
export const runtime = "nodejs";

// Use require to avoid TS/ESM import weirdness
const ExcelJS = require("exceljs");

export async function POST(request: Request) {
  try {
    const modelState: ModelState = await request.json();
    
    const wb = new ExcelJS.Workbook();
    
    // Get all years
    const years = [
      ...(modelState.meta.years.historical || []),
      ...(modelState.meta.years.projection || []),
    ];

    // IS Build sheet first so Financial Model can reference it for projection-year Revenue/COGS
    const { exportISBuildToExcel } = await import("@/lib/excel-export-is-build");
    const wsISBuild = wb.addWorksheet("IS Build", { properties: { tabColor: { argb: "FF1E3A5F" } } });
    const isBuildResult = exportISBuildToExcel(wsISBuild, modelState, undefined, wb);

    const allStatements = {
      incomeStatement: modelState.incomeStatement ?? [],
      balanceSheet: modelState.balanceSheet ?? [],
      cashFlow: modelState.cashFlow ?? [],
    };
    const sbcBreakdowns = modelState.sbcBreakdowns ?? {};
    const danaBreakdowns = modelState.danaBreakdowns ?? {};
    const exportContext: ExportStatementContext = {
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
      isBuildRefs: isBuildResult.refMap,
    };

    // Financial Model sheet: Income Statement references IS Build for projection-year Revenue/COGS
    const ws = wb.addWorksheet("Financial Model");
    let currentRow = 1;

    // Income Statement (first statement - includes currency note and headers)
    const isResult = exportStatementToExcel(
      ws,
      modelState.incomeStatement,
      years,
      currentRow,
      modelState.meta.currencyUnit,
      undefined,
      true,
      wb,
      "IS",
      exportContext
    );
    currentRow = isResult.nextRow;

    // Re-export IS Build so historic cells can reference Financial Model (now that FM exists)
    const isRowMap = isResult.rowIdToExcelRow ?? null;
    exportISBuildToExcel(
      wsISBuild,
      modelState,
      isRowMap
        ? { historicalSheetName: "Financial Model", historicalRowMap: isRowMap, years }
        : undefined,
      wb
    );
    
    // Add SBC Disclosure section below Income Statement (still on Financial Model sheet)
    if (modelState.sbcBreakdowns) {
      currentRow = exportSbcDisclosureToExcel(
        ws,
        modelState.incomeStatement,
        modelState.sbcBreakdowns,
        years,
        currentRow,
        modelState.meta.currencyUnit
      );
    }

    // Balance Sheet (below SBC - add statement header)
    if (modelState.balanceSheet && modelState.balanceSheet.length > 0) {
      const bsResult = exportStatementToExcel(
        ws,
        modelState.balanceSheet,
        years,
        currentRow,
        modelState.meta.currencyUnit,
        "Balance Sheet",
        false,
        wb,
        "BS",
        exportContext
      );
      currentRow = bsResult.nextRow;
      currentRow = exportBalanceCheckToExcel(
        ws,
        modelState.balanceSheet,
        years,
        currentRow,
        0,
        modelState.meta.currencyUnit,
        "BS"
      );
    }
    
    // Cash Flow Statement (below Balance Sheet - add statement header)
    if (modelState.cashFlow && modelState.cashFlow.length > 0) {
      const cfsResult = exportStatementToExcel(
        ws,
        modelState.cashFlow,
        years,
        currentRow,
        modelState.meta.currencyUnit,
        "Cash Flow Statement",
        false,
        wb,
        "CFS",
        exportContext
      );
      currentRow = cfsResult.nextRow;
    }
    
    const buffer = await wb.xlsx.writeBuffer();
    const fileName = `${modelState.meta.companyName || "model"}_${new Date().toISOString().split("T")[0]}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("Excel export error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("Error details:", { errorMessage, errorStack });
    return NextResponse.json(
      { error: "Failed to generate Excel file", details: errorMessage },
      { status: 500 }
    );
  }
}

// Keep GET for backward compatibility (returns sample)
export async function GET() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Model");

  ws.getCell("A1").value = "Line Item";
  ws.getCell("B1").value = "2024A";
  ws.getCell("C1").value = "2025E";

  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };

  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="sample.xlsx"',
    },
  });
}