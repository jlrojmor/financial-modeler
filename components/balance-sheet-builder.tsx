"use client";

import { useMemo, useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
  formatCurrencyDisplay,
} from "@/lib/currency-utils";
import CollapsibleSection from "@/components/collapsible-section";
import { getBSCategorySuggestions, getBSItemImpacts, type BalanceSheetCategory } from "@/lib/bs-impact-rules";
import { getRowsForCategory, getInsertionIndexForCategory } from "@/lib/bs-category-mapper";
import { findTermKnowledge, getSuggestedTreatment } from "@/lib/financial-terms-knowledge";
// UUID helper - inline for now
function uuid() {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Color class mapping for Tailwind (can't use dynamic classes)
const COLOR_CLASSES = {
  blue: {
    border: "border-blue-700/40",
    borderLight: "border-blue-700/30",
    borderDark: "border-blue-800",
    bg: "bg-blue-950/40",
    bgLight: "bg-blue-950/20",
    bgDark: "bg-blue-950/60",
    text: "text-blue-200",
    textLight: "text-blue-400",
    textMuted: "text-blue-100",
    textPlaceholder: "placeholder-blue-500",
    focus: "focus:border-blue-500",
    hover: "hover:bg-blue-950/60",
    hoverText: "hover:text-blue-200",
  },
  green: {
    border: "border-green-700/40",
    borderLight: "border-green-700/30",
    borderDark: "border-green-800",
    bg: "bg-green-950/40",
    bgLight: "bg-green-950/20",
    bgDark: "bg-green-950/60",
    text: "text-green-200",
    textLight: "text-green-400",
    textMuted: "text-green-100",
    textPlaceholder: "placeholder-green-500",
    focus: "focus:border-green-500",
    hover: "hover:bg-green-950/60",
    hoverText: "hover:text-green-200",
  },
  orange: {
    border: "border-orange-700/40",
    borderLight: "border-orange-700/30",
    borderDark: "border-orange-800",
    bg: "bg-orange-950/40",
    bgLight: "bg-orange-950/20",
    bgDark: "bg-orange-950/60",
    text: "text-orange-200",
    textLight: "text-orange-400",
    textMuted: "text-orange-100",
    textPlaceholder: "placeholder-orange-500",
    focus: "focus:border-orange-500",
    hover: "hover:bg-orange-950/60",
    hoverText: "hover:text-orange-200",
  },
  red: {
    border: "border-red-700/40",
    borderLight: "border-red-700/30",
    borderDark: "border-red-800",
    bg: "bg-red-950/40",
    bgLight: "bg-red-950/20",
    bgDark: "bg-red-950/60",
    text: "text-red-200",
    textLight: "text-red-400",
    textMuted: "text-red-100",
    textPlaceholder: "placeholder-red-500",
    focus: "focus:border-red-500",
    hover: "hover:bg-red-950/60",
    hoverText: "hover:text-red-200",
  },
  purple: {
    border: "border-purple-700/40",
    borderLight: "border-purple-700/30",
    borderDark: "border-purple-800",
    bg: "bg-purple-950/40",
    bgLight: "bg-purple-950/20",
    bgDark: "bg-purple-950/60",
    text: "text-purple-200",
    textLight: "text-purple-400",
    textMuted: "text-purple-100",
    textPlaceholder: "placeholder-purple-500",
    focus: "focus:border-purple-500",
    hover: "hover:bg-purple-950/60",
    hoverText: "hover:text-purple-200",
  },
} as const;

/**
 * Add Balance Sheet Item Dialog Component
 * Shows automatic impacts based on accounting rules
 */
function AddBSItemDialog({
  category,
  isOpen,
  onClose,
  onAdd,
  companyType,
}: {
  category: BalanceSheetCategory;
  isOpen: boolean;
  onClose: () => void;
  onAdd: (label: string, itemId?: string) => void;
  companyType?: "public" | "private";
}) {
  const [label, setLabel] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);
  
  const suggestions = getBSCategorySuggestions(category, companyType);
  const [impact, setImpact] = useState<ReturnType<typeof getBSItemImpacts> | null>(null);
  const [termKnowledge, setTermKnowledge] = useState<ReturnType<typeof findTermKnowledge> | null>(null);
  const [suggestedCategory, setSuggestedCategory] = useState<BalanceSheetCategory | null>(null);
  
  // Update impact when label or suggestion changes
  useEffect(() => {
    const itemId = selectedSuggestion || undefined;
    const itemLabel = selectedSuggestion 
      ? suggestions.find(s => s.id === selectedSuggestion)?.label || label
      : label;
    
    if (itemLabel.trim()) {
      // First, check if this is a known financial term
      const knowledge = findTermKnowledge(itemLabel);
      setTermKnowledge(knowledge);
      
      if (knowledge) {
        // If knowledge suggests a different category, note it
        if (knowledge.category !== category && knowledge.category !== "income_statement" && knowledge.category !== "cash_flow") {
          setSuggestedCategory(knowledge.category as BalanceSheetCategory);
        } else {
          setSuggestedCategory(null);
        }
        
        // Use knowledge-based impact if available
        const knowledgeImpact = {
          affectsTotalCurrentAssets: knowledge.category === "current_assets",
          affectsTotalAssets: knowledge.category === "current_assets" || knowledge.category === "fixed_assets",
          affectsTotalCurrentLiabilities: knowledge.category === "current_liabilities",
          affectsTotalLiabilities: knowledge.category === "current_liabilities" || knowledge.category === "non_current_liabilities",
          affectsTotalEquity: knowledge.category === "equity",
          cfsLink: knowledge.cfsTreatment,
          isLink: knowledge.isLink,
        };
        setImpact(knowledgeImpact);
      } else {
        // Fall back to category-based impact
        setSuggestedCategory(null);
        setImpact(getBSItemImpacts(category, itemId, itemLabel));
      }
    } else {
      setImpact(null);
      setTermKnowledge(null);
      setSuggestedCategory(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, selectedSuggestion, category]);
  
  if (!isOpen) return null;
  
  const handleAdd = () => {
    const finalLabel = selectedSuggestion 
      ? suggestions.find(s => s.id === selectedSuggestion)?.label || label
      : label.trim();
    if (!finalLabel) return;
    
    // Guardrail: Block unrecognized terms completely
    const knowledge = findTermKnowledge(finalLabel);
    if (!knowledge && !selectedSuggestion) {
      // This should not happen if button is properly disabled, but double-check
      alert(
        `🔒 GUARDRAIL: Cannot Add Unrecognized Term\n\n` +
        `"${finalLabel}" is not recognized as a standard financial term.\n\n` +
        `Please select a recognized term from the suggestions above, or use standard accounting terminology (IFRS/US GAAP).`
      );
      return; // Block addition
    }
    
    onAdd(finalLabel, selectedSuggestion || undefined);
    setLabel("");
    setSelectedSuggestion(null);
    onClose();
  };
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-slate-100">Add {category.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())} Item</h3>
        
        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="mb-4">
            <label className="mb-2 block text-xs font-semibold text-slate-300">Standard Items (10-K):</label>
            <div className="grid grid-cols-2 gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onClick={() => {
                    setSelectedSuggestion(suggestion.id);
                    setLabel(suggestion.label);
                  }}
                  className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                    selectedSuggestion === suggestion.id
                      ? "border-blue-500 bg-blue-950/40 text-blue-200"
                      : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600"
                  }`}
                >
                  <div className="font-medium">{suggestion.label}</div>
                  {suggestion.description && (
                    <div className="mt-1 text-[10px] text-slate-400">{suggestion.description}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {/* Custom Label Input */}
        <div className="mb-4">
          <label className="mb-2 block text-xs font-semibold text-slate-300">
            {selectedSuggestion ? "Custom Label (optional override):" : "Custom Label:"}
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setSelectedSuggestion(null);
            }}
            placeholder="Enter custom label..."
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            autoFocus
          />
        </div>
        
        {/* Term Recognition Notice */}
        {termKnowledge && (
          <div className={`mb-4 rounded-md border p-4 ${
            suggestedCategory && suggestedCategory !== category
              ? "border-amber-800/40 bg-amber-950/20"
              : "border-emerald-800/40 bg-emerald-950/20"
          }`}>
            <h4 className={`mb-2 text-xs font-semibold ${
              suggestedCategory && suggestedCategory !== category
                ? "text-amber-200"
                : "text-emerald-200"
            }`}>
              {suggestedCategory && suggestedCategory !== category
                ? "⚠️ Category Mismatch Detected"
                : "✅ Recognized Financial Term"}
            </h4>
            <p className={`text-xs mb-2 ${
              suggestedCategory && suggestedCategory !== category
                ? "text-amber-300/90"
                : "text-emerald-300/90"
            }`}>
              {suggestedCategory && suggestedCategory !== category
                ? `The system recognized "${label.trim()}" as a standard financial term, but it typically belongs to a different Balance Sheet category based on international accounting standards (IFRS/US GAAP).`
                : `The system recognized "${label.trim()}" as a standard financial term and automatically determined the correct accounting treatment.`}
            </p>
            {termKnowledge.notes && (
              <p className={`text-xs italic ${
                suggestedCategory && suggestedCategory !== category
                  ? "text-amber-300/70"
                  : "text-emerald-300/70"
              }`}>
                {termKnowledge.notes}
              </p>
            )}
            {suggestedCategory && suggestedCategory !== category && (
              <div className="mt-3 rounded-md border border-amber-700/40 bg-amber-950/40 p-3">
                <p className="text-xs text-amber-200 font-semibold mb-2">
                  📋 International Accounting Standards (IFRS/US GAAP):
                </p>
                <p className="text-xs text-amber-300/90 mb-2">
                  This term typically belongs to: <span className="font-semibold text-amber-200">
                    {suggestedCategory.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                </p>
                <p className="text-xs text-amber-300/80 mt-2">
                  💡 <strong>Recommendation:</strong> Consider adding it to the correct category for proper accounting treatment and accurate Cash Flow Statement impacts. The system will remember this treatment for future use.
                </p>
                {termKnowledge.cfsTreatment && (
                  <div className="mt-2 pt-2 border-t border-amber-800/30">
                    <p className="text-xs text-amber-200 font-semibold mb-1">
                      Cash Flow Treatment (if added to correct category):
                    </p>
                    <p className="text-xs text-amber-300/80">
                      → {termKnowledge.cfsTreatment.section === "operating" ? "Operating" : termKnowledge.cfsTreatment.section === "investing" ? "Investing" : "Financing"} CF: {termKnowledge.cfsTreatment.description}
                    </p>
                  </div>
                )}
              </div>
            )}
            {suggestedCategory === category && (
              <div className="mt-2 rounded-md border border-emerald-700/40 bg-emerald-950/40 p-2">
                <p className="text-xs text-emerald-200 font-semibold">
                  ✓ Category Verified: This term is correctly placed in {category.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                </p>
                <p className="text-xs text-emerald-300/80 mt-1">
                  The system will remember this treatment and apply it automatically in Cash Flow Statement calculations.
                </p>
              </div>
            )}
          </div>
        )}
        
        {/* Automatic Impacts Preview (Read-only) */}
        {impact && (label.trim() || selectedSuggestion) && (
          <div className="mb-4 rounded-md border border-amber-800/40 bg-amber-950/20 p-4">
            <h4 className="mb-2 text-xs font-semibold text-amber-200">
              📊 Automatic Impacts (System Determined):
            </h4>
            <div className="space-y-2 text-xs text-amber-300/90">
              {/* Balance Sheet Impacts */}
              {impact.affectsTotalCurrentAssets && (
                <div>✓ Included in "Total Current Assets" → "Total Assets"</div>
              )}
              {impact.affectsTotalAssets && !impact.affectsTotalCurrentAssets && (
                <div>✓ Included in "Total Assets"</div>
              )}
              {impact.affectsTotalCurrentLiabilities && (
                <div>✓ Included in "Total Current Liabilities" → "Total Liabilities"</div>
              )}
              {impact.affectsTotalLiabilities && !impact.affectsTotalCurrentLiabilities && (
                <div>✓ Included in "Total Liabilities"</div>
              )}
              {impact.affectsTotalEquity && (
                <div>✓ Included in "Total Equity" → "Total Liabilities & Equity"</div>
              )}
              
              {/* Cash Flow Impacts */}
              {impact.cfsLink && (
                <div className="mt-2 border-t border-amber-800/30 pt-2">
                  <div className="font-semibold">💰 Cash Flow Impact:</div>
                  <div className="ml-2">
                    → {impact.cfsLink.section === "operating" ? "Operating" : impact.cfsLink.section === "investing" ? "Investing" : "Financing"} CF: {impact.cfsLink.description}
                  </div>
                </div>
              )}
              
              {/* Income Statement Links */}
              {impact.isLink && (
                <div className="mt-2 border-t border-amber-800/30 pt-2">
                  <div className="font-semibold">🔗 Income Statement Link:</div>
                  <div className="ml-2">→ {impact.isLink.description}</div>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Unrecognized Term Warning - GUARDRAIL */}
        {!termKnowledge && label.trim() && !selectedSuggestion && (
          <div className="mb-4 rounded-md border-2 border-red-800/60 bg-red-950/30 p-4">
            <h4 className="mb-2 text-xs font-semibold text-red-200 flex items-center gap-2">
              🔒 GUARDRAIL: Unrecognized Financial Term
            </h4>
            <p className="text-xs text-red-300/90 mb-3">
              The system does not recognize <span className="font-semibold">"{label.trim()}"</span> as a standard financial term in the knowledge base.
            </p>
            <div className="rounded-md border border-red-700/50 bg-red-950/50 p-3 mb-3">
              <p className="text-xs text-red-200 font-semibold mb-2">
                ⚠️ BLOCKED: Cannot add unrecognized terms
              </p>
              <p className="text-xs text-red-300/90 mb-2">
                To ensure accurate accounting treatment per international standards (IFRS/US GAAP), the system requires recognized terms to automatically determine:
              </p>
              <ul className="text-xs text-red-300/80 space-y-1 mb-2 list-disc list-inside ml-2">
                <li>Correct Balance Sheet category</li>
                <li>Cash Flow Statement treatment (Operating/Investing/Financing)</li>
                <li>Income Statement links (if applicable)</li>
              </ul>
            </div>
            <div className="rounded-md border border-amber-700/40 bg-amber-950/30 p-3">
              <p className="text-xs text-amber-200 font-semibold mb-1">
                💡 How to proceed:
              </p>
              <ul className="text-xs text-amber-300/90 space-y-1 list-disc list-inside ml-2">
                <li><strong>Select a recognized term</strong> from the "Standard Items (10-K)" suggestions above</li>
                <li><strong>Use standard accounting terminology</strong> (e.g., "Operating Lease Liabilities" instead of "Non Current Operating Leases")</li>
                <li><strong>Try alternative spellings</strong> or more specific terms (e.g., "Lease Liabilities", "Operating Leases")</li>
              </ul>
            </div>
          </div>
        )}
        
        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={(!label.trim() && !selectedSuggestion) || (!termKnowledge && label.trim() && !selectedSuggestion)}
            className={`rounded-md px-4 py-2 text-xs font-semibold text-white transition ${
              !termKnowledge && label.trim() && !selectedSuggestion
                ? "bg-red-600 hover:bg-red-500 cursor-not-allowed opacity-75"
                : "bg-blue-600 hover:bg-blue-500"
            } disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed`}
            title={!termKnowledge && label.trim() && !selectedSuggestion 
              ? "🔒 GUARDRAIL: Cannot add unrecognized terms. Please select a recognized term from suggestions or use standard accounting terminology." 
              : undefined}
          >
            {!termKnowledge && label.trim() && !selectedSuggestion 
              ? "🔒 Add Item (Blocked - Unrecognized)" 
              : "Add Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Balance Sheet Category Section Component
 */
function BSCategorySection({
  category,
  categoryLabel,
  colorClass,
  rows,
  totalRowId,
  years,
  meta,
  updateRowValue,
  insertRow,
  moveRow,
  removeRow,
  isLocked,
  companyType,
}: {
  category: BalanceSheetCategory;
  categoryLabel: string;
  colorClass: "blue" | "green" | "orange" | "red" | "purple";
  rows: Row[];
  totalRowId?: string;
  years: string[];
  meta: any;
  updateRowValue: (statement: "balanceSheet", rowId: string, year: string, value: number) => void;
  insertRow: (statement: "balanceSheet", index: number, row: Row) => void;
  moveRow: (statement: "balanceSheet", rowId: string, direction: "up" | "down") => void;
  removeRow: (statement: "balanceSheet", rowId: string) => void;
  isLocked: boolean;
  companyType?: "public" | "private";
}) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  
  // Get fresh rows and meta from store to ensure we have the latest data
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const storeMeta = useModelStore((s) => s.meta);
  const currentRows = balanceSheet.length > 0 ? balanceSheet : rows;
  const effectiveCompanyType = companyType || storeMeta?.companyType;
  
  const totalRow = totalRowId ? currentRows.find(r => r.id === totalRowId) : null;
  const categoryRows = getRowsForCategory(currentRows, category);
  const colors = COLOR_CLASSES[colorClass];
  
  // Safety check: ensure moveRow is available
  if (typeof moveRow !== 'function') {
    console.error("[BSCategorySection] moveRow is not a function!", moveRow);
    // Return early or disable buttons if moveRow is not available
  }
  
  // Debug: log category rows to help diagnose issues (only in development)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[BS Builder] ${categoryLabel}: Found ${categoryRows.length} rows:`, categoryRows.map(r => ({ id: r.id, label: r.label, kind: r.kind })));
      console.log(`[BS Builder] ${categoryLabel}: Total rows in balanceSheet:`, currentRows.length);
      console.log(`[BS Builder] ${categoryLabel}: Total row ID:`, totalRowId, "Found:", !!totalRow);
    }
  }, [categoryRows.length, categoryLabel, currentRows.length, totalRowId, totalRow]);
  
  const handleAddItem = (label: string, itemId?: string) => {
    // Check if this is a known financial term
    const knowledge = findTermKnowledge(label);
    const suggested = getSuggestedTreatment(label);
    
    // Always respect user's category choice, but use knowledge-based treatment if available
    // This ensures correct CFS/IS treatment even if user places item in different category
    const finalCategory = category;
    
    // Create new row
    const newRow: Row = {
      id: itemId || `bs_${uuid()}`,
      label,
      kind: "input",
      valueType: "currency",
      values: {},
      children: [],
    };
    
    // Get impacts - prioritize knowledge-based treatment (international standards)
    // This is how we "remember" the correct treatment for future use
    let impact;
    if (knowledge && knowledge.cfsTreatment) {
      // Use knowledge-based impact (correct treatment per IFRS/US GAAP)
      // This ensures proper CFS treatment regardless of which category user chose
      impact = {
        affectsTotalCurrentAssets: knowledge.category === "current_assets",
        affectsTotalAssets: knowledge.category === "current_assets" || knowledge.category === "fixed_assets",
        affectsTotalCurrentLiabilities: knowledge.category === "current_liabilities",
        affectsTotalLiabilities: knowledge.category === "current_liabilities" || knowledge.category === "non_current_liabilities",
        affectsTotalEquity: knowledge.category === "equity",
        cfsLink: knowledge.cfsTreatment,
        isLink: knowledge.isLink,
      };
      
      // Store the knowledge in the row metadata
      // The cfsLink and isLink fields serve as the "memory" of the correct treatment
      // This ensures the system remembers how to treat this concept in CFS and IS
    } else {
      // Fall back to category-based impact for unrecognized terms
      impact = getBSItemImpacts(finalCategory, itemId, label);
    }
    
    // Set CFS link if applicable (this is how we "remember" the treatment)
    // Store the knowledge-based treatment even if user placed item in different category
    if (impact.cfsLink) {
      newRow.cfsLink = {
        section: impact.cfsLink.section,
        cfsItemId: impact.cfsLink.cfsItemId,
        impact: impact.cfsLink.impact,
        description: impact.cfsLink.description, // Store description for memory
      };
    }
    
    // Set IS link if applicable (this is how we "remember" the IS treatment)
    if (impact.isLink) {
      newRow.isLink = impact.isLink;
    }
    
    // Insert at the correct position for the user's chosen category
    const insertIndex = getInsertionIndexForCategory(currentRows, finalCategory);
    insertRow("balanceSheet", insertIndex, newRow);
    
    // Log for debugging (in development) - shows that knowledge is stored
    if (process.env.NODE_ENV === 'development' && knowledge) {
      console.log(`[BS Builder] Added "${label}" to ${finalCategory}.`, {
        recognized: true,
        correctCategory: knowledge.category,
        userCategory: finalCategory,
        categoryMatch: knowledge.category === finalCategory,
        cfsTreatment: knowledge.cfsTreatment,
        isLink: knowledge.isLink,
        note: "Treatment stored in row.cfsLink and row.isLink for future reference",
      });
    }
    
    // Close dialog after adding
    setShowAddDialog(false);
  };
  
  return (
    <>
      <CollapsibleSection
        sectionId={`bs_${category}`}
        title={categoryLabel}
        description={`Enter ${categoryLabel.toLowerCase()} line items. Totals are calculated automatically.`}
        colorClass={colorClass}
      >
        {/* Total Row Display */}
        {totalRow && (
          <div className={`mb-4 rounded-md border ${colors.border} ${colors.bg} p-3`}>
            <div className={`mb-2 text-xs font-semibold ${colors.text}`}>
              {totalRow.label} (calculated)
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {years.map((y) => {
                const storedValue = totalRow.values?.[y] ?? 0;
                const display = formatCurrencyDisplay(
                  storedValue,
                  meta.currencyUnit,
                  meta.currency
                );
                return (
                  <div key={y} className="block">
                    <div className={`mb-1 text-[10px] ${colors.textLight}`}>{y}</div>
                    <div className={`rounded-md border ${colors.borderDark} ${colors.bgDark} px-2 py-1 text-xs font-semibold ${colors.text}`}>
                      {storedValue !== 0 ? display : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* Category Items */}
        {categoryRows.length === 0 ? (
          <div className={`mb-4 rounded-md border ${colors.borderLight} ${colors.bgLight} p-4 text-center`}>
            <p className={`text-xs ${colors.textLight}`}>
              No {categoryLabel.toLowerCase()} items yet. Click "+ Add {categoryLabel} Item" to add one.
            </p>
          </div>
        ) : (
          <div className="mb-4 space-y-2">
            {categoryRows.map((row, index) => {
              // Skip subtotal rows in the category items list (they're shown separately at the top)
              if (row.id === totalRowId || row.kind === "subtotal" || row.kind === "total") {
                return null;
              }
              
              const isFirst = index === 0;
              const isLast = index === categoryRows.length - 1;
              const canMoveUp = !isFirst && !isLocked;
              const canMoveDown = !isLast && !isLocked;
              
              return (
              <div key={row.id} className={`rounded-md border ${colors.borderLight} ${colors.bgLight} p-3`}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {!isLocked && typeof moveRow === 'function' && (
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof moveRow === 'function') {
                              moveRow("balanceSheet", row.id, "up");
                            }
                          }}
                          disabled={!canMoveUp}
                          className={`text-[10px] ${canMoveUp ? `${colors.textLight} ${colors.hoverText}` : 'text-slate-600 cursor-not-allowed'}`}
                          title="Move up"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof moveRow === 'function') {
                              moveRow("balanceSheet", row.id, "down");
                            }
                          }}
                          disabled={!canMoveDown}
                          className={`text-[10px] ${canMoveDown ? `${colors.textLight} ${colors.hoverText}` : 'text-slate-600 cursor-not-allowed'}`}
                          title="Move down"
                        >
                          ▼
                        </button>
                      </div>
                    )}
                    <div className={`text-xs font-semibold ${colors.text}`}>{row.label}</div>
                  </div>
                  {(() => {
                    // Protect critical totals and subtotals
                    const protectedRows = [
                      "total_current_assets",
                      "total_fixed_assets",
                      "total_assets",
                      "total_current_liabilities",
                      "total_non_current_liabilities",
                      "total_liabilities",
                      "total_equity",
                      "total_liab_and_equity",
                    ];
                    const isProtected = protectedRows.includes(row.id);
                    
                    // Show Remove button for all items except protected ones, and only when not locked
                    return !isProtected && !isLocked ? (
                      <button
                        type="button"
                        onClick={() => removeRow("balanceSheet", row.id)}
                        className={`text-xs ${colors.textLight} ${colors.hoverText}`}
                      >
                        Remove
                      </button>
                    ) : null;
                  })()}
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                  {years.map((y) => {
                    const storedValue = row.values?.[y] ?? 0;
                    const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
                    const unitLabel = getUnitLabel(meta.currencyUnit);
                    return (
                      <label key={y} className="block">
                        <div className={`mb-1 text-[10px] ${colors.textLight}`}>
                          {y} {unitLabel && `(${unitLabel})`}
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          value={storedValue === 0 ? "" : displayValue}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const stored = displayToStored(val, meta.currencyUnit);
                            updateRowValue("balanceSheet", row.id, y, stored);
                          }}
                          disabled={isLocked}
                          className={`w-full rounded-md border ${colors.border} ${colors.bgDark} px-2 py-1 text-xs ${colors.textMuted} ${colors.textPlaceholder} ${colors.focus} focus:outline-none disabled:opacity-50`}
                          placeholder="0"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            );
            })}
          </div>
        )}
        
        {/* Add Item Button */}
        {!isLocked && (
          <button
            type="button"
            onClick={() => setShowAddDialog(true)}
            className={`rounded-md border ${colors.border} ${colors.bg} px-4 py-2 text-xs font-semibold ${colors.text} ${colors.hover}`}
          >
            + Add {categoryLabel} Item
          </button>
        )}
      </CollapsibleSection>
      
      <AddBSItemDialog
        category={category}
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onAdd={handleAddItem}
        companyType={effectiveCompanyType}
      />
    </>
  );
}

/**
 * Main Balance Sheet Builder Component
 */
export default function BalanceSheetBuilder() {
  const meta = useModelStore((s) => s.meta);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const insertRow = useModelStore((s) => s.insertRow);
  const moveRow = useModelStore((s) => s.moveRow);
  const removeRow = useModelStore((s) => s.removeRow);
  
  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    return hist;
  }, [meta]);
  
  // Check if sections are locked
  const isCALocked = useModelStore((s) => s.sectionLocks["bs_current_assets"] ?? false);
  const isFALocked = useModelStore((s) => s.sectionLocks["bs_fixed_assets"] ?? false);
  const isCLLocked = useModelStore((s) => s.sectionLocks["bs_current_liabilities"] ?? false);
  const isNCLLocked = useModelStore((s) => s.sectionLocks["bs_non_current_liabilities"] ?? false);
  const isEquityLocked = useModelStore((s) => s.sectionLocks["bs_equity"] ?? false);
  
  return (
    <CollapsibleSection
      sectionId="balance_sheet_all"
      title="Balance Sheet Builder"
      description="Add line items for each category. The system automatically determines Cash Flow impacts based on accounting rules."
      colorClass="blue"
      defaultExpanded={true}
    >
      <div className="space-y-6">
        {/* Current Assets */}
        <BSCategorySection
          category="current_assets"
          categoryLabel="Current Assets"
          colorClass="blue"
          rows={balanceSheet}
          totalRowId="total_current_assets"
          years={years}
          meta={meta}
          updateRowValue={updateRowValue}
          insertRow={insertRow}
          moveRow={moveRow}
          removeRow={removeRow}
          isLocked={isCALocked}
          companyType={meta?.companyType}
        />
        
        {/* Fixed Assets */}
        <BSCategorySection
          category="fixed_assets"
          categoryLabel="Fixed / Non-Current Assets"
          colorClass="green"
          rows={balanceSheet}
          totalRowId="total_assets"
          years={years}
          meta={meta}
          updateRowValue={updateRowValue}
          insertRow={insertRow}
          moveRow={moveRow}
          removeRow={removeRow}
          isLocked={isFALocked}
          companyType={meta?.companyType}
        />
        
        {/* Current Liabilities */}
        <BSCategorySection
          category="current_liabilities"
          categoryLabel="Current Liabilities"
          colorClass="orange"
          rows={balanceSheet}
          totalRowId="total_current_liabilities"
          years={years}
          meta={meta}
          updateRowValue={updateRowValue}
          insertRow={insertRow}
          moveRow={moveRow}
          removeRow={removeRow}
          isLocked={isCLLocked}
          companyType={meta?.companyType}
        />
        
        {/* Non-Current Liabilities */}
        <BSCategorySection
          category="non_current_liabilities"
          categoryLabel="Non-Current Liabilities"
          colorClass="red"
          rows={balanceSheet}
          totalRowId="total_liabilities"
          years={years}
          meta={meta}
          updateRowValue={updateRowValue}
          insertRow={insertRow}
          moveRow={moveRow}
          removeRow={removeRow}
          isLocked={isNCLLocked}
          companyType={meta?.companyType}
        />
        
        {/* Shareholders' Equity */}
        <div className="space-y-4">
          {meta?.companyType === "public" ? (
            <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 p-3">
              <h4 className="text-xs font-semibold text-purple-200 mb-2">
                📋 10-K Equity Structure Guidance (Public Company)
              </h4>
              <div className="text-xs text-purple-300/90 space-y-1">
                <p><strong>Common Stock (Par Value):</strong> Enter only the par value (typically $0.001-$0.01 per share × shares outstanding). This is usually a very small amount.</p>
                <p><strong>Additional Paid-in Capital (APIC):</strong> Enter the amount paid above par value when shares were issued. This is typically the bulk of equity issuance.</p>
                <p><strong>Treasury Stock:</strong> Enter as a <strong>negative value</strong> (contra-equity account). Represents shares repurchased by the company.</p>
                <p><strong>AOCI:</strong> Can be positive or negative. Represents unrealized gains/losses not in net income.</p>
                <p><strong>Retained Earnings:</strong> Cumulative net income - dividends paid. Links to Income Statement Net Income.</p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-purple-800/40 bg-purple-950/20 p-3">
              <h4 className="text-xs font-semibold text-purple-200 mb-2">
                📋 Equity Structure Guidance (Private Company)
              </h4>
              <div className="text-xs text-purple-300/90 space-y-1">
                <p><strong>Flexible Structure:</strong> Private companies can have simpler equity structures. Add only the items that apply to your company.</p>
                <p><strong>Common Options:</strong></p>
                <ul className="list-disc list-inside ml-2 space-y-0.5">
                  <li><strong>Members' Equity</strong> (for LLCs)</li>
                  <li><strong>Partners' Capital</strong> (for partnerships)</li>
                  <li><strong>Owner's Equity</strong> or <strong>Shareholders' Equity</strong> (for corporations)</li>
                  <li><strong>Retained Earnings</strong> (if applicable)</li>
                </ul>
                <p className="mt-2"><strong>Note:</strong> You don't need Common Stock (par value) or APIC unless your company actually has them. The balance check will work with any equity structure.</p>
              </div>
            </div>
          )}
          <BSCategorySection
            category="equity"
            categoryLabel={meta?.companyType === "public" ? "Shareholders' Equity" : "Equity"}
            colorClass="purple"
            rows={balanceSheet}
            totalRowId="total_equity"
            years={years}
            meta={meta}
            updateRowValue={updateRowValue}
            insertRow={insertRow}
            moveRow={moveRow}
            removeRow={removeRow}
            isLocked={isEquityLocked}
            companyType={meta?.companyType}
          />
        </div>
      </div>
    </CollapsibleSection>
  );
}
