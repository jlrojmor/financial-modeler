import { NextResponse } from "next/server";
import type { CompanyContext } from "@/types/company-context";
import type { InterestIncomeAiSuggestion } from "@/types/tax-schedule-v1";

interface RequestBody {
  companyContext?: CompanyContext;
  /** Historical interest income values per year (absolute values) */
  historicalInterestIncome: number[];
  /** Historical cash balances per year */
  historicalCashBalances: number[];
  /** Historical revenue per year (for low-cash detection) */
  historicalRevenue: number[];
  currencyUnit: string;
}

interface RawAiResponse {
  suggestedRatePct?: unknown;
  shouldSkip?: unknown;
  rationale?: unknown;
  confidence?: unknown;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    const { companyContext, historicalInterestIncome, historicalCashBalances, historicalRevenue, currencyUnit } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured." }, { status: 500 });
    }

    // Compute implied rates from historical data
    const impliedRates: number[] = [];
    for (let i = 0; i < historicalInterestIncome.length; i++) {
      const income = historicalInterestIncome[i] ?? 0;
      const cash = historicalCashBalances[i] ?? 0;
      if (cash > 0 && income > 0) {
        impliedRates.push((income / cash) * 100);
      }
    }

    const avgImpliedRate = impliedRates.length > 0
      ? impliedRates.reduce((a, b) => a + b, 0) / impliedRates.length
      : null;

    const totalHistIncome = historicalInterestIncome.reduce((a, b) => a + b, 0);
    const avgCash = historicalCashBalances.length > 0
      ? historicalCashBalances.reduce((a, b) => a + b, 0) / historicalCashBalances.length
      : 0;
    const avgRevenue = historicalRevenue.length > 0
      ? historicalRevenue.reduce((a, b) => a + b, 0) / historicalRevenue.length
      : 0;

    const cashPctRevenue = avgRevenue > 0 ? (avgCash / avgRevenue) * 100 : 0;

    const companyName = companyContext?.user_inputs?.companyName ?? "this company";
    const industry = companyContext?.user_inputs?.industry ?? "general";
    const geography = String(companyContext?.user_inputs?.mainOperatingGeography ?? "US");

    const prompt = `You are an investment banking financial modeling expert.

Company: ${companyName}
Industry: ${industry}
Geography: ${geography}
Currency unit: ${currencyUnit}

Historical interest income data:
- Average historical interest income per year: ${totalHistIncome > 0 ? (totalHistIncome / Math.max(historicalInterestIncome.length, 1)).toFixed(0) : "0"} ${currencyUnit}
- Average cash balance: ${avgCash.toFixed(0)} ${currencyUnit}
- Cash as % of revenue: ${cashPctRevenue.toFixed(1)}%
- Implied historical interest rate: ${avgImpliedRate != null ? avgImpliedRate.toFixed(1) + "%" : "N/A (no positive history)"}

Task: Suggest an interest income forecast rate (% of average cash balance) for the projection years.

Rules:
1. If historical interest income is zero or near-zero AND cash is less than 2% of revenue, recommend skipping (shouldSkip: true, rate: 0).
2. If historical interest income exists, back-calculate the implied rate and use that as the base.
3. If implied rate seems anomalously high (>10%) or low (<0.5%), normalize toward current market rates (US: ~4-5% for short-term operating cash, 2026 environment).
4. For asset-light businesses with minimal cash, a rate of 3-5% is typical.
5. Keep rationale brief (1-2 sentences), non-technical enough for non-finance users.

Respond ONLY with valid JSON, no markdown:
{
  "suggestedRatePct": <number, e.g. 4.5>,
  "shouldSkip": <true|false>,
  "rationale": "<1-2 sentence plain-English explanation>",
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
        max_tokens: 300,
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

    const suggestion: InterestIncomeAiSuggestion = {
      suggestedRatePct: typeof parsed.suggestedRatePct === "number"
        ? Math.max(0, Math.min(15, parsed.suggestedRatePct))
        : (avgImpliedRate != null ? Math.max(0.5, Math.min(10, avgImpliedRate)) : 4.5),
      shouldSkip: typeof parsed.shouldSkip === "boolean" ? parsed.shouldSkip : totalHistIncome === 0,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "Based on historical cash balance and market rates.",
      confidence: (parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low")
        ? parsed.confidence
        : "medium",
    };

    return NextResponse.json({ suggestion });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
