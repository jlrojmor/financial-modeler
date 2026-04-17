"use client";

import type { Row } from "@/types/finance";
import type { CfsAiRecommendedTreatment } from "@/types/cfs-forecast-diagnosis-v1";
import type { CfsLineForecastDiagnosisV1 } from "@/types/cfs-forecast-diagnosis-v1";
import { formatCfsRowLinksResolved } from "@/lib/cfs-disclosure-ui-helpers";

const TREATMENT_CHOICES: { value: CfsAiRecommendedTreatment; label: string }[] = [
  { value: "flat_last", label: "Flat to last actual" },
  { value: "pct_revenue", label: "% of revenue" },
  { value: "zero", label: "Zero" },
  { value: "exclude", label: "Exclude (rollup)" },
  { value: "manual_grid", label: "Manual by year" },
  { value: "map_to_bs", label: "Map to balance sheet (Historicals)" },
  { value: "use_is_bridge", label: "Use IS bridge (Historicals)" },
];

function modelEffectForTreatment(t: CfsAiRecommendedTreatment | undefined): string {
  if (!t) return "—";
  const m: Record<CfsAiRecommendedTreatment, string> = {
    flat_last: "Projection years use this line’s last historical amount on the CFS row. Appears in Projected Statements CFS and export.",
    pct_revenue: "Each projection year = (pct ÷ 100) × forecast revenue. Same write path as preview.",
    zero: "Forces 0 in all projection years.",
    exclude: "Sets to 0; optional hide from rolled-up CFS preview if enabled.",
    manual_grid: "You enter each projection year; stored on policy and written to cashFlow on build.",
    map_to_bs:
      "No number from this tab. Set BS link in Historicals so the line is no longer disclosure-only; then engine bridges.",
    use_is_bridge:
      "No number from this tab. Bridge to IS in Historicals so forecast flows through; then not disclosure-only.",
  };
  return m[t];
}

const STATUS_BADGE: Record<
  NonNullable<CfsLineForecastDiagnosisV1["userStatus"]>,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-amber-500/10 text-amber-400 border border-amber-500/30",
  },
  accepted: {
    label: "Accepted",
    className: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
  },
  edited: {
    label: "Edited",
    className: "bg-sky-500/10 text-sky-300 border border-sky-500/30",
  },
  dismissed: {
    label: "Dismissed",
    className: "bg-slate-600/10 text-slate-400 border border-slate-600/30",
  },
};

function StatusBadge({ status }: { status: CfsLineForecastDiagnosisV1["userStatus"] | undefined }) {
  const s = status ?? "pending";
  const cfg = STATUS_BADGE[s] ?? STATUS_BADGE.pending;
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

const MATERIALITY_LABEL: Record<string, string> = {
  immaterial: "Immaterial",
  standard: "Standard",
  material: "Material",
};

export default function CfsDisclosureLineCard({
  rowId,
  label,
  row,
  balanceSheet,
  incomeStatement,
  diag,
  onAccept,
  onDismiss,
  onOverrideChange,
}: {
  rowId: string;
  label: string;
  row: Row | null;
  balanceSheet: Row[];
  incomeStatement: Row[];
  diag: CfsLineForecastDiagnosisV1 | undefined;
  onAccept: () => void;
  onDismiss: () => void;
  onOverrideChange: (t: CfsAiRecommendedTreatment | "") => void;
}) {
  const ai = diag?.ai;
  const effTreatment = diag?.editedTreatment ?? ai?.recommendedTreatment;
  const resolved = formatCfsRowLinksResolved(row, balanceSheet, incomeStatement);

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/30 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 bg-slate-800/40 border-b border-slate-700/40">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-100 leading-snug">{label}</h3>
          <p className="text-[10px] font-mono text-slate-500 truncate mt-0.5" title={rowId}>
            {rowId}
          </p>
        </div>
        <StatusBadge status={diag?.userStatus} />
      </div>

      <div className="px-4 py-4 space-y-4">
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Links (Historicals)</h4>
          <p className="text-xs text-slate-300 leading-relaxed" title={resolved.title}>
            {resolved.compact}
          </p>
        </section>

        {ai ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">AI recommendation</span>
              <span className="rounded-full border border-violet-500/35 bg-violet-500/10 px-2.5 py-0.5 text-xs font-medium text-violet-200">
                {ai.recommendedTreatment}
              </span>
              <span className="text-xs text-slate-500">{(ai.confidence * 100).toFixed(0)}% confidence</span>
              {ai.materialityNote ? (
                <span className="rounded-full border border-slate-600 bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-400">
                  {MATERIALITY_LABEL[ai.materialityNote] ?? ai.materialityNote}
                </span>
              ) : null}
            </div>

            {ai.executiveSummary ? (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  Executive summary
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{ai.executiveSummary}</p>
              </section>
            ) : null}

            {ai.bridgeRecommendation ? (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  Bridge recommendation
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{ai.bridgeRecommendation}</p>
              </section>
            ) : null}

            {ai.doubleCountRisk ? (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-amber-600/90 mb-1.5">
                  Double-count risk
                </h4>
                <p className="text-xs text-amber-200/90 leading-relaxed">{ai.doubleCountRisk}</p>
              </section>
            ) : null}

            {ai.rejectedAlternatives?.length ? (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  Alternatives not chosen
                </h4>
                <ul className="list-disc pl-4 text-xs text-slate-400 space-y-1">
                  {ai.rejectedAlternatives.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {ai.rationale ? (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Technical note</h4>
                <p className="text-xs text-slate-400 leading-relaxed">{ai.rationale}</p>
              </section>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-slate-500">Run CFS diagnosis to get structured recommendations for this line.</p>
        )}

        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Model effect (override)</h4>
          <p className="text-xs text-slate-400 leading-relaxed mb-2">{modelEffectForTreatment(effTreatment)}</p>
          <label className="sr-only" htmlFor={`override-${rowId}`}>
            Override treatment
          </label>
          <select
            id={`override-${rowId}`}
            className="w-full max-w-xl rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            value={effTreatment ?? ""}
            onChange={(e) => onOverrideChange((e.target.value || "") as CfsAiRecommendedTreatment | "")}
            disabled={!row}
          >
            <option value="">Select treatment…</option>
            {TREATMENT_CHOICES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </section>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="rounded-md border border-emerald-600/50 bg-emerald-600/15 px-4 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-600/25 disabled:opacity-40"
            disabled={!diag?.ai && !diag?.editedTreatment}
            onClick={onAccept}
          >
            Accept
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-600 px-4 py-2 text-xs text-slate-400 hover:bg-slate-800/80"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
