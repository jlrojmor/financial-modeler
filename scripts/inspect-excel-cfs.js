/**
 * Reads an Excel file and prints the Cash Flow Statement section (labels, formulas, values).
 * Run from project root: node scripts/inspect-excel-cfs.js [path-to-file.xlsx]
 * Default path: uploads/exported-model.xlsx
 */

const path = require("path");
const fs = require("fs");

const ExcelJS = require("exceljs");

const defaultPath = path.join(__dirname, "..", "uploads", "exported-model.xlsx");
const filePath = process.argv[2] || defaultPath;

if (!fs.existsSync(filePath)) {
  console.error("File not found:", filePath);
  console.error("\nUsage: node scripts/inspect-excel-cfs.js [path-to-file.xlsx]");
  console.error("Example: node scripts/inspect-excel-cfs.js uploads/exported-model.xlsx");
  process.exit(1);
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheetName = workbook.worksheets.find((ws) => ws.name === "Financial Model")
    ? "Financial Model"
    : workbook.worksheets[0]?.name;
  if (!sheetName) {
    console.error("No worksheet found.");
    process.exit(1);
  }

  const sheet = workbook.getWorksheet(sheetName);
  console.log("Sheet:", sheetName, "\n");

  // Find "Cash Flow Statement" row
  let cfsStartRow = null;
  for (let r = 1; r <= Math.min(sheet.rowCount, 200); r++) {
    const cellA = sheet.getCell(r, 1);
    const val = cellA.value;
    const text = typeof val === "string" ? val : (val && typeof val === "object" && "text" in val ? val.text : String(val ?? ""));
    if (text && String(text).toLowerCase().includes("cash flow statement")) {
      cfsStartRow = r;
      break;
    }
  }

  if (!cfsStartRow) {
    console.error('Row with "Cash Flow Statement" not found in column A.');
    process.exit(1);
  }

  console.log("--- Cash Flow Statement (from row", cfsStartRow, ") ---\n");

  // How many columns (years)?
  const maxCol = Math.min((sheet.columnCount || 10) + 2, 15);
  const yearHeaders = [];
  for (let c = 2; c <= maxCol; c++) {
    const cell = sheet.getCell(cfsStartRow, c);
    const v = cell.value;
    yearHeaders.push(v != null ? String(v) : `Col${c}`);
  }

  // Print from CFS header down for a reasonable number of rows
  const maxRows = 80;
  for (let r = cfsStartRow; r < cfsStartRow + maxRows; r++) {
    const labelCell = sheet.getCell(r, 1);
    const labelVal = labelCell.value;
    let label = "";
    if (labelVal != null) {
      if (typeof labelVal === "string") label = labelVal;
      else if (typeof labelVal === "object" && labelVal.formula) label = "=" + labelVal.formula;
      else if (typeof labelVal === "object" && "result" in labelVal) label = String(labelVal.result ?? "");
      else label = String(labelVal);
    }

    const parts = [`Row ${r}:`, label.trim() || "(empty)"];
    for (let c = 2; c <= maxCol; c++) {
      const cell = sheet.getCell(r, c);
      const v = cell.value;
      let cellStr = "";
      if (v == null) cellStr = "-";
      else if (typeof v === "object" && v.formula) cellStr = "=" + v.formula;
      else if (typeof v === "number") cellStr = String(v);
      else cellStr = String(v);
      parts.push(`  [${c}] ${cellStr}`);
    }
    console.log(parts.join(" "));

    // Stop after we've passed CFS (e.g. next section or many blank rows)
    if (r > cfsStartRow && !label.trim() && sheet.getCell(r + 1, 1).value == null) break;
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
