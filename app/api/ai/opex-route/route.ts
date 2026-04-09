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
  normalizedCategory: string;
  suggestedRoute: OpExRouteStatusV1;
  suggestedMethod: OpExDirectForecastMethodV1 | null;
  /** 0–100; primary confidence for UI */
  confidencePct: number;
  /** Derived from confidencePct for legacy consumers */
  confidence: "high" | "medium" | "low";
  explanation: string;
  detectedSignals: string[];
  ambiguityFlags: string[];
  likelyRecurring: boolean | null;
  likelyScheduleDerived: boolean | null;
  likelyNonRecurring: boolean | null;
  reviewRecommended: boolean;
  flags: string[];
  userFacingSummary: string;
}

const PROMPT_BASE = `You are an investment banking financial modeling assistant. Each LINE is already a leaf under **Operating Expenses** on the historical P&L. Phase 1 only **actively** direct-forecasts normal recurring operating expense. You must classify for routing and transparency — not forecast interest, tax, or other income/expense as OpEx direct lines.

Return STRICT JSON only: { "suggestions": [ ... ] } — same order as input. Each object MUST include:
- lineId (string, echo input)
- normalizedCategory (string, snake_case bucket, e.g. "sga_overhead", "depreciation_amortization", "ambiguous_other")
- suggestedRoute: one of forecast_direct | derive_schedule | review_required | excluded_nonrecurring
- suggestedMethod: one of pct_of_revenue | growth_percent | flat_value | manual_by_year, OR null if suggestedRoute is not forecast_direct
- confidencePct: integer 0–100 (use the full range; avoid always 90+)
- explanation: max 220 chars, technical, banker-grade, why this route
- detectedSignals: string array, max 8 items, short tokens matched from the label (e.g. "amortization", "restructuring")
- ambiguityFlags: string array, max 6 items (e.g. "broad_other", "mixed_concepts", "compressed_public_co_label") — empty if clear
- likelyRecurring: true | false | null if unknown
- likelyScheduleDerived: true | false | null
- likelyNonRecurring: true | false | null
- reviewRecommended: boolean — true if analyst should confirm before trusting
- flags: optional extra tags (max 6), may mirror ambiguityFlags
- userFacingSummary: max 140 chars, polished UI copy

Routing intent:
- forecast_direct: normal recurring OpEx (salaries, rent, marketing, software, insurance, professional fees, typical SG&A, R&D as OpEx).
- derive_schedule: depreciation, amortization, D&A, stock-based compensation, lease/ROU when clearly schedule-driven, and any **interest** / **other income(expense)** / **tax** wording if it appears on this line — route away from Phase 1 direct OpEx (do not treat as operating run-rate).
- review_required: ambiguous or compressed labels ("other operating", "operating expense net", "admin and other", multi-theme labels, broad "corporate" without detail). Prefer this over overconfident forecast_direct when uncertain.
- excluded_nonrecurring: restructuring, impairment, litigation, severance, M&A/transaction, one-time, unusual, gains/losses on disposal.

Behavior:
- Avoid overconfidence: if unsure between forecast_direct and review_required, choose review_required and set reviewRecommended true with moderate confidencePct.
- If the label clearly indicates amortization/depreciation/SBC, use derive_schedule even if buried in a long phrase.
- If deterministicRoute / deterministicRuleId are provided, treat as a strong prior; only override when the label clearly contradicts (e.g. label says amortization but deterministic said direct).
- suggestedMethod only when suggestedRoute is forecast_direct: pct_of_revenue for variable/scalable; growth_percent for stable overhead; flat_value for steady fees; manual_by_year for lumpy or management-specific.
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

function clampConfidencePct(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(fallback)));
  return Math.max(0, Math.min(100, Math.round(n)));
}

function bucketFromPct(pct: number): "high" | "medium" | "low" {
  if (pct >= 80) return "high";
  if (pct >= 55) return "medium";
  return "low";
}

function asNullableBool(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  return null;
}

function stringArray(v: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x).trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, max);
}

function normalizeSuggestion(raw: Partial<OpExRouteSuggestion>, lineId: string): OpExRouteSuggestion {
  const route = ROUTES.includes(raw.suggestedRoute as OpExRouteStatusV1)
    ? (raw.suggestedRoute as OpExRouteStatusV1)
    : "review_required";

  let method: OpExDirectForecastMethodV1 | null = null;
  if (route === "forecast_direct") {
    const m = raw.suggestedMethod as OpExDirectForecastMethodV1 | undefined;
    method = METHODS.includes(m as OpExDirectForecastMethodV1) ? (m as OpExDirectForecastMethodV1) : "growth_percent";
  }

  let confidencePct = clampConfidencePct(raw.confidencePct, 62);
  if (raw.confidencePct == null && (raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low")) {
    confidencePct =
      raw.confidence === "high" ? 88 : raw.confidence === "medium" ? 68 : 45;
  }

  const confidence = bucketFromPct(confidencePct);
  const detectedSignals = stringArray(raw.detectedSignals, 8, 64);
  const ambiguityFlags = stringArray(raw.ambiguityFlags, 6, 80);
  const flags = stringArray(raw.flags, 8, 80);
  const normalizedCategory =
    typeof raw.normalizedCategory === "string" && raw.normalizedCategory.trim()
      ? raw.normalizedCategory.trim().slice(0, 80)
      : "uncategorized";

  const reviewRecommended =
    typeof raw.reviewRecommended === "boolean"
      ? raw.reviewRecommended
      : route === "review_required";

  return {
    lineId: typeof raw.lineId === "string" ? raw.lineId : lineId,
    normalizedCategory,
    suggestedRoute: route,
    suggestedMethod: method,
    confidencePct,
    confidence,
    explanation: typeof raw.explanation === "string" ? raw.explanation.slice(0, 220) : "",
    detectedSignals,
    ambiguityFlags,
    likelyRecurring: asNullableBool(raw.likelyRecurring),
    likelyScheduleDerived: asNullableBool(raw.likelyScheduleDerived),
    likelyNonRecurring: asNullableBool(raw.likelyNonRecurring),
    reviewRecommended,
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
        max_tokens: 4096,
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
      normalizeSuggestion(arr[index] ?? {}, item.lineId)
    );

    return NextResponse.json({ suggestions });
  } catch (e) {
    console.error("[opex-route]", e);
    return NextResponse.json({ error: "Server error", suggestions: [] }, { status: 500 });
  }
}
