/**
 * Intangibles & Amortization — Projection engine (BS Build only).
 * Roll-forward: Beginning, Additions, Amortization, Ending.
 * Does not write to store; used by Capex & D&A card and BS Build Excel preview.
 */

export type IntangiblesAmortInput = {
  projectionYears: string[];
  /** Last historical year ending balance of Intangible assets, net (from BS). Stored units. */
  lastHistIntangibles: number;
  additionsMethod: "pct_revenue" | "manual" | "pct_capex";
  pctRevenue: number;
  manualByYear: Record<string, number>;
  pctOfCapex: number;
  /** Total Capex by year (stored units). Used when additionsMethod === "pct_capex". */
  capexByYear: Record<string, number>;
  revenueByYear: Record<string, number>;
  lifeYears: number;
  timingConvention: "mid" | "start" | "end";
};

export type IntangiblesAmortOutput = {
  beginningByYear: Record<string, number>;
  additionsByYear: Record<string, number>;
  amortByYear: Record<string, number>;
  endByYear: Record<string, number>;
};

function timingFactor(timing: "mid" | "start" | "end"): number {
  switch (timing) {
    case "mid": return 0.5;
    case "start": return 1;
    case "end": return 0;
    default: return 0.5;
  }
}

/**
 * Compute projected Intangibles additions by year from method and inputs.
 */
function computeAdditionsByYear(input: IntangiblesAmortInput): Record<string, number> {
  const {
    projectionYears,
    additionsMethod,
    pctRevenue,
    manualByYear,
    pctOfCapex,
    capexByYear,
    revenueByYear,
  } = input;
  const result: Record<string, number> = {};
  for (const y of projectionYears) {
    if (additionsMethod === "pct_revenue") {
      const rev = revenueByYear[y] ?? 0;
      result[y] = rev * (pctRevenue / 100);
    } else if (additionsMethod === "manual") {
      result[y] = manualByYear[y] ?? 0;
    } else {
      // pct_capex
      const capex = capexByYear[y] ?? 0;
      result[y] = capex * (pctOfCapex / 100);
    }
  }
  return result;
}

/**
 * Compute Intangibles roll-forward: Beginning, Additions, Amortization, Ending.
 * Amort[t] = (Beg[t] + timingWeight * Additions[t]) / lifeYears, capped so End >= 0.
 */
export function computeIntangiblesAmortSchedule(input: IntangiblesAmortInput): IntangiblesAmortOutput | null {
  const { projectionYears, lastHistIntangibles, lifeYears, timingConvention } = input;
  if (lifeYears <= 0) return null;

  const additionsByYear = computeAdditionsByYear(input);
  const factor = timingFactor(timingConvention);

  const beginningByYear: Record<string, number> = {};
  const amortByYear: Record<string, number> = {};
  const endByYear: Record<string, number> = {};

  let beg = lastHistIntangibles;
  for (const y of projectionYears) {
    const additions = additionsByYear[y] ?? 0;
    beginningByYear[y] = beg;

    const amortRaw = (beg + factor * additions) / lifeYears;
    const maxAmort = beg + additions;
    const amort = Math.max(0, Math.min(amortRaw, maxAmort));
    amortByYear[y] = amort;

    const end = Math.max(0, beg + additions - amort);
    endByYear[y] = end;
    beg = end;
  }

  return {
    beginningByYear,
    additionsByYear,
    amortByYear,
    endByYear,
  };
}
