"use client";

import { useMemo, useState } from "react";
import type { Row } from "@/types/finance";
import { useModelStore } from "@/store/useModelStore";
import type { CurrencyUnit } from "@/store/useModelStore";
import { storedToDisplay, displayToStored, getUnitLabel } from "@/lib/currency-utils";
import { tryBuildModelTotalDebtByYear } from "@/lib/model-total-debt-for-interest";
import { DEBT_SCHEDULE_PHASE2_ID } from "@/types/debt-schedule-v1";
import type {
  DebtScheduleConfigBodyV1,
  DebtTrancheConfigV1,
  DebtTrancheTypeV1,
  InterestComputationBasisV1,
  InterestRateMethodV1,
  OpeningBalanceSourceV1,
} from "@/types/debt-schedule-v1";
import {
  cloneDebtScheduleBody,
  createDefaultDebtTranche,
  debtScheduleBodiesEqual,
  defaultDebtScheduleBody,
  ensureDebtScheduleBodyProjectionYears,
} from "@/lib/debt-schedule-persist";
import { computeDebtScheduleEngine } from "@/lib/debt-schedule-engine";
import { getDebtScheduleGlobalAdvisory, getDebtScheduleTrancheAdvisory } from "@/lib/debt-schedule-advisory";

function patchTranche(
  body: DebtScheduleConfigBodyV1,
  trancheId: string,
  patch: Partial<DebtTrancheConfigV1>
): DebtScheduleConfigBodyV1 {
  return {
    ...body,
    tranches: body.tranches.map((t) => (t.trancheId === trancheId ? { ...t, ...patch } : t)),
  };
}

function patchTrancheYear(
  body: DebtScheduleConfigBodyV1,
  trancheId: string,
  field: "drawsByYear" | "mandatoryRepaymentByYear" | "optionalRepaymentByYear" | "interestRateByYear",
  year: string,
  stored: number
): DebtScheduleConfigBodyV1 {
  return {
    ...body,
    tranches: body.tranches.map((t) => {
      if (t.trancheId !== trancheId) return t;
      return { ...t, [field]: { ...t[field], [year]: stored } };
    }),
  };
}

export function DebtSchedulePhase2Builder(props: {
  projectionYears: string[];
  currencyUnit: CurrencyUnit;
  balanceSheet: Row[];
  lastHistoricYear: string | null;
}) {
  const { projectionYears, currencyUnit, balanceSheet, lastHistoricYear } = props;
  const persist = useModelStore((s) => s.debtSchedulePhase2Persist);
  const setPersist = useModelStore((s) => s.setDebtSchedulePhase2Persist);

  const [openTrancheId, setOpenTrancheId] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);

  const basePersist = persist ?? { draft: defaultDebtScheduleBody([]), applied: null };
  const draft = useMemo(
    () => ensureDebtScheduleBodyProjectionYears(basePersist.draft, projectionYears),
    [basePersist.draft, projectionYears]
  );
  const appliedBody = basePersist.applied
    ? ensureDebtScheduleBodyProjectionYears(basePersist.applied, projectionYears)
    : null;

  const unsaved = appliedBody == null || !debtScheduleBodiesEqual(draft, appliedBody);
  const hasApplied = appliedBody != null && debtScheduleBodiesEqual(draft, appliedBody);

  const histDebtOk = useMemo(() => {
    if (!lastHistoricYear) return false;
    return tryBuildModelTotalDebtByYear(balanceSheet, [lastHistoricYear]).ok;
  }, [balanceSheet, lastHistoricYear]);

  const appliedPreview = useMemo(() => {
    if (!appliedBody) return null;
    return computeDebtScheduleEngine({
      config: appliedBody,
      projectionYears,
      lastHistoricYear,
      balanceSheet,
    });
  }, [appliedBody, projectionYears, lastHistoricYear, balanceSheet]);

  const globalAdvisory = useMemo(() => getDebtScheduleGlobalAdvisory(), []);
  const unitLabel = getUnitLabel(currencyUnit);

  const setDraft = (next: DebtScheduleConfigBodyV1) => {
    setPersist({
      draft: ensureDebtScheduleBodyProjectionYears(next, projectionYears),
      applied: basePersist.applied,
    });
  };

  const onApply = () => {
    const body = cloneDebtScheduleBody(ensureDebtScheduleBodyProjectionYears(draft, projectionYears));
    setPersist({ draft: body, applied: body });
  };

  const onReset = () => {
    if (appliedBody) {
      const b = cloneDebtScheduleBody(ensureDebtScheduleBodyProjectionYears(appliedBody, projectionYears));
      setPersist({ draft: b, applied: appliedBody });
    } else {
      setPersist({
        draft: defaultDebtScheduleBody(projectionYears),
        applied: null,
      });
    }
  };

  const addTranche = () => {
    const next = cloneDebtScheduleBody(draft);
    next.tranches.push(createDefaultDebtTranche(projectionYears, next.tranches.length));
    setDraft(next);
    setOpenTrancheId(next.tranches[next.tranches.length - 1]!.trancheId);
  };

  const removeTranche = (id: string) => {
    if (draft.tranches.length <= 1) return;
    const next = { ...draft, tranches: draft.tranches.filter((t) => t.trancheId !== id) };
    setDraft(next);
    if (openTrancheId === id) setOpenTrancheId(null);
  };

  return (
    <div className="rounded-lg border border-sky-900/40 bg-sky-950/15 overflow-hidden">
      <button
        type="button"
        onClick={() => setSummaryOpen((o) => !o)}
        className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/20"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-sky-100">Debt schedule</div>
          <div className="text-[10px] text-sky-200/80 mt-0.5 leading-snug">
            Interest expense below EBIT is derived from this schedule — not forecast separately.
          </div>
        </div>
        <span className="text-slate-500 text-xs shrink-0">{summaryOpen ? "▼" : "▶"}</span>
      </button>
      {summaryOpen ? (
        <div className="px-3 pb-3 pt-0 border-t border-sky-900/30 space-y-3 text-[11px] text-slate-300">
          <p className="leading-relaxed text-slate-400">
            IB-style roll-forward per tranche: opening debt, new borrowing / draws, mandatory repayment, optional
            repayment, ending debt, and interest.{" "}
            <span className="text-amber-200/90">
              Revolver automation, cash sweep, and circularity are deferred — inputs are user-driven in v1.
            </span>
          </p>
          <p className="text-[10px] text-slate-600 font-mono">schedule id: {DEBT_SCHEDULE_PHASE2_ID}</p>

          <div className="rounded-md border border-slate-700/80 bg-slate-900/50 p-2 space-y-1">
            <p className="text-[11px] text-slate-200 font-medium">{globalAdvisory.title}</p>
            <p className="text-[11px] text-slate-400">{globalAdvisory.reason}</p>
            <p className="text-[10px] text-slate-500">
              Source: {globalAdvisory.source} · {globalAdvisory.confidencePct}% confidence
            </p>
          </div>

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
            <span className="text-[10px] text-slate-500 self-center">
              {appliedBody == null
                ? "Not applied"
                : hasApplied
                  ? "Applied"
                  : "Unsaved changes"}
            </span>
          </div>

          {appliedPreview && appliedBody ? (
            <div className="rounded-md border border-slate-800 bg-slate-950/40 p-2">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                Applied schedule check
              </p>
              <p className="text-[10px] text-slate-500">
                {appliedPreview.isComplete
                  ? "All enabled tranches have complete opening balances, roll-forward, and interest for each projection year."
                  : "Incomplete — fix opening debt (manual or historical BS), rates, or roll-forward so every enabled tranche computes for all years. Preview shows interest only when complete."}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addTranche}
              className="rounded-md border border-sky-700/50 bg-sky-950/40 px-2.5 py-1 text-[11px] text-sky-200 hover:bg-sky-900/50"
            >
              Add tranche
            </button>
          </div>

          <div className="space-y-2">
            {draft.tranches.map((t) => {
              const open = openTrancheId === t.trancheId;
              const advisories = getDebtScheduleTrancheAdvisory(t);
              return (
                <div key={t.trancheId} className="rounded-lg border border-slate-700 bg-slate-950/40 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenTrancheId(open ? null : t.trancheId)}
                    className="w-full text-left px-2.5 py-2 flex justify-between items-start gap-2 hover:bg-slate-800/20"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-slate-100">{t.trancheName || "Untitled tranche"}</span>
                      <span className="text-[10px] text-slate-500 ml-2 capitalize">{t.trancheType.replace("_", " ")}</span>
                      {!t.isEnabled ? (
                        <span className="text-[10px] text-slate-600 ml-2">· disabled</span>
                      ) : null}
                    </div>
                    <span className="text-slate-500 text-xs">{open ? "▼" : "▶"}</span>
                  </button>
                  {open ? (
                    <div className="px-2.5 pb-2.5 pt-0 border-t border-slate-800/80 space-y-2">
                      {t.trancheType === "revolver" ? (
                        <p className="text-[10px] text-amber-200/90 border-l-2 border-amber-800/50 pl-2">
                          Revolver: manual draws/repayments only in v1. Cash-driven draws and auto paydown are future
                          work (no circularity).
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2 items-center">
                        <label className="text-[10px] text-slate-500">Name</label>
                        <input
                          className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 flex-1 min-w-[120px]"
                          value={t.trancheName}
                          onChange={(e) => setDraft(patchTranche(draft, t.trancheId, { trancheName: e.target.value }))}
                        />
                        <label className="flex items-center gap-1 text-[10px] text-slate-400">
                          <input
                            type="checkbox"
                            checked={t.isEnabled}
                            onChange={(e) =>
                              setDraft(patchTranche(draft, t.trancheId, { isEnabled: e.target.checked }))
                            }
                          />
                          Enabled
                        </label>
                        <select
                          className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                          value={t.trancheType}
                          onChange={(e) =>
                            setDraft(
                              patchTranche(draft, t.trancheId, { trancheType: e.target.value as DebtTrancheTypeV1 })
                            )
                          }
                        >
                          <option value="term_debt">Term debt / funded</option>
                          <option value="revolver">Revolver</option>
                          <option value="other">Other</option>
                        </select>
                        <button
                          type="button"
                          disabled={draft.tranches.length <= 1}
                          onClick={() => removeTranche(t.trancheId)}
                          className="text-[10px] text-red-300/90 hover:text-red-200 disabled:opacity-30"
                        >
                          Remove
                        </button>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase text-slate-500 mb-0.5">Opening debt</label>
                        <select
                          className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 mb-1"
                          value={t.openingBalanceSource}
                          onChange={(e) =>
                            setDraft(
                              patchTranche(draft, t.trancheId, {
                                openingBalanceSource: e.target.value as OpeningBalanceSourceV1,
                              })
                            )
                          }
                        >
                          <option value="manual">Manual opening debt</option>
                          <option value="historical" disabled={!histDebtOk}>
                            From balance sheet (last historical)
                          </option>
                        </select>
                        {!histDebtOk ? (
                          <p className="text-[9px] text-amber-200/80">
                            Historical opening requires explicit st_debt and lt_debt for the last historical year.
                          </p>
                        ) : null}
                        {t.openingBalanceSource === "manual" ? (
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[10px] text-slate-500">{unitLabel}</span>
                            <input
                              type="number"
                              step={0.01}
                              className="w-28 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                              value={
                                t.openingBalanceManual != null
                                  ? storedToDisplay(t.openingBalanceManual, currencyUnit)
                                  : ""
                              }
                              onChange={(e) => {
                                const n = parseFloat(e.target.value);
                                setDraft(
                                  patchTranche(draft, t.trancheId, {
                                    openingBalanceManual: Number.isFinite(n)
                                      ? displayToStored(n, currencyUnit)
                                      : 0,
                                  })
                                );
                              }}
                            />
                          </div>
                        ) : (
                          <div className="mt-1 flex items-center gap-1">
                            <span className="text-[10px] text-slate-500">Allocation of BS total debt %</span>
                            <input
                              type="number"
                              step={0.1}
                              className="w-20 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                              value={t.openingHistoricalAllocationPct}
                              onChange={(e) => {
                                const n = parseFloat(e.target.value);
                                setDraft(
                                  patchTranche(draft, t.trancheId, {
                                    openingHistoricalAllocationPct: Number.isFinite(n) ? n : 0,
                                  })
                                );
                              }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] uppercase text-slate-500 mb-0.5">Interest rate</label>
                          <select
                            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 w-full"
                            value={t.interestRateMethod}
                            onChange={(e) =>
                              setDraft(
                                patchTranche(draft, t.trancheId, {
                                  interestRateMethod: e.target.value as InterestRateMethodV1,
                                })
                              )
                            }
                          >
                            <option value="fixed_rate">Fixed rate (all years)</option>
                            <option value="manual_by_year">Manual by year</option>
                          </select>
                          {t.interestRateMethod === "fixed_rate" ? (
                            <div className="flex items-center gap-1 mt-1">
                              <input
                                type="number"
                                step={0.01}
                                className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                                value={t.fixedInterestRatePct ?? ""}
                                onChange={(e) => {
                                  const n = parseFloat(e.target.value);
                                  setDraft(
                                    patchTranche(draft, t.trancheId, {
                                      fixedInterestRatePct: Number.isFinite(n) ? n : 0,
                                    })
                                  );
                                }}
                              />
                              <span className="text-[10px] text-slate-500">% nominal / year</span>
                            </div>
                          ) : null}
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase text-slate-500 mb-0.5">Interest basis</label>
                          <select
                            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 w-full"
                            value={t.interestComputationBasis}
                            onChange={(e) =>
                              setDraft(
                                patchTranche(draft, t.trancheId, {
                                  interestComputationBasis: e.target.value as InterestComputationBasisV1,
                                })
                              )
                            }
                          >
                            <option value="average_balance">Average balance</option>
                            <option value="ending_balance">Ending balance</option>
                          </select>
                        </div>
                      </div>

                      {advisories.length > 0 ? (
                        <div className="space-y-1">
                          {advisories.map((a, i) => (
                            <div key={i} className="rounded border border-slate-800/90 bg-slate-900/30 px-2 py-1">
                              <p className="text-[10px] text-slate-300">{a.reason}</p>
                              <p className="text-[9px] text-slate-600">
                                {a.title} · {a.source} · {a.confidencePct}%
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {projectionYears.length === 0 ? (
                        <p className="text-[10px] text-slate-600">Add projection years in model settings.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px] text-slate-300 border-collapse min-w-[480px]">
                            <thead>
                              <tr className="text-left text-slate-500 border-b border-slate-800">
                                <th className="py-1 pr-2 font-medium">Year</th>
                                <th className="py-1 px-1 font-medium text-right">Draws</th>
                                <th className="py-1 px-1 font-medium text-right">Mand. rep.</th>
                                <th className="py-1 px-1 font-medium text-right">Opt. rep.</th>
                                {t.interestRateMethod === "manual_by_year" ? (
                                  <th className="py-1 px-1 font-medium text-right">Rate %</th>
                                ) : null}
                              </tr>
                            </thead>
                            <tbody>
                              {projectionYears.map((y) => (
                                <tr key={y} className="border-b border-slate-800/60">
                                  <td className="py-1 pr-2 text-slate-400 whitespace-nowrap">{y}</td>
                                  {(["drawsByYear", "mandatoryRepaymentByYear", "optionalRepaymentByYear"] as const).map(
                                    (field) => (
                                      <td key={field} className="py-1 px-1 text-right">
                                        <input
                                          type="number"
                                          step={0.01}
                                          className="w-full max-w-[72px] ml-auto rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px] text-slate-200 tabular-nums"
                                          value={storedToDisplay(t[field][y] ?? 0, currencyUnit)}
                                          onChange={(e) => {
                                            const n = parseFloat(e.target.value);
                                            setDraft(
                                              patchTrancheYear(
                                                draft,
                                                t.trancheId,
                                                field,
                                                y,
                                                Number.isFinite(n) ? displayToStored(n, currencyUnit) : 0
                                              )
                                            );
                                          }}
                                        />
                                      </td>
                                    )
                                  )}
                                  {t.interestRateMethod === "manual_by_year" ? (
                                    <td className="py-1 px-1 text-right">
                                      <input
                                        type="number"
                                        step={0.01}
                                        className="w-full max-w-[56px] ml-auto rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px] text-slate-200"
                                        value={t.interestRateByYear[y] ?? ""}
                                        onChange={(e) => {
                                          const n = parseFloat(e.target.value);
                                          setDraft(
                                            patchTrancheYear(
                                              draft,
                                              t.trancheId,
                                              "interestRateByYear",
                                              y,
                                              Number.isFinite(n) ? n : 0
                                            )
                                          );
                                        }}
                                      />
                                    </td>
                                  ) : null}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="text-[9px] text-slate-600 mt-1">Amounts in {unitLabel || "model units"}.</p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
