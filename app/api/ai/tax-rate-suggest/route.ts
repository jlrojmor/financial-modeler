import { NextResponse } from "next/server";
import type { CompanyContext } from "@/types/company-context";
import type { TaxScheduleAiSuggestion } from "@/types/tax-schedule-v1";

interface RequestBody {
  companyContext?: CompanyContext;
  /** Historical ETR values (0–1 decimal) */
  historicalEtrs: number[];
  /** Historical years corresponding to ETR values */
  historicalYears: string[];
  /** Whether any historical year had a flagged erratic ETR */
  hasErraticEtr: boolean;
  currencyUnit: string;
}

interface RawAiResponse {
  suggestedRatePct?: unknown;
  entityTypeNote?: unknown;
  rationale?: unknown;
  erraticFlag?: unknown;
  erraticExplanation?: unknown;
  confidence?: unknown;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    const { companyContext, historicalEtrs, historicalYears, hasErraticEtr, currencyUnit } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured." }, { status: 500 });
    }

    const companyName = companyContext?.user_inputs?.companyName ?? "this company";
    const industry = companyContext?.user_inputs?.industry ?? "general";
    const geography = String(companyContext?.user_inputs?.mainOperatingGeography ?? "US");
    const entityType = String(companyContext?.user_inputs?.publicPrivate ?? "unknown");

    const etrSummary = historicalEtrs.length > 0
      ? historicalYears.map((y, i) => `${y}: ${((historicalEtrs[i] ?? 0) * 100).toFixed(1)}%`).join(", ")
      : "No historical data";

    const avgEtr = historicalEtrs.length > 0
      ? historicalEtrs.reduce((a, b) => a + b, 0) / historicalEtrs.length
      : null;

    const prompt = `You are an investment banking tax modeling expert.

Company: ${companyName}
Industry: ${industry}
Geography: ${geography}
Entity type: ${entityType}
Currency: ${currencyUnit}

Historical Effective Tax Rates (ETR = tax expense / EBT):
${etrSummary}
Average historical ETR: ${avgEtr != null ? (avgEtr * 100).toFixed(1) + "%" : "N/A"}
Erratic ETR detected: ${hasErraticEtr ? "YES (at least one year deviates >10pp from median)" : "No"}

Task: Suggest a forecast effective tax rate for the projection years.

Rules:
1. S-corp, LLC, partnership, or pass-through entities → flag in entityTypeNote, suggest 0% or prompt user to verify.
2. US C-corp: blended federal (21%) + state (6-9% average) = ~27-30%.
3. International: use appropriate statutory rate for the geography.
4. If historical ETR is erratic, explain the likely cause (one-time items, deferred tax, etc.) and suggest the normalized rate.
5. If no historical data: default to 28% for US C-corp.
6. Keep rationale and explanations brief (1-2 sentences), plain English for non-finance users.

Respond ONLY with valid JSON, no markdown:
{
  "suggestedRatePct": <number, e.g. 28>,
  "entityTypeNote": <null or "string explaining pass-through treatment">,
  "rationale": "<1-2 sentence plain-English explanation>",
  "erraticFlag": <true|false>,
  "erraticExplanation": <null or "string explaining why ETR was erratic">,
  "confidence": "<high|medium|low>"
}`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 400,
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.text();
      return NextResponse.json({ error: `OpenAI error: ${err}` }, { status: 500 });
    }

    const openaiData = await openaiRes.json() as { choices?: { message?: { content?: string } }[] };
    const content = openaiData.choices?.[0]?.message?.content ?? "";

    let parsed: RawAiResponse = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]) as RawAiResponse;
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response." }, { status: 500 });
    }

    const fallbackRate = avgEtr != null ? Math.max(0, Math.min(60, avgEtr * 100)) : 28;

    const suggestion: TaxScheduleAiSuggestion = {
      suggestedRatePct: typeof parsed.suggestedRatePct === "number"
        ? Math.max(0, Math.min(60, parsed.suggestedRatePct))
        : fallbackRate,
      entityTypeNote: typeof parsed.entityTypeNote === "string" ? parsed.entityTypeNote : null,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "Based on historical ETR and company profile.",
      erraticFlag: typeof parsed.erraticFlag === "boolean" ? parsed.erraticFlag : hasErraticEtr,
      erraticExplanation: typeof parsed.erraticExplanation === "string" ? parsed.erraticExplanation : null,
      confidence: (parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low")
        ? parsed.confidence
        : "medium",
    };

    return NextResponse.json({ suggestion });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
