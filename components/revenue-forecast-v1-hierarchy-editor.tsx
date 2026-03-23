"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ForecastRevenueNodeV1 } from "@/types/revenue-forecast-v1";
import type { RevenueForecastConfigV1 } from "@/types/revenue-forecast-v1";
import {
  getAllocationPercentSum,
  REVENUE_ALLOC_SUM_TOLERANCE,
} from "@/lib/revenue-forecast-v1-validation";
import {
  METHODOLOGY,
  getDirectForecastCompactSummary,
  getDirectForecastRowUiStatusWithAlloc,
  DERIVED_PARENT_EXPLAINER,
  ALLOCATION_LINE_TITLE,
  ALLOCATION_FORMULA_LINE,
  ALLOCATION_LINE_TITLE_PARENT,
  ALLOCATION_FORMULA_PARENT,
} from "@/lib/revenue-forecast-v1-methodology";
import {
  RevenueForecastV1DirectForecastBlock,
  RevenueForecastV1MethodologyCallout,
} from "@/components/revenue-forecast-v1-direct-forecast-block";
import { RevenueForecastLineNameAdd } from "@/components/revenue-forecast-v1-deferred-input";
import { AllocationRowCard, RowStatusPill } from "@/components/revenue-forecast-v1-allocation-row";
import {
  getRevenueRowStructuralMode,
  structuralModeLabel,
  getRevenueRowDataBasis,
  dataBasisLabel,
  expandIdsForNodePath,
} from "@/lib/revenue-row-state-v1";
import { useModelStore } from "@/store/useModelStore";

type Unit = "units" | "thousands" | "millions";

function allowGrowthFromHistoricalForNode(
  node: ForecastRevenueNodeV1,
  lastHistoricByRowId: Record<string, number> | undefined
): boolean {
  if (node.isForecastOnly) return false;
  const v = lastHistoricByRowId?.[node.id];
  return typeof v === "number" && !Number.isNaN(v);
}

type ModalState =
  | null
  | {
      kind: "direct_alloc_to_derived";
      nodeId: string;
      label: string;
      nAlloc: number;
    }
  | { kind: "derived_to_direct"; nodeId: string; label: string; nChildren: number }
  | { kind: "remove_all_alloc"; nodeId: string; label: string }
  | { kind: "standalone_to_derived"; nodeId: string; label: string };

function ConfirmModal(props: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
      <div className="max-w-md rounded-lg border border-slate-600 bg-slate-900 p-4 shadow-xl space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">{props.title}</h3>
        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{props.body}</p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            className="rounded bg-amber-700 px-3 py-1.5 text-xs text-white hover:bg-amber-600"
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function RowStatusHeader(props: {
  rowId: string;
  name: string;
  modeLabel: string;
  basisLabel: string;
  children: React.ReactNode;
  flash?: boolean;
}) {
  return (
    <div
      data-revenue-row-id={props.rowId}
      className={`rounded-t-lg border-b border-slate-500/75 px-3 py-2 space-y-2 transition-colors duration-500 ${
        props.flash ? "bg-amber-900/35 ring-1 ring-amber-500/50" : "bg-slate-950/50"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-100">{props.name}</span>
        <span className="rounded bg-slate-700/80 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200/90">
          {props.modeLabel}
        </span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{props.basisLabel}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">{props.children}</div>
    </div>
  );
}

export function RevenueForecastV1HierarchyEditor(props: {
  revIsDerived: boolean;
  forest: ForecastRevenueNodeV1[];
  rows: RevenueForecastConfigV1["rows"];
  setRevenueForecastRowV1: (rowId: string, patch: Record<string, unknown>) => void;
  addRevenueStreamChild: (parentId: string, label: string) => string | undefined;
  removeRow: (rowId: string) => void;
  expandedStreams: Set<string>;
  toggleExpanded: (id: string) => void;
  /** Merge these ids into expanded set (ancestors + target). */
  ensureExpandedIds: (ids: string[]) => void;
  /** Briefly highlight a row card (scroll target). */
  flashRowId: string | null;
  /** When false, ring highlight still applies but scrollIntoView is skipped (e.g. existing row after modal). */
  flashRowScrollIntoView?: boolean;
  onFlashRow: (rowId: string, opts?: { scrollIntoView?: boolean }) => void;
  lastHistoricByRowId: Record<string, number> | undefined;
  projectionYears: string[];
  unit: Unit;
  /** ISO currency for Price × Volume driver labels (not K/M display). */
  currencyCode?: string;
  /** Focus first input on this direct row after add (top-level from tab). */
  pendingDirectFocusRowId?: string | null;
  onConsumedDirectFocus?: () => void;
  /** Focus allocation % on this row after add (top-level allocation from tab). */
  pendingAllocationFocusRowId?: string | null;
  onConsumedAllocationFocus?: () => void;
}) {
  const {
    revIsDerived,
    forest,
    rows,
    setRevenueForecastRowV1,
    addRevenueStreamChild,
    removeRow,
    expandedStreams,
    toggleExpanded,
    ensureExpandedIds,
    flashRowId,
    flashRowScrollIntoView = true,
    onFlashRow,
    lastHistoricByRowId,
    projectionYears,
    unit,
    currencyCode = "USD",
    pendingDirectFocusRowId,
    onConsumedDirectFocus,
    pendingAllocationFocusRowId,
    onConsumedAllocationFocus,
  } = props;

  const [modal, setModal] = useState<ModalState>(null);
  /** Collapsed forecast cards (direct rows + derived “build from children” parents). */
  const [collapsedForecastCards, setCollapsedForecastCards] = useState<Set<string>>(() => new Set());
  const [directFocusNonce, setDirectFocusNonce] = useState<Record<string, number>>({});
  const [allocPctFocusNonce, setAllocPctFocusNonce] = useState<Record<string, number>>({});
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const bumpDirectFocus = useCallback((rowId: string) => {
    setCollapsedForecastCards((prev) => {
      const n = new Set(prev);
      n.delete(rowId);
      return n;
    });
    setDirectFocusNonce((prev) => ({ ...prev, [rowId]: (prev[rowId] ?? 0) + 1 }));
  }, []);

  /** Ensure ancestor cards are expanded so a new/edited nested line is visible. */
  const expandForecastCardsOnPath = useCallback((targetId: string) => {
    const tree = useModelStore.getState().revenueForecastTreeV1 ?? [];
    const path = expandIdsForNodePath(tree, targetId);
    if (!path?.length) return;
    setCollapsedForecastCards((prev) => {
      const next = new Set(prev);
      path.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  useEffect(() => {
    const id = pendingDirectFocusRowId;
    if (!id || !onConsumedDirectFocus) return;
    const exists = findNode(useModelStore.getState().revenueForecastTreeV1 ?? [], id);
    if (!exists) return;
    bumpDirectFocus(id);
    onConsumedDirectFocus();
  }, [pendingDirectFocusRowId, onConsumedDirectFocus, bumpDirectFocus]);

  useEffect(() => {
    const id = pendingAllocationFocusRowId;
    if (!id || !onConsumedAllocationFocus) return;
    const exists = findNode(useModelStore.getState().revenueForecastTreeV1 ?? [], id);
    if (!exists) return;
    setAllocPctFocusNonce((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    onConsumedAllocationFocus();
  }, [pendingAllocationFocusRowId, onConsumedAllocationFocus]);

  const setRowRef = useCallback((id: string, el: HTMLDivElement | null) => {
    rowRefs.current[id] = el;
  }, []);

  useEffect(() => {
    if (!flashRowId) return;
    if (!flashRowScrollIntoView) return;
    const el = rowRefs.current[flashRowId];
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [flashRowId, flashRowScrollIntoView]);

  const afterAdd = useCallback(
    (
      newId: string | undefined,
      opts?: { allocationParentDirectId?: string; scrollToRow?: boolean; expandPath?: boolean }
    ) => {
      if (!newId) return;
      const scrollToRow = opts?.scrollToRow !== false;
      const expandPath = opts?.expandPath !== false;
      const tree = useModelStore.getState().revenueForecastTreeV1 ?? [];
      if (expandPath) {
        const path = expandIdsForNodePath(tree, newId);
        if (path?.length) ensureExpandedIds(path);
        expandForecastCardsOnPath(newId);
      }
      onFlashRow(newId, { scrollIntoView: scrollToRow });
      const role = useModelStore.getState().revenueForecastConfigV1?.rows?.[newId]?.forecastRole;
      if (role === "independent_driver") bumpDirectFocus(newId);
      if (role === "allocation_of_parent") {
        if (opts?.allocationParentDirectId) bumpDirectFocus(opts.allocationParentDirectId);
        setAllocPctFocusNonce((prev) => ({ ...prev, [newId]: (prev[newId] ?? 0) + 1 }));
      }
    },
    [ensureExpandedIds, onFlashRow, bumpDirectFocus, expandForecastCardsOnPath]
  );

  /** Top-level: Total Revenue direct → allocation lines only */
  if (!revIsDerived) {
    const sum = getAllocationPercentSum(forest, rows);
    const hasLines = forest.length > 0;
    return (
      <div className="space-y-3">
        {!hasLines ? (
          <p className="text-[11px] text-slate-500">
            Optional: add sub-lines below. Each is a % of Total Revenue. Sub-lines must total exactly 100% before projections run.
          </p>
        ) : (
          <>
            <RevenueForecastV1MethodologyCallout
              variant="allocate_from_parent"
              allocationSum={sum}
              hasChildren
              allocLineCount={forest.length}
              showAllocationExplainer
            />
            {forest.map((node) => (
              <div key={node.id} ref={(el) => setRowRef(node.id, el)} className="mb-2">
                <AllocationRowCard
                  node={node}
                  siblingNodes={forest}
                  rows={rows}
                  setRevenueForecastRowV1={setRevenueForecastRowV1}
                  onRemove={() => removeRow(node.id)}
                  titleLine={ALLOCATION_LINE_TITLE}
                  formulaLine={ALLOCATION_FORMULA_LINE}
                  flash={flashRowId === node.id}
                  allocPctFocusNonce={allocPctFocusNonce[node.id] ?? 0}
                />
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  const RecursiveNode = ({
    node,
    depth,
    allocSiblings,
  }: {
    node: ForecastRevenueNodeV1;
    depth: number;
    allocSiblings?: ForecastRevenueNodeV1[];
  }) => {
    const cfg = rows[node.id];
    const role = cfg?.forecastRole ?? "independent_driver";
    const hasCh = node.children.length > 0;
    const isOpen = expandedStreams.has(node.id);
    const allowHist = allowGrowthFromHistoricalForNode(node, lastHistoricByRowId);
    const mode = getRevenueRowStructuralMode(node, cfg);
    const basis = getRevenueRowDataBasis(mode, node, lastHistoricByRowId);

    if (role === "derived_sum") {
      const m = METHODOLOGY.build_from_children;
      const derivedCardExpanded = !collapsedForecastCards.has(node.id);
      const toggleDerivedCard = () => {
        setCollapsedForecastCards((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
      };
      return (
        <div
          ref={(el) => setRowRef(node.id, el)}
          className={`rounded-lg border border-amber-600/55 overflow-hidden mb-2.5 transition-shadow shadow-sm shadow-black/20 ${
            flashRowId === node.id ? "ring-2 ring-amber-400/50" : ""
          }`}
          style={{ marginLeft: depth * 12 }}
        >
          <RowStatusHeader
            rowId={node.id}
            name={node.label}
            modeLabel={structuralModeLabel(mode)}
            basisLabel={dataBasisLabel(basis)}
            flash={flashRowId === node.id}
          >
            <button
              type="button"
              onClick={toggleDerivedCard}
              className="text-slate-400 hover:text-slate-200 w-6 text-xs shrink-0 -ml-0.5"
              aria-expanded={derivedCardExpanded}
              title={derivedCardExpanded ? "Collapse card" : "Expand card"}
            >
              {derivedCardExpanded ? "▼" : "▶"}
            </button>
            <button
              type="button"
              onClick={() => {
                const wasOpen = isOpen;
                toggleExpanded(node.id);
                if (!wasOpen) {
                  ensureExpandedIds(
                    expandIdsForNodePath(useModelStore.getState().revenueForecastTreeV1 ?? [], node.id) ?? []
                  );
                }
              }}
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[10px] text-slate-300"
            >
              {node.children.length
                ? isOpen
                  ? "Hide breakdown"
                  : "Show breakdown"
                : "Show breakdown"}
            </button>
            <RevenueForecastLineNameAdd
              placeholder="Child line name"
              buttonLabel="Add child line"
              inputClassName="rounded border border-slate-600 bg-slate-800 text-xs px-2 py-1 w-40"
              onAdd={(t) => {
                const id = addRevenueStreamChild(node.id, t);
                afterAdd(id);
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (node.children.length > 0) {
                  setModal({
                    kind: "derived_to_direct",
                    nodeId: node.id,
                    label: node.label,
                    nChildren: node.children.length,
                  });
                } else {
                  setRevenueForecastRowV1(node.id, {
                    forecastRole: "independent_driver",
                    forecastMethod: "growth_rate",
                    forecastParameters: {
                      startingBasis: allowHist ? "last_historical" : "starting_amount",
                    },
                  });
                }
              }}
              className="rounded border border-amber-800/50 px-2 py-1 text-[10px] text-amber-200/90 hover:bg-amber-950/40"
            >
              Convert: forecast this line directly
            </button>
            <button
              type="button"
              onClick={() => removeRow(node.id)}
              className="rounded border border-red-900/40 px-2 py-1 text-[10px] text-red-400"
            >
              Remove
            </button>
          </RowStatusHeader>
          {!derivedCardExpanded ? (
            <div className="px-3 py-2 bg-slate-950/30 border-t border-amber-800/35">
              <p className="text-[10px] text-slate-400 leading-snug pl-1">
                {m.title} · {node.children.length} component line{node.children.length === 1 ? "" : "s"}
              </p>
            </div>
          ) : (
            <div className="p-3 pl-4 space-y-2 bg-slate-950/30 border-t border-amber-800/35">
              <div className="rounded-md border border-amber-700/45 bg-amber-950/10 px-3 py-2 text-[11px] text-amber-100/85 space-y-1">
                <div className="font-semibold text-amber-200/90">{m.title}</div>
                <div className="text-slate-400">Formula: {m.formula}</div>
                <p className="text-[10px] text-slate-500">{DERIVED_PARENT_EXPLAINER}</p>
                <div>Validation: {node.children.length > 0 ? `✓ ${m.validation}` : `⚠ At least one component line required`}</div>
              </div>
              {(node.children.length === 0 || isOpen) && (
                <>
                  {node.children.map((c) => (
                    <RecursiveNode key={c.id} node={c} depth={depth + 1} />
                  ))}
                  <RevenueForecastLineNameAdd
                    placeholder="Child line name"
                    buttonLabel="Add child line"
                    inputClassName="rounded border border-slate-600 bg-slate-800 text-xs px-2 py-1 w-44"
                    onAdd={(t) => {
                      const id = addRevenueStreamChild(node.id, t);
                      afterAdd(id);
                    }}
                  />
                </>
              )}
            </div>
          )}
        </div>
      );
    }

    if (role === "allocation_of_parent") {
      const sibs = allocSiblings ?? [node];
      return (
        <div
          ref={(el) => setRowRef(node.id, el)}
          style={{ marginLeft: depth * 12 }}
          className={flashRowId === node.id ? "ring-2 ring-violet-400/45 rounded-lg" : ""}
        >
          <AllocationRowCard
            node={node}
            siblingNodes={sibs}
            rows={rows}
            setRevenueForecastRowV1={setRevenueForecastRowV1}
            onRemove={() => removeRow(node.id)}
            titleLine={ALLOCATION_LINE_TITLE_PARENT}
            formulaLine={ALLOCATION_FORMULA_PARENT}
            flash={flashRowId === node.id}
            allocPctFocusNonce={allocPctFocusNonce[node.id] ?? 0}
          />
        </div>
      );
    }

    const isDirectStandalone = mode === "direct_standalone";
    const isDirectAllocParent = mode === "direct_with_allocation_children";
    const cardExpanded = !collapsedForecastCards.has(node.id);
    const showAllocSection = cardExpanded && (isDirectStandalone || isDirectAllocParent);
    const allocSum = getAllocationPercentSum(node.children, rows);
    const allocCount = node.children.length;
    const allocOnly =
      allocCount > 0 &&
      node.children.every((c) => rows[c.id]?.forecastRole === "allocation_of_parent");
    const allocOk = allocOnly && Math.abs(allocSum - 100) <= REVENUE_ALLOC_SUM_TOLERANCE;
    const allocOver = allocOnly && allocSum > 100 + REVENUE_ALLOC_SUM_TOLERANCE;
    const methodSummary = getDirectForecastCompactSummary(
      cfg,
      node.id,
      allowHist,
      lastHistoricByRowId,
      projectionYears
    );
    const rowUiStatus = getDirectForecastRowUiStatusWithAlloc(
      cfg,
      node.id,
      node,
      rows,
      lastHistoricByRowId,
      allowHist,
      projectionYears
    );
    const toggleCard = () => {
      setCollapsedForecastCards((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
    };

    return (
      <div
        ref={(el) => setRowRef(node.id, el)}
        className={`rounded-lg border border-slate-500/80 overflow-hidden mb-2.5 transition-shadow shadow-sm shadow-black/25 ${
          flashRowId === node.id ? "ring-2 ring-cyan-500/45" : ""
        }`}
        style={{ marginLeft: depth * 12 }}
      >
        <div
          className={`bg-slate-950/60 border-b border-slate-600/55 px-2 py-2 ${
            flashRowId === node.id ? "bg-amber-950/20" : ""
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleCard}
              className="text-slate-400 hover:text-slate-200 w-6 text-xs shrink-0"
              aria-expanded={cardExpanded}
            >
              {cardExpanded ? "▼" : "▶"}
            </button>
            <span className="text-sm font-semibold text-slate-100">{node.label}</span>
            <span className="rounded bg-slate-700/90 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200/90">
              Direct
            </span>
            <RowStatusPill
              status={rowUiStatus === "ready" ? "ready" : rowUiStatus === "invalid" ? "invalid" : "incomplete"}
            />
            {hasCh ? (
              <button
                type="button"
                onClick={() => {
                  const wasOpen = isOpen;
                  toggleExpanded(node.id);
                  if (!wasOpen) {
                    const tree = useModelStore.getState().revenueForecastTreeV1 ?? [];
                    const path = expandIdsForNodePath(tree, node.id);
                    if (path) ensureExpandedIds(path);
                  }
                }}
                className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400"
              >
                {isOpen ? "Hide" : "Show"} splits list
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => removeRow(node.id)}
              className="ml-auto rounded border border-red-900/40 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-950/20"
            >
              Remove
            </button>
          </div>
          {!cardExpanded ? (
            <p className="text-[10px] text-slate-400 mt-1.5 pl-8 leading-snug">
              {methodSummary}
              {allocCount > 0
                ? allocOk
                  ? ` · Split total 100%`
                  : allocOver
                    ? ` · Split total ${allocSum.toFixed(0)}% (over 100%)`
                    : ` · Split total ${allocSum.toFixed(0)}% · missing ${Math.max(0, 100 - allocSum).toFixed(0)}%`
                : ""}{" "}
              ·{" "}
              <span
                className={
                  rowUiStatus === "ready"
                    ? "text-emerald-500/90"
                    : rowUiStatus === "invalid"
                      ? "text-red-400/90"
                      : "text-amber-400/90"
                }
              >
                {rowUiStatus === "ready" ? "Ready" : rowUiStatus === "invalid" ? "Invalid" : "Incomplete"}
              </span>
            </p>
          ) : (
            <p className="text-[10px] text-slate-500 mt-1 pl-8">
              {methodSummary.split(" · ").slice(1).join(" · ") || "Configure below, then Apply."}
            </p>
          )}
          {cardExpanded && (isDirectStandalone || isDirectAllocParent) ? (
            <div className="flex flex-wrap gap-1.5 mt-2 pl-8">
              {isDirectStandalone ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      document.getElementById(`revenue-alloc-split-${node.id}`)?.scrollIntoView({
                        behavior: "smooth",
                        block: "nearest",
                      })
                    }
                    className="rounded border border-cyan-800/50 px-2 py-1 text-[10px] text-cyan-200/90"
                  >
                    Add allocation line
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setModal({ kind: "standalone_to_derived", nodeId: node.id, label: node.label })
                    }
                    className="rounded border border-amber-800/50 px-2 py-1 text-[10px] text-amber-200"
                  >
                    Convert: build from child lines
                  </button>
                </>
              ) : null}
              {isDirectAllocParent ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      document.getElementById(`revenue-alloc-split-${node.id}`)?.scrollIntoView({
                        behavior: "smooth",
                        block: "nearest",
                      })
                    }
                    className="rounded border border-cyan-800/50 px-2 py-1 text-[10px] text-cyan-200/90"
                  >
                    Add allocation line
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setModal({
                        kind: "remove_all_alloc",
                        nodeId: node.id,
                        label: node.label,
                      })
                    }
                    className="rounded border border-slate-600 px-2 py-1 text-[10px] text-slate-400"
                  >
                    Remove all allocation lines
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setModal({
                        kind: "direct_alloc_to_derived",
                        nodeId: node.id,
                        label: node.label,
                        nAlloc: node.children.length,
                      })
                    }
                    className="rounded border border-amber-800/50 px-2 py-1 text-[10px] text-amber-200"
                  >
                    Convert: build from child lines
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {cardExpanded ? (
          <>
            <div className="bg-slate-900/35 px-3 py-3 border-b border-slate-600/50">
              <RevenueForecastV1DirectForecastBlock
                rowId={node.id}
                cfg={cfg}
                setRevenueForecastRowV1={setRevenueForecastRowV1}
                lastHistoricByRowId={lastHistoricByRowId}
                projectionYears={projectionYears}
                currencyCode={currencyCode}
                allowGrowthFromHistorical={allowHist}
                focusNonce={directFocusNonce[node.id] ?? 0}
                compactExplainer
              />
            </div>

            {showAllocSection ? (
              <div
                id={`revenue-alloc-split-${node.id}`}
                className="bg-slate-950/40 px-3 py-3 space-y-3 border-t border-slate-600/45"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-600/50 pb-2">
                  <div>
                    <div className="text-[11px] font-medium text-slate-300">Split by % (component lines)</div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Forecast this row directly, then split it into component lines by %. The lines below are not forecast
                      separately — they split this row’s projected total. Sub-lines must total exactly 100%.
                    </p>
                  </div>
                  <div
                    className={`text-[11px] font-medium tabular-nums shrink-0 max-w-[200px] text-right leading-snug ${
                      allocCount === 0
                        ? "text-slate-500"
                        : allocOk
                          ? "text-emerald-400"
                          : allocOver
                            ? "text-red-400"
                            : "text-amber-300"
                    }`}
                  >
                    {allocCount === 0
                      ? "No sub-lines yet"
                      : allocOk
                        ? "100% assigned — projections allowed"
                        : allocOver
                          ? `${allocSum.toFixed(2)}% assigned — exceeds 100% by ${(allocSum - 100).toFixed(2)}%`
                          : `${allocSum.toFixed(2)}% assigned — missing ${(100 - allocSum).toFixed(2)}%`}
                  </div>
                </div>
                {(isOpen || node.children.length <= 12 || node.children.length === 0) && (
                  <div className="space-y-2 pt-1">
                    {node.children.map((c) => (
                      <RecursiveNode
                        key={c.id}
                        node={c}
                        depth={depth + 1}
                        allocSiblings={node.children}
                      />
                    ))}
                    <RevenueForecastLineNameAdd
                      placeholder="New component line (split by %)"
                      buttonLabel="Add allocation line"
                      inputClassName="rounded border border-slate-600 bg-slate-800 text-xs px-2 py-1 w-44"
                      onAdd={(t) => {
                        const newChildId = addRevenueStreamChild(node.id, t);
                        afterAdd(newChildId, { allocationParentDirectId: node.id });
                      }}
                    />
                  </div>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500 mb-2">
        Each line is exactly one of: <strong className="text-slate-400">Direct</strong> (own forecast),{" "}
        <strong className="text-slate-400">Built from the lines below</strong> (sum of sub-lines), or{" "}
        <strong className="text-slate-400">Allocation</strong> (a % of the row above — not forecast separately). Changing structure uses
        explicit actions with confirmation when data would be replaced.
      </p>
      {forest.map((node) => (
        <RecursiveNode key={node.id} node={node} depth={0} />
      ))}

      {modal?.kind === "direct_alloc_to_derived" && (
        <ConfirmModal
          title="Convert: build from child lines"
          body={`This will replace allocation splits with a child-driven forecast structure. The ${modal.nAlloc} sub-line(s) below will stop being % splits and become independent forecast lines (same names preserved). This row will equal the sum of those lines each year.\n\nContinue?`}
          confirmLabel="Convert"
          onCancel={() => setModal(null)}
          onConfirm={() => {
            const id = modal.nodeId;
            setRevenueForecastRowV1(id, { forecastRole: "derived_sum", forecastMethod: undefined, forecastParameters: {} });
            const tree = useModelStore.getState().revenueForecastTreeV1 ?? [];
            const n = findNode(tree, id);
            n?.children.forEach((c) => {
              const allowHistChild = allowGrowthFromHistoricalForNode(c, lastHistoricByRowId);
              setRevenueForecastRowV1(c.id, {
                forecastRole: "independent_driver",
                forecastMethod: "growth_rate",
                forecastParameters: allowHistChild
                  ? { startingBasis: "last_historical" }
                  : { startingBasis: "starting_amount" },
              });
            });
            setModal(null);
            afterAdd(id);
          }}
        />
      )}

      {modal?.kind === "remove_all_alloc" && (
        <ConfirmModal
          title="Remove all allocation lines"
          body={`Remove every allocation split under "${modal.label}"? This row becomes a direct-only line again.`}
          confirmLabel="Remove all"
          onCancel={() => setModal(null)}
          onConfirm={() => {
            const tree = useModelStore.getState().revenueForecastTreeV1 ?? [];
            const n = findNode(tree, modal.nodeId);
            [...(n?.children ?? [])].forEach((c) => removeRow(c.id));
            setModal(null);
          }}
        />
      )}

      {modal?.kind === "standalone_to_derived" && (
        <ConfirmModal
          title="Build from child lines"
          body={`"${modal.label}" will have no direct forecast. You'll add child lines below; parent = sum(children). Confirm to switch structure.`}
          confirmLabel="Switch to built-from-children"
          onCancel={() => setModal(null)}
          onConfirm={() => {
            setRevenueForecastRowV1(modal.nodeId, {
              forecastRole: "derived_sum",
              forecastMethod: undefined,
              forecastParameters: {},
            });
            setModal(null);
            afterAdd(modal.nodeId, { scrollToRow: false });
          }}
        />
      )}

      {modal?.kind === "derived_to_direct" && (
        <ConfirmModal
          title="Forecast this line directly"
          body={`"${modal.label}" has ${modal.nChildren} child line(s). Switching to direct forecast will remove all of them from the model. This cannot be undone. Continue?`}
          confirmLabel="Remove children & forecast directly"
          onCancel={() => setModal(null)}
          onConfirm={() => {
            const nid = modal.nodeId;
            const tree = useModelStore.getState().revenueForecastTreeV1 ?? [];
            const n = findNode(tree, nid);
            const allowHist = n
              ? allowGrowthFromHistoricalForNode(n, lastHistoricByRowId)
              : false;
            [...(n?.children ?? [])].forEach((c) => removeRow(c.id));
            setRevenueForecastRowV1(nid, {
              forecastRole: "independent_driver",
              forecastMethod: "growth_rate",
              forecastParameters: {
                startingBasis: allowHist ? "last_historical" : "starting_amount",
              },
            });
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

function findNode(nodes: ForecastRevenueNodeV1[], id: string): ForecastRevenueNodeV1 | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = findNode(n.children, id);
    if (f) return f;
  }
  return null;
}
