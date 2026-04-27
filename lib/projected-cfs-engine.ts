/**
 * Phase 3 — Projected Cash Flow Statement (indirect method)
 *
 * CFO / CFI / CFF and ending cash are assembled from projected IS, BS, and schedule
 * outputs only — not from historical CFS disclosure line values. The existing CFS row
 * tree is the merge target; disclosure-only historic lines are zeroed in projection years.
 *
 * Signs follow IB-style cash flow presentation:
 * - Outflows are negative (capex, debt repaid, cash interest, dividends, buybacks).
 * - Inflows are positive (debt issued, equity issued).
 */

import type { Row } from "@/types/finance";
import type { DebtScheduleEngineResultV1 } from "@/lib/debt-schedule-engine";
import type { EquityRollforwardResult } from "@/lib/equity-rollforward-engine";
import { computeBalanceSheetTotalsWithOverrides, getDeltaWcBs } from "@/lib/calculations";
import { getDandaFromIncomeStatement, getSbcFromIncomeStatement } from "@/lib/cfo-source-resolution";
import { classifyCfsLineForProjection } from "@/lib/cfs-line-classification";
import { findRowInTree } from "@/lib/row-utils";
import { computeOtherBsBridgeLineForYear } from "@/lib/other-bs-cfs-bridge";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProjectedCfsEngineInput = {
  projectionYears: string[];
  lastHistoricalYear: string | null;
  balanceSheet: Row[];
  incomeStatement: Row[];
  /** Capex cash spend by year (positive magnitudes from capex engine). */
  totalCapexByYear: Record<string, number>;
  debtScheduleResult?: DebtScheduleEngineResultV1 | null;
  equityRollforwardResult?: EquityRollforwardResult | null;
  /** Optional FX / cash bridge; defaults to 0 per year. */
  fxEffectByYear?: Record<string, number>;
  /**
   * CFS row tree after anchors (same structure as merged output). Used only to classify
   * row ids as forecasted vs disclosure-only and to emit zeros for non-forecasted ids.
   */
  cashFlowTree: Row[];
  /** Intangible asset additions by year (positive = cash spend on intangibles). */
  intangibleAdditionsByYear?: Record<string, number | undefined>;
  /** BS row ids with Other BS bridge lines — excluded from residual sweep. */
  otherBsBridgeBsIds?: ReadonlySet<string>;
};

export type ProjectedCfsYearBreakdown = {
  beginningCash: number;
  netIncome: number;
  danda: number;
  sbc: number;
  wcChange: number;
  otherOperating: number;
  cfo: number;
  capex: number;
  acquisitions: number;
  assetSales: number;
  investments: number;
  otherInvesting: number;
  cfi: number;
  debtIssued: number;
  debtRepaid: number;
  cashInterestPaid: number;
  equityIssued: number;
  shareRepurchases: number;
  dividends: number;
  otherFinancing: number;
  cff: number;
  fxEffect: number;
  netChangeInCash: number;
  endingCash: number;
};

export type ProjectedCfsEngineResult = {
  byYear: Record<string, ProjectedCfsYearBreakdown>;
  /** Merge into CFS row.values for projection years (row id → year → value). */
  cfsValuesByRowId: Record<string, Record<string, number>>;
  endingCashByYear: Record<string, number>;
  /** Row ids that receive engine-backed values; all other CFS ids are zero in projections. */
  forecastedCfsRowIds: ReadonlySet<string>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flattenStatement(rows: Row[], out: Row[] = []): Row[] {
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) flattenStatement(r.children, out);
  }
  return out;
}

function val(row: Row | null | undefined, year: string): number {
  if (!row) return 0;
  return row.values?.[year] ?? 0;
}

/**
 * Deferred tax non-cash adjustment in CFO: -ΔDTA + ΔDTL (standard bridge).
 */
function otherOperatingDeferredTax(flatBs: Row[], year: string, prevYear: string | null): number {
  if (!prevYear) return 0;
  const sumTax = (tax: string, y: string) =>
    flatBs.filter((r) => r.taxonomyType === tax).reduce((s, r) => s + (r.values?.[y] ?? 0), 0);
  const dtaY = sumTax("asset_deferred_tax", year);
  const dtaP = sumTax("asset_deferred_tax", prevYear);
  const dtlY = sumTax("liab_deferred_tax", year);
  const dtlP = sumTax("liab_deferred_tax", prevYear);
  return -(dtaY - dtaP) + (dtlY - dtlP);
}

function extractDandaAddBack(incomeStatement: Row[], year: string): number {
  return getDandaFromIncomeStatement(incomeStatement, year) ?? 0;
}

function extractSbcAddBack(incomeStatement: Row[], year: string): number {
  return getSbcFromIncomeStatement(incomeStatement, year) ?? 0;
}

function extractNetIncome(is: Row[], flatIs: Row[], year: string): number {
  const row =
    findRowInTree(is, "net_income") ?? flatIs.find((r) => r.taxonomyType === "calc_net_income");
  return val(row, year);
}

function getBeginningCashFromBs(balanceSheet: Row[], lastHistYear: string | null): number {
  if (!lastHistYear) return 0;
  const flat = flattenStatement(balanceSheet);
  const cash = flat.find((r) => r.id === "cash" || r.taxonomyType === "asset_cash");
  return cash?.values?.[lastHistYear] ?? 0;
}

/** WC bridge line `cfo_${bsId}` — same sign logic as `computeFormula` cfo_* branch in calculations. */
function cfoComponentCashFromBs(
  cfsRow: Row,
  balanceSheet: Row[],
  year: string,
  prevYear: string | null
): number | null {
  if (!prevYear || !cfsRow.id.startsWith("cfo_") || !cfsRow.cfsLink) return null;
  const bsRowId = cfsRow.id.replace(/^cfo_/, "");
  const bsRow = findRowInTree(balanceSheet, bsRowId);
  if (!bsRow) return null;
  const curr = bsRow.values?.[year] ?? 0;
  const prev = bsRow.values?.[prevYear] ?? 0;
  const change = curr - prev;
  const imp = cfsRow.cfsLink.impact;
  if (imp === "positive") return change;
  if (imp === "negative") return -change;
  return change;
}

/**
 * Per projection year: verify BS totals vs engine ending cash (diagnostic).
 */
export function verifyCashBalanceCheck(
  balanceSheet: Row[],
  projectionYears: string[],
  endingCashByYear: Record<string, number>
): void {
  if (process.env.NODE_ENV === "production") return;
  const flatBs = flattenStatement(balanceSheet);
  const cashRow = flatBs.find((r) => r.id === "cash" || r.taxonomyType === "asset_cash");
  for (const y of projectionYears) {
    const totals = computeBalanceSheetTotalsWithOverrides(balanceSheet, y);
    const totalAssets = totals.total_assets;
    const totalLiabAndEquity = totals.total_liab_and_equity;
    const diff = totalAssets - totalLiabAndEquity;
    // eslint-disable-next-line no-console -- intentional diagnostic for BS build verification
    console.log(
      `BS Check [${y}]: Assets = ${totalAssets}, L+E = ${totalLiabAndEquity}, Diff = ${diff}`
    );
    // eslint-disable-next-line no-console -- intentional diagnostic for BS build verification
    console.log(`Engine Cash = ${endingCashByYear[y]}, BS Cash Row = ${cashRow?.values?.[y]}`);
  }
}

// ─── Core ────────────────────────────────────────────────────────────────────

export function computeProjectedCashFlow(input: ProjectedCfsEngineInput): ProjectedCfsEngineResult {
  /*
   * Step 1 — Data available when applyBsBuildProjectionsToModel calls this (variable names at call site):
   *
   * - newIS (`incomeStatement` arg): projected IS rows after `isProjectedByRowId` write + `recomputeCalculations`
   *   per projection year. Contains `net_income` / `calc_net_income`, D&A (`opex_danda` or split `opex_depreciation`
   *   + `opex_amortization`), SBC (`opex_sbc`), interest, tax, and other forecast lines from revenue/COGS, capex D&A
   *   schedule, intangibles amort, debt interest, interest income schedule, tax schedule, opex forecast, etc.
   *
   * - newBS (`balanceSheet` arg): projected BS after WC (`wcProjected`), PP&E (`ppeByYear` / capex schedule),
   *   intangibles ending (`intangiblesEndByYear`), debt STD/LTD (`debtStdByYear` / `debtLtdByYear`), equity accounts
   *   (`equityByAccount` from equity roll-forward), other BS items (`otherBsProjected`). Cash row is still pre-engine
   *   (historical in projection cols until `applyEndingCashToBalanceSheet` runs after recompute).
   *
   * - totalCapexByYear: `Record<year, number>` from `computeProjectedCapexByYear(capexEngineInput)`.
   * - debtScheduleResult: `DebtScheduleEngineResultV1 | null` from `computeDebtScheduleEngine` when phase-2 debt applied.
   * - equityRollforwardResult: `EquityRollforwardResult | null` when `equityRollforwardConfirmed`; fields used here:
   *   `cffIssuancesByYear`, `cffBuybacksByYear`, `cffDividendsByYear` (CFF signs: inflow positive, outflow negative).
   * - intangibleAdditionsByYear (optional): `intangiblesOutput?.additionsByYear` from `computeIntangiblesAmortSchedule`.
   * - cashFlowTree: copy of `cashFlow` after `ensureCFSAnchorRowsInPlace` — structure for classification / zeroing only.
   *
   * Not passed directly (already embedded in IS/BS): interest income on IS, tax expense, amortization split on IS.
   */

  const {
    projectionYears,
    lastHistoricalYear,
    balanceSheet,
    incomeStatement,
    totalCapexByYear,
    debtScheduleResult,
    equityRollforwardResult,
    fxEffectByYear = {},
    cashFlowTree,
    intangibleAdditionsByYear = {},
    otherBsBridgeBsIds = new Set<string>(),
  } = input;

  const flatBs = flattenStatement(balanceSheet);
  const flatCf = flattenStatement(cashFlowTree);

  const forecastedCfsRowIds = new Set<string>();
  for (const r of flatCf) {
    if (classifyCfsLineForProjection(r, balanceSheet) !== "cf_disclosure_only") {
      forecastedCfsRowIds.add(r.id);
    }
  }

  /** Step 1 — rows already reflected elsewhere in CFO/CFI/CFF or non-cash; skip residual sweep. */
  function residualSweepExcludeRow(r: Row): boolean {
    const tt = r.taxonomyType;
    if (tt === "asset_cash" || r.id === "cash") return true;
    if (tt === "asset_deferred_tax") return true;
    if (tt === "liab_deferred_tax") return true;
    if (r.scheduleOwner != null && r.scheduleOwner !== "none") return true;
    if (r.cashFlowBehavior === "working_capital") return true;
    if (r.cashFlowBehavior === "non_cash") return true;
    if (r.id.startsWith("total")) return true;
    if (tt?.startsWith("calc_")) return true;
    if (tt?.startsWith("equity_")) return true;
    return false;
  }

  const byYear: Record<string, ProjectedCfsYearBreakdown> = {};
  const cfsValuesByRowId: Record<string, Record<string, number>> = {};
  const endingCashByYear: Record<string, number> = {};

  const setCfs = (rowId: string, year: string, value: number) => {
    if (!cfsValuesByRowId[rowId]) cfsValuesByRowId[rowId] = {};
    cfsValuesByRowId[rowId][year] = value;
  };

  let prevEndingCash = getBeginningCashFromBs(balanceSheet, lastHistoricalYear);

  for (let i = 0; i < projectionYears.length; i++) {
    const year = projectionYears[i]!;
    const prevYear = i === 0 ? lastHistoricalYear : projectionYears[i - 1]!;

    const beginningCash = prevEndingCash;

    const flatIs = flattenStatement(incomeStatement);
    const netIncome = extractNetIncome(incomeStatement, flatIs, year);
    const danda = extractDandaAddBack(incomeStatement, year);
    const sbc = extractSbcAddBack(incomeStatement, year);
    const wcChange = prevYear ? -getDeltaWcBs(balanceSheet, year, prevYear) : 0;
    const otherOperating = otherOperatingDeferredTax(flatBs, year, prevYear);

    let cfo = netIncome + danda + sbc + wcChange + otherOperating;

    const capexRaw = totalCapexByYear[year] ?? 0;
    const capex = -Math.abs(capexRaw);

    const intangibleAdd = intangibleAdditionsByYear[year] ?? 0;
    const intangibleCfi = -Math.abs(intangibleAdd);

    const acquisitions = 0;
    const assetSales = 0;
    const investments = 0;
    const otherInvesting = 0;

    let cfi = capex + intangibleCfi + acquisitions + assetSales + investments + otherInvesting;

    let debtIssued = 0;
    let debtRepaid = 0;
    let cashInterestPaid = 0;
    if (debtScheduleResult) {
      const t = debtScheduleResult.totalsByYear[year];
      if (t) {
        debtIssued = t.totalNewBorrowingDraws ?? 0;
        const prin = (t.totalMandatoryRepayment ?? 0) + (t.totalOptionalRepayment ?? 0);
        debtRepaid = -Math.abs(prin);
        const intExp = t.totalInterestExpense;
        cashInterestPaid = intExp != null && Number.isFinite(intExp) ? -Math.abs(intExp) : 0;
      }
    }

    let equityIssued = 0;
    let shareRepurchases = 0;
    let dividends = 0;
    if (equityRollforwardResult) {
      equityIssued = equityRollforwardResult.cffIssuancesByYear[year] ?? 0;
      shareRepurchases = equityRollforwardResult.cffBuybacksByYear[year] ?? 0;
      dividends = equityRollforwardResult.cffDividendsByYear[year] ?? 0;
    }

    const otherFinancing = 0;
    let cff =
      debtIssued + debtRepaid + cashInterestPaid + equityIssued + shareRepurchases + dividends + otherFinancing;

    let residualCfo = 0;
    let residualCfi = 0;
    let residualCff = 0;

    if (prevYear) {
      for (const r of flatBs) {
        if (residualSweepExcludeRow(r)) continue;
        if (otherBsBridgeBsIds.has(r.id)) continue;

        const tt = r.taxonomyType as string | undefined;
        const cfb = r.cashFlowBehavior;

        let bucket: "cfo" | "cfi" | "cff" | null = null;
        if (cfb === "investing") {
          bucket = "cfi";
        } else if (cfb === "financing") {
          bucket = "cff";
        } else if (cfb == null || cfb === "unclassified") {
          if (tt?.startsWith("liab_")) bucket = "cfo";
          else if (tt?.startsWith("asset_")) bucket = "cfo";
          else {
            console.warn(
              "[computeProjectedCashFlow] Residual BS Sweep: cannot determine CFS section (need asset_/liab_ taxonomy or investing/financing behavior)",
              r.id,
              r.label,
              tt ?? "(no taxonomyType)"
            );
            continue;
          }
        }

        const rawY = r.values?.[year];
        const rawP = r.values?.[prevYear];
        const vY = typeof rawY === "number" && Number.isFinite(rawY) ? rawY : 0;
        const vP = typeof rawP === "number" && Number.isFinite(rawP) ? rawP : 0;
        const delta = vY - vP;

        let cashImpact: number;
        if (tt?.startsWith("asset_")) {
          cashImpact = -delta;
        } else if (tt?.startsWith("liab_")) {
          cashImpact = delta;
        } else if (cfb === "investing" || bucket === "cfi") {
          cashImpact = -delta;
        } else if (cfb === "financing" || bucket === "cff") {
          cashImpact = delta;
        } else {
          console.warn(
            "[computeProjectedCashFlow] Residual BS Sweep: ambiguous cash impact (no asset_/liab_ taxonomy and no investing/financing behavior)",
            r.id,
            r.label,
            tt ?? "(no taxonomyType)"
          );
          continue;
        }

        if (bucket === "cfo") residualCfo += cashImpact;
        else if (bucket === "cfi") residualCfi += cashImpact;
        else residualCff += cashImpact;
      }
    }
    cfo += residualCfo;
    cfi += residualCfi;
    cff += residualCff;

    const otherBsBridgeLines: { id: string; value: number }[] = [];
    if (otherBsBridgeBsIds.size > 0 && prevYear) {
      for (const bsId of otherBsBridgeBsIds) {
        const line = computeOtherBsBridgeLineForYear(balanceSheet, bsId, year, prevYear);
        if (!line) continue;
        otherBsBridgeLines.push(line);
        if (line.id.startsWith("mbc_cfi_")) cfi += line.value;
        else if (line.id.startsWith("mbc_cfo_")) cfo += line.value;
        else if (line.id.startsWith("mbc_cff_")) cff += line.value;
      }
    }

    const fxEffect = fxEffectByYear[year] ?? 0;
    const netChangeInCash = cfo + cfi + cff + fxEffect;
    const endingCash = beginningCash + netChangeInCash;

    byYear[year] = {
      beginningCash,
      netIncome,
      danda,
      sbc,
      wcChange,
      otherOperating,
      cfo,
      capex,
      acquisitions,
      assetSales,
      investments,
      otherInvesting,
      cfi,
      debtIssued,
      debtRepaid,
      cashInterestPaid,
      equityIssued,
      shareRepurchases,
      dividends,
      otherFinancing,
      cff,
      fxEffect,
      netChangeInCash,
      endingCash,
    };

    endingCashByYear[year] = endingCash;
    prevEndingCash = endingCash;

    setCfs("net_income", year, netIncome);
    setCfs("danda", year, danda);
    setCfs("sbc", year, sbc);
    setCfs("wc_change", year, wcChange);
    setCfs("other_operating", year, otherOperating);
    setCfs("capex", year, capex);
    setCfs("additions_to_intangibles", year, intangibleCfi);
    setCfs("acquisitions", year, acquisitions);
    setCfs("asset_sales", year, assetSales);
    setCfs("investments", year, investments);
    setCfs("other_investing", year, otherInvesting);
    setCfs("debt_issued", year, debtIssued);
    setCfs("debt_repaid", year, debtRepaid);
    setCfs("debt_issuance", year, debtIssued);
    setCfs("debt_repayment", year, debtRepaid);
    setCfs("cash_interest_paid", year, cashInterestPaid);
    setCfs("equity_issued", year, equityIssued);
    setCfs("equity_issuance", year, equityIssued);
    setCfs("share_repurchases", year, shareRepurchases);
    setCfs("dividends", year, dividends);
    setCfs("other_financing", year, otherFinancing);
    setCfs("fx_effect_on_cash", year, fxEffect);

    for (const ol of otherBsBridgeLines) {
      setCfs(ol.id, year, ol.value);
    }

    for (const r of flatCf) {
      if (r.id.startsWith("cfo_") && r.cfsLink && forecastedCfsRowIds.has(r.id)) {
        const wcLine = cfoComponentCashFromBs(r, balanceSheet, year, prevYear);
        if (wcLine !== null) {
          setCfs(r.id, year, wcLine);
        }
      }
    }

    for (const r of flatCf) {
      if (!forecastedCfsRowIds.has(r.id)) {
        setCfs(r.id, year, 0);
      }
    }
  }

  return { byYear, cfsValuesByRowId, endingCashByYear, forecastedCfsRowIds };
}

/** Deep-merge projected CFS values into existing rows (historical years untouched). */
export function applyProjectedCfsToCashFlowRows(
  cashFlow: Row[],
  cfsValuesByRowId: Record<string, Record<string, number>>
): Row[] {
  const patch = (rows: Row[]): Row[] =>
    rows.map((r) => {
      const years = cfsValuesByRowId[r.id];
      const nextChildren = r.children ? patch(r.children) : undefined;
      if (!years && !nextChildren) return r;
      const newValues = { ...(r.values ?? {}) };
      if (years) {
        for (const [y, v] of Object.entries(years)) {
          newValues[y] = v;
        }
      }
      return { ...r, values: newValues, ...(nextChildren ? { children: nextChildren } : {}) };
    });
  return patch(cashFlow);
}

/** Write engine ending cash to the BS cash row for projection years. */
export function applyEndingCashToBalanceSheet(
  balanceSheet: Row[],
  endingCashByYear: Record<string, number>,
  projectionYears: string[]
): Row[] {
  const patch = (rows: Row[]): Row[] =>
    rows.map((r) => {
      const nextChildren = r.children ? patch(r.children) : undefined;
      const isCash = r.id === "cash" || r.taxonomyType === "asset_cash";
      if (!isCash) {
        return nextChildren ? { ...r, children: nextChildren } : r;
      }
      const newValues = { ...(r.values ?? {}) };
      for (const y of projectionYears) {
        if (endingCashByYear[y] !== undefined) newValues[y] = endingCashByYear[y]!;
      }
      return { ...r, values: newValues, ...(nextChildren ? { children: nextChildren } : {}) };
    });
  return patch(balanceSheet);
}
