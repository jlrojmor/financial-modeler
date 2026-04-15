/**
 * Equity Roll-Forward Engine
 *
 * Pure function that computes projected BS equity line balances for every
 * forecast year, given user-configured equity drivers and projected IS/CFS inputs.
 *
 * IB treatment:
 *   Common Stock(t)  = Common Stock(t-1) + Issuances_par(t) + Option_par(t)
 *   APIC(t)          = APIC(t-1) + SBC(t) + Issuances_above_par(t) + Option_above_par(t) + ESPP(t)
 *   Treasury(t)      = Treasury(t-1) − Buybacks(t) + Reissued(t)   [treasury is negative equity]
 *   RE(t)            = RE(t-1) + NetIncome(t) − Dividends(t)
 *   Dividends(t)     → CFS financing outflow
 *   Buybacks(t)      → CFS financing outflow
 *   Issuances(t) + Option proceeds(t) + ESPP(t) → CFS financing inflow
 *
 * All values in stored units (base currency, same as BS/IS row values).
 * Par value for option exercises / issuances: assumed negligible — all proceeds → APIC.
 * (This is standard for modeling purposes; par value is typically $0.001/share.)
 */

export type EquityDividendMethod = "none" | "payout_ratio" | "fixed_amount" | "manual_by_year";
export type EquityBuybackMethod  = "none" | "fixed_amount" | "pct_net_income" | "pct_fcf" | "manual_by_year";
export type EquityIssuanceMethod = "none" | "fixed_amount" | "manual_by_year";
export type EquityOptionMethod   = "none" | "fixed_amount" | "pct_revenue" | "manual_by_year";
export type EquityEsppMethod     = "none" | "fixed_amount" | "manual_by_year";
export type EquityReissuedMethod = "none" | "fixed_amount" | "manual_by_year";

export interface EquityRollforwardConfig {
  // Dividends
  dividendMethod:        EquityDividendMethod;
  dividendPayoutRatio:   number;                        // % of NI, e.g. 30
  dividendFixedAmount:   number;                        // stored units
  dividendManualByYear:  Record<string, number>;

  // Share repurchases / buybacks
  buybackMethod:         EquityBuybackMethod;
  buybackFixedAmount:    number;
  buybackPctNetIncome:   number;
  buybackManualByYear:   Record<string, number>;

  // Shares reissued from treasury
  reissuedMethod:        EquityReissuedMethod;
  reissuedFixedAmount:   number;
  reissuedManualByYear:  Record<string, number>;

  // New equity issuances (IPO / follow-on / private placement)
  issuanceMethod:        EquityIssuanceMethod;
  issuanceFixedAmount:   number;
  issuanceManualByYear:  Record<string, number>;

  // Stock option exercise proceeds
  optionProceedsMethod:       EquityOptionMethod;
  optionProceedsFixedAmount:  number;
  optionProceedsManualByYear: Record<string, number>;

  // ESPP (Employee Stock Purchase Plan) proceeds
  esppMethod:            EquityEsppMethod;
  esppFixedAmount:       number;
  esppManualByYear:      Record<string, number>;
}

export interface EquityRollforwardInputs {
  config: EquityRollforwardConfig;
  projectionYears: string[];
  /** Net Income by year (stored units, positive = profit). */
  netIncomeByYear: Record<string, number>;
  /** Free Cash Flow by year: CFO − CapEx (stored units). Used for pct_fcf buyback method. */
  fcfByYear: Record<string, number>;
  /** Revenue by year (stored units). Used for pct_revenue option proceeds method. */
  revenueByYear: Record<string, number>;
  /**
   * SBC expense by year (stored units, positive amount).
   * Auto-sourced from sbcBreakdowns in the store; passed in so engine stays pure.
   */
  sbcByYear: Record<string, number>;
  /** Last historical BS balance for each equity account (stored units). */
  lastHistCommonStock:    number;
  lastHistApic:           number;
  lastHistTreasuryStock:  number;  // already negative (treasury is contra-equity)
  lastHistRetainedEarnings: number;
}

export interface EquityRollforwardResult {
  /** Absolute balance each year. */
  commonStockByYear:      Record<string, number>;
  apicByYear:             Record<string, number>;
  treasuryStockByYear:    Record<string, number>;   // negative value (contra-equity)
  retainedEarningsByYear: Record<string, number>;

  /** Year-over-year driver amounts (for waterfall display). */
  dividendsByYear:        Record<string, number>;   // positive = amount paid
  buybacksByYear:         Record<string, number>;   // positive = amount repurchased
  reissuedByYear:         Record<string, number>;   // positive = amount reissued
  issuancesByYear:        Record<string, number>;   // positive = gross proceeds
  sbcImpactByYear:        Record<string, number>;   // positive = SBC → APIC
  optionProceedsByYear:   Record<string, number>;   // positive = cash inflow / APIC increase
  esppByYear:             Record<string, number>;   // positive = cash inflow / APIC increase

  /** CFS financing flows (positive = inflow, negative = outflow). */
  cffDividendsByYear:     Record<string, number>;   // negative (outflow)
  cffBuybacksByYear:      Record<string, number>;   // negative (outflow)
  cffIssuancesByYear:     Record<string, number>;   // positive (inflow) — equity_issued + options + espp
}

/** Default config: all methods none / flat. */
export function defaultEquityRollforwardConfig(): EquityRollforwardConfig {
  return {
    dividendMethod:        "none",
    dividendPayoutRatio:   30,
    dividendFixedAmount:   0,
    dividendManualByYear:  {},
    buybackMethod:         "none",
    buybackFixedAmount:    0,
    buybackPctNetIncome:   0,
    buybackManualByYear:   {},
    reissuedMethod:        "none",
    reissuedFixedAmount:   0,
    reissuedManualByYear:  {},
    issuanceMethod:        "none",
    issuanceFixedAmount:   0,
    issuanceManualByYear:  {},
    optionProceedsMethod:       "none",
    optionProceedsFixedAmount:  0,
    optionProceedsManualByYear: {},
    esppMethod:            "none",
    esppFixedAmount:       0,
    esppManualByYear:      {},
  };
}

// ─── Core engine ──────────────────────────────────────────────────────────────

export function computeEquityRollforward(inputs: EquityRollforwardInputs): EquityRollforwardResult {
  const {
    config,
    projectionYears,
    netIncomeByYear,
    fcfByYear,
    revenueByYear,
    sbcByYear,
    lastHistCommonStock,
    lastHistApic,
    lastHistTreasuryStock,
    lastHistRetainedEarnings,
  } = inputs;

  const commonStockByYear:      Record<string, number> = {};
  const apicByYear:             Record<string, number> = {};
  const treasuryStockByYear:    Record<string, number> = {};
  const retainedEarningsByYear: Record<string, number> = {};
  const dividendsByYear:        Record<string, number> = {};
  const buybacksByYear:         Record<string, number> = {};
  const reissuedByYear:         Record<string, number> = {};
  const issuancesByYear:        Record<string, number> = {};
  const sbcImpactByYear:        Record<string, number> = {};
  const optionProceedsByYear:   Record<string, number> = {};
  const esppByYear:             Record<string, number> = {};
  const cffDividendsByYear:     Record<string, number> = {};
  const cffBuybacksByYear:      Record<string, number> = {};
  const cffIssuancesByYear:     Record<string, number> = {};

  let prevCS  = lastHistCommonStock;
  let prevAPIC = lastHistApic;
  let prevTS   = lastHistTreasuryStock;
  let prevRE   = lastHistRetainedEarnings;

  for (const y of projectionYears) {
    const ni  = netIncomeByYear[y] ?? 0;
    const fcf = fcfByYear[y] ?? 0;
    const rev = revenueByYear[y] ?? 0;
    const sbc = Math.abs(sbcByYear[y] ?? 0); // SBC is positive amount

    // ── Dividends ──────────────────────────────────────────────────
    let divAmount = 0;
    switch (config.dividendMethod) {
      case "payout_ratio":
        divAmount = Math.max(0, ni) * (config.dividendPayoutRatio / 100);
        break;
      case "fixed_amount":
        divAmount = Math.max(0, config.dividendFixedAmount);
        break;
      case "manual_by_year":
        divAmount = Math.max(0, config.dividendManualByYear[y] ?? 0);
        break;
      case "none":
      default:
        divAmount = 0;
    }

    // ── Buybacks ───────────────────────────────────────────────────
    let buybackAmount = 0;
    switch (config.buybackMethod) {
      case "fixed_amount":
        buybackAmount = Math.max(0, config.buybackFixedAmount);
        break;
      case "pct_net_income":
        buybackAmount = Math.max(0, ni) * (config.buybackPctNetIncome / 100);
        break;
      case "pct_fcf":
        // buybackPctNetIncome field is reused for both pct_ni and pct_fcf to avoid a separate store field
        buybackAmount = Math.max(0, fcf) * (config.buybackPctNetIncome / 100);
        break;
      case "manual_by_year":
        buybackAmount = Math.max(0, config.buybackManualByYear[y] ?? 0);
        break;
      case "none":
      default:
        buybackAmount = 0;
    }

    // ── Shares reissued from treasury ──────────────────────────────
    let reissuedAmount = 0;
    switch (config.reissuedMethod) {
      case "fixed_amount":
        reissuedAmount = Math.max(0, config.reissuedFixedAmount);
        break;
      case "manual_by_year":
        reissuedAmount = Math.max(0, config.reissuedManualByYear[y] ?? 0);
        break;
      case "none":
      default:
        reissuedAmount = 0;
    }

    // ── New equity issuances ───────────────────────────────────────
    let issuanceAmount = 0;
    switch (config.issuanceMethod) {
      case "fixed_amount":
        issuanceAmount = Math.max(0, config.issuanceFixedAmount);
        break;
      case "manual_by_year":
        issuanceAmount = Math.max(0, config.issuanceManualByYear[y] ?? 0);
        break;
      case "none":
      default:
        issuanceAmount = 0;
    }

    // ── Stock option proceeds ──────────────────────────────────────
    let optAmount = 0;
    switch (config.optionProceedsMethod) {
      case "fixed_amount":
        optAmount = Math.max(0, config.optionProceedsFixedAmount);
        break;
      case "pct_revenue":
        // reusing optionProceedsFixedAmount as the % value when method is pct_revenue
        optAmount = rev * (config.optionProceedsFixedAmount / 100);
        break;
      case "manual_by_year":
        optAmount = Math.max(0, config.optionProceedsManualByYear[y] ?? 0);
        break;
      case "none":
      default:
        optAmount = 0;
    }

    // ── ESPP proceeds ─────────────────────────────────────────────
    let esppAmount = 0;
    switch (config.esppMethod) {
      case "fixed_amount":
        esppAmount = Math.max(0, config.esppFixedAmount);
        break;
      case "manual_by_year":
        esppAmount = Math.max(0, config.esppManualByYear[y] ?? 0);
        break;
      case "none":
      default:
        esppAmount = 0;
    }

    // ── Roll balances forward ──────────────────────────────────────
    // Common Stock: par increases with issuances + option exercises (we treat all as APIC for simplicity)
    const newCS = prevCS; // par value negligible — stays flat unless user sets issuances explicitly

    // APIC: receives SBC, issuances (above par = all of it), option proceeds, ESPP
    const newAPIC = prevAPIC + sbc + issuanceAmount + optAmount + esppAmount;

    // Treasury Stock: decreases (more negative) with buybacks, increases (less negative) with reissued
    const newTS = prevTS - buybackAmount + reissuedAmount;

    // Retained Earnings: + NI - Dividends (no share buyback hit; treasury handles that separately)
    const newRE = prevRE + ni - divAmount;

    // Store results
    commonStockByYear[y]      = newCS;
    apicByYear[y]             = newAPIC;
    treasuryStockByYear[y]    = newTS;
    retainedEarningsByYear[y] = newRE;

    // Driver amounts for waterfall display
    dividendsByYear[y]        = divAmount;
    buybacksByYear[y]         = buybackAmount;
    reissuedByYear[y]         = reissuedAmount;
    issuancesByYear[y]        = issuanceAmount;
    sbcImpactByYear[y]        = sbc;
    optionProceedsByYear[y]   = optAmount;
    esppByYear[y]             = esppAmount;

    // CFS financing flows
    cffDividendsByYear[y]  = -divAmount;                        // outflow
    cffBuybacksByYear[y]   = -buybackAmount;                    // outflow
    cffIssuancesByYear[y]  = issuanceAmount + optAmount + esppAmount; // inflow

    // Advance prior-year values
    prevCS   = newCS;
    prevAPIC = newAPIC;
    prevTS   = newTS;
    prevRE   = newRE;
  }

  return {
    commonStockByYear,
    apicByYear,
    treasuryStockByYear,
    retainedEarningsByYear,
    dividendsByYear,
    buybacksByYear,
    reissuedByYear,
    issuancesByYear,
    sbcImpactByYear,
    optionProceedsByYear,
    esppByYear,
    cffDividendsByYear,
    cffBuybacksByYear,
    cffIssuancesByYear,
  };
}

// ─── Historical analysis helpers ──────────────────────────────────────────────

/**
 * Compute historical payout ratios and average from IS/CFS data.
 * Returns {year → pct} and average pct (0 if no data).
 */
export function computeHistoricalPayoutRatios(
  historicYears: string[],
  netIncomeByYear: Record<string, number>,
  dividendsByYear: Record<string, number>
): { ratioByYear: Record<string, number>; average: number } {
  const ratioByYear: Record<string, number> = {};
  let sum = 0;
  let count = 0;
  for (const y of historicYears) {
    const ni  = netIncomeByYear[y] ?? 0;
    const div = Math.abs(dividendsByYear[y] ?? 0);
    if (ni > 0) {
      const ratio = (div / ni) * 100;
      ratioByYear[y] = ratio;
      sum += ratio;
      count++;
    }
  }
  return { ratioByYear, average: count > 0 ? sum / count : 0 };
}

/**
 * Compute historical buyback rates as % of NI and % of FCF.
 */
export function computeHistoricalBuybackRatios(
  historicYears: string[],
  netIncomeByYear: Record<string, number>,
  fcfByYear: Record<string, number>,
  buybacksByYear: Record<string, number>
): {
  pctNiByYear: Record<string, number>;
  pctFcfByYear: Record<string, number>;
  avgPctNi: number;
  avgPctFcf: number;
} {
  const pctNiByYear:  Record<string, number> = {};
  const pctFcfByYear: Record<string, number> = {};
  let sumNi = 0; let cntNi = 0;
  let sumFcf = 0; let cntFcf = 0;

  for (const y of historicYears) {
    const bb  = Math.abs(buybacksByYear[y] ?? 0);
    const ni  = netIncomeByYear[y] ?? 0;
    const fcf = fcfByYear[y] ?? 0;
    if (ni > 0)  { pctNiByYear[y]  = (bb / ni)  * 100; sumNi  += pctNiByYear[y];  cntNi++;  }
    if (fcf > 0) { pctFcfByYear[y] = (bb / fcf) * 100; sumFcf += pctFcfByYear[y]; cntFcf++; }
  }

  return {
    pctNiByYear,
    pctFcfByYear,
    avgPctNi:  cntNi  > 0 ? sumNi  / cntNi  : 0,
    avgPctFcf: cntFcf > 0 ? sumFcf / cntFcf : 0,
  };
}
