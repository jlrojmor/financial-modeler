"use client";

import { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
  formatCurrencyDisplay,
} from "@/lib/currency-utils";

interface StatementBuilderProps {
  statement: "incomeStatement" | "balanceSheet" | "cashFlow";
  statementLabel: string;
  description: string;
}

function flattenRows(rows: Row[], depth = 0): Array<{ row: Row; depth: number }> {
  const out: Array<{ row: Row; depth: number }> = [];
  for (const r of rows) {
    out.push({ row: r, depth });
    if (r.children?.length) out.push(...flattenRows(r.children, depth + 1));
  }
  return out;
}

export default function StatementBuilder({
  statement,
  statementLabel,
  description,
}: StatementBuilderProps) {
  const meta = useModelStore((s) => s.meta);
  const rows = useModelStore((s) => s[statement]);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const addChildRow = useModelStore((s) => s.addChildRow);
  const removeRow = useModelStore((s) => s.removeRow);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [newChildLabels, setNewChildLabels] = useState<Record<string, string>>({});
  const [showAddChild, setShowAddChild] = useState<Record<string, boolean>>({});

  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    return hist; // Only show historical years for now
  }, [meta]);

  const flat = useMemo(() => flattenRows(rows ?? []), [rows]);

  const toggleExpand = (rowId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  const handleAddChild = (parentId: string) => {
    const label = newChildLabels[parentId]?.trim();
    if (!label) return;

    addChildRow(statement, parentId, label);
    setNewChildLabels((prev) => ({ ...prev, [parentId]: "" }));
    setShowAddChild((prev) => ({ ...prev, [parentId]: false }));
  };

  const canAddChild = (row: Row) => {
    // Don't allow adding children to Revenue, COGS, or SG&A (handled by dedicated builders)
    if (row.id === "rev" || row.id === "cogs" || row.id === "sga") {
      return false;
    }
    
    // Don't allow adding children to revenue/COGS/SG&A streams (they're already breakdowns)
    // Check if this row is a child of Revenue, COGS, or SG&A
    const isBreakdownChild = (r: Row, parentRows: Row[]): boolean => {
      for (const parent of parentRows) {
        if ((parent.id === "rev" || parent.id === "cogs" || parent.id === "sga") && parent.children?.some(c => c.id === r.id)) {
          return true;
        }
        if (parent.children && isBreakdownChild(r, parent.children)) {
          return true;
        }
      }
      return false;
    };
    
    if (isBreakdownChild(row, rows)) {
      return false; // Don't allow nested breakdowns of revenue/COGS/SG&A streams
    }
    
    // Can add children to calc/subtotal/total rows, or input rows that don't have children yet
    return (
      row.kind === "calc" ||
      row.kind === "subtotal" ||
      row.kind === "total" ||
      (row.kind === "input" && (!row.children || row.children.length === 0))
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-100">{statementLabel}</h3>
          <p className="mt-1 text-xs text-slate-400">{description}</p>
        </div>

        <div className="space-y-2">
          {flat
            .filter(({ row }) => {
              // Hide Revenue and COGS if they have children (handled by RevenueCogsBuilder)
              if ((row.id === "rev" || row.id === "cogs") && row.children && row.children.length > 0) {
                return false;
              }
              // Hide SG&A if it has children (handled by SgaBuilder)
              if (row.id === "sga" && row.children && row.children.length > 0) {
                return false;
              }
              // Hide D&A (handled by DanaBuilder)
              if (row.id === "danda") {
                return false;
              }
              // Hide Interest Expense, Interest Income, Other Income (handled by InterestOtherBuilder)
              if (row.id === "interest_expense" || row.id === "interest_income" || row.id === "other_income") {
                return false;
              }
              return true;
            })
            .map(({ row, depth }) => {
            const hasChildren = row.children && row.children.length > 0;
            const isExpanded = expandedRows.has(row.id);
            const indent = depth * 16;

            return (
              <div
                key={row.id}
                className="rounded-md border border-slate-800 bg-slate-900/40 p-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1" style={{ paddingLeft: `${indent}px` }}>
                    <div className="flex items-center gap-2">
                      {hasChildren && (
                        <button
                          onClick={() => toggleExpand(row.id)}
                          className="text-slate-400 hover:text-slate-200"
                        >
                          {isExpanded ? "▼" : "▶"}
                        </button>
                      )}
                      <span
                        className={[
                          "text-xs font-medium",
                          row.kind === "input"
                            ? "text-blue-300"
                            : row.kind === "total"
                            ? "text-emerald-300 font-semibold"
                            : "text-slate-200",
                        ].join(" ")}
                      >
                        {row.label}
                        {row.kind === "calc" && " (calculated)"}
                        {row.kind === "total" && " (total)"}
                      </span>
                    </div>

                    {/* Input fields for historical years */}
                    {row.kind === "input" && (
                      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                        {years.map((y) => {
                          const storedValue = row.values?.[y] ?? 0;
                          const isCurrency = row.valueType === "currency";
                          
                          // Only apply currency unit scaling for currency values
                          const displayValue = isCurrency
                            ? storedToDisplay(storedValue, meta.currencyUnit)
                            : storedValue;
                          const unitLabel = isCurrency ? getUnitLabel(meta.currencyUnit) : "";
                          
                          return (
                            <label key={y} className="block">
                              <div className="mb-1 text-[10px] text-slate-400">
                                {y} {unitLabel && `(${unitLabel})`}
                                {row.valueType === "percent" && " (%)"}
                                {row.valueType === "number" && " (units)"}
                              </div>
                              <input
                                type="number"
                                step={row.valueType === "percent" ? "0.01" : "any"}
                                className="w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                value={displayValue === 0 ? "" : displayValue}
                                onChange={(e) => {
                                  const inputNum = Number(e.target.value || 0);
                                  // Only scale currency values
                                  const storedNum = isCurrency
                                    ? displayToStored(inputNum, meta.currencyUnit)
                                    : inputNum;
                                  updateRowValue(statement, row.id, y, storedNum);
                                }}
                                placeholder="0"
                              />
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {/* Show calculated value */}
                    {(row.kind === "calc" || row.kind === "total") && (
                      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                        {years.map((y) => {
                          const storedValue = row.values?.[y] ?? 0;
                          const isCurrency = row.valueType === "currency";
                          
                          // Format based on value type
                          let display = "—";
                          if (storedValue !== 0) {
                            if (isCurrency) {
                              display = formatCurrencyDisplay(
                                storedValue,
                                meta.currencyUnit,
                                meta.currency
                              );
                            } else if (row.valueType === "percent") {
                              display = `${(storedValue * 100).toFixed(2)}%`;
                            } else {
                              display = storedValue.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              });
                            }
                          }
                          
                          return (
                            <div key={y} className="block">
                              <div className="mb-1 text-[10px] text-slate-400">{y}</div>
                              <div className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-300">
                                {display}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add child row button */}
                    {canAddChild(row) && (
                      <div className="mt-2">
                        {!showAddChild[row.id] ? (
                          <button
                            onClick={() =>
                              setShowAddChild((prev) => ({ ...prev, [row.id]: true }))
                            }
                            className="text-[10px] text-blue-400 hover:text-blue-300"
                          >
                            + Add breakdown item
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              className="flex-1 rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                              placeholder="Item name..."
                              value={newChildLabels[row.id] ?? ""}
                              onChange={(e) =>
                                setNewChildLabels((prev) => ({
                                  ...prev,
                                  [row.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  handleAddChild(row.id);
                                } else if (e.key === "Escape") {
                                  setShowAddChild((prev) => ({ ...prev, [row.id]: false }));
                                  setNewChildLabels((prev) => ({ ...prev, [row.id]: "" }));
                                }
                              }}
                              autoFocus
                            />
                            <button
                              onClick={() => handleAddChild(row.id)}
                              className="rounded-md bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500"
                            >
                              Add
                            </button>
                            <button
                              onClick={() => {
                                setShowAddChild((prev) => ({ ...prev, [row.id]: false }));
                                setNewChildLabels((prev) => ({ ...prev, [row.id]: "" }));
                              }}
                              className="rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Remove button for user-added rows */}
                    {row.id.startsWith("id_") && (
                      <button
                        onClick={() => removeRow(statement, row.id)}
                        className="mt-2 text-[10px] text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {/* Show children if expanded - recursively render them */}
                {hasChildren && isExpanded && row.children && (
                  <div className="mt-3 ml-4 space-y-3 border-l-2 border-slate-700 pl-4">
                    {row.children.map((child) => {
                      const childHasChildren = child.children && child.children.length > 0;
                      const childIsExpanded = expandedRows.has(child.id);
                      const childIndent = (depth + 1) * 16;

                      return (
                        <div
                          key={child.id}
                          className="rounded-md border border-slate-800 bg-slate-900/60 p-2"
                        >
                          <div className="flex items-center gap-2">
                            {childHasChildren && (
                              <button
                                onClick={() => toggleExpand(child.id)}
                                className="text-slate-400 hover:text-slate-200"
                              >
                                {childIsExpanded ? "▼" : "▶"}
                              </button>
                            )}
                            <span className="text-xs font-medium text-blue-300">
                              {child.label}
                            </span>
                          </div>

                          {/* Input fields for child */}
                          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                            {years.map((y) => {
                              const storedValue = child.values?.[y] ?? 0;
                              const isCurrency = child.valueType === "currency";
                              
                              // Only apply currency unit scaling for currency values
                              const displayValue = isCurrency
                                ? storedToDisplay(storedValue, meta.currencyUnit)
                                : storedValue;
                              const unitLabel = isCurrency ? getUnitLabel(meta.currencyUnit) : "";
                              
                              return (
                                <label key={y} className="block">
                                  <div className="mb-1 text-[10px] text-slate-400">
                                    {y} {unitLabel && `(${unitLabel})`}
                                    {child.valueType === "percent" && " (%)"}
                                    {child.valueType === "number" && " (units)"}
                                  </div>
                                  <input
                                    type="number"
                                    step={child.valueType === "percent" ? "0.01" : "any"}
                                    className="w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                                    value={displayValue === 0 ? "" : displayValue}
                                    onChange={(e) => {
                                      const inputNum = Number(e.target.value || 0);
                                      // Only scale currency values
                                      const storedNum = isCurrency
                                        ? displayToStored(inputNum, meta.currencyUnit)
                                        : inputNum;
                                      updateRowValue(statement, child.id, y, storedNum);
                                    }}
                                    placeholder="0"
                                  />
                                </label>
                              );
                            })}
                          </div>

                          {/* Remove button */}
                          <button
                            onClick={() => removeRow(statement, child.id)}
                            className="mt-2 text-[10px] text-red-400 hover:text-red-300"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {flat.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-500">
            No rows yet. The statement structure will be initialized when you start building.
          </div>
        )}
      </div>
    </div>
  );
}
