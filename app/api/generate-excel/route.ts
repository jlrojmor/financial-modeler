import { NextResponse } from "next/server";
import type { ModelState } from "@/store/useModelStore";
import { exportStatementToExcel } from "@/lib/excel-export";

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
    
    // Income Statement
    const isWs = wb.addWorksheet("Income Statement");
    exportStatementToExcel(isWs, modelState.incomeStatement, years, 1, modelState.meta.currencyUnit);
    
    // Balance Sheet
    if (modelState.balanceSheet && modelState.balanceSheet.length > 0) {
      const bsWs = wb.addWorksheet("Balance Sheet");
      exportStatementToExcel(bsWs, modelState.balanceSheet, years, 1, modelState.meta.currencyUnit);
    }
    
    // Cash Flow Statement
    if (modelState.cashFlow && modelState.cashFlow.length > 0) {
      const cfsWs = wb.addWorksheet("Cash Flow");
      exportStatementToExcel(cfsWs, modelState.cashFlow, years, 1, modelState.meta.currencyUnit);
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
    return NextResponse.json(
      { error: "Failed to generate Excel file" },
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