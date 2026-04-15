import { NextResponse } from "next/server";
import type { CompanyContext } from "@/types/company-context";

interface RequestBody {
  companyContext?: CompanyContext;
  historicalYears: string[];
  historicalDivAmounts: number[];       // stored units (absolute)
  historicalNetIncome: number[];        // stored units
  historicalPayoutRatios: (number | null)[]; // %
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
      historicalDivAmounts,
      historicalNetIncome,
      historicalPayoutRatios,
      currencyUnit,
    } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured." }, { status: 500 });
    }

    const companyName  = companyContext?.user_inputs?.companyName ?? "this company";
    const industry     = companyContext?.user_inputs?.industry ?? "general";
    const entityType   = String(companyContext?.user_inputs?.publicPrivate ?? "unknown");
    const unit         = currencyUnit;

    const hasDividends = historicalDivAmounts.some((d) => d > 0);
    const avgPayout    = historicalPayoutRatios
      .filter((r): r is number => r != null && r > 0)
      .reduce((a, b, _i, arr) => a + b / arr.length, 0);

    const histSummary = historicalYears
      .map((y, i) => {
        const div = historicalDivAmounts[i] ?? 0;
        const ni  = historicalNetIncome[i] ?? 0;
        const pr  = historicalPayoutRatios[i];
        return `${y}: Div=${div.toLocaleString()} ${unit}, NI=${ni.toLocaleString()} ${unit}${pr != null ? `, payout=${pr.toFixed(1)}%` : ""}`;
      })
      .join("\n");

    const prompt = `You are an investment banking equity modeling expert specializing in dividend policy forecasting.

Company: ${companyName}
Industry: ${industry}
Entity type: ${entityType}
Currency unit: ${unit}

Historical dividend data:
${histSummary || "No historical dividend data available."}
Average historical payout ratio: ${hasDividends ? avgPayout.toFixed(1) + "%" : "N/A (no dividends paid)"}

Task: Recommend a dividend forecasting method and value for this company's projection years.

Rules:
1. Private companies typically pay no dividends or minimal dividends → method: "none" unless clear history.
2. Public companies with consistent payout history → method: "payout_ratio", value = avg payout % slightly smoothed.
3. Companies with irregular NI but steady dividends → method: "fixed_amount", value = avg annual dividend.
4. If no history: for private cos → "none". For public growth cos → "none". For mature public cos → suggest 20-30%.
5. Keep payout ratio ≤ 80% (unsustainable above that).
6. Rationale should be 1-2 plain-English sentences.
7. For "payout_ratio": value = the % (e.g. 30 means 30% of NI).
8. For "fixed_amount": value = annual dividend in the same ${unit} as the historical data.
9. For "none": value = 0.

Respond ONLY with valid JSON, no markdown:
{
  "method": "none" | "payout_ratio" | "fixed_amount",
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

    const validMethods = ["none", "payout_ratio", "fixed_amount"] as const;
    type ValidMethod = typeof validMethods[number];
    const method: ValidMethod = validMethods.includes(parsed.method as ValidMethod)
      ? (parsed.method as ValidMethod)
      : "none";

    const suggestion = {
      method,
      value:     typeof parsed.value === "number" ? Math.max(0, parsed.value) : 0,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "Based on historical dividend patterns.",
      confidence: (["high", "medium", "low"] as const).includes(parsed.confidence as "high" | "medium" | "low")
        ? (parsed.confidence as "high" | "medium" | "low")
        : "medium",
    };

    return NextResponse.json({ suggestion });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
