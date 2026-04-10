"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Row } from "@/types/finance";
import { useModelStore } from "@/store/useModelStore";
import type { OpExDirectForecastMethodV1 } from "@/types/opex-forecast-v1";
import type { NonOperatingPhase2AiLineSuggestion } from "@/types/non-operating-phase2-ai";
import { storedToDisplay, displayToStored, getUnitLabel } from "@/lib/currency-utils";
import {
  collectNonOperatingIncomeLeaves,
  defaultPhase2Bucket,
  findIsRowById,
  getNonOperatingInterestKind,
  inferScheduleDisplayCategory,
  phase2ScheduleCategoryPillLabel,
  type NonOperatingLeafLine,
  type Phase2LineBucket,
  type Phase2ScheduleDisplayCategory,
  type Phase2ScheduleShellStatus,
} from "@/lib/non-operating-phase2-lines";
import {
  buildPhase2GlobalSummary,
  buildPhase2StartHereSteps,
  computePhase2HighImpactLineIds,
  getPhase2DirectLineNudges,
  getPhase2ScheduledLineNudges,
  scheduleExplanationLine,
  scheduleImpactLine,
  scheduleStatusHelperLine,
  scheduleStatusUserLabel,
  type Phase2LineNudgeSignal,
} from "@/lib/non-operating-phase2-nudges";
import {
  formatAiAdvisorySourceLine,
  formatRouteSourceLabel,
  resolvePhase2RouteSource,
} from "@/lib/non-operating-phase2-ai-utils";
import {
  cloneDirectBody,
  defaultNonOperatingDirectBody,
  directBodiesEqual,
  type NonOperatingPhase2DirectPersistBody,
  type NonOperatingPhase2DirectLinePersist,
} from "@/lib/non-operating-phase2-ui-persist";
import { DebtSchedulePhase2Builder } from "@/components/debt-schedule-phase2-builder";

type Phase2SectionAccordionVariant = "default" | "needs_review" | "excluded";

function Phase2NudgePillsRow({ signals }: { signals: Phase2LineNudgeSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {signals.map((s) => (
        <span
          key={s.type}
          title={s.tooltip}
          className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] leading-tight cursor-default ${
            s.severity === "warning"
              ? "border-amber-800/45 bg-amber-950/25 text-amber-100/90"
              : "border-slate-600/50 bg-slate-800/40 text-slate-300"
          }`}
        >
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Phase2SectionAccordion(props: {
  title: ReactNode;
  subtitle: ReactNode;
  summary: string;
  defaultExpanded: boolean;
  variant?: Phase2SectionAccordionVariant;
  readinessHint?: string;
  priorityHighlight?: boolean;
  startHereHint?: boolean;
  children: ReactNode;
}) {
  const {
    title,
    subtitle,
    summary,
    defaultExpanded,
    variant = "default",
    readinessHint,
    priorityHighlight,
    startHereHint,
    children,
  } = props;
  const [expanded, setExpanded] = useState(defaultExpanded);

  const outer =
    variant === "needs_review"
      ? `rounded-lg border border-amber-800/40 bg-amber-950/10 ${
          priorityHighlight ? "ring-2 ring-amber-600/35" : "ring-1 ring-amber-900/20"
        }`
      : variant === "excluded"
        ? "rounded-lg border border-slate-600/70 bg-slate-900/40"
        : `rounded-lg border border-slate-700 bg-slate-900/40${
            priorityHighlight ? " ring-2 ring-violet-500/30" : ""
          }`;

  const headerBorder =
    variant === "needs_review"
      ? expanded
        ? "border-b border-amber-900/30"
        : ""
      : expanded
        ? "border-b border-slate-800"
        : "";

  return (
    <section className={outer}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={`w-full text-left px-4 py-3 hover:bg-slate-800/25 transition-colors ${headerBorder}`}
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div>{title}</div>
            <div className="text-[11px] text-slate-500 mt-1 leading-snug">{subtitle}</div>
            {summary ? (
              <div className="text-[10px] text-slate-500/85 mt-1.5 leading-snug">{summary}</div>
            ) : null}
            {readinessHint ? (
              <div className="text-[10px] text-slate-600 mt-1 leading-snug">{readinessHint}</div>
            ) : null}
            {startHereHint ? (
              <div className="text-[10px] text-violet-300/80 mt-1 font-medium">Start here</div>
            ) : null}
          </div>
          <span className="text-slate-500 text-xs shrink-0 mt-0.5 tabular-nums" aria-hidden>
            {expanded ? "▼" : "▶"}
          </span>
        </div>
      </button>
      {expanded ? <div>{children}</div> : null}
    </section>
  );
}

const BUCKET_OPTIONS: { value: Phase2LineBucket; label: string }[] = [
  { value: "scheduled", label: "Schedule-driven (deferred to engines)" },
  { value: "direct", label: "Forecast direct non-operating" },
  { value: "review", label: "Needs review" },
  { value: "excluded", label: "Excluded" },
];

const ROUTE_MEANINGS: { title: string; body: string }[] = [
  {
    title: "Schedule-driven (deferred to engines)",
    body: "Placeholders for dedicated engines — e.g. the debt schedule (which will drive interest expense), amortization, and other below-EBIT schedules. Interest expense is not forecast directly here.",
  },
  {
    title: "Forecast direct non-operating",
    body: "Recurring below-EBIT items that are not tied to a formal schedule in this step — forecast with Apply here; they flow into the preview when applied.",
  },
  {
    title: "Needs review",
    body: "These items are ambiguous or incomplete and need your confirmation before they can be routed confidently.",
  },
  {
    title: "Excluded",
    body: "These items are treated as non-recurring or outside the recurring below-EBIT forecast.",
  },
];

function bucketLabel(b: Phase2LineBucket): string {
  return BUCKET_OPTIONS.find((o) => o.value === b)?.label ?? b;
}

function signExpectationHint(s: NonOperatingPhase2AiLineSuggestion | undefined): string | null {
  if (!s) return null;
  switch (s.signExpectation) {
    case "usually_expense":
      return "Sign expectation: usually reduces pre-tax income.";
    case "usually_income":
      return "Sign expectation: usually increases pre-tax income.";
    default:
      return "Sign expectation: mixed or label-dependent — verify against historicals.";
  }
}

function lastHistoricalSnippet(row: Row | null, lastHistYear: string | null): string | undefined {
  if (!row || !lastHistYear) return undefined;
  const v = row.values?.[lastHistYear];
  if (v == null || !Number.isFinite(v)) return undefined;
  return String(v);
}

function Phase2AmortizationSchedulePlaceholderCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/20"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-100">Amortization schedule</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Placeholder · engine not built yet</div>
        </div>
        <span className="text-slate-500 text-xs shrink-0">{open ? "▼" : "▶"}</span>
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-0 border-t border-slate-800/80 space-y-2 text-[11px] text-slate-400 leading-relaxed">
          <p>
            Amortization and related below-EBIT items will use a dedicated schedule engine later. This section only
            records the intended route for now.
          </p>
        </div>
      ) : null}
    </div>
  );
}

const INTEREST_EXPENSE_LINE_ID = "interest_expense";

function Phase2InterestExpenseDebtLinkedShell(props: {
  line: NonOperatingLeafLine;
  row: Row | null;
  scheduleCategory: Phase2ScheduleDisplayCategory | null;
  status: Phase2ScheduleShellStatus;
  nudges: Phase2LineNudgeSignal[];
  onStatusChange: (s: Phase2ScheduleShellStatus) => void;
  onBucketChange: (b: Phase2LineBucket) => void;
  currentBucket: Phase2LineBucket;
  routeSourceDisplay: string;
  aiSuggestion?: NonOperatingPhase2AiLineSuggestion;
}) {
  const {
    line,
    row,
    scheduleCategory,
    status,
    nudges,
    onStatusChange,
    onBucketChange,
    currentBucket,
    routeSourceDisplay,
    aiSuggestion,
  } = props;
  const [open, setOpen] = useState(false);
  const interestKind = row ? getNonOperatingInterestKind(row) : null;
  const pill = phase2ScheduleCategoryPillLabel(row, scheduleCategory);
  const aiMismatch =
    aiSuggestion != null && aiSuggestion.suggestedBucket !== currentBucket
      ? `AI suggests ${bucketLabel(aiSuggestion.suggestedBucket)} (${aiSuggestion.confidencePct}%): reference only.`
      : null;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/20"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-100">{line.label}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Under: {line.parentLabel}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span className="inline-flex rounded border border-amber-800/50 bg-amber-950/35 px-1.5 py-0.5 text-[10px] text-amber-100">
              Debt schedule required
            </span>
            <span className="inline-flex rounded border border-violet-800/50 bg-violet-950/30 px-1.5 py-0.5 text-[10px] text-violet-200">
              {pill}
            </span>
            <span className="text-[10px] text-slate-500">{routeSourceDisplay}</span>
            {aiSuggestion ? (
              <span className="text-[10px] text-slate-500">{aiSuggestion.confidencePct}% AI</span>
            ) : null}
          </div>
          <Phase2NudgePillsRow signals={nudges} />
          <div className="text-[10px] text-slate-500 mt-1">
            {bucketLabel(currentBucket)} · {scheduleStatusUserLabel(status)}
          </div>
        </div>
        <span className="text-slate-500 text-xs shrink-0">{open ? "▼" : "▶"}</span>
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-0 border-t border-slate-800/80 space-y-3">
          <p className="text-[10px] text-amber-200/90 border-l-2 border-amber-700/50 pl-2 leading-relaxed">
            Driven by the <span className="text-amber-100">Debt schedule</span> card above — not forecast directly on
            this line. Apply the schedule so preview interest expense reflects tranche balances and rates.
          </p>
          {scheduleCategory === "interest" && interestKind === "expense" ? (
            <p className="text-[10px] text-slate-400 border-l-2 border-slate-600 pl-2">Reduces pre-tax income once the debt engine feeds this line.</p>
          ) : null}
          <p className="text-[11px] text-slate-300 leading-relaxed">{scheduleExplanationLine(scheduleCategory, interestKind)}</p>
          <p className="text-[11px] text-slate-500 leading-relaxed">{scheduleImpactLine(scheduleCategory, interestKind)}</p>
          <p className="text-[11px] text-slate-400">{scheduleStatusHelperLine(status)}</p>
          <div className="text-[11px] text-slate-400">
            Status: <span className="text-slate-200">{scheduleStatusUserLabel(status)}</span>
          </div>
          <div className="text-[11px] text-slate-500">
            <span className="text-slate-400">Route source:</span> {routeSourceDisplay}
            {aiSuggestion ? (
              <>
                {" "}
                · <span className="text-slate-400">AI advisory:</span> {formatAiAdvisorySourceLine(aiSuggestion)}
              </>
            ) : null}
          </div>
          {aiSuggestion ? (
            <div className="rounded-md border border-slate-700/80 bg-slate-900/50 p-2 space-y-1">
              <p className="text-[11px] text-slate-200 font-medium">AI guidance</p>
              <p className="text-[11px] text-slate-300">{aiSuggestion.userFacingSummary || aiSuggestion.explanation}</p>
              {aiSuggestion.explanation && aiSuggestion.userFacingSummary ? (
                <p className="text-[10px] text-slate-500">{aiSuggestion.explanation}</p>
              ) : null}
              <p className="text-[10px] text-sky-300/90">
                Next: {aiSuggestion.suggestedNextAction || "Confirm route; interest expense follows the debt schedule."}
              </p>
              {aiMismatch ? <p className="text-[10px] text-amber-200/90">{aiMismatch}</p> : null}
            </div>
          ) : null}
          <p className="text-[10px] text-slate-600">
            There is no standalone interest-rate forecast on this line by design — use the <span className="text-slate-400">Debt schedule</span> card above (Apply) so interest expense is derived from tranche balances and rates.
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex flex-col gap-0.5">
              <button
                type="button"
                title="Optional shell flag only — does not compute interest."
                onClick={() => onStatusChange("applied")}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 text-left"
              >
                Mark as acknowledged (preview shell)
              </button>
              <span className="text-[9px] text-slate-600 max-w-[240px]">
                Tracks that you have reviewed this routing; does not run calculations or replace the debt schedule.
              </span>
            </span>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Classification</label>
            <select
              value={currentBucket}
              onChange={(e) => onBucketChange(e.target.value as Phase2LineBucket)}
              className="w-full max-w-sm rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
            >
              {BUCKET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Phase2ScheduledLineShell(props: {
  line: NonOperatingLeafLine;
  row: Row | null;
  scheduleCategory: Phase2ScheduleDisplayCategory | null;
  status: Phase2ScheduleShellStatus;
  nudges: Phase2LineNudgeSignal[];
  onStatusChange: (s: Phase2ScheduleShellStatus) => void;
  onOpenPlaceholder: (mode: "configure" | "view") => void;
  isPlaceholderTarget: boolean;
  onBucketChange: (b: Phase2LineBucket) => void;
  currentBucket: Phase2LineBucket;
  routeSourceDisplay: string;
  aiSuggestion?: NonOperatingPhase2AiLineSuggestion;
}) {
  const {
    line,
    row,
    scheduleCategory,
    status,
    nudges,
    onStatusChange,
    onOpenPlaceholder,
    isPlaceholderTarget,
    onBucketChange,
    currentBucket,
    routeSourceDisplay,
    aiSuggestion,
  } = props;
  const [open, setOpen] = useState(false);
  const configured = status === "applied" || status === "complete";
  const interestKind = row ? getNonOperatingInterestKind(row) : null;
  const pill = phase2ScheduleCategoryPillLabel(row, scheduleCategory);
  const aiMismatch =
    aiSuggestion != null && aiSuggestion.suggestedBucket !== currentBucket
      ? `AI suggests ${bucketLabel(aiSuggestion.suggestedBucket)} (${aiSuggestion.confidencePct}%): reference only.`
      : null;

  return (
    <div
      className={`rounded-lg border bg-slate-950/30 overflow-hidden ${
        isPlaceholderTarget ? "border-violet-500/50 ring-1 ring-violet-500/25" : "border-slate-700"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/20"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-100">{line.label}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Under: {line.parentLabel}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span className="inline-flex rounded border border-violet-800/50 bg-violet-950/30 px-1.5 py-0.5 text-[10px] text-violet-200">
              {pill}
            </span>
            <span className="text-[10px] text-slate-500">{routeSourceDisplay}</span>
            {aiSuggestion ? (
              <span className="text-[10px] text-slate-500">{aiSuggestion.confidencePct}% AI</span>
            ) : null}
          </div>
          <Phase2NudgePillsRow signals={nudges} />
          <div className="text-[10px] text-slate-500 mt-1">
            {bucketLabel(currentBucket)} · {scheduleStatusUserLabel(status)}
            {aiSuggestion?.userFacingSummary ? ` · ${aiSuggestion.userFacingSummary.slice(0, 90)}${aiSuggestion.userFacingSummary.length > 90 ? "…" : ""}` : ""}
          </div>
        </div>
        <span className="text-slate-500 text-xs shrink-0">{open ? "▼" : "▶"}</span>
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-0 border-t border-slate-800/80 space-y-3">
          {scheduleCategory === "interest" && interestKind === "expense" ? (
            <p className="text-[10px] text-slate-400 border-l-2 border-slate-600 pl-2">Reduces pre-tax income.</p>
          ) : null}
          {scheduleCategory === "interest" && interestKind === "income" ? (
            <p className="text-[10px] text-slate-400 border-l-2 border-slate-600 pl-2">Increases pre-tax income.</p>
          ) : null}
          <p className="text-[11px] text-slate-300 leading-relaxed">
            {scheduleExplanationLine(scheduleCategory, interestKind)}
          </p>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {scheduleImpactLine(scheduleCategory, interestKind)}
          </p>
          <p className="text-[11px] text-slate-400">{scheduleStatusHelperLine(status)}</p>
          <div className="text-[11px] text-slate-400">
            Status: <span className="text-slate-200">{scheduleStatusUserLabel(status)}</span>
          </div>
          <div className="text-[11px] text-slate-500">
            <span className="text-slate-400">Route source:</span> {routeSourceDisplay}
            {aiSuggestion ? (
              <>
                {" "}
                · <span className="text-slate-400">AI advisory:</span>{" "}
                {formatAiAdvisorySourceLine(aiSuggestion)}
              </>
            ) : null}
          </div>
          <div className="text-[11px] text-slate-400">
            Schedule type: <span className="text-slate-200">{pill}</span>
          </div>
          {aiSuggestion ? (
            <div className="rounded-md border border-slate-700/80 bg-slate-900/50 p-2 space-y-1">
              <p className="text-[11px] text-slate-200 font-medium">AI guidance</p>
              <p className="text-[11px] text-slate-300">{aiSuggestion.userFacingSummary || aiSuggestion.explanation}</p>
              {aiSuggestion.explanation && aiSuggestion.userFacingSummary ? (
                <p className="text-[10px] text-slate-500">{aiSuggestion.explanation}</p>
              ) : null}
              <p className="text-[10px] text-sky-300/90">
                Next: {aiSuggestion.suggestedNextAction || "Review route and schedule setup."}
              </p>
              {aiMismatch ? <p className="text-[10px] text-amber-200/90">{aiMismatch}</p> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onStatusChange(status === "not_set_up" ? "draft" : status);
                onOpenPlaceholder("configure");
              }}
              className="rounded-md bg-violet-700/80 px-3 py-1.5 text-xs font-medium text-violet-50 hover:bg-violet-600"
            >
              {configured ? "Reconfigure schedule" : "Configure schedule"}
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenPlaceholder("view");
              }}
              disabled={status === "not_set_up"}
              className="rounded-md border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              View schedule
            </button>
            {status === "draft" || status === "not_set_up" ? (
              <span className="inline-flex flex-col gap-0.5">
                <button
                  type="button"
                  title="Tracks setup status for this preview shell. Does not yet run schedule calculations."
                  onClick={() => onStatusChange("applied")}
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 text-left"
                >
                  Mark as configured (preview only)
                </button>
                <span className="text-[9px] text-slate-600 max-w-[220px]">
                  Tracks setup status for this preview shell. Does not yet run schedule calculations.
                </span>
              </span>
            ) : null}
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Classification</label>
            <select
              value={currentBucket}
              onChange={(e) => onBucketChange(e.target.value as Phase2LineBucket)}
              className="w-full max-w-sm rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
            >
              {BUCKET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Phase2DirectForecastLineCard(props: {
  line: NonOperatingLeafLine;
  row: Row | null;
  projectionYears: string[];
  currencyUnit: "units" | "thousands" | "millions";
  draft: NonOperatingPhase2DirectPersistBody;
  applied: NonOperatingPhase2DirectPersistBody | null;
  nudges: Phase2LineNudgeSignal[];
  onDraftChange: (next: NonOperatingPhase2DirectPersistBody) => void;
  onApply: () => void;
  onReset: () => void;
  onBucketChange: (b: Phase2LineBucket) => void;
  currentBucket: Phase2LineBucket;
  routeSourceDisplay: string;
  aiSuggestion?: NonOperatingPhase2AiLineSuggestion;
  onApplyAiPrefill: () => void;
}) {
  const {
    line,
    row,
    projectionYears,
    currencyUnit,
    draft,
    applied,
    nudges,
    onDraftChange,
    onApply,
    onReset,
    onBucketChange,
    currentBucket,
    routeSourceDisplay,
    aiSuggestion,
    onApplyAiPrefill,
  } = props;
  const [open, setOpen] = useState(false);
  const unsaved = applied == null || !directBodiesEqual(draft, applied);
  const unitLabel = getUnitLabel(currencyUnit);
  const hasApplied = applied != null && directBodiesEqual(draft, applied);

  const setDraft = (patch: Partial<NonOperatingPhase2DirectPersistBody>) => {
    onDraftChange({ ...draft, ...patch });
  };

  const isOtherIncomeTemplate = row?.id === "other_income";
  const aiPrefillDisabled =
    !aiSuggestion?.suggestedDirectMethod ||
    aiSuggestion.directForecastAppropriate === false ||
    aiSuggestion.suggestedBucket !== "direct";
  const aiMismatch =
    aiSuggestion != null && aiSuggestion.suggestedBucket !== currentBucket
      ? `AI suggests ${bucketLabel(aiSuggestion.suggestedBucket)} (${aiSuggestion.confidencePct}%): reference only.`
      : null;
  const signHint = signExpectationHint(aiSuggestion);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/20"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-100">{line.label}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Under: {line.parentLabel}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span className="inline-flex rounded border border-emerald-800/45 bg-emerald-950/25 px-1.5 py-0.5 text-[10px] text-emerald-200">
              Direct forecast
            </span>
            <span className="text-[10px] text-slate-500">{routeSourceDisplay}</span>
            {aiSuggestion ? (
              <span className="text-[10px] text-slate-500">{aiSuggestion.confidencePct}% AI</span>
            ) : null}
          </div>
          <Phase2NudgePillsRow signals={nudges} />
          <div className="text-[10px] text-slate-500 mt-1">
            {applied == null ? (
              <span className="text-amber-200/85">Not forecasted</span>
            ) : hasApplied ? (
              <span className="text-emerald-400/80">Applied</span>
            ) : (
              <span className="text-amber-200/90">Unsaved changes</span>
            )}
            {aiSuggestion?.userFacingSummary
              ? ` · ${aiSuggestion.userFacingSummary.slice(0, 80)}${aiSuggestion.userFacingSummary.length > 80 ? "…" : ""}`
              : ""}
          </div>
        </div>
        <span className="text-slate-500 text-xs shrink-0">{open ? "▼" : "▶"}</span>
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-0 border-t border-slate-800/80 space-y-3">
          <p className="text-[11px] text-slate-400">
            Recurring non-operating line — forecast directly here when it is not schedule-driven (interest expense is
            never forecast in this section; it follows the debt schedule). Same method family as OpEx direct forecasts
            (shell only; no statement write yet).
          </p>
          {signHint ? <p className="text-[10px] text-slate-500 border-l-2 border-slate-600 pl-2">{signHint}</p> : null}
          {aiSuggestion ? (
            <div className="rounded-md border border-slate-700/80 bg-slate-900/50 p-2 space-y-1">
              <p className="text-[11px] text-slate-200 font-medium">AI guidance</p>
              <p className="text-[11px] text-slate-300">{aiSuggestion.userFacingSummary || aiSuggestion.explanation}</p>
              {isOtherIncomeTemplate && aiSuggestion.directVsScheduleRationale ? (
                <p className="text-[10px] text-amber-200/85">
                  Other income / expense: {aiSuggestion.directVsScheduleRationale}
                </p>
              ) : null}
              <p className="text-[10px] text-slate-500">
                Recurring judgment: {aiSuggestion.recurringJudgment.replace(/_/g, " ")} · Direct forecast
                appropriate:{" "}
                {aiSuggestion.directForecastAppropriate == null
                  ? "unclear"
                  : aiSuggestion.directForecastAppropriate
                    ? "yes"
                    : "no — prefer schedule, review, or exclude"}
              </p>
              <p className="text-[10px] text-sky-300/90">Next: {aiSuggestion.suggestedNextAction}</p>
              {aiMismatch ? <p className="text-[10px] text-amber-200/90">{aiMismatch}</p> : null}
              <button
                type="button"
                disabled={aiPrefillDisabled}
                title={
                  aiPrefillDisabled
                    ? "Run AI classification or wait for a direct-forecast method suggestion."
                    : "Prefills the recommended method in the draft only — review and click Apply."
                }
                onClick={onApplyAiPrefill}
                className="mt-1 rounded-md border border-sky-700/50 bg-sky-950/40 px-2.5 py-1 text-[11px] font-medium text-sky-200 hover:bg-sky-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Apply AI suggestion (prefill)
              </button>
              <p className="text-[9px] text-slate-600">
                Prefill updates the draft only — nothing is saved until you click Apply.
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-slate-600">
              Run <span className="text-slate-400">Refresh AI classification</span> above for method and route
              suggestions.
            </p>
          )}
          <div className="text-[11px] text-slate-500">
            <span className="text-slate-400">Route source:</span> {routeSourceDisplay}
            {aiSuggestion ? (
              <>
                {" "}
                · <span className="text-slate-400">AI advisory:</span>{" "}
                {formatAiAdvisorySourceLine(aiSuggestion)}
              </>
            ) : null}
          </div>
          <div>
            <label className="block text-[10px] uppercase text-slate-500 mb-1">Forecast method</label>
            <select
              value={draft.method}
              onChange={(e) => setDraft({ method: e.target.value as OpExDirectForecastMethodV1 })}
              className="w-full max-w-xs rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
            >
              <option value="pct_of_revenue">% of revenue</option>
              <option value="growth_percent">Growth %</option>
              <option value="flat_value">Flat value</option>
              <option value="manual_by_year">Manual by year</option>
            </select>
          </div>
          {draft.method === "pct_of_revenue" ? (
            <div>
              <label className="block text-[10px] uppercase text-slate-500 mb-1">% of revenue</label>
              <input
                type="number"
                step={0.1}
                className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                value={draft.pct || ""}
                onChange={(e) => setDraft({ pct: parseFloat(e.target.value) || 0 })}
              />
              <span className="ml-1 text-xs text-slate-500">%</span>
            </div>
          ) : null}
          {draft.method === "growth_percent" ? (
            <div>
              <label className="block text-[10px] uppercase text-slate-500 mb-1">Growth % (YoY)</label>
              <input
                type="number"
                step={0.1}
                className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                value={draft.growth || ""}
                onChange={(e) => setDraft({ growth: parseFloat(e.target.value) || 0 })}
              />
              <span className="ml-1 text-xs text-slate-500">%</span>
            </div>
          ) : null}
          {draft.method === "flat_value" ? (
            <div>
              <label className="block text-[10px] uppercase text-slate-500 mb-1">Amount ({unitLabel})</label>
              <input
                type="number"
                step={0.01}
                className="w-28 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                value={draft.flat ? storedToDisplay(draft.flat, currencyUnit) : ""}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setDraft({ flat: Number.isFinite(n) ? displayToStored(n, currencyUnit) : 0 });
                }}
              />
            </div>
          ) : null}
          {draft.method === "manual_by_year" && projectionYears.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {projectionYears.map((y) => (
                <div key={y} className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 w-10">{y}</span>
                  <input
                    type="number"
                    step={0.01}
                    className="w-20 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-200"
                    value={
                      draft.manualByYear[y] != null
                        ? storedToDisplay(draft.manualByYear[y]!, currencyUnit)
                        : ""
                    }
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      const next = { ...draft.manualByYear, [y]: Number.isFinite(n) ? displayToStored(n, currencyUnit) : 0 };
                      setDraft({ manualByYear: next });
                    }}
                  />
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onApply}
              className="rounded-md bg-emerald-700/80 px-3 py-1.5 text-xs font-medium text-emerald-50 hover:bg-emerald-600 disabled:opacity-40"
              disabled={!unsaved}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={onReset}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              disabled={!unsaved}
            >
              Reset changes
            </button>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Classification</label>
            <select
              value={currentBucket}
              onChange={(e) => onBucketChange(e.target.value as Phase2LineBucket)}
              className="w-full max-w-sm rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
            >
              {BUCKET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Phase2RoutedLineShell(props: {
  line: NonOperatingLeafLine;
  variant: "review" | "excluded";
  onBucketChange: (b: Phase2LineBucket) => void;
  currentBucket: Phase2LineBucket;
  routeSourceDisplay: string;
  aiSuggestion?: NonOperatingPhase2AiLineSuggestion;
}) {
  const { line, variant, onBucketChange, currentBucket, routeSourceDisplay, aiSuggestion } = props;
  const [open, setOpen] = useState(false);
  const pill =
    variant === "review" ? (
      <span className="inline-flex rounded border border-amber-800/50 bg-amber-950/30 px-1.5 py-0.5 text-[10px] text-amber-200">
        Needs confirmation
      </span>
    ) : (
      <span className="inline-flex rounded border border-slate-600 bg-slate-800/50 px-1.5 py-0.5 text-[10px] text-slate-400">
        Excluded
      </span>
    );
  const aiMismatch =
    aiSuggestion != null && aiSuggestion.suggestedBucket !== currentBucket
      ? `AI suggests ${bucketLabel(aiSuggestion.suggestedBucket)} (${aiSuggestion.confidencePct}%).`
      : null;

  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        variant === "review"
          ? "border-amber-900/35 bg-amber-950/10"
          : "border-slate-700 bg-slate-950/30"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-slate-800/15"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-100">{line.label}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Under: {line.parentLabel}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {pill}
            <span className="text-[10px] text-slate-500">{routeSourceDisplay}</span>
            {aiSuggestion ? (
              <span className="text-[10px] text-slate-500">{aiSuggestion.confidencePct}% AI</span>
            ) : null}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            {bucketLabel(currentBucket)}
            {variant === "review" ? " · Needs review" : " · Excluded"}
            {aiSuggestion?.userFacingSummary
              ? ` · ${aiSuggestion.userFacingSummary.slice(0, 72)}${aiSuggestion.userFacingSummary.length > 72 ? "…" : ""}`
              : ""}
          </div>
        </div>
        <span className="text-slate-500 text-xs shrink-0">{open ? "▼" : "▶"}</span>
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-0 border-t border-slate-800/60 space-y-3">
          <p className="text-[11px] text-slate-400">
            {variant === "review"
              ? "This line is below operating income but its treatment is ambiguous. Choose a classification to move it into Scheduled items, direct forecast, or Excluded."
              : "This line is treated as non-recurring or out of scope for the recurring below-EBIT forecast."}
          </p>
          <div className="text-[11px] text-slate-500">
            <span className="text-slate-400">Route source:</span> {routeSourceDisplay}
            {aiSuggestion ? (
              <>
                {" "}
                · <span className="text-slate-400">AI:</span> {formatAiAdvisorySourceLine(aiSuggestion)}
              </>
            ) : null}
          </div>
          {aiSuggestion ? (
            <div className="rounded-md border border-slate-700/80 bg-slate-900/50 p-2 space-y-1">
              <p className="text-[11px] text-slate-200 font-medium">AI guidance</p>
              <p className="text-[11px] text-slate-300">{aiSuggestion.userFacingSummary || aiSuggestion.explanation}</p>
              <p className="text-[10px] text-sky-300/90">Next: {aiSuggestion.suggestedNextAction}</p>
              {aiMismatch ? <p className="text-[10px] text-amber-200/90">{aiMismatch} Reference only until you change classification.</p> : null}
            </div>
          ) : null}
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Classification</label>
            <select
              value={currentBucket}
              onChange={(e) => onBucketChange(e.target.value as Phase2LineBucket)}
              className="w-full max-w-sm rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
            >
              {BUCKET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function NonOperatingSchedulesPhase2Panel() {
  const incomeStatement = useModelStore((s) => s.incomeStatement ?? []);
  const balanceSheet = useModelStore((s) => s.balanceSheet ?? []);
  const meta = useModelStore((s) => s.meta);
  const projectionYears = meta?.years?.projection ?? [];
  const historicalYears = meta?.years?.historical ?? [];
  const lastHistYear = historicalYears.length > 0 ? historicalYears[historicalYears.length - 1]! : null;
  const currencyUnit = meta?.currencyUnit ?? "millions";

  const scheduleStatusByLine = useModelStore((s) => s.nonOperatingPhase2ScheduleStatusByLine ?? {});
  const bucketOverrides = useModelStore((s) => s.nonOperatingPhase2BucketOverrides ?? {});
  const directByLine = useModelStore((s) => s.nonOperatingPhase2DirectByLine ?? {});
  const aiByLine = useModelStore((s) => s.nonOperatingPhase2AiByLine ?? {});
  const classificationLockedByLine = useModelStore((s) => s.nonOperatingPhase2ClassificationLockedByLine ?? {});
  const companyContext = useModelStore((s) => s.companyContext);
  const setNonOperatingPhase2ScheduleStatus = useModelStore((s) => s.setNonOperatingPhase2ScheduleStatus);
  const setNonOperatingPhase2BucketOverride = useModelStore((s) => s.setNonOperatingPhase2BucketOverride);
  const setNonOperatingPhase2DirectLine = useModelStore((s) => s.setNonOperatingPhase2DirectLine);
  const mergeNonOperatingPhase2AiSuggestions = useModelStore((s) => s.mergeNonOperatingPhase2AiSuggestions);
  const setNonOperatingPhase2ClassificationLocked = useModelStore((s) => s.setNonOperatingPhase2ClassificationLocked);

  const leaves = useMemo(
    () => collectNonOperatingIncomeLeaves(incomeStatement),
    [incomeStatement]
  );

  const [placeholder, setPlaceholder] = useState<{
    lineId: string;
    label: string;
    mode: "configure" | "view";
  } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [routeMeaningsOpen, setRouteMeaningsOpen] = useState(false);

  const effectiveBucket = (line: NonOperatingLeafLine): Phase2LineBucket => {
    const row = findIsRowById(incomeStatement, line.lineId);
    const base = row ? defaultPhase2Bucket(row) : "review";
    return bucketOverrides[line.lineId] ?? base;
  };

  const setBucket = (lineId: string, b: Phase2LineBucket) => {
    const row = findIsRowById(incomeStatement, lineId);
    const def = row ? defaultPhase2Bucket(row) : "review";
    if (b === def) {
      setNonOperatingPhase2BucketOverride(lineId, null);
      setNonOperatingPhase2ClassificationLocked(lineId, false);
    } else {
      setNonOperatingPhase2BucketOverride(lineId, b);
      setNonOperatingPhase2ClassificationLocked(lineId, true);
    }
  };

  const routeSourceFor = (lineId: string, eff: Phase2LineBucket): string => {
    const row = findIsRowById(incomeStatement, lineId);
    const locked = classificationLockedByLine[lineId] === true;
    return formatRouteSourceLabel(
      resolvePhase2RouteSource({ row, effectiveBucket: eff, classificationLocked: locked })
    );
  };

  const runAiClassification = async () => {
    if (leaves.length === 0) return;
    setAiError(null);
    setAiNotice(null);
    setAiLoading(true);
    try {
      const items = leaves.map((leaf) => {
        const row = findIsRowById(incomeStatement, leaf.lineId);
        const det = row ? defaultPhase2Bucket(row) : "review";
        return {
          lineId: leaf.lineId,
          label: leaf.label,
          parentLabel: leaf.parentLabel,
          deterministicBucket: det,
          lastHistoricalValueText: lastHistoricalSnippet(row, lastHistYear),
        };
      });
      const res = await fetch("/api/ai/non-operating-phase2-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, companyContext }),
      });
      const data = (await res.json()) as {
        suggestions?: NonOperatingPhase2AiLineSuggestion[];
        error?: string;
      };
      if (!res.ok) {
        setAiError(data.error ?? "AI request failed");
        return;
      }
      const sugs = data.suggestions ?? [];
      mergeNonOperatingPhase2AiSuggestions(sugs);
      setAiNotice(
        sugs.length > 0
          ? "AI suggestions stored for each line. Your classifications and overrides are unchanged — use them as advisory only."
          : null
      );
    } catch {
      setAiError("Network error");
    } finally {
      setAiLoading(false);
    }
  };

  const applyDirectAiPrefill = (lineId: string) => {
    const sug = aiByLine[lineId];
    const method = sug?.suggestedDirectMethod;
    if (!method || sug.suggestedBucket !== "direct" || sug.directForecastAppropriate === false) return;
    const st: NonOperatingPhase2DirectLinePersist = directByLine[lineId] ?? {
      draft: defaultNonOperatingDirectBody(projectionYears),
      applied: null,
    };
    setNonOperatingPhase2DirectLine(lineId, {
      draft: { ...st.draft, method },
      applied: st.applied,
    });
  };

  const scheduledLines = leaves.filter((l) => effectiveBucket(l) === "scheduled");
  const directLines = leaves.filter((l) => effectiveBucket(l) === "direct");
  const reviewLines = leaves.filter((l) => effectiveBucket(l) === "review");
  const excludedLines = leaves.filter((l) => effectiveBucket(l) === "excluded");

  const getScheduleStatus = (lineId: string): Phase2ScheduleShellStatus =>
    scheduleStatusByLine[lineId] ?? "not_set_up";

  const setScheduleStatus = (lineId: string, s: Phase2ScheduleShellStatus) => {
    setNonOperatingPhase2ScheduleStatus(lineId, s);
  };

  const scheduledHighImpactIds = useMemo(
    () =>
      computePhase2HighImpactLineIds({
        lineIds: scheduledLines.map((l) => l.lineId),
        incomeStatement,
        lastHistYear,
      }),
    [scheduledLines, incomeStatement, lastHistYear]
  );

  const directHighImpactIds = useMemo(
    () =>
      computePhase2HighImpactLineIds({
        lineIds: directLines.map((l) => l.lineId),
        incomeStatement,
        lastHistYear,
      }),
    [directLines, incomeStatement, lastHistYear]
  );

  const globalSummary = useMemo(() => {
    const eb = (line: NonOperatingLeafLine): Phase2LineBucket => {
      const row = findIsRowById(incomeStatement, line.lineId);
      const base = row ? defaultPhase2Bucket(row) : "review";
      return bucketOverrides[line.lineId] ?? base;
    };
    return buildPhase2GlobalSummary({
      leaves,
      incomeStatement,
      effectiveBucket: eb,
      scheduleStatusByLine,
      directByLine,
    });
  }, [leaves, incomeStatement, bucketOverrides, scheduleStatusByLine, directByLine]);

  const startHereSteps = useMemo(() => buildPhase2StartHereSteps(globalSummary), [globalSummary]);

  const scheduledSummary = useMemo(() => {
    const n = scheduledLines.length;
    const needsSetup = scheduledLines.filter((l) => getScheduleStatus(l.lineId) === "not_set_up").length;
    const inProgress = scheduledLines.filter((l) => getScheduleStatus(l.lineId) === "draft").length;
    const bits = ["Debt + amortization placeholders"];
    if (n === 0) bits.push("no IS lines schedule-routed yet");
    else {
      bits.push(`${n} schedule-routed line${n === 1 ? "" : "s"}`);
      if (needsSetup > 0) bits.push(`${needsSetup} need setup`);
      if (inProgress > 0) bits.push(`${inProgress} in progress`);
    }
    return bits.join(" · ");
  }, [scheduledLines, scheduleStatusByLine]);

  const scheduledReadiness = useMemo(() => {
    if (scheduledLines.length === 0) return "";
    const done = scheduledLines.filter((l) => {
      const s = scheduleStatusByLine[l.lineId] ?? "not_set_up";
      return s === "applied" || s === "complete";
    }).length;
    const fragments: string[] = [];
    const ns = scheduledLines.filter((l) => (scheduleStatusByLine[l.lineId] ?? "not_set_up") === "not_set_up").length;
    if (ns > 0) fragments.push(`${ns} needs setup`);
    return [...fragments, `${done} of ${scheduledLines.length} configured`].filter(Boolean).join(" · ");
  }, [scheduledLines, scheduleStatusByLine]);

  const directSummary = useMemo(() => {
    const n = directLines.length;
    if (n === 0) return "No lines";
    let notForecasted = 0;
    let worthReview = 0;
    for (const l of directLines) {
      const st = directByLine[l.lineId];
      if (!st || st.applied == null) notForecasted += 1;
      else if (!directBodiesEqual(st.draft, st.applied)) worthReview += 1;
    }
    const bits = [`${n} line${n === 1 ? "" : "s"}`];
    if (notForecasted > 0) bits.push(`${notForecasted} not forecasted`);
    else if (worthReview === 0 && n > 0) bits.push("all applied");
    if (worthReview > 0) bits.push(`${worthReview} worth reviewing`);
    return bits.join(" · ");
  }, [directLines, directByLine]);

  const directReadiness = useMemo(() => {
    if (directLines.length === 0) return "";
    let appliedCount = 0;
    let notApplied = 0;
    for (const l of directLines) {
      const st = directByLine[l.lineId];
      if (st?.applied != null && directBodiesEqual(st.draft, st.applied)) appliedCount += 1;
      if (!st || st.applied == null) notApplied += 1;
    }
    const parts: string[] = [];
    if (notApplied > 0) parts.push(`${notApplied} not applied`);
    parts.push(`${appliedCount} of ${directLines.length} applied`);
    return parts.join(" · ");
  }, [directLines, directByLine]);

  const priority = globalSummary.prioritySection;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">Non-operating &amp; Schedules</h2>
        <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
          Forecast recurring below-EBIT items directly when they are not schedule-driven. Schedule placeholders (debt,
          amortization, …) document where dedicated engines will plug in — interest expense is owned by the future debt
          schedule, not a standalone forecast here.
        </p>
        <p className="text-[11px] text-slate-500 mt-1.5">
          Workspace order: direct non-operating forecasts first, then create/configure schedules (debt schedule drives
          interest expense later), then review and exclusions.
        </p>
      </div>

      <div className="rounded-md border border-violet-900/35 bg-violet-950/10 px-3 py-2.5">
        <p className="text-[11px] font-semibold text-violet-200/95">Start here</p>
        <ol className="mt-1.5 list-decimal list-inside space-y-1 text-[11px] text-slate-300 leading-relaxed">
          {startHereSteps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="rounded-md border border-slate-700/80 bg-slate-900/50 px-3 py-2">
        <p className="text-[11px] text-slate-400 leading-snug">{globalSummary.barText}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRouteMeaningsOpen((o) => !o)}
          className="rounded-md border border-slate-600 bg-slate-800/70 px-3 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
        >
          {routeMeaningsOpen ? "Hide route meanings" : "Route meanings"}
        </button>
        <button
          type="button"
          onClick={() => void runAiClassification()}
          disabled={aiLoading || leaves.length === 0}
          className="rounded-md border border-sky-700/50 bg-sky-950/35 px-3 py-1.5 text-[11px] font-medium text-sky-200 hover:bg-sky-900/45 disabled:opacity-40"
        >
          {aiLoading ? "Running AI…" : "Refresh AI classification"}
        </button>
      </div>
      {aiError ? <p className="text-[11px] text-red-400/90">{aiError}</p> : null}
      {aiNotice ? <p className="text-[11px] text-sky-300/85">{aiNotice}</p> : null}
      {routeMeaningsOpen ? (
        <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-2">
          {ROUTE_MEANINGS.map((m) => (
            <div key={m.title}>
              <p className="text-[11px] font-semibold text-slate-200">{m.title}</p>
              <p className="text-[11px] text-slate-500 leading-relaxed">{m.body}</p>
            </div>
          ))}
        </div>
      ) : null}

      <Phase2SectionAccordion
        title={<span className="text-sm font-semibold text-slate-100">Forecast direct non-operating items</span>}
        subtitle="Recurring below-EBIT lines that are not schedule-driven — Apply saves assumptions; preview uses applied values only."
        summary={directSummary}
        defaultExpanded={directLines.length > 0 || scheduledLines.length === 0}
        readinessHint={directReadiness ? `Direct non-operating: ${directReadiness}` : undefined}
        priorityHighlight={priority === "direct"}
        startHereHint={priority === "direct" && !globalSummary.isPhase2Complete}
      >
        <div className="p-3 space-y-3 bg-slate-950/20">
          {directLines.length === 0 ? (
            <p className="text-xs text-slate-500 px-1">No direct-forecast lines in this section.</p>
          ) : (
            directLines.map((line) => {
              const row = findIsRowById(incomeStatement, line.lineId);
              const eff = effectiveBucket(line);
              const st: NonOperatingPhase2DirectLinePersist = directByLine[line.lineId] ?? {
                draft: defaultNonOperatingDirectBody(projectionYears),
                applied: null,
              };
              const dirNudges = getPhase2DirectLineNudges({
                applied: st.applied != null,
                unsaved: st.applied != null && !directBodiesEqual(st.draft, st.applied),
                highImpact: directHighImpactIds.has(line.lineId),
              });
              return (
                <Phase2DirectForecastLineCard
                  key={line.lineId}
                  line={line}
                  row={row}
                  projectionYears={projectionYears}
                  currencyUnit={currencyUnit}
                  draft={st.draft}
                  applied={st.applied}
                  nudges={dirNudges}
                  onDraftChange={(next) =>
                    setNonOperatingPhase2DirectLine(line.lineId, {
                      draft: next,
                      applied: st.applied,
                    })
                  }
                  onApply={() =>
                    setNonOperatingPhase2DirectLine(line.lineId, {
                      draft: cloneDirectBody(st.draft),
                      applied: cloneDirectBody(st.draft),
                    })
                  }
                  onReset={() => {
                    const base = st.applied
                      ? cloneDirectBody(st.applied)
                      : defaultNonOperatingDirectBody(projectionYears);
                    setNonOperatingPhase2DirectLine(line.lineId, { draft: base, applied: st.applied });
                  }}
                  onBucketChange={(b) => setBucket(line.lineId, b)}
                  currentBucket={eff}
                  routeSourceDisplay={routeSourceFor(line.lineId, eff)}
                  aiSuggestion={aiByLine[line.lineId]}
                  onApplyAiPrefill={() => applyDirectAiPrefill(line.lineId)}
                />
              );
            })
          )}
        </div>
      </Phase2SectionAccordion>

      <Phase2SectionAccordion
        title={<span className="text-sm font-semibold text-slate-100">Create / configure schedules</span>}
        subtitle="Placeholders for dedicated engines (debt → interest expense, amortization, …). Not forecast directly here."
        summary={scheduledSummary}
        defaultExpanded={scheduledLines.length > 0 && directLines.length === 0}
        readinessHint={scheduledReadiness ? `Schedule setup: ${scheduledReadiness}` : undefined}
        priorityHighlight={priority === "scheduled"}
        startHereHint={priority === "scheduled" && !globalSummary.isPhase2Complete}
      >
        <div className="p-3 space-y-3 bg-slate-950/20">
          <DebtSchedulePhase2Builder
            projectionYears={projectionYears}
            currencyUnit={currencyUnit}
            balanceSheet={balanceSheet}
            lastHistoricYear={lastHistYear}
          />
          <Phase2AmortizationSchedulePlaceholderCard />
          {placeholder && scheduledLines.some((l) => l.lineId === placeholder.lineId) ? (
            <div className="rounded-lg border border-violet-800/40 bg-violet-950/15 p-4 space-y-2">
              <h3 className="text-xs font-semibold text-violet-200">
                {placeholder.mode === "configure" ? "Configure schedule" : "View schedule"} · {placeholder.label}
              </h3>
              <p className="text-[11px] text-slate-400">
                Mapped lines: <span className="text-slate-200">{placeholder.label}</span>
              </p>
              <p className="text-[11px] text-slate-500">
                Engine not built yet — see Debt schedule above for interest expense; other schedules will follow the same
                pattern.
              </p>
              <button
                type="button"
                onClick={() => setPlaceholder(null)}
                className="text-[11px] text-violet-300 hover:text-violet-200"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <p className="text-[10px] text-slate-600 px-1">
            Income-statement lines routed as schedule-driven appear below. Interest expense links to the debt schedule
            — there is no standalone interest forecast in this section.
          </p>
          {scheduledLines.length === 0 ? (
            <p className="text-xs text-slate-500 px-1">No lines classified as schedule-driven yet.</p>
          ) : (
            scheduledLines.map((line) => {
              const row = findIsRowById(incomeStatement, line.lineId);
              const cat = row ? inferScheduleDisplayCategory(row) : null;
              const schedNudges = getPhase2ScheduledLineNudges({
                status: getScheduleStatus(line.lineId),
                highImpact: scheduledHighImpactIds.has(line.lineId),
              });
              const eff = effectiveBucket(line);
              if (line.lineId === INTEREST_EXPENSE_LINE_ID) {
                return (
                  <Phase2InterestExpenseDebtLinkedShell
                    key={line.lineId}
                    line={line}
                    row={row}
                    scheduleCategory={cat}
                    status={getScheduleStatus(line.lineId)}
                    nudges={schedNudges}
                    onStatusChange={(s) => setScheduleStatus(line.lineId, s)}
                    onBucketChange={(b) => setBucket(line.lineId, b)}
                    currentBucket={eff}
                    routeSourceDisplay={routeSourceFor(line.lineId, eff)}
                    aiSuggestion={aiByLine[line.lineId]}
                  />
                );
              }
              return (
                <Phase2ScheduledLineShell
                  key={line.lineId}
                  line={line}
                  row={row}
                  scheduleCategory={cat}
                  status={getScheduleStatus(line.lineId)}
                  nudges={schedNudges}
                  onStatusChange={(s) => setScheduleStatus(line.lineId, s)}
                  onOpenPlaceholder={(mode) => setPlaceholder({ lineId: line.lineId, label: line.label, mode })}
                  isPlaceholderTarget={placeholder?.lineId === line.lineId}
                  onBucketChange={(b) => setBucket(line.lineId, b)}
                  currentBucket={eff}
                  routeSourceDisplay={routeSourceFor(line.lineId, eff)}
                  aiSuggestion={aiByLine[line.lineId]}
                />
              );
            })
          )}
        </div>
      </Phase2SectionAccordion>

      <Phase2SectionAccordion
        variant="needs_review"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-amber-100/95">Needs review</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-amber-400/80">Action</span>
          </span>
        }
        subtitle={
          reviewLines.length > 0
            ? "These lines need your confirmation before forecasting."
            : "When every line is classified, nothing appears here."
        }
        summary={
          reviewLines.length > 0
            ? `${reviewLines.length} item${reviewLines.length === 1 ? "" : "s"} need review`
            : "All lines reviewed ✓"
        }
        defaultExpanded={reviewLines.length > 0}
        readinessHint={
          reviewLines.length === 0 ? "Needs review: All lines reviewed ✓" : undefined
        }
        priorityHighlight={priority === "review"}
        startHereHint={priority === "review" && !globalSummary.isPhase2Complete}
      >
        <div className="p-3 space-y-3 bg-slate-950/25">
          {reviewLines.length === 0 ? (
            <div className="px-2 py-2" aria-hidden />
          ) : (
            reviewLines.map((line) => {
              const eff = effectiveBucket(line);
              return (
                <Phase2RoutedLineShell
                  key={line.lineId}
                  line={line}
                  variant="review"
                  onBucketChange={(b) => setBucket(line.lineId, b)}
                  currentBucket={eff}
                  routeSourceDisplay={routeSourceFor(line.lineId, eff)}
                  aiSuggestion={aiByLine[line.lineId]}
                />
              );
            })
          )}
        </div>
      </Phase2SectionAccordion>

      <Phase2SectionAccordion
        variant="excluded"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">Excluded</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Resolved</span>
          </span>
        }
        subtitle="These lines are not included in the recurring forecast."
        summary={
          excludedLines.length === 0
            ? "No lines"
            : `${excludedLines.length} line${excludedLines.length === 1 ? "" : "s"}`
        }
        defaultExpanded={false}
      >
        <div className="p-3 space-y-3 bg-slate-950/25">
          {excludedLines.length === 0 ? (
            <p className="text-xs text-slate-500 px-1">No excluded lines.</p>
          ) : (
            excludedLines.map((line) => {
              const eff = effectiveBucket(line);
              return (
                <Phase2RoutedLineShell
                  key={line.lineId}
                  line={line}
                  variant="excluded"
                  onBucketChange={(b) => setBucket(line.lineId, b)}
                  currentBucket={eff}
                  routeSourceDisplay={routeSourceFor(line.lineId, eff)}
                  aiSuggestion={aiByLine[line.lineId]}
                />
              );
            })
          )}
        </div>
      </Phase2SectionAccordion>
    </div>
  );
}
