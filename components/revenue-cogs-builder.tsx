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
import CollapsibleSection from "@/components/collapsible-section";

/**
 * Guided Revenue & COGS Builder
 * 
 * This component provides a friendly, step-by-step interface for:
 * 1. Adding revenue streams (all at same level under Revenue)
 * 2. Adding corresponding COGS for each revenue stream
 * 3. Making it clear what's calculated vs input
 */
export default function RevenueCogsBuilder() {
  const meta = useModelStore((s) => s.meta);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const updateRowValue = useModelStore((s) => s.updateRowValue);
  const addChildRow = useModelStore((s) => s.addChildRow);
  const removeRow = useModelStore((s) => s.removeRow);

  const [newRevenueStream, setNewRevenueStream] = useState("");
  const [showAddRevenue, setShowAddRevenue] = useState(false);

  // Check if sections are locked
  const isRevenueLocked = useModelStore((s) => s.sectionLocks["revenue"] ?? false);
  const isCogsLocked = useModelStore((s) => s.sectionLocks["cogs"] ?? false);

  const years = useMemo(() => {
    const hist = meta?.years?.historical ?? [];
    return hist;
  }, [meta]);

  // Find Revenue and COGS rows
  const revenueRow = incomeStatement.find((r) => r.id === "rev");
  const cogsRow = incomeStatement.find((r) => r.id === "cogs");
  const grossProfitRow = incomeStatement.find((r) => r.id === "gross_profit");
  const grossMarginRow = incomeStatement.find((r) => r.id === "gross_margin");

  const revenueStreams = revenueRow?.children ?? [];
  const cogsStreams = cogsRow?.children ?? [];

  const hasRevenueStreams = revenueStreams.length > 0;

  const handleAddRevenueStream = () => {
    const trimmed = newRevenueStream.trim();
    if (!trimmed) return;

    // Add revenue stream
    addChildRow("incomeStatement", "rev", trimmed);

    // Automatically add corresponding COGS stream
    addChildRow("incomeStatement", "cogs", `${trimmed} COGS`);

    setNewRevenueStream("");
    setShowAddRevenue(false);
  };

  return (
    <div className="space-y-6">
      {/* Revenue Section */}
      <CollapsibleSection
        sectionId="revenue"
        title="Revenue"
        description={
          hasRevenueStreams
            ? "Revenue is calculated from the sum of revenue streams below."
            : "Add revenue streams to break down your revenue. Each stream will have its own COGS."
        }
        borderColor="border-blue-800/40"
        bgColor="bg-blue-950/20"
        textColor="text-blue-200"
        confirmButtonLabel="Done"
      >

        {/* Revenue Total - Input when no streams, Calculated when streams exist */}
        <div className="mb-4 rounded-md border border-blue-700/40 bg-blue-950/40 p-3">
          <div className="mb-2 text-xs font-semibold text-blue-200">
            {hasRevenueStreams ? "Total Revenue (calculated)" : "Total Revenue"}
          </div>
          {hasRevenueStreams ? (
            // Show calculated value
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {years.map((y) => {
                const storedValue = revenueRow?.values?.[y] ?? 0;
                const display = formatCurrencyDisplay(
                  storedValue,
                  meta.currencyUnit,
                  meta.currency
                );
                return (
                  <div key={y} className="block">
                    <div className="mb-1 text-[10px] text-blue-400">{y}</div>
                    <div className="rounded-md border border-blue-800 bg-blue-950/60 px-2 py-1 text-xs font-semibold text-blue-200">
                      {storedValue !== 0 ? display : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // Show input fields
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {years.map((y) => {
                const storedValue = revenueRow?.values?.[y] ?? 0;
                const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
                const unitLabel = getUnitLabel(meta.currencyUnit);
                return (
                  <label key={y} className="block">
                    <div className="mb-1 text-[10px] text-blue-400">
                      {y} {unitLabel && `(${unitLabel})`}
                    </div>
                    <input
                      type="number"
                      step="any"
                      className="w-full rounded-md border border-blue-800 bg-blue-950 px-2 py-1 text-xs text-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      value={displayValue === 0 ? "" : displayValue}
                      onChange={(e) => {
                        const displayNum = Number(e.target.value || 0);
                        const storedNum = displayToStored(displayNum, meta.currencyUnit);
                        updateRowValue("incomeStatement", "rev", y, storedNum);
                      }}
                      placeholder="0"
                      disabled={isRevenueLocked}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Add Revenue Stream */}
        <div className="mb-4">
          {!showAddRevenue ? (
            <button
              onClick={() => setShowAddRevenue(true)}
              className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isRevenueLocked}
              type="button"
            >
              + Add Revenue Stream
            </button>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 rounded-md border border-blue-700 bg-blue-950/40 px-3 py-2 text-xs text-blue-100 placeholder:text-blue-400"
                placeholder="e.g., Subscription Revenue, Product Sales..."
                value={newRevenueStream}
                onChange={(e) => setNewRevenueStream(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddRevenueStream();
                  } else if (e.key === "Escape") {
                    setShowAddRevenue(false);
                    setNewRevenueStream("");
                  }
                }}
                autoFocus
              />
              <button
                onClick={handleAddRevenueStream}
                className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setShowAddRevenue(false);
                  setNewRevenueStream("");
                }}
                className="rounded-md bg-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          )}
          {showAddRevenue && (
            <p className="mt-2 text-[10px] text-blue-300/60">
              A matching COGS line will be created automatically for this revenue stream.
            </p>
          )}
        </div>

        {/* Revenue Streams */}
        {revenueStreams.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-blue-200 mb-2">
              Revenue Streams:
            </div>
            {revenueStreams.map((stream) => {
              const unitLabel = getUnitLabel(meta.currencyUnit);
              return (
                <div
                  key={stream.id}
                  className="rounded-md border border-blue-700/40 bg-blue-950/40 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-200">
                      {stream.label}
                    </span>
                    <button
                      onClick={() => {
                        // Remove revenue stream
                        removeRow("incomeStatement", stream.id);
                        // Also remove corresponding COGS if it exists
                        const matchingCogs = cogsStreams.find((c) =>
                          c.label.toLowerCase().includes(stream.label.toLowerCase())
                        );
                        if (matchingCogs) {
                          removeRow("incomeStatement", matchingCogs.id);
                        }
                      }}
                      className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isRevenueLocked}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                    {years.map((y) => {
                      const storedValue = stream.values?.[y] ?? 0;
                      const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
                      return (
                        <label key={y} className="block">
                          <div className="mb-1 text-[10px] text-blue-400">
                            {y} {unitLabel && `(${unitLabel})`}
                          </div>
                          <input
                            type="number"
                            step="any"
                            className="w-full rounded-md border border-blue-800 bg-blue-950 px-2 py-1 text-xs text-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            value={displayValue === 0 ? "" : String(displayValue)}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || val === "-") {
                                updateRowValue("incomeStatement", stream.id, y, 0);
                                return;
                              }
                              const displayNum = Number(val);
                              if (!isNaN(displayNum)) {
                                const storedNum = displayToStored(displayNum, meta.currencyUnit);
                                updateRowValue("incomeStatement", stream.id, y, storedNum);
                              }
                            }}
                            onBlur={(e) => {
                              // Ensure value is set even if empty
                              if (e.target.value === "") {
                                updateRowValue("incomeStatement", stream.id, y, 0);
                              }
                            }}
                            placeholder="0"
                            disabled={isRevenueLocked}
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
      </CollapsibleSection>

      {/* COGS Section */}
      <CollapsibleSection
        sectionId="cogs"
        title="Cost of Goods Sold (COGS)"
        description={
          hasRevenueStreams
            ? "Enter COGS for each revenue stream. Total COGS is calculated automatically."
            : "Add revenue streams first, then enter COGS for each stream."
        }
        borderColor="border-orange-800/40"
        bgColor="bg-orange-950/20"
        textColor="text-orange-200"
        confirmButtonLabel="Done"
      >

        {/* COGS Total - Input when no streams, Calculated when streams exist */}
        <div className="mb-4 rounded-md border border-orange-700/40 bg-orange-950/40 p-3">
          <div className="mb-2 text-xs font-semibold text-orange-200">
            {hasRevenueStreams ? "Total COGS (calculated)" : "Total COGS"}
          </div>
          {hasRevenueStreams ? (
            // Show calculated value
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {years.map((y) => {
                const storedValue = cogsRow?.values?.[y] ?? 0;
                const display = formatCurrencyDisplay(
                  storedValue,
                  meta.currencyUnit,
                  meta.currency
                );
                return (
                  <div key={y} className="block">
                    <div className="mb-1 text-[10px] text-orange-400">{y}</div>
                    <div className="rounded-md border border-orange-800 bg-orange-950/60 px-2 py-1 text-xs font-semibold text-orange-200">
                      {storedValue !== 0 ? display : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // Show input fields
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {years.map((y) => {
                const storedValue = cogsRow?.values?.[y] ?? 0;
                const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
                const unitLabel = getUnitLabel(meta.currencyUnit);
                return (
                  <label key={y} className="block">
                    <div className="mb-1 text-[10px] text-orange-400">
                      {y} {unitLabel && `(${unitLabel})`}
                    </div>
                    <input
                      type="number"
                      step="any"
                      className="w-full rounded-md border border-orange-800 bg-orange-950 px-2 py-1 text-xs text-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      value={displayValue === 0 ? "" : displayValue}
                      onChange={(e) => {
                        const displayNum = Number(e.target.value || 0);
                        const storedNum = displayToStored(displayNum, meta.currencyUnit);
                        updateRowValue("incomeStatement", "cogs", y, storedNum);
                      }}
                      placeholder="0"
                      disabled={isCogsLocked}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* COGS Streams (matching revenue streams) */}
        {cogsStreams.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-orange-200 mb-2">
              COGS by Revenue Stream:
            </div>
            {cogsStreams.map((cogsStream) => {
              const unitLabel = getUnitLabel(meta.currencyUnit);
              // Find matching revenue stream name
              const matchingRevenue = revenueStreams.find((r) =>
                cogsStream.label.toLowerCase().includes(r.label.toLowerCase())
              );
              return (
                <div
                  key={cogsStream.id}
                  className="rounded-md border border-orange-700/40 bg-orange-950/40 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-orange-200">
                        {cogsStream.label}
                      </span>
                      {matchingRevenue && (
                        <span className="ml-2 text-[10px] text-orange-400">
                          (for {matchingRevenue.label})
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => removeRow("incomeStatement", cogsStream.id)}
                      className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isCogsLocked}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                    {years.map((y) => {
                      const storedValue = cogsStream.values?.[y] ?? 0;
                      const displayValue = storedToDisplay(storedValue, meta.currencyUnit);
                      return (
                        <label key={y} className="block">
                          <div className="mb-1 text-[10px] text-orange-400">
                            {y} {unitLabel && `(${unitLabel})`}
                          </div>
                          <input
                            type="number"
                            step="any"
                            className="w-full rounded-md border border-orange-800 bg-orange-950 px-2 py-1 text-xs text-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            value={displayValue === 0 ? "" : String(displayValue)}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || val === "-") {
                                updateRowValue("incomeStatement", cogsStream.id, y, 0);
                                return;
                              }
                              const displayNum = Number(val);
                              if (!isNaN(displayNum)) {
                                const storedNum = displayToStored(displayNum, meta.currencyUnit);
                                updateRowValue("incomeStatement", cogsStream.id, y, storedNum);
                              }
                            }}
                            onBlur={(e) => {
                              // Ensure value is set even if empty
                              if (e.target.value === "") {
                                updateRowValue("incomeStatement", cogsStream.id, y, 0);
                              }
                            }}
                            placeholder="0"
                            disabled={isCogsLocked}
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

        {!hasRevenueStreams && (
          <div className="rounded-md border border-orange-700/40 bg-orange-950/40 p-3 text-center">
            <p className="text-xs text-orange-400">
              Add revenue streams above to create corresponding COGS lines.
            </p>
          </div>
        )}
      </CollapsibleSection>

      {/* Gross Profit Section - Always shown */}
      <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-4">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-emerald-200 mb-1">
            Gross Profit (calculated)
          </h3>
          <p className="text-xs text-emerald-300/80">
            Gross Profit = Total Revenue - Total COGS
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          {years.map((y) => {
            const storedValue = grossProfitRow?.values?.[y] ?? 0;
            const display = formatCurrencyDisplay(
              storedValue,
              meta.currencyUnit,
              meta.currency
            );
            return (
              <div key={y} className="block">
                <div className="mb-1 text-[10px] text-emerald-400">{y}</div>
                <div className="rounded-md border border-emerald-800 bg-emerald-950/60 px-2 py-1 text-xs font-semibold text-emerald-200">
                  {storedValue !== 0 ? display : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Gross Margin Section - Always shown */}
      <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-4">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-emerald-200 mb-1">
            Gross Margin % (calculated)
          </h3>
          <p className="text-xs text-emerald-300/80">
            Gross Margin % = (Gross Profit / Revenue) × 100
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          {years.map((y) => {
            const storedValue = grossMarginRow?.values?.[y] ?? 0;
            const display = storedValue !== 0 ? `${storedValue.toFixed(2)}%` : "—";
            return (
              <div key={y} className="block">
                <div className="mb-1 text-[10px] text-emerald-400">{y}</div>
                <div className="rounded-md border border-emerald-800 bg-emerald-950/60 px-2 py-1 text-xs font-semibold text-emerald-200">
                  {display}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
