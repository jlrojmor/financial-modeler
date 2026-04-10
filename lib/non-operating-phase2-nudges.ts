/**
 * Phase 2 (Non-operating & Schedules) — derived nudges, summaries, and preview copy.
 * Guidance only; no forecast math.
 */

import type { Row } from "@/types/finance";
import type {
  NonOperatingInterestKind,
  NonOperatingLeafLine,
  Phase2ScheduleDisplayCategory,
  Phase2ScheduleShellStatus,
} from "@/lib/non-operating-phase2-lines";
import { findIsRowById, inferScheduleDisplayCategory } from "@/lib/non-operating-phase2-lines";
import type { NonOperatingPhase2DirectLinePersist } from "@/lib/non-operating-phase2-ui-persist";
import { directBodiesEqual } from "@/lib/non-operating-phase2-ui-persist";

const HIGH_IMPACT_SHARE = 0.15;

export type Phase2NudgeSeverity = "info" | "warning";

export type Phase2LineNudgeType =
  | "needs_setup"
  | "high_impact"
  | "not_forecasted"
  | "unsaved_changes";

export type Phase2LineNudgeSignal = {
  type: Phase2LineNudgeType;
  severity: Phase2NudgeSeverity;
  label: string;
  tooltip: string;
};

export type Phase2PrioritySection = "scheduled" | "direct" | "review" | "none";

export type Phase2GlobalSummary = {
  /** Single-line status bar (ordered by priority). */
  barText: string;
  prioritySection: Phase2PrioritySection;
  /** True when every tracked line is in a “done” state for this pass. */
  isPhase2Complete: boolean;
  /** Any interest template line in scheduled bucket still on Needs setup. */
  interestScheduleNeedsSetup: boolean;
  counts: {
    scheduleNotSetUp: number;
    scheduleDraft: number;
    scheduleAppliedOrComplete: number;
    directNotApplied: number;
    directUnsaved: number;
    reviewCount: number;
    totalLeaves: number;
    scheduledLineCount: number;
    directLineCount: number;
  };
};

export type Phase2PreviewGuidance = {
  /** Primary strip (most important unresolved issue); null if none needed. */
  primaryStrip: { tone: "info" | "warning"; text: string } | null;
  /** Optional secondary strip. */
  secondaryStrip: { tone: "info" | "warning"; text: string } | null;
  positiveLine: string | null;
  scheduledConfigured: boolean;
  directConfigured: boolean;
  /** Trust copy when the bridge shows numeric applied direct non-operating forecasts. */
  bridgeNote: string | null;
};

/**
 * Ordered next-step copy for the builder “Start here” block (same inputs as global summary).
 */
export function buildPhase2StartHereSteps(summary: Phase2GlobalSummary): string[] {
  const c = summary.counts;
  if (c.totalLeaves === 0) {
    return [
      "When your income statement includes lines below operating income, they will appear here for routing and setup.",
    ];
  }

  const steps: string[] = [];

  if (c.directNotApplied > 0) {
    steps.push(
      `Start with direct non-operating forecasts — ${c.directNotApplied} recurring line${c.directNotApplied === 1 ? "" : "s"} not yet applied (Apply when ready).`
    );
  } else if (c.directUnsaved > 0) {
    steps.push(
      `Apply or reset ${c.directUnsaved} direct line${c.directUnsaved === 1 ? "" : "s"} with unsaved forecast changes.`
    );
  }

  if (c.scheduleNotSetUp > 0 || c.scheduleDraft > 0) {
    const bits: string[] = [];
    if (c.scheduleNotSetUp > 0) {
      bits.push(
        `${c.scheduleNotSetUp} schedule placeholder${c.scheduleNotSetUp === 1 ? "" : "s"} still need setup`
      );
    }
    if (c.scheduleDraft > 0) {
      bits.push(`${c.scheduleDraft} schedule${c.scheduleDraft === 1 ? "" : "s"} in progress`);
    }
    steps.push(
      `Review create/configure schedules: ${bits.join("; ")}. Interest expense will be driven by the future debt schedule, not forecast directly here.`
    );
  } else if (summary.interestScheduleNeedsSetup) {
    steps.push(
      "Review interest income / other schedule placeholders — interest expense will come from the debt schedule when that engine ships."
    );
  }

  if (c.reviewCount > 0) {
    steps.push(
      `Resolve review-required items — ${c.reviewCount} line${c.reviewCount === 1 ? "" : "s"} still need classification confirmation.`
    );
  }

  if (steps.length === 0 && summary.isPhase2Complete) {
    steps.push(
      "Phase 2 shell setup is complete for this pass — the preview shows the intended pre-tax bridge structure."
    );
  } else if (steps.length === 0) {
    steps.push("Run AI classification to stress-test routes, then confirm each line on the left.");
  }

  return steps;
}

function findRowValues(row: Row | null, lastHistYear: string | null): number | null {
  if (!row || !lastHistYear) return null;
  const v = row.values?.[lastHistYear];
  return v != null && Number.isFinite(v) ? v : null;
}

/**
 * |hist| share within a section; high impact only if 2+ lines and share > threshold.
 */
export function computePhase2HighImpactLineIds(input: {
  lineIds: string[];
  incomeStatement: Row[];
  lastHistYear: string | null;
}): Set<string> {
  const { lineIds, incomeStatement, lastHistYear } = input;
  const set = new Set<string>();
  if (lineIds.length < 2 || !lastHistYear) return set;

  const absById: Record<string, number> = {};
  let total = 0;
  for (const id of lineIds) {
    const walk = (rows: Row[]): Row | null => {
      for (const r of rows) {
        if (r.id === id) return r;
        if (r.children?.length) {
          const f = walk(r.children);
          if (f) return f;
        }
      }
      return null;
    };
    const row = walk(incomeStatement);
    const v = findRowValues(row, lastHistYear);
    const a = v != null ? Math.abs(v) : 0;
    absById[id] = a;
    total += a;
  }
  if (total <= 0) return set;
  for (const id of lineIds) {
    if (absById[id]! / total > HIGH_IMPACT_SHARE) set.add(id);
  }
  return set;
}

const SCHEDULED_NUDGE_PRIORITY: Phase2LineNudgeType[] = ["needs_setup", "high_impact"];
const DIRECT_NUDGE_PRIORITY: Phase2LineNudgeType[] = ["not_forecasted", "unsaved_changes", "high_impact"];

export function getPhase2ScheduledLineNudges(input: {
  status: Phase2ScheduleShellStatus;
  highImpact: boolean;
  maxSignals?: number;
}): Phase2LineNudgeSignal[] {
  const { status, highImpact, maxSignals = 2 } = input;
  const candidates: Phase2LineNudgeSignal[] = [];
  if (status === "not_set_up") {
    candidates.push({
      type: "needs_setup",
      severity: "warning",
      label: "Needs setup",
      tooltip: "Configure the shared schedule before this line is treated as ready.",
    });
  }
  if (highImpact) {
    candidates.push({
      type: "high_impact",
      severity: "info",
      label: "High impact",
      tooltip: "This line is large relative to other items in this section on the latest historical year.",
    });
  }
  const out: Phase2LineNudgeSignal[] = [];
  for (const t of SCHEDULED_NUDGE_PRIORITY) {
    const c = candidates.find((x) => x.type === t);
    if (c) out.push(c);
    if (out.length >= maxSignals) break;
  }
  return out;
}

export function getPhase2DirectLineNudges(input: {
  applied: boolean;
  unsaved: boolean;
  highImpact: boolean;
  maxSignals?: number;
}): Phase2LineNudgeSignal[] {
  const { applied, unsaved, highImpact, maxSignals = 2 } = input;
  const candidates: Phase2LineNudgeSignal[] = [];
  if (!applied) {
    candidates.push({
      type: "not_forecasted",
      severity: "warning",
      label: "Not forecasted",
      tooltip: "Apply a forecast assumption for this line (local to this step until statement write is enabled).",
    });
  }
  if (applied && unsaved) {
    candidates.push({
      type: "unsaved_changes",
      severity: "warning",
      label: "Unsaved changes",
      tooltip: "Draft differs from the last applied assumption.",
    });
  }
  if (highImpact) {
    candidates.push({
      type: "high_impact",
      severity: "info",
      label: "High impact",
      tooltip: "This line is large relative to other direct non-operating lines on the latest historical year.",
    });
  }
  const out: Phase2LineNudgeSignal[] = [];
  for (const t of DIRECT_NUDGE_PRIORITY) {
    const c = candidates.find((x) => x.type === t);
    if (c) out.push(c);
    if (out.length >= maxSignals) break;
  }
  return out;
}

function countScheduledNeedsWork(
  scheduledLineIds: string[],
  scheduleStatusByLine: Record<string, Phase2ScheduleShellStatus>
): { notSetUp: number; draft: number; done: number } {
  let notSetUp = 0;
  let draft = 0;
  let done = 0;
  for (const id of scheduledLineIds) {
    const s = scheduleStatusByLine[id] ?? "not_set_up";
    if (s === "not_set_up") notSetUp += 1;
    else if (s === "draft") draft += 1;
    else if (s === "applied" || s === "complete") done += 1;
  }
  return { notSetUp, draft, done };
}

function countDirectWork(
  directLineIds: string[],
  directByLine: Record<string, NonOperatingPhase2DirectLinePersist>
): { notApplied: number; unsaved: number; settled: number } {
  let notApplied = 0;
  let unsaved = 0;
  let settled = 0;
  for (const id of directLineIds) {
    const st = directByLine[id];
    if (!st || st.applied == null) {
      notApplied += 1;
      continue;
    }
    if (!directBodiesEqual(st.draft, st.applied)) unsaved += 1;
    else settled += 1;
  }
  return { notApplied, unsaved, settled };
}

/**
 * Top status bar + priority section for subtle highlight.
 */
export function buildPhase2GlobalSummary(input: {
  leaves: NonOperatingLeafLine[];
  incomeStatement: Row[];
  effectiveBucket: (line: NonOperatingLeafLine) => "scheduled" | "direct" | "review" | "excluded";
  scheduleStatusByLine: Record<string, Phase2ScheduleShellStatus>;
  directByLine: Record<string, NonOperatingPhase2DirectLinePersist>;
}): Phase2GlobalSummary {
  const { leaves, incomeStatement, effectiveBucket, scheduleStatusByLine, directByLine } = input;
  const scheduled = leaves.filter((l) => effectiveBucket(l) === "scheduled");
  const direct = leaves.filter((l) => effectiveBucket(l) === "direct");
  const review = leaves.filter((l) => effectiveBucket(l) === "review");

  const sCount = countScheduledNeedsWork(
    scheduled.map((l) => l.lineId),
    scheduleStatusByLine
  );
  const dCount = countDirectWork(
    direct.map((l) => l.lineId),
    directByLine
  );

  /** Interest expense is debt-schedule-driven (not configured here). Flag only non–debt-driven interest placeholders (e.g. income). */
  let interestScheduleNeedsSetup = false;
  for (const l of scheduled) {
    const row = findIsRowById(incomeStatement, l.lineId);
    if (row?.id === "interest_expense") continue;
    const cat = row ? inferScheduleDisplayCategory(row) : null;
    const isInterestLine = row?.id === "interest_income" || cat === "interest";
    const st = scheduleStatusByLine[l.lineId] ?? "not_set_up";
    if (isInterestLine && st === "not_set_up") interestScheduleNeedsSetup = true;
  }

  const counts = {
    scheduleNotSetUp: sCount.notSetUp,
    scheduleDraft: sCount.draft,
    scheduleAppliedOrComplete: sCount.done,
    directNotApplied: dCount.notApplied,
    directUnsaved: dCount.unsaved,
    reviewCount: review.length,
    totalLeaves: leaves.length,
    scheduledLineCount: scheduled.length,
    directLineCount: direct.length,
  };

  if (leaves.length === 0) {
    return {
      barText: "No non-operating lines below operating income in the current structure.",
      prioritySection: "none",
      isPhase2Complete: true,
      interestScheduleNeedsSetup: false,
      counts,
    };
  }

  const scheduleNeedsWork = sCount.notSetUp + sCount.draft;
  const directNeedsWork = dCount.notApplied + dCount.unsaved;

  const isPhase2Complete = review.length === 0 && scheduleNeedsWork === 0 && directNeedsWork === 0;

  let prioritySection: Phase2PrioritySection = "none";
  if (dCount.notApplied > 0 || dCount.unsaved > 0) prioritySection = "direct";
  else if (sCount.notSetUp > 0 || sCount.draft > 0) prioritySection = "scheduled";
  else if (review.length > 0) prioritySection = "review";

  const parts: string[] = [];
  if (dCount.notApplied > 0) {
    parts.push(`${dCount.notApplied} direct item${dCount.notApplied === 1 ? "" : "s"} not applied`);
  }
  if (dCount.unsaved > 0) {
    parts.push(`${dCount.unsaved} with unsaved changes`);
  }
  if (sCount.notSetUp > 0) {
    parts.push(`${sCount.notSetUp} schedule${sCount.notSetUp === 1 ? "" : "s"} need setup`);
  }
  if (sCount.draft > 0) {
    parts.push(`${sCount.draft} schedule${sCount.draft === 1 ? "" : "s"} in progress`);
  }
  if (review.length > 0) {
    parts.push(`${review.length} item${review.length === 1 ? "" : "s"} need review`);
  }

  const barText =
    parts.length > 0 ? parts.join(" · ") : isPhase2Complete ? "Phase 2 complete ✓" : "Review classifications below.";

  return { barText, prioritySection, isPhase2Complete, interestScheduleNeedsSetup, counts };
}

export function scheduleExplanationLine(
  cat: Phase2ScheduleDisplayCategory | null,
  interestKind?: NonOperatingInterestKind | null
): string {
  switch (cat) {
    case "interest":
      if (interestKind === "expense")
        return "Interest expense is driven by the debt schedule (balances, draws, repayments, rates) — not forecast directly in this section.";
      if (interestKind === "income") return "This line is modeled through an interest income schedule.";
      return "This line is modeled through an interest schedule.";
    case "amortization":
      return "This line is modeled through an amortization schedule.";
    case "depreciation":
      return "This line is modeled through a depreciation schedule.";
    case "lease":
      return "This line is modeled through a lease-related schedule.";
    case "stock_compensation":
      return "This line is modeled through a stock-based compensation schedule.";
    default:
      return "This line is modeled through a shared schedule.";
  }
}

export function scheduleImpactLine(
  cat: Phase2ScheduleDisplayCategory | null,
  interestKind?: NonOperatingInterestKind | null
): string {
  switch (cat) {
    case "interest":
      if (interestKind === "expense")
        return "Reduces pre-tax income when the debt schedule engine feeds this line (after balances and interest are modeled).";
      if (interestKind === "income") return "Increases pre-tax income when the schedule is connected.";
      return "Impacts pre-tax income through interest income or expense when the schedule is connected.";
    case "amortization":
      return "Impacts pre-tax income through amortization expense.";
    case "depreciation":
      return "Impacts pre-tax income through depreciation expense.";
    case "lease":
      return "Impacts pre-tax income through lease-related expense.";
    case "stock_compensation":
      return "Impacts pre-tax income through stock-based compensation.";
    default:
      return "Impacts pre-tax income when the schedule flows into the income statement.";
  }
}

export function scheduleStatusUserLabel(status: Phase2ScheduleShellStatus): string {
  switch (status) {
    case "not_set_up":
      return "Needs setup";
    case "draft":
      return "In progress";
    case "applied":
      return "Applied";
    case "complete":
      return "Complete";
    default:
      return "—";
  }
}

export function scheduleStatusHelperLine(status: Phase2ScheduleShellStatus): string {
  switch (status) {
    case "not_set_up":
      return "This schedule still needs to be configured.";
    case "draft":
      return "Inputs have been started but not fully applied.";
    case "applied":
      return "This schedule has applied assumptions.";
    case "complete":
      return "This schedule is fully set up for this pass.";
    default:
      return "";
  }
}

export function buildPhase2PreviewGuidance(
  summary: Phase2GlobalSummary,
  opts?: {
    directNumericInPreview?: boolean;
    /** User has applied a debt schedule config (draft vs applied discipline). */
    debtScheduleApplied?: boolean;
    /** Applied debt schedule produces full interest for all projection years (engine isComplete). */
    debtScheduleInterestComplete?: boolean;
  }
): Phase2PreviewGuidance {
  const {
    scheduleNotSetUp,
    scheduleDraft,
    directNotApplied,
    directUnsaved,
    reviewCount,
    totalLeaves,
    scheduledLineCount,
    directLineCount,
  } = summary.counts;

  const scheduledConfigured =
    totalLeaves === 0 || scheduledLineCount === 0 || (scheduleNotSetUp === 0 && scheduleDraft === 0);
  const directConfigured =
    totalLeaves === 0 || directLineCount === 0 || (directNotApplied === 0 && directUnsaved === 0);

  let primaryStrip: Phase2PreviewGuidance["primaryStrip"] = null;
  let secondaryStrip: Phase2PreviewGuidance["secondaryStrip"] = null;

  const debtApplied = opts?.debtScheduleApplied === true;
  const debtInterestOk = opts?.debtScheduleInterestComplete === true;
  let bridgeNote: string | null = null;
  if (opts?.directNumericInPreview === true) {
    if (debtInterestOk) {
      bridgeNote =
        "Applied direct non-operating forecasts and interest expense from the applied debt schedule feed the partial pre-tax row below. Interest income and other schedule-driven bridge lines remain placeholders — pre-tax is still partial.";
    } else if (debtApplied) {
      bridgeNote =
        "Applied direct non-operating forecasts are in the partial pre-tax row. Debt schedule is applied but interest is not shown until every enabled tranche has complete opening balances, roll-forward, and rates for all projection years.";
    } else {
      bridgeNote =
        "Applied direct non-operating forecasts are included in the partial pre-tax row below. Apply the debt schedule on the left to derive interest expense; interest income and other schedule-driven lines stay placeholders — pre-tax remains partial.";
    }
  }

  if (totalLeaves === 0) {
    return {
      primaryStrip: null,
      secondaryStrip: null,
      positiveLine: null,
      scheduledConfigured: true,
      directConfigured: true,
      bridgeNote: null,
    };
  }

  if (summary.isPhase2Complete) {
    return {
      primaryStrip: null,
      secondaryStrip: null,
      positiveLine:
        "Phase 2 shell is complete — classifications, schedule setup flags, and direct assumptions are in place for this pass (preview-only until schedule engines connect).",
      scheduledConfigured,
      directConfigured,
      bridgeNote:
        opts?.directNumericInPreview === true
          ? debtInterestOk
            ? "Applied direct non-operating forecasts and debt-schedule interest appear in the bridge. Other schedule rows are still pending — partial pre-tax is not a full statement subtotal."
            : debtApplied
              ? "Applied direct non-operating forecasts appear in the bridge. Debt schedule is applied — finish tranche inputs so interest expense can compute; other schedule rows are still pending."
              : "Applied direct non-operating forecasts appear in the bridge. Apply the debt schedule to derive interest expense; other schedule rows are still pending — partial pre-tax is not a full statement subtotal."
          : bridgeNote,
    };
  }

  if (summary.interestScheduleNeedsSetup) {
    primaryStrip = {
      tone: "warning",
      text:
        opts?.debtScheduleInterestComplete === true
          ? "Some schedule placeholders (e.g. interest income) are not marked configured — interest expense is already driven by the applied debt schedule."
          : "Some schedule placeholders (e.g. interest income) are not marked configured — configure or apply the debt schedule for interest expense when ready.",
    };
  } else if (scheduleNotSetUp > 0) {
    primaryStrip = {
      tone: "warning",
      text: "Scheduled items are not fully configured — pre-tax income may be incomplete until setup is finished.",
    };
  } else if (scheduleDraft > 0) {
    primaryStrip = {
      tone: "info",
      text: "Some schedules are in progress — finish or mark as configured (preview only) so the shell stays honest.",
    };
  }

  if (directNotApplied > 0) {
    const msg =
      directNotApplied === 1
        ? "1 recurring non-operating line still not applied — pre-tax income may omit recurring non-operating items."
        : `${directNotApplied} recurring non-operating lines still not applied — pre-tax income may omit those items.`;
    if (!primaryStrip) primaryStrip = { tone: "warning", text: msg };
    else if (!secondaryStrip) secondaryStrip = { tone: "warning", text: msg };
  } else if (directUnsaved > 0) {
    const msg = "Direct non-operating forecasts have unsaved changes — apply them when ready.";
    if (!primaryStrip) primaryStrip = { tone: "info", text: msg };
    else if (!secondaryStrip) secondaryStrip = { tone: "info", text: msg };
  }

  if (reviewCount > 0 && !secondaryStrip) {
    secondaryStrip = {
      tone: "warning",
      text: `Review queue not cleared — ${reviewCount} line${reviewCount === 1 ? "" : "s"}; classification may still be incomplete.`,
    };
  }

  return {
    primaryStrip,
    secondaryStrip,
    positiveLine: null,
    scheduledConfigured,
    directConfigured,
    bridgeNote,
  };
}
