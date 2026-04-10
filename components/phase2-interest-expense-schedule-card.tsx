"use client";

/**
 * Archived Phase 2 UI: standalone interest-expense inputs. Not mounted in the builder — interest expense is modeled
 * from the future debt schedule. Kept for reuse when wiring the debt engine or internal testing.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Row } from "@/types/finance";
import type { NonOperatingPhase2AiLineSuggestion } from "@/types/non-operating-phase2-ai";
import type {
  InterestExpenseDebtSource,
  InterestExpenseScheduleConfigBody,
  InterestExpenseScheduleLinePersist,
  InterestExpenseScheduleMethod,
} from "@/types/interest-expense-schedule-v1";
import { storedToDisplay, displayToStored, getUnitLabel } from "@/lib/currency-utils";
import {
  ensureInterestExpenseBodyProjectionYears,
  interestExpenseScheduleBodiesEqual,
} from "@/lib/interest-expense-schedule-persist";
import { tryBuildModelTotalDebtByYear } from "@/lib/model-total-debt-for-interest";
import { getInterestExpenseScheduleAdvisory } from "@/lib/interest-expense-schedule-advisory";
import {
  formatAiAdvisorySourceLine,
} from "@/lib/non-operating-phase2-ai-utils";
import {
  phase2ScheduleCategoryPillLabel,
  getNonOperatingInterestKind,
  type NonOperatingLeafLine,
  type Phase2LineBucket,
  type Phase2ScheduleDisplayCategory,
} from "@/lib/non-operating-phase2-lines";
import type { Phase2LineNudgeSignal } from "@/lib/non-operating-phase2-nudges";
import { computeAppliedInterestExpenseByYear } from "@/lib/interest-expense-schedule-engine";

const BUCKET_OPTIONS: { value: Phase2LineBucket; label: string }[] = [
  { value: "scheduled", label: "Scheduled items" },
  { value: "direct", label: "Forecast other income & expense" },
  { value: "review", label: "Needs review" },
  { value: "excluded", label: "Excluded" },
];

function bucketLabel(b: Phase2LineBucket): string {
  return BUCKET_OPTIONS.find((o) => o.value === b)?.label ?? b;
}

function Phase2NudgePillsRow({ signals }: { signals: Phase2LineNudgeSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {signals.map((s) => (
        <span
          key={s.type}
          title={s.tooltip}
          className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] leading-tight cursor-default ${
            s.severity === "warning"
              ? "border-amber-800/45 bg-amber-950/25 text-amber-100/90"
              : "border-slate-600/50 bg-slate-800/40 text-slate-300"
          }`}
        >
          {s.label}
        </span>
      ))}
    </div>
  );
}

export function Phase2InterestExpenseScheduleCard(props: {
  line: NonOperatingLeafLine;
  row: Row | null;
  scheduleCategory: Phase2ScheduleDisplayCategory | null;
  nudges: Phase2LineNudgeSignal[];
  onBucketChange: (b: Phase2LineBucket) => void;
  currentBucket: Phase2LineBucket;
  routeSourceDisplay: string;
  aiSuggestion?: NonOperatingPhase2AiLineSuggestion;
  projectionYears: string[];
  currencyUnit: "units" | "thousands" | "millions";
  balanceSheet: Row[];
  lastHistoricYear: string | null;
  persist: InterestExpenseScheduleLinePersist;
  onPersist: (next: InterestExpenseScheduleLinePersist) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const {
    line,
    row,
    scheduleCategory,
    nudges,
    onBucketChange,
    currentBucket,
    routeSourceDisplay,
    aiSuggestion,
    projectionYears,
    currencyUnit,
    balanceSheet,
    lastHistoricYear,
    persist,
    onPersist,
    onApply,
    onReset,
  } = props;

  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const unitLabel = getUnitLabel(currencyUnit);
  const pill = phase2ScheduleCategoryPillLabel(row, scheduleCategory);
  const interestKind = row ? getNonOperatingInterestKind(row) : null;

  const draft = useMemo(
    () => ensureInterestExpenseBodyProjectionYears(persist.draft, projectionYears),
    [persist.draft, projectionYears]
  );
  const appliedBody = persist.applied
    ? ensureInterestExpenseBodyProjectionYears(persist.applied, projectionYears)
    : null;
  const unsaved = appliedBody == null || !interestExpenseScheduleBodiesEqual(draft, appliedBody);
  const hasApplied = appliedBody != null && interestExpenseScheduleBodiesEqual(draft, appliedBody);

  const modelDebtAvailable = useMemo(() => {
    if (projectionYears.length === 0) return false;
    const hist = lastHistoricYear && lastHistoricYear.length > 0 ? lastHistoricYear : null;
    const yearsNeed = hist ? [hist, ...projectionYears] : [...projectionYears];
    return tryBuildModelTotalDebtByYear(balanceSheet, yearsNeed).ok;
  }, [balanceSheet, projectionYears, lastHistoricYear]);

  const appliedPreviewByYear = useMemo(() => {
    if (!appliedBody) return {} as Record<string, number>;
    return computeAppliedInterestExpenseByYear({
      applied: appliedBody,
      projectionYears,
      lastHistoricYear,
      balanceSheet,
    });
  }, [appliedBody, projectionYears, lastHistoricYear, balanceSheet]);

  const advisory = useMemo(() => getInterestExpenseScheduleAdvisory(), []);

  const setDraft = (patch: Partial<InterestExpenseScheduleConfigBody>) => {
    const nextBody: InterestExpenseScheduleConfigBody = { ...draft, ...patch };
    onPersist({
      lineId: line.lineId,
      draft: ensureInterestExpenseBodyProjectionYears(nextBody, projectionYears),
      applied: persist.applied,
    });
  };

  const aiMismatch =
    aiSuggestion != null && aiSuggestion.suggestedBucket !== currentBucket
      ? `AI suggests ${bucketLabel(aiSuggestion.suggestedBucket)} (${aiSuggestion.confidencePct}%): reference only.`
      : null;

  const debtSourceDisabledModel = !modelDebtAvailable;

  useEffect(() => {
    if (modelDebtAvailable) return;
    if (persist.draft.debtSource !== "model") return;
    const p = persistRef.current;
    const coerced = ensureInterestExpenseBodyProjectionYears(
      { ...p.draft, debtSource: "manual" },
      projectionYears
    );
    onPersist({
      lineId: line.lineId,
      draft: coerced,
      applied: p.applied,
    });
  }, [modelDebtAvailable, persist.draft.debtSource, line.lineId, projectionYears, onPersist]);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/20"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-100">{line.label}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Under: {line.parentLabel}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span className="inline-flex rounded border border-violet-800/50 bg-violet-950/30 px-1.5 py-0.5 text-[10px] text-violet-200">
              {pill}
            </span>
            <span className="text-[10px] text-slate-500">{routeSourceDisplay}</span>
            {aiSuggestion ? (
              <span className="text-[10px] text-slate-500">{aiSuggestion.confidencePct}% AI</span>
            ) : null}
          </div>
          <Phase2NudgePillsRow signals={nudges} />
          <div className="text-[10px] text-slate-500 mt-1">
            {appliedBody == null ? (
              <span className="text-amber-200/85">Schedule not applied</span>
            ) : hasApplied ? (
              <span className="text-emerald-400/80">Applied</span>
            ) : (
              <span className="text-amber-200/90">Unsaved changes</span>
            )}
          </div>
        </div>
        <span className="text-slate-500 text-xs shrink-0">{open ? "▼" : "▶"}</span>
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-0 border-t border-slate-800/80 space-y-3">
          {scheduleCategory === "interest" && interestKind === "expense" ? (
            <p className="text-[10px] text-slate-400 border-l-2 border-slate-600 pl-2">
              Interest expense reduces pre-tax income. Values below are stored as positive expense amounts; the preview
              subtracts them in the bridge.
            </p>
          ) : null}
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Debt-based methods estimate recurring financing cost from a debt balance and one nominal rate. Manual by
            year is for known coupons, hedging, or management guidance. Nothing is written to the income statement row
            yet — preview only.
          </p>
          {debtSourceDisabledModel ? (
            <p className="text-[10px] text-amber-200/85 leading-relaxed">
              Model debt forecast is not available yet: balance sheet <span className="text-slate-300">st_debt</span> and{" "}
              <span className="text-slate-300">lt_debt</span> need an explicit value for every projection year
              {lastHistoricYear ? ` and ${lastHistoricYear} (for average-debt opening)` : ""}. Use{" "}
              <span className="text-slate-300">Enter debt manually</span> until those cells are filled.
            </p>
          ) : null}

          <div className="rounded-md border border-slate-700/80 bg-slate-900/50 p-2 space-y-1">
            <p className="text-[11px] text-slate-200 font-medium">Schedule guidance</p>
            <p className="text-[11px] text-slate-300">{advisory.reason}</p>
            <p className="text-[10px] text-slate-500">
              Suggested:{" "}
              {advisory.suggestedMethod === "pct_avg_debt"
                ? "% of average debt"
                : advisory.suggestedMethod === "pct_ending_debt"
                  ? "% of ending debt"
                  : "Manual by year"}{" "}
              · Source: {advisory.source} · Confidence: {advisory.confidencePct}%
            </p>
            <button
              type="button"
              onClick={() => setDraft({ method: advisory.suggestedMethod })}
              className="mt-1 rounded-md border border-sky-700/50 bg-sky-950/40 px-2.5 py-1 text-[11px] font-medium text-sky-200 hover:bg-sky-900/50"
            >
              Use suggested method (draft only)
            </button>
          </div>

          {aiSuggestion ? (
            <div className="rounded-md border border-slate-700/80 bg-slate-900/50 p-2 space-y-1">
              <p className="text-[11px] text-slate-200 font-medium">AI classification</p>
              <p className="text-[11px] text-slate-300">{aiSuggestion.userFacingSummary || aiSuggestion.explanation}</p>
              <p className="text-[10px] text-slate-500">
                <span className="text-slate-400">AI advisory:</span> {formatAiAdvisorySourceLine(aiSuggestion)}
              </p>
              {aiMismatch ? <p className="text-[10px] text-amber-200/90">{aiMismatch}</p> : null}
            </div>
          ) : null}

          <div className="text-[11px] text-slate-500">
            <span className="text-slate-400">Route source:</span> {routeSourceDisplay}
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Method</label>
            <select
              value={draft.method}
              onChange={(e) => setDraft({ method: e.target.value as InterestExpenseScheduleMethod })}
              className="w-full max-w-sm rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
            >
              <option value="pct_avg_debt">% of average debt</option>
              <option value="pct_ending_debt">% of ending debt</option>
              <option value="manual_by_year">Manual by year</option>
            </select>
          </div>

          {draft.method !== "manual_by_year" ? (
            <>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                  Interest rate (% per year)
                </label>
                <input
                  type="number"
                  step={0.01}
                  className="w-28 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                  value={draft.interestRatePct === 0 ? "" : draft.interestRatePct}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    setDraft({ interestRatePct: Number.isFinite(n) ? n : 0 });
                  }}
                />
                <span className="ml-1 text-xs text-slate-500">%</span>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Debt source</label>
                <select
                  value={draft.debtSource}
                  onChange={(e) => setDraft({ debtSource: e.target.value as InterestExpenseDebtSource })}
                  className="w-full max-w-sm rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
                >
                  <option value="manual" title="Enter ending debt by projection year">
                    Enter debt manually
                  </option>
                  <option value="model" disabled={debtSourceDisabledModel} title="Requires explicit st_debt + lt_debt for each year">
                    Use model debt (balance sheet)
                  </option>
                </select>
              </div>
              {draft.debtSource === "manual" && projectionYears.length > 0 ? (
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">
                    Ending debt by year ({unitLabel || "model units"} — same as income statement storage)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {projectionYears.map((y) => (
                      <div key={y} className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500 w-10">{y}</span>
                        <input
                          type="number"
                          step={0.01}
                          className="w-20 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-200"
                          value={
                            draft.manualDebtByYear[y] != null
                              ? storedToDisplay(draft.manualDebtByYear[y]!, currencyUnit)
                              : ""
                          }
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            const next = {
                              ...draft.manualDebtByYear,
                              [y]: Number.isFinite(n) ? displayToStored(n, currencyUnit) : 0,
                            };
                            setDraft({ manualDebtByYear: next });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div>
              <p className="text-[10px] text-slate-500 mb-1">
                Interest expense by year (positive = expense magnitude; {unitLabel || "model units"})
              </p>
              {projectionYears.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {projectionYears.map((y) => (
                    <div key={y} className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-500 w-10">{y}</span>
                      <input
                        type="number"
                        step={0.01}
                        className="w-20 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-200"
                        value={
                          draft.manualInterestByYear[y] != null
                            ? storedToDisplay(draft.manualInterestByYear[y]!, currencyUnit)
                            : ""
                        }
                        onChange={(e) => {
                          const n = parseFloat(e.target.value);
                          const next = {
                            ...draft.manualInterestByYear,
                            [y]: Number.isFinite(n) ? displayToStored(n, currencyUnit) : 0,
                          };
                          setDraft({ manualInterestByYear: next });
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-slate-600">Add projection years in model settings.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onApply}
              disabled={!unsaved}
              className="rounded-md bg-emerald-700/80 px-3 py-1.5 text-xs font-medium text-emerald-50 hover:bg-emerald-600 disabled:opacity-40"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={!unsaved}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              Reset
            </button>
          </div>

          {appliedBody && Object.keys(appliedPreviewByYear).length > 0 ? (
            <div className="rounded-md border border-slate-800/90 overflow-hidden">
              <button
                type="button"
                onClick={() => setDetailOpen((d) => !d)}
                className="w-full text-left px-2 py-2 flex justify-between items-center hover:bg-slate-800/25 text-[11px] text-slate-300"
              >
                <span>Applied schedule detail (preview)</span>
                <span className="text-slate-500">{detailOpen ? "▼" : "▶"}</span>
              </button>
              {detailOpen ? (
                <div className="px-2 pb-2 pt-0 border-t border-slate-800/80 space-y-1 text-[10px] text-slate-500">
                  <p>
                    Method:{" "}
                    <span className="text-slate-300">
                      {appliedBody.method === "pct_avg_debt"
                        ? "% of average debt"
                        : appliedBody.method === "pct_ending_debt"
                          ? "% of ending debt"
                          : "Manual by year"}
                    </span>
                  </p>
                  {appliedBody.method !== "manual_by_year" ? (
                    <>
                      <p>
                        Rate: <span className="text-slate-300">{appliedBody.interestRatePct}%</span>
                      </p>
                      <p>
                        Debt basis:{" "}
                        <span className="text-slate-300">
                          {appliedBody.debtSource === "model" ? "Model (BS st_debt + lt_debt)" : "Manual entry"}
                        </span>
                      </p>
                    </>
                  ) : null}
                  <p className="text-slate-400 pt-1">Expense magnitudes (stored positive)</p>
                  <ul className="font-mono text-slate-400">
                    {projectionYears.map((y) => (
                      <li key={y}>
                        {y}: {appliedPreviewByYear[y] != null ? appliedPreviewByYear[y]!.toFixed(4) : "—"}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Classification</label>
            <select
              value={currentBucket}
              onChange={(e) => onBucketChange(e.target.value as Phase2LineBucket)}
              className="w-full max-w-sm rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
            >
              {BUCKET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}
