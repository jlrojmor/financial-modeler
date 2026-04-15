"use client";

import { useEffect, useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import type { CurrencyUnit } from "@/store/useModelStore";
import { computeRowValue } from "@/lib/calculations";
import { storedToDisplay, displayToStored, getUnitLabel } from "@/lib/currency-utils";
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
import { computeDebtScheduleEngine, type DebtScheduleEngineResultV1 } from "@/lib/debt-schedule-engine";
import type { DebtScheduleConfigBodyV1 } from "@/types/debt-schedule-v1";
import {
  debtScheduleBodiesEqual,
  defaultDebtSchedulePhase2Persist,
  ensureDebtScheduleBodyProjectionYears,
} from "@/lib/debt-schedule-persist";
import {
  computeCapexDaSchedule,
  computeCapexDaScheduleByBucket,
  computeProjectedCapexByYear,
} from "@/lib/capex-da-engine";
import { computeIntangiblesAmortSchedule } from "@/lib/intangibles-amort-engine";
import {
  CAPEX_DEFAULT_BUCKET_IDS,
} from "@/lib/capex-defaults";
import { computeInterestIncomeSchedule } from "@/lib/interest-income-engine";
import { computeTaxSchedule } from "@/lib/tax-schedule-engine";
import { computeProjectedEbitByYear } from "@/lib/projected-ebit";

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

function flattenBalanceSheetRows(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) out.push(...flattenBalanceSheetRows(r.children));
  }
  return out;
}

function bsTaxonomyStoredAtYear(
  balanceSheet: Row[],
  taxonomyType: "liab_short_term_debt" | "liab_long_term_debt",
  year: string
): number | null {
  const flat = flattenBalanceSheetRows(balanceSheet);
  const row = flat.find((r) => r.taxonomyType === taxonomyType);
  const v = row?.values?.[year];
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

type DebtBsBreakdown =
  | {
      mode: "current_portion";
      histLabel: string;
      histSt: number | null;
      histLtd: number | null;
      projectionYears: string[];
      std: (number | null)[];
      ltd: (number | null)[];
    }
  | {
      mode: "revolver";
      histLabel: string;
      histSt: number | null;
      histLtd: number | null;
      projectionYears: string[];
      locBal: (number | null)[];
      termBal: (number | null)[];
    };

function buildDebtBsBreakdownPreview(params: {
  debtAppliedBody: DebtScheduleConfigBodyV1;
  debtEngineResult: DebtScheduleEngineResultV1;
  lastHistoricYear: string;
  balanceSheet: Row[];
  projectionYears: string[];
}): DebtBsBreakdown | null {
  const { debtAppliedBody, debtEngineResult, lastHistoricYear, balanceSheet, projectionYears } = params;
  const enabled = debtAppliedBody.tranches.filter((t) => t.isEnabled);
  const locTranche = enabled.find((t) => t.trancheType === "bank_line" || t.trancheType === "revolver");
  const termTranche = enabled.find((t) => t.trancheType === "term_loan" || t.trancheType === "term_debt");
  const isRevolverPath =
    enabled.length === 2 &&
    locTranche != null &&
    termTranche != null &&
    locTranche.trancheId !== termTranche.trancheId;
  const isCurrentPortionPath =
    !isRevolverPath &&
    enabled.length === 1 &&
    (enabled[0].trancheType === "term_loan" || enabled[0].trancheType === "term_debt") &&
    enabled[0].detectedFromBucket === "long_term";
  if (!isRevolverPath && !isCurrentPortionPath) return null;

  const histSt = bsTaxonomyStoredAtYear(balanceSheet, "liab_short_term_debt", lastHistoricYear);
  const histLtd = bsTaxonomyStoredAtYear(balanceSheet, "liab_long_term_debt", lastHistoricYear);
  const histLabel = `${lastHistoricYear}A`;

  if (isCurrentPortionPath) {
    const std: (number | null)[] = [];
    const ltd: (number | null)[] = [];
    for (const y of projectionYears) {
      const tot = debtEngineResult.totalsByYear[y]?.totalEndingDebt;
      const mand = debtEngineResult.totalsByYear[y]?.totalMandatoryRepayment;
      if (tot == null || mand == null || !Number.isFinite(tot) || !Number.isFinite(mand)) {
        std.push(null);
        ltd.push(null);
      } else {
        const s = Math.min(mand, tot);
        std.push(s);
        ltd.push(Math.max(0, tot - s));
      }
    }
    return {
      mode: "current_portion",
      histLabel,
      histSt,
      histLtd,
      projectionYears: [...projectionYears],
      std,
      ltd,
    };
  }

  const locFlows = debtEngineResult.perTrancheByYear[locTranche!.trancheId];
  const termFlows = debtEngineResult.perTrancheByYear[termTranche!.trancheId];
  const locBal: (number | null)[] = [];
  const termBal: (number | null)[] = [];
  for (const y of projectionYears) {
    const le = locFlows?.[y]?.endingDebt;
    const te = termFlows?.[y]?.endingDebt;
    locBal.push(le != null && Number.isFinite(le) ? le : null);
    termBal.push(te != null && Number.isFinite(te) ? te : null);
  }
  return {
    mode: "revolver",
    histLabel,
    histSt,
    histLtd,
    projectionYears: [...projectionYears],
    locBal,
    termBal,
  };
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
  const cogsForecastConfigV1 = useModelStore((s) => s.cogsForecastConfigV1);
  const opexForecastConfigV1 = useModelStore((s) => s.opexForecastConfigV1);

  // Capex & D&A store reads (for roll-forward preview)
  const capexForecastMethod = useModelStore((s) => s.capexForecastMethod);
  const capexPctRevenue = useModelStore((s) => s.capexPctRevenue);
  const capexManualByYear = useModelStore((s) => s.capexManualByYear);
  const capexGrowthPct = useModelStore((s) => s.capexGrowthPct);
  const capexTimingConvention = useModelStore((s) => s.capexTimingConvention);
  const ppeUsefulLifeSingle = useModelStore((s) => s.ppeUsefulLifeSingle);
  const capexSplitByBucket = useModelStore((s) => s.capexSplitByBucket);
  const capexCustomBucketIds = useModelStore((s) => s.capexCustomBucketIds);
  const capexBucketAllocationPct = useModelStore((s) => s.capexBucketAllocationPct);
  const ppeUsefulLifeByBucket = useModelStore((s) => s.ppeUsefulLifeByBucket);
  const capexHelperPpeByBucketByYear = useModelStore((s) => s.capexHelperPpeByBucketByYear);
  const capexModelIntangibles = useModelStore((s) => s.capexModelIntangibles);
  const intangiblesAmortizationLifeYears = useModelStore((s) => s.intangiblesAmortizationLifeYears);
  const intangiblesForecastMethod = useModelStore((s) => s.intangiblesForecastMethod);
  const intangiblesPctRevenue = useModelStore((s) => s.intangiblesPctRevenue);
  const intangiblesManualByYear = useModelStore((s) => s.intangiblesManualByYear);
  const intangiblesPctOfCapex = useModelStore((s) => s.intangiblesPctOfCapex);

  // Interest Income Schedule fields
  const intIncomeMethod = useModelStore((s) => s.intIncomeMethod);
  const intIncomeRatePct = useModelStore((s) => s.intIncomeRatePct);
  const intIncomeFlatValue = useModelStore((s) => s.intIncomeFlatValue);
  const intIncomeGrowthPct = useModelStore((s) => s.intIncomeGrowthPct);
  const intIncomeManualByYear = useModelStore((s) => s.intIncomeManualByYear);
  const intIncomeScheduleConfirmed = useModelStore((s) => s.intIncomeScheduleConfirmed);

  // Tax Schedule fields
  const taxForecastMethod = useModelStore((s) => s.taxForecastMethod);
  const taxEffectiveRatePct = useModelStore((s) => s.taxEffectiveRatePct);
  const taxRateByYear = useModelStore((s) => s.taxRateByYear);
  const taxFlatExpense = useModelStore((s) => s.taxFlatExpense);
  const taxAllowBenefit = useModelStore((s) => s.taxAllowBenefit);
  const taxScheduleConfirmed = useModelStore((s) => s.taxScheduleConfirmed);

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

  const debtDraftBody = useMemo(() => {
    if (!debtPersist.draft) return null;
    return ensureDebtScheduleBodyProjectionYears(debtPersist.draft, projectionYears);
  }, [debtPersist.draft, projectionYears]);

  const debtConventionMatch =
    (debtDraftBody?.conventionType ?? "mid_year") === (debtAppliedBody?.conventionType ?? "mid_year");

  const isDebtScheduleDirty =
    debtDraftBody != null &&
    debtAppliedBody != null &&
    (!debtScheduleBodiesEqual(debtDraftBody, debtAppliedBody) || !debtConventionMatch);

  const isDebtScheduleActive =
    isDebtScheduleDirty || debtSchedulePhase2Persist?.applied != null;

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

  const debtBsBreakdownPreview = useMemo(() => {
    if (!debtScheduleApplied || !debtAppliedBody || !debtEngineResult || !lastHistoricYear) return null;
    return buildDebtBsBreakdownPreview({
      debtAppliedBody,
      debtEngineResult,
      lastHistoricYear,
      balanceSheet,
      projectionYears,
    });
  }, [debtScheduleApplied, debtAppliedBody, debtEngineResult, lastHistoricYear, balanceSheet, projectionYears]);

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

  // Projected EBIT by year — uses forecast engines (revenue, COGS, opex drivers)
  // computeRowValue(ebitRow) returns 0 for projection years because input rows have no stored values
  const ebitByYear = useMemo(() => {
    return computeProjectedEbitByYear({
      incomeStatement,
      projectionYears,
      lastHistoricYear,
      revenueForecastConfigV1,
      revenueForecastTreeV1,
      revenueProjectionConfig,
      cogsForecastConfigV1,
      opexForecastConfigV1,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns,
      currencyUnit: unit,
    });
  }, [
    incomeStatement,
    projectionYears,
    lastHistoricYear,
    revenueForecastConfigV1,
    revenueForecastTreeV1,
    revenueProjectionConfig,
    cogsForecastConfigV1,
    opexForecastConfigV1,
    allStatements,
    sbcBreakdowns,
    danaBreakdowns,
    unit,
  ]);

  // ebitVal used by completeness badge — taken from forecast-engine result (same as ebitByYear[firstProj])
  const ebitVal = firstProj != null ? (ebitByYear[firstProj] ?? null) : null;
  const ebtVal = useMemo(() => {
    const allSt = { incomeStatement, balanceSheet, cashFlow };
    if (!firstProj) return null;
    const ebtRow = incomeStatement.find((r) => r.id === "ebt");
    if (!ebtRow) return null;
    try {
      const v = computeRowValue(ebtRow, firstProj, incomeStatement, incomeStatement, allSt);
      return v != null && Number.isFinite(v) ? v : null;
    } catch { return null; }
  }, [incomeStatement, balanceSheet, cashFlow, firstProj]);

  // EBT statement formula row — for comparison in footnote
  const ebtStatementByYear = useMemo(() => {
    const allSt = { incomeStatement, balanceSheet, cashFlow };
    const ebtRow = incomeStatement.find((r) => r.id === "ebt");
    const out: Record<string, number | null> = {};
    for (const y of projectionYears) {
      if (!ebtRow) { out[y] = null; continue; }
      try {
        const v = computeRowValue(ebtRow, y, incomeStatement, incomeStatement, allSt);
        out[y] = v != null && Number.isFinite(v) && v !== 0 ? v : null;
      } catch { out[y] = null; }
    }
    return out;
  }, [projectionYears, incomeStatement, balanceSheet, cashFlow]);

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

  // ── Interest Income Schedule preview — all values in STORED units ─────────
  const intIncomeByYear = useMemo(() => {
    if (!intIncomeScheduleConfirmed || projectionYears.length === 0) return null;
    const cashRow = balanceSheet.find((r) => r.taxonomyType === "asset_cash" || r.id === "cash");
    const cashByYear: Record<string, number> = {};
    for (const y of [...historicalYears, ...projectionYears]) {
      const v = cashRow?.values?.[y];
      if (typeof v === "number") cashByYear[y] = Math.abs(v);  // stored — engine works with stored values
    }
    const lastHistCash = historicalYears.length > 0
      ? Math.abs(cashRow?.values?.[historicalYears[historicalYears.length - 1]!] ?? 0)
      : 0;
    const intIncomeRow = incomeStatement.find((r) => r.taxonomyType === "non_op_interest_income" || r.id === "interest_income");
    const lastHistInterestIncome = historicalYears.length > 0
      ? Math.abs(intIncomeRow?.values?.[historicalYears[historicalYears.length - 1]!] ?? 0)
      : 0;
    return computeInterestIncomeSchedule({
      projectionYears,
      cashByYear,
      lastHistCash,
      lastHistInterestIncome,
      method: intIncomeMethod,
      ratePct: intIncomeRatePct,
      flatValue: intIncomeFlatValue,    // stored
      growthPct: intIncomeGrowthPct,
      manualByYear: intIncomeManualByYear,  // stored
    });
  }, [
    intIncomeScheduleConfirmed,
    projectionYears,
    historicalYears,
    balanceSheet,
    incomeStatement,
    intIncomeMethod,
    intIncomeRatePct,
    intIncomeFlatValue,
    intIncomeGrowthPct,
    intIncomeManualByYear,
  ]);

  // ── Tax Schedule preview — all values in STORED units ─────────────────────
  const taxByYear = useMemo(() => {
    if (!taxScheduleConfirmed || projectionYears.length === 0) return null;
    const allSt = { incomeStatement, balanceSheet, cashFlow };
    const ebtByYearCalc: Record<string, number> = {};
    const ebtRow = incomeStatement.find((r) => r.id === "ebt");
    for (const y of projectionYears) {
      if (ebtRow) {
        try {
          const v = computeRowValue(ebtRow, y, incomeStatement, incomeStatement, allSt);
          ebtByYearCalc[y] = v != null && Number.isFinite(v) ? v : 0;  // stored
        } catch {
          ebtByYearCalc[y] = 0;
        }
      } else {
        ebtByYearCalc[y] = 0;
      }
    }
    return computeTaxSchedule({
      projectionYears,
      ebtByYear: ebtByYearCalc,  // stored
      method: taxForecastMethod,
      flatRatePct: taxEffectiveRatePct,
      rateByYear: taxRateByYear,
      flatExpense: taxFlatExpense,  // stored
      allowTaxBenefit: taxAllowBenefit,
    });
  }, [
    taxScheduleConfirmed,
    projectionYears,
    incomeStatement,
    balanceSheet,
    cashFlow,
    taxForecastMethod,
    taxEffectiveRatePct,
    taxRateByYear,
    taxFlatExpense,
    taxAllowBenefit,
  ]);

  // ── Bridge completeness badge ──────────────────────────────────────────────
  const bridgeCompletenessBadge = useMemo(() => {
    let active = 0;
    let total = 0;
    // EBIT — always present when IS has ebit row
    total += 1;
    if (ebitVal != null) active += 1;
    // Interest expense
    total += 1;
    if (debtInterestComplete) active += 1;
    // Interest income
    total += 1;
    if (intIncomeScheduleConfirmed && intIncomeByYear != null) active += 1;
    // Tax
    total += 1;
    if (taxScheduleConfirmed && taxByYear != null) active += 1;

    if (active === total) {
      return { label: "Complete", color: "bg-emerald-900/60 text-emerald-300 border-emerald-700/40" };
    }
    const pending = total - active;
    return {
      label: `Partial — ${pending} item${pending !== 1 ? "s" : ""} pending`,
      color: "bg-amber-900/40 text-amber-300 border-amber-700/40",
    };
  }, [ebitVal, debtInterestComplete, intIncomeScheduleConfirmed, intIncomeByYear, taxScheduleConfirmed, taxByYear]);

  // D&A roll-forward for the preview panel — uses the same revenue engine as the rest of the model
  const dandaPreview = useMemo(() => {
    if (projectionYears.length === 0) return null;

    // revenueTotalByYear is already computed above using getProjectedRevenueTotalByYear
    const revenueByYear: Record<string, number> = {};
    for (const y of projectionYears) revenueByYear[y] = revenueTotalByYear[y] ?? 0;

    const lastHistPPE = lastHistoricYear
      ? (balanceSheet.find((r) => r.id === "ppe")?.values?.[lastHistoricYear] ?? 0)
      : 0;
    const lastHistCapex = lastHistoricYear
      ? (cashFlow.find((r) => r.id === "capex")?.values?.[lastHistoricYear] ?? 0)
      : 0;
    const lastHistIntangibles = lastHistoricYear
      ? (balanceSheet.find((r) => r.id === "intangible_assets")?.values?.[lastHistoricYear] ?? 0)
      : 0;

    const effectiveUsefulLife =
      capexSplitByBucket && ppeUsefulLifeByBucket
        ? (() => {
            const allIds = [...CAPEX_DEFAULT_BUCKET_IDS, ...(capexCustomBucketIds ?? [])];
            const lives = allIds.map((id) => ppeUsefulLifeByBucket[id]).filter((n): n is number => n != null && n > 0);
            return lives.length > 0 ? lives.reduce((a, b) => a + b, 0) / lives.length : (ppeUsefulLifeSingle ?? 10);
          })()
        : (ppeUsefulLifeSingle ?? 10);

    const capexEngineInput = {
      projectionYears,
      revenueByYear,
      lastHistPPE,
      lastHistCapex,
      method: capexForecastMethod,
      pctRevenue: capexPctRevenue,
      manualByYear: capexManualByYear ?? {},
      growthPct: capexGrowthPct,
      timingConvention: capexTimingConvention,
      usefulLifeYears: effectiveUsefulLife,
    };

    const totalCapexByYear = computeProjectedCapexByYear(capexEngineInput);

    let dandaByYear: Record<string, number>;
    let ppeEndByYear: Record<string, number>;

    if (capexSplitByBucket) {
      const allBucketIds = [...CAPEX_DEFAULT_BUCKET_IDS, ...(capexCustomBucketIds ?? [])];
      const landDisplay = lastHistoricYear && capexHelperPpeByBucketByYear?.["cap_b1"]?.[lastHistoricYear];
      const initialLand =
        landDisplay != null && typeof landDisplay === "number" && !Number.isNaN(landDisplay)
          ? displayToStored(landDisplay, unit)
          : 0;
      const bucketOut = computeCapexDaScheduleByBucket({
        projectionYears,
        totalCapexByYear,
        lastHistPPE,
        timingConvention: capexTimingConvention,
        bucketIds: allBucketIds,
        allocationPct: capexBucketAllocationPct ?? {},
        usefulLifeByBucket: ppeUsefulLifeByBucket ?? {},
        initialLandBalance: initialLand,
      });
      dandaByYear = bucketOut.totalDandaByYear;
      ppeEndByYear = bucketOut.totalPpeByYear;
    } else {
      const daOut = computeCapexDaSchedule(capexEngineInput);
      dandaByYear = daOut.dandaByYear;
      ppeEndByYear = daOut.ppeByYear;
    }

    const ppeOpenByYear: Record<string, number> = {};
    let prior = lastHistPPE;
    for (const y of projectionYears) {
      ppeOpenByYear[y] = prior;
      prior = ppeEndByYear[y] ?? prior;
    }

    const intangiblesOutput =
      capexModelIntangibles && intangiblesAmortizationLifeYears && intangiblesAmortizationLifeYears > 0
        ? computeIntangiblesAmortSchedule({
            projectionYears,
            lastHistIntangibles,
            additionsMethod: intangiblesForecastMethod,
            pctRevenue: intangiblesPctRevenue,
            manualByYear: intangiblesManualByYear ?? {},
            pctOfCapex: intangiblesPctOfCapex,
            capexByYear: totalCapexByYear,
            revenueByYear,
            lifeYears: intangiblesAmortizationLifeYears,
            timingConvention: capexTimingConvention,
          })
        : null;

    const totalDandaByYear: Record<string, number> = {};
    for (const y of projectionYears) {
      totalDandaByYear[y] = (dandaByYear[y] ?? 0) + (intangiblesOutput?.amortByYear[y] ?? 0);
    }

    const isConfigured = projectionYears.some((y) => (dandaByYear[y] ?? 0) > 0 || (totalCapexByYear[y] ?? 0) > 0);

    return {
      totalCapexByYear,
      dandaByYear,
      ppeOpenByYear,
      ppeEndByYear,
      lastHistPPE,
      lastHistIntangibles,
      intangiblesOutput,
      totalDandaByYear,
      isConfigured,
    };
  }, [
    projectionYears,
    revenueTotalByYear,
    balanceSheet,
    cashFlow,
    lastHistoricYear,
    unit,
    capexForecastMethod,
    capexPctRevenue,
    capexManualByYear,
    capexGrowthPct,
    capexTimingConvention,
    ppeUsefulLifeSingle,
    capexSplitByBucket,
    capexCustomBucketIds,
    capexBucketAllocationPct,
    ppeUsefulLifeByBucket,
    capexHelperPpeByBucketByYear,
    capexModelIntangibles,
    intangiblesAmortizationLifeYears,
    intangiblesForecastMethod,
    intangiblesPctRevenue,
    intangiblesManualByYear,
    intangiblesPctOfCapex,
  ]);

  const [dandaPreviewExpanded, setDandaPreviewExpanded] = useState(false);

  const hasAppliedDirect = directPreview.hasAnyAppliedProjection;
  /** null = follow default (expanded when applied, collapsed when not). */
  const [directDetailExpandedOverride, setDirectDetailExpandedOverride] = useState<boolean | null>(null);
  const [debtScheduleDetailExpanded, setDebtScheduleDetailExpanded] = useState(false);
  const [debtBsBreakdownOpen, setDebtBsBreakdownOpen] = useState(false);

  useEffect(() => {
    if (isDebtScheduleDirty) setDebtScheduleDetailExpanded(true);
  }, [isDebtScheduleDirty]);

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
        {debtScheduleApplied && projectionYears.length > 0 ? (
          <div
            data-debt-schedule-active={isDebtScheduleActive ? "true" : "false"}
            className={`rounded-lg border overflow-hidden ${
              isDebtScheduleDirty
                ? "border-sky-500/60 bg-sky-950/25 ring-1 ring-sky-500/30"
                : "border-sky-900/35 bg-sky-950/15"
            }`}
          >
            <button
              type="button"
              onClick={() => setDebtScheduleDetailExpanded((o) => !o)}
              className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/20"
            >
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-100">
                  {isDebtScheduleDirty ? (
                    <span
                      className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0"
                      aria-hidden
                    />
                  ) : null}
                  Debt schedule summary
                </span>
                {isDebtScheduleDirty ? (
                  <p className="text-[10px] text-sky-400 mt-0.5">Working on this now ↑</p>
                ) : null}
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
                <table className="w-full text-[10px] text-slate-300 mt-2 min-w-[480px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="py-1 pr-3 text-left font-medium text-slate-500 align-bottom">Line item</th>
                      {projectionYears.map((y) => (
                        <th
                          key={y}
                          className="py-1 px-1.5 text-right font-medium text-slate-500 tabular-nums align-bottom whitespace-nowrap"
                        >
                          {y}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-3 text-slate-400 whitespace-nowrap">
                        Total ending debt <span className="text-slate-600">→ BS</span>
                      </td>
                      {projectionYears.map((y) => (
                        <td key={y} className="py-1 px-1.5 text-right tabular-nums font-mono text-slate-200">
                          {formatBridgeAmount(debtEngineResult.totalsByYear[y]?.totalEndingDebt ?? null, unit, showDecimals)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-3 text-sky-300 whitespace-nowrap">
                        Total interest expense <span className="text-slate-600">→ IS</span>
                      </td>
                      {projectionYears.map((y) => (
                        <td key={y} className="py-1 px-1.5 text-right tabular-nums font-mono text-sky-300">
                          {formatBridgeAmount(debtEngineResult.totalsByYear[y]?.totalInterestExpense ?? null, unit, showDecimals)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-3 text-slate-400 whitespace-nowrap">
                        Mandatory repayments <span className="text-slate-600">→ CFS</span>
                      </td>
                      {projectionYears.map((y) => (
                        <td key={y} className="py-1 px-1.5 text-right tabular-nums font-mono text-slate-200">
                          {formatBridgeAmount(debtEngineResult.totalsByYear[y]?.totalMandatoryRepayment ?? null, unit, showDecimals)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-3 text-slate-400 whitespace-nowrap">
                        Total draws <span className="text-slate-600">→ CFS</span>
                      </td>
                      {projectionYears.map((y) => (
                        <td key={y} className="py-1 px-1.5 text-right tabular-nums font-mono text-slate-200">
                          {formatBridgeAmount(debtEngineResult.totalsByYear[y]?.totalNewBorrowingDraws ?? null, unit, showDecimals)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-3 text-slate-200 font-semibold whitespace-nowrap">Total debt service</td>
                      {projectionYears.map((y) => (
                        <td key={y} className="py-1 px-1.5 text-right tabular-nums font-mono font-semibold text-slate-200">
                          {formatBridgeAmount(debtEngineResult.totalsByYear[y]?.totalDebtService ?? null, unit, showDecimals)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                <p className="text-[9px] text-slate-600 mt-2">
                  Same engine totals as before, transposed: years are columns. Per-tranche detail is in the builder.
                </p>
                {debtScheduleApplied && debtBsBreakdownPreview ? (
                  <div className="mt-3 border-t border-sky-900/25 pt-2">
                    <button
                      type="button"
                      onClick={() => setDebtBsBreakdownOpen((o) => !o)}
                      className="w-full text-left flex items-start justify-between gap-2 hover:bg-slate-800/20 rounded px-0.5 py-1 -mx-0.5"
                    >
                      <div className="min-w-0">
                        <span className="text-[11px] font-semibold text-slate-200">Balance Sheet breakdown</span>
                        <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                          How STD and LTD appear on your balance sheet each year
                        </p>
                      </div>
                      <span className="text-slate-500 text-xs shrink-0">{debtBsBreakdownOpen ? "▼" : "▶"}</span>
                    </button>
                    {debtBsBreakdownOpen ? (
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-[10px] text-slate-300 border-collapse min-w-[480px]">
                          <thead>
                            <tr className="border-b border-slate-800">
                              <th className="py-1 pr-3 text-left font-medium text-slate-500 align-bottom">Line item</th>
                              <th className="py-1 px-1.5 text-right font-medium text-amber-200/90 tabular-nums align-bottom whitespace-nowrap">
                                {debtBsBreakdownPreview.histLabel}
                              </th>
                              {debtBsBreakdownPreview.projectionYears.map((y) => (
                                <th
                                  key={y}
                                  className="py-1 px-1.5 text-right font-medium text-slate-500 tabular-nums align-bottom whitespace-nowrap"
                                >
                                  {y}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-b border-slate-800/60">
                              <td className="py-1 pr-3 text-slate-300 whitespace-nowrap">Short-term debt / LOC</td>
                              <td className="py-1 px-1.5 text-right tabular-nums font-mono text-slate-200">
                                {formatBridgeAmount(debtBsBreakdownPreview.histSt, unit, showDecimals)}
                              </td>
                              {debtBsBreakdownPreview.mode === "current_portion"
                                ? debtBsBreakdownPreview.std.map((v, i) => (
                                    <td
                                      key={debtBsBreakdownPreview.projectionYears[i]}
                                      className="py-1 px-1.5 text-right tabular-nums font-mono text-slate-200"
                                    >
                                      {formatBridgeAmount(v, unit, showDecimals)}
                                    </td>
                                  ))
                                : debtBsBreakdownPreview.locBal.map((v, i) => (
                                    <td
                                      key={debtBsBreakdownPreview.projectionYears[i]}
                                      className="py-1 px-1.5 text-right tabular-nums font-mono text-slate-200"
                                    >
                                      {formatBridgeAmount(v, unit, showDecimals)}
                                    </td>
                                  ))}
                            </tr>
                            <tr className="border-b border-slate-800/60">
                              <td className="py-1 pr-3 text-slate-300 whitespace-nowrap">Long-term debt</td>
                              <td className="py-1 px-1.5 text-right tabular-nums font-mono text-slate-200">
                                {formatBridgeAmount(debtBsBreakdownPreview.histLtd, unit, showDecimals)}
                              </td>
                              {debtBsBreakdownPreview.mode === "current_portion"
                                ? debtBsBreakdownPreview.ltd.map((v, i) => (
                                    <td
                                      key={debtBsBreakdownPreview.projectionYears[i]}
                                      className="py-1 px-1.5 text-right tabular-nums font-mono text-slate-200"
                                    >
                                      {formatBridgeAmount(v, unit, showDecimals)}
                                    </td>
                                  ))
                                : debtBsBreakdownPreview.termBal.map((v, i) => (
                                    <td
                                      key={debtBsBreakdownPreview.projectionYears[i]}
                                      className="py-1 px-1.5 text-right tabular-nums font-mono text-slate-200"
                                    >
                                      {formatBridgeAmount(v, unit, showDecimals)}
                                    </td>
                                  ))}
                            </tr>
                          </tbody>
                        </table>
                        <p className="text-[9px] text-slate-500 italic mt-2 leading-snug">
                          {debtBsBreakdownPreview.mode === "current_portion"
                            ? "Short-term = next 12 months of principal payments (current portion). Reclassified from LTD each year automatically."
                            : "LOC balance stays flat until cash sweep auto-draws/repays in next step. LTD reduces by scheduled principal payments."}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* D&A Roll-Forward Preview Card */}
        {dandaPreview?.isConfigured ? (
          <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setDandaPreviewExpanded((o) => !o)}
              className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/20"
            >
              <div className="min-w-0">
                <span className="text-[11px] font-semibold text-violet-100">PP&amp;E &amp; D&amp;A roll-forward</span>
                <p className="text-[10px] text-violet-300/70 mt-0.5">
                  {(() => {
                    const vals = projectionYears.map((y) => dandaPreview.totalDandaByYear[y] ?? 0).filter((v) => v > 0);
                    if (vals.length === 0) return "Capex & depreciation projections";
                    const min = Math.min(...vals);
                    const max = Math.max(...vals);
                    const ul = getUnitLabel(unit);
                    const fmt = (v: number) => storedToDisplay(v, unit).toLocaleString(undefined, { maximumFractionDigits: 0 });
                    return min === max
                      ? `Total D&A: ${fmt(min)}${ul ? ` ${ul}` : ""}/yr`
                      : `Total D&A: ${fmt(min)}–${fmt(max)}${ul ? ` ${ul}` : ""}/yr`;
                  })()}
                </p>
              </div>
              <span className="text-slate-500 text-xs shrink-0">{dandaPreviewExpanded ? "▼" : "▶"}</span>
            </button>
            {dandaPreviewExpanded ? (
              <div className="px-3 pb-3 border-t border-violet-900/25 overflow-x-auto">
                <table className="w-full text-[10px] text-slate-300 mt-2 min-w-[380px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="py-1 pr-2 text-left font-medium text-slate-500">Item</th>
                      {lastHistoricYear ? (
                        <th className="py-1 px-1 text-right font-medium text-amber-400/70 tabular-nums">{lastHistoricYear}A</th>
                      ) : null}
                      {projectionYears.map((y) => (
                        <th key={y} className="py-1 px-1 text-right font-medium text-slate-500 tabular-nums">{y}E</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-2 text-slate-500">PP&amp;E — Opening</td>
                      {lastHistoricYear ? <td className="py-1 px-1 text-right text-slate-600">—</td> : null}
                      {projectionYears.map((y) => (
                        <td key={y} className="py-1 px-1 text-right tabular-nums font-mono">
                          {formatMaybe(dandaPreview.ppeOpenByYear[y] || null, unit, false)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-2 pl-3 text-slate-500">+ Capex</td>
                      {lastHistoricYear ? <td className="py-1 px-1 text-right text-slate-600">—</td> : null}
                      {projectionYears.map((y) => (
                        <td key={y} className="py-1 px-1 text-right tabular-nums font-mono">
                          {formatMaybe(dandaPreview.totalCapexByYear[y] || null, unit, false)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-2 pl-3 text-slate-500">− Depreciation</td>
                      {lastHistoricYear ? <td className="py-1 px-1 text-right text-slate-600">—</td> : null}
                      {projectionYears.map((y) => (
                        <td key={y} className="py-1 px-1 text-right tabular-nums font-mono">
                          {dandaPreview.dandaByYear[y]
                            ? `(${storedToDisplay(dandaPreview.dandaByYear[y]!, unit).toLocaleString(undefined, { maximumFractionDigits: 0 })})`
                            : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-800">
                      <td className="py-1.5 pr-2 text-slate-100 font-semibold">PP&amp;E — Ending</td>
                      {lastHistoricYear ? (
                        <td className="py-1.5 px-1 text-right tabular-nums font-mono font-semibold text-amber-400/80">
                          {formatMaybe(dandaPreview.lastHistPPE || null, unit, false)}
                        </td>
                      ) : null}
                      {projectionYears.map((y) => (
                        <td key={y} className="py-1.5 px-1 text-right tabular-nums font-mono font-semibold text-slate-100">
                          {formatMaybe(dandaPreview.ppeEndByYear[y] || null, unit, false)}
                        </td>
                      ))}
                    </tr>
                    {dandaPreview.intangiblesOutput ? (
                      <>
                        <tr className="border-b border-slate-800/60">
                          <td className="py-1 pr-2 text-slate-500">Intangibles — Ending</td>
                          {lastHistoricYear ? (
                            <td className="py-1 px-1 text-right tabular-nums text-amber-400/70">
                              {formatMaybe(dandaPreview.lastHistIntangibles || null, unit, false)}
                            </td>
                          ) : null}
                          {projectionYears.map((y) => (
                            <td key={y} className="py-1 px-1 text-right tabular-nums font-mono">
                              {formatMaybe(dandaPreview.intangiblesOutput!.endByYear[y] || null, unit, false)}
                            </td>
                          ))}
                        </tr>
                        <tr className="border-b border-slate-800/60">
                          <td className="py-1 pr-2 pl-3 text-slate-500">Amortization</td>
                          {lastHistoricYear ? <td className="py-1 px-1 text-right text-slate-600">—</td> : null}
                          {projectionYears.map((y) => (
                            <td key={y} className="py-1 px-1 text-right tabular-nums font-mono">
                              {dandaPreview.intangiblesOutput!.amortByYear[y]
                                ? `(${storedToDisplay(dandaPreview.intangiblesOutput!.amortByYear[y]!, unit).toLocaleString(undefined, { maximumFractionDigits: 0 })})`
                                : "—"}
                            </td>
                          ))}
                        </tr>
                      </>
                    ) : null}
                    <tr>
                      <td className="py-1.5 pr-2 text-violet-200 font-bold">Total D&amp;A</td>
                      {lastHistoricYear ? <td className="py-1.5 px-1 text-right text-slate-600">—</td> : null}
                      {projectionYears.map((y) => (
                        <td key={y} className="py-1.5 px-1 text-right tabular-nums font-mono font-bold text-violet-200">
                          {formatMaybe(dandaPreview.totalDandaByYear[y] || null, unit, false)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                <p className="text-[9px] text-slate-600 mt-2">
                  Straight-line depreciation (IB standard). Adjust in the Amortization schedule card on the left.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="border-b border-slate-800/60 my-1" />

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

        <div className="border-b border-slate-800/60 my-1" />

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

        <div className="border-b border-slate-800/60 my-1" />

        <div className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-3 space-y-2">
          {/* Header */}
          <div className="pb-2 border-b border-slate-800/80">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-slate-300">Pre-tax income bridge</p>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${bridgeCompletenessBadge.color}`}>
                {bridgeCompletenessBadge.label}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              EBIT → EBT → Net income, showing interest and non-operating items
            </p>
          </div>

          {/* Status hints for each key line */}
          <div className="text-[10px] space-y-0.5 pb-1 border-b border-slate-800/50">
            {!debtScheduleApplied ? (
              <p className="text-amber-400/80">
                <span className="font-medium">Interest expense:</span> Apply the debt schedule on the left.
              </p>
            ) : !debtInterestComplete ? (
              <p className="text-amber-400/80">
                <span className="font-medium">Interest expense:</span> Schedule applied but incomplete — finalize all tranches.
              </p>
            ) : (
              <p className="text-emerald-400/70">
                <span className="font-medium">Interest expense:</span> {bridgeModel.interestExpense.setupHint}
              </p>
            )}
            {!intIncomeScheduleConfirmed ? (
              <p className="text-slate-500">
                <span className="font-medium">Interest income:</span> Configure the Interest Income Schedule on the left.
              </p>
            ) : (
              <p className="text-emerald-400/70">
                <span className="font-medium">Interest income:</span> {bridgeModel.interestIncome.setupHint}
              </p>
            )}
            {!taxScheduleConfirmed ? (
              <p className="text-slate-500">
                <span className="font-medium">Tax expense:</span> Configure the Tax Schedule on the left.
              </p>
            ) : (
              <p className="text-emerald-400/70">
                <span className="font-medium">Tax schedule:</span> {taxEffectiveRatePct.toFixed(1)}% ETR applied to projected EBT.
              </p>
            )}
            {directPreview.hasAnyAppliedProjection && (
              <p className="text-slate-500">
                <span className="font-medium">Direct other:</span> {bridgeModel.directOther.setupHint}
              </p>
            )}
          </div>

          {/* Multi-year table */}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left py-1.5 pr-3 font-normal text-slate-500 w-28">Item</th>
                  {projectionYears.map((y) => (
                    <th key={y} className="text-right py-1.5 px-1.5 font-semibold text-slate-400 tabular-nums">{y}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* EBIT */}
                <tr className="border-b border-slate-800/40">
                  <td className="py-1.5 pr-3 text-slate-300">EBIT</td>
                  {projectionYears.map((y) => {
                    const v = ebitByYear[y];
                    return (
                      <td key={y} className="text-right px-1.5 py-1.5 text-slate-200 tabular-nums font-mono">
                        {v != null ? formatBridgeAmount(v, unit, showDecimals) : "—"}
                      </td>
                    );
                  })}
                </tr>
                {/* Interest expense */}
                <tr className="border-b border-slate-800/40">
                  <td className="py-1.5 pr-3 text-slate-400">
                    <span className="text-slate-600 mr-1">−</span>Int. expense
                  </td>
                  {projectionYears.map((y) => {
                    const mag =
                      debtInterestComplete && debtEngineResult?.interestExpenseTotalByYear[y] != null
                        ? debtEngineResult.interestExpenseTotalByYear[y]!
                        : null;
                    return (
                      <td key={y} className="text-right px-1.5 py-1.5 text-slate-200 tabular-nums font-mono">
                        {mag != null ? formatBridgeAmount(-mag, unit, showDecimals) : <span className="text-slate-600">—</span>}
                      </td>
                    );
                  })}
                </tr>
                {/* Interest income */}
                <tr className="border-b border-slate-800/40">
                  <td className="py-1.5 pr-3 text-slate-400">
                    <span className="text-slate-600 mr-1">+</span>Int. income
                  </td>
                  {projectionYears.map((y) => {
                    const v =
                      intIncomeScheduleConfirmed && intIncomeByYear != null
                        ? (intIncomeByYear.interestIncomeByYear[y] ?? null)
                        : null;
                    return (
                      <td key={y} className="text-right px-1.5 py-1.5 text-emerald-300 tabular-nums font-mono">
                        {v != null && v !== 0 ? formatBridgeAmount(v, unit, showDecimals) : <span className="text-slate-600">—</span>}
                      </td>
                    );
                  })}
                </tr>
                {/* Direct other (only if any applied) */}
                {directPreview.hasAnyAppliedProjection && (
                  <tr className="border-b border-slate-800/40">
                    <td className="py-1.5 pr-3 text-slate-400">
                      <span className="text-slate-600 mr-1">±</span>Direct other
                    </td>
                    {projectionYears.map((y) => {
                      const v = directPreview.totalByYear[y] ?? null;
                      return (
                        <td key={y} className="text-right px-1.5 py-1.5 text-slate-200 tabular-nums font-mono">
                          {v != null ? formatBridgeAmount(v, unit, showDecimals) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                )}
                {/* EBT subtotal */}
                <tr className="border-b border-slate-700/60 bg-slate-800/20">
                  <td className="py-1.5 pr-3 text-emerald-200/90 font-semibold">
                    = EBT{bridgeCompletenessBadge.label !== "Complete" ? " (partial)" : ""}
                  </td>
                  {projectionYears.map((y) => {
                    const ebit = ebitByYear[y];
                    if (ebit == null) return <td key={y} className="text-right px-1.5 py-1.5 text-slate-500">—</td>;
                    const intExp = debtInterestComplete ? (debtEngineResult?.interestExpenseTotalByYear[y] ?? 0) : 0;
                    const intInc =
                      intIncomeScheduleConfirmed && intIncomeByYear != null
                        ? (intIncomeByYear.interestIncomeByYear[y] ?? 0)
                        : 0;
                    const direct = directPreview.hasAnyAppliedProjection ? (directPreview.totalByYear[y] ?? 0) : 0;
                    const ebt = ebit - intExp + intInc + direct;
                    return (
                      <td key={y} className="text-right px-1.5 py-1.5 text-emerald-200 tabular-nums font-mono font-semibold">
                        {formatBridgeAmount(ebt, unit, showDecimals)}
                      </td>
                    );
                  })}
                </tr>
                {/* Tax expense */}
                <tr className="border-b border-slate-800/40">
                  <td className="py-1.5 pr-3 text-slate-400">
                    <span className="text-slate-600 mr-1">−</span>Tax expense
                  </td>
                  {projectionYears.map((y) => {
                    const tax =
                      taxScheduleConfirmed && taxByYear != null
                        ? (taxByYear.taxExpenseByYear[y] ?? null)
                        : null;
                    return (
                      <td key={y} className="text-right px-1.5 py-1.5 text-red-300 tabular-nums font-mono">
                        {tax != null && tax !== 0 ? formatBridgeAmount(-tax, unit, showDecimals) : <span className="text-slate-600">—</span>}
                      </td>
                    );
                  })}
                </tr>
                {/* Net income */}
                <tr className="bg-slate-800/10">
                  <td className="py-1.5 pr-3 text-slate-200 font-semibold">= Net income</td>
                  {projectionYears.map((y) => {
                    const ebit = ebitByYear[y];
                    if (ebit == null || !taxScheduleConfirmed || taxByYear == null) {
                      return <td key={y} className="text-right px-1.5 py-1.5 text-slate-600 font-mono">—</td>;
                    }
                    const intExp = debtInterestComplete ? (debtEngineResult?.interestExpenseTotalByYear[y] ?? 0) : 0;
                    const intInc =
                      intIncomeScheduleConfirmed && intIncomeByYear != null
                        ? (intIncomeByYear.interestIncomeByYear[y] ?? 0)
                        : 0;
                    const direct = directPreview.hasAnyAppliedProjection ? (directPreview.totalByYear[y] ?? 0) : 0;
                    const ebt = ebit - intExp + intInc + direct;
                    const tax = taxByYear.taxExpenseByYear[y] ?? 0;
                    const ni = ebt - tax;
                    const color = ni >= 0 ? "text-emerald-300" : "text-red-400";
                    return (
                      <td key={y} className={`text-right px-1.5 py-1.5 tabular-nums font-mono font-semibold ${color}`}>
                        {formatBridgeAmount(ni, unit, showDecimals)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* EBT statement formula footnote */}
          <div className="border-t border-slate-800/50 pt-2">
            <p className="text-[10px] text-slate-500 font-medium mb-1">EBT (statement formula row)</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {projectionYears.map((y) => (
                <span key={y} className="text-[10px] text-slate-600 tabular-nums">
                  {y}: {formatMaybe(ebtStatementByYear[y] ?? null, unit, showDecimals)}
                </span>
              ))}
            </div>
            <p className="text-[9px] text-slate-700 mt-1">
              Reported EBT row from your IS formulas — may differ from bridge EBT until schedules fully feed the statement.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
