import { NextResponse } from "next/server";
import type { CompanyContext } from "@/types/company-context";
import type { OpExDirectForecastMethodV1, OpExRouteStatusV1 } from "@/types/opex-forecast-v1";
import { buildModelingContext, getModelingContextSummaryForPrompt } from "@/lib/modeling-context";

const ROUTES: OpExRouteStatusV1[] = [
  "forecast_direct",
  "derive_schedule",
  "review_required",
  "excluded_nonrecurring",
];

const METHODS: OpExDirectForecastMethodV1[] = [
  "pct_of_revenue",
  "growth_percent",
  "flat_value",
  "manual_by_year",
];

export interface OpExRouteItemInput {
  lineId: string;
  label: string;
  parentLabel?: string;
  sectionOwner?: string;
  deterministicRoute?: OpExRouteStatusV1;
  deterministicRuleId?: string | null;
}

export interface OpExRouteSuggestion {
  lineId: string;
  suggestedRoute: OpExRouteStatusV1;
  suggestedMethod: OpExDirectForecastMethodV1 | null;
  confidence: "high" | "medium" | "low";
  explanation: string;
  flags: string[];
  userFacingSummary: string;
}

const PROMPT_BASE = `You are an investment banking financial modeling assistant. Classify each Income Statement operating expense LINE (already under Operating Expenses on the P&L) for Phase 1 forecasting.

Return STRICT JSON only: { "suggestions": [ ... ] } where each element matches the input order and has:
- lineId (string, echo input)
- suggestedRoute: one of forecast_direct | derive_schedule | review_required | excluded_nonrecurring
- suggestedMethod: one of pct_of_revenue | growth_percent | flat_value | manual_by_year, OR null if suggestedRoute is not forecast_direct
- confidence: high | medium | low
- explanation: max 220 chars, technical, banker-grade
- flags: string array, short tags (e.g. "mixed_costs", "schedule_candidate")
- userFacingSummary: max 140 chars, polished UI copy

Rules:
- forecast_direct: normal recurring OpEx (salaries, rent, marketing, software, insurance, professional fees, R&D, typical SG&A).
- derive_schedule: depreciation, amortization, D&A, interest, taxes, stock-based comp, lease-related when clearly schedule-driven.
- review_required: ambiguous labels ("other operating", "general corporate", "admin and other", broad combined buckets, unclear mixed items).
- excluded_nonrecurring: restructuring, impairment, litigation, severance, transaction/acquisition-related, one-time, unusual.
- If input includes deterministicRoute from rule engine, treat it as a strong prior unless the label clearly contradicts it; if you agree, keep the same suggestedRoute and say so briefly.
- suggestedMethod only when suggestedRoute is forecast_direct: pct_of_revenue for variable/scalable costs; growth_percent for stable recurring overhead; flat_value for steady known fees; manual_by_year when line is lumpy or management-specific.
- Do not invent line items; only classify what is given.
`;

function buildPayload(items: OpExRouteItemInput[]): string {
  return items
    .map((i) =>
      JSON.stringify({
        lineId: i.lineId,
        label: i.label,
        parentLabel: i.parentLabel ?? "",
        sectionOwner: i.sectionOwner ?? "",
        deterministicRoute: i.deterministicRoute ?? "",
        deterministicRuleId: i.deterministicRuleId ?? "",
      })
    )
    .join("\n");
}

function normalizeSuggestion(raw: Partial<OpExRouteSuggestion>, lineId: string, index: number): OpExRouteSuggestion {
  const route = ROUTES.includes(raw.suggestedRoute as OpExRouteStatusV1)
    ? (raw.suggestedRoute as OpExRouteStatusV1)
    : "review_required";
  let method: OpExDirectForecastMethodV1 | null = null;
  if (route === "forecast_direct") {
    const m = raw.suggestedMethod as OpExDirectForecastMethodV1 | undefined;
    method = METHODS.includes(m as OpExDirectForecastMethodV1) ? (m as OpExDirectForecastMethodV1) : "growth_percent";
  }
  const conf =
    raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low"
      ? raw.confidence
      : "medium";
  const flags = Array.isArray(raw.flags) ? raw.flags.map((x) => String(x).slice(0, 80)).slice(0, 8) : [];
  return {
    lineId: typeof raw.lineId === "string" ? raw.lineId : lineId,
    suggestedRoute: route,
    suggestedMethod: method,
    confidence: conf,
    explanation: typeof raw.explanation === "string" ? raw.explanation.slice(0, 220) : "",
    flags,
    userFacingSummary:
      typeof raw.userFacingSummary === "string"
        ? raw.userFacingSummary.slice(0, 140)
        : typeof raw.explanation === "string"
          ? raw.explanation.slice(0, 140)
          : "",
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items: OpExRouteItemInput[] = Array.isArray(body.items) ? body.items : [];
    const companyContext = body.companyContext as CompanyContext | undefined;
    if (items.length === 0) {
      return NextResponse.json({ suggestions: [] as OpExRouteSuggestion[] });
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
        max_tokens: 2048,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[opex-route] OpenAI error:", res.status, err);
      return NextResponse.json(
        { error: "LLM request failed", suggestions: [] },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const rawText = data?.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: { suggestions?: Partial<OpExRouteSuggestion>[] };
    try {
      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned) as { suggestions?: Partial<OpExRouteSuggestion>[] };
    } catch {
      console.error("[opex-route] Invalid JSON:", rawText.slice(0, 400));
      return NextResponse.json(
        { error: "Invalid LLM response", suggestions: [] },
        { status: 502 }
      );
    }

    const arr = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const suggestions: OpExRouteSuggestion[] = items.map((item, index) =>
      normalizeSuggestion(arr[index] ?? {}, item.lineId, index)
    );

    return NextResponse.json({ suggestions });
  } catch (e) {
    console.error("[opex-route]", e);
    return NextResponse.json({ error: "Server error", suggestions: [] }, { status: 500 });
  }
}
