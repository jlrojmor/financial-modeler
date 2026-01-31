/**
 * Balance Sheet Category Mapper
 * 
 * Maps Balance Sheet row IDs to their categories based on standard template structure
 */

import type { Row } from "@/types/finance";
import type { BalanceSheetCategory } from "./bs-impact-rules";

// Standard row IDs for each category (based on template)
const CATEGORY_MAPPINGS: Record<string, BalanceSheetCategory> = {
  // Current Assets
  cash: "current_assets",
  ar: "current_assets",
  inventory: "current_assets",
  other_ca: "current_assets",
  
  // Fixed Assets
  ppe: "fixed_assets",
  intangible_assets: "fixed_assets",
  goodwill: "fixed_assets",
  other_assets: "fixed_assets",
  
  // Current Liabilities
  ap: "current_liabilities",
  st_debt: "current_liabilities",
  other_cl: "current_liabilities",
  
  // Non-Current Liabilities
  lt_debt: "non_current_liabilities",
  other_liab: "non_current_liabilities",
  
  // Equity
  common_stock: "equity",
  retained_earnings: "equity",
  other_equity: "equity",
};

/**
 * Get category for a row based on its position in the BS array
 */
export function getBSCategoryForRow(
  rowId: string,
  rows: Row[],
  rowIndex?: number
): BalanceSheetCategory | null {
  // First check direct mapping
  if (rowId in CATEGORY_MAPPINGS) {
    return CATEGORY_MAPPINGS[rowId];
  }
  
  // If no direct mapping and we have row index, infer from position
  if (rowIndex !== undefined) {
    const totalCurrentAssetsIndex = rows.findIndex(r => r.id === "total_current_assets");
    const totalAssetsIndex = rows.findIndex(r => r.id === "total_assets");
    const totalCurrentLiabIndex = rows.findIndex(r => r.id === "total_current_liabilities");
    const totalLiabIndex = rows.findIndex(r => r.id === "total_liabilities");
    const totalEquityIndex = rows.findIndex(r => r.id === "total_equity");
    
    if (rowIndex < totalCurrentAssetsIndex) return "current_assets";
    if (rowIndex < totalAssetsIndex) return "fixed_assets";
    if (rowIndex < totalCurrentLiabIndex) return "current_liabilities";
    if (rowIndex < totalLiabIndex) return "non_current_liabilities";
    if (rowIndex < totalEquityIndex) return "equity";
  }
  
  return null;
}

/**
 * Get all rows for a specific category
 */
export function getRowsForCategory(
  rows: Row[],
  category: BalanceSheetCategory
): Row[] {
  const categoryRows: Row[] = [];
  
  // Define boundaries based on total row positions
  const totalCurrentAssetsIndex = rows.findIndex(r => r.id === "total_current_assets");
  const totalAssetsIndex = rows.findIndex(r => r.id === "total_assets");
  const totalCurrentLiabIndex = rows.findIndex(r => r.id === "total_current_liabilities");
  const totalLiabIndex = rows.findIndex(r => r.id === "total_liabilities");
  const totalEquityIndex = rows.findIndex(r => r.id === "total_equity");
  
  rows.forEach((row, index) => {
    // Skip only grand totals, but include subtotals (they should be shown)
    if (row.id === "total_assets" || row.id === "total_liabilities" || row.id === "total_liab_and_equity") return;
    // Include subtotals like total_current_assets, total_current_liabilities, total_equity
    
    let belongsToCategory = false;
    
    // Handle cases where total row indices might be -1 (not found)
    switch (category) {
      case "current_assets":
        if (totalCurrentAssetsIndex >= 0) {
          belongsToCategory = index < totalCurrentAssetsIndex;
        } else if (totalAssetsIndex >= 0) {
          // If total_current_assets not found, include everything before total_assets
          belongsToCategory = index < totalAssetsIndex;
        } else {
          // If no totals found, include first few rows (fallback)
          belongsToCategory = index < 10;
        }
        break;
      case "fixed_assets":
        if (totalCurrentAssetsIndex >= 0 && totalAssetsIndex >= 0) {
          // Fixed assets are between total_current_assets and total_assets (exclusive of both)
          belongsToCategory = index > totalCurrentAssetsIndex && index < totalAssetsIndex;
        } else if (totalAssetsIndex >= 0 && totalCurrentAssetsIndex === -1) {
          // If total_current_assets not found but total_assets is, try to find where current assets end
          // Look for common current asset IDs to determine boundary
          const commonCAIds = ["cash", "ar", "inventory", "other_ca", "prepaid_expenses", "marketable_securities"];
          let lastCAIndex = -1;
          for (let i = 0; i < index; i++) {
            if (commonCAIds.includes(rows[i].id) || rows[i].id.startsWith("ca_")) {
              lastCAIndex = i;
            }
          }
          // If we found current assets, fixed assets start after them
          if (lastCAIndex >= 0) {
            belongsToCategory = index > lastCAIndex && index < totalAssetsIndex;
          } else {
            // Fallback: assume first few rows are current assets, rest before total_assets are fixed
            belongsToCategory = index >= 5 && index < totalAssetsIndex;
          }
        }
        break;
      case "current_liabilities":
        if (totalAssetsIndex >= 0 && totalCurrentLiabIndex >= 0) {
          // Current liabilities are between total_assets and total_current_liabilities (exclusive of both)
          belongsToCategory = index > totalAssetsIndex && index < totalCurrentLiabIndex;
        } else if (totalCurrentLiabIndex >= 0) {
          // If total_assets not found, look for common asset IDs to determine boundary
          const commonAssetIds = ["ppe", "intangible_assets", "other_assets", "total_assets"];
          let lastAssetIndex = -1;
          for (let i = 0; i < index; i++) {
            if (commonAssetIds.includes(rows[i].id) || rows[i].id === "total_current_assets" || rows[i].id.startsWith("fa_")) {
              lastAssetIndex = i;
            }
          }
          if (lastAssetIndex >= 0) {
            belongsToCategory = index > lastAssetIndex && index < totalCurrentLiabIndex;
          } else {
            belongsToCategory = index < totalCurrentLiabIndex;
          }
        }
        break;
      case "non_current_liabilities":
        if (totalCurrentLiabIndex >= 0 && totalLiabIndex >= 0) {
          // Non-current liabilities are between total_current_liabilities and total_liabilities (exclusive of both)
          belongsToCategory = index > totalCurrentLiabIndex && index < totalLiabIndex;
        } else if (totalLiabIndex >= 0) {
          // If total_current_liabilities not found, look for common current liability IDs
          const commonCLIds = ["ap", "st_debt", "other_cl", "total_current_liabilities"];
          let lastCLIndex = -1;
          for (let i = 0; i < index; i++) {
            if (commonCLIds.includes(rows[i].id) || rows[i].id.startsWith("cl_")) {
              lastCLIndex = i;
            }
          }
          if (lastCLIndex >= 0) {
            belongsToCategory = index > lastCLIndex && index < totalLiabIndex;
          } else {
            belongsToCategory = index < totalLiabIndex;
          }
        }
        break;
      case "equity":
        if (totalLiabIndex >= 0 && totalEquityIndex >= 0) {
          belongsToCategory = index > totalLiabIndex && index < totalEquityIndex;
        } else if (totalEquityIndex >= 0) {
          belongsToCategory = index < totalEquityIndex;
        } else {
          // If no equity total found, include rows after liabilities (fallback)
          belongsToCategory = index > (totalLiabIndex >= 0 ? totalLiabIndex : rows.length - 10);
        }
        break;
    }
    
    if (belongsToCategory) {
      categoryRows.push(row);
    }
  });
  
  return categoryRows;
}

/**
 * Get insertion index for a new row in a category
 * Inserts at the END of the category items (before the subtotal/total row)
 */
export function getInsertionIndexForCategory(
  rows: Row[],
  category: BalanceSheetCategory
): number {
  const totalCurrentAssetsIndex = rows.findIndex(r => r.id === "total_current_assets");
  const totalAssetsIndex = rows.findIndex(r => r.id === "total_assets");
  const totalCurrentLiabIndex = rows.findIndex(r => r.id === "total_current_liabilities");
  const totalLiabIndex = rows.findIndex(r => r.id === "total_liabilities");
  const totalEquityIndex = rows.findIndex(r => r.id === "total_equity");
  
  switch (category) {
    case "current_assets":
      // Insert at the end of current assets (right before total_current_assets)
      // Find the last item in current assets category
      if (totalCurrentAssetsIndex >= 0) {
        // Find the last non-total row before total_current_assets
        for (let i = totalCurrentAssetsIndex - 1; i >= 0; i--) {
          if (!rows[i].id.startsWith("total_") && rows[i].kind !== "total" && rows[i].kind !== "subtotal") {
            return i + 1; // Insert after the last item
          }
        }
        return totalCurrentAssetsIndex; // If no items found, insert before total
      }
      return 0;
    case "fixed_assets":
      // Insert at the end of fixed assets (right before total_assets)
      if (totalAssetsIndex >= 0 && totalCurrentAssetsIndex >= 0) {
        for (let i = totalAssetsIndex - 1; i > totalCurrentAssetsIndex; i--) {
          if (!rows[i].id.startsWith("total_") && rows[i].kind !== "total" && rows[i].kind !== "subtotal") {
            return i + 1;
          }
        }
        return totalAssetsIndex;
      }
      return rows.length;
    case "current_liabilities":
      // Insert at the end of current liabilities
      if (totalCurrentLiabIndex >= 0 && totalAssetsIndex >= 0) {
        for (let i = totalCurrentLiabIndex - 1; i > totalAssetsIndex; i--) {
          if (!rows[i].id.startsWith("total_") && rows[i].kind !== "total" && rows[i].kind !== "subtotal") {
            return i + 1;
          }
        }
        return totalCurrentLiabIndex;
      }
      return rows.length;
    case "non_current_liabilities":
      // Insert at the end of non-current liabilities
      if (totalLiabIndex >= 0 && totalCurrentLiabIndex >= 0) {
        for (let i = totalLiabIndex - 1; i > totalCurrentLiabIndex; i--) {
          if (!rows[i].id.startsWith("total_") && rows[i].kind !== "total" && rows[i].kind !== "subtotal") {
            return i + 1;
          }
        }
        return totalLiabIndex;
      }
      return rows.length;
    case "equity":
      // Insert at the end of equity
      if (totalEquityIndex >= 0 && totalLiabIndex >= 0) {
        for (let i = totalEquityIndex - 1; i > totalLiabIndex; i--) {
          if (!rows[i].id.startsWith("total_") && rows[i].kind !== "total" && rows[i].kind !== "subtotal") {
            return i + 1;
          }
        }
        return totalEquityIndex;
      }
      return rows.length;
    default:
      return rows.length;
  }
}
