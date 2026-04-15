import { NextResponse } from "next/server";
import type { CompanyContext } from "@/types/company-context";

interface RequestBody {
  companyContext?: CompanyContext;
  historicalYears: string[];
  historicalBuybackAmounts: number[];    // stored units (absolute)
  historicalNetIncome: number[];         // stored units
  historicalBbPctNi: (number | null)[];  // %
  currencyUnit: string;
}

interface RawAiResponse {
  method?: unknown;
  value?: unknown;
  rationale?: unknown;
  confidence?: unknown;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    const {
      companyContext,
      historicalYears,
      historicalBuybackAmounts,
      historicalNetIncome,
      historicalBbPctNi,
      currencyUnit,
    } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured." }, { status: 500 });
    }

    const companyName = companyContext?.user_inputs?.companyName ?? "this company";
    const industry    = companyContext?.user_inputs?.industry ?? "general";
    const entityType  = String(companyContext?.user_inputs?.publicPrivate ?? "unknown");
    const unit        = currencyUnit;

    const hasBuybacks = historicalBuybackAmounts.some((b) => b > 0);
    const avgPctNi    = historicalBbPctNi
      .filter((r): r is number => r != null && r > 0)
      .reduce((a, b, _i, arr) => a + b / arr.length, 0);

    const histSummary = historicalYears
      .map((y, i) => {
        const bb  = historicalBuybackAmounts[i] ?? 0;
        const ni  = historicalNetIncome[i] ?? 0;
        const pct = historicalBbPctNi[i];
        return `${y}: Buybacks=${bb.toLocaleString()} ${unit}, NI=${ni.toLocaleString()} ${unit}${pct != null ? `, bb/NI=${pct.toFixed(1)}%` : ""}`;
      })
      .join("\n");

    const prompt = `You are an investment banking equity modeling expert specializing in share repurchase programs.

Company: ${companyName}
Industry: ${industry}
Entity type: ${entityType}
Currency unit: ${unit}

Historical buyback data:
${histSummary || "No historical buyback data available."}
Average historical buyback as % of NI: ${hasBuybacks ? avgPctNi.toFixed(1) + "%" : "N/A (no buybacks)"}

Task: Recommend a share repurchase (buyback) forecasting method and value for this company's projection years.

Rules:
1. Private companies almost never do buybacks → method: "none" unless explicit history.
2. Public companies with consistent buyback programs → "pct_net_income", value = avg % of NI.
3. Large, one-time buyback programs → "fixed_amount", value = avg annual amount.
4. No history: private → "none". Growth-stage public → "none". Mature/cash-generative public → "pct_net_income" 5-20%.
5. Do not recommend buybacks > 50% of NI (unsustainable).
6. For "pct_net_income" and "pct_fcf": value = the % (e.g. 15 means 15%).
7. For "fixed_amount": value = annual amount in the same ${unit} as the historical data.
8. For "none": value = 0.
9. Rationale: 1-2 plain-English sentences.

Respond ONLY with valid JSON, no markdown:
{
  "method": "none" | "fixed_amount" | "pct_net_income" | "pct_fcf",
  "value": <number>,
  "rationale": "<1-2 sentence plain-English explanation>",
  "confidence": "high" | "medium" | "low"
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

    const validMethods = ["none", "fixed_amount", "pct_net_income", "pct_fcf"] as const;
    type ValidMethod = typeof validMethods[number];
    const method: ValidMethod = validMethods.includes(parsed.method as ValidMethod)
      ? (parsed.method as ValidMethod)
      : "none";

    const suggestion = {
      method,
      value:     typeof parsed.value === "number" ? Math.max(0, parsed.value) : 0,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "Based on historical buyback patterns.",
      confidence: (["high", "medium", "low"] as const).includes(parsed.confidence as "high" | "medium" | "low")
        ? (parsed.confidence as "high" | "medium" | "low")
        : "medium",
    };

    return NextResponse.json({ suggestion });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
