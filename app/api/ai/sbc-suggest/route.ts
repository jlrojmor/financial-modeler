import { NextResponse } from "next/server";
import type { CompanyContext } from "@/types/company-context";

interface RequestBody {
  companyContext?: CompanyContext;
  historicalYears: string[];
  historicalSbcAmounts: number[];     // stored units (absolute)
  historicalRevenue: number[];        // stored units
  historicalSbcPctRev: (number | null)[]; // %
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
      historicalSbcAmounts,
      historicalRevenue,
      historicalSbcPctRev,
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

    const hasSbc   = historicalSbcAmounts.some((s) => s > 0);
    const hasRev   = historicalRevenue.some((r) => r > 0);
    const validPcts = historicalSbcPctRev.filter((p): p is number => p != null && p > 0);
    const avgPct   = validPcts.length > 0
      ? validPcts.reduce((a, b) => a + b, 0) / validPcts.length
      : 0;

    const histSummary = historicalYears
      .map((y, i) => {
        const sbc  = historicalSbcAmounts[i] ?? 0;
        const rev  = historicalRevenue[i] ?? 0;
        const pct  = historicalSbcPctRev[i];
        return `${y}: SBC=${sbc.toLocaleString()} ${unit}, Rev=${rev.toLocaleString()} ${unit}${pct != null ? `, SBC/Rev=${pct.toFixed(2)}%` : ""}`;
      })
      .join("\n");

    const prompt = `You are an investment banking equity modeling expert specializing in SBC (Stock-Based Compensation) forecasting.

Company: ${companyName}
Industry: ${industry}
Entity type: ${entityType}
Currency unit: ${unit}

Historical SBC data:
${histSummary || "No historical SBC data available."}
Average historical SBC / Revenue: ${hasSbc && hasRev ? avgPct.toFixed(2) + "%" : "N/A"}

Task: Recommend the best SBC forecasting method and value for this company's projection years.

Available methods:
- "pct_revenue": project SBC as a % of revenue each year (best for companies with stable SBC/Rev ratio)
- "flat_hist": keep SBC flat at last historical value (best when revenue growth is uncertain or SBC is contractually fixed)
- "manual_by_year": no specific recommendation needed (return this only if the pattern is highly irregular)

Rules:
1. Public companies with consistent SBC/Revenue ratios (variance < 0.5pp year over year) → "pct_revenue", value = slightly smoothed avg %.
2. Private companies or companies with declining/irregular SBC → "flat_hist", value = last historical SBC amount.
3. For "pct_revenue": typical ranges: tech/SaaS 5–15%, consumer/retail 0.5–3%, financials 1–4%.
4. Do NOT recommend pct > 20% unless historical data clearly supports it.
5. If SBC history is very short (1 year) → prefer "flat_hist" for conservatism.
6. Rationale must be 1-2 plain-English sentences a non-finance user would understand.
7. For "pct_revenue": value = the % number (e.g. 1.2 means 1.2% of revenue each year).
8. For "flat_hist": value = last historical SBC in ${unit}.

Respond ONLY with valid JSON, no markdown:
{
  "method": "pct_revenue" | "flat_hist" | "manual_by_year",
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

    const validMethods = ["pct_revenue", "flat_hist", "manual_by_year"] as const;
    type ValidMethod = typeof validMethods[number];
    const method: ValidMethod = validMethods.includes(parsed.method as ValidMethod)
      ? (parsed.method as ValidMethod)
      : "flat_hist";

    const suggestion = {
      method,
      value:      typeof parsed.value === "number" ? Math.max(0, parsed.value) : 0,
      rationale:  typeof parsed.rationale === "string" ? parsed.rationale : "Based on historical SBC patterns.",
      confidence: (["high", "medium", "low"] as const).includes(parsed.confidence as "high" | "medium" | "low")
        ? (parsed.confidence as "high" | "medium" | "low")
        : "medium",
    };

    return NextResponse.json({ suggestion });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
