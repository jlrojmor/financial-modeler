import { NextResponse } from "next/server";
import type { CompanyContext } from "@/types/company-context";
import { buildModelingContext, getModelingContextSummaryForPrompt } from "@/lib/modeling-context";

export type CFRecommendation = "working_capital" | "investing" | "financing" | "non_cash";

export interface CFClassifyItemInput {
  rowId: string;
  label: string;
  bsCategory: string;
  side: "asset" | "liability" | "equity";
  historicalValues: Record<string, number>;
  revenueByYear?: Record<string, number>;
  deltaPatterns?: string;
  glossaryMatch?: string;
  currentCashFlowBehavior?: string | null;
}

export interface CFClassifySuggestion {
  rowId: string;
  recommendation: CFRecommendation;
  confidence: number;
  reason: string;
  alternatives?: CFRecommendation[];
}

const PROMPT_BASE = `You are a financial modeling expert. Classify each Balance Sheet line item into exactly one cash flow treatment for the Cash Flow Statement.

RULES:
- Core rows (e.g. Cash, AR, Inventory, AP, PP&E, Debt, Equity) are LOCKED; do not override. Only classify non-core/custom rows.
- Return STRICT JSON only: an array of objects with keys: rowId, recommendation, confidence (0-1), reason (max 200 chars), alternatives (optional array).
- Use the company context below to weight suggestions (e.g. inventory-heavy WC → working_capital emphasis; SaaS → deferred revenue / low WC; non-cash adjustments). Do not force one answer; suggest best fit and mention context in reason when relevant.

DEFINITIONS:
- working_capital: Operating current assets/liabilities excluding cash and short-term debt (receivables, payables, inventory, prepaid, accrued, deferred revenue, other operating CA/CL).
- investing: Long-term assets, investments, capitalized costs (PP&E, intangibles, strategic investments, restricted cash, marketable securities if non-current).
- financing: Debt (short/long-term borrowings, notes payable, bonds, term loans, revolver, current portion of LTD, credit facilities), equity balances (common stock, APIC, treasury, dividends payable). Do not classify notes payable or borrowings as working_capital unless the label clearly indicates trade/operating payables.
- non_cash: Accounting-only or schedule-handled elsewhere (e.g. goodwill, some other equity, DTA/DTL, ROU assets/liabilities that are not debt).

`;

function buildItemsSummary(items: CFClassifyItemInput[]): string {
  return items
    .map(
      (i) =>
        `{rowId:"${i.rowId}", label:"${i.label}", bsCategory:"${i.bsCategory}", side:"${i.side}", values:${JSON.stringify(i.historicalValues)}, revenue:${JSON.stringify(i.revenueByYear ?? {})}, deltas:"${i.deltaPatterns ?? ""}", glossary:"${i.glossaryMatch ?? ""}", current:"${i.currentCashFlowBehavior ?? ""}"}`
    )
    .join("\n");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items: CFClassifyItemInput[] = Array.isArray(body.items) ? body.items : [];
    const companyContext = body.companyContext as CompanyContext | undefined;
    if (items.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.AI_MODEL || "gpt-4o-mini";

    if (process.env.NODE_ENV !== "production") {
      console.log("[cf-classify] OPENAI_API_KEY present:", !!apiKey, "| AI_MODEL:", model);
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured", suggestions: [] },
        { status: 503 }
      );
    }

    const modelingProfile = buildModelingContext(companyContext);
    const contextSummary = getModelingContextSummaryForPrompt(modelingProfile ?? null);
    const companyBlock = contextSummary
      ? `\nCOMPANY CONTEXT (use to weight WC vs non-cash vs investing; do not force one answer):\n${contextSummary}\n\n`
      : "";

    const prompt =
      PROMPT_BASE +
      companyBlock +
      "Input items (JSON):\n" +
      buildItemsSummary(items) +
      "\n\nRespond with ONLY a JSON array of suggestion objects, no markdown.";

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
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[cf-classify] OpenAI error:", res.status, err);
      return NextResponse.json(
        { error: "LLM request failed", suggestions: [] },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: CFClassifySuggestion[];
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned) as CFClassifySuggestion[];
    } catch {
      console.error("[cf-classify] Invalid JSON:", raw.slice(0, 300));
      return NextResponse.json(
        { error: "Invalid LLM response", suggestions: [] },
        { status: 502 }
      );
    }

    const valid: CFRecommendation[] = ["working_capital", "investing", "financing", "non_cash"];
    const suggestions: CFClassifySuggestion[] = (Array.isArray(parsed) ? parsed : []).map((s) => ({
      rowId: s.rowId ?? "",
      recommendation: valid.includes(s.recommendation) ? s.recommendation : "non_cash",
      confidence: typeof s.confidence === "number" ? Math.max(0, Math.min(1, s.confidence)) : 0.5,
      reason: typeof s.reason === "string" ? s.reason.slice(0, 200) : "",
      alternatives: Array.isArray(s.alternatives) ? s.alternatives.filter((a) => valid.includes(a)) : undefined,
    }));

    return NextResponse.json({ suggestions });
  } catch (e) {
    console.error("[cf-classify]", e);
    return NextResponse.json(
      { error: "Server error", suggestions: [] },
      { status: 500 }
    );
  }
}
