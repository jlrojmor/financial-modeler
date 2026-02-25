"use client";

import { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import type { RevenueBreakdownItem, PctOfTotalInputs } from "@/types/revenue-projection";
import { hasInvalidBreakdownMix } from "@/types/revenue-projection";

type BreakdownRole = "driver" | "pct_of_parent" | "residual";

interface RevenueBreakdownAllocationProps {
  parentStream: Row;
  /** Breakdown items from IS Build config (not from tree). */
  breakdownItems: RevenueBreakdownItem[];
  /** First projection year (e.g. "2026E") for label. */
  firstProjectionYear: string;
}

/**
 * Allocation for projection years only. User sets % per breakdown (sum = 100%).
 * Applies from first projection year onwards. Historics are fixed and untouched.
 */
export default function RevenueBreakdownAllocation({
  parentStream,
  breakdownItems,
  firstProjectionYear,
}: RevenueBreakdownAllocationProps) {
  const revenueProjectionConfig = useModelStore((s) => s.revenueProjectionConfig);
  const setProjectionAllocation = useModelStore((s) => s.setProjectionAllocation);
  const setRevenueProjectionInputs = useModelStore((s) => s.setRevenueProjectionInputs);
  const [localInputs, setLocalInputs] = useState<Record<string, string>>({});

  const projectionAllocation = useMemo(() => {
    return revenueProjectionConfig?.projectionAllocations?.[parentStream.id] ?? null;
  }, [revenueProjectionConfig, parentStream.id]);

  const items = revenueProjectionConfig?.items ?? {};

  const invalidMix = useMemo(
    () =>
      hasInvalidBreakdownMix(
        breakdownItems.map((b) => b.id),
        items,
        parentStream.id
      ),
    [breakdownItems, items, parentStream.id]
  );

  const roleAndPct = useMemo(() => {
    return breakdownItems.map((item) => {
      const method = items[item.id]?.method;
      const isDriver = method === "price_volume" || method === "customers_arpu";
      const refId = (items[item.id]?.inputs as PctOfTotalInputs | undefined)?.referenceId ?? "rev";
      const isPctOfParent = method === "pct_of_total" && refId === parentStream.id;
      const role: BreakdownRole = isDriver ? "driver" : isPctOfParent ? "pct_of_parent" : "residual";
      const pctFromMethod = isPctOfParent ? ((items[item.id]?.inputs as PctOfTotalInputs)?.pctOfTotal ?? 0) : 0;
      return { item, role, pct: pctFromMethod };
    });
  }, [breakdownItems, items, parentStream.id]);

  const pctOfParentItems = roleAndPct.filter((r) => r.role === "pct_of_parent");
  const pctOfParentSum = useMemo(
    () => pctOfParentItems.reduce((s, r) => s + r.pct, 0),
    [pctOfParentItems]
  );
  const hasPctOfParent = pctOfParentItems.length > 0;

  const handlePctOfStreamChange = (itemId: string, pct: number) => {
    const cfg = items[itemId];
    if (!cfg || cfg.method !== "pct_of_total") return;
    const prev = cfg.inputs as PctOfTotalInputs;
    setRevenueProjectionInputs(itemId, { ...prev, referenceId: prev.referenceId ?? parentStream.id, pctOfTotal: pct });
  };

  const distributeEvenlyAmongPctOfStream = () => {
    if (pctOfParentItems.length < 2) return;
    const pctEach = 100 / pctOfParentItems.length;
    pctOfParentItems.forEach((r) => handlePctOfStreamChange(r.item.id, pctEach));
  };

  if (invalidMix) {
    return (
      <div className="rounded-lg border border-red-800/60 bg-red-950/30 p-4 space-y-2">
        <h4 className="text-xs font-semibold text-red-200">
          Invalid mix of projection methods
        </h4>
        <p className="text-[10px] text-red-300/90">
          This stream mixes <strong>growth</strong> (e.g. % growth, product line, channel), <strong>$ output</strong> (Price × Volume, Customers × ARPU), and <strong>% of this stream</strong> in the same breakdown set. Use at most two of these so projections stay consistent.
        </p>
        <p className="text-[10px] text-red-200/80">
          Change one or more breakdowns to a different projection method so you have only: growth-type only, $ only, growth + $, growth + % of stream, or $ + % of stream.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-green-800/40 bg-green-950/20 p-4 space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-green-200 mb-1">
          Allocation weight (only for &quot;% of this stream&quot;)
        </h4>
        <p className="text-[10px] text-green-300/80">
          The only allocation weight you can set is for a breakdown that is <strong>X% of {parentStream.label}</strong>. That item has no growth option — it is calculated as that % of the stream total and grows with the stream. All other breakdowns are forecast in $ (growth, Price×Volume, etc.) and their share is derived.
        </p>
      </div>

      <div className="space-y-2">
        {roleAndPct.map(({ item, role, pct }) => {
          const pctInputKey = `pct_${item.id}`;
          const localPct = localInputs[pctInputKey];
          const isEditable = role === "pct_of_parent";

          return (
            <div key={item.id} className="flex items-center gap-2">
              <span className="text-xs text-slate-300 w-40 truncate">
                {item.label}
                {role === "driver" && (
                  <span className="ml-1 text-slate-500">(from forecast $)</span>
                )}
                {role === "residual" && (
                  <span className="ml-1 text-slate-500">(from forecast $)</span>
                )}
              </span>
              <div className="flex-1 flex items-center gap-2">
                {isEditable ? (
                  <>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      max={100}
                      className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                      value={localPct !== undefined ? localPct : (pct === 0 ? "" : pct.toFixed(1))}
                      onChange={(e) => {
                        const inputVal = e.target.value;
                        if (inputVal === "" || inputVal === "-" || /^-?\d*\.?\d*$/.test(inputVal)) {
                          setLocalInputs((prev) => ({ ...prev, [pctInputKey]: inputVal }));
                          if (inputVal === "" || inputVal === "-") {
                            handlePctOfStreamChange(item.id, 0);
                          } else {
                            const val = parseFloat(inputVal);
                            if (!isNaN(val)) handlePctOfStreamChange(item.id, val);
                          }
                        }
                      }}
                      onBlur={() => {
                        setLocalInputs((prev) => {
                          const next = { ...prev };
                          delete next[pctInputKey];
                          return next;
                        });
                      }}
                      placeholder="0"
                    />
                    <span className="text-xs text-slate-500">% of stream</span>
                  </>
                ) : (
                  <span className="text-xs text-slate-500 italic">
                    From forecast (no weight)
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasPctOfParent && (
        <div className="flex items-center justify-between pt-2 border-t border-slate-700">
          <div className="text-xs">
            <span className="text-slate-400">Sum of &quot;% of stream&quot; targets: </span>
            <span className="font-medium text-green-400">
              {pctOfParentSum.toFixed(1)}%
            </span>
            <span className="text-slate-500 ml-1">
              (rest from $ forecasts)
            </span>
          </div>
          {pctOfParentItems.length > 1 && (
            <button
              type="button"
              onClick={distributeEvenlyAmongPctOfStream}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Distribute evenly
            </button>
          )}
        </div>
      )}

      {hasPctOfParent && (
        <p className="text-[10px] text-green-400">
          ✓ &quot;% of stream&quot; items will be that % of {parentStream.label} from {firstProjectionYear} onwards and grow with the stream.
        </p>
      )}
    </div>
  );
}
