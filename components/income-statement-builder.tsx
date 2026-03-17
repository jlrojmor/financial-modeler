"use client";

import { useEffect, useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { findGlossaryItem } from "@/lib/financial-glossary";
import UnifiedItemCard from "@/components/unified-item-card";
import CollapsibleSection from "@/components/collapsible-section";
import { computeRowValue } from "@/lib/calculations";
import { getIsRowsMissingClassification, getIsRowsClassifiedCustom, getIsSectionKey } from "@/lib/is-classification";
import { getFallbackIsClassification } from "@/lib/is-fallback-classify";
import { buildModelingContext, getSuggestionReasoningFromContext } from "@/lib/modeling-context";
import { getSectionOwnerOrderForProfile } from "@/lib/company-aware-suggestions";
import { getFinalRowClassificationState } from "@/lib/final-row-classification";
import SbcOptionalSection from "@/components/sbc-optional-section";
import AmortizationOptionalSection from "@/components/amortization-optional-section";
import DepreciationOptionalSection from "@/components/depreciation-optional-section";
import RestructuringOptionalSection from "@/components/restructuring-optional-section";

type ISClassifySuggestion = {
  sectionOwner: Row["sectionOwner"];
  isOperating: boolean;
  confidence: number;
  reason: string;
};

/**
 * Unified Income Statement Builder
 * 
 * Replaces fragmented builders (revenue-cogs, sga, dana, etc.) with a single
 * unified builder that uses the same pattern as BS and CFS builders.
 * 
 * Features:
 * - Common suggestions from glossary
 * - AI matching for manual additions
 * - Expand/collapse items
 * - Edit/Confirm/Remove functionality
 * - Organized by sections
 */
export default function IncomeStatementBuilder() {
  const meta = useModelStore((s) => s.meta);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const insertRow = useModelStore((s) => s.insertRow);
  const removeRow = useModelStore((s) => s.removeRow);
  const addChildRow = useModelStore((s) => s.addChildRow);
  const reorderIncomeStatementChildren = useModelStore((s) => s.reorderIncomeStatementChildren);
  const reorderIncomeStatementRows = useModelStore((s) => s.reorderIncomeStatementRows);
  const updateIncomeStatementRowMetadata = useModelStore((s) => s.updateIncomeStatementRowMetadata);
  const confirmRowReview = useModelStore((s) => s.confirmRowReview);
  const renameRow = useModelStore((s) => s.renameRow);
  const companyContext = useModelStore((s) => s.companyContext);

  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [editingLabelRowId, setEditingLabelRowId] = useState<string | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState("");
  const [dragOverTopLevelId, setDragOverTopLevelId] = useState<string | null>(null);
  const [newBreakdownLabels, setNewBreakdownLabels] = useState<Record<string, string>>({});
  const [showAddBreakdown, setShowAddBreakdown] = useState<Record<string, boolean>>({});
  const [showAddInterestDialog, setShowAddInterestDialog] = useState(false);
  const [newInterestLabel, setNewInterestLabel] = useState("");
  const [pendingAiSuggestions, setPendingAiSuggestions] = useState<Record<string, ISClassifySuggestion>>({});
  const [isClassifyLoading, setIsClassifyLoading] = useState(false);
  const [lastAddedOpexLabel, setLastAddedOpexLabel] = useState<string | null>(null);

  // After adding a child under operating_expenses, run AI classification (store already set fallback from label)
  useEffect(() => {
    if (!lastAddedOpexLabel || !incomeStatement?.length) return;
    const opEx = incomeStatement.find((r) => r.id === "operating_expenses");
    const child = opEx?.children?.find((c) => c.label === lastAddedOpexLabel);
    if (child) {
      runIsClassifyAndApply(child.id, child.label, "Operating Expenses");
      setLastAddedOpexLabel(null);
    }
  }, [lastAddedOpexLabel, incomeStatement]);

  const years = useMemo(() => {
    return meta?.years?.historical ?? [];
  }, [meta]);
  
  const isLocked = useModelStore((s) => s.sectionLocks["income_statement"] ?? false);

  const rowsMissingIsClassification = useMemo(
    () => getIsRowsMissingClassification(incomeStatement ?? []),
    [incomeStatement]
  );
  const rowsClassifiedCustom = useMemo(
    () => getIsRowsClassifiedCustom(incomeStatement ?? []),
    [incomeStatement]
  );

  const flattenIsRows = (rows: Row[]): Row[] =>
    rows.flatMap((r) => [r, ...(r.children?.length ? flattenIsRows(r.children) : [])]);

  const rowsWithPendingSuggestion = useMemo(() => {
    const flat = flattenIsRows(incomeStatement ?? []);
    return flat.filter((r) => Object.prototype.hasOwnProperty.call(pendingAiSuggestions, r.id));
  }, [incomeStatement, pendingAiSuggestions]);

  const rowsNeedingReview = useMemo(() => {
    const missingIds = new Set(rowsMissingIsClassification.map((r) => r.id));
    const fromPending = rowsWithPendingSuggestion.filter((r) => !missingIds.has(r.id));
    return [...rowsMissingIsClassification, ...fromPending];
  }, [rowsMissingIsClassification, rowsWithPendingSuggestion]);

  const rowsAlreadyClassified = useMemo(
    () => rowsClassifiedCustom.filter((r) => !Object.prototype.hasOwnProperty.call(pendingAiSuggestions, r.id)),
    [rowsClassifiedCustom, pendingAiSuggestions]
  );

  const [showReviewClassified, setShowReviewClassified] = useState(false);
  const [showChangeDropdownForId, setShowChangeDropdownForId] = useState<Record<string, boolean>>({});

  const allStatementsForCalc = useMemo(
    () => ({ incomeStatement: incomeStatement ?? [], balanceSheet: [], cashFlow: [] }),
    [incomeStatement]
  );
  const validationWarnings = useMemo(() => {
    const warnings: { year: string; type: "gross_margin" | "ebit_margin" | "net_margin"; value: number }[] = [];
    if (!years.length || !incomeStatement?.length) return warnings;
    for (const year of years) {
      try {
        const rev = computeRowValue(
          incomeStatement.find((r) => r.id === "rev")!,
          year,
          incomeStatement,
          incomeStatement,
          allStatementsForCalc
        );
        const grossMargin = rev !== 0 ? computeRowValue(
          incomeStatement.find((r) => r.id === "gross_margin")!,
          year,
          incomeStatement,
          incomeStatement,
          allStatementsForCalc
        ) : 0;
        const ebitMargin = rev !== 0 ? computeRowValue(
          incomeStatement.find((r) => r.id === "ebit_margin")!,
          year,
          incomeStatement,
          incomeStatement,
          allStatementsForCalc
        ) : 0;
        const netMargin = rev !== 0 ? computeRowValue(
          incomeStatement.find((r) => r.id === "net_income_margin")!,
          year,
          incomeStatement,
          incomeStatement,
          allStatementsForCalc
        ) : 0;
        if (grossMargin < -100 || grossMargin > 100) warnings.push({ year, type: "gross_margin", value: grossMargin });
        if (ebitMargin < -200 || ebitMargin > 200) warnings.push({ year, type: "ebit_margin", value: ebitMargin });
        if (netMargin < -200 || netMargin > 200) warnings.push({ year, type: "net_margin", value: netMargin });
      } catch {
        // skip year if calc fails
      }
    }
    return warnings;
  }, [incomeStatement, years, allStatementsForCalc]);
  
  // Organize IS items by section. Operating Expenses = structural parent + children in stored order (user-controlled).
  const sections = useMemo(() => {
    const mainRows = incomeStatement ?? [];
    const key = (r: Row) => getIsSectionKey(r);

    const revenue = mainRows.filter(r => key(r) === "revenue");
    const cogs = mainRows.filter(r => key(r) === "cogs");
    const interest = mainRows.filter(r => key(r) === "interest");
    const tax = mainRows.filter(r => key(r) === "tax");

    const opExRow = mainRows.find(r => r.id === "operating_expenses");
    const opexChildren = opExRow ? (opExRow.children ?? []) : [];
    const operatingExpenses = opExRow ? [opExRow, ...opexChildren] : [...mainRows.filter(r => key(r) === "sga"), ...mainRows.filter(r => key(r) === "rd"), ...mainRows.filter(r => key(r) === "other_operating")];
    const sga: Row[] = [];
    const rd: Row[] = [];
    const other_operating: Row[] = [];

    return {
      revenue,
      cogs,
      sga,
      rd,
      other_operating,
      operatingExpenses,
      interest,
      tax,
    };
  }, [incomeStatement]);
  
  const handleDragStart = (e: React.DragEvent, payload: { parentId: string; childId: string; fromIndex: number }) => {
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
    target: { parentId: string; childId: string; toIndex: number }
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    let payload: { parentId: string; childId: string; fromIndex: number };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const { parentId: draggedParentId, childId: draggedChildId, fromIndex } = payload;
    
    // Only allow drops within the same parent
    if (draggedParentId !== target.parentId) return;
    // Don't reorder if dropping on itself
    if (draggedChildId === target.childId) return;
    
    const toIndex = target.toIndex;
    const adjustedToIndex = fromIndex < toIndex ? toIndex : toIndex;
    
    if (fromIndex !== adjustedToIndex) {
      reorderIncomeStatementChildren(draggedParentId, fromIndex, adjustedToIndex);
    }
  };

  // Drag-and-drop for top-level rows (Interest & Other section)
  const handleDragStartTopLevel = (e: React.DragEvent, fromIndex: number) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ fromIndex, type: "is_top_level" }));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOverTopLevel = (e: React.DragEvent, rowId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTopLevelId(rowId);
  };

  const handleDragLeaveTopLevel = () => {
    setDragOverTopLevelId(null);
  };

  const handleDropTopLevel = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTopLevelId(null);
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    let payload: { fromIndex: number; type: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.type !== "is_top_level") return;
    const { fromIndex } = payload;
    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    if (fromIndex !== adjustedToIndex) {
      reorderIncomeStatementRows(fromIndex, adjustedToIndex);
    }
  };

  const runIsClassifyAndApply = async (
    rowId: string,
    label: string,
    parentContext: string,
    historicalValues?: Record<string, number>
  ) => {
    setIsClassifyLoading(true);
    setPendingAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
    let appliedSource: "ai" | "fallback" | "user" | "pending" = "fallback";
    let appliedSectionOwner: Row["sectionOwner"] = "other_operating";
    let appliedIsOperating = true;
    let appliedConfidence = 0;
    try {
      const res = await fetch("/api/ai/is-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ label, parentContext, nearbySection: parentContext, historicalValues }],
          companyContext: companyContext ?? undefined,
        }),
      });
      const data = await res.json();
      const suggestions = data.suggestions as ISClassifySuggestion[] | undefined;
      const s = Array.isArray(suggestions) && suggestions[0] ? suggestions[0] : null;
      if (s && s.confidence > 0.75) {
        appliedSource = "ai";
        appliedSectionOwner = s.sectionOwner;
        appliedIsOperating = s.isOperating;
        appliedConfidence = s.confidence;
        updateIncomeStatementRowMetadata(rowId, {
          sectionOwner: s.sectionOwner,
          isOperating: s.isOperating,
          classificationSource: "ai",
          classificationReason: s.reason,
          classificationConfidence: s.confidence,
        });
      } else if (s) {
        setPendingAiSuggestions((prev) => ({ ...prev, [rowId]: s }));
        appliedSectionOwner = s.sectionOwner;
        appliedIsOperating = s.isOperating;
        appliedConfidence = s.confidence;
        appliedSource = "pending";
      } else {
        const fallback = getFallbackIsClassification(label);
        appliedSectionOwner = fallback.sectionOwner;
        appliedIsOperating = fallback.isOperating;
        const fallbackReason = getSuggestionReasoningFromContext(buildModelingContext(companyContext) ?? null, "is_classification");
        updateIncomeStatementRowMetadata(rowId, {
          sectionOwner: fallback.sectionOwner,
          isOperating: fallback.isOperating,
          classificationSource: "fallback",
          classificationReason: fallbackReason ?? undefined,
        });
      }
    } catch {
      const fallback = getFallbackIsClassification(label);
      appliedSectionOwner = fallback.sectionOwner;
      appliedIsOperating = fallback.isOperating;
      const fallbackReason = getSuggestionReasoningFromContext(buildModelingContext(companyContext) ?? null, "is_classification");
      updateIncomeStatementRowMetadata(rowId, {
        sectionOwner: fallback.sectionOwner,
        isOperating: fallback.isOperating,
        classificationSource: "fallback",
        classificationReason: fallbackReason ?? undefined,
      });
    } finally {
      if (appliedSource === "ai") appliedConfidence = (await (async () => {
        const flat = (rows: Row[]): Row[] => rows.flatMap((r) => [r, ...(r.children?.length ? flat(r.children) : [])]);
        const r = flat(incomeStatement ?? []).find((x) => x.id === rowId);
        return r?.classificationConfidence ?? 0;
      })()) ?? 0;
      console.log(
        "IS AI CLASSIFICATION RESULT: label:",
        label,
        "sectionOwner:",
        appliedSectionOwner,
        "isOperating:",
        appliedIsOperating,
        "confidence:",
        appliedSource === "ai" ? appliedConfidence : appliedSource === "pending" ? appliedConfidence : "(fallback)",
        "classificationSource:",
        appliedSource
      );
      setIsClassifyLoading(false);
    }
  };

  const handleRemoveItem = (rowId: string) => {
    const calculatedOutputItems = [
      "gross_profit", "gross_margin",
      "ebit", "ebit_margin",
      "ebt", "ebt_margin",
      "net_income", "net_income_margin"
    ];
    const coreInputItems = ["rev", "cogs", "tax", "operating_expenses"];
    const protectedRows = [...calculatedOutputItems, ...coreInputItems];
    if (protectedRows.includes(rowId)) return;
    removeRow("incomeStatement", rowId);
  };

  const handleEditRow = (rowId: string) => {
    const row = incomeStatement?.find((r) => r.id === rowId)
      ?? incomeStatement?.flatMap((r) => r.children ?? []).find((c) => c.id === rowId);
    if (row) {
      setEditingLabelRowId(rowId);
      setEditingLabelValue(row.label);
    }
  };

  const handleSaveEditRowLabel = () => {
    if (editingLabelRowId && editingLabelValue.trim()) {
      renameRow("incomeStatement", editingLabelRowId, editingLabelValue.trim());
      setEditingLabelRowId(null);
      setEditingLabelValue("");
    }
  };
  
  const renderSection = (
    title: string,
    items: Row[],
    colorClass: "blue" | "green" | "purple" | "amber" | "slate" | "orange" = "slate",
    sectionId: string,
    showSuggestions: boolean = false
  ) => {
    // For Interest & Other section, always show it (to show suggestions and allow adding items)
    // For other sections, only show if they have items
    if (!showSuggestions && items.length === 0) {
      return null;
    }
    
    const isInterestSection = sectionId === "is_interest";
    
    return (
      <CollapsibleSection
        sectionId={sectionId}
        title={title}
        description={`${title} items in the Income Statement`}
        colorClass={colorClass}
        defaultExpanded={true}
      >
        <div className="space-y-3">
          {sectionId === "is_operating_expenses" && items.length > 0 && (() => {
            const childIds = items.length > 1 ? items.slice(1).map((r) => r.id) : [];
            console.log("OPERATING_EXPENSES_CHILD_IDS:", childIds);
            return null;
          })()}
          {items.map((row, itemIndex) => {
            const globalIndex = incomeStatement.findIndex((r) => r.id === row.id);
            const isOperatingExpensesSection = sectionId === "is_operating_expenses";
            const isOpExParent = isOperatingExpensesSection && row.id === "operating_expenses";
            const isOpExChild = isOperatingExpensesSection && itemIndex > 0;
            const opExParentId = "operating_expenses";
            const opExChildIndex = isOpExChild ? itemIndex - 1 : 0;
            if (isOpExChild) console.log("RENDERING OPEX CHILD ROW:", row.id);
            const glossaryItem = findGlossaryItem(row.label);
            const isCalculated = (row.kind === "calc" || row.kind === "total") && 
                                 !["rev", "cogs", "sga", "danda", "tax", "interest_expense", "interest_income", "other_income"].includes(row.id);
            
            // All calculated/output items that cannot be removed
            // These are outputs/calculations, not user inputs (operating_expenses = structural parent, sum of children)
            const calculatedOutputItems = [
              "gross_profit", "gross_margin",
              "operating_expenses",
              "ebit", "ebit_margin",
              "ebt", "ebt_margin",
              "net_income", "net_income_margin"
            ];
            
            // Core anchors; operating-expense children (sga, rd, custom) are not protected
            const coreInputItems = ["rev", "cogs", "tax", "operating_expenses"];
            const allProtectedItems = [...calculatedOutputItems, ...coreInputItems];
            
            // Check if this is a calculated output (should never show remove button)
            const isCalculatedOutput = calculatedOutputItems.includes(row.id);
            
            // Check if it's a calculated row that needs special handling
            let computedValue: number | null = null;
            if (isCalculated || isCalculatedOutput) {
              try {
                computedValue = computeRowValue(
                  row,
                  years[0] || "",
                  incomeStatement,
                  incomeStatement,
                  { incomeStatement, balanceSheet: [], cashFlow: [] }
                );
              } catch {
                computedValue = null;
              }
            }
            
            // Breakdowns: rev, cogs, operating_expenses, and any child of operating_expenses
            const canHaveBreakdowns = ["rev", "cogs", "operating_expenses"].includes(row.id) || (isOperatingExpensesSection && isOpExChild);
            const hasChildren = row.children && row.children.length > 0;
            // Parent-child enforcement: parent value = sum(children); disable parent input when children exist
            const isParentWithChildren = canHaveBreakdowns && hasChildren;
            // Sign discipline: expense categories use absolute values only (no negative input); any child of operating_expenses is an expense
            const expenseRowIds = ["cogs", "sga", "rd", "danda", "interest_expense", "tax", "other_opex"];
            const allowNegative = !expenseRowIds.includes(row.id) && row.id !== "rev" && !(isOperatingExpensesSection && isOpExChild);

            return (
              <div
                key={row.id}
                className="space-y-2"
                {...(isInterestSection && {
                  onDragOver: (e: React.DragEvent) => handleDragOverTopLevel(e, row.id),
                  onDragLeave: handleDragLeaveTopLevel,
                  onDrop: (e: React.DragEvent) => handleDropTopLevel(e, globalIndex),
                })}
                {...(isOpExChild && {
                  onDragOver: (e: React.DragEvent) => handleDragOver(e, row.id),
                  onDragLeave: handleDragLeave,
                  onDrop: (e: React.DragEvent) => handleDrop(e, { parentId: opExParentId, childId: row.id, toIndex: opExChildIndex }),
                })}
              >
                <UnifiedItemCard
                  row={row}
                  years={years}
                  meta={meta}
                  glossaryItem={glossaryItem ?? undefined}
                  isLocked={isLocked}
                  isCalculated={isCalculated || isCalculatedOutput || isParentWithChildren || isOpExParent}
                  autoValue={computedValue}
                  allowNegative={allowNegative}
                  colorClass={colorClass}
                  onUpdateValue={updateRowValue.bind(null, "incomeStatement")}
                  onRemove={handleRemoveItem}
                  reviewState={getFinalRowClassificationState(row, "income").reviewState}
                  onConfirmSuggestion={() => confirmRowReview("incomeStatement", row.id)}
                  showRemove={!isCalculatedOutput && !allProtectedItems.includes(row.id)}
                  showEditRow={!isCalculatedOutput && !allProtectedItems.includes(row.id)}
                  onEditRow={handleEditRow}
                  editingLabelRowId={editingLabelRowId}
                  editingLabelValue={editingLabelValue}
                  onEditingLabelChange={setEditingLabelValue}
                  onSaveEditLabel={handleSaveEditRowLabel}
                  onCancelEditLabel={() => { setEditingLabelRowId(null); setEditingLabelValue(""); }}
                  protectedRows={allProtectedItems}
                  draggable={(isInterestSection || isOpExChild) && !isLocked}
                  onDragStart={isInterestSection ? (e) => { e.stopPropagation(); handleDragStartTopLevel(e, globalIndex); } : isOpExChild ? (e) => { e.stopPropagation(); handleDragStart(e, { parentId: opExParentId, childId: row.id, fromIndex: opExChildIndex }); } : undefined}
                  onDragOver={isInterestSection ? (e) => handleDragOverTopLevel(e, row.id) : isOpExChild ? (e) => handleDragOver(e, row.id) : undefined}
                  onDragLeave={isInterestSection ? handleDragLeaveTopLevel : isOpExChild ? handleDragLeave : undefined}
                  onDrop={isInterestSection ? (e) => handleDropTopLevel(e, globalIndex) : isOpExChild ? (e) => handleDrop(e, { parentId: opExParentId, childId: row.id, toIndex: opExChildIndex }) : undefined}
                  dragOverId={isInterestSection ? dragOverTopLevelId : isOpExChild ? dragOverId : undefined}
                />
                
                {/* Breakdown Section - for Revenue, COGS, and (non-parent) op-ex rows. Operating-expenses parent's children are rendered in the section list below, not here. */}
                {canHaveBreakdowns && (
                  <div className="ml-6 space-y-2">
                    {/* Show existing breakdowns — skip for operating_expenses parent so children are not rendered twice (they're already in items as section-level rows) */}
                    {hasChildren && !isOpExParent && (
                      <div className="space-y-2">
                        {row.children!.map((child, childIndex) => {
                          const childGlossaryItem = findGlossaryItem(child.label);
                          return (
                            <div
                              key={child.id}
                              onDragOver={(e) => handleDragOver(e, child.id)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, { parentId: row.id, childId: child.id, toIndex: childIndex })}
                            >
                              <UnifiedItemCard
                                row={child}
                                years={years}
                                meta={meta}
                                glossaryItem={childGlossaryItem ?? undefined}
                                isLocked={isLocked}
                                isCalculated={false}
                                colorClass={colorClass}
                                onUpdateValue={updateRowValue.bind(null, "incomeStatement")}
                                onRemove={handleRemoveItem}
                                reviewState={getFinalRowClassificationState(child, "income").reviewState}
                                onConfirmSuggestion={() => confirmRowReview("incomeStatement", child.id)}
                                showRemove={true}
                                showEditRow={true}
                                onEditRow={handleEditRow}
                                editingLabelRowId={editingLabelRowId}
                                editingLabelValue={editingLabelValue}
                                onEditingLabelChange={setEditingLabelValue}
                                onSaveEditLabel={handleSaveEditRowLabel}
                                onCancelEditLabel={() => { setEditingLabelRowId(null); setEditingLabelValue(""); }}
                                protectedRows={[]}
                                allowNegative={row.id === "rev"}
                                draggable={!isLocked}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  handleDragStart(e, { parentId: row.id, childId: child.id, fromIndex: childIndex });
                                }}
                                onDragOver={(e) => handleDragOver(e, child.id)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, { parentId: row.id, childId: child.id, toIndex: childIndex })}
                                dragOverId={dragOverId}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                    
                    {/* Add Breakdown - Proper input field instead of prompt */}
                    {!isLocked && (
                      <div className="mt-2">
                        {!showAddBreakdown[row.id] ? (
                          <button
                            type="button"
                            onClick={() => {
                              setShowAddBreakdown((prev) => ({ ...prev, [row.id]: true }));
                              setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: "" }));
                            }}
                            className="text-xs text-blue-400 hover:text-blue-300 underline"
                          >
                            + Add {row.id === "rev" ? "Revenue Stream" : row.id === "cogs" ? "COGS Breakdown" : isOperatingExpensesSection && row.id === "operating_expenses" ? "Operating expense item" : "Breakdown"}
                          </button>
                        ) : (
                          <div className="flex gap-2 items-center">
                            <input
                              type="text"
                              value={newBreakdownLabels[row.id] || ""}
                              onChange={(e) => {
                                setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: e.target.value }));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const label = newBreakdownLabels[row.id]?.trim();
                                  if (label) {
                                    if (row.id === "rev") {
                                      addChildRow("incomeStatement", "rev", label);
                                      const cogsRow = incomeStatement.find(r => r.id === "cogs");
                                      if (cogsRow) {
                                        addChildRow("incomeStatement", "cogs", `${label} COGS`);
                                      }
                                    } else if (isOperatingExpensesSection && row.id === "operating_expenses") {
                                      setLastAddedOpexLabel(label);
                                      addChildRow("incomeStatement", "operating_expenses", label);
                                    } else {
                                      addChildRow("incomeStatement", row.id, label);
                                    }
                                    setShowAddBreakdown((prev) => ({ ...prev, [row.id]: false }));
                                    setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: "" }));
                                  }
                                } else if (e.key === "Escape") {
                                  setShowAddBreakdown((prev) => ({ ...prev, [row.id]: false }));
                                  setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: "" }));
                                }
                              }}
                              placeholder={
                                row.id === "rev"
                                  ? "e.g., Product Revenue, Service Revenue"
                                  : row.id === "cogs"
                                  ? "e.g., Product COGS"
                                  : isOperatingExpensesSection && row.id === "operating_expenses"
                                  ? "e.g., Payroll, Occupancy, Restructuring"
                                  : "Enter breakdown name"
                              }
                              className="flex-1 rounded-md border border-slate-700 bg-slate-900/50 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const label = newBreakdownLabels[row.id]?.trim();
                                if (label) {
                                  if (row.id === "rev") {
                                    addChildRow("incomeStatement", "rev", label);
                                    const cogsRow = incomeStatement.find(r => r.id === "cogs");
                                    if (cogsRow) {
                                      addChildRow("incomeStatement", "cogs", `${label} COGS`);
                                    }
                                  } else if (isOperatingExpensesSection && row.id === "operating_expenses") {
                                    setLastAddedOpexLabel(label);
                                    addChildRow("incomeStatement", "operating_expenses", label);
                                  } else {
                                    addChildRow("incomeStatement", row.id, label);
                                  }
                                  setShowAddBreakdown((prev) => ({ ...prev, [row.id]: false }));
                                  setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: "" }));
                                }
                              }}
                              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowAddBreakdown((prev) => ({ ...prev, [row.id]: false }));
                                setNewBreakdownLabels((prev) => ({ ...prev, [row.id]: "" }));
                              }}
                              className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          
          {/* Interest & Other: section-level add only (no suggestion cards) */}
          {showSuggestions && !isLocked && sectionId === "is_interest" && (
            <div className="mt-4 space-y-2">
              {!showAddInterestDialog ? (
                <button
                  type="button"
                  onClick={() => setShowAddInterestDialog(true)}
                  className="text-xs text-slate-400 hover:text-slate-300 underline"
                >
                  + Add custom item
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={newInterestLabel}
                    onChange={(e) => setNewInterestLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const trimmed = newInterestLabel.trim();
                        if (!trimmed) return;
                        const fallback = getFallbackIsClassification(trimmed);
                        const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
                        const ebtIndex = incomeStatement.findIndex((r) => r.id === "ebt");
                        const insertIndex = ebtIndex >= 0 ? ebtIndex : ebitMarginIndex >= 0 ? ebitMarginIndex + 1 : incomeStatement.length;
                        const newRow: Row = {
                          id: `is_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                          label: trimmed,
                          kind: "input",
                          valueType: "currency",
                          values: {},
                          children: [],
                          sectionOwner: fallback.sectionOwner,
                          isOperating: fallback.isOperating,
                          classificationSource: "fallback",
                        };
                        insertRow("incomeStatement", insertIndex, newRow);
                        runIsClassifyAndApply(newRow.id, newRow.label, "Interest & Other");
                        setShowAddInterestDialog(false);
                        setNewInterestLabel("");
                      }
                      if (e.key === "Escape") {
                        setShowAddInterestDialog(false);
                        setNewInterestLabel("");
                      }
                    }}
                    placeholder="Label for new item"
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 placeholder-slate-500 w-48"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = newInterestLabel.trim();
                      if (!trimmed) return;
                      const ebitMarginIndex = incomeStatement.findIndex((r) => r.id === "ebit_margin");
                      const ebtIndex = incomeStatement.findIndex((r) => r.id === "ebt");
                      const insertIndex = ebtIndex >= 0 ? ebtIndex : ebitMarginIndex >= 0 ? ebitMarginIndex + 1 : incomeStatement.length;
                      const fallback = getFallbackIsClassification(trimmed);
                      const newRow: Row = {
                        id: `is_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        label: trimmed,
                        kind: "input",
                        valueType: "currency",
                        values: {},
                        children: [],
                        sectionOwner: fallback.sectionOwner,
                        isOperating: fallback.isOperating,
                        classificationSource: "fallback",
                      };
                      insertRow("incomeStatement", insertIndex, newRow);
                      runIsClassifyAndApply(newRow.id, newRow.label, "Interest & Other");
                      setShowAddInterestDialog(false);
                      setNewInterestLabel("");
                    }}
                    disabled={!newInterestLabel.trim() || isClassifyLoading}
                    className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddInterestDialog(false);
                      setNewInterestLabel("");
                    }}
                    className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>
    );
  };
  
  const modelingProfile = useMemo(() => buildModelingContext(companyContext), [companyContext]);
  const sectionOwnerOptions: { value: Row["sectionOwner"]; label: string }[] = useMemo(() => {
    const labels: Record<string, string> = {
      revenue: "Revenue",
      cogs: "Cost of Goods Sold",
      sga: "SG&A",
      rd: "Research & Development",
      other_operating: "Other Operating",
      non_operating: "Non-operating",
      tax: "Tax",
    };
    const order = getSectionOwnerOrderForProfile(modelingProfile);
    return order.map((value) => (value != null ? { value, label: labels[value] ?? value } : { value: undefined, label: "" }));
  }, [modelingProfile]);

  const aiClassifiedCount = useMemo(
    () => rowsClassifiedCustom.filter((r) => r.classificationSource === "ai").length,
    [rowsClassifiedCustom]
  );
  const manualClassifiedCount = useMemo(
    () => rowsClassifiedCustom.filter((r) => r.classificationSource === "user" || r.classificationSource == null).length,
    [rowsClassifiedCustom]
  );

  return (
    <CollapsibleSection
      sectionId="income_statement_all"
      title="Income Statement Builder"
      description="Build your Income Statement with revenue, expenses, and key metrics. All items are organized by section."
      colorClass="blue"
      defaultExpanded={true}
    >
      <div className="space-y-6">
        {/* Classification panel: two subsections so classified rows don't disappear */}
        {!isLocked && (rowsNeedingReview.length > 0 || rowsAlreadyClassified.length > 0) && (
          <div className="rounded-lg border border-amber-600/50 bg-amber-950/30 p-3 space-y-4">
            <p className="text-xs font-semibold text-amber-200">Custom row classification</p>
            <p className="text-xs text-amber-200/90">
              {rowsNeedingReview.length} row{rowsNeedingReview.length !== 1 ? "s" : ""} need review · AI classified: {aiClassifiedCount} · Other (fallback/user): {rowsClassifiedCustom.length - aiClassifiedCount}
            </p>
            <p className="text-[11px] text-amber-200/80">
              Operating = included in EBIT / operating profit. Non-operating = below EBIT (interest, investment gains/losses, etc.).
            </p>

            {/* A) Needs review (missing classification or low-confidence AI suggestion) */}
            {rowsNeedingReview.length > 0 && (
              <div>
                <p className="text-xs font-medium text-amber-300 mb-2">Needs review</p>
                <div className="space-y-3">
                  {rowsNeedingReview.map((row) => (
                    <div key={row.id} className="rounded border border-slate-700 bg-slate-900/50 p-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-slate-300 font-medium min-w-[140px]">{row.label}</span>
                        <select
                          value={row.sectionOwner ?? ""}
                          onChange={(e) => {
                            const v = e.target.value as Row["sectionOwner"];
                            if (v) {
                              updateIncomeStatementRowMetadata(row.id, {
                                sectionOwner: v,
                                isOperating: ["revenue", "cogs", "sga", "rd", "other_operating"].includes(v),
                                classificationSource: "user",
                              });
                              setPendingAiSuggestions((prev) => {
                                const next = { ...prev };
                                delete next[row.id];
                                return next;
                              });
                            }
                          }}
                          className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-2 py-1"
                        >
                          <option value="">— Section —</option>
                          {sectionOwnerOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1 text-slate-400" title="Operating = in EBIT; Non-operating = below EBIT">
                          <input
                            type="checkbox"
                            checked={row.isOperating === true}
                            onChange={(e) => {
                              updateIncomeStatementRowMetadata(row.id, { isOperating: e.target.checked, classificationSource: "user" });
                              setPendingAiSuggestions((prev) => {
                                const next = { ...prev };
                                delete next[row.id];
                                return next;
                              });
                            }}
                            className="rounded border-slate-600 bg-slate-800"
                          />
                          Operating
                        </label>
                      </div>
                      {pendingAiSuggestions[row.id] && (
                        <p className="text-[11px] text-slate-400 mt-1.5 pl-0">
                          AI suggests: {sectionOwnerOptions.find((o) => o.value === pendingAiSuggestions[row.id].sectionOwner)?.label ?? pendingAiSuggestions[row.id].sectionOwner}, {pendingAiSuggestions[row.id].isOperating ? "Operating" : "Non-operating"} ({pendingAiSuggestions[row.id].reason})
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* B) Already classified — collapsible, not main focus; hide dropdown for strong AI classification unless "Change" */}
            {rowsAlreadyClassified.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowReviewClassified((prev) => !prev)}
                  className="text-xs font-medium text-amber-300 mb-2 flex items-center gap-1 hover:text-amber-200"
                >
                  {showReviewClassified ? "▼" : "▶"} Review classified rows ({rowsAlreadyClassified.length})
                </button>
                {showReviewClassified && (
                  <div className="space-y-2">
                    {rowsAlreadyClassified.map((row) => {
                      const isAiClassified = row.classificationSource === "ai" && (row.classificationConfidence ?? 0) > 0.75;
                      const showDropdown = !isAiClassified || showChangeDropdownForId[row.id];
                      return (
                        <div key={row.id} className="rounded border border-slate-700 bg-slate-900/50 p-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-slate-300 font-medium min-w-[140px]">{row.label}</span>
                            <span className="text-slate-400">
                              {sectionOwnerOptions.find((o) => o.value === row.sectionOwner)?.label ?? row.sectionOwner}
                            </span>
                            <span className="text-slate-500">·</span>
                            <span className={row.isOperating ? "text-emerald-400" : "text-slate-400"}>
                              {row.isOperating ? "Operating" : "Non-operating"}
                            </span>
                            {isAiClassified && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">
                                Suggested by AI{row.classificationConfidence != null ? ` (${Math.round(row.classificationConfidence * 100)}%)` : ""}
                              </span>
                            )}
                            {isAiClassified && !showDropdown && (
                              <button
                                type="button"
                                onClick={() => setShowChangeDropdownForId((prev) => ({ ...prev, [row.id]: true }))}
                                className="text-[11px] text-slate-400 hover:text-slate-300 underline"
                              >
                                Change
                              </button>
                            )}
                            {showDropdown && (
                              <>
                                <select
                                  value={row.sectionOwner ?? ""}
                                  onChange={(e) => {
                                    const v = e.target.value as Row["sectionOwner"];
                                    if (v) updateIncomeStatementRowMetadata(row.id, {
                                      sectionOwner: v,
                                      isOperating: ["revenue", "cogs", "sga", "rd", "other_operating"].includes(v),
                                      classificationSource: "user",
                                    });
                                  }}
                                  className="rounded border border-slate-600 bg-slate-800 text-slate-200 px-2 py-0.5 text-[11px]"
                                >
                                  {sectionOwnerOptions.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                                <label className="flex items-center gap-1 text-slate-400">
                                  <input
                                    type="checkbox"
                                    checked={row.isOperating === true}
                                    onChange={(e) => updateIncomeStatementRowMetadata(row.id, { isOperating: e.target.checked, classificationSource: "user" })}
                                    className="rounded border-slate-600 bg-slate-800"
                                  />
                                  Operating
                                </label>
                              </>
                            )}
                          </div>
                          {row.classificationSource === "ai" && (row.classificationReason || row.classificationConfidence != null) && (
                            <p className="text-[11px] text-slate-500 mt-1.5 pl-0">
                              Suggested by AI: {sectionOwnerOptions.find((o) => o.value === row.sectionOwner)?.label ?? row.sectionOwner}
                              {row.classificationConfidence != null && ` (${Math.round(row.classificationConfidence * 100)}%)`}.
                              {row.classificationReason && ` Reason: ${row.classificationReason}`}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {isClassifyLoading && (
              <p className="text-xs text-amber-300/80">Classifying with AI…</p>
            )}
          </div>
        )}

        {/* Non-blocking validation warnings (margins) */}
        {validationWarnings.length > 0 && (
          <div className="rounded-lg border border-slate-600 bg-slate-900/50 p-3">
            <p className="text-xs font-semibold text-slate-300 mb-1">Margin check</p>
            <p className="text-xs text-slate-400">
              {validationWarnings.map((w) => (
                <span key={`${w.year}-${w.type}`} className="mr-2">
                  {w.year} {w.type === "gross_margin" ? "Gross margin" : w.type === "ebit_margin" ? "EBIT margin" : "Net margin"}: {w.value.toFixed(1)}%
                </span>
              ))}
              — Review if these values are intended.
            </p>
          </div>
        )}

        {/* Revenue Section */}
        {renderSection("Revenue", sections.revenue, "blue", "is_revenue")}
        
        {/* COGS Section */}
        {renderSection("Cost of Goods Sold (COGS)", sections.cogs, "orange", "is_cogs")}
        
        {/* Operating Expenses: structural parent (calculated, non-editable) + children (SG&A, R&D, Other OpEx, D&A, custom). Always show section. */}
        {(() => {
          const opExItems = sections.operatingExpenses;
          const sectionRootId = opExItems.length > 0 ? opExItems[0].id : null;
          console.log("Operating Expenses section: parent row id used for section =", sectionRootId);
          return renderSection("Operating Expenses", opExItems, "purple", "is_operating_expenses", true);
        })()}
        
        {/* Interest & Other Section */}
        {renderSection("Interest & Other", sections.interest, "orange", "is_interest", true)}
        
        {/* Tax Section */}
        {renderSection("Income Tax", sections.tax, "slate", "is_tax")}
        
        {/* Expense Disclosures (Optional) - expandable/collapsible parent card */}
        {!isLocked && (
          <CollapsibleSection
            sectionId="expense_disclosures_optional"
            title="Expense Disclosures (Optional)"
            description="Use these only if the company discloses embedded expense components in its notes."
            colorClass="slate"
            defaultExpanded={true}
          >
            <div className="space-y-4">
              <SbcOptionalSection />
              <AmortizationOptionalSection />
              <DepreciationOptionalSection />
              <RestructuringOptionalSection />
            </div>
          </CollapsibleSection>
        )}
      </div>
    </CollapsibleSection>
  );
}
