/**
 * Financial Glossary System
 * 
 * Stores comprehensive reference data from Excel glossary for:
 * - Concept definitions
 * - Statement classifications (IS/BS/CFS)
 * - CFS section mappings (CFO/CFI/CFF)
 * - Forecasting methods
 * - Common/mandatory item flags
 */

export type PrimaryStatement = "IS" | "BS" | "CFS";
export type CFSSection = "CFO" | "CFI" | "CFF" | "Supplemental" | "Non-cash" | null;

export interface GlossaryItem {
  concept: string;
  primaryStatement: PrimaryStatement;
  description: string;
  typicalPresentation: string[]; // Common labels in 10-K filings
  impactOnOtherStatements: string; // How it affects other statements
  forecastingMethod: string; // Best way to forecast in IB
  cfsSection?: CFSSection; // CFS section if applicable
  isCommon: boolean; // Most common items (show in suggestions)
  isMandatory: boolean; // Required items (always show)
  alternativeNames?: string[]; // Alternative names for matching
  category?: string; // For grouping (e.g., "Revenue", "Expenses", "Assets")
}

/**
 * Financial Glossary Database
 * 
 * This will be populated from the Excel file you upload.
 * For now, it contains a sample structure with common items.
 */
export const FINANCIAL_GLOSSARY: GlossaryItem[] = [
  // Income Statement - Revenue
  {
    concept: "Revenue / Net sales / Total revenues",
    primaryStatement: "IS",
    description: "Total revenue from sale of goods or services. Primary top-line metric.",
    typicalPresentation: ["Revenue", "Net sales", "Total revenues", "Net revenue"],
    impactOnOtherStatements: "Impacts CFO via working capital changes (AR timing). Drives retained earnings.",
    forecastingMethod: "Unit volume × price, or revenue growth %; segment breakdowns for diversified companies.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Revenue", "Sales", "Net Sales", "Total Revenue", "Top Line"],
    category: "Revenue",
  },
  {
    concept: "Cost of revenue / Cost of sales / COGS",
    primaryStatement: "IS",
    description: "Direct costs attributable to producing/delivering goods/services (materials, labor, logistics, hosting). May include D&A of production assets.",
    typicalPresentation: ["Cost of sales", "Cost of revenues", "Cost of goods sold", "Cost of products sold", "Cost of services"],
    impactOnOtherStatements: "Drives inventory/AP/accruals; D&A embedded is added back in CFO; gross margin output affects retained earnings.",
    forecastingMethod: "Unit cost build (materials+labor+freight) or gross margin %; for SaaS hosting as % of revenue.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["COGS", "Cost of Sales", "Cost of Revenue", "Cost of Goods Sold"],
    category: "Expenses",
  },
  {
    concept: "Gross profit",
    primaryStatement: "IS",
    description: "Revenue minus cost of revenue.",
    typicalPresentation: ["Gross profit", "Gross income"],
    impactOnOtherStatements: "Calculated metric; affects retained earnings.",
    forecastingMethod: "Revenue - COGS, or gross margin % × revenue.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Gross Profit", "Gross Income"],
    category: "Metrics",
  },
  
  // Income Statement - Operating Expenses
  {
    concept: "Selling, general & administrative (SG&A)",
    primaryStatement: "IS",
    description: "Operating expenses including sales, marketing, G&A, and other administrative costs. May include SBC.",
    typicalPresentation: ["Selling, general and administrative expenses", "SG&A", "Operating expenses"],
    impactOnOtherStatements: "SBC non-cash add-back in CFO; accruals/AP in working capital.",
    forecastingMethod: "As % of revenue, or breakdown by function (sales, marketing, G&A).",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["SG&A", "Selling General and Administrative", "Operating Expenses"],
    category: "Expenses",
  },
  {
    concept: "Research & development (R&D)",
    primaryStatement: "IS",
    description: "Costs for research and product development activities.",
    typicalPresentation: ["Research and development", "R&D", "Research and development expenses"],
    impactOnOtherStatements: "Mostly CFO cash outflows when paid.",
    forecastingMethod: "As % of revenue, or absolute growth rate for tech companies.",
    isCommon: true,
    isMandatory: false,
    alternativeNames: ["R&D", "Research and Development"],
    category: "Expenses",
  },
  {
    concept: "Depreciation and amortization",
    primaryStatement: "IS",
    description: "Non-cash expense for wear and tear of assets (PP&E depreciation, intangible amortization).",
    typicalPresentation: ["Depreciation and amortization", "D&A", "Depreciation, depletion and amortization"],
    impactOnOtherStatements: "Added back to reconcile NI to operating cash flow (CFO).",
    forecastingMethod: "Schedule-driven: link to PP&E/intangible balances and useful lives.",
    cfsSection: "CFO",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["D&A", "Depreciation", "Amortization"],
    category: "Expenses",
  },
  {
    concept: "Stock-based compensation (SBC)",
    primaryStatement: "IS",
    description: "Non-cash expense for employee stock options, RSUs, and other equity compensation.",
    typicalPresentation: ["Stock-based compensation", "Share-based compensation", "SBC"],
    impactOnOtherStatements: "Add back in CFO (non-cash).",
    forecastingMethod: "As % of revenue or headcount-based; often embedded in SG&A/R&D.",
    cfsSection: "CFO",
    isCommon: true,
    isMandatory: false,
    alternativeNames: ["SBC", "Stock Based Compensation", "Share Based Compensation"],
    category: "Expenses",
  },
  
  // Income Statement - Other
  {
    concept: "Interest expense",
    primaryStatement: "IS",
    description: "Cost of borrowing on debt instruments (coupons, revolver interest, amortization of fees).",
    typicalPresentation: ["Interest expense", "Interest and fees"],
    impactOnOtherStatements: "Accrued interest on BS; cash interest paid in CFO under US GAAP; driven by debt schedule.",
    forecastingMethod: "Debt schedule: average balance × rate + commitment/fees; separate fixed vs floating.",
    cfsSection: "CFF",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Interest Expense", "Interest Cost"],
    category: "Expenses",
  },
  {
    concept: "Interest income",
    primaryStatement: "IS",
    description: "Income earned on cash, investments, or other interest-bearing assets.",
    typicalPresentation: ["Interest income", "Interest and investment income"],
    impactOnOtherStatements: "Cash received in CFO; driven by cash/investment balances and rates.",
    forecastingMethod: "Average cash/investment balance × rate; often minimal for non-financial companies.",
    cfsSection: "CFO",
    isCommon: true,
    isMandatory: false,
    alternativeNames: ["Interest Income"],
    category: "Income",
  },
  {
    concept: "Other income / (expense), net",
    primaryStatement: "IS",
    description: "Miscellaneous income and expenses not classified elsewhere (gains/losses on investments, foreign exchange, asset sales, etc.).",
    typicalPresentation: ["Other income (expense), net", "Other income", "Other expense", "Other income / (expense), net"],
    impactOnOtherStatements: "Non-operating items; may affect CFO if cash-related (e.g., asset sales).",
    forecastingMethod: "Often zero or minimal; project based on historical patterns or specific known transactions.",
    isCommon: true,
    isMandatory: false,
    alternativeNames: ["Other Income", "Other Expense", "Other Income Expense Net"],
    category: "Income",
  },
  {
    concept: "Gains (losses) on strategic investments",
    primaryStatement: "IS",
    description: "Unrealized or realized gains/losses on equity method investments, marketable securities, or strategic holdings.",
    typicalPresentation: ["Gains (losses) on strategic investments", "Gain on investments", "Loss on investments", "Investment gains (losses)"],
    impactOnOtherStatements: "Non-cash if unrealized; cash impact if realized (affects CFO).",
    forecastingMethod: "Project based on investment portfolio performance or historical patterns; often volatile.",
    isCommon: true,
    isMandatory: false,
    alternativeNames: ["Gains on Investments", "Losses on Investments", "Investment Gains", "Investment Losses", "Strategic Investment Gains"],
    category: "Income",
  },
  {
    concept: "Gains (losses) on foreign currency",
    primaryStatement: "IS",
    description: "Foreign exchange gains or losses from currency translation and transactions.",
    typicalPresentation: ["Foreign currency transaction gains (losses)", "FX gains (losses)", "Currency translation gains (losses)"],
    impactOnOtherStatements: "Non-cash translation adjustments; may affect CFO if cash-related transactions.",
    forecastingMethod: "Often minimal; project based on currency exposure and historical volatility.",
    isCommon: false,
    isMandatory: false,
    alternativeNames: ["FX Gains", "FX Losses", "Foreign Currency Gains", "Currency Gains"],
    category: "Income",
  },
  {
    concept: "Gains (losses) on asset sales / disposals",
    primaryStatement: "IS",
    description: "Gains or losses from the sale or disposal of assets (PP&E, investments, subsidiaries).",
    typicalPresentation: ["Gain on sale of assets", "Loss on disposal", "Gain (loss) on asset sales"],
    impactOnOtherStatements: "Cash proceeds in CFO (investing section); affects PP&E on BS.",
    forecastingMethod: "Project based on known asset sales or historical patterns; often one-time.",
    isCommon: false,
    isMandatory: false,
    alternativeNames: ["Gain on Asset Sales", "Loss on Asset Sales", "Asset Disposal Gains"],
    category: "Income",
  },
  {
    concept: "Provision for income taxes (tax expense)",
    primaryStatement: "IS",
    description: "Income tax expense based on accounting rules (may differ from cash taxes paid).",
    typicalPresentation: ["Provision for income taxes", "Income tax expense", "Tax expense"],
    impactOnOtherStatements: "Cash taxes paid in CFO differs from expense due to deferrals.",
    forecastingMethod: "Tax rate × pre-tax income; adjust for NOLs, credits, and jurisdictional mix.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Tax Expense", "Income Tax", "Provision for Taxes"],
    category: "Expenses",
  },
  {
    concept: "Net income",
    primaryStatement: "IS",
    description: "Bottom line: revenue minus all expenses. Starting point for CFO calculation.",
    typicalPresentation: ["Net income", "Net earnings", "Net profit"],
    impactOnOtherStatements: "Starting line in CFO; affects retained earnings on BS.",
    forecastingMethod: "Revenue - all expenses, or net margin % × revenue.",
    cfsSection: "CFO",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Net Income", "Net Earnings", "Net Profit"],
    category: "Metrics",
  },
  
  // Balance Sheet - Assets
  {
    concept: "Cash and cash equivalents",
    primaryStatement: "BS",
    description: "Liquid assets including cash, bank deposits, and short-term investments with maturities ≤ 3 months.",
    typicalPresentation: ["Cash and cash equivalents", "Cash", "Cash and short-term investments"],
    impactOnOtherStatements: "Ending cash reconciles via CFS (net change in cash).",
    forecastingMethod: "Beginning cash + net change in cash from CFS.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Cash", "Cash and Equivalents"],
    category: "Assets",
  },
  {
    concept: "Accounts receivable, net",
    primaryStatement: "BS",
    description: "Amounts owed by customers for goods/services sold on credit, net of allowance for doubtful accounts.",
    typicalPresentation: ["Accounts receivable", "Accounts receivable, net", "Trade receivables"],
    impactOnOtherStatements: "AR is working capital item in CFO (increase = cash use).",
    forecastingMethod: "DSO method: (AR / Revenue) × 365, or AR as % of revenue.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["AR", "Accounts Receivable", "Receivables"],
    category: "Assets",
  },
  {
    concept: "Inventory",
    primaryStatement: "BS",
    description: "Goods held for sale (raw materials, WIP, finished goods).",
    typicalPresentation: ["Inventory", "Inventories"],
    impactOnOtherStatements: "Working capital item in CFO (increase = cash use).",
    forecastingMethod: "DIO method: (Inventory / COGS) × 365, or inventory as % of COGS.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Inventory", "Inventories"],
    category: "Assets",
  },
  {
    concept: "Property and equipment, net (PP&E)",
    primaryStatement: "BS",
    description: "Tangible long-lived assets (land, buildings, machinery, equipment) net of accumulated depreciation.",
    typicalPresentation: ["Property and equipment, net", "PP&E", "Property, plant and equipment"],
    impactOnOtherStatements: "Capex in CFI, depreciation added back in CFO.",
    forecastingMethod: "Beginning PP&E + capex - depreciation; capex as % of revenue or capacity-based.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["PP&E", "Property Plant and Equipment", "Fixed Assets"],
    category: "Assets",
  },
  
  // Balance Sheet - Liabilities
  {
    concept: "Accounts payable",
    primaryStatement: "BS",
    description: "Amounts owed to suppliers for goods/services purchased on credit.",
    typicalPresentation: ["Accounts payable", "Trade payables"],
    impactOnOtherStatements: "Working capital source in CFO when increases.",
    forecastingMethod: "DPO method: (AP / COGS + relevant opex) × 365, or AP as % of purchases.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["AP", "Accounts Payable", "Payables"],
    category: "Liabilities",
  },
  {
    concept: "Short-term debt / current portion of long-term debt",
    primaryStatement: "BS",
    description: "Debt obligations due within one year (revolver, current portion of term loans).",
    typicalPresentation: ["Short-term debt", "Current portion of long-term debt", "Current maturities"],
    impactOnOtherStatements: "Principal repayment in CFF.",
    forecastingMethod: "From debt schedule: maturing principal + revolver balance.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Short Term Debt", "Current Debt"],
    category: "Liabilities",
  },
  {
    concept: "Long-term debt, net",
    primaryStatement: "BS",
    description: "Debt obligations due beyond one year, net of unamortized discounts/premiums.",
    typicalPresentation: ["Long-term debt", "Long-term debt, net", "Notes payable"],
    impactOnOtherStatements: "Principal financing cash flows in CFF.",
    forecastingMethod: "From debt schedule: beginning balance + new borrowings - repayments.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Long Term Debt", "LT Debt"],
    category: "Liabilities",
  },
  
  // Balance Sheet - Equity
  {
    concept: "Common stock / shares outstanding",
    primaryStatement: "BS",
    description: "Par value of common stock and number of shares issued.",
    typicalPresentation: ["Common stock", "Shares outstanding"],
    impactOnOtherStatements: "Issuance/buybacks affect CFF.",
    forecastingMethod: "Beginning shares + issuances - buybacks; often held constant in base case.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Common Stock", "Shares Outstanding"],
    category: "Equity",
  },
  {
    concept: "Retained earnings",
    primaryStatement: "BS",
    description: "Cumulative net income minus dividends paid over company's lifetime.",
    typicalPresentation: ["Retained earnings", "Retained deficit"],
    impactOnOtherStatements: "Direct link from net income and dividends (CFF).",
    forecastingMethod: "Beginning RE + net income - dividends.",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Retained Earnings"],
    category: "Equity",
  },
  
  // Cash Flow Statement - Operating
  {
    concept: "Change in working capital",
    primaryStatement: "CFS",
    description: "Net change in current assets minus current liabilities (excluding cash and short-term debt).",
    typicalPresentation: ["Changes in operating assets and liabilities", "Change in working capital"],
    impactOnOtherStatements: "Calculated from BS changes: (AR + Inventory + Other CA) - (AP + Other CL).",
    forecastingMethod: "Calculate from forecasted BS items, or use working capital as % of revenue.",
    cfsSection: "CFO",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Working Capital Change", "WC Change"],
    category: "Operating",
  },
  
  // Cash Flow Statement - Investing
  {
    concept: "Capital expenditures (Capex)",
    primaryStatement: "CFS",
    description: "Cash used to acquire PP&E (property, plant, equipment). Investing outflow.",
    typicalPresentation: ["Capital expenditures", "Purchases of property and equipment", "Capex"],
    impactOnOtherStatements: "Increases PP&E on BS; drives future depreciation in IS; D&A add-back in CFO.",
    forecastingMethod: "Capex % revenue or capacity-based; split maintenance vs growth for mature firms.",
    cfsSection: "CFI",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Capex", "Capital Expenditures", "CapEx"],
    category: "Investing",
  },
  
  // Cash Flow Statement - Financing
  {
    concept: "Debt issuance / Proceeds from borrowings",
    primaryStatement: "CFS",
    description: "Cash received from issuing new debt (bonds, loans, notes). Financing inflow.",
    typicalPresentation: ["Proceeds from issuance of debt", "Borrowings under credit facility", "Debt issuance"],
    impactOnOtherStatements: "Increases debt on BS; drives interest expense on IS; financing inflow.",
    forecastingMethod: "From debt schedule: model gross proceeds and repayments separately.",
    cfsSection: "CFF",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Debt Issuance", "Borrowings", "Debt Proceeds"],
    category: "Financing",
  },
  {
    concept: "Debt repayment",
    primaryStatement: "CFS",
    description: "Cash used to repay debt principal. Financing outflow.",
    typicalPresentation: ["Repayment of debt", "Repayments of borrowings", "Debt repayment"],
    impactOnOtherStatements: "Reduces debt on BS; financing outflow.",
    forecastingMethod: "From debt schedule: scheduled maturities + optional prepayments.",
    cfsSection: "CFF",
    isCommon: true,
    isMandatory: true,
    alternativeNames: ["Debt Repayment", "Debt Paydown"],
    category: "Financing",
  },
  {
    concept: "Equity issuance",
    primaryStatement: "CFS",
    description: "Cash received from issuing new equity (common stock, preferred stock). Financing inflow.",
    typicalPresentation: ["Proceeds from issuance of common stock", "Equity issuance", "Stock issuance"],
    impactOnOtherStatements: "Increases equity on BS; financing inflow.",
    forecastingMethod: "Capital plan-driven; often zero in base case unless specified.",
    cfsSection: "CFF",
    isCommon: true,
    isMandatory: false,
    alternativeNames: ["Equity Issuance", "Stock Issuance"],
    category: "Financing",
  },
  {
    concept: "Dividends paid",
    primaryStatement: "CFS",
    description: "Cash dividends paid to shareholders. Financing outflow.",
    typicalPresentation: ["Dividends paid", "Cash dividends", "Dividend payments"],
    impactOnOtherStatements: "Reduces retained earnings on BS; financing outflow.",
    forecastingMethod: "Dividend per share × shares outstanding, or payout ratio × net income.",
    cfsSection: "CFF",
    isCommon: true,
    isMandatory: false,
    alternativeNames: ["Dividends", "Dividends Paid"],
    category: "Financing",
  },
  {
    concept: "Share repurchases / buybacks",
    primaryStatement: "CFS",
    description: "Cash used to repurchase company shares (treasury stock). Financing outflow.",
    typicalPresentation: ["Repurchase of common stock", "Share repurchases", "Stock buybacks"],
    impactOnOtherStatements: "Reduces equity on BS (treasury stock); financing outflow.",
    forecastingMethod: "Capital plan-driven; often zero in base case unless specified.",
    cfsSection: "CFF",
    isCommon: true,
    isMandatory: false,
    alternativeNames: ["Share Repurchases", "Buybacks", "Stock Buybacks"],
    category: "Financing",
  },
];

/**
 * Load glossary from external source (e.g., Excel file)
 * This function will be called when the Excel file is uploaded
 */
export function loadGlossaryFromExcel(data: any[]): void {
  // TODO: Implement Excel parsing when file is provided
  // For now, glossary is hardcoded above
}

/**
 * Search glossary by concept name (fuzzy matching)
 */
export function searchGlossary(query: string, statementType?: PrimaryStatement): GlossaryItem[] {
  const normalizedQuery = query.toLowerCase().trim();
  
  return FINANCIAL_GLOSSARY.filter(item => {
    if (statementType && item.primaryStatement !== statementType) return false;
    
    // Exact match
    if (item.concept.toLowerCase().includes(normalizedQuery)) return true;
    
    // Alternative names match
    if (item.alternativeNames?.some(name => name.toLowerCase().includes(normalizedQuery))) return true;
    
    // Typical presentation match
    if (item.typicalPresentation.some(p => p.toLowerCase().includes(normalizedQuery))) return true;
    
    return false;
  });
}

/**
 * Find exact match in glossary
 */
export function findGlossaryItem(concept: string): GlossaryItem | null {
  const normalized = concept.toLowerCase().trim();
  
  return FINANCIAL_GLOSSARY.find(item => 
    item.concept.toLowerCase() === normalized ||
    item.alternativeNames?.some(name => name.toLowerCase() === normalized) ||
    item.typicalPresentation.some(p => p.toLowerCase() === normalized)
  ) || null;
}
