/**
 * Standard IB Financial Statement Templates
 * 
 * These templates provide the standard structure for each financial statement.
 * Users can customize by adding/removing rows or breaking down consolidated items.
 */

import type { Row } from "@/types/finance";

/**
 * Standard Income Statement Template (IB-grade)
 */
export function createIncomeStatementTemplate(): Row[] {
  return [
    {
      id: "rev",
      label: "Revenue",
      kind: "input", // Start as input, becomes calc when breakdowns are added
      valueType: "currency",
      values: {},
      children: [], // User can add revenue streams here
    },
    {
      id: "cogs",
      label: "Cost of Goods Sold (COGS)",
      kind: "input", // Start as input, becomes calc when breakdowns are added
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "gross_profit",
      label: "Gross Profit",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "gross_margin",
      label: "Gross Margin %",
      kind: "calc",
      valueType: "percent",
      values: {},
      children: [],
    },
    {
      id: "sga",
      label: "Selling, General & Administrative (SG&A)",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [], // User can break this down into Sales & Marketing, G&A, etc.
    },
    {
      id: "ebit",
      label: "EBIT (Operating Income)",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "ebit_margin",
      label: "EBIT Margin %",
      kind: "calc",
      valueType: "percent",
      values: {},
      children: [],
    },
    {
      id: "rd",
      label: "Research & Development (R&D)",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "other_opex",
      label: "Other Operating Expenses",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "danda",
      label: "Depreciation & Amortization (D&A)",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "interest_expense",
      label: "Interest Expense",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "interest_income",
      label: "Interest Income",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "other_income",
      label: "Other Income / (Expense), net",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "ebt",
      label: "EBT (Earnings Before Tax)",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "tax",
      label: "Income Tax Expense",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "net_income",
      label: "Net Income",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "net_income_margin",
      label: "Net Income Margin %",
      kind: "calc",
      valueType: "percent",
      values: {},
      children: [],
    },
  ];
}

/**
 * Standard Balance Sheet Template (IB-grade)
 */
export function createBalanceSheetTemplate(): Row[] {
  return [
    // ASSETS
    {
      id: "cash",
      label: "Cash & Cash Equivalents",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "ar",
      label: "Accounts Receivable",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "inventory",
      label: "Inventory",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "other_ca",
      label: "Other Current Assets",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [], // User can break this down
    },
    {
      id: "total_current_assets",
      label: "Total Current Assets",
      kind: "subtotal",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "ppe",
      label: "Property, Plant & Equipment (PP&E)",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "intangible_assets",
      label: "Intangible Assets",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "other_assets",
      label: "Other Assets",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "total_fixed_assets",
      label: "Total Fixed Assets",
      kind: "subtotal",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "total_assets",
      label: "Total Assets",
      kind: "total",
      valueType: "currency",
      values: {},
      children: [],
    },
    // LIABILITIES
    {
      id: "ap",
      label: "Accounts Payable",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "st_debt",
      label: "Short-Term Debt",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "other_cl",
      label: "Other Current Liabilities",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "total_current_liabilities",
      label: "Total Current Liabilities",
      kind: "subtotal",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "lt_debt",
      label: "Long-Term Debt",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "other_liab",
      label: "Other Liabilities",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "total_non_current_liabilities",
      label: "Total Non-Current Liabilities",
      kind: "subtotal",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "total_liabilities",
      label: "Total Liabilities",
      kind: "total",
      valueType: "currency",
      values: {},
      children: [],
    },
    // EQUITY (10-K Standard Structure)
    {
      id: "preferred_stock",
      label: "Preferred Stock (Par Value)",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "common_stock",
      label: "Common Stock (Par Value)",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "apic",
      label: "Additional Paid-in Capital (APIC)",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "treasury_stock",
      label: "Treasury Stock (at cost)",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
      // Note: Treasury stock is typically negative (contra-equity account)
    },
    {
      id: "aoci",
      label: "Accumulated Other Comprehensive Income (AOCI)",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "retained_earnings",
      label: "Retained Earnings",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "total_equity",
      label: "Total Equity",
      kind: "total",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "total_liab_and_equity",
      label: "Total Liabilities & Equity",
      kind: "total",
      valueType: "currency",
      values: {},
      children: [],
    },
  ];
}

/**
 * Standard Cash Flow Statement Template (IB-grade)
 */
export function createCashFlowTemplate(): Row[] {
  return [
    // Operating Activities
    {
      id: "net_income",
      label: "Net Income",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "danda",
      label: "Depreciation & Amortization",
      kind: "input", // Manual input in CFO
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "sbc",
      label: "Stock-Based Compensation",
      kind: "calc", // Calculated from SBC breakdowns
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "wc_change",
      label: "Change in Working Capital",
      kind: "input", // Input for first historical year, calculated for subsequent years
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "other_operating",
      label: "Other Operating Activities",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "operating_cf",
      label: "Cash from Operating Activities",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
    // Investing Activities
    {
      id: "capex",
      label: "Capital Expenditures (CapEx)",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "other_investing",
      label: "Other Investing Activities",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "investing_cf",
      label: "Cash from Investing Activities",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
    // Financing Activities
    {
      id: "debt_issuance",
      label: "Debt Issuance",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "debt_repayment",
      label: "Debt Repayment",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "equity_issuance",
      label: "Equity Issuance",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "dividends",
      label: "Dividends Paid",
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "financing_cf",
      label: "Cash from Financing Activities",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
    {
      id: "net_change_cash",
      label: "Net Change in Cash",
      kind: "calc",
      valueType: "currency",
      values: {},
      children: [],
    },
  ];
}
