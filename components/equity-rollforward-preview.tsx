"use client";

/**
 * Equity Roll-Forward Preview
 *
 * Fixes vs v1:
 *  - DriverRow spans ALL columns (historical + projected): renders "—" for historical cols,
 *    actual historical data for hist driver rows, and engine output for forecast cols.
 *    This eliminates the "projected data appears in historical columns" misalignment bug.
 *  - Historical equity values sourced correctly from BS rows.
 *  - Historical driver values (NI, dividends, buybacks) sourced from IS/CFS rows.
 *  - SBC detection mirrors the panel: IS → CFS → sbcBreakdowns.
 */

import { useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { CurrencyUnit } from "@/store/useModelStore";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import { computeEquityRollforward, defaultEquityRollforwardConfig } from "@/lib/equity-rollforward-engine";
import { computeProjectedEbitByYear, computeProjectedRevCogs } from "@/lib/projected-ebit";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, unit: CurrencyUnit, paren = false): string {
  if (v == null || !isFinite(v)) return "—";
  const d = storedToDisplay(v, unit);
  const lbl = getUnitLabel(unit);
  const abs = Math.abs(d).toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (d < 0 || paren) return `(${abs}) ${lbl}`;
  return `${abs} ${lbl}`;
}

// ─── Driver row — spans ALL columns, "—" for hist cols, data for proj cols ────
// Also supports showing actual historical data in hist cols via `histByYear`.

function DriverRow({
  label,
  allDisplayYears,
  projectionYears,
  engineValueByYear,      // projected values from engine
  histValueByYear,        // historical actuals (optional, for display in hist cols)
  color = "text-slate-400",
  sign = 1,
  unit,
}: {
  label: string;
  allDisplayYears: string[];
  projectionYears: string[];
  engineValueByYear: Record<string, number>;
  histValueByYear?: Record<string, number>;
  color?: string;
  sign?: 1 | -1;
  unit: CurrencyUnit;
}) {
  // Show row only if any projected value or any historical value is non-zero
  const hasProjData = projectionYears.some((y) => Math.abs(engineValueByYear[y] ?? 0) > 0);
  const hasHistData = histValueByYear != null && allDisplayYears
    .filter((y) => !projectionYears.includes(y))
    .some((y) => Math.abs(histValueByYear[y] ?? 0) > 0);

  if (!hasProjData && !hasHistData) return null;

  return (
    <tr className="border-t border-slate-800/40">
      <td className="px-3 py-1 pl-5 text-[10px] text-slate-500">{label}</td>
      {allDisplayYears.map((y) => {
        const isProj = projectionYears.includes(y);
        if (isProj) {
          const raw = (engineValueByYear[y] ?? 0) * sign;
          return (
            <td key={y} className={`px-3 py-1 text-right font-mono text-[10px] ${raw < 0 ? "text-orange-300" : color}`}>
              {Math.abs(raw) > 0.01 ? fmt(raw, unit, raw < 0) : "—"}
            </td>
          );
        }
        // Historical column
        const histVal = histValueByYear?.[y];
        if (histVal != null && Math.abs(histVal) > 0.01) {
          const raw = histVal * sign;
          return (
            <td key={y} className={`px-3 py-1 text-right font-mono text-[10px] text-slate-500`}>
              {fmt(raw, unit, raw < 0)}
            </td>
          );
        }
        return <td key={y} className="px-3 py-1 text-center text-[10px] text-slate-700">—</td>;
      })}
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function EquityRollforwardPreview() {
  const meta            = useModelStore((s) => s.meta);
  const balanceSheet    = useModelStore((s) => s.balanceSheet);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const cashFlow        = useModelStore((s) => s.cashFlow);
  const sbcBreakdowns   = useModelStore((s) => s.sbcBreakdowns ?? {});
  const danaBreakdowns  = useModelStore((s) => s.danaBreakdowns ?? {});

  const revenueForecastConfigV1 = useModelStore((s) => s.revenueForecastConfigV1);
  const revenueForecastTreeV1   = useModelStore((s) => s.revenueForecastTreeV1);
  const revenueProjectionConfig = useModelStore((s) => s.revenueProjectionConfig);
  const cogsForecastConfigV1    = useModelStore((s) => s.cogsForecastConfigV1);
  const opexForecastConfigV1    = useModelStore((s) => s.opexForecastConfigV1);

  const equityDividendMethod          = useModelStore((s) => s.equityDividendMethod);
  const equityDividendPayoutRatio     = useModelStore((s) => s.equityDividendPayoutRatio);
  const equityDividendFixedAmount     = useModelStore((s) => s.equityDividendFixedAmount);
  const equityDividendManualByYear    = useModelStore((s) => s.equityDividendManualByYear);
  const equityBuybackMethod           = useModelStore((s) => s.equityBuybackMethod);
  const equityBuybackFixedAmount      = useModelStore((s) => s.equityBuybackFixedAmount);
  const equityBuybackPctNetIncome     = useModelStore((s) => s.equityBuybackPctNetIncome);
  const equityBuybackManualByYear     = useModelStore((s) => s.equityBuybackManualByYear);
  const equitySharesReissuedMethod    = useModelStore((s) => s.equitySharesReissuedMethod);
  const equitySharesReissuedFixedAmount = useModelStore((s) => s.equitySharesReissuedFixedAmount);
  const equitySharesReissuedManualByYear = useModelStore((s) => s.equitySharesReissuedManualByYear);
  const equityIssuanceMethod          = useModelStore((s) => s.equityIssuanceMethod);
  const equityIssuanceFixedAmount     = useModelStore((s) => s.equityIssuanceFixedAmount);
  const equityIssuanceManualByYear    = useModelStore((s) => s.equityIssuanceManualByYear);
  const equityOptionProceedsMethod    = useModelStore((s) => s.equityOptionProceedsMethod);
  const equityOptionProceedsFixedAmount = useModelStore((s) => s.equityOptionProceedsFixedAmount);
  const equityOptionProceedsManualByYear = useModelStore((s) => s.equityOptionProceedsManualByYear);
  const equityEsppMethod              = useModelStore((s) => s.equityEsppMethod);
  const equityEsppFixedAmount         = useModelStore((s) => s.equityEsppFixedAmount);
  const equityEsppManualByYear        = useModelStore((s) => s.equityEsppManualByYear);
  const equitySbcMethod               = useModelStore((s) => s.equitySbcMethod);
  const equityManualSbcByYear         = useModelStore((s) => s.equityManualSbcByYear);
  const equitySbcPctRevenue           = useModelStore((s) => s.equitySbcPctRevenue);
  const equityRollforwardConfirmed    = useModelStore((s) => s.equityRollforwardConfirmed);

  const unit           = (meta?.currencyUnit ?? "millions") as CurrencyUnit;
  const historicYears  = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const lastHistYear   = historicYears[historicYears.length - 1] ?? null;

  // Show up to 4 historical years + all projection years in the table
  const displayHistYears  = historicYears.slice(-4);
  const allDisplayYears   = [...displayHistYears, ...projectionYears];

  // ── Historical equity BS values (one per displayed year) ─────────────────
  const histEquity = useMemo(() => {
    const findBs = (tt: string) => balanceSheet?.find((r) => r.taxonomyType === tt) ?? null;

    const byYearFn = (r: ReturnType<typeof findBs>) =>
      allDisplayYears.reduce<Record<string, number>>((acc, y) => {
        acc[y] = r?.values?.[y] ?? 0;
        return acc;
      }, {});

    const csRow  = findBs("equity_common_stock");
    const apicRow = findBs("equity_apic");
    const tsRow  = findBs("equity_treasury_stock");
    const reRow  = findBs("equity_retained_earnings");

    return {
      commonStockAll:      byYearFn(csRow),
      apicAll:             byYearFn(apicRow),
      treasuryAll:         byYearFn(tsRow),
      retainedEarningsAll: byYearFn(reRow),
      lastCS:   csRow?.values?.[lastHistYear ?? ""] ?? 0,
      lastAPIC: apicRow?.values?.[lastHistYear ?? ""] ?? 0,
      lastTS:   tsRow?.values?.[lastHistYear ?? ""] ?? 0,
      lastRE:   reRow?.values?.[lastHistYear ?? ""] ?? 0,
    };
  }, [balanceSheet, allDisplayYears, lastHistYear]);

  // ── Historical CFS drivers for historical waterfall rows ─────────────────
  const histDrivers = useMemo(() => {
    const cfRows = cashFlow ?? [];
    const isRows = incomeStatement ?? [];
    const findCf = (tt: string, id?: string) =>
      cfRows.find((r) => r.taxonomyType === tt) ??
      (id ? cfRows.find((r) => r.id === id) : null) ?? null;
    const findIs = (tt: string) => isRows.find((r) => r.taxonomyType === tt) ?? null;

    const getByYear = (r: ReturnType<typeof findCf>): Record<string, number> =>
      allDisplayYears.reduce<Record<string, number>>((acc, y) => {
        acc[y] = r?.values?.[y] ?? 0;
        return acc;
      }, {});

    const niRow   = findIs("calc_net_income");
    const divRow  = findCf("cff_dividends", "dividends");
    const bbRow   = findCf("cff_share_repurchases", "share_repurchases");
    const sbcIsRow = findIs("opex_sbc");
    const sbcCfRow = findCf("cfo_sbc", "sbc");

    // SBC: prefer IS row, fallback CFS
    const sbcRow = sbcIsRow ?? sbcCfRow;

    return {
      netIncome:  getByYear(niRow ?? null),
      dividends:  getByYear(divRow),
      buybacks:   getByYear(bbRow),
      sbc:        getByYear(sbcRow),
    };
  }, [cashFlow, incomeStatement, allDisplayYears]);

  // ── SBC projected: respects user's equitySbcMethod choice ───────────────
  // sbcProjByYear declared after projRevByYear below (requires projRevByYear for pct_revenue)

  // ── All statements ────────────────────────────────────────────────────────
  const allStatements = useMemo(
    () => ({ incomeStatement: incomeStatement ?? [], balanceSheet: balanceSheet ?? [], cashFlow: cashFlow ?? [] }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  // ── Projected Revenue (needed for pct_revenue option proceeds) ────────────
  const projRevByYear = useMemo((): Record<string, number> => {
    if (projectionYears.length === 0 || !lastHistYear) return {};
    try {
      const { revByYear } = computeProjectedRevCogs({
        incomeStatement: incomeStatement ?? [],
        projectionYears,
        lastHistoricYear: lastHistYear,
        revenueForecastConfigV1,
        revenueForecastTreeV1,
        revenueProjectionConfig,
        cogsForecastConfigV1,
        allStatements,
        sbcBreakdowns,
        danaBreakdowns,
        currencyUnit: unit,
      });
      return revByYear;
    } catch { return {}; }
  }, [incomeStatement, projectionYears, lastHistYear, revenueForecastConfigV1, revenueForecastTreeV1, revenueProjectionConfig, cogsForecastConfigV1, allStatements, sbcBreakdowns, danaBreakdowns, unit]);

  // ── SBC projected: respects user's equitySbcMethod choice ───────────────
  const sbcProjByYear = useMemo((): Record<string, number> => {
    if (equitySbcMethod === "manual_by_year") {
      const result: Record<string, number> = {};
      for (const y of projectionYears) result[y] = Math.max(0, equityManualSbcByYear[y] ?? 0);
      return result;
    }

    if (equitySbcMethod === "pct_revenue") {
      const result: Record<string, number> = {};
      for (const y of projectionYears) {
        const rev = projRevByYear[y] ?? 0;
        result[y] = rev * (equitySbcPctRevenue / 100);
      }
      return result;
    }

    // Detect sources for "auto" and "flat_hist" modes
    const isRows  = incomeStatement ?? [];
    const cfsRows = cashFlow ?? [];

    // Source 1: sbcBreakdowns (IS schedule)
    let hasBreakdowns = false;
    const fromBreakdowns: Record<string, number> = {};
    for (const y of projectionYears) {
      let sum = 0;
      for (const bucket of Object.values(sbcBreakdowns)) sum += Math.abs(bucket[y] ?? 0);
      fromBreakdowns[y] = sum;
      if (sum > 0) hasBreakdowns = true;
    }

    // Source 2 & 3: IS / CFS rows
    const isRow  = isRows.find((r) => r.taxonomyType === "opex_sbc");
    const cfsRow = cfsRows.find((r) => r.taxonomyType === "cfo_sbc" || r.id === "sbc");

    // Last historical SBC (for flat_hist mode)
    const histYears = Object.keys(isRow?.values ?? cfsRow?.values ?? {})
      .filter((y) => !projectionYears.includes(y))
      .sort();
    const lastHistYearKey = histYears[histYears.length - 1];
    const lastHistSbc = Math.abs(
      (isRow?.values?.[lastHistYearKey] ?? 0) || (cfsRow?.values?.[lastHistYearKey] ?? 0)
    );

    if (equitySbcMethod === "flat_hist") {
      const result: Record<string, number> = {};
      for (const y of projectionYears) result[y] = lastHistSbc;
      return result;
    }

    // "auto": sbcBreakdowns → IS/CFS projected rows → 0 (no silent fallback)
    if (hasBreakdowns) return fromBreakdowns;

    const fromRows: Record<string, number> = {};
    for (const y of projectionYears) {
      const fromIs  = Math.abs(isRow?.values?.[y]  ?? 0);
      const fromCfs = Math.abs(cfsRow?.values?.[y] ?? 0);
      fromRows[y] = fromIs > 0 ? fromIs : fromCfs;
    }
    return fromRows;
  }, [equitySbcMethod, equityManualSbcByYear, equitySbcPctRevenue, projRevByYear, sbcBreakdowns, projectionYears, incomeStatement, cashFlow]);

  // ── Projected NI (EBIT as proxy) ──────────────────────────────────────────
  const projNiByYear = useMemo((): Record<string, number> => {
    if (projectionYears.length === 0 || !lastHistYear) return {};
    try {
      const ebitByYear = computeProjectedEbitByYear({
        incomeStatement: incomeStatement ?? [],
        projectionYears,
        lastHistoricYear: lastHistYear,
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
      const result: Record<string, number> = {};
      for (const y of projectionYears) result[y] = ebitByYear[y] ?? 0;
      return result;
    } catch { return {}; }
  }, [incomeStatement, projectionYears, lastHistYear, revenueForecastConfigV1, revenueForecastTreeV1, revenueProjectionConfig, cogsForecastConfigV1, opexForecastConfigV1, allStatements, sbcBreakdowns, danaBreakdowns, unit]);

  // ── Engine ────────────────────────────────────────────────────────────────
  const engineResult = useMemo(() => {
    if (projectionYears.length === 0) return null;
    return computeEquityRollforward({
      config: {
        ...defaultEquityRollforwardConfig(),
        dividendMethod:       equityDividendMethod,
        dividendPayoutRatio:  equityDividendPayoutRatio,
        dividendFixedAmount:  equityDividendFixedAmount,
        dividendManualByYear: equityDividendManualByYear,
        buybackMethod:        equityBuybackMethod,
        buybackFixedAmount:   equityBuybackFixedAmount,
        buybackPctNetIncome:  equityBuybackPctNetIncome,
        buybackManualByYear:  equityBuybackManualByYear,
        reissuedMethod:       equitySharesReissuedMethod,
        reissuedFixedAmount:  equitySharesReissuedFixedAmount,
        reissuedManualByYear: equitySharesReissuedManualByYear,
        issuanceMethod:       equityIssuanceMethod,
        issuanceFixedAmount:  equityIssuanceFixedAmount,
        issuanceManualByYear: equityIssuanceManualByYear,
        optionProceedsMethod:       equityOptionProceedsMethod,
        optionProceedsFixedAmount:  equityOptionProceedsFixedAmount,
        optionProceedsManualByYear: equityOptionProceedsManualByYear,
        esppMethod:       equityEsppMethod,
        esppFixedAmount:  equityEsppFixedAmount,
        esppManualByYear: equityEsppManualByYear,
      },
      projectionYears,
      netIncomeByYear: projNiByYear,
      fcfByYear:       projNiByYear,
      revenueByYear:   projRevByYear,
      sbcByYear:       sbcProjByYear,
      lastHistCommonStock:      histEquity.lastCS,
      lastHistApic:             histEquity.lastAPIC,
      lastHistTreasuryStock:    histEquity.lastTS,
      lastHistRetainedEarnings: histEquity.lastRE,
    });
  }, [
    projectionYears, equityDividendMethod, equityDividendPayoutRatio, equityDividendFixedAmount, equityDividendManualByYear,
    equityBuybackMethod, equityBuybackFixedAmount, equityBuybackPctNetIncome, equityBuybackManualByYear,
    equitySharesReissuedMethod, equitySharesReissuedFixedAmount, equitySharesReissuedManualByYear,
    equityIssuanceMethod, equityIssuanceFixedAmount, equityIssuanceManualByYear,
    equityOptionProceedsMethod, equityOptionProceedsFixedAmount, equityOptionProceedsManualByYear,
    equityEsppMethod, equityEsppFixedAmount, equityEsppManualByYear,
    projNiByYear, projRevByYear, sbcProjByYear, histEquity,
    equitySbcMethod, equityManualSbcByYear, equitySbcPctRevenue,
  ]);

  // ── Merged balance per year: historical = BS value, projected = engine ────
  const getCS  = (y: string) => projectionYears.includes(y) ? (engineResult?.commonStockByYear[y]      ?? histEquity.commonStockAll[y] ?? 0) : (histEquity.commonStockAll[y] ?? 0);
  const getAPIC = (y: string) => projectionYears.includes(y) ? (engineResult?.apicByYear[y]             ?? histEquity.apicAll[y] ?? 0) : (histEquity.apicAll[y] ?? 0);
  const getTS  = (y: string) => projectionYears.includes(y) ? (engineResult?.treasuryStockByYear[y]    ?? histEquity.treasuryAll[y] ?? 0) : (histEquity.treasuryAll[y] ?? 0);
  const getRE  = (y: string) => projectionYears.includes(y) ? (engineResult?.retainedEarningsByYear[y] ?? histEquity.retainedEarningsAll[y] ?? 0) : (histEquity.retainedEarningsAll[y] ?? 0);
  const getTE  = (y: string) => getCS(y) + getAPIC(y) + getTS(y) + getRE(y);

  // ── CFS financing summary ─────────────────────────────────────────────────
  const cffByYear = useMemo(() => {
    if (!engineResult) return {} as Record<string, number>;
    return projectionYears.reduce<Record<string, number>>((acc, y) => {
      acc[y] = (engineResult.cffDividendsByYear[y] ?? 0)
             + (engineResult.cffBuybacksByYear[y]  ?? 0)
             + (engineResult.cffIssuancesByYear[y]  ?? 0);
      return acc;
    }, {});
  }, [engineResult, projectionYears]);

  // ─── Rendering ─────────────────────────────────────────────────────────────

  // Empty state
  if (projectionYears.length === 0) {
    return (
      <div className="text-[10px] text-slate-500 text-center py-4">
        Add projection years to see the equity roll-forward.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-slate-200">Equity Roll-Forward</h3>
          <p className="text-[9px] text-slate-500 mt-0.5">Common Stock · APIC · Treasury · Retained Earnings</p>
        </div>
        {equityRollforwardConfirmed && (
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
            ✓ Active
          </span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-700/50">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-slate-800/60">
              <th className="px-3 py-2 text-left text-slate-400 font-medium" style={{ minWidth: "130px" }}>Equity Account</th>
              {allDisplayYears.map((y) => {
                const isHist = !projectionYears.includes(y);
                return (
                  <th key={y} className={`px-3 py-2 text-right font-medium whitespace-nowrap ${isHist ? "text-amber-400/70" : "text-slate-300"}`}>
                    {y}{isHist ? "A" : "E"}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {/* ── Common Stock ────────────────────────────────────── */}
            <tr className="border-t border-slate-700/50 bg-slate-800/20">
              <td className="px-3 py-2 text-slate-200 font-medium">Common Stock</td>
              {allDisplayYears.map((y) => {
                const v = getCS(y);
                const isProj = projectionYears.includes(y);
                return (
                  <td key={y} className={`px-3 py-2 text-right font-mono ${isProj ? "text-violet-200" : "text-slate-300"}`}>
                    {fmt(v, unit)}
                  </td>
                );
              })}
            </tr>
            {engineResult && (
              <>
                <DriverRow label="  + Issuances" allDisplayYears={allDisplayYears} projectionYears={projectionYears} engineValueByYear={engineResult.issuancesByYear} histValueByYear={histDrivers.dividends} color="text-emerald-400" sign={1} unit={unit} />
                <DriverRow label="  + Option proceeds" allDisplayYears={allDisplayYears} projectionYears={projectionYears} engineValueByYear={engineResult.optionProceedsByYear} color="text-emerald-400" sign={1} unit={unit} />
              </>
            )}

            {/* ── APIC ─────────────────────────────────────────────── */}
            <tr className="border-t border-slate-700/50 bg-slate-800/20">
              <td className="px-3 py-2 text-slate-200 font-medium">APIC</td>
              {allDisplayYears.map((y) => {
                const v = getAPIC(y);
                const isProj = projectionYears.includes(y);
                return (
                  <td key={y} className={`px-3 py-2 text-right font-mono ${isProj ? "text-violet-200" : "text-slate-300"}`}>
                    {fmt(v, unit)}
                  </td>
                );
              })}
            </tr>
            {engineResult && (
              <>
                <DriverRow label="  + SBC (auto)" allDisplayYears={allDisplayYears} projectionYears={projectionYears} engineValueByYear={engineResult.sbcImpactByYear} histValueByYear={histDrivers.sbc} color="text-emerald-400" sign={1} unit={unit} />
                <DriverRow label="  + Issuances" allDisplayYears={allDisplayYears} projectionYears={projectionYears} engineValueByYear={engineResult.issuancesByYear} color="text-emerald-400" sign={1} unit={unit} />
                <DriverRow label="  + Option proceeds" allDisplayYears={allDisplayYears} projectionYears={projectionYears} engineValueByYear={engineResult.optionProceedsByYear} color="text-emerald-400" sign={1} unit={unit} />
                <DriverRow label="  + ESPP" allDisplayYears={allDisplayYears} projectionYears={projectionYears} engineValueByYear={engineResult.esppByYear} color="text-emerald-400" sign={1} unit={unit} />
              </>
            )}

            {/* ── Treasury Stock ───────────────────────────────────── */}
            <tr className="border-t border-slate-700/50 bg-slate-800/20">
              <td className="px-3 py-2 text-slate-200 font-medium">Treasury Stock</td>
              {allDisplayYears.map((y) => {
                const v = getTS(y);
                const isProj = projectionYears.includes(y);
                return (
                  <td key={y} className={`px-3 py-2 text-right font-mono ${isProj ? "text-violet-200" : v < 0 ? "text-orange-300" : "text-slate-300"}`}>
                    {fmt(v, unit, v < 0)}
                  </td>
                );
              })}
            </tr>
            {engineResult && (
              <>
                <DriverRow label="  − Buybacks" allDisplayYears={allDisplayYears} projectionYears={projectionYears} engineValueByYear={engineResult.buybacksByYear} histValueByYear={Object.fromEntries(Object.entries(histDrivers.buybacks).map(([k, v]) => [k, Math.abs(v)]))} color="text-orange-400" sign={-1} unit={unit} />
                <DriverRow label="  + Reissued" allDisplayYears={allDisplayYears} projectionYears={projectionYears} engineValueByYear={engineResult.reissuedByYear} color="text-emerald-400" sign={1} unit={unit} />
              </>
            )}

            {/* ── Retained Earnings ────────────────────────────────── */}
            <tr className="border-t border-slate-700/50 bg-slate-800/20">
              <td className="px-3 py-2 text-slate-200 font-medium">Retained Earnings</td>
              {allDisplayYears.map((y) => {
                const v = getRE(y);
                const isProj = projectionYears.includes(y);
                return (
                  <td key={y} className={`px-3 py-2 text-right font-mono ${isProj ? "text-violet-200" : v < 0 ? "text-orange-300" : "text-slate-300"}`}>
                    {fmt(v, unit, v < 0)}
                  </td>
                );
              })}
            </tr>
            {engineResult && (
              <>
                <DriverRow
                  label="  + Net Income"
                  allDisplayYears={allDisplayYears}
                  projectionYears={projectionYears}
                  engineValueByYear={projNiByYear}
                  histValueByYear={Object.fromEntries(Object.entries(histDrivers.netIncome).map(([k, v]) => [k, Math.abs(v)]))}
                  color="text-emerald-400"
                  sign={1}
                  unit={unit}
                />
                <DriverRow
                  label="  − Dividends"
                  allDisplayYears={allDisplayYears}
                  projectionYears={projectionYears}
                  engineValueByYear={engineResult.dividendsByYear}
                  histValueByYear={Object.fromEntries(Object.entries(histDrivers.dividends).map(([k, v]) => [k, Math.abs(v)]))}
                  color="text-orange-400"
                  sign={-1}
                  unit={unit}
                />
              </>
            )}

            {/* ── Total Equity ─────────────────────────────────────── */}
            <tr className="border-t-2 border-slate-600/60 bg-slate-800/40">
              <td className="px-3 py-2.5 text-slate-100 font-bold">Total Equity</td>
              {allDisplayYears.map((y) => {
                const te = getTE(y);
                const isProj = projectionYears.includes(y);
                return (
                  <td key={y} className={`px-3 py-2.5 text-right font-mono font-bold ${isProj ? (te < 0 ? "text-orange-300" : "text-violet-100") : (te < 0 ? "text-orange-300" : "text-slate-100")}`}>
                    {fmt(te, unit, te < 0)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* CFS impact summary — table layout matching the equity roll-forward above */}
      {engineResult && projectionYears.length > 0 && (() => {
        const rows: { label: string; byYear: Record<string, number>; color: string; sign: 1 | -1 }[] = ([
          { label: "− Dividends",        byYear: engineResult.cffDividendsByYear,  color: "text-orange-400",  sign: -1 as const },
          { label: "− Share buybacks",   byYear: engineResult.cffBuybacksByYear,   color: "text-orange-400",  sign: -1 as const },
          { label: "+ Equity issuances", byYear: engineResult.issuancesByYear,     color: "text-emerald-400", sign:  1 as const },
          { label: "+ Option proceeds",  byYear: engineResult.optionProceedsByYear,color: "text-emerald-400", sign:  1 as const },
          { label: "+ ESPP proceeds",    byYear: engineResult.esppByYear,          color: "text-emerald-400", sign:  1 as const },
        ] as const).filter((r) => projectionYears.some((y) => Math.abs(r.byYear[y] ?? 0) > 0));

        const netByYear: Record<string, number> = {};
        for (const y of projectionYears) {
          netByYear[y] = (engineResult.cffDividendsByYear[y] ?? 0)
                       + (engineResult.cffBuybacksByYear[y] ?? 0)
                       + (engineResult.cffIssuancesByYear[y] ?? 0)
                       + (engineResult.optionProceedsByYear[y] ?? 0)
                       + (engineResult.esppByYear[y] ?? 0);
        }

        return (
          <div className="overflow-x-auto rounded-lg border border-slate-700/50">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-slate-800/60 border-b border-slate-700/50">
                  <th className="px-3 py-2 text-left text-slate-400 font-medium" style={{ minWidth: "130px" }}>
                    CFS — Financing
                  </th>
                  {projectionYears.map((y) => (
                    <th key={y} className="px-3 py-2 text-right font-medium whitespace-nowrap text-slate-300">
                      {y}E
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-t border-slate-700/30">
                    <td className="px-3 py-1.5 text-slate-400">{row.label}</td>
                    {projectionYears.map((y) => {
                      const v = row.byYear[y] ?? 0;
                      const display = Math.abs(v) < 0.01 ? "—" : (
                        row.sign === -1
                          ? `(${fmt(Math.abs(v), unit)})`
                          : `+${fmt(v, unit)}`
                      );
                      return (
                        <td key={y} className={`px-3 py-1.5 text-right font-mono ${Math.abs(v) < 0.01 ? "text-slate-600" : row.color}`}>
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Net row */}
                <tr className="border-t border-slate-600/50 bg-slate-800/30">
                  <td className="px-3 py-2 text-slate-300 font-semibold">Net CFF impact</td>
                  {projectionYears.map((y) => {
                    const net = netByYear[y] ?? 0;
                    return (
                      <td key={y} className={`px-3 py-2 text-right font-mono font-semibold ${net < 0 ? "text-orange-300" : "text-emerald-300"}`}>
                        {net >= 0 ? `+${fmt(net, unit)}` : `(${fmt(Math.abs(net), unit)})`}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
            <p className="px-3 py-1.5 text-[9px] text-slate-600 border-t border-slate-700/30">
              These amounts flow into CFS → Cash from Financing in the next modeling step.
            </p>
          </div>
        );
      })()}

      {/* Guardrails */}
      <div className="text-[9px] text-slate-600 space-y-0.5 border-t border-slate-700/30 pt-2">
        <p>• Hist columns (A) = stored BS values. Forecast columns (E) = engine output.</p>
        <p>• Driver sub-rows only show when non-zero.</p>
        <p>• RE = prior RE + Net Income − Dividends (auto-derived).</p>
        <p>• Treasury Stock is negative equity — buybacks make it more negative.</p>
      </div>
    </div>
  );
}
