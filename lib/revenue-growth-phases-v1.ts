/**
 * Growth phases for Revenue Forecast v1: validate and expand to ratesByYear for the existing engine.
 */

export interface GrowthPhaseV1 {
  startYear: string;
  endYear: string;
  ratePercent: number;
}

export const GROWTH_PHASE_MESSAGES = {
  coverAll: "Growth phases must cover all projection years.",
  overlap: "Phase ranges cannot overlap.",
  needRate: "Each phase needs a growth %.",
  gaps: "Growth phases must run in order without gaps.",
  count: "Use 1–4 growth phases.",
} as const;

/** Map each projection year to rate % from non-overlapping phases (years as inclusive string ranges). */
export function expandPhasesToRatesByYear(
  phases: GrowthPhaseV1[],
  projectionYears: string[]
): Record<string, number> {
  const sortedProj = [...projectionYears].sort();
  const out: Record<string, number> = {};
  for (const ph of phases) {
    for (const y of sortedProj) {
      if (y >= ph.startYear && y <= ph.endYear) {
        out[y] = ph.ratePercent;
      }
    }
  }
  return out;
}

export function validateGrowthPhases(
  phases: GrowthPhaseV1[],
  projectionYears: string[]
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const sortedProj = [...projectionYears].sort((a, b) => a.localeCompare(b));
  if (sortedProj.length === 0) {
    return { ok: false, errors: [GROWTH_PHASE_MESSAGES.coverAll] };
  }

  if (phases.length < 1) {
    errors.push(GROWTH_PHASE_MESSAGES.coverAll);
  }
  if (phases.length > 4) {
    errors.push(GROWTH_PHASE_MESSAGES.count);
  }

  const yearSet = new Set(sortedProj);

  for (const ph of phases) {
    if (!ph.startYear?.trim() || !ph.endYear?.trim()) {
      errors.push(GROWTH_PHASE_MESSAGES.coverAll);
      continue;
    }
    if (ph.startYear > ph.endYear) {
      errors.push(GROWTH_PHASE_MESSAGES.gaps);
    }
    if (!yearSet.has(ph.startYear) || !yearSet.has(ph.endYear)) {
      errors.push(GROWTH_PHASE_MESSAGES.coverAll);
    }
    if (ph.ratePercent == null || !Number.isFinite(Number(ph.ratePercent))) {
      errors.push(GROWTH_PHASE_MESSAGES.needRate);
    }
  }

  const assignment: Record<string, number> = {};
  for (const ph of phases) {
    if (!ph.startYear || !ph.endYear || !Number.isFinite(Number(ph.ratePercent))) continue;
    for (const y of sortedProj) {
      if (y >= ph.startYear && y <= ph.endYear) {
        if (assignment[y] !== undefined) {
          errors.push(GROWTH_PHASE_MESSAGES.overlap);
          break;
        }
        assignment[y] = Number(ph.ratePercent);
      }
    }
  }

  for (const y of sortedProj) {
    if (assignment[y] === undefined) {
      errors.push(GROWTH_PHASE_MESSAGES.coverAll);
      break;
    }
  }

  const sortedPh = [...phases]
    .filter((p) => p.startYear && p.endYear)
    .sort((a, b) => a.startYear.localeCompare(b.startYear));

  if (sortedPh.length > 0 && sortedPh.length <= 4 && sortedProj.length > 0) {
    if (sortedPh[0]!.startYear !== sortedProj[0]) {
      errors.push(GROWTH_PHASE_MESSAGES.gaps);
    }
    if (sortedPh[sortedPh.length - 1]!.endYear !== sortedProj[sortedProj.length - 1]) {
      errors.push(GROWTH_PHASE_MESSAGES.coverAll);
    }
    for (let i = 1; i < sortedPh.length; i++) {
      const prevEnd = sortedProj.indexOf(sortedPh[i - 1]!.endYear);
      const curStart = sortedProj.indexOf(sortedPh[i]!.startYear);
      if (prevEnd >= 0 && curStart >= 0 && curStart !== prevEnd + 1) {
        errors.push(GROWTH_PHASE_MESSAGES.gaps);
        break;
      }
    }
  }

  const uniq = [...new Set(errors)];
  return { ok: uniq.length === 0, errors: uniq };
}

/** Effective ratesByYear for projection: phases expanded, by_year/legacy historical rby, else null → constant %. */
export function resolveGrowthRatesByYear(
  params: Record<string, unknown>,
  projectionYears: string[]
): Record<string, number> | null {
  const pType = params.growthPatternType as string | undefined;
  const basis = params.startingBasis as string | undefined;
  const rby = params.ratesByYear as Record<string, number> | undefined;
  const hasRby = rby && typeof rby === "object" && Object.keys(rby).length > 0;

  if (pType === "phases") {
    const raw = params.growthPhases;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const phases: GrowthPhaseV1[] = raw.map((x: unknown) => {
      const o = x as Record<string, unknown>;
      return {
        startYear: String(o.startYear ?? ""),
        endYear: String(o.endYear ?? ""),
        ratePercent: Number(o.ratePercent),
      };
    });
    const { ok } = validateGrowthPhases(phases, projectionYears);
    if (!ok) return null;
    return expandPhasesToRatesByYear(phases, projectionYears);
  }
  if (pType === "by_year" && hasRby) return rby;
  if (basis === "last_historical" && hasRby && pType !== "constant") {
    return rby;
  }
  return null;
}
