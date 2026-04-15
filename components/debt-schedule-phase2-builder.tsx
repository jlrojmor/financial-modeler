"use client";

import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import type { Row } from "@/types/finance";
import { useModelStore } from "@/store/useModelStore";
import type { CurrencyUnit } from "@/store/useModelStore";
import { storedToDisplay, displayToStored, getUnitLabel } from "@/lib/currency-utils";
import { tryBuildModelTotalDebtByYear } from "@/lib/model-total-debt-for-interest";
import { DEBT_SCHEDULE_PHASE2_ID } from "@/types/debt-schedule-v1";
import type {
  AmortizationMethodV1,
  DebtScheduleConfigBodyV1,
  DebtScheduleConventionTypeV1,
  DebtTrancheConfigV1,
  DebtTrancheTypeV1,
  InterestComputationBasisV1,
  InterestRateMethodV1,
} from "@/types/debt-schedule-v1";
import {
  cloneDebtScheduleBody,
  createDefaultDebtTranche,
  debtScheduleBodiesEqual,
  defaultDebtScheduleBody,
  ensureDebtScheduleBodyProjectionYears,
} from "@/lib/debt-schedule-persist";
import {
  computeDebtScheduleEngine,
  detectBsDebtOpeningBalances,
  resolveTrancheOpeningBalance,
  type BsDebtOpeningBalancesV1,
  type DebtScheduleEngineResultV1,
  type DebtTrancheYearFlowV1,
} from "@/lib/debt-schedule-engine";
import { getDebtScheduleRepaymentStyleHint } from "@/lib/debt-schedule-advisory";
import { applyStraightLineMandatoriesOnTranche } from "@/lib/debt-schedule-apply";

type OpeningSelectValue = "detected_st" | "detected_lt" | "manual" | "legacy_all_funded" | "historical";

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

function patchConvention(body: DebtScheduleConfigBodyV1, conventionType: DebtScheduleConventionTypeV1): DebtScheduleConfigBodyV1 {
  return { ...body, conventionType };
}

function trancheTypeDisplayLabel(tt: DebtTrancheTypeV1): string {
  switch (tt) {
    case "revolver":
    case "bank_line":
      return "Bank line";
    case "term_debt":
    case "term_loan":
      return "Term loan";
    case "mortgage":
      return "Mortgage";
    case "shareholder_loan":
      return "Shareholder loan";
    default:
      return "Other";
  }
}

/** Plain-English labels for facility type (UI). */
function facilityTypePlainLabel(tt: DebtTrancheTypeV1): string {
  switch (tt) {
    case "bank_line":
      return "Bank Line of Credit";
    case "term_loan":
      return "Bank Term Loan";
    case "mortgage":
      return "Mortgage / Equipment Loan";
    case "shareholder_loan":
      return "Owner / Shareholder Loan";
    case "other":
      return "Other";
    case "revolver":
      return "Revolver (legacy)";
    case "term_debt":
      return "Term debt (legacy)";
    default:
      return "Other";
  }
}

function inferOpeningSelectValue(t: DebtTrancheConfigV1): OpeningSelectValue {
  if (t.openingBalanceSource === "historical") return "historical";
  if (t.openingBalanceSource === "manual") {
    if (t.detectedFromBucket === "short_term") return "detected_st";
    if (t.detectedFromBucket === "long_term") return "detected_lt";
    return "manual";
  }
  if (t.openingBalanceSource === "detected_historical_bs") {
    const b = t.openingDebtBucket ?? "all_funded";
    if (b === "current_funded") return "detected_st";
    if (b === "long_term_funded") return "detected_lt";
    return "legacy_all_funded";
  }
  return "manual";
}

function applyOpeningSelect(
  body: DebtScheduleConfigBodyV1,
  trancheId: string,
  value: OpeningSelectValue,
  bs: BsDebtOpeningBalancesV1
): DebtScheduleConfigBodyV1 {
  const t = body.tranches.find((x) => x.trancheId === trancheId);
  if (!t) return body;
  if (value === "detected_st") {
    return patchTranche(body, trancheId, {
      openingBalanceSource: "manual",
      openingBalanceManual: bs.shortTerm ?? 0,
      detectedFromBucket: "short_term",
      openingDebtBucket: "current_funded",
    });
  }
  if (value === "detected_lt") {
    return patchTranche(body, trancheId, {
      openingBalanceSource: "manual",
      openingBalanceManual: bs.longTerm ?? 0,
      detectedFromBucket: "long_term",
      openingDebtBucket: "long_term_funded",
    });
  }
  if (value === "legacy_all_funded") {
    return patchTranche(body, trancheId, {
      openingBalanceSource: "detected_historical_bs",
      openingDebtBucket: "all_funded",
      detectedFromBucket: undefined,
    });
  }
  return patchTranche(body, trancheId, {
    openingBalanceSource: "manual",
    detectedFromBucket: "manual",
  });
}

function findHistoricalInterestExpenseMagnitude(incomeStatement: Row[], year: string | null): number | null {
  if (!year) return null;
  const cell = (r: Row | undefined) => {
    const v = r?.values?.[year];
    if (v == null || !Number.isFinite(v)) return null;
    return Math.abs(v);
  };
  const byTax = incomeStatement.find((r) => r.taxonomyType === "non_op_interest_expense");
  const a = cell(byTax);
  if (a != null) return a;
  const byId = incomeStatement.find((r) => r.id === "interest_expense");
  return cell(byId);
}

function fmtMoneyStored(n: number | null | undefined, currencyUnit: CurrencyUnit, parensIfNegative: boolean): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const d = storedToDisplay(n, currencyUnit);
  const s = d.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (parensIfNegative && n < 0) return `(${Math.abs(d).toLocaleString(undefined, { maximumFractionDigits: 2 })})`;
  return s;
}

function fmtRatePct(nominal: number | null | undefined): string {
  if (nominal == null || !Number.isFinite(nominal)) return "—";
  return `${(nominal * 100).toFixed(2)}%`;
}

/** Compact display for onboarding copy (e.g. $1.2K). */
function fmtBooksAmount(n: number | null | undefined, currencyUnit: CurrencyUnit): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const d = storedToDisplay(n, currencyUnit);
  const abs = Math.abs(d);
  if (abs >= 1000) {
    return `$${(abs / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  }
  return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function computeBeyondMaturityYear(repaymentStartYear: string | undefined, termYears: number): string | undefined {
  if (!repaymentStartYear || termYears <= 0) return undefined;
  const sy = parseInt(repaymentStartYear, 10);
  if (!Number.isFinite(sy)) return undefined;
  return String(sy + termYears);
}

function readBalanceSheetRowValue(rows: Row[], rowId: string, year: string | null): number | null {
  if (!year) return null;
  const row = rows.find((r) => r.id === rowId);
  const v = row?.values?.[year];
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function flattenBalanceSheetRows(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) out.push(...flattenBalanceSheetRows(r.children));
  }
  return out;
}

function bsTaxonomyValueAtYear(
  balanceSheet: Row[],
  taxonomyType: "asset_receivables" | "asset_inventory",
  year: string | null
): number | null {
  if (!year) return null;
  const flat = flattenBalanceSheetRows(balanceSheet);
  const row = flat.find((r) => r.taxonomyType === taxonomyType);
  const v = row?.values?.[year];
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

type RevolverCapAblSuggestion = {
  /** Model units (stored). */
  capStored: number;
  /** Display “K” for the number input. */
  capK: number;
  rationale: string;
};

/** ABL-style suggested revolver cap + copy for the UI. */
function revolverCapAblSuggestion(
  balanceSheet: Row[],
  lastHistoricYear: string | null,
  shortTermStored: number | null | undefined,
  currencyUnit: CurrencyUnit
): RevolverCapAblSuggestion {
  const st = shortTermStored ?? 0;
  const ar = bsTaxonomyValueAtYear(balanceSheet, "asset_receivables", lastHistoricYear) ?? 0;
  const inv = bsTaxonomyValueAtYear(balanceSheet, "asset_inventory", lastHistoricYear) ?? 0;
  const ablCap = ar * 0.8 + inv * 0.5;
  let capStored: number;
  let rationale: string;
  if (ablCap > 0) {
    capStored = ablCap;
    rationale = `80% of AR (${fmtBooksAmount(ar, currencyUnit)}) + 50% of inventory (${fmtBooksAmount(
      inv,
      currencyUnit
    )}) — ABL industry standard. Confirm with your bank.`;
  } else if (ar > 0) {
    capStored = ar * 0.8;
    rationale = `80% of your accounts receivable — standard for AR-based credit lines.`;
  } else {
    capStored = st * 2;
    rationale = `Estimated at 2× your current line balance — no AR/inventory data found. Confirm with your bank.`;
  }
  if (!Number.isFinite(capStored) || capStored < 0) capStored = 0;
  const capK = capStored > 0 ? storedToDisplay(capStored, currencyUnit) / 1000 : 0;
  return { capStored, capK, rationale };
}

type DraftRollYear = { opening: number; ending: number; interest: number };

function computeDraftTrancheRollforwardByYear(
  tranche: DebtTrancheConfigV1,
  projectionYears: string[],
  lastHistoricYear: string | null,
  balanceSheet: Row[],
  conventionType: DebtScheduleConventionTypeV1 | undefined
): Record<string, DraftRollYear> | null {
  if (!tranche.isEnabled) return null;
  const open = resolveTrancheOpeningBalance(tranche, lastHistoricYear, balanceSheet);
  if (open == null || !Number.isFinite(open)) return null;
  const fullYear = (conventionType ?? "mid_year") === "full_year";
  const rateMethod = tranche.interestRateMethod ?? "fixed_rate";
  let prior = open;
  const byYear: Record<string, DraftRollYear> = {};
  for (const y of projectionYears) {
    const mand = tranche.mandatoryRepaymentByYear[y] ?? 0;
    const draws = tranche.drawsByYear[y] ?? 0;
    const ending = Math.max(0, prior + draws - mand);
    const average = (prior + ending) / 2;
    const ratePct =
      rateMethod === "manual_by_year" ? (tranche.interestRateByYear[y] ?? 0) : (tranche.fixedInterestRatePct ?? 0);
    const rate = (typeof ratePct === "number" && Number.isFinite(ratePct) ? ratePct : 0) / 100;
    const basis = fullYear ? ending : average;
    const interest = rate * basis;
    byYear[y] = { opening: prior, ending, interest };
    prior = ending;
  }
  return byYear;
}

type StdRatioSuggest = "current_portion" | "revolver" | "unclear";

function computeStdDebtRatioSuggestion(
  shortTerm: number,
  longTerm: number,
  stLabel: string,
  ltLabel: string
): { suggest: StdRatioSuggest; reason: string } {
  if (longTerm <= 0 || shortTerm <= 0) {
    return {
      suggest: "unclear",
      reason: "The ratio could indicate either. We recommend confirming with your accountant or loan documents.",
    };
  }
  const r = shortTerm / longTerm;
  const pct = (r * 100).toFixed(1);
  if (r >= 0.08 && r <= 0.15) {
    return {
      suggest: "current_portion",
      reason: `Your short-term debt (${stLabel}) is approximately ${pct}% of your long-term debt (${ltLabel}), which is consistent with an annual loan payment. This is likely the current portion of your term loan.`,
    };
  }
  if (r < 0.05 || r > 0.25) {
    return {
      suggest: "revolver",
      reason: `The ratio between your short-term (${stLabel}) and long-term debt (${ltLabel}) doesn't match typical annual amortization patterns. This may be a separate revolving line.`,
    };
  }
  return {
    suggest: "unclear",
    reason: "The ratio could indicate either. We recommend confirming with your accountant or loan documents.",
  };
}

/** Option A: ST is current portion of term loan — opening is ST+LT; only LTD bucket flag is stored. */
function isCombinedCurrentPortionTranche(
  t: DebtTrancheConfigV1,
  shortTerm: number | null,
  longTerm: number | null
): boolean {
  if (t.detectedFromBucket !== "long_term" || shortTerm == null || longTerm == null) return false;
  const sum = shortTerm + longTerm;
  const m = t.openingBalanceManual;
  if (m == null || !Number.isFinite(m) || !Number.isFinite(sum)) return false;
  const tol = Math.max(1e-9, Math.abs(sum) * 1e-5);
  return Math.abs(m - sum) <= tol;
}

/**
 * Same rules as the tranche row "Estimated annual principal repayment" (straight-line beyond vs within forecast,
 * manual_by_year, none). Uses resolved opening balance — for combined current-portion tranches this matches ST+LT.
 */
function computeTrancheEstimatedAnnualPrincipal(
  tr: DebtTrancheConfigV1 | undefined,
  openingUsed: number | null,
  projectionYears: string[],
  maturityUi: { withinForecast: boolean; termYears: number }
): number {
  if (!tr) return 0;
  const amort: AmortizationMethodV1 = tr.amortizationMethod ?? "manual_by_year";
  if (amort === "none") return 0;
  const fy = projectionYears[0];
  if (amort === "manual_by_year") {
    return fy ? (tr.mandatoryRepaymentByYear[fy] ?? 0) : 0;
  }
  if (amort !== "straight_line") {
    return fy ? (tr.mandatoryRepaymentByYear[fy] ?? 0) : 0;
  }
  if (openingUsed == null || !Number.isFinite(openingUsed) || openingUsed <= 0) {
    return fy ? (tr.mandatoryRepaymentByYear[fy] ?? 0) : 0;
  }
  if (!maturityUi.withinForecast && maturityUi.termYears > 0) {
    return openingUsed / maturityUi.termYears;
  }
  const estStraightYears =
    tr.repaymentStartYear && tr.maturityYear && maturityUi.withinForecast
      ? projectionYears.filter((yy) => yy >= tr.repaymentStartYear! && yy <= tr.maturityYear!)
      : [];
  if (estStraightYears.length > 0) {
    return openingUsed / estStraightYears.length;
  }
  return fy ? (tr.mandatoryRepaymentByYear[fy] ?? 0) : 0;
}

function getBucketBlockers(
  tranches: DebtTrancheConfigV1[],
  shortTerm: number | null | undefined,
  longTerm: number | null | undefined
): {
  shortTermOwnerId: string | null;
  shortTermOwnerName: string;
  longTermOwnerId: string | null;
  longTermOwnerName: string;
} {
  const st = shortTerm ?? null;
  const lt = longTerm ?? null;
  const combined = tranches.find((t) => isCombinedCurrentPortionTranche(t, st, lt));
  if (combined) {
    const nm = combined.trancheName || "Another facility";
    return {
      shortTermOwnerId: combined.trancheId,
      shortTermOwnerName: nm,
      longTermOwnerId: combined.trancheId,
      longTermOwnerName: nm,
    };
  }
  let shortTermOwnerId: string | null = null;
  let shortTermOwnerName = "";
  let longTermOwnerId: string | null = null;
  let longTermOwnerName = "";
  for (const t of tranches) {
    if (t.detectedFromBucket === "short_term") {
      shortTermOwnerId = t.trancheId;
      shortTermOwnerName = t.trancheName || "Another facility";
    }
    if (t.detectedFromBucket === "long_term") {
      longTermOwnerId = t.trancheId;
      longTermOwnerName = t.trancheName || "Another facility";
    }
  }
  return { shortTermOwnerId, shortTermOwnerName, longTermOwnerId, longTermOwnerName };
}

function fixedRateContextHint(trancheType: DebtTrancheTypeV1): string {
  switch (trancheType) {
    case "bank_line":
    case "revolver":
      return "Typical bank lines: Prime + 1–3% spread. If unknown, use 8–9%.";
    case "term_loan":
    case "term_debt":
      return "Typical bank term loans: 5–9% for healthy private companies. Use your loan agreement rate if available.";
    case "mortgage":
      return "Typical commercial mortgages: 5–7.5%.";
    case "shareholder_loan":
      return "Owner loans are often 0% or at the IRS Applicable Federal Rate. Enter 0 if no interest is charged.";
    default:
      return "Enter the rate from your loan agreement.";
  }
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
  const incomeStatement = useModelStore((s) => s.incomeStatement ?? []);

  const [openTrancheId, setOpenTrancheId] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [archDocOpen, setArchDocOpen] = useState(false);
  const [startHereDismissed, setStartHereDismissed] = useState(false);
  /** Local only: straight-line maturity extends past forecast (Apply reads this). */
  const [maturityUiByTranche, setMaturityUiByTranche] = useState<
    Record<string, { withinForecast: boolean; termYears: number }>
  >({});
  /** Short-term vs long-term interpretation when both BS buckets exist (local only). */
  const [stdClassificationPick, setStdClassificationPick] = useState<
    null | "current_portion" | "revolver" | "unclear"
  >(null);
  const [stdAwaitingUnclearFollowup, setStdAwaitingUnclearFollowup] = useState(false);
  const [stdSetupCommitted, setStdSetupCommitted] = useState<null | "current_portion" | "revolver">(null);
  const [stdOnlyPick, setStdOnlyPick] = useState<null | "revolver" | "st_loan" | "other">(null);
  // revolverCapKByTrancheId removed — revolver cap and cash-sweep params are now persisted on the tranche.

  const basePersist = persist ?? { draft: defaultDebtScheduleBody([]), applied: null };
  const draft = useMemo(
    () => ensureDebtScheduleBodyProjectionYears(basePersist.draft, projectionYears),
    [basePersist.draft, projectionYears]
  );
  const appliedBody = basePersist.applied
    ? ensureDebtScheduleBodyProjectionYears(basePersist.applied, projectionYears)
    : null;

  const effectiveConvention = (c: DebtScheduleConventionTypeV1 | undefined) => c ?? "mid_year";
  const unsaved =
    appliedBody == null ||
    !debtScheduleBodiesEqual(draft, appliedBody) ||
    effectiveConvention(draft.conventionType) !== effectiveConvention(appliedBody?.conventionType);
  const hasApplied =
    appliedBody != null &&
    debtScheduleBodiesEqual(draft, appliedBody) &&
    effectiveConvention(draft.conventionType) === effectiveConvention(appliedBody.conventionType);

  const histDebtOk = useMemo(() => {
    if (!lastHistoricYear) return false;
    return tryBuildModelTotalDebtByYear(balanceSheet, [lastHistoricYear]).ok;
  }, [balanceSheet, lastHistoricYear]);

  const bsOpening = useMemo(
    () => detectBsDebtOpeningBalances(balanceSheet, lastHistoricYear),
    [balanceSheet, lastHistoricYear]
  );

  const booksYearLabel = lastHistoricYear ?? bsOpening.historicalYearUsed ?? "latest books";
  const hasStdDebt = (bsOpening.shortTerm ?? 0) > 0;
  const hasLtdDebt = (bsOpening.longTerm ?? 0) > 0;

  const impliedFixedRatePctByTrancheId = useMemo(() => {
    const out: Record<string, number | null> = {};
    const ieMag = findHistoricalInterestExpenseMagnitude(incomeStatement, lastHistoricYear);
    for (const tranche of draft.tranches) {
      if (ieMag == null || !Number.isFinite(ieMag) || ieMag <= 0) {
        out[tranche.trancheId] = null;
        continue;
      }
      const open = resolveTrancheOpeningBalance(tranche, lastHistoricYear, balanceSheet);
      if (open == null || !Number.isFinite(open) || open <= 0) {
        out[tranche.trancheId] = null;
        continue;
      }
      const implied = (ieMag / open) * 100;
      if (!Number.isFinite(implied) || implied <= 0 || implied < 0.5 || implied > 30) out[tranche.trancheId] = null;
      else out[tranche.trancheId] = implied;
    }
    return out;
  }, [draft.tranches, incomeStatement, lastHistoricYear, balanceSheet]);

  const stdRatioHint = useMemo(() => {
    if (!hasStdDebt || !hasLtdDebt) return null;
    const st = bsOpening.shortTerm!;
    const lt = bsOpening.longTerm!;
    return computeStdDebtRatioSuggestion(
      st,
      lt,
      fmtBooksAmount(st, currencyUnit),
      fmtBooksAmount(lt, currencyUnit)
    );
  }, [hasStdDebt, hasLtdDebt, bsOpening.shortTerm, bsOpening.longTerm, currencyUnit]);

  const bucketBlockers = useMemo(
    () => getBucketBlockers(draft.tranches, bsOpening.shortTerm, bsOpening.longTerm),
    [draft.tranches, bsOpening.shortTerm, bsOpening.longTerm]
  );

  const currentPortionBsPreview = useMemo(() => {
    if (stdSetupCommitted !== "current_portion") return null;
    const histY = lastHistoricYear ?? bsOpening.historicalYearUsed;
    if (!histY) return null;
    const st = bsOpening.shortTerm ?? 0;
    const lt = bsOpening.longTerm ?? 0;
    const openingCombined = st + lt;
    const tr =
      draft.tranches.find((x) => isCombinedCurrentPortionTranche(x, st, lt)) ?? draft.tranches[0];
    const openingUsed = tr ? resolveTrancheOpeningBalance(tr, lastHistoricYear, balanceSheet) : null;
    const mUi = tr ? maturityUiByTranche[tr.trancheId] ?? { withinForecast: true, termYears: 10 } : { withinForecast: true, termYears: 10 };
    const annual = computeTrancheEstimatedAnnualPrincipal(tr, openingUsed, projectionYears, mUi);
    const forecastCols = projectionYears.slice(0, 3);
    const stdProj: number[] = [];
    const ltdProj: number[] = [];
    for (let i = 0; i < forecastCols.length; i++) {
      const totalEndingDebt = Math.max(0, openingCombined - annual * (i + 1));
      const stdRow = Math.min(annual, totalEndingDebt);
      const ltdRow = Math.max(0, totalEndingDebt - stdRow);
      stdProj.push(stdRow);
      ltdProj.push(ltdRow);
    }
    return { histY, forecastCols, st, lt, openingCombined, stdProj, ltdProj, annual };
  }, [
    stdSetupCommitted,
    lastHistoricYear,
    bsOpening,
    draft.tranches,
    projectionYears,
    maturityUiByTranche,
    balanceSheet,
  ]);

  const revolverBsPreview = useMemo(() => {
    if (stdSetupCommitted !== "revolver") return null;
    const histY = lastHistoricYear ?? bsOpening.historicalYearUsed;
    if (!histY) return null;
    const st = bsOpening.shortTerm ?? 0;
    const lt = bsOpening.longTerm ?? 0;
    const forecastCols = projectionYears.slice(0, 3);
    const locTranche =
      draft.tranches.find(
        (x) =>
          x.detectedFromBucket === "short_term" && (x.trancheType === "bank_line" || x.trancheType === "revolver")
      ) ?? draft.tranches.find((x) => x.trancheType === "bank_line" || x.trancheType === "revolver");
    const termTranche =
      draft.tranches.find(
        (x) =>
          (x.trancheType === "term_loan" || x.trancheType === "term_debt") && x.detectedFromBucket === "long_term"
      ) ?? draft.tranches.find((x) => x.trancheType === "term_loan" || x.trancheType === "term_debt");
    const conv = draft.conventionType;
    const locRoll = locTranche
      ? computeDraftTrancheRollforwardByYear(locTranche, projectionYears, lastHistoricYear, balanceSheet, conv)
      : null;
    const termRoll = termTranche
      ? computeDraftTrancheRollforwardByYear(termTranche, projectionYears, lastHistoricYear, balanceSheet, conv)
      : null;
    const locProj = forecastCols.map((y) => locRoll?.[y]?.ending ?? st);
    const ltdProj = forecastCols.map((y) => termRoll?.[y]?.ending ?? lt);
    const totalProj = forecastCols.map((_, i) => locProj[i]! + ltdProj[i]!);
    return { histY, forecastCols, st, lt, locProj, ltdProj, totalProj };
  }, [stdSetupCommitted, lastHistoricYear, bsOpening, draft.tranches, projectionYears, balanceSheet]);

  const detectionBannerText = useMemo(() => {
    if (bsOpening.found && bsOpening.historicalYearUsed) {
      const u = getUnitLabel(currencyUnit);
      const fmt = (v: number | null) =>
        v != null && Number.isFinite(v)
          ? `${storedToDisplay(v, currencyUnit).toLocaleString(undefined, { maximumFractionDigits: 0 })}${u ? ` ${u}` : ""}`
          : "—";
      return `Historical BS · ${bsOpening.historicalYearUsed} · Short-term: ${fmt(bsOpening.shortTerm)} · Long-term: ${fmt(
        bsOpening.longTerm
      )} · Total: ${fmt(bsOpening.total)}`;
    }
    return "No historical debt found — enter manually";
  }, [bsOpening, currencyUnit]);

  const appliedPreview: DebtScheduleEngineResultV1 | null = useMemo(() => {
    if (!appliedBody) return null;
    return computeDebtScheduleEngine({
      config: appliedBody,
      projectionYears,
      lastHistoricYear,
      balanceSheet,
    });
  }, [appliedBody, projectionYears, lastHistoricYear, balanceSheet]);

  const unitLabel = getUnitLabel(currencyUnit);

  const setDraft = (next: DebtScheduleConfigBodyV1) => {
    setPersist({
      draft: ensureDebtScheduleBodyProjectionYears(next, projectionYears),
      applied: basePersist.applied,
    });
  };

  const applyCurrentPortionSingleTranche = () => {
    const fy = projectionYears[0];
    const ly = projectionYears[projectionYears.length - 1] ?? fy;
    if (!fy) return;
    const st = bsOpening.shortTerm ?? 0;
    const lt = bsOpening.longTerm ?? 0;
    let t = createDefaultDebtTranche(projectionYears, 0);
    t = {
      ...t,
      trancheName: "Bank Term Loan",
      trancheType: "term_loan",
      openingBalanceSource: "manual",
      openingBalanceManual: st + lt,
      detectedFromBucket: "long_term",
      openingDebtBucket: "long_term_funded",
      amortizationMethod: "straight_line",
      repaymentStartYear: fy,
      maturityYear: ly,
    };
    setDraft({ ...cloneDebtScheduleBody(draft), tranches: [t] });
    setOpenTrancheId(t.trancheId);
    setStdSetupCommitted("current_portion");
    setStartHereDismissed(true);
    setStdClassificationPick(null);
    setStdAwaitingUnclearFollowup(false);
  };

  const applyTwoTrancheRevolver = () => {
    const fy = projectionYears[0];
    const ly = projectionYears[projectionYears.length - 1] ?? fy;
    if (!fy) return;
    let t0 = createDefaultDebtTranche(projectionYears, 0);
    t0 = {
      ...t0,
      trancheName: "Revolving Line of Credit",
      trancheType: "bank_line",
      openingBalanceSource: "manual",
      openingBalanceManual: bsOpening.shortTerm ?? 0,
      detectedFromBucket: "short_term",
      openingDebtBucket: "current_funded",
      amortizationMethod: "none",
      repaymentStartYear: fy,
      maturityYear: undefined,
      priority: 1,
    };
    let t1 = createDefaultDebtTranche(projectionYears, 1);
    t1 = {
      ...t1,
      trancheName: "Bank Term Loan",
      trancheType: "term_loan",
      openingBalanceSource: "manual",
      openingBalanceManual: bsOpening.longTerm ?? 0,
      detectedFromBucket: "long_term",
      openingDebtBucket: "long_term_funded",
      amortizationMethod: "straight_line",
      repaymentStartYear: fy,
      maturityYear: ly,
      priority: 2,
    };
    const abl = revolverCapAblSuggestion(balanceSheet, lastHistoricYear, bsOpening.shortTerm, currencyUnit);
    t0 = { ...t0, revolverCapStoredK: abl.capStored > 0 ? abl.capStored : 0 };
    setDraft({ ...cloneDebtScheduleBody(draft), tranches: [t0, t1] });
    setOpenTrancheId(t0.trancheId);
    setStdSetupCommitted("revolver");
    setStartHereDismissed(true);
    setStdClassificationPick(null);
    setStdAwaitingUnclearFollowup(false);
  };

  const applyLtdOnlyTranche = () => {
    const fy = projectionYears[0];
    const ly = projectionYears[projectionYears.length - 1] ?? fy;
    if (!fy) return;
    let t = createDefaultDebtTranche(projectionYears, 0);
    t = {
      ...t,
      trancheName: "Bank Term Loan",
      trancheType: "term_loan",
      openingBalanceSource: "manual",
      openingBalanceManual: bsOpening.longTerm ?? 0,
      detectedFromBucket: "long_term",
      openingDebtBucket: "long_term_funded",
      amortizationMethod: "straight_line",
      repaymentStartYear: fy,
      maturityYear: ly,
    };
    setDraft({ ...cloneDebtScheduleBody(draft), tranches: [t] });
    setOpenTrancheId(t.trancheId);
    setStartHereDismissed(true);
  };

  const applyStdOnlySelection = () => {
    const fy = projectionYears[0];
    const ly = projectionYears[projectionYears.length - 1] ?? fy;
    if (!fy || !stdOnlyPick) return;
    if (stdOnlyPick === "revolver") {
      let t = createDefaultDebtTranche(projectionYears, 0);
      t = {
        ...t,
        trancheName: "Revolving Line of Credit",
        trancheType: "bank_line",
        openingBalanceSource: "manual",
        openingBalanceManual: bsOpening.shortTerm ?? 0,
        detectedFromBucket: "short_term",
        openingDebtBucket: "current_funded",
        amortizationMethod: "none",
        repaymentStartYear: fy,
        maturityYear: undefined,
        priority: 1,
      };
      const abl = revolverCapAblSuggestion(balanceSheet, lastHistoricYear, bsOpening.shortTerm, currencyUnit);
      t = { ...t, revolverCapStoredK: abl.capStored > 0 ? abl.capStored : 0 };
      setDraft({ ...cloneDebtScheduleBody(draft), tranches: [t] });
      setOpenTrancheId(t.trancheId);
    } else if (stdOnlyPick === "st_loan") {
      let t = createDefaultDebtTranche(projectionYears, 0);
      t = {
        ...t,
        trancheName: "Short-term loan",
        trancheType: "term_loan",
        openingBalanceSource: "manual",
        openingBalanceManual: bsOpening.shortTerm ?? 0,
        detectedFromBucket: "short_term",
        openingDebtBucket: "current_funded",
        amortizationMethod: "straight_line",
        repaymentStartYear: fy,
        maturityYear: fy,
      };
      setDraft({ ...cloneDebtScheduleBody(draft), tranches: [t] });
      setOpenTrancheId(t.trancheId);
    } else {
      let t = createDefaultDebtTranche(projectionYears, 0);
      t = {
        ...t,
        trancheName: "Debt facility",
        trancheType: "other",
        openingBalanceSource: "manual",
        openingBalanceManual: 0,
        detectedFromBucket: "manual",
        amortizationMethod: "manual_by_year",
        repaymentStartYear: undefined,
        maturityYear: undefined,
      };
      setDraft({ ...cloneDebtScheduleBody(draft), tranches: [t] });
      setOpenTrancheId(t.trancheId);
    }
    setStartHereDismissed(true);
    setStdOnlyPick(null);
  };

  const onStdClassificationContinue = () => {
    if (!stdClassificationPick) return;
    if (stdClassificationPick === "unclear") {
      setStdAwaitingUnclearFollowup(true);
      return;
    }
    if (stdClassificationPick === "current_portion") applyCurrentPortionSingleTranche();
    else if (stdClassificationPick === "revolver") applyTwoTrancheRevolver();
  };

  const reconfigureStdClassification = () => {
    setStdSetupCommitted(null);
    setStdClassificationPick(null);
    setStdAwaitingUnclearFollowup(false);
    setStdOnlyPick(null);
    setStartHereDismissed(false);
    setOpenTrancheId(null);
    setPersist({
      draft: ensureDebtScheduleBodyProjectionYears(defaultDebtScheduleBody(projectionYears), projectionYears),
      applied: basePersist.applied,
    });
  };

  const onApply = () => {
    const ensured = ensureDebtScheduleBodyProjectionYears(draft, projectionYears);
    const withConvention: DebtScheduleConfigBodyV1 = {
      ...ensured,
      conventionType: ensured.conventionType ?? "mid_year",
    };
    const tranches = withConvention.tranches.map((t) => {
      const ui = maturityUiByTranche[t.trancheId];
      const beyond =
        (t.amortizationMethod ?? "manual_by_year") === "straight_line" &&
        ui != null &&
        ui.withinForecast === false &&
        ui.termYears > 0;
      return applyStraightLineMandatoriesOnTranche(t, projectionYears, lastHistoricYear, balanceSheet, {
        beyondForecastTermYears: beyond ? ui.termYears : undefined,
      });
    });
    const body = {
      ...cloneDebtScheduleBody({ ...withConvention, tranches }),
      conventionType: withConvention.conventionType,
    };
    setPersist({ draft: body, applied: body });
  };

  const onReset = () => {
    if (appliedBody) {
      const b = cloneDebtScheduleBody(ensureDebtScheduleBodyProjectionYears(appliedBody, projectionYears));
      const restored: DebtScheduleConfigBodyV1 = { ...b, conventionType: appliedBody.conventionType };
      setPersist({ draft: restored, applied: appliedBody });
    } else {
      setPersist({
        draft: defaultDebtScheduleBody(projectionYears),
        applied: null,
      });
    }
  };

  const addTranche = () => {
    const next = cloneDebtScheduleBody(draft);
    const i = next.tranches.length;
    const fy = projectionYears[0];
    const ly = projectionYears[projectionYears.length - 1];
    let t = createDefaultDebtTranche(projectionYears, i);
    t = {
      ...t,
      trancheName: i === 0 ? "Bank term loan" : `Debt facility ${i + 1}`,
      trancheType: "term_loan",
      amortizationMethod: "straight_line",
      repaymentStartYear: fy,
      maturityYear: ly,
      openingBalanceSource: "manual",
      openingBalanceManual: 0,
      detectedFromBucket: "manual",
    };
    next.tranches.push(t);
    setDraft(next);
    setOpenTrancheId(t.trancheId);
  };

  const removeTranche = (id: string) => {
    if (draft.tranches.length <= 1) return;
    const next = { ...draft, tranches: draft.tranches.filter((t) => t.trancheId !== id) };
    setDraft(next);
    if (openTrancheId === id) setOpenTrancheId(null);
  };

  const conventionUi: DebtScheduleConventionTypeV1 = draft.conventionType ?? "mid_year";

  const renderRollForwardPreview = (trancheId: string) => {
    if (!appliedPreview || !appliedBody) {
      return (
        <p className="text-[10px] text-slate-500 font-mono mt-2 border-t border-slate-800/80 pt-2">
          Apply the schedule to see the roll-forward.
        </p>
      );
    }
    const flows = appliedPreview.perTrancheByYear[trancheId];
    if (!flows) return null;
    const tranche = appliedBody.tranches.find((t) => t.trancheId === trancheId);
    return (
      <div className="mt-2 border-t border-slate-800/80 pt-2 space-y-2">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Roll-forward preview</p>
        <p className="text-[10px] text-slate-500 leading-snug">
          This shows how the debt balance moves year by year after the schedule is applied.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] font-mono text-slate-300 border-collapse min-w-[520px]">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-800">
                <th className="py-1 pr-2 font-medium">Year</th>
                <th className="py-1 px-1 font-medium text-right">Opening</th>
                <th className="py-1 px-1 font-medium text-right">+ Draws</th>
                <th className="py-1 px-1 font-medium text-right">− Mand.</th>
                <th className="py-1 px-1 font-medium text-right">
                  <span className="inline-flex items-center gap-1">
                    Cash sweep
                    <span className="rounded px-1 py-px text-[8px] font-medium uppercase bg-slate-800 text-slate-500 border border-slate-700">
                      Auto (future)
                    </span>
                  </span>
                </th>
                <th className="py-1 px-1 font-medium text-right">Ending</th>
                <th className="py-1 px-1 font-medium text-right">Average</th>
                <th className="py-1 px-1 font-medium text-right">Rate</th>
                <th className="py-1 px-1 font-medium text-right text-sky-300">Interest</th>
              </tr>
            </thead>
            <tbody>
              {projectionYears.map((y) => {
                const f: DebtTrancheYearFlowV1 = flows[y]!;
                const end = f.endingDebt;
                const isRevolverType =
                  tranche?.trancheType === "bank_line" || tranche?.trancheType === "revolver";
                const my = tranche?.maturityYear;
                const hasExplicitMaturity = my != null && my !== "";
                const isBalloonYear =
                  !isRevolverType && hasExplicitMaturity && my === y;
                const endCls =
                  end != null && end < 0 ? "text-red-400" : isBalloonYear ? "text-amber-300" : "";
                const intMissing = f.interestExpense == null;
                return (
                  <tr key={y} className="border-b border-slate-800/60">
                    <td className="py-1 pr-2 text-slate-400 whitespace-nowrap">{y}</td>
                    <td className="py-1 px-1 text-right tabular-nums">
                      {fmtMoneyStored(f.beginningDebt, currencyUnit, true)}
                    </td>
                    <td className="py-1 px-1 text-right tabular-nums">
                      {fmtMoneyStored(f.newBorrowingDraws, currencyUnit, true)}
                    </td>
                    <td className="py-1 px-1 text-right tabular-nums">
                      {fmtMoneyStored(-f.mandatoryRepayment, currencyUnit, true)}
                    </td>
                    <td
                      className="py-1 px-1 text-right tabular-nums text-slate-600"
                      title="Cash sweep will be calculated automatically once cash flow projections are connected."
                    >
                      —
                    </td>
                    <td className={`py-1 px-1 text-right tabular-nums ${endCls}`}>
                      {fmtMoneyStored(end, currencyUnit, true)}
                    </td>
                    <td className="py-1 px-1 text-right tabular-nums">
                      {fmtMoneyStored(f.averageBalance, currencyUnit, false)}
                    </td>
                    <td className="py-1 px-1 text-right tabular-nums">{fmtRatePct(f.nominalRate)}</td>
                    <td className="py-1 px-1 text-right tabular-nums text-sky-300">
                      {intMissing ? "—" : fmtMoneyStored(f.interestExpense, currencyUnit, false)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(() => {
          const lastY = projectionYears[projectionYears.length - 1];
          if (!lastY || !tranche?.maturityYear) return null;
          const mn = parseInt(tranche.maturityYear, 10);
          const ln = parseInt(lastY, 10);
          const endBal = flows[lastY]?.endingDebt;
          if (endBal == null || !Number.isFinite(endBal) || !Number.isFinite(mn) || !Number.isFinite(ln) || mn <= ln) {
            return null;
          }
          return (
            <p className="text-slate-500 italic text-[10px] mt-1">
              Remaining balance at end of forecast: {fmtBooksAmount(endBal, currencyUnit)} (debt matures{" "}
              {tranche.maturityYear})
            </p>
          );
        })()}
        <div className="space-y-0.5 text-[10px] text-amber-200/90">
          {projectionYears.some((y) => {
            const e = flows[y]?.endingDebt;
            return e != null && e < 0;
          })
            ? <p>Warning: negative ending balance in one or more years.</p>
            : null}
          {projectionYears.some((y) => flows[y]?.nominalRate == null)
            ? <p>Warning: missing interest rate for one or more years.</p>
            : null}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-sky-900/40 bg-sky-950/15 overflow-hidden">
      <button
        type="button"
        onClick={() => setSummaryOpen((o) => !o)}
        className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/20"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-sky-100">Debt schedule</span>
            {hasApplied ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
                ✓ Active
              </span>
            ) : appliedBody == null ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-amber-950/40 text-amber-300 border border-amber-700/40">
                Not saved
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-amber-950/40 text-amber-300 border border-amber-700/40">
                Unsaved changes
              </span>
            )}
          </div>
          <div className="text-[10px] text-sky-200/80 mt-0.5 leading-snug">
            {hasApplied
              ? `${draft.tranches.filter((t) => t.isEnabled).length} tranche(s) active — interest expense flowing into model.`
              : "Map your debt facilities, then confirm to drive interest in the model."}
          </div>
        </div>
        <span className="text-slate-500 text-xs shrink-0">{summaryOpen ? "▼" : "▶"}</span>
      </button>
      {summaryOpen ? (
        <div className="px-3 pb-3 pt-0 border-t border-sky-900/30 space-y-3 text-[11px] text-slate-300">
          <p className="text-[10px] text-slate-600 font-mono">schedule id: {DEBT_SCHEDULE_PHASE2_ID}</p>

          <div className="rounded-md border border-slate-700/60 bg-slate-900/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setArchDocOpen((o) => !o)}
              className="w-full text-left px-2.5 py-2 flex justify-between items-center gap-2 hover:bg-slate-800/30"
            >
              <span className="text-[11px] font-medium text-slate-200">How debt and interest work here</span>
              <span className="text-slate-500 text-xs">{archDocOpen ? "▼" : "▶"}</span>
            </button>
            {archDocOpen ? (
              <div className="px-2.5 pb-2.5 pt-0 text-[10px] text-slate-400 space-y-1.5 border-t border-slate-800/80 leading-relaxed">
                <p>Interest expense is derived from this debt schedule.</p>
                <p>Automatic cash-sweep and revolver logic are not active in this version.</p>
                <p>
                  Once cash flow projections are connected, excess cash can later be used to repay debt automatically.
                </p>
                <p>More advanced circularity handling will be added in a future update.</p>
              </div>
            ) : null}
          </div>

          <div className="rounded-md border border-slate-700/80 bg-slate-900/50 px-2.5 py-2">
            <p className="text-[11px] text-slate-200 leading-snug font-mono">{detectionBannerText}</p>
          </div>

          <div className="rounded-md border border-slate-700/80 bg-slate-900/40 px-2.5 py-2 space-y-1">
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Interest calculation</label>
            <select
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 max-w-xs"
              value={conventionUi}
              onChange={(e) =>
                setDraft(patchConvention(draft, e.target.value as DebtScheduleConventionTypeV1))
              }
            >
              <option value="mid_year">Mid-year (recommended) — average balance</option>
              <option value="full_year">Full-year — ending balance</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 w-full">
            {hasApplied ? (
              <>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded px-2 py-0.5 bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
                  ✓ Debt schedule active — interest expense flowing into model
                </span>
                <button
                  type="button"
                  onClick={() => setSummaryOpen(true)}
                  className="rounded border border-slate-600 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={reconfigureStdClassification}
                  className="rounded border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-300"
                >
                  Reset
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => { onApply(); setSummaryOpen(false); }}
                  disabled={draft.tranches.filter((t) => t.isEnabled).length === 0}
                  className="flex-1 rounded px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {draft.tranches.filter((t) => t.isEnabled).length === 0
                    ? "Add at least one tranche above first"
                    : "✓ Confirm & Activate Debt Schedule"}
                </button>
                <span className="text-[10px] text-slate-500 self-center">
                  {appliedBody == null ? "Not saved yet" : "Unsaved changes — confirm to save"}
                </span>
                <button
                  type="button"
                  onClick={reconfigureStdClassification}
                  className="rounded border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-300 ml-auto"
                >
                  Reset
                </button>
              </>
            )}
          </div>

          {!startHereDismissed && stdSetupCommitted === null && draft.tranches.length === 0 ? (
            <div className="rounded-md border border-emerald-900/40 bg-emerald-950/20 px-2.5 py-2.5 space-y-2">
              <p className="text-[11px] font-semibold text-emerald-100/95">Start here</p>
              {bsOpening.found && (hasStdDebt || hasLtdDebt) ? (
                hasLtdDebt && hasStdDebt ? (
                  stdAwaitingUnclearFollowup ? (
                    <div className="space-y-3">
                      <button
                        type="button"
                        className="text-[10px] text-slate-400 underline hover:text-slate-200"
                        onClick={() => setStdAwaitingUnclearFollowup(false)}
                      >
                        ← Back to choices
                      </button>
                      {stdRatioHint?.suggest === "current_portion" ? (
                        <>
                          <div className="rounded-lg border-2 border-sky-600/40 bg-sky-950/25 p-3 space-y-2">
                            <p className="text-[11px] text-sky-100 leading-relaxed">
                              Based on the numbers, we think this is most likely the current portion of your term loan.
                              We&apos;ll set it up that way — you can change this if your accountant confirms otherwise.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={applyCurrentPortionSingleTranche}
                              className="rounded-md bg-emerald-800/90 px-2.5 py-1.5 text-[11px] font-medium text-emerald-50 hover:bg-emerald-700"
                            >
                              Use recommended setup
                            </button>
                            <button
                              type="button"
                              onClick={applyTwoTrancheRevolver}
                              className="rounded-md border border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800/80"
                            >
                              It&apos;s actually a revolver
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-[11px] text-slate-300 leading-relaxed">
                            We&apos;re not certain — please check your loan documents or ask your accountant.
                            Here&apos;s what each option means for your model:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={applyCurrentPortionSingleTranche}
                              className="rounded-md bg-emerald-800/90 px-2.5 py-1.5 text-[11px] font-medium text-emerald-50 hover:bg-emerald-700"
                            >
                              Set up as current portion
                            </button>
                            <button
                              type="button"
                              onClick={applyTwoTrancheRevolver}
                              className="rounded-md border border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800/80"
                            >
                              Set up as revolver
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-semibold text-emerald-50">First, let&apos;s identify your short-term debt</p>
                        <p className="text-[11px] text-slate-300 leading-relaxed mt-1">
                          Your {booksYearLabel} balance sheet shows {fmtBooksAmount(bsOpening.shortTerm, currencyUnit)} in
                          short-term debt and {fmtBooksAmount(bsOpening.longTerm, currencyUnit)} in long-term debt. Before we
                          set up the schedule, we need to understand what the short-term debt is.
                        </p>
                      </div>
                      <div className="space-y-2">
                        {(
                          [
                            {
                              id: "current_portion" as const,
                              icon: "🔄",
                              title: "It's part of my term loan (current portion)",
                              desc: "The bank reclassifies a portion of my long-term loan as 'current' each year as it comes due. The short-term balance is NOT a separate facility — it's just the next year's payment on my term loan.",
                              tag: "Most common for companies with only one bank loan",
                            },
                            {
                              id: "revolver" as const,
                              icon: "💳",
                              title: "It's a separate revolving line of credit (LOC)",
                              desc: "I have a separate bank line that I can draw on and repay. The short-term balance is what I currently owe on that line, separate from my long-term loan.",
                              tag: "Common when company has both a line of credit AND a term loan",
                            },
                            {
                              id: "unclear" as const,
                              icon: "❓",
                              title: "I'm not sure",
                              desc: "I don't know whether this is a current portion of my term loan or a separate facility.",
                              tag: "We'll make an intelligent recommendation",
                            },
                          ] as const
                        ).map((opt) => (
                          <label
                            key={opt.id}
                            className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors ${
                              stdClassificationPick === opt.id
                                ? "border-sky-500/70 bg-sky-950/30"
                                : "border-slate-700/80 bg-slate-900/50 hover:border-slate-600"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <input
                                type="radio"
                                name="std-classification"
                                className="mt-0.5 accent-sky-600"
                                checked={stdClassificationPick === opt.id}
                                onChange={() => setStdClassificationPick(opt.id)}
                              />
                              <div className="min-w-0 flex-1">
                                <span className="text-base leading-none">{opt.icon}</span>
                                <p className="text-[12px] font-semibold text-slate-100 mt-1">{opt.title}</p>
                                <p className="text-[10px] text-slate-400 leading-snug mt-0.5">{opt.desc}</p>
                                <p className="text-[9px] text-slate-500 italic mt-1">{opt.tag}</p>
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                      {stdRatioHint ? (
                        <div className="border border-sky-800/30 bg-sky-950/15 text-sky-300 text-[11px] rounded p-3">
                          <p>
                            💡 Our best guess: {stdRatioHint.reason}
                          </p>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={!stdClassificationPick}
                          onClick={onStdClassificationContinue}
                          className="rounded-md bg-emerald-800/90 px-3 py-1.5 text-[11px] font-medium text-emerald-50 hover:bg-emerald-700 disabled:opacity-40"
                        >
                          Continue →
                        </button>
                        <button
                          type="button"
                          onClick={() => setStartHereDismissed(true)}
                          className="rounded-md border border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800/80"
                        >
                          Set up manually
                        </button>
                      </div>
                    </div>
                  )
                ) : hasLtdDebt && !hasStdDebt ? (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      We detected long-term debt only ({fmtBooksAmount(bsOpening.longTerm, currencyUnit)}). Add a term loan
                      from that balance, or set up manually.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={applyLtdOnlyTranche}
                        className="rounded-md bg-emerald-800/90 px-2.5 py-1.5 text-[11px] font-medium text-emerald-50 hover:bg-emerald-700"
                      >
                        Add term loan from long-term debt
                      </button>
                      <button
                        type="button"
                        onClick={() => setStartHereDismissed(true)}
                        className="rounded-md border border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800/80"
                      >
                        Set up manually
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Your balance sheet shows {fmtBooksAmount(bsOpening.shortTerm, currencyUnit)} in short-term debt but no
                      long-term debt. What is this?
                    </p>
                    <div className="space-y-2">
                      {(
                        [
                          { id: "revolver" as const, label: "A revolving line of credit" },
                          { id: "st_loan" as const, label: "A short-term loan or note payable" },
                          { id: "other" as const, label: "Other" },
                        ] as const
                      ).map((o) => (
                        <label
                          key={o.id}
                          className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-[11px] ${
                            stdOnlyPick === o.id ? "border-sky-500/60 bg-sky-950/25" : "border-slate-700 bg-slate-900/40"
                          }`}
                        >
                          <input
                            type="radio"
                            name="std-only"
                            className="accent-sky-600"
                            checked={stdOnlyPick === o.id}
                            onChange={() => setStdOnlyPick(o.id)}
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!stdOnlyPick}
                        onClick={applyStdOnlySelection}
                        className="rounded-md bg-emerald-800/90 px-2.5 py-1.5 text-[11px] font-medium text-emerald-50 hover:bg-emerald-700 disabled:opacity-40"
                      >
                        Continue →
                      </button>
                      <button
                        type="button"
                        onClick={() => setStartHereDismissed(true)}
                        className="rounded-md border border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800/80"
                      >
                        Set up manually
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    No historical debt found. You can add a debt facility manually if needed.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      addTranche();
                      setStartHereDismissed(true);
                    }}
                    className="rounded-md bg-emerald-800/90 px-2.5 py-1.5 text-[11px] font-medium text-emerald-50 hover:bg-emerald-700"
                  >
                    Add first facility
                  </button>
                </>
              )}
            </div>
          ) : null}

          {startHereDismissed && stdSetupCommitted ? (
            <div className="rounded-md border border-emerald-800/40 bg-emerald-950/15 px-2.5 py-2 space-y-1">
              {stdSetupCommitted === "current_portion" ? (
                <div className="text-[11px] text-emerald-100/95 leading-relaxed space-y-1.5">
                  <p>
                    ✓ Short-term debt is the current portion of your term loan. Combined into one facility:{" "}
                    {fmtBooksAmount((bsOpening.shortTerm ?? 0) + (bsOpening.longTerm ?? 0), currencyUnit)} opening balance.
                  </p>
                  {currentPortionBsPreview && currentPortionBsPreview.annual > 0 ? (
                    <p>
                      Each year, the next payment ({fmtBooksAmount(currentPortionBsPreview.annual, currencyUnit)}) shows as
                      short-term debt on your Balance Sheet. The rest stays as long-term debt. This is how IB models handle
                      this — no separate LOC.
                    </p>
                  ) : (
                    <p>This is how IB models handle this — no separate LOC.</p>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-emerald-100/95 leading-relaxed">
                  ✓ Two separate facilities: revolving line ({fmtBooksAmount(bsOpening.shortTerm, currencyUnit)}) + term loan (
                  {fmtBooksAmount(bsOpening.longTerm, currencyUnit)}).
                </p>
              )}
              <p className="text-[10px] text-slate-500">
                To change the debt structure, click <span className="text-slate-400 font-medium">Reset</span> above.
              </p>
            </div>
          ) : null}

          {currentPortionBsPreview ? (
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-2">
              <p className="text-[11px] font-semibold text-slate-200">How this appears on your Balance Sheet</p>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] text-slate-300 border-collapse min-w-[320px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-slate-500">
                      <th className="py-1 pr-2 font-medium"> </th>
                      <th className="py-1 px-1 font-medium text-right tabular-nums">{currentPortionBsPreview.histY}</th>
                      {currentPortionBsPreview.forecastCols.map((y) => (
                        <th key={y} className="py-1 px-1 font-medium text-right tabular-nums whitespace-nowrap">
                          {y}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-2 text-slate-400">Short-term debt (current portion)</td>
                      <td className="py-1 px-1 text-right font-mono tabular-nums">
                        {fmtMoneyStored(currentPortionBsPreview.st, currencyUnit, true)}
                      </td>
                      {currentPortionBsPreview.stdProj.map((v, i) => (
                        <td key={currentPortionBsPreview.forecastCols[i]} className="py-1 px-1 text-right font-mono tabular-nums">
                          {fmtMoneyStored(v, currencyUnit, true)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-2 text-slate-400">Long-term debt</td>
                      <td className="py-1 px-1 text-right font-mono tabular-nums">
                        {fmtMoneyStored(currentPortionBsPreview.lt, currencyUnit, true)}
                      </td>
                      {currentPortionBsPreview.ltdProj.map((v, i) => (
                        <td key={currentPortionBsPreview.forecastCols[i]} className="py-1 px-1 text-right font-mono tabular-nums">
                          {fmtMoneyStored(v, currencyUnit, true)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-2 text-slate-200 font-medium">Total funded debt</td>
                      <td className="py-1 px-1 text-right font-mono tabular-nums font-medium">
                        {fmtMoneyStored(currentPortionBsPreview.st + currentPortionBsPreview.lt, currencyUnit, true)}
                      </td>
                      {currentPortionBsPreview.stdProj.map((v, i) => (
                        <td
                          key={`t-${currentPortionBsPreview.forecastCols[i]}`}
                          className="py-1 px-1 text-right font-mono tabular-nums font-medium"
                        >
                          {fmtMoneyStored(v + currentPortionBsPreview.ltdProj[i]!, currencyUnit, true)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500 italic mt-2">
                Short-term debt shows the next 12 months of principal payments (current portion). Long-term debt is the
                remaining balance beyond that. This reclassification happens automatically each year.
              </p>
            </div>
          ) : null}

          {revolverBsPreview ? (
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-2">
              <p className="text-[11px] font-semibold text-slate-200">How this appears on your Balance Sheet</p>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] text-slate-300 border-collapse min-w-[320px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-slate-500">
                      <th className="py-1 pr-2 font-medium"> </th>
                      <th className="py-1 px-1 font-medium text-right tabular-nums">{revolverBsPreview.histY}</th>
                      {revolverBsPreview.forecastCols.map((y) => (
                        <th key={y} className="py-1 px-1 font-medium text-right tabular-nums whitespace-nowrap">
                          {y}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-2 text-slate-400">Revolving line of credit (LOC)</td>
                      <td className="py-1 px-1 text-right font-mono tabular-nums">
                        {fmtMoneyStored(revolverBsPreview.st, currencyUnit, true)}
                      </td>
                      {revolverBsPreview.locProj.map((v, i) => (
                        <td key={revolverBsPreview.forecastCols[i]} className="py-1 px-1 text-right font-mono tabular-nums">
                          {fmtMoneyStored(v, currencyUnit, true)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-2 text-slate-400">Long-term debt</td>
                      <td className="py-1 px-1 text-right font-mono tabular-nums">
                        {fmtMoneyStored(revolverBsPreview.lt, currencyUnit, true)}
                      </td>
                      {revolverBsPreview.ltdProj.map((v, i) => (
                        <td key={revolverBsPreview.forecastCols[i]} className="py-1 px-1 text-right font-mono tabular-nums">
                          {fmtMoneyStored(v, currencyUnit, true)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-800/60">
                      <td className="py-1 pr-2 text-slate-200 font-medium">Total funded debt</td>
                      <td className="py-1 px-1 text-right font-mono tabular-nums font-medium">
                        {fmtMoneyStored(revolverBsPreview.st + revolverBsPreview.lt, currencyUnit, true)}
                      </td>
                      {revolverBsPreview.totalProj.map((v, i) => (
                        <td
                          key={`rv-t-${revolverBsPreview.forecastCols[i]}`}
                          className="py-1 px-1 text-right font-mono tabular-nums font-medium"
                        >
                          {fmtMoneyStored(v, currencyUnit, true)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500 italic mt-2">
                Revolving line stays roughly flat until the cash sweep step automatically draws/repays based on available
                cash. Long-term debt reduces by scheduled principal payments.
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
              const openingUsed = resolveTrancheOpeningBalance(t, lastHistoricYear, balanceSheet);
              const openingSelect = inferOpeningSelectValue(t);
              const rateMethodUi = t.interestRateMethod ?? "fixed_rate";
              const rateHeader =
                rateMethodUi === "fixed_rate"
                  ? `${t.fixedInterestRatePct ?? "—"}%`
                  : "By year";
              const amort: AmortizationMethodV1 = t.amortizationMethod ?? "manual_by_year";
              const mUi = maturityUiByTranche[t.trancheId] ?? { withinForecast: true, termYears: 10 };
              const estStraightYears =
                t.repaymentStartYear && t.maturityYear && mUi.withinForecast
                  ? projectionYears.filter((yy) => yy >= t.repaymentStartYear! && yy <= t.maturityYear!)
                  : [];
              const estAnnualPrincipal =
                amort === "straight_line" && openingUsed != null
                  ? !mUi.withinForecast && mUi.termYears > 0
                    ? openingUsed / mUi.termYears
                    : estStraightYears.length > 0
                      ? openingUsed / estStraightYears.length
                      : null
                  : null;
              const hasLegacyType = t.trancheType === "revolver" || t.trancheType === "term_debt";
              const stDetected = (bsOpening.shortTerm ?? 0) > 0;
              const ltDetected = (bsOpening.longTerm ?? 0) > 0;
              const isHistoricalOpening = t.openingBalanceSource === "historical";
              const isCurrentPortionLocked =
                stdSetupCommitted === "current_portion" &&
                isCombinedCurrentPortionTranche(t, bsOpening.shortTerm, bsOpening.longTerm);
              const repaymentHint = getDebtScheduleRepaymentStyleHint(t.trancheType);
              const openingHelperLine =
                openingSelect === "historical"
                  ? "Allocated as a share of detected total funded debt on the balance sheet."
                  : openingSelect === "detected_st"
                    ? "Usually debt due within the next 12 months."
                    : openingSelect === "detected_lt"
                      ? "Usually debt repaid over multiple years."
                      : openingSelect === "legacy_all_funded"
                        ? "Uses the combined funded-debt total from your historical balance sheet (legacy)."
                        : "Use this if the schedule should start from a different balance.";
              const stBucketBlocked =
                bucketBlockers.shortTermOwnerId != null && bucketBlockers.shortTermOwnerId !== t.trancheId;
              const ltBucketBlocked =
                bucketBlockers.longTermOwnerId != null && bucketBlockers.longTermOwnerId !== t.trancheId;
              const isRevolverUi = t.trancheType === "bank_line" || t.trancheType === "revolver";
              const revolverCapAbl = revolverCapAblSuggestion(
                balanceSheet,
                lastHistoricYear,
                resolveTrancheOpeningBalance(t, lastHistoricYear, balanceSheet) ?? bsOpening.shortTerm,
                currencyUnit
              );
              const revolverCapKValue =
                t.revolverCapStoredK != null && t.revolverCapStoredK > 0
                  ? storedToDisplay(t.revolverCapStoredK, currencyUnit) / 1000
                  : revolverCapAbl.capK;

              return (
                <div key={t.trancheId} className="rounded-lg border border-slate-700 bg-slate-950/40 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenTrancheId(open ? null : t.trancheId)}
                    className="w-full text-left px-2.5 py-2 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-800/20"
                  >
                    <div className="min-w-0 flex flex-wrap items-center gap-2">
                      <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-sky-900/50 text-sky-200 border border-sky-800/60 max-w-[11rem] truncate">
                        {facilityTypePlainLabel(t.trancheType)}
                      </span>
                      <span className="text-xs font-medium text-slate-100">{t.trancheName || "Untitled tranche"}</span>
                      <span className="text-[10px] font-mono text-slate-400">
                        Opening {openingUsed != null ? storedToDisplay(openingUsed, currencyUnit).toLocaleString() : "—"}
                        {unitLabel ? ` ${unitLabel}` : ""}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">· {rateHeader}</span>
                      {!t.isEnabled ? <span className="text-[10px] text-slate-600">· disabled</span> : null}
                    </div>
                    <span className="text-slate-500 text-xs">{open ? "▼" : "▶"}</span>
                  </button>
                  {open ? (
                    <div className="px-2.5 pb-2.5 pt-0 border-t border-slate-800/80 space-y-3">
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide pt-2">Identity</p>
                      <p className="text-[11px] text-slate-300">What kind of debt is this?</p>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">Facility name</label>
                          <input
                            className="w-full max-w-md rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
                            value={t.trancheName}
                            onChange={(e) => setDraft(patchTranche(draft, t.trancheId, { trancheName: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">Facility type</label>
                          <select
                            className="w-full max-w-md rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
                            value={t.trancheType}
                            onChange={(e) => {
                              const tt = e.target.value as DebtTrancheTypeV1;
                              const patch: Partial<DebtTrancheConfigV1> = { trancheType: tt };
                              if (tt === "bank_line" || tt === "revolver") {
                                patch.maturityYear = undefined;
                              }
                              setDraft(patchTranche(draft, t.trancheId, patch));
                            }}
                          >
                            <option value="bank_line">{facilityTypePlainLabel("bank_line")}</option>
                            <option value="term_loan">{facilityTypePlainLabel("term_loan")}</option>
                            <option value="mortgage">{facilityTypePlainLabel("mortgage")}</option>
                            <option value="shareholder_loan">{facilityTypePlainLabel("shareholder_loan")}</option>
                            <option value="other">{facilityTypePlainLabel("other")}</option>
                            {hasLegacyType ? (
                              <>
                                <option value="revolver">{facilityTypePlainLabel("revolver")}</option>
                                <option value="term_debt">{facilityTypePlainLabel("term_debt")}</option>
                              </>
                            ) : null}
                          </select>
                          {t.trancheType === "bank_line" || t.trancheType === "revolver" ? (
                            <p className="text-[9px] text-slate-600 mt-1">
                              Typically used for short-term working capital needs.
                            </p>
                          ) : null}
                          {t.trancheType === "term_loan" || t.trancheType === "term_debt" ? (
                            <p className="text-[9px] text-slate-600 mt-1">Typically repaid over several years.</p>
                          ) : null}
                          {t.trancheType === "shareholder_loan" ? (
                            <p className="text-[9px] text-slate-600 mt-1">
                              Often owner-funded and may carry a below-market or 0% rate.
                            </p>
                          ) : null}
                          {repaymentHint ? <p className="text-[9px] text-slate-500 mt-1 italic">{repaymentHint}</p> : null}
                        </div>
                        <label className="flex items-center gap-2 text-[11px] text-slate-300">
                          <input
                            type="checkbox"
                            checked={t.isEnabled}
                            onChange={(e) =>
                              setDraft(patchTranche(draft, t.trancheId, { isEnabled: e.target.checked }))
                            }
                          />
                          Include in model
                        </label>
                        <div>
                          <label
                            className="block text-[10px] text-slate-600 mb-0.5"
                            title="Lower number = repaid first once cash-sweep logic is added later."
                          >
                            Priority <span className="text-slate-500">(optional)</span>
                          </label>
                          <input
                            type="number"
                            className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                            value={t.priority ?? ""}
                            placeholder="—"
                            title="Lower number = repaid first once cash-sweep logic is added later."
                            onChange={(e) => {
                              const n = parseInt(e.target.value, 10);
                              setDraft(
                                patchTranche(draft, t.trancheId, {
                                  priority: Number.isFinite(n) ? n : undefined,
                                })
                              );
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          disabled={draft.tranches.length <= 1}
                          onClick={() => removeTranche(t.trancheId)}
                          className="text-[10px] text-red-300/90 hover:text-red-200 disabled:opacity-30"
                        >
                          Remove facility
                        </button>
                      </div>

                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Opening balance</p>
                      {isCurrentPortionLocked ? (
                        <div className="space-y-1.5">
                          <div className="bg-slate-900/40 border border-slate-700 rounded px-3 py-2">
                            <div className="flex items-start gap-1.5 text-[11px] text-slate-200">
                              <Lock className="shrink-0 mt-0.5" size={12} aria-hidden />
                              <span>
                                Opening balance:{" "}
                                {fmtBooksAmount((bsOpening.shortTerm ?? 0) + (bsOpening.longTerm ?? 0), currencyUnit)} (short-term{" "}
                                {fmtBooksAmount(bsOpening.shortTerm, currencyUnit)} + long-term{" "}
                                {fmtBooksAmount(bsOpening.longTerm, currencyUnit)} combined)
                              </span>
                            </div>
                          </div>
                          <p className="text-[10px] text-slate-500">
                            This combines both your short-term and long-term debt into one facility. To change this, click <span className="font-medium text-slate-400">Reset</span> above.
                          </p>
                        </div>
                      ) : isHistoricalOpening ? (
                        <div className="space-y-1.5">
                          <p className="text-[11px] text-slate-300">Opening from historical allocation</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] text-slate-500">Allocation % of BS total</span>
                            <input
                              type="number"
                              step={0.1}
                              className="w-20 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 font-mono"
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
                          <p className="text-[9px] text-slate-500 mt-1">{openingHelperLine}</p>
                          {!histDebtOk ? (
                            <p className="text-[9px] text-amber-200/80">
                              Need resolvable total funded debt for the last historical year.
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          <select
                            className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 w-full max-w-xl"
                            value={openingSelect}
                            onChange={(e) =>
                              setDraft(
                                applyOpeningSelect(draft, t.trancheId, e.target.value as OpeningSelectValue, bsOpening)
                              )
                            }
                          >
                            {stDetected ? (
                              <option
                                value="detected_st"
                                disabled={stBucketBlocked}
                                title={
                                  stBucketBlocked
                                    ? `Already assigned to ${bucketBlockers.shortTermOwnerName}`
                                    : undefined
                                }
                              >
                                Use short-term debt from your {booksYearLabel} books (
                                {fmtBooksAmount(bsOpening.shortTerm, currencyUnit)})
                              </option>
                            ) : null}
                            {ltDetected ? (
                              <option
                                value="detected_lt"
                                disabled={ltBucketBlocked}
                                title={
                                  ltBucketBlocked
                                    ? `Already assigned to ${bucketBlockers.longTermOwnerName}`
                                    : undefined
                                }
                              >
                                Use long-term debt from your {booksYearLabel} books (
                                {fmtBooksAmount(bsOpening.longTerm, currencyUnit)})
                              </option>
                            ) : null}
                            <option value="manual">Enter opening balance manually</option>
                            {openingSelect === "legacy_all_funded" ? (
                              <option value="legacy_all_funded">All funded debt from detection (legacy)</option>
                            ) : null}
                            {openingSelect === "detected_st" && !stDetected ? (
                              <option value="detected_st" disabled>
                                Saved short-term opening (not currently detected — pick another option)
                              </option>
                            ) : null}
                            {openingSelect === "detected_lt" && !ltDetected ? (
                              <option value="detected_lt" disabled>
                                Saved long-term opening (not currently detected — pick another option)
                              </option>
                            ) : null}
                          </select>
                          <p className="text-[9px] text-slate-500 mt-1">{openingHelperLine}</p>
                          {openingSelect === "manual" ||
                          openingSelect === "detected_st" ||
                          openingSelect === "detected_lt" ? (
                            <div className="mt-1 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] text-slate-500 inline-flex items-center gap-1">
                                  {(openingSelect === "detected_st" || openingSelect === "detected_lt") && (
                                    <Lock className="shrink-0 opacity-70" size={12} aria-hidden />
                                  )}
                                  Opening amount {unitLabel ? `(${unitLabel})` : ""}
                                </span>
                                <input
                                  type="number"
                                  step={0.01}
                                  readOnly={openingSelect === "detected_st" || openingSelect === "detected_lt"}
                                  disabled={openingSelect === "detected_st" || openingSelect === "detected_lt"}
                                  className={`w-32 rounded border px-2 py-1 text-xs font-mono ${
                                    openingSelect === "detected_st" || openingSelect === "detected_lt"
                                      ? "bg-slate-900/60 text-slate-400 cursor-not-allowed border-slate-700/50"
                                      : "border-slate-600 bg-slate-800 text-slate-200"
                                  }`}
                                  value={
                                    t.openingBalanceManual != null
                                      ? storedToDisplay(t.openingBalanceManual, currencyUnit)
                                      : ""
                                  }
                                  onChange={(e) => {
                                    const n = parseFloat(e.target.value);
                                    setDraft(
                                      patchTranche(draft, t.trancheId, {
                                        openingBalanceManual: Number.isFinite(n) ? displayToStored(n, currencyUnit) : 0,
                                      })
                                    );
                                  }}
                                />
                              </div>
                              {(openingSelect === "detected_st" || openingSelect === "detected_lt") && (
                                <p className="text-[9px] text-slate-500 leading-snug">
                                  Locked to your {booksYearLabel} balance sheet value. Switch to &quot;Enter opening balance
                                  manually&quot; above to override.
                                </p>
                              )}
                            </div>
                          ) : null}
                        </>
                      )}
                      <p className="text-[10px] text-slate-300 font-mono mt-1">
                        Opening balance used in this schedule:{" "}
                        {openingUsed != null
                          ? `${storedToDisplay(openingUsed, currencyUnit).toLocaleString(undefined, { maximumFractionDigits: 2 })}${unitLabel ? ` ${unitLabel}` : ""}`
                          : "—"}
                      </p>
                      {isCombinedCurrentPortionTranche(t, bsOpening.shortTerm, bsOpening.longTerm) && !isCurrentPortionLocked ? (
                        <p className="text-[10px] text-sky-200/90 border border-sky-900/40 rounded-md bg-sky-950/20 px-2 py-1.5 leading-snug">
                          Opening balance includes the current portion ({fmtBooksAmount(bsOpening.shortTerm, currencyUnit)})
                          + long-term portion ({fmtBooksAmount(bsOpening.longTerm, currencyUnit)}) ={" "}
                          {fmtBooksAmount((bsOpening.shortTerm ?? 0) + (bsOpening.longTerm ?? 0), currencyUnit)} total. The
                          Year 1 mandatory repayment will include the current portion naturally.
                        </p>
                      ) : null}

                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">C — Interest</p>
                      <div
                        id={`debt-interest-rate-${t.trancheId}`}
                        className="grid grid-cols-1 sm:grid-cols-2 gap-2 scroll-mt-24"
                      >
                        <div>
                          <label className="block text-[10px] uppercase text-slate-500 mb-0.5">Rate method</label>
                          <select
                            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 w-full"
                            value={rateMethodUi}
                            onChange={(e) =>
                              setDraft(
                                patchTranche(draft, t.trancheId, {
                                  interestRateMethod: e.target.value as InterestRateMethodV1,
                                })
                              )
                            }
                          >
                            <option value="fixed_rate">Fixed rate (same every year)</option>
                            <option value="manual_by_year">Custom rate by year</option>
                          </select>
                          {rateMethodUi === "fixed_rate" ? (
                            <div className="mt-1 space-y-1">
                              <div className="flex items-center gap-1 flex-wrap">
                                <input
                                  type="number"
                                  step={0.01}
                                  className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 font-mono"
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
                                <span className="text-[10px] text-slate-500">% nominal / yr</span>
                              </div>
                              <p className="text-[10px] text-slate-500 italic">{fixedRateContextHint(t.trancheType)}</p>
                              {(() => {
                                const implied = impliedFixedRatePctByTrancheId[t.trancheId];
                                if (implied == null) return null;
                                return (
                                  <div className="border border-sky-800/30 bg-sky-950/20 rounded px-2 py-1.5 text-[11px] text-sky-300 space-y-1">
                                    <p>
                                      💡 Based on your historical interest expense and debt balance, your implied rate is
                                      approximately {implied.toFixed(1)}%.
                                    </p>
                                    <button
                                      type="button"
                                      className="text-[10px] font-medium text-sky-200 underline decoration-sky-600/80 hover:text-sky-100"
                                      onClick={() =>
                                        setDraft(
                                          patchTranche(draft, t.trancheId, { fixedInterestRatePct: implied })
                                        )
                                      }
                                    >
                                      Use this rate
                                    </button>
                                  </div>
                                );
                              })()}
                            </div>
                          ) : (
                            <p className="text-[10px] text-slate-500 italic mt-1">
                              Use this if your rate changes year to year.
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase text-slate-500 mb-0.5">Interest basis (detail)</label>
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
                            <option value="average_balance">Average (recommended with mid-year convention)</option>
                            <option value="ending_balance">Ending</option>
                          </select>
                          <p className="text-[9px] text-slate-600 mt-0.5">
                            Global convention above overrides this for interest expense when set.
                          </p>
                        </div>
                      </div>

                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Repayment</p>
                      {isRevolverUi ? (
                        <div className="space-y-3 rounded-md border border-slate-700/80 bg-slate-900/40 p-2.5">
                          <p className="text-[11px] font-semibold text-slate-200">How this revolving line works in your model</p>
                          <div className="space-y-2 border-b border-slate-800/80 pb-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[10px] font-medium text-slate-200">Phase 1 (now): Interest-only</p>
                                <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
                                  The line balance stays at {fmtBooksAmount(openingUsed, currencyUnit)}. Interest accrues on
                                  the outstanding balance. No automatic draws or repayments yet.
                                </p>
                              </div>
                              <span className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                                Active
                              </span>
                            </div>
                          </div>
                          <div className="space-y-2 border-b border-slate-800/80 pb-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[10px] font-medium text-slate-200">
                                  Phase 2 (cash sweep, coming soon): Auto-draw &amp; repay
                                </p>
                                <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
                                  Once your Income Statement and Cash Flow are complete, this line will automatically draw
                                  when cash runs short and repay when cash is available.
                                </p>
                              </div>
                              <span className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase bg-amber-950/80 text-amber-200 border border-amber-800/50">
                                Pending
                              </span>
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] font-medium text-slate-200">How the auto-draw works</p>
                            <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
                              If projected cash falls below your minimum cash buffer, the model draws this line up to its
                              cap. When cash exceeds the buffer, the line is repaid first.
                            </p>
                          </div>
                          <div className="space-y-3 pt-1 border border-slate-700/60 rounded-md p-2.5 bg-slate-900/30">
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Cash sweep parameters</p>
                            <p className="text-[9px] text-slate-500 leading-snug">
                              These drive automatic draws and repayments once the Cash Flow statement is connected.
                            </p>
                            {/* Maximum Revolver Commitment */}
                            <div className="space-y-1">
                              <label className="block text-[10px] text-slate-400 font-medium">
                                Maximum Revolver Commitment (Current Assets Method [AR + Inventory] × 80%)
                              </label>
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="number"
                                  step={0.1}
                                  min={0}
                                  className="w-28 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 font-mono"
                                  value={Number.isFinite(revolverCapKValue) ? Math.round(revolverCapKValue * 10) / 10 : ""}
                                  onChange={(e) => {
                                    const n = parseFloat(e.target.value);
                                    setDraft(patchTranche(draft, t.trancheId, {
                                      revolverCapStoredK: Number.isFinite(n) ? displayToStored(n * 1000, currencyUnit) : 0,
                                    }));
                                  }}
                                />
                                <span className="text-[10px] text-slate-500">K</span>
                              </div>
                              <p className="text-[9px] text-slate-500 leading-snug">{revolverCapAbl.rationale}</p>
                            </div>
                            {/* Minimum Cash Requirement % of Revenue */}
                            <div className="space-y-1">
                              <label className="block text-[10px] text-slate-400 font-medium">
                                Minimum Cash Requirement % of Revenue
                              </label>
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="number"
                                  step={0.1}
                                  min={0}
                                  max={100}
                                  placeholder="e.g. 2"
                                  className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 font-mono"
                                  value={t.minCashPctRevenue != null && Number.isFinite(t.minCashPctRevenue) ? t.minCashPctRevenue : ""}
                                  onChange={(e) => {
                                    const n = parseFloat(e.target.value);
                                    setDraft(patchTranche(draft, t.trancheId, {
                                      minCashPctRevenue: Number.isFinite(n) ? n : undefined,
                                    }));
                                  }}
                                />
                                <span className="text-[10px] text-slate-500">% of revenue</span>
                              </div>
                              <p className="text-[9px] text-slate-500 leading-snug">
                                IB standard: 1–3% of revenue. Model draws the LOC when cash falls below this threshold.
                              </p>
                            </div>
                            {/* Minimum Cash Requirement Floor ($) */}
                            <div className="space-y-1">
                              <label className="block text-[10px] text-slate-400 font-medium">
                                Minimum Cash Requirement Floor ($)
                              </label>
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="number"
                                  step={1}
                                  min={0}
                                  placeholder="e.g. 500"
                                  className="w-28 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 font-mono"
                                  value={
                                    t.minCashFloorStoredK != null && t.minCashFloorStoredK > 0
                                      ? Math.round(storedToDisplay(t.minCashFloorStoredK, currencyUnit) / 1000)
                                      : ""
                                  }
                                  onChange={(e) => {
                                    const n = parseFloat(e.target.value);
                                    setDraft(patchTranche(draft, t.trancheId, {
                                      minCashFloorStoredK: Number.isFinite(n) ? displayToStored(n * 1000, currencyUnit) : undefined,
                                    }));
                                  }}
                                />
                                <span className="text-[10px] text-slate-500">K</span>
                              </div>
                              <p className="text-[9px] text-slate-500 leading-snug">
                                Hard floor: effective minimum = max(% of revenue, this floor). Leave blank to use % only.
                              </p>
                            </div>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Current rate:{" "}
                            <span className="font-mono text-slate-200">{t.fixedInterestRatePct ?? "—"}%</span>
                            <span className="text-slate-500"> — </span>
                            <a
                              href={`#debt-interest-rate-${t.trancheId}`}
                              className="text-sky-400 underline hover:text-sky-300"
                            >
                              Edit under Interest (section C) above
                            </a>
                          </div>
                        </div>
                      ) : (
                        <>
                      <select
                        className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 max-w-md"
                        value={amort === "straight_line" ? "straight_line" : amort === "none" ? "none" : "manual"}
                        onChange={(e) => {
                          const v = e.target.value;
                          const method: AmortizationMethodV1 =
                            v === "straight_line" ? "straight_line" : v === "none" ? "none" : "manual_by_year";
                          setDraft(patchTranche(draft, t.trancheId, { amortizationMethod: method }));
                        }}
                      >
                        <option value="straight_line">Straight-line to maturity</option>
                        <option value="manual">Manual by year</option>
                        <option value="none">None / interest-only</option>
                      </select>
                      {amort === "straight_line" ? (
                        <div className="mt-2 space-y-2 text-[10px] text-slate-400">
                          <p>
                            We&apos;ll spread principal repayments evenly across the selected period. Amounts are written
                            when you click Apply.
                          </p>
                          <div className="flex flex-wrap gap-x-3 gap-y-2 items-center">
                            <div>
                              <label className="block text-[9px] text-slate-500 mb-0.5">Repayment starts in</label>
                              <select
                                className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                                value={t.repaymentStartYear ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value || undefined;
                                  const patch: Partial<DebtTrancheConfigV1> = { repaymentStartYear: v };
                                  if (!mUi.withinForecast && mUi.termYears > 0) {
                                    const my = computeBeyondMaturityYear(v, mUi.termYears);
                                    if (my) patch.maturityYear = my;
                                  }
                                  setDraft(patchTranche(draft, t.trancheId, patch));
                                }}
                              >
                                <option value="">—</option>
                                {projectionYears.map((y) => (
                                  <option key={y} value={y}>
                                    {y}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="min-w-[200px] space-y-1.5">
                              <span className="block text-[9px] text-slate-500 mb-0.5">Final repayment year</span>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="radio"
                                  className="accent-sky-600"
                                  checked={mUi.withinForecast}
                                  onChange={() => {
                                    setMaturityUiByTranche((prev) => ({
                                      ...prev,
                                      [t.trancheId]: { ...mUi, withinForecast: true },
                                    }));
                                  }}
                                />
                                <span>Ends within forecast period</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="radio"
                                  className="accent-sky-600"
                                  checked={!mUi.withinForecast}
                                  onChange={() => {
                                    const term = mUi.termYears > 0 ? mUi.termYears : 10;
                                    setMaturityUiByTranche((prev) => ({
                                      ...prev,
                                      [t.trancheId]: { withinForecast: false, termYears: term },
                                    }));
                                    const my = computeBeyondMaturityYear(t.repaymentStartYear, term);
                                    if (my) setDraft(patchTranche(draft, t.trancheId, { maturityYear: my }));
                                  }}
                                />
                                <span>Ends beyond forecast period</span>
                              </label>
                              {mUi.withinForecast ? (
                                <select
                                  className="mt-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 w-full max-w-[140px]"
                                  value={t.maturityYear ?? ""}
                                  onChange={(e) =>
                                    setDraft(
                                      patchTranche(draft, t.trancheId, { maturityYear: e.target.value || undefined })
                                    )
                                  }
                                >
                                  <option value="">—</option>
                                  {projectionYears.map((y) => (
                                    <option key={y} value={y}>
                                      {y}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="mt-1 space-y-1 text-slate-400">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] text-slate-500 whitespace-nowrap">Total loan term:</span>
                                    <input
                                      type="number"
                                      min={1}
                                      step={1}
                                      className="w-16 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 font-mono"
                                      value={mUi.termYears || ""}
                                      onChange={(e) => {
                                        const n = parseInt(e.target.value, 10);
                                        const ty = Number.isFinite(n) && n > 0 ? n : 0;
                                        setMaturityUiByTranche((prev) => ({
                                          ...prev,
                                          [t.trancheId]: { withinForecast: false, termYears: ty },
                                        }));
                                        const my = computeBeyondMaturityYear(t.repaymentStartYear, ty);
                                        if (my) setDraft(patchTranche(draft, t.trancheId, { maturityYear: my }));
                                      }}
                                    />
                                    <span className="text-[10px]">years from repayment start</span>
                                  </div>
                                  <p className="text-[10px] text-slate-500">
                                    Matures in:{" "}
                                    <span className="font-mono text-slate-300">
                                      {computeBeyondMaturityYear(t.repaymentStartYear, mUi.termYears) ?? "—"}
                                    </span>{" "}
                                    (beyond forecast window)
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                          <p className="text-[10px] text-slate-300 font-mono">
                            Estimated annual principal repayment:{" "}
                            {estAnnualPrincipal != null
                              ? `${storedToDisplay(estAnnualPrincipal, currencyUnit).toLocaleString(undefined, { maximumFractionDigits: 0 })}${unitLabel ? ` ${unitLabel}` : ""}/yr`
                              : "— (set years and opening balance)"}
                          </p>
                          <p className="text-[9px] text-slate-600">
                            Switch to Manual only if you have a specific repayment schedule from loan documents.
                          </p>
                        </div>
                      ) : null}
                      {amort === "manual_by_year" ? (
                        <p className="text-[9px] text-slate-500 mt-1">
                          Use this when you already know the repayment schedule.
                        </p>
                      ) : null}
                      {amort === "none" ? (
                        <p className="text-[9px] text-slate-500 mt-1">
                          Use this when no scheduled principal repayment is expected during the forecast period.
                        </p>
                      ) : null}
                        </>
                      )}

                      {projectionYears.length === 0 ? (
                        <p className="text-[10px] text-slate-600">Add projection years in model settings.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px] text-slate-300 border-collapse min-w-[480px]">
                            <thead>
                              <tr className="text-left text-slate-500 border-b border-slate-800">
                                <th className="py-1 pr-2 font-medium">Year</th>
                                <th className="py-1 px-1 font-medium text-right">
                                  <span className="block">Draws</span>
                                  {isRevolverUi ? (
                                    <span className="block text-[8px] font-normal text-slate-500 normal-case">
                                      Manual (optional)
                                    </span>
                                  ) : null}
                                </th>
                                <th className="py-1 px-1 font-medium text-right">Mand. rep.</th>
                                <th className="py-1 px-1 font-medium text-right">
                                  <span className="inline-flex flex-col items-end gap-0.5">
                                    <span>Cash sweep</span>
                                    <span className="rounded px-1 py-px text-[7px] font-semibold uppercase bg-slate-800 text-slate-500 border border-slate-700">
                                      Auto (future)
                                    </span>
                                  </span>
                                </th>
                                {rateMethodUi === "manual_by_year" ? (
                                  <th className="py-1 px-1 font-medium text-right">Rate %</th>
                                ) : null}
                              </tr>
                            </thead>
                            <tbody>
                              {projectionYears.map((y) => (
                                <tr key={y} className="border-b border-slate-800/60">
                                  <td className="py-1 pr-2 text-slate-400 whitespace-nowrap font-mono">{y}</td>
                                  <td className="py-1 px-1 text-right">
                                    <input
                                      type="number"
                                      step={0.01}
                                      className="w-full max-w-[72px] ml-auto rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px] text-slate-200 tabular-nums font-mono"
                                      value={storedToDisplay(t.drawsByYear[y] ?? 0, currencyUnit)}
                                      onChange={(e) => {
                                        const n = parseFloat(e.target.value);
                                        setDraft(
                                          patchTrancheYear(
                                            draft,
                                            t.trancheId,
                                            "drawsByYear",
                                            y,
                                            Number.isFinite(n) ? displayToStored(n, currencyUnit) : 0
                                          )
                                        );
                                      }}
                                    />
                                  </td>
                                  <td className="py-1 px-1 text-right text-slate-600 font-mono select-none">
                                    {isRevolverUi ? "—" : (
                                      <input
                                        type="number"
                                        step={0.01}
                                        className="w-full max-w-[72px] ml-auto rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px] text-slate-200 tabular-nums font-mono"
                                        value={storedToDisplay(t.mandatoryRepaymentByYear[y] ?? 0, currencyUnit)}
                                        onChange={(e) => {
                                          const n = parseFloat(e.target.value);
                                          setDraft(
                                            patchTrancheYear(
                                              draft,
                                              t.trancheId,
                                              "mandatoryRepaymentByYear",
                                              y,
                                              Number.isFinite(n) ? displayToStored(n, currencyUnit) : 0
                                            )
                                          );
                                        }}
                                      />
                                    )}
                                  </td>
                                  <td
                                    className="py-1 px-1 text-right text-slate-600 font-mono select-none"
                                    title="Cash sweep will be calculated automatically once cash flow projections are connected."
                                  >
                                    —
                                  </td>
                                  {rateMethodUi === "manual_by_year" ? (
                                    <td className="py-1 px-1 text-right">
                                      <input
                                        type="number"
                                        step={0.01}
                                        className="w-full max-w-[56px] ml-auto rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px] text-slate-200 font-mono"
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
                          <p className="text-[9px] text-slate-600 mt-1">Cash flows in {unitLabel || "model units"}.</p>
                          {isRevolverUi ? (
                            <p className="text-[9px] text-slate-500 mt-1 leading-relaxed">
                              You can enter planned draws above. Auto-draw logic will be added in the cash sweep step.
                            </p>
                          ) : null}
                          <p className="text-[9px] text-slate-500 mt-1 leading-relaxed">
                            Optional repayments will later be calculated from excess cash. For now, this schedule focuses
                            on opening debt, mandatory repayments, and interest.
                          </p>
                        </div>
                      )}

                      {unsaved ? (
                        <div className="mt-2 border-t border-slate-800/80 pt-2 space-y-1 border-l-2 border-amber-700/50 pl-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-amber-950/60 text-amber-200 border border-amber-800/50">
                              Draft preview
                            </span>
                            <span className="text-[10px] text-slate-500">
                              Updates as you type — click Apply to save
                            </span>
                          </div>
                          <p className="text-[10px] text-amber-200/80 font-medium">Draft (not yet applied)</p>
                          {(() => {
                            const draftRoll = computeDraftTrancheRollforwardByYear(
                              t,
                              projectionYears,
                              lastHistoricYear,
                              balanceSheet,
                              draft.conventionType
                            );
                            if (!draftRoll) {
                              return (
                                <p className="text-[10px] text-slate-500">
                                  Set opening balance and rates to see a draft roll-forward.
                                </p>
                              );
                            }
                            return (
                              <div className="overflow-x-auto">
                                <table className="w-full text-[10px] font-mono text-slate-300 border-collapse min-w-[280px]">
                                  <thead>
                                    <tr className="text-left text-slate-500 border-b border-slate-800">
                                      <th className="py-1 pr-2 font-medium"> </th>
                                      {projectionYears.map((y) => (
                                        <th key={y} className="py-1 px-1 font-medium text-right whitespace-nowrap">
                                          {y}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(["opening", "ending", "interest"] as const).map((rowKind) => (
                                      <tr key={rowKind} className="border-b border-slate-800/60">
                                        <td className="py-1 pr-2 text-slate-400 capitalize">{rowKind}</td>
                                        {projectionYears.map((y) => {
                                          const cell = draftRoll[y];
                                          const val =
                                            rowKind === "opening"
                                              ? cell?.opening
                                              : rowKind === "ending"
                                                ? cell?.ending
                                                : cell?.interest;
                                          return (
                                            <td key={y} className="py-1 px-1 text-right tabular-nums">
                                              {rowKind === "interest"
                                                ? fmtMoneyStored(val ?? null, currencyUnit, false)
                                                : fmtMoneyStored(val ?? null, currencyUnit, true)}
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}
                        </div>
                      ) : null}
                      {renderRollForwardPreview(t.trancheId)}
                      <div className="pt-2 border-t border-slate-800/60 flex justify-end">
                        <button
                          type="button"
                          onClick={() => setOpenTrancheId(null)}
                          className="rounded border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
                        >
                          ✓ Done — collapse this facility
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="rounded-md border border-slate-700 bg-slate-950/50 p-2.5 space-y-2">
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Debt summary</p>
              <p className="text-[9px] text-slate-500 mt-0.5 leading-relaxed">
                These outputs feed your Interest Expense forecast and later connect to the Balance Sheet and Cash Flow
                Statement.
              </p>
            </div>
            {!appliedPreview || !appliedBody ? (
              <p className="text-[10px] text-slate-500 font-mono">Apply the schedule to see totals.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono text-slate-300 border-collapse min-w-[420px]">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-800">
                      <th className="py-1 pr-2">Year</th>
                      <th className="py-1 px-1 text-right">
                        Total ending <span className="text-slate-600">→ BS</span>
                      </th>
                      <th className="py-1 px-1 text-right text-sky-300">
                        Total interest <span className="text-slate-600">→ IS</span>
                      </th>
                      <th className="py-1 px-1 text-right">
                        Mand. rep. <span className="text-slate-600">→ CFS</span>
                      </th>
                      <th className="py-1 px-1 text-right">Draws</th>
                      <th className="py-1 px-1 text-right">Debt service</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectionYears.map((y) => {
                      const tot = appliedPreview.totalsByYear[y]!;
                      return (
                        <tr key={y} className="border-b border-slate-800/60">
                          <td className="py-1 pr-2 text-slate-400">{y}</td>
                          <td className="py-1 px-1 text-right tabular-nums">
                            {fmtMoneyStored(tot.totalEndingDebt, currencyUnit, true)}
                          </td>
                          <td className="py-1 px-1 text-right tabular-nums text-sky-300">
                            {tot.totalInterestExpense == null
                              ? "—"
                              : fmtMoneyStored(tot.totalInterestExpense, currencyUnit, false)}
                          </td>
                          <td className="py-1 px-1 text-right tabular-nums">
                            {fmtMoneyStored(tot.totalMandatoryRepayment, currencyUnit, false)}
                          </td>
                          <td className="py-1 px-1 text-right tabular-nums">
                            {fmtMoneyStored(tot.totalNewBorrowingDraws, currencyUnit, false)}
                          </td>
                          <td className="py-1 px-1 text-right tabular-nums">
                            {tot.totalDebtService == null
                              ? "—"
                              : fmtMoneyStored(tot.totalDebtService, currencyUnit, false)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
