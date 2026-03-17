import { NextResponse } from "next/server";
import type { CompanyContext } from "@/types/company-context";
import { buildModelingContext, getModelingContextSummaryForPrompt } from "@/lib/modeling-context";

export type ISSectionOwner =
  | "revenue"
  | "cogs"
  | "sga"
  | "rd"
  | "other_operating"
  | "non_operating"
  | "tax";

export interface ISClassifyItemInput {
  label: string;
  parentContext?: string;
  nearbySection?: string;
  historicalValues?: Record<string, number>;
}

export interface ISClassifySuggestion {
  sectionOwner: ISSectionOwner;
  isOperating: boolean;
  confidence: number;
  reason: string;
}

const SECTION_OWNERS: ISSectionOwner[] = [
  "revenue",
  "cogs",
  "sga",
  "rd",
  "other_operating",
  "non_operating",
  "tax",
];

const PROMPT_BASE = `You are a financial modeling expert. Classify each Income Statement line item into exactly one section and whether it is operating or non-operating.

RULES:
- Return STRICT JSON only: an array of objects with keys: sectionOwner, isOperating (boolean), confidence (0-1), reason (max 200 chars).
- sectionOwner must be exactly one of: revenue, cogs, sga, rd, other_operating, non_operating, tax.
- Operating = included in EBIT / operating profit (revenue, COGS, SG&A, R&D, other operating, D&A).
- Non-operating = below EBIT: interest, investment gains/losses, other income/expense, tax.
- Use the company context below to weight suggestions (e.g. SaaS → deferred revenue/SBC/subscription; wholesale → COGS/opex; healthcare lab → relevant peer patterns). Do not force a single answer; suggest the best fit and mention context in reason when relevant.

DEFINITIONS:
- revenue: Top-line sales, subscriptions, fees.
- cogs: Direct cost of revenue.
- sga: Selling, general & administrative.
- rd: Research & development.
- other_operating: Other operating expenses (e.g. D&A if not separate, restructuring).
- non_operating: Interest expense/income, gains/losses on investments, FX, other below EBIT.
- tax: Income tax expense.

`;

function buildItemsSummary(items: ISClassifyItemInput[]): string {
  return items
    .map(
      (i) =>
        `{label:"${i.label.replace(/"/g, '\\"')}", parentContext:"${(i.parentContext ?? "").replace(/"/g, '\\"')}", nearbySection:"${(i.nearbySection ?? "").replace(/"/g, '\\"')}", historicalValues:${JSON.stringify(i.historicalValues ?? {})}}`
    )
    .join("\n");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items: ISClassifyItemInput[] = Array.isArray(body.items) ? body.items : [];
    const companyContext = body.companyContext as CompanyContext | undefined;
    if (items.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.AI_MODEL || "gpt-4o-mini";

    if (process.env.NODE_ENV !== "production") {
      console.log("[is-classify] OPENAI_API_KEY present:", !!apiKey, "| AI_MODEL:", model);
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
      ? `\nCOMPANY CONTEXT (use to weight suggestions; do not force one answer):\n${contextSummary}\n\n`
      : "";

    const prompt =
      PROMPT_BASE +
      companyBlock +
      "Input items (one per line, JSON):\n" +
      buildItemsSummary(items) +
      "\n\nRespond with ONLY a JSON array of suggestion objects (same order as input), no markdown.";

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
      console.error("[is-classify] OpenAI error:", res.status, err);
      return NextResponse.json(
        { error: "LLM request failed", suggestions: [] },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: ISClassifySuggestion[];
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned) as ISClassifySuggestion[];
    } catch {
      console.error("[is-classify] Invalid JSON:", raw.slice(0, 300));
      return NextResponse.json(
        { error: "Invalid LLM response", suggestions: [] },
        { status: 502 }
      );
    }

    const suggestions: ISClassifySuggestion[] = (Array.isArray(parsed) ? parsed : []).map((s, idx) => ({
      sectionOwner: SECTION_OWNERS.includes(s.sectionOwner) ? s.sectionOwner : "non_operating",
      isOperating: typeof s.isOperating === "boolean" ? s.isOperating : false,
      confidence: typeof s.confidence === "number" ? Math.max(0, Math.min(1, s.confidence)) : 0.5,
      reason: typeof s.reason === "string" ? s.reason.slice(0, 200) : "",
    }));

    return NextResponse.json({ suggestions });
  } catch (e) {
    console.error("[is-classify]", e);
    return NextResponse.json(
      { error: "Server error", suggestions: [] },
      { status: 500 }
    );
  }
}
