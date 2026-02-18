"use client";

import { useMemo, useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { findGlossaryItem } from "@/lib/financial-glossary";
import { getCommonBSItems, filterAlreadyAdded } from "@/lib/common-suggestions";
import { suggestBestMatch, validateConceptForStatement } from "@/lib/ai-item-matcher";
import { getRowsForCategory, getInsertionIndexForCategory } from "@/lib/bs-category-mapper";
import type { BalanceSheetCategory } from "@/lib/bs-impact-rules";
import { getSuggestedTreatment } from "@/lib/financial-terms-knowledge";
import UnifiedItemCard from "@/components/unified-item-card";
import CollapsibleSection from "@/components/collapsible-section";
import { computeRowValue } from "@/lib/calculations";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";

// UUID helper
function uuid() {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Extra current-asset suggestions (not all may be in glossary)
const EXTRA_CA_SUGGESTIONS = [
  { concept: "Marketable securities", description: "Short-term liquid investments (e.g. treasury bills, commercial paper)." },
  { concept: "Short-term investments", description: "Investments with maturities over 3 months but due within one year." },
  { concept: "Prepaid expenses", description: "Payments made in advance for future goods or services (e.g. insurance, rent)." },
  { concept: "Other current assets", description: "Other assets expected to be realized in cash or consumed within one year." },
  { concept: "Restricted cash (current)", description: "Cash held in escrow or restricted for use within one year." },
];

// Extra fixed-asset suggestions
const EXTRA_FA_SUGGESTIONS = [
  { concept: "Property, Plant & Equipment, net", description: "PP&E net of accumulated depreciation." },
  { concept: "Goodwill", description: "Excess of purchase price over fair value of net assets in an acquisition." },
  { concept: "Intangible assets", description: "Non-physical assets (patents, trademarks, software)." },
  { concept: "Other long-term assets", description: "Other non-current assets." },
  { concept: "Deferred tax assets, non-current", description: "Future tax benefits from temporary differences." },
  { concept: "Strategic investments", description: "Long-term equity or debt investments." },
  { concept: "Operating lease right-of-use assets", description: "ROU assets from lease agreements." },
];

// Extra current-liability suggestions
const EXTRA_CL_SUGGESTIONS = [
  { concept: "Accounts payable", description: "Amounts owed to suppliers for goods or services received on credit." },
  { concept: "Short-term debt", description: "Debt due within one year (bank loans, commercial paper)." },
  { concept: "Accrued expenses", description: "Expenses incurred but not yet paid." },
  { concept: "Deferred revenue", description: "Cash received before revenue is earned." },
  { concept: "Unearned revenue", description: "Obligation to deliver goods or services for advance payments." },
  { concept: "Other current liabilities", description: "Other obligations due within one year." },
  { concept: "Current portion of long-term debt", description: "Portion of long-term debt due within one year." },
];

// Extra non-current liability suggestions
const EXTRA_NCL_SUGGESTIONS = [
  { concept: "Long-term debt", description: "Debt with maturity beyond one year." },
  { concept: "Deferred tax liabilities", description: "Future tax obligations from temporary differences." },
  { concept: "Pension liabilities", description: "Obligations under defined benefit pension plans." },
  { concept: "Other long-term liabilities", description: "Other non-current obligations." },
  { concept: "Operating lease liabilities", description: "Lease liabilities from operating leases." },
  { concept: "Finance lease liabilities", description: "Liabilities from finance (capital) leases." },
  { concept: "Bonds payable", description: "Long-term debt issued in the form of bonds." },
];

// Extra shareholders' equity suggestions
const EXTRA_EQUITY_SUGGESTIONS = [
  { concept: "Common stock", description: "Par value of common shares outstanding." },
  { concept: "Additional paid-in capital", description: "Amount received above par value for shares issued." },
  { concept: "Retained earnings", description: "Cumulative net income less dividends." },
  { concept: "Treasury stock", description: "Company's own shares repurchased (contra-equity)." },
  { concept: "Accumulated other comprehensive income", description: "Unrealized gains/losses not in net income." },
  { concept: "Noncontrolling interest", description: "Equity in subsidiaries not fully owned." },
  { concept: "Preferred stock", description: "Preferred shares (if any)." },
];

/**
 * Unified Balance Sheet Builder
 * 
 * Replaces the complex category-based builder with a unified pattern
 * that matches IS and CFS builders.
 * 
 * Features:
 * - Common suggestions from glossary
 * - AI matching for manual additions
 * - Expand/collapse items
 * - Edit/Confirm/Remove functionality
 * - Organized by categories (Assets, Liabilities, Equity)
 */
export default function BalanceSheetBuilderUnified() {
  const meta = useModelStore((s) => s.meta);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const insertRow = useModelStore((s) => s.insertRow);
  const removeRow = useModelStore((s) => s.removeRow);
  const reorderBalanceSheetCategory = useModelStore((s) => s.reorderBalanceSheetCategory);
  
  const years = useMemo(() => {
    return meta?.years?.historical ?? [];
  }, [meta]);
  
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<BalanceSheetCategory | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<any>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [isMatching, setIsMatching] = useState(false);
  const [showAddCADialog, setShowAddCADialog] = useState(false);
  const [newCALabel, setNewCALabel] = useState("");
  const [caMatchResult, setCaMatchResult] = useState<any>(null);
  const [caMatching, setCaMatching] = useState(false);
  const [showAddFADialog, setShowAddFADialog] = useState(false);
  const [newFALabel, setNewFALabel] = useState("");
  const [faMatchResult, setFaMatchResult] = useState<any>(null);
  const [faMatching, setFaMatching] = useState(false);
  const [showAddCLDialog, setShowAddCLDialog] = useState(false);
  const [newCLLabel, setNewCLLabel] = useState("");
  const [clMatchResult, setClMatchResult] = useState<any>(null);
  const [clMatching, setClMatching] = useState(false);
  const [showAddNCLDialog, setShowAddNCLDialog] = useState(false);
  const [newNCLLabel, setNewNCLLabel] = useState("");
  const [nclMatchResult, setNclMatchResult] = useState<any>(null);
  const [nclMatching, setNclMatching] = useState(false);
  const [showAddEquityDialog, setShowAddEquityDialog] = useState(false);
  const [newEquityLabel, setNewEquityLabel] = useState("");
  const [equityMatchResult, setEquityMatchResult] = useState<any>(null);
  const [equityMatching, setEquityMatching] = useState(false);
  
  const isLocked = useModelStore((s) => s.sectionLocks["balance_sheet"] ?? false);
  
  // Get common suggestions by category
  const commonSuggestions = useMemo(() => {
    const assets = getCommonBSItems("Assets");
    const liabilities = getCommonBSItems("Liabilities");
    const equity = getCommonBSItems("Equity");
    
    return {
      assets: filterAlreadyAdded(assets, balanceSheet.map(r => ({ label: r.label, id: r.id }))),
      liabilities: filterAlreadyAdded(liabilities, balanceSheet.map(r => ({ label: r.label, id: r.id }))),
      equity: filterAlreadyAdded(equity, balanceSheet.map(r => ({ label: r.label, id: r.id }))),
    };
  }, [balanceSheet]);
  
  // Organize BS items by category
  const sections = useMemo(() => {
    const currentAssets = getRowsForCategory(balanceSheet, "current_assets");
    const fixedAssets = getRowsForCategory(balanceSheet, "fixed_assets");
    const currentLiabilities = getRowsForCategory(balanceSheet, "current_liabilities");
    const nonCurrentLiabilities = getRowsForCategory(balanceSheet, "non_current_liabilities");
    const equity = getRowsForCategory(balanceSheet, "equity");
    
    // Get total rows
    const totalCurrentAssets = balanceSheet.find(r => r.id === "total_current_assets");
    const totalAssets = balanceSheet.find(r => r.id === "total_assets");
    const totalCurrentLiab = balanceSheet.find(r => r.id === "total_current_liabilities");
    const totalLiab = balanceSheet.find(r => r.id === "total_liabilities");
    const totalEquity = balanceSheet.find(r => r.id === "total_equity");
    const totalLiabAndEquity = balanceSheet.find(r => r.id === "total_liab_and_equity");
    
    return {
      currentAssets,
      fixedAssets,
      currentLiabilities,
      nonCurrentLiabilities,
      equity,
      totals: {
        totalCurrentAssets,
        totalAssets,
        totalCurrentLiab,
        totalLiab,
        totalEquity,
        totalLiabAndEquity,
      },
    };
  }, [balanceSheet]);
  
  // Validate new item as user types
  useEffect(() => {
    if (newItemLabel.trim() && selectedCategory) {
      setIsMatching(true);
      const validateAndMatch = async () => {
        const validation = validateConceptForStatement(newItemLabel.trim(), "BS");
        const match = await suggestBestMatch(newItemLabel.trim(), "BS");
        
        setValidationError(validation.isValid ? null : (validation.reason || "Invalid concept"));
        setMatchResult(match);
        setIsMatching(false);
      };
      validateAndMatch();
    } else {
      setValidationError(null);
      setMatchResult(null);
      setIsMatching(false);
    }
  }, [newItemLabel, selectedCategory]);
  
  const handleAddFromSuggestion = (item: any, category: BalanceSheetCategory) => {
    const insertIndex = getInsertionIndexForCategory(balanceSheet, category);
    const newRow: Row = {
      id: `bs_${uuid()}`,
      label: item.concept,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    
    // Add CFS link if item has one
    const glossaryItem = findGlossaryItem(item.concept);
    if (glossaryItem?.cfsSection) {
      newRow.cfsLink = {
        section: glossaryItem.cfsSection,
        cfsItemId: newRow.id,
        impact: "positive", // Default, can be refined
        description: glossaryItem.description,
      };
    }
    
    insertRow("balanceSheet", insertIndex, newRow);
  };
  
  const handleAddCustom = async () => {
    const trimmed = newItemLabel.trim();
    if (!trimmed || !selectedCategory) return;
    
    if (validationError && !matchResult?.shouldAllow) {
      return;
    }
    
    const label = matchResult?.suggestedLabel || trimmed;
    const insertIndex = getInsertionIndexForCategory(balanceSheet, selectedCategory);
    
    const newRow: Row = {
      id: `bs_${uuid()}`,
      label,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    
    // Add CFS link if matched item has one
    if (matchResult?.matchedConcept) {
      const glossaryItem = matchResult.matchedConcept;
      if (glossaryItem.cfsSection) {
        newRow.cfsLink = {
          section: glossaryItem.cfsSection,
          cfsItemId: newRow.id,
          impact: "positive",
          description: glossaryItem.description,
        };
      }
    }
    
    insertRow("balanceSheet", insertIndex, newRow);
    setNewItemLabel("");
    setShowAddDialog(false);
    setSelectedCategory(null);
    setValidationError(null);
    setMatchResult(null);
  };
  
  const protectedTotalRows = [
    "total_current_assets", "total_fixed_assets", "total_assets", "total_current_liabilities",
    "total_non_current_liabilities", "total_liabilities", "total_equity", "total_liab_and_equity",
  ];

  const handleRemoveItem = (rowId: string) => {
    if (protectedTotalRows.includes(rowId)) return;
    removeRow("balanceSheet", rowId);
  };

  const handleDragStart = (e: React.DragEvent, payload: { rowId: string; category: BalanceSheetCategory; fromIndex: number }) => {
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(targetId);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (
    e: React.DragEvent,
    target: { category: BalanceSheetCategory; rowId: string; toIndex: number }
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    let payload: { rowId: string; category: BalanceSheetCategory; fromIndex: number };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const { rowId: draggedRowId, category: draggedCategory, fromIndex } = payload;
    
    // Only allow drops within the same category
    if (draggedCategory !== target.category) return;
    // Don't reorder if dropping on itself
    if (draggedRowId === target.rowId) return;
    
    const toIndex = target.toIndex;
    // Adjust index when dragging down (fromIndex < toIndex): after removal, toIndex becomes toIndex - 1
    // When dragging up (fromIndex > toIndex): toIndex stays the same
    const adjustedToIndex = fromIndex < toIndex ? toIndex : toIndex;
    
    if (fromIndex !== adjustedToIndex) {
      reorderBalanceSheetCategory(draggedCategory, fromIndex, adjustedToIndex);
    }
  };

  const existingLabels = useMemo(() => balanceSheet.map((r) => r.label), [balanceSheet]);
  const caFromGlossary = commonSuggestions.assets
    .filter((a: any) => a.category === "Assets")
    .filter((a: any) => getSuggestedTreatment(a.concept).category === "current_assets");
  const caExtra = EXTRA_CA_SUGGESTIONS.filter(
    (extra) => !existingLabels.some((l) => l.toLowerCase().trim() === extra.concept.toLowerCase().trim())
  );
  const caSuggestions = [...caFromGlossary, ...caExtra].slice(0, 8);
  const knownCategoryForCALabel = newCALabel.trim() ? getSuggestedTreatment(newCALabel.trim()).category : undefined;
  const notCurrentAssetWarning =
    knownCategoryForCALabel &&
    knownCategoryForCALabel !== "current_assets" &&
    (knownCategoryForCALabel === "fixed_assets" ||
      knownCategoryForCALabel === "current_liabilities" ||
      knownCategoryForCALabel === "non_current_liabilities" ||
      knownCategoryForCALabel === "equity");

  const faFromGlossary = commonSuggestions.assets
    .filter((a: any) => a.category === "Assets")
    .filter((a: any) => getSuggestedTreatment(a.concept).category === "fixed_assets");
  const faExtra = EXTRA_FA_SUGGESTIONS.filter(
    (extra) => !existingLabels.some((l) => l.toLowerCase().trim() === extra.concept.toLowerCase().trim())
  );
  const faSuggestions = [...faFromGlossary, ...faExtra].slice(0, 8);
  const knownCategoryForFALabel = newFALabel.trim() ? getSuggestedTreatment(newFALabel.trim()).category : undefined;
  const notFixedAssetWarning =
    knownCategoryForFALabel &&
    knownCategoryForFALabel !== "fixed_assets" &&
    (knownCategoryForFALabel === "current_assets" ||
      knownCategoryForFALabel === "current_liabilities" ||
      knownCategoryForFALabel === "non_current_liabilities" ||
      knownCategoryForFALabel === "equity");

  const clFromGlossary = commonSuggestions.liabilities
    .filter((l: any) => l.category === "Liabilities")
    .filter((l: any) => getSuggestedTreatment(l.concept).category === "current_liabilities");
  const clExtra = EXTRA_CL_SUGGESTIONS.filter(
    (extra) => !existingLabels.some((lab) => lab.toLowerCase().trim() === extra.concept.toLowerCase().trim())
  );
  const clSuggestions = [...clFromGlossary, ...clExtra].slice(0, 8);
  const knownCategoryForCLLabel = newCLLabel.trim() ? getSuggestedTreatment(newCLLabel.trim()).category : undefined;
  const notCurrentLiabilityWarning =
    knownCategoryForCLLabel &&
    knownCategoryForCLLabel !== "current_liabilities" &&
    (knownCategoryForCLLabel === "current_assets" ||
      knownCategoryForCLLabel === "fixed_assets" ||
      knownCategoryForCLLabel === "non_current_liabilities" ||
      knownCategoryForCLLabel === "equity");

  const nclFromGlossary = commonSuggestions.liabilities
    .filter((l: any) => l.category === "Liabilities")
    .filter((l: any) => getSuggestedTreatment(l.concept).category === "non_current_liabilities");
  const nclExtra = EXTRA_NCL_SUGGESTIONS.filter(
    (extra) => !existingLabels.some((lab) => lab.toLowerCase().trim() === extra.concept.toLowerCase().trim())
  );
  const nclSuggestions = [...nclFromGlossary, ...nclExtra].slice(0, 8);
  const knownCategoryForNCLLabel = newNCLLabel.trim() ? getSuggestedTreatment(newNCLLabel.trim()).category : undefined;
  const notNonCurrentLiabilityWarning =
    knownCategoryForNCLLabel &&
    knownCategoryForNCLLabel !== "non_current_liabilities" &&
    (knownCategoryForNCLLabel === "current_assets" ||
      knownCategoryForNCLLabel === "fixed_assets" ||
      knownCategoryForNCLLabel === "current_liabilities" ||
      knownCategoryForNCLLabel === "equity");

  const equityFromGlossary = commonSuggestions.equity
    .filter((e: any) => e.category === "Equity")
    .filter((e: any) => getSuggestedTreatment(e.concept).category === "equity");
  const equityExtra = EXTRA_EQUITY_SUGGESTIONS.filter(
    (extra) => !existingLabels.some((lab) => lab.toLowerCase().trim() === extra.concept.toLowerCase().trim())
  );
  const equitySuggestions = [...equityFromGlossary, ...equityExtra].slice(0, 8);
  const knownCategoryForEquityLabel = newEquityLabel.trim() ? getSuggestedTreatment(newEquityLabel.trim()).category : undefined;
  const notEquityWarning =
    knownCategoryForEquityLabel &&
    knownCategoryForEquityLabel !== "equity" &&
    (knownCategoryForEquityLabel === "current_assets" ||
      knownCategoryForEquityLabel === "fixed_assets" ||
      knownCategoryForEquityLabel === "current_liabilities" ||
      knownCategoryForEquityLabel === "non_current_liabilities");

  useEffect(() => {
    if (!showAddCADialog || !newCALabel.trim()) {
      setCaMatchResult(null);
      setCaMatching(false);
      return;
    }
    setCaMatching(true);
    suggestBestMatch(newCALabel.trim(), "BS").then((res) => {
      setCaMatchResult(res);
      setCaMatching(false);
    });
  }, [showAddCADialog, newCALabel]);

  const handleAddCustomCA = () => {
    const trimmed = newCALabel.trim();
    if (!trimmed) return;
    const label = caMatchResult?.suggestedLabel || trimmed;
    const insertIndex = getInsertionIndexForCategory(balanceSheet, "current_assets");
    const newRow: Row = {
      id: `bs_${uuid()}`,
      label,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    const knowledge = getSuggestedTreatment(trimmed);
    if (knowledge.cfsLink) {
      newRow.cfsLink = {
        section: knowledge.cfsLink.section,
        cfsItemId: newRow.id,
        impact: knowledge.cfsLink.impact,
        description: knowledge.cfsLink.description,
      };
    }
    if (caMatchResult?.matchedConcept?.cfsSection) {
      const g = findGlossaryItem(caMatchResult.matchedConcept.concept);
      if (g?.cfsSection) {
        newRow.cfsLink = {
          section: g.cfsSection as "operating" | "investing" | "financing",
          cfsItemId: newRow.id,
          impact: "positive",
          description: g.description,
        };
      }
    }
    insertRow("balanceSheet", insertIndex, newRow);
    setNewCALabel("");
    setShowAddCADialog(false);
    setCaMatchResult(null);
  };

  useEffect(() => {
    if (!showAddFADialog || !newFALabel.trim()) {
      setFaMatchResult(null);
      setFaMatching(false);
      return;
    }
    setFaMatching(true);
    suggestBestMatch(newFALabel.trim(), "BS").then((res) => {
      setFaMatchResult(res);
      setFaMatching(false);
    });
  }, [showAddFADialog, newFALabel]);

  useEffect(() => {
    if (!showAddCLDialog || !newCLLabel.trim()) {
      setClMatchResult(null);
      setClMatching(false);
      return;
    }
    setClMatching(true);
    suggestBestMatch(newCLLabel.trim(), "BS").then((res) => {
      setClMatchResult(res);
      setClMatching(false);
    });
  }, [showAddCLDialog, newCLLabel]);

  useEffect(() => {
    if (!showAddNCLDialog || !newNCLLabel.trim()) {
      setNclMatchResult(null);
      setNclMatching(false);
      return;
    }
    setNclMatching(true);
    suggestBestMatch(newNCLLabel.trim(), "BS").then((res) => {
      setNclMatchResult(res);
      setNclMatching(false);
    });
  }, [showAddNCLDialog, newNCLLabel]);

  const handleAddCustomNCL = () => {
    const trimmed = newNCLLabel.trim();
    if (!trimmed) return;
    const label = nclMatchResult?.suggestedLabel || trimmed;
    const insertIndex = getInsertionIndexForCategory(balanceSheet, "non_current_liabilities");
    const newRow: Row = {
      id: `bs_${uuid()}`,
      label,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    const knowledge = getSuggestedTreatment(trimmed);
    if (knowledge.cfsLink) {
      newRow.cfsLink = {
        section: knowledge.cfsLink.section,
        cfsItemId: newRow.id,
        impact: knowledge.cfsLink.impact,
        description: knowledge.cfsLink.description,
      };
    }
    if (nclMatchResult?.matchedConcept?.cfsSection) {
      const g = findGlossaryItem(nclMatchResult.matchedConcept.concept);
      if (g?.cfsSection) {
        newRow.cfsLink = {
          section: g.cfsSection as "operating" | "investing" | "financing",
          cfsItemId: newRow.id,
          impact: "positive",
          description: g.description,
        };
      }
    }
    insertRow("balanceSheet", insertIndex, newRow);
    setNewNCLLabel("");
    setShowAddNCLDialog(false);
    setNclMatchResult(null);
  };

  useEffect(() => {
    if (!showAddEquityDialog || !newEquityLabel.trim()) {
      setEquityMatchResult(null);
      setEquityMatching(false);
      return;
    }
    setEquityMatching(true);
    suggestBestMatch(newEquityLabel.trim(), "BS").then((res) => {
      setEquityMatchResult(res);
      setEquityMatching(false);
    });
  }, [showAddEquityDialog, newEquityLabel]);

  const handleAddCustomEquity = () => {
    const trimmed = newEquityLabel.trim();
    if (!trimmed) return;
    const label = equityMatchResult?.suggestedLabel || trimmed;
    const insertIndex = getInsertionIndexForCategory(balanceSheet, "equity");
    const newRow: Row = {
      id: `bs_${uuid()}`,
      label,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    const knowledge = getSuggestedTreatment(trimmed);
    if (knowledge.cfsLink) {
      newRow.cfsLink = {
        section: knowledge.cfsLink.section,
        cfsItemId: newRow.id,
        impact: knowledge.cfsLink.impact,
        description: knowledge.cfsLink.description,
      };
    }
    if (equityMatchResult?.matchedConcept?.cfsSection) {
      const g = findGlossaryItem(equityMatchResult.matchedConcept.concept);
      if (g?.cfsSection) {
        newRow.cfsLink = {
          section: g.cfsSection as "operating" | "investing" | "financing",
          cfsItemId: newRow.id,
          impact: "positive",
          description: g.description,
        };
      }
    }
    insertRow("balanceSheet", insertIndex, newRow);
    setNewEquityLabel("");
    setShowAddEquityDialog(false);
    setEquityMatchResult(null);
  };

  const handleAddCustomCL = () => {
    const trimmed = newCLLabel.trim();
    if (!trimmed) return;
    const label = clMatchResult?.suggestedLabel || trimmed;
    const insertIndex = getInsertionIndexForCategory(balanceSheet, "current_liabilities");
    const newRow: Row = {
      id: `bs_${uuid()}`,
      label,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    const knowledge = getSuggestedTreatment(trimmed);
    if (knowledge.cfsLink) {
      newRow.cfsLink = {
        section: knowledge.cfsLink.section,
        cfsItemId: newRow.id,
        impact: knowledge.cfsLink.impact,
        description: knowledge.cfsLink.description,
      };
    }
    if (clMatchResult?.matchedConcept?.cfsSection) {
      const g = findGlossaryItem(clMatchResult.matchedConcept.concept);
      if (g?.cfsSection) {
        newRow.cfsLink = {
          section: g.cfsSection as "operating" | "investing" | "financing",
          cfsItemId: newRow.id,
          impact: "positive",
          description: g.description,
        };
      }
    }
    insertRow("balanceSheet", insertIndex, newRow);
    setNewCLLabel("");
    setShowAddCLDialog(false);
    setClMatchResult(null);
  };

  const handleAddCustomFA = () => {
    const trimmed = newFALabel.trim();
    if (!trimmed) return;
    const label = faMatchResult?.suggestedLabel || trimmed;
    const insertIndex = getInsertionIndexForCategory(balanceSheet, "fixed_assets");
    const newRow: Row = {
      id: `bs_${uuid()}`,
      label,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    const knowledge = getSuggestedTreatment(trimmed);
    if (knowledge.cfsLink) {
      newRow.cfsLink = {
        section: knowledge.cfsLink.section,
        cfsItemId: newRow.id,
        impact: knowledge.cfsLink.impact,
        description: knowledge.cfsLink.description,
      };
    }
    if (faMatchResult?.matchedConcept?.cfsSection) {
      const g = findGlossaryItem(faMatchResult.matchedConcept.concept);
      if (g?.cfsSection) {
        newRow.cfsLink = {
          section: g.cfsSection as "operating" | "investing" | "financing",
          cfsItemId: newRow.id,
          impact: "positive",
          description: g.description,
        };
      }
    }
    insertRow("balanceSheet", insertIndex, newRow);
    setNewFALabel("");
    setShowAddFADialog(false);
    setFaMatchResult(null);
  };

  const renderSection = (
    title: string,
    items: Row[],
    colorClass: "blue" | "green" | "orange" | "purple" | "amber" | "slate" | "red",
    sectionId: string,
    suggestions?: any[]
  ) => {
    if (items.length === 0 && (!suggestions || suggestions.length === 0)) return null;
    
    return (
      <CollapsibleSection
        sectionId={sectionId}
        title={title}
        description={`${title} items in the Balance Sheet`}
        colorClass={colorClass}
        defaultExpanded={true}
      >
        <div className="space-y-3">
          {items.map((row, index) => {
            const glossaryItem = findGlossaryItem(row.label);
            const isCalculated = row.kind === "calc" || row.kind === "total" || row.kind === "subtotal";
            const isTotalRow = row.id.startsWith("total_") || row.kind === "total" || row.kind === "subtotal";
            
            let computedValue: number | null = null;
            if (isCalculated) {
              try {
                computedValue = computeRowValue(
                  row,
                  years[0] || "",
                  balanceSheet,
                  balanceSheet,
                  { incomeStatement: [], balanceSheet, cashFlow: [] }
                );
              } catch {
                computedValue = null;
              }
            }
            
            // Determine category from section title
            const category = title.includes("Current Asset") 
              ? "current_assets"
              : title.includes("Fixed Asset")
              ? "fixed_assets"
              : title.includes("Current Liabilit")
              ? "current_liabilities"
              : title.includes("Non-Current Liabilit")
              ? "non_current_liabilities"
              : "equity";
            
            // Calculate index excluding total rows (for drag-and-drop)
            const reorderableIndex = items.slice(0, index).filter((r) => !r.id.startsWith("total_") && r.kind !== "total" && r.kind !== "subtotal").length;
            
            return (
              <div
                key={row.id}
                onDragOver={(e) => handleDragOver(e, row.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => !isTotalRow && handleDrop(e, { category, rowId: row.id, toIndex: reorderableIndex })}
              >
                <UnifiedItemCard
                  row={row}
                  years={years}
                  meta={meta}
                  glossaryItem={glossaryItem}
                  isLocked={isLocked}
                  isCalculated={isCalculated}
                  autoValue={computedValue}
                  colorClass={colorClass}
                  onUpdateValue={updateRowValue.bind(null, "balanceSheet")}
                  onRemove={handleRemoveItem}
                  showRemove={!isTotalRow}
                  showConfirm={true}
                  protectedRows={protectedTotalRows}
                  draggable={!isLocked && !isTotalRow}
                  onDragStart={(e) => handleDragStart(e, { rowId: row.id, category, fromIndex: reorderableIndex })}
                  onDragOver={(e) => handleDragOver(e, row.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => !isTotalRow && handleDrop(e, { category, rowId: row.id, toIndex: reorderableIndex })}
                  dragOverId={dragOverId}
                />
              </div>
            );
          })}
        </div>
        
        {/* Suggestions for this section */}
        {!isLocked && suggestions && suggestions.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold text-slate-300">
              💡 Common {title} Items:
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {suggestions.slice(0, 6).map((item) => (
                <div
                  key={item.concept}
                  className="rounded-lg border border-blue-700/40 bg-blue-950/20 p-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-blue-200">
                        {item.concept}
                      </div>
                      <p className="text-xs text-blue-300/70 mt-1">
                        {item.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const category = title.includes("Asset") 
                          ? (title.includes("Current") ? "current_assets" : "fixed_assets")
                          : title.includes("Liability")
                          ? (title.includes("Current") ? "current_liabilities" : "non_current_liabilities")
                          : "equity";
                        handleAddFromSuggestion(item, category as BalanceSheetCategory);
                      }}
                      className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 transition ml-2"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CollapsibleSection>
    );
  };
  
  return (
    <CollapsibleSection
      sectionId="balance_sheet_all"
      title="Balance Sheet Builder"
      description="Build your Balance Sheet with Assets, Liabilities, and Equity. All items are organized by category."
      colorClass="green"
      defaultExpanded={true}
    >
      <div className="space-y-6">
        {/* Assets Section */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-green-200">ASSETS</h3>

          {/* Current Assets: items + collapsible suggestions + Add custom */}
          <CollapsibleSection
            sectionId="bs_current_assets"
            title="Current Assets"
            description="Current Assets items in the Balance Sheet"
            colorClass="blue"
            defaultExpanded={true}
          >
            <div className="space-y-3">
              {sections.currentAssets.map((row, index) => {
                const glossaryItem = findGlossaryItem(row.label);
                const isCalculated = row.kind === "calc" || row.kind === "total" || row.kind === "subtotal";
                const isTotalRow = row.id.startsWith("total_") || row.kind === "total" || row.kind === "subtotal";
                let computedValue: number | null = null;
                if (isCalculated) {
                  try {
                    computedValue = computeRowValue(row, years[0] || "", balanceSheet, balanceSheet, { incomeStatement: [], balanceSheet, cashFlow: [] });
                  } catch {
                    computedValue = null;
                  }
                }
                // Calculate index excluding total rows (for drag-and-drop)
                const reorderableIndex = sections.currentAssets.slice(0, index).filter((r) => !r.id.startsWith("total_") && r.kind !== "total" && r.kind !== "subtotal").length;
                return (
                  <div
                    key={row.id}
                    onDragOver={(e) => {
                      if (!isTotalRow) {
                        handleDragOver(e, row.id);
                      }
                    }}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => {
                      if (!isTotalRow) {
                        handleDrop(e, { category: "current_assets", rowId: row.id, toIndex: reorderableIndex });
                      }
                    }}
                  >
                    <UnifiedItemCard
                      row={row}
                      years={years}
                      meta={meta}
                      glossaryItem={glossaryItem}
                      isLocked={isLocked}
                      isCalculated={isCalculated}
                      autoValue={computedValue}
                      colorClass="blue"
                      onUpdateValue={updateRowValue.bind(null, "balanceSheet")}
                      onRemove={handleRemoveItem}
                      showRemove={!isTotalRow}
                      showConfirm={true}
                      protectedRows={protectedTotalRows}
                      draggable={!isLocked && !isTotalRow}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, { rowId: row.id, category: "current_assets", fromIndex: reorderableIndex });
                      }}
                      onDragOver={(e) => {
                        if (!isTotalRow) {
                          handleDragOver(e, row.id);
                        }
                      }}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => {
                        if (!isTotalRow) {
                          handleDrop(e, { category: "current_assets", rowId: row.id, toIndex: reorderableIndex });
                        }
                      }}
                      dragOverId={dragOverId}
                    />
                  </div>
                );
              })}
            </div>

            {!isLocked && caSuggestions.length > 0 && (
              <CollapsibleSection
                sectionId="bs_current_assets_suggestions"
                title="Current Asset suggestions"
                description="Common current asset items to add"
                colorClass="blue"
                defaultExpanded={false}
              >
                <div className="mt-2">
                  <div className="mb-2 text-xs font-semibold text-slate-300">
                    💡 Common Current Asset Items:
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {caSuggestions.slice(0, 8).map((item: any) => (
                      <div
                        key={item.concept}
                        className="rounded-lg border border-blue-700/40 bg-blue-950/20 p-3"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="text-sm font-medium text-blue-200">
                              {item.concept}
                            </div>
                            <p className="text-xs text-blue-300/70 mt-1">
                              {item.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddFromSuggestion(item, "current_assets")}
                            className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 transition ml-2"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {!isLocked && (
              <div className="mt-3">
                {!showAddCADialog ? (
                  <button
                    type="button"
                    onClick={() => setShowAddCADialog(true)}
                    className="rounded-md border border-blue-700/60 bg-blue-950/30 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-900/40 transition"
                  >
                    + Add custom current asset item
                  </button>
                ) : (
                  <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 p-3">
                    <label className="mb-2 block text-xs font-semibold text-blue-200">Item name</label>
                    <input
                      type="text"
                      value={newCALabel}
                      onChange={(e) => setNewCALabel(e.target.value)}
                      placeholder="e.g. Prepaid expenses, Short-term investments..."
                      className="w-full rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none mb-2"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCustomCA();
                        if (e.key === "Escape") { setShowAddCADialog(false); setNewCALabel(""); setCaMatchResult(null); }
                      }}
                      autoFocus
                    />
                    {notCurrentAssetWarning && (
                      <div className="mb-2 rounded-md border border-amber-600/50 bg-amber-950/30 p-2">
                        <p className="text-xs text-amber-200">
                          ⚠️ This item is typically classified as <strong>{knownCategoryForCALabel.replace(/_/g, " ")}</strong>, not Current Assets. You can still add it here if your model requires it.
                        </p>
                      </div>
                    )}
                    {caMatchResult?.matchedConcept && !notCurrentAssetWarning && (
                      <div className="mb-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
                        <p className="text-xs text-emerald-300">✓ {caMatchResult.matchedConcept.description}</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddCustomCA}
                        disabled={!newCALabel.trim() || caMatching}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                      >
                        {caMatching ? "Matching..." : "Add"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowAddCADialog(false); setNewCALabel(""); setCaMatchResult(null); }}
                        className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CollapsibleSection>

          {/* Fixed Assets: same pattern as Current Assets — items + collapsible suggestions + Add custom */}
          <CollapsibleSection
            sectionId="bs_fixed_assets"
            title="Fixed Assets"
            description="Fixed Assets items in the Balance Sheet"
            colorClass="green"
            defaultExpanded={true}
          >
            <div className="space-y-3">
              {sections.fixedAssets.map((row, index) => {
                const glossaryItem = findGlossaryItem(row.label);
                const isCalculated = row.kind === "calc" || row.kind === "total" || row.kind === "subtotal";
                const isTotalRow = row.id.startsWith("total_") || row.kind === "total" || row.kind === "subtotal";
                let computedValue: number | null = null;
                if (isCalculated) {
                  try {
                    computedValue = computeRowValue(row, years[0] || "", balanceSheet, balanceSheet, { incomeStatement: [], balanceSheet, cashFlow: [] });
                  } catch {
                    computedValue = null;
                  }
                }
                const reorderableIndex = sections.fixedAssets.slice(0, index).filter((r) => !r.id.startsWith("total_") && r.kind !== "total" && r.kind !== "subtotal").length;
                return (
                  <div
                    key={row.id}
                    onDragOver={(e) => {
                      if (!isTotalRow) handleDragOver(e, row.id);
                    }}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => {
                      if (!isTotalRow) handleDrop(e, { category: "fixed_assets", rowId: row.id, toIndex: reorderableIndex });
                    }}
                  >
                    <UnifiedItemCard
                      row={row}
                      years={years}
                      meta={meta}
                      glossaryItem={glossaryItem}
                      isLocked={isLocked}
                      isCalculated={isCalculated}
                      autoValue={computedValue}
                      colorClass="green"
                      onUpdateValue={updateRowValue.bind(null, "balanceSheet")}
                      onRemove={handleRemoveItem}
                      showRemove={!isTotalRow}
                      showConfirm={true}
                      protectedRows={protectedTotalRows}
                      draggable={!isLocked && !isTotalRow}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, { rowId: row.id, category: "fixed_assets", fromIndex: reorderableIndex });
                      }}
                      onDragOver={(e) => {
                        if (!isTotalRow) handleDragOver(e, row.id);
                      }}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => {
                        if (!isTotalRow) handleDrop(e, { category: "fixed_assets", rowId: row.id, toIndex: reorderableIndex });
                      }}
                      dragOverId={dragOverId}
                    />
                  </div>
                );
              })}
            </div>

            {!isLocked && faSuggestions.length > 0 && (
              <CollapsibleSection
                sectionId="bs_fixed_assets_suggestions"
                title="Fixed Asset suggestions"
                description="Common fixed asset items to add"
                colorClass="green"
                defaultExpanded={false}
              >
                <div className="mt-2">
                  <div className="mb-2 text-xs font-semibold text-slate-300">
                    💡 Common Fixed Asset Items:
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {faSuggestions.slice(0, 8).map((item: any) => (
                      <div
                        key={item.concept}
                        className="rounded-lg border border-green-700/40 bg-green-950/20 p-3"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="text-sm font-medium text-green-200">
                              {item.concept}
                            </div>
                            <p className="text-xs text-green-300/70 mt-1">
                              {item.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddFromSuggestion(item, "fixed_assets")}
                            className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-600 transition ml-2"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {!isLocked && (
              <div className="mt-3">
                {!showAddFADialog ? (
                  <button
                    type="button"
                    onClick={() => setShowAddFADialog(true)}
                    className="rounded-md border border-green-700/60 bg-green-950/30 px-3 py-2 text-xs font-semibold text-green-200 hover:bg-green-900/40 transition"
                  >
                    + Add custom fixed asset item
                  </button>
                ) : (
                  <div className="rounded-lg border border-green-800/40 bg-green-950/20 p-3">
                    <label className="mb-2 block text-xs font-semibold text-green-200">Item name</label>
                    <input
                      type="text"
                      value={newFALabel}
                      onChange={(e) => setNewFALabel(e.target.value)}
                      placeholder="e.g. PP&E, Goodwill, Intangible assets..."
                      className="w-full rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-green-500 focus:outline-none mb-2"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCustomFA();
                        if (e.key === "Escape") { setShowAddFADialog(false); setNewFALabel(""); setFaMatchResult(null); }
                      }}
                      autoFocus
                    />
                    {notFixedAssetWarning && (
                      <div className="mb-2 rounded-md border border-amber-600/50 bg-amber-950/30 p-2">
                        <p className="text-xs text-amber-200">
                          ⚠️ This item is typically classified as <strong>{knownCategoryForFALabel?.replace(/_/g, " ")}</strong>, not Fixed Assets. You can still add it here if your model requires it.
                        </p>
                      </div>
                    )}
                    {faMatchResult?.matchedConcept && !notFixedAssetWarning && (
                      <div className="mb-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
                        <p className="text-xs text-emerald-300">✓ {faMatchResult.matchedConcept.description}</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddCustomFA}
                        disabled={!newFALabel.trim() || faMatching}
                        className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-50"
                      >
                        {faMatching ? "Matching..." : "Add"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowAddFADialog(false); setNewFALabel(""); setFaMatchResult(null); }}
                        className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CollapsibleSection>
        </div>
        
        {/* Liabilities Section */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-orange-200">LIABILITIES</h3>

          {/* Current Liabilities: same pattern as Current Assets / Fixed Assets */}
          <CollapsibleSection
            sectionId="bs_current_liabilities"
            title="Current Liabilities"
            description="Current Liabilities items in the Balance Sheet"
            colorClass="orange"
            defaultExpanded={true}
          >
            <div className="space-y-3">
              {sections.currentLiabilities.map((row, index) => {
                const glossaryItem = findGlossaryItem(row.label);
                const isCalculated = row.kind === "calc" || row.kind === "total" || row.kind === "subtotal";
                const isTotalRow = row.id.startsWith("total_") || row.kind === "total" || row.kind === "subtotal";
                let computedValue: number | null = null;
                if (isCalculated) {
                  try {
                    computedValue = computeRowValue(row, years[0] || "", balanceSheet, balanceSheet, { incomeStatement: [], balanceSheet, cashFlow: [] });
                  } catch {
                    computedValue = null;
                  }
                }
                const reorderableIndex = sections.currentLiabilities.slice(0, index).filter((r) => !r.id.startsWith("total_") && r.kind !== "total" && r.kind !== "subtotal").length;
                return (
                  <div
                    key={row.id}
                    onDragOver={(e) => {
                      if (!isTotalRow) handleDragOver(e, row.id);
                    }}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => {
                      if (!isTotalRow) handleDrop(e, { category: "current_liabilities", rowId: row.id, toIndex: reorderableIndex });
                    }}
                  >
                    <UnifiedItemCard
                      row={row}
                      years={years}
                      meta={meta}
                      glossaryItem={glossaryItem}
                      isLocked={isLocked}
                      isCalculated={isCalculated}
                      autoValue={computedValue}
                      colorClass="orange"
                      onUpdateValue={updateRowValue.bind(null, "balanceSheet")}
                      onRemove={handleRemoveItem}
                      showRemove={!isTotalRow}
                      showConfirm={true}
                      protectedRows={protectedTotalRows}
                      draggable={!isLocked && !isTotalRow}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, { rowId: row.id, category: "current_liabilities", fromIndex: reorderableIndex });
                      }}
                      onDragOver={(e) => {
                        if (!isTotalRow) handleDragOver(e, row.id);
                      }}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => {
                        if (!isTotalRow) handleDrop(e, { category: "current_liabilities", rowId: row.id, toIndex: reorderableIndex });
                      }}
                      dragOverId={dragOverId}
                    />
                  </div>
                );
              })}
            </div>

            {!isLocked && clSuggestions.length > 0 && (
              <CollapsibleSection
                sectionId="bs_current_liabilities_suggestions"
                title="Current Liability suggestions"
                description="Common current liability items to add"
                colorClass="orange"
                defaultExpanded={false}
              >
                <div className="mt-2">
                  <div className="mb-2 text-xs font-semibold text-slate-300">
                    💡 Common Current Liability Items:
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {clSuggestions.slice(0, 8).map((item: any) => (
                      <div
                        key={item.concept}
                        className="rounded-lg border border-orange-700/40 bg-orange-950/20 p-3"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="text-sm font-medium text-orange-200">
                              {item.concept}
                            </div>
                            <p className="text-xs text-orange-300/70 mt-1">
                              {item.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddFromSuggestion(item, "current_liabilities")}
                            className="rounded-md bg-orange-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 transition ml-2"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {!isLocked && (
              <div className="mt-3">
                {!showAddCLDialog ? (
                  <button
                    type="button"
                    onClick={() => setShowAddCLDialog(true)}
                    className="rounded-md border border-orange-700/60 bg-orange-950/30 px-3 py-2 text-xs font-semibold text-orange-200 hover:bg-orange-900/40 transition"
                  >
                    + Add custom current liability item
                  </button>
                ) : (
                  <div className="rounded-lg border border-orange-800/40 bg-orange-950/20 p-3">
                    <label className="mb-2 block text-xs font-semibold text-orange-200">Item name</label>
                    <input
                      type="text"
                      value={newCLLabel}
                      onChange={(e) => setNewCLLabel(e.target.value)}
                      placeholder="e.g. Accounts payable, Accrued expenses, Deferred revenue..."
                      className="w-full rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-orange-500 focus:outline-none mb-2"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCustomCL();
                        if (e.key === "Escape") { setShowAddCLDialog(false); setNewCLLabel(""); setClMatchResult(null); }
                      }}
                      autoFocus
                    />
                    {notCurrentLiabilityWarning && (
                      <div className="mb-2 rounded-md border border-amber-600/50 bg-amber-950/30 p-2">
                        <p className="text-xs text-amber-200">
                          ⚠️ This item is typically classified as <strong>{knownCategoryForCLLabel?.replace(/_/g, " ")}</strong>, not Current Liabilities. You can still add it here if your model requires it.
                        </p>
                      </div>
                    )}
                    {clMatchResult?.matchedConcept && !notCurrentLiabilityWarning && (
                      <div className="mb-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
                        <p className="text-xs text-emerald-300">✓ {clMatchResult.matchedConcept.description}</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddCustomCL}
                        disabled={!newCLLabel.trim() || clMatching}
                        className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                      >
                        {clMatching ? "Matching..." : "Add"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowAddCLDialog(false); setNewCLLabel(""); setClMatchResult(null); }}
                        className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CollapsibleSection>

          {/* Non-Current Liabilities: same pattern as Current Liabilities */}
          <CollapsibleSection
            sectionId="bs_non_current_liabilities"
            title="Non-Current Liabilities"
            description="Non-Current Liabilities items in the Balance Sheet"
            colorClass="red"
            defaultExpanded={true}
          >
            <div className="space-y-3">
              {sections.nonCurrentLiabilities.map((row, index) => {
                const glossaryItem = findGlossaryItem(row.label);
                const isCalculated = row.kind === "calc" || row.kind === "total" || row.kind === "subtotal";
                const isTotalRow = row.id.startsWith("total_") || row.kind === "total" || row.kind === "subtotal";
                let computedValue: number | null = null;
                if (isCalculated) {
                  try {
                    computedValue = computeRowValue(row, years[0] || "", balanceSheet, balanceSheet, { incomeStatement: [], balanceSheet, cashFlow: [] });
                  } catch {
                    computedValue = null;
                  }
                }
                const reorderableIndex = sections.nonCurrentLiabilities.slice(0, index).filter((r) => !r.id.startsWith("total_") && r.kind !== "total" && r.kind !== "subtotal").length;
                return (
                  <div
                    key={row.id}
                    onDragOver={(e) => {
                      if (!isTotalRow) handleDragOver(e, row.id);
                    }}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => {
                      if (!isTotalRow) handleDrop(e, { category: "non_current_liabilities", rowId: row.id, toIndex: reorderableIndex });
                    }}
                  >
                    <UnifiedItemCard
                      row={row}
                      years={years}
                      meta={meta}
                      glossaryItem={glossaryItem}
                      isLocked={isLocked}
                      isCalculated={isCalculated}
                      autoValue={computedValue}
                      colorClass="red"
                      onUpdateValue={updateRowValue.bind(null, "balanceSheet")}
                      onRemove={handleRemoveItem}
                      showRemove={!isTotalRow}
                      showConfirm={true}
                      protectedRows={protectedTotalRows}
                      draggable={!isLocked && !isTotalRow}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, { rowId: row.id, category: "non_current_liabilities", fromIndex: reorderableIndex });
                      }}
                      onDragOver={(e) => {
                        if (!isTotalRow) handleDragOver(e, row.id);
                      }}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => {
                        if (!isTotalRow) handleDrop(e, { category: "non_current_liabilities", rowId: row.id, toIndex: reorderableIndex });
                      }}
                      dragOverId={dragOverId}
                    />
                  </div>
                );
              })}
            </div>

            {!isLocked && nclSuggestions.length > 0 && (
              <CollapsibleSection
                sectionId="bs_non_current_liabilities_suggestions"
                title="Non-Current Liability suggestions"
                description="Common non-current liability items to add"
                colorClass="red"
                defaultExpanded={false}
              >
                <div className="mt-2">
                  <div className="mb-2 text-xs font-semibold text-slate-300">
                    💡 Common Non-Current Liability Items:
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {nclSuggestions.slice(0, 8).map((item: any) => (
                      <div
                        key={item.concept}
                        className="rounded-lg border border-red-700/40 bg-red-950/20 p-3"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="text-sm font-medium text-red-200">
                              {item.concept}
                            </div>
                            <p className="text-xs text-red-300/70 mt-1">
                              {item.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddFromSuggestion(item, "non_current_liabilities")}
                            className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 transition ml-2"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {!isLocked && (
              <div className="mt-3">
                {!showAddNCLDialog ? (
                  <button
                    type="button"
                    onClick={() => setShowAddNCLDialog(true)}
                    className="rounded-md border border-red-700/60 bg-red-950/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-900/40 transition"
                  >
                    + Add custom non-current liability item
                  </button>
                ) : (
                  <div className="rounded-lg border border-red-800/40 bg-red-950/20 p-3">
                    <label className="mb-2 block text-xs font-semibold text-red-200">Item name</label>
                    <input
                      type="text"
                      value={newNCLLabel}
                      onChange={(e) => setNewNCLLabel(e.target.value)}
                      placeholder="e.g. Long-term debt, Deferred tax liabilities, Lease liabilities..."
                      className="w-full rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-red-500 focus:outline-none mb-2"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCustomNCL();
                        if (e.key === "Escape") { setShowAddNCLDialog(false); setNewNCLLabel(""); setNclMatchResult(null); }
                      }}
                      autoFocus
                    />
                    {notNonCurrentLiabilityWarning && (
                      <div className="mb-2 rounded-md border border-amber-600/50 bg-amber-950/30 p-2">
                        <p className="text-xs text-amber-200">
                          ⚠️ This item is typically classified as <strong>{knownCategoryForNCLLabel?.replace(/_/g, " ")}</strong>, not Non-Current Liabilities. You can still add it here if your model requires it.
                        </p>
                      </div>
                    )}
                    {nclMatchResult?.matchedConcept && !notNonCurrentLiabilityWarning && (
                      <div className="mb-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
                        <p className="text-xs text-emerald-300">✓ {nclMatchResult.matchedConcept.description}</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddCustomNCL}
                        disabled={!newNCLLabel.trim() || nclMatching}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                      >
                        {nclMatching ? "Matching..." : "Add"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowAddNCLDialog(false); setNewNCLLabel(""); setNclMatchResult(null); }}
                        className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CollapsibleSection>
        </div>
        
        {/* Equity Section (Shareholders' Equity) */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-purple-200">SHAREHOLDERS&apos; EQUITY</h3>

          <CollapsibleSection
            sectionId="bs_equity"
            title="Shareholders' Equity"
            description="Shareholders' Equity items in the Balance Sheet"
            colorClass="purple"
            defaultExpanded={true}
          >
            <div className="space-y-3">
              {sections.equity.map((row, index) => {
                const glossaryItem = findGlossaryItem(row.label);
                const isCalculated = row.kind === "calc" || row.kind === "total" || row.kind === "subtotal";
                const isTotalRow = row.id.startsWith("total_") || row.kind === "total" || row.kind === "subtotal";
                let computedValue: number | null = null;
                if (isCalculated) {
                  try {
                    computedValue = computeRowValue(row, years[0] || "", balanceSheet, balanceSheet, { incomeStatement: [], balanceSheet, cashFlow: [] });
                  } catch {
                    computedValue = null;
                  }
                }
                const reorderableIndex = sections.equity.slice(0, index).filter((r) => !r.id.startsWith("total_") && r.kind !== "total" && r.kind !== "subtotal").length;
                return (
                  <div
                    key={row.id}
                    onDragOver={(e) => {
                      if (!isTotalRow) handleDragOver(e, row.id);
                    }}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => {
                      if (!isTotalRow) handleDrop(e, { category: "equity", rowId: row.id, toIndex: reorderableIndex });
                    }}
                  >
                    <UnifiedItemCard
                      row={row}
                      years={years}
                      meta={meta}
                      glossaryItem={glossaryItem}
                      isLocked={isLocked}
                      isCalculated={isCalculated}
                      autoValue={computedValue}
                      colorClass="purple"
                      onUpdateValue={updateRowValue.bind(null, "balanceSheet")}
                      onRemove={handleRemoveItem}
                      showRemove={!isTotalRow}
                      showConfirm={true}
                      protectedRows={protectedTotalRows}
                      draggable={!isLocked && !isTotalRow}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, { rowId: row.id, category: "equity", fromIndex: reorderableIndex });
                      }}
                      onDragOver={(e) => {
                        if (!isTotalRow) handleDragOver(e, row.id);
                      }}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => {
                        if (!isTotalRow) handleDrop(e, { category: "equity", rowId: row.id, toIndex: reorderableIndex });
                      }}
                      dragOverId={dragOverId}
                    />
                  </div>
                );
              })}
            </div>

            {!isLocked && equitySuggestions.length > 0 && (
              <CollapsibleSection
                sectionId="bs_equity_suggestions"
                title="Equity suggestions"
                description="Common shareholders' equity items to add"
                colorClass="purple"
                defaultExpanded={false}
              >
                <div className="mt-2">
                  <div className="mb-2 text-xs font-semibold text-slate-300">
                    💡 Common Shareholders&apos; Equity Items:
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {equitySuggestions.slice(0, 8).map((item: any) => (
                      <div
                        key={item.concept}
                        className="rounded-lg border border-purple-700/40 bg-purple-950/20 p-3"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="text-sm font-medium text-purple-200">
                              {item.concept}
                            </div>
                            <p className="text-xs text-purple-300/70 mt-1">
                              {item.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddFromSuggestion(item, "equity")}
                            className="rounded-md bg-purple-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-600 transition ml-2"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {!isLocked && (
              <div className="mt-3">
                {!showAddEquityDialog ? (
                  <button
                    type="button"
                    onClick={() => setShowAddEquityDialog(true)}
                    className="rounded-md border border-purple-700/60 bg-purple-950/30 px-3 py-2 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 transition"
                  >
                    + Add custom equity item
                  </button>
                ) : (
                  <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 p-3">
                    <label className="mb-2 block text-xs font-semibold text-purple-200">Item name</label>
                    <input
                      type="text"
                      value={newEquityLabel}
                      onChange={(e) => setNewEquityLabel(e.target.value)}
                      placeholder="e.g. Common stock, Retained earnings, Treasury stock..."
                      className="w-full rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-purple-500 focus:outline-none mb-2"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCustomEquity();
                        if (e.key === "Escape") { setShowAddEquityDialog(false); setNewEquityLabel(""); setEquityMatchResult(null); }
                      }}
                      autoFocus
                    />
                    {notEquityWarning && (
                      <div className="mb-2 rounded-md border border-amber-600/50 bg-amber-950/30 p-2">
                        <p className="text-xs text-amber-200">
                          ⚠️ This item is typically classified as <strong>{knownCategoryForEquityLabel?.replace(/_/g, " ")}</strong>, not Shareholders&apos; Equity. You can still add it here if your model requires it.
                        </p>
                      </div>
                    )}
                    {equityMatchResult?.matchedConcept && !notEquityWarning && (
                      <div className="mb-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
                        <p className="text-xs text-emerald-300">✓ {equityMatchResult.matchedConcept.description}</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddCustomEquity}
                        disabled={!newEquityLabel.trim() || equityMatching}
                        className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
                      >
                        {equityMatching ? "Matching..." : "Add"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowAddEquityDialog(false); setNewEquityLabel(""); setEquityMatchResult(null); }}
                        className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CollapsibleSection>
        </div>
        
        {/* Total Rows */}
        {sections.totals.totalAssets && (
          <div className="mt-6 rounded-lg border-2 border-green-800/40 bg-green-950/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-green-200">
                {sections.totals.totalAssets.label}
              </span>
              <span className="text-xs text-slate-400 italic">(Calculated)</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {years.map((year) => {
                let computedValue: number;
                try {
                  computedValue = computeRowValue(
                    sections.totals.totalAssets!,
                    year,
                    balanceSheet,
                    balanceSheet,
                    { incomeStatement: [], balanceSheet, cashFlow: [] }
                  );
                } catch {
                  computedValue = 0;
                }
                const displayValue = storedToDisplay(computedValue, meta?.currencyUnit);
                const unitLabel = getUnitLabel(meta?.currencyUnit);
                
                return (
                  <div key={year} className="flex flex-col">
                    <label className="text-xs text-green-300/80 mb-1">{year}</label>
                    <div className="rounded-md border border-green-700/40 bg-green-950/40 px-2 py-1.5 text-sm font-semibold text-green-200">
                      {computedValue !== 0 ? `${displayValue}${unitLabel ? ` ${unitLabel}` : ""}` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* Add Custom Item */}
        {!isLocked && (
          <div className="mt-6">
            {!showAddDialog ? (
              <button
                type="button"
                onClick={() => setShowAddDialog(true)}
                className="rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:opacity-80 transition"
              >
                + Add Custom Balance Sheet Item
              </button>
            ) : (
              <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                <div className="mb-3">
                  <label className="mb-2 block text-xs font-semibold text-slate-300">
                    Select Category:
                  </label>
                  <select
                    value={selectedCategory || ""}
                    onChange={(e) => setSelectedCategory(e.target.value as BalanceSheetCategory)}
                    className="w-full rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select a category...</option>
                    <option value="current_assets">Current Assets</option>
                    <option value="fixed_assets">Fixed Assets</option>
                    <option value="current_liabilities">Current Liabilities</option>
                    <option value="non_current_liabilities">Non-Current Liabilities</option>
                    <option value="equity">Equity</option>
                  </select>
                </div>
                
                <input
                  type="text"
                  value={newItemLabel}
                  onChange={(e) => setNewItemLabel(e.target.value)}
                  placeholder="Enter item name (e.g., Prepaid Expenses)..."
                  className="w-full rounded border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none mb-2"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !validationError && matchResult?.shouldAllow && selectedCategory) {
                      handleAddCustom();
                    } else if (e.key === "Escape") {
                      setShowAddDialog(false);
                      setNewItemLabel("");
                      setSelectedCategory(null);
                    }
                  }}
                  disabled={!selectedCategory}
                  autoFocus
                />
                
                {/* Validation Error */}
                {validationError && (
                  <div className="mb-2 rounded-md border border-red-700/40 bg-red-950/20 p-2">
                    <div className="text-xs text-red-300">⚠️ {validationError}</div>
                  </div>
                )}
                
                {/* Match Result */}
                {matchResult && matchResult.matchedConcept && !validationError && (
                  <div className="mb-2 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-2">
                    <div className="text-xs text-emerald-300">
                      ✅ Matched: <strong>{matchResult.matchedConcept.concept}</strong>
                    </div>
                    <div className="text-xs text-emerald-300/70 mt-1">
                      {matchResult.matchedConcept.description}
                    </div>
                    {matchResult.confidence < 0.8 && (
                      <div className="text-xs text-amber-300/70 mt-1">
                        ⚠️ Confidence: {Math.round(matchResult.confidence * 100)}% - Please verify this is correct
                      </div>
                    )}
                  </div>
                )}
                
                {/* Suggestions */}
                {matchResult && matchResult.suggestions.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs text-slate-400 mb-1">Did you mean:</div>
                    {matchResult.suggestions.slice(0, 3).map((suggestion: any) => (
                      <button
                        key={suggestion.concept}
                        type="button"
                        onClick={() => {
                          setNewItemLabel(suggestion.concept);
                        }}
                        className="mr-2 mb-1 rounded-md border border-blue-700/40 bg-blue-950/20 px-2 py-1 text-xs text-blue-300 hover:bg-blue-900/40"
                      >
                        {suggestion.concept}
                      </button>
                    ))}
                  </div>
                )}
                
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddCustom}
                    disabled={!newItemLabel.trim() || !selectedCategory || (validationError && !matchResult?.shouldAllow) || isMatching}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isMatching ? "Matching..." : "Add"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddDialog(false);
                      setNewItemLabel("");
                      setSelectedCategory(null);
                      setValidationError(null);
                      setMatchResult(null);
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
