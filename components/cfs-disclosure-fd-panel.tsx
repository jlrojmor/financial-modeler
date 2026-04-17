"use client";

import { useCallback, useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import {
  buildForecastDriversCoverageSnapshotFromModel,
  compareAllCfsLinesToCoverage,
} from "@/lib/forecast-drivers-coverage-snapshot";
import { findRowInTree } from "@/lib/row-utils";
import { mapAiTreatmentToDisclosureSpec } from "@/lib/cfs-ai-treatment-to-policy";
import { computeRowValue } from "@/lib/calculations";
import type { CfsAiRecommendedTreatment } from "@/types/cfs-forecast-diagnosis-v1";
import type { CfsLineAiDiagnosisPayload, CfsLineForecastDiagnosisV1 } from "@/types/cfs-forecast-diagnosis-v1";
import { isCfsComputedRollupRowId } from "@/lib/cfs-structural-row-ids";
import { CFS_DISCLOSURE_TREATMENT_LEGEND } from "@/lib/cfs-disclosure-treatment-copy";
import CfsDisclosureLineCard from "@/components/cfs-disclosure-line-card";

export default function CfsDisclosureFdPanel() {
  const cashFlow = useModelStore((s) => s.cashFlow);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const companyContext = useModelStore((s) => s.companyContext);
  const meta = useModelStore((s) => s.meta);
  const revenueForecastTreeV1 = useModelStore((s) => s.revenueForecastTreeV1);
  const wcDriversConfirmed = useModelStore((s) => s.wcDriversConfirmed);
  const dandaScheduleConfirmed = useModelStore((s) => s.dandaScheduleConfirmed);
  const equityRollforwardConfirmed = useModelStore((s) => s.equityRollforwardConfirmed);
  const otherBsConfirmed = useModelStore((s) => s.otherBsConfirmed);
  const taxScheduleConfirmed = useModelStore((s) => s.taxScheduleConfirmed);
  const debtSchedulePhase2Persist = useModelStore((s) => s.debtSchedulePhase2Persist);
  const cfsForecastDiagnosisByRowId = useModelStore((s) => s.cfsForecastDiagnosisByRowId ?? {});
  const mergeCfsForecastDiagnosisFromApi = useModelStore((s) => s.mergeCfsForecastDiagnosisFromApi);
  const setCfsLineForecastDiagnosis = useModelStore((s) => s.setCfsLineForecastDiagnosis);
  const setCfsDisclosureProjection = useModelStore((s) => s.setCfsDisclosureProjection);
  const applyBsBuildProjectionsToModel = useModelStore((s) => s.applyBsBuildProjectionsToModel);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const historicYears = meta?.years?.historical ?? [];
  const lastHistYear = historicYears[historicYears.length - 1] ?? null;

  const snapshot = useMemo(
    () =>
      buildForecastDriversCoverageSnapshotFromModel({
        incomeStatement: incomeStatement ?? [],
        balanceSheet: balanceSheet ?? [],
        cashFlow: cashFlow ?? [],
        revenueForecastTreeV1: revenueForecastTreeV1 ?? [],
        wcDriversConfirmed,
        dandaScheduleConfirmed,
        equityRollforwardConfirmed,
        otherBsConfirmed,
        taxScheduleConfirmed,
        debtSchedulePhase2Persist,
        meta,
      }),
    [
      cashFlow,
      balanceSheet,
      incomeStatement,
      revenueForecastTreeV1,
      wcDriversConfirmed,
      dandaScheduleConfirmed,
      equityRollforwardConfirmed,
      otherBsConfirmed,
      taxScheduleConfirmed,
      debtSchedulePhase2Persist,
      meta,
    ]
  );

  const compares = useMemo(
    () =>
      compareAllCfsLinesToCoverage(cashFlow ?? [], balanceSheet ?? [], incomeStatement ?? [], snapshot)
        .filter((c) => !isCfsComputedRollupRowId(c.cfsRowId))
        .filter((c) => c.deterministicClass === "cf_disclosure_only" || (c.gaps?.length ?? 0) > 0),
    [cashFlow, balanceSheet, incomeStatement, snapshot]
  );

  const allStatements = useMemo(
    () => ({
      incomeStatement: incomeStatement ?? [],
      balanceSheet: balanceSheet ?? [],
      cashFlow: cashFlow ?? [],
    }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  const lastHistRevenue = useMemo(() => {
    if (!lastHistYear) return undefined;
    const revRow = incomeStatement?.find((r) => r.id === "rev");
    if (!revRow) return undefined;
    try {
      return computeRowValue(revRow, lastHistYear, incomeStatement ?? [], incomeStatement ?? [], allStatements);
    } catch {
      return undefined;
    }
  }, [lastHistYear, incomeStatement, allStatements]);

  const runDiagnosis = useCallback(async () => {
    if (compares.length === 0) {
      setError("No CFS lines need diagnosis (no CF-disclosure gaps in the current tree).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/cfs-forecast-diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyContext,
          coverageSnapshot: snapshot,
          compares,
          balanceSheet: balanceSheet ?? [],
          incomeStatement: incomeStatement ?? [],
        }),
      });
      const data = (await res.json()) as {
        suggestions?: Record<string, CfsLineAiDiagnosisPayload>;
        error?: string | null;
      };
      if (!res.ok) {
        setError(data.error ?? "Diagnosis request failed");
        return;
      }
      if (data.suggestions && Object.keys(data.suggestions).length > 0) {
        mergeCfsForecastDiagnosisFromApi(data.suggestions);
      } else {
        setError(data.error ?? "No suggestions returned. Check API configuration.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [
    compares,
    companyContext,
    snapshot,
    balanceSheet,
    incomeStatement,
    mergeCfsForecastDiagnosisFromApi,
  ]);

  const acceptRow = useCallback(
    (rowId: string, diag: CfsLineForecastDiagnosisV1 | undefined) => {
      const row = findRowInTree(cashFlow ?? [], rowId);
      const eff = diag?.editedTreatment ?? diag?.ai?.recommendedTreatment;
      if (row && eff) {
        const spec = mapAiTreatmentToDisclosureSpec(eff, row, lastHistYear, lastHistRevenue);
        if (spec) setCfsDisclosureProjection(rowId, spec);
      }
      setCfsLineForecastDiagnosis(rowId, { userStatus: "accepted" });
      applyBsBuildProjectionsToModel();
    },
    [
      cashFlow,
      lastHistYear,
      lastHistRevenue,
      setCfsDisclosureProjection,
      setCfsLineForecastDiagnosis,
      applyBsBuildProjectionsToModel,
    ]
  );

  const dismissRow = useCallback(
    (rowId: string) => {
      setCfsLineForecastDiagnosis(rowId, { userStatus: "dismissed" });
    },
    [setCfsLineForecastDiagnosis]
  );

  const rowIdsToShow = useMemo(() => {
    const fromDiag = Object.keys(cfsForecastDiagnosisByRowId).filter((id) => !isCfsComputedRollupRowId(id));
    const fromCompare = compares.map((c) => c.cfsRowId);
    return Array.from(new Set([...fromCompare, ...fromDiag]));
  }, [cfsForecastDiagnosisByRowId, compares]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4">
        <h2 className="text-sm font-semibold text-slate-100">Cash flow disclosure lines</h2>
        <p className="mt-2 text-xs text-slate-400 max-w-3xl leading-relaxed">
          IS and BS forecasts drive schedules and bridges; the CFS rolls up operating, investing, and financing
          flows; net change in cash ties to cash on the balance sheet. This tab is only for filing-style lines that
          do not bridge automatically—section totals are computed by the engine.
        </p>
        <details className="mt-4 rounded-md border border-slate-600/50 bg-slate-900/50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-300 select-none">
            Treatment reference (and how it reaches Projected Statements)
          </summary>
          <ul className="mt-3 space-y-2 text-xs text-slate-400 list-none pl-0">
            {CFS_DISCLOSURE_TREATMENT_LEGEND.map((item) => (
              <li key={item.title} className="border-l-2 border-slate-600 pl-3">
                <span className="text-slate-200 font-medium">{item.title}</span>
                <span className="text-slate-500"> — </span>
                {item.body}
              </li>
            ))}
          </ul>
        </details>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runDiagnosis()}
            disabled={loading || compares.length === 0}
            className="rounded-md border border-sky-600/50 bg-sky-600/20 px-3 py-2 text-xs font-medium text-sky-200 hover:bg-sky-600/30 disabled:opacity-40"
          >
            {loading ? "Running…" : "Run CFS diagnosis"}
          </button>
          {compares.length === 0 ? (
            <span className="text-xs text-slate-500">No eligible lines (CF-disclosure / gaps).</span>
          ) : (
            <span className="text-xs text-slate-500">{compares.length} line(s) sent to the model.</span>
          )}
        </div>
        {error ? <p className="mt-2 text-xs text-amber-400">{error}</p> : null}
      </div>

      <div className="space-y-4">
        {rowIdsToShow.map((rowId) => {
          const compare = compares.find((c) => c.cfsRowId === rowId);
          const diag = cfsForecastDiagnosisByRowId[rowId];
          const row = findRowInTree(cashFlow ?? [], rowId);
          const label = compare?.label ?? row?.label ?? rowId;
          return (
            <CfsDisclosureLineCard
              key={rowId}
              rowId={rowId}
              label={label}
              row={row}
              balanceSheet={balanceSheet ?? []}
              incomeStatement={incomeStatement ?? []}
              diag={diag}
              onAccept={() => acceptRow(rowId, diag)}
              onDismiss={() => dismissRow(rowId)}
              onOverrideChange={(v) => {
                setCfsLineForecastDiagnosis(rowId, {
                  editedTreatment: v || undefined,
                  userStatus:
                    diag?.userStatus === "pending" || diag?.userStatus === undefined
                      ? "edited"
                      : diag.userStatus === "dismissed"
                        ? "edited"
                        : diag.userStatus,
                });
              }}
            />
          );
        })}
        {rowIdsToShow.length === 0 ? (
          <p className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-500">
            No disclosure lines to show.
          </p>
        ) : null}
      </div>
    </div>
  );
}
