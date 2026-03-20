"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ForecastRevenueNodeV1 } from "@/types/revenue-forecast-v1";
import type { RevenueForecastConfigV1 } from "@/types/revenue-forecast-v1";
import {
  getAllocationPercentSum,
  REVENUE_ALLOC_SUM_TOLERANCE,
} from "@/lib/revenue-forecast-v1-validation";
import { useModelStore } from "@/store/useModelStore";
import { formatNumberInputDisplayOnBlur } from "@/lib/revenue-forecast-numeric-format";
import { RevenueForecastDecimalInput } from "@/components/revenue-forecast-decimal-input";

export type AllocationRowStatus = "ready" | "incomplete" | "invalid";

export function allocationRowStatus(
  committedPct: number | undefined,
  localUnsaved: boolean,
  siblingSum: number,
  siblingCount: number
): AllocationRowStatus {
  if (siblingCount === 0) return "incomplete";
  if (siblingSum > 100 + REVENUE_ALLOC_SUM_TOLERANCE) return "invalid";
  if (localUnsaved) return "incomplete";
  if (Math.abs(siblingSum - 100) > REVENUE_ALLOC_SUM_TOLERANCE) return "incomplete";
  if (committedPct == null || !Number.isFinite(committedPct)) return "incomplete";
  return "ready";
}

export function RowStatusPill({ status }: { status: AllocationRowStatus }) {
  const map = {
    ready: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50",
    incomplete: "bg-amber-900/45 text-amber-200 border-amber-700/45",
    invalid: "bg-red-900/40 text-red-200 border-red-700/50",
  } as const;
  const label = status === "ready" ? "Ready" : status === "incomplete" ? "Incomplete" : "Invalid";
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-semibold border ${map[status]}`}>{label}</span>
  );
}

export function AllocationRowCard(props: {
  node: ForecastRevenueNodeV1;
  /** All allocation siblings under same parent (including this node). */
  siblingNodes: ForecastRevenueNodeV1[];
  rows: RevenueForecastConfigV1["rows"];
  setRevenueForecastRowV1: (rowId: string, patch: Record<string, unknown>) => void;
  onRemove: () => void;
  titleLine: string;
  formulaLine: string;
  flash?: boolean;
  /** Increment to expand row and focus the % field (after add). */
  allocPctFocusNonce?: number;
}) {
  const {
    node,
    siblingNodes,
    rows,
    setRevenueForecastRowV1,
    onRemove,
    flash,
    titleLine,
    formulaLine,
    allocPctFocusNonce = 0,
  } = props;
  const renameNode = useModelStore((s) => s.renameRevenueForecastTreeNodeV1);
  const cParams = (rows[node.id]?.forecastParameters ?? {}) as Record<string, unknown>;
  const committed = typeof cParams.allocationPercent === "number" ? cParams.allocationPercent : undefined;
  const [collapsed, setCollapsed] = useState(false);
  const [localStr, setLocalStr] = useState(() =>
    committed != null && Number.isFinite(committed) ? String(committed) : ""
  );
  const [baseline, setBaseline] = useState(committed);
  const [nameDraft, setNameDraft] = useState(node.label);
  const pctInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNameDraft(node.label);
  }, [node.id, node.label]);

  useEffect(() => {
    const c = typeof cParams.allocationPercent === "number" ? cParams.allocationPercent : undefined;
    setBaseline(c);
    setLocalStr(c != null && Number.isFinite(c) ? formatNumberInputDisplayOnBlur(String(c)) : "");
  }, [node.id, cParams.allocationPercent]);

  useEffect(() => {
    if (allocPctFocusNonce <= 0) return;
    setCollapsed(false);
    const t = requestAnimationFrame(() => pctInputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [allocPctFocusNonce]);

  const parsed = parseFloat(localStr.replace(/,/g, "").trim());
  const appliedNum = baseline ?? NaN;
  const localUnsaved =
    Number.isFinite(parsed) !== Number.isFinite(appliedNum) ||
    (Number.isFinite(parsed) && Number.isFinite(appliedNum) && Math.abs(parsed - appliedNum) > 1e-9) ||
    (!Number.isFinite(parsed) && localStr.trim() !== "");

  const siblingSum = getAllocationPercentSum(siblingNodes, rows);
  const status = allocationRowStatus(baseline, localUnsaved, siblingSum, siblingNodes.length);

  const apply = useCallback(() => {
    const t = localStr.replace(/,/g, "").trim();
    if (t === "") return;
    let v = parseFloat(t);
    if (!Number.isFinite(v)) return;
    v = Math.max(0, Math.min(100, v));
    setRevenueForecastRowV1(node.id, {
      forecastParameters: { ...cParams, allocationPercent: v },
    });
    setBaseline(v);
    setLocalStr(formatNumberInputDisplayOnBlur(String(v)));
  }, [localStr, node.id, cParams, setRevenueForecastRowV1]);

  const resetLocal = useCallback(() => {
    setLocalStr(
      baseline != null && Number.isFinite(baseline) ? formatNumberInputDisplayOnBlur(String(baseline)) : ""
    );
  }, [baseline]);

  const displayPct =
    baseline != null && Number.isFinite(baseline) ? `${Number(baseline)}%` : "—%";

  return (
    <div
      className={`rounded-lg border border-violet-600/50 overflow-hidden mb-2.5 shadow-sm shadow-black/20 ${
        flash ? "ring-2 ring-violet-400/45" : ""
      }`}
    >
      <div className="bg-slate-950/60 border-b border-slate-600/55 px-2 py-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-slate-400 hover:text-slate-200 w-6 text-xs shrink-0"
          aria-expanded={!collapsed}
        >
          {collapsed ? "▶" : "▼"}
        </button>
        <input
          type="text"
          aria-label="Line name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            const t = nameDraft.trim();
            if (t && t !== node.label) renameNode(node.id, t);
            else if (!t) setNameDraft(node.label);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="text-sm font-medium text-slate-100 bg-slate-900/80 border border-slate-700 rounded px-1.5 py-0.5 min-w-[120px] max-w-[220px]"
        />
        <span className="text-[11px] text-slate-400 tabular-nums">{displayPct}</span>
        <span className="rounded bg-violet-950/50 px-1.5 py-0.5 text-[10px] text-violet-200/90">Allocation</span>
        <RowStatusPill status={status} />
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto text-[10px] text-red-400 hover:text-red-300 px-2 py-0.5 rounded border border-red-900/30"
        >
          Remove
        </button>
      </div>
      {collapsed ? (
        <p className="text-[10px] text-slate-500 px-3 py-2 pl-10">
          {node.label} · {displayPct} · Allocation
        </p>
      ) : (
        <div className="p-3 space-y-3 bg-slate-950/40">
          <div className="rounded-md border border-slate-600/55 px-3 py-2 text-[11px] text-slate-300 space-y-1">
            <div className="font-semibold text-slate-200">{titleLine}</div>
            <div className="text-slate-400">{formulaLine}</div>
            <p className="text-[10px] text-slate-500">
              This line is a % of the row above. It is not forecast independently. Sub-lines must total exactly 100%.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500">%</span>
            <RevenueForecastDecimalInput
              ref={pctInputRef}
              value={localStr}
              onChange={setLocalStr}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  apply();
                }
              }}
              className="w-16 rounded border border-slate-600 bg-slate-800 text-xs px-2 py-1.5 text-right tabular-nums text-slate-100"
            />
            <span className="text-[11px] font-medium text-slate-400">%</span>
            {localUnsaved ? (
              <span className="text-[10px] text-amber-300/90 font-medium">Unsaved</span>
            ) : null}
            <button
              type="button"
              onClick={apply}
              disabled={!localUnsaved || !Number.isFinite(parsed)}
              className="rounded bg-emerald-700 text-white text-[10px] px-2.5 py-1 font-medium disabled:opacity-40 hover:bg-emerald-600"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={resetLocal}
              disabled={!localUnsaved}
              className="rounded border border-slate-600 bg-slate-800 text-slate-200 text-[10px] px-2.5 py-1 font-medium disabled:opacity-40 hover:bg-slate-700"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
