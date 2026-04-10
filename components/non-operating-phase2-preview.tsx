"use client";

import { useEffect, useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import type { CurrencyUnit } from "@/store/useModelStore";
import { computeRowValue } from "@/lib/calculations";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import {
  collectNonOperatingIncomeLeaves,
  defaultPhase2Bucket,
  findIsRowById,
  type NonOperatingLeafLine,
  type Phase2LineBucket,
} from "@/lib/non-operating-phase2-lines";
import { buildPhase2GlobalSummary, buildPhase2PreviewGuidance } from "@/lib/non-operating-phase2-nudges";
import { buildPhase2PreviewBridgeModel } from "@/lib/non-operating-phase2-preview-bridge";
import {
  buildNonOperatingPhase2DirectPreview,
  getProjectedRevenueTotalByYear,
} from "@/lib/non-operating-phase2-direct-preview";
import { computeDebtScheduleEngine } from "@/lib/debt-schedule-engine";
import {
  defaultDebtSchedulePhase2Persist,
  ensureDebtScheduleBodyProjectionYears,
} from "@/lib/debt-schedule-persist";

const PHASE2_INTEREST_EXPENSE_LINE_ID = "interest_expense";

function formatMaybe(
  v: number | null,
  unit: CurrencyUnit,
  showDecimals: boolean
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "—";
  const displayValue = storedToDisplay(v, unit);
  const unitLabel = getUnitLabel(unit);
  const decimals = showDecimals ? 2 : 0;
  const formatted = Math.abs(displayValue).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const withUnit = `${formatted}${unitLabel ? ` ${unitLabel}` : ""}`;
  return displayValue < 0 ? `(${withUnit})` : withUnit;
}

/** Bridge amounts: show zero when computed (honest), em dash only when missing. */
function formatBridgeAmount(
  v: number | null | undefined,
  unit: CurrencyUnit,
  showDecimals: boolean
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const displayValue = storedToDisplay(v, unit);
  const unitLabel = getUnitLabel(unit);
  const decimals = showDecimals ? 2 : 0;
  const formatted = Math.abs(displayValue).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const withUnit = `${formatted}${unitLabel ? ` ${unitLabel}` : ""}`;
  return displayValue < 0 ? `(${withUnit})` : withUnit;
}

/**
 * Right-hand preview for Forecast Drivers · Non-operating & Schedules.
 * Applied direct non-operating forecasts contribute numeric bridge values. Interest expense is derived from the
 * applied debt schedule when the engine run is complete; other schedule rows stay placeholders until those engines exist.
 */
export default function NonOperatingPhase2Preview() {
  const meta = useModelStore((s) => s.meta);
  const incomeStatement = useModelStore((s) => s.incomeStatement ?? []);
  const balanceSheet = useModelStore((s) => s.balanceSheet ?? []);
  const cashFlow = useModelStore((s) => s.cashFlow ?? []);
  const debtSchedulePhase2Persist = useModelStore((s) => s.debtSchedulePhase2Persist);
  const scheduleStatusByLine = useModelStore((s) => s.nonOperatingPhase2ScheduleStatusByLine ?? {});
  const bucketOverrides = useModelStore((s) => s.nonOperatingPhase2BucketOverrides ?? {});
  const directByLine = useModelStore((s) => s.nonOperatingPhase2DirectByLine ?? {});
  const revenueForecastConfigV1 = useModelStore((s) => s.revenueForecastConfigV1);
  const revenueForecastTreeV1 = useModelStore((s) => s.revenueForecastTreeV1 ?? []);
  const revenueProjectionConfig = useModelStore((s) => s.revenueProjectionConfig);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns ?? {});
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns ?? {});

  const unit = (meta?.currencyUnit ?? "millions") as CurrencyUnit;
  const showDecimals = false;
  const projectionYears = meta?.years?.projection ?? [];
  const historicalYears = meta?.years?.historical ?? [];
  const lastHistoricYear = historicalYears.length > 0 ? historicalYears[historicalYears.length - 1]! : "";
  const firstProj = projectionYears[0] ?? null;

  const allStatements = useMemo(
    () => ({ incomeStatement, balanceSheet, cashFlow }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  const leaves = useMemo(
    () => collectNonOperatingIncomeLeaves(incomeStatement),
    [incomeStatement]
  );

  const globalSummary = useMemo(() => {
    const eb = (line: NonOperatingLeafLine): Phase2LineBucket => {
      const row = findIsRowById(incomeStatement, line.lineId);
      const base = row ? defaultPhase2Bucket(row) : "review";
      return bucketOverrides[line.lineId] ?? base;
    };
    return buildPhase2GlobalSummary({
      leaves,
      incomeStatement,
      effectiveBucket: eb,
      scheduleStatusByLine,
      directByLine,
    });
  }, [leaves, incomeStatement, bucketOverrides, scheduleStatusByLine, directByLine]);

  const revenueTotalByYear = useMemo(
    () =>
      getProjectedRevenueTotalByYear({
        incomeStatement,
        revenueForecastConfigV1,
        revenueForecastTreeV1,
        revenueProjectionConfig,
        projectionYears,
        lastHistoricYear,
        allStatements,
        sbcBreakdowns,
        danaBreakdowns,
        currencyUnit: unit,
      }),
    [
      incomeStatement,
      revenueForecastConfigV1,
      revenueForecastTreeV1,
      revenueProjectionConfig,
      projectionYears,
      lastHistoricYear,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
      unit,
    ]
  );

  const directPreview = useMemo(
    () =>
      buildNonOperatingPhase2DirectPreview({
        leaves,
        incomeStatement,
        bucketOverrides,
        directByLine,
        projectionYears,
        lastHistoricYear,
        revenueTotalByYear,
        allStatements,
        sbcBreakdowns,
        danaBreakdowns,
      }),
    [
      leaves,
      incomeStatement,
      bucketOverrides,
      directByLine,
      projectionYears,
      lastHistoricYear,
      revenueTotalByYear,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
    ]
  );

  const debtPersist = debtSchedulePhase2Persist ?? defaultDebtSchedulePhase2Persist();
  const debtAppliedBody = useMemo(() => {
    if (!debtPersist.applied) return null;
    return ensureDebtScheduleBodyProjectionYears(debtPersist.applied, projectionYears);
  }, [debtPersist.applied, projectionYears]);

  const debtScheduleApplied = debtAppliedBody != null;

  const debtEngineResult = useMemo(() => {
    if (!debtAppliedBody) return null;
    return computeDebtScheduleEngine({
      config: debtAppliedBody,
      projectionYears,
      lastHistoricYear: lastHistoricYear || null,
      balanceSheet,
    });
  }, [debtAppliedBody, projectionYears, lastHistoricYear, balanceSheet]);

  const debtInterestComplete =
    debtScheduleApplied && debtEngineResult != null && debtEngineResult.isComplete === true;

  const previewGuidance = useMemo(
    () =>
      buildPhase2PreviewGuidance(globalSummary, {
        directNumericInPreview: directPreview.hasAnyAppliedProjection,
        debtScheduleApplied,
        debtScheduleInterestComplete: debtInterestComplete,
      }),
    [globalSummary, directPreview.hasAnyAppliedProjection, debtScheduleApplied, debtInterestComplete]
  );

  const bridgeModel = useMemo(
    () =>
      buildPhase2PreviewBridgeModel({
        incomeStatement,
        bucketOverrides,
        scheduleStatusByLine,
        directByLine,
        scheduleStatusOverrides:
          debtInterestComplete
            ? { [PHASE2_INTEREST_EXPENSE_LINE_ID]: "complete" }
            : debtScheduleApplied
              ? { [PHASE2_INTEREST_EXPENSE_LINE_ID]: "draft" }
              : undefined,
      }),
    [
      incomeStatement,
      bucketOverrides,
      scheduleStatusByLine,
      directByLine,
      debtScheduleApplied,
      debtInterestComplete,
    ]
  );

  const { ebitVal, ebtVal } = useMemo(() => {
    const allSt = { incomeStatement, balanceSheet, cashFlow };
    let ebit: number | null = null;
    let ebt: number | null = null;
    if (!firstProj) return { ebitVal: null, ebtVal: null };
    const ebitRow = incomeStatement.find((r) => r.id === "ebit");
    const ebtRow = incomeStatement.find((r) => r.id === "ebt");
    const tryVal = (row: Row | undefined): number | null => {
      if (!row) return null;
      try {
        const v = computeRowValue(row, firstProj, incomeStatement, incomeStatement, allSt);
        return v != null && Number.isFinite(v) ? v : null;
      } catch {
        return null;
      }
    };
    ebit = tryVal(ebitRow);
    ebt = tryVal(ebtRow);
    return { ebitVal: ebit, ebtVal: ebt };
  }, [incomeStatement, balanceSheet, cashFlow, firstProj]);

  /** Applied direct lines only; null when none project (row shows —). */
  const directForDisplay =
    firstProj != null && directPreview.hasAnyAppliedProjection
      ? directPreview.totalByYear[firstProj] ?? 0
      : null;

  const firstProjInterestExpenseMag =
    firstProj != null &&
    debtInterestComplete &&
    debtEngineResult != null &&
    debtEngineResult.interestExpenseTotalByYear[firstProj] != null
      ? debtEngineResult.interestExpenseTotalByYear[firstProj]!
      : null;

  const partialPretax = useMemo(() => {
    if (firstProj == null || ebitVal == null || !Number.isFinite(ebitVal)) return null;
    const d =
      firstProj != null && directPreview.hasAnyAppliedProjection
        ? directPreview.totalByYear[firstProj] ?? 0
        : 0;
    const intMag =
      debtInterestComplete &&
      debtEngineResult?.interestExpenseTotalByYear[firstProj] != null &&
      Number.isFinite(debtEngineResult.interestExpenseTotalByYear[firstProj]!)
        ? debtEngineResult.interestExpenseTotalByYear[firstProj]!
        : 0;
    return ebitVal - intMag + d;
  }, [
    firstProj,
    ebitVal,
    directPreview.hasAnyAppliedProjection,
    directPreview.totalByYear,
    debtInterestComplete,
    debtEngineResult,
  ]);

  const hasAppliedDirect = directPreview.hasAnyAppliedProjection;
  /** null = follow default (expanded when applied, collapsed when not). */
  const [directDetailExpandedOverride, setDirectDetailExpandedOverride] = useState<boolean | null>(null);
  const [debtScheduleDetailExpanded, setDebtScheduleDetailExpanded] = useState(false);

  useEffect(() => {
    setDirectDetailExpandedOverride(null);
  }, [hasAppliedDirect]);

  const directDetailExpanded = directDetailExpandedOverride ?? hasAppliedDirect;

  const projectionYearSpan = useMemo(() => {
    if (projectionYears.length === 0) return "";
    if (projectionYears.length === 1) return projectionYears[0]!;
    return `${projectionYears[0]} to ${projectionYears[projectionYears.length - 1]!}`;
  }, [projectionYears]);

  const directDetailCollapsedSummary = useMemo(() => {
    if (!hasAppliedDirect) return "No applied direct forecasts yet — use Apply on the left to show years here.";
    const n = directPreview.lineDetails.length;
    if (n <= 0) return "Applied forecasts · expand to view years";
    const lineBit =
      n === 1 ? "1 applied line" : `${n} applied lines`;
    return projectionYearSpan ? `${lineBit} · ${projectionYearSpan}` : `${lineBit} · projection years`;
  }, [hasAppliedDirect, directPreview.lineDetails.length, projectionYearSpan]);

  const stripClass = (tone: "info" | "warning") =>
    tone === "warning"
      ? "border-amber-900/40 bg-amber-950/20 text-amber-100/90"
      : "border-slate-700 bg-slate-900/50 text-slate-300";

  return (
    <section className="h-full w-full rounded-xl border border-slate-800 bg-slate-950/50 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 p-4 pb-2 border-b border-slate-800">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Preview</h2>
            <p className="text-xs text-slate-500">
              <span className="text-slate-300">Forecast Drivers · Non-operating &amp; Schedules</span>
              {" · "}
              <span className="text-slate-300">{meta?.companyName ?? "—"}</span>
            </p>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mt-1 leading-snug">{globalSummary.barText}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
        {previewGuidance.primaryStrip ? (
          <div
            className={`rounded-md border px-3 py-2 text-[11px] leading-relaxed ${stripClass(
              previewGuidance.primaryStrip.tone
            )}`}
          >
            {previewGuidance.primaryStrip.text}
          </div>
        ) : null}
        {previewGuidance.secondaryStrip ? (
          <div
            className={`rounded-md border px-3 py-2 text-[11px] leading-relaxed ${stripClass(
              previewGuidance.secondaryStrip.tone
            )}`}
          >
            {previewGuidance.secondaryStrip.text}
          </div>
        ) : null}
        {previewGuidance.bridgeNote ? (
          <div className="rounded-md border border-slate-700/90 bg-slate-900/45 px-3 py-2 text-[11px] text-slate-400 leading-relaxed">
            {previewGuidance.bridgeNote}
          </div>
        ) : null}
        {previewGuidance.positiveLine ? (
          <div className="rounded-md border border-emerald-900/35 bg-emerald-950/15 px-3 py-2 text-[11px] text-emerald-100/90 leading-relaxed">
            {previewGuidance.positiveLine}
          </div>
        ) : null}

        {debtScheduleApplied && projectionYears.length > 0 ? (
          <div className="rounded-lg border border-sky-900/35 bg-sky-950/15 overflow-hidden">
            <button
              type="button"
              onClick={() => setDebtScheduleDetailExpanded((o) => !o)}
              className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/20"
            >
              <div className="min-w-0">
                <span className="text-[11px] font-semibold text-sky-100">Debt schedule summary</span>
                <p className="text-[10px] text-sky-200/75 mt-1 leading-snug">
                  Aggregate roll-forward from the applied schedule (opening debt, new borrowing / draws, repayments,
                  ending debt).{" "}
                  {!debtEngineResult?.isComplete ? (
                    <span className="text-amber-200/90">Incomplete — totals may show em dashes until all enabled tranches resolve.</span>
                  ) : null}
                </p>
              </div>
              <span className="text-slate-500 text-xs shrink-0">{debtScheduleDetailExpanded ? "▼" : "▶"}</span>
            </button>
            {debtScheduleDetailExpanded && debtEngineResult ? (
              <div className="px-3 pb-3 border-t border-sky-900/25 overflow-x-auto">
                <table className="w-full text-[10px] text-slate-300 mt-2 min-w-[420px]">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-800">
                      <th className="py-1 pr-2 font-medium">Year</th>
                      <th className="py-1 px-1 font-medium text-right">Opening debt</th>
                      <th className="py-1 px-1 font-medium text-right">Draws</th>
                      <th className="py-1 px-1 font-medium text-right">Repayments</th>
                      <th className="py-1 px-1 font-medium text-right">Ending debt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectionYears.map((y) => {
                      const t = debtEngineResult.totalsByYear[y];
                      const rep =
                        t != null
                          ? t.totalMandatoryRepayment + t.totalOptionalRepayment
                          : null;
                      return (
                        <tr key={y} className="border-b border-slate-800/60">
                          <td className="py-1 pr-2 text-slate-400 whitespace-nowrap">{y}</td>
                          <td className="py-1 px-1 text-right tabular-nums">
                            {formatBridgeAmount(t?.totalOpeningDebt ?? null, unit, showDecimals)}
                          </td>
                          <td className="py-1 px-1 text-right tabular-nums">
                            {formatBridgeAmount(t?.totalNewBorrowingDraws ?? null, unit, showDecimals)}
                          </td>
                          <td className="py-1 px-1 text-right tabular-nums">
                            {rep != null && Number.isFinite(rep) ? formatBridgeAmount(rep, unit, showDecimals) : "—"}
                          </td>
                          <td className="py-1 px-1 text-right tabular-nums">
                            {formatBridgeAmount(t?.totalEndingDebt ?? null, unit, showDecimals)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[9px] text-slate-600 mt-2">
                  Repayments = mandatory repayment + optional repayment. Per-tranche detail is available in the builder.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-3 space-y-1">
          <p className="text-[10px] text-slate-500 pb-2 leading-relaxed border-b border-slate-800/80">
            Pre-tax bridge — first projection year shown for EBIT, interest expense (when the applied debt schedule is
            complete), applied direct non-operating forecasts, and partial pre-tax. Other schedule-driven lines stay at —;{" "}
            <span className="text-slate-400">no fabricated schedule values.</span>
          </p>
          <div className="text-[10px] text-slate-500 font-mono leading-relaxed py-1 border-b border-slate-800/80">
            Partial pre-tax ≈ EBIT − interest expense (debt schedule) + direct other (interest income and other
            schedules still pending)
          </div>

          <div className="flex justify-between gap-3 border-b border-slate-800 py-2">
            <div className="min-w-0">
              <span className="text-slate-300 font-medium">Operating income / EBIT</span>
              <p className="text-[10px] text-slate-500 mt-0.5">From your income statement formulas.</p>
            </div>
            <span className="text-right tabular-nums text-slate-200 shrink-0">
              {firstProj ? (
                <>
                  <span className="text-slate-500 mr-1">{firstProj}</span>
                  {formatMaybe(ebitVal, unit, showDecimals)}
                </>
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </span>
          </div>

          <div className="flex justify-between gap-3 border-b border-slate-800 py-2">
            <div className="min-w-0 pr-2">
              <span className="text-slate-300 font-medium">
                <span className="text-slate-500 mr-1">−</span>
                Interest expense
              </span>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {!debtScheduleApplied ? (
                  <>
                    <span className="text-slate-400">Apply the debt schedule</span> on the left — interest expense is
                    derived from tranche balances and rates (positive magnitudes in the engine; shown as an expense
                    here).{" "}
                  </>
                ) : !debtInterestComplete ? (
                  <>
                    <span className="text-amber-200/90">Applied schedule incomplete</span> — interest is withheld until
                    every enabled tranche has opening debt, roll-forward, and rates for all projection years.{" "}
                  </>
                ) : (
                  <>
                    <span className="text-slate-400">From applied debt schedule</span> — average or ending balance basis
                    per tranche.{" "}
                  </>
                )}
                <span className="text-slate-600"> {bridgeModel.interestExpense.setupHint}</span>
              </p>
            </div>
            <span className="text-right tabular-nums shrink-0 text-slate-200">
              {firstProj ? (
                <>
                  <span className="text-slate-500 mr-1">{firstProj}</span>
                  {firstProjInterestExpenseMag != null ? (
                    formatBridgeAmount(-firstProjInterestExpenseMag, unit, showDecimals)
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </>
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </span>
          </div>

          <div className="flex justify-between gap-3 border-b border-slate-800 py-2">
            <div className="min-w-0 pr-2">
              <span className="text-slate-300 font-medium">
                <span className="text-slate-500 mr-1">+</span>
                Interest income
              </span>
              <p className="text-[10px] text-slate-500 mt-0.5">
                <span className="text-slate-400">Pending</span> — future schedule- or cash/investment-driven treatment.{""}
                <span className="text-slate-600"> {bridgeModel.interestIncome.setupHint}</span>
              </p>
            </div>
            <span className="text-slate-500 shrink-0 text-right tabular-nums">—</span>
          </div>

          <div className="flex justify-between gap-3 border-b border-slate-800 py-2">
            <div className="min-w-0 pr-2">
              <span className="text-slate-300 font-medium">
                <span className="text-slate-500 mr-1">±</span>
                Other scheduled below EBIT
              </span>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Amortization, lease, SBC, and other schedule-driven lines.{""}
                <span className="text-slate-600"> {bridgeModel.otherScheduled.setupHint}</span>
              </p>
            </div>
            <span className="text-slate-500 shrink-0 text-right tabular-nums">—</span>
          </div>

          <div className="flex justify-between gap-3 border-b border-slate-800 py-2">
            <div className="min-w-0 pr-2">
              <span className="text-slate-300 font-medium">
                <span className="text-slate-500 mr-1">±</span>
                Direct other income / expense
              </span>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Sum of applied direct non-operating lines only (drafts excluded). Signs match saved assumptions.{""}
                <span className="text-slate-600"> {bridgeModel.directOther.setupHint}</span>
              </p>
            </div>
            <span className="text-right tabular-nums text-slate-200 shrink-0">
              {firstProj ? (
                <>
                  <span className="text-slate-500 mr-1">{firstProj}</span>
                  {formatBridgeAmount(directForDisplay, unit, showDecimals)}
                </>
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </span>
          </div>

          <div className="flex justify-between gap-3 py-2 border-b border-slate-800">
            <div className="min-w-0">
              <span className="text-slate-300 font-medium">Pre-tax income / EBT (partial)</span>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                EBIT minus interest expense when the applied debt schedule is complete, plus applied direct other income
                / expense. Interest income and other schedule-driven rows are not in this subtotal yet — the label stays
                partial.
              </p>
            </div>
            <span className="text-right tabular-nums text-emerald-200/95 font-medium shrink-0">
              {firstProj ? (
                <>
                  <span className="text-slate-500 mr-1 font-normal">{firstProj}</span>
                  {formatBridgeAmount(partialPretax, unit, showDecimals)}
                </>
              ) : (
                <span className="text-slate-500 font-normal">—</span>
              )}
            </span>
          </div>

          <div className="flex justify-between gap-3 py-2">
            <div className="min-w-0">
              <span className="text-slate-400 font-medium text-[11px]">Pre-tax income / EBT (statement formula)</span>
              <p className="text-[10px] text-slate-600 mt-0.5">
                Reported row from the model — may differ until schedules and direct forecasts fully feed the
                statement.
              </p>
            </div>
            <span className="text-right tabular-nums text-slate-400 shrink-0 text-[11px]">
              {firstProj ? (
                <>
                  <span className="text-slate-600 mr-1">{firstProj}</span>
                  {formatMaybe(ebtVal, unit, showDecimals)}
                </>
              ) : (
                <span className="text-slate-600">—</span>
              )}
            </span>
          </div>
        </div>

        {projectionYears.length > 0 ? (
          <div
            className={`rounded-lg border overflow-hidden bg-slate-900/30 ${
              hasAppliedDirect ? "border-emerald-800/35 ring-1 ring-emerald-900/20" : "border-slate-700/80"
            }`}
          >
            <button
              type="button"
              onClick={() => setDirectDetailExpandedOverride(!directDetailExpanded)}
              className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/25"
            >
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-semibold text-slate-200">Direct other income / expense detail</span>
                <p className="text-[10px] text-slate-500 mt-1 leading-snug">
                  Shows applied direct non-operating forecasts across all projection years.
                </p>
                {!directDetailExpanded ? (
                  <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">{directDetailCollapsedSummary}</p>
                ) : null}
              </div>
              <span className="text-slate-500 text-xs shrink-0 pt-0.5" aria-hidden>
                {directDetailExpanded ? "▼" : "▶"}
              </span>
            </button>
            {directDetailExpanded ? (
              <div className="px-3 pb-3 overflow-x-auto border-t border-slate-800/80">
                {hasAppliedDirect && directPreview.lineDetails.length > 0 ? (
                  <table className="w-full text-[10px] text-slate-300 mt-2">
                    <thead>
                      <tr className="text-left text-slate-500 border-b border-slate-800">
                        <th className="py-1 pr-2 font-medium">Line item</th>
                        {projectionYears.map((y) => (
                          <th key={y} className="py-1 px-1 font-medium text-right tabular-nums whitespace-nowrap">
                            {y}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {directPreview.lineDetails.map((row) => (
                        <tr key={row.lineId} className="border-b border-slate-800/60">
                          <td className="py-1.5 pr-2 text-slate-200 max-w-[160px]">{row.label}</td>
                          {projectionYears.map((y) => (
                            <td key={y} className="py-1.5 px-1 text-right tabular-nums text-slate-300">
                              {formatBridgeAmount(row.byYear[y], unit, showDecimals)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {directPreview.lineDetails.length > 1 ? (
                        <tr className="text-slate-200 font-medium">
                          <td className="py-1.5 pr-2">Total</td>
                          {projectionYears.map((y) => (
                            <td key={y} className="py-1.5 px-1 text-right tabular-nums">
                              {formatBridgeAmount(directPreview.totalByYear[y], unit, showDecimals)}
                            </td>
                          ))}
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
                    No applied direct non-operating forecasts yet. Configure a line in the direct-forecast bucket on
                    the left and click <span className="text-slate-400">Apply</span> — the full horizon will appear
                    here.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="text-[10px] text-slate-600 leading-relaxed">
          Applied direct non-operating methods use the same revenue projection as Forecast Drivers revenue (when
          available) for % of revenue; growth % anchors to each line&apos;s last historical value. Unapplied drafts
          do not affect this preview.
        </p>
      </div>
    </section>
  );
}
