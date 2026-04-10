/**
 * Deterministic advisory copy for the debt schedule builder (not LLM).
 * Debt math stays in debt-schedule-engine.ts only.
 */

import type { DebtTrancheConfigV1 } from "@/types/debt-schedule-v1";

export type DebtScheduleAdvisory = {
  title: string;
  source: string;
  confidencePct: number;
  reason: string;
};

export function getDebtScheduleGlobalAdvisory(): DebtScheduleAdvisory {
  return {
    title: "Interest basis",
    source: "Built-in guidance",
    confidencePct: 78,
    reason:
      "Average balance is standard in DCF and LBO models because interest accrues on debt outstanding through the period. Ending balance is acceptable when you intentionally simplify or when draws/repayments are concentrated at period end.",
  };
}

export function getDebtScheduleTrancheAdvisory(tranche: DebtTrancheConfigV1): DebtScheduleAdvisory[] {
  const out: DebtScheduleAdvisory[] = [];
  if (tranche.interestComputationBasis === "ending_balance") {
    out.push({
      title: "Basis",
      source: "Built-in guidance",
      confidencePct: 65,
      reason:
        "Ending-balance interest understates expense versus average debt when balances move within the year. Prefer average balance unless you have a specific reason to simplify.",
    });
  }
  if (tranche.interestRateMethod === "manual_by_year") {
    out.push({
      title: "Rates",
      source: "Built-in guidance",
      confidencePct: 70,
      reason:
        "Manual-by-year rates fit step-ups, refinancing, or management guidance. Use a single fixed rate when the borrowing cost is stable across the forecast.",
    });
  }
  if (tranche.trancheType === "revolver") {
    out.push({
      title: "Revolver",
      source: "Built-in guidance",
      confidencePct: 60,
      reason:
        "Revolver draws and paydowns are manual in this version. Future phases can add cash-driven draws, minimum cash, and sweep — not circular in v1.",
    });
  }
  const draws = Object.values(tranche.drawsByYear).reduce((a, b) => a + (b ?? 0), 0);
  const rep =
    Object.values(tranche.mandatoryRepaymentByYear).reduce((a, b) => a + (b ?? 0), 0) +
    Object.values(tranche.optionalRepaymentByYear).reduce((a, b) => a + (b ?? 0), 0);
  if (draws > 0 && rep === 0 && tranche.isEnabled) {
    out.push({
      title: "Sanity check",
      source: "Rule-based flag",
      confidencePct: 55,
      reason:
        "New borrowing is entered with no repayments on this tranche — confirm that is intentional (bullet maturity outside the horizon, or fill repayments).",
    });
  }
  return out;
}
