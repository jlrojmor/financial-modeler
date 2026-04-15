"use client";

/**
 * Equity Roll-Forward Builder Panel — Area 2 of "Other BS Items" tab.
 *
 * Fixes vs v1:
 *  - NumInput uses local draft string state → typing decimals, clearing, etc. all work
 *  - Each SectionCard has its own "Done ✓" collapse button
 *  - SBC detection reads sbcBreakdowns + IS opex_sbc row + CFS sbc row (IB-standard)
 *  - Option proceeds uses separate pct field (not reusing fixed amount)
 *  - Scroll position preserved on confirm (no page-jump)
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, Sparkles, Loader2, Info, Lock, Check } from "lucide-react";
import { useModelStore } from "@/store/useModelStore";
import type { CurrencyUnit } from "@/store/useModelStore";
import { storedToDisplay, getUnitLabel } from "@/lib/currency-utils";
import { computeEquityRollforward, defaultEquityRollforwardConfig } from "@/lib/equity-rollforward-engine";
import { computeProjectedEbitByYear, computeProjectedRevCogs } from "@/lib/projected-ebit";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, unit: CurrencyUnit): string {
  if (v == null || !isFinite(v)) return "—";
  const d = storedToDisplay(v, unit);
  const lbl = getUnitLabel(unit);
  const abs = Math.abs(d).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return d < 0 ? `(${abs} ${lbl})` : `${abs} ${lbl}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

// ─── Controlled number input — local draft state prevents typing issues ───────

function NumInput({
  value,
  onChange,
  suffix,
  placeholder = "0",
  min = 0,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  placeholder?: string;
  min?: number;
}) {
  const [draft, setDraft] = useState<string>(value === 0 ? "" : String(value));

  // Sync when external value changes (e.g. AI suggestion applied)
  useEffect(() => {
    setDraft(value === 0 ? "" : String(value));
  }, [value]);

  const commit = useCallback(
    (s: string) => {
      const parsed = parseFloat(s);
      if (!isNaN(parsed) && parsed >= min) {
        onChange(parsed);
        setDraft(parsed === 0 ? "" : String(parsed));
      } else if (s === "" || s === "-") {
        onChange(0);
        setDraft("");
      } else {
        // Revert to last valid
        setDraft(value === 0 ? "" : String(value));
      }
    },
    [min, onChange, value]
  );

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit(draft); }}
        className="w-28 bg-slate-800/60 border border-slate-600/60 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
      />
      {suffix && <span className="text-[10px] text-slate-400">{suffix}</span>}
    </div>
  );
}

// ─── Method button ────────────────────────────────────────────────────────────

function MethodBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded text-[10px] font-medium border transition-colors ${
        active
          ? "bg-violet-600/30 border-violet-500/60 text-violet-200"
          : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:text-slate-200 hover:border-slate-500"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Manual-by-year table ─────────────────────────────────────────────────────

function ManualTable({
  years,
  valueByYear,
  onChange,
  unit,
}: {
  years: string[];
  valueByYear: Record<string, number>;
  onChange: (year: string, v: number) => void;
  unit: CurrencyUnit;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px]">
        <thead>
          <tr>
            {years.map((y) => (
              <th key={y} className="px-2 pb-1 text-center text-slate-400 font-medium">{y}E</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {years.map((y) => (
              <td key={y} className="px-1 py-0.5">
                <NumInput
                  value={valueByYear[y] ?? 0}
                  onChange={(v) => onChange(y, v)}
                />
              </td>
            ))}
          </tr>
          <tr>
            {years.map((y) => (
              <td key={y} className="px-2 pt-0.5 text-center text-slate-500">
                {fmt(valueByYear[y] ?? 0, unit)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── IB info note ─────────────────────────────────────────────────────────────

function IbNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1.5 bg-slate-800/30 border border-slate-700/40 rounded px-2.5 py-2 text-[10px] text-slate-400">
      <Info className="h-3 w-3 mt-0.5 text-slate-500 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

// ─── Historical analysis mini-table ──────────────────────────────────────────

function HistAnalysisRow({
  label,
  values,
  format,
  years,
}: {
  label: string;
  values: Record<string, number | undefined>;
  format: (v: number) => string;
  years: string[];
}) {
  return (
    <div className="flex items-center gap-3 text-[10px]">
      <span className="text-slate-500 w-28 shrink-0">{label}</span>
      <div className="flex gap-3 flex-wrap">
        {years.slice(-4).map((y) => (
          <span key={y} className="text-slate-300">
            <span className="text-slate-500 mr-0.5">{y}:</span>
            {values[y] != null ? format(values[y]!) : "—"}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Section card with header toggle + Done button ────────────────────────────

type SectionId = "re" | "dividends" | "buybacks" | "issuances" | "sbc" | "options" | "espp";

const SECTION_LABELS: Record<SectionId, string> = {
  re:        "A — Retained Earnings",
  dividends: "B — Dividends",
  buybacks:  "C — Share Repurchases",
  issuances: "D — New Equity Issuances",
  sbc:       "E — SBC → APIC",
  options:   "F — Stock Option Proceeds",
  espp:      "G — ESPP Proceeds",
};

function SectionCard({
  id,
  openSection,
  setOpenSection,
  badge,
  children,
}: {
  id: SectionId;
  openSection: SectionId | null;
  setOpenSection: (v: SectionId | null) => void;
  badge?: string;
  children: React.ReactNode;
}) {
  const open = openSection === id;
  return (
    <div className="border border-slate-700/60 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpenSection(open ? null : id)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/60 hover:bg-slate-800/90 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-300">{SECTION_LABELS[id]}</span>
          {badge && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
              {badge}
            </span>
          )}
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 py-4 bg-slate-900/40 space-y-3">
          {children}
          {/* Per-section Done button — collapses without scrolling */}
          <div className="pt-2 border-t border-slate-700/40">
            <button
              type="button"
              onClick={() => setOpenSection(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-700/60 hover:bg-slate-700 border border-slate-600/60 text-[10px] text-slate-200 font-medium transition-colors"
            >
              <Check className="h-3 w-3 text-emerald-400" />
              Done — collapse
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function EquityRollforwardPanel() {
  const meta            = useModelStore((s) => s.meta);
  const balanceSheet    = useModelStore((s) => s.balanceSheet);
  const cashFlow        = useModelStore((s) => s.cashFlow);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const sbcBreakdowns   = useModelStore((s) => s.sbcBreakdowns ?? {});
  const danaBreakdowns  = useModelStore((s) => s.danaBreakdowns ?? {});
  const companyContext  = useModelStore((s) => s.companyContext);

  const revenueForecastConfigV1 = useModelStore((s) => s.revenueForecastConfigV1);
  const revenueForecastTreeV1   = useModelStore((s) => s.revenueForecastTreeV1);
  const revenueProjectionConfig = useModelStore((s) => s.revenueProjectionConfig);
  const cogsForecastConfigV1    = useModelStore((s) => s.cogsForecastConfigV1);
  const opexForecastConfigV1    = useModelStore((s) => s.opexForecastConfigV1);

  // Equity store fields
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

  const setEquityDividendMethod        = useModelStore((s) => s.setEquityDividendMethod);
  const setEquityDividendPayoutRatio   = useModelStore((s) => s.setEquityDividendPayoutRatio);
  const setEquityDividendFixedAmount   = useModelStore((s) => s.setEquityDividendFixedAmount);
  const setEquityDividendManualByYear  = useModelStore((s) => s.setEquityDividendManualByYear);
  const setEquityBuybackMethod         = useModelStore((s) => s.setEquityBuybackMethod);
  const setEquityBuybackFixedAmount    = useModelStore((s) => s.setEquityBuybackFixedAmount);
  const setEquityBuybackPctNetIncome   = useModelStore((s) => s.setEquityBuybackPctNetIncome);
  const setEquityBuybackManualByYear   = useModelStore((s) => s.setEquityBuybackManualByYear);
  const setEquitySharesReissuedMethod  = useModelStore((s) => s.setEquitySharesReissuedMethod);
  const setEquitySharesReissuedFixedAmount = useModelStore((s) => s.setEquitySharesReissuedFixedAmount);
  const setEquitySharesReissuedManualByYear = useModelStore((s) => s.setEquitySharesReissuedManualByYear);
  const setEquityIssuanceMethod        = useModelStore((s) => s.setEquityIssuanceMethod);
  const setEquityIssuanceFixedAmount   = useModelStore((s) => s.setEquityIssuanceFixedAmount);
  const setEquityIssuanceManualByYear  = useModelStore((s) => s.setEquityIssuanceManualByYear);
  const setEquityOptionProceedsMethod  = useModelStore((s) => s.setEquityOptionProceedsMethod);
  const setEquityOptionProceedsFixedAmount = useModelStore((s) => s.setEquityOptionProceedsFixedAmount);
  const setEquityOptionProceedsManualByYear = useModelStore((s) => s.setEquityOptionProceedsManualByYear);
  const setEquityEsppMethod            = useModelStore((s) => s.setEquityEsppMethod);
  const setEquityEsppFixedAmount       = useModelStore((s) => s.setEquityEsppFixedAmount);
  const setEquityEsppManualByYear      = useModelStore((s) => s.setEquityEsppManualByYear);
  const setEquitySbcMethod             = useModelStore((s) => s.setEquitySbcMethod);
  const setEquityManualSbcByYear       = useModelStore((s) => s.setEquityManualSbcByYear);
  const setEquitySbcPctRevenue         = useModelStore((s) => s.setEquitySbcPctRevenue);
  const setEquityRollforwardConfirmed  = useModelStore((s) => s.setEquityRollforwardConfirmed);

  const unit           = (meta?.currencyUnit ?? "millions") as CurrencyUnit;
  const historicYears  = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const lastHistYear   = historicYears[historicYears.length - 1] ?? null;

  const [openSection, setOpenSection] = useState<SectionId | null>(null);
  const [divAiLoading, setDivAiLoading] = useState(false);
  const [divAiResult, setDivAiResult] = useState<{ method: string; value: number; rationale: string } | null>(null);
  const [bbAiLoading, setBbAiLoading] = useState(false);
  const [bbAiResult, setBbAiResult] = useState<{ method: string; value: number; rationale: string } | null>(null);
  const [sbcAiLoading, setSbcAiLoading] = useState(false);
  const [sbcAiResult, setSbcAiResult] = useState<{ method: string; value: number; rationale: string; confidence: string } | null>(null);

  // ── Historical equity BS ──────────────────────────────────────────────────
  const histEquity = useMemo(() => {
    const findBs = (tt: string) => balanceSheet?.find((r) => r.taxonomyType === tt) ?? null;
    const val = (r: ReturnType<typeof findBs>, y: string | null) =>
      y && r?.values?.[y] != null ? (r.values[y] ?? 0) : 0;
    return {
      commonStock:      val(findBs("equity_common_stock"),      lastHistYear),
      apic:             val(findBs("equity_apic"),              lastHistYear),
      treasury:         val(findBs("equity_treasury_stock"),    lastHistYear),
      retainedEarnings: val(findBs("equity_retained_earnings"), lastHistYear),
    };
  }, [balanceSheet, lastHistYear]);

  // ── SBC detection: reads auto sources only (no silent fallback) ──────────
  const sbcData = useMemo(() => {
    const cfRows = cashFlow ?? [];
    const isRows = incomeStatement ?? [];

    // Source 1: sbcBreakdowns (IS schedule builder — most authoritative for projections)
    const projFromBreakdowns: Record<string, number> = {};
    let hasBreakdowns = false;
    for (const y of projectionYears) {
      let sum = 0;
      for (const bucket of Object.values(sbcBreakdowns)) {
        sum += Math.abs(bucket[y] ?? 0);
      }
      if (sum > 0) hasBreakdowns = true;
      projFromBreakdowns[y] = sum;
    }

    // Source 2: IS opex_sbc row
    const isRow = isRows.find((r) => r.taxonomyType === "opex_sbc") ?? null;

    // Source 3: CFS cfo_sbc / sbc row
    const cfsRow =
      cfRows.find((r) => r.taxonomyType === "cfo_sbc") ??
      cfRows.find((r) => r.id === "sbc") ??
      null;

    // Historical values from IS or CFS (prefer IS)
    const histByYear: Record<string, number> = {};
    for (const y of historicYears) {
      const fromIs  = Math.abs(isRow?.values?.[y] ?? 0);
      const fromCfs = Math.abs(cfsRow?.values?.[y] ?? 0);
      histByYear[y] = fromIs > 0 ? fromIs : fromCfs;
    }

    const lastHistSbc = histByYear[lastHistYear ?? ""] ?? 0;

    // Auto-source projected values (no flat fallback — that is now an explicit user choice)
    const autoProjByYear: Record<string, number> = {};
    for (const y of projectionYears) {
      if (hasBreakdowns) {
        autoProjByYear[y] = projFromBreakdowns[y] ?? 0;
      } else {
        const fromIs  = Math.abs(isRow?.values?.[y] ?? 0);
        const fromCfs = Math.abs(cfsRow?.values?.[y] ?? 0);
        autoProjByYear[y] = fromIs > 0 ? fromIs : fromCfs;
      }
    }

    return {
      histByYear,
      autoProjByYear,
      hasBreakdowns,
      lastHistSbc,
      hasHistSbc: Object.values(histByYear).some((v) => v > 0),
      source: hasBreakdowns ? "schedule" : isRow ? "income_statement" : cfsRow ? "cash_flow" : "none",
    };
  }, [cashFlow, incomeStatement, sbcBreakdowns, historicYears, projectionYears, lastHistYear]);

  // ── Resolved SBC by year (respects user's method choice) ─────────────────
  // resolvedSbcByYear is declared after projRevByYear below

  // ── Historical CFS: dividends, buybacks, equity issued ────────────────────
  const histCfs = useMemo(() => {
    const cfRows = cashFlow ?? [];
    const isRows = incomeStatement ?? [];
    const findCf = (tt: string, id?: string) =>
      cfRows.find((r) => r.taxonomyType === tt) ??
      (id ? cfRows.find((r) => r.id === id) : null) ??
      null;
    const findIs = (tt: string) => isRows.find((r) => r.taxonomyType === tt) ?? null;
    const getVals = (r: ReturnType<typeof findCf>) =>
      historicYears.reduce<Record<string, number>>((acc, y) => {
        acc[y] = r?.values?.[y] != null ? Math.abs(r.values[y]!) : 0;
        return acc;
      }, {});

    const niRow  = findIs("calc_net_income");
    const divRow = findCf("cff_dividends", "dividends");
    const bbRow  = findCf("cff_share_repurchases", "share_repurchases");
    const eqRow  = findCf("cff_equity_issued", "equity_issued");

    return {
      netIncome:    getVals(niRow ?? null),
      dividends:    getVals(divRow),
      buybacks:     getVals(bbRow),
      equityIssued: getVals(eqRow),
    };
  }, [cashFlow, incomeStatement, historicYears]);

  // ── Historical payout / buyback analytics ─────────────────────────────────
  const histAnalytics = useMemo(() => {
    const payoutByYear: Record<string, number> = {};
    const bbPctNiByYear: Record<string, number> = {};
    let payoutSum = 0; let payoutCnt = 0;
    let bbSum = 0; let bbCnt = 0;
    for (const y of historicYears) {
      const ni  = histCfs.netIncome[y] ?? 0;
      const div = histCfs.dividends[y] ?? 0;
      const bb  = histCfs.buybacks[y] ?? 0;
      if (ni > 0) {
        payoutByYear[y]   = (div / ni) * 100;
        bbPctNiByYear[y]  = (bb / ni) * 100;
        payoutSum += payoutByYear[y]; payoutCnt++;
        bbSum += bbPctNiByYear[y]; bbCnt++;
      }
    }
    return {
      payoutByYear,
      avgPayout: payoutCnt > 0 ? payoutSum / payoutCnt : 0,
      bbPctNiByYear,
      avgBbPctNi: bbCnt > 0 ? bbSum / bbCnt : 0,
    };
  }, [historicYears, histCfs]);

  // ── Historical SBC % of Revenue analytics ────────────────────────────────
  const histSbcRevAnalytics = useMemo(() => {
    const isRows = incomeStatement ?? [];
    const revRow = isRows.find((r) => r.id === "rev");
    const sbcPctByYear: Record<string, number> = {};
    let sum = 0; let cnt = 0;
    for (const y of historicYears) {
      const sbc = sbcData.histByYear[y] ?? 0;
      const rev = Math.abs(revRow?.values?.[y] ?? 0);
      if (sbc > 0 && rev > 0) {
        sbcPctByYear[y] = (sbc / rev) * 100;
        sum += sbcPctByYear[y]; cnt++;
      }
    }
    const histRevByYear: Record<string, number> = {};
    for (const y of historicYears) histRevByYear[y] = Math.abs(revRow?.values?.[y] ?? 0);
    return {
      sbcPctByYear,
      avgPct: cnt > 0 ? sum / cnt : 0,
      histRevByYear,
    };
  }, [historicYears, incomeStatement, sbcData.histByYear]);

  // ── All statements memo ───────────────────────────────────────────────────
  const allStatements = useMemo(
    () => ({ incomeStatement: incomeStatement ?? [], balanceSheet: balanceSheet ?? [], cashFlow: cashFlow ?? [] }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  // ── Projected Revenue (needed for pct_revenue option proceeds + SBC) ───────
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

  // ── Resolved SBC by year (method-aware, declared after projRevByYear) ─────
  const resolvedSbcByYear = useMemo((): Record<string, number> => {
    switch (equitySbcMethod) {
      case "flat_hist": {
        const result: Record<string, number> = {};
        for (const y of projectionYears) result[y] = sbcData.lastHistSbc;
        return result;
      }
      case "pct_revenue": {
        const result: Record<string, number> = {};
        for (const y of projectionYears) {
          const rev = projRevByYear[y] ?? 0;
          result[y] = rev * (equitySbcPctRevenue / 100);
        }
        return result;
      }
      case "manual_by_year": {
        const result: Record<string, number> = {};
        for (const y of projectionYears) result[y] = Math.max(0, equityManualSbcByYear[y] ?? 0);
        return result;
      }
      case "auto":
      default:
        return sbcData.autoProjByYear;
    }
  }, [equitySbcMethod, equityManualSbcByYear, equitySbcPctRevenue, projRevByYear, sbcData.autoProjByYear, sbcData.lastHistSbc, projectionYears]);

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

  // ── Engine result (live preview) ──────────────────────────────────────────
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
      sbcByYear:       resolvedSbcByYear,
      lastHistCommonStock:      histEquity.commonStock,
      lastHistApic:             histEquity.apic,
      lastHistTreasuryStock:    histEquity.treasury,
      lastHistRetainedEarnings: histEquity.retainedEarnings,
    });
  }, [projectionYears, equityDividendMethod, equityDividendPayoutRatio, equityDividendFixedAmount, equityDividendManualByYear, equityBuybackMethod, equityBuybackFixedAmount, equityBuybackPctNetIncome, equityBuybackManualByYear, equitySharesReissuedMethod, equitySharesReissuedFixedAmount, equitySharesReissuedManualByYear, equityIssuanceMethod, equityIssuanceFixedAmount, equityIssuanceManualByYear, equityOptionProceedsMethod, equityOptionProceedsFixedAmount, equityOptionProceedsManualByYear, equityEsppMethod, equityEsppFixedAmount, equityEsppManualByYear, projNiByYear, projRevByYear, resolvedSbcByYear, histEquity]);

  // ── AI: Dividend ──────────────────────────────────────────────────────────
  const handleDivAiSuggest = async () => {
    setDivAiLoading(true); setDivAiResult(null);
    try {
      const res = await fetch("/api/ai/dividend-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyContext,
          historicalYears: historicYears,
          historicalDivAmounts: historicYears.map((y) => histCfs.dividends[y] ?? 0),
          historicalNetIncome: historicYears.map((y) => histCfs.netIncome[y] ?? 0),
          historicalPayoutRatios: historicYears.map((y) => histAnalytics.payoutByYear[y] ?? null),
          currencyUnit: unit,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { suggestion?: { method: string; value: number; rationale: string } };
        if (data.suggestion) setDivAiResult(data.suggestion);
      }
    } catch { /* ignore */ }
    setDivAiLoading(false);
  };

  const applyDivAi = () => {
    if (!divAiResult) return;
    if (divAiResult.method === "payout_ratio") { setEquityDividendMethod("payout_ratio"); setEquityDividendPayoutRatio(divAiResult.value); }
    else if (divAiResult.method === "fixed_amount") { setEquityDividendMethod("fixed_amount"); setEquityDividendFixedAmount(divAiResult.value); }
  };

  // ── AI: Buyback ───────────────────────────────────────────────────────────
  const handleBbAiSuggest = async () => {
    setBbAiLoading(true); setBbAiResult(null);
    try {
      const res = await fetch("/api/ai/buyback-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyContext,
          historicalYears: historicYears,
          historicalBuybackAmounts: historicYears.map((y) => histCfs.buybacks[y] ?? 0),
          historicalNetIncome: historicYears.map((y) => histCfs.netIncome[y] ?? 0),
          historicalBbPctNi: historicYears.map((y) => histAnalytics.bbPctNiByYear[y] ?? null),
          currencyUnit: unit,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { suggestion?: { method: string; value: number; rationale: string } };
        if (data.suggestion) setBbAiResult(data.suggestion);
      }
    } catch { /* ignore */ }
    setBbAiLoading(false);
  };

  const applyBbAi = () => {
    if (!bbAiResult) return;
    if (bbAiResult.method === "pct_net_income") { setEquityBuybackMethod("pct_net_income"); setEquityBuybackPctNetIncome(bbAiResult.value); }
    else if (bbAiResult.method === "pct_fcf") { setEquityBuybackMethod("pct_fcf"); setEquityBuybackPctNetIncome(bbAiResult.value); }
    else if (bbAiResult.method === "fixed_amount") { setEquityBuybackMethod("fixed_amount"); setEquityBuybackFixedAmount(bbAiResult.value); }
  };

  // ── AI: SBC ───────────────────────────────────────────────────────────────
  const handleSbcAiSuggest = async () => {
    setSbcAiLoading(true); setSbcAiResult(null);
    try {
      const res = await fetch("/api/ai/sbc-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyContext,
          historicalYears: historicYears,
          historicalSbcAmounts: historicYears.map((y) => sbcData.histByYear[y] ?? 0),
          historicalRevenue: historicYears.map((y) => histSbcRevAnalytics.histRevByYear[y] ?? 0),
          historicalSbcPctRev: historicYears.map((y) => histSbcRevAnalytics.sbcPctByYear[y] ?? null),
          currencyUnit: unit,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { suggestion?: { method: string; value: number; rationale: string; confidence: string } };
        if (data.suggestion) setSbcAiResult(data.suggestion);
      }
    } catch { /* ignore */ }
    setSbcAiLoading(false);
  };

  const applySbcAi = () => {
    if (!sbcAiResult) return;
    if (sbcAiResult.method === "pct_revenue") {
      setEquitySbcMethod("pct_revenue");
      setEquitySbcPctRevenue(sbcAiResult.value);
    } else if (sbcAiResult.method === "flat_hist") {
      setEquitySbcMethod("flat_hist");
    } else if (sbcAiResult.method === "manual_by_year") {
      setEquitySbcMethod("manual_by_year");
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const hasHistDividends  = historicYears.some((y) => (histCfs.dividends[y] ?? 0) > 0);
  const hasHistBuybacks   = historicYears.some((y) => (histCfs.buybacks[y] ?? 0) > 0);
  const hasHistIssuances  = historicYears.some((y) => (histCfs.equityIssued[y] ?? 0) > 0);

  // ─── Rendering ─────────────────────────────────────────────────────────────

  return (
    <div className="mt-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-gradient-to-r from-violet-500/40 to-transparent" />
        <span className="text-[11px] font-bold text-violet-300 uppercase tracking-wider px-2">
          Equity Roll-Forward
        </span>
        <div className="h-px flex-1 bg-gradient-to-l from-violet-500/40 to-transparent" />
      </div>

      <p className="text-[10px] text-slate-400 leading-relaxed">
        Configure each equity driver below. Common Stock, APIC, Treasury Stock, and Retained Earnings
        are projected from these schedules — not entered manually. Click any section to expand.
      </p>

      {/* Confirmed banner */}
      {equityRollforwardConfirmed && (
        <div className="flex items-center gap-2 bg-emerald-900/20 border border-emerald-500/30 rounded px-3 py-2">
          <span className="text-[10px] text-emerald-300 font-medium">✓ Equity roll-forward active</span>
          <button type="button" onClick={() => setEquityRollforwardConfirmed(false)} className="ml-auto text-[9px] text-slate-400 hover:text-slate-200">Edit</button>
        </div>
      )}

      {/* ── Section A — Retained Earnings ───────────────────────── */}
      <SectionCard id="re" openSection={openSection} setOpenSection={setOpenSection}>
        <IbNote text="RE(t) = RE(t-1) + Net Income(t) − Dividends(t). This is derived automatically — no manual input needed." />
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-slate-400 w-36 shrink-0">Opening ({lastHistYear ?? "—"})</span>
            <span className="text-slate-200 font-mono">{fmt(histEquity.retainedEarnings, unit)}</span>
          </div>
          {projectionYears.slice(0, 4).map((y) => (
            <div key={y} className="flex items-center gap-2 text-[10px]">
              <span className="text-slate-500 w-36 shrink-0">{y}E projected</span>
              <span className="text-violet-300 font-mono">
                {engineResult ? fmt(engineResult.retainedEarningsByYear[y] ?? null, unit) : "—"}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ── Section B — Dividends ────────────────────────────────── */}
      <SectionCard
        id="dividends"
        openSection={openSection}
        setOpenSection={setOpenSection}
        badge={equityDividendMethod !== "none" ? equityDividendMethod.replace(/_/g, " ") : undefined}
      >
        <IbNote text="Dividends reduce Retained Earnings and appear as a cash outflow in CFS → Financing. For most private companies, select None." />

        {hasHistDividends && (
          <div className="bg-slate-900/50 rounded px-3 py-2 space-y-1">
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Historical</p>
            <HistAnalysisRow label="Dividends paid" values={histCfs.dividends} format={(v) => fmt(v, unit)} years={historicYears} />
            <HistAnalysisRow label="Payout ratio" values={histAnalytics.payoutByYear} format={fmtPct} years={historicYears} />
            <p className="text-[9px] text-slate-500 mt-1">Avg payout: {fmtPct(histAnalytics.avgPayout)}</p>
          </div>
        )}

        {/* AI */}
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={handleDivAiSuggest} disabled={divAiLoading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-violet-700/30 hover:bg-violet-700/50 border border-violet-500/40 rounded text-[10px] text-violet-200 transition-colors disabled:opacity-60">
            {divAiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Suggest dividend policy
          </button>
          {divAiResult && (
            <button type="button" onClick={applyDivAi}
              className="text-[9px] px-2 py-1 bg-emerald-700/30 border border-emerald-500/40 rounded text-emerald-300 hover:bg-emerald-700/50">
              Apply suggestion
            </button>
          )}
        </div>
        {divAiResult && (
          <div className="bg-violet-900/20 border border-violet-500/30 rounded px-3 py-2 text-[10px] text-slate-300">
            <span className="font-semibold text-violet-300">AI: </span>{divAiResult.rationale}
          </div>
        )}

        {/* Method */}
        <div className="flex flex-wrap gap-1.5">
          {(["none", "payout_ratio", "fixed_amount", "manual_by_year"] as const).map((m) => (
            <MethodBtn key={m} active={equityDividendMethod === m} onClick={() => setEquityDividendMethod(m)}>
              {m === "none" ? "None" : m === "payout_ratio" ? "% of Net Income" : m === "fixed_amount" ? "Fixed amount" : "Manual by year"}
            </MethodBtn>
          ))}
        </div>

        {equityDividendMethod === "payout_ratio" && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Payout ratio</span>
            <NumInput value={equityDividendPayoutRatio} onChange={setEquityDividendPayoutRatio} suffix="% of NI" />
          </div>
        )}
        {equityDividendMethod === "fixed_amount" && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Annual dividends</span>
            <NumInput value={equityDividendFixedAmount} onChange={setEquityDividendFixedAmount} suffix={getUnitLabel(unit)} />
          </div>
        )}
        {equityDividendMethod === "manual_by_year" && (
          <ManualTable years={projectionYears} valueByYear={equityDividendManualByYear} onChange={setEquityDividendManualByYear} unit={unit} />
        )}

        {equityDividendMethod !== "none" && engineResult && (
          <div className="text-[9px] text-slate-500 mt-1">
            <span className="text-slate-400">CFS outflow (all years):</span>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {projectionYears.map((y) => (
                <span key={y} className="text-orange-300">{y}: ({fmt(engineResult.dividendsByYear[y] ?? 0, unit)})</span>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Section C — Share Repurchases ────────────────────────── */}
      <SectionCard
        id="buybacks"
        openSection={openSection}
        setOpenSection={setOpenSection}
        badge={equityBuybackMethod !== "none" ? "active" : undefined}
      >
        <IbNote text="Buybacks increase Treasury Stock (more negative) and appear as a cash outflow in CFS → Financing. Typical for public companies with excess cash." />

        {hasHistBuybacks && (
          <div className="bg-slate-900/50 rounded px-3 py-2 space-y-1">
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Historical</p>
            <HistAnalysisRow label="Buybacks" values={histCfs.buybacks} format={(v) => fmt(v, unit)} years={historicYears} />
            <HistAnalysisRow label="% of NI" values={histAnalytics.bbPctNiByYear} format={fmtPct} years={historicYears} />
            <p className="text-[9px] text-slate-500 mt-1">Avg: {fmtPct(histAnalytics.avgBbPctNi)} of NI</p>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={handleBbAiSuggest} disabled={bbAiLoading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-violet-700/30 hover:bg-violet-700/50 border border-violet-500/40 rounded text-[10px] text-violet-200 transition-colors disabled:opacity-60">
            {bbAiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Suggest buyback program
          </button>
          {bbAiResult && (
            <button type="button" onClick={applyBbAi}
              className="text-[9px] px-2 py-1 bg-emerald-700/30 border border-emerald-500/40 rounded text-emerald-300 hover:bg-emerald-700/50">
              Apply suggestion
            </button>
          )}
        </div>
        {bbAiResult && (
          <div className="bg-violet-900/20 border border-violet-500/30 rounded px-3 py-2 text-[10px] text-slate-300">
            <span className="font-semibold text-violet-300">AI: </span>{bbAiResult.rationale}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {(["none", "fixed_amount", "pct_net_income", "pct_fcf", "manual_by_year"] as const).map((m) => (
            <MethodBtn key={m} active={equityBuybackMethod === m} onClick={() => setEquityBuybackMethod(m)}>
              {m === "none" ? "None" : m === "fixed_amount" ? "Fixed amount" : m === "pct_net_income" ? "% of NI" : m === "pct_fcf" ? "% of FCF" : "Manual by year"}
            </MethodBtn>
          ))}
        </div>

        {equityBuybackMethod === "fixed_amount" && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Annual buyback</span>
            <NumInput value={equityBuybackFixedAmount} onChange={setEquityBuybackFixedAmount} suffix={getUnitLabel(unit)} />
          </div>
        )}
        {(equityBuybackMethod === "pct_net_income" || equityBuybackMethod === "pct_fcf") && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">
              {equityBuybackMethod === "pct_net_income" ? "% of Net Income" : "% of Free Cash Flow"}
            </span>
            <NumInput value={equityBuybackPctNetIncome} onChange={setEquityBuybackPctNetIncome} suffix="%" />
          </div>
        )}
        {equityBuybackMethod === "manual_by_year" && (
          <ManualTable years={projectionYears} valueByYear={equityBuybackManualByYear} onChange={setEquityBuybackManualByYear} unit={unit} />
        )}

        {/* Shares reissued sub-section */}
        {equityBuybackMethod !== "none" && (
          <div className="mt-2 pt-3 border-t border-slate-700/40 space-y-2">
            <p className="text-[10px] text-slate-300 font-medium">Shares reissued from treasury</p>
            <IbNote text="Shares reissued reduce Treasury Stock (positive equity impact). Common for employee stock plans drawing on existing buyback pool." />
            <div className="flex flex-wrap gap-1.5">
              {(["none", "fixed_amount", "manual_by_year"] as const).map((m) => (
                <MethodBtn key={m} active={equitySharesReissuedMethod === m} onClick={() => setEquitySharesReissuedMethod(m)}>
                  {m === "none" ? "None" : m === "fixed_amount" ? "Fixed amount" : "Manual by year"}
                </MethodBtn>
              ))}
            </div>
            {equitySharesReissuedMethod === "fixed_amount" && (
              <NumInput value={equitySharesReissuedFixedAmount} onChange={setEquitySharesReissuedFixedAmount} suffix={getUnitLabel(unit)} />
            )}
            {equitySharesReissuedMethod === "manual_by_year" && (
              <ManualTable years={projectionYears} valueByYear={equitySharesReissuedManualByYear} onChange={setEquitySharesReissuedManualByYear} unit={unit} />
            )}
          </div>
        )}
      </SectionCard>

      {/* ── Section D — New Equity Issuances ─────────────────────── */}
      <SectionCard
        id="issuances"
        openSection={openSection}
        setOpenSection={setOpenSection}
        badge={equityIssuanceMethod !== "none" ? "active" : undefined}
      >
        <IbNote text="New equity raises (IPO, follow-on offerings, private placements) increase APIC and appear as CFS inflows. For most private companies with no planned raises, select None." />

        {hasHistIssuances && (
          <div className="bg-slate-900/50 rounded px-3 py-2 space-y-1">
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Historical equity raised</p>
            <HistAnalysisRow label="Equity issued" values={histCfs.equityIssued} format={(v) => fmt(v, unit)} years={historicYears} />
          </div>
        )}

        <div className="bg-slate-800/40 border border-slate-700/40 rounded px-2.5 py-2 text-[10px] text-slate-400 space-y-0.5">
          <p className="text-slate-300 font-medium text-[10px]">IB guidance</p>
          <p>• <span className="text-slate-300">Private companies</span>: select None unless a raise is planned.</p>
          <p>• <span className="text-slate-300">Pre-IPO / growth stage</span>: model known rounds as fixed amounts.</p>
          <p>• <span className="text-slate-300">Public companies</span>: typically 0 unless an ATM or follow-on is planned.</p>
          <p>• All proceeds flow to APIC (par value is negligible for modeling purposes).</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(["none", "fixed_amount", "manual_by_year"] as const).map((m) => (
            <MethodBtn key={m} active={equityIssuanceMethod === m} onClick={() => setEquityIssuanceMethod(m)}>
              {m === "none" ? "None" : m === "fixed_amount" ? "Fixed annual amount" : "Manual by year"}
            </MethodBtn>
          ))}
        </div>

        {equityIssuanceMethod === "fixed_amount" && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Annual proceeds</span>
            <NumInput value={equityIssuanceFixedAmount} onChange={setEquityIssuanceFixedAmount} suffix={getUnitLabel(unit)} />
          </div>
        )}
        {equityIssuanceMethod === "manual_by_year" && (
          <ManualTable years={projectionYears} valueByYear={equityIssuanceManualByYear} onChange={setEquityIssuanceManualByYear} unit={unit} />
        )}
      </SectionCard>

      {/* ── Section E — SBC → APIC ────────────────────────────────── */}
      <SectionCard id="sbc" openSection={openSection} setOpenSection={setOpenSection}
        badge={equitySbcMethod !== "auto" || Object.values(sbcData.autoProjByYear).some((v) => v > 0) ? "active" : undefined}>
        <div className="space-y-2">
          <IbNote text="SBC is a non-cash expense: it is added back in CFO and increases APIC when options vest. No cash changes hands. The cash received from employees exercising options is a separate item (Section F)." />

          {/* Source indicator */}
          <div className="flex items-start gap-1.5 text-[10px]">
            <Lock className="h-3 w-3 text-slate-500 mt-0.5 shrink-0" />
            <span className="text-slate-400">
              {sbcData.source === "schedule"
                ? "SBC pulled from your IS schedule. Auto mode uses this automatically."
                : sbcData.source === "income_statement"
                ? "SBC detected from Income Statement (opex_sbc row). Used in Auto mode."
                : sbcData.source === "cash_flow"
                ? "SBC detected from Cash Flow Statement (CFO add-back row). Used in Auto mode."
                : "No SBC detected in IS or CFS rows."}
            </span>
          </div>

          {/* Historical SBC */}
          {sbcData.hasHistSbc && (
            <div className="bg-slate-900/50 rounded px-3 py-2 space-y-1">
              <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Historical SBC (source: {sbcData.source})
              </p>
              <HistAnalysisRow
                label="SBC expense"
                values={sbcData.histByYear}
                format={(v) => fmt(v, unit)}
                years={historicYears}
              />
            </div>
          )}

          {/* Projection method selector */}
          <div className="space-y-1">
            <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Projection method</p>
            <div className="flex flex-wrap gap-1.5">
              {(["auto", "flat_hist", "pct_revenue", "manual_by_year"] as const).map((m) => (
                <MethodBtn key={m} active={equitySbcMethod === m} onClick={() => setEquitySbcMethod(m)}>
                  {m === "auto" ? "Auto (from IS schedule)" : m === "flat_hist" ? "Flat — last historical" : m === "pct_revenue" ? "% of Revenue" : "Manual by year"}
                </MethodBtn>
              ))}
            </div>
          </div>

          {/* AI suggestion button */}
          {sbcData.hasHistSbc && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSbcAiSuggest}
                disabled={sbcAiLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-violet-600/20 border border-violet-500/30 text-violet-300 text-[10px] hover:bg-violet-600/30 transition-colors disabled:opacity-50"
              >
                {sbcAiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Ask AI for best SBC method
              </button>
            </div>
          )}

          {/* AI result */}
          {sbcAiResult && (
            <div className="bg-violet-900/20 border border-violet-500/30 rounded px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3 w-3 text-violet-300 shrink-0" />
                <p className="text-[10px] font-semibold text-violet-200">
                  AI recommends: <span className="text-violet-100">
                    {sbcAiResult.method === "pct_revenue" ? `${sbcAiResult.value.toFixed(2)}% of revenue` :
                     sbcAiResult.method === "flat_hist" ? "Flat last historical" : "Manual by year"}
                  </span>
                  <span className="ml-2 text-[9px] text-violet-400">({sbcAiResult.confidence} confidence)</span>
                </p>
              </div>
              <p className="text-[10px] text-slate-300">{sbcAiResult.rationale}</p>
              <button
                type="button"
                onClick={applySbcAi}
                className="text-[10px] px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white transition-colors"
              >
                Apply this recommendation
              </button>
            </div>
          )}

          {/* Auto: show what was detected */}
          {equitySbcMethod === "auto" && (
            Object.values(sbcData.autoProjByYear).some((v) => v > 0) ? (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {projectionYears.map((y) => (
                  <span key={y} className="text-[10px]">
                    <span className="text-slate-500">{y}E: </span>
                    <span className="text-emerald-300 font-mono">+{fmt(sbcData.autoProjByYear[y] ?? 0, unit)} → APIC</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-amber-400/80 bg-amber-900/20 border border-amber-500/30 rounded px-2.5 py-2 space-y-1">
                <p className="font-medium">Auto: No projected SBC found in IS schedule or CFS rows.</p>
                <p>Options: (1) Configure SBC in <span className="text-amber-300">IS → Operating Expenses</span>, or (2) switch to <span className="text-amber-300">Flat — last historical</span> or <span className="text-amber-300">Manual</span> below.</p>
                {sbcData.hasHistSbc && (
                  <p>Last historical SBC: <span className="text-amber-200 font-mono">{fmt(sbcData.lastHistSbc, unit)}</span></p>
                )}
              </div>
            )
          )}

          {/* Flat hist */}
          {equitySbcMethod === "flat_hist" && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {projectionYears.map((y) => (
                  <span key={y} className="text-[10px]">
                    <span className="text-slate-500">{y}E: </span>
                    <span className="text-emerald-300 font-mono">+{fmt(sbcData.lastHistSbc, unit)} → APIC</span>
                  </span>
                ))}
              </div>
              <div className="text-[10px] text-amber-400/80 bg-amber-900/20 border border-amber-500/30 rounded px-2.5 py-2 space-y-1">
                <p className="font-medium">IB consistency note</p>
                <p>This adds <span className="text-amber-200">{fmt(sbcData.lastHistSbc, unit)}/yr</span> to APIC only. For a fully consistent 3-statement model, also project the same SBC in <span className="text-amber-300">IS → Operating Expenses</span> — it will then flow as an IS expense and a CFO add-back automatically.</p>
              </div>
            </div>
          )}

          {/* % of Revenue */}
          {equitySbcMethod === "pct_revenue" && (
            <div className="space-y-2">
              {/* Historical anchor */}
              {histSbcRevAnalytics.avgPct > 0 && (
                <div className="bg-slate-900/50 rounded px-3 py-2 space-y-1">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Historical SBC / Revenue</p>
                  <HistAnalysisRow
                    label="SBC / Rev"
                    values={histSbcRevAnalytics.sbcPctByYear}
                    format={(v) => `${v.toFixed(2)}%`}
                    years={historicYears}
                  />
                  <p className="text-[9px] text-slate-500 mt-1">Historical avg: {histSbcRevAnalytics.avgPct.toFixed(2)}%</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">SBC as % of Revenue</span>
                <NumInput
                  value={equitySbcPctRevenue}
                  onChange={setEquitySbcPctRevenue}
                  suffix="%"
                  placeholder={histSbcRevAnalytics.avgPct > 0 ? histSbcRevAnalytics.avgPct.toFixed(2) : "0"}
                />
                {histSbcRevAnalytics.avgPct > 0 && (
                  <button
                    type="button"
                    onClick={() => setEquitySbcPctRevenue(parseFloat(histSbcRevAnalytics.avgPct.toFixed(2)))}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                  >
                    Use avg ({histSbcRevAnalytics.avgPct.toFixed(2)}%)
                  </button>
                )}
              </div>
              {Object.keys(projRevByYear).length === 0 && (
                <p className="text-[9px] text-amber-400/80">Revenue projections not configured — set up Revenue in Forecast Drivers to use this method.</p>
              )}
              {Object.keys(projRevByYear).length > 0 && equitySbcPctRevenue > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {projectionYears.map((y) => {
                    const rev = projRevByYear[y] ?? 0;
                    const sbc = rev * (equitySbcPctRevenue / 100);
                    return (
                      <span key={y} className="text-[10px]">
                        <span className="text-slate-500">{y}E: </span>
                        <span className="text-emerald-300 font-mono">+{fmt(sbc, unit)} → APIC</span>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="text-[10px] text-amber-400/80 bg-amber-900/20 border border-amber-500/30 rounded px-2.5 py-2 space-y-1">
                <p className="font-medium">IB consistency note</p>
                <p>This adds SBC to APIC only. For a fully consistent 3-statement model, also project the same SBC in <span className="text-amber-300">IS → Operating Expenses</span> — it will then flow as an IS expense and a CFO add-back automatically.</p>
              </div>
            </div>
          )}

          {/* Manual by year */}
          {equitySbcMethod === "manual_by_year" && (
            <div className="space-y-2">
              <ManualTable
                years={projectionYears}
                valueByYear={equityManualSbcByYear}
                onChange={setEquityManualSbcByYear}
                unit={unit}
              />
              <div className="text-[10px] text-amber-400/80 bg-amber-900/20 border border-amber-500/30 rounded px-2.5 py-2 space-y-1">
                <p className="font-medium">IB consistency note</p>
                <p>These amounts increase APIC only. For a fully consistent 3-statement model, also enter the same SBC in <span className="text-amber-300">IS → Operating Expenses</span> — they will then flow as IS expenses and CFO add-backs.</p>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Section F — Stock Option Proceeds ────────────────────── */}
      <SectionCard
        id="options"
        openSection={openSection}
        setOpenSection={setOpenSection}
        badge={equityOptionProceedsMethod !== "none" ? "active" : undefined}
      >
        <IbNote text="Cash received when employees exercise stock options. This is different from the SBC grant expense — options are exercised later. Proceeds go to APIC and appear as a CFS inflow (Financing). Common for public companies and pre-IPO." />

        <div className="bg-slate-800/40 border border-slate-700/40 rounded px-2.5 py-2 text-[10px] text-slate-400 space-y-0.5">
          <p><span className="text-slate-300">Relationship to SBC:</span> SBC records the expense when options are granted. Option proceeds are received when employees actually exercise (sell at strike price). These are independent — both can be active simultaneously.</p>
          <p className="mt-1"><span className="text-slate-300">Typical range:</span> 0.5–2% of revenue for large public companies. Private companies: often None.</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(["none", "fixed_amount", "pct_revenue", "manual_by_year"] as const).map((m) => (
            <MethodBtn key={m} active={equityOptionProceedsMethod === m} onClick={() => setEquityOptionProceedsMethod(m)}>
              {m === "none" ? "None" : m === "fixed_amount" ? "Fixed amount" : m === "pct_revenue" ? "% of Revenue" : "Manual by year"}
            </MethodBtn>
          ))}
        </div>

        {equityOptionProceedsMethod === "fixed_amount" && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Annual proceeds</span>
            <NumInput value={equityOptionProceedsFixedAmount} onChange={setEquityOptionProceedsFixedAmount} suffix={getUnitLabel(unit)} />
          </div>
        )}
        {equityOptionProceedsMethod === "pct_revenue" && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400">% of Revenue</span>
              <NumInput value={equityOptionProceedsFixedAmount} onChange={setEquityOptionProceedsFixedAmount} suffix="%" />
            </div>
            {Object.keys(projRevByYear).length === 0 && (
              <p className="text-[9px] text-amber-400/80">Revenue projections not yet configured — set up Revenue in Forecast Drivers to enable this method.</p>
            )}
          </div>
        )}
        {equityOptionProceedsMethod === "manual_by_year" && (
          <ManualTable years={projectionYears} valueByYear={equityOptionProceedsManualByYear} onChange={setEquityOptionProceedsManualByYear} unit={unit} />
        )}
        {equityOptionProceedsMethod !== "none" && engineResult && (
          <div className="text-[9px] text-slate-500 mt-1">
            <span className="text-slate-400">APIC inflow (all years):</span>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {projectionYears.map((y) => (
                <span key={y} className="text-emerald-300">{y}: +{fmt(engineResult.optionProceedsByYear[y] ?? 0, unit)}</span>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Section G — ESPP Proceeds ─────────────────────────────── */}
      <SectionCard
        id="espp"
        openSection={openSection}
        setOpenSection={setOpenSection}
        badge={equityEsppMethod !== "none" ? "active" : undefined}
      >
        <IbNote text="ESPP (Employee Stock Purchase Plan): employees buy company stock at a discount. The proceeds go to APIC and are a CFS inflow under Financing. Typically 1–3% of total payroll. Private companies: select None." />

        <div className="bg-slate-800/40 border border-slate-700/40 rounded px-2.5 py-2 text-[10px] text-slate-400 space-y-0.5">
          <p><span className="text-slate-300">When to use:</span> Only if the company has an active ESPP. Most private companies do not.</p>
          <p><span className="text-slate-300">Public companies:</span> Check historical CFS for ESPP proceeds line — if present, use Fixed amount or Manual.</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(["none", "fixed_amount", "manual_by_year"] as const).map((m) => (
            <MethodBtn key={m} active={equityEsppMethod === m} onClick={() => setEquityEsppMethod(m)}>
              {m === "none" ? "None" : m === "fixed_amount" ? "Fixed amount" : "Manual by year"}
            </MethodBtn>
          ))}
        </div>

        {equityEsppMethod === "fixed_amount" && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Annual proceeds</span>
            <NumInput value={equityEsppFixedAmount} onChange={setEquityEsppFixedAmount} suffix={getUnitLabel(unit)} />
          </div>
        )}
        {equityEsppMethod === "manual_by_year" && (
          <ManualTable years={projectionYears} valueByYear={equityEsppManualByYear} onChange={setEquityEsppManualByYear} unit={unit} />
        )}
        {equityEsppMethod !== "none" && engineResult && (
          <div className="text-[9px] text-slate-500 mt-1">
            <span className="text-slate-400">APIC inflow (all years):</span>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {projectionYears.map((y) => (
                <span key={y} className="text-emerald-300">{y}: +{fmt(engineResult.esppByYear[y] ?? 0, unit)}</span>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Overall Confirm ────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => { setEquityRollforwardConfirmed(true); setOpenSection(null); }}
        className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold transition-colors"
      >
        ✓ Confirm & Apply Equity Roll-Forward
      </button>
    </div>
  );
}
