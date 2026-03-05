/**
 * Capex & D&A — Historical diagnostics (read-only).
 * Uses historical financials to compute Capex intensity, implied D&A, PP&E and Intangibles intensity.
 * No store writes; used only to guide the user in the Capex & D&A Schedule card.
 */

import type { Row } from "@/types/finance";
import { computeRowValue } from "./calculations";

export type CapexDiagnosticsInput = {
  incomeStatement: Row[];
  balanceSheet: Row[];
  cashFlow: Row[];
  historicalYears: string[];
  danaBreakdowns?: Record<string, number>;
};

export type CapexIntensityRow = {
  year: string;
  capex: number;
  revenue: number;
  capexPctRevenue: number | null;
};

export type PPEIntensityRow = {
  year: string;
  ppe: number;
  revenue: number;
  ppePctRevenue: number | null;
  cogs?: number;
  ppePctCogs?: number | null;
};

export type IntangiblesRow = {
  year: string;
  intangibles: number;
  revenue: number;
  intangiblesPctRevenue: number | null;
};

export type CapexDiagnostics = {
  capexIntensity: CapexIntensityRow[];
  recommendedCapexPctRevenue: number | null;
  capexTrend: "up" | "down" | "flat" | null;
  observedDandaByYear: Record<string, number>;
  hasObservedDanda: boolean;
  impliedDandaByYear: Record<string, number>;
  hasImpliedDanda: boolean;
  ppeIntensity: PPEIntensityRow[];
  intangiblesIntensity: IntangiblesRow[];
};

function getRevenue(year: string, incomeStatement: Row[], allStatements: CapexDiagnosticsInput): number {
  const revRow = incomeStatement.find((r) => r.id === "rev");
  if (!revRow) return 0;
  try {
    return computeRowValue(revRow, year, incomeStatement, incomeStatement, allStatements);
  } catch {
    return revRow.values?.[year] ?? 0;
  }
}

/** Capex from CFS is stored as negative (outflow). In BS Build diagnostics we show it as positive. */
function getCapex(year: string, cashFlow: Row[]): number {
  const row = cashFlow.find((r) => r.id === "capex");
  const raw = row?.values?.[year] ?? 0;
  return Math.abs(raw);
}

function getPPE(year: string, balanceSheet: Row[]): number {
  const row = balanceSheet.find((r) => r.id === "ppe");
  return row?.values?.[year] ?? 0;
}

function getIntangibles(year: string, balanceSheet: Row[]): number {
  const row = balanceSheet.find((r) => r.id === "intangible_assets");
  return row?.values?.[year] ?? 0;
}

function getCogs(year: string, incomeStatement: Row[], allStatements: CapexDiagnosticsInput): number {
  const cogsRow = incomeStatement.find((r) => r.id === "cogs");
  if (!cogsRow) return 0;
  try {
    return computeRowValue(cogsRow, year, incomeStatement, incomeStatement, allStatements);
  } catch {
    return cogsRow.values?.[year] ?? 0;
  }
}

/**
 * Compute historical diagnostics for the Capex & D&A schedule.
 */
export function computeCapexDiagnostics(input: CapexDiagnosticsInput): CapexDiagnostics {
  const { incomeStatement, balanceSheet, cashFlow, historicalYears, danaBreakdowns } = input;
  const allStatements = {
    incomeStatement,
    balanceSheet,
    cashFlow,
  };

  const capexIntensity: CapexIntensityRow[] = [];
  let sumPct = 0;
  let pctCount = 0;
  for (const year of historicalYears) {
    const capex = getCapex(year, cashFlow);
    const revenue = getRevenue(year, incomeStatement, input);
    const capexPctRevenue = revenue > 0 ? (capex / revenue) * 100 : null;
    capexIntensity.push({ year, capex, revenue, capexPctRevenue });
    if (capexPctRevenue != null) {
      sumPct += capexPctRevenue;
      pctCount += 1;
    }
  }
  const last2 = capexIntensity.filter((r) => r.capexPctRevenue != null).slice(-2);
  const recommendedCapexPctRevenue =
    last2.length > 0 ? last2.reduce((s, r) => s + (r.capexPctRevenue ?? 0), 0) / last2.length : null;
  let capexTrend: "up" | "down" | "flat" | null = null;
  if (last2.length === 2 && last2[0].capexPctRevenue != null && last2[1].capexPctRevenue != null) {
    const diff = last2[1].capexPctRevenue! - last2[0].capexPctRevenue!;
    if (diff > 0.5) capexTrend = "up";
    else if (diff < -0.5) capexTrend = "down";
    else capexTrend = "flat";
  }

  const dandaRow = incomeStatement.find((r) => r.id === "danda");
  const observedDandaByYear: Record<string, number> = {};
  let hasObservedDanda = false;
  for (const year of historicalYears) {
    const fromRow = dandaRow?.values?.[year] ?? 0;
    const fromBreakdowns = danaBreakdowns?.[year] ?? 0;
    const val = fromRow || fromBreakdowns;
    observedDandaByYear[year] = val;
    if (val > 0) hasObservedDanda = true;
  }

  const impliedDandaByYear: Record<string, number> = {};
  let hasImpliedDanda = false;
  const ordered = [...historicalYears].sort();
  for (let i = 0; i < ordered.length; i++) {
    const y = ordered[i];
    const begPPE = i === 0 ? 0 : getPPE(ordered[i - 1], balanceSheet);
    const endPPE = getPPE(y, balanceSheet);
    const capex = getCapex(y, cashFlow);
    const implied = begPPE + capex - endPPE;
    if (implied > 0 || begPPE > 0 || capex > 0) hasImpliedDanda = true;
    impliedDandaByYear[y] = Math.max(0, implied);
  }

  const ppeIntensity: PPEIntensityRow[] = [];
  for (const year of historicalYears) {
    const ppe = getPPE(year, balanceSheet);
    const revenue = getRevenue(year, incomeStatement, input);
    const cogs = getCogs(year, incomeStatement, input);
    ppeIntensity.push({
      year,
      ppe,
      revenue,
      ppePctRevenue: revenue > 0 ? (ppe / revenue) * 100 : null,
      cogs,
      ppePctCogs: cogs > 0 ? (ppe / cogs) * 100 : null,
    });
  }

  const intangiblesIntensity: IntangiblesRow[] = [];
  for (const year of historicalYears) {
    const intangibles = getIntangibles(year, balanceSheet);
    const revenue = getRevenue(year, incomeStatement, input);
    intangiblesIntensity.push({
      year,
      intangibles,
      revenue,
      intangiblesPctRevenue: revenue > 0 ? (intangibles / revenue) * 100 : null,
    });
  }

  return {
    capexIntensity,
    recommendedCapexPctRevenue,
    capexTrend,
    observedDandaByYear,
    hasObservedDanda,
    impliedDandaByYear,
    hasImpliedDanda,
    ppeIntensity,
    intangiblesIntensity,
  };
}
