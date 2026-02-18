"use client";

import { useMemo, useState, useEffect, Fragment } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
} from "@/lib/currency-utils";
import CollapsibleSection from "@/components/collapsible-section";
import { findTermKnowledge } from "@/lib/financial-terms-knowledge";
import { analyzeBSItemsForCFO, type CFOItem } from "@/lib/cfo-intelligence";
import { getSuggestedCFIItems, validateCFIItem, findCFIItem, type CFIItem } from "@/lib/cfi-intelligence";
import { getSuggestedCFFItems, validateCFFItem, findCFFItem, type CFFItem } from "@/lib/cff-intelligence";
import { computeRowValue, getTotalSbcForYear } from "@/lib/calculations";
// UUID helper
function uuid() {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Infer CFO sign for an unrecognized operating item from its label.
 * Cash outflow / use of cash → negative; inflow / source of cash → positive.
 */
function inferOperatingSignFromLabel(label: string): "positive" | "negative" {
  const L = label.toLowerCase();
  const negativePatterns = [
    "payment", "payments", "paid", "expense", "expenses", "cost", "costs",
    "outflow", "outflows", "charge", "charges", "loss", "losses", "write-off", "writeoff",
    "settlement", "repayment", "funding of", "increase in receivable", "increase in inventory",
    "decrease in payable", "accrued", "accrual", "prepaid", "deposit paid",
    "litigation", "restructuring", "severance", "penalty", "fine", "interest paid",
  ];
  const positivePatterns = [
    "receipt", "receipts", "received", "income", "revenue", "inflow", "inflows",
    "gain", "gains", "recovery", "recoveries", "refund", "refunds", "rebate",
    "decrease in receivable", "decrease in inventory", "increase in payable",
    "amortization", "depreciation add-back", "non-cash", "noncash",
    "proceeds", "collection", "collections",
  ];
  for (const p of negativePatterns) {
    if (L.includes(p)) return "negative";
  }
  for (const p of positivePatterns) {
    if (L.includes(p)) return "positive";
  }
  // Default: treat as additive (positive) as most "other operating" items are add-backs
  return "positive";
}

/**
 * Infer CFF sign for an unrecognized financing item from its label.
 * Cash inflow (proceeds, issuance, borrowing) → positive; outflow (repayment, repurchase, dividends) → negative.
 */
function inferFinancingSignFromLabel(label: string): "positive" | "negative" {
  const L = label.toLowerCase();
  const negativePatterns = [
    "repayment", "repayments", "repay", "repurchases", "repurchase", "buyback", "buy-back",
    "dividend", "dividends", "payment", "payments", "paid", "outflow", "outflows",
    "retirement", "retirements", "redemption", "redemptions", "settlement", "settlements",
    "principal repayment", "principal repayments", "debt repayment", "debt repayments",
  ];
  const positivePatterns = [
    "issuance", "issuances", "issue", "proceeds", "borrowing", "borrowings", "loan", "loans",
    "inflow", "inflows", "receipt", "receipts", "received", "raise", "raised",
    "debt issuance", "equity issuance", "stock issuance", "bond issuance",
    "exercise", "exercised", "warrant", "warrants", "option", "options",
  ];
  for (const p of negativePatterns) {
    if (L.includes(p)) return "negative";
  }
  for (const p of positivePatterns) {
    if (L.includes(p)) return "positive";
  }
  // Default: treat as positive (most financing items are cash inflows)
  return "positive";
}

type CFSSection = "operating" | "investing" | "financing";

interface CFSSectionConfig {
  id: CFSSection;
  label: string;
  description: string;
  colorClass: "blue" | "green" | "orange";
  sectionId: string;
  totalRowId: string;
  standardItems: string[]; // IDs of standard items in this section
}

const CFS_SECTIONS: CFSSectionConfig[] = [
  {
    id: "operating",
    label: "Operating Activities",
    description: "Cash flows from operating activities. ✨ Net Income, D&A, and SBC auto-populate from Income Statement. 📊 Working Capital changes: input first year, then auto-calculated from Balance Sheet.",
    colorClass: "blue",
    sectionId: "cfs_operating",
    totalRowId: "operating_cf",
    standardItems: ["net_income", "danda", "sbc", "wc_change", "other_operating"],
  },
  {
    id: "investing",
    label: "Investing Activities",
    description: "Cash flows from investing activities. CapEx and other investing transactions.",
    colorClass: "green",
    sectionId: "cfs_investing",
    totalRowId: "investing_cf",
    standardItems: ["capex"],
  },
  {
    id: "financing",
    label: "Financing Activities",
    description: "Cash flows from financing activities. Debt, equity, and dividend transactions.",
    colorClass: "orange",
    sectionId: "cfs_financing",
    totalRowId: "financing_cf",
    standardItems: [],
  },
];

/**
 * CFS Section Component - displays items for a specific CFS section
 */
function CFSSectionComponent({
  section,
  rows,
  years,
  meta,
  updateRowValue,
  insertRow,
  removeRow,
  incomeStatement,
  sbcBreakdowns,
  allStatements,
  cfoIntelligence = [],
  balanceSheet,
  danaBreakdowns,
  danaLocation,
}: {
  section: CFSSectionConfig;
  rows: Row[];
  years: string[];
  meta: any;
  updateRowValue: (statement: "cashFlow", rowId: string, year: string, value: number) => void;
  insertRow: (statement: "cashFlow", index: number, row: Row) => void;
  removeRow: (statement: "cashFlow", rowId: string) => void;
  incomeStatement: Row[];
  sbcBreakdowns: Record<string, Record<string, number>>;
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] };
  cfoIntelligence?: CFOItem[];
  balanceSheet: Row[];
  danaBreakdowns: Record<string, number>;
  danaLocation: "cogs" | "sga" | "both" | null;
}) {
  // Get current cashFlow from store to ensure we have the latest state
  // This ensures we always have the most up-to-date data after insertions
  const currentCashFlow = useModelStore((s) => s.cashFlow);
  const ensureWcChildrenFromBS = useModelStore((s) => s.ensureWcChildrenFromBS);
  const reorderCashFlowTopLevel = useModelStore((s) => s.reorderCashFlowTopLevel);
  const reorderWcChildren = useModelStore((s) => s.reorderWcChildren);
  const moveCashFlowRowIntoWc = useModelStore((s) => s.moveCashFlowRowIntoWc);
  const moveCashFlowRowOutOfWc = useModelStore((s) => s.moveCashFlowRowOutOfWc);
  const confirmedRowIds = useModelStore((s) => s.confirmedRowIds);
  const toggleConfirmedRow = useModelStore((s) => s.toggleConfirmedRow);
  // Always use currentCashFlow from store as the source of truth
  const currentRows = currentCashFlow;
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [termKnowledge, setTermKnowledge] = useState<any>(null);
  const [wcSectionExpanded, setWcSectionExpanded] = useState(true);
  const [suggestedCFIExpanded, setSuggestedCFIExpanded] = useState(false);
  const [suggestedCFFExpanded, setSuggestedCFFExpanded] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const toggleConfirmed = (rowId: string) => {
    toggleConfirmedRow(rowId);
  };

  const sectionStartIndex = currentRows.findIndex((r) => {
    if (section.id === "operating") return r.id === "net_income";
    if (section.id === "investing") return r.id === "capex";
    if (section.id === "financing") return r.id === "debt_issuance";
    return false;
  });
  const sectionEndIndex = currentRows.findIndex((r, idx) => {
    if (idx <= sectionStartIndex) return false;
    if (section.id === "operating") return r.id === "operating_cf";
    if (section.id === "investing") return r.id === "investing_cf";
    if (section.id === "financing") return r.id === "financing_cf";
    return false;
  });

  const handleDragStart = (e: React.DragEvent, payload: { rowId: string; isWcChild: boolean; fromTopLevelIndex?: number; fromWcChildIndex?: number }) => {
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(targetId);
  };

  const handleDragLeave = () => setDragOverId(null);

  const handleDrop = (
    e: React.DragEvent,
    target: { type: "top-level"; rowId: string; globalIndex: number } | { type: "wc-container" } | { type: "wc-child"; rowId: string; wcChildIndex: number }
  ) => {
    e.preventDefault();
    setDragOverId(null);
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    let payload: { rowId: string; isWcChild: boolean; fromTopLevelIndex?: number; fromWcChildIndex?: number };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const { rowId, isWcChild, fromTopLevelIndex, fromWcChildIndex } = payload;
    if (target.type !== "wc-container" && rowId === target.rowId) return;

    if (target.type === "top-level") {
      const toIndex = target.globalIndex;
      if (isWcChild) {
        moveCashFlowRowOutOfWc(rowId, toIndex);
      } else {
        const fromIndex = fromTopLevelIndex ?? currentRows.findIndex((r) => r.id === rowId);
        if (fromIndex === -1) return;
        // Calculate insert index: when dragging down (fromIndex < toIndex), insert after drop target.
        // When dragging up (fromIndex > toIndex), insert before drop target (at toIndex).
        // After removal, array shrinks, so adjust: drag down = toIndex (insert after), drag up = toIndex (insert before).
        const insertIndex = fromIndex < toIndex ? toIndex : toIndex;
        if (fromIndex !== insertIndex) reorderCashFlowTopLevel(fromIndex, insertIndex);
      }
    } else if (target.type === "wc-container") {
      if (!isWcChild) moveCashFlowRowIntoWc(rowId);
    } else if (target.type === "wc-child") {
      const toIndex = target.wcChildIndex;
      if (isWcChild) {
        const fromIndex = fromWcChildIndex ?? currentRows.find((r) => r.id === "wc_change")?.children?.findIndex((c) => c.id === rowId) ?? -1;
        if (fromIndex !== -1 && fromIndex !== toIndex) reorderWcChildren(fromIndex, toIndex);
      } else {
        moveCashFlowRowIntoWc(rowId, toIndex);
      }
    }
  };

  // Sync Working Capital children from Balance Sheet when operating section is shown
  useEffect(() => {
    if (section.id === "operating" && balanceSheet.length > 0) {
      ensureWcChildrenFromBS();
    }
  }, [section.id, balanceSheet.length, ensureWcChildrenFromBS]);
  
  // Check if label is recognized - use CFI validation for investing section
  useEffect(() => {
    if (newItemLabel.trim()) {
      if (section.id === "investing") {
        // Use CFI intelligence for investing section
        const validation = validateCFIItem(newItemLabel.trim());
        const matchedItem = findCFIItem(newItemLabel.trim());
        
        if (matchedItem) {
          setTermKnowledge({ cfiItem: matchedItem });
          setValidationError(null);
        } else if (validation.isValid) {
          setTermKnowledge({ cfiItem: null, validation });
          setValidationError(null);
        } else {
          setTermKnowledge(null);
          setValidationError(validation.suggestion || validation.reason || "⚠️ This term may not be appropriate for Investing Activities.");
        }
      } else if (section.id === "financing") {
        // Use CFF intelligence for financing section
        const validation = validateCFFItem(newItemLabel.trim());
        const matchedItem = findCFFItem(newItemLabel.trim());
        
        if (matchedItem) {
          setTermKnowledge({ cffItem: matchedItem });
          setValidationError(null);
        } else if (validation.isValid) {
          setTermKnowledge({ cffItem: null, validation });
          setValidationError(null);
        } else {
          // Allow unrecognized items - we'll infer sign from label
          setTermKnowledge(null);
          setValidationError("This term is not recognized. You can still add it; we'll infer the sign from the label.");
        }
      } else {
        // Use financial terms knowledge for operating and others
        const knowledge = findTermKnowledge(newItemLabel.trim());
        setTermKnowledge(knowledge);
        if (!knowledge && !section.standardItems.some(id => currentRows.some(r => r.id === id && r.label.toLowerCase() === newItemLabel.trim().toLowerCase()))) {
          if (section.id === "operating") {
            setValidationError("This term is not recognized. You can still add it; we'll infer the sign from the label.");
          } else {
            setValidationError("This term is not recognized. Please use standard financial terminology or select a suggestion.");
          }
        } else {
          setValidationError(null);
        }
      }
    } else {
      setValidationError(null);
      setTermKnowledge(null);
    }
  }, [newItemLabel, currentRows, section.standardItems, section.id]);

  // Get items for this section
  const sectionItems = useMemo(() => {
    const sectionStartIndex = currentRows.findIndex(r => {
      if (section.id === "operating") return r.id === "net_income";
      if (section.id === "investing") return r.id === "capex";
      if (section.id === "financing") return r.id === "debt_issuance";
      return false;
    });

    const sectionEndIndex = currentRows.findIndex((r, idx) => {
      if (idx <= sectionStartIndex) return false;
      if (section.id === "operating") return r.id === "operating_cf";
      if (section.id === "investing") return r.id === "investing_cf";
      if (section.id === "financing") return r.id === "financing_cf";
      return false;
    });

    // For investing and financing sections, include all items from start marker up to and including the total row
    // This ensures newly added items (inserted before the total) are included
    let result: Row[] = [];
    
    if (sectionStartIndex !== -1) {
      // Standard case: start marker exists, get items from start to end
      result = sectionEndIndex === -1 
        ? currentRows.slice(sectionStartIndex) 
        : currentRows.slice(sectionStartIndex, sectionEndIndex + 1);
    }
    
    // For all sections, also include any items with matching cfsLink.section
    // This handles cases where start marker doesn't exist or items are inserted outside normal range
    // Keep items in store order (don't reorder) so preview matches builder
    if (section.id === "operating" || section.id === "investing" || section.id === "financing") {
      const itemsWithCfsLink = currentRows.filter(r => r.cfsLink?.section === section.id);
      
      const additionalItems = itemsWithCfsLink.filter(r => 
        !result.some(existing => existing.id === r.id) &&
        r.id !== section.totalRowId // Don't include the total row here
      );
      if (additionalItems.length > 0) {
        // For preview to match builder: show items in store order only.
        // Additional items outside slice should be moved into slice in store, not reordered here.
        // For now, append them at end (before total) to maintain relative store order.
        const totalIndexInResult = result.findIndex(r => r.id === section.totalRowId);
        if (totalIndexInResult >= 0) {
          // Sort additional items by their store index to maintain order
          const sortedAdditional = [...additionalItems].sort((a, b) => {
            const aIdx = currentRows.findIndex(r => r.id === a.id);
            const bIdx = currentRows.findIndex(r => r.id === b.id);
            return aIdx - bIdx;
          });
          result = [
            ...result.slice(0, totalIndexInResult),
            ...sortedAdditional,
            ...result.slice(totalIndexInResult)
          ];
        } else {
          result = [...result, ...additionalItems];
        }
      }
      
      // If no items found and start marker doesn't exist, still try to find items by cfsLink
      if (result.length === 0 && sectionStartIndex === -1) {
        const itemsByLink = currentRows.filter(r => r.cfsLink?.section === section.id);
        if (itemsByLink.length > 0) {
          result = itemsByLink;
          // Also include the total row if it exists
          const totalRow = currentRows.find(r => r.id === section.totalRowId);
          if (totalRow) {
            result.push(totalRow);
          }
        }
      }
      
      // CRITICAL: For operating section, also include any custom items that might be positioned
      // between operating_cf and capex (they should have cfsLink.section === "operating" but double-check)
      if (section.id === "operating") {
        const operatingCfIndex = currentRows.findIndex(r => r.id === "operating_cf");
        const capexIndex = currentRows.findIndex(r => r.id === "capex");
        if (operatingCfIndex >= 0 && capexIndex > operatingCfIndex) {
          const itemsBetween = currentRows.slice(operatingCfIndex + 1, capexIndex);
          const missingCustomItems = itemsBetween.filter(r => 
            !result.some(existing => existing.id === r.id) &&
            r.id !== section.totalRowId &&
            (r.cfsLink?.section === "operating" || !r.cfsLink) // Include items with operating cfsLink or no cfsLink (custom items)
          );
          if (missingCustomItems.length > 0) {
            const totalIndexInResult = result.findIndex(r => r.id === section.totalRowId);
            if (totalIndexInResult >= 0) {
              result = [
                ...result.slice(0, totalIndexInResult),
                ...missingCustomItems,
                ...result.slice(totalIndexInResult)
              ];
            } else {
              result = [...result, ...missingCustomItems];
            }
          }
        }
      }
      
      // Check for items between investing_cf and financing_cf that might be financing items
      // but don't have cfsLink (position-based detection like Excel preview uses)
      if (section.id === "financing") {
        const investingCfIndex = currentRows.findIndex(r => r.id === "investing_cf");
        const financingCfIndex = currentRows.findIndex(r => r.id === "financing_cf");
        
        if (investingCfIndex >= 0 && financingCfIndex >= 0) {
          const itemsBetween = currentRows.slice(investingCfIndex + 1, financingCfIndex);
          const missingItems = itemsBetween.filter(r => 
            !result.some(existing => existing.id === r.id) &&
            r.id !== section.totalRowId
          );
          
          if (missingItems.length > 0) {
            // Add missing items that are positioned in financing section
            const totalIndexInResult = result.findIndex(r => r.id === section.totalRowId);
            if (totalIndexInResult >= 0) {
              result = [
                ...result.slice(0, totalIndexInResult),
                ...missingItems,
                ...result.slice(totalIndexInResult)
              ];
            } else {
              result = [...result, ...missingItems];
            }
          }
          
          // Ensure the total row (financing_cf) is always included
          const totalRow = currentRows.find(r => r.id === section.totalRowId);
          if (totalRow && !result.some(r => r.id === section.totalRowId)) {
            result.push(totalRow);
          }
        }
      }
    }
    
    return result;
  }, [currentRows, section.id]);

  const historicalYears = meta?.years?.historical ?? years.filter((y) => y.endsWith("A"));
  const totalRow = sectionItems.find(r => r.id === section.totalRowId);
  const isLocked = useModelStore((s) => s.sectionLocks[section.sectionId] ?? false);

  // Get the sign indicator for CFO/CFI items
  const getCFOSign = (row: Row): string | null => {
    // Show signs for operating and investing section items
    if (section.id === "operating") {
      // Standard CFO items with known signs
      if (row.id === "net_income" || row.id === "danda" || row.id === "sbc") {
        return "+";
      }
      if (row.id === "wc_change") {
        return "-";
      }
      if (row.id === "other_operating") {
        return "+"; // Can be negative, but shown as + (value itself can be negative)
      }
      
      // Custom / CFO intelligence items - check cfsLink.impact (set when recognized or inferred)
      if (row.cfsLink?.section === "operating") {
        if (row.cfsLink.impact === "negative") return "-";
        return "+";
      }
    } else if (section.id === "investing") {
      // Standard CFI items
      if (row.id === "capex") {
        return "-"; // CapEx is cash outflow
      }
      if (row.id === "other_investing") {
        return "+"; // Can be positive or negative, but shown as + (value itself can be negative)
      }
      
      // CFI items with cfsLink - check the impact
      if (row.cfsLink && row.cfsLink.section === "investing") {
        if (row.cfsLink.impact === "positive") {
          return "+";
        } else if (row.cfsLink.impact === "negative") {
          return "-";
        }
      }
      
      // Try to match by label using CFI intelligence
      if (row.label) {
        const cfiItem = findCFIItem(row.label);
        if (cfiItem) {
          return cfiItem.impact === "positive" ? "+" : "-";
        }
      }
    } else if (section.id === "financing") {
      // Standard CFF items
      if (row.id === "debt_issuance" || row.id === "equity_issuance") {
        return "+"; // Issuances are cash inflows
      }
      if (row.id === "debt_repayment" || row.id === "dividends") {
        return "-"; // Repayments and dividends are cash outflows
      }
      
      // CFF items with cfsLink - check the impact
      if (row.cfsLink && row.cfsLink.section === "financing") {
        if (row.cfsLink.impact === "positive") {
          return "+";
        } else if (row.cfsLink.impact === "negative") {
          return "-";
        }
      }
      
      // Try to match by label using CFF intelligence
      if (row.label) {
        const cffItem = findCFFItem(row.label);
        if (cffItem) {
          return cffItem.impact === "positive" ? "+" : "-";
        }
      }
    }
    
    // Default: no sign for unknown items
    return null;
  };

  // Get link information and auto-population status for display
  const getLinkInfo = (row: Row): { text: string; isAutoPopulated: boolean } | null => {
    if (row.cfsLink) {
      return { text: row.cfsLink.description, isAutoPopulated: false };
    }
    if (row.isLink) {
      return { text: `Links to IS: ${row.isLink.description}`, isAutoPopulated: true };
    }
    // Standard links
    if (row.id === "net_income") return { text: "✨ Auto-populated from Income Statement", isAutoPopulated: true };
    // D&A is now a manual input - no auto-population
    if (row.id === "sbc") return { text: "✨ Auto-calculated from SBC breakdowns", isAutoPopulated: true };
    if (row.id === "wc_change") {
      // All historical years are manual input, projection years are calculated
      return { 
        text: "📝 Input required for all historical years (from 10-K). Projection years will be auto-calculated from Balance Sheet changes",
        isAutoPopulated: false
      };
    }
    return null;
  };
  
  // Get auto-populated value for display
  const getAutoPopulatedValue = (row: Row, year: string): number | null => {
    if (row.id === "net_income") {
      const isRow = incomeStatement.find(r => r.id === "net_income");
      if (isRow?.values?.[year] !== undefined) {
        return isRow.values[year];
      }
      // Try computing it if not stored
      try {
        const computed = computeRowValue(isRow || row, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns);
        return computed !== 0 ? computed : null;
      } catch {
        return null;
      }
    }
    // D&A is now a manual input - no auto-population
    if (row.id === "sbc" && allStatements) {
      const total = getTotalSbcForYear(allStatements.incomeStatement, sbcBreakdowns || {}, year);
      return total > 0 ? total : null;
    }
    if (row.id === "wc_change") {
      // All historical years are manual input
      // Projection years are calculated from BS changes
      const isHistorical = year.endsWith("A");
      const isProjection = year.endsWith("E");
      
      if (isHistorical) {
        // Historical year - return stored input value
        const storedValue = row.values?.[year];
        return storedValue !== undefined && storedValue !== 0 ? storedValue : null;
      } else if (isProjection) {
        // Projection year - calculate from BS changes
        try {
          const computed = computeRowValue(row, year, allStatements.cashFlow, allStatements.cashFlow, allStatements, sbcBreakdowns);
          return computed;
        } catch {
          return null;
        }
      }
      // Default: treat as input
      const storedValue = row.values?.[year];
      return storedValue !== undefined && storedValue !== 0 ? storedValue : null;
    }
    return null;
  };

  const handleAddCustomItem = () => {
    if (!newItemLabel.trim()) return;
    
    // For investing/financing, allow add even when unrecognized (we'll infer sign from label)
    // Only block if there's a validation error that explicitly says not to add
    if (section.id !== "operating" && validationError && validationError.includes("may not be appropriate") && !termKnowledge) {
      return;
    }

    // Find insertion point (before the total row)
    const totalIndex = currentRows.findIndex(r => r.id === section.totalRowId);
    const insertIndex = totalIndex >= 0 ? totalIndex : currentRows.length;

    const newRow: Row = {
      id: uuid(),
      label: newItemLabel.trim(),
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    
    // Operating: set cfsLink from term knowledge or infer sign from label when unrecognized
    if (section.id === "operating") {
      if (termKnowledge?.cfsTreatment) {
        newRow.cfsLink = {
          section: "operating",
          cfsItemId: newRow.id,
          impact: termKnowledge.cfsTreatment.impact,
          description: termKnowledge.cfsTreatment.description,
        };
      } else {
        const impact = inferOperatingSignFromLabel(newItemLabel.trim());
        newRow.cfsLink = {
          section: "operating",
          cfsItemId: newRow.id,
          impact,
          description: "Custom operating item (sign inferred from label)",
        };
      }
    }
    
    // If term is recognized (investing/financing or other), store its knowledge
    if (termKnowledge) {
      // CFI item (for investing section)
      if (termKnowledge.cfiItem) {
        const cfiItem = termKnowledge.cfiItem as CFIItem;
        newRow.cfsLink = {
          section: "investing",
          cfsItemId: newRow.id,
          impact: cfiItem.impact,
          description: cfiItem.description,
        };
      }
      // CFF item (for financing section)
      else if ((termKnowledge as any).cffItem) {
        const cffItem = (termKnowledge as any).cffItem as CFFItem;
        newRow.cfsLink = {
          section: "financing",
          cfsItemId: newRow.id,
          impact: cffItem.impact,
          description: cffItem.description,
        };
      }
      // Financial terms knowledge (for other sections)
      else if (termKnowledge.cfsTreatment) {
        newRow.cfsLink = {
          section: termKnowledge.cfsTreatment.section,
          cfsItemId: termKnowledge.cfsTreatment.cfsItemId,
          impact: termKnowledge.cfsTreatment.impact,
          description: termKnowledge.cfsTreatment.description,
        };
      }
    }
    
    // Financing: if no cfsLink set yet, infer sign from label (like operating)
    if (section.id === "financing" && !newRow.cfsLink) {
      const impact = inferFinancingSignFromLabel(newItemLabel.trim());
      newRow.cfsLink = {
        section: "financing",
        cfsItemId: newRow.id,
        impact,
        description: "Custom financing item (sign inferred from label)",
      };
      if (termKnowledge.isLink) {
        newRow.isLink = {
          isItemId: termKnowledge.isLink.isItemId,
          description: termKnowledge.isLink.description,
        };
      }
    }

    insertRow("cashFlow", insertIndex, newRow);
    setNewItemLabel("");
    setShowAddDialog(false);
    setValidationError(null);
    setTermKnowledge(null);
  };

  const handleRemoveItem = (rowId: string) => {
    // Protect critical totals and calculated rows that are essential for the model
    const protectedRows = [
      "operating_cf",
      "investing_cf", 
      "financing_cf",
      "net_change_cash",
      "net_income", // Critical for CFO calculation
    ];
    
    // Don't allow removing protected rows
    if (protectedRows.includes(rowId) || rowId === section.totalRowId) {
      return;
    }
    
    // Allow removing any other item (standard items, user-added items, etc.)
    removeRow("cashFlow", rowId);
  };

  const colors = {
    blue: {
      border: "border-blue-800/40",
      bg: "bg-blue-950/20",
      text: "text-blue-200",
      textLight: "text-blue-300/80",
    },
    green: {
      border: "border-green-800/40",
      bg: "bg-green-950/20",
      text: "text-green-200",
      textLight: "text-green-300/80",
    },
    orange: {
      border: "border-orange-800/40",
      bg: "bg-orange-950/20",
      text: "text-orange-200",
      textLight: "text-orange-300/80",
    },
  }[section.colorClass];

  return (
    <CollapsibleSection
      sectionId={section.sectionId}
      title={section.label}
      description={section.description}
      colorClass={section.colorClass}
      defaultExpanded={true}
    >
      <div className="space-y-4">
        {/* Items List */}
        {sectionItems.length > 0 ? (
          sectionItems
            .filter(r => r.id !== section.totalRowId) // Don't show total in the list
            .map((row) => {
            const linkInfo = getLinkInfo(row);
            const isStandard = section.standardItems.includes(row.id);
            // D&A and WC Change are editable even if marked as "calc"
            // For D&A, always treat as input (not calculated)
            const isCalculated = row.id === "danda" ? false : (row.kind === "calc" && row.id !== "wc_change");
            const autoValue = linkInfo?.isAutoPopulated ? getAutoPopulatedValue(row, years[0] || "") : null;

            const globalIndex = currentRows.findIndex((r) => r.id === row.id);
            const isTotalRow = row.id === section.totalRowId;
            const displayableCount = sectionItems.filter((r) => r.id !== section.totalRowId).length;
            const canDrag = !isLocked && !isTotalRow && (
              sectionStartIndex !== -1 ||
              ((section.id === "investing" || section.id === "financing") && displayableCount >= 2)
            );
            const protectedRows = ["operating_cf", "investing_cf", "financing_cf", "net_change_cash", "net_income"];
            const isProtected = protectedRows.includes(row.id) || row.id === section.totalRowId;
            const isTopConfirmed = confirmedRowIds[row.id] === true;

            return row.id === "wc_change" && row.children && row.children.length > 0 ? (
              <div
                key={row.id}
                className={`rounded-lg border-2 ${colors.border} ${colors.bg} overflow-hidden ${dragOverId === "wc-container" ? "ring-2 ring-emerald-500" : ""}`}
                onDragOver={(e) => handleDragOver(e, "wc-container")}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, { type: "wc-container" })}
              >
                {/* WC category header */}
                <div className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 flex items-center gap-1">
                      {canDrag && (
                        <span
                          draggable
                          onDragStart={(e) => handleDragStart(e, { rowId: row.id, isWcChild: false, fromTopLevelIndex: globalIndex })}
                          className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 touch-none"
                          title="Drag to reorder"
                          aria-hidden
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><path d="M3 4h2v2H3V4zm4 0h2v2H7V4zm4 0h2v2h-2V4zM3 8h2v2H3V8zm4 0h2v2H7V8zm4 0h2v2h-2V8zM3 12h2v2H3v-2zm4 0h2v2H7v-2zm4 0h2v2h-2v-2z"/></svg>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setWcSectionExpanded((prev) => !prev)}
                        className="flex items-center justify-center w-5 h-5 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                        title={wcSectionExpanded ? "Collapse" : "Expand"}
                        aria-expanded={wcSectionExpanded}
                      >
                        <span className="text-xs">{wcSectionExpanded ? "▼" : "▶"}</span>
                      </button>
                      {getCFOSign(row) && (
                        <span className={`text-sm font-semibold ${getCFOSign(row) === "+" ? "text-green-400" : "text-red-400"}`}>
                          ({getCFOSign(row)})
                        </span>
                      )}
                      <span className={`text-sm font-medium ${colors.text}`}>{row.label}</span>
                      {linkInfo && (
                        <span className={`text-xs ${linkInfo.isAutoPopulated ? "text-emerald-400" : "text-slate-400"}`}>
                          {linkInfo.isAutoPopulated ? "✨ " : "🔗 "}{linkInfo.text}
                        </span>
                      )}
                    </div>
                  </div>
                  {years.length > 0 && (
                    <div className="mt-2 rounded-md border border-blue-700/40 bg-blue-950/20 p-2">
                      <div className="text-xs text-blue-300">📊 <strong>Working Capital Change</strong></div>
                      <div className="text-[10px] text-blue-400/80 mt-1">
                        Enter the change in each component below for historical years. Total is the sum of components. Projection years are calculated from the Balance Sheet.
                      </div>
                      <div className="text-[10px] text-blue-400/60 mt-1 italic">
                        Formula: Change in (Current Assets − Current Liabilities), excluding Cash & Short-Term Debt
                      </div>
                    </div>
                  )}
                </div>
                {/* Nested: WC components live INSIDE this category card */}
                {wcSectionExpanded && (
                  <div className="border-t border-slate-700/60 bg-slate-900/30 pl-4 pr-3 py-3 border-l-4 border-blue-600/60 rounded-br-lg">
                    <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-2">Components</div>
                    <div className="space-y-2">
                      {row.children.map((child, wcChildIndex) => {
                        const isConfirmed = confirmedRowIds[child.id] === true;
                        return (
                          <div
                            key={child.id}
                            className={`rounded-lg border ${colors.border} ${colors.bg} p-3 ${dragOverId === child.id ? "ring-2 ring-emerald-500" : ""}`}
                            onDragOver={(e) => handleDragOver(e, child.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, { type: "wc-child", rowId: child.id, wcChildIndex })}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1 min-w-0">
                                {canDrag && (
                                  <span
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, { rowId: child.id, isWcChild: true, fromWcChildIndex: wcChildIndex })}
                                    className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 touch-none shrink-0"
                                    title="Drag to reorder or drag out of Working Capital"
                                    aria-hidden
                                  >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><path d="M3 4h2v2H3V4zm4 0h2v2H7V4zm4 0h2v2h-2V4zM3 8h2v2H3V8zm4 0h2v2H7V8zm4 0h2v2h-2V8zM3 12h2v2H3v-2zm4 0h2v2H7v-2zm4 0h2v2h-2v-2z"/></svg>
                                  </span>
                                )}
                                <span className={`text-sm font-medium ${colors.text} truncate`}>{child.label}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => toggleConfirmed(child.id)}
                                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                                    isConfirmed ? "bg-slate-600 text-slate-300 hover:bg-slate-500" : "bg-emerald-600 text-white hover:bg-emerald-500"
                                  }`}
                                >
                                  {isConfirmed ? "Edit" : "Done"}
                                </button>
                                {!isLocked && (
                                  <button type="button" onClick={() => handleRemoveItem(child.id)} className="text-xs text-red-400 hover:text-red-300">
                                    Remove
                                  </button>
                                )}
                              </div>
                            </div>
                            {!isConfirmed && (
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                                {historicalYears.map((year: string) => {
                                  const storedValue = child.values?.[year] ?? 0;
                                  const displayValue = storedToDisplay(storedValue, meta?.currencyUnit);
                                  const unitLabel = getUnitLabel(meta?.currencyUnit);
                                  return (
                                    <div key={year} className="flex flex-col">
                                      <label className={`text-xs ${colors.textLight} mb-1`}>{year}</label>
                                      <input
                                        type="number"
                                        step="any"
                                        value={displayValue === 0 ? "" : String(displayValue)}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          if (val === "" || val === "-") { updateRowValue("cashFlow", child.id, year, 0); return; }
                                          const displayNum = Number(val);
                                          if (!isNaN(displayNum)) updateRowValue("cashFlow", child.id, year, displayToStored(displayNum, meta?.currencyUnit));
                                        }}
                                        onBlur={(e) => { if (e.target.value === "") updateRowValue("cashFlow", child.id, year, 0); }}
                                        placeholder="0"
                                        disabled={isLocked}
                                        className="w-full rounded border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                      />
                                      {unitLabel && <span className="text-xs text-slate-500 mt-0.5">{unitLabel}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                key={row.id}
                className={`rounded-lg border ${colors.border} ${colors.bg} p-3 ${dragOverId === row.id ? "ring-2 ring-emerald-500" : ""}`}
                onDragOver={(e) => handleDragOver(e, row.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, { type: "top-level", rowId: row.id, globalIndex })}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {canDrag && (
                        <span
                          draggable
                          onDragStart={(e) => handleDragStart(e, { rowId: row.id, isWcChild: false, fromTopLevelIndex: globalIndex })}
                          className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 touch-none shrink-0"
                          title="Drag to reorder"
                          aria-hidden
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><path d="M3 4h2v2H3V4zm4 0h2v2H7V4zm4 0h2v2h-2V4zM3 8h2v2H3V8zm4 0h2v2H7V8zm4 0h2v2h-2V8zM3 12h2v2H3v-2zm4 0h2v2H7v-2zm4 0h2v2h-2v-2z"/></svg>
                        </span>
                      )}
                      {getCFOSign(row) && (
                        <span className={`text-sm font-semibold ${getCFOSign(row) === "+" ? "text-green-400" : "text-red-400"}`}>
                          ({getCFOSign(row)})
                        </span>
                      )}
                      <span className={`text-sm font-medium ${colors.text}`}>
                        {row.label}
                      </span>
                      {!isTopConfirmed && isCalculated && (
                        <span className="text-xs text-slate-400 italic">(Calculated)</span>
                      )}
                      {!isTopConfirmed && linkInfo && (
                        <span className={`text-xs ${linkInfo.isAutoPopulated ? "text-emerald-400" : "text-slate-400"}`}>
                          {linkInfo.isAutoPopulated ? "✨ " : "🔗 "}{linkInfo.text}
                        </span>
                      )}
                      {!isTopConfirmed && autoValue !== null && autoValue !== undefined && (
                        <span className="text-xs text-emerald-300">
                          (Value: {storedToDisplay(autoValue, meta?.currencyUnit)} {getUnitLabel(meta?.currencyUnit)})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleConfirmed(row.id)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                        isTopConfirmed ? "bg-slate-600 text-slate-300 hover:bg-slate-500" : "bg-emerald-600 text-white hover:bg-emerald-500"
                      }`}
                    >
                      {isTopConfirmed ? "Edit" : "Done"}
                    </button>
                    {!isProtected && !isLocked && (
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(row.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {/* When confirmed, only show the header line; otherwise show full content */}
                {!isTopConfirmed && (
                <>
                {/* Show auto-populated value or input fields */}
                {/* For Net Income and SBC: show read-only auto-populated value */}
                {/* For D&A and WC Change: show auto-populated value as suggestion, but allow input */}
                {linkInfo?.isAutoPopulated && autoValue !== null && (row.id === "net_income" || row.id === "sbc") ? (
                  <div className="mt-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
                    <div className="text-xs text-emerald-300">
                      ✨ Auto-populated from linked statement
                      {years.length > 0 && (
                        <span className="ml-1">
                          · {years.map((y) => {
                            const v = getAutoPopulatedValue(row, y);
                            if (v === null) return null;
                            return (
                              <span key={y} className="mr-2">
                                {y}: {storedToDisplay(v, meta?.currencyUnit)}{getUnitLabel(meta?.currencyUnit) ? ` ${getUnitLabel(meta?.currencyUnit)}` : ""}
                              </span>
                            );
                          }).filter(Boolean)}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-emerald-400/70 mt-1">
                      {row.id === "net_income" 
                        ? "Values are pulled from the Income Statement (Net Income row). No manual input needed."
                        : row.id === "sbc"
                        ? "Values are calculated from all SBC breakdowns (SG&A and COGS). No manual input needed."
                        : "Values are pulled from the Income Statement or SBC breakdowns. No manual input needed."}
                    </div>
                  </div>
                ) : !isCalculated || row.id === "danda" || row.id === "wc_change" || row.kind === "input" ? (
                  <div>
                    
                    {/* Guidance for WC Change */}
                    {row.id === "wc_change" && years.length > 0 && (
                      <div className="mb-2 rounded-md border border-blue-700/40 bg-blue-950/20 p-2">
                        <div className="text-xs text-blue-300">
                          📊 <strong>Working Capital Change:</strong>
                        </div>
                        <div className="text-[10px] text-blue-400/80 mt-1">
                          {years.length === 1 
                            ? "Input required for the first historical year (no prior year to calculate change)."
                            : `Input required for ${years[0]}. For ${years.slice(1).join(", ")}, this will be automatically calculated from Balance Sheet changes: (Current Assets - Current Liabilities), excluding Cash and Short-Term Debt.`
                          }
                        </div>
                        <div className="text-[10px] text-blue-400/60 mt-1 italic">
                          Formula: Change in (Current Assets - Current Liabilities), excluding Cash & Short-Term Debt
                        </div>
                      </div>
                    )}
                    
                    {/* Input fields for historical years */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                    {years.map((year) => {
                      // Get stored value - simple for all fields
                      let storedValue = row.values?.[year] ?? 0;
                      
                      // For Net Income and SBC: use auto-populated value (read-only)
                      if (row.id === "net_income" || row.id === "sbc") {
                        const autoValue = getAutoPopulatedValue(row, year);
                        if (autoValue !== null) {
                          storedValue = autoValue;
                        }
                      }
                      
                      // D&A is now a simple manual input - no auto-population
                      
                      // For WC Change, all historical years are input, projection years are calculated
                      if (row.id === "wc_change") {
                        const isHistorical = year.endsWith("A");
                        const isProjection = year.endsWith("E");
                        
                        if (isHistorical) {
                          // Historical year - use stored input
                          storedValue = row.values?.[year] ?? 0;
                        } else if (isProjection) {
                          // Projection year - calculate from BS changes
                          try {
                            const computed = computeRowValue(row, year, allStatements.cashFlow, allStatements.cashFlow, allStatements, sbcBreakdowns);
                            storedValue = computed;
                          } catch {
                            // Fallback to stored value if computation fails
                            storedValue = row.values?.[year] ?? 0;
                          }
                        } else {
                          // Default: treat as input
                          storedValue = row.values?.[year] ?? 0;
                        }
                      }
                      
                      const displayValue = storedToDisplay(storedValue, meta?.currencyUnit);
                      const unitLabel = getUnitLabel(meta?.currencyUnit);
                      
                      // Determine if field is read-only
                      // WC Change: historical years are editable, projection years are calculated (read-only)
                      const isWcChangeProjection = row.id === "wc_change" && year.endsWith("E");
                      const isReadOnly = (row.id === "net_income" || row.id === "sbc") || isWcChangeProjection;
                      const isDanda = row.id === "danda";

                      return (
                        <div key={year} className="flex flex-col">
                          <label className={`text-xs ${colors.textLight} mb-1`}>
                            {year}
                            {isWcChangeProjection && <span className="text-[10px] text-slate-500 ml-1">(calculated)</span>}
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={displayValue === 0 ? "" : String(displayValue)}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || val === "-") {
                                updateRowValue("cashFlow", row.id, year, 0);
                                return;
                              }
                              const displayNum = Number(val);
                              if (!isNaN(displayNum)) {
                                const storedNum = displayToStored(displayNum, meta?.currencyUnit);
                                updateRowValue("cashFlow", row.id, year, storedNum);
                              }
                            }}
                            onBlur={(e) => {
                              if (e.target.value === "") {
                                updateRowValue("cashFlow", row.id, year, 0);
                              }
                            }}
                            placeholder="0"
                            disabled={row.id === "danda" ? false : (isLocked || isReadOnly)}
                            className={`w-full rounded border border-slate-700 bg-slate-900/50 px-2 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${isReadOnly && row.id !== "danda" ? "bg-slate-800/30" : ""}`}
                          />
                          {unitLabel && (
                            <span className="text-xs text-slate-500 mt-0.5">{unitLabel}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-400 italic">
                    Value calculated automatically from linked statements
                  </div>
                )}

                {/* Calculated value display */}
                {isCalculated && (
                  <div className="mt-2 text-xs text-slate-400 italic">
                    Value calculated automatically from linked statements
                  </div>
                )}
                </>
                )}
              </div>
            );
          })
        ) : null}

        {/* CFI Suggestions (only for Investing Activities) – grouped in one collapsible card */}
        {section.id === "investing" && (() => {
          const existingItemIds = sectionItems.map(r => r.id);
          const suggestedCFI = getSuggestedCFIItems(existingItemIds);
          const availableSuggestions = suggestedCFI.filter((item) => {
            const alreadyAdded = currentRows.some(r =>
              r.label.toLowerCase() === item.label.toLowerCase() ||
              item.commonNames.some(name => r.label.toLowerCase() === name.toLowerCase())
            );
            return !alreadyAdded;
          });
          return availableSuggestions.length > 0 ? (
            <div className="mt-4 rounded-lg border-2 border-green-700/40 bg-green-950/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setSuggestedCFIExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-green-900/30 transition-colors"
                aria-expanded={suggestedCFIExpanded}
              >
                <span className="text-sm font-medium text-green-200 flex items-center gap-2">
                  <span className="text-slate-400">{suggestedCFIExpanded ? "▼" : "▶"}</span>
                  💡 Suggested CFI Items
                  <span className="text-xs text-slate-400 font-normal">({availableSuggestions.length})</span>
                </span>
              </button>
              {suggestedCFIExpanded && (
                <div className="border-t border-green-700/40 px-3 py-2 space-y-2">
                  {availableSuggestions.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-green-700/30 bg-green-950/30 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-semibold shrink-0 ${item.impact === "positive" ? "text-green-400" : "text-red-400"}`}>
                              ({item.impact === "positive" ? "+" : "-"})
                            </span>
                            <span className="text-sm font-medium text-green-200">{item.label}</span>
                          </div>
                          <p className="text-xs text-green-300/70 mt-1">{item.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const totalIndex = currentRows.findIndex(r => r.id === section.totalRowId);
                            const insertIndex = totalIndex >= 0 ? totalIndex : currentRows.length;
                            const newRowId = uuid();
                            const newRow: Row = {
                              id: newRowId,
                              label: item.label,
                              kind: "input",
                              valueType: "currency",
                              values: {},
                              children: [],
                              cfsLink: {
                                section: "investing",
                                cfsItemId: newRowId,
                                impact: item.impact,
                                description: item.description,
                              },
                            };
                            insertRow("cashFlow", insertIndex, newRow);
                          }}
                          className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-600 transition shrink-0"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null;
        })()}

        {/* CFF Suggestions (only for Financing Activities) – grouped in one collapsible card */}
        {section.id === "financing" && (() => {
          const existingItemIds = sectionItems.map(r => r.id);
          const suggestedCFF = getSuggestedCFFItems(existingItemIds);
          const availableSuggestions = suggestedCFF.filter((item) => {
            const alreadyAdded = currentRows.some(r =>
              r.label.toLowerCase() === item.label.toLowerCase() ||
              item.commonNames.some(name => r.label.toLowerCase() === name.toLowerCase())
            );
            return !alreadyAdded;
          });
          return availableSuggestions.length > 0 ? (
            <div className="mt-4 rounded-lg border-2 border-orange-700/40 bg-orange-950/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setSuggestedCFFExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-orange-900/30 transition-colors"
                aria-expanded={suggestedCFFExpanded}
              >
                <span className="text-sm font-medium text-orange-200 flex items-center gap-2">
                  <span className="text-slate-400">{suggestedCFFExpanded ? "▼" : "▶"}</span>
                  💡 Suggested CFF Items
                  <span className="text-xs text-slate-400 font-normal">({availableSuggestions.length})</span>
                </span>
              </button>
              {suggestedCFFExpanded && (
                <div className="border-t border-orange-700/40 px-3 py-2 space-y-2">
                  {availableSuggestions.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-orange-700/30 bg-orange-950/30 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-semibold shrink-0 ${item.impact === "positive" ? "text-green-400" : "text-red-400"}`}>
                              ({item.impact === "positive" ? "+" : "-"})
                            </span>
                            <span className="text-sm font-medium text-orange-200">{item.label}</span>
                          </div>
                          <p className="text-xs text-orange-300/70 mt-1">{item.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const totalIndex = currentRows.findIndex(r => r.id === section.totalRowId);
                            const insertIndex = totalIndex >= 0 ? totalIndex : currentRows.length;
                            const newRowId = uuid();
                            const newRow: Row = {
                              id: newRowId,
                              label: item.label,
                              kind: "input",
                              valueType: "currency",
                              values: {},
                              children: [],
                              cfsLink: {
                                section: "financing",
                                cfsItemId: newRowId,
                                impact: item.impact,
                                description: item.description,
                              },
                            };
                            insertRow("cashFlow", insertIndex, newRow);
                          }}
                          className="rounded-md bg-orange-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 transition shrink-0"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null;
        })()}

        {/* Total Row Display */}
        {totalRow && (
          <div className={`rounded-lg border-2 ${colors.border} ${colors.bg} p-3 mt-4`}>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-bold ${colors.text}`}>
                {totalRow.label}
              </span>
              <span className="text-xs text-slate-400 italic">(Calculated)</span>
            </div>
          </div>
        )}

        {/* Add Custom Item */}
        {!isLocked && (
          <div className="mt-4">
            {!showAddDialog ? (
              <button
                type="button"
                onClick={() => setShowAddDialog(true)}
                className={`rounded-md border ${colors.border} ${colors.bg} px-4 py-2 text-xs font-semibold ${colors.text} hover:opacity-80 transition`}
              >
                + Add Custom {section.label} Item
              </button>
            ) : (
              <div className={`rounded-lg border ${colors.border} ${colors.bg} p-3`}>
                <input
                  type="text"
                  value={newItemLabel}
                  onChange={(e) => setNewItemLabel(e.target.value)}
                  placeholder="Enter item label..."
                  className="w-full rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none mb-2"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddCustomItem();
                    } else if (e.key === "Escape") {
                      setShowAddDialog(false);
                      setNewItemLabel("");
                    }
                  }}
                  autoFocus
                />
                {/* Validation: amber warning for operating/financing when unrecognized (still allow add); red error for investing when unrecognized */}
                {validationError && (
                  <div className={`mb-2 rounded-md border p-2 ${(section.id === "operating" || section.id === "financing") && !termKnowledge ? "border-amber-700/40 bg-amber-950/20" : "border-red-700/40 bg-red-950/20"}`}>
                    <div className={`text-xs ${(section.id === "operating" || section.id === "financing") && !termKnowledge ? "text-amber-300" : "text-red-300"}`}>
                      ⚠️ {validationError}
                      {section.id === "operating" && !termKnowledge && newItemLabel.trim() && (
                        <span className="block mt-1 font-medium">
                          Inferred sign: ({inferOperatingSignFromLabel(newItemLabel.trim()) === "negative" ? "−" : "+"}) — you can still add it.
                        </span>
                      )}
                      {section.id === "financing" && !termKnowledge && newItemLabel.trim() && (
                        <span className="block mt-1 font-medium">
                          Inferred sign: ({inferFinancingSignFromLabel(newItemLabel.trim()) === "negative" ? "−" : "+"}) — you can still add it.
                        </span>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Term Recognition Notice */}
                {termKnowledge && !validationError && (
                  <div className="mb-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
                    <div className="text-xs text-emerald-300">
                      ✅ {(termKnowledge as any).cfiItem 
                        ? `Recognized: ${(termKnowledge as any).cfiItem.label} - ${(termKnowledge as any).cfiItem.description}`
                        : (termKnowledge as any).cffItem
                        ? `Recognized: ${(termKnowledge as any).cffItem.label} - ${(termKnowledge as any).cffItem.description}`
                        : termKnowledge.cfsTreatment?.description || "Standard financial term"}
                    </div>
                  </div>
                )}
                
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddCustomItem}
                    disabled={!newItemLabel.trim() || (section.id !== "operating" && !!validationError && !termKnowledge)}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddDialog(false);
                      setNewItemLabel("");
                    }}
                    className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}

/**
 * Cash Flow Statement Builder Component
 */
export default function CashFlowBuilder() {
  const meta = useModelStore((s) => s.meta);
  const cashFlow = useModelStore((s) => s.cashFlow);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns);
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns || {});
  const danaLocation = useModelStore((s) => s.danaLocation);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const insertRow = useModelStore((s) => s.insertRow);
  const removeRow = useModelStore((s) => s.removeRow);
  
  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    return hist;
  }, [meta]);
  
  const allStatements = useMemo(() => ({
    incomeStatement,
    balanceSheet,
    cashFlow,
  }), [incomeStatement, balanceSheet, cashFlow]);
  
  // Analyze Balance Sheet items for CFO intelligence
  const cfoIntelligence = useMemo(() => {
    if (balanceSheet.length === 0 || years.length === 0) return [];
    return analyzeBSItemsForCFO(balanceSheet, years);
  }, [balanceSheet, years]);
  
  // Auto-add items that should be automatically added to CFO
  useEffect(() => {
    if (cfoIntelligence.length === 0) return;
    
    const operatingSection = CFS_SECTIONS.find(s => s.id === "operating");
    if (!operatingSection) return;
    
    // Find the index to insert before "other_operating" or "operating_cf"
    const otherOperatingIndex = cashFlow.findIndex(r => r.id === "other_operating");
    const operatingCfIndex = cashFlow.findIndex(r => r.id === "operating_cf");
    const insertIndex = otherOperatingIndex >= 0 ? otherOperatingIndex : 
                       operatingCfIndex >= 0 ? operatingCfIndex : 
                       cashFlow.length;
    
    // Auto-add items marked as "auto_add" that don't already exist
    cfoIntelligence.forEach(item => {
      if (item.treatment === "auto_add") {
        // Check if item already exists in CFS
        const exists = cashFlow.some(r => r.id === `cfo_${item.rowId}`);
        
        if (!exists) {
          const newRow: Row = {
            id: `cfo_${item.rowId}`, // Prefix to avoid conflicts
            label: `Change in ${item.label}`,
            kind: "calc", // Will be calculated from BS changes
            valueType: "currency",
            values: {},
            children: [],
            cfsLink: {
              section: "operating",
              cfsItemId: "other_operating",
              impact: item.impact,
              description: item.description,
            },
          };
          
          insertRow("cashFlow", insertIndex, newRow);
        }
      }
    });
  }, [cfoIntelligence, cashFlow, insertRow]);

  return (
    <CollapsibleSection
      sectionId="cash_flow_all"
      title="Cash Flow Statement Builder"
      description="Build your Cash Flow Statement with three main sections: Operating, Investing, and Financing activities. Many items link automatically to IS and BS."
      colorClass="purple"
      defaultExpanded={true}
    >
      <div className="space-y-6">
        {/* Operating Activities */}
        <CFSSectionComponent
          section={CFS_SECTIONS[0]}
          rows={cashFlow}
          years={years}
          meta={meta}
          updateRowValue={updateRowValue}
          insertRow={insertRow}
          removeRow={removeRow}
          incomeStatement={incomeStatement}
          sbcBreakdowns={sbcBreakdowns}
          allStatements={allStatements}
          cfoIntelligence={cfoIntelligence}
          balanceSheet={balanceSheet}
          danaBreakdowns={danaBreakdowns}
          danaLocation={danaLocation}
        />

        {/* Investing Activities */}
        <CFSSectionComponent
          section={CFS_SECTIONS[1]}
          rows={cashFlow}
          years={years}
          meta={meta}
          updateRowValue={updateRowValue}
          insertRow={insertRow}
          removeRow={removeRow}
          incomeStatement={incomeStatement}
          sbcBreakdowns={sbcBreakdowns}
          allStatements={allStatements}
          cfoIntelligence={[]}
          balanceSheet={balanceSheet}
          danaBreakdowns={danaBreakdowns}
          danaLocation={danaLocation}
        />

        {/* Financing Activities */}
        <CFSSectionComponent
          section={CFS_SECTIONS[2]}
          rows={cashFlow}
          years={years}
          meta={meta}
          updateRowValue={updateRowValue}
          insertRow={insertRow}
          removeRow={removeRow}
          incomeStatement={incomeStatement}
          sbcBreakdowns={sbcBreakdowns}
          allStatements={allStatements}
          cfoIntelligence={[]}
          balanceSheet={balanceSheet}
          danaBreakdowns={danaBreakdowns}
          danaLocation={danaLocation}
        />

        {/* Net Change in Cash */}
        {(() => {
          const netChangeCashRow = cashFlow.find(r => r.id === "net_change_cash");
          if (!netChangeCashRow) return null;
          
          return (
            <div className="rounded-lg border-2 border-purple-800/40 bg-purple-950/20 p-4 mt-6">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-bold text-purple-200">
                  Net Change in Cash
                </span>
                <span className="text-xs text-slate-400 italic">(Calculated: Operating + Investing + Financing)</span>
              </div>
              
              {/* Display calculated values for each year */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {years.map((year) => {
                  let computedValue: number;
                  try {
                    computedValue = computeRowValue(
                      netChangeCashRow,
                      year,
                      cashFlow,
                      cashFlow,
                      allStatements,
                      sbcBreakdowns,
                      danaBreakdowns
                    );
                  } catch {
                    computedValue = 0;
                  }
                  
                  const displayValue = storedToDisplay(computedValue, meta?.currencyUnit);
                  const unitLabel = getUnitLabel(meta?.currencyUnit);
                  
                  return (
                    <div key={year} className="flex flex-col">
                      <label className="text-xs text-purple-300/80 mb-1">
                        {year}
                      </label>
                      <div className="rounded-md border border-purple-700/40 bg-purple-950/40 px-2 py-1.5 text-sm font-semibold text-purple-200">
                        {computedValue !== 0 ? `${displayValue}${unitLabel ? ` ${unitLabel}` : ""}` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
    </CollapsibleSection>
  );
}
