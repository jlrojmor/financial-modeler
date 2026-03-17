"use client";

import { useMemo, useState, useEffect, useRef, Fragment } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row, EmbeddedDisclosureItem } from "@/types/finance";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
  formatIntegerWithSeparators,
} from "@/lib/currency-utils";
import CollapsibleSection from "@/components/collapsible-section";
import { findTermKnowledge } from "@/lib/financial-terms-knowledge";
import { analyzeBSItemsForCFO, type CFOItem } from "@/lib/cfo-intelligence";
import { getSuggestedCFIItems, validateCFIItem, findCFIItem, type CFIItem } from "@/lib/cfi-intelligence";
import { getSuggestedCFFItems, validateCFFItem, findCFFItem, type CFFItem } from "@/lib/cff-intelligence";
import { computeRowValue } from "@/lib/calculations";
import { resolveHistoricalCfoValue, resolveHistoricalCfoValueOnly, hasSbcDisclosureValueForYear } from "@/lib/cfo-source-resolution";
import {
  getFinalOperatingSubgroup,
  OPERATING_SUBGROUP_ORDER,
  OPERATING_SUBGROUP_LABELS,
  type OperatingSubgroupId,
} from "@/lib/cfs-operating-subgroups";
import { getFinalRowClassificationState } from "@/lib/final-row-classification";
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

type CFSSection = "operating" | "investing" | "financing" | "cash_bridge";

interface CFSSectionConfig {
  id: CFSSection;
  label: string;
  description: string;
  colorClass: "blue" | "green" | "orange" | "purple";
  sectionId: string;
  totalRowId: string; // For cash_bridge: net_change_cash (section ends before this row)
  standardItems: string[]; // IDs of standard items in this section
}

/** Display-only subgroup blocks for Operating (from shared single source of truth). */
const CFO_OPERATING_SUBGROUPS = [
  ...OPERATING_SUBGROUP_ORDER.map((id) => ({ id, label: OPERATING_SUBGROUP_LABELS[id] })),
  { id: "total" as const, label: OPERATING_SUBGROUP_LABELS.total },
];

/** Default historicalCfsNature when adding a custom operating row from a given subgroup. */
function getDefaultNatureForOperatingSubgroup(subgroup: "non_cash" | "working_capital" | "other_operating"): "reported_non_cash_adjustment" | "reported_working_capital_movement" | "reported_operating_other" {
  if (subgroup === "non_cash") return "reported_non_cash_adjustment";
  if (subgroup === "working_capital") return "reported_working_capital_movement";
  return "reported_operating_other";
}

/** True if AI-suggested nature would move the row out of the subgroup the user added from. */
function wouldMoveOutOfOperatingSubgroup(
  subgroup: "non_cash" | "working_capital" | "other_operating",
  aiNature: string
): boolean {
  if (subgroup === "working_capital") return aiNature === "reported_operating_other" || aiNature === "reported_non_cash_adjustment";
  if (subgroup === "non_cash") return aiNature === "reported_operating_other" || aiNature === "reported_working_capital_movement";
  return aiNature === "reported_working_capital_movement" || aiNature === "reported_non_cash_adjustment";
}

const CFS_SECTIONS: CFSSectionConfig[] = [
  {
    id: "operating",
    label: "Operating Activities",
    description: "Cash flows from operating activities. ✨ Net Income, D&A, and SBC auto-populate from Income Statement. 📊 Working Capital: historical years are entered by component; the total is calculated from those components. Projection years are calculated from Balance Sheet movements.",
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
    standardItems: ["capex", "acquisitions", "asset_sales", "investments", "other_investing"],
  },
  {
    id: "financing",
    label: "Financing Activities",
    description: "Cash flows from financing activities. Debt, equity, and dividend transactions.",
    colorClass: "orange",
    sectionId: "cfs_financing",
    totalRowId: "financing_cf",
    standardItems: ["debt_issued", "debt_repaid", "equity_issued", "share_repurchases", "dividends", "other_financing"],
  },
  {
    id: "cash_bridge",
    label: "Cash Bridge Items",
    description: "Items that affect net change in cash but are not CFO, CFI, or CFF (e.g. effect of exchange rate changes, restricted cash reconciliation).",
    colorClass: "purple",
    sectionId: "cfs_cash_bridge",
    totalRowId: "net_change_cash", // Section ends before this row
    standardItems: ["fx_effect_on_cash"],
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
  embeddedDisclosures,
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
  embeddedDisclosures?: EmbeddedDisclosureItem[];
}) {
  // Get current cashFlow from store to ensure we have the latest state
  // This ensures we always have the most up-to-date data after insertions
  const currentCashFlow = useModelStore((s) => s.cashFlow);
  const ensureWcChildrenFromBS = useModelStore((s) => s.ensureWcChildrenFromBS);
  const reorderCashFlowTopLevel = useModelStore((s) => s.reorderCashFlowTopLevel);
  const addWcChild = useModelStore((s) => s.addWcChild);
  const reorderWcChildren = useModelStore((s) => s.reorderWcChildren);
  const moveCashFlowRowIntoWc = useModelStore((s) => s.moveCashFlowRowIntoWc);
  const moveCashFlowRowOutOfWc = useModelStore((s) => s.moveCashFlowRowOutOfWc);
  const confirmedRowIds = useModelStore((s) => s.confirmedRowIds);
  const toggleConfirmedRow = useModelStore((s) => s.toggleConfirmedRow);
  const confirmRowReview = useModelStore((s) => s.confirmRowReview);
  const renameRow = useModelStore((s) => s.renameRow);
  const sbcDisclosureEnabled = useModelStore((s) => s.sbcDisclosureEnabled ?? true);
  const companyContext = useModelStore((s) => s.companyContext);
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
  const [addingWithAI, setAddingWithAI] = useState(false);
  const [editingLabelRowId, setEditingLabelRowId] = useState<string | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState("");

  const toggleConfirmed = (rowId: string) => {
    toggleConfirmedRow(rowId);
  };

  const handleEditRow = (rowId: string) => {
    const row = currentRows.find((r) => r.id === rowId) ?? currentRows.find((r) => r.id === "wc_change")?.children?.find((c) => c.id === rowId);
    if (row) {
      setEditingLabelRowId(rowId);
      setEditingLabelValue(row.label);
    }
  };

  const handleSaveEditRowLabel = () => {
    if (editingLabelRowId && editingLabelValue.trim()) {
      renameRow("cashFlow", editingLabelRowId, editingLabelValue.trim());
      setEditingLabelRowId(null);
      setEditingLabelValue("");
    }
  };

  const sectionStartIndex = currentRows.findIndex((r) => {
    if (section.id === "operating") return r.id === "net_income";
    if (section.id === "investing") return r.id === "capex";
    if (section.id === "financing") return ["debt_issued", "debt_issuance", "debt_repaid", "equity_issued", "equity_issuance", "share_repurchases", "dividends", "other_financing"].includes(r.id);
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
    target: { type: "top-level"; rowId: string; globalIndex: number; targetSubgroup?: "non_cash" | "other_operating" } | { type: "wc-container" } | { type: "wc-child"; rowId: string; wcChildIndex: number }
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
        moveCashFlowRowOutOfWc(rowId, toIndex, target.targetSubgroup);
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
      if (section.id === "financing") return ["debt_issued", "debt_issuance", "debt_repaid", "equity_issued", "equity_issuance", "share_repurchases", "dividends", "other_financing"].includes(r.id);
      if (section.id === "cash_bridge") return r.id === "fx_effect_on_cash";
      return false;
    });

    const sectionEndIndex = currentRows.findIndex((r, idx) => {
      if (idx <= sectionStartIndex) return false;
      if (section.id === "operating") return r.id === "operating_cf";
      if (section.id === "investing") return r.id === "investing_cf";
      if (section.id === "financing") return r.id === "financing_cf";
      if (section.id === "cash_bridge") return r.id === "net_change_cash"; // Section ends before net_change_cash (we exclude it)
      return false;
    });

    // For investing and financing sections, include all items from start marker up to and including the total row
    // This ensures newly added items (inserted before the total) are included
    let result: Row[] = [];
    
    if (sectionStartIndex !== -1) {
      // Standard case: start marker exists, get items from start to end
      // cash_bridge: end before net_change_cash (exclude it); other sections include total row
      const endExclusive = section.id === "cash_bridge" && sectionEndIndex >= 0 ? sectionEndIndex : sectionEndIndex + 1;
      result = sectionEndIndex === -1
        ? currentRows.slice(sectionStartIndex)
        : currentRows.slice(sectionStartIndex, endExclusive);
    }

    // For all sections, also include any items with matching cfsLink.section
    if (section.id === "operating" || section.id === "investing" || section.id === "financing" || section.id === "cash_bridge") {
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
          // Include total row only for operating/investing/financing (not for cash_bridge)
          if (section.id !== "cash_bridge") {
            const totalRow = currentRows.find(r => r.id === section.totalRowId);
            if (totalRow) result.push(totalRow);
          }
        }
      }
      
      // CRITICAL: For operating section, include custom items that might be between operating_cf and capex,
      // or anywhere in currentRows with cfsLink.section === "operating", so they always render in the builder.
      if (section.id === "operating") {
        const operatingCfIndex = currentRows.findIndex(r => r.id === "operating_cf");
        const capexIndex = currentRows.findIndex(r => r.id === "capex");
        if (operatingCfIndex >= 0 && capexIndex > operatingCfIndex) {
          const itemsBetween = currentRows.slice(operatingCfIndex + 1, capexIndex);
          const missingCustomItems = itemsBetween.filter(r => 
            !result.some(existing => existing.id === r.id) &&
            r.id !== section.totalRowId &&
            (r.cfsLink?.section === "operating" || !r.cfsLink)
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
        // Fallback: ensure any row with cfsLink.section === "operating" not yet in result is included (e.g. custom rows)
        const operatingByLink = currentRows.filter(r => r.cfsLink?.section === "operating" && !result.some(existing => existing.id === r.id) && r.id !== section.totalRowId);
        if (operatingByLink.length > 0) {
          const totalIndexInResult = result.findIndex(r => r.id === section.totalRowId);
          const sorted = [...operatingByLink].sort((a, b) => currentRows.findIndex(r => r.id === a.id) - currentRows.findIndex(r => r.id === b.id));
          if (totalIndexInResult >= 0) {
            result = [...result.slice(0, totalIndexInResult), ...sorted, ...result.slice(totalIndexInResult)];
          } else {
            result = [...result, ...sorted];
          }
        }
      }
      
      // Investing: include any row between capex and investing_cf not yet in result (e.g. custom rows)
      if (section.id === "investing") {
        const capexIndex = currentRows.findIndex(r => r.id === "capex");
        const investingCfIndex = currentRows.findIndex(r => r.id === "investing_cf");
        if (capexIndex >= 0 && investingCfIndex > capexIndex) {
          const between = currentRows.slice(capexIndex, investingCfIndex + 1).filter(r =>
            !result.some(existing => existing.id === r.id) && r.id !== section.totalRowId
          );
          if (between.length > 0) {
            const totalIndexInResult = result.findIndex(r => r.id === section.totalRowId);
            const sorted = [...between].sort((a, b) => currentRows.findIndex(r => r.id === a.id) - currentRows.findIndex(r => r.id === b.id));
            if (totalIndexInResult >= 0) {
              result = [...result.slice(0, totalIndexInResult), ...sorted, ...result.slice(totalIndexInResult)];
            } else {
              result = [...result, ...sorted];
            }
          }
        }
      }
      
      // Cash bridge: include any row between fx_effect_on_cash and net_change_cash not yet in result
      if (section.id === "cash_bridge") {
        const fxIndex = currentRows.findIndex(r => r.id === "fx_effect_on_cash");
        const netChangeIndex = currentRows.findIndex(r => r.id === "net_change_cash");
        if (fxIndex >= 0 && netChangeIndex > fxIndex) {
          const between = currentRows.slice(fxIndex, netChangeIndex).filter(r =>
            !result.some(existing => existing.id === r.id) && r.id !== section.totalRowId
          );
          if (between.length > 0) {
            result = [...result, ...between].sort((a, b) => currentRows.findIndex(r => r.id === a.id) - currentRows.findIndex(r => r.id === b.id));
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
          
          const totalRow = currentRows.find(r => r.id === section.totalRowId);
          if (totalRow && !result.some(r => r.id === section.totalRowId)) {
            result.push(totalRow);
          }
        }
      }
    }

    // Operating: WC-classified rows are structural children of wc_change; do not show as top-level
    if (section.id === "operating") {
      result = result.filter((r) => r.historicalCfsNature !== "reported_working_capital_movement");
    }

    return result;
  }, [currentRows, section.id]);

  const historicalYears = meta?.years?.historical ?? years.filter((y) => y.endsWith("A"));
  const totalRow = sectionItems.find(r => r.id === section.totalRowId);
  const isLocked = useModelStore((s) => s.sectionLocks[section.sectionId] ?? false);

  /** For Operating only: display blocks. WC subgroup uses canonical structure (wc_change + wc_change.children only). */
  const operatingDisplayBlocks = useMemo(() => {
    if (section.id !== "operating") return [];
    const nonTotal = sectionItems.filter((r) => r.id !== section.totalRowId);
    const wcChangeRow = currentRows.find((r) => r.id === "wc_change");
    const blocks: ({ type: "header"; label: string; subgroupId?: OperatingSubgroupId } | { type: "row"; row: Row })[] = [];
    for (const sg of CFO_OPERATING_SUBGROUPS) {
      if (sg.id === "total") continue;
      // Working Capital: only wc_change row (components come from wc_change.children in render)
      const rowsInGroup =
        sg.id === "working_capital"
          ? wcChangeRow
            ? [wcChangeRow]
            : []
          : sg.id === "other_operating"
            ? nonTotal.filter((r) => getFinalOperatingSubgroup(r) === sg.id && r.id !== "other_operating")
            : nonTotal.filter((r) => getFinalOperatingSubgroup(r) === sg.id);
      const showBlock = rowsInGroup.length > 0 || sg.id === "other_operating";
      if (showBlock) {
        blocks.push({ type: "header", label: sg.label, subgroupId: sg.id });
        rowsInGroup.forEach((row) => blocks.push({ type: "row", row }));
      }
    }
    return blocks;
  }, [section.id, section.totalRowId, sectionItems, currentRows]);

  /** When adding a custom operating row from a subgroup, this is set so we default historicalCfsNature and apply conservative AI override. */
  const [addingFromOperatingSubgroup, setAddingFromOperatingSubgroup] = useState<OperatingSubgroupId | null>(null);
  /** Ref captures add-intent when opening from subgroup "+ Add item" so we always insert into correct target (e.g. wc_change.children) even if state updates async. */
  const addIntentSubgroupRef = useRef<OperatingSubgroupId | null>(null);

  /** Resolve source badge label for key CFO rows (display only). Uses first year if available. */
  const getSourceBadgeLabel = (rowId: string): string | null => {
    if (section.id !== "operating" || !allStatements) return null;
    const year = years[0];
    if (!year) return null;
    if (!["net_income", "danda", "sbc", "wc_change"].includes(rowId)) return null;
    try {
      const result = resolveHistoricalCfoValue(rowId, year, {
        cashFlowRows: allStatements.cashFlow,
        incomeStatement: allStatements.incomeStatement,
        balanceSheet: allStatements.balanceSheet,
        embeddedDisclosures: embeddedDisclosures ?? [],
        sbcDisclosureEnabled,
        danaBreakdowns: danaBreakdowns ?? {},
      });
      if (result.sourceType === "income_statement") return "Source: Income Statement";
      if (result.sourceType === "reported") return "Source: Reported CFS";
      if (result.sourceType === "embedded_disclosure") return "Source: Disclosure";
      if (result.sourceType === "derived") return "Source: Derived";
      if (result.sourceType === "manual" && rowId === "wc_change") return "Source: Reported CFS";
      if (result.sourceType === "manual") return null;
      return `Source: ${result.sourceDetail}`;
    } catch {
      return null;
    }
  };

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
      // Standard CFF items (anchor rows)
      if (row.id === "debt_issued" || row.id === "debt_issuance" || row.id === "equity_issued" || row.id === "equity_issuance") {
        return "+"; // Issuances are cash inflows
      }
      if (row.id === "debt_repaid" || row.id === "debt_repayment" || row.id === "share_repurchases" || row.id === "dividends") {
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
    if (row.id === "sbc") return { text: "✨ Reported CFS or embedded disclosure total", isAutoPopulated: true };
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
        const computed = computeRowValue(isRow || row, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled);
        return computed !== 0 ? computed : null;
      } catch {
        return null;
      }
    }
    // SBC: CFO source hierarchy (reported CFS → embedded disclosure total → 0); no sbcBreakdowns in CFS path
    if (row.id === "sbc" && allStatements) {
      const value = resolveHistoricalCfoValueOnly("sbc", year, {
        cashFlowRows: allStatements.cashFlow,
        incomeStatement: allStatements.incomeStatement,
        balanceSheet: allStatements.balanceSheet,
        embeddedDisclosures: embeddedDisclosures ?? [],
        sbcDisclosureEnabled,
      });
      return value !== 0 ? value : null;
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
          const computed = computeRowValue(row, year, allStatements.cashFlow, allStatements.cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled);
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

  const handleAddCustomItem = async () => {
    if (!newItemLabel.trim()) return;

    if (section.id !== "operating" && section.id !== "cash_bridge" && validationError && validationError.includes("may not be appropriate") && !termKnowledge) {
      return;
    }

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

    // Base cfsLink from term knowledge or inferred sign
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
    if (termKnowledge) {
      if (termKnowledge.cfiItem) {
        const cfiItem = termKnowledge.cfiItem as CFIItem;
        newRow.cfsLink = {
          section: "investing",
          cfsItemId: newRow.id,
          impact: cfiItem.impact,
          description: cfiItem.description,
        };
      } else if ((termKnowledge as any).cffItem) {
        const cffItem = (termKnowledge as any).cffItem as CFFItem;
        newRow.cfsLink = {
          section: "financing",
          cfsItemId: newRow.id,
          impact: cffItem.impact,
          description: cffItem.description,
        };
      } else if (termKnowledge.cfsTreatment) {
        newRow.cfsLink = {
          section: termKnowledge.cfsTreatment.section,
          cfsItemId: termKnowledge.cfsTreatment.cfsItemId,
          impact: termKnowledge.cfsTreatment.impact,
          description: termKnowledge.cfsTreatment.description,
        };
      }
    }
    if (section.id === "investing" && !newRow.cfsLink) {
      newRow.cfsLink = {
        section: "investing",
        cfsItemId: newRow.id,
        impact: "negative",
        description: "Custom investing item",
      };
    }
    if (section.id === "financing" && !newRow.cfsLink) {
      const impact = inferFinancingSignFromLabel(newItemLabel.trim());
      newRow.cfsLink = {
        section: "financing",
        cfsItemId: newRow.id,
        impact,
        description: "Custom financing item (sign inferred from label)",
      };
      if (termKnowledge?.isLink) {
        newRow.isLink = {
          isItemId: termKnowledge.isLink.isItemId,
          description: termKnowledge.isLink.description,
        };
      }
    }
    if (section.id === "cash_bridge" && !newRow.cfsLink) {
      newRow.cfsLink = {
        section: "cash_bridge",
        cfsItemId: newRow.id,
        impact: "neutral",
        description: "Cash bridge item (affects net change in cash, not CFO/CFI/CFF)",
      };
      newRow.historicalCfsNature = "reported_meta";
      newRow.cfsForecastDriver = "manual_other";
    }

    // Operating: deterministic default from subgroup so rows land in the right place even before AI (earnings_base and total have no nature)
    const subgroupWithNature: "non_cash" | "working_capital" | "other_operating" | null =
      addingFromOperatingSubgroup === "non_cash" || addingFromOperatingSubgroup === "working_capital" || addingFromOperatingSubgroup === "other_operating"
        ? addingFromOperatingSubgroup
        : null;
    if (section.id === "operating" && subgroupWithNature) {
      newRow.historicalCfsNature = getDefaultNatureForOperatingSubgroup(subgroupWithNature);
    }

    const OVERRIDE_SUBGROUP_THRESHOLD = 0.9; // Do not let AI move row out of subgroup unless confidence >= this

    // AI classification for custom CFS row (forecast driver, section, sign, reason, confidence)
    setAddingWithAI(true);
    try {
      const res = await fetch("/api/ai/cfs-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newItemLabel.trim(),
          sectionContext: section.id,
          ...(section.id === "operating" && subgroupWithNature ? { operatingSubgroup: subgroupWithNature } : {}),
          companyContext: companyContext ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const suggestion = data?.suggestion;
      if (suggestion && typeof suggestion.section === "string" && typeof suggestion.forecastDriver === "string") {
        const confidence = typeof suggestion.confidence === "number" ? Math.max(0, Math.min(1, suggestion.confidence)) : 0.5;
        const sectionConflict = suggestion.section !== section.id;
        const useAiSection = !sectionConflict || confidence >= 0.9;
        const effectiveSection = useAiSection ? suggestion.section : section.id;

        newRow.cfsForecastDriver = suggestion.forecastDriver;
        let effectiveNature = suggestion.historicalCfsNature ?? (section.id === "cash_bridge" ? "reported_meta" : section.id === "operating" ? "reported_operating_other" : section.id === "investing" ? "reported_investing" : "reported_financing");
        // Conservative override: do not let AI move operating row out of the subgroup it was added from unless confidence is very high
        if (section.id === "operating" && subgroupWithNature) {
          const subgroupDefault = getDefaultNatureForOperatingSubgroup(subgroupWithNature);
          if (wouldMoveOutOfOperatingSubgroup(subgroupWithNature, effectiveNature) && confidence < OVERRIDE_SUBGROUP_THRESHOLD) {
            effectiveNature = subgroupDefault;
          }
        }
        newRow.historicalCfsNature = effectiveNature;
        newRow.classificationSource = "ai";
        newRow.classificationReason = suggestion.reason ?? "";
        newRow.classificationConfidence = confidence;
        newRow.cfsLink = {
          section: effectiveSection,
          cfsItemId: newRow.id,
          impact: suggestion.sign === "positive" ? "positive" : "negative",
          description: suggestion.reason || newRow.cfsLink?.description || "Custom CFS item",
          forecastDriver: suggestion.forecastDriver,
        };
        if (confidence >= 0.75 && (useAiSection || !sectionConflict)) {
          newRow.forecastMetadataStatus = "trusted";
        } else {
          newRow.forecastMetadataStatus = "needs_review";
        }
      } else {
        newRow.classificationSource = "fallback";
        newRow.forecastMetadataStatus = "needs_review";
        newRow.historicalCfsNature = section.id === "cash_bridge" ? "reported_meta" : section.id === "operating"
          ? (subgroupWithNature ? getDefaultNatureForOperatingSubgroup(subgroupWithNature) : "reported_operating_other")
          : section.id === "investing" ? "reported_investing" : "reported_financing";
      }
    } catch {
      newRow.classificationSource = "fallback";
      newRow.forecastMetadataStatus = "needs_review";
      newRow.historicalCfsNature = section.id === "cash_bridge" ? "reported_meta" : section.id === "operating"
        ? (subgroupWithNature ? getDefaultNatureForOperatingSubgroup(subgroupWithNature) : "reported_operating_other")
        : section.id === "investing" ? "reported_investing" : "reported_financing";
    } finally {
      setAddingWithAI(false);
    }

    // WC-classified rows must be structural children of wc_change; use ref so intent is reliable (e.g. opened from "+ Add item" next to Working Capital)
    const wcIntent = addIntentSubgroupRef.current === "working_capital" || addingFromOperatingSubgroup === "working_capital";
    if (section.id === "operating" && wcIntent) {
      newRow.historicalCfsNature = "reported_working_capital_movement";
      addWcChild(newRow);
    } else {
      insertRow("cashFlow", insertIndex, newRow);
    }
    addIntentSubgroupRef.current = null;
    setNewItemLabel("");
    setShowAddDialog(false);
    setValidationError(null);
    setTermKnowledge(null);
    setAddingFromOperatingSubgroup(null);
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
    purple: {
      border: "border-purple-800/40",
      bg: "bg-purple-950/20",
      text: "text-purple-200",
      textLight: "text-purple-300/80",
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
        {/* Items List: Operating = grouped with subgroup headers; Investing/Financing = flat */}
        {sectionItems.length > 0 ? (
          (section.id === "operating" ? operatingDisplayBlocks : sectionItems.filter((r) => r.id !== section.totalRowId).map((row) => ({ type: "row" as const, row }))).map((block) => {
            if (block.type === "header") {
              const subgroupId = "subgroupId" in block ? block.subgroupId : undefined;
              const showAddInSubgroup = section.id === "operating" && subgroupId && subgroupId !== "earnings_base" && !isLocked;
              const isOtherOperatingHeader = section.id === "operating" && subgroupId === "other_operating";
              const otherOperatingInsertIndex = isOtherOperatingHeader ? (currentRows.findIndex((r) => r.id === "operating_cf") >= 0 ? currentRows.findIndex((r) => r.id === "operating_cf") : currentRows.length) : 0;
              return (
                <div
                  key={`cfo-h-${block.label}`}
                  className={`pt-2 first:pt-0 ${isOtherOperatingHeader ? `rounded border border-dashed p-2 -m-0.5 ${dragOverId === "header-other_operating" ? "ring-2 ring-emerald-500 border-slate-500" : "border-slate-600/50"}` : ""}`}
                  {...(isOtherOperatingHeader ? {
                    onDragOver: (e: React.DragEvent) => handleDragOver(e, `header-other_operating`),
                    onDragLeave: handleDragLeave,
                    onDrop: (e: React.DragEvent) => handleDrop(e, { type: "top-level", rowId: "operating_cf", globalIndex: otherOperatingInsertIndex, targetSubgroup: "other_operating" }),
                  } : {})}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-700/60 pb-1.5 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{block.label}</span>
                    {showAddInSubgroup && (
                      <button
                        type="button"
                        onClick={() => {
                          addIntentSubgroupRef.current = subgroupId;
                          setAddingFromOperatingSubgroup(subgroupId);
                          setShowAddDialog(true);
                        }}
                        className="text-[10px] font-medium text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        + Add item
                      </button>
                    )}
                  </div>
                </div>
              );
            }
            const row = block.row;
            const linkInfo = getLinkInfo(row);
            const sourceBadge = section.id === "operating" ? getSourceBadgeLabel(row.id) : null;
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
            const protectedRows = ["operating_cf", "investing_cf", "financing_cf", "net_change_cash", "net_income", "fx_effect_on_cash"];
            const isProtected = protectedRows.includes(row.id) || row.id === section.totalRowId;
            const isTopConfirmed = confirmedRowIds[row.id] === true;

            return row.id === "wc_change" ? (
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
                      {sourceBadge && (
                        <span className="text-[10px] text-slate-500 ml-1" title="Resolved source for this row">
                          — {sourceBadge}
                        </span>
                      )}
                    </div>
                  </div>
                  {years.length > 0 && (
                    <div className="mt-2 rounded-md border border-blue-700/40 bg-blue-950/20 p-2 space-y-2">
                      <div className="text-[10px] text-blue-400/80">
                        Historical years are entered by component below; the total Change in Working Capital is calculated from those components. Projection years are calculated automatically from Balance Sheet movements.
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {years.map((year) => {
                          let subtotal = 0;
                          if (allStatements) {
                            try {
                              subtotal = computeRowValue(row, year, allStatements.cashFlow, allStatements.cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled);
                            } catch {
                              subtotal = 0;
                            }
                          }
                          const displayVal = storedToDisplay(subtotal, meta?.currencyUnit);
                          const unitLabel = getUnitLabel(meta?.currencyUnit);
                          return (
                            <div key={year} className="flex flex-col">
                              <span className="text-[10px] text-slate-500">{year}</span>
                              <div className="rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1 text-sm text-slate-300">
                                {displayVal === 0 ? "—" : displayVal}
                                {unitLabel && <span className="text-slate-500 ml-1">{unitLabel}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                {/* Nested: WC components live INSIDE this category card */}
                {wcSectionExpanded && (
                  <div className="border-t border-slate-700/60 bg-slate-900/30 pl-4 pr-3 py-3 border-l-4 border-blue-600/60 rounded-br-lg">
                    <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-2">Components</div>
                    {(!row.children || row.children.length === 0) ? (
                      <p className="text-xs text-slate-500 italic">No components yet. Use &quot;+ Add item&quot; above under Working Capital Adjustments to add e.g. Accounts receivable, Accounts payable.</p>
                    ) : (
                    <div className="space-y-2">
                      {row.children.map((child, wcChildIndex) => {
                        const isConfirmed = confirmedRowIds[child.id] === true;
                        return (
                          <div
                            key={`${child.id}-${wcChildIndex}`}
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
                                <div className="min-w-0">
                                  {editingLabelRowId === child.id ? (
                                    <span className="inline-flex items-center gap-1 flex-wrap">
                                      <input
                                        type="text"
                                        value={editingLabelValue}
                                        onChange={(e) => setEditingLabelValue(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveEditRowLabel(); if (e.key === "Escape") { setEditingLabelRowId(null); setEditingLabelValue(""); } }}
                                        className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-sm text-slate-200 min-w-[120px]"
                                        autoFocus
                                      />
                                      <button type="button" onClick={handleSaveEditRowLabel} className="text-xs text-emerald-400 hover:text-emerald-300">Save</button>
                                      <button type="button" onClick={() => { setEditingLabelRowId(null); setEditingLabelValue(""); }} className="text-xs text-slate-400 hover:text-slate-300">Cancel</button>
                                    </span>
                                  ) : (
                                    <span className={`text-sm font-medium ${colors.text} truncate`}>{child.label}</span>
                                  )}
                                  {child.id === "other_wc_reclass" && editingLabelRowId !== child.id && (
                                    <div className="text-[10px] text-slate-500 italic mt-0.5">Optional manual reclass. Leave blank unless the company reports a specific working-capital reclassification item.</div>
                                  )}
                                  {(() => {
                                    const final = getFinalRowClassificationState(child, "cashFlow", { parentId: "wc_change", sectionId: "operating", subgroupId: "working_capital" });
                                    if (final.reviewState === "setup_required") {
                                      return <span className="text-[10px] text-amber-500/90 ml-1">— Setup required</span>;
                                    }
                                    if (final.reviewState === "needs_confirmation") {
                                      return (
                                        <span className="inline-flex flex-wrap items-center gap-1.5 ml-1">
                                          {final.suggestedLabel && (
                                            <span className="text-[10px] text-amber-400/90" title={final.reason}>— Suggested: {final.suggestedLabel}</span>
                                          )}
                                          {!final.suggestedLabel && <span className="text-[10px] text-amber-400/90">— Suggested classification</span>}
                                          <button
                                            type="button"
                                            onClick={() => confirmRowReview("cashFlow", child.id)}
                                            className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-600/80 text-white hover:bg-amber-500/90 transition-colors"
                                          >
                                            Confirm
                                          </button>
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => toggleConfirmed(child.id)}
                                  className="text-xs text-blue-400 hover:text-blue-300"
                                >
                                  {isConfirmed ? "Edit values" : "Collapse"}
                                </button>
                                {!section.standardItems.includes(child.id) && (
                                  <button type="button" onClick={() => handleEditRow(child.id)} className="text-xs text-slate-400 hover:text-slate-300">
                                    Edit row
                                  </button>
                                )}
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
                  )}
                  </div>
                )}
              </div>
            ) : (
              <div
                key={row.id}
                className={`rounded-lg border ${colors.border} ${colors.bg} p-3 ${dragOverId === row.id ? "ring-2 ring-emerald-500" : ""}`}
                onDragOver={(e) => handleDragOver(e, row.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, {
                  type: "top-level",
                  rowId: row.id,
                  globalIndex,
                  ...(section.id === "operating" ? { targetSubgroup: getFinalOperatingSubgroup(row) === "other_operating" ? "other_operating" : "non_cash" } : {}),
                })}
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
                      {editingLabelRowId === row.id ? (
                        <span className="inline-flex items-center gap-1 flex-wrap">
                          <input
                            type="text"
                            value={editingLabelValue}
                            onChange={(e) => setEditingLabelValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleSaveEditRowLabel(); if (e.key === "Escape") { setEditingLabelRowId(null); setEditingLabelValue(""); } }}
                            className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-sm text-slate-200 min-w-[120px]"
                            autoFocus
                          />
                          <button type="button" onClick={handleSaveEditRowLabel} className="text-xs text-emerald-400 hover:text-emerald-300">Save</button>
                          <button type="button" onClick={() => { setEditingLabelRowId(null); setEditingLabelValue(""); }} className="text-xs text-slate-400 hover:text-slate-300">Cancel</button>
                        </span>
                      ) : (
                        <span className={`text-sm font-medium ${colors.text}`}>
                          {row.label}
                        </span>
                      )}
                      {!isTopConfirmed && isCalculated && (row.id === "net_income" || row.id === "sbc") && (
                        <span className="text-xs text-slate-400 italic">(Calculated)</span>
                      )}
                      {!isTopConfirmed && linkInfo && !sourceBadge && (
                        <span className={`text-xs ${linkInfo.isAutoPopulated ? "text-emerald-400" : "text-slate-400"}`}>
                          {linkInfo.isAutoPopulated ? "✨ " : "🔗 "}{linkInfo.text}
                        </span>
                      )}
                      {sourceBadge && (
                        <span className="text-[10px] text-slate-500 ml-1" title="Resolved source for this row">
                          — {sourceBadge}
                        </span>
                      )}
                      {/* Single canonical review state from getFinalRowClassificationState */}
                      {!isStandard && !isTotalRow && (() => {
                        const context = section.id ? { sectionId: section.id, subgroupId: row.id === "wc_change" ? "working_capital" : undefined } : undefined;
                        const final = getFinalRowClassificationState(row, "cashFlow", context);
                        if (final.reviewState === "setup_required") {
                          return <span className="text-[10px] text-amber-500/90 ml-1" title={final.reason}>— Setup required</span>;
                        }
                        if (final.reviewState === "needs_confirmation") {
                          return (
                            <span className="inline-flex flex-wrap items-center gap-1.5 ml-1">
                              {final.suggestedLabel ? (
                                <span className="text-[10px] text-amber-400/90" title={final.reason}>— Suggested: {final.suggestedLabel}</span>
                              ) : (
                                <span className="text-[10px] text-amber-400/90" title={final.reason}>— Suggested classification</span>
                              )}
                              <button
                                type="button"
                                onClick={() => confirmRowReview("cashFlow", row.id)}
                                className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-600/80 text-white hover:bg-amber-500/90 transition-colors"
                              >
                                Confirm
                              </button>
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleConfirmed(row.id)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      {isTopConfirmed ? "Edit values" : "Collapse"}
                    </button>
                    {!isStandard && !isTotalRow && (
                      <button type="button" onClick={() => handleEditRow(row.id)} className="text-xs text-slate-400 hover:text-slate-300">
                        Edit row
                      </button>
                    )}
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
                {/* Show input grid for all operating rows; Net Income/SBC are read-only and use source label only */}
                {!isCalculated || row.id === "danda" || row.id === "wc_change" || row.kind === "input" || row.id === "net_income" || row.id === "sbc" ? (
                  <div>
                    
                    {/* Guidance for WC Change when no components (single-line mode) */}
                    {row.id === "wc_change" && years.length > 0 && (
                      <div className="mb-2 rounded-md border border-blue-700/40 bg-blue-950/20 p-2">
                        <div className="text-[10px] text-blue-400/80">
                          Enter historical total here, or add Working Capital components above so the total is calculated from them. Projection years are calculated from Balance Sheet movements.
                        </div>
                      </div>
                    )}
                    
                    {/* Input fields for historical years */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                    {years.map((year) => {
                      // Get stored value - simple for all fields
                      let storedValue = row.values?.[year] ?? 0;
                      
                      // For Net Income: use auto-populated value (read-only)
                      if (row.id === "net_income") {
                        const autoValue = getAutoPopulatedValue(row, year);
                        if (autoValue !== null) storedValue = autoValue;
                      }
                      // For SBC: always use resolved value so that when sbcDisclosureEnabled is false we never show stale disclosure-driven values from row.values
                      if (row.id === "sbc") {
                        const resolved = getAutoPopulatedValue(row, year);
                        storedValue = resolved !== null ? resolved : 0;
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
                            const computed = computeRowValue(row, year, allStatements.cashFlow, allStatements.cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled);
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
                      // Net Income: always read-only. SBC: only read-only when disclosure actually has a value for this year; otherwise editable.
                      // WC Change: historical years are editable, projection years are calculated (read-only)
                      const isWcChangeProjection = row.id === "wc_change" && year.endsWith("E");
                      const sbcDisclosureDrivenThisYear = row.id === "sbc" && hasSbcDisclosureValueForYear(year, embeddedDisclosures ?? [], sbcDisclosureEnabled);
                      const isReadOnly = (row.id === "net_income" || sbcDisclosureDrivenThisYear) || isWcChangeProjection;
                      const isDanda = row.id === "danda";
                      // Net Income: display-only (no input boxes) so it clearly looks read-only / calculated
                      const isNetIncomeReadOnlyDisplay = row.id === "net_income";

                      return (
                        <div key={year} className="flex flex-col">
                          <label className={`text-xs ${colors.textLight} mb-1`}>
                            {year}
                            {isWcChangeProjection && <span className="text-[10px] text-slate-500 ml-1">(calculated)</span>}
                          </label>
                          {isNetIncomeReadOnlyDisplay ? (
                            <div className="rounded border border-slate-700/50 bg-slate-800/40 px-2 py-1.5 text-sm text-slate-400">
                              {displayValue === 0 ? "—" : displayValue}
                              {unitLabel && <span className="text-slate-500 ml-1">{unitLabel}</span>}
                            </div>
                          ) : (
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
                          )}
                          {!isNetIncomeReadOnlyDisplay && unitLabel && (
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

                {/* Calculated value display (skip for net_income/sbc — source label and header suffice) */}
                {isCalculated && row.id !== "net_income" && row.id !== "sbc" && (
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
                              historicalCfsNature: "reported_investing",
                              classificationSource: "user",
                              forecastMetadataStatus: "trusted",
                              taxonomyStatus: "trusted",
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
                              historicalCfsNature: "reported_financing",
                              classificationSource: "user",
                              forecastMetadataStatus: "trusted",
                              taxonomyStatus: "trusted",
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
          <>
            {section.id === "operating" && (
              <div className="pt-2 mt-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-700/60 pb-1.5 mb-2">
                  Cash from Operating Activities
                </div>
              </div>
            )}
            <div className={`rounded-lg border-2 ${colors.border} ${colors.bg} p-3 ${section.id === "operating" ? "mt-0" : "mt-4"}`}>
              <div className="flex items-center justify-between">
                <span className={`text-sm font-bold ${colors.text}`}>
                  {totalRow.label}
                </span>
                <span className="text-xs text-slate-400 italic">(Calculated)</span>
              </div>
            </div>
          </>
        )}

        {/* Add Custom Item */}
        {!isLocked && (
          <div className="mt-4">
            {!showAddDialog ? (
              <button
                type="button"
                onClick={() => {
                  addIntentSubgroupRef.current = null;
                  setAddingFromOperatingSubgroup(null);
                  setShowAddDialog(true);
                }}
                className={`rounded-md border ${colors.border} ${colors.bg} px-4 py-2 text-xs font-semibold ${colors.text} hover:opacity-80 transition`}
              >
                + Add Custom {section.id === "cash_bridge" ? "Cash Bridge" : section.label} Item
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
                    if (e.key === "Enter" && !addingWithAI) {
                      void handleAddCustomItem();
                    } else if (e.key === "Escape") {
                      addIntentSubgroupRef.current = null;
                      setShowAddDialog(false);
                      setNewItemLabel("");
                      setAddingFromOperatingSubgroup(null);
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
                    onClick={() => void handleAddCustomItem()}
                    disabled={!newItemLabel.trim() || addingWithAI || (section.id !== "operating" && !!validationError && !termKnowledge)}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {addingWithAI ? "Adding…" : "Add"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      addIntentSubgroupRef.current = null;
                      setShowAddDialog(false);
                      setNewItemLabel("");
                      setAddingFromOperatingSubgroup(null);
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
  const companyContext = useModelStore((s) => s.companyContext);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns);
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns || {});
  const danaLocation = useModelStore((s) => s.danaLocation);
  const embeddedDisclosures = useModelStore((s) => s.embeddedDisclosures ?? []);
  const sbcDisclosureEnabled = useModelStore((s) => s.sbcDisclosureEnabled ?? true);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const insertRow = useModelStore((s) => s.insertRow);
  const removeRow = useModelStore((s) => s.removeRow);
  const ensureCFSAnchorRows = useModelStore((s) => s.ensureCFSAnchorRows);

  // Ensure CFI/CFF fixed anchor rows exist when builder is shown (e.g. after rehydration)
  useEffect(() => {
    ensureCFSAnchorRows();
  }, [ensureCFSAnchorRows]);

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
          embeddedDisclosures={embeddedDisclosures}
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
          embeddedDisclosures={embeddedDisclosures}
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
          embeddedDisclosures={embeddedDisclosures}
        />

        {/* Cash Bridge Items (FX effect, etc.) */}
        <CFSSectionComponent
          section={CFS_SECTIONS[3]}
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
          embeddedDisclosures={embeddedDisclosures}
        />

        {/* Net Change in Cash — same computed value as preview (operating + investing + financing + bridge) */}
        {(() => {
          const netChangeCashRow = cashFlow.find(r => r.id === "net_change_cash");
          const operatingCfRow = cashFlow.find(r => r.id === "operating_cf");
          const investingCfRow = cashFlow.find(r => r.id === "investing_cf");
          const financingCfRow = cashFlow.find(r => r.id === "financing_cf");
          if (!netChangeCashRow) return null;

          const getNetChangeForYear = (year: string): number | null => {
            if (!allStatements) return null;
            try {
              const operatingCf = operatingCfRow
                ? computeRowValue(operatingCfRow, year, cashFlow, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled)
                : 0;
              const investingCf = investingCfRow
                ? computeRowValue(investingCfRow, year, cashFlow, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled)
                : 0;
              const financingCf = financingCfRow
                ? computeRowValue(financingCfRow, year, cashFlow, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled)
                : 0;
              let bridge = 0;
              for (const r of cashFlow) {
                if (r.id === "net_change_cash") continue;
                if (r.id === "fx_effect_on_cash" || r.cfsLink?.section === "cash_bridge") {
                  bridge += computeRowValue(r, year, cashFlow, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled);
                }
              }
              return operatingCf + investingCf + financingCf + bridge;
            } catch {
              return null;
            }
          };

          return (
            <div className="rounded-lg border-2 border-purple-800/40 bg-purple-950/20 p-4 mt-6">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-bold text-purple-200">
                  Net Change in Cash
                </span>
                <span className="text-xs text-slate-400 italic">(Calculated: Operating + Investing + Financing + Cash Bridge)</span>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {years.map((year) => {
                  const computedValue = getNetChangeForYear(year);
                  const unitLabel = getUnitLabel(meta?.currencyUnit);
                  const isUnavailable = computedValue === null || Number.isNaN(computedValue);
                  const displayValue = !isUnavailable ? storedToDisplay(computedValue as number, meta?.currencyUnit) : null;
                  const cellText = isUnavailable ? "—" : `${formatIntegerWithSeparators(displayValue)}${unitLabel ? ` ${unitLabel}` : ""}`;

                  return (
                    <div key={year} className="flex flex-col">
                      <label className="text-xs text-purple-300/80 mb-1">
                        {year}
                      </label>
                      <div className="rounded-md border border-purple-700/40 bg-purple-950/40 px-2 py-1.5 text-sm font-semibold text-purple-200">
                        {cellText}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Cash Reconciliation (historical, display-only) */}
        {(() => {
          const cashRow = balanceSheet?.find((r) => r.id === "cash");
          const netChangeCashRow = cashFlow.find((r) => r.id === "net_change_cash");
          if (!cashRow && !netChangeCashRow) return null;

          const unitLabel = getUnitLabel(meta?.currencyUnit);
          const tolerance = 0.5; // stored-unit tolerance for small rounding differences

          const formatValue = (v: number | undefined): string => {
            if (v === undefined) return "—";
            const display = storedToDisplay(v, meta?.currencyUnit ?? "units");
            const formatted = formatIntegerWithSeparators(display);
            return unitLabel ? `${formatted} ${unitLabel}` : formatted;
          };

          return (
            <div className="rounded-lg border-2 border-slate-700/60 bg-slate-950/40 p-4 mt-6">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-100">
                  Cash Reconciliation (historical)
                </span>
                <span className="text-[11px] text-slate-400 italic">
                  Beginning Cash + Net Change in Cash vs. Balance Sheet Cash
                </span>
              </div>
              <div className="overflow-x-auto mt-2">
                <table className="min-w-full text-xs text-slate-200">
                  <thead>
                    <tr className="border-b border-slate-700/60">
                      <th className="px-2 py-1 text-left text-slate-400">Year</th>
                      <th className="px-2 py-1 text-right text-slate-400">Beginning Cash</th>
                      <th className="px-2 py-1 text-right text-slate-400">Net Change in Cash</th>
                      <th className="px-2 py-1 text-right text-slate-400">Implied Ending Cash</th>
                      <th className="px-2 py-1 text-right text-slate-400">Balance Sheet Cash</th>
                      <th className="px-2 py-1 text-left text-slate-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {years.map((year, index) => {
                      const prevYear = index > 0 ? years[index - 1] : null;
                      const beginning =
                        prevYear && cashRow?.values ? cashRow.values[prevYear] : undefined;
                      let netChange: number | undefined;
                      if (netChangeCashRow && allStatements) {
                        try {
                          netChange = computeRowValue(netChangeCashRow, year, cashFlow, cashFlow, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled);
                        } catch {
                          netChange = undefined;
                        }
                      }
                      const implied =
                        beginning !== undefined && netChange !== undefined
                          ? beginning + netChange
                          : undefined;
                      const bsEnding = cashRow?.values?.[year];

                      let status = "Insufficient data";
                      let statusClass = "text-slate-400";
                      if (implied !== undefined && bsEnding !== undefined) {
                        const diff = Math.abs(implied - bsEnding);
                        if (diff <= tolerance) {
                          status = "Pass";
                          statusClass = "text-emerald-400";
                        } else {
                          status = "Mismatch";
                          statusClass = "text-amber-400";
                        }
                      }

                      return (
                        <tr key={year} className="border-b border-slate-800/40">
                          <td className="px-2 py-1 text-slate-300">{year}</td>
                          <td className="px-2 py-1 text-right">{formatValue(beginning)}</td>
                          <td className="px-2 py-1 text-right">{formatValue(netChange)}</td>
                          <td className="px-2 py-1 text-right">{formatValue(implied)}</td>
                          <td className="px-2 py-1 text-right">{formatValue(bsEnding)}</td>
                          <td className="px-2 py-1">
                            <span className={statusClass}>{status}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </CollapsibleSection>
  );
}
