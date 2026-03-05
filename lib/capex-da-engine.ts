/**
 * Capex & D&A — Projection engine.
 * Computes projected Capex, Depreciation & Amortization, and Ending PP&E from schedule config.
 * Does not write to store; used by the schedule card and BS Build Excel preview.
 */

export type CapexEngineInput = {
  projectionYears: string[];
  revenueByYear: Record<string, number>;
  lastHistPPE: number;
  lastHistCapex: number;
  method: "pct_revenue" | "manual" | "growth";
  pctRevenue: number;
  manualByYear: Record<string, number>;
  growthPct: number;
  timingConvention: "mid" | "start" | "end";
  usefulLifeYears: number;
};

export type CapexEngineOutput = {
  capexByYear: Record<string, number>;
  dandaByYear: Record<string, number>;
  ppeByYear: Record<string, number>;
};

/**
 * Timing factor: share of that year's new Capex that is depreciated in the same year.
 * - mid: 0.5 (half year)
 * - start: 1
 * - end: 0
 */
function timingFactor(timing: "mid" | "start" | "end"): number {
  switch (timing) {
    case "mid": return 0.5;
    case "start": return 1;
    case "end": return 0;
    default: return 0.5;
  }
}

/**
 * Compute projected Capex by year from method and inputs.
 */
export function computeProjectedCapexByYear(input: CapexEngineInput): Record<string, number> {
  const { projectionYears, revenueByYear, lastHistCapex, method, pctRevenue, manualByYear, growthPct } = input;
  const result: Record<string, number> = {};
  // CFS stores capex as negative; use absolute value so growth and display are positive in BS Build
  let prevCapex = Math.abs(lastHistCapex);
  for (const y of projectionYears) {
    if (method === "pct_revenue") {
      const rev = revenueByYear[y] ?? 0;
      result[y] = rev * (pctRevenue / 100);
    } else if (method === "manual") {
      result[y] = manualByYear[y] ?? 0;
    } else {
      // growth
      result[y] = prevCapex * (1 + growthPct / 100);
      prevCapex = result[y];
    }
  }
  return result;
}

/**
 * Compute D&A and PP&E rollforward.
 * Straight-line: D&A = (Beginning PP&E / useful life) + (New Capex * timing factor / useful life).
 * Ending PP&E = Beginning PP&E + Capex - D&A.
 */
export function computeCapexDaSchedule(input: CapexEngineInput): CapexEngineOutput {
  const capexByYear = computeProjectedCapexByYear(input);
  const { projectionYears, lastHistPPE, timingConvention, usefulLifeYears } = input;
  const factor = timingFactor(timingConvention);
  const life = Math.max(0.5, usefulLifeYears);

  const dandaByYear: Record<string, number> = {};
  const ppeByYear: Record<string, number> = {};
  let begPPE = lastHistPPE;
  for (const y of projectionYears) {
    const capex = capexByYear[y] ?? 0;
    const depOnOpening = begPPE / life;
    const depOnNew = capex * (factor / life);
    const danda = depOnOpening + depOnNew;
    const endPPE = begPPE + capex - danda;
    dandaByYear[y] = Math.max(0, danda);
    ppeByYear[y] = Math.max(0, endPPE);
    begPPE = ppeByYear[y];
  }
  return { capexByYear, dandaByYear, ppeByYear };
}

/** Per-bucket schedule: Beginning, Capex, D&A, End by year */
export type CapexBucketSchedule = {
  beginningByYear: Record<string, number>;
  capexByYear: Record<string, number>;
  dandaByYear: Record<string, number>;
  endByYear: Record<string, number>;
};

export type CapexEngineInputBucketed = {
  projectionYears: string[];
  totalCapexByYear: Record<string, number>;
  lastHistPPE: number;
  timingConvention: "mid" | "start" | "end";
  bucketIds: string[];
  allocationPct: Record<string, number>;
  usefulLifeByBucket: Record<string, number>;
  /** Land (cap_b1) balance from last historical year; kept constant in projections. No allocation % applied to Land. */
  initialLandBalance?: number;
};

const LAND_BUCKET_ID = "cap_b1";

export type CapexEngineOutputBucketed = {
  byBucket: Record<string, CapexBucketSchedule>;
  totalCapexByYear: Record<string, number>;
  totalDandaByYear: Record<string, number>;
  totalPpeByYear: Record<string, number>;
};

/**
 * Compute per-bucket PP&E rollforward with timing convention.
 * - Total Capex ($) = given per year (e.g. 2% of revenue). Allocated by weights to non-Land buckets only.
 * - Land: no allocation; Beg = End = initialLandBalance (constant); Capex = 0; D&A = 0.
 * - Other buckets: allocation % applies to full total Capex; weights sum to 100% across non-Land so allocated $ sum to total Capex.
 */
export function computeCapexDaScheduleByBucket(input: CapexEngineInputBucketed): CapexEngineOutputBucketed {
  const {
    projectionYears,
    totalCapexByYear,
    lastHistPPE,
    timingConvention,
    bucketIds,
    allocationPct,
    usefulLifeByBucket,
    initialLandBalance = 0,
  } = input;
  const factor = timingFactor(timingConvention);

  const nonLandIds = bucketIds.filter((id) => id !== LAND_BUCKET_ID);
  const allocationSumNonLand = nonLandIds.reduce((s, id) => s + (allocationPct[id] ?? 0), 0) || 100;
  const depreciableOpening = Math.max(0, lastHistPPE - initialLandBalance);

  const byBucket: Record<string, CapexBucketSchedule> = {};
  const totalDandaByYear: Record<string, number> = {};
  const totalPpeByYear: Record<string, number> = {};

  for (const id of bucketIds) {
    const beginningByYear: Record<string, number> = {};
    const capexByYear: Record<string, number> = {};
    const dandaByYear: Record<string, number> = {};
    const endByYear: Record<string, number> = {};

    if (id === LAND_BUCKET_ID) {
      for (const y of projectionYears) {
        beginningByYear[y] = initialLandBalance;
        capexByYear[y] = 0;
        dandaByYear[y] = 0;
        endByYear[y] = initialLandBalance;
      }
      byBucket[id] = { beginningByYear, capexByYear, dandaByYear, endByYear };
      for (const y of projectionYears) {
        totalPpeByYear[y] = (totalPpeByYear[y] ?? 0) + initialLandBalance;
      }
      continue;
    }

    const pct = (allocationPct[id] ?? 0) / allocationSumNonLand;
    const life = Math.max(0, usefulLifeByBucket[id] ?? 0);
    let beg = depreciableOpening * pct;

    for (const y of projectionYears) {
      const capex = (totalCapexByYear[y] ?? 0) * pct;
      beginningByYear[y] = beg;
      capexByYear[y] = capex;

      let danda = 0;
      if (life > 0) {
        const depOnOpening = beg / life;
        const depOnNew = capex * (factor / life);
        danda = depOnOpening + depOnNew;
      }
      const end = beg + capex - danda;
      dandaByYear[y] = Math.max(0, danda);
      endByYear[y] = Math.max(0, end);
      beg = endByYear[y];
    }
    byBucket[id] = { beginningByYear, capexByYear, dandaByYear, endByYear };

    for (const y of projectionYears) {
      totalDandaByYear[y] = (totalDandaByYear[y] ?? 0) + dandaByYear[y];
      totalPpeByYear[y] = (totalPpeByYear[y] ?? 0) + endByYear[y];
    }
  }

  return {
    byBucket,
    totalCapexByYear: { ...totalCapexByYear },
    totalDandaByYear,
    totalPpeByYear,
  };
}
