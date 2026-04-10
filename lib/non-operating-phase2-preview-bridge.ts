/**
 * Preview-only: group Phase 2 lines for the pre-tax bridge shell (no schedule math here).
 * Dollar interest expense is computed in the debt schedule engine; this module only supplies setup hints.
 */

import type { Row } from "@/types/finance";
import type { NonOperatingPhase2DirectLinePersist } from "@/lib/non-operating-phase2-ui-persist";
import { directBodiesEqual } from "@/lib/non-operating-phase2-ui-persist";
import {
  collectNonOperatingIncomeLeaves,
  defaultPhase2Bucket,
  findIsRowById,
  getNonOperatingInterestKind,
  inferScheduleDisplayCategory,
  type NonOperatingLeafLine,
  type Phase2LineBucket,
  type Phase2ScheduleShellStatus,
} from "@/lib/non-operating-phase2-lines";

export type Phase2BridgeScheduledBand = {
  lineIds: string[];
  /** Human-readable setup hint; no dollar amounts. */
  setupHint: string;
};

function effectiveBucketFor(
  line: NonOperatingLeafLine,
  incomeStatement: Row[],
  overrides: Record<string, Phase2LineBucket>
): Phase2LineBucket {
  const row = findIsRowById(incomeStatement, line.lineId);
  const base = row ? defaultPhase2Bucket(row) : "review";
  return overrides[line.lineId] ?? base;
}

function setupHintForScheduled(
  lineIds: string[],
  scheduleStatusByLine: Record<string, Phase2ScheduleShellStatus>,
  scheduleStatusOverrides?: Record<string, Phase2ScheduleShellStatus>
): string {
  if (lineIds.length === 0) return "No lines in this bucket.";
  let notSetUp = 0;
  let draft = 0;
  let done = 0;
  for (const id of lineIds) {
    const s = scheduleStatusOverrides?.[id] ?? scheduleStatusByLine[id] ?? "not_set_up";
    if (s === "not_set_up") notSetUp += 1;
    else if (s === "draft") draft += 1;
    else if (s === "applied" || s === "complete") done += 1;
  }
  const parts: string[] = [];
  if (notSetUp > 0) parts.push(`${notSetUp} need setup`);
  if (draft > 0) parts.push(`${draft} in progress`);
  if (parts.length === 0) parts.push(`${done} marked configured (preview only)`);
  else parts.push(`${done} marked configured`);
  return parts.join(" · ");
}

function directBandHint(
  lineIds: string[],
  directByLine: Record<string, NonOperatingPhase2DirectLinePersist>
): string {
  if (lineIds.length === 0) return "No direct-forecast lines.";
  let notApplied = 0;
  let unsaved = 0;
  let settled = 0;
  for (const id of lineIds) {
    const st = directByLine[id];
    if (!st || st.applied == null) notApplied += 1;
    else if (!directBodiesEqual(st.draft, st.applied)) unsaved += 1;
    else settled += 1;
  }
  const bits: string[] = [];
  if (notApplied > 0) bits.push(`${notApplied} not applied`);
  if (unsaved > 0) bits.push(`${unsaved} unsaved`);
  if (notApplied === 0 && unsaved === 0) bits.push(`${settled} applied`);
  return bits.join(" · ");
}

export type Phase2PreviewBridgeModel = {
  interestExpense: Phase2BridgeScheduledBand;
  interestIncome: Phase2BridgeScheduledBand;
  otherScheduled: Phase2BridgeScheduledBand;
  directOther: { lineIds: string[]; setupHint: string };
};

export function buildPhase2PreviewBridgeModel(input: {
  incomeStatement: Row[];
  bucketOverrides: Record<string, Phase2LineBucket>;
  scheduleStatusByLine: Record<string, Phase2ScheduleShellStatus>;
  /** Effective status for specific lines (e.g. interest_expense from applied schedule config). */
  scheduleStatusOverrides?: Record<string, Phase2ScheduleShellStatus>;
  directByLine: Record<string, NonOperatingPhase2DirectLinePersist>;
}): Phase2PreviewBridgeModel {
  const leaves = collectNonOperatingIncomeLeaves(input.incomeStatement);
  const interestExpenseIds: string[] = [];
  const interestIncomeIds: string[] = [];
  const otherScheduledIds: string[] = [];
  const directIds: string[] = [];

  for (const line of leaves) {
    const b = effectiveBucketFor(line, input.incomeStatement, input.bucketOverrides);
    const row = findIsRowById(input.incomeStatement, line.lineId);
    if (b === "direct") {
      directIds.push(line.lineId);
      continue;
    }
    if (b !== "scheduled") continue;
    if (!row) {
      otherScheduledIds.push(line.lineId);
      continue;
    }
    const cat = inferScheduleDisplayCategory(row);
    const ik = getNonOperatingInterestKind(row);
    if (cat === "interest" && ik === "expense") {
      interestExpenseIds.push(line.lineId);
    } else if (cat === "interest" && ik === "income") {
      interestIncomeIds.push(line.lineId);
    } else if (cat === "interest") {
      otherScheduledIds.push(line.lineId);
    } else {
      otherScheduledIds.push(line.lineId);
    }
  }

  const ov = input.scheduleStatusOverrides;
  return {
    interestExpense: {
      lineIds: interestExpenseIds,
      setupHint: setupHintForScheduled(interestExpenseIds, input.scheduleStatusByLine, ov),
    },
    interestIncome: {
      lineIds: interestIncomeIds,
      setupHint: setupHintForScheduled(interestIncomeIds, input.scheduleStatusByLine, ov),
    },
    otherScheduled: {
      lineIds: otherScheduledIds,
      setupHint: setupHintForScheduled(otherScheduledIds, input.scheduleStatusByLine, ov),
    },
    directOther: {
      lineIds: directIds,
      setupHint: directBandHint(directIds, input.directByLine),
    },
  };
}
