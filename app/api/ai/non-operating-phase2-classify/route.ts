import { NextResponse } from "next/server";
import type { CompanyContext } from "@/types/company-context";
import type { OpExDirectForecastMethodV1 } from "@/types/opex-forecast-v1";
import type {
  NonOperatingPhase2AiLineSuggestion,
  NonOperatingPhase2AiRouteBucket,
  NonOperatingPhase2DirectMethodAi,
  NonOperatingPhase2RecurringJudgment,
  NonOperatingPhase2ScheduleTypeAi,
  NonOperatingPhase2SignExpectation,
} from "@/types/non-operating-phase2-ai";
import type { Phase2LineBucket } from "@/lib/non-operating-phase2-lines";
import {
  mapAiRouteBucketToPhase2,
  normalizeDirectMethodAi,
} from "@/lib/non-operating-phase2-ai-utils";
import { buildModelingContext, getModelingContextSummaryForPrompt } from "@/lib/modeling-context";

const ROUTE_BUCKETS: NonOperatingPhase2AiRouteBucket[] = [
  "scheduled_item",
  "direct_forecast",
  "review_required",
  "excluded_nonrecurring",
];

const SCHEDULE_TYPES: NonOperatingPhase2ScheduleTypeAi[] = [
  "interest",
  "amortization",
  "taxes",
  "depreciation",
  "lease",
  "stock_compensation",
  "other",
];

const DIRECT_METHODS: NonOperatingPhase2DirectMethodAi[] = [
  "pct_of_revenue",
  "growth_percent",
  "flat_value",
  "manual_by_year",
  "phased_growth",
];

export interface NonOperatingPhase2ClassifyItemInput {
  lineId: string;
  label: string;
  parentLabel?: string;
  deterministicBucket?: Phase2LineBucket;
  lastHistoricalValueText?: string;
}

interface RawSuggestion {
  lineId?: string;
  suggestedRoute?: string;
  suggestedScheduleType?: string | null;
  suggestedDirectMethod?: string | null;
  confidencePct?: number;
  explanation?: string;
  detectedSignals?: unknown;
  ambiguityFlags?: unknown;
  recurringJudgment?: string;
  signExpectation?: string;
  suggestedNextAction?: string;
  userFacingSummary?: string;
  directForecastAppropriate?: boolean | null;
  directVsScheduleRationale?: string;
}

const PROMPT_BASE = `You are an investment banking financial modeling assistant. Each LINE is a **leaf** in the **non-operating / below-EBIT** section of the income statement (interest, other income/expense, etc.). Phase 2 uses **schedules** for structured items (interest, amortization, …) and **direct forecast** only for recurring non-operating lines that are not schedule-driven.

Return STRICT JSON only: { "suggestions": [ ... ] } — same order as input lines. Each object MUST include:
- lineId (string, echo input)
- suggestedRoute: one of scheduled_item | direct_forecast | review_required | excluded_nonrecurring
  - scheduled_item: interest, amortization, D&A below EBIT, leases, SBC when clearly schedule-driven
  - direct_forecast: recurring FX, royalties, investment income run-rates, other recurring below-EBIT items NOT tied to a formal schedule
  - review_required: ambiguous labels ("other income/expense, net"), mixed recurring + one-time, fair value noise, broad corporate lines
  - excluded_nonrecurring: gain/loss on sale, restructuring, impairments, one-time items, transaction costs, obvious non-recurring
- suggestedScheduleType: one of interest | amortization | taxes | depreciation | lease | stock_compensation | other, OR null if not scheduled_item
- suggestedDirectMethod: one of pct_of_revenue | growth_percent | flat_value | manual_by_year | phased_growth, OR null if suggestedRoute is not direct_forecast
- confidencePct: integer 0–100 (use full range; avoid always 90+)
- explanation: max 240 chars, technical, why this route
- detectedSignals: string array, max 8 short tokens from the label
- ambiguityFlags: string array, max 6 (e.g. "broad_other", "mixed_recurring_one_time")
- recurringJudgment: one of recurring | non_recurring | unclear
- signExpectation: one of usually_expense | usually_income | mixed_or_ambiguous
- suggestedNextAction: max 120 chars, imperative next step for the analyst
- userFacingSummary: max 160 chars, polished UI copy (include confidence feel)
- directForecastAppropriate: boolean or null — false if line should NOT be directly forecasted (should be schedule, excluded, or review)
- directVsScheduleRationale: max 200 chars — especially for "Other income / expense" style lines: why direct vs schedule vs review

Rules:
- **Other income / expense** lines: be rigorous; prefer review_required when label is net/broad or could mix themes.
- **Interest expense** (typically line id interest_expense): scheduled_item + suggestedScheduleType interest. In userFacingSummary and suggestedNextAction, state clearly that interest expense should be **derived from the future debt schedule** (debt balances, draws, repayments, revolver, rates) — **never** direct_forecast for interest expense.
- **Interest income**: scheduled_item + interest unless label clearly indicates a recurring direct run-rate suitable for direct_forecast; prefer scheduled when ambiguous.
- **Amortization / D&A below EBIT**: scheduled_item + amortization or depreciation as appropriate.
- Do not invent line items; only classify given lines.
- If deterministicBucket is provided, treat as strong prior; override only when label clearly contradicts.
- suggestedDirectMethod only when suggestedRoute is direct_forecast; otherwise null.
`;

function buildPayload(items: NonOperatingPhase2ClassifyItemInput[]): string {
  return items
    .map((i) =>
      JSON.stringify({
        lineId: i.lineId,
        label: i.label,
        parentLabel: i.parentLabel ?? "",
        deterministicBucket: i.deterministicBucket ?? "",
        lastHistoricalValueText: i.lastHistoricalValueText ?? "",
      })
    )
    .join("\n");
}

function clampPct(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(fallback)));
  return Math.max(0, Math.min(100, Math.round(n)));
}

function stringArray(v: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x).trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, max);
}

function asRecurringJudgment(v: unknown): NonOperatingPhase2RecurringJudgment {
  if (v === "recurring" || v === "non_recurring" || v === "unclear") return v;
  return "unclear";
}

function asSignExpectation(v: unknown): NonOperatingPhase2SignExpectation {
  if (v === "usually_expense" || v === "usually_income" || v === "mixed_or_ambiguous") return v;
  return "mixed_or_ambiguous";
}

function normalizeSuggestion(raw: RawSuggestion, lineId: string): NonOperatingPhase2AiLineSuggestion {
  const routeRaw = raw.suggestedRoute as string | undefined;
  const route: NonOperatingPhase2AiRouteBucket = ROUTE_BUCKETS.includes(routeRaw as NonOperatingPhase2AiRouteBucket)
    ? (routeRaw as NonOperatingPhase2AiRouteBucket)
    : "review_required";

  const stRaw = raw.suggestedScheduleType as string | null | undefined;
  const scheduleType: NonOperatingPhase2ScheduleTypeAi | null =
    stRaw && SCHEDULE_TYPES.includes(stRaw as NonOperatingPhase2ScheduleTypeAi)
      ? (stRaw as NonOperatingPhase2ScheduleTypeAi)
      : null;

  const dmRaw = raw.suggestedDirectMethod as string | null | undefined;
  let directMethod: NonOperatingPhase2DirectMethodAi | null = null;
  if (route === "direct_forecast" && dmRaw && DIRECT_METHODS.includes(dmRaw as NonOperatingPhase2DirectMethodAi)) {
    directMethod = dmRaw as NonOperatingPhase2DirectMethodAi;
  }

  const suggestedBucket = mapAiRouteBucketToPhase2(route);
  const suggestedDirectMethodNorm = normalizeDirectMethodAi(directMethod);

  return {
    lineId: typeof raw.lineId === "string" ? raw.lineId : lineId,
    suggestedBucket,
    suggestedScheduleType: route === "scheduled_item" ? scheduleType : null,
    suggestedDirectMethod: route === "direct_forecast" ? suggestedDirectMethodNorm : null,
    confidencePct: clampPct(raw.confidencePct, 62),
    explanation: typeof raw.explanation === "string" ? raw.explanation.slice(0, 240) : "",
    detectedSignals: stringArray(raw.detectedSignals, 8, 64),
    ambiguityFlags: stringArray(raw.ambiguityFlags, 6, 80),
    recurringJudgment: asRecurringJudgment(raw.recurringJudgment),
    signExpectation: asSignExpectation(raw.signExpectation),
    suggestedNextAction:
      typeof raw.suggestedNextAction === "string" ? raw.suggestedNextAction.slice(0, 120) : "",
    userFacingSummary:
      typeof raw.userFacingSummary === "string" ? raw.userFacingSummary.slice(0, 160) : "",
    directForecastAppropriate:
      typeof raw.directForecastAppropriate === "boolean" ? raw.directForecastAppropriate : null,
    directVsScheduleRationale:
      typeof raw.directVsScheduleRationale === "string" ? raw.directVsScheduleRationale.slice(0, 200) : "",
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items: NonOperatingPhase2ClassifyItemInput[] = Array.isArray(body.items) ? body.items : [];
    const companyContext = body.companyContext as CompanyContext | undefined;
    if (items.length === 0) {
      return NextResponse.json({ suggestions: [] as NonOperatingPhase2AiLineSuggestion[] });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.AI_MODEL || "gpt-4o-mini";

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured", suggestions: [] },
        { status: 503 }
      );
    }

    const modelingProfile = buildModelingContext(companyContext);
    const contextSummary = getModelingContextSummaryForPrompt(modelingProfile ?? null);
    const companyBlock = contextSummary
      ? `\nCOMPANY CONTEXT (weight suggestions; do not override obvious schedule/non-recurring rules):\n${contextSummary}\n`
      : "";

    const prompt =
      PROMPT_BASE +
      companyBlock +
      "\nLines to classify (JSON lines):\n" +
      buildPayload(items) +
      '\n\nRespond with ONLY JSON: { "suggestions": [ ... ] } same order as input.';

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[non-operating-phase2-classify] OpenAI error:", res.status, err);
      return NextResponse.json(
        { error: "LLM request failed", suggestions: [] },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const rawText = data?.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: { suggestions?: RawSuggestion[] };
    try {
      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned) as { suggestions?: RawSuggestion[] };
    } catch {
      console.error("[non-operating-phase2-classify] Invalid JSON:", rawText.slice(0, 400));
      return NextResponse.json(
        { error: "Invalid LLM response", suggestions: [] },
        { status: 502 }
      );
    }

    const arr = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const suggestions: NonOperatingPhase2AiLineSuggestion[] = items.map((item, index) =>
      normalizeSuggestion(arr[index] ?? {}, item.lineId)
    );

    return NextResponse.json({ suggestions });
  } catch (e) {
    console.error("[non-operating-phase2-classify]", e);
    return NextResponse.json({ error: "Server error", suggestions: [] }, { status: 500 });
  }
}
