/**
 * Total D&A by projection year — same basis as Non-operating & Schedules
 * (PP&E roll-forward + optional intangibles amortization).
 */

import type { Row } from "@/types/finance";
import type { CurrencyUnit } from "@/store/useModelStore";
import { displayToStored } from "@/lib/currency-utils";
import {
  computeCapexDaSchedule,
  computeCapexDaScheduleByBucket,
  computeProjectedCapexByYear,
} from "@/lib/capex-da-engine";
import { computeIntangiblesAmortSchedule } from "@/lib/intangibles-amort-engine";
import { CAPEX_DEFAULT_BUCKET_IDS } from "@/lib/capex-defaults";

export type ScheduleTotalDandaInput = {
  projectionYears: string[];
  lastHistoricYear: string;
  /** Same revenue basis as Forecast Drivers / Non-operating preview */
  revenueByYear: Record<string, number>;
  balanceSheet: Row[];
  cashFlow: Row[];
  currencyUnit: CurrencyUnit;
  capexForecastMethod: "pct_revenue" | "manual" | "growth";
  capexPctRevenue: number;
  capexManualByYear: Record<string, number> | undefined;
  capexGrowthPct: number;
  capexTimingConvention: "mid" | "start" | "end";
  ppeUsefulLifeSingle: number | undefined;
  capexSplitByBucket: boolean;
  capexCustomBucketIds: string[] | undefined;
  capexBucketAllocationPct: Record<string, number> | undefined;
  ppeUsefulLifeByBucket: Record<string, number> | undefined;
  capexHelperPpeByBucketByYear: Record<string, Record<string, number>> | undefined;
  capexModelIntangibles: boolean;
  intangiblesAmortizationLifeYears: number | undefined;
  intangiblesForecastMethod: "pct_revenue" | "manual" | "pct_capex" | undefined;
  intangiblesPctRevenue: number | undefined;
  intangiblesManualByYear: Record<string, number> | undefined;
  intangiblesPctOfCapex: number | undefined;
};

export function computeScheduleTotalDandaByYear(input: ScheduleTotalDandaInput): Record<string, number> {
  const {
    projectionYears,
    lastHistoricYear,
    revenueByYear,
    balanceSheet,
    cashFlow,
    currencyUnit,
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
  } = input;

  const out: Record<string, number> = {};
  if (projectionYears.length === 0 || !lastHistoricYear) return out;

  const lastHistPPE = balanceSheet.find((r) => r.id === "ppe")?.values?.[lastHistoricYear] ?? 0;
  const lastHistCapex = cashFlow.find((r) => r.id === "capex")?.values?.[lastHistoricYear] ?? 0;
  const lastHistIntangibles =
    balanceSheet.find((r) => r.id === "intangible_assets")?.values?.[lastHistoricYear] ?? 0;

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

  if (capexSplitByBucket) {
    const allBucketIds = [...CAPEX_DEFAULT_BUCKET_IDS, ...(capexCustomBucketIds ?? [])];
    const landDisplay = lastHistoricYear && capexHelperPpeByBucketByYear?.["cap_b1"]?.[lastHistoricYear];
    const initialLand =
      landDisplay != null && typeof landDisplay === "number" && !Number.isNaN(landDisplay)
        ? displayToStored(landDisplay, currencyUnit)
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
  } else {
    const daOut = computeCapexDaSchedule(capexEngineInput);
    dandaByYear = daOut.dandaByYear;
  }

  const intangiblesOutput =
    capexModelIntangibles && intangiblesAmortizationLifeYears && intangiblesAmortizationLifeYears > 0
      ? computeIntangiblesAmortSchedule({
          projectionYears,
          lastHistIntangibles,
          additionsMethod: intangiblesForecastMethod ?? "pct_revenue",
          pctRevenue: intangiblesPctRevenue ?? 0,
          manualByYear: intangiblesManualByYear ?? {},
          pctOfCapex: intangiblesPctOfCapex ?? 0,
          capexByYear: totalCapexByYear,
          revenueByYear,
          lifeYears: intangiblesAmortizationLifeYears,
          timingConvention: capexTimingConvention,
        })
      : null;

  for (const y of projectionYears) {
    const depAm = (dandaByYear[y] ?? 0) + (intangiblesOutput?.amortByYear[y] ?? 0);
    if (Number.isFinite(depAm)) out[y] = depAm;
  }

  return out;
}
